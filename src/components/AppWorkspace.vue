<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useAppController } from '@/composables/useAppController'
import EditorTopBar from '@/components/EditorTopBar.vue'
import ControlMapsDialog from '@/components/ControlMapsDialog.vue'
import EditorToolbar from '@/components/EditorToolbar.vue'
import SceneHierarchy from '@/components/SceneHierarchy.vue'
import ModelImportDialog from '@/components/ModelImportDialog.vue'
import InspectorPanel from '@/components/InspectorPanel.vue'
import EditorViewport from '@/components/EditorViewport.vue'
import VisualScriptGraph from '@/components/VisualScriptGraph.vue'
import FullscreenDiagnostics from '@/components/FullscreenDiagnostics.vue'
import GameOverlayHost from '@/components/GameOverlayHost.vue'
import UIWorkspace from '@/components/UIWorkspace.vue'
const context = useAppController() as Record<string, any>
const ctx = reactive(context)
function setExternalRef(name: string, element: unknown): void {
  const externalRef = context[name]
  if (externalRef && typeof externalRef === 'object' && 'value' in externalRef) externalRef.value = element
}
const diagnosticsOpen = ref(false)
const uiWorkspaceOpen = ref(false)

function handleDiagnosticsShortcut(event: KeyboardEvent): void {
  const diagnosticChord = (event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyF'
  const emergencyShortcut = event.key === 'F9' && !event.ctrlKey && !event.altKey && !event.metaKey
  if (!diagnosticChord && !emergencyShortcut) return
  event.preventDefault()
  event.stopPropagation()
  diagnosticsOpen.value = !diagnosticsOpen.value
}

function handleDiagnosticsExit(): void {
  diagnosticsOpen.value = false
  if (ctx.worldFullscreen) void ctx.toggleWorldFullscreen()
}

// Captura antes dos handlers do editor/WebGL para continuar acessível com o canvas focado.
onMounted(() => window.addEventListener('keydown', handleDiagnosticsShortcut, true))
onBeforeUnmount(() => window.removeEventListener('keydown', handleDiagnosticsShortcut, true))
</script>

<template>
  <div :ref="element => setExternalRef('appRoot', element)" class="app" :class="{ 'is-running': ctx.executionMode === 'running', 'world-fullscreen': ctx.worldFullscreen, 'sidebar-collapsed': ctx.sidebarCollapsed }">
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
      @open-ui-workspace="uiWorkspaceOpen = true"
    />

    <UIWorkspace
      v-if="uiWorkspaceOpen"
      :project-name="ctx.projectName"
      @close="uiWorkspaceOpen = false"
    />

    <ControlMapsDialog
      v-if="ctx.controlMapsOpen"
      :open="ctx.controlMapsOpen"
      :settings="ctx.controlMapSettings"
      @update:open="ctx.controlMapsOpen = $event"
      @update:settings="ctx.updateControlMapSettings"
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
      <EditorViewport :context="context">
        <template #game-overlay>
          <GameOverlayHost
            :engine="ctx.engineInstance"
            :behavior-packages="ctx.behaviorPackages"
            :bindings="ctx.activeControlMap.bindings"
            :game-variables="ctx.globalLogicVariables"
            :editor-preview="ctx.executionMode !== 'running'"
          />
        </template>
      </EditorViewport>

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
    <FullscreenDiagnostics v-if="diagnosticsOpen" @exit="handleDiagnosticsExit" />
  </div>
</template>
