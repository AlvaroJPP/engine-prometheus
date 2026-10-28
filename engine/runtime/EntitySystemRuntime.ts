import { EntityComponentRuntime } from './EntityComponentRuntime.ts'
import type { EntityComponentKey, EntityComponentEvent } from './EntityComponentRuntime.ts'

export interface EntitySystemDefinition<TComponents extends object, TContext> {
  readonly id: string
  readonly requiredComponents?: readonly EntityComponentKey<TComponents>[]
  readonly excludedComponents?: readonly EntityComponentKey<TComponents>[]
  readonly priority?: number
  readonly enabled?: boolean
  readonly onEntityEnter?: (entityId: string, context: TContext) => void
  readonly updateEntity?: (deltaSeconds: number, entityId: string, context: TContext) => void
  readonly onEntityExit?: (entityId: string, context: TContext) => void
}

export interface EntitySystemSnapshot {
  readonly id: string
  readonly enabled: boolean
  readonly active: boolean
  readonly priority: number
  readonly matchedEntityCount: number
  readonly faultedEntityCount: number
}

interface SystemRecord<TComponents extends object, TContext> {
  readonly id: string
  readonly definition: EntitySystemDefinition<TComponents, TContext>
  readonly required: readonly EntityComponentKey<TComponents>[]
  readonly excluded: readonly EntityComponentKey<TComponents>[]
  readonly activeEntities: Set<string>
  readonly faultedEntities: Set<string>
  readonly reconciling: Set<string>
  readonly pendingSync: Set<string>
  enabled: boolean
  active: boolean
}

/** Runs generic systems against entities matching required/excluded component filters. */
export class EntitySystemRuntime<TComponents extends object, TContext> {
  private readonly systems = new Map<string, SystemRecord<TComponents, TContext>>()
  private readonly unsubscribeEntities: () => void
  private readonly entities: EntityComponentRuntime<TComponents>
  private readonly createContext: (entityId: string) => TContext
  private runtimeActive = false
  private disposed = false

  constructor(
    entities: EntityComponentRuntime<TComponents>,
    createContext: (entityId: string) => TContext,
  ) {
    this.entities = entities
    this.createContext = createContext
    this.unsubscribeEntities = entities.subscribe(event => this.handleEntityEvent(event))
  }

  register(definition: EntitySystemDefinition<TComponents, TContext>): () => void {
    this.assertAvailable()
    const id = definition.id.trim()
    if (!id) throw new Error('Entity systems require a non-empty identifier.')
    if (this.systems.has(id)) throw new Error(`Entity system already registered: "${id}".`)

    const required = this.uniqueComponents(definition.requiredComponents ?? [])
    const excluded = this.uniqueComponents(definition.excludedComponents ?? [])
    if (required.some(type => excluded.includes(type))) {
      throw new Error(`Entity system "${id}" cannot require and exclude the same component.`)
    }

    const record: SystemRecord<TComponents, TContext> = {
      id,
      definition,
      required,
      excluded,
      activeEntities: new Set(),
      faultedEntities: new Set(),
      reconciling: new Set(),
      pendingSync: new Set(),
      enabled: definition.enabled !== false,
      active: false,
    }
    this.systems.set(id, record)
    if (this.runtimeActive && record.enabled) this.activate(record)
    return () => this.unregister(id, definition)
  }

  unregister(systemId: string, expected?: EntitySystemDefinition<TComponents, TContext>): boolean {
    const id = systemId.trim()
    const record = this.systems.get(id)
    if (!record || (expected && record.definition !== expected)) return false
    this.systems.delete(id)
    this.deactivate(record)
    return true
  }

  setEnabled(systemId: string, enabled: boolean): boolean {
    const record = this.systems.get(systemId.trim())
    if (!record || record.enabled === enabled) return false
    record.enabled = enabled
    if (enabled && this.runtimeActive) this.activate(record)
    else this.deactivate(record)
    return true
  }

  start(): void {
    this.assertAvailable()
    if (this.runtimeActive) return
    this.runtimeActive = true
    for (const record of this.orderedSystems()) {
      if (!this.runtimeActive || this.disposed) break
      if (this.systems.get(record.id) === record && record.enabled) this.activate(record)
    }
  }

  stop(): void {
    if (!this.runtimeActive) return
    this.runtimeActive = false
    for (const record of this.orderedSystems().reverse()) this.deactivate(record)
  }

  update(deltaSeconds: number): void {
    if (!this.runtimeActive || this.disposed) return
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    for (const record of this.orderedSystems()) {
      if (!this.runtimeActive || this.disposed) break
      if (!record.active || !record.enabled || this.systems.get(record.id) !== record) continue
      for (const entityId of [...record.activeEntities].sort()) {
        if (!this.runtimeActive || this.disposed || !record.active) break
        if (this.systems.get(record.id) !== record || !record.activeEntities.has(entityId)) continue
        this.syncEntity(record, entityId)
        if (!record.activeEntities.has(entityId) || record.faultedEntities.has(entityId)) continue
        if (!record.definition.updateEntity) continue
        try {
          record.definition.updateEntity(dt, entityId, this.createContext(entityId))
        } catch (error) {
          this.faultEntity(record, entityId, 'update', error)
        }
      }
    }
  }

