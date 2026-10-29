<script setup lang="ts">
import { computed } from 'vue'
import { getGameOverlays } from '@/lib/gameOverlayRegistry'
import { resolveUIVariableReference } from '@engine'

const props = defineProps<{
  engine: unknown
  behaviorPackages: Array<{ packageId: string }>
  bindings: Record<string, string>
  gameVariables: Record<string, boolean | number | string>
  editorPreview: boolean
}>()

const emit = defineEmits<{
  (event: 'set-global-variable', name: string, value: string | number | boolean): void
  (event: 'set-player-variable', name: string, value: string | number | boolean): void
}>()

const overlays = computed(() => getGameOverlays().filter(overlay =>
  props.behaviorPackages.some(instance => instance.packageId === overlay.packageId),
))

const handleSetGlobalVariable = (name: string, value: string | number | boolean) => {
  const reference = resolveUIVariableReference(name)
  if (!reference) return
  if (reference.scope === 'player') {
    emit('set-player-variable', reference.name, value)
    return
  }
  emit('set-global-variable', reference.name, value)
}
</script>

<template>
  <component
    :is="overlay.component"
    v-for="overlay in overlays"
    :key="overlay.id"
    :engine="engine"
    :enabled="true"
    :bindings="bindings"
    :game-variables="gameVariables"
    :editor-preview="editorPreview"
    @set-global-variable="handleSetGlobalVariable"
  />
</template>
