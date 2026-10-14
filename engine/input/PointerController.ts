import * as THREE from 'three'
import type { EditorState } from '../EditorState'
import { snap, clamp } from '../lib/math'
import type { OrbitCamera } from '../view/OrbitCamera'
import type { World } from '../world/World'

type Drag =
  | { kind: 'none' }
  | { kind: 'orbitPending'; x: number; y: number }
  | { kind: 'orbit'; lastX: number; lastY: number }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'paint' }
  | { kind: 'move'; id: string; planeY: number; offX: number; offZ: number; rest: number; changed: boolean }
  | { kind: 'rotate'; id: string; lastX: number; changed: boolean }
  | { kind: 'scale'; id: string; startY: number; startScale: number; changed: boolean }

const CLICK_THRESHOLD = 4
const PAINT_RATE = 1.5
const GRID = 0.5

/**
 * Traduz mouse/toque em ações do editor: orbitar, mover a câmera, selecionar,
 * transformar objetos, construir e esculpir o terreno.
 *  - botão esquerdo: ferramenta atual (em área vazia, orbita)
 *  - botão do meio: orbitar | botão direito: mover a câmera | roda: zoom
 */
export class PointerController {
  private canvas: HTMLCanvasElement
  private orbit: OrbitCamera
  private world: World
  private state: EditorState
  private isGizmoDragging: () => boolean
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private drag: Drag = { kind: 'none' }
  private lastEvent: PointerEvent | null = null
  private ring = new THREE.Mesh(
    new THREE.RingGeometry(0.94, 1, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffb4a2,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  )

  constructor(canvas: HTMLCanvasElement, orbit: OrbitCamera, world: World, state: EditorState, isGizmoDragging: () => boolean = () => false) {
    this.canvas = canvas
    this.orbit = orbit
    this.world = world
    this.state = state
    this.isGizmoDragging = isGizmoDragging
    this.ring.rotation.x = -Math.PI / 2
    this.ring.renderOrder = 10
    this.ring.visible = false
    world.scene.add(this.ring)
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', this.onContext)
  }

  /** Chamado a cada quadro: esculpe enquanto o botão está pressionado. */
  update(dt: number): void {
    if (this.state.tool !== 'terrain') this.ring.visible = false
    const e = this.lastEvent
    if (this.drag.kind !== 'paint' || !e) return
    this.aim(e)
    const hit = this.terrainHit()
    if (!hit) return
    const sign = e.shiftKey ? -1 : 1
    this.world.terrain.brush(
      hit.point.x,
      hit.point.z,
      this.state.brush.radius,
      sign * this.state.brush.strength * PAINT_RATE * Math.min(dt, 0.05),
    )
    this.moveRing(hit.point)
  }

  // ---------- raycast ----------
  private aim(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.orbit.camera)
  }

  private terrainHit(): THREE.Intersection | undefined {
    if (!this.world.terrain.mesh.visible) return undefined
    return this.raycaster.intersectObject(this.world.terrain.mesh)[0]
  }

  private objectHit(): THREE.Intersection | undefined {
    return this.raycaster.intersectObjects(this.world.pickables())[0]
  }

  private moveRing(point: THREE.Vector3): void {
    const r = this.state.brush.radius
    this.ring.position.set(point.x, point.y + 0.15, point.z)
    this.ring.scale.set(r, r, 1)
    this.ring.visible = true
  }

  // ---------- eventos ----------
  private onDown = (e: PointerEvent): void => {
    if (this.isGizmoDragging()) return
    this.lastEvent = e
    if (e.button === 1) {
      e.preventDefault()
      this.begin({ kind: 'orbit', lastX: e.clientX, lastY: e.clientY }, e)
      return
    }
    if (e.button === 2) {
      this.begin({ kind: 'pan', lastX: e.clientX, lastY: e.clientY }, e)
      return
    }
    if (e.button !== 0) return

    this.aim(e)
    if (this.state.tool === 'terrain') {
      const hit = this.terrainHit()
      if (hit) {
        this.begin({ kind: 'paint' }, e)
        const sign = e.shiftKey ? -1 : 1
        this.world.terrain.brush(
          hit.point.x,
          hit.point.z,
          this.state.brush.radius,
          sign * this.state.brush.strength * 0.12,
        )
        return
      }
    } else if (this.state.tool === 'select') {
      const hit = this.objectHit()
      const id = hit ? (hit.object.userData.id as string) : null
      const obj = id ? this.world.get(id) : undefined
      if (obj) {
        // Atualiza a seleção antes do evento para que scripts antigos que usam
        // a seleção como fallback também enxerguem o objeto clicado.
        this.world.select(obj.id)
        this.world.events.emit('objectClicked', { id: obj.id })
        this.beginTransform(obj.id, e)
        return
      }
    }
    this.begin({ kind: 'orbitPending', x: e.clientX, y: e.clientY }, e)
  }

