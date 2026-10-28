<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import type { Engine } from '../../../engine/Engine'
import { VeilborneGameModule } from '../runtime/VeilborneGameModule'
import type { VeilborneGameModuleControls } from '../runtime/VeilborneGameModule'

const props = withDefaults(defineProps<{
  /** Instância do Engine criada pelo host; null enquanto a viewport não existe. */
  engine: Engine | null
  /** Permite desligar explicitamente a integração de runtime deste pacote. */
  enabled?: boolean
  controls?: Partial<VeilborneGameModuleControls>
}>(), {
  enabled: true,
})

let unregisterGameModule: (() => void) | null = null
let gameModule: VeilborneGameModule | null = null

watch(
  [() => props.engine, () => props.enabled] as const,
  ([engine, enabled]) => {
    unregisterGameModule?.()
    unregisterGameModule = null
    gameModule = null
    if (!engine || !enabled) return

    // Este host registra somente a lógica do jogo. A interface deve ser
    // criada no Workspace de UI, sem HUD específica ativada por padrão.
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
</script>

<template>
  <span v-if="engine && enabled" hidden aria-hidden="true" data-veilborne-runtime-host />
</template>
