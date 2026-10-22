import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

interface UseWorldFullscreenOptions {
  appRoot: Ref<HTMLElement | null>
  worldFullscreen: Ref<boolean>
  beforeEnter: () => void
  refreshViewportLayoutBounds: () => void
  viewportLayoutRefresh: Ref<number>
}

const waitForNextFrames = (count = 2): Promise<void> => new Promise((resolve) => {
  const next = (remaining: number) => {
    if (remaining <= 0) {
      resolve()
      return
    }
    requestAnimationFrame(() => next(remaining - 1))
  }
  next(count)
})

/**
 * Controla apenas o modo de tela cheia e os eventos da janela/WebView.
 * O tamanho do canvas é medido pelo CSS/ResizeObserver do motor, nunca pela
 * resolução nominal do monitor, que pode divergir em telas com DPI escalonado.
 */
export function useWorldFullscreen({
  appRoot,
  worldFullscreen,
  beforeEnter,
  refreshViewportLayoutBounds,
  viewportLayoutRefresh,
}: UseWorldFullscreenOptions) {
  const fullscreenTransition = ref(false)
  let unlistenNativeWindowResize: (() => void) | null = null

  async function syncFullscreenViewportBounds(): Promise<void> {
    if (!worldFullscreen.value) return
    await nextTick()
    refreshViewportLayoutBounds()
    viewportLayoutRefresh.value += 1
    window.dispatchEvent(new Event('resize'))
  }

  async function settleViewportAfterFullscreenChange(): Promise<void> {
    await nextTick()
    await waitForNextFrames(2)

    if (worldFullscreen.value) {
      await syncFullscreenViewportBounds()
      await nextTick()
      await waitForNextFrames(1)
    }

    refreshViewportLayoutBounds()
    viewportLayoutRefresh.value += 1
    window.dispatchEvent(new Event('resize'))
  }

  async function toggleWorldFullscreen(): Promise<void> {
    if (fullscreenTransition.value) return
    fullscreenTransition.value = true
    const entering = !worldFullscreen.value

    try {
      if (entering) {
        beforeEnter()

        if (isTauri()) {
          const appWindow = getCurrentWindow()
          await appWindow.setFullscreen(true)
          if (!(await appWindow.isFullscreen())) {
            await waitForNextFrames(2)
            await appWindow.setFullscreen(true)
          }
          if (!(await appWindow.isFullscreen())) {
            console.warn('[Fullscreen] Tauri não confirmou a tela cheia nativa.')
          }
          await waitForNextFrames(2)
        } else if (!document.fullscreenElement) {
          // Este pedido precisa permanecer diretamente ligado ao clique do usuário.
          const target = appRoot.value
          await (target && typeof target.requestFullscreen === 'function'
            ? target.requestFullscreen()
            : document.documentElement.requestFullscreen())
        }

        // Não aplique .world-fullscreen até o host concluir a troca da superfície.
        worldFullscreen.value = true
        await syncFullscreenViewportBounds()
      } else {
        if (isTauri()) {
          const appWindow = getCurrentWindow()
          if (await appWindow.isFullscreen()) {
            await appWindow.setFullscreen(false)
            if (await appWindow.isFullscreen()) {
              await waitForNextFrames(1)
              await appWindow.setFullscreen(false)
            }
          }
        } else if (document.fullscreenElement) {
          await document.exitFullscreen()
        }

        worldFullscreen.value = false
      }
    } catch (error) {
      console.error('[Fullscreen] Falha na transição da janela:', error)
      // Mantém uma rota de recuperação baseada em CSS, sem deixar a UI travada.
      worldFullscreen.value = entering
      if (entering) await syncFullscreenViewportBounds()
    } finally {
      fullscreenTransition.value = false
    }

    await settleViewportAfterFullscreenChange()
  }

  function handleWorldFullscreenKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !worldFullscreen.value) return
    if (!isTauri() && document.fullscreenElement) return
    event.preventDefault()
    void toggleWorldFullscreen()
  }

  function syncWorldFullscreenAfterBrowserExit(): void {
    if (isTauri() || !worldFullscreen.value || document.fullscreenElement) return
    worldFullscreen.value = false
    void settleViewportAfterFullscreenChange()
  }

  onMounted(() => {
    window.addEventListener('keydown', handleWorldFullscreenKeydown)
    document.addEventListener('fullscreenchange', syncWorldFullscreenAfterBrowserExit)

    if (isTauri()) {
      void getCurrentWindow().onResized(() => {
        if (worldFullscreen.value) void syncFullscreenViewportBounds()
      }).then((unlisten) => {
        unlistenNativeWindowResize = unlisten
      }).catch((error: unknown) => {
        console.warn('[Fullscreen] Não foi possível observar resize da janela.', error)
      })
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleWorldFullscreenKeydown)
    document.removeEventListener('fullscreenchange', syncWorldFullscreenAfterBrowserExit)
    unlistenNativeWindowResize?.()
    unlistenNativeWindowResize = null
  })

  return { fullscreenTransition, toggleWorldFullscreen }
}
