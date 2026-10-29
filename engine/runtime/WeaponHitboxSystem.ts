import * as THREE from 'three'
import type { AnimationController } from '../world/AnimationController'
import type { GameObject } from '../model/object/GameObject'
import type { World } from '../world/World'
import { raycastStaticMesh } from '../world/StaticMeshCollider'

export interface WeaponHitboxConfig {
  /** Bone name in the skeleton hierarchy (e.g., 'weapon', 'rightHand', 'sword'). */
  boneName: string
  /** Local offset from bone origin to hitbox center. */
  localOffset?: THREE.Vector3
  /** Hitbox shape: 'box', 'sphere', 'capsule'. */
  shape: 'box' | 'sphere' | 'capsule'
  /** Hitbox dimensions. For box: [width, height, depth]. For sphere: [radius]. For capsule: [radius, halfHeight]. */
  size: number[]
  /** Rotation offset in degrees. */
  rotationOffset?: THREE.Euler
  /** Tags to filter valid targets. */
  targetTags?: string[]
  /** Tags to exclude from hits. */
  excludedTags?: string[]
}

export interface WeaponHitboxHit {
  targetId: string
  targetObject: GameObject
  hitPoint: THREE.Vector3
  hitNormal: THREE.Vector3
  distance: number
}

export interface WeaponHitboxResult {
  hits: WeaponHitboxHit[]
  sweptPath: THREE.Vector3[] // For visualization/debugging
}

/**
 * Tracks weapon hitboxes during attack animations.
 * Uses the animation mixer to get bone world positions during attack windows.
 * Performs sweep tests along the weapon path for precise hit detection.
 */
export class WeaponHitboxSystem {
  private readonly world: World
  private readonly rootObject: THREE.Object3D

  private activeHitbox: WeaponHitboxConfig | null = null
  private previousBonePosition: THREE.Vector3 | null = null
  private isTracking = false
  private hitTargets = new Set<string>()
  private hitResults: WeaponHitboxResult = { hits: [], sweptPath: [] }
  private elapsedTime = 0
  private attackDuration = 0

  constructor(
    world: World,
    _animationController: AnimationController,
    rootObject: THREE.Object3D,
  ) {
    this.world = world
    this.rootObject = rootObject
  }

  /**
   * Starts tracking a weapon hitbox for the current attack animation.
   * Call this when an attack animation begins (e.g., in performWeaponAttack).
   */
  startAttack(config: WeaponHitboxConfig, estimatedDuration = 0.8): void {
    this.activeHitbox = config
    this.previousBonePosition = null
    this.isTracking = true
    this.hitTargets.clear()
    this.hitResults = { hits: [], sweptPath: [] }
    this.elapsedTime = 0
    this.attackDuration = estimatedDuration
  }

  /**
   * Stops tracking and returns the accumulated hits.
   * Call this when the attack animation ends.
   */
  stopAttack(): WeaponHitboxResult {
    this.isTracking = false
    this.activeHitbox = null
    this.previousBonePosition = null
    return this.hitResults
  }

  /**
   * Updates the hitbox tracking. Call this every frame during the attack.
   * Returns hits detected this frame.
   */
  update(dt: number): WeaponHitboxHit[] {
    if (!this.isTracking || !this.activeHitbox) return []

    this.elapsedTime += Math.max(0, Math.min(dt, 0.1))

    const bone = this.findBone(this.activeHitbox.boneName)
    if (!bone) return []

    // Get bone world position
    const boneWorldPos = new THREE.Vector3()
    bone.getWorldPosition(boneWorldPos)

    // Apply local offset if specified
    if (this.activeHitbox.localOffset) {
      const offset = this.activeHitbox.localOffset.clone()
      offset.applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
      boneWorldPos.add(offset)
    }

    const hits: WeaponHitboxHit[] = []

    if (this.previousBonePosition) {
      // Sweep test from previous position to current position
      const sweepHits = this.sweepTest(this.previousBonePosition, boneWorldPos)
      for (const hit of sweepHits) {
        if (!this.hitTargets.has(hit.targetId)) {
          this.hitTargets.add(hit.targetId)
          this.hitResults.hits.push(hit)
          hits.push(hit)
        }
      }
      // Record path for visualization
      this.hitResults.sweptPath.push(this.previousBonePosition.clone(), boneWorldPos.clone())
    }

    this.previousBonePosition = boneWorldPos.clone()

    // Also check current position (in case animation pauses or first frame)
    const currentHits = this.testPosition(boneWorldPos)
    for (const hit of currentHits) {
      if (!this.hitTargets.has(hit.targetId)) {
        this.hitTargets.add(hit.targetId)
        this.hitResults.hits.push(hit)
        hits.push(hit)
      }
    }

    return hits
  }

  /**
   * Checks if an attack is currently being tracked.
   */
  isAttacking(): boolean {
    return this.isTracking
  }

