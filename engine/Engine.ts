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
import { decodeBase64ArrayBuffer, encodeArrayBufferBase64 } from './lib/BinaryEncoding'
import { World } from './world/World'
import type { GrassRenderOptions } from './world/map/GrassLayer'
import { CollisionSystem } from './world/CollisionSystem'
import { ModelOcclusionSystem } from './world/ModelOcclusionSystem'
import { ModelLodSystem } from './world/ModelLodSystem'
import { HumanoidAvatar } from './world/HumanoidAvatar'
import { AnimationController, createAnimationActionMap, getAnimationControllerFromObject } from './world/AnimationController'
import type { TerrainInfo } from './world/World'
import { RuleEngine } from './script/RuleEngine'
import { AutonomousBehaviorSystem, isAutonomousMovingState } from './script/AutonomousBehaviorSystem'
import { VeilborneVisualEffects } from './script/VeilborneVisualEffects'
import { VeilborneHealthBarSystem } from './script/VeilborneHealthBarSystem'
import { MountModelStateController } from './script/MountModelStateController'
import { createVeilborneSigilVisual, createVeilborneWardMesh, disposeVeilborneVisual } from './script/VeilborneSigilVisuals'
import { VeilborneTargetLockController } from './script/VeilborneTargetLockController'
import { VeilborneInventorySystem } from './script/VeilborneInventorySystem'
import { VeilborneItemUseSystem } from './script/VeilborneItemUseSystem'
import { VeilborneProgressionSystem } from './script/VeilborneProgressionSystem'
import { VeilborneLootSystem } from './script/VeilborneLootSystem'
import { VeilborneDeathRespawnSystem } from './script/VeilborneDeathRespawnSystem'
import type { LogicRule } from './script/types'
import { DEFAULT_MODEL_CONTROL_BINDINGS, getBehaviorPackageDefinition, getMountPackageSettings } from './script/packages'
import type { AnimationRole, BehaviorPackageInstance, ModelControlBindings, PackageJsonValue, PackageScalar } from './script/packages'
import { DEFAULT_CONTROL_MAPS } from './input/ControlMaps'
import type { ControlMapBindings } from './input/ControlMaps'
import {
  applyVeilborneDamage,
  applyVeilborneStatus,
  calculateVeilborneSpellDamage,
  calculateVeilborneWeaponDamage,
  createVeilborneCombatant,
  isVeilborneParrySuccessful,
  restoreVeilborneResource,
  spendVeilborneResource,
  tickVeilborneStatuses,
  VEILBORNE_DEFAULT_SPELL_SLOTS,
  VEILBORNE_RUNTIME_SPELLS,
  VEILBORNE_RUNTIME_WEAPONS,
  VEILBORNE_RUNTIME_SIGILS,
  VEILBORNE_RUNTIME_ITEMS,
} from './script/VeilborneCombat'
import type { VeilborneCombatant, VeilborneDamageType, VeilborneStatusId } from './script/VeilborneCombat'
import type { VeilborneRuntimeSigil } from './script/VeilborneCombat'
import { markEntity } from './model/entity/Entity'
import type { Entity } from './model/entity/Entity'

const PRESET_ORDER: CameraPreset[] = ['free', 'isometric', 'top']

function isPackageJsonValue(value: unknown, depth = 0): value is PackageJsonValue {
  if (depth > 16) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => isPackageJsonValue(item, depth + 1))
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>)
    .every(item => isPackageJsonValue(item, depth + 1))
  return false
}

const MAX_PLAYER_MODEL_BYTES = 30 * 1024 * 1024

export class Engine {
  readonly world = new World()
  readonly collisions = new CollisionSystem(this.world)
  private readonly modelOcclusion = new ModelOcclusionSystem()
  private modelLod!: ModelLodSystem
  readonly state: EditorState = createEditorState()
  readonly logic: RuleEngine = new RuleEngine(this.world)
  private readonly autonomousBehaviorSystem = new AutonomousBehaviorSystem()
  private readonly veilborneVisualEffects: VeilborneVisualEffects
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
  private readonly veilborneCooldowns = new Map<string, number>()
  private readonly veilborneHealthBars: VeilborneHealthBarSystem
  private readonly veilborneTargetLock: VeilborneTargetLockController
  private readonly veilborneInventory: VeilborneInventorySystem
  private readonly veilborneItemUseSystem: VeilborneItemUseSystem
  private readonly veilborneProgression: VeilborneProgressionSystem
  private readonly veilborneLootSystem: VeilborneLootSystem
  private readonly veilborneDeathRespawn: VeilborneDeathRespawnSystem
  private readonly veilborneTargetStates = new Map<string, VeilborneCombatant>()
  private readonly veilborneStatusTickTimers = new Map<string, number>()
  private readonly activeVeilborneSigils = new Map<string, {
    profileId: string
    position: THREE.Vector3
    visual: THREE.Group
    remainingSeconds: number
    triggeredObjectIds: Set<string>
  }>()
  private veilborneSigilSequence = 0
  private veilborneWardMesh: THREE.Mesh | null = null
  private veilborneWardRemainingSeconds = 0
  private veilborneWardAbsorption = 0
  private veilborneBlocking = false
  private veilborneParryStartedAt = Number.NEGATIVE_INFINITY
  private readonly veilborneParryWindowSeconds = 0.2
  private veilbornePlayerStaggerRemainingSeconds = 0
  private veilborneHeavyChargeStartedAt: number | null = null
  private veilborneLootNoticeRemainingSeconds = 0
  private veilborneDefaultSpawnPosition: THREE.Vector3 | null = null
  private veilbornePlayerRespawnRemainingSeconds = 0
  private veilbornePlayerState: VeilborneCombatant | null = null
  private veilbornePendingCast: {
    spellId: string
    remainingSeconds: number
    targetId: string | null
    impactPosition: THREE.Vector3
  } | null = null
  private readonly viewportInvalidationOffs: Array<() => void> = []

