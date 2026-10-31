import * as RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PhysicsWorld } from './PhysicsWorld.ts'

/**
 * Custom Navigation Mesh implementation.
 *
 * Note: Rapier doesn't include recast-navigation built-in.
 * This is a simplified implementation using a grid-based approach
 * that integrates with Rapier's collision detection for walkable area detection.
 * For production use, consider integrating recast-navigation or similar library.
 */

export interface NavMeshConfig {
  /** Grid cell size in world units */
  cellSize: number
  /** Agent radius for obstacle clearance */
  agentRadius: number
  /** Agent height */
  agentHeight: number
  /** Maximum slope angle the agent can traverse (radians) */
  maxSlopeAngle: number
  /** Maximum step height the agent can climb */
  maxStepHeight: number
  /** World bounds for navmesh generation */
  boundsMin?: THREE.Vector3
  boundsMax?: THREE.Vector3
  /** Layer mask for collision detection (Rapier groups) */
  collisionGroups?: RAPIER.InteractionGroups
}

export const DEFAULT_NAVMESH_CONFIG: NavMeshConfig = {
  cellSize: 1.0,
  agentRadius: 0.5,
  agentHeight: 1.8,
  maxSlopeAngle: Math.PI / 3, // 60 degrees
  maxStepHeight: 0.5,
}

export interface NavMeshNode {
  /** Grid position */
  x: number
  z: number
  /** World position of node center */
  position: THREE.Vector3
  /** Whether this node is walkable */
  walkable: boolean
  /** Height at this node (for multi-level) */
  height: number
  /** Connections to neighboring nodes (up to 8 for 8-directional) */
  neighbors: NavMeshNode[]
}

export interface NavMeshQueryResult {
  /** Whether a path was found */
  success: boolean
  /** Path as array of world positions */
  path: THREE.Vector3[]
  /** Total path length */
  length: number
}

/**
 * Grid-based Navigation Mesh.
 *
 * Uses a 2D grid with height sampling from Rapier physics world
 * to determine walkable areas. Suitable for flat or moderately
 * complex terrain. For complex multi-level environments, consider
 * integrating a full recast/detour implementation.
 */
export class NavMesh {
  private physicsWorld: PhysicsWorld
  private config: NavMeshConfig
  private grid: NavMeshNode[][] = []
  private gridWidth = 0
  private gridDepth = 0
  private originX = 0
  private originZ = 0
  private built = false
  private building = false

  constructor(physicsWorld: PhysicsWorld, config: Partial<NavMeshConfig> = {}) {
    this.physicsWorld = physicsWorld
    this.config = { ...DEFAULT_NAVMESH_CONFIG, ...config }
  }

  /** Check if navmesh is built and ready for queries. */
  isReady(): boolean {
    return this.built
  }

  /** Check if a build is in progress. */
  isBuilding(): boolean {
    return this.building
  }

