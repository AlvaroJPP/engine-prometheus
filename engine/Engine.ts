import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { PointerController } from './input/PointerController'
import { createEditorState } from './EditorState'
import type { BrushSettings, EditorState, ToolMode, TransformMode } from './EditorState'
import { randomSeed, resetIds, uuid } from './lib/id'
import { removeTransientScriptObjects } from './script/TransientScriptObjectCleanup'
import type { ObjectInfo, ObjectPatch } from './model/object/GameObject'
import { MAIN_SCENE_PATH } from './project/format'
import type { CameraPreset, ObjectType, PlayerModelData, ProjectBundle, SceneObjectData } from './project/format'
import { buildBundle, objectFromData } from './project/serialize'
import { restoreImportedProjectModels } from './project/ImportedModelProjectRestorer'
import { restorePlayerModelFromProject } from './project/PlayerModelProjectRestorer'
import type { ProjectMeta } from './project/serialize'
import { ProjectFormatError } from './project/validate'
import { OrbitCamera } from './view/OrbitCamera'
import { Viewport } from './view/Viewport'
import type { ViewportRenderStats } from './view/Viewport'
import { clamp, snap } from './lib/math'
import { encodeArrayBufferBase64 } from './lib/BinaryEncoding'
import { World } from './world/World'
import type { GrassRenderOptions } from './world/map/GrassLayer'
import { CollisionSystem } from './world/CollisionSystem'
import { ModelOcclusionSystem } from './world/ModelOcclusionSystem'
import { ModelLodSystem } from './world/ModelLodSystem'
import { HumanoidAvatar } from './world/HumanoidAvatar'
import { validateImportedModel } from './model/validateImportedModel'
import { splitStaticModelIntoSpatialParts } from './model/ImportedModelSpatialGrouping'
import { prepareImportedModelGeometry } from './model/ImportedModelGeometryPreparation'
import { createImportedModelRoot } from './model/ImportedModelRootFactory'
import { applyImportedModelMetadata } from './model/ImportedModelMetadata'
import type { TerrainInfo } from './world/World'
import { RuleEngine } from './script/RuleEngine'
import { AutonomousBehaviorCoordinator } from './script/AutonomousBehaviorCoordinator'
import { EngineBehaviorTreeRuntime } from './script/EngineBehaviorTreeRuntime'
import { MountModelStateController } from './script/MountModelStateController'
import type { LogicRule } from './script/types'
import { DEFAULT_MODEL_CONTROL_BINDINGS, getMountPackageSettings } from './script/packages'
import type { AnimationRole, BehaviorPackageInstance } from './script/packages'
import { DEFAULT_CONTROL_MAPS } from './input/ControlMaps'
import type { ControlMapBindings } from './input/ControlMaps'
import type { Entity } from './model/entity/Entity'
import { GameModuleRegistry } from './runtime/GameModuleRegistry'
import { createRuntimeFrameUpdateHandler } from './runtime/RuntimeFrameCoordinator'
import { BuildComponentPlacementController } from './runtime/BuildComponentPlacementController'
import { resolveModelControlBindings } from './script/ModelControlBindings'
import { placeSpawnPlatform } from './world/SpawnPlatformPlacement'
import { dispatchMouseBinding, isInteractiveRuntimeTarget, mouseButtonBindingCode } from './input/RuntimePointerBindings'
import type { EngineGameModule, GameModuleContext } from './runtime/GameModule'

import { PRESET_ORDER } from './view/cameraPresets'
import { MAX_PLAYER_MODEL_BYTES } from './model/playerModelLimits'
export interface EngineOptions {
  /** Módulos de jogos fornecidos pela aplicação que hospeda a engine. */
  gameModules?: readonly EngineGameModule[]
}

export class Engine {
  readonly world = new World()
  readonly collisions = new CollisionSystem(this.world)
  private readonly modelOcclusion = new ModelOcclusionSystem()
  private modelLod!: ModelLodSystem
  readonly state: EditorState = createEditorState()
  readonly logic: RuleEngine = new RuleEngine(this.world)
  private readonly behaviorTreeRuntime = new EngineBehaviorTreeRuntime()
  private autonomousBehaviorCoordinator!: AutonomousBehaviorCoordinator
  private buildComponentPlacement!: BuildComponentPlacementController
  private orbit = new OrbitCamera()
  private viewport: Viewport
  private input: PointerController
  private transformControls: TransformControls
  private avatar: HumanoidAvatar
  private playerModelData: PlayerModelData | null = null
  private playerControlBindings: ControlMapBindings = { ...DEFAULT_CONTROL_MAPS[0]!.bindings }
  private meta: ProjectMeta = { id: uuid(), name: 'Novo Mundo' }
  private groupTransformSnapshot: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null = null
  private cameraStateBeforeRun: ReturnType<OrbitCamera['getState']> | null = null
  private runtimeModeActive = false
  /** Mapeia o botão físico pressionado para o controle que foi acionado no jogo. */
  private readonly pressedMouseBindings = new Map<string, string>()
  private activeMountPackageId: string | null = null
  private lastMountMovementState: string | null = null
  private readonly mountModelStateController: MountModelStateController
  private readonly viewportInvalidationOffs: Array<() => void> = []
  private readonly gameModules = new GameModuleRegistry()

