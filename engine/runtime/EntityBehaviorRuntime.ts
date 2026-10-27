import { EntityComponentRuntime } from './EntityComponentRuntime.ts'

export interface EntityBehavior<TContext> {
  readonly id: string
  readonly priority?: number
  readonly enabled?: boolean
  readonly onAttach?: (context: TContext) => void
  readonly onStart?: (context: TContext) => void
  readonly update?: (deltaSeconds: number, context: TContext) => void
  readonly onStop?: (context: TContext) => void
  readonly onDetach?: (context: TContext) => void
}

export interface EntityBehaviorSnapshot {
  readonly entityId: string
  readonly id: string
  readonly enabled: boolean
  readonly active: boolean
  readonly faulted: boolean
  readonly priority: number
}

interface BehaviorRecord<TContext> {
  readonly id: string
  readonly entityId: string
  readonly behavior: EntityBehavior<TContext>
  enabled: boolean
  attached: boolean
  active: boolean
  faulted: boolean
}

/** Owns reusable behavior instances and binds their lifecycle to entity state. */
export class EntityBehaviorRuntime<TComponents extends object, TContext> {
  private readonly byEntity = new Map<string, Map<string, BehaviorRecord<TContext>>>()
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
    this.unsubscribeEntities = entities.subscribe(event => {
      if (event.type === 'entity-destroying') this.removeEntity(event.entityId)
      if (event.type === 'entity-enabled-changed') {
        if (event.enabled) this.startEntity(event.entityId)
        else this.stopEntity(event.entityId)
      }
    })
  }

  add(entityId: string, behavior: EntityBehavior<TContext>): () => void {
    this.assertAvailable()
    const owner = entityId.trim()
    const id = behavior.id.trim()
    if (!owner || !id) throw new Error('Entity behaviors require entity and behavior identifiers.')
    if (!this.entities.get(owner)) throw new Error(`Cannot attach behavior to missing entity "${owner}".`)
    const list = this.byEntity.get(owner) ?? new Map<string, BehaviorRecord<TContext>>()
    if (list.has(id)) throw new Error(`Behavior "${id}" already exists on entity "${owner}".`)
    const record: BehaviorRecord<TContext> = {
      id,
      entityId: owner,
      behavior,
      enabled: behavior.enabled !== false,
      attached: true,
      active: false,
      faulted: false,
    }
    list.set(id, record)
    this.byEntity.set(owner, list)
    if (!this.invoke(record, 'attach', () => behavior.onAttach?.(this.createContext(owner)))) {
      return () => this.remove(owner, id, behavior)
    }
    if (this.runtimeActive && this.entities.get(owner)?.enabled) this.startOne(record)
    return () => this.remove(owner, id, behavior)
  }

  remove(entityId: string, behaviorId: string, expected?: EntityBehavior<TContext>): boolean {
    const owner = entityId.trim()
    const id = behaviorId.trim()
    const list = this.byEntity.get(owner)
    const record = list?.get(id)
    if (!record || (expected && record.behavior !== expected) || !list) return false
    list.delete(id)
    if (list.size === 0) this.byEntity.delete(owner)
    this.teardown(record)
    return true
  }

  removeEntity(entityId: string): number {
    const owner = entityId.trim()
    const list = this.byEntity.get(owner)
    if (!list) return 0
    const records = [...list.values()].sort((a, b) => this.priority(b) - this.priority(a))
    this.byEntity.delete(owner)
    for (const record of records) this.teardown(record)
    return records.length
  }

  setEnabled(entityId: string, behaviorId: string, enabled: boolean): boolean {
    const record = this.byEntity.get(entityId.trim())?.get(behaviorId.trim())
    if (!record || record.enabled === enabled || record.faulted) return false
    record.enabled = enabled
    if (!enabled) this.stopOne(record)
    else if (this.runtimeActive && this.entities.get(record.entityId)?.enabled) this.startOne(record)
    return true
  }

  start(): void {
    this.assertAvailable()
    if (this.runtimeActive) return
    this.runtimeActive = true
    for (const record of this.orderedRecords()) {
      if (!this.runtimeActive || this.disposed) break
      if (this.byEntity.get(record.entityId)?.get(record.id) !== record) continue
      if (this.entities.get(record.entityId)?.enabled) this.startOne(record)
    }
  }

  stop(): void {
    if (!this.runtimeActive) return
    this.runtimeActive = false
    for (const record of this.orderedRecords().reverse()) this.stopOne(record)
  }

  update(deltaSeconds: number): void {
    if (!this.runtimeActive || this.disposed) return
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    for (const record of this.orderedRecords()) {
      if (!this.runtimeActive || this.disposed) break
      if (this.byEntity.get(record.entityId)?.get(record.id) !== record) continue
      if (!record.active || record.faulted || !record.enabled || !record.behavior.update) continue
      this.invoke(record, 'update', () => record.behavior.update!(dt, this.createContext(record.entityId)))
    }
  }

  list(entityId?: string): EntityBehaviorSnapshot[] {
    const records = entityId === undefined
      ? this.orderedRecords()
      : [...(this.byEntity.get(entityId.trim())?.values() ?? [])].sort((a, b) => this.priority(a) - this.priority(b))
    return records.map(record => ({
      entityId: record.entityId,
      id: record.id,
      enabled: record.enabled,
      active: record.active,
      faulted: record.faulted,
      priority: this.priority(record),
    }))
  }

  clear(): void {
    this.stop()
    for (const entityId of [...this.byEntity.keys()].reverse()) this.removeEntity(entityId)
  }

  dispose(): void {
    if (this.disposed) return
    this.clear()
    this.disposed = true
    this.unsubscribeEntities()
  }

  get size(): number {
    let count = 0
    for (const list of this.byEntity.values()) count += list.size
    return count
  }

  private startEntity(entityId: string): void {
    if (!this.runtimeActive || this.disposed) return
    for (const record of this.orderedRecords(entityId)) this.startOne(record)
  }

  private stopEntity(entityId: string): void {
    for (const record of this.orderedRecords(entityId).reverse()) this.stopOne(record)
  }

  private startOne(record: BehaviorRecord<TContext>): void {
    if (
      !this.runtimeActive || !record.enabled || record.active || record.faulted
      || this.byEntity.get(record.entityId)?.get(record.id) !== record
      || !this.entities.get(record.entityId)?.enabled
    ) return
    record.active = true
    this.invoke(record, 'start', () => record.behavior.onStart?.(this.createContext(record.entityId)))
  }

  private stopOne(record: BehaviorRecord<TContext>): void {
    if (!record.active) return
    record.active = false
    this.invoke(record, 'stop', () => record.behavior.onStop?.(this.createContext(record.entityId)))
  }

  private teardown(record: BehaviorRecord<TContext>): void {
    this.stopOne(record)
    if (!record.attached) return
    record.attached = false
    this.invoke(record, 'detach', () => record.behavior.onDetach?.(this.createContext(record.entityId)))
  }

  private invoke(record: BehaviorRecord<TContext>, phase: string, callback: () => void): boolean {
    try {
      callback()
      return true
    } catch (error) {
      this.fail(record, phase, error)
      return false
    }
  }

  private fail(record: BehaviorRecord<TContext>, phase: string, error: unknown): void {
    const wasActive = record.active
    record.faulted = true
    record.active = false
    console.error(`[EntityBehaviorRuntime] Behavior "${record.id}" on "${record.entityId}" failed during ${phase}.`, error)
    if (wasActive) {
      try {
        record.behavior.onStop?.(this.createContext(record.entityId))
      } catch (stopError) {
        console.error('[EntityBehaviorRuntime] Behavior failed while cleaning up after an error.', stopError)
      }
    }
  }

  private orderedRecords(entityId?: string): BehaviorRecord<TContext>[] {
    const records = entityId === undefined
      ? [...this.byEntity.values()].flatMap(list => [...list.values()])
      : [...(this.byEntity.get(entityId)?.values() ?? [])]
    return records.sort((a, b) => this.priority(a) - this.priority(b) || a.id.localeCompare(b.id))
  }

  private priority(record: BehaviorRecord<TContext>): number {
    return Number.isFinite(record.behavior.priority) ? record.behavior.priority! : 0
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Entity behavior runtime has been disposed.')
  }
}
