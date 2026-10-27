/**
 * Controles defensivos opcionais do VEILBORNE.
 *
 * A resolução é pura e testável, separada do orquestrador de gameplay.
 */
export interface VeilborneGameModuleControls {
  /** Tecla mantida para bloquear; usa uma tecla livre, R por padrão. */
  block: string
  /** Tecla de aparo; usa uma tecla livre, Y por padrão. */
  parry: string
  /** Tecla de travamento de alvo; usa uma tecla livre, O por padrão. */
  targetLock: string
}

export interface VeilborneGameModuleOptions {
  controls?: Partial<VeilborneGameModuleControls>
}

type ActiveControlBindings = Readonly<Record<string, string>>

const FALLBACK_CODES = [
  'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F17',
  'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24',
  'Backquote', 'BracketLeft', 'BracketRight', 'Backslash',
  'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
  'NumpadSubtract', 'NumpadAdd', 'NumpadMultiply', 'NumpadDivide',
]

/**
 * Resolve três atalhos distintos e livres em relação ao mapa ativo. Controles
 * customizados são respeitados quando não colidem; em caso de conflito, são
 * substituídos por uma alternativa livre para não disparar várias ações juntas.
 */
export function resolveVeilborneGameModuleControls(
  activeBindings: ActiveControlBindings,
  configured: Partial<VeilborneGameModuleControls> = {},
): VeilborneGameModuleControls {
  const occupied = new Set(Object.values(activeBindings).filter(value => typeof value === 'string' && value.length > 0))
  const selected = new Set<string>()

  const choose = (requested: string | undefined, candidates: readonly string[]): string => {
    if (requested && !occupied.has(requested) && !selected.has(requested)) {
      selected.add(requested)
      return requested
    }

    for (const code of [...candidates, ...FALLBACK_CODES]) {
      if (occupied.has(code) || selected.has(code)) continue
      selected.add(code)
      return code
    }

    // Fallback defensivo para mapas personalizados patológicos que ocupem todos
    // os códigos previstos; na prática o mapa suporta muito menos ações que isso.
    let index = 1
    while (selected.has('F' + index) || occupied.has('F' + index)) index += 1
    const code = 'F' + index
    selected.add(code)
    return code
  }

  const block = choose(configured.block, [
    'KeyR', 'KeyH', 'KeyU', 'KeyP', 'KeyJ', 'KeyM',
  ])
  const parry = choose(configured.parry, [
    'KeyY', 'KeyJ', 'KeyU', 'KeyP', 'KeyM', 'KeyH',
  ])
  const targetLock = choose(configured.targetLock, [
    activeBindings.toggleFirstPerson === 'KeyO' ? 'KeyM' : 'KeyO',
    'KeyO', 'KeyM', 'KeyJ', 'KeyU', 'KeyP', 'KeyK',
  ])

  return { block, parry, targetLock }
}
