import { EntityComponentRuntime } from './EntityComponentRuntime.ts'
import type { EntityComponentKey, EntityComponentEvent } from './EntityComponentRuntime.ts'

export interface EntityQueryFilter<TComponents extends object> {
  readonly allOf?: readonly EntityComponentKey<TComponents>[]
  readonly anyOf?: readonly EntityComponentKey<TComponents>[]
  readonly noneOf?: readonly EntityComponentKey<TComponents>[]
  readonly includeDisabled?: boolean
}

export interface EntityQueryEvent {
  readonly type: 'enter' | 'exit'
  readonly queryId: string
  readonly entityId: string
}

export interface EntityQuerySnapshot<TComponents extends object = object> {
  readonly id: string
  readonly size: number
  readonly filter: EntityQueryFilter<TComponents>
}

interface QueryRecord<TComponents extends object> {
  readonly id: string
  readonly filter: EntityQueryFilter<TComponents>
  readonly allOf: readonly EntityComponentKey<TComponents>[]
  readonly anyOf: readonly EntityComponentKey<TComponents>[]
  readonly noneOf: readonly EntityComponentKey<TComponents>[]
  readonly matches: Set<string>
  readonly listeners: Set<(event: EntityQueryEvent) => void>
  readonly reconciling: Set<string>
  readonly pendingSync: Set<string>
  disposed: boolean
}

export interface EntityQueryHandle {
  readonly id: string
  readonly size: number
  getEntities(): string[]
  has(entityId: string): boolean
  subscribe(listener: (event: EntityQueryEvent) => void): () => void
  dispose(): void
}

/** Maintains reusable, cached entity queries over component combinations. */
export class EntityQueryRuntime<TComponents extends object = Record<string, unknown>> {
  private readonly queries = new Map<string, QueryRecord<TComponents>>()
  private readonly entities: EntityComponentRuntime<TComponents>
  private readonly unsubscribeEntities: () => void
  private disposed = false

  constructor(entities: EntityComponentRuntime<TComponents>) {
    this.entities = entities
    this.unsubscribeEntities = entities.subscribe(event => this.handleEntityEvent(event))
  }

  create(id: string, filter: EntityQueryFilter<TComponents> = {}): EntityQueryHandle<TComponents> {
    this.assertAvailable()
    const key = id.trim()
    if (!key) throw new Error('Entity queries require a non-empty identifier.')
    if (this.queries.has(key)) throw new Error(`Entity query already exists: "${key}".`)

    const allOf = this.normalizeComponents(filter.allOf ?? [])
    const anyOf = this.normalizeComponents(filter.anyOf ?? [])
    const noneOf = this.normalizeComponents(filter.noneOf ?? [])
    if (allOf.some(type => noneOf.includes(type))) {
      throw new Error(`Entity query "${key}" cannot require and exclude the same component.`)
    }

    const record: QueryRecord<TComponents> = {
      id: key,
      filter: {
        allOf,
        anyOf,
        noneOf,
        includeDisabled: filter.includeDisabled === true,
      },
      allOf,
      anyOf,
      noneOf,
      matches: new Set(),
      listeners: new Set(),
      reconciling: new Set(),
      pendingSync: new Set(),
      disposed: false,
    }
    this.queries.set(key, record)
    for (const entityId of this.entities.query([], { includeDisabled: true })) this.sync(record, entityId)

    let active = true
    const handle: EntityQueryHandle = {
      id: key,
      get size() { return record.matches.size },
      getEntities: () => [...record.matches].sort(),
      has: entityId => record.matches.has(entityId.trim()),
      subscribe: listener => {
        this.assertAvailable()
        if (!active || record.disposed || this.queries.get(key) !== record) {
          throw new Error(`Entity query "${key}" has been disposed.`)
        }
        record.listeners.add(listener)
        let subscribed = true
        return () => {
          if (!subscribed) return
          subscribed = false
          record.listeners.delete(listener)
        }
      },
      dispose: () => {
        if (!active) return
        active = false
        if (this.queries.get(key) === record) this.queries.delete(key)
        record.disposed = true
        record.listeners.clear()
        record.matches.clear()
        record.pendingSync.clear()
      },
    }
    return handle
  }