  constructor(canvas: HTMLCanvasElement, options: EngineOptions = {}) {
    for (const module of options.gameModules ?? []) this.gameModules.register(module)
    this.viewport = new Viewport(canvas, (aspect) => this.orbit.resize(aspect))
    this.mountModelStateController = new MountModelStateController(
      this.world,
      this.logic,
      this.modelOcclusion,
      this.collisions,
    )
    this.modelLod = new ModelLodSystem(() => {
      this.viewport.invalidate()
    })
    this.avatar = new HumanoidAvatar(this.world, this.orbit.target, () => this.orbit.yaw)
    this.autonomousBehaviorCoordinator = new AutonomousBehaviorCoordinator({
      world: this.world,
      logic: this.logic,
      collisions: this.collisions,
      avatar: this.avatar,
      isRuntimeActive: () => this.runtimeModeActive,
      notifyPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      triggerPackageEvent: (ownerObjectId, packageId, eventId) =>
        this.triggerBehaviorPackageEvent(ownerObjectId, packageId, eventId),
    })
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
    // Escuta no window para o ataque também funcionar quando o canvas está coberto
    // por camadas transparentes do HUD. O handler ignora controles e o Arsenal.
    window.addEventListener('pointerdown', this.onRuntimePointerDown, true)
    window.addEventListener('pointerup', this.onRuntimePointerUp, true)
    window.addEventListener('keydown', this.onRuleKeyDown)
    window.addEventListener('keyup', this.onGameModuleKeyUp)
    window.addEventListener('blur', this.onGameModuleBlur)
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
    this.buildComponentPlacement = new BuildComponentPlacementController({
      world: this.world,
      logic: this.logic,
      transformControls: this.transformControls,
      addImportedModel: (name, model, height) => this.addImportedModel(name, model, height),
      installBehaviorPackage: (ownerObjectId, packageId) => this.installBehaviorPackage(ownerObjectId, packageId),
      updateBehaviorPackage: (id, patch) => this.updateBehaviorPackage(id, patch),
      emitTool: () => this.emitTool(),
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
      (x, y, z) => this.buildComponentPlacement.place(x, y, z),
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
    const moduleContext: GameModuleContext = {
      world: this.world,
      logic: this.logic,
      avatar: this.avatar,
      collisions: this.collisions,
      getControlBindings: () => ({ ...this.playerControlBindings }),
      setCameraTarget: (x, y, z) => this.orbit.target.set(x, y, z),
      isRuntimeActive: () => this.runtimeModeActive,
      invalidate: () => this.viewport.invalidate(),
    }
    this.gameModules.attach(moduleContext)
    this.viewport.start(createRuntimeFrameUpdateHandler({
      input: this.input,
      world: this.world,
      collisions: this.collisions,
      avatar: this.avatar,
      logic: this.logic,
      orbit: this.orbit,
      modelOcclusion: this.modelOcclusion,
      modelLod: this.modelLod,
      viewport: this.viewport,
      gameModules: this.gameModules,
      isRuntimeModeActive: () => this.runtimeModeActive,
      getActiveMountPackageId: () => this.activeMountPackageId,
      getLastMountMovementState: () => this.lastMountMovementState,
      setLastMountMovementState: state => { this.lastMountMovementState = state },
      updateAutonomousBehaviors: dt => this.autonomousBehaviorCoordinator.update(dt),
      updateBehaviorTrees: dt => this.updateBehaviorTrees(dt),
      notifyBehaviorPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      triggerBehaviorPackageEvent: (ownerObjectId, packageId, eventId) =>
        this.triggerBehaviorPackageEvent(ownerObjectId, packageId, eventId),
      applyMountModelStates: instance => this.applyMountModelStates(instance),
    }))
  }

  /** Registra um módulo de jogo sem acoplar o núcleo às regras desse jogo. */
  registerGameModule(module: EngineGameModule): () => void {
    return this.gameModules.register(module)
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

  /** Ajusta de forma independente a escala de resolução e o limite de FPS. */
  setRenderOptions(options: {
    resolutionScale?: number | null
    fpsLimit?: number | null
    dynamicResolution?: boolean
    dynamicResolutionTargetFps?: number
    dynamicResolutionMinScale?: number
  }): void {
    this.viewport.setRenderOptions(options)
  }

  /** Ajusta LOD, densidade, alcance, oclusão e vento da vegetação. */
  setGrassRenderOptions(options: GrassRenderOptions): void {
    this.world.terrain.grass.setRenderOptions(options)
    this.viewport.invalidate()
  }

  /** Liga/desliga a neblina atmosférica. */
  setFogEnabled(enabled: boolean): void {
    this.world.setFogEnabled(enabled)
    this.viewport.invalidate()
  }

  /** Define o alcance visual da neblina entre 50% e 200%. */
  setFogDistanceScale(scale: number): void {
    this.world.setFogDistanceScale(scale)
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

  /** Executa árvores de comportamento genéricas dos pacotes durante o modo Run. */
  private updateBehaviorTrees(dt: number): void {
    this.behaviorTreeRuntime.update({
      world: this.world,
      logic: this.logic,
      playerPosition: this.avatar.mesh.position,
      invalidate: () => this.viewport.invalidate(),
      notifyPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
    }, dt, this.runtimeModeActive)
  }

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
      const controlBindings = resolveModelControlBindings(rawBindings)
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
    this.mountModelStateController.forget(id)
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

  /** Altura final do corpo em unidades do mundo; projetos antigos usam 1,8 u. */
  getPlayerModelHeight(): number {
    return this.playerModelData?.height ?? 1.8
  }

  hasCustomPlayerModel(): boolean {
    return this.playerModelData !== null
  }

  /** Aplica um modelo GLB escolhido pelo usuário, preservando a cápsula física do jogador. */
  async setPlayerModel(
    data: ArrayBuffer,
    name: string,
    animationRoles?: Record<string, AnimationRole>,
    height = 1.8,
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

    // A altura é validada em unidades do mundo. 1,8 u continua sendo o padrão para chamadas antigas.
    const targetHeight = clamp(Number.isFinite(height) ? height : 1.8, 0.1, 10000)
    // A troca visual só é confirmada após o GLB ser validado e carregado.
    await this.avatar.setCustomModel(data, animationRoles, targetHeight)
    this.playerModelData = {
      name: cleanName,
      glbData: encodeArrayBufferBase64(data),
      height: targetHeight,
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
      this.gameModules.start()
      this.transformControls.detach()
      this.transformControls.enabled = false
      this.viewport.invalidate()
      return
    }

    this.gameModules.stop()
    this.logic.restoreRuntimeWorldChanges()
    for (const objectId of removeTransientScriptObjects(this.world)) {
      this.logic.removeObjectVariables(objectId)
    }
    this.runtimeModeActive = false
    for (const code of this.pressedMouseBindings.values()) dispatchMouseBinding(code, 'keyup')
    this.pressedMouseBindings.clear()
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
    placeSpawnPlatform(this.world, this.orbit.target)
  }

  private onRuntimePointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType !== 'mouse' ||
      !this.cameraStateBeforeRun ||
      !this.runtimeModeActive
    ) return

    const code = mouseButtonBindingCode(event.button)
    if (!code || isInteractiveRuntimeTarget(event.target)) return

    const isMappedControl = Object.values(this.playerControlBindings).some(binding => binding === code)
    const dispatchedCode = isMappedControl ? code : null

    if (!dispatchedCode) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (this.pressedMouseBindings.has(code)) return
    this.pressedMouseBindings.set(code, dispatchedCode)
    dispatchMouseBinding(dispatchedCode, 'keydown')
  }

  private onRuntimePointerUp = (event: PointerEvent): void => {
    if (!this.cameraStateBeforeRun || !this.runtimeModeActive) return
    const mouseCode = mouseButtonBindingCode(event.button)
    if (!mouseCode) return
    const dispatchedCode = this.pressedMouseBindings.get(mouseCode)
    if (!dispatchedCode) return

    event.preventDefault()
    event.stopImmediatePropagation()
    this.pressedMouseBindings.delete(mouseCode)
    dispatchMouseBinding(dispatchedCode, 'keyup')
  }

  private onGameModuleKeyUp = (event: KeyboardEvent): void => {
    this.gameModules.dispatchKeyUp(event)
  }

  private onGameModuleBlur = (): void => {
    for (const code of this.pressedMouseBindings.values()) dispatchMouseBinding(code, 'keyup')
    this.pressedMouseBindings.clear()
    this.gameModules.dispatchInputBlur()
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

    // Módulos de jogo processam suas ações; o Visual Script genérico recebe a tecla também.
    const moduleHandled = this.gameModules.dispatchKeyDown(event)
    const executed = this.logic.triggerKeyPressed(event.code)
    if (executed || moduleHandled) event.preventDefault()
  }

  /** Selects a reusable library component for placement with the Build tool. */
  setBuildComponentPlacement(name: string, model: THREE.Object3D, height: number): void {
    this.buildComponentPlacement.set(name, model, height)
  }

  /** Adiciona um modelo externo como objeto transformável na cena. */
  addImportedModel(name: string, model: THREE.Object3D, targetHeight: number, restoreData?: SceneObjectData): void {
    validateImportedModel(model)

    const importedAnimations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    // A divisão espacial só se aplica a modelos estáticos comuns: entidades e modelos animados
    // preservam a hierarquia e os nomes de nós necessários aos bindings de animação.
    if (model.userData.sceneKind !== 'entity' && model.userData.importPart !== true && importedAnimations.length === 0) {
      const spatialParts = splitStaticModelIntoSpatialParts(name, model)
      if (spatialParts) {
        for (const part of spatialParts) {
          this.addImportedModel(`${name} — ${part.label}`, part.model, targetHeight)
        }
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

    const preferredAnisotropy = Math.min(4, this.viewport.renderer.capabilities.getMaxAnisotropy())
    const { meshCount, triangleCount, importedMeshes } = prepareImportedModelGeometry(
      model,
      name,
      preferredAnisotropy,
      originalSize,
    )

    const { root, height, explicitRoles } = createImportedModelRoot({
      model,
      name,
      targetHeight,
      originalSize,
      restoreData,
      cameraTarget: this.orbit.target,
      groundHeightAt: (x, z) => this.world.terrain.heightAt(x, z),
    })

    const renderedBounds = new THREE.Box3().setFromObject(model)
    const renderedSize = renderedBounds.getSize(new THREE.Vector3())
    const hasAnimatedColliderGeometry = importedMeshes.some(mesh =>
      mesh instanceof THREE.SkinnedMesh || (mesh.geometry.morphAttributes.position?.length ?? 0) > 0,
    )
    // Migra cidades/cenários estáticos antigos que ainda tinham a caixa proxy
    // como colisor. A heurística corresponde ao padrão do importador 3D.
    const cityFootprint = Math.max(renderedSize.x, renderedSize.z)
    const cityAspectRatio = cityFootprint / Math.max(renderedSize.y, 0.1)
    const isStaticCityLike = importedAnimations.length === 0 &&
      !hasAnimatedColliderGeometry &&
      (
        (cityFootprint >= 18 && triangleCount >= 1_000) ||
        (meshCount >= 36 && cityFootprint >= 8) ||
        // A previously imported city may already have been normalized to a
        // small final height. Use its proportions as a migration signal too.
        (cityFootprint >= 8 && cityAspectRatio >= 3 && triangleCount >= 800)
      )
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

    const id = applyImportedModelMetadata(root, model, {
      height,
      restoreData,
      explicitRoles,
      isStaticCityLike,
    })
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
  /** Lista os nós do modelo importado que podem receber regras de estado visual. */
  listImportedModelNodes(objectId: string): Array<{ path: string; name: string; meshCount: number }> {
    return this.mountModelStateController.listImportedModelNodes(objectId)
  }

  /** Aplica as regras visuais configuradas no pacote de montaria. */
  private applyMountModelStates(
    instance: BehaviorPackageInstance,
    force = false,
    enabled = instance.enabled,
  ): void {
    this.mountModelStateController.apply(instance, force, enabled)
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
    this.gameModules.stop()
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
    this.gameModules.stop()
    this.runtimeModeActive = false
    // Os IDs dos pacotes são persistidos. Limpe a assinatura em cache antes de
    // recarregar um projeto para não confundir o estado visual da cena anterior.
    this.mountModelStateController.clear()
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

    await restoreImportedProjectModels(scene.objects, {
      report,
      yieldToUi,
      addImportedModel: (name, model, height, restoreData) =>
        this.addImportedModel(name, model, height, restoreData),
    })

    this.playerModelData = await restorePlayerModelFromProject(
      scene.playerModel,
      this.playerModelData,
      this.avatar,
      report,
    )

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
    this.behaviorTreeRuntime.reset()
    this.gameModules.dispose()
    window.removeEventListener('pointerdown', this.onRuntimePointerDown, true)
    window.removeEventListener('pointerup', this.onRuntimePointerUp, true)
    window.removeEventListener('keydown', this.onRuleKeyDown)
    window.removeEventListener('keyup', this.onGameModuleKeyUp)
    window.removeEventListener('blur', this.onGameModuleBlur)
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
