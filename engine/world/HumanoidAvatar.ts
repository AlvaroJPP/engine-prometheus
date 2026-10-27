import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { World } from './World'
import { AnimationController, createAnimationActionMap } from './AnimationController'
import {
  getStaticMeshCollisionData,
  raycastStaticMesh,
  visitStaticMeshTriangles,
} from './StaticMeshCollider'
import { DEFAULT_MODEL_CONTROL_BINDINGS } from '../script/packages'
import type { MountPackageSettings, AnimationRole, MountMovementState, ModelControlBindings } from '../script/packages'
import { DEFAULT_CONTROL_MAPS } from '../input/ControlMaps'
import type { ControlMapBindings } from '../input/ControlMaps'
import {
  PLAYER_ID,
  WALK_SPEED,
  RUN_MULTIPLIER,
  JUMP_SPEED,
  GRAVITY,
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  WALKABLE_SURFACE_NORMAL_Y,
  MAX_WALK_STEP_UP,
  STEP_UP_SPEED,
  MAX_WALK_OFF_DROP,
  LEDGE_EDGE_TOP_TOLERANCE,
  PLAYER_SUPPORT_PROBE_FACTORS,
  DODGE_SPEED,
  DODGE_DURATION,
  SLIDE_SPEED,
  SLIDE_DURATION,
  ROLL_SPEED,
  ROLL_DURATION,
  MANEUVER_COOLDOWN,
  ROLL_COOLDOWN,
  getCircularDirectionalWeights,
  smoothTurnYaw,
  getColliderBounds,
} from './HumanoidAvatarShared'
import type { PlayerManeuver, PlayerPosture } from './HumanoidAvatarShared'
import { createHumanoidAvatarMountMethods } from './HumanoidAvatarMountMethods'
import type { HumanoidAvatarMountMethods } from './HumanoidAvatarMountMethods'


export interface HumanoidAvatar extends HumanoidAvatarMountMethods {}

/** Avatar humanoide controlável por teclado, com gravidade e colisões com terreno/objetos. */
export class HumanoidAvatar {
  readonly mesh = new THREE.Group()
  private readonly visualRoot = new THREE.Group()
  private disposed = false
  /** Altura física normalizada do avatar, em unidades do mundo. */
  private standingPlayerHeight = PLAYER_HEIGHT
  private modelLoadRevision = 0
  private animationActions = new Map<string, THREE.AnimationAction>()
  private animationController: AnimationController | null = null
  private activeAnimation = ''
  private playerMountTransition: 'mount' | null = null
  private animationTime = 0
  private proceduralLocomotionBlend = 0
  private proceduralRunBlend = 0
  private proceduralCycleSpeed = 8
  private animatedBones: Array<{ node: THREE.Object3D; name: string; baseX: number; baseY: number; baseZ: number; basePosition: THREE.Vector3 }> = []
  private proceduralLimbs: { leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; leftShoe: THREE.Mesh; rightShoe: THREE.Mesh; torso: THREE.Mesh } | null = null
  private readonly world: World
  private readonly cameraTarget: THREE.Vector3
  private readonly getCameraYaw: () => number
  private readonly pressed = new Set<string>()
  /** Salto por borda de tecla: segurar espaço não deve disparar saltos repetidos. */
  private jumpRequested = false
  private playerControlBindings: ControlMapBindings = { ...DEFAULT_CONTROL_MAPS[0]!.bindings }
  private readonly activeCollisions = new Map<string, { a: string; b: string }>()
  private verticalVelocity = 0
  private grounded = true
  private sprintToggled = false
  private walkToggled = false
  private posture: PlayerPosture = 'standing'
  private dodgeRequested = false
  private slideRequested = false
  private rollRequested = false
  private maneuver: PlayerManeuver = null
  private maneuverRemaining = 0
  private maneuverCooldown = 0
  private maneuverAdmission: ((kind: 'dodge' | 'slide' | 'roll') => boolean) | null = null
  private actionLockRemaining = 0
  private maneuverSpeed = 0
  private readonly maneuverDirection = new THREE.Vector3()
  private postureBeforeSlide: PlayerPosture = 'standing'
  /** Compensa a pose procedural antes do próximo tick para não acumular rotações. */
  private readonly postureRotationOffsets = new Map<THREE.Object3D, number>()
  private enabled = true
  private firstPersonMode = false
  private readonly firstPersonHiddenBones = new Map<THREE.Bone, THREE.Vector3>()
  private mountedRoot: THREE.Mesh | null = null
  private mountSettings: MountPackageSettings | null = null
  private mountedMovementState: MountMovementState = 'idle'
  private mountedJumpRequested = false
  private mountedAirborne = false
  private mountedVerticalVelocity = 0
  private mountedStartPosition: THREE.Vector3 | null = null
  private mountedStartRotation: THREE.Euler | null = null
  private mountedVisualPivot: THREE.Object3D | null = null
  private mountedVisualBaseQuaternion: THREE.Quaternion | null = null
  /** Evita executar nove raycasts de suporte em cada subpasso de movimento da montaria. */
  private mountedSupportProbeElapsed = 0
  private mountedHasSupportProbe = false
  private readonly mountedLastSupportProbePosition = new THREE.Vector3()
  private controlBindings(): ControlMapBindings {
    if (!this.mountedRoot || !this.mountSettings) return this.playerControlBindings

    // Um pacote que mantém os controles padrão herda o mapa selecionado pelo usuário.
    // Se o pacote tiver teclas próprias, preserva-as e herda as manobras do perfil ativo.
    const mountBindings = this.mountSettings.controlBindings
    const keys: (keyof ModelControlBindings)[] = ['forward', 'backward', 'left', 'right', 'run', 'jump', 'interact']
    const usesDefaults = keys.every(key => mountBindings[key] === DEFAULT_MODEL_CONTROL_BINDINGS[key])
    return usesDefaults
      ? this.playerControlBindings
      : { ...this.playerControlBindings, ...mountBindings }
  }

  setControlBindings(bindings: ControlMapBindings): void {
    this.playerControlBindings = { ...bindings }
    this.pressed.clear()
    this.sprintToggled = false
    this.walkToggled = false
    this.dodgeRequested = false
    this.slideRequested = false
    this.rollRequested = false
  }

  /** Permite ao sistema de jogo validar/cobrar recursos antes de iniciar manobras. */
  setManeuverAdmission(admission: ((kind: 'dodge' | 'slide' | 'roll') => boolean) | null): void {
    this.maneuverAdmission = admission
  }

