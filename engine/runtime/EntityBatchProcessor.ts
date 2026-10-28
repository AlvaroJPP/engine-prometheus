import { EntityComponentRuntime } from './EntityComponentRuntime.ts'
import type { EntityComponentKey } from './EntityComponentRuntime.ts'
import type { EntityQueryHandle } from './EntityQueryRuntime.ts'

export interface EntityBatchFailure {
  readonly entityId: string
  readonly error: unknown
}

export interface EntityBatchReport {
  readonly candidateCount: number
  readonly processedCount: number
  readonly skippedCount: number
  readonly failures: readonly EntityBatchFailure[]
}

export interface EntityBatchOptions {
  /** Additional runtime eligibility check, used by systems with per-entity faults. */
  readonly isEligible?: (entityId: string) => boolean
  /** Handles isolated per-entity callback failures. Defaults to console.error. */
  readonly onError?: (entityId: string, error: unknown) => void
}

export interface EntityBatchItem<TComponents extends object, TContext> {
  readonly entityId: string
  readonly context: TContext
  getComponent<K extends EntityComponentKey<TComponents>>(componentType: K): TComponents[K] | undefined
  hasComponent<K extends EntityComponentKey<TComponents>>(componentType: K): boolean
}

export interface EntityBatchView<TComponents extends object, TContext> {
  /** Stable ID snapshot captured when this batch view was created. */
  readonly entityIds: readonly string[]
  readonly size: number
  /** True only while the entity is still in the query and passes the eligibility check. */
  has(entityId: string): boolean
  getComponent<K extends EntityComponentKey<TComponents>>(
    entityId: string,
    componentType: K,
  ): TComponents[K] | undefined
  hasComponent(entityId: string, componentType: EntityComponentKey<TComponents>): boolean
  getContext(entityId: string): TContext | undefined
  /** Iterates the initial snapshot; entities that leave mid-batch are skipped and new matches wait until the next batch. */
  forEach(callback: (item: EntityBatchItem<TComponents, TContext>) => void): EntityBatchReport
}

/** Creates stable batch views over cached query results without owning entities or query lifecycles. */
export class EntityBatchProcessor<TComponents extends object> {
  private readonly entities: EntityComponentRuntime<TComponents>

  constructor(entities: EntityComponentRuntime<TComponents>) {
    this.entities = entities
  }

  createView<TContext>(
    query: EntityQueryHandle,
    createContext: (entityId: string) => TContext,
    options: EntityBatchOptions = {},
  ): EntityBatchView<TComponents, TContext> {
    const entityIds = Object.freeze(query.getEntities())
    const has = (rawEntityId: string): boolean => {
      const entityId = rawEntityId.trim()
      return Boolean(
        entityId
        && query.has(entityId)
        && this.entities.get(entityId)
        && (options.isEligible?.(entityId) ?? true),
      )
    }
    const getComponent = <K extends EntityComponentKey<TComponents>>(
      entityId: string,
      componentType: K,
    ): TComponents[K] | undefined => has(entityId)
      ? this.entities.getComponent(entityId, componentType)
      : undefined
    const hasComponent = (
      entityId: string,
      componentType: EntityComponentKey<TComponents>,
    ): boolean => has(entityId) && this.entities.hasComponent(entityId, componentType)

    return {
      entityIds,
      size: entityIds.length,
      has,
      getComponent,
      hasComponent,
      getContext: entityId => has(entityId) ? createContext(entityId.trim()) : undefined,
      forEach: callback => {
        const failures: EntityBatchFailure[] = []
        let processedCount = 0
        let skippedCount = 0
        for (const entityId of entityIds) {
          if (!has(entityId)) {
            skippedCount += 1
            continue
          }
          try {
            const context = createContext(entityId)
            const item: EntityBatchItem<TComponents, TContext> = {
              entityId,
              context,
              getComponent: componentType => getComponent(entityId, componentType),
              hasComponent: componentType => hasComponent(entityId, componentType),
            }
            callback(item)
            processedCount += 1
          } catch (error) {
            failures.push({ entityId, error })
            try {
              if (options.onError) options.onError(entityId, error)
              else console.error(`[EntityBatchProcessor] Batch callback failed for "${entityId}".`, error)
            } catch (handlerError) {
              console.error(`[EntityBatchProcessor] Error handler failed for "${entityId}".`, handlerError)
            }
          }
        }
        return {
          candidateCount: entityIds.length,
          processedCount,
          skippedCount,
          failures,
        }
      },
    }
  }
}
