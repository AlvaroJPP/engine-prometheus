<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

defineEmits<{ exit: [] }>()

type Snapshot = {
  checkedAt: string
  nativeFullscreen: string
  browserFullscreen: string
  rootRect: string
  mainRect: string
  viewportRect: string
  canvasRect: string
  canvasClientSize: string
  canvasBufferSize: string
  lastResize: string
  lastRender: string
  resizeBlocked: string
  webglReady: string
  contextLost: string
  fullscreenClass: string
  rootDisplay: string
  viewportDisplay: string
}

const snapshot = ref<Snapshot>({
  checkedAt: '—',
  nativeFullscreen: 'consultando…',
  browserFullscreen: '—',
  rootRect: '—',
  mainRect: '—',
  viewportRect: '—',
  canvasRect: '—',
  canvasClientSize: '—',
  canvasBufferSize: '—',
  lastResize: '—',
  lastRender: '—',
  resizeBlocked: '—',
  webglReady: '—',
  contextLost: '—',
  fullscreenClass: '—',
  rootDisplay: '—',
  viewportDisplay: '—',
})

let timer: number | null = null
let reading = false

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

async function refreshSnapshot(): Promise<void> {
  if (reading) return
  reading = true
  try {
    const root = document.querySelector<HTMLElement>('.app')
    const main = root?.querySelector<HTMLElement>('.main') ?? null
    const viewport = root?.querySelector<HTMLElement>('.viewport') ?? null
    const canvas = viewport?.querySelector<HTMLCanvasElement>('canvas.canvas') ?? null
    const rootStyle = root ? getComputedStyle(root) : null
    const viewportStyle = viewport ? getComputedStyle(viewport) : null
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
      rootRect: rectLabel(root),
      mainRect: rectLabel(main),
      viewportRect: rectLabel(viewport),
      canvasRect: rectLabel(canvas),
      canvasClientSize: canvas ? canvas.dataset.engineClientSize || `${canvas.clientWidth}x${canvas.clientHeight}` : 'canvas não encontrado',
      canvasBufferSize: canvas ? canvas.dataset.engineBufferSize || `${canvas.width}x${canvas.height}` : 'canvas não encontrado',
      lastResize: timestampAge(canvas?.dataset.engineLastResizeAt),
      lastRender: timestampAge(canvas?.dataset.engineLastRenderAt),
      resizeBlocked: canvas?.dataset.engineResizeBlocked || 'não',
      webglReady: canvas?.dataset.engineWebglReady || 'não registrado',
      contextLost: canvas?.dataset.engineContextLost || 'não registrado',
      fullscreenClass: root?.classList.contains('world-fullscreen') ? 'ativa' : 'inativa',
      rootDisplay: rootStyle?.display ?? '—',
      viewportDisplay: viewportStyle?.display ?? '—',
    }
  } finally {
    reading = false
  }
}

function requestRemeasure(): void {
  window.dispatchEvent(new Event('resize'))
  requestAnimationFrame(() => { void refreshSnapshot() })
}

onMounted(() => {
  void refreshSnapshot()
  timer = window.setInterval(() => { void refreshSnapshot() }, 750)
})
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
  timer = null
})
</script>

<template>
  <section class="fullscreen-diagnostics" role="status" aria-live="polite">
    <header class="diagnostics-header">
      <div>
        <strong>DIAGNÓSTICO DA VIEWPORT</strong>
        <small>Atualizado às {{ snapshot.checkedAt }}</small>
      </div>
      <button type="button" class="diagnostics-close" title="Fechar tela cheia" @click="$emit('exit')">Sair</button>
    </header>
    <div class="diagnostics-state">
      <span :class="snapshot.lastRender === 'nenhum quadro registrado' ? 'state-warning' : 'state-ok'">
        Render: {{ snapshot.lastRender }}
      </span>
      <span>WebGL: {{ snapshot.webglReady }} · Contexto perdido: {{ snapshot.contextLost }}</span>
    </div>
    <dl>
      <dt>Tela cheia nativa Tauri</dt><dd>{{ snapshot.nativeFullscreen }}</dd>
      <dt>Fullscreen API do navegador</dt><dd>{{ snapshot.browserFullscreen }}</dd>
      <dt>Classe CSS de tela cheia</dt><dd>{{ snapshot.fullscreenClass }}</dd>
      <dt>Raiz .app</dt><dd>{{ snapshot.rootRect }} · display={{ snapshot.rootDisplay }}</dd>
      <dt>Área .main</dt><dd>{{ snapshot.mainRect }}</dd>
      <dt>Viewport</dt><dd>{{ snapshot.viewportRect }} · display={{ snapshot.viewportDisplay }}</dd>
      <dt>Canvas CSS</dt><dd>{{ snapshot.canvasRect }}</dd>
      <dt>Canvas / buffer WebGL</dt><dd>{{ snapshot.canvasClientSize }} / {{ snapshot.canvasBufferSize }}</dd>
      <dt>Último resize</dt><dd>{{ snapshot.lastResize }}</dd>
      <dt>Resize bloqueado</dt><dd>{{ snapshot.resizeBlocked }}</dd>
    </dl>
    <footer>
      <button type="button" @click="requestRemeasure">Forçar nova medição</button>
      <span>Deixe este painel aberto e tire uma captura se continuar preto.</span>
    </footer>
  </section>
</template>

<style scoped>
.fullscreen-diagnostics {
  position: fixed;
  z-index: 20050;
  top: 12px;
  left: 12px;
  width: min(455px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 12px;
  border: 1px solid #586474;
  border-radius: 8px;
  background: rgba(12, 16, 22, 0.97);
  color: #edf2f7;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  font: 11px/1.4 'IBM Plex Sans', sans-serif;
  pointer-events: auto;
}
.diagnostics-header, .diagnostics-header > div, footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.diagnostics-header strong { font-size: 11px; letter-spacing: .08em; }
.diagnostics-header small, footer span { display: block; color: #aab5c3; font-size: 10px; }
.diagnostics-header > div { align-items: flex-start; flex-direction: column; gap: 2px; }
button {
  flex: none;
  border: 1px solid #495669;
  border-radius: 5px;
  padding: 5px 9px;
  background: #222c39;
  color: #fff;
  cursor: pointer;
  font: inherit;
}
button:hover { background: #303d4d; }
.diagnostics-close { background: #51292b; border-color: #85444a; }
.diagnostics-state {
  display: grid;
  gap: 3px;
  margin: 10px 0 8px;
  padding: 7px;
  border-radius: 5px;
  background: #1a222d;
}
.state-ok { color: #9ae6b4; }
.state-warning { color: #f8c66a; }
dl {
  display: grid;
  grid-template-columns: 145px minmax(0, 1fr);
  gap: 5px 9px;
  margin: 0;
}
dt { color: #9eaaba; }
dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #f0f4fa; }
footer { justify-content: flex-start; align-items: flex-start; margin-top: 10px; padding-top: 9px; border-top: 1px solid #35404e; }
footer span { padding-top: 3px; }
</style>
