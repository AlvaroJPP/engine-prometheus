/** Pure helpers for generic UI navigation history. */

export const UI_SCREEN_HISTORY_LIMIT = 100

/** Adds a visited screen while keeping history bounded and avoiding adjacent duplicates. */
export function appendUIScreenHistory(
  history: readonly string[],
  screenId: string,
  limit = UI_SCREEN_HISTORY_LIMIT,
): string[] {
  const id = screenId.trim()
  if (!id) return history.slice(-Math.max(0, limit))
  const next = history[history.length - 1] === id ? [...history] : [...history, id]
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : UI_SCREEN_HISTORY_LIMIT
  return safeLimit === 0 ? [] : next.slice(-safeLimit)
}

/** Pops entries until an available previous screen is found, returning the remaining history. */
export function takePreviousUIScreen(
  history: readonly string[],
  isAvailable: (screenId: string) => boolean,
): { history: string[]; screenId: string } {
  const remaining = [...history]
  while (remaining.length) {
    const screenId = remaining.pop() ?? ''
    if (screenId && isAvailable(screenId)) return { history: remaining, screenId }
  }
  return { history: remaining, screenId: '' }
}
