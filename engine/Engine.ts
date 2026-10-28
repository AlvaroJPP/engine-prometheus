import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { PointerController } from './input/PointerController'
import { createEditorState } from './EditorState'
import type { BrushSettings } from './EditorState'
import type { EditorState } from './EditorState'
import type { ToolMode } from './EditorState'
import type { TransformMode } from './EditorState'
import { randomSeed } from './lib/id'
import { uuid } from './lib/id'
import { removeTransientScriptObjects } from './script/TransientScriptObjectCleanup'
import type { ObjectInfo } from './model/object/GameObject'
import type { ObjectPatch } from './model/object/GameObject'
import type { CameraPreset } from './project/format'
import type { ObjectType } from './project/format'
import type { PlayerModelData } from './project/format'
import type { ProjectBundle } from './project/format'
import type { SceneObjectData } from './project/format'
import type { ProjectMeta } from './project/serialize'
import { OrbitCamera } from './view/OrbitCamera'
import { Viewport } from './view/Viewport'
import type { ViewportRenderStats } from './view/Viewport'
import { clamp } from './lib/math'
import { snap } from './lib/math'
import { encodeArrayBufferBase64 } from './lib/BinaryEncoding'
import { World } from './world/World'
import type { GrassRenderOptions } from './world/map/GrassLayer'
import { CollisionSystem } from './world/CollisionSystem'
import { GridPathfinder } from './navigation/GridPathfinder'
import { ModelOcclusionSystem } from './world/ModelOcclusionSystem'
import { ModelLodSystem } from './world/ModelLodSystem'
import { HumanoidAvatar } from './world/HumanoidAvatar'
import { getAnimationControllerFromObject } from './world/AnimationController'
import type { TerrainInfo } from './world/World'
import { RuleEngine } from './script/RuleEngine'
import { AutonomousBehaviorSystem } from './script/AutonomousBehaviorSystem'
import { EngineBehaviorTreeRuntime } from './script/EngineBehaviorTreeRuntime'
import { MountModelStateController } from './script/MountModelStateController'
import type { LogicRule } from './script/types'
import { getMountPackageSettings } from './script/packages'
import type { AnimationRole } from './script/packages'
import type { BehaviorPackageInstance } from './script/packages'
import type { PackageJsonValue } from './script/packages'
import { DEFAULT_CONTROL_MAPS } from './input/ControlMaps'
import type { ControlMapBindings } from './input/ControlMaps'
import type { Entity } from './model/entity/Entity'
import { GameModuleRegistry } from './runtime/GameModuleRegistry'
import type { EngineGameModule } from './runtime/GameModule'
import type { GameModuleContext } from './runtime/GameModule'
import { createEngineBehaviorMethods } from './EngineBehaviorMethods'
import { createEngineInputMethods } from './EngineInputMethods'
import { createEngineModelImportMethods } from './EngineModelImportMethods'
import { createEngineProjectMethods } from './EngineProjectMethods'


const PRESET_ORDER: CameraPreset[] = ['free', 'isometric', 'top']



