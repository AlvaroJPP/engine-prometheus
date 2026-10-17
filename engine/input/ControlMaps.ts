import type { ModelControlBindings } from '../script/packages'

/** Teclas compartilhadas do jogador e atalhos disponíveis durante a execução. */
export interface ControlMapBindings extends ModelControlBindings {
  toggleFirstPerson: string
  cycleCamera: string
  exitRuntime: string
}

export interface ControlMapProfile {
  id: string
  name: string
  /** Perfis fornecidos pelo Engine não podem ser excluídos, mas podem ser personalizados. */
  builtIn?: boolean
  bindings: ControlMapBindings
}

export interface ControlMapSettings {
  profiles: ControlMapProfile[]
  activeProfileId: string
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
      jump: 'Space',
      interact: 'KeyE',
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
      jump: 'Space',
      interact: 'KeyE',
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
      jump: 'Space',
      interact: 'KeyA',
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
      jump: 'Space',
      interact: 'KeyU',
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
