import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import { PointerController } from './input/PointerController'
import { createEditorState } from './EditorState'
import type { BrushSettings, EditorState, ToolMode, TransformMode } from './EditorState'
import { randomSeed, resetIds, uuid } from './lib/id'
import type { ObjectInfo, ObjectPatch } from './model/object/GameObject'
import { MAIN_SCENE_PATH } from './project/format'
import type { CameraPreset, ObjectType, PlayerModelData, ProjectBundle, SceneObjectData } from './project/format'
import { buildBundle, objectFromData } from './project/serialize'
import type { ProjectMeta } from './project/serialize'
import { ProjectFormatError } from './project/validate'
import { OrbitCamera } from './view/OrbitCamera'
import { Viewport } from './view/Viewport'
import type { ViewportRenderStats } from './view/Viewport'
import { clamp, snap } from './lib/math'
import { World } from './world/World'
import { CollisionSystem } from './world/CollisionSystem'
import { ModelOcclusionSystem } from './world/ModelOcclusionSystem'
import { ModelLodSystem } from './world/ModelLodSystem'
import { HumanoidAvatar } from './world/HumanoidAvatar'
import type { TerrainInfo } from './world/World'
import { RuleEngine } from './script/RuleEngine'
import type { LogicRule } from './script/types'
import { DEFAULT_MODEL_CONTROL_BINDINGS, getMountPackageSettings, ONE_SHOT_ANIMATION_ROLES } from './script/packages'
import type { AnimationRole, BehaviorPackageInstance, ModelControlBindings } from './script/packages'
import { DEFAULT_CONTROL_MAPS } from './input/ControlMaps'
import type { ControlMapBindings } from './input/ControlMaps'
import { markEntity } from './model/entity/Entity'
import type { Entity } from './model/entity/Entity'

const PRESET_ORDER: CameraPreset[] = ['free', 'isometric', 'top']
const MAX_PLAYER_MODEL_BYTES = 30 * 1024 * 1024

function encodeArrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

function decodeBase64ArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

export class Engine {
  readonly world = new World()
  readonly collisions = new CollisionSystem(this.world)
  private readonly modelOcclusion = new ModelOcclusionSystem()
  private modelLod!: ModelLodSystem
  readonly state: EditorState = createEditorState()
  readonly logic: RuleEngine = new RuleEngine(this.world)
  private orbit = new OrbitCamera()
  private viewport: Viewport
  private input: PointerController
  private transformControls: TransformControls
  private avatar: HumanoidAvatar
  private playerModelData: PlayerModelData | null = null
  private playerControlBindings: ControlMapBindings = { ...DEFAULT_CONTROL_MAPS[0]!.bindings }
  private meta: ProjectMeta = { id: uuid(), name: 'Novo Mundo' }
  private groupTransformSnapshot: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null = null
  private pendingBuildComponent: { name: string; model: THREE.Object3D; height: number } | null = null
  private cameraStateBeforeRun: ReturnType<OrbitCamera['getState']> | null = null
  private runtimeModeActive = false
  private activeMountPackageId: string | null = null
  private lastMountMovementState: string | null = null
  private readonly mountModelStateSignatures = new Map<string, string>()
  private readonly viewportInvalidationOffs: Array<() => void> = []

