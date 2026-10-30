import * as RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

export interface PhysicsConfig {
  gravity: THREE.Vector3
  timeStep: number
  maxSubSteps: number
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  gravity: new THREE.Vector3(0, -9.81, 0),
  timeStep: 1 / 60,
  maxSubSteps: 4,
}

export class PhysicsWorld {
  private world: RAPIER.World | null = null
  private config: PhysicsConfig
  private isInitialized = false
  private initializationPromise: Promise<void> | null = null
  private eventQueue: RAPIER.EventQueue | null = null

  constructor(config: Partial<PhysicsConfig> = {}) {
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...config }
  }

  /** Initialize Rapier WASM module and create the physics world. */
  async initialize(): Promise<void> {
    if (this.isInitialized) return
    if (this.initializationPromise) return this.initializationPromise

    this.initializationPromise = (async () => {
      await RAPIER.init()
      const gravity = new RAPIER.Vector3(
        this.config.gravity.x,
        this.config.gravity.y,
        this.config.gravity.z,
      )
      this.world = new RAPIER.World(gravity)
      this.eventQueue = new RAPIER.EventQueue(true)
      this.isInitialized = true
    })()

    return this.initializationPromise
  }

  /** Get the underlying Rapier world instance. */
  getWorld(): RAPIER.World | null {
    return this.world
  }

  /** Get the event queue for collision events. */
  getEventQueue(): RAPIER.EventQueue | null {
    return this.eventQueue
  }

  /** Check if the physics world is initialized. */
  isReady(): boolean {
    return this.isInitialized && this.world !== null
  }

  /** Step the physics simulation. */
  step(deltaTime?: number): void {
    if (!this.world) return
    const dt = deltaTime ?? this.config.timeStep
    this.world.timestep = dt
    this.world.step(this.eventQueue ?? undefined)
  }

  /** Create a rigid body. */
  createRigidBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody | null {
    if (!this.world) return null
    return this.world.createRigidBody(desc)
  }

  /** Create a collider attached to a rigid body. */
  createCollider(
    desc: RAPIER.ColliderDesc,
    body: RAPIER.RigidBody,
  ): RAPIER.Collider | null {
    if (!this.world) return null
    return this.world.createCollider(desc, body)
  }

  /** Remove a rigid body and its colliders. */
  removeRigidBody(body: RAPIER.RigidBody): void {
    if (!this.world) return
    this.world.removeRigidBody(body)
  }

  /** Remove a collider. */
  removeCollider(collider: RAPIER.Collider): void {
    if (!this.world) return
    this.world.removeCollider(collider, true)
  }

  /** Raycast from origin in direction. */
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    groups?: RAPIER.InteractionGroups,
  ): RAPIER.RayColliderHit | null {
    if (!this.world) return null
    const ray = new RAPIER.Ray(
      new RAPIER.Vector3(origin.x, origin.y, origin.z),
      new RAPIER.Vector3(direction.x, direction.y, direction.z),
    )
    return this.world.castRay(ray, maxDistance, true, undefined, groups)
  }

  /** Raycast and return the first hit with Three.js vector. */
  raycastFirst(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): { hit: boolean; point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null {
    const result = this.raycast(origin, direction, maxDistance)
    if (!result) return null

    const hitPoint = new THREE.Vector3().addScaledVector(direction, result.timeOfImpact)

    return {
      hit: true,
      point: hitPoint,
      normal: new THREE.Vector3(0, 1, 0), // Normal not available in RayColliderHit
      distance: result.timeOfImpact,
    }
  }

  /** Raycast with normal. */
  raycastWithNormal(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): RAPIER.RayColliderIntersection | null {
    if (!this.world) return null
    const ray = new RAPIER.Ray(
      new RAPIER.Vector3(origin.x, origin.y, origin.z),
      new RAPIER.Vector3(direction.x, direction.y, direction.z),
    )
    return this.world.castRayAndGetNormal(ray, maxDistance, true)
  }

  /** Query shapes overlapping a sphere. */
  overlapSphere(
    center: THREE.Vector3,
    radius: number,
    callback: (collider: RAPIER.Collider) => boolean,
    groups?: RAPIER.InteractionGroups,
  ): void {
    if (!this.world) return
    const colliderDesc = RAPIER.ColliderDesc.ball(radius).setTranslation(
      center.x,
      center.y,
      center.z,
    )
    // We need to create a temporary shape for the query
    const shape = colliderDesc.shape
    this.world.intersectionsWithShape(
      new RAPIER.Vector3(center.x, center.y, center.z),
      RAPIER.RotationOps.identity(),
      shape,
      callback,
      undefined,
      groups,
    )
  }

  /** Set gravity. */
  setGravity(gravity: THREE.Vector3): void {
    this.config.gravity.copy(gravity)
    if (this.world) {
      this.world.gravity.x = gravity.x
      this.world.gravity.y = gravity.y
      this.world.gravity.z = gravity.z
    }
  }

  /** Get current gravity. */
  getGravity(): THREE.Vector3 {
    return this.config.gravity.clone()
  }

  /** Set time step. */
  setTimeStep(timeStep: number): void {
    this.config.timeStep = timeStep
    if (this.world) {
      this.world.timestep = timeStep
    }
  }

  /** Get current time step. */
  getTimeStep(): number {
    return this.config.timeStep
  }

  /** Enable/disable sleeping for performance. */
  setSleeping(_enabled: boolean): void {
    // Note: sleepDisabled doesn't exist in this version
    // Use integration parameters or other methods if needed
  }

  /** Get number of active rigid bodies. */
  getActiveBodyCount(): number {
    if (!this.world) return 0
    let count = 0
    this.world.forEachRigidBody(() => { count++ })
    return count
  }

  /** Get number of active colliders. */
  getActiveColliderCount(): number {
    if (!this.world) return 0
    let count = 0
    this.world.forEachCollider(() => { count++ })
    return count
  }

  /** Dispose the physics world and free resources. */
  dispose(): void {
    if (this.world) {
      this.world.free()
      this.world = null
      this.isInitialized = false
    }
    if (this.eventQueue) {
      this.eventQueue.free()
      this.eventQueue = null
    }
  }

  /** Convert Three.js vector to Rapier vector. */
  static toRapier(vec: THREE.Vector3): RAPIER.Vector3 {
    return new RAPIER.Vector3(vec.x, vec.y, vec.z)
  }

  /** Convert Rapier vector to Three.js vector. */
  static toThree(vec: RAPIER.Vector3): THREE.Vector3 {
    return new THREE.Vector3(vec.x, vec.y, vec.z)
  }

  /** Convert Three.js quaternion to Rapier rotation. */
  static toRapierRotation(quat: THREE.Quaternion): RAPIER.Quaternion {
    return new RAPIER.Quaternion(quat.x, quat.y, quat.z, quat.w)
  }

  /** Convert Rapier rotation to Three.js quaternion. */
  static toThreeQuaternion(rot: RAPIER.Quaternion): THREE.Quaternion {
    return new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
  }
}