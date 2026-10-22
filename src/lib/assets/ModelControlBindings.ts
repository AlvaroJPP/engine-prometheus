import { DEFAULT_MODEL_CONTROL_BINDINGS } from '@engine'
import type { ModelControlBindings } from '@engine'

/** Normaliza bindings persistidos de modelos importados sem aceitar valores inválidos. */
export function normalizeModelControlBindings(value: unknown): ModelControlBindings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ModelControlBindings>
    : {}
  const read = (key: keyof ModelControlBindings): string => {
    const candidate = raw[key]
    return typeof candidate === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(candidate)
      ? candidate
      : DEFAULT_MODEL_CONTROL_BINDINGS[key]
  }
  return {
    forward: read('forward'),
    backward: read('backward'),
    left: read('left'),
    right: read('right'),
    run: read('run'),
    jump: read('jump'),
    interact: read('interact'),
  }
}

/** Converte KeyboardEvent.code em rótulo legível para os controles do importador. */
export function formatModelControlKey(code: string): string {
  const names: Record<string, string> = {
    Space: 'Espaço',
    ShiftLeft: 'Shift esquerdo',
    ShiftRight: 'Shift direito',
    ControlLeft: 'Ctrl esquerdo',
    ControlRight: 'Ctrl direito',
    AltLeft: 'Alt esquerdo',
    AltRight: 'Alt direito',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    CapsLock: 'Caps Lock',
  }
  if (names[code]) return names[code]!
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6)
  return code
}
