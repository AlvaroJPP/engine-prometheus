import * as RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PhysicsWorld } from './PhysicsWorld.ts'

export interface CharacterControllerConfig {
  /** Capsule radius */
  radius: number
  /** Capsule height (excluding hemispheres) */
  height: number
  /** Maximum slope angle in radians the character can walk up */
  maxSlopeAngle: number
  /** Maximum step height the character can climb */
  maxStepHeight: number
  /** Whether the character can jump */
  allowJump: boolean
  /** Jump impulse magnitude */
  jumpImpulse: number
  /** Air control factor (0 = no air control, 1 = full air control) */
  airControl: number
  /** Ground friction when not moving */
  staticFriction: number
  /** Ground friction when moving */
  dynamicFriction: number
  /** Custom gravity for this character (optional) */
  customGravity?: THREE.Vector3
}

export const DEFAULT_CHARACTER_CONFIG: CharacterControllerConfig = {
  radius: 0.4,
  height: 1.8,
  maxSlopeAngle: Math.PI / 3, // 60 degrees
  maxStepHeight: 0.4,
  allowJump: true,
  jumpImpulse: 8.0,
  airControl: 0.3,
  staticFriction: 0.9,
  dynamicFriction: 0.6,
}

export interface CharacterInput {
  /** Movement direction in world space (normalized) */
  moveDirection: THREE.Vector3
  /** Whether jump was requested this frame */
  jump: boolean
  /** Whether sprint is held */
  sprint: boolean
  /** Delta time since last frame */
  deltaTime: number
}

export interface CharacterState {
  /** Current world position */
  position: THREE.Vector3
  /** Current velocity */
  velocity: THREE.Vector3
  /** Whether character is grounded */
  grounded: boolean
  /** Current ground normal */
  groundNormal: THREE.Vector3
  /** Current speed */
  speed: number
  /** Whether character is jumping */
  jumping: boolean
  /** Whether character is on a slope */
  onSlope: boolean
  /** Slope angle in radians */
  slopeAngle: number
}

/**
 * Kinematic Character Controller using Rapier physics.
 *
 * This replaces the raycast-based HumanoidAvatar movement with a proper
 * physics-based character controller that handles:
 * - Slope sliding
 * - Step climbing
 * - Jumping
 * - Platform movement
 * - Collision response
 */
export class RapierCharacterController {
  private physicsWorld: PhysicsWorld
  private config: CharacterControllerConfig
  private body: RAPIER.RigidBody | null = null
  private collider: RAPIER.Collider | null = null
  private controller: RAPIER.KinematicCharacterController | null = null
  private initialized = false

