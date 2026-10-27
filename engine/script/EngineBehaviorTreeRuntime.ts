import type { BehaviorPackageInstance, PackageScalar } from './packages'
import type { BehaviorTreeHandlers, BehaviorTreeParameters } from './BehaviorTree.ts'
import { BehaviorTreePackageSystem } from './BehaviorTreePackageSystem.ts'
import type { RuleEngine } from './RuleEngine'
import type { World } from '../world/World'

interface Position3 {
  x: number
  y: number
  z: number
}

export interface EngineBehaviorTreeContext {
  world: World
  logic: RuleEngine
  playerPosition: Position3
  invalidate: () => void
  notifyPackageChanged: (ownerObjectId: string) => void
}

const stringParam = (params: BehaviorTreeParameters, key: string): string | null => {
  const value = params[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const scalarParam = (params: BehaviorTreeParameters, key: string): PackageScalar | undefined => {
  const value = params[key]
  return typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined
}

const numberParam = (params: BehaviorTreeParameters, key: string): number | null => {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function findPackage(
  context: EngineBehaviorTreeContext,
  instance: BehaviorPackageInstance,
  packageId: string | null,
): BehaviorPackageInstance | undefined {
  return context.logic.listPackages(instance.ownerObjectId).find(candidate =>
    candidate.packageId === (packageId ?? instance.packageId),
  )
}

/**
 * Bridges serialized behavior trees into the regular Engine Run loop.
 * The action vocabulary is generic; projects can add game-specific handlers
 * through BehaviorTreePackageSystem without changing this bridge.
 */
export class EngineBehaviorTreeRuntime {
  private readonly system = new BehaviorTreePackageSystem<EngineBehaviorTreeContext>()

  update(context: EngineBehaviorTreeContext, dt: number, runtimeEnabled: boolean): void {
    const instances = context.logic.listPackages()
    const transitions = this.system.update({
      instances,
      context,
      dt,
      runtimeEnabled,
      handlersFor: instance => this.createHandlers(instance),
    })

    for (const instance of instances) {
      const hasTree = instance.config.behaviorTree !== undefined && instance.config.behaviorTree !== null
      if (!runtimeEnabled || !instance.enabled || !hasTree) {
        if (context.logic.removePackageVariable(instance.id, 'behavior_tree_status')) {
          context.notifyPackageChanged(instance.ownerObjectId)
        }
      }
    }

    for (const transition of transitions) {
      context.logic.setPackageVariable(
        transition.instanceId,
        'behavior_tree_status',
        transition.status,
      )
      context.notifyPackageChanged(transition.ownerObjectId)
    }
  }

  reset(): void {
    this.system.reset()
  }

  private createHandlers(instance: BehaviorPackageInstance): BehaviorTreeHandlers<EngineBehaviorTreeContext> {
    return {
      condition: (name, params, context) => {
        switch (name) {
          case 'object_exists': {
            const objectId = stringParam(params, 'objectId') ?? instance.ownerObjectId
            return context.world.get(objectId) !== undefined
          }
          case 'object_visible': {
            const objectId = stringParam(params, 'objectId') ?? instance.ownerObjectId
            const object = context.world.get(objectId)
            return !!object && context.world.isObjectVisible(object)
          }
          case 'global_variable_equals': {
            const variable = stringParam(params, 'variable')
            const expected = scalarParam(params, 'value')
            return variable !== null && expected !== undefined
              && context.logic.getVariable(variable) === expected
          }
          case 'package_variable_equals': {
            const variable = stringParam(params, 'variable')
            const expected = scalarParam(params, 'value')
            const target = findPackage(context, instance, stringParam(params, 'packageId'))
            return !!target && variable !== null && expected !== undefined
              && target.variables[variable] === expected
          }
          case 'distance_to_player_lte': {
            const maxDistance = numberParam(params, 'distance')
            const objectId = stringParam(params, 'objectId') ?? instance.ownerObjectId
            const object = context.world.get(objectId)
            if (!object || maxDistance === null || maxDistance < 0) return false
            const position = object.mesh.position
            return Math.hypot(
              position.x - context.playerPosition.x,
              position.y - context.playerPosition.y,
              position.z - context.playerPosition.z,
            ) <= maxDistance
          }
          case 'object_distance_lte': {
            const maxDistance = numberParam(params, 'distance')
            const objectId = stringParam(params, 'objectId') ?? instance.ownerObjectId
            const targetId = stringParam(params, 'targetObjectId')
            const object = context.world.get(objectId)
            const target = targetId ? context.world.get(targetId) : undefined
            if (!object || !target || maxDistance === null || maxDistance < 0) return false
            return object.mesh.position.distanceTo(target.mesh.position) <= maxDistance
          }
          default:
            return false
        }
      },
      action: (name, params, context) => {
        switch (name) {
          case 'set_package_variable': {
            const variable = stringParam(params, 'variable')
            const value = scalarParam(params, 'value')
            const target = findPackage(context, instance, stringParam(params, 'packageId'))
            if (!target || !variable || value === undefined) return 'failure'
            context.logic.setPackageVariable(target.id, variable, value)
            context.notifyPackageChanged(target.ownerObjectId)
            return 'success'
          }
          case 'set_global_variable': {
            const variable = stringParam(params, 'variable')
            const value = scalarParam(params, 'value')
            if (!variable || value === undefined) return 'failure'
            context.logic.setVariable(variable, value)
            return 'success'
          }
          case 'trigger_package_event': {
            const eventId = stringParam(params, 'eventId')
            const packageId = stringParam(params, 'packageId') ?? instance.packageId
            const objectId = stringParam(params, 'objectId') ?? instance.ownerObjectId
            if (!eventId || !context.logic.triggerPackageEvent(objectId, packageId, eventId)) return 'failure'
            context.notifyPackageChanged(objectId)
            return 'success'
          }
          case 'set_object_visible': {
            const objectId = stringParam(params, 'objectId') ?? instance.ownerObjectId
            const visible = params.visible
            const object = context.world.get(objectId)
            if (!object || typeof visible !== 'boolean') return 'failure'
            object.mesh.visible = visible
            context.invalidate()
            return 'success'
          }
          case 'set_object_position': {
            const objectId = stringParam(params, 'objectId') ?? instance.ownerObjectId
            const object = context.world.get(objectId)
            if (!object) return 'failure'
            const x = numberParam(params, 'x')
            const y = numberParam(params, 'y')
            const z = numberParam(params, 'z')
            if (x === null && y === null && z === null) return 'failure'
            context.world.update(objectId, {
              ...(x !== null ? { x } : {}),
              ...(y !== null ? { y } : {}),
              ...(z !== null ? { z } : {}),
            })
            context.invalidate()
            context.notifyPackageChanged(objectId)
            return 'success'
          }
          default:
            return 'failure'
        }
      },
    }
  }
}
