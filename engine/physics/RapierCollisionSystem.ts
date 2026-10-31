import * as RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PhysicsWorld, type PhysicsConfig } from './PhysicsWorld.ts'
import type { GameObject } from '../model/object/GameObject.ts'
import type { World } from '../world/World.ts'

export interface PhysicsObjectConfig {
  /** Type of collider */
  colliderType: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh' | 'auto'
  /** Mass (0 = static, >0 = dynamic) */
  mass: number
  /** Collider size (half-extents for box, radius for sphere/capsule) */
  size?: THREE.Vector3
  /** Collider offset from object center */
  offset?: THREE.Vector3
  /** Friction coefficient */
  friction?: number
  /** Restitution (bounciness) */
  restitution?: number
  /** Linear damping */
  linearDamping?: number
  /** Angular damping */
  angularDamping?: number
  /** Whether object can sleep */
  canSleep?: boolean
  /** Collision groups (bitmask) */
  collisionGroups?: RAPIER.InteractionGroups
  /** Whether this is a sensor (trigger) */
  isSensor?: boolean
  /** CCD enabled for fast-moving objects */
  ccdEnabled?: boolean
}

export const DEFAULT_PHYSICS_OBJECT_CONFIG: PhysicsObjectConfig = {
  colliderType: 'auto',
  mass: 1,
  friction: 0.6,
  restitution: 0.0,
  linearDamping: 0.01,
  angularDamping: 0.05,
  canSleep: true,
  isSensor: false,
  ccdEnabled: false,
}

export interface PhysicsObject {
  id: string
  gameObject: GameObject
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  config: PhysicsObjectConfig
}

export interface CollisionEvent {
  type: 'start' | 'end' | 'stay'
  objectA: string
  objectB: string
  contactPoint?: THREE.Vector3
  contactNormal?: THREE.Vector3
  depth?: number
}

/**
 * Rapier-based collision system for dynamic physics objects.
 * Replaces the custom SAT-based CollisionSystem for dynamic objects.
 * Static environment collision can still use the existing system.
 */
export class RapierCollisionSystem {
  private physicsWorld: PhysicsWorld
  private objects = new Map<string, PhysicsObject>()
  private colliderToObjectId = new Map<number, string>() // collider handle -> object id
  private bodyToObjectId = new Map<number, string>() // body handle -> object id
  private collisionEvents: CollisionEvent[] = []
  private eventCallbacks = new Map<string, (event: CollisionEvent) => void>()
  private debugEnabled = false
  private debugHelpers = new Map<string, THREE.LineSegments>()

  constructor(_world: World, physicsConfig?: Partial<PhysicsConfig>) {
    this.physicsWorld = new PhysicsWorld(physicsConfig)
  }

  /** Initialize the physics world. */
  async initialize(): Promise<void> {
    await this.physicsWorld.initialize()
  }

  /** Get the underlying PhysicsWorld. */
  getPhysicsWorld(): PhysicsWorld {
    return this.physicsWorld
  }

  /** Add a game object to the physics simulation. */
  addObject(gameObject: GameObject, config: Partial<PhysicsObjectConfig> = {}): PhysicsObject | null {
    if (!this.physicsWorld.isReady()) {
      console.warn('[RapierCollisionSystem] Physics world not ready')
      return null
    }

    const fullConfig: PhysicsObjectConfig = { ...DEFAULT_PHYSICS_OBJECT_CONFIG, ...config }
    const mesh = gameObject.mesh
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    const worldScale = new THREE.Vector3()
    mesh.getWorldPosition(worldPos)
    mesh.getWorldQuaternion(worldQuat)
    mesh.getWorldScale(worldScale)

    // Determine collider type from game object if auto
    let colliderType = fullConfig.colliderType
    if (colliderType === 'auto') {
      colliderType = this.inferColliderType(mesh)
    }

    // Create rigid body
    let bodyDesc: RAPIER.RigidBodyDesc
    if (fullConfig.mass <= 0) {
      bodyDesc = RAPIER.RigidBodyDesc.fixed()
    } else {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMass(fullConfig.mass)
        .setLinearDamping(fullConfig.linearDamping ?? 0.01)
        .setAngularDamping(fullConfig.angularDamping ?? 0.05)
        .setCanSleep(fullConfig.canSleep ?? true)
        .setCcdEnabled(fullConfig.ccdEnabled ?? false)
    }

    bodyDesc.setTranslation(worldPos.x, worldPos.y, worldPos.z)
    bodyDesc.setRotation(new RAPIER.Quaternion(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w))

    const rapierWorld = this.physicsWorld.getWorld()!
    const body = rapierWorld.createRigidBody(bodyDesc)

    // Create collider
    const colliderDesc = this.createColliderDesc(colliderType, mesh, fullConfig, worldScale)
    colliderDesc.setFriction(fullConfig.friction ?? 0.6)
    colliderDesc.setRestitution(fullConfig.restitution ?? 0.0)
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    colliderDesc.setSensor(fullConfig.isSensor ?? false)

    if (fullConfig.collisionGroups) {
      colliderDesc.setCollisionGroups(fullConfig.collisionGroups)
    }

    if (fullConfig.offset) {
      colliderDesc.setTranslation(fullConfig.offset.x, fullConfig.offset.y, fullConfig.offset.z)
    }

    const collider = rapierWorld.createCollider(colliderDesc, body)

    // Store mapping from handles to object id
    this.colliderToObjectId.set(collider.handle, gameObject.id)
    this.bodyToObjectId.set(body.handle, gameObject.id)

    const physicsObject: PhysicsObject = {
      id: gameObject.id,
      gameObject,
      body,
      collider,
      config: { ...fullConfig, colliderType },
    }

    this.objects.set(gameObject.id, physicsObject)
    return physicsObject
  }

