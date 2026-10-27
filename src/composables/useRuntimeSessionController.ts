import type { Ref } from 'vue'

type UseRuntimeSessionControllerOptions = {
  executionMode: Ref<'edit' | 'running'>
  firstPersonMode: Ref<boolean>
  status: Ref<string>
  activeControlMapName: () => string
  setFirstPersonMode: (enabled: boolean) => void
  setRuntimeMode: (enabled: boolean) => void
  cycleCamera: () => void
}

/** Encapsula os comandos da sessão de jogo e a alternância de câmera. */
export function useRuntimeSessionController({
  executionMode,
  firstPersonMode,
  status,
  activeControlMapName,
  setFirstPersonMode,
  setRuntimeMode,
  cycleCamera,
}: UseRuntimeSessionControllerOptions) {
  function toggleFirstPerson() {
    firstPersonMode.value = !firstPersonMode.value
    setFirstPersonMode(firstPersonMode.value)
  }

  function cycleCameraView() {
    if (firstPersonMode.value) {
      firstPersonMode.value = false
      setFirstPersonMode(false)
    }
    cycleCamera()
  }

  function startRuntimeSession() {
    if (firstPersonMode.value) {
      firstPersonMode.value = false
      setFirstPersonMode(false)
    }
    setRuntimeMode(true)
    executionMode.value = 'running'
    status.value = `Modo Run ativo · mapa “${activeControlMapName()}”. Use Controles para personalizar as teclas.`
  }

  function returnToEdit() {
    // Atualiza a interface mesmo se algum recurso do runtime falhar ao ser encerrado.
    try {
      if (firstPersonMode.value) {
        firstPersonMode.value = false
        setFirstPersonMode(false)
      }
      setRuntimeMode(false)
    } catch (error) {
      console.error('Falha ao encerrar o modo Run:', error)
      status.value = 'Ocorreu um erro ao encerrar o jogo. O editor foi reativado; confira o console.'
    } finally {
      executionMode.value = 'edit'
      if (!status.value.includes('Ocorreu um erro ao encerrar')) {
        status.value = 'Modo de edição · câmera livre e ferramentas habilitadas.'
      }
    }
  }

  function handleHudToggleCamera() {
    if (executionMode.value === 'running') cycleCameraView()
  }

  function handleHudExitRuntime() {
    if (executionMode.value === 'running') returnToEdit()
  }

  return {
    cycleCameraView,
    handleHudExitRuntime,
    handleHudToggleCamera,
    returnToEdit,
    startRuntimeSession,
    toggleFirstPerson,
  }
}
