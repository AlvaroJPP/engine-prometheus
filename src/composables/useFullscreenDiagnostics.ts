import { onBeforeUnmount, onMounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export type FullscreenDiagnosticSnapshot = {
  checkedAt: string
  nativeFullscreen: string
  browserFullscreen: string
  windowSize: string
  devicePixelRatio: string
  rootRect: string
  mainRect: string
  viewportRect: string
  canvasRect: string
  canvasClientSize: string
  canvasBufferSize: string
  canvasRenderCount: string
  lastRenderSize: string
  lastResize: string
  lastRender: string
  lastRenderError: string
  resizeBlocked: string
  webglReady: string
  webglError: string
  canvasZIndex: string
  contextLost: string
  contextLostAt: string
  fullscreenClass: string
  rootDisplay: string
  viewportDisplay: string
  canvasVisibility: string
}

const initialSnapshot: FullscreenDiagnosticSnapshot = {
  checkedAt: '—',
  nativeFullscreen: 'consultando…',
  browserFullscreen: '—',
  windowSize: '—',
  devicePixelRatio: '—',
  rootRect: '—',
  mainRect: '—',
  viewportRect: '—',
  canvasRect: '—',
  canvasClientSize: '—',
  canvasBufferSize: '—',
  canvasRenderCount: '—',
  lastRenderSize: '—',
  lastResize: '—',
  lastRender: '—',
  lastRenderError: 'nenhum',
  resizeBlocked: '—',
  webglReady: '—',
  webglError: 'nenhum',
  canvasZIndex: '—',
  contextLost: '—',
  contextLostAt: '—',
  fullscreenClass: '—',
  rootDisplay: '—',
  viewportDisplay: '—',
  canvasVisibility: '—',
}

function rectLabel(element: Element | null): string {
  if (!element) return 'elemento não encontrado'
  const rect = element.getBoundingClientRect()
  return `${Math.round(rect.width)} × ${Math.round(rect.height)} px (x=${Math.round(rect.left)}, y=${Math.round(rect.top)})`
}

function timestampAge(value: string | undefined): string {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) return 'nenhum quadro registrado'
  const seconds = Math.max(0, (Date.now() - time) / 1000)
  return seconds < 1 ? 'há menos de 1 s' : `há ${seconds.toFixed(1)} s`
}

function readData(canvas: HTMLCanvasElement | null, key: string, fallback: string): string {
  return canvas?.dataset[key] || fallback
}

/** Reúne sinais independentes da janela, layout CSS e renderizador WebGL. */
export function useFullscreenDiagnostics() {
  const snapshot = ref<FullscreenDiagnosticSnapshot>({ ...initialSnapshot })
  let timer: number | null = null
  let reading = false
  let disposed = false

  async function refreshSnapshot(): Promise<void> {
    if (reading || disposed) return
    reading = true
    try {
      const root = document.querySelector<HTMLElement>('.app')
      const main = root?.querySelector<HTMLElement>('.main') ?? null
      const viewport = root?.querySelector<HTMLElement>('.viewport') ?? null
      const canvas = viewport?.querySelector<HTMLCanvasElement>('canvas.canvas') ?? null
      const rootStyle = root ? getComputedStyle(root) : null
      const viewportStyle = viewport ? getComputedStyle(viewport) : null
      const canvasStyle = canvas ? getComputedStyle(canvas) : null
      let nativeFullscreen = 'não se aplica'
      if (isTauri()) {
        try {
          nativeFullscreen = String(await getCurrentWindow().isFullscreen())
        } catch (error) {
          nativeFullscreen = error instanceof Error ? `erro: ${error.message}` : 'erro ao consultar Tauri'
        }
      }

      snapshot.value = {
        checkedAt: new Date().toLocaleTimeString(),
        nativeFullscreen,
        browserFullscreen: document.fullscreenElement ? 'sim' : 'não',
        windowSize: `${window.innerWidth} × ${window.innerHeight} CSS px`,
        devicePixelRatio: String(window.devicePixelRatio || 1),
        rootRect: rectLabel(root),
        mainRect: rectLabel(main),
        viewportRect: rectLabel(viewport),
        canvasRect: rectLabel(canvas),
        canvasClientSize: readData(canvas, 'engineClientSize', canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : 'canvas não encontrado'),
        canvasBufferSize: readData(canvas, 'engineBufferSize', canvas ? `${canvas.width}x${canvas.height}` : 'canvas não encontrado'),
        canvasRenderCount: readData(canvas, 'engineRenderCount', 'nenhum quadro registrado'),
        lastRenderSize: readData(canvas, 'engineLastRenderSize', '—'),
        lastResize: timestampAge(canvas?.dataset.engineLastResizeAt),
        lastRender: timestampAge(canvas?.dataset.engineLastRenderAt),
        lastRenderError: readData(canvas, 'engineLastRenderError', 'nenhum'),
        resizeBlocked: readData(canvas, 'engineResizeBlocked', 'não'),
        webglReady: readData(canvas, 'engineWebglReady', 'não registrado'),
        webglError: readData(canvas, 'engineWebglError', 'nenhum'),
        canvasZIndex: canvasStyle?.zIndex ?? '—',
        contextLost: readData(canvas, 'engineContextLost', 'não registrado'),
        contextLostAt: timestampAge(canvas?.dataset.engineContextLostAt),
        fullscreenClass: root?.classList.contains('world-fullscreen') ? 'ativa' : 'inativa',
        rootDisplay: rootStyle?.display ?? '—',
        viewportDisplay: viewportStyle?.display ?? '—',
        canvasVisibility: canvasStyle ? `display=${canvasStyle.display}; visibility=${canvasStyle.visibility}; opacity=${canvasStyle.opacity}` : 'canvas não encontrado',
      }
    } finally {
      reading = false
    }
  }

  function requestRemeasure(): void {
    window.dispatchEvent(new Event('resize'))
    requestAnimationFrame(() => { void refreshSnapshot() })
  }

  function logSnapshot(): void {
    console.info('[Engine Prometheus · fullscreen diagnostic]', {
      ...snapshot.value,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    })
  }

  const copyMessage = ref('')

  async function copySnapshot(): Promise<void> {
    await refreshSnapshot()
    const payload = JSON.stringify({
      ...snapshot.value,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    }, null, 2)

    try {
      await navigator.clipboard.writeText(payload)
      copyMessage.value = 'Diagnóstico copiado'
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = payload
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-10000px'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      textarea.remove()
      copyMessage.value = copied
        ? 'Diagnóstico copiado'
        : 'Cópia bloqueada; use Registrar no console'
    }
  }

  onMounted(() => {
    void refreshSnapshot()
    timer = window.setInterval(() => { void refreshSnapshot() }, 750)
  })

  onBeforeUnmount(() => {
    disposed = true
    if (timer !== null) window.clearInterval(timer)
    timer = null
  })

  return { snapshot, requestRemeasure, refreshSnapshot, logSnapshot, copySnapshot, copyMessage }
}
