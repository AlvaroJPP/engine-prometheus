import { CooldownScheduler } from './CooldownScheduler.ts'
import { ResourcePoolRegistry } from './ResourcePoolRegistry.ts'
import { StatusEffectRuntime } from './StatusEffectRuntime.ts'
import { EntityComponentRuntime } from './EntityComponentRuntime.ts'
import { EntityBehaviorRuntime } from './EntityBehaviorRuntime.ts'
import { EntitySystemRuntime } from './EntitySystemRuntime.ts'
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
export interface GameplayEntityContext {
  readonly entityId: string
  readonly runtime: GameplayRuntime
}
export interface GameplayEntityCleanup {
  readonly entityRemoved: boolean
  readonly componentEntityRemoved: boolean
  readonly behaviorsRemoved: number
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
  readonly entities = new EntityComponentRuntime()
  readonly behaviors: EntityBehaviorRuntime<Record<string, unknown>, GameplayEntityContext>
  readonly systems: EntitySystemRuntime<Record<string, unknown>, GameplayEntityContext>
  private readonly behaviorNamespace: string

  constructor(options: GameplayRuntimeOptions = {}) {
    this.world = new GameplayWorldSystems(options.cellSize, options.maxQueryCells)
    this.statuses = new StatusEffectRuntime(options.maxCatchUpTicks)
    this.behaviorNamespace = options.behaviorNamespace?.trim() || 'gameplay'
    const createEntityContext = (entityId: string): GameplayEntityContext => ({
      entityId,
      runtime: this as GameplayRuntime,
    })
    this.behaviors = new EntityBehaviorRuntime<Record<string, unknown>, GameplayEntityContext>(
      this.entities,
      createEntityContext,
    )
    this.systems = new EntitySystemRuntime<Record<string, unknown>, GameplayEntityContext>(
      this.entities,
      createEntityContext,
    )
  }

  /** Starts component-filtered systems before entity behaviors consume their results. */
  start(): void {
    this.systems.start()
    this.behaviors.start()
  }

  /** Stops behaviors before systems, reversing the startup dependency order. */
  stop(): void {
    this.behaviors.stop()
    this.systems.stop()
  }

  /** Advances timed systems, component-filtered systems, behaviors, and trigger occupancy. */
  update(deltaSeconds: number): GameplayRuntimeUpdate {
    this.cooldowns.update(deltaSeconds)
    const statusEvents = this.statuses.update(deltaSeconds)
    this.systems.update(deltaSeconds)
    this.behaviors.update(deltaSeconds)
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
    if (!owner) {
      return {
        entityRemoved: false,
        componentEntityRemoved: false,
        behaviorsRemoved: 0,
        resourcePoolsRemoved: 0,
        statusEffectsRemoved: 0,
        cooldownsCanceled: 0,
      }
    }
    const behaviorsRemoved = this.behaviors.removeEntity(owner)
    const errors: unknown[] = []
    let componentEntityRemoved = false
    try {
      componentEntityRemoved = this.entities.destroy(owner)
    } catch (error) {
      errors.push(error)
      componentEntityRemoved = !this.entities.get(owner)
    }
    const entityRemoved = this.world.remove(owner)
    const resourcePoolsRemoved = this.resources.removeOwner(owner)
    const statusEffectsRemoved = this.statuses.removeOwner(owner).length
    const prefix = `${owner}::`
    const cooldownKeys = this.cooldowns.snapshot()
      .map(entry => entry.key)
      .filter(key => key.startsWith(prefix))
    for (const key of cooldownKeys) this.cooldowns.cancel(key)
    if (errors.length > 0) throw errors[0]
    return {
      entityRemoved,
      componentEntityRemoved,
      behaviorsRemoved,
      resourcePoolsRemoved,
      statusEffectsRemoved,
      cooldownsCanceled: cooldownKeys.length,
    }
  }

  /** Clears the complete runtime; dispose external subscriptions before reusing it. */
  clear(): void {
    const errors: unknown[] = []
    const cleanups = [
      () => this.stop(),
      () => this.behaviors.clear(),
      () => this.systems.clear(),
      () => this.entities.clear(),
      () => this.resources.clear(),
      () => this.world.clear(),
      () => this.statuses.clear(),
      () => this.objectives.clear(),
      () => this.cooldowns.clear(),
    ]
    for (const cleanup of cleanups) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    if (errors.length > 0) throw errors[0]
  }
}
