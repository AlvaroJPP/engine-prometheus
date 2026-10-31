import { reactive } from 'vue'
import type { UIScreenDefinition } from '@engine'

/**
 * Shared state keeps the designer and the game runtime on the same screen definitions.
 * The project service is responsible for persisting these definitions in ui/screens.json.
 */
export const uiWorkspaceState = reactive({
  screens: [] as UIScreenDefinition[],
  activeScreenId: '',
})

export function replaceUIScreenDefinitions(screens: UIScreenDefinition[]): void {
  uiWorkspaceState.screens = screens
  if (!screens.some(screen => screen.id === uiWorkspaceState.activeScreenId)) {
    uiWorkspaceState.activeScreenId = screens[0]?.id ?? ''
  }
}

export function activeUIScreen(): UIScreenDefinition | null {
  return uiWorkspaceState.screens.find(screen => screen.id === uiWorkspaceState.activeScreenId) ?? null
}
