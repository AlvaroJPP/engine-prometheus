/** Maps browser mouse button indices to the engine's input binding codes. */
export function mouseButtonBindingCode(button: number): string | null {
  const codes: Record<number, string> = {
    0: 'MouseLeft',
    1: 'MouseMiddle',
    2: 'MouseRight',
    3: 'MouseBack',
    4: 'MouseForward',
  }
  return codes[button] ?? null
}

/** Routes mouse bindings through the same keyboard path as Visual Script and control maps. */
export function dispatchMouseBinding(code: string, type: 'keydown' | 'keyup'): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }))
}

/** Prevents game input from intercepting UI controls and explicitly protected HUD regions. */
export function isInteractiveRuntimeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(
    'button, input, select, textarea, a, [role="dialog"], [data-no-game-attack], .hud-settings-panel, .hud-custom-image',
  )
}