  constructor(canvas: HTMLCanvasElement) {
    this.viewport = new Viewport(canvas, (aspect) => this.orbit.resize(aspect))
    this.veilborneVisualEffects = new VeilborneVisualEffects(
      this.world.scene,
      () => this.viewport.invalidate(),
    )
    this.veilborneInventory = new VeilborneInventorySystem(
      this.logic,
      (message, durationSeconds) => {
        this.logic.setVariable('loot_notice', message)
        this.veilborneLootNoticeRemainingSeconds = durationSeconds
      },
    )
    this.mountModelStateController = new MountModelStateController(
      this.world,
      this.logic,
      this.modelOcclusion,
      this.collisions,
    )
    this.veilborneHealthBars = new VeilborneHealthBarSystem(this.world.scene)
    this.modelLod = new ModelLodSystem(() => {
      this.viewport.invalidate()
    })
    this.avatar = new HumanoidAvatar(this.world, this.orbit.target, () => this.orbit.yaw)
    this.veilborneLootSystem = new VeilborneLootSystem({
      world: this.world,
      logic: this.logic,
      avatar: this.avatar.mesh,
      inventory: this.veilborneInventory,
      isEnabled: () => this.isVeilborneEnabled(),
      isRuntimeModeActive: () => this.runtimeModeActive,
      installBehaviorPackage: (ownerObjectId, packageId) => this.installBehaviorPackage(ownerObjectId, packageId),
      notifyBehaviorPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      removeObject: id => this.removeObject(id),
      clearNotice: () => {
        if (this.logic.getVariable('loot_notice') !== undefined) this.logic.setVariable('loot_notice', '')
        this.veilborneLootNoticeRemainingSeconds = 0
      },
      spawnEffect: (position, color, scale, durationSeconds) =>
        this.veilborneVisualEffects.spawnEffect(position, color, scale, durationSeconds),
      invalidate: () => this.viewport.invalidate(),
    })
    this.veilborneProgression = new VeilborneProgressionSystem({
      world: this.world,
      logic: this.logic,
      avatar: this.avatar.mesh,
      isEnabled: () => this.isVeilborneEnabled(),
      isRuntimeModeActive: () => this.runtimeModeActive,
      readNumber: (name, fallback) => this.readVeilborneNumber(name, fallback),
      getPlayer: () => this.getVeilbornePlayerCombatant(),
      syncPlayer: player => this.syncVeilbornePlayerCombatant(player),
      installBehaviorPackage: (ownerObjectId, packageId) => this.installBehaviorPackage(ownerObjectId, packageId),
      notifyBehaviorPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      triggerBehaviorPackageEvent: (ownerObjectId, packageId, eventId) =>
        this.triggerBehaviorPackageEvent(ownerObjectId, packageId, eventId),
      removeObject: id => this.removeObject(id),
      registerSpawnedLoot: id => this.veilborneLootSystem.registerSpawnedLoot(id),
      forgetSpawnedLoot: id => this.veilborneLootSystem.forgetSpawnedLoot(id),
      spawnEffect: (position, color, scale, durationSeconds) =>
        this.veilborneVisualEffects.spawnEffect(position, color, scale, durationSeconds),
      showNotice: (message, durationSeconds) => {
        this.logic.setVariable('loot_notice', message)
        this.veilborneLootNoticeRemainingSeconds = durationSeconds
      },
      invalidate: () => this.viewport.invalidate(),
    })
    this.veilborneDeathRespawn = new VeilborneDeathRespawnSystem({
      world: this.world,
      logic: this.logic,
      avatar: this.avatar,
      progression: this.veilborneProgression,
      readNumber: (name, fallback) => this.readVeilborneNumber(name, fallback),
      syncPlayer: player => this.syncVeilbornePlayerCombatant(player),
      getOrbitTarget: () => this.orbit.target,
      getDefaultSpawnPosition: () => this.veilborneDefaultSpawnPosition,
      getRespawnRemaining: () => this.veilbornePlayerRespawnRemainingSeconds,
      setRespawnRemaining: seconds => { this.veilbornePlayerRespawnRemainingSeconds = seconds },
      resetCombatInputs: () => {
        this.veilborneHeavyChargeStartedAt = null
        this.veilborneBlocking = false
        this.veilborneParryStartedAt = Number.NEGATIVE_INFINITY
        this.logic.setVariable('carregando_ataque', false)
        this.logic.setVariable('carga_ataque', 0)
        this.logic.setVariable('bloqueando', false)
      },
      clearTargetLock: () => this.veilborneTargetLock.clear(),
      spawnEffect: (position, color, scale, durationSeconds) =>
        this.veilborneVisualEffects.spawnEffect(position, color, scale, durationSeconds),
      invalidate: () => this.viewport.invalidate(),
    })
    this.veilborneTargetLock = new VeilborneTargetLockController({
      scene: this.world.scene,
      avatar: this.avatar.mesh,
      logic: this.logic,
      findTarget: maxRange => this.findVeilborneTarget(maxRange),
      getHostiles: () => this.getVeilborneHostilePackages(),
      getWorldPoint: objectId => this.getVeilborneWorldPoint(objectId),
      isPlayerAlive: () => this.getVeilbornePlayerCombatant().alive,
      spawnEffect: (position, color, radius, durationSeconds) =>
        this.veilborneVisualEffects.spawnEffect(position, color, radius, durationSeconds),
      invalidate: () => this.viewport.invalidate(),
    })
    this.veilborneItemUseSystem = new VeilborneItemUseSystem({
      logic: this.logic,
      inventory: this.veilborneInventory,
      isEnabled: () => this.isVeilborneEnabled(),
      isRuntimeModeActive: () => this.runtimeModeActive,
      getPlayer: () => this.getVeilbornePlayerCombatant(),
      syncPlayer: player => this.syncVeilbornePlayerCombatant(player),
      readEchoes: () => this.readVeilborneNumber('ecos', 0),
      findTarget: maxRange => this.findVeilborneTarget(maxRange),
      getHostiles: () => this.getVeilborneHostilePackages(),
      getAvatarMesh: () => this.avatar.mesh,
      spawnEffect: (position, color, scale, durationSeconds) =>
        this.veilborneVisualEffects.spawnEffect(position, color, scale, durationSeconds),
      applyHit: (instance, amount, damageType, postureDamage, status) =>
        this.applyVeilborneHit(instance, amount, damageType, postureDamage, status),
      showNotice: (message, durationSeconds) => {
        this.logic.setVariable('loot_notice', message)
        this.veilborneLootNoticeRemainingSeconds = durationSeconds
      },
      invalidate: () => this.viewport.invalidate(),
    })
    this.avatar.setManeuverAdmission(kind => this.admitVeilborneManeuver(kind))
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
    window.addEventListener('keyup', this.onVeilborneKeyUp)
    window.addEventListener('blur', this.onVeilborneBlur)
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
      // Um controlador por objeto animado. O mixer pertence ao controlador e só é
      // avançado aqui uma vez, antes da física, para manter colisões e render em sincronia.
      let hasRunningModelAnimation = false
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
      this.updateVeilborneRuntime(dt)
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

  private isVeilborneEnabled(): boolean {
    return this.logic.listPackages().some(instance => instance.enabled && instance.packageId === 'veilborne_rpg')
  }

  private ensureVeilbornePlayerVariables(): void {
    if (!this.isVeilborneEnabled()) return
    const defaults: Array<[string, boolean | number | string]> = [
      ['vida', 100], ['vida_max', 100], ['eter', 100], ['eter_max', 100],
      ['vigor', 100], ['vigor_max', 100], ['postura', 0], ['postura_max', 100],
      ['forca', 10], ['destreza', 10], ['intelecto', 10], ['vontade', 10], ['resistencia', 10],
      ['res_fisica', 0], ['res_chama', 0], ['res_geada', 0], ['res_tempestade', 0],
      ['res_sangue', 0], ['res_sombra', 0], ['res_espirito', 0], ['res_arcano', 0],
      ['ecos', 0], ['nivel', 1], ['experiencia', 0], ['experiencia_proximo_nivel', 100], ['pontos_atributo', 0], ['arquetipo', 'custom'],
      ['morto', false], ['arma_equipada', 'starter_arcane_sword'],
      ['magia_1', VEILBORNE_DEFAULT_SPELL_SLOTS[0]],
      ['magia_2', VEILBORNE_DEFAULT_SPELL_SLOTS[1]],
      ['magia_3', VEILBORNE_DEFAULT_SPELL_SLOTS[2]],
      ['magia_4', VEILBORNE_DEFAULT_SPELL_SLOTS[3]],
      ['sigilo_1', 'ward'], ['sigilo_2', 'blast'], ['sigilo_3', 'hunter_mark'], ['sigilo_4', 'slow_field'],
      ['sigilo_selecionado', 1], ['sigilo_ativo', 'ward'],
      ['bloqueando', false], ['aparo_total', 0], ['aparo_sucesso', false], ['jogador_morreu', false], ['jogador_atordoado', false],
      ['alvo_travado', false], ['alvo_veilborne_id', ''],
      ['carregando_ataque', false], ['carga_ataque', 0],
      ['ward_remaining', 0], ['ward_absorption', 0],
      ['inventario_json', '[]'], ['item_use_request', ''], ['loot_notice', ''],
      ['checkpoint_id', ''], ['checkpoint_x', 0], ['checkpoint_y', 0], ['checkpoint_z', 0],
      ['ecos_perdidos', 0], ['ponto_de_morte_x', 0], ['ponto_de_morte_y', 0], ['ponto_de_morte_z', 0], ['morte_contagem', 0],
    ]
    for (const [name, value] of defaults) {
      if (this.logic.getVariable(name) === undefined) this.logic.setVariable(name, value)
    }
  }

  private readVeilborneNumber(name: string, fallback: number): number {
    const value = this.logic.getVariable(name)
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private readVeilborneString(name: string, fallback: string): string {
    const value = this.logic.getVariable(name)
    return typeof value === 'string' && value.trim() ? value : fallback
  }

  private getVeilbornePlayerCombatant(): VeilborneCombatant {
    this.ensureVeilbornePlayerVariables()
    const resources = {
      vitality: this.readVeilborneNumber('vida', 100),
      maxVitality: Math.max(1, this.readVeilborneNumber('vida_max', 100)),
      ether: this.readVeilborneNumber('eter', 100),
      maxEther: Math.max(1, this.readVeilborneNumber('eter_max', 100)),
      stamina: this.readVeilborneNumber('vigor', 100),
      maxStamina: Math.max(1, this.readVeilborneNumber('vigor_max', 100)),
      posture: this.readVeilborneNumber('postura', 0),
      maxPosture: Math.max(1, this.readVeilborneNumber('postura_max', 100)),
    }
    const player = this.veilbornePlayerState ?? createVeilborneCombatant('veilborne-player', resources)
    player.resources = {
      vitality: Math.max(0, Math.min(resources.maxVitality, resources.vitality)),
      maxVitality: resources.maxVitality,
      ether: Math.max(0, Math.min(resources.maxEther, resources.ether)),
      maxEther: resources.maxEther,
      stamina: Math.max(0, Math.min(resources.maxStamina, resources.stamina)),
      maxStamina: resources.maxStamina,
      posture: Math.max(0, Math.min(resources.maxPosture, resources.posture)),
      maxPosture: resources.maxPosture,
    }
    player.attributes = {
      strength: this.readVeilborneNumber('forca', 10),
      dexterity: this.readVeilborneNumber('destreza', 10),
      intellect: this.readVeilborneNumber('intelecto', 10),
      will: this.readVeilborneNumber('vontade', 10),
      resistance: this.readVeilborneNumber('resistencia', 10),
    }
    player.resistances = {
      physical: this.readVeilborneNumber('res_fisica', 0),
      fire: this.readVeilborneNumber('res_chama', 0),
      frost: this.readVeilborneNumber('res_geada', 0),
      storm: this.readVeilborneNumber('res_tempestade', 0),
      blood: this.readVeilborneNumber('res_sangue', 0),
      shadow: this.readVeilborneNumber('res_sombra', 0),
      spirit: this.readVeilborneNumber('res_espirito', 0),
      arcane: this.readVeilborneNumber('res_arcano', 0),
    }
    player.alive = player.resources.vitality > 0 && this.logic.getVariable('morto') !== true
    this.veilbornePlayerState = player
    return player
  }

  private syncVeilbornePlayerCombatant(player: VeilborneCombatant): void {
    this.logic.setVariable('vida', player.resources.vitality)
    this.logic.setVariable('eter', player.resources.ether)
    this.logic.setVariable('vigor', player.resources.stamina)
    this.logic.setVariable('postura', player.resources.posture)
    if (player.resources.vitality <= 0) {
      this.logic.setVariable('morto', true)
    } else if (this.logic.getVariable('morto') === true) {
      this.logic.setVariable('morto', false)
    }
  }

  private getVeilborneHostilePackages(): Array<{ instance: BehaviorPackageInstance; object: NonNullable<ReturnType<World['get']>> }> {
    return this.logic.listPackages()
      .filter(instance => instance.enabled && instance.packageId === 'veilborne_rpg')
      .filter(instance => instance.variables.entity_role === undefined || instance.variables.entity_role === 'combatant')
      .filter(instance => instance.variables.faction === undefined || instance.variables.faction === 'hostile')
      .filter(instance => instance.variables.morto !== true && (typeof instance.variables.vida !== 'number' || instance.variables.vida > 0))
      .map(instance => ({ instance, object: this.world.get(instance.ownerObjectId) }))
      .filter((entry): entry is { instance: BehaviorPackageInstance; object: NonNullable<ReturnType<World['get']>> } =>
        entry.object !== undefined && this.world.isObjectVisible(entry.object),
      )
  }

  private findVeilborneTarget(maxRange: number): { instance: BehaviorPackageInstance; object: NonNullable<ReturnType<World['get']>>; distance: number } | null {
    const playerPosition = this.avatar.mesh.position
    const hostiles = this.getVeilborneHostilePackages()
    if (this.veilborneTargetLock.targetId) {
      const locked = hostiles.find(candidate => candidate.object.id === this.veilborneTargetLock.targetId)
      if (!locked) {
        this.veilborneTargetLock.clear()
      } else {
        const distance = Math.hypot(
          locked.object.mesh.position.x - playerPosition.x,
          locked.object.mesh.position.z - playerPosition.z,
        )
        return distance <= maxRange
          ? { instance: locked.instance, object: locked.object, distance }
          : null
      }
    }
    const forward = new THREE.Vector3(Math.sin(this.avatar.mesh.rotation.y), 0, Math.cos(this.avatar.mesh.rotation.y)).normalize()
    let best: { instance: BehaviorPackageInstance; object: NonNullable<ReturnType<World['get']>>; distance: number; score: number } | null = null

    for (const candidate of hostiles) {
      const delta = candidate.object.mesh.position.clone().sub(playerPosition)
      delta.y = 0
      const distance = delta.length()
      if (distance > maxRange || distance < 0.001) continue
      const facing = forward.dot(delta.normalize())
      if (facing < -0.15) continue
      const score = distance + (1 - facing) * 1.2
      if (!best || score < best.score) best = { ...candidate, distance, score }
    }
    return best ? { instance: best.instance, object: best.object, distance: best.distance } : null
  }

  private getVeilborneTargetCombatant(instance: BehaviorPackageInstance): VeilborneCombatant {
    const variables = instance.variables
    const number = (name: string, fallback: number): number => {
      const value = variables[name]
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }
    const maxVitality = Math.max(1, number('vida_max', 100))
    const maxEther = Math.max(1, number('eter_max', 100))
    const maxStamina = Math.max(1, number('vigor_max', 100))
    const maxPosture = Math.max(1, number('postura_max', 100))
    const current: Partial<VeilborneCombatant['resources']> = {
      vitality: number('vida', maxVitality), maxVitality,
      ether: number('eter', maxEther), maxEther,
      stamina: number('vigor', maxStamina), maxStamina,
      posture: number('postura', 0), maxPosture,
    }
    const state = this.veilborneTargetStates.get(instance.ownerObjectId) ??
      createVeilborneCombatant(instance.ownerObjectId, current)
    state.resources = {
      vitality: Math.max(0, Math.min(maxVitality, current.vitality ?? maxVitality)),
      maxVitality,
      ether: Math.max(0, Math.min(maxEther, current.ether ?? maxEther)),
      maxEther,
      stamina: Math.max(0, Math.min(maxStamina, current.stamina ?? maxStamina)),
      maxStamina,
      posture: Math.max(0, Math.min(maxPosture, current.posture ?? 0)),
      maxPosture,
    }
    state.attributes = {
      strength: number('forca', 10),
      dexterity: number('destreza', 10),
      intellect: number('intelecto', 10),
      will: number('vontade', 10),
      resistance: number('resistencia', 10),
    }
    const resistance = (name: string): number => number(name, 0)
    state.resistances = {
      physical: resistance('res_fisica'),
      fire: resistance('res_chama'),
      frost: resistance('res_geada'),
      storm: resistance('res_tempestade'),
      blood: resistance('res_sangue'),
      shadow: resistance('res_sombra'),
      spirit: resistance('res_espirito'),
      arcane: resistance('res_arcano'),
    }
    state.alive = state.resources.vitality > 0 && variables.morto !== true
    this.veilborneTargetStates.set(instance.ownerObjectId, state)
    return state
  }

  private syncVeilborneTarget(instance: BehaviorPackageInstance, target: VeilborneCombatant, notify = true): void {
    this.logic.setPackageVariable(instance.id, 'vida', target.resources.vitality)
    this.logic.setPackageVariable(instance.id, 'postura', target.resources.posture)
    if (target.resources.vitality <= 0) {
      this.logic.setPackageVariable(instance.id, 'morto', true)
      target.alive = false
    }
    if (notify) this.notifyBehaviorPackageChanged(instance.ownerObjectId)
  }



  private tryActivateVeilborneCheckpoint(): boolean {
    return this.veilborneProgression.activateCheckpoint()
  }

  private tryPickupVeilborneEchoCache(): boolean {
    return this.veilborneProgression.pickupEchoCache()
  }

  private handleVeilbornePlayerDeath(): void {
    this.veilborneDeathRespawn.handlePlayerDeath()
  }

  private updateVeilborneRespawn(dt: number, player: VeilborneCombatant): void {
    this.veilborneDeathRespawn.update(dt, player)
  }

  private tryPickupVeilborneLoot(): boolean {
    return this.veilborneLootSystem.pickup()
  }

  private spawnVeilborneLootDrop(instance: BehaviorPackageInstance): void {
    this.veilborneLootSystem.spawnDrop(instance)
  }

  private processVeilborneItemUseRequest(): void {
    this.veilborneItemUseSystem.processRequest()
  }

  private updateVeilborneLootNotice(dt: number): void {
    if (this.veilborneLootNoticeRemainingSeconds <= 0) return
    this.veilborneLootNoticeRemainingSeconds = Math.max(0, this.veilborneLootNoticeRemainingSeconds - dt)
    if (this.veilborneLootNoticeRemainingSeconds <= 0) this.logic.setVariable('loot_notice', '')
  }

  private resetVeilborneLootForEditor(): void {
    this.veilborneLootSystem.resetForEditor()
    this.veilborneProgression.clearEchoCacheReference()
  }

  private awardVeilborneKillReward(instance: BehaviorPackageInstance): void {
    this.spawnVeilborneLootDrop(instance)
    const profile = typeof instance.variables.ai_profile === 'string'
      ? instance.variables.ai_profile.trim().toLowerCase()
      : 'melee'
    const automaticRewards: Record<string, { echoes: number; experience: number }> = {
      melee: { echoes: 10, experience: 15 },
      ranged_caster: { echoes: 12, experience: 18 },
      flanker: { echoes: 14, experience: 20 },
      guard_breaker: { echoes: 22, experience: 40 },
      boss_phases: { echoes: 100, experience: 150 },
    }
    const automatic = automaticRewards[profile] ?? automaticRewards.melee!
    const readReward = (name: string, fallback: number): number => {
      const value = instance.variables[name]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
      return Math.max(0, Math.floor(value))
    }
    const echoes = readReward('eco_reward', automatic.echoes)
    const rewardExperience = readReward('xp_reward', automatic.experience)
    if (echoes > 0) {
      this.logic.setVariable('ecos', Math.max(0, this.readVeilborneNumber('ecos', 0)) + echoes)
    }

    const previousLevel = Math.max(1, Math.floor(this.readVeilborneNumber('nivel', 1)))
    let level = previousLevel
    let experience = Math.max(0, this.readVeilborneNumber('experiencia', 0)) + rewardExperience
    let attributePoints = Math.max(0, Math.floor(this.readVeilborneNumber('pontos_atributo', 0)))
    const thresholdForLevel = (currentLevel: number): number =>
      Math.max(100, Math.floor(100 * Math.pow(currentLevel, 1.22)))
    let threshold = thresholdForLevel(level)
    let levelsGained = 0
    while (experience >= threshold && level < 999) {
      experience -= threshold
      level += 1
      levelsGained += 1
      attributePoints += 1
      threshold = thresholdForLevel(level)
    }
    this.logic.setVariable('nivel', level)
    this.logic.setVariable('experiencia', experience)
    this.logic.setVariable('experiencia_proximo_nivel', threshold)
    this.logic.setVariable('pontos_atributo', attributePoints)

    if (levelsGained > 0) {
      this.triggerBehaviorPackageEvent(instance.ownerObjectId, 'veilborne_rpg', 'level_up')
      this.veilborneVisualEffects.spawnEffect(
        this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
        0xe9bf75,
        1.2,
        0.7,
      )
      this.viewport.invalidate()
    }
  }

  private applyVeilborneHit(
    instance: BehaviorPackageInstance,
    amount: number,
    damageType: VeilborneDamageType,
    postureDamage: number,
    status?: { id: VeilborneStatusId; potency: number; durationSeconds: number },
  ): { damage: number; killed: boolean } {
    const target = this.getVeilborneTargetCombatant(instance)
    if (!target.alive) return { damage: 0, killed: true }
    const marked = target.statuses.some(status => status.id === 'marked')
    const adjustedAmount = marked ? amount * 1.2 : amount
    const result = applyVeilborneDamage(target, { amount: adjustedAmount, type: damageType, postureDamage })
    if (status && target.alive) {
      applyVeilborneStatus(target, {
        id: status.id,
        potency: status.potency,
        remainingSeconds: status.durationSeconds,
        stacks: 1,
      })
    }
    if (result.postureBroken && target.alive) {
      // Quebra de postura abre uma janela de vulnerabilidade e reinicia o medidor.
      target.resources.posture = 0
      applyVeilborneStatus(target, {
        id: 'stagger',
        potency: 1,
        remainingSeconds: 1.15,
        stacks: 1,
      })
    }
    this.syncVeilborneTarget(instance, target)
    const hitObject = this.world.get(instance.ownerObjectId)
    if (result.vitalityDamage > 0 && hitObject) {
      const hitPoint = this.getVeilborneWorldPoint(instance.ownerObjectId) ?? hitObject.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0))
      this.veilborneVisualEffects.spawnDamageNumber(hitPoint, result.vitalityDamage, result.killed)
      this.veilborneVisualEffects.spawnEffect(hitPoint, result.killed ? 0xffd7a0 : 0xff4358, result.killed ? 0.72 : 0.46, 0.34)
    }
    if (result.postureBroken && !result.killed) {
      this.triggerBehaviorPackageEvent(instance.ownerObjectId, 'veilborne_rpg', 'posture_broken')
    }
    if (result.killed) {
      const corpse = this.world.get(instance.ownerObjectId)
      const controller = corpse ? getAnimationControllerFromObject(corpse.mesh) : undefined
      if (controller?.playOneShot('death', true, true)) {
        corpse!.mesh.userData.veilborneDeathAnimation = true
      } else if (controller?.actions.has('prone')) {
        controller.setState('prone', true)
      } else if (corpse) {
        // Modelos sem clipe de morte continuam visivelmente derrotados e não voltam à IA.
        corpse.mesh.userData.veilborneDeathFallback = true
        corpse.mesh.traverse(node => {
          const renderable = node as THREE.Mesh
          if (!renderable.isMesh || !renderable.material) return
          const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
          for (const material of materials) {
            if ('color' in material && material.color instanceof THREE.Color) material.color.lerp(new THREE.Color(0x5b343b), 0.48)
            if ('emissive' in material && material.emissive instanceof THREE.Color) material.emissive.set(0x24080d)
          }
        })
      }
      this.logic.setPackageVariable(instance.id, 'ai_state', 'dead')
      this.notifyBehaviorPackageChanged(instance.ownerObjectId)
      this.awardVeilborneKillReward(instance)
      this.veilborneTargetStates.delete(instance.ownerObjectId)
      this.triggerBehaviorPackageEvent(instance.ownerObjectId, 'veilborne_rpg', 'enemy_killed')
    }
    return { damage: result.vitalityDamage, killed: result.killed }
  }