  /** Build the navigation mesh asynchronously. */
  async build(): Promise<{ success: boolean; nodesBuilt: number; buildTimeMs: number; error?: string }> {
    if (this.building) {
      return { success: false, nodesBuilt: 0, buildTimeMs: 0, error: 'Build already in progress' }
    }

    const startTime = performance.now()
    this.building = true

    try {
      await this.physicsWorld.initialize()
      const world = this.physicsWorld.getWorld()
      if (!world) {
        throw new Error('Physics world not initialized')
      }

      // Determine bounds
      const bounds = this.determineBounds(world)

      // Create grid
      this.originX = bounds.min.x
      this.originZ = bounds.min.z
      this.gridWidth = Math.ceil((bounds.max.x - bounds.min.x) / this.config.cellSize)
      this.gridDepth = Math.ceil((bounds.max.z - bounds.min.z) / this.config.cellSize)

      // Build grid nodes
      this.grid = []
      let walkableCount = 0

      for (let gz = 0; gz < this.gridDepth; gz++) {
        const row: NavMeshNode[] = []
        for (let gx = 0; gx < this.gridWidth; gx++) {
          const worldX = this.originX + (gx + 0.5) * this.config.cellSize
          const worldZ = this.originZ + (gz + 0.5) * this.config.cellSize

          // Sample height at this position
          const heightResult = this.sampleHeight(worldX, worldZ)

          const node: NavMeshNode = {
            x: gx,
            z: gz,
            position: new THREE.Vector3(worldX, heightResult.height, worldZ),
            walkable: heightResult.walkable,
            height: heightResult.height,
            neighbors: [],
          }

          if (node.walkable) walkableCount++
          row.push(node)
        }
        this.grid.push(row)
      }

      // Connect neighbors (8-directional)
      this.connectNeighbors()

      this.built = true
      const buildTimeMs = performance.now() - startTime

      return {
        success: true,
        nodesBuilt: walkableCount,
        buildTimeMs,
      }
    } catch (error) {
      const buildTimeMs = performance.now() - startTime
      return {
        success: false,
        nodesBuilt: 0,
        buildTimeMs,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      this.building = false
    }
  }

  /** Determine world bounds from physics colliders or config. */
  private determineBounds(world: RAPIER.World): { min: THREE.Vector3; max: THREE.Vector3 } {
    const config = this.config

    if (config.boundsMin && config.boundsMax) {
      return { min: config.boundsMin.clone(), max: config.boundsMax.clone() }
    }

    // Sample colliders to find bounds
    let minX = Infinity, minZ = Infinity
    let maxX = -Infinity, maxZ = -Infinity
    let hasBounds = false

    world.forEachCollider((collider) => {
      const aabb = this.computeColliderAabb(collider)
      minX = Math.min(minX, aabb.min.x)
      minZ = Math.min(minZ, aabb.min.z)
      maxX = Math.max(maxX, aabb.max.x)
      maxZ = Math.max(maxZ, aabb.max.z)
      hasBounds = true
    })

    if (!hasBounds) {
      // Default bounds
      return {
        min: new THREE.Vector3(-50, -10, -50),
        max: new THREE.Vector3(50, 10, 50),
      }
    }

    // Add padding
    const padding = this.config.cellSize * 2
    return {
      min: new THREE.Vector3(minX - padding, -10, minZ - padding),
      max: new THREE.Vector3(maxX + padding, 10, maxZ + padding),
    }
  }

  /** Compute approximate AABB for a collider. */
  private computeColliderAabb(collider: RAPIER.Collider): { min: THREE.Vector3; max: THREE.Vector3 } {
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
      min: new THREE.Vector3(
        translation.x - conservativeExtent.x,
        translation.y - conservativeExtent.y,
        translation.z - conservativeExtent.z,
      ),
      max: new THREE.Vector3(
        translation.x + conservativeExtent.x,
        translation.y + conservativeExtent.y,
        translation.z + conservativeExtent.z,
      ),
    }
  }

  /** Sample height and walkability at a world position. */
  private sampleHeight(worldX: number, worldZ: number): { height: number; walkable: boolean } {
    const world = this.physicsWorld.getWorld()
    if (!world) return { height: 0, walkable: false }

    const rayOrigin = new THREE.Vector3(worldX, 100, worldZ)
    const rayDir = new THREE.Vector3(0, -1, 0)
    const maxDist = 200

    const result = this.physicsWorld.raycast(rayOrigin, rayDir, maxDist, this.config.collisionGroups)

    if (!result) {
      return { height: 0, walkable: false }
    }

    const hitPoint = rayOrigin.clone().addScaledVector(rayDir, result.toi)
    const normalResult = this.physicsWorld.raycastWithNormal(rayOrigin, rayDir, maxDist)
    const normal = normalResult
      ? new THREE.Vector3(normalResult.normal.x, normalResult.normal.y, normalResult.normal.z)
      : new THREE.Vector3(0, 1, 0)

    // Check slope
    const up = new THREE.Vector3(0, 1, 0)
    const slopeAngle = Math.acos(Math.min(1, Math.max(-1, normal.dot(up))))

    if (slopeAngle > this.config.maxSlopeAngle) {
      return { height: hitPoint.y, walkable: false }
    }

    // Check headroom with another raycast up from hit point
    const headroomRay = this.physicsWorld.raycast(
      new THREE.Vector3(hitPoint.x, hitPoint.y + 0.1, hitPoint.z),
      new THREE.Vector3(0, 1, 0),
      this.config.agentHeight,
      this.config.collisionGroups
    )

    if (headroomRay && headroomRay.toi < this.config.agentHeight) {
      return { height: hitPoint.y, walkable: false }
    }

    // Check clearance around agent radius
    if (!this.checkClearance(hitPoint)) {
      return { height: hitPoint.y, walkable: false }
    }

    return { height: hitPoint.y, walkable: true }
  }

