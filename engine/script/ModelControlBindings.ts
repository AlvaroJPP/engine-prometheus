import { DEFAULT_MODEL_CONTROL_BINDINGS } from './packages'
import type { ModelControlBindings } from './packages'

/** Resolves persisted imported-model bindings while rejecting malformed key names. */
export function resolveModelControlBindings(rawBindings: unknown): ModelControlBindings {
  const candidate = rawBindings && typeof rawBindings === 'object'
    ? rawBindings as Partial<ModelControlBindings>
    : {}
  const readKey = (key: keyof ModelControlBindings): string => {
    const value = candidate[key]
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(value)
      ? value
      : DEFAULT_MODEL_CONTROL_BINDINGS[key]
  }
  return {
    forward: readKey('forward'),
    backward: readKey('backward'),
    left: readKey('left'),
    right: readKey('right'),
    run: readKey('run'),
    jump: readKey('jump'),
    interact: readKey('interact'),
  }
}
