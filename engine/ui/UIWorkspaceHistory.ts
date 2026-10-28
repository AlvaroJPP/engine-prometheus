import type { UIScreenDefinition } from './UIScreenDocument'

export interface UIWorkspaceSnapshot {
  screens: UIScreenDefinition[]
  activeScreenId: string
}

function serializeSnapshot(snapshot: UIWorkspaceSnapshot): string {
  return JSON.stringify(snapshot)
}

function cloneSnapshot(snapshot: UIWorkspaceSnapshot): UIWorkspaceSnapshot {
  return JSON.parse(serializeSnapshot(snapshot)) as UIWorkspaceSnapshot
}

/** Bounded undo/redo history for serializable visual UI workspace documents. */
export class UIWorkspaceHistory {
  private entries: UIWorkspaceSnapshot[] = []
  private entrySizes: number[] = []
  private cursor = -1
  private retainedCharacters = 0
  private readonly characterBudget = 24 * 1024 * 1024

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
    const serialized = serializeSnapshot(snapshot)
    this.entries = [JSON.parse(serialized) as UIWorkspaceSnapshot]
    this.entrySizes = [serialized.length]
    this.retainedCharacters = serialized.length
    this.cursor = 0
  }

  record(snapshot: UIWorkspaceSnapshot): boolean {
    const serialized = serializeSnapshot(snapshot)
    const current = this.entries[this.cursor]
    if (current && serializeSnapshot(current) === serialized) return false

    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1)
      this.entrySizes.splice(this.cursor + 1)
      this.retainedCharacters = this.entrySizes.reduce((total, size) => total + size, 0)
    }

    const next = JSON.parse(serialized) as UIWorkspaceSnapshot
    this.entries.push(next)
    this.entrySizes.push(serialized.length)
    this.retainedCharacters += serialized.length
    while (this.entries.length > 1 && (
      this.entries.length > this.limit || this.retainedCharacters > this.characterBudget
    )) {
      this.entries.shift()
      this.retainedCharacters -= this.entrySizes.shift() ?? 0
    }
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
