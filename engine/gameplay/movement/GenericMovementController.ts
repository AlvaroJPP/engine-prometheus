import * as THREE from 'three'

export interface MovementConfig {
  maxSpeed: number
  acceleration: number
  deceleration: number
  gravity: number
  maxSlopeAngle: number
  maxStepHeight: number
  jumpImpulse?: number
  canJump: boolean
}

export interface MovementInput {
  moveDirection: THREE.Vector3
  jump: boolean
  sprint: boolean
}

export interface MovementState {
  velocity: THREE.Vector3
  isGrounded: boolean
  isJumping: boolean
  currentSpeed: number
}

export class GenericMovementController {
  private config: MovementConfig
  private state: MovementState = {
    velocity: new THREE.Vector3(),
    isGrounded: false,
    isJumping: false,
    currentSpeed: 0,
  }

  constructor(config: MovementConfig) {
    this.config = config
  }

  update(deltaTime: number, input: MovementInput, grounded: boolean, velocity: THREE.Vector3): MovementState {
    this.state.isGrounded = grounded
    this.state.velocity.copy(velocity)

    // Calculate desired velocity
    const targetVelocity = input.moveDirection.clone().multiplyScalar(input.sprint ? this.config.maxSpeed * 1.5 : this.config.maxSpeed)

    // In a pure controller, we might want to return the "desired" velocity
    // based on physics, but this controller was designed to calculate it.
    // For now, let's keep it simple: it calculates the state based on external physics state.

    this.state.currentSpeed = new THREE.Vector3(this.state.velocity.x, 0, this.state.velocity.z).length()

    return this.state
  }

  getState(): MovementState {
    return { ...this.state }
  }
}