  list(): EntityQuerySnapshot<TComponents>[] {
    return [...this.queries.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(record => ({
        id: record.id,
        size: record.matches.size,
        filter: {
          allOf: [...record.allOf],
          anyOf: [...record.anyOf],
          noneOf: [...record.noneOf],
          includeDisabled: record.filter.includeDisabled === true,
        },
      }))
  }

  clear(): void {
    for (const record of this.queries.values()) {
      record.disposed = true
      record.listeners.clear()
      record.matches.clear()
      record.pendingSync.clear()
    }
    this.queries.clear()
  }

  dispose(): void {
    if (this.disposed) return
    this.clear()
    this.disposed = true
    this.unsubscribeEntities()
  }

  get size(): number { return this.queries.size }

  private handleEntityEvent(event: EntityComponentEvent<TComponents>): void {
    if (event.type === 'entity-destroying') {
      for (const record of [...this.queries.values()]) this.leave(record, event.entityId)
      return
    }
    if (event.type === 'entity-destroyed') return
    if (
      event.type === 'entity-created'
      || event.type === 'entity-enabled-changed'
      || event.type === 'component-added'
      || event.type === 'component-removed'
    ) {
      const entityId = event.type === 'entity-created' ? event.entity.id : event.entityId
      for (const record of [...this.queries.values()]) this.sync(record, entityId)
    }
  }

  private sync(record: QueryRecord<TComponents>, entityId: string): void {
    if (this.queries.get(record.id) !== record) return
    const id = entityId.trim()
    if (!id) return
    if (record.reconciling.has(id)) {
      record.pendingSync.add(id)
      return
    }

    record.reconciling.add(id)
    try {
      let repeat = true
      let attempts = 0
      while (repeat && attempts < 8) {
        attempts += 1
        record.pendingSync.delete(id)
        const matches = this.matches(record, id)
        if (matches && !record.matches.has(id)) this.enter(record, id)
        else if (!matches && record.matches.has(id)) this.leave(record, id)
        repeat = record.pendingSync.has(id)
        if (this.queries.get(record.id) !== record) break
      }
      if (record.pendingSync.has(id)) {
        record.pendingSync.delete(id)
        console.warn(`[EntityQueryRuntime] Too many reentrant component changes for entity "${id}" in query "${record.id}".`)
      }
    } finally {
      record.reconciling.delete(id)
    }
  }

  private matches(record: QueryRecord<TComponents>, entityId: string): boolean {
    if (this.entities.isDestroying(entityId)) return false
    const entity = this.entities.get(entityId)
    if (!entity || (!record.filter.includeDisabled && !entity.enabled)) return false
    if (!record.allOf.every(type => this.entities.hasComponent(entityId, type))) return false
    if (record.anyOf.length > 0 && !record.anyOf.some(type => this.entities.hasComponent(entityId, type))) return false
    return !record.noneOf.some(type => this.entities.hasComponent(entityId, type))
  }

  private enter(record: QueryRecord<TComponents>, entityId: string): void {
    record.matches.add(entityId)
    this.emit(record, { type: 'enter', queryId: record.id, entityId })
  }

  private leave(record: QueryRecord<TComponents>, entityId: string): void {
    if (!record.matches.delete(entityId)) return
    this.emit(record, { type: 'exit', queryId: record.id, entityId })
  }

  private emit(record: QueryRecord<TComponents>, event: EntityQueryEvent): void {
    for (const listener of [...record.listeners]) {
      try {
        listener(event)
      } catch (error) {
        console.error(`[EntityQueryRuntime] Query listener failed for "${record.id}".`, error)
      }
    }
  }

  private normalizeComponents(
    components: readonly EntityComponentKey<TComponents>[],
  ): EntityComponentKey<TComponents>[] {
    return [...new Set(components.map(component => {
      const key = component.trim()
      if (!key) throw new Error('Entity query component filters cannot contain empty identifiers.')
      return key as EntityComponentKey<TComponents>
    }))]
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Entity query runtime has been disposed.')
  }
}
