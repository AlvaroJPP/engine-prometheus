<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Engine } from '../../../engine/Engine'
import { VeilborneGameModule } from '../runtime/VeilborneGameModule'
import type { VeilborneGameModuleControls } from '../runtime/VeilborneGameModule'
import { resolveVeilborneGameModuleControls } from '../runtime/VeilborneControls'
import VeilborneHUD from './VeilborneHUD.vue'

const props = withDefaults(defineProps<{
  /** Instância do Engine criada pelo host; null enquanto a viewport não existe. */
  engine: Engine | null
  bindings: Record<string, string>
  gameVariables: Record<string, boolean | number | string>
  /** A presença deste componente opta explicitamente pela integração VEILBORNE. */
  enabled?: boolean
  editorPreview?: boolean
  controls?: Partial<VeilborneGameModuleControls>
}>(), {
  enabled: true,
  editorPreview: false,
})

const emit = defineEmits<{
  (event: 'set-global-variable', name: string, value: string | number | boolean): void
}>()

// Keep the HUD responsive immediately, while still allowing the owning host to
// refresh its own model and mark the project dirty through the emitted event.
const localGameVariables = ref({ ...props.gameVariables })
watch(
  () => props.gameVariables,
  value => { localGameVariables.value = { ...value } },
  { deep: true },
)

let unregisterGameModule: (() => void) | null = null
let gameModule: VeilborneGameModule | null = null

const defensiveControls = computed(() => resolveVeilborneGameModuleControls(
  props.bindings,
  {
    block: props.controls?.block,
    parry: props.controls?.parry,
    targetLock: props.controls?.targetLock,
  },
))

watch(
  [() => props.engine, () => props.enabled] as const,
  ([engine, enabled]) => {
    unregisterGameModule?.()
    unregisterGameModule = null
    gameModule = null
    if (!engine || !enabled) return

    // O host do jogo é o único local que registra o módulo; o editor genérico
    // continua sem importações ou ativação automática de regras VEILBORNE.
    gameModule = new VeilborneGameModule({ controls: props.controls })
    unregisterGameModule = engine.registerGameModule(gameModule)
  },
  { immediate: true },
)

watch(
  [() => props.controls?.block, () => props.controls?.parry, () => props.controls?.targetLock] as const,
  () => gameModule?.setControls(props.controls),
)

onBeforeUnmount(() => {
  unregisterGameModule?.()
  unregisterGameModule = null
  gameModule = null
})

function setGlobalVariable(name: string, value: string | number | boolean): void {
  localGameVariables.value = { ...localGameVariables.value, [name]: value }
  props.engine?.setLogicVariable(name, value)
  emit('set-global-variable', name, value)
}
</script>

<template>
  <VeilborneHUD
    v-if="engine && enabled"
    :bindings="bindings"
    :defensive-controls="defensiveControls"
    :game-variables="localGameVariables"
    :editor-preview="editorPreview"
    @set-global-variable="setGlobalVariable"
  />
</template>
