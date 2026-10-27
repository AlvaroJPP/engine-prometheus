export interface InventoryStack {
  id: string
  quantity: number
}

export interface InventoryRuntimeOptions {
  readSerialized(): unknown
  writeSerialized(value: string): void
  /** Optional item catalog guard; the engine itself does not assume any game's item IDs. */
  isKnownItem?(id: string): boolean
  maxStack?: number
  maxGrantPerCall?: number
}

/** Generic JSON-backed inventory with safe parsing, stack merging, grant and consume. */
export class InventoryRuntime {
  private readonly options: InventoryRuntimeOptions
  private readonly maxStack: number
  private readonly maxGrantPerCall: number

  constructor(options: InventoryRuntimeOptions) {
    this.options = options
    this.maxStack = this.readLimit(options.maxStack, 999)
    this.maxGrantPerCall = this.readLimit(options.maxGrantPerCall, 99)
  }

  read(): InventoryStack[] {
    const raw = this.options.readSerialized()
    if (typeof raw !== 'string' || !raw.trim()) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      const merged = new Map<string, number>()
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const record = entry as Record<string, unknown>
        if (typeof record.id !== 'string' || !record.id.trim() || !this.isKnown(record.id)) continue
        const quantity = typeof record.quantity === 'number' && Number.isFinite(record.quantity)
          ? Math.max(0, Math.min(this.maxStack, Math.floor(record.quantity)))
          : 0
        if (quantity > 0) {
          merged.set(record.id, Math.min(this.maxStack, (merged.get(record.id) ?? 0) + quantity))
        }
      }
      return [...merged.entries()].map(([id, quantity]) => ({ id, quantity }))
    } catch {
      return []
    }
  }

  write(items: readonly InventoryStack[]): void {
    const merged = new Map<string, number>()
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || !this.isKnown(item.id)) continue
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue
      const quantity = Math.min(this.maxStack, Math.floor(item.quantity))
      if (quantity > 0) merged.set(item.id, Math.min(this.maxStack, (merged.get(item.id) ?? 0) + quantity))
    }
    this.options.writeSerialized(JSON.stringify(
      [...merged.entries()].map(([id, quantity]) => ({ id, quantity })),
    ))
  }

  grant(itemId: string, quantity = 1): boolean {
    if (
      typeof itemId !== 'string'
      || !itemId.trim()
      || !this.isKnown(itemId)
      || !Number.isFinite(quantity)
      || quantity <= 0
    ) return false

    const amount = Math.min(this.maxGrantPerCall, Math.floor(quantity))
    if (amount < 1) return false
    const items = this.read()
    const current = items.find(item => item.id === itemId)
    if (current) {
      if (current.quantity >= this.maxStack) return false
      current.quantity = Math.min(this.maxStack, current.quantity + amount)
    } else {
      items.push({ id: itemId, quantity: Math.min(this.maxStack, amount) })
    }
    this.write(items)
    return true
  }

  consume(itemId: string, quantity = 1): boolean {
    if (
      typeof itemId !== 'string'
      || !itemId.trim()
      || !Number.isFinite(quantity)
      || quantity <= 0
    ) return false

    const amount = Math.floor(quantity)
    if (amount < 1) return false
    const items = this.read()
    const current = items.find(item => item.id === itemId)
    if (!current || current.quantity < amount) return false
    current.quantity -= amount
    this.write(items.filter(item => item.quantity > 0))
    return true
  }

  quantity(itemId: string): number {
    return this.read().find(item => item.id === itemId)?.quantity ?? 0
  }

  private isKnown(id: string): boolean {
    return this.options.isKnownItem?.(id) ?? true
  }

  private readLimit(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1
      ? Math.max(1, Math.floor(value))
      : fallback
  }
}