  constructor(canvas: HTMLCanvasElement) {
    this.viewport = new Viewport(canvas, (aspect) => this.orbit.resize(aspect))
    this.modelLod = new ModelLodSystem(() => {
      this.viewport.invalidate()
    })
    this.avatar = new HumanoidAvatar(this.world, this.orbit.target, () => this.orbit.yaw)
    this.avatar.mesh.visible = false
    this.avatar.setEnabled(false)
    this.viewportInvalidationOffs.push(
      this.events.on('renderInvalidated', () => this.viewport.invalidate()),
      this.events.on('objectAdded', () => this.viewport.invalidate()),
      this.events.on('objectRemoved', () => this.viewport.invalidate()),
      this.events.on('objectRenamed', () => this.viewport.invalidate()),
      this.events.on('objectChanged', () => this.viewport.invalidate()),
      this.events.on('objectAdded', () => this.modelOcclusion.invalidate()),
      this.events.on('objectRemoved', () => this.modelOcclusion.invalidate()),
      this.events.on('objectChanged', () => this.modelOcclusion.invalidate()),
      this.events.on('worldReset', () => {
        this.modelOcclusion.invalidate()
        this.modelLod.clear()
        this.viewport.invalidate()
      }),
      this.events.on('objectRemoved', ({ id }) => this.modelLod.remove(id)),
      this.events.on('objectChanged', () => this.modelLod.invalidate()),
      this.events.on('behaviorPackageChanged', () => this.viewport.invalidate()),
      this.events.on('objectClicked', () => this.viewport.invalidate()),
      this.events.on('collisionStarted', () => this.viewport.invalidate()),
      this.events.on('collisionEnded', () => this.viewport.invalidate()),
      this.events.on('selectionChanged', () => this.viewport.invalidate()),
      this.events.on('terrainChanged', () => this.viewport.invalidate()),
      this.events.on('worldReset', () => this.viewport.invalidate()),
      this.events.on('toolChanged', () => this.viewport.invalidate()),
      this.events.on('cameraChanged', () => this.viewport.invalidate()),
    )
    window.addEventListener('keydown', this.onRuleKeyDown)
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
    this.input = new PointerController(
      canvas,
      this.orbit,
      this.world,
      this.state,
      // O TransformControls e o PointerController escutam o mesmo canvas.
      // Ao clicar num eixo, a ferramenta manual não pode capturar o ponteiro
      // antes do gizmo iniciar o arrasto. Consideramos também o eixo sob o
      // cursor, não apenas dragging (que só fica true depois do pointerdown).
      () => this.transformControls.dragging || this.transformControls.axis !== null,
      (x, y, z) => this.placePendingBuildComponent(x, y, z),
      (id) => {

      this.events.emit('objectClicked', { id })
    })
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
      const frameStartedAt = performance.now()
      this.input.update(dt)
      // Atualize animações antes dos testes físicos para usar a pose exibida
      // no quadro atual. A versão invalida o wireframe automático do modelo
      // quando ossos ou morph targets mudam.
      let hasRunningModelAnimation = false
      for (const object of this.world.list()) {
        const mixer = object.mesh.userData.importAnimationMixer as THREE.AnimationMixer | undefined
        if (!mixer) continue
        mixer.update(dt)
        const animationActions = object.mesh.userData.importAnimationActions as Partial<Record<AnimationRole, THREE.AnimationAction>> | undefined
        const fallbackAnimationAction = object.mesh.userData.importAnimationFallbackAction as THREE.AnimationAction | undefined
        if (
          Object.values(animationActions ?? {}).some(action => action?.isRunning())
          || fallbackAnimationAction?.isRunning() === true
        ) {
          hasRunningModelAnimation = true
        }
        const mountedTransition = object.mesh.userData.importAnimationTransition as AnimationRole | undefined
        if (mountedTransition && ONE_SHOT_ANIMATION_ROLES.has(mountedTransition)) {
          const actions = object.mesh.userData.importAnimationActions as Partial<Record<AnimationRole, THREE.AnimationAction>> | undefined
          const transitionAction = actions?.[mountedTransition]
          if (!transitionAction?.isRunning()) {
            object.mesh.userData.importAnimationTransition = undefined
            const restingRoles: AnimationRole[] = ['idle', 'walk', 'run', 'walk_diagonal_left', 'walk_diagonal_right']
            const restingRole = restingRoles.find(role => actions?.[role] !== undefined)
            const restingAction = restingRole ? actions?.[restingRole] : undefined
            if (restingAction && actions) {
              restingAction.setLoop(THREE.LoopRepeat, Infinity)
              restingAction.clampWhenFinished = false
              restingAction.reset().fadeIn(0.15).play()
              const fallbackAction = object.mesh.userData.importAnimationFallbackAction as THREE.AnimationAction | undefined
              if (fallbackAction && fallbackAction !== restingAction && fallbackAction.isRunning()) fallbackAction.fadeOut(0.15)
              for (const action of Object.values(actions)) {
                if (action && action !== restingAction && action.isRunning()) action.fadeOut(0.15)
              }
              object.mesh.userData.importAnimationState = restingRole
            } else {
              transitionAction?.stop()
              const fallbackAction = object.mesh.userData.importAnimationFallbackAction as THREE.AnimationAction | undefined
              fallbackAction?.stop()
              object.mesh.userData.importAnimationState = ''
            }
          }
        }
        const previousPoseVersion = object.mesh.userData.colliderPoseVersion
        object.mesh.userData.colliderPoseVersion =
          (typeof previousPoseVersion === 'number' ? previousPoseVersion : 0) + 1
      }
      this.collisions.update(this.runtimeModeActive)
      if (this.activeMountPackageId) {
        const currentMount = this.logic.listPackages().find(instance => instance.id === this.activeMountPackageId)
        if (currentMount?.enabled) this.avatar.updateMountSettings(getMountPackageSettings(currentMount))
      }
      this.avatar.update(dt)
      const mountedObjectId = this.avatar.getMountedObjectId()
      const mountedMovementState = this.avatar.getMountedMovementState()
      if (mountedObjectId && mountedMovementState && this.activeMountPackageId) {
        const mountInstance = this.logic.listPackages().find(instance => instance.id === this.activeMountPackageId)
        if (mountInstance && mountInstance.variables.movementState !== mountedMovementState) {
          this.logic.setPackageVariable(mountInstance.id, 'movementState', mountedMovementState)
          this.notifyBehaviorPackageChanged(mountInstance.ownerObjectId)
          if (this.lastMountMovementState !== null && this.lastMountMovementState !== mountedMovementState) {
            this.triggerBehaviorPackageEvent(mountedObjectId, mountInstance.packageId, 'movement_changed')
          }
        }
        this.lastMountMovementState = mountedMovementState
      } else {
        this.lastMountMovementState = null
      }
      this.world.updateEnvironment(dt)
      this.logic.update()
      for (const instance of this.logic.listPackages()) {
        if (instance.packageId === 'mount') this.applyMountModelStates(instance)
      }
      this.orbit.update()
      if (this.world.updateRenderDistance(this.orbit.camera.position)) {
        // A distância pode reexibir submalhas escondidas pela oclusão ou ocultar
        // bloqueadores; invalide seus caches para recalcular a visibilidade coerente.
        this.modelOcclusion.invalidate()
      }
      this.world.updateFogForCamera(this.orbit.camera.position)
      this.modelLod.update(this.orbit.camera.position)
      if (this.modelOcclusion.update(this.orbit.camera, this.world.list(), performance.now())) {
        this.viewport.invalidate()
      }
      this.world.terrain.grass.updateVisibility(
        this.orbit.camera.position,
        this.avatar.mesh.visible ? this.avatar.mesh.position : null,
        this.world.grassOcclusionRoots(),
      )
      const environment = this.world.getEnvironment()
      const continuousRendering = this.avatar.mesh.visible || environment.cycleEnabled || hasRunningModelAnimation
      this.viewport.recordUpdateDuration(performance.now() - frameStartedAt)
      this.viewport.render(this.world.scene, this.orbit.camera, performance.now(), continuousRendering)
    })
  }

  get events() {
    return this.world.events
  }

  /** Liga um observador à taxa de quadros real do viewport. */
  setFpsListener(listener: ((fps: number) => void) | null): void {
    this.viewport.setFpsListener(listener)
  }

  /** Expõe estatísticas de triângulos/draw calls e custo CPU do renderizador. */
  setRenderStatsListener(listener: ((stats: ViewportRenderStats) => void) | null): void {
    this.viewport.setRenderStatsListener(listener)
  }

  /** Configura limite de quadros, resolução, LOD de modelos e densidade da grama. */
  setPerformancePreset(preset: 'quality' | 'balanced' | 'economy'): void {
    this.viewport.setPerformancePreset(preset)
    this.modelLod.setPreset(preset)
    this.world.terrain.grass.setPerformancePreset(preset)
    this.viewport.invalidate()
  }

  /** Compatibilidade com chamadas antigas do modo desempenho. */
  setPerformanceMode(enabled: boolean): void {
    const preset = enabled ? 'economy' : 'quality'
    this.viewport.setPerformanceMode(enabled)
    this.modelLod.setPreset(preset)
    this.world.terrain.grass.setPerformancePreset(preset)
    this.viewport.invalidate()
  }

  /** Consulta uma entidade genérica da cena pelo ID, sem lógica específica de espécie. */
  getEntity(id: string): Entity | null { return this.world.getEntity(id) }
  /** Lista todas as entidades colocadas no mundo. */
  listEntities(): Entity[] { return this.world.listEntities() }
  private notifyBehaviorPackageChanged(ownerObjectId: string): void {
    this.events.emit('behaviorPackageChanged', { ownerObjectId })
  }

  /** Despacha um gatilho do pacote e atualiza a interface se suas ações alterarem variáveis. */
  private triggerBehaviorPackageEvent(ownerObjectId: string, packageId: string, eventId: string): boolean {
    const executed = this.logic.triggerPackageEvent(ownerObjectId, packageId, eventId)
    this.notifyBehaviorPackageChanged(ownerObjectId)
    return executed
  }

  /** Finaliza a montaria uma vez, sincronizando variáveis e o gatilho Desmontou. */
  private dismountActiveMount(): void {
    const packageId = this.activeMountPackageId
    const packageInstance = packageId
      ? this.logic.listPackages().find(instance => instance.id === packageId)
      : undefined
    const mountedObjectId = this.avatar.dismount()

    if (packageId) {
      this.logic.setPackageVariable(packageId, 'mounted', false)
      this.logic.setPackageVariable(packageId, 'movementState', 'idle')
    }
    this.activeMountPackageId = null
    this.lastMountMovementState = null

    if (packageInstance) {
      this.notifyBehaviorPackageChanged(packageInstance.ownerObjectId)
      if (mountedObjectId) {
        this.triggerBehaviorPackageEvent(mountedObjectId, packageInstance.packageId, 'dismounted')
      }
    }
  }

  listRules(): LogicRule[] { return this.logic.list() }
  listBehaviorPackages(ownerObjectId?: string): BehaviorPackageInstance[] { return this.logic.listPackages(ownerObjectId) }
  installBehaviorPackage(ownerObjectId: string, packageId: string): BehaviorPackageInstance {
    const alreadyInstalled = this.logic.listPackages(ownerObjectId).some(instance => instance.packageId === packageId)
    const instance = this.logic.installPackage(ownerObjectId, packageId)
    if (packageId === 'mount' && !alreadyInstalled) {
      const rawBindings = this.world.get(ownerObjectId)?.mesh.userData.importControlBindings
      const candidate = rawBindings && typeof rawBindings === 'object'
        ? rawBindings as Partial<ModelControlBindings>
        : {}
      const readKey = (key: keyof ModelControlBindings): string => {
        const value = candidate[key]
        return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(value)
          ? value
          : DEFAULT_MODEL_CONTROL_BINDINGS[key]
      }
      const controlBindings: ModelControlBindings = {
        forward: readKey('forward'),
        backward: readKey('backward'),
        left: readKey('left'),
        right: readKey('right'),
        run: readKey('run'),
        jump: readKey('jump'),
        interact: readKey('interact'),
      }
      this.logic.updatePackage(instance.id, {
        config: {
          ...instance.config,
          interactionKey: controlBindings.interact,
          controlBindings: { ...controlBindings },
        },
      })
    }
    const installed = this.logic.listPackages(ownerObjectId).find(item => item.packageId === packageId) ?? instance
    this.notifyBehaviorPackageChanged(ownerObjectId)
    return installed
  }
  updateBehaviorPackage(
    id: string,
    patch: Partial<Pick<BehaviorPackageInstance, 'enabled' | 'variables' | 'config'>>,
  ): void {
    this.logic.updatePackage(id, patch)
    const instance = this.logic.listPackages().find(item => item.id === id)
    if (patch.enabled === false && this.activeMountPackageId === id) this.dismountActiveMount()
    if (instance) this.notifyBehaviorPackageChanged(instance.ownerObjectId)
  }
  removeBehaviorPackage(id: string): void {
    const instance = this.logic.listPackages().find(item => item.id === id)
    if (instance?.packageId === 'mount') this.applyMountModelStates(instance, true, false)
    if (this.activeMountPackageId === id) this.dismountActiveMount()
    this.logic.removePackage(id)
    this.mountModelStateSignatures.delete(id)
  }
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
    const previousTool = this.state.tool
    this.state.tool = tool
    if (tool === 'grass') {
      this.transformControls.detach()
      this.transformControls.enabled = false
    } else {
      this.transformControls.enabled = true
      if (tool === 'select') {
        const id = this.world.getSelectedId()
        const selected = id ? this.world.get(id) : undefined
        if (selected && selected.mesh.userData.locked !== true) this.transformControls.attach(selected.mesh)
      } else if (previousTool === 'grass') {
        this.transformControls.detach()
      }
    }
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

  /** Nome exibido no editor para o visual atual do jogador. */
  getPlayerModelName(): string {
    return this.playerModelData?.name ?? 'Modelo padrão (Dummy)'
  }

  hasCustomPlayerModel(): boolean {
    return this.playerModelData !== null
  }

  /** Aplica um modelo GLB escolhido pelo usuário, preservando a cápsula física do jogador. */
  async setPlayerModel(
    data: ArrayBuffer,
    name: string,
    animationRoles?: Record<string, AnimationRole>,
  ): Promise<void> {
    const cleanName = name.trim() || 'Jogador.glb'
    if (!cleanName.toLowerCase().endsWith('.glb')) {
      throw new Error('O modelo do jogador precisa estar no formato binário .glb.')
    }
    if (data.byteLength < 12) throw new Error('O arquivo GLB está vazio ou incompleto.')
    if (data.byteLength > MAX_PLAYER_MODEL_BYTES) {
      throw new Error('O modelo do jogador deve ter no máximo 30 MB.')
    }
    if (new DataView(data).getUint32(0, true) !== 0x46546c67) {
      throw new Error('O arquivo selecionado não tem o cabeçalho GLB esperado. Exporte o modelo como .glb.')
    }

    // A troca visual só é confirmada após o GLB ser validado e carregado.
    await this.avatar.setCustomModel(data, animationRoles)
    this.playerModelData = {
      name: cleanName,
      glbData: encodeArrayBufferBase64(data),
      ...(animationRoles ? { animationRoles: { ...animationRoles } } : {}),
    }
    this.viewport.invalidate()
  }

  /** Restaura o avatar original usado pelos projetos antigos. */
  async resetPlayerModel(): Promise<void> {
    await this.avatar.resetDefaultModel()
    this.playerModelData = null
    this.viewport.invalidate()
  }

  /** Define as teclas do mapa de controles ativo para o jogador. */
  setControlBindings(bindings: ControlMapBindings): void {
    this.playerControlBindings = { ...bindings }
    this.avatar.setControlBindings(this.playerControlBindings)
  }

  /** Alterna entre o editor livre e a execução controlada pelo jogador. */
  setRuntimeMode(enabled: boolean): void {
    if (enabled) {
      if (this.cameraStateBeforeRun) return
      this.runtimeModeActive = true
      this.cameraStateBeforeRun = this.orbit.getState()
      this.orbit.setFirstPersonMode(false)
      this.avatar.setFirstPersonMode(false)
      // Se houver uma plataforma de spawn, posiciona os pés do jogador sobre ela.
      // O nome é persistido no projeto, então o ponto continua funcionando após reabrir.
      const spawn = this.world.list().find((object) =>
        object.name === 'Plataforma de Spawn' || object.mesh.userData.playerSpawn === true,
      )
      if (spawn) {
        spawn.mesh.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(spawn.mesh)
        this.avatar.mesh.position.set(spawn.mesh.position.x, bounds.max.y + 0.03, spawn.mesh.position.z)
        this.avatar.resetVerticalState()
      } else {
        this.avatar.reset()
      }
      this.avatar.mesh.visible = true
      this.avatar.setEnabled(true)
      this.orbit.target.set(this.avatar.mesh.position.x, this.avatar.mesh.position.y + 0.9, this.avatar.mesh.position.z)
      this.orbit.distance = 10
      this.input.setRuntimeMode(true)
      this.transformControls.detach()
      this.transformControls.enabled = false
      this.viewport.invalidate()
      return
    }

    this.runtimeModeActive = false
    this.input.setRuntimeMode(false)
    if (this.avatar.isMounted() || this.activeMountPackageId) this.dismountActiveMount()
    this.avatar.setEnabled(false)
    this.avatar.mesh.visible = false
    this.avatar.setFirstPersonMode(false)
    if (this.cameraStateBeforeRun) {
      this.orbit.restore(this.cameraStateBeforeRun)
      this.cameraStateBeforeRun = null
    }
    this.transformControls.enabled = true
    const selectedId = this.world.getSelectedId()
    const selected = selectedId ? this.world.get(selectedId) : undefined
    if (this.state.tool === 'select' && selected && selected.mesh.userData.locked !== true) {
      this.transformControls.attach(selected.mesh)
    } else {
      this.transformControls.detach()
    }
    this.emitTool()
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

  /** Cria uma pequena plataforma persistente que define o ponto inicial do jogador. */
  addSpawnPlatform(): void {
    const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48)
    const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48)
    const groundY = this.world.terrain.heightAt(x, z)

    // Mantém apenas um ponto de spawn ativo por projeto.
    for (const object of this.world.list()) {
      if (object.name === 'Plataforma de Spawn' || object.mesh.userData.playerSpawn === true) {
        this.world.rename(object.id, 'Plataforma')
        object.mesh.userData.playerSpawn = false
      }
    }

    const spawn = this.world.place('platform', x, groundY, z)
    spawn.name = 'Plataforma de Spawn'
    spawn.mesh.name = 'Plataforma de Spawn'
    spawn.mesh.scale.set(0.5, 0.5, 0.5)
    spawn.mesh.position.y = groundY + 0.1
    spawn.mesh.userData.playerSpawn = true
    this.world.notifyChanged(spawn.id)
    this.world.select(spawn.id)
  }

  /** Clona e vincula ao objeto os nós embutidos no asset reutilizável. */
  private applyComponentLogic(objectId: string, templates: unknown): void {
    if (!Array.isArray(templates)) return
    for (const raw of templates) {
      if (!raw || typeof raw !== 'object') continue
      const template = JSON.parse(JSON.stringify(raw)) as LogicRule
      const remap = (value: string): string => value === '{ID_OBJECT}' ? objectId : value
      template.id = `${template.id || 'component-event'}-${objectId}`
      template.ownerObjectId = objectId
      if (template.trigger.type === 'object_clicked') {
        template.trigger.objectId = remap(template.trigger.objectId)
      }
      for (const action of template.actions) {
        if ('objectId' in action && typeof action.objectId === 'string') {
          action.objectId = remap(action.objectId)
        }
      }
      this.logic.upsert(template)
    }
  }

  private onRuleKeyDown = (event: KeyboardEvent): void => {
    if (!this.cameraStateBeforeRun || event.repeat || event.metaKey) return

    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
    const modifierKey = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(event.code)
    if ((event.ctrlKey || event.altKey) && !modifierKey) return

    // Atalhos de ação ficam disponíveis como eventos personalizados do projeto.
    // Evita, por exemplo, que Tab mova o foco da interface enquanto o jogo roda.
    const actionKeys = [
      this.playerControlBindings.primaryAction,
      this.playerControlBindings.secondaryAction,
      this.playerControlBindings.inventory,
      this.playerControlBindings.useItem,
      this.playerControlBindings.reload,
      this.playerControlBindings.ability1,
      this.playerControlBindings.ability2,
      this.playerControlBindings.ability3,
      this.playerControlBindings.ability4,
      this.playerControlBindings.emote,
    ]
    if (actionKeys.includes(event.code)) event.preventDefault()

    // Montaria é um pacote de comportamento comum, configurado por objeto.
    // A tecla é lida da instância instalada; nenhum nome de espécie é necessário.
    if (this.avatar.isMounted()) {
      const packageInstance = this.activeMountPackageId
        ? this.logic.listPackages().find(instance => instance.id === this.activeMountPackageId)
        : undefined
      const interactionKey = packageInstance ? getMountPackageSettings(packageInstance).interactionKey : 'KeyE'
      if (event.code === this.playerControlBindings.interact || (interactionKey !== DEFAULT_MODEL_CONTROL_BINDINGS.interact && event.code === interactionKey)) {
        const mountedObjectId = this.avatar.dismount()
        if (packageInstance) {
          this.logic.setPackageVariable(packageInstance.id, 'mounted', false)
          this.logic.setPackageVariable(packageInstance.id, 'movementState', 'idle')
          this.notifyBehaviorPackageChanged(packageInstance.ownerObjectId)
          if (mountedObjectId) this.triggerBehaviorPackageEvent(mountedObjectId, packageInstance.packageId, 'dismounted')
          this.logic.triggerKeyPressed(event.code)
        }
        this.activeMountPackageId = null
        this.lastMountMovementState = null
        event.preventDefault()
        return
      }
    } else {
      const playerPosition = this.avatar.mesh.position
      const candidates = this.logic.listPackages()
        .filter(instance => instance.enabled && instance.packageId === 'mount')
        .map(instance => {
          const object = this.world.get(instance.ownerObjectId)
          const settings = getMountPackageSettings(instance)
          const distance = object
            ? Math.hypot(object.mesh.position.x - playerPosition.x, object.mesh.position.z - playerPosition.z)
            : Number.POSITIVE_INFINITY
          return { instance, object, settings, distance }
        })
        .filter(candidate =>
          candidate.object !== undefined && this.world.isObjectVisible(candidate.object) &&
          (event.code === this.playerControlBindings.interact || (candidate.settings.interactionKey !== DEFAULT_MODEL_CONTROL_BINDINGS.interact && event.code === candidate.settings.interactionKey)) &&
          candidate.distance <= candidate.settings.interactionRadius,
        )
        .sort((a, b) => a.distance - b.distance)

      for (const candidate of candidates) {
        if (!candidate.object) continue
        // A tentativa de interação é um gatilho próprio do pacote; as regras
        // podem avaliar variáveis/condições antes da ação Montar.
        this.triggerBehaviorPackageEvent(candidate.instance.ownerObjectId, candidate.instance.packageId, 'interact')
        // A regra Interagir pode mudar variáveis do pacote. Consulte a instância
        // atual, não a cópia retornada por listPackages antes do disparo.
        const currentInstance = this.logic.listPackages().find(instance => instance.id === candidate.instance.id)
        if (!currentInstance?.enabled || !this.world.isObjectVisible(candidate.object)) continue
        const currentSettings = getMountPackageSettings(currentInstance)
        if (!this.avatar.mount(candidate.object.mesh, currentSettings)) continue
        this.activeMountPackageId = currentInstance.id
        this.lastMountMovementState = this.avatar.getMountedMovementState()
        this.logic.setPackageVariable(currentInstance.id, 'mounted', true)
        this.logic.setPackageVariable(currentInstance.id, 'movementState', this.lastMountMovementState ?? 'idle')
        this.notifyBehaviorPackageChanged(currentInstance.ownerObjectId)
        this.triggerBehaviorPackageEvent(currentInstance.ownerObjectId, currentInstance.packageId, 'mounted')
        // O mesmo gatilho de tecla também pode iniciar regras comuns ligadas
        // ao objeto; o pacote não substitui o sistema de eventos existente.
        this.logic.triggerKeyPressed(event.code)
        event.preventDefault()
        return
      }
    }

    // Mantém o sistema de eventos existente funcionando para as outras teclas.
    const executed = this.logic.triggerKeyPressed(event.code)
    if (executed) event.preventDefault()
  }

  /** Seleciona um componente da biblioteca para ser colocado pela ferramenta Construir. */
  setBuildComponentPlacement(name: string, model: THREE.Object3D, height: number): void {
    model.userData.importPart = true
    this.pendingBuildComponent = { name, model, height }
  }

  private placePendingBuildComponent(x: number, baseY: number, z: number): boolean {
    const pending = this.pendingBuildComponent
    if (!pending) return false
    try {
      const existingIds = new Set(this.world.list().map(object => object.id))
      const model = cloneSkinnedModel(pending.model)
      model.userData = { ...pending.model.userData, importPart: true }
      // Mantém o GLB como uma única instância editável na Hierarquia.
      this.addImportedModel(pending.name, model, pending.height)
      const created = this.world.list().find(object => !existingIds.has(object.id))
      if (!created) return false
      created.mesh.position.set(x, baseY + pending.height / 2, z)
      created.mesh.updateMatrixWorld(true)
      this.world.notifyChanged(created.id) 
      this.applyComponentLogic(created.id, pending.model.userData.componentLogic)
      // Mantém a ferramenta Construir ativa para permitir colocar várias cópias
      // em sequência. O objeto recém-criado continua selecionado; o usuário pode
      // mudar para Selecionar quando quiser mover, girar ou redimensionar.
      this.world.select(created.id)
      this.transformControls.attach(created.mesh)
      this.emitTool()
      return true
    } catch (error) {
      console.error('[Engine] Não foi possível construir o componente:', error)
      // O clique foi consumido pela ferramenta de componente; não crie um cubo de fallback.
      return true
    }
  }

  /** Adiciona um modelo externo como objeto transformável na cena. */
  addImportedModel(name: string, model: THREE.Object3D, targetHeight: number, restoreData?: SceneObjectData): void {
    // Evita congelamentos ao inserir assets acidentalmente gigantes no editor.
    // A contagem é feita antes da análise de agrupamento e antes de adicionar ao render loop.
    const MAX_IMPORTED_TRIANGLES = 1_500_000
    let preflightTriangles = 0
    let preflightMeshes = 0
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      preflightMeshes += 1
      const position = child.geometry.getAttribute('position')
      preflightTriangles += child.geometry.index
        ? child.geometry.index.count / 3
        : (position?.count ?? 0) / 3
    })
    if (preflightMeshes === 0 || preflightTriangles === 0) {
      throw new Error('O modelo não contém malhas trianguladas para inserir no mundo.')
    }
    if (preflightTriangles > MAX_IMPORTED_TRIANGLES) {
      throw new Error(`Este modelo contém ${Math.round(preflightTriangles).toLocaleString('pt-BR')} triângulos, acima do limite seguro de ${MAX_IMPORTED_TRIANGLES.toLocaleString('pt-BR')}. Reduza ou otimize o modelo antes de importá-lo.`)
    }

    // Alguns GLBs representam cada árvore como um grupo; outros exportam tronco,
    // copa e galhos como irmãos. Agrupamos irmãos pelo centro X/Z para separar
    // árvores sem transformar cada malha (tronco/folhas) em um objeto isolado.
    const importedAnimations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    // Modelos animados e entidades precisam manter a hierarquia original: separar malhas
    // por proximidade espacial pode destacar partes do modelo da raiz que o gizmo move.
    // A divisão em componentes continua disponível para assets estáticos comuns, como árvores.
    if (model.userData.sceneKind !== 'entity' && model.userData.importPart !== true && importedAnimations.length === 0) {
      model.removeFromParent()
      model.updateMatrixWorld(true)

      type PartCluster = { center: THREE.Vector3; nodes: THREE.Object3D[]; span: number }
      const hasMesh = (node: THREE.Object3D): boolean => {
        let found = false
        node.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry.getAttribute('position')) found = true
        })
        return found
      }
      const boundsOf = (node: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(node)
      const clustersOf = (node: THREE.Object3D): PartCluster[] => {
        const candidates = node.children.filter(hasMesh)
        if (candidates.length < 2) return []
        const clusters: PartCluster[] = []
        for (const candidate of candidates) {
          const bounds = boundsOf(candidate)
          if (bounds.isEmpty()) continue
          const center = bounds.getCenter(new THREE.Vector3())
          const size = bounds.getSize(new THREE.Vector3())
          const span = Math.max(size.x, size.z, 0.001)
          // Componentes da mesma árvore tendem a compartilhar o centro X/Z.
          // A tolerância escala com o tamanho das próprias malhas.
          const existing = clusters.find((cluster) => {
            const distance = Math.hypot(center.x - cluster.center.x, center.z - cluster.center.z)
            const tolerance = Math.max(0.2, Math.min(span, cluster.span) * 0.28)
            return distance <= tolerance
          })
          if (existing) {
            existing.nodes.push(candidate)
            const count = existing.nodes.length
            existing.center.lerp(center, 1 / count)
            existing.span = Math.max(existing.span, span)
          } else {
            clusters.push({ center, nodes: [candidate], span })
          }
        }
        return clusters
      }

      let bestContainer: THREE.Object3D | null = null
      let bestClusters: PartCluster[] = []
      const findPartContainer = (node: THREE.Object3D): void => {
        const clusters = clustersOf(node)
        // Preferir o nível com mais exemplares separados, normalmente as três árvores.
        if (clusters.length >= 2 && clusters.length > bestClusters.length) {
          bestContainer = node
          bestClusters = clusters
        }
        for (const child of node.children) findPartContainer(child)
      }
      findPartContainer(model)

      if (bestContainer && bestClusters.length >= 2) {
        const animations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
        console.info('[Engine] Componentes espaciais do GLB:', {
          name,
          clusters: bestClusters.map((cluster, index) => ({
            name: cluster.nodes.map((part) => part.name).filter(Boolean).join(' + ') || `Árvore ${index + 1}`,
            meshes: cluster.nodes.reduce((total, part) => {
              let count = 0
              part.traverse((child) => { if (child instanceof THREE.Mesh) count += 1 })
              return total + count
            }, 0),
            center: cluster.center.toArray(),
          })),
          animationClips: animations.map((clip) => clip.name),
        })

        bestClusters.forEach((cluster, index) => {
          const group = new THREE.Group()
          const label = cluster.nodes.map((part) => part.name.trim()).filter(Boolean)[0] || `Árvore ${index + 1}`
          group.name = label
          // Converta cada irmão para coordenadas do mundo antes de reagrupá-lo.
          // Isso mantém as transformações do GLB e os nomes usados pelas animações.
          for (const part of cluster.nodes) {
            part.updateWorldMatrix(true, false)
            const worldMatrix = part.matrixWorld.clone()
            part.removeFromParent()
            worldMatrix.decompose(part.position, part.quaternion, part.scale)
            part.updateMatrix()
            group.add(part)
          }
          const bounds = boundsOf(group)
          const center = bounds.getCenter(new THREE.Vector3())
          group.position.set(-center.x, -center.y, -center.z)
          group.userData.importOffset = [center.x, center.z]
          group.userData.importAnimations = animations
          group.userData.importPart = true
          this.addImportedModel(`${name} — ${label}`, group, targetHeight)
        })
        return
      }
    }

    // O modelo vem do preview, cuja cena não deve continuar sendo dona dele.
    // Removê-lo antes de calcular os limites evita misturar transformações de pais externos.
    model.removeFromParent()
    model.updateMatrixWorld(true)
    // A partição espacial e o BVH são preparados em segundo plano depois que
    // a raiz entra no mundo. Isso mantém a interface responsiva em malhas de 50k+
    // triângulos e usa o mesmo pipeline para os formatos de modelo aceitos pelo importador.
    const bounds = new THREE.Box3().setFromObject(model)
    if (bounds.isEmpty()) throw new Error('O modelo importado não possui geometria visível.')

    const originalSize = bounds.getSize(new THREE.Vector3())
    if (!Number.isFinite(originalSize.y) || originalSize.y <= 0) {
      throw new Error('Não foi possível calcular a altura do modelo importado.')
    }

    // Modelos de terceiros podem conter dezenas de malhas e sombras caras.
    // Desativa sombras por malha importada e prepara limites de geometria para
    // evitar trabalho desnecessário durante renderização e seleção.
    let meshCount = 0
    let triangleCount = 0
    let generatedNormalCount = 0
    let enhancedTextureCount = 0
    const preferredAnisotropy = Math.min(4, this.viewport.renderer.capabilities.getMaxAnisotropy())
    const importedMeshes: THREE.Mesh[] = []
    // Mantém materiais independentes entre modelos importados, mas evita criar
    // um clone de material por bloco da mesma geometria particionada.
    const clonedMaterials = new Map<THREE.Material, THREE.Material>()
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      importedMeshes.push(child)
      meshCount += 1
      // Não herdar estado de visibilidade de exporters/visualizadores externos.
      child.visible = true
      child.castShadow = false
      child.receiveShadow = false
      // Malhas GLB originais mantêm a proteção contra bounds incorretos do preview.
      // Só os blocos gerados habilitam frustum culling, pois seus bounds foram
      // recalculados sobre os vértices de cada região espacial.
      child.frustumCulled = child.userData.generatedOcclusionCluster === true
      const geometries = child.geometry
      const position = geometries.getAttribute('position')
      // Alguns OBJ/FBX/PLY exportados não incluem normais. Gere-as apenas quando
      // faltarem, preservando o sombreamento e a topologia dos modelos que já
      // possuem normais válidas no arquivo de origem.
      const normal = geometries.getAttribute('normal')
      if (position && position.count >= 3 && (!normal || normal.count !== position.count)) {
        geometries.computeVertexNormals()
        generatedNormalCount += 1
      }
      if (!geometries.boundingSphere) geometries.computeBoundingSphere()
      if (!geometries.boundingBox) geometries.computeBoundingBox()
      if (position) triangleCount += geometries.index
        ? geometries.index.count / 3
        : position.count / 3
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
      const materials: THREE.Material[] = sourceMaterials.map((material) => {
        // GLTFs válidos costumam definir material, mas meshes sem material podem
        // aparecer em arquivos exportados por ferramentas externas.
        if (!(material instanceof THREE.Material)) return new THREE.MeshStandardMaterial()
        let clone = clonedMaterials.get(material)
        if (!clone) {
          clone = material.clone()
          clonedMaterials.set(material, clone)
        }
        return clone
      })
      child.material = Array.isArray(child.material) ? materials : (materials[0] ?? child.material)
      for (const material of materials) {
        // Preserve os valores PBR da origem e trate mapas de cor como sRGB.
        // Mapas de normais, rugosidade, metalness e oclusão mantêm espaço linear.
        material.visible = true
        const texturedMaterial = material as THREE.Material & {
          colorWrite?: boolean
          [key: string]: unknown
        }
        if ('colorWrite' in texturedMaterial) texturedMaterial.colorWrite = true
        for (const [slot, value] of Object.entries(texturedMaterial)) {
          if (!(value instanceof THREE.Texture)) continue
          if ((slot === 'map' || slot === 'emissiveMap') && value.colorSpace !== THREE.SRGBColorSpace) {
            value.colorSpace = THREE.SRGBColorSpace
            value.needsUpdate = true
          }
          // Filtragem anisotrópica limitada a 4x deixa texturas oblíquas mais
          // nítidas sem escolher o custo máximo da GPU para todos os materiais.
          if (preferredAnisotropy > value.anisotropy) {
            value.anisotropy = preferredAnisotropy
            value.needsUpdate = true
            enhancedTextureCount += 1
          }
        }
        material.needsUpdate = true
      }
    })
    if (meshCount === 0 || triangleCount === 0) {
      throw new Error('O arquivo foi carregado, mas não contém malhas trianguladas para renderizar.')
    }
    // Evita manter uma hierarquia invisível herdada do preview.
    // A visibilidade de qualquer ancestral controla todos os descendentes.
    let ancestor: THREE.Object3D | null = model
    while (ancestor) {
      ancestor.visible = true
      ancestor = ancestor.parent
    }
    // A seleção usa uma caixa simples; o modelo real não precisa ser testado
    // face por face pelo raycaster a cada clique.
    model.userData.importStats = { meshCount, triangleCount }
    console.info('[Engine] Modelo importado preparado:', {
      name,
      meshCount,
      triangleCount,
      generatedNormalCount,
      enhancedTextureCount,
      textureAnisotropy: preferredAnisotropy,
      bounds: originalSize.toArray(),
      visibleMeshes: importedMeshes.filter((mesh) => mesh.visible).length,
    })

    const height = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : originalSize.y
    // Preserva o nó raiz original do glTF: os clips podem referenciar seu nome
    // e seus transforms. A centralização fica num pivô externo e estável.
    const scaleFactor = height / originalSize.y
    model.scale.multiplyScalar(scaleFactor)
    model.updateMatrixWorld(true)
    const scaledBounds = new THREE.Box3().setFromObject(model)
    const visualCenter = scaledBounds.getCenter(new THREE.Vector3())
    const finalSize = scaledBounds.getSize(new THREE.Vector3())
    const visualPivot = new THREE.Group()
    visualPivot.name = 'ImportedVisualPivot'
    visualPivot.position.copy(visualCenter).negate()
    visualPivot.add(model)

    // Use os clips originais do GLTFLoader: filtrar os nomes dos tracks por
    // comparação textual removia animações válidas em alguns rigs/exportadores.
    // Só uma animação toca por vez para evitar que idle/walk/run briguem pelos ossos.
    const animationClips = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    const explicitRoles = model.userData.importAnimationRoles as Record<string, AnimationRole> | undefined
    const idleClip = animationClips.find((clip) => /idle|stand|rest|breath|neutral/i.test(clip.name))
      ?? animationClips[0]
    let animationMixer: THREE.AnimationMixer | undefined
    let fallbackAnimationAction: THREE.AnimationAction | undefined
    const animationActions: Partial<Record<AnimationRole, THREE.AnimationAction>> = {}
    if (animationClips.length > 0) {
      animationMixer = new THREE.AnimationMixer(model)
      animationClips.forEach((clip, index) => {
        const normalizedName = clip.name.toLowerCase().replace(/[\s._-]+/g, '')
        const isRun = /gallop|canter|sprint|running|run/.test(normalizedName)
        const left = /left|esquerda|izquierda/.test(normalizedName)
        const right = /right|direita|derecha/.test(normalizedName)
        const movementClip = /walk|trot|locomotion|move|run|sprint|gallop|canter|strafe|sidestep|sideways/.test(normalizedName)
        const diagonal = /diagonal|diag|strafe|sidestep|sideways/.test(normalizedName) ||
          (movementClip && (left || right) && !/turn|pivot|rotate/.test(normalizedName))
        const backward = /backward|backwards|reverse|walkback|moveback|backward|tras|atr.s/.test(normalizedName)
        const guessed: AnimationRole = /dismount|unmount|getoff/.test(normalizedName) ? 'dismount'
          : /mounting|mount|geton|riding/.test(normalizedName) ? 'mount'
            : /stoprun|runstop|stoprunning|runningstop|braking|brake|deceleration/.test(normalizedName) ? 'run_stop'
              : /crouch|squat/.test(normalizedName) ? 'crouch'
                : /prone|crawl/.test(normalizedName) ? 'prone_crawl'
                  : /dodge|evade/.test(normalizedName) ? 'dodge'
                    : /slide|sliding/.test(normalizedName) ? 'slide'
                      : /roll|rolling|somersault/.test(normalizedName) ? 'roll'
                        : /reload/.test(normalizedName) ? 'reload'
                          : /inventory/.test(normalizedName) ? 'inventory'
                            : /useitem|consume|drinking|eating/.test(normalizedName) ? 'use_item'
                              : /ability1|skill1|spell1/.test(normalizedName) ? 'ability_1'
                                : /ability2|skill2|spell2/.test(normalizedName) ? 'ability_2'
                                  : /ability3|skill3|spell3/.test(normalizedName) ? 'ability_3'
                                    : /ability4|skill4|spell4/.test(normalizedName) ? 'ability_4'
                                      : /secondaryaction|secondaryattack|block|parry|defend/.test(normalizedName) ? 'secondary_action'
                                        : /primaryaction|attack|strike|punch|slash|shoot|melee/.test(normalizedName) ? 'primary_action'
                                          : /interact|interaction|useobject/.test(normalizedName) ? 'interact'
                                            : /emote|gesture|dance|wave/.test(normalizedName) ? 'emote'
                                              : movementClip && backward ? (isRun ? 'run_backward' : 'walk_backward')
                                                : diagonal && left ? (isRun ? 'run_diagonal_left' : 'walk_diagonal_left')
                                                  : diagonal && right ? (isRun ? 'run_diagonal_right' : 'walk_diagonal_right')
                                                    : isRun ? 'run'
                                                      : /walk|trot|locomotion|move/.test(normalizedName) ? 'walk'
                                                        : /idle|stand|rest|breath|neutral/.test(normalizedName) ? 'idle' : 'ignore'
        const savedRole = explicitRoles?.[String(index)]
        const guessedIsDiagonal = ['walk_diagonal_left', 'walk_diagonal_right', 'run_diagonal_left', 'run_diagonal_right'].includes(guessed)
        // Migra papéis automáticos antigos de locomoção para os papéis diagonais
        // mais específicos identificados no próprio nome do clipe.
        const role = guessedIsDiagonal && (savedRole === undefined || savedRole === 'ignore' || savedRole === 'walk' || savedRole === 'run')
          ? guessed
          : savedRole ?? guessed
        if (role === 'ignore') return
        if (!animationActions[role]) animationActions[role] = animationMixer!.clipAction(clip)
      })
      if (!animationActions.idle && idleClip) {
        const idleIndex = animationClips.indexOf(idleClip)
        if (!explicitRoles || explicitRoles[String(idleIndex)] === undefined) {
          animationActions.idle = animationMixer.clipAction(idleClip)
        }
      }
      // Se o usuário atribuiu papéis no preview, respeite "Não usar":
      // clipes de montar/desmontar nunca devem tocar em loop fora da ação.
      const initialAction = animationActions.idle ?? animationActions.walk ?? animationActions.run
        ?? animationActions.walk_diagonal_left ?? animationActions.walk_diagonal_right
        ?? (!explicitRoles && !animationActions.mount && !animationActions.dismount && !animationActions.run_stop ? animationMixer.clipAction(animationClips[0]!) : undefined)
      if (initialAction) {
        initialAction.reset().setLoop(THREE.LoopRepeat, Infinity).play()
        if (!Object.values(animationActions).includes(initialAction)) fallbackAnimationAction = initialAction
        console.info('[Engine] Animações do componente:', {
          name,
          initialClip: initialAction.getClip().name || '(primeira animação do modelo)',
          availableClips: animationClips.map((clip) => clip.name),
          mappedRoles: explicitRoles ?? 'automático por nome',
        })
      }
    }

    // A caixa de seleção usa as dimensões do modelo e compartilha sua raiz editável.
    const proxyGeometry = new THREE.BoxGeometry(
      Math.max(finalSize.x, 0.05),
      Math.max(height, 0.05),
      Math.max(finalSize.z, 0.05),
    )
    const proxyMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
    })
    const root = new THREE.Mesh(proxyGeometry, proxyMaterial)
    root.name = name.trim() || 'Modelo importado'
    const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48)
    const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48)
    const importOffset = model.userData.importOffset as [number, number] | undefined
    root.position.set(
      restoreData?.position[0] ?? x + (importOffset?.[0] ?? 0) * scaleFactor,
      restoreData?.position[1] ?? this.world.terrain.heightAt(x, z) + height / 2,
      restoreData?.position[2] ?? z + (importOffset?.[1] ?? 0) * scaleFactor,
    )
    if (restoreData) {
      root.rotation.set(...restoreData.rotation)
      root.scale.set(...restoreData.scale)
      root.visible = restoreData.visible
    }
    if (animationMixer) {
      root.userData.importAnimationMixer = animationMixer
      root.userData.importAnimationActions = animationActions
      root.userData.importAnimationFallbackAction = fallbackAnimationAction
      root.userData.importAnimationState = animationActions.idle ? 'idle'
        : animationActions.walk ? 'walk' : animationActions.run ? 'run' : ''
    }
    root.add(visualPivot)
    // Atualiza toda a hierarquia antes de entrar no loop de renderização.
    // Isso também garante bounds corretos para GLB com nós e transforms aninhados.
    root.updateMatrixWorld(true)
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.visible = true
        // Ativa o culling nativo para toda malha estática, não apenas para
        // regiões geradas pelo particionador. Malhas esqueléticas ficam fora
        // desse descarte para evitar popping causado pela deformação dos ossos.
        child.frustumCulled = !(child instanceof THREE.SkinnedMesh)
      }
    })
    root.frustumCulled = false
    root.updateMatrixWorld(true)
    const renderedBounds = new THREE.Box3().setFromObject(model)
    console.info('[Engine] Modelo na cena:', {
      name: root.name,
      rootPosition: root.position.toArray(),
      modelPosition: model.position.toArray(),
      bounds: renderedBounds.isEmpty() ? 'empty' : {
        min: renderedBounds.min.toArray(),
        max: renderedBounds.max.toArray(),
      },
      meshesVisible: importedMeshes.filter(mesh => mesh.visible).length,
      meshCount: importedMeshes.length,
    })

    const id = `model_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
    root.userData.id = id
    root.userData.locked = false
    root.userData.groupId = null
    root.userData.wireframeVisible = false
    root.userData.mass = 1
    // O colisor é configurado no importador e fica independente da malha visual.
    root.userData.colliderType = model.userData.importColliderType === 'box' || model.userData.importColliderType === 'sphere' || model.userData.importColliderType === 'capsule' || model.userData.importColliderType === 'none'
      ? model.userData.importColliderType
      : 'box'
    const importedColliderSize = model.userData.importColliderSize
    if (Array.isArray(importedColliderSize) && importedColliderSize.length === 3 && importedColliderSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
      root.userData.colliderSize = importedColliderSize.map((value: number) => clamp(value, 0.05, 100))
    }
    const importedColliderOffset = model.userData.importColliderOffset
    if (Array.isArray(importedColliderOffset) && importedColliderOffset.length === 3 && importedColliderOffset.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
      root.userData.colliderOffset = importedColliderOffset.map((value: number) => clamp(value, -100, 100))
    }
    root.userData.importedModel = true
    root.userData.importAnimationRoles = explicitRoles ? { ...explicitRoles } : undefined
    const importedControlBindings = model.userData.importControlBindings
      ?? restoreData?.importControlBindings
    root.userData.importControlBindings = importedControlBindings && typeof importedControlBindings === 'object'
      ? { ...importedControlBindings as Partial<ModelControlBindings> }
      : undefined
    const componentId = typeof model.userData.componentId === 'string' ? model.userData.componentId : null
    const componentLogic = Array.isArray(model.userData.componentLogic) ? model.userData.componentLogic : []
    if (model.userData.sceneKind === 'entity') {
      // A entidade usa a raiz editável do World; o GLB permanece como filho visual.
      // Entidades importadas compartilham o mesmo ID, gizmo, colisor e persistência.
      markEntity(root, { componentId, componentLogic })
    } else {
      root.userData.sceneKind = 'object'
      root.userData.componentId = componentId ?? undefined
      root.userData.componentLogic = componentLogic
    }
    root.userData.importedModelData = typeof model.userData.importedModelData === 'string' ? model.userData.importedModelData : restoreData?.importedModelData
    root.userData.importedModelHeight = height
    if (restoreData) {
      root.userData.locked = restoreData.locked ?? false
      root.userData.groupId = restoreData.groupId ?? null
      root.userData.wireframeVisible = restoreData.wireframeVisible ?? false
      root.userData.mass = restoreData.mass ?? 1
      if (restoreData.colliderType) root.userData.colliderType = restoreData.colliderType
      if (restoreData.colliderSize) root.userData.colliderSize = [...restoreData.colliderSize]
      if (restoreData.colliderOffset) root.userData.colliderOffset = [...restoreData.colliderOffset]
    }
    const finalId = restoreData?.id ?? id
    root.userData.id = finalId
    this.world.add({ id: finalId, name: root.name, type: 'cube', mesh: root })
    // Particiona modelos densos e prepara BVH antes de gerar LOD. Assim o
    // simplificador trabalha nas regiões renderizáveis, não na malha já removida.
    void this.modelOcclusion.prepareRoot(root, importedAnimations.length > 0, this.world.scene)
      .then(() => this.modelLod.prepare(finalId, root, importedAnimations.length > 0))
      .then(() => this.viewport.invalidate())
      .catch((error) => {
        console.warn('[Engine] Não foi possível preparar otimizações do modelo:', root.name, error)
      })
    // Ao restaurar um projeto, o ID persistido é diferente do ID temporário.
    // Selecionar o temporário deixa a raiz sem seleção válida para o gizmo.
    this.world.select(finalId)
    this.state.tool = 'select'
    this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform)
    this.transformControls.attach(root)
    this.emitTool()
  }

  select(id: string | null): void {
    this.world.select(id)
  }

  selectedId(): string | null {
    return this.world.getSelectedId()
  }

  removeObject(id: string): void {
    if (this.avatar.isMounted() && this.avatar.getMountedObjectId() === id) this.dismountActiveMount()
    // Restaura geometrias originais antes de World.dispose inspecionar a hierarquia,
    // para liberar as geometrias originais e também os buffers temporários do LOD.
    this.modelLod.remove(id)
    this.world.remove(id)
    this.logic.removeObjectVariables(id)
  }

  renameObject(id: string, name: string): void {
    this.world.rename(id, name)
  }

  updateObject(id: string, patch: ObjectPatch): void {
    if (patch.wireframeVisible === true) this.modelLod.forceOriginal(id)
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
    const wireframeVisible = object.mesh.userData.wireframeVisible === false
    if (wireframeVisible) this.modelLod.forceOriginal(id)
    this.world.update(id, { wireframeVisible })
  }

  listObjects(): ObjectInfo[] {
    return this.world.info()
  }
  /** Lista nós do GLB que contêm malhas e podem receber regras de estado visual. */
  listImportedModelNodes(objectId: string): Array<{ path: string; name: string; meshCount: number }> {
    const root = this.world.get(objectId)?.mesh
    if (!root || root.children.length === 0) return []
    const result: Array<{ path: string; name: string; meshCount: number }> = []
    const countMeshes = (node: THREE.Object3D): number => {
      let count = 0
      node.traverse(child => {
        if (child instanceof THREE.Mesh && child.userData.editorOverlay !== true && child.name !== 'collider-debug-wireframe') count += 1
      })
      return count
    }
    root.traverse(node => {
      if (
        node === root
        || node.userData.editorOverlay === true
        || node.userData.generatedOcclusionCluster === true
        || node.name === 'collider-debug-wireframe'
      ) return
      const meshCount = countMeshes(node)
      if (meshCount === 0) return
      result.push({
        path: this.importedModelNodePath(root, node),
        name: node.name.trim() || node.type,
        meshCount,
      })
    })
    return result
  }

  private importedModelNodePath(root: THREE.Object3D, node: THREE.Object3D): string {
    const segments: string[] = []
    let current: THREE.Object3D | null = node
    while (current && current !== root) {
      const label = current.name.trim() || current.type
      const parentNode: THREE.Object3D | null = current.parent
      const siblings: THREE.Object3D[] = parentNode?.children.filter(
        (sibling: THREE.Object3D) => (sibling.name.trim() || sibling.type) === label,
      ) ?? []
      const duplicateIndex = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0
      segments.unshift(duplicateIndex > 0 ? label + '#' + duplicateIndex : label)
      current = parentNode
    }
    return segments.join('/')
  }

  /** Aplica estados visuais do pacote sem remover nós do GLB; ao desativar uma regra, restaura a visibilidade base. */
  private applyMountModelStates(
    instance: BehaviorPackageInstance,
    force = false,
    enabled = instance.enabled,
  ): void {
    const root = this.world.get(instance.ownerObjectId)?.mesh
    if (!root) return
    const rules = enabled ? getMountPackageSettings(instance).modelStates : []
    const evaluated = rules.map(rule => {
      const actual = Object.prototype.hasOwnProperty.call(instance.variables, rule.variable)
        ? instance.variables[rule.variable]
        : this.logic.getVariable(rule.variable, instance.ownerObjectId)
      const matched = actual !== undefined && (rule.operator === 'not_equals' ? actual !== rule.value : actual === rule.value)
      return { rule, matched, actual }
    })
    const signature = JSON.stringify(evaluated.map(({ rule, matched, actual }) => ({ rule, matched, actual })))
    if (!force && this.mountModelStateSignatures.get(instance.id) === signature) return
    this.modelOcclusion.restoreObjectVisibility(root)
    this.mountModelStateSignatures.set(instance.id, signature)
    root.traverse(node => {
      if (
        node === root
        || node.userData.editorOverlay === true
        || node.userData.generatedOcclusionCluster === true
        || node.name === 'collider-debug-wireframe'
      ) return
      const path = this.importedModelNodePath(root, node)
      const state = evaluated.find(item => item.rule.nodePath === path)
      const baseVisible = node.userData.mountModelStateBaseVisible
      if (state) {
        if (typeof baseVisible !== 'boolean') node.userData.mountModelStateBaseVisible = node.visible
        node.visible = state.matched === state.rule.visibleWhenMatched
      } else if (typeof baseVisible === 'boolean') {
        node.visible = baseVisible
      }
    })
    root.updateMatrixWorld(true)
    this.collisions.invalidateObject(instance.ownerObjectId)
  }


  // ---- terreno ----
  terrainInfo(): TerrainInfo {
    return this.world.terrainInfo()
  }

  setTerrainVisible(visible: boolean): void {
    this.world.setTerrainVisible(visible)
  }

  /** Configura a distância geral de renderização; null mantém todos os objetos e a grama. */
  setRenderDistance(distance: number | null): void {
    this.world.setRenderDistance(distance)
    this.viewport.invalidate()
  }

  setGridVisible(visible: boolean): void {
    this.world.setGridVisible(visible)
  }

  setColliderDebugVisible(visible: boolean): void {
    this.collisions.setDebugVisible(visible)
    this.viewport.invalidate()
  }

  isColliderDebugVisible(): boolean {
    return this.collisions.isDebugVisible()
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
    this.runtimeModeActive = false
    resetIds()
    this.meta = { id: uuid(), name }
    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    this.orbit.setPreset('free')
    this.events.emit('cameraChanged', { preset: 'free' })
    if (this.avatar.isMounted() || this.activeMountPackageId) this.dismountActiveMount()
    this.modelLod.clear()
    if (this.playerModelData) {
      this.playerModelData = null
      void this.avatar.resetDefaultModel().catch((error: unknown) => {
        console.warn('[Engine] Não foi possível restaurar o avatar padrão ao criar um projeto novo.', error)
      })
    }
    this.world.replaceAll([], { seed: randomSeed(), visible: true, edits: [] })
    this.world.setEnvironment({ skyTextureDataUrl: '', timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1 })
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
    const scenePath = bundle.project.scenes[0] ?? MAIN_SCENE_PATH
    bundle.scenes[scenePath].environment = this.world.getEnvironment()
    if (this.playerModelData) bundle.scenes[scenePath].playerModel = { ...this.playerModelData }
    else delete bundle.scenes[scenePath].playerModel
    bundle.logic = this.logic.exportData()
    return bundle
  }

  async loadProject(
    bundle: ProjectBundle,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    this.runtimeModeActive = false
    // Os IDs dos pacotes são persistidos. Limpe a assinatura em cache antes de
    // recarregar um projeto para não confundir o estado visual da cena anterior.
    this.mountModelStateSignatures.clear()
    const report = (message: string, percent: number) => onProgress?.(message, Math.max(0, Math.min(100, percent)))
    const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    if (this.avatar.isMounted() || this.activeMountPackageId) this.dismountActiveMount()
    const firstPath = bundle.project.scenes[0] ?? MAIN_SCENE_PATH
    const scene = bundle.scenes[firstPath]
    if (!scene) throw new ProjectFormatError('O projeto não tem nenhuma cena para carregar.')

    resetIds()
    this.meta = { id: bundle.project.id, name: bundle.project.name }
    this.orbit.restore(scene.camera)
    this.events.emit('cameraChanged', { preset: scene.camera.preset })

    report('Preparando o terreno e os objetos básicos…', 5)
    const regularObjects = scene.objects.filter(object => !object.importedModelData)
    const restoredObjects: ReturnType<typeof objectFromData>[] = []
    // Construir objetos em lotes permite que a interface atualize o progresso
    // em projetos com muitas centenas ou milhares de objetos.
    for (let i = 0; i < regularObjects.length; i += 50) {
      const batch = regularObjects.slice(i, i + 50)
      for (const data of batch) restoredObjects.push(objectFromData(data))
      const percent = regularObjects.length
        ? 5 + Math.round((Math.min(i + batch.length, regularObjects.length) / regularObjects.length) * 20)
        : 25
      report(`Preparando objetos básicos… ${Math.min(i + batch.length, regularObjects.length)}/${regularObjects.length}`, percent)
      if (i + 50 < regularObjects.length) await yieldToUi()
    }
    // Remove LOD temporário antes de descartar as geometrias do mundo anterior.
    this.modelLod.clear()
    await this.world.replaceAllAsync(restoredObjects, scene.terrain, (loaded, total) => {
      const percent = total > 0 ? 25 + Math.round((loaded / total) * 3) : 28
      report(
        total > 0
          ? `Restaurando grama pintada… ${loaded.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`
          : 'Terreno e grama prontos.',
        percent,
      )
    })
    this.world.setEnvironment(scene.environment ?? { timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1, skyTextureDataUrl: '' })
    report('Terreno pronto. Restaurando modelos 3D…', 28)

    const importedObjects = scene.objects.filter(object => !!object.importedModelData)
    const loader = new GLTFLoader()
    for (let i = 0; i < importedObjects.length; i += 1) {
      const data = importedObjects[i]!
      report(`Carregando modelo ${i + 1} de ${importedObjects.length}: ${data.name}…`, 30 + Math.round((i / Math.max(importedObjects.length, 1)) * 60))
      try {
        const binary = Uint8Array.from(atob(data.importedModelData!), char => char.charCodeAt(0)).buffer
        const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>((resolve, reject) => {
          loader.parse(binary, '', resolve, reject)
        })
        const model = gltf.scene
        // O nome visível fica no proxy; preservar o nome do nó glTF mantém os bindings de animação.
        model.userData.importPart = true
        model.userData.importAnimations = gltf.animations
        model.userData.importAnimationRoles = data.importAnimationRoles
        model.userData.importControlBindings = data.importControlBindings
        model.userData.componentId = data.componentId
        model.userData.sceneKind = data.sceneKind === 'entity' ? 'entity' : 'object'
        model.userData.importedModelData = data.importedModelData
        model.userData.importColliderType = data.colliderType ?? 'box'
        model.userData.importColliderSize = data.colliderSize ?? [1, 1, 1]
        model.userData.importColliderOffset = data.colliderOffset ?? [0, 0, 0]
        this.addImportedModel(data.name, model, data.importedModelHeight ?? 1, { ...data, importedModelData: data.importedModelData })
      } catch (error) {
        console.error('[Engine] Não foi possível restaurar o modelo importado:', data.name, error)
        throw new ProjectFormatError(`Não foi possível carregar o modelo "${data.name}" salvo no projeto.`)
      }
      // Dá ao navegador/Tauri a chance de pintar a barra e processar eventos
      // entre assets, em vez de bloquear a interface até terminar tudo.
      await yieldToUi()
    }

    if (scene.playerModel?.glbData) {
      report('Restaurando modelo personalizado do jogador…', 91)
      try {
        const playerBytes = decodeBase64ArrayBuffer(scene.playerModel.glbData)
        await this.avatar.setCustomModel(playerBytes, scene.playerModel.animationRoles)
        this.playerModelData = {
          name: scene.playerModel.name,
          glbData: scene.playerModel.glbData,
          ...(scene.playerModel.animationRoles ? { animationRoles: { ...scene.playerModel.animationRoles } } : {}),
        }
      } catch (error) {
        console.error('[Engine] Não foi possível restaurar o modelo personalizado do jogador:', error)
        throw new ProjectFormatError('Não foi possível carregar o modelo personalizado do jogador salvo neste projeto.')
      }
    } else if (this.playerModelData) {
      report('Restaurando modelo padrão do jogador…', 91)
      try {
        await this.avatar.resetDefaultModel()
        this.playerModelData = null
      } catch (error) {
        console.error('[Engine] Não foi possível restaurar o avatar padrão:', error)
        throw new ProjectFormatError('Não foi possível restaurar o modelo padrão do jogador.')
      }
    }

    report('Finalizando configurações do editor…', 93)
    const editorSettings = bundle.project.settings.editor
    this.world.setGridVisible(editorSettings.gridVisible)
    this.setBrush({ strength: editorSettings.brushStrength, radius: editorSettings.brushRadius })
    this.logic.load(bundle.logic)

    // Pré-compila shaders após restaurar os modelos e texturas do projeto. Isso
    // desloca parte do custo do primeiro quadro para a etapa de carregamento.
    report('Pré-processando geometria e visibilidade…', 96)
    await this.modelOcclusion.waitForPreparation()
    for (const object of this.world.list()) {
      if (object.mesh.userData.importedModel === true) {
        // A oclusão restaura o estado anterior das submalhas. As regras visuais
        // do pacote de montaria precisam ser reaplicadas depois desse último reset.
        this.modelOcclusion.restoreObjectVisibility(object.mesh)
      }
    }

    // A preparação de oclusão pode terminar depois da primeira avaliação dos
    // pacotes e restaurar a malha do cavaleiro como visível. Reaplique as regras
    // explicitamente e force o bypass da assinatura para persistir o estado inicial.
    for (const instance of this.logic.listPackages()) {
      if (instance.packageId === 'mount') this.applyMountModelStates(instance, true)
    }

    report('Preparando shaders e recursos gráficos…', 98)
    await this.viewport.precompile(this.world.scene, this.orbit.camera)
    report('Mundo carregado.', 100)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onRuleKeyDown)
    this.input.dispose()
    this.avatar.dispose()
    this.collisions.dispose()
    this.modelLod.dispose()
    this.modelOcclusion.dispose()
    this.transformControls.dispose()
    for (const off of this.viewportInvalidationOffs) off()
    this.viewportInvalidationOffs.length = 0
    this.viewport.dispose()
  }
}