const MAX_PLAYER_MODEL_BYTES = 30 * 1024 * 1024

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
  private readonly autonomousBehaviorSystem = new AutonomousBehaviorSystem()
  private readonly autonomousPathfinder = new GridPathfinder()
  private readonly behaviorTreeRuntime = new EngineBehaviorTreeRuntime()
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
  /** Mapeia o botão físico pressionado para o controle que foi acionado no jogo. */
  private readonly pressedMouseBindings = new Map<string, string>()
  private activeMountPackageId: string | null = null
  private lastMountMovementState: string | null = null
  private readonly mountModelStateController: MountModelStateController
  private readonly viewportInvalidationOffs: Array<() => void> = []
  private readonly gameModules = new GameModuleRegistry()
  private readonly engineBehaviorMethods = createEngineBehaviorMethods()
  private readonly engineInputMethods = createEngineInputMethods()
  private readonly engineModelImportMethods = createEngineModelImportMethods()
  private readonly engineProjectMethods = createEngineProjectMethods()

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
    // Uma falha de simulação não deve impedir o viewport de desenhar a cena.
    let lastFrameUpdateError = ''
    let lastFrameUpdateErrorAt = 0
    this.viewport.start((dt) => {
      const frameStartedAt = performance.now()
      let hasRunningModelAnimation = false
      let updateFailed = false
      try {
        this.input.update(dt)
        // Um controlador por objeto animado. O mixer pertence ao controlador e só é
        // avançado aqui uma vez, antes da física, para manter colisões e render em sincronia.
      for (const object of this.world.list()) {
        const root = object.mesh
        if (!root.userData.importAnimationController && !root.userData.importAnimationMixer) continue
        const controller = getAnimationControllerFromObject(root)
        if (!controller) continue
        controller.update(dt)
        root.userData.importAnimationState = controller.currentState
        hasRunningModelAnimation ||= controller.isPlaying

        const previousPoseVersion = root.userData.colliderPoseVersion
        root.userData.colliderPoseVersion =
          (typeof previousPoseVersion === 'number' ? previousPoseVersion : 0) + 1
      }
      this.collisions.update(this.runtimeModeActive)
      if (this.activeMountPackageId) {
        const currentMount = this.logic.listPackages().find(instance => instance.id === this.activeMountPackageId)
        if (currentMount?.enabled) this.avatar.updateMountSettings(getMountPackageSettings(currentMount))
      }
      this.avatar.update(dt)
      this.updateAutonomousBehaviors(dt)
      this.updateBehaviorTrees(dt)
      this.gameModules.update(dt)
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
      this.logic.update(this.runtimeModeActive ? dt : 0)
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
      } catch (error) {
        updateFailed = true
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        const now = performance.now()
        if (message !== lastFrameUpdateError || now - lastFrameUpdateErrorAt >= 5000) {
          console.error('[Engine] Falha ao atualizar a simulação; mantendo a renderização ativa.', error)
          lastFrameUpdateError = message
          lastFrameUpdateErrorAt = now
        }
      }
      const environment = this.world.getEnvironment()
      const continuousRendering = this.avatar.mesh.visible || environment.cycleEnabled || hasRunningModelAnimation || updateFailed
      this.viewport.recordUpdateDuration(performance.now() - frameStartedAt)
      this.viewport.render(this.world.scene, this.orbit.camera, performance.now(), continuousRendering)
    })
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

  /** Executa os pacotes autônomos genéricos dos objetos ativos. */
  private updateAutonomousBehaviors(dt: number): void {
    this.engineBehaviorMethods.updateAutonomousBehaviors.call(this as any, dt)
  }

  /**
   * Planeja uma rota para os comportamentos autônomos usando os colisores da cena
   * como obstáculos aproximados. A verificação é independente de qualquer jogo.
   */
  private findAutonomousPath(
    objectId: string,
    start: { x: number; y: number; z: number },
    goal: { x: number; y: number; z: number },
  ): Array<{ x: number; y: number; z: number }> {
    return this.engineBehaviorMethods.findAutonomousPath.call(this as any, objectId, start, goal)
  }

  /** Executa árvores de comportamento genéricas dos pacotes durante o modo Run. */
  private updateBehaviorTrees(dt: number): void {
    this.engineBehaviorMethods.updateBehaviorTrees.call(this as any, dt)
  }

  private notifyBehaviorPackageChanged(ownerObjectId: string): void {
    this.engineBehaviorMethods.notifyBehaviorPackageChanged.call(this as any, ownerObjectId)
  }

  /** Despacha um gatilho do pacote e atualiza a interface se suas ações alterarem variáveis. */
  private triggerBehaviorPackageEvent(ownerObjectId: string, packageId: string, eventId: string): boolean {
    return this.engineBehaviorMethods.triggerBehaviorPackageEvent.call(this as any, ownerObjectId, packageId, eventId)
  }

  /** Finaliza a montaria uma vez, sincronizando variáveis e o gatilho Desmontou. */
  private dismountActiveMount(): void {
    this.engineBehaviorMethods.dismountActiveMount.call(this as any)
  }

  listRules(): LogicRule[] { return this.logic.list() }
  listBehaviorPackages(ownerObjectId?: string): BehaviorPackageInstance[] { return this.logic.listPackages(ownerObjectId) }
  installBehaviorPackage(ownerObjectId: string, packageId: string): BehaviorPackageInstance {
    return this.engineBehaviorMethods.installBehaviorPackage.call(this as any, ownerObjectId, packageId)
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
    this.engineBehaviorMethods.removeBehaviorPackage.call(this as any, id)
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
    for (const code of this.pressedMouseBindings.values()) this.dispatchMouseBinding(code, 'keyup')
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

  private mouseButtonBindingCode(button: number): string | null {
    return this.engineInputMethods.mouseButtonBindingCode.call(this as any, button)
  }

  private dispatchMouseBinding(code: string, type: 'keydown' | 'keyup'): void {
    this.engineInputMethods.dispatchMouseBinding.call(this as any, code, type)
  }

  private isInteractiveRuntimeTarget(target: EventTarget | null): boolean {
    return this.engineInputMethods.isInteractiveRuntimeTarget.call(this as any, target)
  }

  private onRuntimePointerDown = (event: PointerEvent): void => {
    this.engineInputMethods.onRuntimePointerDown.call(this as any, event)
  };

  private onRuntimePointerUp = (event: PointerEvent): void => {
    this.engineInputMethods.onRuntimePointerUp.call(this as any, event)
  };

  private onGameModuleKeyUp = (event: KeyboardEvent): void => {
    this.engineInputMethods.onGameModuleKeyUp.call(this as any, event)
  };

  private onGameModuleBlur = (): void => {
    this.engineInputMethods.onGameModuleBlur.call(this as any)
  };

  private onRuleKeyDown = (event: KeyboardEvent): void => {
    this.engineInputMethods.onRuleKeyDown.call(this as any, event)
  };

  /** Seleciona um componente da biblioteca para ser colocado pela ferramenta Construir. */
  setBuildComponentPlacement(name: string, model: THREE.Object3D, height: number): void {
    this.engineModelImportMethods.setBuildComponentPlacement.call(this as any, name, model, height)
  }

  private placePendingBuildComponent(x: number, baseY: number, z: number): boolean {
    return this.engineModelImportMethods.placePendingBuildComponent.call(this as any, x, baseY, z)
  }

  /** Adiciona um modelo externo como objeto transformável na cena. */
  addImportedModel(name: string, model: THREE.Object3D, targetHeight: number, restoreData?: SceneObjectData): void {
    this.engineModelImportMethods.addImportedModel.call(this as any, name, model, targetHeight, restoreData)
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
    this.engineProjectMethods.newProject.call(this as any, name)
  }

  exportProject(): ProjectBundle {
    return this.engineProjectMethods.exportProject.call(this as any)
  }

  async loadProject(
    bundle: ProjectBundle,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    return this.engineProjectMethods.loadProject.call(this as any, bundle, onProgress)
  }

  dispose(): void {
    this.engineProjectMethods.dispose.call(this as any)
  }
}