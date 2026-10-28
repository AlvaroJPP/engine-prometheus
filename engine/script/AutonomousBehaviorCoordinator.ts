import * as THREE from 'three'
import { AutonomousBehaviorSystem, isAutonomousMovingState } from './AutonomousBehaviorSystem'
import { getAnimationControllerFromObject } from '../world/AnimationController'
import { CollisionSystem } from '../world/CollisionSystem'
import { HumanoidAvatar } from '../world/HumanoidAvatar'
import { GridPathfinder } from '../navigation/GridPathfinder'
import { RuleEngine } from './RuleEngine'
import { World } from '../world/World'

export interface AutonomousBehaviorCoordinatorDependencies {
  world: World
  logic: RuleEngine
  collisions: CollisionSystem
  avatar: HumanoidAvatar
  isRuntimeActive: () => boolean
  notifyPackageChanged: (ownerObjectId: string) => void
  triggerPackageEvent: (ownerObjectId: string, packageId: string, eventId: string) => boolean
}

/**
 * Coordinates generic autonomous package execution with movement collision,
 * navigation and animation. Game-specific rules stay in registered packages.
 */
export class AutonomousBehaviorCoordinator {
  private readonly behaviorSystem = new AutonomousBehaviorSystem()
  private readonly pathfinder = new GridPathfinder()

  private readonly dependencies: AutonomousBehaviorCoordinatorDependencies

  constructor(dependencies: AutonomousBehaviorCoordinatorDependencies) {
    this.dependencies = dependencies
  }

  update(dt: number): void {
    const { world, logic, collisions, avatar, isRuntimeActive } = this.dependencies
    const runtimeModeActive = isRuntimeActive()
    if (!runtimeModeActive && !this.behaviorSystem.hasRuntimeState()) return

    const transitions = this.behaviorSystem.update({
      dt,
      runtimeEnabled: runtimeModeActive,
      world,
      packages: logic.listPackages(),
      playerPosition: avatar.mesh.position,
      canMoveTo: (objectId, target) => collisions.canMoveObjectTo(objectId, target),
      findPath: (objectId, start, goal) => this.findPath(objectId, start, goal),
    })

    for (const transition of transitions) {
      logic.setPackageVariable(transition.instanceId, 'state', transition.state)
      const object = world.get(transition.ownerObjectId)
      const controller = object ? getAnimationControllerFromObject(object.mesh) : undefined
      if (controller) {
        if (isAutonomousMovingState(transition.state)) {
          controller.setState(transition.state === 'fleeing' ? 'run' : 'walk')
        } else if (controller.currentState === 'walk' || controller.currentState === 'run') {
          controller.setState('idle')
        }
      }

      if (transition.events.length) {
        for (const eventId of transition.events) {
          this.dependencies.triggerPackageEvent(transition.ownerObjectId, 'autonomous_agent', eventId)
        }
      } else {
        this.dependencies.notifyPackageChanged(transition.ownerObjectId)
      }
    }
  }

  private findPath(
    objectId: string,
    start: { x: number; y: number; z: number },
    goal: { x: number; y: number; z: number },
  ): Array<{ x: number; y: number; z: number }> {
    const { world } = this.dependencies
    const agent = world.get(objectId)
    if (!agent) return []

    const agentBounds = new THREE.Box3().setFromObject(agent.mesh)
    const agentSize = agentBounds.getSize(new THREE.Vector3())
    const halfWidth = Math.max(0.15, agentSize.x * 0.5)
    const halfDepth = Math.max(0.15, agentSize.z * 0.5)
    const bottomOffset = agentBounds.isEmpty() ? 0 : agent.mesh.position.y - agentBounds.min.y
    const agentHeight = agentBounds.isEmpty() ? 1 : Math.max(0.5, agentSize.y)
    const startGround = start.y - bottomOffset

    const obstacles = world.list()
      .filter(object => object.id !== objectId
        && world.isObjectVisible(object)
        && object.mesh.userData.colliderType !== 'none')
      .map(object => ({ bounds: new THREE.Box3().setFromObject(object.mesh) }))
      .filter(item => !item.bounds.isEmpty())

    const result = this.pathfinder.findPath(
      { x: start.x, z: start.z },
      { x: goal.x, z: goal.z },
      {
        bounds: { minX: -49, maxX: 49, minZ: -49, maxZ: 49 },
        cellSize: 1,
        allowDiagonal: true,
        maxVisitedNodes: 12000,
        isWalkable: point => {
          const ground = world.getGroundHeightAt(point.x, point.z, startGround + 0.6)
          if (!Number.isFinite(ground) || ground > startGround + 0.6) return false
          const feet = ground
          const head = feet + agentHeight
          return obstacles.every(({ bounds }) => {
            const overlapsXZ = point.x + halfWidth > bounds.min.x
              && point.x - halfWidth < bounds.max.x
              && point.z + halfDepth > bounds.min.z
              && point.z - halfDepth < bounds.max.z
            const overlapsY = bounds.max.y > feet + 0.05 && bounds.min.y < head - 0.05
            return !(overlapsXZ && overlapsY)
          })
        },
      },
    )

    return result.reached
      ? result.path.map(point => ({
        x: point.x,
        y: world.getGroundHeightAt(point.x, point.z, startGround + 0.6) + bottomOffset,
        z: point.z,
      }))
      : []
  }
}