  /**
   * Gets the current attack progress (0 to 1).
   */
  getAttackProgress(): number {
    if (!this.isTracking) return 0
    return THREE.MathUtils.clamp(this.elapsedTime / this.attackDuration, 0, 1)
  }

  private findBone(name: string): THREE.Bone | null {
    let found: THREE.Bone | null = null
    this.rootObject.traverse((obj) => {
      if (obj instanceof THREE.Bone && obj.name === name) {
        found = obj
      }
    })
    return found
  }

  private sweepTest(from: THREE.Vector3, to: THREE.Vector3): WeaponHitboxHit[] {
    const hits: WeaponHitboxHit[] = []
    const direction = new THREE.Vector3().subVectors(to, from)
    const distance = direction.length()
    if (distance < 0.001) return hits
    direction.normalize()

    const ray = new THREE.Ray(from, direction)
    const raycaster = new THREE.Raycaster()
    raycaster.ray.copy(ray)
    raycaster.near = 0
    raycaster.far = distance
    raycaster.layers.enableAll()

    // Test against all visible objects with valid target tags
    const objects = this.world.list()
    for (const object of objects) {
      if (!this.world.isObjectVisible(object)) continue
      if (!this.isValidTarget(object)) continue

      // Skip if already hit this attack
      if (this.hitTargets.has(object.id)) continue

      // Test against static mesh collider
      const hit = raycastStaticMesh(object.mesh, ray, 0, distance)
      if (hit) {
        hits.push({
          targetId: object.id,
          targetObject: object,
          hitPoint: hit.point.clone(),
          hitNormal: hit.normal.clone(),
          distance: hit.distance,
        })
      }
    }

    return hits
  }

  private testPosition(position: THREE.Vector3): WeaponHitboxHit[] {
    const hits: WeaponHitboxHit[] = []
    if (!this.activeHitbox) return hits

    const { shape, size } = this.activeHitbox
    const radius = shape === 'sphere' ? size[0] : (shape === 'capsule' ? size[0] : Math.max(...size) * 0.5)

    // Simple sphere overlap test at current position
    const objects = this.world.list()
    for (const object of objects) {
      if (!this.world.isObjectVisible(object)) continue
      if (!this.isValidTarget(object)) continue
      if (this.hitTargets.has(object.id)) continue

      const objPos = object.mesh.position
      const dist = position.distanceTo(objPos)
      if (dist <= radius + 1.5) { // 1.5 = approximate enemy radius
        hits.push({
          targetId: object.id,
          targetObject: object,
          hitPoint: position.clone(),
          hitNormal: new THREE.Vector3().subVectors(objPos, position).normalize(),
          distance: dist,
        })
      }
    }

    return hits
  }

  private isValidTarget(object: GameObject): boolean {
    if (!this.activeHitbox) return false
    const tags = object.mesh.userData.tags as string[] | undefined
    if (!tags) return false

    const { targetTags, excludedTags } = this.activeHitbox
    if (excludedTags && excludedTags.some(tag => tags.includes(tag))) return false
    if (targetTags && targetTags.length > 0) {
      return targetTags.some(tag => tags.includes(tag))
    }
    return true
  }
}

/**
 * Configuration for common weapon types.
 * Can be extended by game modules.
 */
export const WEAPON_HITBOX_PRESETS: Record<string, WeaponHitboxConfig> = {
  sword: {
    boneName: 'weapon',
    shape: 'box',
    size: [0.15, 0.8, 0.15], // Thin long box along blade
    localOffset: new THREE.Vector3(0, 0.4, 0), // Center of blade
    targetTags: ['enemy', 'hostile', 'damageable'],
    excludedTags: ['player', 'ally', 'loot', 'interactable'],
  },
  greatsword: {
    boneName: 'weapon',
    shape: 'box',
    size: [0.2, 1.2, 0.2],
    localOffset: new THREE.Vector3(0, 0.6, 0),
    targetTags: ['enemy', 'hostile', 'damageable'],
    excludedTags: ['player', 'ally', 'loot', 'interactable'],
  },
  dagger: {
    boneName: 'weapon',
    shape: 'box',
    size: [0.1, 0.5, 0.1],
    localOffset: new THREE.Vector3(0, 0.25, 0),
    targetTags: ['enemy', 'hostile', 'damageable'],
    excludedTags: ['player', 'ally', 'loot', 'interactable'],
  },
  staff: {
    boneName: 'weapon',
    shape: 'box',
    size: [0.15, 1.0, 0.15],
    localOffset: new THREE.Vector3(0, 0.5, 0.1), // Slightly forward
    targetTags: ['enemy', 'hostile', 'damageable'],
    excludedTags: ['player', 'ally', 'loot', 'interactable'],
  },
  fist: {
    boneName: 'rightHand',
    shape: 'sphere',
    size: [0.25],
    targetTags: ['enemy', 'hostile', 'damageable'],
    excludedTags: ['player', 'ally', 'loot', 'interactable'],
  },
}