<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UIScreenDefinition, UIElementDefinition } from '@engine'

const props = defineProps<{
  screens: UIScreenDefinition[]
  gameVariables: Record<string, boolean | number | string>
}>()
const emit = defineEmits<{
  (event: 'set-global-variable', name: string, value: string | number | boolean): void
}>()

const activeScreenId = ref('')
const availableScreens = computed(() => props.screens.filter(screen => screen.enabledInGame))
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
    borderRadius: `${element.borderRadius}px`,
  }
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

function activate(element: UIElementDefinition): void {
  if (element.action === 'navigate-screen') {
    if (navigableScreens.value.some(screen => screen.id === element.targetScreenId)) {
      activeScreenId.value = element.targetScreenId
    }
    return
  }
  if (element.action === 'set-variable' && element.variableName.trim()) {
    emit('set-global-variable', element.variableName.trim(), parseVariableValue(element.variableValue))
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
        v-for="element in screen.elements"
        :key="element.id"
        class="game-ui-element"
        :class="'game-ui-' + element.kind"
        :style="elementStyle(screen, element)"
      >
        <template v-if="element.kind === 'panel'">{{ element.text }}</template>
        <template v-else-if="element.kind === 'text'">{{ element.text }}</template>
        <template v-else-if="element.kind === 'image'">
          <img v-if="element.imageDataUrl" :src="element.imageDataUrl" :alt="element.name" />
          <span v-else>{{ element.text }}</span>
        </template>
        <template v-else-if="element.kind === 'progress'">
          <span class="game-ui-progress-fill" :style="{ width: progressPercent(element) + '%', backgroundColor: element.color }" />
          <span class="game-ui-progress-caption">{{ element.text || element.variableName }} <small v-if="progressLabel(element)">{{ progressLabel(element) }}</small></span>
        </template>
        <button v-else type="button" class="game-ui-button" :style="{ color: element.color, backgroundColor: element.background, borderRadius: element.borderRadius + 'px' }" @pointerdown.stop @click.stop="activate(element)">
          {{ element.text || 'Botão' }}
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