  resetEntityFault(systemId: string, entityId: string): boolean {
    const record = this.systems.get(systemId.trim())
    const entity = entityId.trim()
    if (!record || !record.faultedEntities.delete(entity)) return false
    this.syncEntity(record, entity)
    return true
  }

  list(): EntitySystemSnapshot[] {
    return this.orderedSystems().map(record => ({
      id: record.id,
      enabled: record.enabled,
      active: record.active,
      priority: this.priority(record),
      matchedEntityCount: record.activeEntities.size,
      faultedEntityCount: record.faultedEntities.size,
    }))
  }

  clear(): void {
    this.stop()
    for (const record of [...this.systems.values()].reverse()) this.unregister(record.id, record.definition)
  }

  dispose(): void {
    if (this.disposed) return
    const errors: unknown[] = []
    try { this.clear() } catch (error) { errors.push(error) }
    this.disposed = true
    this.unsubscribeEntities()
    if (errors.length > 0) throw errors[0]
  }

  get size(): number { return this.systems.size }

  private handleEntityEvent(event: EntityComponentEvent<TComponents>): void {
    if (event.type === 'entity-destroying') {
      for (const record of this.systems.values()) this.leave(record, event.entityId)
      return
    }
    if (event.type === 'entity-destroyed') {
      for (const record of this.systems.values()) {
        record.faultedEntities.delete(event.entityId)
        record.pendingSync.delete(event.entityId)
      }
      return
    }
    if (
      event.type === 'entity-created'
      || event.type === 'entity-enabled-changed'
      || event.type === 'component-added'
      || event.type === 'component-removed'
    ) {
      const entityId = event.type === 'entity-created' ? event.entity.id : event.entityId
      for (const record of this.systems.values()) this.syncEntity(record, entityId)
    }
  }

  private activate(record: SystemRecord<TComponents, TContext>): void {
    if (record.active || !record.enabled || !this.runtimeActive || this.systems.get(record.id) !== record) return
    record.active = true
    for (const entityId of this.entities.query([], { includeDisabled: false }).sort()) {
      if (!record.active || !this.runtimeActive || this.systems.get(record.id) !== record) break
      this.syncEntity(record, entityId)
    }
  }

  private deactivate(record: SystemRecord<TComponents, TContext>): void {
    if (!record.active && record.activeEntities.size === 0) return
    record.active = false
    for (const entityId of [...record.activeEntities].sort().reverse()) this.leave(record, entityId)
  }

  private syncEntity(record: SystemRecord<TComponents, TContext>, entityId: string): void {
    if (
      !this.runtimeActive || !record.active || !record.enabled
      || this.systems.get(record.id) !== record
    ) return
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
        if (matches && !record.activeEntities.has(id) && !record.faultedEntities.has(id)) {
          this.enter(record, id)
        } else if (!matches && record.activeEntities.has(id)) {
          this.leave(record, id)
        }
        repeat = record.pendingSync.has(id)
        if (!this.runtimeActive || !record.active || this.systems.get(record.id) !== record) break
      }
      if (record.pendingSync.has(id)) {
        record.pendingSync.delete(id)
        console.warn(`[EntitySystemRuntime] Too many reentrant component changes for entity "${id}" in system "${record.id}".`)
      }
    } finally {
      record.reconciling.delete(id)
    }
  }

  private matches(record: SystemRecord<TComponents, TContext>, entityId: string): boolean {
    const entity = this.entities.get(entityId)
    if (!entity?.enabled) return false
    if (!record.required.every(type => this.entities.hasComponent(entityId, type))) return false
    return !record.excluded.some(type => this.entities.hasComponent(entityId, type))
  }

  private enter(record: SystemRecord<TComponents, TContext>, entityId: string): void {
    record.activeEntities.add(entityId)
    try {
      record.definition.onEntityEnter?.(entityId, this.createContext(entityId))
    } catch (error) {
      this.faultEntity(record, entityId, 'enter', error)
    }
  }

  private leave(record: SystemRecord<TComponents, TContext>, entityId: string): void {
    if (!record.activeEntities.delete(entityId)) return
    try {
      record.definition.onEntityExit?.(entityId, this.createContext(entityId))
    } catch (error) {
      record.faultedEntities.add(entityId)
      console.error(`[EntitySystemRuntime] System "${record.id}" failed during exit for "${entityId}".`, error)
    }
  }

  private faultEntity(
    record: SystemRecord<TComponents, TContext>,
    entityId: string,
    phase: string,
    error: unknown,
  ): void {
    record.faultedEntities.add(entityId)
    console.error(`[EntitySystemRuntime] System "${record.id}" failed during ${phase} for "${entityId}".`, error)
    this.leave(record, entityId)
  }

  private uniqueComponents(components: readonly EntityComponentKey<TComponents>[]): EntityComponentKey<TComponents>[] {
    return [...new Set(components.map(component => {
      const key = component.trim()
      if (!key) throw new Error('Entity system component filters cannot contain empty identifiers.')
      return key as EntityComponentKey<TComponents>
    }))]
  }

  private orderedSystems(): SystemRecord<TComponents, TContext>[] {
    return [...this.systems.values()].sort(
      (a, b) => this.priority(a) - this.priority(b) || a.id.localeCompare(b.id),
    )
  }

  private priority(record: SystemRecord<TComponents, TContext>): number {
    return Number.isFinite(record.definition.priority) ? record.definition.priority! : 0
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Entity system runtime has been disposed.')
  }
}
