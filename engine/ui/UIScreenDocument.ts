export type UIElementKind = 'panel' | 'text' | 'button' | 'image' | 'progress'
export type UIElementAction = 'none' | 'navigate-screen' | 'navigate-back' | 'set-variable' | 'toggle-variable' | 'adjust-variable' | 'trigger-event' | 'trigger-player-event'
export type UIElementTextAlign = 'left' | 'center' | 'right'
export type UIElementImageFit = 'contain' | 'cover' | 'fill'
export type UIElementFontWeight = 400 | 500 | 600 | 700 | 800

export interface UIElementDefinition {
  id: string
  name: string
  kind: UIElementKind
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
  background: string
  fontSize: number
  fontWeight: UIElementFontWeight
  textAlign: UIElementTextAlign
  opacity: number
  imageFit: UIElementImageFit
  borderRadius: number
  variableName: string
  variableMax: number
  /** Numeric delta applied by the adjust-variable button action. */
  variableStep: number
  /** Inclusive lower and upper bounds for numeric button adjustments. */
  variableMin: number
  variableLimitMax: number
  action: UIElementAction
  /** Visual Script event invoked by a HUD/button action; may target global or player scope. */
  eventId: string
  targetScreenId: string
  variableValue: string
  /** Optional variable-driven visibility; blank variable means always visible. */
  visibilityVariable?: string
  visibilityValue?: string
  /** Editor-only group identity; ignored by game runtime rendering. */
  groupId?: string
  imageDataUrl?: string
}

export interface UIScreenDefinition {
  id: string
  name: string
  width: number
  height: number
  background: string
  /** Main navigable screen or persistent overlay such as an in-game HUD. */
  displayMode: 'screen' | 'overlay'
  enabledInGame: boolean
  /** Optional variable-driven visibility; blank variable means always visible. */
  visibilityVariable?: string
  visibilityValue?: string
  elements: UIElementDefinition[]
}

