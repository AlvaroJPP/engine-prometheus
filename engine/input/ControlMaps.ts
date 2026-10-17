import type { ModelControlBindings } from '../script/packages'

/**
 * Mapa completo de comandos do jogador.
 * Os comandos adicionais de ação também podem ser usados como gatilhos
 * key_pressed no sistema visual de eventos do projeto.
 */
export interface ControlMapBindings extends ModelControlBindings {
  sprintToggle: string
  walkToggle: string
  crouchToggle: string
  proneToggle: string
  dodge: string
  slide: string
  roll: string
  primaryAction: string
  secondaryAction: string
  inventory: string
  useItem: string
  reload: string
  ability1: string
  ability2: string
  ability3: string
  ability4: string
  emote: string
  toggleFirstPerson: string
  cycleCamera: string
  exitRuntime: string
}

export interface ControlMapProfile {
  id: string
  name: string
  /** Perfis integrados não podem ser excluídos, mas podem ser personalizados. */
  builtIn?: boolean
  bindings: ControlMapBindings
}

export interface ControlMapSettings {
  profiles: ControlMapProfile[]
  activeProfileId: string
}

const COMMON_ACTIONS = {
  walkToggle: 'CapsLock',
  jump: 'Space',
  proneToggle: 'KeyZ',
  dodge: 'KeyV',
  slide: 'KeyX',
  roll: 'KeyB',
  primaryAction: 'KeyF',
  secondaryAction: 'KeyG',
  inventory: 'Tab',
  useItem: 'KeyH',
  reload: 'KeyT',
  ability1: 'Digit1',
  ability2: 'Digit2',
  ability3: 'Digit3',
  ability4: 'Digit4',
  emote: 'KeyN',
}

export const DEFAULT_CONTROL_MAPS: ControlMapProfile[] = [
  {
    id: 'wasd',
    name: 'Padrão (WASD)',
    builtIn: true,
    bindings: {
      forward: 'KeyW',
      backward: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'ShiftLeft',
      sprintToggle: 'ShiftRight',
      walkToggle: COMMON_ACTIONS.walkToggle,
      jump: COMMON_ACTIONS.jump,
      crouchToggle: 'ControlLeft',
      proneToggle: COMMON_ACTIONS.proneToggle,
      dodge: COMMON_ACTIONS.dodge,
      slide: COMMON_ACTIONS.slide,
      roll: COMMON_ACTIONS.roll,
      interact: 'KeyE',
      primaryAction: COMMON_ACTIONS.primaryAction,
      secondaryAction: COMMON_ACTIONS.secondaryAction,
      inventory: COMMON_ACTIONS.inventory,
      useItem: COMMON_ACTIONS.useItem,
      reload: COMMON_ACTIONS.reload,
      ability1: COMMON_ACTIONS.ability1,
      ability2: COMMON_ACTIONS.ability2,
      ability3: COMMON_ACTIONS.ability3,
      ability4: COMMON_ACTIONS.ability4,
      emote: COMMON_ACTIONS.emote,
      toggleFirstPerson: 'KeyQ',
      cycleCamera: 'KeyC',
      exitRuntime: 'F10',
    },
  },
  {
    id: 'arrows',
    name: 'Setas direcionais',
    builtIn: true,
    bindings: {
      forward: 'ArrowUp',
      backward: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      run: 'ShiftRight',
      sprintToggle: 'ShiftLeft',
      walkToggle: 'CapsLock',
      jump: 'Space',
      crouchToggle: 'ControlRight',
      proneToggle: 'KeyZ',
      dodge: 'KeyV',
      slide: 'KeyX',
      roll: 'KeyB',
      interact: 'KeyE',
      primaryAction: 'KeyF',
      secondaryAction: 'KeyG',
      inventory: 'Tab',
      useItem: 'KeyH',
      reload: 'KeyT',
      ability1: 'Digit1',
      ability2: 'Digit2',
      ability3: 'Digit3',
      ability4: 'Digit4',
      emote: 'KeyN',
      toggleFirstPerson: 'KeyQ',
      cycleCamera: 'KeyC',
      exitRuntime: 'F10',
    },
  },
  {
    id: 'esdf',
    name: 'ESDF (mão esquerda)',
    builtIn: true,
    bindings: {
      forward: 'KeyE',
      backward: 'KeyD',
      left: 'KeyS',
      right: 'KeyF',
      run: 'ShiftLeft',
      sprintToggle: 'ShiftRight',
      walkToggle: 'CapsLock',
      jump: 'Space',
      crouchToggle: 'ControlLeft',
      proneToggle: 'KeyZ',
      dodge: 'KeyV',
      slide: 'KeyX',
      roll: 'KeyB',
      interact: 'KeyA',
      primaryAction: 'KeyR',
      secondaryAction: 'KeyT',
      inventory: 'Tab',
      useItem: 'KeyG',
      reload: 'KeyY',
      ability1: 'Digit1',
      ability2: 'Digit2',
      ability3: 'Digit3',
      ability4: 'Digit4',
      emote: 'KeyN',
      toggleFirstPerson: 'KeyQ',
      cycleCamera: 'KeyC',
      exitRuntime: 'F10',
    },
  },
  {
    id: 'ijkl',
    name: 'IJKL',
    builtIn: true,
    bindings: {
      forward: 'KeyI',
      backward: 'KeyK',
      left: 'KeyJ',
      right: 'KeyL',
      run: 'ShiftLeft',
      sprintToggle: 'ShiftRight',
      walkToggle: 'CapsLock',
      jump: 'Space',
      crouchToggle: 'ControlLeft',
      proneToggle: 'KeyZ',
      dodge: 'KeyV',
      slide: 'KeyX',
      roll: 'KeyB',
      interact: 'KeyU',
      primaryAction: 'KeyF',
      secondaryAction: 'KeyG',
      inventory: 'Tab',
      useItem: 'KeyH',
      reload: 'KeyT',
      ability1: 'Digit1',
      ability2: 'Digit2',
      ability3: 'Digit3',
      ability4: 'Digit4',
      emote: 'KeyN',
      toggleFirstPerson: 'KeyO',
      cycleCamera: 'KeyP',
      exitRuntime: 'F10',
    },
  },
]

export function createDefaultControlMapSettings(): ControlMapSettings {
  return {
    profiles: DEFAULT_CONTROL_MAPS.map(profile => ({
      ...profile,
      bindings: { ...profile.bindings },
    })),
    activeProfileId: DEFAULT_CONTROL_MAPS[0]?.id ?? 'wasd',
  }
}
