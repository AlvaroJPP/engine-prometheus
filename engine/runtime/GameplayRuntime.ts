import { CooldownScheduler } from './CooldownScheduler.ts'
import { ResourcePoolRegistry } from './ResourcePoolRegistry.ts'
import { StatusEffectRuntime } from './StatusEffectRuntime.ts'
import { GameplayWorldSystems } from '../world/GameplayWorldSystems.ts'
import type { SpatialItem3 } from '../world/SpatialHash3D.ts'
import type { TriggerEvent } from '../world/TriggerVolumeSystem.ts'
import type { StatusEffectEvent } from './StatusEffectRuntime.ts'
import { ObjectiveTracker } from '../script/ObjectiveTracker.ts'
import { registerGameplayBehaviorNodes } from '../script/GameplayBehaviorExtensions.ts'
import type { GameplayBehaviorServices } from '../script/GameplayBehaviorExtensions.ts'
import type { BehaviorTreeHandlerRegistry } from '../script/BehaviorTreeHandlerRegistry.ts'

export interface GameplayRuntimeOptions {
  readonly cellSize?: number
  readonly maxQueryCells?: number
  readonly maxCatchUpTicks?: number
  readonly behaviorNamespace?: string
}
export interface GameplayRuntimeUpdate {
  readonly statusEvents: readonly StatusEffectEvent[]
  readonly triggerEvents: readonly TriggerEvent[]
}
export interface GameplayEntityCleanup {
  readonly entityRemoved: boolean
  readonly resourcePoolsRemoved: number
  readonly statusEffectsRemoved: number
  readonly cooldownsCanceled: number
}
export type GameplayRuntimeAccessors<TContext> = Pick<
  GameplayBehaviorServices<TContext>,
  'resolveOwnerId' | 'resolvePosition'
> 

/** Optional composition root for the generic gameplay primitives. */
export class GameplayRuntime {
  readonly resources = new ResourcePoolRegistry()
  readonly world: GameplayWorldSystems<SpatialItem3>
  readonly statuses: StatusEffectRuntime
  readonly objectives = new ObjectiveTracker()
  readonly cooldowns = new CooldownScheduler()
  private readonly behaviorNamespace: string

  constructor(options: GameplayRuntimeOptions = {}) {
    this.world = new GameplayWorldSystems(options.cellSize, options.maxQueryCells)
    this.statuses = new StatusEffectRuntime(options.maxCatchUpTicks)
    this.behaviorNamespace = options.behaviorNamespace?.trim() || 'gameplay'
  }

  /** Advances timed systems and evaluates trigger occupants once per simulation tick. */
  update(deltaSeconds: number): GameplayRuntimeUpdate {
    this.cooldowns.update(deltaSeconds)
    const statusEvents = this.statuses.update(deltaSeconds)
    const triggerEvents = this.world.updateTriggers()
    return { statusEvents, triggerEvents }
  }

  registerBehaviorNodes<TContext>(
    registry: BehaviorTreeHandlerRegistry<TContext>,
    accessors: GameplayRuntimeAccessors<TContext>,
  ): () => void {
    return registerGameplayBehaviorNodes(registry, {
      resources: this.resources,
      world: this.world,
      statuses: this.statuses,
      objectives: this.objectives,
      cooldowns: this.cooldowns,
      namespace: this.behaviorNamespace,
      ...accessors,
    })
  }

  /** Removes all owner-scoped runtime state together with its indexed world entity. */
  removeEntity(ownerId: string): GameplayEntityCleanup {
    const owner = ownerId.trim()
    if (!owner) return { entityRemoved: false, resourcePoolsRemoved: 0, statusEffectsRemoved: 0, cooldownsCanceled: 0 }
    const resourcePoolsRemoved = this.resources.removeOwner(owner)
    const statusEffectsRemoved = this.statuses.removeOwner(owner).length
    const prefix = `${owner}::`
    const cooldownKeys = this.cooldowns.snapshot()
      .map(entry => entry.key)
      .filter(key => key.startsWith(prefix))
    for (const key of cooldownKeys) this.cooldowns.cancel(key)
    return {
      entityRemoved: this.world.remove(owner),
      resourcePoolsRemoved,
      statusEffectsRemoved,
      cooldownsCanceled: cooldownKeys.length,
    }
  }

  /** Clears the complete runtime; dispose external subscriptions before reusing it. */
  clear(): void {
    this.resources.clear()
    this.world.clear()
    this.statuses.clear()
    this.objectives.clear()
    this.cooldowns.clear()
  }
}