export function createUIScreenId(prefix = 'ui'): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${random}`
}

export function createUIScreen(name = 'Nova tela'): UIScreenDefinition {
  return {
    id: createUIScreenId('screen'),
    name: name.slice(0, 80),
    width: 1280,
    height: 720,
    background: '#00000000',
    displayMode: 'screen',
    enabledInGame: false,
    visibilityVariable: '',
    visibilityValue: 'true',
    elements: [],
  }
}

export function createUIElement(kind: UIElementKind, count = 0): UIElementDefinition {
  const defaults: Record<UIElementKind, Omit<UIElementDefinition, 'id' | 'name' | 'x' | 'y' | 'eventId'>> = {
    panel: {
      kind: 'panel', width: 42, height: 44, text: '', color: '#F4F1E9',
      background: '#202631', fontSize: 24, fontWeight: 600, textAlign: 'center', opacity: 1, imageFit: 'contain', borderRadius: 14,
      variableName: 'vida', variableMax: 100, variableStep: 1, variableMin: 0, variableLimitMax: 100, action: 'none', targetScreenId: '', variableValue: 'true', visibilityVariable: '', visibilityValue: 'true',
    },
    text: {
      kind: 'text', width: 38, height: 12, text: 'Novo texto', color: '#F4F1E9',
      background: '#00000000', fontSize: 36, fontWeight: 600, textAlign: 'center', opacity: 1, imageFit: 'contain', borderRadius: 0,
      variableName: 'vida', variableMax: 100, variableStep: 1, variableMin: 0, variableLimitMax: 100, action: 'none', targetScreenId: '', variableValue: 'true', visibilityVariable: '', visibilityValue: 'true',
    },
    button: {
      kind: 'button', width: 24, height: 11, text: 'Novo botão', color: '#FFFFFF',
      background: '#B97828', fontSize: 20, fontWeight: 700, textAlign: 'center', opacity: 1, imageFit: 'contain', borderRadius: 8,
      variableName: 'confirmado', variableMax: 100, variableStep: 1, variableMin: 0, variableLimitMax: 100, action: 'none', targetScreenId: '', variableValue: 'true', visibilityVariable: '', visibilityValue: 'true',
    },
    image: {
      kind: 'image', width: 22, height: 22, text: 'Imagem', color: '#F4F1E9',
      background: '#252B35', fontSize: 18, fontWeight: 600, textAlign: 'center', opacity: 1, imageFit: 'contain', borderRadius: 8,
      variableName: 'vida', variableMax: 100, variableStep: 1, variableMin: 0, variableLimitMax: 100, action: 'none', targetScreenId: '', variableValue: 'true', visibilityVariable: '', visibilityValue: 'true',
    },
    progress: {
      kind: 'progress', width: 32, height: 6, text: 'Vida', color: '#FFFFFF',
      background: '#4A2630', fontSize: 16, fontWeight: 600, textAlign: 'center', opacity: 1, imageFit: 'contain', borderRadius: 6,
      variableName: 'vida', variableMax: 100, variableStep: 1, variableMin: 0, variableLimitMax: 100, action: 'none', targetScreenId: '', variableValue: 'true', visibilityVariable: '', visibilityValue: 'true',
    },
  }
  const base = defaults[kind]
  return {
    ...base,
    id: createUIScreenId('element'),
    name: `${kind === 'panel' ? 'Painel' : kind === 'text' ? 'Texto' : kind === 'button' ? 'Botão' : kind === 'image' ? 'Imagem' : 'Barra'} ${count + 1}`,
    x: Math.min(72, 8 + (count % 4) * 5),
    y: Math.min(78, 10 + (count % 5) * 7),
    eventId: '',
  }
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function boundedString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback
}

function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : fallback
}

/** Validates and normalizes UI data before loading a project file. */
/** Empty draft screens must never paint an opaque full-screen layer over the running world. */
export function getRenderableUIScreenDefinitions(screens: readonly UIScreenDefinition[]): UIScreenDefinition[] {
  return screens.filter(screen => screen.enabledInGame && screen.elements.length > 0)
}

export function parseUIScreenDefinitions(value: unknown): UIScreenDefinition[] {
  if (!Array.isArray(value)) throw new Error('ui/screens.json precisa conter uma lista de telas.')
  if (value.length > 64) throw new Error('Um projeto pode conter no máximo 64 telas de interface.')

  const seenScreenIds = new Set<string>()
  return value.map((raw, screenIndex) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`A tela de interface ${screenIndex + 1} é inválida.`)
    }
    const source = raw as Partial<UIScreenDefinition>
    if (typeof source.id !== 'string' || !source.id.trim()) {
      throw new Error(`A tela de interface ${screenIndex + 1} não tem um ID válido.`)
    }
    if (seenScreenIds.has(source.id)) throw new Error(`ID de tela duplicado: ${source.id}`)
    seenScreenIds.add(source.id)
    if (!Array.isArray(source.elements) || source.elements.length > 512) {
      throw new Error(`A tela "${source.name ?? source.id}" tem uma lista de elementos inválida ou excede 512 elementos.`)
    }
    const seenElementIds = new Set<string>()
    const elements = source.elements.map((rawElement, elementIndex): UIElementDefinition => {
      if (!rawElement || typeof rawElement !== 'object' || Array.isArray(rawElement)) {
        throw new Error(`O elemento ${elementIndex + 1} da tela "${source.name ?? source.id}" é inválido.`)
      }
      const element = rawElement as Partial<UIElementDefinition>
      if (typeof element.id !== 'string' || !element.id.trim()) throw new Error('Um elemento de interface não tem um ID válido.')
      if (seenElementIds.has(element.id)) throw new Error(`ID de elemento duplicado: ${element.id}`)
      seenElementIds.add(element.id)
      const kind: UIElementKind = element.kind === 'panel' || element.kind === 'text' || element.kind === 'button' || element.kind === 'image' || element.kind === 'progress'
        ? element.kind
        : 'text'
      const action: UIElementAction = element.action === 'navigate-screen' || element.action === 'navigate-back' || element.action === 'set-variable' || element.action === 'toggle-variable' || element.action === 'adjust-variable' || element.action === 'trigger-event' || element.action === 'trigger-player-event' ? element.action : 'none'
      const imageDataUrl = typeof element.imageDataUrl === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(element.imageDataUrl) && element.imageDataUrl.length <= 7_000_000
        ? element.imageDataUrl
        : undefined
      return {
        id: element.id,
        name: boundedString(element.name, `Elemento ${elementIndex + 1}`, 80),
        kind,
        x: boundedNumber(element.x, 8, 0, 100),
        y: boundedNumber(element.y, 10, 0, 100),
        width: boundedNumber(element.width, 24, 1, 100),
        height: boundedNumber(element.height, 10, 1, 100),
        text: boundedString(element.text, '', 240),
        color: safeColor(element.color, '#F4F1E9'),
        background: safeColor(element.background, '#252B35'),
        fontSize: boundedNumber(element.fontSize, 20, 8, 96),
        fontWeight: [400, 500, 600, 700, 800].includes(Number(element.fontWeight)) ? Number(element.fontWeight) as UIElementFontWeight : (kind === 'button' ? 700 : 600),
        textAlign: element.textAlign === 'left' || element.textAlign === 'right' ? element.textAlign : 'center',
        opacity: boundedNumber(element.opacity, 1, 0, 1),
        imageFit: element.imageFit === 'cover' || element.imageFit === 'fill' ? element.imageFit : 'contain',
        borderRadius: boundedNumber(element.borderRadius, 8, 0, 48),
        variableName: boundedString(element.variableName, '', 80),
        variableMax: boundedNumber(element.variableMax, 100, 1, 1_000_000),
        variableStep: boundedNumber(element.variableStep, 1, -1_000_000, 1_000_000),
        variableMin: boundedNumber(element.variableMin, 0, -1_000_000, 1_000_000),
        variableLimitMax: boundedNumber(element.variableLimitMax, 100, -1_000_000, 1_000_000),
        action,
        eventId: boundedString(element.eventId, '', 100),
        targetScreenId: boundedString(element.targetScreenId, '', 100),
        variableValue: boundedString(element.variableValue, 'true', 100),
        visibilityVariable: boundedString(element.visibilityVariable, '', 80).trim(),
        visibilityValue: boundedString(element.visibilityValue, 'true', 100),
        ...(typeof element.groupId === 'string' && element.groupId.trim()
          ? { groupId: boundedString(element.groupId.trim(), '', 100) }
          : {}),
        ...(imageDataUrl ? { imageDataUrl } : {}),
      }
    })
    return {
      id: source.id,
      name: boundedString(source.name, `Tela ${screenIndex + 1}`, 80),
      width: boundedNumber(source.width, 1280, 320, 4096),
      height: boundedNumber(source.height, 720, 180, 4096),
      background: safeColor(source.background, '#00000000'),
      displayMode: source.displayMode === 'overlay' ? 'overlay' : 'screen',
      enabledInGame: source.enabledInGame === true,
      visibilityVariable: boundedString(source.visibilityVariable, '', 80).trim(),
      visibilityValue: boundedString(source.visibilityValue, 'true', 100),
      elements,
    }
  })
}
