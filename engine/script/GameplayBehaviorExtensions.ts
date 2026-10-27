import { CooldownScheduler } from '../runtime/CooldownScheduler.ts'
import { ResourcePoolRegistry } from '../runtime/ResourcePoolRegistry.ts'
import { GameplayWorldSystems } from '../world/GameplayWorldSystems.ts'
import type { SpatialItem3, SpatialPoint3 } from '../world/SpatialHash3D.ts'
import { StatusEffectRuntime } from '../runtime/StatusEffectRuntime.ts'
import { ObjectiveTracker } from './ObjectiveTracker.ts'
import type { BehaviorTreeParameters, BehaviorTreeStatus } from './BehaviorTree.ts'
import type { BehaviorTreeHandlerRegistry } from './BehaviorTreeHandlerRegistry.ts'

export interface GameplayBehaviorServices<TContext> {
  readonly resources: ResourcePoolRegistry
  readonly world: GameplayWorldSystems<SpatialItem3>
  readonly statuses: StatusEffectRuntime
  readonly objectives: ObjectiveTracker
  readonly cooldowns: CooldownScheduler
  readonly resolveOwnerId: (context: TContext) => string | null
  readonly resolvePosition: (context: TContext) => SpatialPoint3 | null
  readonly namespace?: string
}

