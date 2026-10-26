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
  | { kind: 'grassPaint' }
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
  private onBuildAt: ((x: number, y: number, z: number) => boolean) | undefined
  private onRuntimeObjectClick: ((id: string) => void) | undefined
  private runtimeMode = false
  // O BVH retorna só a interseção mais próxima, evitando coletar todos os triângulos atingidos.
  private raycaster = Object.assign(new THREE.Raycaster(), { firstHitOnly: true })
  private pointer = new THREE.Vector2()
  private drag: Drag = { kind: 'none' }
  private lastEvent: PointerEvent | null = null
  private cursorResetTimer: ReturnType<typeof setTimeout> | null = null
  private lastGrassPaintAt = 0
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

  constructor(canvas: HTMLCanvasElement, orbit: OrbitCamera, world: World, state: EditorState, isGizmoDragging: () => boolean = () => false, onBuildAt?: (x: number, y: number, z: number) => boolean, onRuntimeObjectClick?: (id: string) => void) {
    this.canvas = canvas
    this.orbit = orbit
    this.world = world
    this.state = state
    this.isGizmoDragging = isGizmoDragging
    this.onBuildAt = onBuildAt
    this.onRuntimeObjectClick = onRuntimeObjectClick
    this.ring.rotation.x = -Math.PI / 2
    this.ring.renderOrder = 10
    this.ring.visible = false
    world.scene.add(this.ring)
    canvas.addEventListener('pointerdown', this.onDown)
    document.addEventListener('mousemove', this.onDocumentMouseMove)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', this.onContext)
  }

  /** Bloqueia as ferramentas de edição durante a execução do mundo. */
  setRuntimeMode(enabled: boolean): void {
    this.runtimeMode = enabled
    this.setCursorOverride(null)
    this.drag = { kind: 'none' }
    this.lastEvent = null
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  /** Chamado a cada quadro: esculpe enquanto o botão está pressionado. */
  update(dt: number): void {
    if (this.state.tool !== 'terrain' && this.state.tool !== 'grass') this.ring.visible = false
    const e = this.lastEvent
    if ((this.drag.kind !== 'paint' && this.drag.kind !== 'grassPaint') || !e) return
    this.aim(e)
    const hit = this.terrainHit()
    if (!hit) return
    if (this.drag.kind === 'grassPaint') {
      const now = performance.now()
      if (now - this.lastGrassPaintAt >= 90) {
        if (e.shiftKey) this.world.terrain.grass.erase(hit.point.x, hit.point.z, this.state.brush.radius)
        else this.world.terrain.grass.paint(hit.point.x, hit.point.z, this.state.brush.radius, this.state.brush.strength)
        this.lastGrassPaintAt = now
      }
      this.moveRing(hit.point)
      return
    }
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
    // O heightfield atravessa apenas as células tocadas pelo raio; não precisa
    // esperar o BVH em worker nem testar toda a malha durante o primeiro traço.
    return this.world.terrain.intersectRay(this.raycaster)
  }

  /**
   * Inclui os filhos do mesh (como as linhas da malha poligonal).
   * O clique pode atingir uma linha em vez da malha sólida; nesse caso,
   * sobe pela hierarquia até encontrar o GameObject que possui o ID.
   */
  private objectHit(): THREE.Intersection | undefined {
    // O objeto-raiz já possui uma malha proxy de seleção. Não percorra as
    // malhas internas dos modelos GLB/FBX: alguns assets têm centenas de
    // milhares de triângulos e travavam a construção por raycast recursivo.
    const hits = this.raycaster.intersectObjects(this.world.pickables(), false)
    return hits.find((hit) => this.objectIdFromHit(hit.object) !== null)
  }

  private objectIdFromHit(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object
    while (current) {
      const id = current.userData.id
      if (typeof id === 'string' && this.world.get(id)) return id
      current = current.parent
    }
    return null
  }

  private moveRing(point: THREE.Vector3): void {
    const r = this.state.brush.radius
    this.ring.position.set(point.x, point.y + 0.15, point.z)
    this.ring.scale.set(r, r, 1)
    this.ring.visible = true
  }

  // ---------- eventos ----------
  private onDown = (e: PointerEvent): void => {
    if (this.runtimeMode) {
      // Em Run, o clique esquerdo dispara o Visual Script do objeto atingido.
      // Se clicar em espaço vazio, continua controlando a câmera como antes.
      if (e.button === 0) {
        this.aim(e)
        const hit = this.objectHit()
        const id = hit ? this.objectIdFromHit(hit.object) : null
        if (id) {
          e.preventDefault()
          this.onRuntimeObjectClick?.(id)
          return
        }
      }
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        e.preventDefault()
        this.setCursorOverride('orbit')
        this.begin({ kind: 'orbit', lastX: e.clientX, lastY: e.clientY }, e)
      }
      return
    }
    if (this.orbit.firstPerson) {
      if (e.button === 0 && document.pointerLockElement !== this.canvas) {
        void this.canvas.requestPointerLock()
      }
      return
    }
    if (this.isGizmoDragging()) return
    this.lastEvent = e
    if (e.button === 1) {
      e.preventDefault()
      this.setCursorOverride('orbit')
      this.begin({ kind: 'orbit', lastX: e.clientX, lastY: e.clientY }, e)
      return
    }
    if (e.button === 2) {
      this.setCursorOverride('pan')
      this.begin({ kind: 'pan', lastX: e.clientX, lastY: e.clientY }, e)
      return
    }
    if (e.button !== 0) return

    this.aim(e)
    if (this.state.tool === 'terrain' || this.state.tool === 'grass') {
      const hit = this.terrainHit()
      if (hit) {
        if (this.state.tool === 'grass') {
          this.begin({ kind: 'grassPaint' }, e)
          if (e.shiftKey) this.world.terrain.grass.erase(hit.point.x, hit.point.z, this.state.brush.radius)
          else this.world.terrain.grass.paint(hit.point.x, hit.point.z, this.state.brush.radius, this.state.brush.strength)
          this.lastGrassPaintAt = performance.now()
          this.moveRing(hit.point)
          return
        }
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
      const id = hit ? this.objectIdFromHit(hit.object) : null
      const obj = id ? this.world.get(id) : undefined
      if (obj) {
        this.world.select(obj.id)
        this.world.events.emit('objectClicked', { id: obj.id })
        // O TransformControls nativo é o único responsável por transformar objetos.
        // Não inicie um segundo arrasto manual no mesmo pointerdown: isso disputa
        // o pointer capture e impede o gizmo de mover modelos importados.
        return
      }
    }
    this.begin({ kind: 'orbitPending', x: e.clientX, y: e.clientY }, e)
  }

  private begin(drag: Drag, e: PointerEvent): void {
    this.drag = drag
    this.canvas.setPointerCapture(e.pointerId)
  }

  private setCursorOverride(cursor: 'orbit' | 'pan' | 'zoom' | 'erase' | null): void {
    if (this.cursorResetTimer !== null) {
      clearTimeout(this.cursorResetTimer)
      this.cursorResetTimer = null
    }
    if (cursor) this.canvas.dataset.cursorOverride = cursor
    else delete this.canvas.dataset.cursorOverride
  }

  private flashCursorOverride(cursor: 'zoom', duration = 180): void {
    this.setCursorOverride(cursor)
    this.cursorResetTimer = setTimeout(() => {
      if (this.canvas.dataset.cursorOverride === cursor) this.setCursorOverride(null)
    }, duration)
  }

  private onDocumentMouseMove = (e: MouseEvent): void => {
    if (!this.orbit.firstPerson || document.pointerLockElement !== this.canvas) return
    this.orbit.rotate(e.movementX, e.movementY)
  }

  private onMove = (e: PointerEvent): void => {
    this.lastEvent = e
    const canEraseGrass = this.state.tool === 'grass' && e.shiftKey && (this.drag.kind === 'none' || this.drag.kind === 'grassPaint')
    if (canEraseGrass && this.canvas.dataset.cursorOverride !== 'erase') this.setCursorOverride('erase')
    else if (!canEraseGrass && this.canvas.dataset.cursorOverride === 'erase') this.setCursorOverride(null)
    const d = this.drag
    switch (d.kind) {
      case 'none':
        this.hover(e)
        break
      case 'orbitPending':
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_THRESHOLD) {
          this.drag = { kind: 'orbit', lastX: d.x, lastY: d.y }
          this.setCursorOverride('orbit')
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
      case 'grassPaint':
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
    if (this.state.tool !== 'terrain' && this.state.tool !== 'grass') return
    this.aim(e)
    const hit = this.terrainHit()
    if (hit) this.moveRing(hit.point)
    else this.ring.visible = false
  }

  private onUp = (e: PointerEvent): void => {
    const d = this.drag
    this.drag = { kind: 'none' }
    this.setCursorOverride(null)
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)

    switch (d.kind) {
      case 'paint':
        // Recalcula a grama pintada apenas uma vez no fim da pincelada;
        // durante o arrasto, o terreno é atualizado por regiões locais.
        this.world.terrain.finishBrush()
        this.world.notifyTerrain()
        break
      case 'grassPaint':
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

  /** Encontra a superfície de apoio abaixo do ponto clicado. */
  private buildSupportBelow(x: number, z: number, referenceY: number, excludeId: string | null): number {
    const originY = Math.max(100, referenceY + 100)
    const down = new THREE.Raycaster(
      new THREE.Vector3(x, originY, z),
      new THREE.Vector3(0, -1, 0),
      0,
      originY + 100,
    )
    const surfaces: number[] = []
    for (const object of this.world.list()) {
      if (!object.mesh.visible || object.mesh.userData.locked === true || object.id === excludeId) continue
      if (object.mesh.userData.colliderType === 'none') continue
      // A caixa raiz é o mesmo proxy usado pelo sistema de colisão e evita
      // percorrer triângulos pesados de modelos GLB/FBX.
      const hit = down.intersectObject(object.mesh, false).find((item) => {
        if (!item.face) return false
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.mesh.matrixWorld)
        const normal = item.face.normal.clone().applyMatrix3(normalMatrix).normalize()
        return normal.y > 0.5 && item.point.y <= referenceY + 0.05
      })
      if (hit) surfaces.push(hit.point.y)
    }
    if (this.world.terrain.mesh.visible) {
      const terrainHit = this.world.terrain.intersectRay(down)
      if (terrainHit && terrainHit.point.y <= referenceY + 0.05) surfaces.push(terrainHit.point.y)
      else surfaces.push(this.world.terrain.heightAt(x, z))
    } else if (surfaces.length === 0) {
      return referenceY
    }
    // A superfície válida mais alta abaixo do clique é a primeira base sólida
    // que sustenta o objeto sem fazê-lo atravessar outro colisor.
    return surfaces.length ? Math.max(...surfaces) : referenceY
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

    // Ctrl+clique mantém exatamente o posicionamento antigo, na face atingida.
    // Clique normal procura a base de colisão abaixo do ponto clicado.
    // O objeto clicado também pode servir de apoio. Excluí-lo fazia a nova peça
    // ignorar o topo da plataforma e voltar para a altura do terreno, sobrepondo-a.
    const baseY = e.ctrlKey
      ? (useObject ? hit.point.y : this.world.terrain.heightAt(x, z))
      : this.buildSupportBelow(x, z, hit.point.y, null)

    if (this.onBuildAt?.(x, baseY, z)) return
    this.world.place(this.state.buildShape, x, baseY, z)
  }

  private onLeave = (): void => {
    if (this.drag.kind === 'none') {
      this.ring.visible = false
      this.setCursorOverride(null)
    }
  }

  private onWheel = (e: WheelEvent): void => {
    // A roda em painéis HTML deve rolar o painel, não aproximar/afastar a câmera.
    // elementFromPoint também cobre sobreposições que deixam passar o ponteiro
    // até o canvas por causa de pointer-events.
    const elements = [
      e.target instanceof Element ? e.target : null,
      document.elementFromPoint(e.clientX, e.clientY),
    ]
    const overUi = elements.some(element => element?.closest(
      '.hud-settings-panel, [data-no-camera-zoom], [role="dialog"], .scroll, .sidebar, .inspector, input, textarea, select, button, a, [contenteditable="true"]',
    ))
    if (overUi) return

    e.preventDefault()
    if (this.drag.kind === 'none' || this.drag.kind === 'orbitPending') this.flashCursorOverride('zoom')
    this.orbit.zoom(e.deltaY)
  }

  private onContext = (e: Event): void => {
    e.preventDefault()
  }

  dispose(): void {
    this.setCursorOverride(null)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    document.removeEventListener('mousemove', this.onDocumentMouseMove)
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
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
