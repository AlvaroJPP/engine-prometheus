import * as THREE from 'three'
import * as RAPIER from '@dimforge/rapier3d-compat'
import { PhysicsWorld } from './PhysicsWorld.ts'
import { RapierCollisionSystem } from './RapierCollisionSystem.ts'
import { NavMesh } from './NavMesh.ts'

export interface DebugConfig {
  /** Show rigid body wireframes */
  showWireframes: boolean
  /** Show collider wireframes */
  showColliders: boolean
  /** Show contact points */
  showContacts: boolean
  /** Show contact normals */
  showContactNormals: boolean
  /** Show AABBs */
  showAABBs: boolean
  /** Show center of mass */
  showCenterOfMass: boolean
  /** Show velocity vectors */
  showVelocities: boolean
  /** Show navmesh polygons */
  showNavMesh: boolean
  /** Show navmesh tile boundaries */
  showNavMeshTiles: boolean
  /** Show navmesh polygon centers */
  showNavMeshCenters: boolean
  /** Navmesh path highlight */
  showNavMeshPath: boolean
  /** Wireframe color for dynamic bodies */
  dynamicColor: THREE.Color
  /** Wireframe color for kinematic bodies */
  kinematicColor: THREE.Color
  /** Wireframe color for fixed bodies */
  fixedColor: THREE.Color
  /** Wireframe color for sensors */
  sensorColor: THREE.Color
  /** Contact point color */
  contactColor: THREE.Color
  /** Contact normal color */
  contactNormalColor: THREE.Color
  /** Navmesh color */
  navMeshColor: THREE.Color
  /** Navmesh path color */
  navMeshPathColor: THREE.Color
  /** Line width for wireframes */
  lineWidth: number
  /** Point size for contacts */
  pointSize: number
  /** Max contact points to display */
  maxContactPoints: number
}

export const DEFAULT_DEBUG_CONFIG: DebugConfig = {
  showWireframes: true,
  showColliders: true,
  showContacts: true,
  showContactNormals: true,
  showAABBs: false,
  showCenterOfMass: false,
  showVelocities: false,
  showNavMesh: true,
  showNavMeshTiles: false,
  showNavMeshCenters: false,
  showNavMeshPath: true,
  dynamicColor: new THREE.Color(0x00ff00),
  kinematicColor: new THREE.Color(0x0088ff),
  fixedColor: new THREE.Color(0x888888),
  sensorColor: new THREE.Color(0xffff00),
  contactColor: new THREE.Color(0xff0000),
  contactNormalColor: new THREE.Color(0x00ffff),
  navMeshColor: new THREE.Color(0x00ff88),
  navMeshPathColor: new THREE.Color(0xff8800),
  lineWidth: 1,
  pointSize: 4,
  maxContactPoints: 100,
}

export interface DebugContact {
  pointA: THREE.Vector3
  pointB: THREE.Vector3
  normal: THREE.Vector3
  depth: number
  colliderA: number
  colliderB: number
}

export interface DebugNavMeshPath {
  path: THREE.Vector3[]
  flags?: number[]
}

/**
 * Physics Debug Visualization System.
 *
 * Renders wireframe colliders, contact points, navmesh, and other physics debug
 * information using Three.js. Designed to be added to the scene and updated each frame.
 */
export class PhysicsDebug {
  private physicsWorld: PhysicsWorld
  private navMesh: NavMesh | null
  private config: DebugConfig
  private scene: THREE.Scene | null = null
  private disposed = false

  // Render objects
  private wireframeGroup: THREE.Group | null = null
  private contactGroup: THREE.Group | null = null
  private aabbGroup: THREE.Group | null = null
  private velocityGroup: THREE.Group | null = null
  private centerOfMassGroup: THREE.Group | null = null
  private navMeshGroup: THREE.Group | null = null
  private navMeshPathGroup: THREE.Group | null = null

