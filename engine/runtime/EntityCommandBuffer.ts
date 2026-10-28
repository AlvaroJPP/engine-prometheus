import { EntityComponentRuntime } from './EntityComponentRuntime.ts'
import type { EntityComponentKey } from './EntityComponentRuntime.ts'

export type EntityCommandKind =
  | 'create-entity'
  | 'destroy-entity'
  | 'add-component'
  | 'remove-component'
  | 'set-enabled'

type EntityCommand<TComponents extends object> =
  | { readonly kind: 'create-entity'; readonly entityId: string }
  | { readonly kind: 'destroy-entity'; readonly entityId: string }
  | {
      readonly kind: 'add-component'
      readonly entityId: string
      readonly componentType: EntityComponentKey<TComponents>
      readonly component: TComponents[EntityComponentKey<TComponents>]
    }
  | {
      readonly kind: 'remove-component'
      readonly entityId: string
      readonly componentType: EntityComponentKey<TComponents>
    }
  | { readonly kind: 'set-enabled'; readonly entityId: string; readonly enabled: boolean }

export interface EntityCommandFailure {
  /** Zero-based index in the playback snapshot. */
  readonly commandIndex: number
  readonly commandType: EntityCommandKind
  readonly entityId: string
  readonly error: unknown
}

export interface EntityCommandBufferReport {
  readonly commandCount: number
  readonly appliedCount: number
  readonly skippedCount: number
  readonly failures: readonly EntityCommandFailure[]
}

export interface EntityCommandBufferOptions {
  readonly onError?: (failure: EntityCommandFailure) => void
}

/**
 * Queues structural entity changes until playback, so systems can mutate the
 * world at a deterministic boundary rather than changing query membership mid-loop.
 */
export class EntityCommandBuffer<TComponents extends object = Record<string, unknown>> {
  private readonly entities: EntityComponentRuntime<TComponents>
  private readonly pending: EntityCommand<TComponents>[] = []
  private readonly onError?: (failure: EntityCommandFailure) => void
  private playingBack = false
  private disposed = false

  constructor(
    entities: EntityComponentRuntime<TComponents>,
    options: EntityCommandBufferOptions = {},
  ) {
    this.entities = entities
    this.onError = options.onError
  }

  createEntity(entityId: string): void {
    this.assertAvailable()
    this.pending.push({ kind: 'create-entity', entityId: this.normalizeEntityId(entityId) })
  }

  destroyEntity(entityId: string): void {
    this.assertAvailable()
    this.pending.push({ kind: 'destroy-entity', entityId: this.normalizeEntityId(entityId) })
  }

  addComponent<K extends EntityComponentKey<TComponents>>(
    entityId: string,
    componentType: K,
    component: TComponents[K],
  ): void {
    this.assertAvailable()
    this.pending.push({
      kind: 'add-component',
      entityId: this.normalizeEntityId(entityId),
      componentType: this.normalizeComponentType(componentType),
      component: component as TComponents[EntityComponentKey<TComponents>],
    })
  }

  removeComponent<K extends EntityComponentKey<TComponents>>(
    entityId: string,
    componentType: K,
  ): void {
    this.assertAvailable()
    this.pending.push({
      kind: 'remove-component',
      entityId: this.normalizeEntityId(entityId),
      componentType: this.normalizeComponentType(componentType),
    })
  }

  setEnabled(entityId: string, enabled: boolean): void {
    this.assertAvailable()
    this.pending.push({
      kind: 'set-enabled',
      entityId: this.normalizeEntityId(entityId),
      enabled,
    })
  }

  /**
   * Applies the commands that were pending at the start of playback in queue order.
   * Commands queued by callbacks during playback remain queued for the next call.
   * A failed command is reported and does not prevent later commands from running.
   */
  playback(): EntityCommandBufferReport {
    this.assertAvailable()
    if (this.playingBack) throw new Error('Entity command buffer playback cannot be nested.')

    const snapshot = this.pending.splice(0)
    this.playingBack = true
    let appliedCount = 0
    let skippedCount = 0
    const failures: EntityCommandFailure[] = []

    try {
      snapshot.forEach((command, commandIndex) => {
        try {
          if (this.execute(command)) appliedCount += 1
          else skippedCount += 1
        } catch (error) {
          const failure: EntityCommandFailure = {
            commandIndex,
            commandType: command.kind,
            entityId: command.entityId,
            error,
          }
          failures.push(failure)
          try {
            if (this.onError) this.onError(failure)
            else console.error(
              `[EntityCommandBuffer] Command ${command.kind} failed for "${command.entityId}".`,
              error,
            )
          } catch (handlerError) {
            console.error(
              `[EntityCommandBuffer] Error handler failed for "${command.entityId}".`,
              handlerError,
            )
          }
        }
      })
    } finally {
      this.playingBack = false
    }

    return {
      commandCount: snapshot.length,
      appliedCount,
      skippedCount,
      failures,
    }
  }

  /** Discards queued commands without changing the entities or component storage. */
  clear(): void {
    this.pending.length = 0
  }

  /** Discards pending commands and prevents any further queueing or playback. */
  dispose(): void {
    this.clear()
    this.disposed = true
  }

  get pendingCount(): number { return this.pending.length }

  private execute(command: EntityCommand<TComponents>): boolean {
    switch (command.kind) {
      case 'create-entity':
        this.entities.create(command.entityId)
        return true
      case 'destroy-entity':
        return this.entities.destroy(command.entityId)
      case 'add-component':
        return this.entities.addComponent(
          command.entityId,
          command.componentType,
          command.component,
        )
      case 'remove-component':
        return this.entities.removeComponent(command.entityId, command.componentType)
      case 'set-enabled':
        return this.entities.setEnabled(command.entityId, command.enabled)
    }
  }

  private normalizeEntityId(entityId: string): string {
    const id = entityId.trim()
    if (!id) throw new Error('Entity command entity identifiers must not be empty.')
    return id
  }

  private normalizeComponentType(componentType: string): EntityComponentKey<TComponents> {
    const key = componentType.trim()
    if (!key) throw new Error('Entity command component types must not be empty.')
    return key as EntityComponentKey<TComponents>
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Entity command buffer has been disposed.')
  }
}
