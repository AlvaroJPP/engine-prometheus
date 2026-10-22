<script setup lang="ts">
import { reactive } from 'vue'
import EditorTopBar from '@/components/EditorTopBar.vue'
import ControlMapsDialog from '@/components/ControlMapsDialog.vue'
import EditorToolbar from '@/components/EditorToolbar.vue'
import SceneHierarchy from '@/components/SceneHierarchy.vue'
import PlayerHUD from '@/components/PlayerHUD.vue'
import ModelImportDialog from '@/components/ModelImportDialog.vue'
import InspectorPanel from '@/components/InspectorPanel.vue'
import VisualScriptGraph from '@/components/VisualScriptGraph.vue'
const props = defineProps<{ context: Record<string, any> }>()
const context = props.context
const ctx = reactive(context)
function setExternalRef(name: string, element: unknown): void {
  const externalRef = context[name]
  if (externalRef && typeof externalRef === 'object' && 'value' in externalRef) externalRef.value = element
}
</script>

<template>
  <div :ref="element => setExternalRef('appRoot', element)" class="app" :style="ctx.worldFullscreenStyle" :class="{ 'is-running': ctx.executionMode === 'running', 'world-fullscreen': ctx.worldFullscreen, 'sidebar-collapsed': ctx.sidebarCollapsed }">
    <EditorTopBar
      v-model:project-name="ctx.projectName"
      :viewport-layout-style="ctx.viewportLayoutStyle('render')"
      :dirty="ctx.dirty"
      :camera-label="ctx.cameraLabel"
      :first-person-mode="ctx.firstPersonMode"
      :render-distance="ctx.renderDistance"
      :render-all="ctx.renderAll"
      :performance-mode="ctx.performanceMode"
      :render-resolution-scale="ctx.renderResolutionScale"
      :render-fps-limit="ctx.renderFpsLimit"
      :render-fog-enabled="ctx.renderFogEnabled"
      :render-fog-distance-scale="ctx.renderFogDistanceScale"
      :render-dynamic-resolution="ctx.renderDynamicResolution"
      :render-dynamic-resolution-target-fps="ctx.renderDynamicResolutionTargetFps"
      :render-dynamic-resolution-min-scale="ctx.renderDynamicResolutionMinScale"
      :grass-visible="ctx.grassVisible"
      :grass-use-detailed-model="ctx.grassUseDetailedModel"
      :grass-density-percent="ctx.grassDensityPercent"
      :grass-render-distance-mode="ctx.grassRenderDistanceMode"
      :grass-render-distance="ctx.grassRenderDistance"
      :grass-near-detail-distance="ctx.grassNearDetailDistance"
      :grass-middle-detail-distance="ctx.grassMiddleDetailDistance"
      :grass-occlusion-enabled="ctx.grassOcclusionEnabled"
      :grass-occlusion-interval-ms="ctx.grassOcclusionIntervalMs"
      :wall-occlusion-quality="ctx.wallOcclusionQuality"
      :grass-wind-percent="ctx.grassWindPercent"
      :execution-mode="ctx.executionMode"
      :world-fullscreen="ctx.worldFullscreen"
      :viewport-layout-config-open="ctx.viewportLayoutConfigOpen"
      :objects="ctx.objects"
      :components="ctx.placeableSavedComponents"
      @select-object="ctx.selectItem"
      @place-component="ctx.placeSavedComponent"
      @open-model-import="ctx.previewComponentAsset = null; ctx.modelImportOpen = true"
      @run-world="ctx.runWorld"
      @edit-world="ctx.returnToEdit"
      @toggle-world-fullscreen="ctx.toggleWorldFullscreen"
      @toggle-viewport-layout-config="ctx.toggleViewportLayoutConfig"
      @render-distance-change="ctx.setRenderDistance"
      @render-all-change="ctx.setRenderAll"
      @performance-mode-change="ctx.setPerformanceMode"
      @render-resolution-scale-change="ctx.setRenderResolutionScale"
      @render-fps-limit-change="ctx.setRenderFpsLimit"
      @render-fog-enabled-change="ctx.setRenderFogEnabled"
      @render-fog-distance-scale-change="ctx.setRenderFogDistanceScale"
      @render-dynamic-resolution-change="ctx.setRenderDynamicResolution"
      @render-dynamic-resolution-target-fps-change="ctx.setRenderDynamicResolutionTargetFps"
      @render-dynamic-resolution-min-scale-change="ctx.setRenderDynamicResolutionMinScale"
      @grass-visible-change="ctx.setGrassVisible"
      @grass-use-detailed-model-change="ctx.setGrassUseDetailedModel"
      @grass-density-change="ctx.setGrassDensityPercent"
      @grass-render-distance-change="ctx.setGrassRenderDistance"
      @grass-near-detail-change="(value) => ctx.setGrassDetailDistance('near', value)"
      @grass-middle-detail-change="(value) => ctx.setGrassDetailDistance('middle', value)"
      @grass-occlusion-enabled-change="ctx.setGrassOcclusionEnabled"
      @grass-occlusion-interval-change="ctx.setGrassOcclusionInterval"
      @wall-occlusion-quality-change="ctx.setWallOcclusionQuality"
      @grass-wind-change="ctx.setGrassWindPercent"
      @toggle-first-person="ctx.toggleFirstPerson"
      @open-control-maps="ctx.controlMapsOpen = true"
      @mark-dirty="ctx.markDirty"
      @new-project="ctx.newProject"
      @open-project="ctx.openProject"
      @save-project="ctx.saveProject"
      @cycle-camera="ctx.cycleCameraView"
    />

    <ControlMapsDialog
      v-if="ctx.controlMapsOpen"
      :open="ctx.controlMapsOpen"
      :settings="ctx.controlMapSettings"
      @update:open="controlMapsOpen = $event"
      @update:settings="updateControlMapSettings"
    />

    <EditorToolbar
      class="viewport-layout-positioned"
      :style="ctx.viewportLayoutStyle('tools')"
      :tools="ctx.TOOLS"
      :transforms="ctx.TRANSFORMS"
      :tool="ctx.tool"
      :transform="ctx.transform"
      :inspector-mode="ctx.inspectorMode"
      :graph-open="ctx.graphOpen"
      :grid-visible="ctx.gridVisible"
      :polygon-lines-visible="ctx.polygonLinesVisible"
      :performance-mode="ctx.performanceMode"
      @set-tool="ctx.setTool"
      @set-transform="ctx.setTransform"
      @toggle-graph="ctx.graphOpen = !ctx.graphOpen"
      @open-model-import="ctx.previewComponentAsset = null; ctx.modelImportOpen = true"
      @add-primitive="ctx.addPrimitive"
      @add-spawn-platform="ctx.addSpawnPlatform"
      @add-clickable-example="ctx.addClickableCubeExample"
      @toggle-grid="ctx.toggleGrid"
      @toggle-polygon-lines="ctx.togglePolygonLines"
      @toggle-performance-mode="ctx.togglePerformanceMode"
    />

    <button
      v-if="ctx.sidebarCollapsed"
      class="sidebar-hamburger"
      type="button"
      aria-label="Expandir painel lateral"
      title="Expandir hierarquia e biblioteca"
      :aria-expanded="!ctx.sidebarCollapsed"
      @click="ctx.sidebarCollapsed = false"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 5.5h14M3 10h14M3 14.5h14" />
        <path d="m7 7 3 3-3 3" />
      </svg>
      <span>Abrir painel</span>
    </button>

    <div v-if="ctx.sidebarCollapsed" class="collapsed-sidebar-actions" aria-label="Criação e importação">
      <div class="quick-add-wrap collapsed-sidebar-add-wrap">
        <button
          class="collapsed-sidebar-action collapsed-sidebar-add-trigger"
          type="button"
          :aria-expanded="ctx.quickAddOpen"
          aria-haspopup="menu"
          title="Adicionar objetos à cena"
          @click.stop="ctx.quickAddOpen = !ctx.quickAddOpen"
        >
          <span class="collapsed-sidebar-action-icon" aria-hidden="true">＋</span>
          <span>Adicionar</span>
          <span class="quick-add-chevron" aria-hidden="true">▾</span>
        </button>
        <div v-if="ctx.quickAddOpen" class="quick-add-popover collapsed-sidebar-add-popover" role="menu" @click.stop>
          <div class="quick-add-heading">CRIAR NA CENA</div>
          <button role="menuitem" title="Adiciona um cubo à cena. Atalho indicado: 1." @click="ctx.addPrimitive('cube'); ctx.quickAddOpen = false"><span class="quick-add-icon">◇</span><span><strong>Cubo</strong><small>Objeto geométrico</small></span><kbd>1</kbd></button>
          <button role="menuitem" title="Adiciona uma plataforma retangular. Atalho indicado: 2." @click="ctx.addPrimitive('platform'); ctx.quickAddOpen = false"><span class="quick-add-icon">▱</span><span><strong>Plataforma</strong><small>Superfície retangular</small></span><kbd>2</kbd></button>
          <button role="menuitem" title="Cria um marcador para o ponto inicial do jogador." @click="ctx.addSpawnPlatform(); ctx.quickAddOpen = false"><span class="quick-add-icon">◎</span><span><strong>Spawn do jogador</strong><small>Ponto inicial do personagem</small></span></button>
          <button role="menuitem" title="Cria um objeto de exemplo com evento de clique para testar o Visual Script." @click="ctx.addClickableCubeExample(); ctx.quickAddOpen = false"><span class="quick-add-icon">⌘</span><span><strong>Exemplo interativo</strong><small>Objeto com evento de clique</small></span></button>
        </div>
      </div>
      <button
        class="collapsed-sidebar-action"
        type="button"
        title="Importa arquivos 3D e configura modelo e animações"
        aria-label="Importar modelo 3D"
        @click="ctx.quickAddOpen = false; ctx.previewComponentAsset = null; ctx.modelImportOpen = true"
      >
        <span class="collapsed-sidebar-action-icon" aria-hidden="true">▧</span>
        <span>Importar 3D</span>
      </button>
    </div>

    <div class="main">
      <SceneHierarchy
        v-model:root-open="ctx.rootOpen"
        :components="ctx.savedComponents"
        :objects="ctx.objects"
        :terrain="ctx.terrain"
        :selected-id="ctx.selectedId"
        :group-selection="ctx.groupSelection"
        :terrain-id="ctx.TERRAIN_ID"
        @select-item="ctx.selectItem"
        @group-selected="ctx.groupSelectedObjects"
        @ungroup-selected="ctx.ungroupSelectedObjects"
        @toggle-terrain="ctx.toggleTerrain"
        @toggle-visible="ctx.toggleVisible"
        @toggle-lock="ctx.toggleObjectLock"
        @toggle-wireframe="ctx.toggleObjectWireframe"
        @place-component="ctx.placeSavedComponent"
        @rename-component="ctx.renameSavedComponent"
        @delete-component="ctx.removeSavedComponent"
        @preview-component="ctx.previewSavedComponent"
        @move-component="ctx.moveSavedComponentGroup"
        @use-animation-source="ctx.useSavedAnimationSource"
        @open-model-import="ctx.previewAnimationSourceAsset = null; ctx.previewComponentAsset = null; ctx.modelImportOpen = true"
        @open-components="ctx.backfillMissingComponentThumbnails"
        @collapse-sidebar="ctx.sidebarCollapsed = true"
      />

      <!-- Viewport -->
      <main :ref="element => setExternalRef('viewportRoot', element)" class="viewport">
        <canvas :ref="element => setExternalRef('canvas', element)" class="canvas" :class="['tool-' + ctx.tool, ctx.viewportCursorClass]" />
        <PlayerHUD
          v-if="ctx.executionMode === 'running' || ctx.playerHudSettingsOpen"
          :player-name="ctx.playerModelName"
          :camera-mode="ctx.firstPersonMode ? 'Primeira pessoa' : ctx.CAMERA_LABELS[ctx.cameraPreset]"
          :fps="ctx.fps"
          :control-map-name="ctx.activeControlMap.name"
          :first-person="ctx.firstPersonMode"
          :settings-open="ctx.playerHudSettingsOpen"
          :editor-preview="ctx.executionMode !== 'running'"
          :world-fullscreen="ctx.worldFullscreen"
          :bindings="ctx.activeControlMap.bindings"
          :game-variables="ctx.globalLogicVariables"
          @toggle-camera="ctx.handleHudToggleCamera"
          @exit-runtime="ctx.handleHudExitRuntime"
          @settings-open-change="ctx.playerHudSettingsOpen = $event"
          @set-global-variable="ctx.handleHudGlobalVariable"
        />
        <div class="viewport-actions" aria-label="Ações rápidas da cena">
          <div class="quick-add-wrap">
            <button class="quick-add-trigger" :aria-expanded="ctx.quickAddOpen" title="Adicionar objetos à cena." data-tooltip="Crie primitivas, plataformas, ponto inicial do jogador e exemplos interativos." @click.stop="ctx.quickAddOpen = !ctx.quickAddOpen"><span>＋</span> Adicionar <span class="quick-add-chevron">▾</span></button>
            <div v-if="ctx.quickAddOpen" class="quick-add-popover" @click.stop>
              <div class="quick-add-heading">CRIAR NA CENA</div>
              <button title="Adiciona um cubo à cena. Atalho indicado: 1." @click="ctx.addPrimitive('cube'); ctx.quickAddOpen = false"><span class="quick-add-icon">◇</span><span><strong>Cubo</strong><small>Objeto geométrico</small></span><kbd>1</kbd></button>
              <button title="Adiciona uma plataforma retangular. Atalho indicado: 2." @click="ctx.addPrimitive('platform'); ctx.quickAddOpen = false"><span class="quick-add-icon">▱</span><span><strong>Plataforma</strong><small>Superfície retangular</small></span><kbd>2</kbd></button>
              <button title="Cria um marcador para o ponto inicial do jogador." @click="ctx.addSpawnPlatform(); ctx.quickAddOpen = false"><span class="quick-add-icon">◎</span><span><strong>Spawn do jogador</strong><small>Ponto inicial do personagem</small></span></button>
              <button title="Cria um objeto de exemplo com evento de clique para testar o Visual Script." @click="ctx.addClickableCubeExample(); ctx.quickAddOpen = false"><span class="quick-add-icon">⌘</span><span><strong>Exemplo interativo</strong><small>Objeto com evento de clique</small></span></button>
            </div>
          </div>
          <button class="model-import-launch" title="Importa arquivos 3D, configura o modelo e as animações antes de salvar na biblioteca." aria-label="Importar modelo 3D" @click="ctx.previewComponentAsset = null; ctx.modelImportOpen = true"><span aria-hidden="true">＋</span> Importar 3D</button>
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
      </main>

      <!-- Inspetor -->
      <InspectorPanel :context="context" />
    </div>
    <VisualScriptGraph :context="context" />
    <div v-if="ctx.ioProgress.active" class="project-io-overlay" role="status" aria-live="polite">
      <section class="project-io-card">
        <div class="project-io-icon">{{ ctx.ioProgress.kind === 'save' ? '↓' : '↑' }}</div>
        <div class="project-io-heading">{{ ctx.ioProgress.kind === 'save' ? 'Salvando projeto' : 'Carregando projeto' }}</div>
        <p class="project-io-message">{{ ctx.ioProgress.message }}</p>
        <div class="project-io-track"><div class="project-io-fill" :style="{ width: ctx.ioProgress.percent + '%' }"></div></div>
        <div class="project-io-meta"><span>Não feche o aplicativo durante esta operação</span><strong>{{ ctx.ioProgress.percent }}%</strong></div>
      </section>
    </div>
    <ModelImportDialog :open="ctx.modelImportOpen" :initial-asset="ctx.previewComponentAsset" :animation-source-asset="ctx.previewAnimationSourceAsset" :animation-source-options="ctx.savedAnimationSourceOptions" :control-map="ctx.activeControlMap.bindings" :save-model="ctx.handleModelImport" @close="ctx.closeModelImport" @use-player="ctx.handleUsePlayerModel" @save-animation-source="ctx.handleSaveAnimationSource" @load-animation-source="ctx.useSavedAnimationSource" />
  </div>
</template>
