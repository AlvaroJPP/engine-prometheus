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
import type { CameraPreset, ObjectType, ProjectBundle, SceneObjectData } from './project/format'
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
import { getMountPackageSettings } from './script/packages'
import type { AnimationRole, BehaviorPackageInstance } from './script/packages'
import { markEntity } from './model/entity/Entity'
import type { Entity } from './model/entity/Entity'

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
  private pendingBuildComponent: { name: string; model: THREE.Object3D; height: number } | null = null
  private cameraStateBeforeRun: ReturnType<OrbitCamera['getState']> | null = null
  private activeMountPackageId: string | null = null
  private lastMountMovementState: string | null = null
  private readonly mountModelStateSignatures = new Map<string, string>()
  private readonly viewportInvalidationOffs: Array<() => void> = []

  constructor(canvas: HTMLCanvasElement) {
    this.viewport = new Viewport(canvas, (aspect) => this.orbit.resize(aspect))
    this.avatar = new HumanoidAvatar(this.world, this.orbit.target, () => this.orbit.yaw)
    this.avatar.mesh.visible = false
    this.avatar.setEnabled(false)
    this.viewportInvalidationOffs.push(
      this.events.on('renderInvalidated', () => this.viewport.invalidate()),
      this.events.on('objectAdded', () => this.viewport.invalidate()),
      this.events.on('objectRemoved', () => this.viewport.invalidate()),
      this.events.on('objectRenamed', () => this.viewport.invalidate()),
      this.events.on('objectChanged', () => this.viewport.invalidate()),
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
        if (mountedTransition && ['mount', 'dismount', 'run_stop', 'jump'].includes(mountedTransition)) {
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
      this.collisions.update()
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
      this.world.updateFogForCamera(this.orbit.camera.position)
      this.world.terrain.grass.updateVisibility(
        this.orbit.camera.position,
        this.avatar.mesh.visible ? this.avatar.mesh.position : null,
        this.world.grassOcclusionRoots(),
      )
      const environment = this.world.getEnvironment()
      const continuousRendering = this.avatar.mesh.visible || environment.cycleEnabled || hasRunningModelAnimation
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

  /** Configura o limite de renderização e a resolução interna do viewport. */
  setPerformancePreset(preset: 'quality' | 'balanced' | 'economy'): void {
    this.viewport.setPerformancePreset(preset)
  }

  /** Compatibilidade com chamadas antigas do modo desempenho. */
  setPerformanceMode(enabled: boolean): void {
    this.viewport.setPerformanceMode(enabled)
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
    const instance = this.logic.installPackage(ownerObjectId, packageId)
    this.notifyBehaviorPackageChanged(ownerObjectId)
    return instance
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

  /** Alterna entre o editor livre e a execução controlada pelo jogador. */
  setRuntimeMode(enabled: boolean): void {
    if (enabled) {
      if (this.cameraStateBeforeRun) return
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
    if (!this.cameraStateBeforeRun || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return

    // Montaria é um pacote de comportamento comum, configurado por objeto.
    // A tecla é lida da instância instalada; nenhum nome de espécie é necessário.
    if (this.avatar.isMounted()) {
      const packageInstance = this.activeMountPackageId
        ? this.logic.listPackages().find(instance => instance.id === this.activeMountPackageId)
        : undefined
      const interactionKey = packageInstance ? getMountPackageSettings(packageInstance).interactionKey : 'KeyE'
      if (event.code === interactionKey) {
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
          candidate.object?.mesh.visible &&
          event.code === candidate.settings.interactionKey &&
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
        if (!currentInstance?.enabled || !candidate.object.mesh.visible) continue
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
    const importedMeshes: THREE.Mesh[] = []
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      importedMeshes.push(child)
      meshCount += 1
      // Não herdar estado de visibilidade de exporters/visualizadores externos.
      child.visible = true
      child.castShadow = false
      child.receiveShadow = false
      // Assets GLB podem trazer bounding spheres incorretas ou muito pequenas.
      // Desativar frustum culling evita que a malha desapareça após ser movida
      // do preview para a cena principal, sem afetar a caixa de seleção.
      child.frustumCulled = false
      const geometries = child.geometry
      if (!geometries.boundingSphere) geometries.computeBoundingSphere()
      if (!geometries.boundingBox) geometries.computeBoundingBox()
      const position = geometries.getAttribute('position')
      if (position) triangleCount += geometries.index
        ? geometries.index.count / 3
        : position.count / 3
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
      // Cada objeto importado recebe materiais próprios: alterar a cor de uma
      // árvore não deve modificar as outras árvores que compartilham materiais no GLB.
      const materials = sourceMaterials.map((material) => material.clone())
      child.material = Array.isArray(child.material) ? materials : (materials[0] ?? child.material)
      for (const material of materials) {
        // Preserve os valores PBR do glTF e garanta que mapas de cor sejam lidos
        // como sRGB, inclusive em arquivos exportados com metadados incompletos.
        material.visible = true
        const texturedMaterial = material as THREE.Material & {
          colorWrite?: boolean
          map?: THREE.Texture | null
          emissiveMap?: THREE.Texture | null
        }
        if (texturedMaterial.map) texturedMaterial.map.colorSpace = THREE.SRGBColorSpace
        if (texturedMaterial.emissiveMap) texturedMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace
        if ('colorWrite' in texturedMaterial) texturedMaterial.colorWrite = true
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
        const guessed: AnimationRole = /dismount|unmount|getoff/.test(normalizedName) ? 'dismount'
          : /mounting|mount|geton|riding/.test(normalizedName) ? 'mount'
            : /stoprun|runstop|stoprunning|runningstop|braking|brake|deceleration/.test(normalizedName) ? 'run_stop'
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
        child.frustumCulled = false
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
      if (node === root || node.userData.editorOverlay === true || node.name === 'collider-debug-wireframe') return
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
      const parent = current.parent
      const siblings = parent?.children.filter(sibling => (sibling.name.trim() || sibling.type) === label) ?? []
      const duplicateIndex = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0
      segments.unshift(duplicateIndex > 0 ? label + '#' + duplicateIndex : label)
      current = parent
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
    this.mountModelStateSignatures.set(instance.id, signature)
    root.traverse(node => {
      if (node === root || node.userData.editorOverlay === true || node.name === 'collider-debug-wireframe') return
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
  }


  // ---- terreno ----
  terrainInfo(): TerrainInfo {
    return this.world.terrainInfo()
  }

  setTerrainVisible(visible: boolean): void {
    this.world.setTerrainVisible(visible)
  }

  /** Configura alcance radial da grama; null renderiza todo o mapa. */
  setGrassRenderDistance(distance: number | null): void {
    this.world.setGrassRenderDistance(distance)
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
    resetIds()
    this.meta = { id: uuid(), name }
    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    this.orbit.setPreset('free')
    this.events.emit('cameraChanged', { preset: 'free' })
    if (this.avatar.isMounted() || this.activeMountPackageId) this.dismountActiveMount()
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
    bundle.logic = this.logic.exportData()
    return bundle
  }

  async loadProject(
    bundle: ProjectBundle,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
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

    report('Finalizando configurações do editor…', 93)
    const editorSettings = bundle.project.settings.editor
    this.world.setGridVisible(editorSettings.gridVisible)
    this.setBrush({ strength: editorSettings.brushStrength, radius: editorSettings.brushRadius })
    this.logic.load(bundle.logic)
    report('Mundo carregado.', 100)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onRuleKeyDown)
    this.input.dispose()
    this.avatar.dispose()
    this.collisions.clear()
    this.transformControls.dispose()
    for (const off of this.viewportInvalidationOffs) off()
    this.viewportInvalidationOffs.length = 0
    this.viewport.dispose()
  }
}
