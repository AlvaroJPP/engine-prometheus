export interface RuntimePhaseDefinition {
  readonly id: string
  readonly order: number
}

export interface RuntimeTaskDefinition<TContext> {
  readonly id: string
  readonly phaseId: string
  readonly priority?: number
  readonly enabled?: boolean
  readonly execute: (deltaSeconds: number, context: TContext) => void
}

export interface RuntimePhaseSnapshot {
  readonly id: string
  readonly order: number
  readonly taskCount: number
}

export interface RuntimeTaskSnapshot {
  readonly id: string
  readonly phaseId: string
  readonly priority: number
  readonly enabled: boolean
  readonly faulted: boolean
}

export interface RuntimeTaskFailure {
  readonly taskId: string
  readonly phaseId: string
  readonly error: unknown
}

export interface RuntimePhaseResult {
  readonly phaseId: string
  readonly candidateTaskCount: number
  readonly executedTaskCount: number
  readonly skippedTaskCount: number
  readonly failures: readonly RuntimeTaskFailure[]
}

export interface RuntimePipelineReport {
  readonly phaseCount: number
  readonly candidateTaskCount: number
  readonly executedTaskCount: number
  readonly skippedTaskCount: number
  readonly failures: readonly RuntimeTaskFailure[]
  readonly phases: readonly RuntimePhaseResult[]
}

interface TaskRecord<TContext> {
  readonly id: string
  readonly phaseId: string
  readonly priority: number
  readonly definition: RuntimeTaskDefinition<TContext>
  enabled: boolean
  faulted: boolean
}

/** Deterministic, game-agnostic execution phases with per-task fault isolation. */
export class RuntimePhasePipeline<TContext> {
  private readonly phases = new Map<string, RuntimePhaseDefinition>()
  private readonly tasks = new Map<string, TaskRecord<TContext>>()
  private running = false
  private disposed = false

  definePhase(definition: RuntimePhaseDefinition): void {
    this.assertAvailable()
    const id = this.normalizeId(definition.id, 'phase')
    if (!Number.isFinite(definition.order)) throw new Error('Runtime phase order must be finite.')
    if (this.phases.has(id)) throw new Error(`Runtime phase already exists: "${id}".`)
    this.phases.set(id, { id, order: definition.order })
  }

  registerTask(definition: RuntimeTaskDefinition<TContext>): () => void {
    this.assertAvailable()
    const id = this.normalizeId(definition.id, 'task')
    const phaseId = this.normalizeId(definition.phaseId, 'phase')
    if (!this.phases.has(phaseId)) throw new Error(`Unknown runtime phase: "${phaseId}".`)
    if (this.tasks.has(id)) throw new Error(`Runtime task already registered: "${id}".`)
    if (typeof definition.execute !== 'function') throw new Error('Runtime tasks require an execute callback.')

    const record: TaskRecord<TContext> = {
      id,
      phaseId,
      priority: Number.isFinite(definition.priority) ? definition.priority! : 0,
      definition,
      enabled: definition.enabled !== false,
      faulted: false,
    }
    this.tasks.set(id, record)
    return () => this.unregisterTask(id, definition)
  }

  unregisterTask(taskId: string, expected?: RuntimeTaskDefinition<TContext>): boolean {
    const id = taskId.trim()
    const record = this.tasks.get(id)
    if (!record || (expected && record.definition !== expected)) return false
    this.tasks.delete(id)
    return true
  }

  setTaskEnabled(taskId: string, enabled: boolean): boolean {
    const record = this.tasks.get(taskId.trim())
    if (!record || record.enabled === enabled) return false
    record.enabled = enabled
    return true
  }

  resetTaskFault(taskId: string): boolean {
    const record = this.tasks.get(taskId.trim())
    if (!record || !record.faulted) return false
    record.faulted = false
    return true
  }

  run(deltaSeconds: number, context: TContext): RuntimePipelineReport {
    this.assertAvailable()
    if (this.running) throw new Error('Runtime phase pipeline cannot run recursively.')
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    const phases = this.orderedPhases().map(phase => ({
      phase,
      tasks: this.orderedTasks(phase.id),
    }))
    const phaseResults: RuntimePhaseResult[] = []
    const failures: RuntimeTaskFailure[] = []
    let candidateTaskCount = 0
    let executedTaskCount = 0
    let skippedTaskCount = 0

    this.running = true
    try {
      for (const snapshot of phases) {
        let phaseExecuted = 0
        let phaseSkipped = 0
        const phaseFailures: RuntimeTaskFailure[] = []
        candidateTaskCount += snapshot.tasks.length

        for (const record of snapshot.tasks) {
          if (
            this.disposed
            || this.tasks.get(record.id) !== record
            || !record.enabled
            || record.faulted
          ) {
            phaseSkipped += 1
            skippedTaskCount += 1
            continue
          }

          try {
            record.definition.execute(dt, context)
            phaseExecuted += 1
            executedTaskCount += 1
          } catch (error) {
            record.faulted = true
            const failure: RuntimeTaskFailure = {
              taskId: record.id,
              phaseId: record.phaseId,
              error,
            }
            phaseFailures.push(failure)
            failures.push(failure)
            console.error(
              `[RuntimePhasePipeline] Task "${record.id}" failed in phase "${record.phaseId}".`,
              error,
            )
          }
        }

        phaseResults.push({
          phaseId: snapshot.phase.id,
          candidateTaskCount: snapshot.tasks.length,
          executedTaskCount: phaseExecuted,
          skippedTaskCount: phaseSkipped,
          failures: phaseFailures,
        })
      }
    } finally {
      this.running = false
    }

    return {
      phaseCount: phaseResults.length,
      candidateTaskCount,
      executedTaskCount,
      skippedTaskCount,
      failures,
      phases: phaseResults,
    }
  }

  listPhases(): RuntimePhaseSnapshot[] {
    return this.orderedPhases().map(phase => ({
      id: phase.id,
      order: phase.order,
      taskCount: [...this.tasks.values()].filter(task => task.phaseId === phase.id).length,
    }))
  }

  listTasks(): RuntimeTaskSnapshot[] {
    return [...this.tasks.values()]
      .sort((a, b) => a.phaseId.localeCompare(b.phaseId) || a.priority - b.priority || a.id.localeCompare(b.id))
      .map(record => ({
        id: record.id,
        phaseId: record.phaseId,
        priority: record.priority,
        enabled: record.enabled,
        faulted: record.faulted,
      }))
  }

  clear(): void {
    this.tasks.clear()
  }

  dispose(): void {
    if (this.disposed) return
    this.clear()
    this.phases.clear()
    this.disposed = true
  }

  get phaseCount(): number { return this.phases.size }
  get taskCount(): number { return this.tasks.size }

  private orderedPhases(): RuntimePhaseDefinition[] {
    return [...this.phases.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  private orderedTasks(phaseId: string): TaskRecord<TContext>[] {
    return [...this.tasks.values()]
      .filter(record => record.phaseId === phaseId)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  }

  private normalizeId(value: string, kind: string): string {
    const id = value.trim()
    if (!id) throw new Error(`Runtime ${kind} identifiers must not be empty.`)
    return id
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Runtime phase pipeline has been disposed.')
  }
}
