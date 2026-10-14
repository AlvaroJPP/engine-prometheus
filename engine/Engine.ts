import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { PointerController } from './input/PointerController'
import { createEditorState } from './EditorState'
import type { BrushSettings, EditorState, ToolMode, TransformMode } from './EditorState'
import { randomSeed, resetIds, uuid } from './lib/id'
import type { ObjectInfo, ObjectPatch } from './model/object/GameObject'
import { MAIN_SCENE_PATH } from './project/format'
import type { CameraPreset, ObjectType, ProjectBundle } from './project/format'
import { buildBundle, objectFromData } from './project/serialize'
import type { ProjectMeta } from './project/serialize'
import { ProjectFormatError } from './project/validate'
import { OrbitCamera } from './view/OrbitCamera'
import { Viewport } from './view/Viewport'
import { clamp, snap } from './lib/math'
import { World } from './world/World'
import { CollisionSystem } from './world/CollisionSystem'
import { HumanoidAvatar } from './world/HumanoidAvatar'
import type { TerrainInfo } from './world/World'
import { RuleEngine } from './script/RuleEngine'
import type { LogicRule } from './script/types'

const PRESET_ORDER: CameraPreset[] = ['free', 'isometric', 'top']

export class Engine {
  readonly world = new World()
  readonly collisions = new CollisionSystem(this.world)
  readonly state: EditorState = createEditorState()
  readonly logic: RuleEngine = new RuleEngine(this.world)
  private orbit = new OrbitCamera()
  private viewport: Viewport
  private input: PointerController
  private transformControls: TransformControls
  private avatar: HumanoidAvatar
  private meta: ProjectMeta = { id: uuid(), name: 'Novo Mundo' }
  private groupTransformSnapshot: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.viewport = new Viewport(canvas, (aspect) => this.orbit.resize(aspect))
    this.avatar = new HumanoidAvatar(this.world, this.orbit.target, () => this.orbit.yaw)
    // Gizmo 3D nativo do Three.js: eixos de mover, anéis de rotação e alças de escala.
    this.transformControls = new TransformControls(this.orbit.camera, canvas)
    this.world.scene.add(this.transformControls.getHelper())
    this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform)
    this.transformControls.setSpace('world')
    this.transformControls.addEventListener('objectChange', () => {
      const id = this.world.getSelectedId()
      const selected = id ? this.world.get(id) : undefined
      if (!id || !selected) return
      const mesh = selected.mesh
      const current = {
        position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
      }
      const previous = this.groupTransformSnapshot
      if (previous && typeof mesh.userData.groupId === 'string') {
        const groupId = mesh.userData.groupId as string
        const dx = current.position[0] - previous.position[0]
        const dy = current.position[1] - previous.position[1]
        const dz = current.position[2] - previous.position[2]
        const drx = current.rotation[0] - previous.rotation[0]
        const dry = current.rotation[1] - previous.rotation[1]
        const drz = current.rotation[2] - previous.rotation[2]
        const ratios = current.scale.map((v, i) => previous.scale[i] === 0 ? 1 : v / previous.scale[i]) as [number, number, number]
        const pivot = new THREE.Vector3(previous.position[0], previous.position[1], previous.position[2])
        const deltaRotation = new THREE.Euler(drx, dry, drz, mesh.rotation.order)
        const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(deltaRotation)
        for (const sibling of this.world.list()) {
          if (sibling.id === id || sibling.mesh.userData.groupId !== groupId || sibling.mesh.userData.locked === true) continue
          const other = sibling.mesh
          other.position.sub(pivot)
          other.position.set(other.position.x * ratios[0], other.position.y * ratios[1], other.position.z * ratios[2])
          other.position.applyMatrix4(rotationMatrix)
          other.position.add(pivot)
          other.position.x += dx; other.position.y += dy; other.position.z += dz
          other.rotation.x += drx; other.rotation.y += dry; other.rotation.z += drz
          other.scale.x *= ratios[0]; other.scale.y *= ratios[1]; other.scale.z *= ratios[2]
          this.world.notifyChanged(sibling.id)
        }
      }
      this.groupTransformSnapshot = current
      this.world.notifyChanged(id)
    })
    this.transformControls.addEventListener('dragging-changed', (event) => {
      // O PointerController consulta este estado para não competir com o gizmo.
      if (event.value) {
        this.state.tool = 'select'
        const id = this.world.getSelectedId()
        const mesh = id ? this.world.get(id)?.mesh : undefined
        this.groupTransformSnapshot = mesh ? { position: [mesh.position.x, mesh.position.y, mesh.position.z], rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] } : null
      } else this.groupTransformSnapshot = null
    })
    this.input = new PointerController(canvas, this.orbit, this.world, this.state, () => this.transformControls.dragging)
    this.events.on('selectionChanged', ({ id }) => {
      const object = id ? this.world.get(id) : undefined
      if (object && object.mesh.userData.locked !== true) this.transformControls.attach(object.mesh)
      else this.transformControls.detach()
    })
    this.events.on('toolChanged', ({ transform, tool }) => {
      this.transformControls.setMode(transform === 'move' ? 'translate' : transform)
      this.transformControls.enabled = tool === 'select'
    })
    this.events.on('objectChanged', ({ id }) => {
      if (this.world.getSelectedId() === id) this.transformControls.getHelper().updateMatrixWorld()
    })
    this.viewport.start((dt) => {
      this.input.update(dt)
      this.collisions.update()
      this.avatar.update(dt)
      this.logic.update()
      this.orbit.update()
      this.viewport.renderer.render(this.world.scene, this.orbit.camera)
    })
  }

  get events() {
    return this.world.events
  }

  listRules(): LogicRule[] { return this.logic.list() }
  upsertRule(rule: LogicRule): void { this.logic.upsert(rule) }
  removeRule(id: string): void { this.logic.remove(id) }
  moveRule(id: string, direction: -1 | 1): void { this.logic.move(id, direction) }
  setLogicVariable(name: string, value: boolean | number | string, objectId?: string | null): void { this.logic.setVariable(name, value, objectId) }
  removeLogicVariable(name: string, objectId?: string | null): boolean { return this.logic.removeVariable(name, objectId) }
  logicVariables(objectId?: string | null): Record<string, boolean | number | string> { return this.logic.variables(objectId) }

  get projectName(): string {
    return this.meta.name
  }

  setProjectName(name: string): void {
    const clean = name.trim()
    if (clean !== '') this.meta.name = clean
  }

  // ---- ferramentas ----
  setTool(tool: ToolMode): void {
    this.state.tool = tool
    this.emitTool()
  }

  /** Escolher mover/rotacionar/escalar também ativa a ferramenta Selecionar. */
  setTransform(mode: TransformMode): void {
    this.state.transform = mode
    this.state.tool = 'select'
    this.transformControls.setMode(mode === 'move' ? 'translate' : mode)
    this.transformControls.enabled = true
    this.emitTool()
  }

  setBuildShape(type: ObjectType): void {
    this.state.buildShape = type
  }

  setBrush(brush: BrushSettings): void {
    this.state.brush.strength = clamp(brush.strength, 0.1, 5)
    this.state.brush.radius = clamp(brush.radius, 0.5, 20)
  }

  private emitTool(): void {
    this.events.emit('toolChanged', { tool: this.state.tool, transform: this.state.transform })
  }

  // ---- câmera ----
  get cameraPreset(): CameraPreset {
    return this.orbit.preset
  }

  setFirstPersonMode(enabled: boolean): void {
    this.orbit.setFirstPersonMode(enabled)
    this.avatar.setFirstPersonMode(enabled)
    if (!enabled) this.orbit.update()
    this.events.emit('cameraChanged', { preset: this.orbit.preset })
  }

  cycleCameraPreset(): CameraPreset {
    const next = PRESET_ORDER[(PRESET_ORDER.indexOf(this.orbit.preset) + 1) % PRESET_ORDER.length] ?? 'free'
    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    this.orbit.setPreset(next)
    this.events.emit('cameraChanged', { preset: next })
    return next
  }

  // ---- objetos ----
  /** Cria um objeto no centro da visão, apoiado no terreno. */
  addPrimitive(type: ObjectType): void {
    this.state.buildShape = type
    const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48)
    const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48)
    this.world.place(type, x, this.world.terrain.heightAt(x, z), z)
  }

  select(id: string | null): void {
    this.world.select(id)
  }

  selectedId(): string | null {
    return this.world.getSelectedId()
  }

  removeObject(id: string): void {
    this.world.remove(id)
    this.logic.removeObjectVariables(id)
  }

  renameObject(id: string, name: string): void {
    this.world.rename(id, name)
  }

  updateObject(id: string, patch: ObjectPatch): void {
    this.world.update(id, patch)
    const object = this.world.get(id)
    if (id === this.world.getSelectedId() && object?.mesh.userData.locked === true) this.transformControls.detach()
    else if (id === this.world.getSelectedId() && object) this.transformControls.attach(object.mesh)
  }

  toggleObjectLock(id: string): void {
    const object = this.world.get(id)
    if (!object) return
    this.world.update(id, { locked: object.mesh.userData.locked !== true })
    if (id === this.world.getSelectedId()) {
      if (object.mesh.userData.locked === true) this.transformControls.detach()
      else this.transformControls.attach(object.mesh)
    }
  }

  groupObjects(ids: string[]): void {
    const unique = [...new Set(ids)].filter(id => this.world.get(id))
    if (unique.length < 2) return
    const groupId = uuid()
    for (const id of unique) this.world.update(id, { groupId })
  }

  ungroupObjects(ids: string[]): void {
    for (const id of ids) if (this.world.get(id)) this.world.update(id, { groupId: null })
  }

  toggleObjectWireframe(id: string): void {
    const object = this.world.get(id)
    if (!object) return
    this.world.update(id, { wireframeVisible: object.mesh.userData.wireframeVisible === false })
  }

  listObjects(): ObjectInfo[] {
    return this.world.info()
  }

  // ---- terreno ----
  terrainInfo(): TerrainInfo {
    return this.world.terrainInfo()
  }

  setTerrainVisible(visible: boolean): void {
    this.world.setTerrainVisible(visible)
  }

  setGridVisible(visible: boolean): void {
    this.world.setGridVisible(visible)
  }

  isGridVisible(): boolean {
    return this.world.isGridVisible()
  }

  regenerateTerrain(): void {
    this.world.regenerateTerrain(randomSeed())
  }

  clearTerrainEdits(): void {
    this.world.clearTerrainEdits()
  }

  // ---- projeto ----
  newProject(name = 'Novo Mundo'): void {
    resetIds()
    this.meta = { id: uuid(), name }
    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    this.orbit.setPreset('free')
    this.events.emit('cameraChanged', { preset: 'free' })
    this.world.replaceAll([], { seed: randomSeed(), visible: true, edits: [] })
    this.avatar.reset()
    this.collisions.clear()
    this.world.setGridVisible(true)
    this.setBrush({ strength: 1.5, radius: 4 })
    this.logic.load()
  }

  exportProject(): ProjectBundle {
    const bundle = buildBundle(this.world.list(), this.world.terrainData(), this.orbit.getState(), this.meta, {
      gridVisible: this.world.isGridVisible(),
      brushStrength: this.state.brush.strength,
      brushRadius: this.state.brush.radius,
    })
    bundle.logic = this.logic.exportData()
    return bundle
  }

  loadProject(bundle: ProjectBundle): void {
    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    const firstPath = bundle.project.scenes[0] ?? MAIN_SCENE_PATH
    const scene = bundle.scenes[firstPath]
    if (!scene) throw new ProjectFormatError('O projeto não tem nenhuma cena para carregar.')
    resetIds()
    this.meta = { id: bundle.project.id, name: bundle.project.name }
    this.orbit.restore(scene.camera)
    this.events.emit('cameraChanged', { preset: scene.camera.preset })
    this.world.replaceAll(scene.objects.map(objectFromData), scene.terrain)
    const editorSettings = bundle.project.settings.editor
    this.world.setGridVisible(editorSettings.gridVisible)
    this.setBrush({ strength: editorSettings.brushStrength, radius: editorSettings.brushRadius })
    this.logic.load(bundle.logic)
  }

  dispose(): void {
    this.input.dispose()
    this.avatar.dispose()
    this.collisions.clear()
    this.transformControls.dispose()
    this.viewport.dispose()
  }
}