  private beginTransform(id: string, e: PointerEvent): void {
    const obj = this.world.get(id)
    if (!obj) return
    const m = obj.mesh
    switch (this.state.transform) {
      case 'move': {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -m.position.y)
        const p = new THREE.Vector3()
        const hasHit = this.raycaster.ray.intersectPlane(plane, p) !== null
        this.begin(
          {
            kind: 'move',
            id,
            planeY: m.position.y,
            offX: hasHit ? m.position.x - p.x : 0,
            offZ: hasHit ? m.position.z - p.z : 0,
            rest: m.position.y - this.world.terrain.heightAt(m.position.x, m.position.z),
            changed: false,
          },
          e,
        )
        break
      }
      case 'rotate':
        this.begin({ kind: 'rotate', id, lastX: e.clientX, changed: false }, e)
        break
      case 'scale':
        this.begin({ kind: 'scale', id, startY: e.clientY, startScale: m.scale.x, changed: false }, e)
        break
    }
  }

  private begin(drag: Drag, e: PointerEvent): void {
    this.drag = drag
    this.canvas.setPointerCapture(e.pointerId)
  }

  private onMove = (e: PointerEvent): void => {
    this.lastEvent = e
    const d = this.drag
    switch (d.kind) {
      case 'none':
        this.hover(e)
        break
      case 'orbitPending':
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_THRESHOLD) {
          this.drag = { kind: 'orbit', lastX: d.x, lastY: d.y }
          this.onMove(e)
        }
        break
      case 'orbit':
        this.orbit.rotate(e.clientX - d.lastX, e.clientY - d.lastY)
        d.lastX = e.clientX
        d.lastY = e.clientY
        break
      case 'pan':
        this.orbit.pan(e.clientX - d.lastX, e.clientY - d.lastY)
        d.lastX = e.clientX
        d.lastY = e.clientY
        break
      case 'paint':
        this.aim(e)
        {
          const hit = this.terrainHit()
          if (hit) this.moveRing(hit.point)
        }
        break
      case 'move': {
        const obj = this.world.get(d.id)
        if (!obj) break
        this.aim(e)
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.planeY)
        const p = new THREE.Vector3()
        if (this.raycaster.ray.intersectPlane(plane, p) === null) break
        const x = clamp(snap(p.x + d.offX, GRID), -50, 50)
        const z = clamp(snap(p.z + d.offZ, GRID), -50, 50)
        const y = this.world.terrain.heightAt(x, z) + d.rest
        if (x !== obj.mesh.position.x || z !== obj.mesh.position.z) d.changed = true
        obj.mesh.position.set(x, y, z)
        break
      }
      case 'rotate': {
        const obj = this.world.get(d.id)
        if (!obj) break
        obj.mesh.rotation.y += (e.clientX - d.lastX) * 0.012
        d.lastX = e.clientX
        d.changed = true
        break
      }
      case 'scale': {
        const obj = this.world.get(d.id)
        if (!obj) break
        const s = clamp(d.startScale * Math.exp(-(e.clientY - d.startY) * 0.008), 0.1, 20)
        obj.mesh.scale.set(s, s, s)
        d.changed = true
        break
      }
    }
  }

  private hover(e: PointerEvent): void {
    if (this.state.tool !== 'terrain') return
    this.aim(e)
    const hit = this.terrainHit()
    if (hit) this.moveRing(hit.point)
    else this.ring.visible = false
  }

  private onUp = (e: PointerEvent): void => {
    const d = this.drag
    this.drag = { kind: 'none' }
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)

    switch (d.kind) {
      case 'paint':
        this.world.notifyTerrain()
        break
      case 'move':
      case 'rotate':
      case 'scale':
        if (d.changed) this.world.notifyChanged(d.id)
        break
      case 'orbitPending':
        this.click(e)
        break
      default:
        break
    }
  }

  /** Clique simples (sem arrastar) em área vazia. */
  private click(e: PointerEvent): void {
    if (e.button !== 0) return
    if (this.state.tool === 'select') {
      this.world.select(null)
      return
    }
    if (this.state.tool !== 'build') return
    this.aim(e)
    const objHit = this.objectHit()
    const terrHit = this.terrainHit()
    const useObject = objHit !== undefined && (terrHit === undefined || objHit.distance < terrHit.distance)
    const hit = useObject ? objHit : terrHit
    if (!hit) return
    const x = clamp(snap(hit.point.x, GRID), -50, 50)
    const z = clamp(snap(hit.point.z, GRID), -50, 50)
    const baseY = useObject ? hit.point.y : this.world.terrain.heightAt(x, z)
    this.world.place(this.state.buildShape, x, baseY, z)
  }

  private onLeave = (): void => {
    if (this.drag.kind === 'none') this.ring.visible = false
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.orbit.zoom(e.deltaY)
  }

  private onContext = (e: Event): void => {
    e.preventDefault()
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown)
    this.canvas.removeEventListener('pointermove', this.onMove)
    this.canvas.removeEventListener('pointerup', this.onUp)
    this.canvas.removeEventListener('pointercancel', this.onUp)
    this.canvas.removeEventListener('pointerleave', this.onLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContext)
    this.world.scene.remove(this.ring)
    this.ring.geometry.dispose()
    ;(this.ring.material as THREE.Material).dispose()
  }
}
