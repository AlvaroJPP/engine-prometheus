import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { World } from './World'
import {
  getStaticMeshCollisionData,
  raycastStaticMesh,
  visitStaticMeshTriangles,
} from './StaticMeshCollider'
import { DEFAULT_MODEL_CONTROL_BINDINGS, ONE_SHOT_ANIMATION_ROLES } from '../script/packages'
import type { MountPackageSettings, AnimationRole, MountMovementState, ModelControlBindings } from '../script/packages'
import { DEFAULT_CONTROL_MAPS } from '../input/ControlMaps'
import type { ControlMapBindings } from '../input/ControlMaps'

const PLAYER_ID = 'player'
const WALK_SPEED = 4.2
const RUN_MULTIPLIER = 1.7
const JUMP_SPEED = 6.2
const GRAVITY = 18
const PLAYER_RADIUS = 0.32
const PLAYER_HEIGHT = 1.8
const DODGE_SPEED = 10
const DODGE_DURATION = 0.22
const SLIDE_SPEED = 7.8
const SLIDE_DURATION = 0.48
const ROLL_SPEED = 6.8
const ROLL_DURATION = 0.36
const MANEUVER_COOLDOWN = 0.32
const ROLL_COOLDOWN = 0.52
// Exact triangle traversal is too expensive for dense animated GLBs during mounting.
// Imported models over this threshold use their already-configured physical bounds.
const MAX_EXACT_MOUNT_COLLISION_TRIANGLES = 6000

const ANIMATION_FALLBACKS: Partial<Record<AnimationRole, AnimationRole[]>> = {
  run: ['walk', 'idle'],
  walk_slow: ['walk', 'idle'],
  walk_backward: ['walk', 'idle'],
  walk_left: ['walk_diagonal_left', 'walk', 'idle'],
  walk_right: ['walk_diagonal_right', 'walk', 'idle'],
  walk_diagonal_left: ['walk_left', 'walk', 'idle'],
  walk_diagonal_right: ['walk_right', 'walk', 'idle'],
  run_backward: ['run', 'walk', 'idle'],
  run_left: ['run_diagonal_left', 'run', 'walk', 'idle'],
  run_right: ['run_diagonal_right', 'run', 'walk', 'idle'],
  run_diagonal_left: ['run_left', 'run', 'walk_diagonal_left', 'walk', 'idle'],
  run_diagonal_right: ['run_right', 'run', 'walk_diagonal_right', 'walk', 'idle'],
  crouch: ['idle'],
  crouch_walk: ['crouch', 'walk', 'idle'],
  prone: ['idle'],
  prone_crawl: ['prone', 'walk', 'idle'],
  jump: ['idle'],
}

type PlayerPosture = 'standing' | 'crouching' | 'prone'
type PlayerManeuver = 'dodge' | 'slide' | 'roll' | null

