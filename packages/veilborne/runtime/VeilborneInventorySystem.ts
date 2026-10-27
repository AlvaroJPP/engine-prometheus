import { InventoryRuntime } from '../../../engine/script/InventoryRuntime'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import { VEILBORNE_RUNTIME_ITEMS } from './VeilborneCombat'

export interface VeilborneInventoryItem {
  id: string
  quantity: number
}

/** Catálogo/avisos do jogo sobre o armazenamento genérico da engine. */
export class VeilborneInventorySystem {
  private readonly inventory: InventoryRuntime
  private readonly showNotice: (message: string, durationSeconds: number) => void

  constructor(
    logic: RuleEngine,
    showNotice: (message: string, durationSeconds: number) => void,
  ) {
    this.showNotice = showNotice
    this.inventory = new InventoryRuntime({
      readSerialized: () => logic.getVariable('inventario_json'),
      writeSerialized: value => logic.setVariable('inventario_json', value),
      isKnownItem: itemId => Object.prototype.hasOwnProperty.call(VEILBORNE_RUNTIME_ITEMS, itemId),
      maxStack: 999,
      maxGrantPerCall: 99,
    })
  }

  read(): VeilborneInventoryItem[] {
    return this.inventory.read()
  }

  write(items: VeilborneInventoryItem[]): void {
    this.inventory.write(items)
  }

  grant(itemId: string, quantity: number): boolean {
    const definition = VEILBORNE_RUNTIME_ITEMS[itemId]
    if (!definition || !this.inventory.grant(itemId, quantity)) return false
    const amount = Math.max(1, Math.min(99, Math.floor(Number.isFinite(quantity) ? quantity : 1)))
    this.showNotice(`Obtido: ${definition.name} ×${amount}`, 2.4)
    return true
  }
}
