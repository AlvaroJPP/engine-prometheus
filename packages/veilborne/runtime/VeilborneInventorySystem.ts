import type { RuleEngine } from '../../../engine/script/RuleEngine'
import { VEILBORNE_RUNTIME_ITEMS } from './VeilborneCombat'

export interface VeilborneInventoryItem {
  id: string
  quantity: number
}

/** Mantém o inventário serializado do VEILBORNE validado e normalizado. */
export class VeilborneInventorySystem {
  private readonly logic: RuleEngine
  private readonly showNotice: (message: string, durationSeconds: number) => void

  constructor(
    logic: RuleEngine,
    showNotice: (message: string, durationSeconds: number) => void,
  ) {
    this.logic = logic
    this.showNotice = showNotice
  }

  read(): VeilborneInventoryItem[] {
    const raw = this.logic.getVariable('inventario_json')
    if (typeof raw !== 'string' || !raw.trim()) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      const merged = new Map<string, number>()
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const record = entry as Record<string, unknown>
        if (
          typeof record.id !== 'string'
          || !Object.prototype.hasOwnProperty.call(VEILBORNE_RUNTIME_ITEMS, record.id)
        ) continue
        const quantity = typeof record.quantity === 'number' && Number.isFinite(record.quantity)
          ? Math.max(0, Math.min(999, Math.floor(record.quantity)))
          : 0
        if (quantity > 0) merged.set(record.id, Math.min(999, (merged.get(record.id) ?? 0) + quantity))
      }
      return [...merged.entries()].map(([id, quantity]) => ({ id, quantity }))
    } catch {
      return []
    }
  }

  write(items: VeilborneInventoryItem[]): void {
    const sanitized = items
      .filter(item =>
        Object.prototype.hasOwnProperty.call(VEILBORNE_RUNTIME_ITEMS, item.id)
        && Number.isFinite(item.quantity)
        && item.quantity > 0,
      )
      .map(item => ({ id: item.id, quantity: Math.min(999, Math.floor(item.quantity)) }))
    this.logic.setVariable('inventario_json', JSON.stringify(sanitized))
  }

  grant(itemId: string, quantity: number): boolean {
    if (!Object.prototype.hasOwnProperty.call(VEILBORNE_RUNTIME_ITEMS, itemId)) return false
    const amount = Math.max(1, Math.min(99, Math.floor(Number.isFinite(quantity) ? quantity : 1)))
    const items = this.read()
    const existing = items.find(item => item.id === itemId)
    if (existing) existing.quantity = Math.min(999, existing.quantity + amount)
    else items.push({ id: itemId, quantity: amount })
    this.write(items)
    const definition = VEILBORNE_RUNTIME_ITEMS[itemId]!
    this.showNotice(`Obtido: ${definition.name} ×${amount}`, 2.4)
    return true
  }
}
