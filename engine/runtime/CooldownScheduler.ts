export interface CooldownEntry {
  readonly key: string
  readonly remainingSeconds: number
}

/** Timers determinísticos por chave, sem depender de relógio global. */
export class CooldownScheduler {
  private readonly remaining = new Map<string, number>()

  start(key: string, durationSeconds: number, replace = true): boolean {
    const normalized = key.trim()
    if (!normalized || !Number.isFinite(durationSeconds) || durationSeconds < 0) return false
    if (!replace && this.remaining.has(normalized)) return false
    if (durationSeconds === 0) {
      this.remaining.delete(normalized)
      return true
    }
    this.remaining.set(normalized, durationSeconds)
    return true
  }

  update(deltaSeconds: number): void {
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    if (dt === 0) return
    for (const [key, remaining] of this.remaining) {
      const next = remaining - dt
      if (next <= 0) this.remaining.delete(key)
      else this.remaining.set(key, next)
    }
  }

  isReady(key: string): boolean { return !this.remaining.has(key.trim()) }
  getRemaining(key: string): number { return this.remaining.get(key.trim()) ?? 0 }
  cancel(key: string): boolean { return this.remaining.delete(key.trim()) }
  clear(): void { this.remaining.clear() }
  snapshot(): CooldownEntry[] {
    return [...this.remaining].map(([key, remainingSeconds]) => ({ key, remainingSeconds }))
  }
}
