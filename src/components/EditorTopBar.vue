<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{
  projectName: string
  viewportLayoutStyle: Record<string, string>
  dirty: boolean
  cameraLabel: string
  firstPersonMode: boolean
  renderDistance: number
  renderAll: boolean
  performanceMode: 'quality' | 'balanced' | 'economy' | 'auto'
  renderResolutionScale: number
  renderFpsLimit: number
  renderFogEnabled: boolean
  renderFogDistanceScale: number
  renderDynamicResolution: boolean
  renderDynamicResolutionTargetFps: number
  renderDynamicResolutionMinScale: number
  grassVisible: boolean
  grassUseDetailedModel: boolean
  grassDensityPercent: number
  grassRenderDistanceMode: 'global' | 'all' | 'custom'
  grassRenderDistance: number
  grassNearDetailDistance: number
  grassMiddleDetailDistance: number
  grassOcclusionEnabled: boolean
  grassOcclusionIntervalMs: number
  wallOcclusionQuality: 'fast' | 'precise'
  grassWindPercent: number
  executionMode: 'edit' | 'running'
  worldFullscreen: boolean
  viewportLayoutConfigOpen: boolean
  objects: Array<{ id: string; name: string }>
  components: Array<{ id: string; name: string }>
}>()

const emit = defineEmits<{
  'update:projectName': [value: string]
  'mark-dirty': []
  'new-project': []
  'open-project': []
  'save-project': [saveAs: boolean]
  'cycle-camera': []
  'toggle-first-person': []
  'render-distance-change': [value: number]
  'render-all-change': [value: boolean]
  'performance-mode-change': [value: 'quality' | 'balanced' | 'economy' | 'auto']
  'render-resolution-scale-change': [value: number]
  'render-fps-limit-change': [value: number]
  'render-fog-enabled-change': [value: boolean]
  'render-fog-distance-scale-change': [value: number]
  'render-dynamic-resolution-change': [value: boolean]
  'render-dynamic-resolution-target-fps-change': [value: number]
  'render-dynamic-resolution-min-scale-change': [value: number]
  'grass-visible-change': [value: boolean]
  'grass-use-detailed-model-change': [value: boolean]
  'grass-density-change': [value: number]
  'grass-render-distance-change': [value: string]
  'grass-near-detail-change': [value: number]
  'grass-middle-detail-change': [value: number]
  'grass-occlusion-enabled-change': [value: boolean]
  'grass-occlusion-interval-change': [value: number]
  'wall-occlusion-quality-change': [value: 'fast' | 'precise']
  'grass-wind-change': [value: number]
  'open-control-maps': []
  'open-ui-workspace': []
  'open-player-workspace': []
  'run-world': []
  'edit-world': []
  'toggle-world-fullscreen': []
  'toggle-viewport-layout-config': []
  'select-object': [id: string]
  'place-component': [id: string]
  'open-model-import': []
}>()
type SearchResult = { key: string; label: string; detail: string; action: 'object' | 'component' | 'save' | 'import' | 'edit' | 'run' | 'camera' | 'controls'; id?: string }
const searchQuery = ref('')
const fullscreenToggleTitle = computed(() => props.worldFullscreen ? 'Sair da tela cheia do mundo' : 'Expandir o mundo em tela cheia')
const grassRenderDistanceOption = computed(() => props.grassRenderDistanceMode === 'custom'
  ? String(props.grassRenderDistance)
  : props.grassRenderDistanceMode)
