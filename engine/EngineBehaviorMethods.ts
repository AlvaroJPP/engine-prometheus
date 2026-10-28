import * as THREE from 'three'
import { getAnimationControllerFromObject } from './world/AnimationController'
import { isAutonomousMovingState } from './script/AutonomousBehaviorSystem'
import { DEFAULT_MODEL_CONTROL_BINDINGS } from './script/packages'
import type { BehaviorPackageInstance } from './script/packages'
import type { ModelControlBindings } from './script/packages'

export interface EngineBehaviorContext {
  [key: string]: any
}

export function createEngineBehaviorMethods() {
  return {
    updateAutonomousBehaviors(this: EngineBehaviorContext, dt: number): void {
      if (!this.runtimeModeActive && !this.autonomousBehaviorSystem.hasRuntimeState()) return
    
      const transitions = this.autonomousBehaviorSystem.update({
        dt,
        runtimeEnabled: this.runtimeModeActive,
        world: this.world,
        packages: this.logic.listPackages(),
        playerPosition: this.avatar.mesh.position,
        canMoveTo: (objectId, target) => this.collisions.canMoveObjectTo(objectId, target),
        findPath: (objectId, start, goal) => this.findAutonomousPath(objectId, start, goal),
      })
    
      for (const transition of transitions) {
        this.logic.setPackageVariable(transition.instanceId, 'state', transition.state)
        const object = this.world.get(transition.ownerObjectId)
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
            this.triggerBehaviorPackageEvent(transition.ownerObjectId, 'autonomous_agent', eventId)
          }
        } else {
          this.notifyBehaviorPackageChanged(transition.ownerObjectId)
        }
      }
    },
    findAutonomousPath(
      this: EngineBehaviorContext,
      objectId: string,
      start: { x: number; y: number; z: number },
      goal: { x: number; y: number; z: number },
    ): Array<{ x: number; y: number; z: number }> {
      const agent = this.world.get(objectId)
      if (!agent) return []
    
      const agentBounds = new THREE.Box3().setFromObject(agent.mesh)
      const agentSize = agentBounds.getSize(new THREE.Vector3())
      const halfWidth = Math.max(0.15, agentSize.x * 0.5)
      const halfDepth = Math.max(0.15, agentSize.z * 0.5)
      const bottomOffset = agentBounds.isEmpty() ? 0 : agent.mesh.position.y - agentBounds.min.y
      const agentHeight = agentBounds.isEmpty() ? 1 : Math.max(0.5, agentSize.y)
      const startGround = start.y - bottomOffset
    
      const obstacles = this.world.list()
        .filter(object => object.id !== objectId
          && this.world.isObjectVisible(object)
          && object.mesh.userData.colliderType !== 'none')
        .map(object => ({ bounds: new THREE.Box3().setFromObject(object.mesh) }))
        .filter(item => !item.bounds.isEmpty())
    
      const result = this.autonomousPathfinder.findPath(
        { x: start.x, z: start.z },
        { x: goal.x, z: goal.z },
        {
          bounds: { minX: -49, maxX: 49, minZ: -49, maxZ: 49 },
          cellSize: 1,
          allowDiagonal: true,
          maxVisitedNodes: 12000,
          isWalkable: point => {
            const ground = this.world.getGroundHeightAt(point.x, point.z, startGround + 0.6)
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
          y: this.world.getGroundHeightAt(point.x, point.z, startGround + 0.6) + bottomOffset,
          z: point.z,
        }))
        : []
    },
    updateBehaviorTrees(this: EngineBehaviorContext, dt: number): void {
      this.behaviorTreeRuntime.update({
        world: this.world,
        logic: this.logic,
        playerPosition: this.avatar.mesh.position,
        invalidate: () => this.viewport.invalidate(),
        notifyPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      }, dt, this.runtimeModeActive)
    },
    triggerBehaviorPackageEvent(this: EngineBehaviorContext, ownerObjectId: string, packageId: string, eventId: string): boolean {
      const executed = this.logic.triggerPackageEvent(ownerObjectId, packageId, eventId)
      this.notifyBehaviorPackageChanged(ownerObjectId)
      return executed
    },
    notifyBehaviorPackageChanged(this: EngineBehaviorContext, ownerObjectId: string): void {
      this.events.emit('behaviorPackageChanged', { ownerObjectId })
    },
    dismountActiveMount(this: EngineBehaviorContext): void {
      const packageId = this.activeMountPackageId
      const packageInstance = packageId
        ? this.logic.listPackages().find(instance => instance.id === packageId)
        : undefined
      const mountedObjectId = this.avatar.dismount()
    
      if (packageId) {
        this.logic.setPackageVariable(packageId, 'mounted', false)
        this.logic.setPackageVariable(packageId, 'movementState', 'idle')
      }
      this.activeMountPackageId = null
      this.lastMountMovementState = null
    
      if (packageInstance) {
        this.notifyBehaviorPackageChanged(packageInstance.ownerObjectId)
        if (mountedObjectId) {
          this.triggerBehaviorPackageEvent(mountedObjectId, packageInstance.packageId, 'dismounted')
        }
      }
    },
    installBehaviorPackage(this: EngineBehaviorContext, ownerObjectId: string, packageId: string): BehaviorPackageInstance {
      const alreadyInstalled = this.logic.listPackages(ownerObjectId).some(instance => instance.packageId === packageId)
      const instance = this.logic.installPackage(ownerObjectId, packageId)
      if (packageId === 'mount' && !alreadyInstalled) {
        const rawBindings = this.world.get(ownerObjectId)?.mesh.userData.importControlBindings
        const candidate = rawBindings && typeof rawBindings === 'object'
          ? rawBindings as Partial<ModelControlBindings>
          : {}
        const readKey = (key: keyof ModelControlBindings): string => {
          const value = candidate[key]
          return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(value)
            ? value
            : DEFAULT_MODEL_CONTROL_BINDINGS[key]
        }
        const controlBindings: ModelControlBindings = {
          forward: readKey('forward'),
          backward: readKey('backward'),
          left: readKey('left'),
          right: readKey('right'),
          run: readKey('run'),
          jump: readKey('jump'),
          interact: readKey('interact'),
        }
        this.logic.updatePackage(instance.id, {
          config: {
            ...instance.config,
            interactionKey: controlBindings.interact,
            controlBindings: { ...controlBindings },
          },
        })
      }
      const installed = this.logic.listPackages(ownerObjectId).find(item => item.packageId === packageId) ?? instance
      this.notifyBehaviorPackageChanged(ownerObjectId)
      return installed
    },
    removeBehaviorPackage(this: EngineBehaviorContext, id: string): void {
      const instance = this.logic.listPackages().find(item => item.id === id)
      if (instance?.packageId === 'mount') this.applyMountModelStates(instance, true, false)
      if (this.activeMountPackageId === id) this.dismountActiveMount()
      this.logic.removePackage(id)
      this.mountModelStateController.forget(id)
    }
  }
}