  /** Impede temporariamente as ações do avatar sem desativar a câmera ou o runtime inteiro. */
  setActionLock(durationSeconds: number): void {
    this.actionLockRemaining = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0)
    this.pressed.clear()
    this.jumpRequested = false
    this.mountedJumpRequested = false
    this.dodgeRequested = false
    this.slideRequested = false
    this.rollRequested = false
    if (this.actionLockRemaining > 0) {
      if (this.maneuver === 'slide' || this.maneuver === 'roll') this.setPosture(this.postureBeforeSlide)
      this.maneuver = null
      this.maneuverRemaining = 0
      this.maneuverSpeed = 0
      this.animationController?.setState('idle', true)
    }
  }

  isActionLocked(): boolean {
    return this.actionLockRemaining > 0
  }

  private getStandingPlayerHeight(): number {
    return this.standingPlayerHeight
  }

  private getBodyScale(): number {
    return this.standingPlayerHeight / PLAYER_HEIGHT
  }

  private getPlayerRadius(): number {
    return Math.max(0.01, PLAYER_RADIUS * this.getBodyScale())
  }

  private getMaxWalkStepUp(): number {
    // Mantém uma margem mínima absoluta para personagens pequenos navegarem degraus e guias comuns.
    return Math.max(0.15, MAX_WALK_STEP_UP * this.getBodyScale())
  }

  private getMaxWalkOffDrop(): number {
    // Uma queda pequena não deve virar uma parede intransponível ao reduzir o tamanho do avatar.
    return Math.max(0.25, MAX_WALK_OFF_DROP * this.getBodyScale())
  }

  private getLedgeEdgeTopTolerance(): number {
    return Math.max(0.005, LEDGE_EDGE_TOP_TOLERANCE * this.getBodyScale())
  }

  private getLedgeEdgeFloorTolerance(): number {
    return this.getMaxWalkOffDrop() + 0.12 * this.getBodyScale()
  }

  private getPlayerHeight(): number {
    if (this.posture === 'prone') return Math.max(0.01, this.standingPlayerHeight * (0.62 / PLAYER_HEIGHT))
    if (this.posture === 'crouching') return Math.max(0.01, this.standingPlayerHeight * (1.12 / PLAYER_HEIGHT))
    return this.standingPlayerHeight
  }

  private setPosture(posture: PlayerPosture): void {
    this.posture = posture
    // Agachar deve articular as pernas e o tronco, não comprimir o modelo inteiro.
    // A escala reduzida permanece reservada à postura deitada.
    this.visualRoot.scale.y = posture === 'prone' ? 0.34 : 1
  }

  private clearPosturePoseOffsets(): void {
    for (const [node, offset] of this.postureRotationOffsets) {
      node.rotation.x -= offset
    }
    this.postureRotationOffsets.clear()
  }

  private addPostureRotationOffset(node: THREE.Object3D, offset: number): void {
    node.rotation.x += offset
    this.postureRotationOffsets.set(node, (this.postureRotationOffsets.get(node) ?? 0) + offset)
  }

  /**
   * Fallback articulado para rigs sem clipe de agachamento.
   * Modelos que já têm animação crouch/crouch_walk usam o clipe original.
   */
  private applyFallbackCrouchPose(): void {
    if (this.posture !== 'crouching') return
    if (this.animationActions.has('crouch') || this.animationActions.has('crouch_walk')) return

    for (const bone of this.animatedBones) {
      const name = bone.name.toLowerCase()
      if (/upleg|upper.?leg|thigh|femur/.test(name)) {
        this.addPostureRotationOffset(bone.node, 0.48)
      } else if (/(calf|shin|knee|lower.?leg)/.test(name) ||
        (/(left|right).*(leg)|(leg).*(left|right)/.test(name) && !/upleg|upper.?leg|thigh/.test(name))) {
        this.addPostureRotationOffset(bone.node, -0.82)
      } else if (/spine|chest/.test(name)) {
        this.addPostureRotationOffset(bone.node, 0.08)
      } else if (/hips|pelvis/.test(name)) {
        this.addPostureRotationOffset(bone.node, 0.08)
      }
    }

    // O avatar procedural de reserva não possui ossos de joelho separados.
    // Inclinar os pivôs das pernas e o tronco produz uma postura baixa sem achatar a malha.
    if (this.proceduralLimbs) {
      const limbs = this.proceduralLimbs
      this.addPostureRotationOffset(limbs.leftLeg, 0.42)
      this.addPostureRotationOffset(limbs.rightLeg, 0.42)
      this.addPostureRotationOffset(limbs.torso, 0.12)
      this.addPostureRotationOffset(limbs.leftArm, -0.14)
      this.addPostureRotationOffset(limbs.rightArm, -0.14)
    }
  }

  private beginManeuver(kind: Exclude<PlayerManeuver, null>, direction: THREE.Vector3): void {
    this.maneuver = kind
    this.maneuverRemaining = kind === 'slide' ? SLIDE_DURATION : kind === 'roll' ? ROLL_DURATION : DODGE_DURATION
    this.maneuverSpeed = kind === 'slide' ? SLIDE_SPEED : kind === 'roll' ? ROLL_SPEED : DODGE_SPEED
    this.maneuverDirection.copy(direction).setY(0)
    if (this.maneuverDirection.lengthSq() < 1e-8) {
      this.maneuverDirection.set(Math.sin(this.mesh.rotation.y), 0, Math.cos(this.mesh.rotation.y))
    }
    this.maneuverDirection.normalize()
    this.maneuverCooldown = kind === 'slide' ? 0.72 : kind === 'roll' ? ROLL_COOLDOWN : MANEUVER_COOLDOWN
    if (kind === 'slide' || kind === 'roll') {
      this.postureBeforeSlide = this.posture
      this.setPosture(kind === 'slide' ? 'crouching' : 'prone')
    }
    this.triggerPlayerAnimation(kind)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const bindings = this.controlBindings()
    const animationControls: Array<{ code: string; role: AnimationRole }> = [
      { code: bindings.interact, role: 'interact' },
      { code: bindings.dodge, role: 'dodge' },
      { code: bindings.slide, role: 'slide' },
      { code: bindings.roll, role: 'roll' },
      { code: bindings.primaryAction, role: 'primary_action' },
      { code: bindings.secondaryAction, role: 'secondary_action' },
      { code: bindings.inventory, role: 'inventory' },
      { code: bindings.useItem, role: 'use_item' },
      { code: bindings.reload, role: 'reload' },
      { code: bindings.ability1, role: 'ability_1' },
      { code: bindings.ability2, role: 'ability_2' },
      { code: bindings.ability3, role: 'ability_3' },
      { code: bindings.ability4, role: 'ability_4' },
      { code: bindings.emote, role: 'emote' },
    ]
    const mappedAnimation = animationControls.find(item => item.code === event.code)
    const movementKeys = [
      bindings.forward, bindings.backward, bindings.left, bindings.right,
      bindings.run, bindings.jump, bindings.interact,
      bindings.sprintToggle, bindings.walkToggle, bindings.crouchToggle,
      bindings.proneToggle, bindings.dodge, bindings.slide, bindings.roll,
      ...animationControls.map(item => item.code),
    ]
    if (!movementKeys.includes(event.code)) return

    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    const editingText = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable
    if (this.enabled && !editingText) event.preventDefault()
    if (editingText || event.metaKey || event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight' || event.altKey && event.code !== 'AltLeft' && event.code !== 'AltRight') return

    if (!event.repeat) {
      if (event.code === bindings.sprintToggle) {
        this.sprintToggled = !this.sprintToggled
        if (this.sprintToggled) this.walkToggled = false
        return
      }
      if (event.code === bindings.walkToggle) {
        this.walkToggled = !this.walkToggled
        if (this.walkToggled) this.sprintToggled = false
        return
      }
    }

    if (!event.repeat && !this.mountedRoot) {
      if (event.code === bindings.crouchToggle) {
        if (this.maneuver !== 'slide' && this.maneuver !== 'roll') this.setPosture(this.posture === 'crouching' ? 'standing' : 'crouching')
        return
      }
      if (event.code === bindings.proneToggle) {
        if (this.maneuver !== 'slide' && this.maneuver !== 'roll') this.setPosture(this.posture === 'prone' ? 'standing' : 'prone')
        return
      }
      if (event.code === bindings.dodge) {
        if (this.maneuverCooldown > 0 || this.maneuver !== null || !this.grounded) return
        if (this.maneuverAdmission && !this.maneuverAdmission('dodge')) return
        this.dodgeRequested = true
        return
      }
      if (event.code === bindings.slide) {
        if (this.maneuverCooldown > 0 || this.maneuver !== null || !this.grounded) return
        const hasMovementIntent = this.pressed.has(bindings.forward) || this.pressed.has(bindings.backward) ||
          this.pressed.has(bindings.left) || this.pressed.has(bindings.right)
        if (!hasMovementIntent) return
        if (this.maneuverAdmission && !this.maneuverAdmission('slide')) return
        this.slideRequested = true
        return
      }
      if (event.code === bindings.roll) {
        if (this.maneuverCooldown > 0 || this.maneuver !== null || !this.grounded) return
        if (this.maneuverAdmission && !this.maneuverAdmission('roll')) return
        this.rollRequested = true
        return
      }
    }

    if (event.code === bindings.jump && !event.repeat) {
      if (this.mountedRoot) this.mountedJumpRequested = true
      else this.jumpRequested = true
    }

    if (!event.repeat && mappedAnimation) {
      if (this.mountedRoot) {
        const actions = this.mountedRoot.userData.importAnimationActions as Partial<Record<AnimationRole, THREE.AnimationAction>> | undefined
        // Interação em uma montaria já montada aciona a desmontagem pelo Engine;
        // não deixe um clipe genérico de interação competir com a transição.
        if (mappedAnimation.role !== 'interact' && actions?.[mappedAnimation.role]) {
          this.playMountAnimation(this.mountedRoot, mappedAnimation.role, true)
        }
      } else if (!['dodge', 'slide', 'roll'].includes(mappedAnimation.role)) {
        this.triggerPlayerAnimation(mappedAnimation.role)
      }
    }
    this.pressed.add(event.code)
  }
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code)
  }
  private readonly onBlur = (): void => {
    this.pressed.clear()
    this.jumpRequested = false
    this.mountedJumpRequested = false
  }

  constructor(world: World, cameraTarget: THREE.Vector3, getCameraYaw: () => number) {
    this.world = world
    this.cameraTarget = cameraTarget
    this.getCameraYaw = getCameraYaw
    this.mesh.name = 'Humanoid Avatar'
    this.mesh.userData.id = PLAYER_ID
    this.visualRoot.name = 'Avatar visual'
    this.mesh.add(this.visualRoot)

    const skin = new THREE.MeshStandardMaterial({ color: 0xd7a078, roughness: 0.85 })
    const shirt = new THREE.MeshStandardMaterial({ color: 0x2878c8, roughness: 0.8 })
    const pants = new THREE.MeshStandardMaterial({ color: 0x263e61, roughness: 0.9 })
    const shoes = new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.8 })
    const hair = new THREE.MeshStandardMaterial({ color: 0x39291f, roughness: 1 })
    const addPart = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale?: [number, number, number], parent: THREE.Object3D = this.visualRoot) => {
      const part = new THREE.Mesh(geometry, material)
      part.name = name
      part.position.set(...position)
      if (scale) part.scale.set(...scale)
      part.castShadow = true
      part.receiveShadow = true
      parent.add(part)
      return part
    }

    // Cabeça, cabelo e pescoço.
    addPart('head', new THREE.SphereGeometry(0.19, 16, 12), skin, [0, 1.57, 0])
    addPart('hair', new THREE.SphereGeometry(0.195, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, 1.65, -0.015])
    addPart('neck', new THREE.CylinderGeometry(0.065, 0.07, 0.12, 10), skin, [0, 1.34, 0])
    // Tronco e membros articulados: os pivôs permitem animar cada bloco proceduralmente.
    const torso = addPart('torso', new THREE.BoxGeometry(0.48, 0.58, 0.27), shirt, [0, 1.02, 0])
    const leftArm = new THREE.Group()
    leftArm.name = 'left-arm-pivot'
    leftArm.position.set(-0.27, 1.2, 0)
    this.visualRoot.add(leftArm)
    addPart('left-arm', new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), shirt, [-0.045, -0.17, 0], undefined, leftArm)
    addPart('left-hand', new THREE.SphereGeometry(0.07, 10, 8), skin, [-0.045, -0.39, 0], undefined, leftArm)
    const rightArm = new THREE.Group()
    rightArm.name = 'right-arm-pivot'
    rightArm.position.set(0.27, 1.2, 0)
    this.visualRoot.add(rightArm)
    addPart('right-arm', new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), shirt, [0.045, -0.17, 0], undefined, rightArm)
    addPart('right-hand', new THREE.SphereGeometry(0.07, 10, 8), skin, [0.045, -0.39, 0], undefined, rightArm)

    const leftLeg = new THREE.Group()
    leftLeg.name = 'left-leg-pivot'
    leftLeg.position.set(-0.13, 0.66, 0)
    this.visualRoot.add(leftLeg)
    addPart('left-leg', new THREE.CapsuleGeometry(0.095, 0.36, 4, 8), pants, [0, -0.19, 0], undefined, leftLeg)
    const leftShoe = addPart('left-shoe', new THREE.BoxGeometry(0.17, 0.1, 0.27), shoes, [0, -0.49, 0.045], undefined, leftLeg)
    const rightLeg = new THREE.Group()
    rightLeg.name = 'right-leg-pivot'
    rightLeg.position.set(0.13, 0.66, 0)
    this.visualRoot.add(rightLeg)
    addPart('right-leg', new THREE.CapsuleGeometry(0.095, 0.36, 4, 8), pants, [0, -0.19, 0], undefined, rightLeg)
    const rightShoe = addPart('right-shoe', new THREE.BoxGeometry(0.17, 0.1, 0.27), shoes, [0, -0.49, 0.045], undefined, rightLeg)
    this.proceduralLimbs = { leftArm, rightArm, leftLeg, rightLeg, leftShoe, rightShoe, torso }

    this.mesh.position.set(0, world.terrain.heightAt(0, 0), 0)
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) child.userData.avatarPart = true
    })
    this.world.scene.add(this.mesh)
    void this.loadSketchfabModel()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  update(dt: number): void {
    if (!this.enabled) return
    const step = Math.min(dt, 0.05)
    if (this.actionLockRemaining > 0) {
      this.actionLockRemaining = Math.max(0, this.actionLockRemaining - step)
      this.pressed.clear()
      this.jumpRequested = false
      this.mountedJumpRequested = false
      this.dodgeRequested = false
      this.slideRequested = false
      this.rollRequested = false
    }
    const actionLocked = this.actionLockRemaining > 0
    const bindings = this.controlBindings()
    const forwardInput = actionLocked ? 0 : Number(this.pressed.has(bindings.forward)) - Number(this.pressed.has(bindings.backward))
    const sideInput = actionLocked ? 0 : Number(this.pressed.has(bindings.right)) - Number(this.pressed.has(bindings.left))
    const length = Math.hypot(forwardInput, sideInput)
    const running = this.pressed.has(bindings.run) || this.sprintToggled
    let speed = WALK_SPEED * (running ? RUN_MULTIPLIER : 1)
    if (this.walkToggled && !running) speed = WALK_SPEED * 0.48
    if (this.posture === 'crouching') speed = WALK_SPEED * 0.54
    else if (this.posture === 'prone') speed = WALK_SPEED * 0.24

    // Enquanto montado, os controles deslocam a entidade montável em vez do avatar.
    if (this.mountedRoot && this.mountSettings) {
      // Durante a transição de montar, o clipe do jogador e o da montaria avançam
      // paralelamente. Ao terminar a animação do jogador, ele fica oculto no assento.
      this.updateMountedMovement(step, forwardInput, sideInput, running, this.walkToggled && !running)
      this.updateMountedPlayerTransition(step)
      return
    }

    // A animação deve refletir deslocamento real, não apenas uma tecla pressionada.
    // Em colisões com paredes/partes da cidade o personagem pode ficar parado mesmo
    // com entrada de movimento; nesses casos o estado correto é idle.
    const animationStartX = this.mesh.position.x
    const animationStartZ = this.mesh.position.z

    // Consumir somente o pressionamento inicial evita que manter a tecla de
    // salto force um novo salto ao tocar o chão e interrompa a corrida continuamente.
    const requestedJump = this.jumpRequested
    this.jumpRequested = false
    if (requestedJump && this.grounded) {
      this.verticalVelocity = JUMP_SPEED * Math.sqrt(this.getBodyScale())
      this.grounded = false
    }
    this.verticalVelocity -= GRAVITY * step
    const oldY = this.mesh.position.y
    const wasGrounded = this.grounded
    let nextY = oldY + this.verticalVelocity * step

    // Movimento relativo à orientação horizontal da câmera.
    if (this.maneuverCooldown > 0) this.maneuverCooldown = Math.max(0, this.maneuverCooldown - step)
    let requestedDirection = new THREE.Vector3(
      sideInput * Math.cos(this.getCameraYaw()) - forwardInput * Math.sin(this.getCameraYaw()),
      0,
      -sideInput * Math.sin(this.getCameraYaw()) - forwardInput * Math.cos(this.getCameraYaw()),
    )
    if (requestedDirection.lengthSq() > 1e-8) requestedDirection.normalize()

    if (this.dodgeRequested || this.slideRequested || this.rollRequested) {
      const requestedManeuver = this.rollRequested ? 'roll' : this.slideRequested ? 'slide' : 'dodge'
      const canStart = requestedManeuver === 'dodge' || requestedManeuver === 'roll' || length > 0
      if (this.grounded && this.maneuverCooldown <= 0 && this.maneuver === null && canStart) {
        this.beginManeuver(requestedManeuver, requestedDirection)
      }
      this.dodgeRequested = false
      this.slideRequested = false
      this.rollRequested = false
    }

    let horizontalStepY: number | null = null
    const movingByInput = length > 0
    if (movingByInput || this.maneuver !== null) {
      let displacement = new THREE.Vector3()
      if (this.maneuver !== null && this.maneuverRemaining > 0) {
        const maneuverTime = Math.min(step, this.maneuverRemaining)
        const normalTime = Math.max(0, step - maneuverTime)
        displacement.addScaledVector(this.maneuverDirection, this.maneuverSpeed * maneuverTime)
        if (normalTime > 0 && movingByInput) displacement.addScaledVector(requestedDirection, speed * normalTime)
        this.maneuverRemaining = Math.max(0, this.maneuverRemaining - step)
        if (this.maneuverRemaining <= 0) {
          if (this.maneuver === 'slide' || this.maneuver === 'roll') this.setPosture(this.postureBeforeSlide)
          this.maneuver = null
          this.maneuverSpeed = 0
        }
      } else if (movingByInput) {
        displacement.copy(requestedDirection).multiplyScalar(speed * step)
      }
      const direction = displacement
      const horizontalMovementBounds = this.getHorizontalMovementBounds()

      // Faça a varredura horizontal em incrementos pequenos. Um único teste no
      // ponto final pode saltar uma perna ou uma face low-poly quando o quadro
      // chega lento; a varredura mantém contato com as superfícies reais.
      const moveAxis = (axis: 'x' | 'z', delta: number): void => {
        if (Math.abs(delta) < 1e-8) return
        const origin = this.mesh.position[axis]
        const maxSubstep = Math.max(0.005, Math.min(0.05, this.getPlayerRadius() * 0.16))
        const steps = Math.max(1, Math.ceil(Math.abs(delta) / maxSubstep))
        let lastSafe = origin

        for (let index = 1; index <= steps; index += 1) {
          const coordinate = THREE.MathUtils.clamp(
            origin + delta * index / steps,
            axis === 'x' ? horizontalMovementBounds.minX : horizontalMovementBounds.minZ,
            axis === 'x' ? horizontalMovementBounds.maxX : horizontalMovementBounds.maxZ,
          )
          this.mesh.position[axis] = coordinate

          if (!this.collidesWithObjects()) {
            lastSafe = coordinate
            continue
          }

          const stepDownSurface = wasGrounded
            ? this.findWalkOffSurface(
                this.mesh.position.x,
                this.mesh.position.z,
                this.mesh.position.y,
                axis,
                Math.sign(delta),
              )
            : null
          if (stepDownSurface !== null) {
            const edgeWindow = {
              topY: this.mesh.position.y,
              floorY: stepDownSurface,
            }
            // O meio-fio termina na altura da sola; não deve prender a caixa
            // do jogador apenas por tocar a sua aresta inferior. Paredes acima
            // dos pés e faces que descem muito abaixo do piso continuam bloqueando.
            if (!this.collidesWithObjects(false, edgeWindow)) {
              lastSafe = coordinate
              continue
            }
          }

          const stepUp = wasGrounded
            ? this.findStepUpSurface(this.mesh.position.x, this.mesh.position.z, this.mesh.position.y, axis, Math.sign(delta))
            : null
          if (stepUp !== null) {
            const previousY = this.mesh.position.y
            // Primeiro levantamos o volume físico ligeiramente acima da face
            // superior. Sem essa folga, o AABB ainda intersecta a aresta do espelho
            // da escada e a própria colisão lateral cancela a subida.
            // findObjectLanding repõe os pés exatamente sobre o triângulo do degrau
            // no fim deste mesmo frame.
            const targetY = Math.max(previousY, stepUp) + 0.065 * this.getBodyScale()
            const candidateY = Math.min(targetY, previousY + STEP_UP_SPEED * step)
            this.mesh.position.y = candidateY
            if (!this.collidesWithObjects()) {
              horizontalStepY = candidateY
              this.verticalVelocity = 0
              lastSafe = coordinate
              continue
            }
            // A elevação parcial continua entre quadros; não teleporta o avatar
            // até o topo nem perde todo o progresso quando a aresta ainda colide.
            horizontalStepY = candidateY
            this.verticalVelocity = 0
            this.mesh.position[axis] = lastSafe
            this.mesh.updateMatrixWorld(true)
            break
          }

          // Para no último ponto livre, sem reverter o outro eixo nem teleportar.
          this.mesh.position[axis] = lastSafe
          break
        }
      }

      moveAxis('x', direction.x)
      moveAxis('z', direction.z)
      if (direction.lengthSq() > 1e-8) {
        const targetYaw = Math.atan2(direction.x, direction.z)
        // A rotação tem aceleração angular; o blend direcional consegue passar
        // pelas diagonais durante curvas sem dar um salto de 90°/180° na pose.
        this.mesh.rotation.y = smoothTurnYaw(
          this.mesh.rotation.y,
          targetYaw,
          step,
          running ? 10.5 : 8,
        )
      }
    }

    // A correção de altura feita durante o movimento horizontal precisa
    // sobreviver ao cálculo da gravidade deste mesmo quadro.
    if (horizontalStepY !== null) nextY = Math.max(nextY, horizontalStepY)
    const newGroundY = this.world.terrain.heightAt(this.mesh.position.x, this.mesh.position.z)
    this.mesh.position.y = nextY
    this.mesh.updateMatrixWorld(true)

    // Durante o salto, testa a cabeça contra a face inferior das malhas. Sem esta
    // verificação vertical, o personagem pode atravessar o teto de uma rampa e
    // aparecer por cima mesmo que a colisão horizontal esteja funcionando.
    if (this.verticalVelocity > 0 && this.collidesWithObjects(true)) {
      nextY = oldY
      this.mesh.position.y = oldY
      this.verticalVelocity = 0
      this.mesh.updateMatrixWorld(true)
    }
    const landing = this.findObjectLanding(oldY, nextY)

    // Mantém contato com rampas descendentes: sem essa tolerância, a gravidade
    // deixa o avatar alguns frames no ar e alterna walk/jump rapidamente.
    const terrainDrop = oldY - newGroundY
    const bodyScale = this.getBodyScale()
    const canFollowSlopeDown = wasGrounded &&
      length > 0 &&
      this.verticalVelocity <= 0 &&
      terrainDrop >= -0.08 * bodyScale &&
      terrainDrop <= Math.max(0.32 * bodyScale, speed * step * 1.5)

    // Acompanha também descidas pequenas em malhas importadas, sem esperar
    // que a gravidade alcance a superfície. Isso evita alternar entre andar e cair
    // quando o piso é estreito ou a rampa desce menos por quadro que a gravidade.
    const objectDropLimit = Math.max(0.38 * bodyScale, speed * step * 1.5)
    const canFollowObjectSlopeDown = wasGrounded &&
      length > 0 &&
      landing !== null &&
      this.verticalVelocity <= 0 &&
      landing <= oldY + 0.08 * bodyScale &&
      landing >= oldY - objectDropLimit

    const canLandOnObject = landing !== null &&
      this.verticalVelocity <= 0 &&
      (
        nextY <= landing + 0.05 * bodyScale ||
        (wasGrounded && length > 0 && landing >= oldY - 0.16 * bodyScale && landing <= oldY + this.getMaxWalkStepUp()) ||
        canFollowObjectSlopeDown
      )

    // Plataformas/rampas têm prioridade sobre o terreno base. Caso contrário,
    // um quadro em que nextY chega ao nível do terreno pode apagar o pouso
    // válido numa plataforma logo acima dele.
    if (horizontalStepY !== null && horizontalStepY > oldY + 0.01 * bodyScale) {
      this.mesh.position.y = horizontalStepY
      this.verticalVelocity = 0
      this.grounded = true
    } else if (canLandOnObject && landing !== null) {
      this.mesh.position.y = landing
      this.verticalVelocity = 0
      this.grounded = true
    } else if (nextY <= newGroundY || canFollowSlopeDown) {
      this.mesh.position.y = newGroundY
      this.verticalVelocity = 0
      this.grounded = true
    } else {
      // Não force o personagem para uma plataforma que ainda está abaixo dele.
      // Deixe a gravidade conduzir a queda e só pouse quando nextY alcançar a superfície.
      this.grounded = false
    }

    const actualHorizontalDistance = Math.hypot(
      this.mesh.position.x - animationStartX,
      this.mesh.position.z - animationStartZ,
    )
    const movementEpsilon = Math.max(0.001, this.getBodyScale() * 0.0015)
    const actuallyMoving = actualHorizontalDistance > movementEpsilon
    this.updateAvatarAnimation(
      step,
      actuallyMoving || this.maneuver !== null,
      running,
      forwardInput,
      sideInput,
      actualHorizontalDistance / Math.max(step, 1e-4),
    )
    this.updateCollisionEvents()
    // A câmera acompanha o personagem, mantendo o ângulo e a distância atuais.
    if (this.firstPersonMode) {
      this.cameraTarget.x = this.mesh.position.x
      // Mantém a câmera na altura dos olhos relativa aos pés do avatar,
      // acompanhando pulos e mudanças de nível do terreno/plataformas.
      this.cameraTarget.y = this.mesh.position.y + this.getPlayerHeight() * 0.88
      this.cameraTarget.z = this.mesh.position.z
    } else {
      this.cameraTarget.x = THREE.MathUtils.lerp(this.cameraTarget.x, this.mesh.position.x, 0.12)
      this.cameraTarget.z = THREE.MathUtils.lerp(this.cameraTarget.z, this.mesh.position.z, 0.12)
    }
  }

  setFirstPersonMode(enabled: boolean): void {
    this.firstPersonMode = enabled
    this.visualRoot.visible = this.mountedRoot === null
    const headPartPattern = /head|hair|face|neck|jaw|eye|teeth|tongue|cabe[cç]a|cabelo|rosto|pesco[cç]o|mand[ií]bula|olho|dente|l[ií]ngua/i
    this.visualRoot.traverse((child) => {
      const partName = child.name
      if (headPartPattern.test(partName)) {
        child.visible = !enabled
      }

      // Alguns GLBs juntam cabeça e corpo numa única malha skinned.
      // Nesses modelos, esconder só o objeto não basta: desativa também
      // os ossos da cabeça/pescoço, restaurando a escala ao sair do modo.
      if (child instanceof THREE.Bone && headPartPattern.test(partName)) {
        if (enabled) {
          if (!this.firstPersonHiddenBones.has(child)) {
            this.firstPersonHiddenBones.set(child, child.scale.clone())
          }
          child.scale.set(0, 0, 0)
        } else {
          const originalScale = this.firstPersonHiddenBones.get(child)
          if (originalScale) child.scale.copy(originalScale)
        }
      }
    })
    if (!enabled) this.firstPersonHiddenBones.clear()
    this.pressed.clear()
    if (enabled) {
      this.cameraTarget.x = this.mesh.position.x
      this.cameraTarget.z = this.mesh.position.z
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.pressed.clear()
    this.jumpRequested = false
    this.mountedJumpRequested = false
    if (!enabled) {
      this.animationController?.stop()
      this.activeAnimation = ''
    }
  }

  /** Verifica se o jogador pode ocupar uma posição sem colidir com objetos. */
  canOccupyPosition(x: number, z: number): boolean {
    const previous = this.mesh.position.clone()
    this.mesh.position.set(
      THREE.MathUtils.clamp(x, -49, 49),
      this.world.terrain.heightAt(x, z),
      THREE.MathUtils.clamp(z, -49, 49),
    )
    this.mesh.updateMatrixWorld(true)
    const blocked = this.collidesWithObjects()
    this.mesh.position.copy(previous)
    this.mesh.updateMatrixWorld(true)
    return !blocked
  }

  resetVerticalState(): void {
    this.jumpRequested = false
    this.mountedJumpRequested = false
    this.verticalVelocity = 0
    this.grounded = true
    this.pressed.clear()
    this.activeCollisions.clear()
    this.animationTime = 0
    this.sprintToggled = false
    this.walkToggled = false
    this.maneuver = null
    this.maneuverRemaining = 0
    this.maneuverCooldown = 0
    this.maneuverSpeed = 0
    this.dodgeRequested = false
    this.slideRequested = false
    this.rollRequested = false
    this.setPosture('standing')
    this.playAnimation('idle')
  }

  reset(): void {
    this.jumpRequested = false
    this.mountedJumpRequested = false
    this.mesh.position.set(0, this.world.terrain.heightAt(0, 0), 0)
    this.verticalVelocity = 0
    this.grounded = true
    this.pressed.clear()
    this.activeCollisions.clear()
    this.animationTime = 0
    this.sprintToggled = false
    this.walkToggled = false
    this.maneuver = null
    this.maneuverRemaining = 0
    this.maneuverCooldown = 0
    this.dodgeRequested = false
    this.slideRequested = false
    this.rollRequested = false
    this.setPosture('standing')
    this.playAnimation('idle')
  }

  dispose(): void {
    this.disposed = true
    this.animationController?.dispose()
    this.animationController = null
    this.animationActions.clear()
    this.animatedBones = []
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.world.scene.remove(this.mesh)
    this.mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
    })
  }

  /** Substitui o visual do jogador por um GLB escolhido no editor. */
  async setCustomModel(
    data: ArrayBuffer,
    animationRoles?: Record<string, AnimationRole>,
    targetHeight = PLAYER_HEIGHT,
  ): Promise<void> {
    if (this.disposed) throw new Error('O jogador já foi descarregado.')
    if (!(data instanceof ArrayBuffer) || data.byteLength < 20) {
      throw new Error('O arquivo do jogador não parece ser um GLB válido.')
    }

    const revision = ++this.modelLoadRevision
    const installed = await this.parseAndInstallModel(data.slice(0), revision, animationRoles, targetHeight)
    if (!installed) throw new Error('O carregamento do modelo foi substituído por outra operação.')
  }

  /** Restaura o modelo padrão sem interromper o jogo enquanto o asset é carregado. */
  async resetDefaultModel(): Promise<void> {
    if (this.disposed) throw new Error('O jogador já foi descarregado.')
    const revision = ++this.modelLoadRevision
    const installed = await this.loadDefaultModel(revision)
    if (!installed || revision !== this.modelLoadRevision) {
      throw new Error('A restauração do modelo padrão foi interrompida.')
    }
  }

  /** Carrega o modelo padrão embutido na aplicação, mantendo o avatar procedural como fallback. */
  private async loadSketchfabModel(): Promise<void> {
    try {
      await this.loadDefaultModel(this.modelLoadRevision)
    } catch (error) {
      console.warn('[Engine Prometheus] Não foi possível carregar o avatar padrão; mantendo o modelo de reserva.', error)
    }
  }

  private async loadDefaultModel(revision: number): Promise<boolean> {
    const response = await fetch(`${import.meta.env.BASE_URL}models/dummy.zip`)
    if (!response.ok) throw new Error(`Não foi possível carregar o modelo padrão (HTTP ${response.status}).`)
    const archive = await response.arrayBuffer()
    const view = new DataView(archive)
    if (view.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50) {
      throw new Error('O arquivo do avatar padrão não é um ZIP válido.')
    }
    const compression = view.getUint16(8, true)
    const compressedSize = view.getUint32(18, true)
    const nameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)
    if (compression !== 0) throw new Error('O ZIP do avatar usa uma compressão não suportada.')
    const dataStart = 30 + nameLength + extraLength
    if (dataStart + compressedSize > view.byteLength) throw new Error('O GLB dentro do ZIP está incompleto.')
    return this.parseAndInstallModel(archive.slice(dataStart, dataStart + compressedSize), revision)
  }

  private async parseAndInstallModel(data: ArrayBuffer, revision: number, animationRoles?: Record<string, AnimationRole>, targetHeight = PLAYER_HEIGHT): Promise<boolean> {
    const loader = new GLTFLoader()
    const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>((resolve, reject) => {
      loader.parse(data, '', resolve, reject)
    })

    if (this.disposed || revision !== this.modelLoadRevision) {
      this.disposeObject(gltf.scene)
      return false
    }

    const bounds = new THREE.Box3().setFromObject(gltf.scene)
    const size = bounds.getSize(new THREE.Vector3())
    if (!Number.isFinite(size.y) || size.y <= 1e-5) {
      this.disposeObject(gltf.scene)
      throw new Error('O modelo não possui altura válida. Verifique se o GLB contém malhas visíveis.')
    }

    // A altura definida no Importador 3D passa a controlar o visual e o corpo físico.
    // O fator usa as dimensões efetivas do GLB, mesmo que ele já venha escalado no arquivo.
    const normalizedTargetHeight = THREE.MathUtils.clamp(
      Number.isFinite(targetHeight) ? targetHeight : PLAYER_HEIGHT,
      0.1,
      10000,
    )
    gltf.scene.scale.multiplyScalar(normalizedTargetHeight / size.y)
    gltf.scene.updateMatrixWorld(true)
    const normalizedBounds = new THREE.Box3().setFromObject(gltf.scene)
    const center = normalizedBounds.getCenter(new THREE.Vector3())
    gltf.scene.position.x -= center.x
    gltf.scene.position.y -= normalizedBounds.min.y
    gltf.scene.position.z -= center.z

    const nextMixer = new THREE.AnimationMixer(gltf.scene)
    const nextActions = createAnimationActionMap(nextMixer, gltf.animations, animationRoles)

    const nextBones: typeof this.animatedBones = []
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Bone || /arm|leg|thigh|calf|foot|hand|spine|hips|pelvis/i.test(child.name)) {
        nextBones.push({
          node: child,
          name: child.name.toLowerCase(),
          baseX: child.rotation.x,
          baseY: child.rotation.y,
          baseZ: child.rotation.z,
          basePosition: child.position.clone(),
        })
      }
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
        child.userData.avatarPart = true
      }
    })

    // O novo modelo só substitui o antigo depois de ser carregado e validado.
    // Assim, um GLB inválido não deixa o jogador invisível nem remove o fallback.
    this.animationController?.dispose()
    this.animationActions = nextActions
    this.animationController = new AnimationController(nextMixer, nextActions)
    this.animatedBones = nextBones
    this.firstPersonHiddenBones.clear()
    for (const child of [...this.visualRoot.children]) this.disposeObject(child)
    this.visualRoot.clear()
    this.proceduralLimbs = null
    this.visualRoot.add(gltf.scene)
    this.standingPlayerHeight = normalizedTargetHeight
    this.setPosture(this.posture)
    this.setFirstPersonMode(this.firstPersonMode)
    this.activeAnimation = ''
    this.playAnimation('idle')
    return true
  }

  private triggerPlayerAnimation(role: AnimationRole): void {
    if (!this.animationController?.hasRole(role)) return
    this.animationController.playOneShot(role, false)
  }

  private playAnimation(state: string, oneShot = false): void {
    const controller = this.animationController
    if (!controller) return
    if (oneShot) controller.playOneShot(state, false)
    else controller.setState(state)
    this.activeAnimation = controller.currentState || state
  }

  private getLocomotionAnimationRole(forwardInput: number, sideInput: number, running: boolean): AnimationRole {
    if (forwardInput < 0 && sideInput !== 0) {
      if (running) return sideInput < 0 ? 'run_backward_diagonal_left' : 'run_backward_diagonal_right'
      return sideInput < 0 ? 'walk_backward_diagonal_left' : 'walk_backward_diagonal_right'
    }
    if (forwardInput > 0 && Math.abs(sideInput) > 0) {
      if (running) return sideInput < 0 ? 'run_diagonal_left' : 'run_diagonal_right'
      return sideInput < 0 ? 'walk_diagonal_left' : 'walk_diagonal_right'
    }
    if (forwardInput < 0) return running ? 'run_backward' : 'walk_backward'
    if (sideInput < 0) return running ? 'run_left' : 'walk_left'
    if (sideInput > 0) return running ? 'run_right' : 'walk_right'
    return running ? 'run' : 'walk'
  }

  private updateAvatarAnimation(
    dt: number,
    moving: boolean,
    running: boolean,
    forwardInput: number,
    sideInput: number,
    actualHorizontalSpeed: number,
  ): void {
    // Retira a pose procedural do quadro anterior antes de o mixer avançar.
    // Assim, alternar entre agachado e em pé não acumula rotações nos ossos.
    this.clearPosturePoseOffsets()
    // Quando o modelo não possui clipe de salto, não deixe pequenas falhas
    // momentâneas de grounded trocar a corrida pela pose idle. Nessa situação,
    // o ciclo de locomoção continua acompanhando o movimento horizontal.
    const controller = this.animationController
    const hasJumpClip = controller?.hasRole('jump') ?? false
    if (this.grounded && controller?.activeOneShotRole === 'jump') controller.cancelOneShot('jump')

    const movingNow = moving && (this.grounded || !hasJumpClip)
    const blendRate = 1 - Math.exp(-Math.max(0, dt) * (movingNow ? 8.5 : 5.5))
    this.proceduralLocomotionBlend = THREE.MathUtils.lerp(this.proceduralLocomotionBlend, movingNow ? 1 : 0, blendRate)
    this.proceduralRunBlend = THREE.MathUtils.lerp(this.proceduralRunBlend, movingNow && running ? 1 : 0, blendRate)
    const targetCycleSpeed = movingNow ? (running ? 12 : 8) : 4.5
    this.proceduralCycleSpeed = THREE.MathUtils.lerp(this.proceduralCycleSpeed, targetCycleSpeed, 1 - Math.exp(-Math.max(0, dt) * 5))
    this.animationTime += dt * this.proceduralCycleSpeed

    const state: AnimationRole = !this.grounded && hasJumpClip ? 'jump'
      : this.posture === 'prone' ? (moving ? 'prone_crawl' : 'prone')
        : this.posture === 'crouching' ? (moving ? 'crouch_walk' : 'crouch')
          : !moving ? 'idle'
            : this.walkToggled && !running ? 'walk_slow'
              : this.getLocomotionAnimationRole(forwardInput, sideInput, running)

    const canBlendDirection = movingNow &&
      this.posture === 'standing' &&
      !(this.walkToggled && !running) &&
      this.maneuver === null &&
      !controller?.isOneShotPlaying &&
      this.animationActions.size > 0
    let usedDirectionalBlend = false
    if (controller && canBlendDirection) {
      const targetWeights = getCircularDirectionalWeights(
        this.animationActions, forwardInput, sideInput,
        this.getCameraYaw(), this.mesh.rotation.y, running,
      )
      if (targetWeights.size > 0) {
        const nominalSpeed = running ? WALK_SPEED * RUN_MULTIPLIER : WALK_SPEED
        const dominantRole = controller.setBlendWeights(
          targetWeights,
          actualHorizontalSpeed / Math.max(0.1, nominalSpeed),
          this.activeAnimation,
        )
        if (dominantRole) {
          this.activeAnimation = dominantRole
          usedDirectionalBlend = true
        }
      }
    }
    if (controller && !usedDirectionalBlend) {
      controller.setState(state)
      this.activeAnimation = controller.currentState || state
    }
    controller?.update(dt)

    // Alguns clipes de corrida animam novamente os ossos da cabeça depois
    // que o modo primeira pessoa os esconde. Reaplica a máscara após o mixer
    // em todos os frames para impedir que a cabeça volte a aparecer ao correr.
    if (this.firstPersonMode && this.firstPersonHiddenBones.size > 0) {
      for (const bone of this.firstPersonHiddenBones.keys()) {
        bone.scale.set(0, 0, 0)
      }
    }

    // Usa animação procedural quando não existe um clipe adequado para o estado atual.
    // Isso evita deixar o avatar deslizando caso o GLB tenha apenas um clipe genérico.
    const hasStateClip = usedDirectionalBlend || Boolean(controller?.hasState(state))
    if (hasStateClip || controller?.isOneShotPlaying) {
      if (!controller?.isOneShotPlaying) this.applyFallbackCrouchPose()
      return
    }
    // A oscilação das pernas é uma marcha, não uma animação de repouso.
    // Quando o corpo não percorre distância horizontal, deixe as pernas na pose
    // neutra; o pequeno balanço respiratório continua no tronco/raiz.
    const amplitude = movingNow
      ? 0.035 + this.proceduralLocomotionBlend * (0.385 + this.proceduralRunBlend * 0.33)
      : 0
    const swing = Math.sin(this.animationTime) * amplitude
    if (this.proceduralLimbs) {
      const limbs = this.proceduralLimbs
      limbs.leftLeg.rotation.x = swing
      limbs.rightLeg.rotation.x = -swing
      limbs.leftArm.rotation.x = -swing * 0.72
      limbs.rightArm.rotation.x = swing * 0.72

      // Inclina o corpo em relação à inclinação real do terreno, amostrando a altura
      // em quatro pontos próximos ao avatar; os pés recebem ajustes independentes.
      const x = this.mesh.position.x
      const z = this.mesh.position.z
      const sample = 0.28
      const centerY = this.world.terrain.heightAt(x, z)
      const slopeX = (this.world.terrain.heightAt(x + sample, z) - this.world.terrain.heightAt(x - sample, z)) / (sample * 2)
      const slopeZ = (this.world.terrain.heightAt(x, z + sample) - this.world.terrain.heightAt(x, z - sample)) / (sample * 2)
      const yaw = this.mesh.rotation.y
      const localSlopeX = slopeX * Math.cos(yaw) - slopeZ * Math.sin(yaw)
      const localSlopeZ = slopeX * Math.sin(yaw) + slopeZ * Math.cos(yaw)
      const targetTiltX = THREE.MathUtils.clamp(localSlopeZ, -0.45, 0.45)
      const targetTiltZ = THREE.MathUtils.clamp(-localSlopeX, -0.45, 0.45)
      this.visualRoot.rotation.x = THREE.MathUtils.damp(this.visualRoot.rotation.x, targetTiltX, 7, dt)
      this.visualRoot.rotation.z = THREE.MathUtils.damp(this.visualRoot.rotation.z, targetTiltZ, 7, dt)

      const leftGround = this.world.terrain.heightAt(x - Math.cos(yaw) * 0.13, z + Math.sin(yaw) * 0.13)
      const rightGround = this.world.terrain.heightAt(x + Math.cos(yaw) * 0.13, z - Math.sin(yaw) * 0.13)
      const footAdjustLeft = THREE.MathUtils.clamp(leftGround - centerY, -0.18, 0.18)
      const footAdjustRight = THREE.MathUtils.clamp(rightGround - centerY, -0.18, 0.18)
      limbs.leftShoe.position.y = -0.49 + footAdjustLeft
      limbs.rightShoe.position.y = -0.49 + footAdjustRight
      const bob = movingNow ? Math.abs(Math.sin(this.animationTime * 2)) * (running ? 0.055 : 0.028) : Math.sin(this.animationTime * 0.5) * 0.012
      this.visualRoot.position.y = bob
      limbs.torso.rotation.x = movingNow ? Math.sin(this.animationTime * 2) * 0.025 : 0
    }
    for (const bone of this.animatedBones) {
      if (/left.*(leg|thigh|calf)|thigh.*left|leg.*left/.test(bone.name)) bone.node.rotation.x = bone.baseX + swing
      else if (/right.*(leg|thigh|calf)|thigh.*right|leg.*right/.test(bone.name)) bone.node.rotation.x = bone.baseX - swing
      else if (/left.*(arm|hand)|arm.*left/.test(bone.name)) bone.node.rotation.x = bone.baseX - swing * 0.65
      else if (/right.*(arm|hand)|arm.*right/.test(bone.name)) bone.node.rotation.x = bone.baseX + swing * 0.65
      else if (/spine|hips|pelvis/.test(bone.name)) bone.node.rotation.z = bone.baseZ + (movingNow ? Math.sin(this.animationTime * 2) * 0.025 : 0)
    }
    if (!this.proceduralLimbs) {
      if (!movingNow && this.grounded) this.visualRoot.position.y = Math.sin(this.animationTime * 0.5) * 0.012
      else this.visualRoot.position.y = 0
    }
    this.applyFallbackCrouchPose()
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
    })
  }

  /**
   * Mantém o limite padrão do editor para o terreno comum, mas deixa o jogador
   * explorar toda a extensão de cenários importados com colisor de malha estática.
   */
  private getHorizontalMovementBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = -49
    let maxX = 49
    let minZ = -49
    let maxZ = 49

    for (const object of this.world.list()) {
      const mesh = object.mesh
      if (
        !mesh.visible ||
        mesh.userData.importedModel !== true ||
        mesh.userData.colliderType !== 'mesh'
      ) continue
      const collisionData = getStaticMeshCollisionData(mesh)
      mesh.updateWorldMatrix(true, true)
      const bounds = collisionData && !collisionData.localBounds.isEmpty()
        ? collisionData.localBounds.clone().applyMatrix4(mesh.matrixWorld)
        : new THREE.Box3().setFromObject(mesh)
      if (bounds.isEmpty()) continue
      minX = Math.min(minX, bounds.min.x - 2)
      maxX = Math.max(maxX, bounds.max.x + 2)
      minZ = Math.min(minZ, bounds.min.z - 2)
      maxZ = Math.max(maxZ, bounds.max.z + 2)
    }

    return { minX, maxX, minZ, maxZ }
  }

  private playerBox(): THREE.Box3 {
    const height = this.getPlayerHeight()
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + height / 2, this.mesh.position.z),
      new THREE.Vector3(this.getPlayerRadius() * 2, height, this.getPlayerRadius() * 2),
    )
  }

  /**
   * Sonda várias posições dentro da pegada do personagem. O centro sozinho perde
   * escadas estreitas, quinas e pequenas faces triangulares se cair entre vértices.
   * O deslocamento frontal é usado durante a subida para alcançar a borda antes
   * de a caixa do personagem ficar presa na face vertical.
   */
  private getFootProbePoints(
    x: number,
    z: number,
    leadingAxis?: 'x' | 'z',
    leadingDirection = 0,
  ): Array<{ x: number; z: number }> {
    const playerRadius = this.getPlayerRadius()
    const leadingOffset = THREE.MathUtils.clamp(leadingDirection, -1, 1) * playerRadius * 0.85
    return PLAYER_SUPPORT_PROBE_FACTORS.map(([factorX, factorZ]) => ({
      x: x + factorX * playerRadius + (leadingAxis === 'x' ? leadingOffset : 0),
      z: z + factorZ * playerRadius + (leadingAxis === 'z' ? leadingOffset : 0),
    }))
  }

  /**
   * Colisão por contato com os triângulos reais das malhas, em coordenadas de mundo.
   * Faces superiores são piso/rampa; laterais e inferiores bloqueiam o jogador.
   * O AABB é usado somente para descartar malhas distantes rapidamente.
   */
  /**
   * Verifica contato com polígonos reais, limitando o custo por frame:
   * usa bounds para broad phase e testa somente triângulos próximos ao jogador.
   */
  private collidesWithObjects(
    blockCeilings = false,
    walkOffEdge: { topY: number; floorY: number } | null = null,
  ): boolean {
    const playerBox = this.playerBox()
    const playerHeight = this.getPlayerHeight()
    const playerRadius = this.getPlayerRadius()
    const sampleY = blockCeilings ? Math.max(playerHeight * 0.5, playerHeight - playerRadius) : playerHeight * 0.5
    const center = new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + sampleY, this.mesh.position.z)
    const radiusSq = playerRadius * playerRadius
    const triangle = new THREE.Triangle()
    const closest = new THREE.Vector3()
    const normal = new THREE.Vector3()
    // Distribui contatos ao longo da altura física atual: ao rastejar, os
    // pontos altos deixam de bloquear o jogador como se ele estivesse em pé.
    const bodyScale = this.getBodyScale()
    const contactSpacing = 0.26 * bodyScale
    const contactCount = Math.max(2, Math.min(16, Math.ceil(playerHeight / Math.max(0.01, contactSpacing))))
    const innerBodyHeight = Math.max(0.005, Math.min(0.05 * bodyScale, playerHeight * 0.1))
    const playerContactPoints = Array.from({ length: contactCount }, (_, index) =>
      new THREE.Vector3(
        this.mesh.position.x,
        this.mesh.position.y + Math.min(playerHeight - innerBodyHeight, 0.13 * bodyScale + index * contactSpacing),
        this.mesh.position.z,
      ),
    )
    const contactRadiusSq = (playerRadius * 1.05) ** 2
    const triangleBounds = new THREE.Box3()

    const collisionRoots = this.world.list().map((object) => object.mesh)
    for (const root of collisionRoots) {
      if (!root.visible || root.userData.colliderType === 'none') continue
      root.updateWorldMatrix(true, true)

      // O tipo escolhido no inspetor precisa determinar a colisão do jogador.
      // Antes, até mesmo "box", "sphere" e "capsule" ignoravam a forma configurada
      // aqui e continuavam consultando os triângulos visuais do modelo importado.
      // Esses tipos simplificados usam o volume físico calculado pela raiz; apenas
      // "auto" segue a geometria triangular real.
      const configuredCollider = root.userData.colliderType
      if (root.userData.importedModel === true && configuredCollider === 'mesh') {
        const staticData = getStaticMeshCollisionData(root)
        if (staticData) {
          const queryBox = blockCeilings
          ? new THREE.Box3(
              new THREE.Vector3(playerBox.min.x, playerBox.max.y - 0.12, playerBox.min.z),
              new THREE.Vector3(playerBox.max.x, playerBox.max.y + 0.02, playerBox.max.z),
            )
          : playerBox
        const blocked = visitStaticMeshTriangles(root, queryBox, triangle => {
          triangle.getNormal(normal).normalize()
          if (blockCeilings) {
            // Teto inclinado também pode estar invertido no arquivo de origem.
            return Math.abs(normal.y) >= WALKABLE_SURFACE_NORMAL_Y && queryBox.intersectsTriangle(triangle)
          }
          // Piso e rampas são tratados pelas sondas verticais; somente faces
          // relativamente verticais bloqueiam o deslocamento horizontal.
          if (Math.abs(normal.y) >= WALKABLE_SURFACE_NORMAL_Y) return false
          if (walkOffEdge) {
            const topY = Math.max(triangle.a.y, triangle.b.y, triangle.c.y)
            const bottomY = Math.min(triangle.a.y, triangle.b.y, triangle.c.y)
            const isLowLedgeFace = topY <= walkOffEdge.topY + this.getLedgeEdgeTopTolerance() &&
              bottomY >= walkOffEdge.floorY - this.getLedgeEdgeFloorTolerance()
            if (isLowLedgeFace) return false
          }
          return queryBox.intersectsTriangle(triangle)
          })
          if (blocked) return true
          continue
        }
        // Se não for possível gerar o BVH, não transforme a cidade numa caixa sólida.
        // Deixe a consulta por malhas visíveis determinar o contato local.
      }

      if (
        root.userData.importedModel === true &&
        configuredCollider !== undefined &&
        configuredCollider !== 'auto' &&
        configuredCollider !== 'mesh'
      ) {
        const colliderBounds = getColliderBounds(root)
        if (colliderBounds && this.hasVolumeOverlap(playerBox, colliderBounds)) return true
        continue
      }

      // No modo automático, a raiz do modelo importado é apenas o proxy invisível
      // de seleção. A colisão usa a superfície dos filhos visuais.
      const meshes: THREE.Mesh[] = []
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.visible) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        if (root.userData.importedModel === true && child === root) return
        meshes.push(child)
      })

      for (const mesh of meshes) {
        const geometry = mesh.geometry
        const position = geometry.getAttribute('position')
        if (!position || position.count < 3) continue
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingBox) continue

        // Primeiro, descarta malhas distantes usando o bound de repouso ampliado.
        // Ossos/morph targets podem mover vértices para fora da caixa original.
        const coarseBounds = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
        const broadphasePadding = this.getStandingPlayerHeight() * 0.42
        coarseBounds.min.x -= this.getPlayerRadius() + broadphasePadding
        coarseBounds.max.x += this.getPlayerRadius() + broadphasePadding
        coarseBounds.min.y -= this.getStandingPlayerHeight() + broadphasePadding
        coarseBounds.max.y += broadphasePadding
        coarseBounds.min.z -= this.getPlayerRadius() + broadphasePadding
        coarseBounds.max.z += this.getPlayerRadius() + broadphasePadding
        if (!playerBox.intersectsBox(coarseBounds)) continue

        // getVertexPosition aplica morph targets e, em SkinnedMesh, os ossos.
        // Ler diretamente o atributo position usa a pose de bind, que não é
        // necessariamente onde o animal aparece no viewport.
        if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.update()
        const worldVertices: THREE.Vector3[] = new Array(position.count)
        const localVertex = new THREE.Vector3()
        for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
          worldVertices[vertexIndex] = mesh.getVertexPosition(vertexIndex, localVertex.clone())
            .applyMatrix4(mesh.matrixWorld)
        }
        const deformedBounds = new THREE.Box3().setFromPoints(worldVertices)
        // A consulta de distância abaixo usa o raio físico do jogador em torno
        // do eixo central; ampliar o bound evita descartar esses contatos antes
        // que o teste de proximidade de triângulos possa executá-los.
        deformedBounds.expandByScalar(this.getPlayerRadius() * 1.05)
        if (!playerBox.intersectsBox(deformedBounds)) continue

        const index = geometry.getIndex()
        const triangleCount = Math.floor((index ? index.count : position.count) / 3)
        for (let i = 0; i < triangleCount; i++) {
          const ia = index ? index.getX(i * 3) : i * 3
          const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1
          const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2
          const a = worldVertices[ia]
          const b = worldVertices[ib]
          const c = worldVertices[ic]
          if (!a || !b || !c) continue
          triangle.set(a, b, c)
          triangle.getNormal(normal).normalize()

          if (root.userData.importedModel === true) {
            // No salto, superfícies de teto bloqueiam mesmo que a triangulação
            // tenha winding invertido; paredes verticais são filtradas pela normal.
            if (blockCeilings) {
              if (Math.abs(normal.y) < WALKABLE_SURFACE_NORMAL_Y) continue
              if (playerBox.intersectsTriangle(triangle)) return true
              continue
            }

            // Não trate um piso/rampa como parede quando o volume dos pés o toca.
            // Faces laterais continuam bloqueando, inclusive em modelos low-poly.
            if (Math.abs(normal.y) >= WALKABLE_SURFACE_NORMAL_Y) continue
            if (walkOffEdge) {
              const topY = Math.max(a.y, b.y, c.y)
              const bottomY = Math.min(a.y, b.y, c.y)
              const isLowLedgeFace = topY <= walkOffEdge.topY + LEDGE_EDGE_TOP_TOLERANCE &&
                bottomY >= walkOffEdge.floorY - this.getLedgeEdgeFloorTolerance()
              if (isLowLedgeFace) continue
            }
            if (playerBox.intersectsTriangle(triangle)) return true

            // Complementa o teste da caixa com pontos ao longo do corpo. Isso
            // evita atravessar faces triangulares estreitas entre passos de movimento.
            triangleBounds.setFromPoints([a, b, c]).expandByScalar(this.getPlayerRadius())
            if (!triangleBounds.intersectsBox(playerBox)) continue
            for (const sample of playerContactPoints) {
              triangle.closestPointToPoint(sample, closest)
              if (sample.distanceToSquared(closest) <= contactRadiusSq) return true
            }
          } else {
            // Para primitivas e plataformas, preservar o tratamento de piso,
            // rampa e teto já existente.
            if (blockCeilings) {
              if (normal.y > -WALKABLE_SURFACE_NORMAL_Y) continue
            } else if (Math.abs(normal.y) >= WALKABLE_SURFACE_NORMAL_Y) {
              continue
            }
            triangle.closestPointToPoint(center, closest)
            if (center.distanceToSquared(closest) < radiusSq) return true
          }
        }
      }
    }
    return false
  }

  /**
   * Permite subir suavemente em plataformas baixas durante a caminhada.
   * Sem isso, o teste lateral bloqueia o personagem na borda vertical da
   * primeira plataforma e ele nunca chega à superfície superior da rampa.
   */
  /**
   * Encontra degraus ou superfícies de rampa sob a pegada do jogador.
   * Consulta o BVH para cidades estáticas e raios comuns para objetos do editor.
   */
  private findStepUpSurface(
    x: number,
    z: number,
    feetY: number,
    leadingAxis: 'x' | 'z',
    leadingDirection: number,
  ): number | null {
    const playerHeight = this.getPlayerHeight()
    const reach = playerHeight + 1.15
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, feetY + playerHeight + 0.65, z),
      new THREE.Vector3(0, -1, 0),
      0,
      reach,
    )
    const allCandidates = this.world.list().filter(object =>
      object.mesh.visible && object.mesh.userData.colliderType !== 'none',
    )
    const staticCandidates = allCandidates.filter(object =>
      object.mesh.userData.importedModel === true &&
      object.mesh.userData.colliderType === 'mesh' &&
      getStaticMeshCollisionData(object.mesh) !== null,
    )
    const staticMeshColliderIds = new Set(staticCandidates.map(object => object.id))
    const candidates = allCandidates.filter(object => !staticMeshColliderIds.has(object.id))
    const points = this.getFootProbePoints(x, z, leadingAxis, leadingDirection)
    let bestSurface: number | null = null
    const normalMatrix = new THREE.Matrix3()

    for (const point of points) {
      raycaster.ray.origin.set(point.x, feetY + playerHeight + 0.65, point.z)
      if (candidates.length > 0) {
        const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)
        for (const hit of hits) {
          if (!hit.face) continue
          const owner = candidates.find(object =>
            object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
          )
          if (!owner || (owner.mesh.userData.importedModel === true && (owner.mesh.userData.colliderType !== 'mesh' || hit.object === owner.mesh))) continue
          const normal = hit.face.normal.clone()
            .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          if (normal.y < WALKABLE_SURFACE_NORMAL_Y) continue
          const rise = hit.point.y - feetY
          // A amostra pode estar na borda do pé, mas não pode içar o jogador
          // para uma parede ou plataforma alta que só aparece mais adiante.
          if (rise < -0.04 * this.getBodyScale() || rise > this.getMaxWalkStepUp()) continue
          if (bestSurface === null || hit.point.y > bestSurface) bestSurface = hit.point.y
          break
        }
      }

      for (const object of staticCandidates) {
        const hit = raycastStaticMesh(
          object.mesh,
          raycaster.ray,
          0,
          reach,
          candidate => {
            const rise = candidate.point.y - feetY
            return candidate.normal.y >= WALKABLE_SURFACE_NORMAL_Y &&
              rise >= -0.04 * this.getBodyScale() && rise <= this.getMaxWalkStepUp()
          },
        )
        if (hit && (bestSurface === null || hit.point.y > bestSurface)) bestSurface = hit.point.y
      }
    }
    return bestSurface
  }

  /**
   * Encontra o piso logo além de uma borda baixa de uma cidade importada.
   * A sonda fica à frente do pé, porque o raio central ainda pode estar sobre
   * a calçada elevada quando a caixa do jogador toca a face vertical do meio-fio.
   * Só aceita descidas pequenas e superfícies caminháveis, nunca uma parede.
   */
  private findWalkOffSurface(
    x: number,
    z: number,
    feetY: number,
    leadingAxis: 'x' | 'z',
    direction: number,
  ): number | null {
    const candidates = this.world.list().filter(object =>
      object.mesh.visible &&
      object.mesh.userData.importedModel === true &&
      object.mesh.userData.colliderType === 'mesh',
    )
    if (candidates.length === 0) return null

    const lateralOffset = this.getPlayerRadius() * 0.82
    // Verifica mais de uma distância à frente. Uma única sonda pode ainda cair
    // sobre a calçada superior quando o personagem encosta numa borda estreita.
    const bodyScale = this.getBodyScale()
    const forwardOffsets = [this.getPlayerRadius() + 0.04 * bodyScale, this.getPlayerRadius() + 0.18 * bodyScale, this.getPlayerRadius() + 0.32 * bodyScale]
    const lateralOffsets = [-lateralOffset, 0, lateralOffset]
    const points: Array<{ x: number; z: number }> = []
    for (const forwardOffset of forwardOffsets) {
      for (const lateral of lateralOffsets) {
        points.push({
          x: x + (leadingAxis === 'x' ? direction * forwardOffset : lateral),
          z: z + (leadingAxis === 'z' ? direction * forwardOffset : lateral),
        })
      }
    }
    const ray = new THREE.Ray(
      new THREE.Vector3(),
      new THREE.Vector3(0, -1, 0),
    )
    const raycaster = new THREE.Raycaster()
    const normalMatrix = new THREE.Matrix3()
    const maximumDistance = this.getMaxWalkOffDrop() + 0.08 * this.getBodyScale()
    let bestSurface: number | null = null

    for (const point of points) {
      ray.origin.set(point.x, feetY + 0.025 * this.getBodyScale(), point.z)
      for (const object of candidates) {
        if (getStaticMeshCollisionData(object.mesh)) {
          const hit = raycastStaticMesh(
            object.mesh,
            ray,
            0,
            maximumDistance,
            candidate => {
              const drop = feetY - candidate.point.y
              return candidate.normal.y >= WALKABLE_SURFACE_NORMAL_Y &&
                drop >= 0.035 * this.getBodyScale() &&
                drop <= this.getMaxWalkOffDrop()
            },
          )
          if (hit && (bestSurface === null || hit.point.y > bestSurface)) bestSurface = hit.point.y
          continue
        }

        // Fallback para cidades de altíssima densidade: usa o raycaster nas peças
        // visíveis, sem cair na caixa proxy invisível da raiz do modelo.
        raycaster.ray.copy(ray)
        raycaster.near = 0
        raycaster.far = maximumDistance
        const hits = raycaster.intersectObjects(
          object.mesh.children.filter(child => child.visible),
          true,
        )
        for (const hit of hits) {
          if (!hit.face || hit.point.y > feetY - 0.035 * this.getBodyScale()) continue
          const normal = hit.face.normal.clone()
            .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          if (normal.dot(ray.direction) > 0) normal.negate()
          const drop = feetY - hit.point.y
          if (normal.y < WALKABLE_SURFACE_NORMAL_Y || drop > this.getMaxWalkOffDrop()) continue
          if (bestSurface === null || hit.point.y > bestSurface) bestSurface = hit.point.y
          break
        }
      }
    }
    return bestSurface
  }

  private findObjectLanding(oldY: number, nextY: number): number | null {
    const playerBox = this.playerBox()
    let landing: number | null = null

    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    const allSlopeCandidates = this.world.list().filter(object =>
      object.mesh.visible && object.mesh.userData.colliderType !== 'none',
    )
    const staticCandidates = allSlopeCandidates.filter(object =>
      object.mesh.userData.importedModel === true &&
      object.mesh.userData.colliderType === 'mesh' &&
      getStaticMeshCollisionData(object.mesh) !== null,
    )
    const staticMeshColliderIds = new Set(staticCandidates.map(object => object.id))
    const slopeCandidates = allSlopeCandidates.filter(object => !staticMeshColliderIds.has(object.id))
    const rayOriginY = Math.max(oldY, nextY) + this.getPlayerHeight() + 2
    const probes = this.getFootProbePoints(this.mesh.position.x, this.mesh.position.z)
    const normalMatrix = new THREE.Matrix3()

    const isReachableSupport = (surfaceY: number): boolean => {
      const rise = surfaceY - oldY
      // Degraus pequenos são subidos sem exigir um impacto vertical. Na descida,
      // também reconhece uma superfície estreita que cruzou entre dois frames.
      const canStepOntoSurface = this.grounded && rise >= -this.getMaxWalkOffDrop() && rise <= this.getMaxWalkStepUp()
      const crossedSurface = nextY <= surfaceY + 0.04 * this.getBodyScale() && oldY >= surfaceY - 0.82 * this.getBodyScale()
      return canStepOntoSurface || crossedSurface
    }

    for (const probe of probes) {
      raycaster.ray.origin.set(probe.x, rayOriginY, probe.z)

      if (slopeCandidates.length > 0) {
        const hits = raycaster.intersectObjects(slopeCandidates.map(object => object.mesh), true)
        for (const hit of hits) {
          if (!hit.face) continue
          const owner = slopeCandidates.find(candidate =>
            candidate.mesh === hit.object || candidate.mesh.getObjectById(hit.object.id),
          )
          if (!owner) continue
          // A raiz do modelo importado é um proxy invisível; só os filhos visuais são piso.
          if (owner.mesh.userData.importedModel === true && hit.object === owner.mesh) continue
          const normal = hit.face.normal.clone()
            .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          if (normal.y < WALKABLE_SURFACE_NORMAL_Y) continue
          if (!isReachableSupport(hit.point.y)) continue
          if (landing === null || hit.point.y > landing) landing = hit.point.y
          // Os hits estão ordenados do mais próximo (maior Y) ao mais distante.
          break
        }
      }

      for (const object of staticCandidates) {
        const hit = raycastStaticMesh(
          object.mesh,
          raycaster.ray,
          0,
          Number.POSITIVE_INFINITY,
          candidate => candidate.normal.y >= WALKABLE_SURFACE_NORMAL_Y &&
            isReachableSupport(candidate.point.y),
        )
        if (hit && (landing === null || hit.point.y > landing)) landing = hit.point.y
      }
    }

    // Colisores simples continuam fornecendo a superfície superior de plataformas
    // e caixas; malhas estáticas usam os triângulos reais acima.
    if (nextY <= oldY) {
      for (const object of this.world.list()) {
        if (!object.mesh.visible || object.mesh.userData.colliderType === 'none' || object.mesh.userData.colliderType === 'mesh') continue
        const rotatedRamp = Math.abs(object.mesh.rotation.x) > 0.02 || Math.abs(object.mesh.rotation.z) > 0.02
        if (rotatedRamp) continue
        const box = getColliderBounds(object.mesh)
        if (!box) continue
        const horizontalOverlap = playerBox.max.x > box.min.x && playerBox.min.x < box.max.x &&
          playerBox.max.z > box.min.z && playerBox.min.z < box.max.z
        if (!horizontalOverlap || oldY < box.max.y - 0.08 * this.getBodyScale() || nextY > box.max.y) continue
        if (landing === null || box.max.y > landing) landing = box.max.y
      }
    }
    return landing
  }

  private hasVolumeOverlap(a: THREE.Box3, b: THREE.Box3): boolean {
    const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)
    const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)
    const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)
    return overlapX > 0.02 && overlapY > 0.02 && overlapZ > 0.02
  }

  private updateCollisionEvents(): void {
    const playerBox = this.playerBox()
    const next = new Map<string, { a: string; b: string }>()
    for (const object of this.world.list()) {
      if (!object.mesh.visible) continue
      const box = getColliderBounds(object.mesh)
      if (!box || !this.hasVolumeOverlap(playerBox, box)) continue
      const key = object.id
      next.set(key, { a: PLAYER_ID, b: object.id })
    }
    for (const [id, pair] of next) {
      if (!this.activeCollisions.has(id)) this.world.events.emit('collisionStarted', pair)
    }
    for (const [id, pair] of this.activeCollisions) {
      if (!next.has(id)) this.world.events.emit('collisionEnded', pair)
    }
    this.activeCollisions.clear()
    for (const [id, pair] of next) this.activeCollisions.set(id, pair)
  }
}

Object.assign(HumanoidAvatar.prototype, createHumanoidAvatarMountMethods())