const searchResults = computed<SearchResult[]>(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('pt-BR')
  if (!query) return []
  const results: SearchResult[] = []
  const commands: SearchResult[] = [
    { key: 'cmd-save', label: 'Salvar projeto', detail: 'Arquivo · Ctrl S', action: 'save' },
    { key: 'cmd-import', label: 'Importar modelo 3D', detail: 'Comando', action: 'import' },
    { key: 'cmd-edit', label: 'Modo de edição', detail: 'Modo', action: 'edit' },
    { key: 'cmd-run', label: 'Jogar', detail: 'Executar cena', action: 'run' },
    { key: 'cmd-camera', label: 'Câmera livre', detail: 'Viewport', action: 'camera' },
    { key: 'cmd-controls', label: 'Controles', detail: 'Configurações', action: 'controls' },
  ]
  results.push(...commands.filter(item => item.label.toLocaleLowerCase('pt-BR').includes(query)))
  results.push(...props.objects.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(query)).slice(0, 5).map(item => ({ key: 'obj-' + item.id, label: item.name, detail: 'Objeto da cena', action: 'object' as const, id: item.id })))
  results.push(...props.components.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(query)).slice(0, 5).map(item => ({ key: 'component-' + item.id, label: item.name, detail: 'Inserir componente', action: 'component' as const, id: item.id })))
  return results.slice(0, 8)
})
function activateSearchResult(result: SearchResult) {
  if (result.action === 'object' && result.id) emit('select-object', result.id)
  else if (result.action === 'component' && result.id) emit('place-component', result.id)
  else if (result.action === 'save') emit('save-project', false)
  else if (result.action === 'import') emit('open-model-import')
  else if (result.action === 'edit') emit('edit-world')
  else if (result.action === 'run') emit('run-world')
  else if (result.action === 'camera') emit('cycle-camera')
  else if (result.action === 'controls') emit('open-control-maps')
  searchQuery.value = ''
  document.getElementById('global-editor-search')?.blur()
}
function handleGlobalShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    document.getElementById('global-editor-search')?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', handleGlobalShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', handleGlobalShortcut))

