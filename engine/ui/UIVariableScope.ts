export type UIVariableScope = 'global' | 'player'

export interface UIVariableReference {
  scope: UIVariableScope
  name: string
}

/**
 * Resolves a UI variable reference without conflating similarly named scopes.
 * The reserved `player.` prefix addresses a variable owned by the controlled player;
 * all other names resolve to the project's global variable store.
 */
export function resolveUIVariableReference(rawName: string): UIVariableReference | null {
  const reference = rawName.trim()
  if (!reference) return null

  if (reference.startsWith('player.')) {
    const name = reference.slice('player.'.length).trim()
    return name ? { scope: 'player', name } : null
  }

  return { scope: 'global', name: reference }
}
