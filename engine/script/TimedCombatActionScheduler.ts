export interface TimedCombatAction<TPayload> {
  remainingSeconds: number
  payload: TPayload
}

/**
 * Generic scheduler for combat cooldowns and delayed actions such as projectiles.
 * It owns no world, animation or damage rules; callers decide what a due action does.
 */
export class TimedCombatActionScheduler<TPayload> {
  private readonly cooldowns = new Map<string, number>()
  private pending: TimedCombatAction<TPayload>[] = []

  canExecute(actionId: string): boolean {
    return (this.cooldowns.get(actionId) ?? 0) <= 0
  }

  startCooldown(actionId: string, durationSeconds: number): void {
    if (!actionId.trim()) return
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0
    if (duration <= 0) this.cooldowns.delete(actionId)
    else this.cooldowns.set(actionId, duration)
  }

  schedule(payload: TPayload, delaySeconds: number): void {
    const delay = Number.isFinite(delaySeconds) ? Math.max(0, delaySeconds) : 0
    this.pending.push({ remainingSeconds: delay, payload })
  }

  /** Advances timers safely and returns delayed actions that have become due. */
  update(deltaSeconds: number): TPayload[] {
    const step = Math.max(0, Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.1))
    for (const [id, remaining] of this.cooldowns) {
      const next = Math.max(0, remaining - step)
      if (next <= 0) this.cooldowns.delete(id)
      else this.cooldowns.set(id, next)
    }

    const due: TPayload[] = []
    const waiting: TimedCombatAction<TPayload>[] = []
    for (const action of this.pending) {
      action.remainingSeconds -= step
      if (action.remainingSeconds <= 0) due.push(action.payload)
      else waiting.push(action)
    }
    this.pending = waiting
    return due
  }

  clear(): void {
    this.cooldowns.clear()
    this.pending = []
  }

  get pendingCount(): number {
    return this.pending.length
  }
}