</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <div class="brand-mark" role="img" aria-label="Prometheus Engine" title="Prometheus Engine">
        <span class="logo" aria-hidden="true">P</span>
      </div>
      <span class="topbar-divider" aria-hidden="true"></span>

      <div class="project-shell">
        <div class="project-name-field">
          <input :value="projectName" class="pname" aria-label="Nome do projeto" title="Edite o nome do projeto; alterações precisam ser salvas." spellcheck="false" @input="emit('update:projectName', ($event.target as HTMLInputElement).value); emit('mark-dirty')" />
          <span class="save-state" :class="dirty ? 'is-dirty' : 'is-saved'" :title="dirty ? 'Há alterações não salvas' : 'Todas as alterações estão salvas'" :aria-label="dirty ? 'Projeto não salvo' : 'Projeto salvo'"><i class="dot" :class="dirty ? 'warn' : 'ok'" />{{ dirty ? 'Não salvo' : 'Salvo' }}</span>
        </div>
        <span class="project-divider" aria-hidden="true"></span>
        <details class="file-menu">
          <summary data-tooltip="Crie um projeto, abra um arquivo existente ou salve as alterações.">
            Arquivo
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </summary>
          <div class="file-menu-popover">
            <button title="Cria um projeto vazio em uma nova cena." @click="emit('new-project')">Novo projeto</button>
            <button title="Abre um projeto salvo no formato do Engine Prometheus." @click="emit('open-project')">Abrir projeto…</button>
            <button @click="emit('save-project', false)">Salvar <kbd>Ctrl S</kbd></button>
            <button title="Salva o projeto com outro nome ou em outro arquivo." @click="emit('save-project', true)">Salvar como…</button>
          </div>
        </details>
      </div>

      <button class="topbar-save" title="Salvar projeto (Ctrl+S)" @click="emit('save-project', false)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h8l2 2v8H3z" /><path d="M5 3v4h5V3M5 13V9h6v4" /></svg>
        <span>Salvar</span>
      </button>
    </div>

        <div class="mode-segment" aria-label="Modo do editor">
      <button
        v-if="executionMode === 'edit' && !worldFullscreen"
        class="viewport-layout-config-action"
        type="button"
        :aria-expanded="viewportLayoutConfigOpen"
        aria-controls="viewport-layout-config-panel"
        aria-label="Configurar layout da viewport"
        title="Configurar posições e tamanhos da viewport"
        data-tooltip="Posição, escala e tamanho dos menus da viewport."
        @click="emit('toggle-viewport-layout-config')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96c-.5-.38-1.03-.69-1.62-.93l-.36-2.53a.5.5 0 0 0-.49-.41h-3.84a.5.5 0 0 0-.49.41L9.22 5.34c-.59.24-1.13.56-1.62.93l-2.39-.96a.5.5 0 0 0-.6.22L2.69 8.85a.5.5 0 0 0 .12.63l2.03 1.58c-.04.3-.06.62-.06.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.63l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.03.69 1.62.93l.36 2.53a.5.5 0 0 0 .49.41h3.84a.5.5 0 0 0 .49-.41l.36-2.53c.59-.24 1.13-.56 1.62-.93l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63l-2.03-1.58Z" />
        </svg>
      </button>
      <button :class="{ active: executionMode !== 'running' }" @click="emit('edit-world')" :title="executionMode === 'running' ? 'Interromper execução e voltar ao modo de edição' : 'Modo de edição'" :data-tooltip="executionMode === 'running' ? 'Para o jogo e retorna às ferramentas de edição.' : 'Edita objetos, terreno, iluminação e lógica da cena.'">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l1-3.5L11 2.5l2.5 2.5-7 7z" /></svg><span>Editar</span>
      </button>
      <button :class="{ active: executionMode === 'running' }" @click="emit('run-world')" title="Executar cena" data-tooltip="Executa a cena para testar o jogador, as colisões e os eventos.">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3v10l8-5z" /></svg><span>Jogar</span>
      </button>
    </div>

    <div class="topbar-right">
          <div class="global-search-wrap">
      <div class="global-search" :class="{ 'has-query': searchQuery.trim() }">
        <svg class="search-glass" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="8.7" cy="8.7" r="5.7" />
          <path d="m13 13 4 4" />
        </svg>
        <input
          id="global-editor-search"
          v-model="searchQuery"
          type="search"
          placeholder="Pesquisar no editor…"
          aria-label="Busca global do editor"
          title="Pesquisar no editor (Ctrl+K)"
          autocomplete="off"
          spellcheck="false"
          @keydown.esc="searchQuery = ''"
        />
        <button v-if="searchQuery" class="global-search-clear" type="button" title="Limpar pesquisa" aria-label="Limpar pesquisa" @mousedown.prevent @click="searchQuery = ''">×</button>
        <span v-else class="search-shortcut" aria-label="Atalho Ctrl mais K">
          <kbd>Ctrl</kbd><kbd>K</kbd>
        </span>
      </div>
      <div v-if="searchQuery.trim()" class="global-search-results" role="listbox" aria-label="Resultados da busca">
        <div class="global-search-results-heading">
          <span>RESULTADOS</span>
          <kbd>{{ searchResults.length }}</kbd>
        </div>
        <button v-for="result in searchResults" :key="result.key" class="global-search-result" role="option" @mousedown.prevent="activateSearchResult(result)">
          <span class="global-search-result-main">{{ result.label }}</span>
          <small>{{ result.detail }}</small>
        </button>
        <div v-if="!searchResults.length" class="global-search-empty">
          <span class="global-search-empty-icon">⌕</span>
          <span><strong>Nenhum resultado encontrado</strong><small>Tente outro termo ou nome de comando.</small></span>
        </div>
      </div>
    </div>
      <span class="topbar-divider" aria-hidden="true"></span>
      <button class="topbar-controls" type="button" title="Criar menus, telas, botões, barras e HUDs para o jogo." @click="emit('open-ui-workspace')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="1.5"/><path d="M1.5 5.5h13M5 5.5V14M7.5 8h4M7.5 10.5h4"/></svg>
        <span>Workspace UI</span>
      </button>
      <button class="topbar-controls player-workspace-trigger" type="button" title="Configurar aparência, movimento, física, câmera e controles do jogador." aria-label="Abrir Workspace do Player" @click="emit('open-player-workspace')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9H5a3 3 0 0 0-2.8 2L1 15.5A2.5 2.5 0 0 0 5 18l3-3h8l3 3a2.5 2.5 0 0 0 4-2.5L21.8 11A3 3 0 0 0 19 9h-2"/><path d="M8 6h8a3 3 0 0 1 3 3H5a3 3 0 0 1 3-3Z"/><path d="M7 11v4M5 13h4M16.5 12h.01M19 14h.01"/></svg>
        <span>Player</span>
      </button>
      <button class="topbar-controls" type="button" title="Personalize mapas de teclas, ações de movimento e atalhos do jogador." @click="emit('open-control-maps')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 5h12M2 11h12" /><circle cx="10" cy="5" r="1.6" fill="#1d1b17" /><circle cx="6" cy="11" r="1.6" fill="#1d1b17" /></svg>
        <span>Controles</span>
      </button>
    </div>

    <Teleport to=".viewport-hud" defer>
      <div class="viewport-tools-overlay viewport-layout-positioned" :style="viewportLayoutStyle" role="toolbar" aria-label="Controles da visualização do mundo">
        <div class="viewport-camera-switch" role="group" aria-label="Câmera">
          <button class="viewport-tool" :class="{ active: firstPersonMode }" type="button" :aria-pressed="firstPersonMode" title="Alterna a visão em primeira pessoa." @click="emit('toggle-first-person')">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="1.8" /></svg>
            <span>1ª pessoa</span>
          </button>
          <button class="viewport-tool" :class="{ active: !firstPersonMode && cameraLabel === 'Câmera livre' }" type="button" :aria-pressed="!firstPersonMode && cameraLabel === 'Câmera livre'" :title="`Alterna o enquadramento da câmera. Atual: ${cameraLabel}.`" @click="emit('cycle-camera')">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h12M3 5V3h10v2M4 5v8h8V5M6 8h4M6 10h4" /></svg>
            <span>{{ cameraLabel }}</span>
          </button>
        </div>
        <span class="viewport-tools-divider" aria-hidden="true"></span>
            <details class="render-settings">
        <summary class="cam render-settings-trigger" :class="{ active: renderAll }" aria-label="Configurar renderização" title="Configurar a renderização geral do mundo">
          <span class="render-settings-icon" aria-hidden="true"></span>
          <span class="render-settings-label">{{ renderAll ? 'Render: Tudo' : 'Render' }}</span>
          <span class="render-settings-chevron">▾</span>
        </summary>
        <div class="render-settings-popover">
          <div class="render-settings-heading">Renderização geral</div>
          <p class="render-settings-description">Defina a distância máxima de modelos, objetos e grama a partir da câmera ativa.</p>
          <label class="render-settings-field">
            <span>Distância máxima</span>
            <span class="render-settings-number-wrap">
              <input type="number" min="10" max="5000" step="1" :value="renderDistance" :disabled="renderAll" aria-label="Distância de renderização em unidades" @change="emit('render-distance-change', Number(($event.target as HTMLInputElement).value))" />
              <small>un.</small>
            </span>
          </label>
          <input class="render-settings-range" type="range" min="10" max="500" step="1" :value="Math.min(renderDistance, 500)" :disabled="renderAll" aria-label="Ajuste rápido da distância de renderização" title="Define até onde modelos, objetos e grama são desenhados. Distâncias maiores podem reduzir o FPS." @input="emit('render-distance-change', Number(($event.target as HTMLInputElement).value))" />
          <div class="render-settings-range-labels"><span>10 unidades</span><span>500 unidades</span></div>
          <label class="render-settings-everything">
            <input type="checkbox" :checked="renderAll" title="Ignora o limite de distância e mantém todos os objetos e toda a grama elegíveis para renderização." @change="emit('render-all-change', ($event.target as HTMLInputElement).checked)" />
            <span><strong>Renderizar tudo</strong><small>Ignora o limite global para objetos, modelos 3D e grama dentro da cena.</small></span>
          </label>
          <div class="render-settings-section">
            <div class="render-settings-section-title">Grama e vegetação</div>
            <label class="render-settings-everything">
              <input type="checkbox" :checked="grassVisible" @change="emit('grass-visible-change', ($event.target as HTMLInputElement).checked)" />
              <span><strong>Renderizar grama</strong><small>Desliga a camada visual sem apagar a grama pintada no mundo.</small></span>
            </label>
            <label class="render-settings-everything render-settings-grass-check">
              <input type="checkbox" :checked="grassUseDetailedModel" :disabled="!grassVisible" @change="emit('grass-use-detailed-model-change', ($event.target as HTMLInputElement).checked)" />
              <span><strong>Usar modelo 3D detalhado</strong><small>Desative para usar geometria procedural simples na grama próxima e intermediária, reduzindo materiais e draw calls.</small></span>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Densidade visual</span>
              <select class="render-settings-select" :value="grassDensityPercent" :disabled="!grassVisible" @change="emit('grass-density-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="25">Muito leve · 25%</option><option value="40">Leve · 40%</option><option value="60">Equilibrada · 60%</option><option value="80">Densa · 80%</option><option value="100">Máxima · 100%</option>
              </select>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Alcance exclusivo da grama</span>
              <select class="render-settings-select" :value="grassRenderDistanceOption" :disabled="!grassVisible" @change="emit('grass-render-distance-change', ($event.target as HTMLSelectElement).value)">
                <option value="global">Seguir alcance geral</option><option value="all">Renderizar até o limite do mapa</option><option value="25">25 unidades</option><option value="50">50 unidades</option><option value="72">72 unidades</option><option value="100">100 unidades</option><option value="150">150 unidades</option><option value="200">200 unidades</option><option value="300">300 unidades</option><option value="500">500 unidades</option><option value="1000">1000 unidades</option>
              </select>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Raio de grama detalhada</span>
              <select class="render-settings-select" :value="grassNearDetailDistance" :disabled="!grassVisible" @change="emit('grass-near-detail-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="0">Seguir perfil</option><option value="5">5 unidades</option><option value="10">10 unidades</option><option value="15">15 unidades</option><option value="20">20 unidades</option><option value="25">25 unidades</option><option value="30">30 unidades</option><option value="35">35 unidades</option><option value="40">40 unidades</option>
              </select>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Raio de detalhe intermediário</span>
              <select class="render-settings-select" :value="grassMiddleDetailDistance" :disabled="!grassVisible" @change="emit('grass-middle-detail-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="0">Seguir perfil</option><option value="10">10 unidades</option><option value="15">15 unidades</option><option value="20">20 unidades</option><option value="25">25 unidades</option><option value="30">30 unidades</option><option value="40">40 unidades</option><option value="50">50 unidades</option><option value="60">60 unidades</option><option value="70">70 unidades</option><option value="80">80 unidades</option>
              </select>
            </label>
            <label class="render-settings-everything render-settings-grass-check">
              <input type="checkbox" :checked="grassOcclusionEnabled" :disabled="!grassVisible" @change="emit('grass-occlusion-enabled-change', ($event.target as HTMLInputElement).checked)" />
              <span><strong>Oclusão atrás de paredes e objetos</strong><small>Não desenha a grama que fica totalmente ou parcialmente escondida atrás de superfícies sólidas opacas. Este controle é específico para paredes/objetos, não altera o sistema de grama cobrindo grama.</small></span>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Modo de oclusão por paredes</span>
              <select class="render-settings-select" :value="wallOcclusionQuality" :disabled="!grassVisible || !grassOcclusionEnabled" @change="emit('wall-occlusion-quality-change', ($event.target as HTMLSelectElement).value as 'fast' | 'precise')">
                <option value="precise">Preciso · oculta também áreas parciais</option><option value="fast">Econômico · prioriza desempenho</option>
              </select>
            </label>
            <p class="render-settings-help">Preciso mantém a subdivisão fina junto às paredes. Econômico ignora somente os cálculos extras das áreas parcialmente cobertas; ainda oculta chunks totalmente atrás de uma parede.</p>
            <label class="render-settings-field render-settings-fog-field"><span>Frequência da oclusão por paredes</span>
              <select class="render-settings-select" :value="grassOcclusionIntervalMs" :disabled="!grassVisible || !grassOcclusionEnabled" @change="emit('grass-occlusion-interval-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="250">Precisa · recalcula a cada 250 ms</option><option value="400">Equilibrada · 400 ms</option><option value="800">Leve · 800 ms</option><option value="1200">Economia · 1200 ms</option>
              </select>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Intensidade do vento</span>
              <select class="render-settings-select" :value="grassWindPercent" :disabled="!grassVisible" @change="emit('grass-wind-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="0">Desativado</option><option value="25">Muito suave · 25%</option><option value="50">Médio · 50%</option><option value="75">Forte · 75%</option><option value="100">Máximo · 100%</option>
              </select>
            </label>
            <p class="render-settings-help">A densidade usa amostragem por anéis, e os raios definem quando a grama detalhada dá lugar à geometria leve. Esses ajustes não apagam nem modificam os dados de grama pintada.</p>
          </div>
          <div class="render-settings-section">
            <div class="render-settings-section-title">Qualidade geral</div>
            <label class="render-settings-field"><span>Perfil</span>
              <select class="render-settings-select" :value="performanceMode" @change="emit('performance-mode-change', ($event.target as HTMLSelectElement).value as 'quality' | 'balanced' | 'economy' | 'auto')">
                <option value="quality">Qualidade</option><option value="balanced">Equilibrado</option><option value="economy">Econômico</option><option value="auto">Automático</option>
              </select>
            </label>
          </div>
          <div class="render-settings-section">
            <div class="render-settings-section-title">GPU e fluidez</div>
            <label class="render-settings-field"><span>Escala da resolução</span>
              <select class="render-settings-select" :value="renderResolutionScale" @change="emit('render-resolution-scale-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="0">Seguir perfil</option><option value="0.5">50%</option><option value="0.65">65%</option><option value="0.75">75%</option><option value="0.85">85%</option><option value="1">100%</option><option value="1.1">110%</option><option value="1.25">125%</option>
              </select>
            </label>
            <label class="render-settings-field"><span>Limite de FPS</span>
              <select class="render-settings-select" :value="renderFpsLimit" @change="emit('render-fps-limit-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="0">Seguir perfil</option><option value="30">30 FPS</option><option value="45">45 FPS</option><option value="60">60 FPS</option><option value="90">90 FPS</option><option value="120">120 FPS</option>
              </select>
            </label>
            <p class="render-settings-help">Reduzir a escala e limitar FPS pode aliviar a GPU em cenas pesadas.</p>
          </div>
          <div class="render-settings-section">
            <div class="render-settings-section-title">Neblina atmosférica</div>
            <label class="render-settings-everything"><input type="checkbox" :checked="renderFogEnabled" @change="emit('render-fog-enabled-change', ($event.target as HTMLInputElement).checked)" /><span><strong>Ativar neblina</strong><small>Ajuda a disfarçar o horizonte e o limite de visão.</small></span></label>
            <label class="render-settings-field render-settings-fog-field"><span>Alcance da neblina</span><strong class="render-settings-output">{{ Math.round(renderFogDistanceScale * 100) }}%</strong></label>
            <input class="render-settings-range" type="range" min="50" max="200" step="5" :value="Math.round(renderFogDistanceScale * 100)" :disabled="!renderFogEnabled" @input="emit('render-fog-distance-scale-change', Number(($event.target as HTMLInputElement).value) / 100)" />
          </div>
          <div class="render-settings-section">
            <div class="render-settings-section-title">Resolução dinâmica adaptativa</div>
            <label class="render-settings-everything">
              <input type="checkbox" :checked="renderDynamicResolution" @change="emit('render-dynamic-resolution-change', ($event.target as HTMLInputElement).checked)" />
              <span><strong>Ajustar resolução automaticamente</strong><small>Reduz a escala quando o FPS fica abaixo da meta e recupera qualidade quando há folga. Funciona com GPUs NVIDIA, AMD e Intel.</small></span>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Meta de desempenho</span>
              <select class="render-settings-select" :value="renderDynamicResolutionTargetFps" :disabled="!renderDynamicResolution" @change="emit('render-dynamic-resolution-target-fps-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="30">30 FPS</option><option value="45">45 FPS</option><option value="60">60 FPS</option><option value="90">90 FPS</option>
              </select>
            </label>
            <label class="render-settings-field render-settings-fog-field"><span>Escala mínima permitida</span>
              <select class="render-settings-select" :value="renderDynamicResolutionMinScale" :disabled="!renderDynamicResolution" @change="emit('render-dynamic-resolution-min-scale-change', Number(($event.target as HTMLSelectElement).value))">
                <option value="0.5">50%</option><option value="0.6">60%</option><option value="0.7">70%</option><option value="0.8">80%</option><option value="0.9">90%</option>
              </select>
            </label>
            <p class="render-settings-help">A escala muda em passos pequenos e com intervalo para evitar oscilações bruscas. É uma otimização adaptativa multiplataforma, não DLSS ou FSR oficial.</p>
          </div>
          <p class="render-settings-note">Preferências aplicadas imediatamente e salvas neste navegador. Distâncias e resoluções menores podem ajudar em cenas pesadas.</p>
        </div>
      </details>
        <span class="viewport-tools-divider" aria-hidden="true"></span>
        <button class="topbar-fullscreen" type="button" :class="{ active: worldFullscreen }" :title="fullscreenToggleTitle" :aria-label="fullscreenToggleTitle" :aria-pressed="worldFullscreen" @click="emit('toggle-world-fullscreen')">
          <svg v-if="!worldFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5" /></svg>
        </button>
      </div>
    </Teleport>
  </header>
</template>

<style scoped src="./EditorTopBar.css"></style>