/** Bounds do colisor físico, independentes da malha visual importada. */
function getColliderBounds(mesh: THREE.Mesh): THREE.Box3 | null {
  const type = mesh.userData.colliderType
  if (type === 'none') return null

  mesh.updateWorldMatrix(true, false)
  if (type === 'mesh') {
    const staticData = getStaticMeshCollisionData(mesh)
    if (staticData) return staticData.localBounds.clone().applyMatrix4(mesh.matrixWorld)
  }
  const configuredSize = mesh.userData.colliderSize
  const hasManualSize = Array.isArray(configuredSize) &&
    configuredSize.length === 3 &&
    configuredSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
  const offsetData = mesh.userData.colliderOffset
  const offset = Array.isArray(offsetData) && offsetData.length === 3
    ? offsetData.map((value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0) as [number, number, number]
    : [0, 0, 0] as [number, number, number]

  // Em modelos importados, a raiz é apenas uma caixa proxy invisível. O modo automático
  // usa limites das malhas visuais filhas, calculados uma vez no espaço local do modelo.
  // Recalcular Box3 para cada subpasso de movimento percorria toda a hierarquia do GLB
  // repetidamente e congelava a execução com montarias de muitos nós/malhas.
  if ((type === undefined || type === 'auto') && !hasManualSize && offset.every(value => Math.abs(value) < 1e-9)) {
    if (mesh.userData.importedModel === true) {
      type CachedAutoBounds = { min: [number, number, number]; max: [number, number, number] }
      const cached = mesh.userData.importedAutoColliderLocalBounds as CachedAutoBounds | undefined
      if (
        cached &&
        Array.isArray(cached.min) && cached.min.length === 3 &&
        Array.isArray(cached.max) && cached.max.length === 3
      ) {
        return new THREE.Box3(
          new THREE.Vector3(...cached.min),
          new THREE.Vector3(...cached.max),
        ).applyMatrix4(mesh.matrixWorld)
      }

      mesh.updateWorldMatrix(true, true)
      const visualBounds = new THREE.Box3()
      const childBounds = new THREE.Box3()
      const inverseRoot = mesh.matrixWorld.clone().invert()
      const relativeMatrix = new THREE.Matrix4()
      mesh.traverse((child) => {
        if (child === mesh || !(child instanceof THREE.Mesh) || !child.visible) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        child.updateWorldMatrix(true, false)
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
        if (!child.geometry.boundingBox) return
        relativeMatrix.multiplyMatrices(inverseRoot, child.matrixWorld)
        childBounds.copy(child.geometry.boundingBox).applyMatrix4(relativeMatrix)
        visualBounds.union(childBounds)
      })
      if (!visualBounds.isEmpty()) {
        mesh.userData.importedAutoColliderLocalBounds = {
          min: visualBounds.min.toArray() as [number, number, number],
          max: visualBounds.max.toArray() as [number, number, number],
        }
        return visualBounds.applyMatrix4(mesh.matrixWorld)
      }
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    return (mesh.geometry.boundingBox?.clone() ?? new THREE.Box3()).applyMatrix4(mesh.matrixWorld)
  }

  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const sourceSize = mesh.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1)
  const size = hasManualSize
    ? new THREE.Vector3(
      Math.max(0.05, configuredSize[0]),
      Math.max(0.05, configuredSize[1]),
      Math.max(0.05, configuredSize[2]),
    )
    : sourceSize

  // O sistema de colisão do mundo também trata os colisores simplificados como
  // geometria local deslocada; este AABB é usado pelo player para movimento e pouso.
  if (type === 'sphere') {
    const radius = Math.max(size.x, size.y, size.z) * 0.5
    size.setScalar(radius * 2)
  } else if (type === 'capsule') {
    const radius = Math.max(0.025, Math.min(size.x, size.z) * 0.25)
    size.set(Math.max(size.x, radius * 2), Math.max(size.y, radius * 2), Math.max(size.z, radius * 2))
  }

  const localBounds = new THREE.Box3(
    new THREE.Vector3(-size.x / 2 + offset[0], -size.y / 2 + offset[1], -size.z / 2 + offset[2]),
    new THREE.Vector3(size.x / 2 + offset[0], size.y / 2 + offset[1], size.z / 2 + offset[2]),
  )
  return localBounds.applyMatrix4(mesh.matrixWorld)
}

/** Avatar humanoide controlável por teclado, com gravidade e colisões com terreno/objetos. */
export class HumanoidAvatar {
  readonly mesh = new THREE.Group()
  private readonly visualRoot = new THREE.Group()
  private disposed = false
  private modelLoadRevision = 0
  private mixer: THREE.AnimationMixer | null = null
  private animationActions = new Map<string, THREE.AnimationAction>()
  private activeAnimation = ''
  private activeOneShotAnimation: AnimationRole | null = null
  private playerMountTransition: 'mount' | null = null
  private animationTime = 0
  private animatedBones: Array<{ node: THREE.Object3D; name: string; baseX: number; baseY: number; baseZ: number; basePosition: THREE.Vector3 }> = []
  private proceduralLimbs: { leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; leftShoe: THREE.Mesh; rightShoe: THREE.Mesh; torso: THREE.Mesh } | null = null
  private readonly world: World
  private readonly cameraTarget: THREE.Vector3
  private readonly getCameraYaw: () => number
  private readonly pressed = new Set<string>()
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

  private getPlayerHeight(): number {
    if (this.posture === 'prone') return 0.62
    if (this.posture === 'crouching') return 1.12
    return PLAYER_HEIGHT
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
        this.dodgeRequested = true
        return
      }
      if (event.code === bindings.slide) {
        this.slideRequested = true
        return
      }
      if (event.code === bindings.roll) {
        this.rollRequested = true
        return
      }
    }

    if (event.code === bindings.jump && this.mountedRoot && !event.repeat) {
      this.mountedJumpRequested = true
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
  private readonly onBlur = (): void => this.pressed.clear()

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
    const bindings = this.controlBindings()
    const forwardInput = Number(this.pressed.has(bindings.forward)) - Number(this.pressed.has(bindings.backward))
    const sideInput = Number(this.pressed.has(bindings.right)) - Number(this.pressed.has(bindings.left))
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

    if (this.pressed.has(bindings.jump) && this.grounded) {
      this.verticalVelocity = JUMP_SPEED
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
      const oldFeetY = this.mesh.position.y

      // Faça a varredura horizontal em incrementos pequenos. Um único teste no
      // ponto final pode saltar uma perna ou uma face low-poly quando o quadro
      // chega lento; a varredura mantém contato com as superfícies reais.
      const moveAxis = (axis: 'x' | 'z', delta: number): void => {
        if (Math.abs(delta) < 1e-8) return
        const origin = this.mesh.position[axis]
        const maxSubstep = Math.min(0.08, PLAYER_RADIUS * 0.25)
        const steps = Math.max(1, Math.ceil(Math.abs(delta) / maxSubstep))
        let lastSafe = origin

        for (let index = 1; index <= steps; index += 1) {
          const coordinate = THREE.MathUtils.clamp(
            origin + delta * index / steps,
            -49,
            49,
          )
          this.mesh.position[axis] = coordinate

          if (!this.collidesWithObjects()) {
            lastSafe = coordinate
            continue
          }

          const stepUp = wasGrounded
            ? this.findStepUpSurface(this.mesh.position.x, this.mesh.position.z, oldFeetY)
            : null
          if (stepUp !== null) {
            const previousY = this.mesh.position.y
            this.mesh.position.y = stepUp
            if (!this.collidesWithObjects()) {
              horizontalStepY = stepUp
              this.verticalVelocity = 0
              lastSafe = coordinate
              continue
            }
            this.mesh.position.y = previousY
          }

          // Para no último ponto livre, sem reverter o outro eixo nem teleportar.
          this.mesh.position[axis] = lastSafe
          break
        }
      }

      moveAxis('x', direction.x)
      moveAxis('z', direction.z)
      if (direction.lengthSq() > 1e-8) this.mesh.rotation.y = Math.atan2(direction.x, direction.z)
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
    const canFollowSlopeDown = wasGrounded &&
      length > 0 &&
      this.verticalVelocity <= 0 &&
      terrainDrop >= -0.08 &&
      terrainDrop <= Math.max(0.32, speed * step * 1.5)

    const canLandOnObject = landing !== null &&
      this.verticalVelocity <= 0 &&
      landing >= newGroundY &&
      (
        nextY <= landing + 0.05 ||
        (wasGrounded && length > 0 && landing >= oldY - 0.3 && landing <= oldY + 0.5)
      )

    // Plataformas/rampas têm prioridade sobre o terreno base. Caso contrário,
    // um quadro em que nextY chega ao nível do terreno pode apagar o pouso
    // válido numa plataforma logo acima dele.
    if (canLandOnObject && landing !== null) {
      this.mesh.position.y = landing
      this.verticalVelocity = 0
      this.grounded = true
    } else if (nextY <= newGroundY || canFollowSlopeDown) {
      this.mesh.position.y = newGroundY
      this.verticalVelocity = 0
      this.grounded = true
    } else if (landing !== null && this.verticalVelocity <= 0) {
      this.mesh.position.y = landing
      this.verticalVelocity = 0
      this.grounded = true
    } else {
      this.grounded = false
    }

    this.updateAvatarAnimation(step, length > 0 || this.maneuver !== null, running, forwardInput, sideInput)
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

  isMounted(): boolean {
    return this.mountedRoot !== null
  }

  getMountedObjectId(): string | null {
    const id = this.mountedRoot?.userData.id
    return typeof id === 'string' ? id : null
  }

  getMountedMovementState(): MountMovementState | null {
    return this.mountedRoot ? this.mountedMovementState : null
  }

  /** Aplica alterações de configuração do pacote enquanto o jogador já está montado. */
  updateMountSettings(settings: MountPackageSettings): void {
    if (!this.mountedRoot) return
    this.mountSettings = {
      interactionKey: settings.interactionKey,
      seatOffset: [...settings.seatOffset],
      speed: settings.speed,
      runMultiplier: settings.runMultiplier,
      interactionRadius: settings.interactionRadius,
      modelStates: settings.modelStates.map(rule => ({ ...rule })),
      controlBindings: { ...settings.controlBindings },
    }
  }

  /** Vincula o avatar a qualquer objeto que tenha recebido o pacote Montaria. */
  mount(root: THREE.Mesh, settings: MountPackageSettings): boolean {
    if (!this.enabled || this.mountedRoot || !root.visible) return false

    this.mountedRoot = root
    // A física mantém a raiz/colisor nivelados. Somente o pivô visual do GLB
    // pode inclinar para acompanhar o plano da rampa sem girar a caixa física.
    this.mountedVisualPivot = root.getObjectByName('ImportedVisualPivot') ?? null
    this.mountedVisualBaseQuaternion = this.mountedVisualPivot?.quaternion.clone() ?? null
    // O controle montado passa a ser o dono exclusivo do movimento/colisão horizontal.
    root.userData.mountCollisionManaged = true
    this.mountedStartPosition = root.position.clone()
    this.mountedStartRotation = root.rotation.clone()
    this.mountedMovementState = 'idle'
    this.mountedJumpRequested = false
    this.mountedAirborne = false
    this.mountedVerticalVelocity = 0
    this.mountedSupportProbeElapsed = 1
    this.mountedHasSupportProbe = false
    this.mountedLastSupportProbePosition.copy(root.position)
    this.mountSettings = {
      interactionKey: settings.interactionKey,
      seatOffset: [...settings.seatOffset],
      speed: settings.speed,
      runMultiplier: settings.runMultiplier,
      interactionRadius: settings.interactionRadius,
      modelStates: settings.modelStates.map(rule => ({ ...rule })),
      controlBindings: { ...settings.controlBindings },
    }
    // Ambos os modelos iniciam o papel "mount" no mesmo evento do pacote.
    // O jogador fica visível durante o clipe próprio e some ao concluir a transição.
    this.visualRoot.visible = true
    this.placeAvatarAtMountSeat()
    if (this.animationActions.has('mount')) {
      this.playerMountTransition = 'mount'
      this.playAnimation('mount', true)
    } else {
      this.playerMountTransition = null
      this.visualRoot.visible = false
    }
    this.playMountAnimation(root, 'mount', true)
    if (!root.userData.importAnimationActions ||
        !(root.userData.importAnimationActions as Partial<Record<AnimationRole, THREE.AnimationAction>>).mount) {
      this.playMountAnimation(root, 'idle')
    }
    this.verticalVelocity = 0
    this.grounded = true
    this.activeCollisions.clear()
    this.pressed.clear()
    return true
  }

  private updateMountedPlayerTransition(dt: number): void {
    if (!this.mixer || !this.playerMountTransition) return
    this.mixer.update(dt)
    const action = this.animationActions.get(this.playerMountTransition)
    if (action?.isRunning()) return
    this.playerMountTransition = null
    this.activeOneShotAnimation = null
    this.visualRoot.visible = false
  }

  /** Desvincula o jogador e o posiciona junto ao lado livre da montaria. */
  dismount(): string | null {
    const root = this.mountedRoot
    if (!root) return null

    const rootId = typeof root.userData.id === 'string' ? root.userData.id : null
    const positionChanged = this.mountedStartPosition
      ? root.position.distanceToSquared(this.mountedStartPosition) > 1e-6
      : false
    const rotationChanged = this.mountedStartRotation
      ? Math.abs(root.rotation.x - this.mountedStartRotation.x) > 1e-4 ||
        Math.abs(root.rotation.y - this.mountedStartRotation.y) > 1e-4 ||
        Math.abs(root.rotation.z - this.mountedStartRotation.z) > 1e-4
      : false
    root.updateWorldMatrix(true, true)
    this.playMountAnimation(root, 'dismount', true)
    if (this.mountedVisualPivot && this.mountedVisualBaseQuaternion) {
      this.mountedVisualPivot.quaternion.copy(this.mountedVisualBaseQuaternion)
      this.mountedVisualPivot.updateMatrixWorld(true)
    }
    this.mountedVisualPivot = null
    this.mountedVisualBaseQuaternion = null
    root.userData.mountCollisionManaged = false

    const bounds = getColliderBounds(root) ?? new THREE.Box3().setFromObject(root)
    const halfWidth = Math.max(0.45, bounds.getSize(new THREE.Vector3()).x * 0.5)
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion).setY(0).normalize()
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
    const dismountDistance = halfWidth + PLAYER_RADIUS + 0.4
    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(root.quaternion)
      .setY(0)
      .normalize()
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1)
    const candidates = [
      root.position.clone().addScaledVector(side, dismountDistance),
      root.position.clone().addScaledVector(side, -dismountDistance),
      root.position.clone().addScaledVector(forward, dismountDistance),
      root.position.clone().addScaledVector(forward, -dismountDistance),
      root.position.clone().addScaledVector(side, dismountDistance * 0.72).addScaledVector(forward, dismountDistance * 0.72),
      root.position.clone().addScaledVector(side, dismountDistance * 0.72).addScaledVector(forward, -dismountDistance * 0.72),
      root.position.clone().addScaledVector(side, -dismountDistance * 0.72).addScaledVector(forward, dismountDistance * 0.72),
      root.position.clone().addScaledVector(side, -dismountDistance * 0.72).addScaledVector(forward, -dismountDistance * 0.72),
    ]

    this.mountedRoot = null
    this.mountSettings = null
    this.mountedMovementState = 'idle'
    this.mountedJumpRequested = false
    this.mountedAirborne = false
    this.mountedVerticalVelocity = 0
    this.mountedStartPosition = null
    this.mountedStartRotation = null
    this.visualRoot.visible = true
    this.playerMountTransition = null
    this.pressed.clear()
    let placed = false

    const mountFeetY = bounds.min.y
    let placedSupportY: number | null = null
    for (const candidate of candidates) {
      const x = THREE.MathUtils.clamp(candidate.x, -49, 49)
      const z = THREE.MathUtils.clamp(candidate.z, -49, 49)
      const supportY = this.findDismountSupportY(x, z, mountFeetY, root)
      if (supportY === null) continue

      // Se o candidato está além da borda, não teleporta o jogador para o chão
      // vários metros abaixo: deixa-o sair lateralmente e cair com a gravidade.
      const hasNearbyFloor = supportY >= mountFeetY - 0.65
      this.mesh.position.set(x, (hasNearbyFloor ? supportY : mountFeetY) + 0.025, z)
      this.mesh.updateMatrixWorld(true)
      if (!this.collidesWithObjects()) {
        placed = true
        placedSupportY = hasNearbyFloor ? supportY : null
        break
      }
    }

    // Em plataformas estreitas, tenta pontos laterais adicionais antes de usar
    // um fallback, evitando colocar o avatar sob a plataforma por erro de altura.
    if (!placed) {
      const radius = dismountDistance + 0.45
      for (let index = 0; index < 12; index += 1) {
        const angle = (Math.PI * 2 * index) / 12
        const x = THREE.MathUtils.clamp(root.position.x + Math.cos(angle) * radius, -49, 49)
        const z = THREE.MathUtils.clamp(root.position.z + Math.sin(angle) * radius, -49, 49)
        const supportY = this.findDismountSupportY(x, z, mountFeetY, root)
        if (supportY === null) continue
        const hasNearbyFloor = supportY >= mountFeetY - 0.65
        this.mesh.position.set(x, (hasNearbyFloor ? supportY : mountFeetY) + 0.025, z)
        this.mesh.updateMatrixWorld(true)
        if (!this.collidesWithObjects()) {
          placed = true
          placedSupportY = hasNearbyFloor ? supportY : null
          break
        }
      }
    }

    if (!placed) {
      // Último recurso: mantém a altura da montaria e permite que a física
      // resolva uma eventual queda. Não posiciona o jogador diretamente sob ela.
      const x = THREE.MathUtils.clamp(root.position.x + dismountDistance, -49, 49)
      const z = THREE.MathUtils.clamp(root.position.z, -49, 49)
      this.mesh.position.set(x, mountFeetY + 0.025, z)
      this.mesh.updateMatrixWorld(true)
      placedSupportY = null
    }
    this.verticalVelocity = 0
    this.grounded = placedSupportY !== null
    this.activeCollisions.clear()
    this.cameraTarget.set(this.mesh.position.x, this.mesh.position.y + 1, this.mesh.position.z)
    const hasDismountAnimation = this.animationActions.has('dismount')
    this.playAnimation(hasDismountAnimation ? 'dismount' : 'idle', hasDismountAnimation)
    // A cena só é notificada uma vez, ao sair da montaria e apenas se a
    // entidade realmente mudou de posição/rotação durante a execução.
    if (rootId && (positionChanged || rotationChanged)) this.world.notifyChanged(rootId)
    return rootId
  }

  private placeAvatarAtMountSeat(): void {
    const root = this.mountedRoot
    const settings = this.mountSettings
    if (!root || !settings) return
    root.updateWorldMatrix(true, true)
    const seat = root.localToWorld(new THREE.Vector3(...settings.seatOffset))
    this.mesh.position.copy(seat)
    this.mesh.updateMatrixWorld(true)
    this.cameraTarget.set(seat.x, seat.y + 0.9, seat.z)
  }

  /**
   * Obtém a superfície caminhável diretamente sob um ponto de desmontagem.
   * A altura do terreno é apenas um fallback; plataformas, rampas e objetos
   * elevados têm prioridade quando existe piso sob o candidato.
   */
  private findDismountSupportY(
    x: number,
    z: number,
    referenceFeetY: number,
    ignoredRoot: THREE.Mesh,
  ): number | null {
    const terrainY = this.world.terrain.heightAt(x, z)
    let supportY: number | null = terrainY
    const originY = Math.max(referenceFeetY + PLAYER_HEIGHT + 2, terrainY + PLAYER_HEIGHT + 2)
    const lowestAllowedY = terrainY - 0.15
    const allCandidates = this.world.list().filter(object =>
      object.mesh !== ignoredRoot &&
      object.mesh.visible &&
      object.mesh.userData.colliderType !== 'none',
    )
    const staticCandidates = allCandidates.filter(object =>
      object.mesh.userData.importedModel === true &&
      object.mesh.userData.colliderType === 'mesh' &&
      getStaticMeshCollisionData(object.mesh) !== null,
    )
    const staticIds = new Set(staticCandidates.map(object => object.id))
    const candidates = allCandidates.filter(object => !staticIds.has(object.id))
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, originY, z),
      new THREE.Vector3(0, -1, 0),
      0,
      Math.max(1, originY - lowestAllowedY),
    )
    const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)
    const normalMatrix = new THREE.Matrix3()

    for (const hit of hits) {
      if (!hit.face) continue
      const owner = candidates.find(object =>
        object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
      )
      if (!owner) continue
      if (owner.mesh.userData.importedModel === true && hit.object === owner.mesh) continue
      const normal = hit.face.normal.clone()
        .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
        .normalize()
      if (normal.y < 0.45) continue
      if (hit.point.y > referenceFeetY + 0.45 || hit.point.y < lowestAllowedY) continue

      if (supportY === null || hit.point.y > supportY) supportY = hit.point.y
      break
    }

    for (const object of staticCandidates) {
      const hit = raycastStaticMesh(object.mesh, raycaster.ray, 0, Math.max(1, originY - lowestAllowedY), candidate =>
        candidate.normal.y >= 0.45 &&
        candidate.point.y <= referenceFeetY + 0.45 &&
        candidate.point.y >= lowestAllowedY,
      )
      if (hit) supportY = supportY === null ? hit.point.y : Math.max(supportY, hit.point.y)
    }

    // Primitivas com colisor configurado também têm uma face superior válida
    // mesmo que o raycast visual não retorne uma interseção utilizável.
    for (const object of candidates) {
      if (object.mesh.userData.importedModel === true) continue
      const rotated = Math.abs(object.mesh.rotation.x) > 0.02 || Math.abs(object.mesh.rotation.z) > 0.02
      if (rotated) continue
      const box = getColliderBounds(object.mesh)
      if (!box || x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue
      const surfaceY = box.max.y
      if (surfaceY > referenceFeetY + 0.45 || surfaceY < lowestAllowedY) continue
      supportY = supportY === null ? surfaceY : Math.max(supportY, surfaceY)
    }

    return supportY
  }

  private playMountAnimation(root: THREE.Mesh, role: AnimationRole, oneShot = false): void {
    const actions = root.userData.importAnimationActions as Partial<Record<AnimationRole, THREE.AnimationAction>> | undefined
    if (!actions) return
    const transition = root.userData.importAnimationTransition as AnimationRole | undefined
    const transitionAction = transition ? actions[transition] : undefined
    // A transição de parar a corrida pode ser interrompida caso o jogador volte a mover-se,
    // mas idle não deve cancelar a própria animação de parada antes que ela termine.
    if (!oneShot && transitionAction?.isRunning() && (transition !== 'run_stop' || role === 'idle')) return

    const locomotionFallbacks: Partial<Record<AnimationRole, AnimationRole[]>> = {
      walk: ['idle'],
      run: ['walk', 'idle'],
      walk_diagonal_left: ['walk', 'idle'],
      walk_diagonal_right: ['walk', 'idle'],
      run_diagonal_left: ['walk_diagonal_left', 'run', 'walk', 'idle'],
      run_diagonal_right: ['walk_diagonal_right', 'run', 'walk', 'idle'],
      idle: ['walk', 'run'],
    }
    const candidates: AnimationRole[] = ['mount', 'dismount', 'run_stop'].includes(role)
      ? [role]
      : [role, ...(locomotionFallbacks[role] ?? [])]
    const nextRole = candidates.find(candidate => actions[candidate])
    const next = nextRole ? actions[nextRole] : undefined
    if (!next) {
      if (oneShot && ONE_SHOT_ANIMATION_ROLES.has(role)) {
        root.userData.importAnimationTransition = undefined
        const idle = actions.idle ?? actions.walk ?? actions.run ?? actions.walk_diagonal_left ?? actions.walk_diagonal_right
        if (idle) {
          idle.setLoop(THREE.LoopRepeat, Infinity)
          idle.clampWhenFinished = false
          idle.reset().fadeIn(0.15).play()
          const fallbackAction = root.userData.importAnimationFallbackAction as THREE.AnimationAction | undefined
          if (fallbackAction && fallbackAction !== idle && fallbackAction.isRunning()) fallbackAction.fadeOut(0.15)
          for (const action of Object.values(actions)) {
            if (action && action !== idle && action.isRunning()) action.fadeOut(0.15)
          }
          root.userData.importAnimationState = idle === actions.idle ? 'idle'
            : idle === actions.walk ? 'walk' : idle === actions.run ? 'run'
              : idle === actions.walk_diagonal_left ? 'walk_diagonal_left' : 'walk_diagonal_right'
        } else {
          const currentRole = root.userData.importAnimationState as AnimationRole | undefined
          const current = currentRole ? actions[currentRole] : undefined
          current?.stop()
          const fallbackAction = root.userData.importAnimationFallbackAction as THREE.AnimationAction | undefined
          fallbackAction?.stop()
          root.userData.importAnimationState = ''
        }
      }
      return
    }

    const currentRole = root.userData.importAnimationState as AnimationRole | undefined
    const current = currentRole ? actions[currentRole] : undefined
    if (current === next && next.isRunning()) return

    if (oneShot) {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
      root.userData.importAnimationTransition = role
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity)
      next.clampWhenFinished = false
      root.userData.importAnimationTransition = undefined
    }
    next.reset().fadeIn(0.15).play()
    const fallbackAction = root.userData.importAnimationFallbackAction as THREE.AnimationAction | undefined
    if (fallbackAction && fallbackAction !== next && fallbackAction.isRunning()) fallbackAction.fadeOut(0.15)
    for (const action of Object.values(actions)) {
      if (action && action !== next && action.isRunning()) action.fadeOut(0.15)
    }
    root.userData.importAnimationState = role
  }

  /**
   * Inclina apenas o GLB visual para acompanhar a normal da rampa.
   * A raiz invisível permanece nivelada e continua sendo a fonte da colisão;
   * assim a inclinação visual não gira a caixa física nem altera o movimento.
   */
  private updateMountedVisualSlope(root: THREE.Mesh, dt: number): void {
    const pivot = this.mountedVisualPivot
    const baseQuaternion = this.mountedVisualBaseQuaternion
    if (!pivot || !baseQuaternion) return

    let targetQuaternion = baseQuaternion.clone()

    if (!this.mountedAirborne) {
      const bounds = this.getMountedBounds(root)
      const feetY = bounds.min.y
      const size = bounds.getSize(new THREE.Vector3())
      const originY = bounds.max.y + 0.25
      const lowestY = feetY - Math.max(1.25, size.y * 0.45)
      const allCandidates = this.world.list().filter(object =>
        object.mesh !== root &&
        object.mesh.visible &&
        object.mesh.userData.colliderType !== 'none',
      )
      const staticCandidates = allCandidates.filter(object =>
        object.mesh.userData.colliderType === 'mesh' &&
        getStaticMeshCollisionData(object.mesh) !== null,
      )
      const staticIds = new Set(staticCandidates.map(object => object.id))
      const candidates = allCandidates.filter(object =>
        !staticIds.has(object.id) && object.mesh.userData.importedModel !== true,
      )
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(root.position.x, originY, root.position.z),
        new THREE.Vector3(0, -1, 0),
        0,
        Math.max(1, originY - lowestY),
      )

      const makeTilt = (worldNormal: THREE.Vector3): THREE.Quaternion => {
        // A normal em coordenadas locais remove o yaw da raiz. Uma rampa plana
        // produz identidade; uma rampa inclinada gera pitch/roll sem virar o cavalo.
        root.updateWorldMatrix(true, true)
        const inverseRootRotation = root.getWorldQuaternion(new THREE.Quaternion()).invert()
        const localNormal = worldNormal.clone().applyQuaternion(inverseRootRotation).normalize()
        const tilt = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          localNormal,
        )

        // Limita apenas a inclinação visual; a altura e as colisões continuam
        // calculadas pelo movimento físico da raiz.
        const maxTilt = THREE.MathUtils.degToRad(42)
        const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(tilt.w), 0, 1))
        if (angle > maxTilt && angle > 1e-5) {
          return new THREE.Quaternion().identity().slerp(tilt, maxTilt / angle).multiply(baseQuaternion)
        }
        return tilt.multiply(baseQuaternion)
      }

      let foundSupport = false
      if (candidates.length > 0) {
        const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)
        const normalMatrix = new THREE.Matrix3()

        for (const hit of hits) {
          if (!hit.face) continue
          const owner = candidates.find(object =>
            object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
          )
          if (!owner) continue

          const worldNormal = hit.face.normal.clone()
            .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          if (worldNormal.y < 0.25) continue
          if (hit.point.y > feetY + 0.35 || hit.point.y < lowestY) continue

          targetQuaternion = makeTilt(worldNormal)
          foundSupport = true
          break
        }
      }

      if (!foundSupport && staticCandidates.length > 0) {
        let bestHit: ReturnType<typeof raycastStaticMesh> = null
        for (const object of staticCandidates) {
          const hit = raycastStaticMesh(
            object.mesh,
            raycaster.ray,
            0,
            Math.max(1, originY - lowestY),
            candidate => candidate.normal.y >= 0.25 &&
              candidate.point.y <= feetY + 0.35 &&
              candidate.point.y >= lowestY,
          )
          if (hit && (!bestHit || hit.point.y > bestHit.point.y)) bestHit = hit
        }
        if (bestHit) targetQuaternion = makeTilt(bestHit.normal)
      }
    }

    const blend = 1 - Math.exp(-10 * Math.max(0, dt))
    pivot.quaternion.slerp(targetQuaternion, blend)
    root.updateWorldMatrix(true, true)
  }

  private updateMountedMovement(
    dt: number,
    forwardInput: number,
    sideInput: number,
    running: boolean,
    walkingSlow: boolean,
  ): void {
    const root = this.mountedRoot
    const settings = this.mountSettings
    if (!root || !settings) return

    const length = Math.hypot(forwardInput, sideInput)
    this.mountedSupportProbeElapsed += dt
    const shouldJump = this.mountedJumpRequested && !this.mountedAirborne
    this.mountedJumpRequested = false
    let state: MountMovementState = 'idle'

    if (length > 0) {
      const direction = new THREE.Vector3(
        sideInput * Math.cos(this.getCameraYaw()) - forwardInput * Math.sin(this.getCameraYaw()),
        0,
        -sideInput * Math.sin(this.getCameraYaw()) - forwardInput * Math.cos(this.getCameraYaw()),
      ).normalize()
      const speed = settings.speed * (running ? settings.runMultiplier : walkingSlow ? 0.48 : 1)
      direction.multiplyScalar(speed * dt)

      const initialBounds = this.getMountedBounds(root)
      let feetY = initialBounds.min.y
      const moveAxis = (axis: 'x' | 'z', delta: number): void => {
        if (Math.abs(delta) < 1e-8) return
        const origin = root.position[axis]
        const maxSubstep = Math.min(0.08, PLAYER_RADIUS * 0.25)
        const count = Math.max(1, Math.ceil(Math.abs(delta) / maxSubstep))
        let lastSafe = origin
        let lastSafeY = root.position.y

        for (let step = 1; step <= count; step += 1) {
          root.position[axis] = THREE.MathUtils.clamp(origin + delta * step / count, -49, 49)
          root.updateWorldMatrix(true, true)

          // Ajusta a altura a cada subpasso, antes do teste lateral. Assim, a
          // montaria acompanha a subida gradual da rampa em vez de bater na sua face.
          if (!this.mountedAirborne && this.shouldRefreshMountedSupport(root, true)) {
            const supported = this.followMountedSurfaceAtStep(root, Math.abs(delta) / count)
            if (!supported) {
              // Se a montaria saiu da borda da rampa, deixa de congelar a altura:
              // inicia queda física em vez de continuar andando suspensa no ar.
              this.mountedAirborne = true
              this.mountedVerticalVelocity = 0
            }
          }

          if (!this.mountedCollidesWithObjects(root)) {
            lastSafe = root.position[axis]
            lastSafeY = root.position.y
            feetY = this.getMountedBounds(root).min.y
            continue
          }

          // Como o player, a montaria pode subir degraus baixos; faces laterais
          // bloqueiam, enquanto a face superior pode virar uma nova superfície de apoio.
          const stepSurface = this.findMountedStepUpSurface(root, feetY, axis, Math.sign(delta))
          if (stepSurface !== null) {
            const previousY = root.position.y
            const bounds = this.getMountedBounds(root)
            root.position.y += stepSurface - bounds.min.y
            root.updateWorldMatrix(true, true)
            if (!this.mountedCollidesWithObjects(root)) {
              lastSafe = root.position[axis]
              lastSafeY = root.position.y
              feetY = this.getMountedBounds(root).min.y
              continue
            }
            root.position.y = previousY
            root.updateWorldMatrix(true, true)
          }

          // Para no último ponto livre, preservando o movimento pelo outro eixo.
          root.position[axis] = lastSafe
          root.position.y = lastSafeY
          root.updateWorldMatrix(true, true)
          break
        }
      }

      moveAxis('x', direction.x)
      moveAxis('z', direction.z)
      root.rotation.y = Math.atan2(direction.x, direction.z)
      root.updateWorldMatrix(true, true)

      if (forwardInput !== 0 && sideInput !== 0) {
        state = running
          ? (sideInput < 0 ? 'run_diagonal_left' : 'run_diagonal_right')
          : (sideInput < 0 ? 'walk_diagonal_left' : 'walk_diagonal_right')
      } else {
        state = running ? 'run' : 'walk'
      }
    }

    // O pulo montado precisa de física própria: só tocar a animação não desloca
    // a raiz do cavalo. Velocidade vertical e gravidade mantêm o salto até aterrissar.
    if (shouldJump && !this.mountedAirborne) {
      this.mountedAirborne = true
      this.mountedVerticalVelocity = JUMP_SPEED
    }

    if (this.mountedAirborne) {
      const previousRootY = root.position.y
      const previousBounds = this.getMountedBounds(root)
      const previousFeetY = previousBounds.min.y

      root.position.y += this.mountedVerticalVelocity * dt
      root.updateWorldMatrix(true, true)

      // Bloqueia a subida ao atingir a parte inferior de um teto.
      if (this.mountedVerticalVelocity > 0 && this.mountedCollidesWithCeiling(root, previousRootY)) {
        root.position.y = previousRootY
        this.mountedVerticalVelocity = 0
        root.updateWorldMatrix(true, true)
      }

      this.mountedVerticalVelocity -= GRAVITY * dt
      const currentBounds = this.getMountedBounds(root)
      const supportY = this.findMountedGroundSurface(root, currentBounds)
      if (
        this.mountedVerticalVelocity <= 0 &&
        previousFeetY >= supportY - 0.05 &&
        currentBounds.min.y <= supportY + 0.05
      ) {
        root.position.y += supportY - currentBounds.min.y
        this.mountedVerticalVelocity = 0
        this.mountedAirborne = false
        root.updateWorldMatrix(true, true)
      }
    } else if (length === 0 && this.shouldRefreshMountedSupport(root, false)) {
      // Em repouso, o piso não precisa ser amostrado novamente a cada frame.
      // Revalidamos periodicamente e ao mover a montaria para acompanhar rampas
      // sem manter a interface ocupada com raycasts redundantes.
      const beforeGroundingY = root.position.y
      const supported = this.followMountedSurfaceAtStep(root, 0.08)
      if (!supported) {
        this.mountedAirborne = true
        this.mountedVerticalVelocity = 0
      } else if (this.mountedCollidesWithObjects(root)) {
        root.position.y = beforeGroundingY
        root.updateWorldMatrix(true, true)
      }
    }

    this.updateMountedVisualSlope(root, dt)
    this.placeAvatarAtMountSeat()
    const previousState = this.mountedMovementState
    this.mountedMovementState = state
    if (shouldJump) {
      this.playMountAnimation(root, 'jump', true)
    } else if (state === 'idle' && (previousState === 'run' || previousState === 'run_diagonal_left' || previousState === 'run_diagonal_right')) {
      this.playMountAnimation(root, 'run_stop', true)
    } else {
      this.playMountAnimation(root, state)
    }
    this.cameraTarget.x = THREE.MathUtils.lerp(this.cameraTarget.x, this.mesh.position.x, 0.2)
    this.cameraTarget.y = THREE.MathUtils.lerp(this.cameraTarget.y, this.mesh.position.y + 0.9, 0.2)
    this.cameraTarget.z = THREE.MathUtils.lerp(this.cameraTarget.z, this.mesh.position.z, 0.2)
  }

  /**
   * Support probing is expensive: each probe raycasts the nearby scene at nine
   * positions. Reuse the last result for short intervals instead of repeating
   * those raycasts every movement micro-step and every idle frame.
   */
  private shouldRefreshMountedSupport(root: THREE.Mesh, moving: boolean): boolean {
    const movedDistanceSq = this.mountedHasSupportProbe
      ? this.mountedLastSupportProbePosition.distanceToSquared(root.position)
      : Number.POSITIVE_INFINITY
    const distanceThreshold = moving ? 0.035 : 0.0025
    const timeThreshold = moving ? 0.075 : 0.25
    if (
      this.mountedHasSupportProbe &&
      movedDistanceSq < distanceThreshold &&
      this.mountedSupportProbeElapsed < timeThreshold
    ) return false

    this.mountedLastSupportProbePosition.copy(root.position)
    this.mountedHasSupportProbe = true
    this.mountedSupportProbeElapsed = 0
    return true
  }

  /** Bounds de movimento da montaria, usando o colisor configurado ou o modelo visual como fallback. */
  private getMountedBounds(root: THREE.Mesh): THREE.Box3 {
    return getColliderBounds(root) ?? new THREE.Box3().setFromObject(root)
  }

  /** Cacheia a complexidade uma vez; não conte vértices novamente em cada quadro. */
  private getImportedTriangleCount(root: THREE.Mesh): number {
    const cached = root.userData.mountCollisionTriangleCount
    if (typeof cached === 'number') return cached

    let triangleCount = 0
    root.traverse(child => {
      if (!(child instanceof THREE.Mesh) || child === root) return
      if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
      const position = child.geometry.getAttribute('position')
      if (!position) return
      triangleCount += Math.floor((child.geometry.getIndex()?.count ?? position.count) / 3)
    })
    root.userData.mountCollisionTriangleCount = triangleCount
    return triangleCount
  }

  /**
   * Verifica colisão da montaria com o mesmo princípio usado pelo player:
   * colisor configurado para modelos importados e triângulos reais para colisão automática.
   */
  private mountedCollidesWithObjects(root: THREE.Mesh): boolean {
    const mountBounds = getColliderBounds(root)
    if (!mountBounds || root.userData.colliderType === 'none') return false

    const triangle = new THREE.Triangle()
    const normal = new THREE.Vector3()
    const worldObjects = this.world.list()
    const collisionRoots = worldObjects.map(object => object.mesh)

    for (const obstacle of collisionRoots) {
      if (obstacle === root || !obstacle.visible || obstacle.userData.colliderType === 'none') continue
      obstacle.updateWorldMatrix(true, true)

      const configuredCollider = obstacle.userData.colliderType
      const obstacleBounds = getColliderBounds(obstacle)
      const nearRamp = obstacleBounds !== null && mountBounds.intersectsBox(obstacleBounds)
      // Só objetos cuja raiz esteja inclinada são tratados como rampas aqui.
      // Isso evita ignorar modelos comuns que por acaso tenham faces triangulares inclinadas.
      const isInclinedObject =
        Math.abs(obstacle.rotation.x) > 0.02 ||
        Math.abs(obstacle.rotation.z) > 0.02
      const rampSurfaceUnderMount = nearRamp && isInclinedObject &&
        obstacle.userData.importedModel !== true &&
        this.hasWalkableRampSurfaceBelow(obstacle, mountBounds)
      const owner = worldObjects.find(object => object.mesh === obstacle)
      const flatPlatformUnderMount = nearRamp &&
        owner?.type === 'platform' &&
        !isInclinedObject &&
        obstacle.userData.importedModel !== true &&
        this.hasConnectedFlatPlatformSurfaceBelow(obstacle, mountBounds, collisionRoots)

      // Uma face lateral que pertence à emenda de duas peças caminháveis não é
      // uma parede externa. Ignora o volume dessa peça enquanto seu topo plano
      // está sob a montaria e conectado à rampa; o suporte vertical continua
      // sendo decidido pelos raycasts de superfície.
      if (rampSurfaceUnderMount || flatPlatformUnderMount) continue

      if (obstacle.userData.importedModel === true && configuredCollider === 'mesh') {
        const staticData = getStaticMeshCollisionData(obstacle)
        if (staticData) {
          const blocked = visitStaticMeshTriangles(obstacle, mountBounds, (triangle) => {
            triangle.getNormal(normal).normalize()
            // Horizontal faces are walkable floors/ceilings; lateral and steep
            // faces are physical walls for a moving mount.
            // Superfícies caminháveis (pisos e rampas) não podem bloquear o
            // movimento horizontal; paredes e faces íngremes continuam sólidas.
            if (normal.y >= 0.45 || normal.y <= -0.82) return false
            return mountBounds.intersectsTriangle(triangle)
          })
          if (blocked) return true
          continue
        }
      }

      if (
        obstacle.userData.importedModel === true &&
        configuredCollider !== undefined &&
        configuredCollider !== 'auto'
      ) {
        if (obstacleBounds && this.hasVolumeOverlap(mountBounds, obstacleBounds)) return true
        continue
      }

      if (
        obstacle.userData.importedModel === true &&
        configuredCollider === 'auto' &&
        this.getImportedTriangleCount(obstacle) > MAX_EXACT_MOUNT_COLLISION_TRIANGLES
      ) {
        // O colisor automático de um GLB denso não pode custar dezenas de
        // milhares de verificações de triângulos por subpasso de movimento.
        // Usa os limites físicos como fallback conservador para montarias.
        if (obstacleBounds && this.hasVolumeOverlap(mountBounds, obstacleBounds)) return true
        continue
      }

      const meshes: THREE.Mesh[] = []
      obstacle.traverse(child => {
        if (!(child instanceof THREE.Mesh) || !child.visible) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        if (obstacle.userData.importedModel === true && child === obstacle) return
        meshes.push(child)
      })

      for (const mesh of meshes) {
        const geometry = mesh.geometry
        const position = geometry.getAttribute('position')
        if (!position || position.count < 3) continue
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingBox) continue

        const meshBounds = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
        if (!this.hasVolumeOverlap(mountBounds, meshBounds)) continue

        // Igual ao player: considera a pose atual de malhas esqueléticas, não apenas bind pose.
        if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.update()
        const vertices: THREE.Vector3[] = new Array(position.count)
        for (let index = 0; index < position.count; index += 1) {
          vertices[index] = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
        }

        const geometryIndex = geometry.getIndex()
        const triangleCount = Math.floor((geometryIndex ? geometryIndex.count : position.count) / 3)
        for (let index = 0; index < triangleCount; index += 1) {
          const ia = geometryIndex ? geometryIndex.getX(index * 3) : index * 3
          const ib = geometryIndex ? geometryIndex.getX(index * 3 + 1) : index * 3 + 1
          const ic = geometryIndex ? geometryIndex.getX(index * 3 + 2) : index * 3 + 2
          const a = vertices[ia]
          const b = vertices[ib]
          const c = vertices[ic]
          if (!a || !b || !c) continue
          triangle.set(a, b, c)
          triangle.getNormal(normal).normalize()

          // Rampas reconhecidas já foram removidas do teste de obstáculo acima.
          // Nas outras primitivas, mantém a regra de ignorar apenas a face superior.
          if (obstacle.userData.importedModel !== true && normal.y >= 0.45) continue
          if (mountBounds.intersectsTriangle(triangle)) return true
        }
      }
    }
    return false
  }

  /**
   * Detecta colisão ascendente com tetos. Usa colisores simplificados nos modelos
   * configurados manualmente e triângulos reais quando a colisão é automática.
   */
  private mountedCollidesWithCeiling(root: THREE.Mesh, previousRootY: number): boolean {
    const currentBounds = this.getMountedBounds(root)
    const previousBounds = currentBounds.clone().translate(
      new THREE.Vector3(0, previousRootY - root.position.y, 0),
    )

    for (const obstacle of this.world.list().map(object => object.mesh)) {
      if (obstacle === root || !obstacle.visible || obstacle.userData.colliderType === 'none') continue
      obstacle.updateWorldMatrix(true, true)

      const configuredCollider = obstacle.userData.colliderType
      if (obstacle.userData.importedModel === true && configuredCollider === 'mesh') {
        const staticData = getStaticMeshCollisionData(obstacle)
        if (staticData) {
          const headBounds = new THREE.Box3(
            new THREE.Vector3(currentBounds.min.x, currentBounds.max.y - 0.12, currentBounds.min.z),
            new THREE.Vector3(currentBounds.max.x, currentBounds.max.y + 0.02, currentBounds.max.z),
          )
          const blocked = visitStaticMeshTriangles(obstacle, headBounds, triangle => {
            triangle.getNormal(normal).normalize()
            return Math.abs(normal.y) >= 0.45 && headBounds.intersectsTriangle(triangle)
          })
          if (blocked) return true
          continue
        }
      }

      if (
        obstacle.userData.importedModel === true &&
        (
          (configuredCollider !== undefined && configuredCollider !== 'auto' && configuredCollider !== 'mesh') ||
          (configuredCollider === 'auto' && this.getImportedTriangleCount(obstacle) > MAX_EXACT_MOUNT_COLLISION_TRIANGLES)
        )
      ) {
        const box = getColliderBounds(obstacle)
        if (!box) continue
        const overlapsHorizontally = currentBounds.max.x > box.min.x && currentBounds.min.x < box.max.x &&
          currentBounds.max.z > box.min.z && currentBounds.min.z < box.max.z
        const crossesUnderside = previousBounds.max.y <= box.min.y + 0.05 &&
          currentBounds.max.y >= box.min.y - 0.02
        if (overlapsHorizontally && crossesUnderside) return true
        continue
      }

      const meshes: THREE.Mesh[] = []
      obstacle.traverse(child => {
        if (!(child instanceof THREE.Mesh) || !child.visible) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        if (obstacle.userData.importedModel === true && child === obstacle) return
        meshes.push(child)
      })

      for (const mesh of meshes) {
        const geometry = mesh.geometry
        const position = geometry.getAttribute('position')
        if (!position || position.count < 3) continue
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingBox) continue
        const broadBounds = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
        if (!currentBounds.intersectsBox(broadBounds)) continue

        if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.update()
        const vertices: THREE.Vector3[] = new Array(position.count)
        for (let index = 0; index < position.count; index += 1) {
          vertices[index] = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
        }
        const geometryIndex = geometry.getIndex()
        const triangleCount = Math.floor((geometryIndex ? geometryIndex.count : position.count) / 3)
        const triangle = new THREE.Triangle()
        const normal = new THREE.Vector3()
        const triangleBounds = new THREE.Box3()

        for (let index = 0; index < triangleCount; index += 1) {
          const ia = geometryIndex ? geometryIndex.getX(index * 3) : index * 3
          const ib = geometryIndex ? geometryIndex.getX(index * 3 + 1) : index * 3 + 1
          const ic = geometryIndex ? geometryIndex.getX(index * 3 + 2) : index * 3 + 2
          const a = vertices[ia]
          const b = vertices[ib]
          const c = vertices[ic]
          if (!a || !b || !c) continue
          triangle.set(a, b, c)
          triangle.getNormal(normal).normalize()
          if (normal.y >= -0.45) continue
          triangleBounds.setFromPoints([a, b, c])
          if (!currentBounds.intersectsBox(triangleBounds) || !currentBounds.intersectsTriangle(triangle)) continue
          if (previousBounds.max.y <= triangleBounds.max.y + 0.05) return true
        }
      }
    }
    return false
  }

  /**
   * Detecta uma superfície alcançável na borda dianteira do colisor.
   * Consultar somente o centro falha em rampas compridas: a lateral da rampa
   * colide com a montaria antes de o centro chegar à superfície inclinada.
   */
  private findMountedStepUpSurface(
    root: THREE.Mesh,
    feetY: number,
    axis: 'x' | 'z',
    direction: number,
  ): number | null {
    const bounds = this.getMountedBounds(root)
    const size = bounds.getSize(new THREE.Vector3())
    const height = Math.max(0.5, size.y)
    const sign = direction < 0 ? -1 : 1
    const leading = axis === 'x'
      ? (sign > 0 ? bounds.max.x : bounds.min.x)
      : (sign > 0 ? bounds.max.z : bounds.min.z)
    const lateralCenter = axis === 'x'
      ? (bounds.min.z + bounds.max.z) * 0.5
      : (bounds.min.x + bounds.max.x) * 0.5
    const lateralHalf = (axis === 'x' ? size.z : size.x) * 0.34
    const lateralSamples = [lateralCenter - lateralHalf, lateralCenter, lateralCenter + lateralHalf]
    const allCandidates = this.world.list().filter(object =>
      object.mesh !== root &&
      object.mesh.visible &&
      object.mesh.userData.colliderType !== 'none',
    )
    const staticCandidates = allCandidates.filter(object =>
      object.mesh.userData.colliderType === 'mesh' &&
      getStaticMeshCollisionData(object.mesh) !== null,
    )
    const staticIds = new Set(staticCandidates.map(object => object.id))
    const candidates = allCandidates.filter(object =>
      !staticIds.has(object.id) && object.mesh.userData.importedModel !== true,
    )
    const originY = feetY + height + 0.65
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    let bestSurface: number | null = null

    for (const lateral of lateralSamples) {
      const probe = axis === 'x'
        ? new THREE.Vector3(leading + sign * 0.04, originY, lateral)
        : new THREE.Vector3(lateral, originY, leading + sign * 0.04)
      raycaster.ray.origin.copy(probe)
      raycaster.near = 0
      raycaster.far = height + 1.15
      const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)

      for (const hit of hits) {
        if (!hit.face) continue
        const owner = candidates.find(object =>
          object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
        )
        if (!owner) continue
        const normal = hit.face.normal.clone()
          .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize()
        if (normal.y < 0.45) continue

        const rise = hit.point.y - feetY
        if (rise < -0.12 || rise > 0.5) continue
        if (bestSurface === null || hit.point.y > bestSurface) bestSurface = hit.point.y
        break
      }

      for (const object of staticCandidates) {
        const hit = raycastStaticMesh(object.mesh, raycaster.ray, 0, height + 1.15, candidate => {
          const rise = candidate.point.y - feetY
          return candidate.normal.y >= 0.45 && rise >= -0.12 && rise <= 0.5
        })
        if (hit && (bestSurface === null || hit.point.y > bestSurface)) bestSurface = hit.point.y
      }
    }
    return bestSurface
  }

  /**
   * Obtém o piso sob toda a pegada da montaria, não apenas sob o centro.
   * Isso permite apoiar a parte dianteira numa rampa antes que o centro chegue
   * nela, evitando que a caixa grande da montaria fique presa na parede inicial.
   */
  /**
   * Amostra a superfície sob vários pontos da pegada da montaria.
   * Faces inclinadas são agrupadas separadamente para que o ponto mais baixo
   * da pegada acompanhe a descida da rampa em vez de manter o corpo suspenso
   * na altura do lado mais alto.
   */
  private sampleMountedSupportSurfaces(
    root: THREE.Mesh,
    bounds: THREE.Box3,
    maxFlatDrop: number,
    maxSlopeDrop: number,
    maxRise: number,
    originY: number,
  ): { flat: number[]; inclined: number[]; terrain: number[] } {
    const feetY = bounds.min.y
    const size = bounds.getSize(new THREE.Vector3())
    const centerX = (bounds.min.x + bounds.max.x) * 0.5
    const centerZ = (bounds.min.z + bounds.max.z) * 0.5
    const insetX = Math.max(0.05, size.x * 0.3)
    const insetZ = Math.max(0.05, size.z * 0.3)
    const probes: Array<[number, number]> = [
      [centerX, centerZ],
      [centerX - insetX, centerZ],
      [centerX + insetX, centerZ],
      [centerX, centerZ - insetZ],
      [centerX, centerZ + insetZ],
      [centerX - insetX, centerZ - insetZ],
      [centerX - insetX, centerZ + insetZ],
      [centerX + insetX, centerZ - insetZ],
      [centerX + insetX, centerZ + insetZ],
    ]

    const flat: number[] = []
    const inclined: number[] = []
    const terrain: number[] = []

    for (const [x, z] of probes) {
      const terrainY = this.world.terrain.heightAt(x, z)
      const terrainRise = terrainY - feetY
      if (terrainRise <= maxRise && terrainRise >= -maxFlatDrop) terrain.push(terrainY)
    }

    const minProbeX = centerX - insetX
    const maxProbeX = centerX + insetX
    const minProbeZ = centerZ - insetZ
    const maxProbeZ = centerZ + insetZ
    const allCandidates = this.world.list().filter(object =>
      object.mesh !== root &&
      object.mesh.visible &&
      object.mesh.userData.colliderType !== 'none',
    )
    // La cidade/terreno estático usa raycast BVH em vez de atravessar cada
    // mesh filho em cada ponto de apoio da montaria.
    const staticCandidates = allCandidates.filter(object =>
      object.mesh.userData.colliderType === 'mesh' &&
      getStaticMeshCollisionData(object.mesh) !== null,
    )
    const staticIds = new Set(staticCandidates.map(object => object.id))
    const candidates = allCandidates.filter(object => {
      if (staticIds.has(object.id) || object.mesh.userData.importedModel === true) return false
      object.mesh.updateWorldMatrix(true, true)
      const box = getColliderBounds(object.mesh) ?? new THREE.Box3().setFromObject(object.mesh)
      return box.max.x >= minProbeX - 0.02 && box.min.x <= maxProbeX + 0.02 &&
        box.max.z >= minProbeZ - 0.02 && box.min.z <= maxProbeZ + 0.02 &&
        box.max.y >= feetY - maxSlopeDrop && box.min.y <= originY
    })
    if (candidates.length === 0 && staticCandidates.length === 0) return { flat, inclined, terrain }

    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    raycaster.near = 0
    raycaster.far = Math.max(1, originY - (feetY - maxSlopeDrop))
    const objects = candidates.map(object => object.mesh)
    const normalMatrix = new THREE.Matrix3()

    for (const [x, z] of probes) {
      raycaster.ray.origin.set(x, originY, z)
      const hits = raycaster.intersectObjects(objects, true)

      for (const hit of hits) {
        if (!hit.face) continue
        const owner = candidates.find(object =>
          object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
        )
        if (!owner) continue

        const normal = hit.face.normal.clone()
          .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
          .normalize()
        if (normal.y < 0.12) continue

        const isInclinedSurface = normal.y < 0.9995
        // Projeta a amostra inclinada para o centro da pegada: usar o ponto
        // mais baixo de uma rampa longa deixaria a montaria suspensa pelo outro lado.
        const surfaceY = isInclinedSurface && normal.y > 1e-4
          ? hit.point.y - (
            normal.x * (centerX - hit.point.x) +
            normal.z * (centerZ - hit.point.z)
          ) / normal.y
          : hit.point.y
        const rise = surfaceY - feetY
        if (rise > maxRise) continue
        if (rise < -maxFlatDrop && !(isInclinedSurface && rise >= -maxSlopeDrop)) continue

        if (isInclinedSurface) inclined.push(surfaceY)
        else flat.push(surfaceY)
        break
      }

      for (const object of staticCandidates) {
        const hit = raycastStaticMesh(
          object.mesh,
          raycaster.ray,
          raycaster.near,
          raycaster.far,
          candidate => {
            if (candidate.normal.y < 0.12) return false
            const isInclinedSurface = candidate.normal.y < 0.9995
            const surfaceY = isInclinedSurface && candidate.normal.y > 1e-4
              ? candidate.point.y - (
                candidate.normal.x * (centerX - candidate.point.x) +
                candidate.normal.z * (centerZ - candidate.point.z)
              ) / candidate.normal.y
              : candidate.point.y
            const rise = surfaceY - feetY
            return rise <= maxRise &&
              (rise >= -maxFlatDrop || (isInclinedSurface && rise >= -maxSlopeDrop))
          },
        )
        if (!hit) continue
        const normal = hit.normal
        const isInclinedSurface = normal.y < 0.9995
        const surfaceY = isInclinedSurface && normal.y > 1e-4
          ? hit.point.y - (
            normal.x * (centerX - hit.point.x) +
            normal.z * (centerZ - hit.point.z)
          ) / normal.y
          : hit.point.y
        if (isInclinedSurface) inclined.push(surfaceY)
        else flat.push(surfaceY)
      }
    }

    return { flat, inclined, terrain }
  }

  private chooseMountedSupportSurface(
    surfaces: { flat: number[]; inclined: number[]; terrain: number[] },
    feetY: number,
    maxRise: number,
    followGroundedMovement = false,
  ): number | null {
    // Durante a caminhada, se dois níveis baixos estão sob a pegada, acompanha
    // o mais baixo para descer degraus; ao aterrissar após um salto, prioriza
    // o mais alto para não atravessar uma plataforma.
    const nearFlat = surfaces.flat.filter(y => y >= feetY - 0.28 && y <= feetY + maxRise)
    if (nearFlat.length > 0) {
      return followGroundedMovement ? Math.min(...nearFlat) : Math.max(...nearFlat)
    }

    // As alturas inclinadas já foram projetadas para o centro. A mediana
    // ignora amostras discrepantes em emendas entre segmentos da rampa.
    if (surfaces.inclined.length > 0) {
      const centerHeights = [...surfaces.inclined].sort((a, b) => a - b)
      return centerHeights[Math.floor((centerHeights.length - 1) / 2)] ?? null
    }
    if (surfaces.flat.length > 0) return Math.max(...surfaces.flat)

    if (surfaces.terrain.length > 0) {
      const terrainMin = Math.min(...surfaces.terrain)
      const terrainMax = Math.max(...surfaces.terrain)
      if (terrainMax - terrainMin > 0.12) return terrainMin
      const nearTerrain = surfaces.terrain.filter(y => y >= feetY - 0.28 && y <= feetY + maxRise)
      if (nearTerrain.length > 0) return Math.max(...nearTerrain)
      return terrainMax
    }
    return null
  }

  private findMountedGroundSurface(root: THREE.Mesh, bounds: THREE.Box3): number {
    const feetY = bounds.min.y
    const terrainY = this.world.terrain.heightAt(root.position.x, root.position.z)
    const size = bounds.getSize(new THREE.Vector3())
    const maxRise = 0.55
    const maxFlatDrop = Math.max(0.75, size.y * 0.35)
    const maxSlopeDrop = Math.max(1.25, size.y * 0.4)
    const originY = Math.max(bounds.max.y + 1, feetY + size.y + 1, terrainY + size.y + 2)
    const surfaces = this.sampleMountedSupportSurfaces(
      root, bounds, maxFlatDrop, maxSlopeDrop, maxRise, originY,
    )
    return this.chooseMountedSupportSurface(surfaces, feetY, maxRise) ?? terrainY
  }

  /**
   * Detecta uma plataforma plana na junção inferior/superior de uma rampa.
   * Quando o topo já está sob a pegada, sua parede lateral é uma face interna
   * da transição e não deve bloquear o cruzamento. A tolerância para baixo é
   * ampliada somente quando uma rampa adjacente também sustenta a montaria.
   */
  private hasConnectedFlatPlatformSurfaceBelow(
    platform: THREE.Mesh,
    mountBounds: THREE.Box3,
    collisionRoots: THREE.Mesh[],
  ): boolean {
    const platformBounds = getColliderBounds(platform) ?? new THREE.Box3().setFromObject(platform)
    if (!mountBounds.intersectsBox(platformBounds)) return false

    const size = mountBounds.getSize(new THREE.Vector3())
    const centerX = (mountBounds.min.x + mountBounds.max.x) * 0.5
    const centerZ = (mountBounds.min.z + mountBounds.max.z) * 0.5
    const insetX = size.x * 0.38
    const insetZ = size.z * 0.38
    const probes: Array<[number, number]> = [
      [centerX, centerZ],
      [centerX - insetX, centerZ],
      [centerX + insetX, centerZ],
      [centerX, centerZ - insetZ],
      [centerX, centerZ + insetZ],
      [centerX - insetX, centerZ - insetZ],
      [centerX - insetX, centerZ + insetZ],
      [centerX + insetX, centerZ - insetZ],
      [centerX + insetX, centerZ + insetZ],
    ]

    const feetY = mountBounds.min.y
    const nearSupportDrop = 0.35
    const transitionDrop = Math.max(0.45, Math.min(1.25, Math.max(size.x, size.z) * 0.6))
    const originY = mountBounds.max.y + 0.25
    const lowestY = feetY - transitionDrop
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(centerX, originY, centerZ),
      new THREE.Vector3(0, -1, 0),
      0,
      Math.max(1, originY - lowestY),
    )
    const normalMatrix = new THREE.Matrix3()
    let surfaceY: number | null = null

    for (const [x, z] of probes) {
      raycaster.ray.origin.set(x, originY, z)
      const hits = raycaster.intersectObject(platform, true)
      for (const hit of hits) {
        if (!hit.face) continue
        const faceNormal = hit.face.normal.clone()
          .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
          .normalize()
        if (faceNormal.y < 0.9995) continue
        if (hit.point.y < lowestY || hit.point.y > feetY + 0.35) continue
        surfaceY = hit.point.y
        break
      }
      if (surfaceY !== null) break
    }

    if (surfaceY === null) return false
    // Se a superfície está praticamente na altura dos pés, ela já é o piso atual.
    if (surfaceY >= feetY - nearSupportDrop) return true

    // Para um degrau mais baixo, só remove a parede quando a plataforma faz
    // parte da mesma junção e uma face inclinada caminhável segue sob a pegada.
    for (const ramp of collisionRoots) {
      if (
        ramp === platform ||
        !ramp.visible ||
        ramp.userData.colliderType === 'none' ||
        ramp.userData.importedModel === true
      ) continue
      if (Math.abs(ramp.rotation.x) <= 0.02 && Math.abs(ramp.rotation.z) <= 0.02) continue

      const rampBounds = getColliderBounds(ramp) ?? new THREE.Box3().setFromObject(ramp)
      if (!rampBounds.clone().expandByScalar(0.15).intersectsBox(platformBounds)) continue
      if (this.hasWalkableRampSurfaceBelow(ramp, mountBounds)) return true
    }

    return false
  }

  /**
   * Confirma que uma rampa inclinada tem uma face superior caminhável logo sob
   * a área da montaria. Só então as faces laterais daquele prisma deixam de ser
   * consideradas paredes; lados expostos continuam bloqueando normalmente.
   */
  private hasWalkableRampSurfaceBelow(obstacle: THREE.Mesh, mountBounds: THREE.Box3): boolean {
    obstacle.updateWorldMatrix(true, true)
    const size = mountBounds.getSize(new THREE.Vector3())
    const centerX = (mountBounds.min.x + mountBounds.max.x) * 0.5
    const centerZ = (mountBounds.min.z + mountBounds.max.z) * 0.5
    const insetX = size.x * 0.38
    const insetZ = size.z * 0.38
    const probes: Array<[number, number]> = [
      [centerX, centerZ],
      [centerX - insetX, centerZ],
      [centerX + insetX, centerZ],
      [centerX, centerZ - insetZ],
      [centerX, centerZ + insetZ],
      [centerX - insetX, centerZ - insetZ],
      [centerX - insetX, centerZ + insetZ],
      [centerX + insetX, centerZ - insetZ],
      [centerX + insetX, centerZ + insetZ],
    ]
    const obstacleBounds = getColliderBounds(obstacle) ?? new THREE.Box3().setFromObject(obstacle)
    const originY = mountBounds.max.y + 0.5
    // Na entrada da rampa, a superfície pode estar bem abaixo do colisor.
    const lowestAllowedY = Math.min(mountBounds.min.y - 0.2, obstacleBounds.min.y - 0.05)
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    raycaster.near = 0
    raycaster.far = Math.max(1, originY - lowestAllowedY)
    const rampUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(obstacle.getWorldQuaternion(new THREE.Quaternion()))
      .normalize()

    for (const [x, z] of probes) {
      raycaster.ray.origin.set(x, originY, z)
      const hits = raycaster.intersectObject(obstacle, true)
      for (const hit of hits) {
        if (!hit.face) continue
        const normal = hit.face.normal.clone()
          .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize()
        const topAlignment = normal.dot(rampUp)
        // Distingue a face superior de laterais inclinadas pela rotação do objeto.
        if (topAlignment < 0.45 || normal.y < 0.02 || normal.y > 0.99999) continue
        if (hit.point.y < lowestAllowedY || hit.point.y > mountBounds.max.y + 0.05) continue
        return true
      }
    }
    return false
  }

  /**
   * Segue o piso sob o centro a cada subpasso de movimento. A tolerância vertical
   * acompanha inclinações contínuas sem transformar paredes em degraus.
   */
  /**
   * Segue o piso sob o centro a cada subpasso de movimento. A descida de uma
   * rampa pode ficar bem abaixo da altura antiga do cavalo se o frame anterior
   * perdeu a face inclinada; nesse caso, aceita a própria face de rampa como apoio.
   * Retorna false apenas quando não encontra suporte alcançável, para ativar a queda.
   */
  private followMountedSurfaceAtStep(root: THREE.Mesh, horizontalStep: number): boolean {
    const bounds = this.getMountedBounds(root)
    const bottomOffset = root.position.y - bounds.min.y
    const feetY = bounds.min.y
    const maxRise = Math.max(0.16, horizontalStep * 3.5)
    const maxFlatDrop = Math.max(0.28, horizontalStep * 4)
    const maxSlopeDrop = Math.max(1.25, maxFlatDrop)
    const size = bounds.getSize(new THREE.Vector3())
    const originY = Math.max(bounds.max.y + 0.25, feetY + size.y + 0.25, feetY + maxRise + 0.25)
    const surfaces = this.sampleMountedSupportSurfaces(
      root, bounds, maxFlatDrop, maxSlopeDrop, maxRise, originY,
    )
    const supportY = this.chooseMountedSupportSurface(surfaces, feetY, maxRise, true)
    if (supportY === null) return false

    const riseFromFeet = supportY - feetY
    if (riseFromFeet < -maxSlopeDrop || riseFromFeet > maxRise) return false

    root.position.y = supportY + bottomOffset
    root.updateWorldMatrix(true, true)
    return true
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
    if (!enabled) {
      this.mixer?.stopAllAction()
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
    this.mixer?.stopAllAction()
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
  ): Promise<void> {
    if (this.disposed) throw new Error('O jogador já foi descarregado.')
    if (!(data instanceof ArrayBuffer) || data.byteLength < 20) {
      throw new Error('O arquivo do jogador não parece ser um GLB válido.')
    }

    const revision = ++this.modelLoadRevision
    const installed = await this.parseAndInstallModel(data.slice(0), revision, animationRoles)
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

  private async parseAndInstallModel(data: ArrayBuffer, revision: number, animationRoles?: Record<string, AnimationRole>): Promise<boolean> {
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

    // Padroniza todos os modelos para 1,8 m e apoia os pés na origem local.
    gltf.scene.scale.multiplyScalar(PLAYER_HEIGHT / size.y)
    gltf.scene.updateMatrixWorld(true)
    const normalizedBounds = new THREE.Box3().setFromObject(gltf.scene)
    const center = normalizedBounds.getCenter(new THREE.Vector3())
    gltf.scene.position.x -= center.x
    gltf.scene.position.y -= normalizedBounds.min.y
    gltf.scene.position.z -= center.z

    const nextMixer = new THREE.AnimationMixer(gltf.scene)
    const nextActions = new Map<string, THREE.AnimationAction>()
    gltf.animations.forEach((clip, index) => {
      const configuredRole = animationRoles?.[String(index)]
      let key: string
      if (configuredRole !== undefined) {
        if (configuredRole === 'ignore') return
        // Conserva os papéis escolhidos no Model Workspace, inclusive postura e ações.
        key = configuredRole
      } else {
        key = this.classifyAnimation(clip.name)
      }
      if (key !== 'other' && !nextActions.has(key)) nextActions.set(key, nextMixer.clipAction(clip))
    })

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
    this.mixer?.stopAllAction()
    this.animationActions.clear()
    this.mixer = nextMixer
    this.animationActions = nextActions
    this.activeOneShotAnimation = null
    this.animatedBones = nextBones
    this.firstPersonHiddenBones.clear()
    for (const child of [...this.visualRoot.children]) this.disposeObject(child)
    this.visualRoot.clear()
    this.proceduralLimbs = null
    this.visualRoot.add(gltf.scene)
    this.setFirstPersonMode(this.firstPersonMode)
    this.activeAnimation = ''
    this.playAnimation('idle')
    return true
  }

  private classifyAnimation(name: string): string {
    const normalized = name.toLowerCase()
    if (/jump|leap|fall/.test(normalized)) return 'jump'
    if (/run|sprint/.test(normalized)) return 'run'
    if (/walk|locomotion|move/.test(normalized)) return 'walk'
    if (/idle|stand|breath/.test(normalized)) return 'idle'
    return 'other'
  }

  private triggerPlayerAnimation(role: AnimationRole): void {
    if (!this.animationActions.has(role)) return
    this.playAnimation(role, true)
  }

  private playAnimation(state: string, oneShot = false): void {
    if (!this.mixer) return

    if (!oneShot && this.activeOneShotAnimation) {
      const activeOneShot = this.animationActions.get(this.activeOneShotAnimation)
      if (activeOneShot?.isRunning()) return
      this.activeOneShotAnimation = null
    }
    if (!oneShot && this.activeAnimation === state) return

    const role = state as AnimationRole
    const nextRole = [role, ...(ANIMATION_FALLBACKS[role] ?? [])]
      .find(candidate => this.animationActions.has(candidate))
    const next = nextRole ? this.animationActions.get(nextRole) : undefined

    // Evita reiniciar o mesmo clipe a cada troca de estado (por exemplo, run -> walk
    // quando os dois papéis compartilham o mesmo ativo) e mistura as poses suavemente.
    const current = this.animationActions.get(this.activeAnimation)
    if (!oneShot && current && current === next) {
      this.activeAnimation = state
      return
    }

    if (next) {
      if (oneShot || ONE_SHOT_ANIMATION_ROLES.has(role)) {
        next.setLoop(THREE.LoopOnce, 1)
        next.clampWhenFinished = true
      } else {
        next.setLoop(THREE.LoopRepeat, Infinity)
        next.clampWhenFinished = false
      }
      next.reset().fadeIn(0.2).play()
      if (oneShot) this.activeOneShotAnimation = role
    } else if (oneShot) {
      return
    }
    for (const action of this.animationActions.values()) {
      if (action !== next && action.isRunning()) action.fadeOut(0.2)
    }
    this.activeAnimation = state
  }

  private getLocomotionAnimationRole(forwardInput: number, sideInput: number, running: boolean): AnimationRole {
    if (forwardInput > 0 && Math.abs(sideInput) > 0) {
      if (running) return sideInput < 0 ? 'run_diagonal_left' : 'run_diagonal_right'
      return sideInput < 0 ? 'walk_diagonal_left' : 'walk_diagonal_right'
    }
    if (forwardInput < 0) return running ? 'run_backward' : 'walk_backward'
    if (sideInput < 0) return running ? 'run_left' : 'walk_left'
    if (sideInput > 0) return running ? 'run_right' : 'walk_right'
    return running ? 'run' : 'walk'
  }

  private updateAvatarAnimation(dt: number, moving: boolean, running: boolean, forwardInput: number, sideInput: number): void {
    // Retira a pose procedural do quadro anterior antes de o mixer avançar.
    // Assim, alternar entre agachado e em pé não acumula rotações nos ossos.
    this.clearPosturePoseOffsets()
    this.animationTime += dt * (running ? 12 : 8)
    const state: AnimationRole = !this.grounded ? 'jump'
      : this.posture === 'prone' ? (moving ? 'prone_crawl' : 'prone')
        : this.posture === 'crouching' ? (moving ? 'crouch_walk' : 'crouch')
          : !moving ? 'idle'
            : this.walkToggled && !running ? 'walk_slow'
              : this.getLocomotionAnimationRole(forwardInput, sideInput, running)
    this.playAnimation(state)
    this.mixer?.update(dt)

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
    const hasStateClip = [state, ...(ANIMATION_FALLBACKS[state] ?? [])]
      .some(role => this.animationActions.has(role))
    if (hasStateClip || this.activeOneShotAnimation) {
      if (!this.activeOneShotAnimation) this.applyFallbackCrouchPose()
      return
    }
    const movingNow = moving && this.grounded
    const amplitude = movingNow ? (running ? 0.75 : 0.42) : 0.035
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

  private playerBox(): THREE.Box3 {
    const height = this.getPlayerHeight()
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + height / 2, this.mesh.position.z),
      new THREE.Vector3(PLAYER_RADIUS * 2, height, PLAYER_RADIUS * 2),
    )
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
  private collidesWithObjects(blockCeilings = false): boolean {
    const playerBox = this.playerBox()
    const playerHeight = this.getPlayerHeight()
    const sampleY = blockCeilings ? Math.max(0.1, playerHeight - PLAYER_RADIUS) : playerHeight * 0.5
    const center = new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + sampleY, this.mesh.position.z)
    const radiusSq = PLAYER_RADIUS * PLAYER_RADIUS
    const triangle = new THREE.Triangle()
    const closest = new THREE.Vector3()
    const normal = new THREE.Vector3()
    // Distribui contatos ao longo da altura física atual: ao rastejar, os
    // pontos altos deixam de bloquear o jogador como se ele estivesse em pé.
    const contactCount = Math.max(2, Math.ceil(playerHeight / 0.26))
    const playerContactPoints = Array.from({ length: contactCount }, (_, index) =>
      new THREE.Vector3(
        this.mesh.position.x,
        this.mesh.position.y + Math.min(playerHeight - 0.05, 0.13 + index * 0.26),
        this.mesh.position.z,
      ),
    )
    const contactRadiusSq = (PLAYER_RADIUS * 1.05) ** 2
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
              // A head-volume query blocks ceilings independently of triangle winding.
              return Math.abs(normal.y) >= 0.45 && queryBox.intersectsTriangle(triangle)
            }
            // Ignore horizontal floor/roof faces during horizontal movement; the
            // landing solver uses downward BVH raycasts to find their real height.
            // Paredes bloqueiam; pisos e rampas ascendentes ficam a cargo do
            // resolvedor vertical para que o jogador consiga caminhar sobre elas.
            if (normal.y >= 0.45 || normal.y <= -0.82) return false
            return queryBox.intersectsTriangle(triangle)
          })
          if (blocked) return true
          continue
        }
        // Non-static geometry (e.g. a skinned/morph model) falls back to the
        // normal model path instead of building a stale BVH.
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
        coarseBounds.min.x -= PLAYER_RADIUS + 0.75
        coarseBounds.max.x += PLAYER_RADIUS + 0.75
        coarseBounds.min.y -= PLAYER_HEIGHT + 0.75
        coarseBounds.max.y += 0.75
        coarseBounds.min.z -= PLAYER_RADIUS + 0.75
        coarseBounds.max.z += PLAYER_RADIUS + 0.75
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
        deformedBounds.expandByScalar(PLAYER_RADIUS * 1.05)
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
            // No salto, somente faces voltadas para baixo bloqueiam a cabeça.
            if (blockCeilings) {
              if (Math.abs(normal.y) < 0.45 || normal.y > 0.45) continue
              if (playerBox.intersectsTriangle(triangle)) return true
              continue
            }

            // A decisão horizontal não deve filtrar normais inclinadas: modelos
            // low-poly têm triângulos oblíquos que ainda formam paredes sólidas.
            if (playerBox.intersectsTriangle(triangle)) return true

            // Complementa o teste da caixa com pontos ao longo do corpo. Isso
            // evita atravessar faces triangulares estreitas entre passos de movimento.
            triangleBounds.setFromPoints([a, b, c]).expandByScalar(PLAYER_RADIUS)
            if (!triangleBounds.intersectsBox(playerBox)) continue
            for (const sample of playerContactPoints) {
              triangle.closestPointToPoint(sample, closest)
              if (sample.distanceToSquared(closest) <= contactRadiusSq) return true
            }
          } else {
            // Para primitivas e plataformas, preservar o tratamento de piso,
            // rampa e teto já existente.
            if (blockCeilings) {
              if (normal.y > -0.45) continue
            } else if (normal.y >= 0.45) {
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
  private findStepUpSurface(x: number, z: number, feetY: number): number | null {
    const playerHeight = this.getPlayerHeight()
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, feetY + playerHeight + 0.65, z),
      new THREE.Vector3(0, -1, 0),
      0,
      playerHeight + 1.15,
    )
    const allCandidates = this.world.list().filter(object =>
      object.mesh.visible && object.mesh.userData.colliderType !== 'none',
    )
    const staticCandidates = allCandidates.filter(object =>
      object.mesh.userData.importedModel === true &&
      object.mesh.userData.colliderType === 'mesh' &&
      getStaticMeshCollisionData(object.mesh) !== null,
    )
    const staticIds = new Set(staticCandidates.map(object => object.id))
    const candidates = allCandidates.filter(object => !staticIds.has(object.id))
    const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)
    let bestSurface: number | null = null

    for (const hit of hits) {
      if (!hit.face) continue
      const root = candidates.find(object =>
        object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
      )
      if (!root) continue
      // Importados não são degraus físicos genéricos: seus pisos são tratados
      // separadamente a partir do BVH, mas não se sobe pela lateral de um objeto.
      if (root.mesh.userData.importedModel === true) continue
      const normal = hit.face.normal.clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize()
      if (normal.y < 0.45) continue
      const rise = hit.point.y - feetY
      if (rise >= -0.12 && rise <= 0.5 && (bestSurface === null || hit.point.y > bestSurface)) {
        bestSurface = hit.point.y
      }
    }

    for (const object of staticCandidates) {
      const hit = raycastStaticMesh(object.mesh, raycaster.ray, 0, playerHeight + 1.15, candidate => {
        const rise = candidate.point.y - feetY
        return candidate.normal.y >= 0.45 && rise >= -0.12 && rise <= 0.5
      })
      if (hit && (bestSurface === null || hit.point.y > bestSurface)) bestSurface = hit.point.y
    }
    return bestSurface
  }

  private findObjectLanding(oldY: number, nextY: number): number | null {
    const playerBox = this.playerBox()
    let landing: number | null = null

    // Detecta a superfície real de objetos inclinados (rampas) com um raio
    // vertical. Isso evita usar o AABB, cuja altura máxima não representa a rampa.
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    // Procura superfícies de apoio em todos os objetos sólidos, não apenas
    // nos objetos cuja raiz está rotacionada. Rampas também podem ser construídas
    // com várias plataformas individuais, e suas faces superiores precisam sustentar
    // o jogador mesmo quando cada plataforma tem rotação zero.
    const allSlopeCandidates = this.world.list().filter((object) =>
      object.mesh.visible &&
      object.mesh.userData.colliderType !== 'none',
    )
    const staticCandidates = allSlopeCandidates.filter(object =>
      object.mesh.userData.importedModel === true &&
      object.mesh.userData.colliderType === 'mesh' &&
      getStaticMeshCollisionData(object.mesh) !== null,
    )
    const staticIds = new Set(staticCandidates.map(object => object.id))
    const slopeCandidates = allSlopeCandidates.filter(object => !staticIds.has(object.id))
    const rayOriginY = Math.max(oldY, nextY) + PLAYER_HEIGHT + 2
    raycaster.ray.origin.set(this.mesh.position.x, rayOriginY, this.mesh.position.z)
    if (slopeCandidates.length > 0) {
      const hits = raycaster.intersectObjects(slopeCandidates.map(object => object.mesh), true)
      for (const hit of hits) {
        if (!hit.face) continue
        const object = slopeCandidates.find(candidate => candidate.mesh === hit.object || candidate.mesh.getObjectById(hit.object.id))
        if (!object) continue
        // A raiz de um modelo importado é uma caixa proxy invisível. Nunca use sua
        // face superior como chão: o pouso automático deve vir da malha visual filha.
        if (object.mesh.userData.importedModel === true && hit.object === object.mesh) continue
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
        const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
        if (normal.y < 0.45) continue

        const surfaceY = hit.point.y
        const rise = surfaceY - oldY
        const canStepOntoSlope = this.grounded && rise >= -0.3 && rise <= 0.5
        // Ao correr e saltar em direção à rampa, a posição horizontal pode avançar
        // vários centímetros por frame. A superfície pode subir entre duas amostras;
        // uma tolerância fixa de 0,12 m faz o avatar atravessar a rampa e cair.
        // Aceita o cruzamento recente da superfície até 0,75 m abaixo da posição
        // anterior, mas somente durante a descida (o chamador já valida a velocidade).
        const crossedSurface = nextY <= surfaceY && oldY >= surfaceY - 0.75
        if (!canStepOntoSlope && !crossedSurface) continue
        if (landing === null || surfaceY > landing) landing = surfaceY
        break
      }
    }

    // Cidades e terrenos estáticos consultam somente os triângulos que cruzam
    // o raio vertical; os demais triângulos da cidade não são visitados.
    for (const object of staticCandidates) {
      const hit = raycastStaticMesh(object.mesh, raycaster.ray, 0, Number.POSITIVE_INFINITY, candidate => {
        if (candidate.normal.y < 0.45) return false
        const rise = candidate.point.y - oldY
        const canStepOntoSlope = this.grounded && rise >= -0.3 && rise <= 0.5
        const crossedSurface = nextY <= candidate.point.y && oldY >= candidate.point.y - 0.75
        return canStepOntoSlope || crossedSurface
      })
      if (hit && (landing === null || hit.point.y > landing)) landing = hit.point.y
    }

    // Objetos não inclinados continuam usando o colisor configurado.
    if (nextY > oldY) return landing
    for (const object of this.world.list()) {
      if (!object.mesh.visible || object.mesh.userData.colliderType === 'mesh') continue
      const rotatedRamp = Math.abs(object.mesh.rotation.x) > 0.02 || Math.abs(object.mesh.rotation.z) > 0.02
      if (rotatedRamp) continue
      const box = getColliderBounds(object.mesh)
      if (!box) continue
      const horizontalOverlap = playerBox.max.x > box.min.x && playerBox.min.x < box.max.x &&
        playerBox.max.z > box.min.z && playerBox.min.z < box.max.z
      if (!horizontalOverlap || oldY < box.max.y - 0.08 || nextY > box.max.y) continue
      if (landing === null || box.max.y > landing) landing = box.max.y
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