  // Reusable geometry/materials
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly sphereGeometry = new THREE.SphereGeometry(1, 16, 16)
  private readonly cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 1, 16)
  private readonly coneGeometry = new THREE.ConeGeometry(1, 1, 16)
  private readonly capsuleGeometry: THREE.BufferGeometry
  private readonly lineMaterial: THREE.LineBasicMaterial
  private readonly pointMaterial: THREE.PointsMaterial
  private readonly meshMaterial: THREE.MeshBasicMaterial

  // Contact visualization
  private contactPoints: THREE.Points | null = null
  private contactNormals: THREE.LineSegments | null = null

  // Navmesh path
  private currentNavMeshPath: DebugNavMeshPath | null = null

  constructor(
    physicsWorld: PhysicsWorld,
    _collisionSystem: RapierCollisionSystem | null = null,
    navMesh: NavMesh | null = null,
    config: Partial<DebugConfig> = {},
  ) {
    this.physicsWorld = physicsWorld
    this.navMesh = navMesh
    this.config = { ...DEFAULT_DEBUG_CONFIG, ...config }

    // Create capsule geometry (not built into Three.js core)
    this.capsuleGeometry = this.createCapsuleGeometry(1, 1, 16, 8)

    // Create shared materials
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: this.config.dynamicColor,
      transparent: true,
      opacity: 0.8,
    })

    this.pointMaterial = new THREE.PointsMaterial({
      color: this.config.contactColor,
      size: this.config.pointSize,
      sizeAttenuation: true,
    })

    this.meshMaterial = new THREE.MeshBasicMaterial({
      color: this.config.dynamicColor,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    })
  }

  /** Create capsule geometry (not built into Three.js). */
  private createCapsuleGeometry(
    radius: number,
    height: number,
    radialSegments: number,
    heightSegments: number,
  ): THREE.BufferGeometry {
    // Capsule = cylinder + two hemispheres
    const geometry = new THREE.CapsuleGeometry(radius, height, radialSegments, heightSegments)
    return geometry
  }

  /** Attach to a Three.js scene. */
  attachToScene(scene: THREE.Scene): void {
    this.scene = scene

    // Create groups for organization
    this.wireframeGroup = new THREE.Group()
    this.wireframeGroup.name = 'PhysicsDebug_Wireframes'
    this.scene.add(this.wireframeGroup)

    this.contactGroup = new THREE.Group()
    this.contactGroup.name = 'PhysicsDebug_Contacts'
    this.scene.add(this.contactGroup)

    this.aabbGroup = new THREE.Group()
    this.aabbGroup.name = 'PhysicsDebug_AABBs'
    this.scene.add(this.aabbGroup)

    this.velocityGroup = new THREE.Group()
    this.velocityGroup.name = 'PhysicsDebug_Velocities'
    this.scene.add(this.velocityGroup)

    this.centerOfMassGroup = new THREE.Group()
    this.centerOfMassGroup.name = 'PhysicsDebug_CenterOfMass'
    this.scene.add(this.centerOfMassGroup)

    this.navMeshGroup = new THREE.Group()
    this.navMeshGroup.name = 'PhysicsDebug_NavMesh'
    this.scene.add(this.navMeshGroup)

    this.navMeshPathGroup = new THREE.Group()
    this.navMeshPathGroup.name = 'PhysicsDebug_NavMeshPath'
    this.scene.add(this.navMeshPathGroup)
  }

  /** Detach from scene and clean up. */
  detachFromScene(): void {
    if (!this.scene) return

    const groups = [
      this.wireframeGroup,
      this.contactGroup,
      this.aabbGroup,
      this.velocityGroup,
      this.centerOfMassGroup,
      this.navMeshGroup,
      this.navMeshPathGroup,
    ]

    for (const group of groups) {
      if (group) {
        this.scene.remove(group)
        this.disposeGroup(group)
      }
    }

    this.wireframeGroup = null
    this.contactGroup = null
    this.aabbGroup = null
    this.velocityGroup = null
    this.centerOfMassGroup = null
    this.navMeshGroup = null
    this.navMeshPathGroup = null
    this.scene = null
  }

  /** Dispose a group and its children. */
  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose())
        } else {
          child.material?.dispose()
        }
      } else if (child instanceof THREE.LineSegments || child instanceof THREE.Points) {
        child.geometry?.dispose()
        child.material?.dispose()
      }
    })
  }

  /** Update debug visualization. Call once per frame after physics step. */
  update(): void {
    if (this.disposed || !this.scene) return

    // Update wireframes
    if (this.config.showWireframes || this.config.showColliders) {
      this.updateWireframes()
    } else {
      this.clearWireframes()
    }

    // Update contacts
    if (this.config.showContacts || this.config.showContactNormals) {
      this.updateContacts()
    } else {
      this.clearContacts()
    }

    // Update AABBs
    if (this.config.showAABBs) {
      this.updateAABBs()
    } else {
      this.clearAABBs()
    }

    // Update velocities
    if (this.config.showVelocities) {
      this.updateVelocities()
    } else {
      this.clearVelocities()
    }

    // Update center of mass
    if (this.config.showCenterOfMass) {
      this.updateCenterOfMass()
    } else {
      this.clearCenterOfMass()
    }

    // Update navmesh
    if (this.config.showNavMesh && this.navMesh?.isReady()) {
      this.updateNavMesh()
    } else {
      this.clearNavMesh()
    }

    // Update navmesh path
    if (this.config.showNavMeshPath && this.currentNavMeshPath) {
      this.updateNavMeshPath()
    } else {
      this.clearNavMeshPath()
    }
  }

  /** Update wireframe visualization for all bodies/colliders. */
  private updateWireframes(): void {
    if (!this.wireframeGroup || !this.physicsWorld.isReady()) return

    this.clearWireframes()

    const world = this.physicsWorld.getWorld()
    if (!world) return

    world.forEachCollider((collider) => {
      const body = collider.parent()
      if (!body) return

      const bodyType = body.bodyType()
      const isSensor = collider.isSensor()

      // Determine color based on body type
      let color: THREE.Color
      if (isSensor) {
        color = this.config.sensorColor
      } else if (bodyType === RAPIER.RigidBodyType.Dynamic) {
        color = this.config.dynamicColor
      } else if (bodyType === RAPIER.RigidBodyType.KinematicPositionBased ||
                 bodyType === RAPIER.RigidBodyType.KinematicVelocityBased) {
        color = this.config.kinematicColor
      } else {
        color = this.config.fixedColor
      }

      // Create wireframe for collider
      const wireframe = this.createColliderWireframe(collider, color)
      if (wireframe) {
        this.wireframeGroup!.add(wireframe)
      }
    })
  }

  /** Create wireframe mesh for a collider. */
  private createColliderWireframe(
    collider: RAPIER.Collider,
    color: THREE.Color,
  ): THREE.Object3D | null {
    const shape = collider.shape

    // Get world transform
    const position = collider.translation()
    const rotation = collider.rotation()

    const mesh = new THREE.Mesh(this.getShapeGeometry(shape), this.meshMaterial.clone())
    mesh.material.color = color
    mesh.position.set(position.x, position.y, position.z)
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)

    return mesh
  }

  /** Get Three.js geometry for a Rapier shape. */
  private getShapeGeometry(shape: RAPIER.Shape): THREE.BufferGeometry {
    const shapeType = shape.type

    switch (shapeType) {
      case RAPIER.ShapeType.Ball: {
        const ballShape = shape as RAPIER.Ball
        const radius = ballShape.radius
        const geo = this.sphereGeometry.clone()
        geo.scale(radius, radius, radius)
        return geo
      }
      case RAPIER.ShapeType.Cuboid: {
        const cuboidShape = shape as RAPIER.Cuboid
        const halfExtents = cuboidShape.halfExtents
        const geo = this.boxGeometry.clone()
        geo.scale(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2)
        return geo
      }
      case RAPIER.ShapeType.Capsule: {
        const capsuleShape = shape as RAPIER.Capsule
        const radius = capsuleShape.radius
        const halfHeight = capsuleShape.halfHeight
        const geo = this.capsuleGeometry.clone()
        geo.scale(radius, halfHeight, radius)
        return geo
      }
      case RAPIER.ShapeType.Cylinder: {
        const cylinderShape = shape as RAPIER.Cylinder
        const radius = cylinderShape.radius
        const halfHeight = cylinderShape.halfHeight
        const geo = this.cylinderGeometry.clone()
        geo.scale(radius, halfHeight * 2, radius)
        return geo
      }
      case RAPIER.ShapeType.Cone: {
        const coneShape = shape as RAPIER.Cone
        const radius = coneShape.radius
        const halfHeight = coneShape.halfHeight
        const geo = this.coneGeometry.clone()
        geo.scale(radius, halfHeight * 2, radius)
        return geo
      }
      case RAPIER.ShapeType.TriMesh: {
        // For trimesh, create a line wireframe from vertices
        const triMeshShape = shape as RAPIER.TriMesh
        const vertices = triMeshShape.vertices
        const indices = triMeshShape.indices
        if (!vertices || !indices) return this.boxGeometry.clone()

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1))
        return geo
      }
      case RAPIER.ShapeType.HeightField: {
        // Heightfield is complex, use a simple box as placeholder
        const geo = this.boxGeometry.clone()
        return geo
      }
      default:
        return this.boxGeometry.clone()
    }
  }

  /** Clear wireframes. */
  private clearWireframes(): void {
    if (!this.wireframeGroup) return
    while (this.wireframeGroup.children.length > 0) {
      const child = this.wireframeGroup.children[0]
      this.wireframeGroup.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose())
        } else {
          child.material?.dispose()
        }
      }
    }
  }

  /** Update contact point visualization. */
  private updateContacts(): void {
    if (!this.contactGroup || !this.physicsWorld.isReady()) return

    this.clearContacts()

    const world = this.physicsWorld.getWorld()
    const eventQueue = this.physicsWorld.getEventQueue()
    if (!world || !eventQueue) return

    const contactPoints: THREE.Vector3[] = []
    const contactNormals: THREE.Vector3[] = []
    let count = 0

    // Use eventQueue to get collision events
    eventQueue.drainCollisionEvents((_handleA: number, _handleB: number, started: boolean) => {
      if (started) return
      if (count >= this.config.maxContactPoints) return

      // Get the actual contact manifolds from the colliders
      // Note: In Rapier, we need to check the narrow phase or use a different approach
      // For now, we'll skip detailed contact visualization since the API is limited
    })

    // Alternative: iterate over all colliders and check for contacts
    // This is a simplified approach - in a real implementation you'd use the narrow phase
    // For now we'll just clear contacts if none found
    if (contactPoints.length > 0) {
      const pointGeo = new THREE.BufferGeometry()
      pointGeo.setAttribute('position', new THREE.Float32BufferAttribute(
        contactPoints.flatMap(p => [p.x, p.y, p.z]), 3))
      this.contactPoints = new THREE.Points(pointGeo, this.pointMaterial.clone())
      this.contactGroup.add(this.contactPoints)
    }

    // Create contact normals
    if (this.config.showContactNormals && contactNormals.length > 0) {
      const normalGeo = new THREE.BufferGeometry()
      normalGeo.setAttribute('position', new THREE.Float32BufferAttribute(
        contactNormals.flatMap(p => [p.x, p.y, p.z]), 3))
      const normalMat = new THREE.LineBasicMaterial({
        color: this.config.contactNormalColor,
        transparent: true,
        opacity: 0.8,
      })
      this.contactNormals = new THREE.LineSegments(normalGeo, normalMat)
      this.contactGroup.add(this.contactNormals)
    }
  }

  /** Clear contacts. */
  private clearContacts(): void {
    if (!this.contactGroup) return

    if (this.contactPoints) {
      this.contactGroup.remove(this.contactPoints)
      this.contactPoints.geometry.dispose()
      if (Array.isArray(this.contactPoints.material)) {
        this.contactPoints.material.forEach((m) => m.dispose())
      } else {
        this.contactPoints.material?.dispose()
      }
      this.contactPoints = null
    }
    if (this.contactNormals) {
      this.contactGroup.remove(this.contactNormals)
      this.contactNormals.geometry.dispose()
      if (Array.isArray(this.contactNormals.material)) {
        this.contactNormals.material.forEach((m) => m.dispose())
      } else {
        this.contactNormals.material?.dispose()
      }
      this.contactNormals = null
    }
  }

  /** Update AABB visualization. */
  private updateAABBs(): void {
    if (!this.aabbGroup || !this.physicsWorld.isReady()) return

    this.clearAABBs()

    const world = this.physicsWorld.getWorld()
    if (!world) return

    const aabbGeo = new THREE.BufferGeometry()
    const positions: number[] = []

    // Use broad phase to get AABBs
    world.forEachCollider((collider) => {
      // Compute AABB from shape and transform
      const aabb = this.computeColliderAabb(collider)
      if (!aabb) return

      const min = aabb.min
      const max = aabb.max

      // 12 edges of a box
      const corners = [
        [min.x, min.y, min.z], [max.x, min.y, min.z],
        [max.x, min.y, min.z], [max.x, max.y, min.z],
        [max.x, max.y, min.z], [min.x, max.y, min.z],
        [min.x, max.y, min.z], [min.x, min.y, min.z],

        [min.x, min.y, max.z], [max.x, min.y, max.z],
        [max.x, min.y, max.z], [max.x, max.y, max.z],
        [max.x, max.y, max.z], [min.x, max.y, max.z],
        [min.x, max.y, max.z], [min.x, min.y, max.z],

        [min.x, min.y, min.z], [min.x, min.y, max.z],
        [max.x, min.y, min.z], [max.x, min.y, max.z],
        [max.x, max.y, min.z], [max.x, max.y, max.z],
        [min.x, max.y, min.z], [min.x, max.y, max.z],
      ]

      for (const corner of corners) {
        positions.push(corner[0], corner[1], corner[2])
      }
    })

    if (positions.length > 0) {
      aabbGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const aabbMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
      })
      const aabbLines = new THREE.LineSegments(aabbGeo, aabbMat)
      this.aabbGroup.add(aabbLines)
    }
  }

  /** Compute approximate AABB for a collider. */
  private computeColliderAabb(collider: RAPIER.Collider): { min: RAPIER.Vector3; max: RAPIER.Vector3 } | null {
    const translation = collider.translation()
    const shape = collider.shape

    // Get shape extents based on type
    let halfExtents = new RAPIER.Vector3(1, 1, 1) // default

    switch (shape.type) {
      case RAPIER.ShapeType.Ball: {
        const ball = shape as RAPIER.Ball
        const r = ball.radius
        halfExtents = new RAPIER.Vector3(r, r, r)
        break
      }
      case RAPIER.ShapeType.Cuboid: {
        const cuboid = shape as RAPIER.Cuboid
        halfExtents = new RAPIER.Vector3(cuboid.halfExtents.x, cuboid.halfExtents.y, cuboid.halfExtents.z)
        break
      }
      case RAPIER.ShapeType.Capsule: {
        const capsule = shape as RAPIER.Capsule
        const r = capsule.radius
        const h = capsule.halfHeight + capsule.radius
        halfExtents = new RAPIER.Vector3(r, h, r)
        break
      }
      case RAPIER.ShapeType.Cylinder: {
        const cylinder = shape as RAPIER.Cylinder
        const r = cylinder.radius
        const h = cylinder.halfHeight
        halfExtents = new RAPIER.Vector3(r, h, r)
        break
      }
      case RAPIER.ShapeType.Cone: {
        const cone = shape as RAPIER.Cone
        const r = cone.radius
        const h = cone.halfHeight
        halfExtents = new RAPIER.Vector3(r, h, r)
        break
      }
      case RAPIER.ShapeType.TriMesh:
      case RAPIER.ShapeType.Polyline: {
        // For mesh shapes, use a default size
        halfExtents = new RAPIER.Vector3(10, 10, 10)
        break
      }
      default: {
        halfExtents = new RAPIER.Vector3(1, 1, 1)
      }
    }

    // Account for rotation by using the maximum extent on all axes
    // This is a conservative approximation
    const maxExtent = Math.max(halfExtents.x, halfExtents.y, halfExtents.z)
    const conservativeExtent = new RAPIER.Vector3(maxExtent, maxExtent, maxExtent)

    return {
      min: new RAPIER.Vector3(
        translation.x - conservativeExtent.x,
        translation.y - conservativeExtent.y,
        translation.z - conservativeExtent.z,
      ),
      max: new RAPIER.Vector3(
        translation.x + conservativeExtent.x,
        translation.y + conservativeExtent.y,
        translation.z + conservativeExtent.z,
      ),
    }
  }

  /** Clear AABBs. */
  private clearAABBs(): void {
    if (!this.aabbGroup) return
    while (this.aabbGroup.children.length > 0) {
      const child = this.aabbGroup.children[0]
      this.aabbGroup.remove(child)
      if (child instanceof THREE.LineSegments) {
        child.geometry?.dispose()
        child.material?.dispose()
      }
    }
  }

  /** Update velocity vectors. */
  private updateVelocities(): void {
    if (!this.velocityGroup || !this.physicsWorld.isReady()) return

    this.clearVelocities()

    const world = this.physicsWorld.getWorld()
    if (!world) return

    world.forEachRigidBody((body) => {
      if (body.bodyType() !== RAPIER.RigidBodyType.Dynamic) return

      const pos = body.translation()
      const vel = body.linvel()
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

      if (speed < 0.01) return

      // Draw velocity vector
      const points = [
        new THREE.Vector3(pos.x, pos.y, pos.z),
        new THREE.Vector3(pos.x + vel.x, pos.y + vel.y, pos.z + vel.z),
      ]

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(
        points.flatMap(p => [p.x, p.y, p.z]), 3))

      const mat = new THREE.LineBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 0.8,
      })

      const line = new THREE.Line(geo, mat)
      this.velocityGroup!.add(line)
    })
  }

  /** Clear velocities. */
  private clearVelocities(): void {
    if (!this.velocityGroup) return
    while (this.velocityGroup.children.length > 0) {
      const child = this.velocityGroup.children[0]
      this.velocityGroup.remove(child)
      if (child instanceof THREE.Line) {
        child.geometry?.dispose()
        child.material?.dispose()
      }
    }
  }

  /** Update center of mass markers. */
  private updateCenterOfMass(): void {
    if (!this.centerOfMassGroup || !this.physicsWorld.isReady()) return

    this.clearCenterOfMass()

    const world = this.physicsWorld.getWorld()
    if (!world) return

    world.forEachRigidBody((body) => {
      const com = body.worldCom()
      const pos = body.translation()

      // Draw center of mass as small sphere
      const sphereGeo = new THREE.SphereGeometry(0.05, 8, 8)
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff00ff })
      const sphere = new THREE.Mesh(sphereGeo, sphereMat)
      sphere.position.set(com.x, com.y, com.z)
      this.centerOfMassGroup!.add(sphere)

      // Draw line from body origin to COM
      const points = [
        new THREE.Vector3(pos.x, pos.y, pos.z),
        new THREE.Vector3(com.x, com.y, com.z),
      ]
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(
        points.flatMap(p => [p.x, p.y, p.z]), 3))
      const mat = new THREE.LineBasicMaterial({ color: 0xff00ff, opacity: 0.5, transparent: true })
      const line = new THREE.Line(geo, mat)
      this.centerOfMassGroup!.add(line)
    })
  }

  /** Clear center of mass. */
  private clearCenterOfMass(): void {
    if (!this.centerOfMassGroup) return
    while (this.centerOfMassGroup.children.length > 0) {
      const child = this.centerOfMassGroup.children[0]
      this.centerOfMassGroup.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m: THREE.Material) => m.dispose())
        } else {
          child.material?.dispose()
        }
      } else if (child instanceof THREE.Line) {
        child.geometry?.dispose()
        child.material?.dispose()
      }
    }
  }

  /** Update navmesh visualization. */
  private updateNavMesh(): void {
    if (!this.navMeshGroup || !this.navMesh?.isReady()) return

    this.clearNavMesh()

    const allNodes = this.navMesh.getAllNodes()
    if (!allNodes || allNodes.length === 0) return

    // Draw walkable nodes as small squares
    const geo = new THREE.BufferGeometry()
    const positions: number[] = []

    for (const node of allNodes) {
      if (!node.walkable) continue

      const size = this.navMesh.getConfig().cellSize * 0.4
      const x = node.position.x
      const y = node.position.y + 0.01
      const z = node.position.z

      // Square outline (4 lines)
      const corners = [
        [x - size, y, z - size], [x + size, y, z - size],
        [x + size, y, z - size], [x + size, y, z + size],
        [x + size, y, z + size], [x - size, y, z + size],
        [x - size, y, z + size], [x - size, y, z - size],
      ]

      for (const corner of corners) {
        positions.push(corner[0], corner[1], corner[2])
      }
    }

    if (positions.length > 0) {
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const mat = new THREE.LineBasicMaterial({
        color: this.config.navMeshColor,
        transparent: true,
        opacity: 0.5,
      })
      const line = new THREE.LineSegments(geo, mat)
      this.navMeshGroup!.add(line)
    }
  }

  /** Clear navmesh. */
  private clearNavMesh(): void {
    if (!this.navMeshGroup) return
    while (this.navMeshGroup.children.length > 0) {
      const child = this.navMeshGroup.children[0]
      this.navMeshGroup.remove(child)
      if (child instanceof THREE.LineSegments) {
        child.geometry?.dispose()
        child.material?.dispose()
      }
    }
  }

  /** Set navmesh path to visualize. */
  setNavMeshPath(path: DebugNavMeshPath | null): void {
    this.currentNavMeshPath = path
  }

  /** Update navmesh path visualization. */
  private updateNavMeshPath(): void {
    if (!this.navMeshPathGroup || !this.currentNavMeshPath) return

    this.clearNavMeshPath()

    const { path } = this.currentNavMeshPath
    if (path.length < 2) return

    const points = path.map(p => new THREE.Vector3(p.x, p.y + 0.05, p.z))

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      points.flatMap(p => [p.x, p.y, p.z]), 3))

    const mat = new THREE.LineBasicMaterial({
      color: this.config.navMeshPathColor,
      transparent: true,
      opacity: 1.0,
    })

    const line = new THREE.Line(geo, mat)
    this.navMeshPathGroup.add(line)

    // Add waypoint markers
    for (const point of points) {
      const sphereGeo = new THREE.SphereGeometry(0.08, 8, 8)
      const sphereMat = new THREE.MeshBasicMaterial({ color: this.config.navMeshPathColor })
      const sphere = new THREE.Mesh(sphereGeo, sphereMat)
      sphere.position.copy(point)
      this.navMeshPathGroup.add(sphere)
    }
  }

  /** Clear navmesh path. */
  private clearNavMeshPath(): void {
    if (!this.navMeshPathGroup) return
    while (this.navMeshPathGroup.children.length > 0) {
      const child = this.navMeshPathGroup.children[0]
      this.navMeshPathGroup.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m: THREE.Material) => m.dispose())
        } else {
          child.material?.dispose()
        }
      } else if (child instanceof THREE.Line) {
        child.geometry?.dispose()
        child.material?.dispose()
      }
    }
  }

  /** Update configuration at runtime. */
  setConfig(config: Partial<DebugConfig>): void {
    this.config = { ...this.config, ...config }

    // Update materials
    this.lineMaterial.color = this.config.dynamicColor
    // Note: linewidth is not supported on all platforms
    this.pointMaterial.color = this.config.contactColor
    this.pointMaterial.size = this.config.pointSize
  }

  /** Get current config. */
  getConfig(): Readonly<DebugConfig> {
    return this.config
  }

  /** Enable/disable specific debug features. */
  setFeature(feature: keyof DebugConfig, enabled: boolean): void {
    ;(this.config as unknown as Record<string, boolean>)[feature] = enabled
  }

  /** Check if a debug feature is enabled. */
  isFeatureEnabled(feature: keyof DebugConfig): boolean {
    return this.config[feature] as unknown as boolean
  }

  /** Dispose all resources. */
  dispose(): void {
    this.disposed = true
    this.detachFromScene()

    // Dispose geometries
    this.boxGeometry.dispose()
    this.sphereGeometry.dispose()
    this.cylinderGeometry.dispose()
    this.coneGeometry.dispose()
    this.capsuleGeometry.dispose()

    // Dispose materials
    this.lineMaterial.dispose()
    this.pointMaterial.dispose()
    this.meshMaterial.dispose()
  }
}

