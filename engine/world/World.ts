import * as THREE from 'three'
import { EventBus } from './events/EventBus'
import type { EngineEvents } from './events/types'
import type { GameObject, ObjectInfo, ObjectPatch } from '../model/object/GameObject'
import { PRIMITIVE_DEFS } from '../model/object/defs'
import { createPrimitive } from '../model/object/Primitives'
import { TERRAIN_ID, TerrainMesh } from './map/TerrainMesh'
import { DEFAULT_SEED } from './worldGeneration/Heightfield'
import { clamp } from '../lib/math'
import { reserveId } from '../lib/id'
import type { ObjectType, TerrainData } from '../project/format'

export interface TerrainInfo {
  visible: boolean
  seed: number
  edits: number
}

const BACKGROUND = 0x12151c

export class World {
  readonly scene = new THREE.Scene()
  readonly events = new EventBus<EngineEvents>()
  readonly terrain = new TerrainMesh(DEFAULT_SEED)
  private grid = new THREE.GridHelper(100, 100, 0x4a5060, 0x2a2f3a)
  private objects = new Map<string, GameObject>()
  private selectedId: string | null = null
  private gridVisible = true

  constructor() {
    this.scene.background = new THREE.Color(BACKGROUND)
    this.scene.fog = new THREE.Fog(BACKGROUND, 70, 170)
    this.scene.add(this.terrain.mesh)
    this.grid.visible = true
    this.grid.position.y = 0.015
    this.grid.renderOrder = 2
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]
    for (const material of gridMaterials) {
      material.transparent = true
      material.opacity = 0.42
      material.depthWrite = false
      material.depthTest = false
    }
    this.scene.add(this.grid)
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3b3a2e, 1.0))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(30, 50, 20)
    this.scene.add(sun)
  }

  // ---- objetos ----
  add(obj: GameObject): GameObject {
    reserveId(obj.id)
    this.scene.add(obj.mesh)
    this.objects.set(obj.id, obj)
    this.events.emit('objectAdded', { id: obj.id })
    return obj
  }

  /** Cria um objeto apoiado em baseY (a altura do chão naquele ponto) e o seleciona. */
  place(type: ObjectType, x: number, baseY: number, z: number): GameObject {
    const half = PRIMITIVE_DEFS[type].size[1] / 2
    const obj = this.add(createPrimitive(type, { position: [x, baseY + half, z] }))
    this.select(obj.id)
    return obj
  }

  remove(id: string): void {
    const obj = this.objects.get(id)
    if (!obj) return
    if (this.selectedId === id) this.select(null)
    this.dispose(obj)
    this.objects.delete(id)
    this.events.emit('objectRemoved', { id })
  }

  rename(id: string, name: string): void {
    const obj = this.objects.get(id)
    const clean = name.trim()
    if (!obj || clean === '' || clean === obj.name) return
    obj.name = clean
    this.events.emit('objectRenamed', { id, name: clean })
  }

  update(id: string, patch: ObjectPatch): void {
    const obj = this.objects.get(id)
    if (!obj) return
    const m = obj.mesh
    const ok = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n)
    if (ok(patch.x)) m.position.x = clamp(patch.x, -50, 50)
    if (ok(patch.y)) m.position.y = clamp(patch.y, -50, 100)
    if (ok(patch.z)) m.position.z = clamp(patch.z, -50, 50)
    if (ok(patch.rotationX)) m.rotation.x = (patch.rotationX * Math.PI) / 180
    if (ok(patch.rotationY)) m.rotation.y = (patch.rotationY * Math.PI) / 180
    if (ok(patch.rotationZ)) m.rotation.z = (patch.rotationZ * Math.PI) / 180
    if (ok(patch.scale)) {
      const s = clamp(patch.scale, 0.1, 20)
      m.scale.set(s, s, s)
    }
    if (ok(patch.scaleX)) m.scale.x = clamp(patch.scaleX, 0.1, 20)
    if (ok(patch.scaleY)) m.scale.y = clamp(patch.scaleY, 0.1, 20)
    if (ok(patch.scaleZ)) m.scale.z = clamp(patch.scaleZ, 0.1, 20)
    if (ok(patch.color)) (m.material as THREE.MeshStandardMaterial).color.setHex(patch.color)
    if (patch.visible !== undefined) m.visible = patch.visible
    this.events.emit('objectChanged', { id })
  }

  /** Avisa a interface que um objeto foi alterado por arrasto no viewport. */
  notifyChanged(id: string): void {
    this.events.emit('objectChanged', { id })
  }

  /** Substitui todo o conteúdo do mundo (novo projeto ou projeto aberto). */
  replaceAll(objs: GameObject[], terrain: TerrainData): void {
    this.select(null)
    for (const o of this.objects.values()) this.dispose(o)
    this.objects.clear()
    for (const o of objs) {
      reserveId(o.id)
      this.scene.add(o.mesh)
      this.objects.set(o.id, o)
    }
    this.terrain.load(terrain.seed, terrain.edits)
    this.applyTerrainVisible(terrain.visible)
    this.events.emit('worldReset', { count: objs.length })
  }

  // ---- seleção ----
  select(id: string | null): void {
    const valid = id === TERRAIN_ID || (id !== null && this.objects.has(id))
    const next = valid ? id : null
    if (next === this.selectedId) return
    this.highlight(this.selectedId, false)
    this.selectedId = next
    this.highlight(next, true)
    this.events.emit('selectionChanged', { id: next })
  }

  getSelectedId(): string | null {
    return this.selectedId
  }

  // ---- consultas ----
  get(id: string): GameObject | undefined {
    return this.objects.get(id)
  }

  list(): GameObject[] {
    return [...this.objects.values()]
  }

  info(): ObjectInfo[] {
    return this.list().map((o) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      x: o.mesh.position.x,
      y: o.mesh.position.y,
      z: o.mesh.position.z,
      rotationX: (o.mesh.rotation.x * 180) / Math.PI,
      rotationY: (o.mesh.rotation.y * 180) / Math.PI,
      rotationZ: (o.mesh.rotation.z * 180) / Math.PI,
      scale: o.mesh.scale.x,
      scaleX: o.mesh.scale.x,
      scaleY: o.mesh.scale.y,
      scaleZ: o.mesh.scale.z,
      visible: o.mesh.visible,
      color: (o.mesh.material as THREE.MeshStandardMaterial).color.getHex(),
    }))
  }

  /** Só os objetos visíveis podem ser clicados. */
  pickables(): THREE.Mesh[] {
    return this.list()
      .filter((o) => o.mesh.visible)
      .map((o) => o.mesh)
  }

  // ---- terreno ----
  terrainInfo(): TerrainInfo {
    return {
      visible: this.terrain.mesh.visible,
      seed: this.terrain.field.seed,
      edits: this.terrain.field.editCount(),
    }
  }

  terrainData(): TerrainData {
    return {
      seed: this.terrain.field.seed,
      visible: this.terrain.mesh.visible,
      edits: this.terrain.field.exportEdits(),
    }
  }

  setTerrainVisible(visible: boolean): void {
    this.applyTerrainVisible(visible)
    this.notifyTerrain()
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible
    this.grid.visible = visible
  }

  isGridVisible(): boolean {
    return this.gridVisible
  }

  regenerateTerrain(seed: number): void {
    this.terrain.load(seed, [])
    this.notifyTerrain()
  }

  clearTerrainEdits(): void {
    this.terrain.load(this.terrain.field.seed, [])
    this.notifyTerrain()
  }

  notifyTerrain(): void {
    this.events.emit('terrainChanged', { edits: this.terrain.field.editCount() })
  }

  private applyTerrainVisible(visible: boolean): void {
    this.terrain.mesh.visible = visible
    // A malha é independente do terreno e pode permanecer visível como referência do editor.
    this.grid.visible = this.gridVisible
  }

  private highlight(id: string | null, on: boolean): void {
    if (id === null || id === TERRAIN_ID) return
    const obj = this.objects.get(id)
    if (!obj) return
    ;(obj.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x4a2a1a : 0x000000)
  }

  private dispose(obj: GameObject): void {
    this.scene.remove(obj.mesh)
    // Libera também as geometrias e os materiais das linhas que mostram os polígonos.
    obj.mesh.traverse((child) => {
      if (child === obj.mesh) return
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose()
        const material = child.material
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      }
    })
    obj.mesh.geometry.dispose()
    const material = obj.mesh.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  }
}
