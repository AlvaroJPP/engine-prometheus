import { CooldownScheduler } from './CooldownScheduler.ts'
import { ResourcePoolRegistry } from './ResourcePoolRegistry.ts'
import { StatusEffectRuntime } from './StatusEffectRuntime.ts'
import { EntityComponentRuntime } from './EntityComponentRuntime.ts'
import { EntityCommandBuffer } from './EntityCommandBuffer.ts'
import type { EntityCommandBufferReport } from './EntityCommandBuffer.ts'
import { RuntimePhasePipeline } from './RuntimePhasePipeline.ts'
import type { RuntimePipelineReport } from './RuntimePhasePipeline.ts'
import { EntityBehaviorRuntime } from './EntityBehaviorRuntime.ts'
import { EntityQueryRuntime } from './EntityQueryRuntime.ts'
import { EntityBatchProcessor } from './EntityBatchProcessor.ts'
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
  readonly commandReport: EntityCommandBufferReport
  readonly pipelineReport: RuntimePipelineReport
}
export interface GameplayFrameContext {
  readonly runtime: GameplayRuntime
  statusEvents: readonly StatusEffectEvent[]
  triggerEvents: readonly TriggerEvent[]
  commandReport: EntityCommandBufferReport
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
  readonly commands: EntityCommandBuffer<Record<string, unknown>>
  readonly queries: EntityQueryRuntime<Record<string, unknown>>
  readonly batches: EntityBatchProcessor<Record<string, unknown>>
  readonly behaviors: EntityBehaviorRuntime<Record<string, unknown>, GameplayEntityContext>
  readonly systems: EntitySystemRuntime<Record<string, unknown>, GameplayEntityContext>
  readonly pipeline: RuntimePhasePipeline<GameplayFrameContext>
  private readonly behaviorNamespace: string
  private currentFrame: GameplayFrameContext | null = null

  constructor(options: GameplayRuntimeOptions = {}) {
    this.world = new GameplayWorldSystems(options.cellSize, options.maxQueryCells)
    this.statuses = new StatusEffectRuntime(options.maxCatchUpTicks)
    this.behaviorNamespace = options.behaviorNamespace?.trim() || 'gameplay'
    this.commands = new EntityCommandBuffer<Record<string, unknown>>(this.entities)
    this.queries = new EntityQueryRuntime<Record<string, unknown>>(this.entities)
    this.batches = new EntityBatchProcessor<Record<string, unknown>>(this.entities)
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
      this.queries,
      this.batches,
    )
    this.pipeline = new RuntimePhasePipeline<GameplayFrameContext>()
    this.pipeline.definePhase({ id: 'timers', order: 10 })
    this.pipeline.definePhase({ id: 'entity-systems', order: 20 })
    this.pipeline.definePhase({ id: 'behaviors', order: 30 })
    this.pipeline.definePhase({ id: 'deferred-commands', order: 40 })
    this.pipeline.definePhase({ id: 'world-events', order: 50 })
    this.pipeline.registerTask({
      id: 'gameplay:cooldowns',
      phaseId: 'timers',
      priority: 0,
      execute: dt => this.cooldowns.update(dt),
    })
    this.pipeline.registerTask({
      id: 'gameplay:statuses',
      phaseId: 'timers',
      priority: 10,
      execute: (dt, frame) => { frame.statusEvents = this.statuses.update(dt) },
    })
    this.pipeline.registerTask({
      id: 'gameplay:entity-systems',
      phaseId: 'entity-systems',
      execute: dt => this.systems.update(dt),
    })
    this.pipeline.registerTask({
      id: 'gameplay:behaviors',
      phaseId: 'behaviors',
      execute: dt => this.behaviors.update(dt),
    })
    this.pipeline.registerTask({
      id: 'gameplay:commands',
      phaseId: 'deferred-commands',
      execute: (_dt, frame) => { frame.commandReport = this.commands.playback() },
    })
    this.pipeline.registerTask({
      id: 'gameplay:world-events',
      phaseId: 'world-events',
      execute: (_dt, frame) => { frame.triggerEvents = this.world.updateTriggers() },
    })
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

  /** Runs ordered runtime phases; clients can insert additional generic phases by order. */
  update(deltaSeconds: number): GameplayRuntimeUpdate {
    if (this.currentFrame) throw new Error('GameplayRuntime cannot be updated recursively.')
    const frame: GameplayFrameContext = {
      runtime: this,
      statusEvents: [],
      triggerEvents: [],
      commandReport: {
        commandCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        failures: [],
      },
    }
    const safeDeltaSeconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    this.currentFrame = frame
    try {
      const pipelineReport = this.pipeline.run(safeDeltaSeconds, frame)
      return {
        statusEvents: frame.statusEvents,
        triggerEvents: frame.triggerEvents,
        commandReport: frame.commandReport,
        pipelineReport,
      }
    } finally {
      this.currentFrame = null
    }
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
    const behaviorsRemoved = this.behaviors.list(owner).length
    const errors: unknown[] = []
    let componentEntityRemoved = false
    try {
      componentEntityRemoved = this.entities.destroy(owner)
    } catch (error) {
      errors.push(error)
      componentEntityRemoved = !this.entities.get(owner)
    }
    if (!componentEntityRemoved) this.behaviors.removeEntity(owner)
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
      () => this.queries.clear(),
      () => this.resources.clear(),
      () => this.world.clear(),
      () => this.statuses.clear(),
      () => this.objectives.clear(),
      () => this.cooldowns.clear(),
    ]
    for (const cleanup of cleanups) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    try { this.commands.clear() } catch (error) { errors.push(error) }
    for (const taskId of [
      'gameplay:cooldowns',
      'gameplay:statuses',
      'gameplay:entity-systems',
      'gameplay:behaviors',
      'gameplay:commands',
      'gameplay:world-events',
    ]) this.pipeline.resetTaskFault(taskId)
    if (errors.length > 0) throw errors[0]
  }
}
