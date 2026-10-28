<script setup lang="ts">
import { reactive } from 'vue'
import RuntimeHUD from '@/components/RuntimeHUD.vue'
import GameUIRuntime from '@/components/GameUIRuntime.vue'
import { uiWorkspaceState } from '@/lib/ui/uiWorkspaceState'

const props = defineProps<{ context: Record<string, any> }>()
const context = props.context
const ctx = reactive(context)

function setExternalRef(name: string, element: unknown): void {
  const externalRef = context[name]
  if (externalRef && typeof externalRef === 'object' && 'value' in externalRef) {
    externalRef.value = element
  }
}
</script>

<template>
<main :ref="element => setExternalRef('viewportRoot', element)" class="viewport">
        <canvas :ref="element => setExternalRef('canvas', element)" class="canvas" :class="['tool-' + ctx.tool, ctx.viewportCursorClass]" />
        <div class="viewport-hud" role="group" aria-label="HUD da viewport">
        <slot name="game-overlay" />
        <GameUIRuntime
          v-if="ctx.executionMode === 'running'"
          :screens="uiWorkspaceState.screens"
          :game-variables="ctx.globalLogicVariables"
          @set-global-variable="ctx.setRuntimeGlobalVariable"
          @trigger-global-event="ctx.triggerRuntimeGlobalEvent"
        />
        <RuntimeHUD
          v-if="ctx.executionMode === 'running' || ctx.runtimeHudSettingsOpen"
          :player-name="ctx.playerModelName"
          :camera-mode="ctx.firstPersonMode ? 'Primeira pessoa' : ctx.CAMERA_LABELS[ctx.cameraPreset]"
          :fps="ctx.fps"
          :control-map-name="ctx.activeControlMap.name"
          :first-person="ctx.firstPersonMode"
          :settings-open="ctx.runtimeHudSettingsOpen"
          :editor-preview="ctx.executionMode !== 'running'"
          :world-fullscreen="ctx.worldFullscreen"
          :bindings="ctx.activeControlMap.bindings"
          :game-variables="ctx.globalLogicVariables"
          @toggle-camera="ctx.handleHudToggleCamera"
          @exit-runtime="ctx.handleHudExitRuntime"
          @settings-open-change="ctx.runtimeHudSettingsOpen = $event"
        />
        <div class="viewport-actions" aria-label="Ações rápidas da cena">
          <div class="quick-add-wrap">
            <button class="quick-add-trigger" :aria-expanded="ctx.quickAddOpen" aria-label="Adicionar objetos à cena" title="Adicionar objetos à cena." data-tooltip="Crie primitivas, plataformas, ponto inicial do jogador e exemplos interativos." @click.stop="ctx.quickAddOpen = !ctx.quickAddOpen"><span aria-hidden="true">＋</span><span class="viewport-action-label">Adicionar</span><span class="quick-add-chevron" aria-hidden="true">▾</span></button>
            <div v-if="ctx.quickAddOpen" class="quick-add-popover" @click.stop>
              <div class="quick-add-heading">CRIAR NA CENA</div>
              <button title="Adiciona um cubo à cena. Atalho indicado: 1." @click="ctx.addPrimitive('cube'); ctx.quickAddOpen = false"><span class="quick-add-icon">◇</span><span><strong>Cubo</strong><small>Objeto geométrico</small></span><kbd>1</kbd></button>
              <button title="Adiciona uma plataforma retangular. Atalho indicado: 2." @click="ctx.addPrimitive('platform'); ctx.quickAddOpen = false"><span class="quick-add-icon">▱</span><span><strong>Plataforma</strong><small>Superfície retangular</small></span><kbd>2</kbd></button>
              <button title="Cria um marcador para o ponto inicial do jogador." @click="ctx.addSpawnPlatform(); ctx.quickAddOpen = false"><span class="quick-add-icon">◎</span><span><strong>Spawn do jogador</strong><small>Ponto inicial do personagem</small></span></button>
              <button title="Cria um objeto de exemplo com evento de clique para testar o Visual Script." @click="ctx.addClickableCubeExample(); ctx.quickAddOpen = false"><span class="quick-add-icon">⌘</span><span><strong>Exemplo interativo</strong><small>Objeto com evento de clique</small></span></button>
            </div>
          </div>
          <button class="model-import-launch" title="Importa arquivos 3D, configura o modelo e as animações antes de salvar na biblioteca." aria-label="Importar modelo 3D" @click="ctx.previewComponentAsset = null; ctx.modelImportOpen = true"><span aria-hidden="true">＋</span><span class="viewport-action-label">Importar 3D</span></button>
        </div>
        <div v-if="!ctx.modelImportOpen && ctx.executionMode !== 'running'" class="viewport-fps viewport-layout-positioned" :style="ctx.viewportLayoutStyle('fps')" aria-label="Diagnóstico de renderização">
          <div class="viewport-fps-head" :class="{ 'fps-low': ctx.fps > 0 && ctx.fps < 30, 'fps-medium': ctx.fps >= 30 && ctx.fps < 50 }">
            <span class="fps-indicator" />
            <span>FPS</span>
            <strong>{{ ctx.fps || '—' }}</strong>
          </div>
          <div class="viewport-render-stats">
            <span><strong>{{ (ctx.renderStats.triangles / 1000).toFixed(1) }}k</strong> tris</span>
            <span><strong>{{ ctx.renderStats.drawCalls }}</strong> draws</span>
            <span title="Tempo de submissão dos comandos WebGL"><strong>{{ ctx.renderStats.cpuRenderMs.toFixed(1) }}</strong> ms render</span>
            <span title="Tempo gasto atualizando controles, colisões e sistemas do motor"><strong>{{ ctx.renderStats.cpuUpdateMs.toFixed(1) }}</strong> ms loop</span>
          </div>
        </div>
        <div class="chips">
          <span class="chip grid-state">{{ ctx.gridVisible ? 'MALHA ATIVA' : 'MALHA OCULTA' }}</span>
          <span class="chip">ÓRBITA LIVRE</span>
        </div>
        <div class="axes viewport-layout-positioned" :style="ctx.viewportLayoutStyle('axes')">
          <span class="axis"><b class="ax-x">X</b> largura</span>
          <span class="axis"><b class="ax-y">Y</b> altura</span>
          <span class="axis"><b class="ax-z">Z</b> profundidade</span>
        </div>
        <div class="statusbar" aria-label="Status do editor">
          <span class="seg">{{ ctx.groupSelection.length > 1 ? ctx.groupSelection.length + ' objetos selecionados' : ctx.inspectorMode === 'terrain' ? 'Terreno selecionado' : ctx.selectedId ? '1 objeto selecionado' : ctx.objects.length + ' objetos na cena' }}</span>
          <span class="seg"><i class="dot ok" /> Motor 3D ativo</span>
          <span class="seg">Terreno procedural</span>
          <span class="seg grow-text">{{ ctx.status || ctx.hint }}</span>
          <span class="seg status-version">v{{ ctx.ENGINE_VERSION }}</span>
        </div>

        <div
          v-if="ctx.viewportLayoutConfigOpen && ctx.executionMode === 'edit' && !ctx.worldFullscreen"
          id="viewport-layout-config-panel"
          class="viewport-layout-config-panel"
          role="dialog"
          aria-label="Configuração da viewport"
          @pointerdown.stop
          @wheel.stop
        >
          <header class="viewport-layout-config-heading">
            <span class="viewport-layout-config-icon" aria-hidden="true">⚙</span>
            <div><strong>Layout da viewport</strong><small>Posicione e dimensione os menus do editor</small></div>
            <button type="button" class="viewport-layout-close" aria-label="Fechar configurações" @click="ctx.toggleViewportLayoutConfig">×</button>
          </header>

          <div class="viewport-layout-items" role="group" aria-label="Selecionar menu para ajustar">
            <button
              v-for="item in ctx.selectableViewportLayoutItems"
              :key="item.id"
              type="button"
              class="viewport-layout-item"
              :class="{ active: ctx.activeViewportLayoutItem === item.id }"
              @click="ctx.activeViewportLayoutItem = item.id"
            >
              <span class="viewport-layout-item-icon" aria-hidden="true">{{ item.icon }}</span>
              <span class="viewport-layout-item-copy"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
              <span class="viewport-layout-item-check" aria-hidden="true">{{ ctx.activeViewportLayoutItem === item.id ? '●' : '○' }}</span>
            </button>
          </div>

          <div class="viewport-layout-adjustments">
            <div class="viewport-layout-section-title">POSIÇÃO E TAMANHO</div>
            <label class="viewport-layout-range">
              <span>Horizontal <strong>{{ Math.round(ctx.viewportLayout[ctx.activeViewportLayoutItem].x * 100) }}%</strong></span>
              <input type="range" min="0" max="100" step="1" :value="Math.round(ctx.viewportLayout[ctx.activeViewportLayoutItem].x * 100)" @input="ctx.updateViewportLayoutPercent('x', Number(($event.target as HTMLInputElement).value))" @change="ctx.persistViewportLayout" />
            </label>
            <label class="viewport-layout-range">
              <span>Vertical <strong>{{ Math.round(ctx.viewportLayout[ctx.activeViewportLayoutItem].y * 100) }}%</strong></span>
              <input type="range" min="0" max="100" step="1" :value="Math.round(ctx.viewportLayout[ctx.activeViewportLayoutItem].y * 100)" @input="ctx.updateViewportLayoutPercent('y', Number(($event.target as HTMLInputElement).value))" @change="ctx.persistViewportLayout" />
            </label>
            <label class="viewport-layout-range">
              <span>Tamanho <strong>{{ Math.round(ctx.viewportLayout[ctx.activeViewportLayoutItem].scale * 100) }}%</strong></span>
              <input type="range" min="55" max="160" step="5" :value="Math.round(ctx.viewportLayout[ctx.activeViewportLayoutItem].scale * 100)" @input="ctx.updateViewportLayoutScale(Number(($event.target as HTMLInputElement).value))" @change="ctx.persistViewportLayout" />
            </label>
            <div class="viewport-layout-actions">
              <button type="button" class="viewport-layout-secondary" @click="ctx.resetViewportLayoutItem(ctx.activeViewportLayoutItem)">Restaurar este menu</button>
              <button type="button" class="viewport-layout-secondary" @click="ctx.resetAllViewportLayout">Restaurar tudo</button>
            </div>
          </div>

          <div class="viewport-layout-panel-footer">
            <button type="button" class="viewport-layout-drag-toggle" :class="{ active: ctx.viewportLayoutEditMode }" @click="ctx.viewportLayoutEditMode = !ctx.viewportLayoutEditMode">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1v14M1 8h14M5 3l3-2 3 2M5 13l3 2 3-2M3 5 1 8l2 3M13 5l2 3-2 3" /></svg>
              {{ ctx.viewportLayoutEditMode ? 'Concluir posicionamento' : 'Mover e redimensionar na viewport' }}
            </button>
            <button type="button" class="viewport-layout-hud-button" @click="ctx.openHudSettingsFromViewportLayout">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4" /></svg>
              Configurar HUD
            </button>
            <p>Arraste pelo ícone de movimento ou use a alça no canto inferior direito de cada contorno. Tudo fica limitado à área útil da viewport.</p>
          </div>
        </div>

        <div v-if="ctx.viewportLayoutEditMode && ctx.executionMode === 'edit' && !ctx.worldFullscreen" class="viewport-layout-handles" aria-label="Controles para mover e redimensionar menus">
          <div v-for="item in ctx.selectableViewportLayoutItems" :key="'outline-' + item.id" class="viewport-layout-outline" :style="ctx.viewportLayoutOutlineStyle(item.id)">
            <button type="button" class="viewport-layout-move-handle" :title="'Arrastar para mover: ' + item.label" :aria-label="'Mover ' + item.label" @pointerdown="ctx.beginViewportLayoutDrag($event, item.id, 'move')"><span aria-hidden="true">⠿</span></button>
            <span class="viewport-layout-outline-name" aria-hidden="true">{{ item.label }}</span>
            <button type="button" class="viewport-layout-resize-handle" :title="'Arrastar para redimensionar: ' + item.label" :aria-label="'Redimensionar ' + item.label" @pointerdown="ctx.beginViewportLayoutDrag($event, item.id, 'resize')"><span aria-hidden="true">↘</span></button>
          </div>
        </div>
        </div>
      </main>
</template>
