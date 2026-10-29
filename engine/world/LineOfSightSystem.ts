import * as THREE from 'three'
import type { World } from './World'
import { raycastStaticMesh } from './StaticMeshCollider'
import { getStaticMeshCollisionData } from './StaticMeshCollider'
import { TERRAIN_ID } from './map/TerrainMesh'

export interface LineOfSightOptions {
  /** Maximum distance for line of sight check. */
  maxDistance?: number
  /** Additional vertical offset from object position (e.g., eye height). */
  originOffsetY?: number
  /** Additional vertical offset for target position. */
  targetOffsetY?: number
  /** Layers to test against (default: all). */
  layers?: THREE.Layers
  /** Whether to test against terrain. Default true. */
  testTerrain?: boolean
  /** Whether to test against static mesh colliders. Default true. */
  testStaticMeshes?: boolean
  /** Minimum gap to consider line of sight clear (avoids grazing hits). */
  skinWidth?: number
}

export interface LineOfSightResult {
  /** True if target is visible (no blocking geometry). */
  visible: boolean
  /** Distance to target if visible, or distance to blocking hit if not. */
  distance: number
  /** The blocking hit if not visible. */
  hit?: {
    point: THREE.Vector3
    normal: THREE.Vector3
    objectId: string
    objectType: 'terrain' | 'staticMesh'
  }
}

/**
 * Line of sight system using raycasting against world geometry.
 * Tests against terrain heightfield and static mesh colliders (BVH-accelerated).
 * Designed for AI perception checks - enemy seeing player, etc.
 */
export class LineOfSightSystem {
  private readonly world: World
  private readonly raycaster = new THREE.Raycaster()
  private readonly ray = new THREE.Ray()
  private readonly tempVec3 = new THREE.Vector3()

  constructor(world: World) {
    this.world = world
  }

  /**
   * Checks if there is clear line of sight between two world positions.
   * @param origin World position of the viewer (e.g., enemy eye position)
   * @param target World position of the target (e.g., player position)
   * @param options Configuration for the check
   * @returns Result with visibility, distance, and blocking hit info
   */
  checkLineOfSight(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    options: LineOfSightOptions = {},
  ): LineOfSightResult {
    const {
      maxDistance = 100,
      originOffsetY = 0,
      targetOffsetY = 0,
      testTerrain = true,
      testStaticMeshes = true,
      skinWidth = 0.05,
    } = options

    const originWithOffset = this.tempVec3.copy(origin).setY(origin.y + originOffsetY)
    const targetWithOffset = this.tempVec3.copy(target).setY(target.y + targetOffsetY)

    this.ray.origin.copy(originWithOffset)
    this.ray.direction.subVectors(targetWithOffset, originWithOffset)
    const distance = this.ray.direction.length()
    if (distance <= skinWidth || distance > maxDistance) {
      return { visible: distance <= skinWidth, distance }
    }
    this.ray.direction.normalize()

    this.raycaster.ray.copy(this.ray)
    this.raycaster.near = skinWidth
    this.raycaster.far = distance - skinWidth
    if (options.layers) {
      this.raycaster.layers.mask = options.layers.mask
    } else {
      this.raycaster.layers.enableAll()
    }

    let closestHit: LineOfSightResult['hit'] | undefined
    let closestDistance = distance

    // Test against terrain
    if (testTerrain && this.world.terrain.mesh.visible) {
      const terrainHit = this.world.terrain.intersectRay(this.raycaster)
      if (terrainHit && terrainHit.distance < closestDistance) {
        closestDistance = terrainHit.distance
        const normal = new THREE.Vector3(0, 1, 0)
        closestHit = {
          point: terrainHit.point.clone(),
          normal,
          objectId: TERRAIN_ID,
          objectType: 'terrain',
        }
      }
    }

    // Test against static mesh colliders (objects with colliderType !== 'none')
    if (testStaticMeshes) {
      const objects = this.world.list()
      for (const object of objects) {
        // Skip objects without collision mesh or disabled
        if (!this.world.isObjectVisible(object)) continue
        const colliderType = object.mesh.userData.colliderType
        if (colliderType === 'none' || colliderType === undefined) continue

        const collisionData = getStaticMeshCollisionData(object.mesh)
        if (!collisionData || !collisionData.boundsTree) continue

        const hit = raycastStaticMesh(
          object.mesh,
          this.raycaster.ray,
          this.raycaster.near,
          this.raycaster.far,
        )
        if (hit && hit.distance < closestDistance) {
          closestDistance = hit.distance
          closestHit = {
            point: hit.point.clone(),
            normal: hit.normal.clone(),
            objectId: object.id,
            objectType: 'staticMesh',
          }
        }
      }
    }

    return {
      visible: !closestHit,
      distance: closestDistance,
      hit: closestHit,
    }
  }

  /**
   * Convenience method to check line of sight between two game objects.
   * Uses object positions with configurable eye/target height offsets.
   */
  checkObjectLineOfSight(
    viewerId: string,
    targetId: string,
    options: LineOfSightOptions = {},
  ): LineOfSightResult {
    const viewer = this.world.get(viewerId)
    const target = this.world.get(targetId)
    if (!viewer || !target) {
      return { visible: false, distance: 0 }
    }
    return this.checkLineOfSight(viewer.mesh.position, target.mesh.position, options)
  }

  /**
   * Checks line of sight from a viewer to a point, with automatic eye-height offset.
   * @param viewerId Object ID of the viewer
   * @param targetPosition Target world position
   * @param options Configuration (originOffsetY defaults to 1.6 for humanoid eye height)
   */
  checkFromObject(
    viewerId: string,
    targetPosition: THREE.Vector3,
    options: LineOfSightOptions = {},
  ): LineOfSightResult {
    const viewer = this.world.get(viewerId)
    if (!viewer) return { visible: false, distance: 0 }
    return this.checkLineOfSight(viewer.mesh.position, targetPosition, {
      originOffsetY: options.originOffsetY ?? 1.6,
      targetOffsetY: options.targetOffsetY ?? 0.8,
      ...options,
    })
  }
}

// Re-export TERRAIN_ID for external use
export { TERRAIN_ID } from './map/TerrainMesh'