  private getVeilborneWorldPoint(objectId: string): THREE.Vector3 | null {
    const object = this.world.get(objectId)
    if (!object) return null
    const point = object.mesh.getWorldPosition(new THREE.Vector3())
    point.y += 0.65
    return point
  }

  private updateVeilborneHealthBars(): void {
    this.veilborneHealthBars.update(this.getVeilborneHostilePackages())
  }

  private clearVeilborneEffects(): void {
    this.veilborneVisualEffects.clear()
    this.veilborneHealthBars.clear()
  }

  private admitVeilborneManeuver(kind: 'dodge' | 'slide' | 'roll'): boolean {
    if (!this.runtimeModeActive || !this.isVeilborneEnabled()) return true
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive) return false
    const cost = kind === 'dodge' ? 22 : kind === 'roll' ? 30 : 24
    if (!spendVeilborneResource(player, 'stamina', cost)) return false
    this.syncVeilbornePlayerCombatant(player)
    return true
  }


  private onVeilborneKeyUp = (event: KeyboardEvent): void => {
    if (event.code === this.playerControlBindings.block) {
      this.veilborneBlocking = false
      if (this.logic.getVariable('bloqueando') !== undefined) this.logic.setVariable('bloqueando', false)
    }
    if (event.code === this.playerControlBindings.secondaryAction && this.veilborneHeavyChargeStartedAt !== null) {
      const startedAt = this.veilborneHeavyChargeStartedAt
      this.veilborneHeavyChargeStartedAt = null
      if (this.logic.getVariable('carregando_ataque') !== undefined) this.logic.setVariable('carregando_ataque', false)
      if (this.logic.getVariable('carga_ataque') !== undefined) this.logic.setVariable('carga_ataque', 0)
      if (this.runtimeModeActive && this.isVeilborneEnabled() && !this.avatar.isCombatStaggered()) {
        const duration = Math.max(0, performance.now() / 1000 - startedAt)
        const chargedMultiplier = 1 + Math.min(1.5, duration * 0.75)
        this.performVeilborneWeaponAttack(true, chargedMultiplier)
      }
    }
  }

  private onVeilborneBlur = (): void => {
    this.pressedMouseBindings.clear()
    this.veilborneBlocking = false
    this.veilborneHeavyChargeStartedAt = null
    if (this.logic.getVariable('carregando_ataque') !== undefined) this.logic.setVariable('carregando_ataque', false)
    if (this.logic.getVariable('carga_ataque') !== undefined) this.logic.setVariable('carga_ataque', 0)
    this.veilborneParryStartedAt = Number.NEGATIVE_INFINITY
    this.veilbornePlayerStaggerRemainingSeconds = 0
    this.avatar.setCombatStagger(0)
    this.veilborneTargetLock.clear()
    if (this.logic.getVariable('jogador_atordoado') !== undefined) this.logic.setVariable('jogador_atordoado', false)
    if (this.logic.getVariable('bloqueando') !== undefined) this.logic.setVariable('bloqueando', false)
    if (this.logic.getVariable('aparo_sucesso') !== undefined) this.logic.setVariable('aparo_sucesso', false)
  }

  private beginVeilborneParry(): void {
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive) return
    if (!spendVeilborneResource(player, 'stamina', 14)) return
    this.syncVeilbornePlayerCombatant(player)
    this.veilborneParryStartedAt = performance.now() / 1000
    this.logic.setVariable('aparo_sucesso', false)
    this.veilborneVisualEffects.spawnEffect(
      this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.05, 0)),
      0xb0d9ff,
      0.35,
      this.veilborneParryWindowSeconds,
    )
    this.viewport.invalidate()
  }

  /**
   * Entrada de dano para IA e scripts de inimigo. Resolve aparo, escudo, bloqueio e resistência
   * antes de mudar a vida do jogador. Retorna o resultado para que o atacante possa reagir.
   */
  applyVeilborneIncomingDamage(
    amount: number,
    type: VeilborneDamageType = 'physical',
    postureDamage = 0,
    attackerObjectId?: string,
  ): { damage: number; absorbedByWard: number; blocked: boolean; parried: boolean; killed: boolean } {
    if (!this.runtimeModeActive || !this.isVeilborneEnabled()) {
      return { damage: Math.max(0, Number.isFinite(amount) ? amount : 0), absorbedByWard: 0, blocked: false, parried: false, killed: false }
    }
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive) return { damage: 0, absorbedByWard: 0, blocked: false, parried: false, killed: true }

    const now = performance.now() / 1000
    const parried = isVeilborneParrySuccessful(now, this.veilborneParryStartedAt, this.veilborneParryWindowSeconds)
    if (parried) {
      // Um aparo bem-sucedido consome a janela: não pode aparar vários golpes no mesmo instante.
      this.veilborneParryStartedAt = Number.NEGATIVE_INFINITY
      player.resources.posture = Math.max(0, player.resources.posture - Math.max(18, postureDamage * 2))
      restoreVeilborneResource(player, 'stamina', 12)
      this.syncVeilbornePlayerCombatant(player)
      this.logic.setVariable('aparo_sucesso', true)
      this.logic.setVariable('aparo_total', this.readVeilborneNumber('aparo_total', 0) + 1)
      if (attackerObjectId && this.logic.listPackages(attackerObjectId).some(item => item.packageId === 'veilborne_rpg')) {
        this.triggerBehaviorPackageEvent(attackerObjectId, 'veilborne_rpg', 'parry_success')
      }
      const effectPoint = this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.05, 0))
      this.veilborneVisualEffects.spawnEffect(effectPoint, 0xe3f5ff, 1.05, 0.42)
      this.viewport.invalidate()
      return { damage: 0, absorbedByWard: 0, blocked: false, parried: true, killed: false }
    }

    let remainingDamage = Math.max(0, Number.isFinite(amount) ? amount : 0)
    const resistance = Math.max(-100, Math.min(95, player.resistances[type] ?? 0))
    remainingDamage *= 1 - resistance / 100

    const absorbedByWard = Math.min(this.veilborneWardAbsorption, remainingDamage)
    if (absorbedByWard > 0) {
      this.veilborneWardAbsorption = Math.max(0, this.veilborneWardAbsorption - absorbedByWard)
      remainingDamage -= absorbedByWard
      this.logic.setVariable('ward_absorption', this.veilborneWardAbsorption)
      this.veilborneVisualEffects.spawnEffect(this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0x9b80ff, 0.42, 0.24)
      if (this.veilborneWardAbsorption <= 0) this.clearVeilborneWard()
    }

    let blocked = false
    let actualPostureDamage = Math.max(0, postureDamage)
    if (this.veilborneBlocking && remainingDamage > 0 && spendVeilborneResource(player, 'stamina', 12)) {
      blocked = true
      remainingDamage *= 0.35
      actualPostureDamage *= 0.4
    }
    const before = player.resources.vitality
    player.resources.vitality = Math.max(0, before - remainingDamage)
    const previousPosture = player.resources.posture
    player.resources.posture = Math.min(
      player.resources.maxPosture,
      previousPosture + actualPostureDamage,
    )
    player.alive = player.resources.vitality > 0
    const playerPostureBroken = player.alive &&
      previousPosture < player.resources.maxPosture &&
      player.resources.posture >= player.resources.maxPosture
    if (playerPostureBroken) {
      player.resources.posture = 0
      this.veilborneHeavyChargeStartedAt = null
      this.logic.setVariable('carregando_ataque', false)
      this.logic.setVariable('carga_ataque', 0)
      this.veilbornePlayerStaggerRemainingSeconds = Math.max(this.veilbornePlayerStaggerRemainingSeconds, 0.85)
      this.avatar.setCombatStagger(this.veilbornePlayerStaggerRemainingSeconds)
      this.logic.setVariable('jogador_atordoado', true)
      this.veilborneVisualEffects.spawnEffect(this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0)), 0xffb26b, 0.9, 0.4)
    }
    const appliedDamage = before - player.resources.vitality
    this.syncVeilbornePlayerCombatant(player)
    if (!player.alive) {
      this.handleVeilbornePlayerDeath()
    }
    if (blocked) this.veilborneVisualEffects.spawnEffect(this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0xb0d9ff, 0.55, 0.25)
    this.viewport.invalidate()
    return { damage: appliedDamage, absorbedByWard, blocked, parried: false, killed: !player.alive }
  }

  private handleVeilborneControl(code: string): boolean {
    if (!this.cameraStateBeforeRun || !this.isVeilborneEnabled()) return false
    if (this.avatar.isCombatStaggered()) return true
    const bindings = this.playerControlBindings
    if (code === bindings.interact && (this.tryActivateVeilborneCheckpoint() || this.tryPickupVeilborneEchoCache() || this.tryPickupVeilborneLoot())) return true
    if (code === bindings.targetLock) {
      this.veilborneTargetLock.toggle()
      return true
    }
    if (code === bindings.block) {
      this.veilborneBlocking = true
      this.logic.setVariable('bloqueando', true)
      return true
    }
    if (code === bindings.parry) {
      this.beginVeilborneParry()
      return true
    }
    if (code === bindings.primaryAction) {
      this.performVeilborneWeaponAttack(false)
      return true
    }
    if (code === bindings.secondaryAction) {
      this.beginVeilborneHeavyCharge()
      return true
    }
    if (code === bindings.reload) {
      this.cycleVeilborneSigil()
      return true
    }
    if (code === bindings.useItem) {
      this.activateVeilborneSigil()
      return true
    }
    const slots = [bindings.ability1, bindings.ability2, bindings.ability3, bindings.ability4]
    const slotIndex = slots.indexOf(code)
    if (slotIndex >= 0) {
      this.beginVeilborneSpellCast(slotIndex)
      return true
    }
    return false
  }

  private beginVeilborneHeavyCharge(): void {
    if (this.veilborneHeavyChargeStartedAt !== null) return
    if ((this.veilborneCooldowns.get('attack:heavy') ?? 0) > 0) return
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive) return
    this.veilborneHeavyChargeStartedAt = performance.now() / 1000
    this.logic.setVariable('carregando_ataque', true)
    this.logic.setVariable('carga_ataque', 0)
  }

  private performVeilborneWeaponAttack(heavy: boolean, chargedMultiplier = 1): void {
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive) return
    const weaponId = this.readVeilborneString('arma_equipada', 'starter_arcane_sword')
    const weapon = VEILBORNE_RUNTIME_WEAPONS[weaponId] ?? VEILBORNE_RUNTIME_WEAPONS.starter_arcane_sword!
    const cooldownKey = heavy ? 'attack:heavy' : 'attack:quick'
    if ((this.veilborneCooldowns.get(cooldownKey) ?? 0) > 0) return
    const chargeScale = heavy ? Math.max(1, Math.min(2.5, chargedMultiplier)) : 1
    const cost = weapon.staminaCost * (heavy ? 1.65 + (chargeScale - 1) * 0.4 : 1)
    if (!spendVeilborneResource(player, 'stamina', cost)) return

    const target = this.findVeilborneTarget(weapon.range)
    const damage = calculateVeilborneWeaponDamage(weapon, player.attributes, {
      heavy,
      chargedMultiplier: chargeScale,
      critical: !!target && target.instance.variables.morto !== true &&
        this.readTargetPosture(target.instance) >= this.readTargetPostureMax(target.instance) * 0.72,
    })
    const playerController = getAnimationControllerFromObject(this.avatar.mesh)
    if (playerController) playerController.playOneShot(heavy ? 'secondary_action' : 'primary_action')
    // O ataque rápido exige 1,5 s entre acionamentos para evitar ataques em sequência.
    // Ataques pesados mantêm o tempo ajustado pela carga.
    this.veilborneCooldowns.set(cooldownKey, heavy ? 0.62 + (chargeScale - 1) * 0.12 : 1.5)
    this.syncVeilbornePlayerCombatant(player)
    const effectPosition = target
      ? this.getVeilborneWorldPoint(target.object.id) ?? target.object.mesh.position.clone()
      : this.avatar.mesh.position.clone().add(new THREE.Vector3(Math.sin(this.avatar.mesh.rotation.y), 0.9, Math.cos(this.avatar.mesh.rotation.y)).multiplyScalar(Math.min(weapon.range * 0.7, 1.8)))
    this.veilborneVisualEffects.spawnEffect(effectPosition, weapon.damageType === 'arcane' ? 0x9c77ff : 0xd3d8e8, heavy ? 0.95 : 0.7, 0.24, true)

    if (target) {
      const hit = this.applyVeilborneHit(target.instance, damage, weapon.damageType, weapon.postureDamage * (heavy ? 1.6 + (chargeScale - 1) * 0.35 : 1))
      if (hit.damage > 0) this.veilborneVisualEffects.spawnEffect(effectPosition, 0xffd09a, 0.35 + Math.min(0.5, hit.damage / 100), 0.28)
    }
    this.viewport.invalidate()
  }

  private readTargetPosture(instance: BehaviorPackageInstance): number {
    const value = instance.variables.postura
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  private readTargetPostureMax(instance: BehaviorPackageInstance): number {
    const value = instance.variables.postura_max
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 100
  }

  private beginVeilborneSpellCast(slotIndex: number): void {
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive || this.veilbornePendingCast) return
    const slotName = 'magia_' + (slotIndex + 1)
    const spellId = this.readVeilborneString(slotName, VEILBORNE_DEFAULT_SPELL_SLOTS[slotIndex] ?? 'arcane_bolt')
    const spell = VEILBORNE_RUNTIME_SPELLS[spellId] ??
      VEILBORNE_RUNTIME_SPELLS[VEILBORNE_DEFAULT_SPELL_SLOTS[slotIndex] ?? 'arcane_bolt']!
    const cooldownKey = 'spell:' + spell.id
    if ((this.veilborneCooldowns.get(cooldownKey) ?? 0) > 0) return
    if (!spendVeilborneResource(player, 'ether', spell.etherCost)) return

    const target = this.findVeilborneTarget(spell.range)
    const forward = new THREE.Vector3(Math.sin(this.avatar.mesh.rotation.y), 0, Math.cos(this.avatar.mesh.rotation.y)).normalize()
    const impactPosition = target
      ? target.object.mesh.position.clone()
      : this.avatar.mesh.position.clone().addScaledVector(forward, Math.min(spell.range * 0.45, 7))
    impactPosition.y += 0.7
    const origin = this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.05, 0))
    const projectileDuration = spell.targeting === 'projectile'
      ? Math.max(spell.castTimeSeconds, origin.distanceTo(impactPosition) / Math.max(1, spell.projectileSpeed ?? 24))
      : spell.castTimeSeconds
    this.veilbornePendingCast = {
      spellId: spell.id,
      remainingSeconds: projectileDuration,
      targetId: target?.object.id ?? null,
      impactPosition,
    }
    this.veilborneCooldowns.set(cooldownKey, spell.cooldownSeconds)
    this.syncVeilbornePlayerCombatant(player)
    if (spell.targeting === 'projectile') this.veilborneVisualEffects.spawnProjectile(origin, impactPosition, spell.visualColor, projectileDuration)
    else this.veilborneVisualEffects.spawnEffect(origin, spell.visualColor, 0.32, Math.max(0.2, spell.castTimeSeconds + 0.08))
    if (projectileDuration <= 0) this.resolveVeilborneSpellCast()
  }

  private resolveVeilborneSpellCast(): void {
    const pending = this.veilbornePendingCast
    this.veilbornePendingCast = null
    if (!pending) return
    const spell = VEILBORNE_RUNTIME_SPELLS[pending.spellId]
    if (!spell) return
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive) return

    if (spell.id === 'blink_step') {
      const origin = this.avatar.mesh.position.clone()
      const forward = new THREE.Vector3(Math.sin(this.avatar.mesh.rotation.y), 0, Math.cos(this.avatar.mesh.rotation.y)).normalize()
      const rayOrigin = origin.clone().add(new THREE.Vector3(0, 0.8, 0))
      const raycaster = new THREE.Raycaster(rayOrigin, forward, 0, spell.range)
      const roots = this.world.list().map(object => object.mesh)
      const firstHit = raycaster.intersectObjects(roots, true).find(hit => hit.distance > 0.12)
      const travel = Math.max(0, Math.min(spell.range, firstHit ? firstHit.distance - 0.75 : spell.range))
      if (travel > 0.4) {
        this.avatar.mesh.position.addScaledVector(forward, travel)
        this.avatar.resetVerticalState()
        this.veilborneVisualEffects.spawnEffect(origin.add(new THREE.Vector3(0, 0.65, 0)), spell.visualColor, 0.48, 0.38)
        this.veilborneVisualEffects.spawnEffect(this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.65, 0)), spell.visualColor, 0.62, 0.42)
      }
      this.viewport.invalidate()
      return
    }

    const target = pending.targetId
      ? this.getVeilborneHostilePackages().find(candidate => candidate.object.id === pending.targetId)
      : undefined
    const center = target
      ? target.object.mesh.position.clone()
      : pending.impactPosition.clone()
    this.veilborneVisualEffects.spawnEffect(center.clone().add(new THREE.Vector3(0, 0.55, 0)), spell.visualColor, spell.radius > 0 ? Math.max(0.45, spell.radius * 0.45) : 0.45, 0.42)
    const candidates = spell.targeting === 'area' && spell.radius > 0
      ? this.getVeilborneHostilePackages().filter(candidate =>
        Math.hypot(candidate.object.mesh.position.x - center.x, candidate.object.mesh.position.z - center.z) <= spell.radius,
      )
      : target ? [target] : []

    let totalDamage = 0
    for (const candidate of candidates) {
      const damage = calculateVeilborneSpellDamage(spell, player.attributes)
      const hit = this.applyVeilborneHit(
        candidate.instance,
        damage,
        spell.damageType,
        spell.postureDamage ?? 0,
        spell.statusEffect
          ? { id: spell.statusEffect, potency: spell.statusPotency ?? 1, durationSeconds: spell.statusDurationSeconds ?? 2 }
          : undefined,
      )
      totalDamage += hit.damage
      const point = this.getVeilborneWorldPoint(candidate.object.id)
      if (point) this.veilborneVisualEffects.spawnEffect(point, spell.visualColor, 0.34, 0.3)
    }
    if (spell.id === 'blood_siphon' && totalDamage > 0) {
      restoreVeilborneResource(player, 'vitality', totalDamage * 0.55)
      this.syncVeilbornePlayerCombatant(player)
    }
    this.viewport.invalidate()
  }


  private cycleVeilborneSigil(): void {
    if (!this.isVeilborneEnabled()) return
    this.ensureVeilbornePlayerVariables()
    const current = Math.round(this.readVeilborneNumber('sigilo_selecionado', 1))
    const next = current >= 4 || current < 1 ? 1 : current + 1
    const selected = this.readVeilborneString('sigilo_' + next, 'ward')
    this.logic.setVariable('sigilo_selecionado', next)
    this.logic.setVariable('sigilo_ativo', selected)
    this.veilborneVisualEffects.spawnEffect(this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 0x9b80ff, 0.22, 0.18)
    this.viewport.invalidate()
  }

  private activateVeilborneSigil(): void {
    const player = this.getVeilbornePlayerCombatant()
    if (!player.alive) return
    const sigilId = this.readVeilborneString('sigilo_ativo', 'ward')
    const sigil = VEILBORNE_RUNTIME_SIGILS[sigilId] ?? VEILBORNE_RUNTIME_SIGILS.ward!
    const cooldownKey = 'sigil:' + sigil.id
    if ((this.veilborneCooldowns.get(cooldownKey) ?? 0) > 0) return

    const target = sigil.effect === 'mark' ? this.findVeilborneTarget(sigil.radius) : null
    if (sigil.effect === 'mark' && !target) return
    if (!spendVeilborneResource(player, 'ether', sigil.etherCost)) return

    this.veilborneCooldowns.set(cooldownKey, sigil.cooldownSeconds)
    this.syncVeilbornePlayerCombatant(player)

    if (sigil.effect === 'ward') {
      this.clearVeilborneWard()
      this.veilborneWardRemainingSeconds = sigil.durationSeconds
      this.veilborneWardAbsorption = 35
      this.logic.setVariable('ward_remaining', sigil.durationSeconds)
      this.logic.setVariable('ward_absorption', this.veilborneWardAbsorption)
      this.veilborneWardMesh = createVeilborneWardMesh(this.avatar.mesh.position, sigil.visualColor)
      this.world.scene.add(this.veilborneWardMesh)
      this.viewport.invalidate()
      return
    }

    if (sigil.effect === 'mark' && target) {
      const state = this.getVeilborneTargetCombatant(target.instance)
      applyVeilborneStatus(state, {
        id: 'marked',
        potency: sigil.statusPotency ?? 1.2,
        remainingSeconds: sigil.durationSeconds,
        stacks: 1,
      })
      this.syncVeilborneTarget(target.instance, state)
      const point = this.getVeilborneWorldPoint(target.object.id)
      if (point) this.veilborneVisualEffects.spawnEffect(point, sigil.visualColor, 0.75, 0.52)
      this.viewport.invalidate()
      return
    }

    const forward = new THREE.Vector3(Math.sin(this.avatar.mesh.rotation.y), 0, Math.cos(this.avatar.mesh.rotation.y)).normalize()
    const position = this.avatar.mesh.position.clone().addScaledVector(forward, 2.15)
    const groundY = this.world.terrain.heightAt(position.x, position.z)
    position.y = (Number.isFinite(groundY) ? groundY : this.avatar.mesh.position.y) + 0.06
    const visual = this.createVeilborneSigilVisual(sigil, position)
    const instanceId = 'veilborne-sigil-' + (++this.veilborneSigilSequence).toString(36)
    this.activeVeilborneSigils.set(instanceId, {
      profileId: sigil.id,
      position: position.clone(),
      visual,
      remainingSeconds: sigil.durationSeconds,
      triggeredObjectIds: new Set<string>(),
    })
    this.world.scene.add(visual)
    this.viewport.invalidate()
  }

  private createVeilborneSigilVisual(sigil: VeilborneRuntimeSigil, position: THREE.Vector3): THREE.Group {
    return createVeilborneSigilVisual(sigil, position)
  }

  private updateActiveVeilborneSigils(dt: number): void {
    for (const [instanceId, active] of this.activeVeilborneSigils) {
      const sigil = VEILBORNE_RUNTIME_SIGILS[active.profileId]
      if (!sigil) {
        this.removeActiveVeilborneSigil(instanceId, active.visual)
        continue
      }
      active.remainingSeconds -= dt
      const pulse = 0.2 + 0.11 * (0.5 + 0.5 * Math.sin((sigil.durationSeconds - active.remainingSeconds) * 5))
      active.visual.traverse(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) child.material.opacity = pulse
        else if (child instanceof THREE.LineLoop && child.material instanceof THREE.LineBasicMaterial) child.material.opacity = Math.min(1, pulse + 0.4)
      })

      const inside = this.getVeilborneHostilePackages().filter(candidate =>
        Math.hypot(candidate.object.mesh.position.x - active.position.x, candidate.object.mesh.position.z - active.position.z) <= sigil.radius,
      )
      const entrants = inside.filter(candidate => !active.triggeredObjectIds.has(candidate.object.id))
      for (const candidate of entrants) active.triggeredObjectIds.add(candidate.object.id)

      if (entrants.length > 0 && sigil.trigger === 'enemy_enter') {
        if (sigil.effect === 'blast') {
          this.veilborneVisualEffects.spawnEffect(active.position.clone().add(new THREE.Vector3(0, 0.6, 0)), sigil.visualColor, Math.max(0.7, sigil.radius * 0.8), 0.5)
          for (const candidate of inside) {
            this.applyVeilborneHit(
              candidate.instance,
              sigil.damage ?? 42,
              sigil.damageType ?? 'arcane',
              sigil.postureDamage ?? 28,
            )
            const point = this.getVeilborneWorldPoint(candidate.object.id)
            if (point) this.veilborneVisualEffects.spawnEffect(point, sigil.visualColor, 0.35, 0.3)
          }
          this.removeActiveVeilborneSigil(instanceId, active.visual)
          continue
        }
        if (sigil.effect === 'slow' || sigil.effect === 'silence') {
          for (const candidate of entrants) {
            const target = this.getVeilborneTargetCombatant(candidate.instance)
            applyVeilborneStatus(target, {
              id: sigil.effect === 'slow' ? 'slow' : 'silence',
              potency: sigil.statusPotency ?? 1,
              remainingSeconds: Math.min(3, sigil.durationSeconds),
              stacks: 1,
            })
            this.syncVeilborneTarget(candidate.instance, target)
            const point = this.getVeilborneWorldPoint(candidate.object.id)
            if (point) this.veilborneVisualEffects.spawnEffect(point, sigil.visualColor, 0.28, 0.25)
          }
        }
      }

      if (active.remainingSeconds <= 0) this.removeActiveVeilborneSigil(instanceId, active.visual)
    }
  }

  private removeActiveVeilborneSigil(instanceId: string, visual: THREE.Group): void {
    this.activeVeilborneSigils.delete(instanceId)
    this.world.scene.remove(visual)
    disposeVeilborneVisual(visual)
  }

  private clearActiveVeilborneSigils(): void {
    for (const [id, active] of this.activeVeilborneSigils) this.removeActiveVeilborneSigil(id, active.visual)
    this.activeVeilborneSigils.clear()
  }

  private updateVeilborneWard(dt: number): void {
    if (!this.veilborneWardMesh) return
    this.veilborneWardRemainingSeconds = Math.max(0, this.veilborneWardRemainingSeconds - dt)
    this.logic.setVariable('ward_remaining', this.veilborneWardRemainingSeconds)
    this.veilborneWardMesh.position.copy(this.avatar.mesh.position).add(new THREE.Vector3(0, 0.9, 0))
    const material = this.veilborneWardMesh.material
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(this.veilborneWardRemainingSeconds * 4))
    }
    if (this.veilborneWardRemainingSeconds <= 0) this.clearVeilborneWard()
  }

  private clearVeilborneWard(): void {
    if (this.veilborneWardMesh) {
      this.world.scene.remove(this.veilborneWardMesh)
      this.veilborneWardMesh.geometry.dispose()
      const material = this.veilborneWardMesh.material
      if (Array.isArray(material)) material.forEach(item => item.dispose())
      else material.dispose()
      this.veilborneWardMesh = null
    }
    this.veilborneWardRemainingSeconds = 0
    this.veilborneWardAbsorption = 0
    if (this.logic.getVariable('ward_remaining') !== undefined) this.logic.setVariable('ward_remaining', 0)
    if (this.logic.getVariable('ward_absorption') !== undefined) this.logic.setVariable('ward_absorption', 0)
  }



  private setVeilborneAIState(instance: BehaviorPackageInstance, nextState: string): void {
    const previous = typeof instance.variables.ai_state === 'string' ? instance.variables.ai_state : 'idle'
    if (previous === nextState) return
    this.logic.setPackageVariable(instance.id, 'ai_state', nextState)
    this.notifyBehaviorPackageChanged(instance.ownerObjectId)
    if ((nextState === 'pursue' || nextState === 'attack' || nextState === 'recover') && previous === 'idle') {
      this.triggerBehaviorPackageEvent(instance.ownerObjectId, 'veilborne_rpg', 'enemy_spotted')
    } else if (nextState === 'idle' && (previous === 'pursue' || previous === 'attack' || previous === 'recover')) {
      this.triggerBehaviorPackageEvent(instance.ownerObjectId, 'veilborne_rpg', 'enemy_lost_target')
    }
  }

  /**
   * IA inicial para alvos VEILBORNE. A movimentação acontece no plano XZ e a resolução
   * de colisões do mundo corrige o contato no frame seguinte; navegação por caminho ainda
   * não faz parte desta primeira versão.
   */
  private updateVeilborneEnemyAI(dt: number, player: VeilborneCombatant): void {
    const playerPosition = this.avatar.mesh.position
    const step = Math.max(0, Math.min(dt, 0.1))
    if (!player.alive) {
      for (const { instance, object } of this.getVeilborneHostilePackages()) {
        this.setVeilborneAIState(instance, 'idle')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState('idle')
      }
      return
    }
    const profileDefaults: Record<string, {
      attackRange: number
      moveSpeed: number
      damage: number
      cooldown: number
      damageType: VeilborneDamageType
      postureDamage: number
      ranged: boolean
    }> = {
      melee: { attackRange: 2, moveSpeed: 2.8, damage: 12, cooldown: 1.4, damageType: 'physical', postureDamage: 8, ranged: false },
      ranged_caster: { attackRange: 9, moveSpeed: 2.3, damage: 18, cooldown: 1.8, damageType: 'arcane', postureDamage: 6, ranged: true },
      flanker: { attackRange: 1.8, moveSpeed: 4, damage: 10, cooldown: 1.05, damageType: 'physical', postureDamage: 7, ranged: false },
      guard_breaker: { attackRange: 2.7, moveSpeed: 1.7, damage: 24, cooldown: 2, damageType: 'physical', postureDamage: 20, ranged: false },
      boss_phases: { attackRange: 3.2, moveSpeed: 2.3, damage: 28, cooldown: 1.7, damageType: 'shadow', postureDamage: 24, ranged: false },
    }

    for (const { instance, object } of this.getVeilborneHostilePackages()) {
      if (!player.alive) break
      const previousState = typeof instance.variables.ai_state === 'string' ? instance.variables.ai_state : 'idle'
      if (instance.variables.ai_enabled === false) {
        this.setVeilborneAIState(instance, 'idle')
        continue
      }
      if (!player.alive) {
        this.setVeilborneAIState(instance, 'idle')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller && (controller.currentState === 'walk' || controller.currentState === 'run')) controller.setState('idle')
        continue
      }

      const profileName = typeof instance.variables.ai_profile === 'string'
        ? instance.variables.ai_profile.trim().toLowerCase()
        : 'melee'
      const profile = profileDefaults[profileName] ?? profileDefaults.melee!
      const customStats = instance.variables.ai_custom_stats === true
      const number = (name: string, fallback: number): number => {
        const value = instance.variables[name]
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback
      }
      const attackRange = Math.max(0.5, customStats ? number('attack_range', profile.attackRange) : profile.attackRange)
      const moveSpeed = Math.max(0, customStats ? number('move_speed', profile.moveSpeed) : profile.moveSpeed)
      let attackDamage = Math.max(0, customStats ? number('attack_damage', profile.damage) : profile.damage)
      const attackCooldown = Math.max(0.2, customStats ? number('attack_cooldown', profile.cooldown) : profile.cooldown)
      const postureDamage = Math.max(0, customStats ? number('attack_posture_damage', profile.postureDamage) : profile.postureDamage)
      const attackTypeValue = customStats && typeof instance.variables.attack_damage_type === 'string'
        ? instance.variables.attack_damage_type
        : profile.damageType
      const damageTypes = new Set<VeilborneDamageType>(['physical', 'fire', 'frost', 'storm', 'blood', 'shadow', 'spirit', 'arcane'])
      const attackType: VeilborneDamageType = damageTypes.has(attackTypeValue as VeilborneDamageType)
        ? attackTypeValue as VeilborneDamageType
        : profile.damageType
      const perceptionRange = Math.max(1, number('perception_range', 18))
      const dx = playerPosition.x - object.mesh.position.x
      const dz = playerPosition.z - object.mesh.position.z
      const distance = Math.hypot(dx, dz)
      if (distance > perceptionRange || distance < 0.001) {
        this.setVeilborneAIState(instance, 'idle')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller && (controller.currentState === 'walk' || controller.currentState === 'run')) controller.setState('idle')
        continue
      }

      if (profileName === 'boss_phases') {
        const target = this.getVeilborneTargetCombatant(instance)
        const ratio = target.resources.vitality / Math.max(1, target.resources.maxVitality)
        const phase = ratio <= 0.25 ? 3 : ratio <= 0.6 ? 2 : 1
        if (instance.variables.boss_phase !== phase) this.logic.setPackageVariable(instance.id, 'boss_phase', phase)
        if (phase === 2) attackDamage *= 1.2
        if (phase === 3) attackDamage *= 1.45
      }

      const directionX = dx / distance
      const directionZ = dz / distance
      const targetYaw = Math.atan2(directionX, directionZ)
      const rotationYDegrees = targetYaw * 180 / Math.PI
      const movingToward = distance > attackRange * 0.94
      const movingAway = profile.ranged && distance < attackRange * 0.62
      let nextX = object.mesh.position.x
      let nextZ = object.mesh.position.z
      let moving = false

      const targetState = this.getVeilborneTargetCombatant(instance)
      const staggerStatus = targetState.statuses.find(status => status.id === 'stagger')
      if (staggerStatus) {
        this.setVeilborneAIState(instance, 'staggered')
        const staggerController = getAnimationControllerFromObject(object.mesh)
        if (staggerController) staggerController.setState('idle')
        continue
      }
      const slowStatus = targetState.statuses.find(status => status.id === 'slow')
      const slowMultiplier = slowStatus ? Math.max(0.2, 1 - slowStatus.potency) : 1
      if ((movingToward || movingAway) && moveSpeed > 0) {
        const stepDistance = Math.min(moveSpeed * slowMultiplier * step, Math.max(0, Math.abs(distance - attackRange * (movingAway ? 0.72 : 0.94))))
        nextX += directionX * stepDistance * (movingAway ? -1 : 1)
        nextZ += directionZ * stepDistance * (movingAway ? -1 : 1)
        nextX = Math.max(-49, Math.min(49, nextX))
        nextZ = Math.max(-49, Math.min(49, nextZ))
        moving = stepDistance > 1e-5
      }
      const currentRotation = object.mesh.rotation.y
      if (moving || Math.abs(currentRotation - targetYaw) > 0.01) {
        const bounds = new THREE.Box3().setFromObject(object.mesh)
        const bottomOffset = object.mesh.position.y - bounds.min.y
        const groundY = this.world.terrain.heightAt(nextX, nextZ)
        const nextY = groundY + bottomOffset
        this.world.update(object.id, {
          x: nextX,
          y: nextY,
          z: nextZ,
          rotationY: rotationYDegrees,
        })
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState(moving ? 'run' : 'idle')
      }

      if (distance <= attackRange) {
        const state = (this.veilborneCooldowns.get('ai-attack:' + instance.ownerObjectId) ?? 0) > 0
          ? 'recover'
          : 'attack'
        this.setVeilborneAIState(instance, state)
        if (state === 'attack') {
          const silenced = targetState.statuses.some(status => status.id === 'silence')
          if (!(profile.ranged && silenced)) {
            this.veilborneCooldowns.set('ai-attack:' + instance.ownerObjectId, attackCooldown)
            const attackController = getAnimationControllerFromObject(object.mesh)
            if (attackController) attackController.playOneShot(profile.ranged ? 'ability_1' : 'primary_action')
            this.triggerBehaviorPackageEvent(instance.ownerObjectId, 'veilborne_rpg', 'enemy_attack')
            const result = this.applyVeilborneIncomingDamage(attackDamage, attackType, postureDamage, instance.ownerObjectId)
            const colorByType: Record<VeilborneDamageType, number> = {
              physical: 0xd3d8e8, fire: 0xff713b, frost: 0x79ddff, storm: 0xffe77a,
              blood: 0xd82e55, shadow: 0x8b6ee8, spirit: 0x8bf7d1, arcane: 0x8c7cff,
            }
            const source = object.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0))
            this.veilborneVisualEffects.spawnEffect(source, colorByType[attackType], 0.35, 0.28)
            if (result.damage > 0 || result.absorbedByWard > 0) {
              this.veilborneVisualEffects.spawnEffect(
                this.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.85, 0)),
                colorByType[attackType],
                result.blocked ? 0.38 : 0.52,
                0.3,
              )
            }
            if (result.parried) {
              const weaponId = this.readVeilborneString('arma_equipada', 'starter_arcane_sword')
              const weapon = VEILBORNE_RUNTIME_WEAPONS[weaponId] ?? VEILBORNE_RUNTIME_WEAPONS.starter_arcane_sword!
              const counterDamage = Math.round(calculateVeilborneWeaponDamage(weapon, player.attributes) * 0.8)
              this.applyVeilborneHit(instance, counterDamage, weapon.damageType, weapon.postureDamage * 1.5)
              this.veilborneVisualEffects.spawnEffect(
                this.getVeilborneWorldPoint(object.id) ?? object.mesh.position.clone(),
                0xe3f5ff,
                0.8,
                0.34,
              )
            }
          } else {
            this.veilborneCooldowns.set('ai-attack:' + instance.ownerObjectId, Math.min(0.4, attackCooldown))
            this.setVeilborneAIState(instance, 'recover')
          }
        }
      } else {
        this.setVeilborneAIState(instance, 'pursue')
      }

      if (moving && movingToward && previousState === 'idle') {
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState('run')
      }
    }
  }

  private updateVeilborneRuntime(dt: number): void {
    this.veilborneVisualEffects.update(dt)
    for (const [key, remaining] of this.veilborneCooldowns) {
      const next = Math.max(0, remaining - Math.max(0, dt))
      if (next <= 0) this.veilborneCooldowns.delete(key)
      else this.veilborneCooldowns.set(key, next)
    }

    if (!this.runtimeModeActive || !this.isVeilborneEnabled()) return
    this.ensureVeilbornePlayerVariables()
    this.updateVeilborneHealthBars()
    const step = Math.max(0, Math.min(dt, 0.1))
    if (this.veilbornePlayerStaggerRemainingSeconds > 0) {
      this.veilbornePlayerStaggerRemainingSeconds = Math.max(0, this.veilbornePlayerStaggerRemainingSeconds - Math.min(step, 0.05))
      if (this.veilbornePlayerStaggerRemainingSeconds <= 0) {
        this.avatar.setCombatStagger(0)
        this.logic.setVariable('jogador_atordoado', false)
      }
    }
    this.updateActiveVeilborneSigils(step)
    this.updateVeilborneWard(step)
    this.processVeilborneItemUseRequest()
    this.updateVeilborneLootNotice(step)
    if (this.veilbornePendingCast) {
      this.veilbornePendingCast.remainingSeconds -= step
      if (this.veilbornePendingCast.remainingSeconds <= 0) this.resolveVeilborneSpellCast()
    }

    const player = this.getVeilbornePlayerCombatant()
    this.updateVeilborneRespawn(step, player)
    this.veilborneTargetLock.update(player.alive)
    if (this.veilborneHeavyChargeStartedAt !== null) {
      const charge = Math.min(1, Math.max(0, (performance.now() / 1000 - this.veilborneHeavyChargeStartedAt) / 2))
      this.logic.setVariable('carga_ataque', charge)
    }
    if (player.alive) {
      restoreVeilborneResource(player, 'stamina', 16 * step)
      restoreVeilborneResource(player, 'ether', 1.6 * step)
      player.resources.posture = Math.max(0, player.resources.posture - 8 * step)
      this.syncVeilbornePlayerCombatant(player)
    }

    this.updateVeilborneEnemyAI(step, player)
    const activeIds = new Set<string>()
    for (const { instance } of this.getVeilborneHostilePackages()) {
      activeIds.add(instance.ownerObjectId)
      const target = this.getVeilborneTargetCombatant(instance)
      if (!target.alive) continue
      const statusesBeforeTick = target.statuses.map(status => ({ ...status }))
      for (const status of statusesBeforeTick) {
        if (status.id !== 'burn' && status.id !== 'bleed' && status.id !== 'poison') continue
        const key = instance.ownerObjectId + ':' + status.id
        let timer = (this.veilborneStatusTickTimers.get(key) ?? 0) + step
        while (timer >= 1 && target.alive) {
          const type: VeilborneDamageType = status.id === 'burn' ? 'fire' : status.id === 'bleed' ? 'blood' : 'shadow'
          applyVeilborneDamage(target, { amount: status.potency * Math.max(1, status.stacks), type })
          timer -= 1
        }
        this.veilborneStatusTickTimers.set(key, timer)
      }
      const statusIds = new Set(statusesBeforeTick.map(status => status.id))
      tickVeilborneStatuses(target, step)
      for (const statusId of statusIds) {
        if (!target.statuses.some(status => status.id === statusId)) this.veilborneStatusTickTimers.delete(instance.ownerObjectId + ':' + statusId)
      }
      const wasAlive = instance.variables.morto !== true && (typeof instance.variables.vida !== 'number' || instance.variables.vida > 0)
      this.syncVeilborneTarget(instance, target, false)
      if (wasAlive && !target.alive) {
        this.logic.setPackageVariable(instance.id, 'ai_state', 'dead')
        this.awardVeilborneKillReward(instance)
        this.triggerBehaviorPackageEvent(instance.ownerObjectId, 'veilborne_rpg', 'enemy_killed')
      }
    }
    for (const id of this.veilborneTargetStates.keys()) {
      if (!activeIds.has(id)) this.veilborneTargetStates.delete(id)
    }
    this.viewport.invalidate()
  }

  /** Executa pacotes autônomos para qualquer objeto, independentemente do pacote VEILBORNE. */
  private updateAutonomousBehaviors(dt: number): void {
    if (!this.runtimeModeActive && !this.autonomousBehaviorSystem.hasRuntimeState()) return

    const transitions = this.autonomousBehaviorSystem.update({
      dt,
      runtimeEnabled: this.runtimeModeActive,
      world: this.world,
      packages: this.logic.listPackages(),
      playerPosition: this.avatar.mesh.position,
      canMoveTo: (objectId, target) => this.collisions.canMoveObjectTo(objectId, target),
    })

    for (const transition of transitions) {
      this.logic.setPackageVariable(transition.instanceId, 'state', transition.state)
      const object = this.world.get(transition.ownerObjectId)
      const controller = object ? getAnimationControllerFromObject(object.mesh) : undefined
      if (controller) {
        if (isAutonomousMovingState(transition.state)) {
          controller.setState(transition.state === 'fleeing' ? 'run' : 'walk')
        } else if (controller.currentState === 'walk' || controller.currentState === 'run') {
          controller.setState('idle')
        }
      }

      if (transition.events.length) {
        for (const eventId of transition.events) {
          this.triggerBehaviorPackageEvent(transition.ownerObjectId, 'autonomous_agent', eventId)
        }
      } else {
        this.notifyBehaviorPackageChanged(transition.ownerObjectId)
      }
    }
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
      if (this.isVeilborneEnabled()) {
        this.ensureVeilbornePlayerVariables()
        this.veilborneDefaultSpawnPosition = this.avatar.mesh.position.clone()
        this.veilbornePlayerRespawnRemainingSeconds = 0
        if (this.readVeilborneNumber('ecos_perdidos', 0) > 0 && !this.veilborneProgression.echoCacheObjectId) {
          const cachePosition = new THREE.Vector3(
            this.readVeilborneNumber('ponto_de_morte_x', this.avatar.mesh.position.x),
            this.readVeilborneNumber('ponto_de_morte_y', this.avatar.mesh.position.y),
            this.readVeilborneNumber('ponto_de_morte_z', this.avatar.mesh.position.z),
          )
          this.veilborneProgression.spawnEchoCache(this.readVeilborneNumber('ecos_perdidos', 0), cachePosition)
        }
      }
      this.input.setRuntimeMode(true)
      this.transformControls.detach()
      this.transformControls.enabled = false
      this.viewport.invalidate()
      return
    }

    this.runtimeModeActive = false
    for (const code of this.pressedMouseBindings.values()) this.dispatchMouseBinding(code, 'keyup')
    this.pressedMouseBindings.clear()
    this.veilbornePlayerRespawnRemainingSeconds = 0
    this.veilborneDefaultSpawnPosition = null
    this.veilbornePendingCast = null
    this.resetVeilborneLootForEditor()
    this.veilborneCooldowns.clear()
    this.veilborneTargetStates.clear()
    this.veilborneStatusTickTimers.clear()
    this.veilborneBlocking = false
    this.veilborneHeavyChargeStartedAt = null
    if (this.logic.getVariable('carregando_ataque') !== undefined) this.logic.setVariable('carregando_ataque', false)
    if (this.logic.getVariable('carga_ataque') !== undefined) this.logic.setVariable('carga_ataque', 0)
    this.veilborneParryStartedAt = Number.NEGATIVE_INFINITY
    if (this.logic.getVariable('bloqueando') !== undefined) this.logic.setVariable('bloqueando', false)
    if (this.logic.getVariable('aparo_sucesso') !== undefined) this.logic.setVariable('aparo_sucesso', false)
    // A falha ao liberar um efeito visual não pode impedir o retorno ao editor.
    try { this.clearVeilborneEffects() } catch (error) { console.warn('Falha ao limpar efeitos VEILBORNE:', error) }
    try { this.clearActiveVeilborneSigils() } catch (error) { console.warn('Falha ao limpar sigilos VEILBORNE:', error) }
    try { this.clearVeilborneWard() } catch (error) { console.warn('Falha ao limpar proteção VEILBORNE:', error) }
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
    const codes: Record<number, string> = {
      0: 'MouseLeft',
      1: 'MouseMiddle',
      2: 'MouseRight',
      3: 'MouseBack',
      4: 'MouseForward',
    }
    return codes[button] ?? null
  }

  private dispatchMouseBinding(code: string, type: 'keydown' | 'keyup'): void {
    // Usa a mesma rota do teclado para movimento, animações, combate e Visual Script.
    window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }))
  }

  private isInteractiveRuntimeTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(
      'button, input, select, textarea, a, [role="dialog"], .veilborne-loadout-panel, .veilborne-loadout-trigger, .hud-settings-panel, .hud-custom-image, [data-no-game-attack]',
    )
  }

  private onRuntimePointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType !== 'mouse' ||
      !this.cameraStateBeforeRun ||
      !this.runtimeModeActive
    ) return

    const code = this.mouseButtonBindingCode(event.button)
    if (!code || this.isInteractiveRuntimeTarget(event.target)) return

    const isMappedControl = Object.values(this.playerControlBindings).some(binding => binding === code)
    const primaryActionUsesMouse = /^Mouse(?:Left|Right|Middle|Back|Forward)$/.test(this.playerControlBindings.primaryAction)
    // Em VEILBORNE, o clique esquerdo continua sendo o ataque padrão quando o
    // projeto ainda usa uma tecla para primaryAction. Convertemos o clique nessa
    // tecla em vez de chamar o ataque diretamente: assim animação, combate e
    // eventos do Visual Script percorrem o mesmo caminho do teclado.
    const isLegacyPrimaryClick = event.button === 0 &&
      this.isVeilborneEnabled() &&
      !primaryActionUsesMouse

    const dispatchedCode = isMappedControl
      ? code
      : isLegacyPrimaryClick
        ? this.playerControlBindings.primaryAction
        : null

    if (!dispatchedCode) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (this.pressedMouseBindings.has(code)) return
    this.pressedMouseBindings.set(code, dispatchedCode)
    this.dispatchMouseBinding(dispatchedCode, 'keydown')
  }

  private onRuntimePointerUp = (event: PointerEvent): void => {
    if (!this.cameraStateBeforeRun || !this.runtimeModeActive) return
    const mouseCode = this.mouseButtonBindingCode(event.button)
    if (!mouseCode) return
    const dispatchedCode = this.pressedMouseBindings.get(mouseCode)
    if (!dispatchedCode) return

    event.preventDefault()
    event.stopImmediatePropagation()
    this.pressedMouseBindings.delete(mouseCode)
    this.dispatchMouseBinding(dispatchedCode, 'keyup')
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
      this.playerControlBindings.block,
      this.playerControlBindings.parry,
      this.playerControlBindings.targetLock,
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

    // VEILBORNE reutiliza o mesmo mapa de controles do jogador e mantém os gatilhos
    // do Visual Script funcionando depois de processar ataques ou conjurações.
    this.handleVeilborneControl(event.code)

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
      // Instala no objeto recém-criado os pacotes escolhidos durante a importação.
      // Filtra IDs contra o catálogo do motor para não interromper a construção
      // se um componente salvo tiver metadados antigos ou inválidos.
      const rawPackageIds = pending.model.userData.importBehaviorPackageIds
      if (Array.isArray(rawPackageIds)) {
        const packageIds = new Set(rawPackageIds.filter((id): id is string =>
          typeof id === 'string' && !!getBehaviorPackageDefinition(id),
        ))
        const rawPackageSettings = pending.model.userData.importBehaviorPackageSettings
        const packageSettings = rawPackageSettings && typeof rawPackageSettings === 'object' && !Array.isArray(rawPackageSettings)
          ? rawPackageSettings as Record<string, { variables?: Record<string, unknown>; config?: Record<string, unknown> }>
          : {}
        for (const packageId of packageIds) {
          const installed = this.installBehaviorPackage(created.id, packageId)
          const definition = getBehaviorPackageDefinition(packageId)
          const savedSettings = packageSettings[packageId]
          if (!definition || !savedSettings) continue

          const variables: Record<string, PackageScalar> = {}
          for (const variable of definition.variables) {
            const value = savedSettings.variables?.[variable.name]
            if (variable.type === 'boolean' && typeof value === 'boolean') {
              variables[variable.name] = value
            } else if (variable.type === 'string' && typeof value === 'string') {
              variables[variable.name] = value.slice(0, 512)
            } else if (variable.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
              variables[variable.name] = Math.max(
                variable.min ?? Number.NEGATIVE_INFINITY,
                Math.min(variable.max ?? Number.POSITIVE_INFINITY, value),
              )
            }
          }

          const config: Record<string, PackageJsonValue> = {}
          for (const key of Object.keys(definition.defaultConfig)) {
            const value = savedSettings.config?.[key]
            if (isPackageJsonValue(value)) config[key] = value
          }
          if (Object.keys(variables).length || Object.keys(config).length) {
            this.updateBehaviorPackage(installed.id, { variables, config })
          }
        }
      }
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
    const MAX_IMPORTED_TRIANGLES = 5_000_000
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

    // Os clipes são mapeados pela mesma regra central usada pelo avatar.
    // Só o controlador decide pesos, sincronização de ciclo e fim de ações pontuais.
    const animationClips = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    const explicitRoles = model.userData.importAnimationRoles as Record<string, AnimationRole> | undefined
    let animationMixer: THREE.AnimationMixer | undefined
    let animationController: AnimationController | undefined
    let animationFallbackAction: THREE.AnimationAction | undefined
    let animationActions: Partial<Record<AnimationRole, THREE.AnimationAction>> = {}
    if (animationClips.length > 0) {
      animationMixer = new THREE.AnimationMixer(model)
      const actionMap = createAnimationActionMap(animationMixer, animationClips, explicitRoles, {
        genericFallback: !explicitRoles,
      })
      const startingRole = [
        'idle', 'walk', 'run',
        'walk_diagonal_left', 'walk_diagonal_right',
        'walk_left', 'walk_right',
        'walk_backward', 'run_backward',
        'walk_backward_diagonal_left', 'walk_backward_diagonal_right',
        'run_diagonal_left', 'run_diagonal_right',
        'run_left', 'run_right',
        'run_backward_diagonal_left', 'run_backward_diagonal_right',
        '__fallback__',
      ].find(role => actionMap.has(role))
      animationController = new AnimationController(animationMixer, actionMap, {
        genericFallback: actionMap.has('__fallback__'),
      })
      if (startingRole) animationController.setState(startingRole)
      animationActions = Object.fromEntries(actionMap) as Partial<Record<AnimationRole, THREE.AnimationAction>>
      animationFallbackAction = actionMap.get('__fallback__')
      console.info('[Engine] Animações do componente:', {
        name,
        initialClip: startingRole ? actionMap.get(startingRole)?.getClip().name : '(sem estado contínuo mapeado)',
        availableClips: animationClips.map((clip) => clip.name),
        mappedRoles: explicitRoles ?? 'automático por nome',
      })
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
    if (animationMixer && animationController) {
      root.userData.importAnimationMixer = animationMixer
      root.userData.importAnimationActions = animationActions
      root.userData.importAnimationFallbackAction = animationFallbackAction
      root.userData.importAnimationController = animationController
      root.userData.importAnimationState = animationController.currentState
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

    const id = `model_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
    root.userData.id = id
    root.userData.locked = false
    root.userData.groupId = null
    root.userData.wireframeVisible = false
    root.userData.mass = 1
    // O colisor é configurado no importador e fica independente da malha visual.
    root.userData.colliderType = model.userData.importColliderType === 'box' || model.userData.importColliderType === 'sphere' || model.userData.importColliderType === 'capsule' || model.userData.importColliderType === 'mesh' || model.userData.importColliderType === 'none'
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
    root.userData.sourceUrl = typeof model.userData.sourceUrl === 'string' ? model.userData.sourceUrl : restoreData?.sourceUrl
    if (restoreData) {
      root.userData.locked = restoreData.locked ?? false
      root.userData.groupId = restoreData.groupId ?? null
      root.userData.wireframeVisible = restoreData.wireframeVisible ?? false
      root.userData.mass = restoreData.mass ?? 1
      if (restoreData.colliderType) root.userData.colliderType = restoreData.colliderType
      if (restoreData.colliderSize) root.userData.colliderSize = [...restoreData.colliderSize]
      if (restoreData.colliderOffset) root.userData.colliderOffset = [...restoreData.colliderOffset]
    }
    // Projetos salvos antes de existir "Malha estática" guardavam cidades como
    // caixas sólidas. Corrige esses cenários ao abrir o mundo para que ruas,
    // rampas e vãos usem a geometria real sem exigir reimportação manual.
    if ((isStaticCityLike || model.userData.importColliderType === 'mesh') && root.userData.colliderType === 'box') {
      root.userData.colliderType = 'mesh'
      root.userData.colliderOffset = [0, 0, 0]
      console.info('[Engine] Colisor de cenário atualizado automaticamente para malha estática:', root.name)
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
        const playerHeight = clamp(scene.playerModel.height ?? 1.8, 0.1, 10000)
        await this.avatar.setCustomModel(playerBytes, scene.playerModel.animationRoles, playerHeight)
        this.playerModelData = {
          name: scene.playerModel.name,
          glbData: scene.playerModel.glbData,
          height: playerHeight,
          ...(scene.playerModel.sourceUrl ? { sourceUrl: scene.playerModel.sourceUrl } : {}),
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
    window.removeEventListener('pointerdown', this.onRuntimePointerDown, true)
    window.removeEventListener('pointerup', this.onRuntimePointerUp, true)
    window.removeEventListener('keydown', this.onRuleKeyDown)
    window.removeEventListener('keyup', this.onVeilborneKeyUp)
    window.removeEventListener('blur', this.onVeilborneBlur)
    this.clearVeilborneEffects()
    this.clearActiveVeilborneSigils()
    this.clearVeilborneWard()
    this.veilborneTargetLock.clear()
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
