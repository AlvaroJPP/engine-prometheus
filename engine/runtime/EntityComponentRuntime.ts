export type EntityComponentKey<TComponents extends object> = Extract<keyof TComponents, string>

export interface EntitySnapshot {
  readonly id: string
  readonly enabled: boolean
  readonly componentTypes: readonly string[]
}

export interface EntityComponentDefinition<TComponent> {
  readonly onAttach?: (entityId: string, component: TComponent) => void
  readonly onRemove?: (entityId: string, component: TComponent) => void
}

export type EntityComponentEvent<TComponents extends object> =
  | { readonly type: 'entity-created'; readonly entity: EntitySnapshot }
  | { readonly type: 'entity-destroyed'; readonly entityId: string }
  | { readonly type: 'entity-enabled-changed'; readonly entityId: string; readonly enabled: boolean }
  | { readonly type: 'component-added'; readonly entityId: string; readonly componentType: EntityComponentKey<TComponents>; readonly component: unknown }
  | { readonly type: 'component-removed'; readonly entityId: string; readonly componentType: EntityComponentKey<TComponents>; readonly component: unknown }

interface EntityRecord {
  enabled: boolean
  readonly components: Map<string, unknown>
}

/** Generic component storage with deterministic entity and component lifecycle events. */
export class EntityComponentRuntime<TComponents extends object = Record<string, unknown>> {
  private readonly entities = new Map<string, EntityRecord>()
  private readonly definitions = new Map<string, EntityComponentDefinition<unknown>>()
  private readonly listeners = new Set<(event: EntityComponentEvent<TComponents>) => void>()
  private readonly destroying = new Set<string>()

  defineComponent<K extends EntityComponentKey<TComponents>>(
    componentType: K,
    definition: EntityComponentDefinition<TComponents[K]> = {},
  ): () => void {
    const key = this.normalizeComponentType(componentType)
    if (this.definitions.has(key)) throw new Error(`Component type already defined: "${key}".`)
    this.definitions.set(key, definition as EntityComponentDefinition<unknown>)
    return () => {
      if (this.definitions.get(key) === definition) this.definitions.delete(key)
    }
  }

  create(entityId: string): EntitySnapshot {
    const id = this.normalizeEntityId(entityId)
    if (this.entities.has(id)) throw new Error(`Entity already exists: "${id}".`)
    const record: EntityRecord = { enabled: true, components: new Map() }
    this.entities.set(id, record)
    const snapshot = this.snapshot(id, record)
    this.emit({ type: 'entity-created', entity: snapshot })
    return snapshot
  }

  destroy(entityId: string): boolean {
    const id = entityId.trim()
    const record = this.entities.get(id)
    if (!record || this.destroying.has(id)) return false
    this.destroying.add(id)
    this.entities.delete(id)
    const errors: unknown[] = []

    for (const [componentType, component] of [...record.components].reverse()) {
      record.components.delete(componentType)
      try {
        this.definitions.get(componentType)?.onRemove?.(id, component)
      } catch (error) {
        errors.push(error)
      }
      try {
        this.emit({
          type: 'component-removed',
          entityId: id,
          componentType: componentType as EntityComponentKey<TComponents>,
          component,
        })
      } catch (error) {
        errors.push(error)
      }
    }

    this.destroying.delete(id)
    try {
      this.emit({ type: 'entity-destroyed', entityId: id })
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) throw errors[0]
    return true
  }

  addComponent<K extends EntityComponentKey<TComponents>>(
    entityId: string,
    componentType: K,
    component: TComponents[K],
  ): boolean {
    const id = entityId.trim()
    const key = this.normalizeComponentType(componentType)
    const record = this.entities.get(id)
    if (!record || this.destroying.has(id) || record.components.has(key)) return false
    this.definitions.get(key)?.onAttach?.(id, component)
    record.components.set(key, component)
    this.emit({
      type: 'component-added',
      entityId: id,
      componentType,
      component,
    })
    return true
  }

  removeComponent<K extends EntityComponentKey<TComponents>>(
    entityId: string,
    componentType: K,
  ): boolean {
    const id = entityId.trim()
    const key = this.normalizeComponentType(componentType)
    const record = this.entities.get(id)
    if (!record || this.destroying.has(id) || !record.components.has(key)) return false
    const component = record.components.get(key) as TComponents[K]
    record.components.delete(key)
    let failure: unknown
    try {
      this.definitions.get(key)?.onRemove?.(id, component)
    } catch (error) {
      failure = error
    }
    try {
      this.emit({ type: 'component-removed', entityId: id, componentType, component })
    } catch (error) {
      failure ??= error
    }
    if (failure !== undefined) throw failure
    return true
  }

  getComponent<K extends EntityComponentKey<TComponents>>(
    entityId: string,
    componentType: K,
  ): TComponents[K] | undefined {
    return this.entities.get(entityId.trim())?.components.get(componentType) as TComponents[K] | undefined
  }

  hasComponent<K extends EntityComponentKey<TComponents>>(entityId: string, componentType: K): boolean {
    return this.entities.get(entityId.trim())?.components.has(componentType) ?? false
  }

  setEnabled(entityId: string, enabled: boolean): boolean {
    const id = entityId.trim()
    const record = this.entities.get(id)
    if (!record || record.enabled === enabled || this.destroying.has(id)) return false
    record.enabled = enabled
    this.emit({ type: 'entity-enabled-changed', entityId: id, enabled })
    return true
  }

  get(entityId: string): EntitySnapshot | undefined {
    const id = entityId.trim()
    const record = this.entities.get(id)
    return record ? this.snapshot(id, record) : undefined
  }

  query(
    componentTypes: readonly EntityComponentKey<TComponents>[] = [],
    options: { readonly includeDisabled?: boolean } = {},
  ): string[] {
    const required = componentTypes.map(type => this.normalizeComponentType(type))
    return [...this.entities].filter(([, record]) =>
      (options.includeDisabled === true || record.enabled)
      && required.every(type => record.components.has(type)),
    ).map(([id]) => id)
  }

  subscribe(listener: (event: EntityComponentEvent<TComponents>) => void): () => void {
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    const errors: unknown[] = []
    for (const id of [...this.entities.keys()].reverse()) {
      try {
        this.destroy(id)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw errors[0]
  }

  /** Clears entity instances while keeping component definitions and subscriptions reusable. */
  dispose(): void {
    const errors: unknown[] = []
    try { this.clear() } catch (error) { errors.push(error) }
    this.definitions.clear()
    this.listeners.clear()
    if (errors.length > 0) throw errors[0]
  }

  get size(): number { return this.entities.size }

  private snapshot(entityId: string, record: EntityRecord): EntitySnapshot {
    return {
      id: entityId,
      enabled: record.enabled,
      componentTypes: [...record.components.keys()],
    }
  }

  private normalizeEntityId(entityId: string): string {
    const id = entityId.trim()
    if (!id) throw new Error('Entity identifier must not be empty.')
    return id
  }

  private normalizeComponentType(componentType: string): string {
    const key = componentType.trim()
    if (!key) throw new Error('Component type must not be empty.')
    return key
  }

  private emit(event: EntityComponentEvent<TComponents>): void {
    const errors: unknown[] = []
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw errors[0]
  }
}
