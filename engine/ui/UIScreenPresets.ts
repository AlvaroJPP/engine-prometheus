import {
  createUIElement,
  createUIScreen,
  type UIElementDefinition,
  type UIElementKind,
  type UIScreenDefinition,
} from './UIScreenDocument'

export type UIScreenPresetId = 'main-menu' | 'pause-menu' | 'adventure-hud'

export interface UIScreenPresetMetadata {
  id: UIScreenPresetId
  name: string
  description: string
}

export const UI_SCREEN_PRESETS: readonly UIScreenPresetMetadata[] = [
  { id: 'main-menu', name: 'Menu principal', description: 'Título e ações iniciais' },
  { id: 'pause-menu', name: 'Menu de pausa', description: 'Continuar, opções e menu' },
  { id: 'adventure-hud', name: 'HUD de aventura', description: 'Barras de vida e mana' },
]

function addElement(
  screen: UIScreenDefinition,
  kind: UIElementKind,
  overrides: Partial<UIElementDefinition>,
): UIElementDefinition {
  const element = Object.assign(createUIElement(kind, screen.elements.length), overrides)
  screen.elements.push(element)
  return element
}

function addActionButton(
  screen: UIScreenDefinition,
  name: string,
  text: string,
  y: number,
  variableName: string,
): void {
  addElement(screen, 'button', {
    name, text, x: 37, y, width: 26, height: 8,
    fontSize: 20, fontWeight: 700, textAlign: 'center',
    color: '#FFF8EC', background: '#9F6A25', borderRadius: 8,
    action: 'set-variable', variableName, variableValue: 'true',
  })
}

/** Creates a ready-to-edit UI screen from a reusable, project-agnostic starter preset. */
export function createUIScreenFromPreset(presetId: UIScreenPresetId): UIScreenDefinition {
  const screen = createUIScreen()
  screen.enabledInGame = false

  if (presetId === 'main-menu') {
    screen.name = 'Menu principal'
    screen.background = '#10141D'
    addElement(screen, 'panel', {
      name: 'Fundo do menu', x: 28, y: 10, width: 44, height: 80,
      text: '', color: '#F4F1E9', background: '#171D28F2',
      opacity: 0.97, borderRadius: 18,
    })
    addElement(screen, 'text', {
      name: 'Título', text: 'NOVO JOGO', x: 32, y: 18, width: 36, height: 13,
      color: '#F5B548', fontSize: 48, fontWeight: 800, textAlign: 'center',
    })
    addElement(screen, 'text', {
      name: 'Subtítulo', text: 'Uma nova aventura começa', x: 33, y: 32, width: 34, height: 6,
      color: '#CBD2DE', fontSize: 18, fontWeight: 400, textAlign: 'center',
    })
    addActionButton(screen, 'Iniciar', 'Iniciar', 44, 'ui.action.start')
    addActionButton(screen, 'Opções', 'Opções', 56, 'ui.action.options')
    addActionButton(screen, 'Sair', 'Sair', 68, 'ui.action.quit')
    return screen
  }

  if (presetId === 'pause-menu') {
    screen.name = 'Menu de pausa'
    screen.background = '#00000080'
    addElement(screen, 'panel', {
      name: 'Fundo da pausa', x: 31, y: 17, width: 38, height: 66,
      text: '', color: '#F4F1E9', background: '#171D28F5',
      opacity: 0.98, borderRadius: 16,
    })
    addElement(screen, 'text', {
      name: 'Título da pausa', text: 'PAUSADO', x: 34, y: 23, width: 32, height: 12,
      color: '#F5B548', fontSize: 38, fontWeight: 800, textAlign: 'center',
    })
    addActionButton(screen, 'Continuar', 'Continuar', 41, 'ui.action.resume')
    addActionButton(screen, 'Opções', 'Opções', 53, 'ui.action.options')
    addActionButton(screen, 'Menu principal', 'Menu principal', 65, 'ui.action.main-menu')
    return screen
  }

  if (presetId === 'adventure-hud') {
    screen.name = 'HUD de aventura'
    screen.displayMode = 'overlay'
    screen.background = '#00000000'
    addElement(screen, 'panel', {
      name: 'Painel de status', x: 2, y: 3, width: 28, height: 20,
      text: '', color: '#FFFFFF', background: '#10151DDB',
      opacity: 0.96, borderRadius: 10,
    })
    addElement(screen, 'text', {
      name: 'Rótulo de vida', text: 'VIDA', x: 4, y: 5, width: 7, height: 4,
      color: '#FFD9D9', fontSize: 16, fontWeight: 800, textAlign: 'left',
    })
    addElement(screen, 'progress', {
      name: 'Barra de vida', text: 'Vida', x: 4, y: 10, width: 24, height: 4,
      color: '#E5535D', background: '#4A202B', variableName: 'vida',
      variableMax: 100, opacity: 1, borderRadius: 5,
    })
    addElement(screen, 'text', {
      name: 'Rótulo de mana', text: 'MANA', x: 4, y: 15, width: 7, height: 4,
      color: '#D7E5FF', fontSize: 16, fontWeight: 800, textAlign: 'left',
    })
    addElement(screen, 'progress', {
      name: 'Barra de mana', text: 'Mana', x: 4, y: 20, width: 24, height: 3,
      color: '#5794F2', background: '#1C3155', variableName: 'mana',
      variableMax: 100, opacity: 1, borderRadius: 5,
    })
    return screen
  }

  throw new Error(`Modelo de interface desconhecido: ${String(presetId)}`)
}
