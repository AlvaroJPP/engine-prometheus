import { onBeforeUnmount, watch } from 'vue'
import type { Ref } from 'vue'

type RuntimeVariableValue = boolean | number | string

type UseHudRuntimeSyncOptions = {
  executionMode: Ref<'edit' | 'running'>
  globalLogicVariables: Ref<Record<string, RuntimeVariableValue>>
  readRuntimeGlobalVariables: () => Record<string, RuntimeVariableValue>
}

/** Mantém os valores globais exibidos pela HUD sincronizados com o runtime. */
export function useHudRuntimeSync({
  executionMode,
  globalLogicVariables,
  readRuntimeGlobalVariables,
}: UseHudRuntimeSyncOptions) {
  let hudVariablePollTimer: number | null = null

  function syncHudRuntimeVariables() {
    globalLogicVariables.value = readRuntimeGlobalVariables()
  }

  watch(executionMode, mode => {
    if (hudVariablePollTimer !== null) {
      window.clearInterval(hudVariablePollTimer)
      hudVariablePollTimer = null
    }
    syncHudRuntimeVariables()
    if (mode === 'running') {
      hudVariablePollTimer = window.setInterval(syncHudRuntimeVariables, 100)
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    if (hudVariablePollTimer !== null) window.clearInterval(hudVariablePollTimer)
  })
}