  /** Check if there's enough clearance around a point for the agent. */
  private checkClearance(point: THREE.Vector3): boolean {
    const world = this.physicsWorld.getWorld()
    if (!world) return false

    // Check 4 directions around the point at agent radius
    const directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ]

    for (const dir of directions) {
      const checkPos = point.clone().addScaledVector(dir, this.config.agentRadius)
      const result = this.physicsWorld.raycast(
        new THREE.Vector3(checkPos.x, checkPos.y + 0.1, checkPos.z),
        new THREE.Vector3(0, -1, 0),
        this.config.agentHeight + 1,
        this.config.collisionGroups
      )

      if (!result) return false

      const hitY = checkPos.y + 0.1 - result.toi
      if (Math.abs(hitY - point.y) > this.config.maxStepHeight) return false
    }

    return true
  }

  /** Connect neighboring walkable nodes. */
  private connectNeighbors(): void {
    const directions = [
      { dx: 1, dz: 0 },   // right
      { dx: -1, dz: 0 },  // left
      { dx: 0, dz: 1 },   // forward
      { dx: 0, dz: -1 },  // back
      { dx: 1, dz: 1 },   // diagonal
      { dx: 1, dz: -1 },
      { dx: -1, dz: 1 },
      { dx: -1, dz: -1 },
    ]

    for (let gz = 0; gz < this.gridDepth; gz++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const node = this.grid[gz][gx]
        if (!node.walkable) continue

        for (const { dx, dz } of directions) {
          const nx = gx + dx
          const nz = gz + dz

          if (nx < 0 || nx >= this.gridWidth || nz < 0 || nz >= this.gridDepth) continue

          const neighbor = this.grid[nz][nx]
          if (!neighbor.walkable) continue

          // Check height difference for step height
          const heightDiff = Math.abs(neighbor.height - node.height)
          if (heightDiff > this.config.maxStepHeight) continue

          // For diagonal, check adjacent cardinals are walkable (prevent corner cutting)
          if (dx !== 0 && dz !== 0) {
            const adj1 = this.grid[gz][nx]
            const adj2 = this.grid[nz][gx]
            if (!adj1?.walkable || !adj2?.walkable) continue
          }

          node.neighbors.push(neighbor)
        }
      }
    }
  }

  /** Find the grid node closest to a world position. */
  private findNode(position: THREE.Vector3): NavMeshNode | null {
    const gx = Math.floor((position.x - this.originX) / this.config.cellSize)
    const gz = Math.floor((position.z - this.originZ) / this.config.cellSize)

    if (gx < 0 || gx >= this.gridWidth || gz < 0 || gz >= this.gridDepth) {
      return null
    }

    const node = this.grid[gz][gx]
    if (!node || !node.walkable) {
      // Search nearby for walkable node
      return this.findNearestWalkableNode(gx, gz)
    }

    return node
  }

  /** Find nearest walkable node to grid coordinates. */
  private findNearestWalkableNode(gx: number, gz: number, maxRadius = 5): NavMeshNode | null {
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue

          const nx = gx + dx
          const nz = gz + dz

          if (nx < 0 || nx >= this.gridWidth || nz < 0 || nz >= this.gridDepth) continue

          const node = this.grid[nz][nx]
          if (node && node.walkable) return node
        }
      }
    }
    return null
  }

  /** Find a path between two world positions using A*. */
  findPath(start: THREE.Vector3, end: THREE.Vector3): NavMeshQueryResult {
    if (!this.built) {
      return { success: false, path: [], length: 0 }
    }

    const startNode = this.findNode(start)
    const endNode = this.findNode(end)

    if (!startNode || !endNode) {
      return { success: false, path: [], length: 0 }
    }

    if (startNode === endNode) {
      return {
        success: true,
        path: [startNode.position.clone(), endNode.position.clone()],
        length: startNode.position.distanceTo(endNode.position),
      }
    }

    // A* pathfinding
    const path = this.aStar(startNode, endNode)

    if (!path || path.length === 0) {
      return { success: false, path: [], length: 0 }
    }

    // Convert to world positions
    const worldPath = path.map(node => node.position.clone())

    // Add exact start/end positions
    worldPath[0] = start.clone()
    worldPath[worldPath.length - 1] = end.clone()

    // Calculate path length
    let length = 0
    for (let i = 1; i < worldPath.length; i++) {
      length += worldPath[i - 1].distanceTo(worldPath[i])
    }

    return {
      success: true,
      path: worldPath,
      length,
    }
  }

  /** A* pathfinding algorithm. */
  private aStar(start: NavMeshNode, goal: NavMeshNode): NavMeshNode[] | null {
    const openSet = new Set<NavMeshNode>([start])
    const closedSet = new Set<NavMeshNode>()

    const gScore = new Map<NavMeshNode, number>()
    const fScore = new Map<NavMeshNode, number>()
    const cameFrom = new Map<NavMeshNode, NavMeshNode>()

    gScore.set(start, 0)
    fScore.set(start, this.heuristic(start, goal))

    while (openSet.size > 0) {
      // Find node with lowest fScore
      let current: NavMeshNode | null = null
      let lowestF = Infinity

      for (const node of openSet) {
        const f = fScore.get(node) ?? Infinity
        if (f < lowestF) {
          lowestF = f
          current = node
        }
      }

      if (!current) break
      if (current === goal) {
        // Reconstruct path
        return this.reconstructPath(cameFrom, current)
      }

      openSet.delete(current)
      closedSet.add(current)

      for (const neighbor of current.neighbors) {
        if (closedSet.has(neighbor)) continue

        const tentativeG = (gScore.get(current) ?? Infinity) +
          current.position.distanceTo(neighbor.position)

        if (!openSet.has(neighbor)) {
          openSet.add(neighbor)
        } else if (tentativeG >= (gScore.get(neighbor) ?? Infinity)) {
          continue
        }

        cameFrom.set(neighbor, current)
        gScore.set(neighbor, tentativeG)
        fScore.set(neighbor, tentativeG + this.heuristic(neighbor, goal))
      }
    }

    return null
  }

  /** Heuristic: Euclidean distance. */
  private heuristic(a: NavMeshNode, b: NavMeshNode): number {
    return a.position.distanceTo(b.position)
  }

  /** Reconstruct path from cameFrom map. */
  private reconstructPath(cameFrom: Map<NavMeshNode, NavMeshNode>, current: NavMeshNode): NavMeshNode[] {
    const path = [current]
    while (cameFrom.has(current)) {
      current = cameFrom.get(current)!
      path.unshift(current)
    }
    return path
  }

  /** Get height at a world position on the navmesh. */
  getHeightAt(position: THREE.Vector3): number | null {
    const node = this.findNode(position)
    return node ? node.height : null
  }

  /** Check if a position is walkable. */
  isWalkable(position: THREE.Vector3): boolean {
    const node = this.findNode(position)
    return node?.walkable ?? false
  }

  /** Get random walkable point on navmesh. */
  getRandomPoint(): THREE.Vector3 | null {
    const walkableNodes: NavMeshNode[] = []

    for (const row of this.grid) {
      for (const node of row) {
        if (node.walkable) walkableNodes.push(node)
      }
    }

    if (walkableNodes.length === 0) return null

    const randomNode = walkableNodes[Math.floor(Math.random() * walkableNodes.length)]
    return randomNode.position.clone()
  }

  /** Get all walkable nodes (for debugging). */
  getAllNodes(): NavMeshNode[] {
    const nodes: NavMeshNode[] = []
    for (const row of this.grid) {
      for (const node of row) {
        if (node.walkable) nodes.push(node)
      }
    }
    return nodes
  }

  /** Get grid dimensions. */
  getGridSize(): { width: number; depth: number } {
    return { width: this.gridWidth, depth: this.gridDepth }
  }

  /** Get config. */
  getConfig(): Readonly<NavMeshConfig> {
    return this.config
  }

  /** Update config (requires rebuild). */
  setConfig(config: Partial<NavMeshConfig>): void {
    this.config = { ...this.config, ...config }
    this.built = false
  }

  /** Clear the navmesh. */
  clear(): void {
    this.grid = []
    this.gridWidth = 0
    this.gridDepth = 0
    this.built = false
  }

  /** Dispose the navmesh. */
  dispose(): void {
    this.clear()
  }
}

