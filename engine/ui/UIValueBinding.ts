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
    if (!Object.prototype.hasOwnProperty.call(variables, variableName)) return marker
    return String(variables[variableName])
  })
}
