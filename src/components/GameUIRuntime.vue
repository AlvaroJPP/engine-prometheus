<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getRenderableUIScreenDefinitions, isUIVisibilityConditionMet, nextUIToggleValue, adjustUINumericValue, resolveUIValueBindings, appendUIScreenHistory, takePreviousUIScreen } from '@engine'

import type { UIScreenDefinition, UIElementDefinition } from '@engine'

const props = defineProps<{
  screens: UIScreenDefinition[]
  gameVariables: Record<string, boolean | number | string>
}>()
const emit = defineEmits<{
  (event: 'set-global-variable', name: string, value: string | number | boolean): void
  (event: 'set-player-variable', name: string, value: string | number | boolean): void
  (event: 'trigger-global-event', eventId: string, payload: Record<string, string | number | boolean>): void
}>()

const activeScreenId = ref('')
const screenHistory = ref<string[]>([])
const availableScreens = computed(() => getRenderableUIScreenDefinitions(props.screens).filter(screen =>
  isUIVisibilityConditionMet(screen.visibilityVariable, screen.visibilityValue, props.gameVariables),
))
const navigableScreens = computed(() => availableScreens.value.filter(screen => screen.displayMode !== 'overlay'))
const overlayScreens = computed(() => availableScreens.value.filter(screen => screen.displayMode === 'overlay'))
const activeScreen = computed(() => navigableScreens.value.find(screen => screen.id === activeScreenId.value) ?? null)
const visibleScreens = computed(() => [
  ...(activeScreen.value ? [activeScreen.value] : []),
  ...overlayScreens.value.filter(screen => screen.id !== activeScreen.value?.id),
])

watch(navigableScreens, screens => {
  if (!screens.some(screen => screen.id === activeScreenId.value)) {
    activeScreenId.value = screens[0]?.id ?? ''
    screenHistory.value = []
  }
}, { immediate: true, deep: true })

function elementStyle(screen: UIScreenDefinition, element: UIElementDefinition): Record<string, string> {
  return {
    left: `${element.x}%`,
    top: `${element.y}%`,
    width: `${element.width}%`,
    height: `${element.height}%`,
    color: element.color,
    backgroundColor: element.kind === 'text' ? 'transparent' : element.background,
    fontSize: `${(element.fontSize / screen.width * 100).toFixed(3)}cqw`,
    fontWeight: String(element.fontWeight),
    textAlign: element.textAlign,
    justifyContent: element.textAlign === 'left' ? 'flex-start' : element.textAlign === 'right' ? 'flex-end' : 'center',
    opacity: String(element.opacity),
    borderRadius: `${element.borderRadius}px`,
  }
}

function isElementVisible(element: UIElementDefinition): boolean {
  return isUIVisibilityConditionMet(element.visibilityVariable, element.visibilityValue, props.gameVariables)
}

function uiText(text: string, fallback = ''): string {
  const resolved = resolveUIValueBindings(text, props.gameVariables)
  return resolved || fallback
}

function progressLabel(element: UIElementDefinition): string {
  const value = props.gameVariables[element.variableName]
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : ''
}

function progressPercent(element: UIElementDefinition): number {
  const value = props.gameVariables[element.variableName]
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value / Math.max(1, element.variableMax) * 100))
}

function parseVariableValue(raw: string): string | number | boolean {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && Number.isFinite(Number(value))) return Number(value)
  return raw
}

/** player.* is an explicit HUD binding to the player scope; all other keys remain global. */
function writeGameVariable(rawName: string, value: string | number | boolean): void {
  const name = rawName.trim()
  if (!name) return
  if (name.startsWith('player.')) {
    const playerName = name.slice('player.'.length).trim()
    if (playerName) emit('set-player-variable', playerName, value)
    return
  }
  emit('set-global-variable', name, value)
}

