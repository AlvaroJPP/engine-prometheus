export type ObjectiveState = 'locked' | 'active' | 'completed' | 'failed'
export interface ObjectiveDefinition {
  readonly id: string
  readonly title?: string
  readonly prerequisites?: readonly string[]
  readonly requiredProgress?: number
  readonly metadata?: Readonly<Record<string, string | number | boolean>>
}
export interface ObjectiveSnapshot {
  readonly id: string
  readonly title: string
  readonly state: ObjectiveState
  readonly progress: number
  readonly requiredProgress: number
  readonly prerequisites: readonly string[]
  readonly metadata: Readonly<Record<string, string | number | boolean>>
}
export interface ObjectiveEvent {
  readonly type: 'registered' | 'activated' | 'progress' | 'completed' | 'failed' | 'reset'
  readonly objective: ObjectiveSnapshot
  readonly previousState?: ObjectiveState
}
interface MutableObjective {
  id: string
  title: string
  state: ObjectiveState
  progress: number
  requiredProgress: number
  prerequisites: string[]
  metadata: Record<string, string | number | boolean>
}

/** Generic objective graph with prerequisite unlocking, progress, and lifecycle events. */
export class ObjectiveTracker {
  private readonly objectives = new Map<string, MutableObjective>()
  private readonly listeners = new Set<(event: ObjectiveEvent) => void>()

  register(definition: ObjectiveDefinition): ObjectiveSnapshot {
    const id = definition.id.trim()
    if (!id) throw new Error('Objective id must not be empty.')
    if (this.objectives.has(id)) throw new Error(`Objective already registered: "${id}".`)
    const prerequisites = [...new Set((definition.prerequisites ?? []).map(value => value.trim()))]
    if (prerequisites.some(value => !value) || prerequisites.includes(id)) {
      throw new Error(`Objective "${id}" has invalid prerequisites.`)
    }
    const requiredProgress = definition.requiredProgress ?? 1
    if (!Number.isFinite(requiredProgress) || requiredProgress <= 0) {
      throw new Error(`Objective "${id}" requiredProgress must be positive.`)
    }
    const metadata = { ...(definition.metadata ?? {}) }
    if (Object.values(metadata).some(value =>
      typeof value === 'number' ? !Number.isFinite(value) : !['string', 'boolean'].includes(typeof value),
    )) throw new Error(`Objective "${id}" metadata must use finite scalar values.`)

    const objective: MutableObjective = {
      id,
      title: definition.title?.trim() || id,
      state: prerequisites.length === 0 ? 'active' : 'locked',
      progress: 0,
      requiredProgress,
      prerequisites,
      metadata,
    }
    this.objectives.set(id, objective)
    this.emit('registered', objective)
    if (objective.state === 'active') this.emit('activated', objective)
    return this.snapshotOf(objective)
  }

  validateGraph(): void {
    for (const objective of this.objectives.values()) {
      for (const prerequisite of objective.prerequisites) {
        if (!this.objectives.has(prerequisite)) {
          throw new Error(`Objective "${objective.id}" references missing prerequisite "${prerequisite}".`)
        }
      }
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`Objective prerequisite cycle detected at "${id}".`)
      if (visited.has(id)) return
      visiting.add(id)
      for (const prerequisite of this.objectives.get(id)!.prerequisites) visit(prerequisite)
      visiting.delete(id)
      visited.add(id)
    }
    for (const id of this.objectives.keys()) visit(id)
  }

  activate(id: string): boolean {
    const objective = this.objectives.get(id.trim())
    if (!objective || objective.state !== 'locked' || !this.prerequisitesComplete(objective)) return false
    const previousState = objective.state
    objective.state = 'active'
    this.emit('activated', objective, previousState)
    return true
  }

  addProgress(id: string, amount: number): boolean {
    const objective = this.objectives.get(id.trim())
    if (!objective || objective.state !== 'active' || !Number.isFinite(amount) || amount <= 0) return false
    const previousState = objective.state
    objective.progress = Math.min(objective.requiredProgress, objective.progress + amount)
    this.emit('progress', objective, previousState)
    if (objective.progress >= objective.requiredProgress) this.complete(objective.id)
    return true
  }

  complete(id: string): boolean {
    const objective = this.objectives.get(id.trim())
    if (!objective || objective.state !== 'active') return false
    const previousState = objective.state
    objective.progress = objective.requiredProgress
    objective.state = 'completed'
    this.emit('completed', objective, previousState)
    this.unlockReady()
    return true
  }

  fail(id: string): boolean {
    const objective = this.objectives.get(id.trim())
    if (!objective || objective.state !== 'active') return false
    const previousState = objective.state
    objective.state = 'failed'
    this.emit('failed', objective, previousState)
    return true
  }

  reset(): void {
    for (const objective of this.objectives.values()) {
      const previousState = objective.state
      objective.state = objective.prerequisites.length === 0 ? 'active' : 'locked'
      objective.progress = 0
      this.emit('reset', objective, previousState)
    }
  }

  remove(id: string): boolean {
    const key = id.trim()
    const objective = this.objectives.get(key)
    if (!objective) return false
    if ([...this.objectives.values()].some(candidate => candidate.prerequisites.includes(key))) return false
    this.objectives.delete(key)
    return true
  }

  get(id: string): ObjectiveSnapshot | undefined {
    const objective = this.objectives.get(id.trim())
    return objective ? this.snapshotOf(objective) : undefined
  }

  getState(id: string): ObjectiveState | undefined { return this.objectives.get(id.trim())?.state }
  isCompleted(id: string): boolean { return this.getState(id) === 'completed' }
  list(): ObjectiveSnapshot[] { return [...this.objectives.values()].map(objective => this.snapshotOf(objective)) }

  subscribe(listener: (event: ObjectiveEvent) => void): () => void {
    this.listeners.add(listener)
    let active = true
    return () => { if (active) { active = false; this.listeners.delete(listener) } }
  }

  clear(): void { this.objectives.clear(); this.listeners.clear() }
  get size(): number { return this.objectives.size }

  private unlockReady(): void {
    for (const objective of this.objectives.values()) {
      if (objective.state === 'locked' && this.prerequisitesComplete(objective)) {
        const previousState = objective.state
        objective.state = 'active'
        this.emit('activated', objective, previousState)
      }
    }
  }

  private prerequisitesComplete(objective: MutableObjective): boolean {
    return objective.prerequisites.length > 0
      && objective.prerequisites.every(id => this.objectives.get(id)?.state === 'completed')
  }

  private snapshotOf(objective: MutableObjective): ObjectiveSnapshot {
    return {
      id: objective.id, title: objective.title, state: objective.state,
      progress: objective.progress, requiredProgress: objective.requiredProgress,
      prerequisites: [...objective.prerequisites], metadata: { ...objective.metadata },
    }
  }

  private emit(type: ObjectiveEvent['type'], objective: MutableObjective, previousState?: ObjectiveState): void {
    const event: ObjectiveEvent = {
      type,
      objective: this.snapshotOf(objective),
      ...(previousState === undefined ? {} : { previousState }),
    }
    for (const listener of [...this.listeners]) listener(event)
  }
}
