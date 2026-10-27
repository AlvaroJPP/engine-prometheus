import { computed, ref } from 'vue'
import type { Ref } from 'vue'

type UseEnvironmentControllerOptions = {
  status: Ref<string>
  timeOfDay: Ref<number>
  setSkyTexture: (dataUrl: string) => void
  setTimeOfDay: (hours: number) => void
  setPlayerModelFile: (file: File) => Promise<unknown>
}

/** Controla as entradas de ambiente e os atalhos relacionados à hora do dia. */
export function useEnvironmentController({
  status,
  timeOfDay,
  setSkyTexture,
  setTimeOfDay,
  setPlayerModelFile,
}: UseEnvironmentControllerOptions) {
  const skyFileInput = ref<HTMLInputElement | null>(null)
  const playerModelFileInput = ref<HTMLInputElement | null>(null)
  const skyTextureName = ref('')
  function onSkyTextureSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { status.value = 'Escolha um arquivo de imagem para o céu.'; return }
    if (file.size > 20 * 1024 * 1024) { status.value = 'A textura do céu deve ter no máximo 20 MB.'; return }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      skyTextureName.value = file.name
      setSkyTexture(reader.result)
    }
    reader.onerror = () => { status.value = 'Não foi possível ler a imagem do céu.' }
    reader.readAsDataURL(file)
  }
  function clearSkyTexture() { skyTextureName.value = ''; setSkyTexture('') }
  async function onPlayerModelSelected(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) await setPlayerModelFile(file)
  }
  const timeOfDayLabel = computed(() => {
    const totalMinutes = Math.round(Math.max(0, Math.min(24, timeOfDay.value)) * 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  })
  function handleTimeOfDayKeydown(event: KeyboardEvent) {
    const keySteps: Record<string, number> = {
      ArrowRight: 0.25,
      ArrowUp: 0.25,
      ArrowLeft: -0.25,
      ArrowDown: -0.25,
      PageUp: 1,
      PageDown: -1,
    }
    const step = keySteps[event.key]
    if (step === undefined) return
    event.preventDefault()
    setTimeOfDay(Number(Math.max(0, Math.min(24, timeOfDay.value + step)).toFixed(4)))
  }

  return {
    clearSkyTexture,
    handleTimeOfDayKeydown,
    onPlayerModelSelected,
    onSkyTextureSelected,
    playerModelFileInput,
    skyFileInput,
    skyTextureName,
    timeOfDayLabel,
  }
}
