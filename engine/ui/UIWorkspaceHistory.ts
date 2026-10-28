import type { UIScreenDefinition } from './UIScreenDocument'

export interface UIWorkspaceSnapshot {
  screens: UIScreenDefinition[]
  activeScreenId: string
}

function cloneSnapshot(snapshot: UIWorkspaceSnapshot): UIWorkspaceSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as UIWorkspaceSnapshot
}

/** Bounded undo/redo history for serializable visual UI workspace documents. */
export class UIWorkspaceHistory {
  private entries: UIWorkspaceSnapshot[] = []
  private cursor = -1

  constructor(private readonly limit = 40) {
    if (!Number.isInteger(limit) || limit < 2) {
      throw new Error('O histórico de UI precisa manter pelo menos duas entradas.')
    }
  }

  get canUndo(): boolean {
    return this.cursor > 0
  }

  get canRedo(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1
  }

  get size(): number {
    return this.entries.length
  }

  reset(snapshot: UIWorkspaceSnapshot): void {
    this.entries = [cloneSnapshot(snapshot)]
    this.cursor = 0
  }

  record(snapshot: UIWorkspaceSnapshot): boolean {
    const next = cloneSnapshot(snapshot)
    const current = this.entries[this.cursor]
    if (current && JSON.stringify(current) === JSON.stringify(next)) return false

    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1)
    }

    this.entries.push(next)
    if (this.entries.length > this.limit) this.entries.shift()
    this.cursor = this.entries.length - 1
    return true
  }

  undo(): UIWorkspaceSnapshot | null {
    if (!this.canUndo) return null
    this.cursor -= 1
    return cloneSnapshot(this.entries[this.cursor])
  }

  redo(): UIWorkspaceSnapshot | null {
    if (!this.canRedo) return null
    this.cursor += 1
    return cloneSnapshot(this.entries[this.cursor])
  }
}