function activate(element: UIElementDefinition): void {
  if (element.action === 'navigate-screen') {
    if (navigableScreens.value.some(screen => screen.id === element.targetScreenId) && element.targetScreenId !== activeScreenId.value) {
      if (activeScreenId.value && navigableScreens.value.some(screen => screen.id === activeScreenId.value)) {
        screenHistory.value = appendUIScreenHistory(screenHistory.value, activeScreenId.value)
      }
      activeScreenId.value = element.targetScreenId
    }
    return
  }
  if (element.action === 'navigate-back') {
    const previous = takePreviousUIScreen(screenHistory.value, screenId =>
      navigableScreens.value.some(screen => screen.id === screenId),
    )
    screenHistory.value = previous.history
    if (previous.screenId) activeScreenId.value = previous.screenId
    return
  }
  if (element.action === 'set-variable' && element.variableName.trim()) {
    writeGameVariable(element.variableName, parseVariableValue(element.variableValue))
    return
  }
  if (element.action === 'toggle-variable' && element.variableName.trim()) {
    const variableName = element.variableName.trim()
    writeGameVariable(variableName, nextUIToggleValue(props.gameVariables[variableName]))
    return
  }
  if (element.action === 'adjust-variable' && element.variableName.trim()) {
    const variableName = element.variableName.trim()
    writeGameVariable(variableName, adjustUINumericValue(props.gameVariables[variableName], element.variableStep, element.variableMin, element.variableLimitMax))
    return
  }
  if (element.action === 'trigger-event' && element.eventId.trim()) {
    const screen = visibleScreens.value.find(candidate => candidate.elements.some(item => item.id === element.id))
    emit('trigger-global-event', element.eventId.trim(), {
      source: 'hud',
      screenId: screen?.id ?? '',
      screenName: screen?.name ?? '',
      elementId: element.id,
      elementName: element.name,
    })
  }
}
</script>

<template>
  <div v-if="visibleScreens.length" class="game-ui-runtime" aria-label="Interface do jogo">
    <div
      v-for="screen in visibleScreens"
      :key="screen.id"
      class="game-ui-surface"
      :style="{ backgroundColor: screen.background }"
      :aria-label="screen.name"
    >
      <div
        v-for="element in screen.elements.filter(isElementVisible)"
        :key="element.id"
        class="game-ui-element"
        :class="'game-ui-' + element.kind"
        :style="elementStyle(screen, element)"
      >
        <template v-if="element.kind === 'panel'"><span class="game-ui-label">{{ uiText(element.text) }}</span></template>
        <template v-else-if="element.kind === 'text'"><span class="game-ui-label">{{ uiText(element.text) }}</span></template>
        <template v-else-if="element.kind === 'image'">
          <img v-if="element.imageDataUrl" :src="element.imageDataUrl" :alt="uiText(element.name, 'Imagem')" :style="{ objectFit: element.imageFit }" />
          <span v-else>{{ uiText(element.text, element.name) }}</span>
        </template>
        <template v-else-if="element.kind === 'progress'">
          <span class="game-ui-progress-fill" :style="{ width: progressPercent(element) + '%', backgroundColor: element.color }" />
          <span class="game-ui-progress-caption">{{ uiText(element.text, element.variableName) }} <small v-if="progressLabel(element)">{{ progressLabel(element) }}</small></span>
        </template>
        <button v-else type="button" class="game-ui-button" :style="{ color: element.color, backgroundColor: element.background, borderRadius: element.borderRadius + 'px', fontWeight: element.fontWeight, textAlign: element.textAlign }" @pointerdown.stop @click.stop="activate(element)">
          {{ uiText(element.text, 'Botão') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-ui-runtime { position: absolute; inset: 0; z-index: 24; pointer-events: none; overflow: hidden; }
.game-ui-surface { position: absolute; inset: 0; overflow: hidden; container-type: inline-size; pointer-events: none; }
.game-ui-element { position: absolute; display: flex; align-items: center; justify-content: center; overflow: hidden; text-align: center; font-weight: 600; line-height: 1.15; text-shadow: 0 1px 3px #0008; pointer-events: none; }
.game-ui-panel { border: 1px solid #ffffff25; box-shadow: 0 8px 30px #0003; }
.game-ui-label { display: block; width: 100%; min-width: 0; padding: 0 8px; overflow-wrap: anywhere; }
.game-ui-text { overflow-wrap: anywhere; }
.game-ui-image { border: 1px solid #ffffff20; }
.game-ui-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
.game-ui-progress { justify-content: flex-start; border: 1px solid #ffffff2b; background: #242830; }
.game-ui-progress-fill { position: absolute; inset: 0 auto 0 0; opacity: .9; }
.game-ui-progress-caption { position: relative; width: 100%; padding: 0 4px; font-size: .8em; }
.game-ui-progress-caption small { margin-left: 4px; font-size: .9em; }
.game-ui-button { width: 100%; height: 100%; min-width: 0; min-height: 0; border: 1px solid #ffffff30; padding: 0 8px; font: inherit; font-weight: 700; text-shadow: none; box-shadow: 0 3px 10px #0003; cursor: pointer; pointer-events: auto; }
.game-ui-button:hover { filter: brightness(1.12); }
</style>