  /** Remove a game object from physics simulation. */
  removeObject(id: string): void {
    const obj = this.objects.get(id)
    if (!obj) return

    this.colliderToObjectId.delete(obj.collider.handle)
    this.bodyToObjectId.delete(obj.body.handle)

    this.physicsWorld.removeCollider(obj.collider)
    this.physicsWorld.removeRigidBody(obj.body)
    this.objects.delete(id)
  }

  /** Update a physics object's transform from its GameObject. */
  updateObjectTransform(id: string): void {
    const obj = this.objects.get(id)
    if (!obj || obj.config.mass === 0) return // Don't update static bodies

    const mesh = obj.gameObject.mesh
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    mesh.getWorldPosition(worldPos)
    mesh.getWorldQuaternion(worldQuat)

    obj.body.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true)
    obj.body.setRotation(new RAPIER.Quaternion(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w), true)
  }

  /** Sync all dynamic objects from physics to GameObjects. */
  syncFromPhysics(): void {
    for (const obj of this.objects.values()) {
      if (obj.config.mass === 0) continue // Skip static

      const pos = obj.body.translation()
      const rot = obj.body.rotation()

      obj.gameObject.mesh.position.set(pos.x, pos.y, pos.z)
      obj.gameObject.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w)
    }
  }

  /** Sync a specific object from physics to GameObject. */
  syncObjectFromPhysics(id: string): void {
    const obj = this.objects.get(id)
    if (!obj || obj.config.mass === 0) return

    const pos = obj.body.translation()
    const rot = obj.body.rotation()

    obj.gameObject.mesh.position.set(pos.x, pos.y, pos.z)
    obj.gameObject.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w)
  }

  /** Sync GameObject to physics (for kinematic objects). */
  syncObjectToPhysics(id: string): void {
    const obj = this.objects.get(id)
    if (!obj) return

    const mesh = obj.gameObject.mesh
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    mesh.getWorldPosition(worldPos)
    mesh.getWorldQuaternion(worldQuat)

    obj.body.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true)
    obj.body.setRotation(new RAPIER.Quaternion(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w), true)
  }

  /** Step the physics simulation. */
  step(deltaTime?: number): void {
    this.physicsWorld.step(deltaTime)
    this.processCollisionEvents()
  }

  /** Process collision events from Rapier. */
  private processCollisionEvents(): void {
    const eventQueue = this.physicsWorld.getEventQueue()
    const rapierWorld = this.physicsWorld.getWorld()
    if (!eventQueue || !rapierWorld) return

    this.collisionEvents.length = 0

    // Drain collision events (start/end)
    eventQueue.drainCollisionEvents((handleA: number, handleB: number, started: boolean) => {
      const objA = this.findObjectByColliderHandle(handleA)
      const objB = this.findObjectByColliderHandle(handleB)
      if (!objA || !objB) return

      const event: CollisionEvent = {
        type: started ? 'start' : 'end',
        objectA: objA.id,
        objectB: objB.id,
      }

      this.collisionEvents.push(event)
      this.notifyCallbacks(event)
    })

    // Note: Intersection events (sensors) would need contact force events or manual checking
    // For now we handle collision events only
  }

  /** Find physics object by collider handle. */
  private findObjectByColliderHandle(handle: number): PhysicsObject | undefined {
    const id = this.colliderToObjectId.get(handle)
    if (!id) return undefined
    return this.objects.get(id)
  }

  /** Register a collision event callback. */
  onCollision(callbackId: string, callback: (event: CollisionEvent) => void): void {
    this.eventCallbacks.set(callbackId, callback)
  }

  /** Unregister a collision event callback. */
  offCollision(callbackId: string): void {
    this.eventCallbacks.delete(callbackId)
  }

  /** Notify all registered callbacks. */
  private notifyCallbacks(event: CollisionEvent): void {
    for (const callback of this.eventCallbacks.values()) {
      try {
        callback(event)
      } catch (e) {
        console.error('[RapierCollisionSystem] Callback error:', e)
      }
    }
  }

  /** Get all collision events from last step. */
  getCollisionEvents(): ReadonlyArray<CollisionEvent> {
    return this.collisionEvents
  }

  /** Apply impulse to an object. */
  applyImpulse(id: string, impulse: THREE.Vector3, point?: THREE.Vector3): void {
    const obj = this.objects.get(id)
    if (!obj || obj.config.mass === 0) return

    if (point) {
      obj.body.applyImpulseAtPoint(
        new RAPIER.Vector3(impulse.x, impulse.y, impulse.z),
        new RAPIER.Vector3(point.x, point.y, point.z),
        true,
      )
    } else {
      obj.body.applyImpulse(
        new RAPIER.Vector3(impulse.x, impulse.y, impulse.z),
        true,
      )
    }
  }

  /** Apply force to an object. */
  applyForce(id: string, force: THREE.Vector3, point?: THREE.Vector3): void {
    const obj = this.objects.get(id)
    if (!obj || obj.config.mass === 0) return

    if (point) {
      obj.body.addForceAtPoint(
        new RAPIER.Vector3(force.x, force.y, force.z),
        new RAPIER.Vector3(point.x, point.y, point.z),
        true,
      )
    } else {
      obj.body.addForce(
        new RAPIER.Vector3(force.x, force.y, force.z),
        true,
      )
    }
  }

  /** Set object velocity directly. */
  setVelocity(id: string, linear: THREE.Vector3, angular?: THREE.Vector3): void {
    const obj = this.objects.get(id)
    if (!obj || obj.config.mass === 0) return

    obj.body.setLinvel(new RAPIER.Vector3(linear.x, linear.y, linear.z), true)
    if (angular) {
      obj.body.setAngvel(new RAPIER.Vector3(angular.x, angular.y, angular.z), true)
    }
  }

  /** Get object velocity. */
  getVelocity(id: string): { linear: THREE.Vector3; angular: THREE.Vector3 } | null {
    const obj = this.objects.get(id)
    if (!obj) return null

    const linvel = obj.body.linvel()
    const angvel = obj.body.angvel()

    return {
      linear: new THREE.Vector3(linvel.x, linvel.y, linvel.z),
      angular: new THREE.Vector3(angvel.x, angvel.y, angvel.z),
    }
  }

  /** Raycast against physics objects. */
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): { objectId: string; point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null {
    const result = this.physicsWorld.raycastWithNormal(origin, direction, maxDistance)
    if (!result) return null

    // Find which object was hit
    const objId = this.colliderToObjectId.get(result.collider.handle)
    if (!objId) return null

    const hitPoint = new THREE.Vector3().addScaledVector(direction, result.toi)

    return {
      objectId: objId,
      point: hitPoint,
      normal: new THREE.Vector3(result.normal.x, result.normal.y, result.normal.z),
      distance: result.toi,
    }
  }

  /** Enable/disable debug visualization. */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled
    if (!enabled) {
      this.clearDebugHelpers()
    }
  }

  /** Update debug visualization. */
  updateDebug(): void {
    if (!this.debugEnabled) return

    const rapierWorld = this.physicsWorld.getWorld()
    if (!rapierWorld) return

    // Update existing helpers
    for (const [id, helper] of this.debugHelpers) {
      const obj = this.objects.get(id)
      if (obj) {
        const pos = obj.body.translation()
        const rot = obj.body.rotation()
        helper.position.set(pos.x, pos.y, pos.z)
        helper.quaternion.set(rot.x, rot.y, rot.z, rot.w)
      } else {
        // Object removed, clean up helper
        helper.geometry.dispose()
        if (helper.material instanceof THREE.Material) helper.material.dispose()
        this.debugHelpers.delete(id)
      }
    }

    // Add helpers for new objects
    for (const obj of this.objects.values()) {
      if (!this.debugHelpers.has(obj.id)) {
        const helper = this.createDebugHelper(obj)
        if (helper) {
          // Note: World doesn't have getScene() method, scene management is external
          // this.world.getScene()?.add(helper) - commented out
          this.debugHelpers.set(obj.id, helper)
        }
      }
    }
  }

  /** Create debug wireframe for a physics object. */
  private createDebugHelper(obj: PhysicsObject): THREE.LineSegments | null {
    const config = obj.config
    let geometry: THREE.BufferGeometry

    switch (config.colliderType) {
      case 'box': {
        const size = config.size || new THREE.Vector3(1, 1, 1)
        geometry = new THREE.BoxGeometry(size.x * 2, size.y * 2, size.z * 2)
        break
      }
      case 'sphere': {
        const radius = config.size?.x || 1
        geometry = new THREE.SphereGeometry(radius, 16, 16)
        break
      }
      case 'capsule': {
        const radius = config.size?.x || 0.5
        const height = config.size?.y || 1
        geometry = new THREE.CapsuleGeometry(radius, height, 8, 16)
        break
      }
      case 'cylinder': {
        const radius = config.size?.x || 0.5
        const height = config.size?.y || 1
        geometry = new THREE.CylinderGeometry(radius, radius, height, 16)
        break
      }
      default:
        return null
    }

    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({
      color: config.mass === 0 ? 0x00ff00 : 0xffaa00,
      transparent: true,
      opacity: 0.5,
    })

    return new THREE.LineSegments(edges, material)
  }

  /** Clear debug helpers. */
  private clearDebugHelpers(): void {
    for (const helper of this.debugHelpers.values()) {
      helper.geometry.dispose()
      if (helper.material instanceof THREE.Material) helper.material.dispose()
      // this.world.getScene()?.remove(helper) - commented out
    }
    this.debugHelpers.clear()
  }

  /** Infer collider type from GameObject mesh. */
  private inferColliderType(mesh: THREE.Object3D): 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh' {
    const userData = mesh.userData
    if (userData.colliderType) return userData.colliderType

    // Check for primitive types
    if (mesh instanceof THREE.Mesh) {
      const geom = mesh.geometry
      if (geom.type === 'BoxGeometry') return 'box'
      if (geom.type === 'SphereGeometry') return 'sphere'
      if (geom.type === 'CapsuleGeometry') return 'capsule'
      if (geom.type === 'CylinderGeometry') return 'cylinder'
    }

    // Default to box for unknown types
    return 'box'
  }

  /** Create collider description based on type and mesh. */
  private createColliderDesc(
    type: string,
    _mesh: THREE.Object3D,
    config: PhysicsObjectConfig,
    worldScale: THREE.Vector3,
  ): RAPIER.ColliderDesc {
    const size = config.size || new THREE.Vector3(1, 1, 1)

    switch (type) {
      case 'box':
        return RAPIER.ColliderDesc.cuboid(
          size.x * worldScale.x,
          size.y * worldScale.y,
          size.z * worldScale.z,
        )

      case 'sphere':
        return RAPIER.ColliderDesc.ball(size.x * Math.max(worldScale.x, worldScale.y, worldScale.z))

      case 'capsule':
        return RAPIER.ColliderDesc.capsule(
          size.y * worldScale.y / 2,
          size.x * Math.max(worldScale.x, worldScale.z),
        )

      case 'cylinder':
        return RAPIER.ColliderDesc.cylinder(
          size.y * worldScale.y / 2,
          size.x * worldScale.x,
        )

      case 'mesh':
        // For mesh colliders, we'd need to extract vertices/indices
        // This is complex and would need a trimesh or convex hull
        // Fall back to box for now
        console.warn('[RapierCollisionSystem] Mesh colliders not fully implemented, using box')
        return RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z)

      default:
        return RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z)
    }
  }

  /** Get all physics objects. */
  getObjects(): ReadonlyMap<string, PhysicsObject> {
    return this.objects
  }

  /** Get physics object by ID. */
  getObject(id: string): PhysicsObject | undefined {
    return this.objects.get(id)
  }

  /** Check if an object exists in physics. */
  hasObject(id: string): boolean {
    return this.objects.has(id)
  }

  /** Get number of active dynamic bodies. */
  getDynamicBodyCount(): number {
    let count = 0
    for (const obj of this.objects.values()) {
      if (obj.config.mass > 0) count++
    }
    return count
  }

  /** Get number of static bodies. */
  getStaticBodyCount(): number {
    let count = 0
    for (const obj of this.objects.values()) {
      if (obj.config.mass === 0) count++
    }
    return count
  }

  /** Set gravity. */
  setGravity(gravity: THREE.Vector3): void {
    this.physicsWorld.setGravity(gravity)
  }

  /** Dispose the collision system. */
  dispose(): void {
    this.clearDebugHelpers()
    for (const obj of this.objects.values()) {
      this.physicsWorld.removeCollider(obj.collider)
      this.physicsWorld.removeRigidBody(obj.body)
    }
    this.objects.clear()
    this.colliderToObjectId.clear()
    this.bodyToObjectId.clear()
    this.physicsWorld.dispose()
  }
}