  // State
  private currentState: CharacterState = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    grounded: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    speed: 0,
    jumping: false,
    onSlope: false,
    slopeAngle: 0,
  }

  // Movement
  private walkSpeed = 4.0
  private sprintSpeed = 8.0
  private desiredVelocity = new THREE.Vector3()
  private jumpRequested = false
  private wasGrounded = false
  private jumpCooldown = 0
  private computedVelocity = new THREE.Vector3()

  // Callbacks
  private onGroundedChange?: (grounded: boolean) => void
  private onJump?: () => void
  private onLand?: (impactVelocity: number) => void

  constructor(
    physicsWorld: PhysicsWorld,
    config: Partial<CharacterControllerConfig> = {},
  ) {
    this.physicsWorld = physicsWorld
    this.config = { ...DEFAULT_CHARACTER_CONFIG, ...config }
  }

  /** Initialize the character controller (must be called after physics world is ready). */
  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.physicsWorld.initialize()

    const world = this.physicsWorld.getWorld()
    if (!world) throw new Error('Physics world not initialized')

    // Create kinematic rigid body for character
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(0, this.config.height / 2 + this.config.radius, 0)
      .setCanSleep(false)
      .setCcdEnabled(true)

    this.body = world.createRigidBody(bodyDesc)

    // Create capsule collider
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      this.config.height / 2,
      this.config.radius,
    )
      .setFriction(this.config.dynamicFriction)
      .setRestitution(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)

    this.collider = world.createCollider(colliderDesc, this.body)

    // Create character controller
    this.controller = world.createCharacterController(0.1) // offset for ground detection

    // Configure controller
    this.controller.setApplyImpulsesToDynamicBodies(true)
    this.controller.setMaxSlopeClimbAngle(this.config.maxSlopeAngle)
    this.controller.setMinSlopeSlideAngle(0)
    this.controller.enableAutostep(this.config.maxStepHeight, this.config.radius * 2, false)
    this.controller.enableSnapToGround(this.config.radius * 0.5)

    this.initialized = true
  }

  /** Check if controller is initialized. */
  isReady(): boolean {
    return this.initialized && this.body !== null && this.collider !== null && this.controller !== null
  }

  /** Set the character's world position. */
  setPosition(position: THREE.Vector3): void {
    if (!this.body) return
    const targetY = position.y + this.config.height / 2 + this.config.radius
    this.body.setNextKinematicTranslation({ x: position.x, y: targetY, z: position.z })
    // Step physics to update attached collider positions (minimal step)
    this.physicsWorld.step(1/60)
    this.currentState.position.copy(position)
  }

  /** Get the character's current position. */
  getPosition(): THREE.Vector3 {
    return this.currentState.position.clone()
  }

  /** Set walk speed. */
  setWalkSpeed(speed: number): void {
    this.walkSpeed = speed
  }

  /** Set sprint speed. */
  setSprintSpeed(speed: number): void {
    this.sprintSpeed = speed
  }

  /** Set movement callbacks. */
  setCallbacks(callbacks: {
    onGroundedChange?: (grounded: boolean) => void
    onJump?: () => void
    onLand?: (impactVelocity: number) => void
  }): void {
    this.onGroundedChange = callbacks.onGroundedChange
    this.onJump = callbacks.onJump
    this.onLand = callbacks.onLand
  }

  /** Update the character controller with input. */
  update(input: CharacterInput): CharacterState {
    if (!this.isReady() || !this.body || !this.collider || !this.controller) {
      return this.currentState
    }

    const world = this.physicsWorld.getWorld()
    if (!world) return this.currentState

    const dt = input.deltaTime
    const { moveDirection, jump, sprint } = input

    // Update jump cooldown
    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= dt
    }

    // Calculate desired movement speed
    const targetSpeed = sprint ? this.sprintSpeed : this.walkSpeed
    this.desiredVelocity.copy(moveDirection).multiplyScalar(targetSpeed)

    // Handle jumping
    if (jump && this.config.allowJump && this.currentState.grounded && this.jumpCooldown <= 0) {
      this.jumpRequested = true
      this.jumpCooldown = 0.2 // Prevent double jump
    }

    // Perform character movement using Rapier's kinematic character controller
    this.performMovement(dt)

    // Update state from physics body
    this.syncState()

    return this.currentState
  }

  /** Core movement logic using Rapier's built-in character controller. */
  private performMovement(dt: number): void {
    if (!this.body || !this.collider || !this.controller || !this.physicsWorld.isReady()) return

    const world = this.physicsWorld.getWorld()
    if (!world) return

    // Get current position
    const currentPos = this.body.translation()

    // Calculate movement
    let displacement = new RAPIER.Vector3(0, 0, 0)

    // Horizontal movement
    if (this.desiredVelocity.lengthSq() > 0.0001) {
      const horizontalVel = new THREE.Vector3(
        this.desiredVelocity.x,
        0,
        this.desiredVelocity.z,
      )

      // Apply air control if not grounded
      if (!this.currentState.grounded) {
        horizontalVel.multiplyScalar(this.config.airControl)
      }

      displacement.x = horizontalVel.x * dt
      displacement.z = horizontalVel.z * dt
    }

    // Vertical movement: apply gravity when not grounded, or jump when requested
    if (this.jumpRequested && this.currentState.grounded) {
      displacement.y = this.config.jumpImpulse * dt
      this.jumpRequested = false
      this.currentState.jumping = true
      this.onJump?.()
    } else if (!this.currentState.grounded) {
      // Apply gravity when airborne
      const gravity = this.physicsWorld.getGravity()
      displacement.y = gravity.y * dt
    }

    // Let Rapier compute the actual movement with collision resolution
    this.controller.computeColliderMovement(
      this.collider,
      displacement,
    )

    const correctedDisplacement = this.controller.computedMovement()

    // Store computed velocity from corrected displacement
    this.computedVelocity.set(
      correctedDisplacement.x / dt,
      correctedDisplacement.y / dt,
      correctedDisplacement.z / dt,
    )

    // Apply the corrected movement
    const newPos = {
      x: currentPos.x + correctedDisplacement.x,
      y: currentPos.y + correctedDisplacement.y,
      z: currentPos.z + correctedDisplacement.z,
    }
    this.body.setNextKinematicTranslation(newPos)

    // Check ground status after movement
    this.wasGrounded = this.currentState.grounded
    this.currentState.grounded = this.controller.computedGrounded()

    if (!this.wasGrounded && this.currentState.grounded) {
      // Landed
      this.currentState.jumping = false
      const impactVel = Math.abs(this.currentState.velocity.y)
      this.onLand?.(impactVel)
    } else if (this.wasGrounded && !this.currentState.grounded) {
      // Left ground
      this.onGroundedChange?.(false)
    }

    if (this.currentState.grounded !== this.wasGrounded) {
      this.onGroundedChange?.(this.currentState.grounded)
    }
  }

  /** Sync internal state with physics body. */
  private syncState(): void {
    if (!this.body) return

    const pos = this.body.translation()

    // Position is at capsule center, so adjust for feet position
    this.currentState.position.set(
      pos.x,
      pos.y - this.config.height / 2 - this.config.radius,
      pos.z,
    )

    // Use computed velocity from character controller movement
    this.currentState.velocity.copy(this.computedVelocity)
    this.currentState.speed = new THREE.Vector3(
      this.computedVelocity.x,
      0,
      this.computedVelocity.z,
    ).length()
  }

  /** Get current character state. */
  getState(): Readonly<CharacterState> {
    return this.currentState
  }

  /** Get the Rapier rigid body (for advanced usage). */
  getRigidBody(): RAPIER.RigidBody | null {
    return this.body
  }

  /** Get the Rapier collider (for advanced usage). */
  getCollider(): RAPIER.Collider | null {
    return this.collider
  }

  /** Get the Rapier character controller (for advanced usage). */
  getController(): RAPIER.KinematicCharacterController | null {
    return this.controller
  }

  /** Teleport character to a new position instantly. */
  teleport(position: THREE.Vector3): void {
    if (!this.body) return
    const targetY = position.y + this.config.height / 2 + this.config.radius
    this.body.setNextKinematicTranslation({ x: position.x, y: targetY, z: position.z })
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    // Step physics to update attached collider positions
    this.physicsWorld.step(0)
    this.syncState()
  }

  /** Apply an external impulse (e.g., from explosion, knockback). */
  applyImpulse(impulse: THREE.Vector3): void {
    if (!this.body) return
    // For kinematic bodies, we accumulate the impulse into desired velocity
    this.desiredVelocity.add(impulse)
  }

  /** Set character config at runtime. */
  setConfig(config: Partial<CharacterControllerConfig>): void {
    this.config = { ...this.config, ...config }
    if (this.collider) {
      this.collider.setFriction(this.config.dynamicFriction)
    }
    if (this.controller) {
      this.controller.setMaxSlopeClimbAngle(this.config.maxSlopeAngle)
      this.controller.enableAutostep(this.config.maxStepHeight, this.config.radius * 2, false)
    }
  }

  /** Get current config. */
  getConfig(): Readonly<CharacterControllerConfig> {
    return this.config
  }

  /** Dispose the character controller. */
  dispose(): void {
    if (this.controller) {
      const world = this.physicsWorld.getWorld()
      if (world) {
        world.removeCharacterController(this.controller)
      }
      this.controller = null
    }
    if (this.body) {
      this.physicsWorld.removeRigidBody(this.body)
      this.body = null
    }
    if (this.collider) {
      this.physicsWorld.removeCollider(this.collider)
      this.collider = null
    }
    this.initialized = false
  }
}