const stringParam = (params: BehaviorTreeParameters, key: string): string | null => {
  const value = params[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
const numberParam = (params: BehaviorTreeParameters, key: string): number | null => {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
const ownerFor = <TContext>(
  params: BehaviorTreeParameters,
  context: TContext,
  services: GameplayBehaviorServices<TContext>,
): string | null => stringParam(params, 'ownerId') ?? services.resolveOwnerId(context)
const cooldownKey = (owner: string, id: string): string => `${owner}::${id}`
const successIf = (condition: boolean): BehaviorTreeStatus => condition ? 'success' : 'failure'

/**
 * Registers generic gameplay actions/conditions into a shared behavior-tree registry.
 * Owner identity and position are injected by the host, so this module stays game-agnostic.
 */
export function registerGameplayBehaviorNodes<TContext>(
  registry: BehaviorTreeHandlerRegistry<TContext>,
  services: GameplayBehaviorServices<TContext>,
): () => void {
  const owner = (params: BehaviorTreeParameters, context: TContext) => {
    const id = ownerFor(params, context, services)
    return id?.trim() || null
  }
  const resource = (params: BehaviorTreeParameters, context: TContext) => {
    const ownerId = owner(params, context)
    const resourceId = stringParam(params, 'resourceId')
    return ownerId && resourceId ? services.resources.get(ownerId, resourceId) : undefined
  }
  const cooldown = (params: BehaviorTreeParameters, context: TContext) => {
    const ownerId = owner(params, context)
    const id = stringParam(params, 'cooldownId')
    return ownerId && id ? cooldownKey(ownerId, id) : null
  }

  return registry.registerNamespace(services.namespace ?? 'gameplay', {
    conditions: {
      resource_at_least: (params, context) => {
        const pool = resource(params, context)
        const amount = numberParam(params, 'amount')
        return !!pool && amount !== null && amount >= 0 && pool.current >= amount
      },
      resource_depleted: (params, context) => resource(params, context)?.depleted ?? false,
      has_tag: (params, context) => {
        const id = owner(params, context)
        const tag = stringParam(params, 'tag')
        return !!id && !!tag && services.world.tags.has(id, tag)
      },
      nearby_tagged: (params, context) => {
        const position = services.resolvePosition(context)
        const tag = stringParam(params, 'tag')
        const radius = numberParam(params, 'radius')
        const ownerId = owner(params, context)
        if (!position || !tag || radius === null || radius < 0) return false
        return services.world.queryRadius(position, radius, {
          allTags: [tag],
          predicate: item => item.id !== ownerId,
        }).length > 0
      },
      has_status: (params, context) => {
        const id = owner(params, context)
        const effectId = stringParam(params, 'effectId')
        return !!id && !!effectId && services.statuses.has(id, effectId)
      },
      status_stacks_at_least: (params, context) => {
        const id = owner(params, context)
        const effectId = stringParam(params, 'effectId')
        const stacks = numberParam(params, 'stacks')
        if (!id || !effectId || stacks === null || stacks < 1) return false
        return (services.statuses.get(id, effectId)?.stacks ?? 0) >= stacks
      },
      objective_state_is: params => {
        const id = stringParam(params, 'objectiveId')
        const expected = stringParam(params, 'state')
        return !!id && !!expected && services.objectives.getState(id) === expected
      },
      objective_completed: params => {
        const id = stringParam(params, 'objectiveId')
        return !!id && services.objectives.isCompleted(id)
      },
      cooldown_ready: (params, context) => {
        const key = cooldown(params, context)
        return !!key && services.cooldowns.isReady(key)
      },
      inside_trigger: (params, context) => {
        const id = owner(params, context)
        const triggerId = stringParam(params, 'triggerId')
        return !!id && !!triggerId && services.world.triggers.getOccupants(triggerId).includes(id)
      },
    },
    actions: {
      resource_spend: (params, context) => {
        const pool = resource(params, context)
        const amount = numberParam(params, 'amount')
        return successIf(!!pool && amount !== null && amount > 0 && pool.spend(amount))
      },
      resource_restore: (params, context) => {
        const pool = resource(params, context)
        const amount = numberParam(params, 'amount')
        if (!pool || amount === null || amount <= 0) return 'failure'
        pool.restore(amount)
        return 'success'
      },
      tag_add: (params, context) => {
        const id = owner(params, context)
        const tag = stringParam(params, 'tag')
        if (!id || !tag) return 'failure'
        return successIf(services.world.tags.add(id, tag) || services.world.tags.has(id, tag))
      },
      tag_remove: (params, context) => {
        const id = owner(params, context)
        const tag = stringParam(params, 'tag')
        if (!id || !tag) return 'failure'
        return successIf(services.world.tags.remove(id, tag) || !services.world.tags.has(id, tag))
      },
      status_apply: (params, context) => {
        const id = owner(params, context)
        const effectId = stringParam(params, 'effectId')
        const duration = numberParam(params, 'duration')
        if (!id || !effectId || duration === null) return 'failure'
        const tickInterval = numberParam(params, 'tickInterval')
        const maxStacks = numberParam(params, 'maxStacks')
        const stackPolicy = stringParam(params, 'stackPolicy')
        const result = services.statuses.apply(id, effectId, duration, {
          ...(stackPolicy === 'refresh' || stackPolicy === 'replace' || stackPolicy === 'stack' ? { stackPolicy } : {}),
          ...(maxStacks === null ? {} : { maxStacks }),
          ...(tickInterval === null ? {} : { tickIntervalSeconds: tickInterval }),
        })
        return successIf(result !== null)
      },
      status_remove: (params, context) => {
        const id = owner(params, context)
        const effectId = stringParam(params, 'effectId')
        return successIf(!!id && !!effectId && services.statuses.remove(id, effectId) !== null)
      },
      objective_activate: params => successIf(services.objectives.activate(stringParam(params, 'objectiveId') ?? '')),
      objective_progress: params => {
        const id = stringParam(params, 'objectiveId')
        const amount = numberParam(params, 'amount')
        return successIf(!!id && amount !== null && services.objectives.addProgress(id, amount))
      },
      objective_complete: params => successIf(services.objectives.complete(stringParam(params, 'objectiveId') ?? '')),
      objective_fail: params => successIf(services.objectives.fail(stringParam(params, 'objectiveId') ?? '')),
      cooldown_start: (params, context) => {
        const key = cooldown(params, context)
        const duration = numberParam(params, 'duration')
        return successIf(!!key && duration !== null && duration >= 0 && services.cooldowns.start(key, duration))
      },
      cooldown_cancel: (params, context) => {
        const key = cooldown(params, context)
        return successIf(!!key && services.cooldowns.cancel(key))
      },
    },
  })
}
