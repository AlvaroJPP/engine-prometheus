export type ResourceChangeReason = 'spend' | 'drain' | 'restore' | 'set' | 'maximum' | 'reset'
export interface ResourcePoolSnapshot {
  readonly current: number
  readonly minimum: number
  readonly maximum: number
  readonly ratio: number
  readonly depleted: boolean
  readonly full: boolean
}
export interface ResourceChange extends ResourcePoolSnapshot {
  readonly previous: number
  readonly reason: ResourceChangeReason
}

/** Numeric resource primitive for health, stamina, mana, durability, charges, and similar values. */
export class ResourcePool {
  private value: number
  private ceiling: number
  private readonly floor: number
  private readonly listeners = new Set<(change: ResourceChange) => void>()

  constructor(options: { current: number; maximum: number; minimum?: number }) {
    const minimum = options.minimum ?? 0
    if (![options.current, options.maximum, minimum].every(Number.isFinite) || options.maximum < minimum) {
      throw new Error('ResourcePool expects finite values and maximum >= minimum.')
    }
    this.floor = minimum
    this.ceiling = options.maximum
    this.value = this.clamp(options.current)
  }

  get current(): number { return this.value }
  get maximum(): number { return this.ceiling }
  get minimum(): number { return this.floor }
  get ratio(): number { return this.ceiling === this.floor ? 0 : (this.value - this.floor) / (this.ceiling - this.floor) }
  get depleted(): boolean { return this.value <= this.floor }
  get full(): boolean { return this.value >= this.ceiling }

  snapshot(): ResourcePoolSnapshot {
    return { current: this.value, minimum: this.floor, maximum: this.ceiling, ratio: this.ratio, depleted: this.depleted, full: this.full }
  }

  canSpend(amount: number): boolean {
    return Number.isFinite(amount) && amount >= 0 && this.value - amount >= this.floor
  }

  /** All-or-nothing cost; returns false if the amount is invalid or unaffordable. */
  spend(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0 || !this.canSpend(amount)) return false
    this.change(this.value - amount, 'spend')
    return true
  }

  /** Removes up to amount and returns the quantity actually removed. */
  drain(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0
    const previous = this.value
    this.change(this.value - amount, 'drain')
    return previous - this.value
  }

  /** Adds up to amount and returns the quantity actually restored. */
  restore(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0
    const previous = this.value
    this.change(this.value + amount, 'restore')
    return this.value - previous
  }

  setCurrent(value: number): boolean {
    if (!Number.isFinite(value)) return false
    this.change(value, 'set')
    return true
  }

  setMaximum(maximum: number, preserveRatio = false): boolean {
    if (!Number.isFinite(maximum) || maximum < this.floor) return false
    const oldRatio = this.ratio
    const previous = this.value
    this.ceiling = maximum
    this.value = this.clamp(preserveRatio ? this.floor + oldRatio * (maximum - this.floor) : this.value)
    if (previous !== this.value) this.notify(previous, 'maximum')
    return true
  }

  reset(value = this.ceiling): boolean {
    if (!Number.isFinite(value)) return false
    this.change(value, 'reset')
    return true
  }

  subscribe(listener: (change: ResourceChange) => void): () => void {
    this.listeners.add(listener)
    let active = true
    return () => { if (active) { active = false; this.listeners.delete(listener) } }
  }

  private clamp(value: number): number { return Math.max(this.floor, Math.min(this.ceiling, value)) }
  private change(value: number, reason: ResourceChangeReason): void {
    const next = this.clamp(value)
    if (next === this.value) return
    const previous = this.value
    this.value = next
    this.notify(previous, reason)
  }
  private notify(previous: number, reason: ResourceChangeReason): void {
    const change: ResourceChange = { ...this.snapshot(), previous, reason }
    for (const listener of [...this.listeners]) listener(change)
  }
}
