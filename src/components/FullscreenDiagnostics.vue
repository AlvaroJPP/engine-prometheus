<script setup lang="ts">
import { useFullscreenDiagnostics } from '@/composables/useFullscreenDiagnostics'

defineEmits<{ exit: [] }>()

const { snapshot, requestRemeasure, logSnapshot, copySnapshot, copyMessage } = useFullscreenDiagnostics()
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
        Render: {{ snapshot.lastRender }} · Quadros: {{ snapshot.canvasRenderCount }}
      </span>
      <span :class="snapshot.contextLost === 'true' ? 'state-warning' : 'state-ok'">
        WebGL: {{ snapshot.webglReady }} · Contexto perdido: {{ snapshot.contextLost }}
      </span>
      <span v-if="snapshot.webglError !== 'nenhum'" class="state-warning">
        Erro ao iniciar WebGL: {{ snapshot.webglError }}
      </span>
      <span v-if="snapshot.lastRenderError !== 'nenhum'" class="state-warning">
        Erro de renderização: {{ snapshot.lastRenderError }}
      </span>
    </div>
    <dl>
      <dt>Tela cheia nativa Tauri</dt><dd>{{ snapshot.nativeFullscreen }}</dd>
      <dt>Fullscreen API do navegador</dt><dd>{{ snapshot.browserFullscreen }}</dd>
      <dt>Classe CSS de tela cheia</dt><dd>{{ snapshot.fullscreenClass }}</dd>
      <dt>Janela / escala DPI</dt><dd>{{ snapshot.windowSize }} · DPR {{ snapshot.devicePixelRatio }}</dd>
      <dt>Raiz .app</dt><dd>{{ snapshot.rootRect }} · display={{ snapshot.rootDisplay }}</dd>
      <dt>Área .main</dt><dd>{{ snapshot.mainRect }}</dd>
      <dt>Viewport</dt><dd>{{ snapshot.viewportRect }} · display={{ snapshot.viewportDisplay }}</dd>
      <dt>Canvas CSS</dt><dd>{{ snapshot.canvasRect }} · {{ snapshot.canvasVisibility }} · z={{ snapshot.canvasZIndex }}</dd>
      <dt>Canvas / buffer WebGL</dt><dd>{{ snapshot.canvasClientSize }} / {{ snapshot.canvasBufferSize }}</dd>
      <dt>Último buffer desenhado</dt><dd>{{ snapshot.lastRenderSize }}</dd>
      <dt>Geometria enviada à GPU</dt><dd>{{ snapshot.drawCalls }} draw calls · {{ snapshot.triangles }} triângulos · {{ snapshot.points }} pontos · {{ snapshot.lines }} linhas</dd>
      <dt>Último resize</dt><dd>{{ snapshot.lastResize }}</dd>
      <dt>Resize bloqueado</dt><dd>{{ snapshot.resizeBlocked }}</dd>
      <dt>Perda do contexto</dt><dd>{{ snapshot.contextLostAt }}</dd>
    </dl>
    <footer>
      <button type="button" @click="requestRemeasure">Forçar nova medição</button>
      <button type="button" @click="copySnapshot">Copiar diagnóstico</button>
      <button type="button" @click="logSnapshot">Registrar no console</button>
      <span>{{ copyMessage || 'Use Ctrl+Shift+F para abrir este diagnóstico fora da tela cheia.' }}</span>
    </footer>
  </section>
</template>

<style scoped src="./FullscreenDiagnostics.css"></style>