/**
 * Simple debug drawer for quick physics visualization without full PhysicsDebug.
 * Useful for one-off debug rendering.
 */
export class SimplePhysicsDebugDrawer {
  private physicsWorld: PhysicsWorld
  private scene: THREE.Scene
  private lines: THREE.LineSegments[] = []
  private points: THREE.Points[] = []
  private meshes: THREE.Mesh[] = []

  constructor(physicsWorld: PhysicsWorld, scene: THREE.Scene) {
    this.physicsWorld = physicsWorld
    this.scene = scene
  }

  /** Draw all colliders as wireframes. */
  drawColliders(color = 0x00ff00): void {
    this.clear()

    if (!this.physicsWorld.isReady()) return

    const world = this.physicsWorld.getWorld()
    if (!world) return

    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })

    world.forEachCollider((collider) => {
      const shape = collider.shape
      const shapeType = shape.type

      const pos = collider.translation()
      const rot = collider.rotation()

      let geometry: THREE.BufferGeometry

      switch (shapeType) {
        case RAPIER.ShapeType.Ball: {
          const ballShape = shape as RAPIER.Ball
          geometry = new THREE.SphereGeometry(ballShape.radius, 16, 16)
          break
        }
        case RAPIER.ShapeType.Cuboid: {
          const cuboidShape = shape as RAPIER.Cuboid
          const h = cuboidShape.halfExtents
          geometry = new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2)
          break
        }
        case RAPIER.ShapeType.Capsule: {
          const capsuleShape = shape as RAPIER.Capsule
          geometry = new THREE.CapsuleGeometry(capsuleShape.radius, capsuleShape.halfHeight, 16, 8)
          break
        }
        default:
          geometry = new THREE.BoxGeometry(1, 1, 1)
      }

      // Convert to wireframe
      const wireGeo = new THREE.WireframeGeometry(geometry)
      const line = new THREE.LineSegments(wireGeo, material)
      line.position.set(pos.x, pos.y, pos.z)
      line.quaternion.set(rot.x, rot.y, rot.z, rot.w)

      this.scene.add(line)
      this.lines.push(line)

      // Dispose the temporary geometry
      geometry.dispose()
    })
  }

  /** Draw contact points (simplified - uses event queue). */
  drawContacts(color = 0xff0000, maxPoints = 50): void {
    if (!this.physicsWorld.isReady()) return

    const world = this.physicsWorld.getWorld()
    const eventQueue = this.physicsWorld.getEventQueue()
    if (!world || !eventQueue) return

    const contactPoints: THREE.Vector3[] = []
    let count = 0

    // Note: Detailed contact info requires narrow phase access
    // This is a simplified placeholder
    eventQueue.drainCollisionEvents((_handleA: number, _handleB: number, started: boolean) => {
      if (started) return
      if (count >= maxPoints) return
      // In a full implementation, we'd get contact details from the narrow phase
      count++
    })

    if (contactPoints.length > 0) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(
        contactPoints.flatMap(p => [p.x, p.y, p.z]), 3))
      const mat = new THREE.PointsMaterial({ color, size: 0.05, sizeAttenuation: true })
      const points = new THREE.Points(geo, mat)
      this.scene.add(points)
      this.points.push(points)
    }
  }

  /** Clear all debug objects. */
  clear(): void {
    for (const line of this.lines) {
      this.scene.remove(line)
      line.geometry.dispose()
      if (Array.isArray(line.material)) {
        line.material.forEach((m: THREE.Material) => m.dispose())
      } else {
        line.material?.dispose()
      }
    }
    this.lines = []

    for (const point of this.points) {
      this.scene.remove(point)
      point.geometry.dispose()
      if (Array.isArray(point.material)) {
        point.material.forEach((m: THREE.Material) => m.dispose())
      } else {
        point.material?.dispose()
      }
    }
    this.points = []

    for (const mesh of this.meshes) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m: THREE.Material) => m.dispose())
      } else {
        mesh.material?.dispose()
      }
    }
    this.meshes = []
  }

  /** Dispose. */
  dispose(): void {
    this.clear()
  }
}