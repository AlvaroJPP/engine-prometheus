/** Primitive values accepted by the generic UI-to-game-variable binding. */
export type UIValueBindingValue = string | number | boolean

export type UIValueBindingVariables = Readonly<Record<string, UIValueBindingValue>>

const UI_VALUE_BINDING_PATTERN = /\{\{\s*([A-Za-z0-9_.:-]{1,80})\s*\}\}/g

/**
 * Resolves {{variableName}} markers against the current global variable snapshot.
 * Unknown variables intentionally keep their marker in the text to make misspellings visible.
 */
export function resolveUIValueBindings(
  template: string,
  variables: UIValueBindingVariables,
): string {
  return template.replace(UI_VALUE_BINDING_PATTERN, (marker, variableName: string) => {
    const value = variables[variableName]
    if (!Object.prototype.hasOwnProperty.call(variables, variableName)) return marker
    return String(value)
  })
}

/**
 * Tests an optional visibility rule against the current global variable snapshot.
 * A blank variable leaves the UI visible; an unknown variable hides conditioned UI.
 */
export function isUIVisibilityConditionMet(
  variableName: string | undefined,
  expectedValue: string | undefined,
  variables: UIValueBindingVariables,
): boolean {
  const name = (variableName ?? '').trim()
  if (!name) return true
  const value = variables[name]
  if (!Object.prototype.hasOwnProperty.call(variables, name)) return false
  return String(value) === (expectedValue ?? 'true')
}

/**
 * Produces the next boolean value for a UI toggle.
 * Only the boolean `true` state toggles to false; absent or other values initialize to true.
 */
export function nextUIToggleValue(currentValue: UIValueBindingValue | undefined): boolean {
  return currentValue !== true
}

/**
 * Applies a finite numeric delta to a global variable value.
 * Undefined or non-numeric values start from zero; non-finite results keep the current finite value.
 */
export function adjustUINumericValue(
  currentValue: UIValueBindingValue | undefined,
  amount: number,
  minimum = -1_000_000,
  maximum = 1_000_000,
): number {
  const current = typeof currentValue === 'number' && Number.isFinite(currentValue) ? currentValue : 0
  const delta = Number.isFinite(amount) ? amount : 1
  const result = current + delta
  if (!Number.isFinite(result)) return current
  const lower = Number.isFinite(minimum) ? minimum : -1_000_000
  const upper = Number.isFinite(maximum) ? maximum : 1_000_000
  const low = Math.min(lower, upper)
  const high = Math.max(lower, upper)
  return Math.min(high, Math.max(low, result))
}
