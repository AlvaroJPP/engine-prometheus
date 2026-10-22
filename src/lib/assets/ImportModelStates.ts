import type { PackageJsonValue, PackageScalar } from '@engine'

export type ImportModelStateDraft = {
  id: string
  nodePath: string
  variable: string
  operator: 'equals' | 'not_equals'
  value: PackageScalar
  visibleWhenMatched: boolean
}

/**
 * Converts persisted package JSON into validated visual states.
 * Invalid records are ignored so older or hand-edited package data stays safe.
 */
export function parseImportModelStates(raw: PackageJsonValue): ImportModelStateDraft[] {
  if (!Array.isArray(raw)) return []

  const states: ImportModelStateDraft[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, PackageJsonValue>
    const value = record.value
    if (typeof record.id !== 'string' || typeof record.nodePath !== 'string' || !record.nodePath
      || typeof record.variable !== 'string' || !record.variable
      || (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string')) continue

    states.push({
      id: record.id,
      nodePath: record.nodePath,
      variable: record.variable,
      operator: record.operator === 'not_equals' ? 'not_equals' : 'equals',
      value,
      visibleWhenMatched: record.visibleWhenMatched !== false,
    })
  }
  return states
}

/** Converts editor states into the JSON-compatible representation stored in a package. */
export function serializeImportModelStates(states: ImportModelStateDraft[]): PackageJsonValue {
  return states.map(state => ({
    id: state.id,
    nodePath: state.nodePath,
    variable: state.variable,
    operator: state.operator,
    value: state.value,
    visibleWhenMatched: state.visibleWhenMatched,
  })) as unknown as PackageJsonValue
}

/** Parses boolean and numeric text while preserving all other input as a string. */
export function parseImportModelStateValue(raw: string): PackageScalar {
  const trimmed = raw.trim()
  return trimmed === 'true' ? true
    : trimmed === 'false' ? false
      : trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw
}

/** Creates a default state for a model part and a package variable. */
export function createImportModelStateDraft(
  nodePath: string,
  variable: { name: string; defaultValue: PackageScalar },
): ImportModelStateDraft {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'mount-state-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
    nodePath,
    variable: variable.name,
    operator: 'equals',
    value: variable.name === 'mounted' ? true : variable.defaultValue,
    visibleWhenMatched: true,
  }
}