/**
 * NavMeshBuilder for async/streaming construction with progress callbacks.
 */
export class NavMeshBuilder {
  private physicsWorld: PhysicsWorld
  private config: NavMeshConfig
  private cancelled = false

  constructor(physicsWorld: PhysicsWorld, config: Partial<NavMeshConfig> = {}) {
    this.physicsWorld = physicsWorld
    this.config = { ...DEFAULT_NAVMESH_CONFIG, ...config }
  }

  /** Cancel an ongoing build. */
  cancel(): void {
    this.cancelled = true
  }

  /** Build navmesh with progress callback. */
  async build(
    onProgress?: (progress: number, message: string) => void,
  ): Promise<{ success: boolean; nodesBuilt: number; buildTimeMs: number; error?: string }> {
    const startTime = performance.now()
    this.cancelled = false

    try {
      await this.physicsWorld.initialize()
      const world = this.physicsWorld.getWorld()
      if (!world) {
        throw new Error('Physics world not initialized')
      }

      onProgress?.(0.1, 'Determining bounds...')
      if (this.cancelled) throw new Error('Build cancelled')

      // Determine bounds
      let minX = Infinity, minZ = Infinity
      let maxX = -Infinity, maxZ = -Infinity
      let hasBounds = false

      world.forEachCollider((collider) => {
        // Use collider translation with conservative padding for bounds
        const translation = collider.translation()
        minX = Math.min(minX, translation.x - 5)
        minZ = Math.min(minZ, translation.z - 5)
        maxX = Math.max(maxX, translation.x + 5)
        maxZ = Math.max(maxZ, translation.z + 5)
        hasBounds = true
      })

      if (!hasBounds) {
        minX = -50; minZ = -50; maxX = 50; maxZ = 50
      }

      const boundsMin = new THREE.Vector3(minX, -10, minZ)
      const boundsMax = new THREE.Vector3(maxX, 10, maxZ)

      onProgress?.(0.3, 'Building grid...')
      if (this.cancelled) throw new Error('Build cancelled')

      const cellSize = this.config.cellSize
      const originX = boundsMin.x
      const originZ = boundsMin.z
      const gridWidth = Math.ceil((boundsMax.x - boundsMin.x) / cellSize)
      const gridDepth = Math.ceil((boundsMax.z - boundsMin.z) / cellSize)

      const grid: NavMeshNode[][] = []
      let walkableCount = 0

      for (let gz = 0; gz < gridDepth; gz++) {
        if (this.cancelled) throw new Error('Build cancelled')
        if (gz % 10 === 0) {
          onProgress?.(0.3 + 0.5 * (gz / gridDepth), `Building grid row ${gz}/${gridDepth}`)
        }

        const row: NavMeshNode[] = []
        for (let gx = 0; gx < gridWidth; gx++) {
          const worldX = originX + (gx + 0.5) * cellSize
          const worldZ = originZ + (gz + 0.5) * cellSize

          // Sample height
          const rayOrigin = new THREE.Vector3(worldX, 100, worldZ)
          const rayDir = new THREE.Vector3(0, -1, 0)
          const maxDist = 200

          const result = this.physicsWorld.raycast(rayOrigin, rayDir, maxDist)

          let walkable = false
          let height = 0

          if (result) {
            const hitPoint = rayOrigin.clone().addScaledVector(rayDir, result.toi)
            const normalResult = this.physicsWorld.raycastWithNormal(rayOrigin, rayDir, maxDist)
            const normal = normalResult
              ? new THREE.Vector3(normalResult.normal.x, normalResult.normal.y, normalResult.normal.z)
              : new THREE.Vector3(0, 1, 0)

            const up = new THREE.Vector3(0, 1, 0)
            const slopeAngle = Math.acos(Math.min(1, Math.max(-1, normal.dot(up))))

            if (slopeAngle <= this.config.maxSlopeAngle) {
              // Check clearance
              if (this.checkClearanceAt(hitPoint)) {
                walkable = true
                height = hitPoint.y
              }
            }
          }

          const node: NavMeshNode = {
            x: gx,
            z: gz,
            position: new THREE.Vector3(worldX, height, worldZ),
            walkable,
            height,
            neighbors: [],
          }

          if (walkable) walkableCount++
          row.push(node)
        }
        grid.push(row)
      }

      onProgress?.(0.8, 'Connecting neighbors...')
      if (this.cancelled) throw new Error('Build cancelled')

      // Connect neighbors
      const directions = [
        { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
        { dx: 1, dz: 1 }, { dx: 1, dz: -1 }, { dx: -1, dz: 1 }, { dx: -1, dz: -1 },
      ]

      for (let gz = 0; gz < gridDepth; gz++) {
        for (let gx = 0; gx < gridWidth; gx++) {
          const node = grid[gz][gx]
          if (!node.walkable) continue

          for (const { dx, dz } of directions) {
            const nx = gx + dx
            const nz = gz + dz

            if (nx < 0 || nx >= gridWidth || nz < 0 || nz >= gridDepth) continue

            const neighbor = grid[nz][nx]
            if (!neighbor.walkable) continue

            const heightDiff = Math.abs(neighbor.height - node.height)
            if (heightDiff > this.config.maxStepHeight) continue

            if (dx !== 0 && dz !== 0) {
              const adj1 = grid[gz][nx]
              const adj2 = grid[nz][gx]
              if (!adj1?.walkable || !adj2?.walkable) continue
            }

            node.neighbors.push(neighbor)
          }
        }
      }

      onProgress?.(1.0, 'Navmesh built successfully')

      return {
        success: true,
        nodesBuilt: walkableCount,
        buildTimeMs: performance.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        nodesBuilt: 0,
        buildTimeMs: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private checkClearanceAt(point: THREE.Vector3): boolean {
    const directions = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ]

    for (const dir of directions) {
      const checkPos = point.clone().addScaledVector(dir, this.config.agentRadius)
      const result = this.physicsWorld.raycast(
        new THREE.Vector3(checkPos.x, checkPos.y + 0.1, checkPos.z),
        new THREE.Vector3(0, -1, 0),
        this.config.agentHeight + 1,
      )

      if (!result) return false

      const hitY = checkPos.y + 0.1 - result.toi
      if (Math.abs(hitY - point.y) > this.config.maxStepHeight) return false
    }

    return true
  }
}