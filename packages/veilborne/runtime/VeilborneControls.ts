export interface VeilborneGameModuleControls {
  /** Tecla mantida para bloquear; padrão: R quando estiver livre. */
  block: string
  /** Tecla de aparo; padrão: Y quando estiver livre. */
  parry: string
  /** Tecla de travamento de alvo; padrão: O (M se O for a primeira pessoa). */
  targetLock: string
}

export interface VeilborneGameModuleOptions {
  controls?: Partial<VeilborneGameModuleControls>
}

/**
 * Resolve teclas defensivas uma única vez por quadro de entrada para que o
 * runtime e a HUD mostrem exatamente o mesmo resultado.
 */
export function resolveVeilborneGameModuleControls(
  bindings: Record<string, string>,
  configured: Partial<VeilborneGameModuleControls> = {},
): VeilborneGameModuleControls {
  const occupied = new Set(Object.values(bindings))
  const selected = new Set<string>()

  const choose = (configuredCode: string | undefined, candidates: string[]): string => {
    if (configuredCode) {
      selected.add(configuredCode)
      return configuredCode
    }
    const available = candidates.find(code => !occupied.has(code) && !selected.has(code))
    const fallback = available ?? candidates.find(code => !selected.has(code)) ?? 'F8'
    selected.add(fallback)
    return fallback
  }

  const block = choose(configured.block, [
    'KeyR', 'KeyH', 'KeyU', 'KeyP', 'KeyJ', 'KeyM', 'F8',
  ])
  const parry = choose(configured.parry, [
    'KeyY', 'KeyJ', 'KeyU', 'KeyP', 'KeyM', 'KeyH', 'F9',
  ])
  const targetLock = choose(configured.targetLock, [
    bindings.toggleFirstPerson === 'KeyO' ? 'KeyM' : 'KeyO',
    'KeyO', 'KeyM', 'KeyJ', 'KeyU', 'KeyP', 'KeyK', 'F10',
  ])
  return { block, parry, targetLock }
}
