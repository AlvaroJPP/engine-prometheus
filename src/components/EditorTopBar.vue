<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{
  projectName: string
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
  'run-world': []
  'edit-world': []
  'toggle-world-fullscreen': []
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
      <button class="topbar-controls" type="button" title="Personalize mapas de teclas, ações de movimento e atalhos do jogador." @click="emit('open-control-maps')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 5h12M2 11h12" /><circle cx="10" cy="5" r="1.6" fill="#1d1b17" /><circle cx="6" cy="11" r="1.6" fill="#1d1b17" /></svg>
        <span>Controles</span>
      </button>
    </div>

    <div class="viewport-tools-overlay" role="toolbar" aria-label="Controles da visualização do mundo">
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
      <summary class="cam render-settings-trigger" :class="{ active: renderAll }" title="Configurar a renderização geral do mundo">
        <span class="render-settings-icon" aria-hidden="true"></span>
        {{ renderAll ? 'Render: Tudo' : 'Render' }}
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
  </header>
</template>

<style scoped>
.file-menu { position: relative; flex: none; }
.file-menu > summary { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid #2c323d; border-radius:6px; background:#181c23; color:#e6e8ec; cursor:pointer; list-style:none; font-size:12px; }
.file-menu > summary::-webkit-details-marker { display:none; }
.file-menu-popover { position:absolute; z-index:250; top:calc(100% + 6px); left:0; width:190px; padding:5px; border:1px solid #2c323d; border-radius:7px; background:#14171c; box-shadow:0 12px 30px #0008; }
.file-menu-popover button { display:flex; justify-content:space-between; align-items:center; width:100%; min-height:32px; padding:0 9px; border:0; border-radius:4px; background:transparent; color:#e6e8ec; text-align:left; cursor:pointer; }
.file-menu-popover button:hover { background:#252a33; }
kbd { padding:2px 5px; border:1px solid #2c323d; border-radius:4px; color:#9aa1ae; font:10px 'IBM Plex Mono',monospace; }
.global-search-wrap {
  position:relative;
  z-index:1;
  flex:1 1 300px;
  width:min(440px,34vw);
  max-width:440px;
  min-width:180px;
}
.global-search {
  box-sizing:border-box;
  display:flex;
  align-items:center;
  gap:9px;
  width:100%;
  min-width:0;
  height:34px;
  padding:0 8px 0 10px;
  border:1px solid #2b313c;
  border-radius:7px;
  background:#101319;
  color:#929cac;
  transition:border-color .15s ease, background-color .15s ease, box-shadow .15s ease;
}
.global-search:hover {
  border-color:#3a4351;
  background:#12161d;
}
.global-search:focus-within {
  border-color:#a87824;
  background:#11151b;
  box-shadow:0 0 0 3px #f5a52415, 0 1px 0 #ffffff05 inset;
}
.search-glass {
  flex:none;
  width:15px;
  height:15px;
  stroke:currentColor;
  stroke-width:1.7;
  stroke-linecap:round;
  transition:color .15s ease;
}
.global-search:focus-within .search-glass { color:#e9b75c; }
.global-search input {
  flex:1;
  width:100%;
  min-width:0;
  padding:0;
  border:0;
  outline:0;
  background:transparent;
  color:#e6eaf1;
  font:400 12px/1.4 Inter, 'Segoe UI', sans-serif;
}
.global-search input::placeholder { color:#788394; opacity:1; }
.global-search input::-webkit-search-cancel-button { display:none; }
.search-shortcut {
  display:flex;
  align-items:center;
  flex:none;
  gap:3px;
  margin-left:5px;
  padding-left:9px;
  border-left:1px solid #2b313c;
}
.search-shortcut kbd {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:20px;
  height:19px;
  box-sizing:border-box;
  padding:0 5px;
  border:1px solid #353d49;
  border-radius:4px;
  background:linear-gradient(180deg,#202630 0%,#191e26 100%);
  color:#aab3c1;
  font:500 9px/1 'IBM Plex Mono',monospace;
  box-shadow:0 1px 0 #0005;
}
.search-shortcut kbd:first-child { min-width:31px; }
.global-search-clear {
  display:flex;
  align-items:center;
  justify-content:center;
  flex:none;
  width:21px;
  height:21px;
  padding:0;
  border:1px solid transparent;
  border-radius:4px;
  background:transparent;
  color:#8e98a8;
  font:18px/1 'Segoe UI',sans-serif;
  cursor:pointer;
}
.global-search-clear:hover {
  border-color:#3a4351;
  background:#202630;
  color:#f0f2f6;
}
.global-search-results {
  position:absolute;
  z-index:260;
  top:calc(100% + 6px);
  left:0;
  right:0;
  max-height:min(360px,60vh);
  overflow:auto;
  padding:5px;
  border:1px solid #353d49;
  border-radius:8px;
  background:#151920;
  box-shadow:0 16px 38px #0009,0 1px 0 #ffffff05 inset;
  backdrop-filter:blur(14px);
}
.global-search-results-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  min-height:24px;
  padding:0 8px 4px;
  border-bottom:1px solid #262d38;
  color:#7e899a;
  font-size:9px;
  font-weight:700;
  letter-spacing:.09em;
}
.global-search-results-heading kbd {
  min-width:18px;
  padding:2px 5px;
  border:1px solid #303845;
  border-radius:4px;
  color:#a6afbd;
  font:10px 'IBM Plex Mono',monospace;
  letter-spacing:0;
  text-align:center;
}
.global-search-result {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  width:100%;
  min-height:35px;
  margin-top:2px;
  padding:6px 8px;
  border:1px solid transparent;
  border-radius:5px;
  background:transparent;
  color:#e1e6ee;
  text-align:left;
  cursor:pointer;
  transition:background-color .12s ease,border-color .12s ease,color .12s ease;
}
.global-search-result:hover,
.global-search-result:focus-visible {
  border-color:#4c3a1c;
  outline:0;
  background:#2a2317;
  color:#f5c56b;
}
.global-search-result-main { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
.global-search-result small { flex:none; color:#8490a1; font-size:10px; }
.global-search-empty {
  display:flex;
  align-items:center;
  gap:10px;
  padding:16px 10px;
  color:#a6afbd;
  font-size:11px;
}
.global-search-empty-icon {
  display:flex;
  align-items:center;
  justify-content:center;
  width:30px;
  height:30px;
  flex:none;
  border:1px solid #2e3541;
  border-radius:6px;
  color:#8d98a8;
  font-size:18px;
}
.global-search-empty > span:last-child { display:flex; flex-direction:column; gap:4px; }
.global-search-empty strong { color:#dce2eb; font-size:11px; font-weight:600; }
.global-search-empty small { color:#8792a3; font-size:10px; }

.mode-segment { display:flex; flex:none; padding:3px; gap:2px; border:1px solid #252a33; border-radius:7px; background:#0b0d10; }
.mode-segment button { height:26px; min-width:55px; padding:0 10px; border:0; border-radius:4px; background:transparent; color:#9aa1ae; font-size:11px; cursor:pointer; }
.mode-segment button.active { background:#f5a524; color:#1a1204; font-weight:700; }
.topbar-spacer { flex:1; min-width:4px; }
.topbar-fullscreen {
  order:8;
  display:inline-flex;
  flex:none;
  align-items:center;
  justify-content:center;
  gap:6px;
  min-height:32px;
  padding:0 9px;
  border:1px solid #2b313c;
  border-radius:5px;
  background:#181c23;
  color:#aab4c3;
  font-size:11px;
  white-space:nowrap;
  cursor:pointer;
  transition:background-color .14s ease,border-color .14s ease,color .14s ease;
}
.topbar-fullscreen svg { width:15px; height:15px; flex:none; }
.topbar-fullscreen:hover { border-color:#3a4351; background:#202630; color:#f0f2f6; }
.topbar-fullscreen.active { border-color:#6f531e; background:#292314; color:#f5c56b; }
.topbar-fullscreen:focus-visible { outline:2px solid #f5a524; outline-offset:2px; }
.topbar-fullscreen:disabled { opacity:.55; cursor:wait; }
.save-state { display:flex; align-items:center; gap:5px; white-space:nowrap; font-size:10px; color:#9aa1ae; }
.save-state .dot { width:6px; height:6px; }
.save-state.is-saved { color:#3fb950; }
.save-state.is-dirty { color:#f5a524; }
.render-settings { position:relative; flex:none; }
.render-settings > summary { list-style:none; cursor:pointer; user-select:none; }
.render-settings > summary::-webkit-details-marker { display:none; }
.render-settings-trigger.active { background:#292314; border-color:#7d5b1b; color:#f5c56b; }
.render-settings-popover { position:absolute; z-index:200; top:calc(100% + 7px); right:0; width:min(390px,calc(100vw - 24px)); max-height:min(76vh,720px); overflow:auto; box-sizing:border-box; padding:14px; border:1px solid #252a33; border-radius:7px; background:#14171c; color:#e6e8ec; box-shadow:0 12px 32px #0009; }
.render-settings-section { padding:10px 0; border-top:1px solid #252a33; }
.render-settings-section-title { margin-bottom:9px; color:#d6dae2; font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
.render-settings-help { margin:7px 0 0; color:#818b9a; font-size:10px; line-height:1.45; }
.render-settings-select { width:145px; max-width:48%; padding:6px 7px; border:1px solid #303744; border-radius:4px; background:#0e1013; color:#e6e8ec; font:inherit; }
.render-settings-output { min-width:42px; color:#f5c56b; font:11px 'IBM Plex Mono',monospace; text-align:right; }
.render-settings-fog-field { margin-top:12px; }
.render-settings-grass-check { margin-top:12px; }
.render-settings-heading { font-size:12px; font-weight:700; }
.render-settings-description,.render-settings-note { margin:7px 0 12px; color:#9aa1ae; font-size:11px; line-height:1.5; }
.render-settings-field { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:11px; font-weight:600; }
.render-settings-number-wrap { display:flex; align-items:center; gap:6px; }
.render-settings-number-wrap input { width:88px; padding:6px 7px; border:1px solid #252a33; border-radius:4px; color:#e6e8ec; background:#0e1013; font:inherit; }
.render-settings-number-wrap small { color:#9aa1ae; font-size:10px; }
.render-settings-range { display:block; width:100%; margin:12px 0 2px; accent-color:#f5a524; }
.render-settings-range-labels { display:flex; justify-content:space-between; color:#9aa1ae; font-size:9px; }
.render-settings-everything { display:flex; align-items:flex-start; gap:9px; margin-top:14px; padding:10px; border:1px solid #252a33; border-radius:5px; background:#181c23; cursor:pointer; }
.render-settings-everything input { margin-top:2px; accent-color:#3fb950; }
.render-settings-everything span { display:flex; flex-direction:column; gap:4px; }
.render-settings-everything strong { font-size:11px; }
.render-settings-everything small { color:#9aa1ae; font-size:10px; line-height:1.45; }
.render-settings-note { margin-bottom:0; }
.render-settings-popover input:disabled { opacity:.5; cursor:not-allowed; }
@media(max-width:1200px) {
  .brand-copy,.subtitle { display:none; }
  .global-search { max-width:260px; }
}
@media(max-width:900px) {
  .project { display:none; }
  .global-search-wrap { display:block; flex:1 1 170px; width:auto; max-width:300px; min-width:130px; }
  .topbar-spacer { display:none; }
  .cam { padding-inline:7px; }
}
@media(max-width:760px) {
  .global-search-wrap { display:none; }
  .mode-segment { display:none; }
  .render-settings-trigger { gap:4px; padding-inline:7px; }
  .render-settings-icon { display:none; }
  .cam { padding-inline:7px; font-size:10px; }
}

/* Match the compact topbar ordering shown in the provided reference. */
.brand .title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -.01em;
  text-transform: none;
}
.project {
  order: 1;
  margin-left: 8px;
  padding-left: 13px;
  border-left: 1px solid #2a303a;
}
.file-menu { order: 2; }
.topbar-save {
  order: 3;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #d7dee8;
  font-size: 11px;
}
.topbar-save:hover {
  border-color: #343c49;
  background: #202630;
  color: #f2c36f;
}
.global-search-wrap { order: 4; }
.mode-segment { order: 5; }
.topbar-spacer { order: 6; }
.render-settings { order: 7; }
.topbar > .cam { order: 9; }
@media(max-width:1200px) {
  .project { margin-left: 3px; padding-left: 8px; }
}
@media(max-width:900px) {
  .project { display:none; }
  .file-menu { order: 1; }
  .topbar-save { order: 2; }
  .global-search-wrap { order: 3; }
  .mode-segment { order: 4; }
  .topbar-spacer { order: 5; }
  .render-settings { order: 6; }
  .topbar-fullscreen { order: 7; }
  .topbar > .cam { order: 8; }
}
@media(max-width:760px) {
  .topbar-save { display:none; }
  .file-menu > summary { padding-inline:7px; font-size:10px; }
  .topbar-fullscreen { width:30px; min-width:30px; padding:0; }
  .topbar-fullscreen span { display:none; }
}


/* Visual language based on the latest toolbar reference mockup. */
.topbar {
  position:relative;
  z-index:40;
  display:grid;
  grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
  align-items:center;
  gap:16px;
  height:56px;
  min-height:56px;
  padding:0 12px;
  border-bottom:1px solid #2e2b25;
  background:#14120f;
  color:#f3efe6;
  font-family:'IBM Plex Sans',sans-serif;
}
.topbar button { font-family:'IBM Plex Sans',sans-serif; }
.topbar-left,.topbar-right { display:flex; align-items:center; gap:8px; min-width:0; }
.topbar-left { justify-content:flex-start; }
.topbar-right { justify-content:flex-end; }
.brand-mark {
  display:grid;
  place-items:center;
  flex:none;
  width:36px;
  height:36px;
  min-height:36px;
  padding:0;
  border:0;
  border-radius:8px;
  background:transparent;
  cursor:pointer;
}
.brand-mark:hover { background:transparent; }
.brand-mark .logo {
  display:grid;
  place-items:center;
  width:32px;
  height:32px;
  border:1px solid #e8572b;
  border-radius:7px;
  background:#e8572b;
  color:#14120f;
  font-size:17px;
  font-weight:800;
  line-height:1;
}
.topbar-divider,.project-divider,.viewport-tools-divider {
  display:block;
  flex:none;
  width:1px;
  height:24px;
  background:#2e2b25;
}
.project-shell {
  display:flex;
  align-items:center;
  min-width:0;
  height:36px;
  border:1px solid #2e2b25;
  border-radius:8px;
  background:#1d1b17;
}
.project-name-field { display:flex; align-items:center; min-width:0; }
.topbar .pname {
  width:148px;
  min-width:80px;
  height:34px;
  min-height:34px;
  padding:0 10px 0 12px;
  border:0;
  border-radius:7px 0 0 7px;
  outline:none;
  background:transparent;
  color:#f3efe6;
  font:500 13px/1.2 'IBM Plex Sans',sans-serif;
}
.topbar .pname:hover,.topbar .pname:focus {
  border-color:transparent;
  background:#25221d;
}
.project-divider { height:20px; }
.topbar .save-state {
  display:grid;
  place-items:center;
  flex:none;
  width:18px;
  height:30px;
  margin-right:4px;
  overflow:hidden;
  color:transparent;
  font-size:0;
}
.topbar .save-state .dot { display:block; width:7px; height:7px; margin:0; }
.topbar .save-state.is-saved .dot { background:#8cae78; }
.topbar .save-state.is-dirty .dot { background:#e8572b; }
.file-menu { align-self:stretch; display:flex; align-items:center; }
.topbar .file-menu > summary {
  display:flex;
  align-items:center;
  gap:7px;
  height:34px;
  min-height:34px;
  padding:0 12px;
  border:0;
  border-radius:0 7px 7px 0;
  background:transparent;
  color:#b5afa2;
  font:500 13px/1 'IBM Plex Sans',sans-serif;
  cursor:pointer;
}
.topbar .file-menu > summary:hover,.topbar .file-menu[open] > summary { background:#26231e; color:#f3efe6; }
.topbar .file-menu > summary svg { flex:none; }
.topbar .file-menu-popover {
  top:calc(100% + 6px);
  width:190px;
  border-color:#3b3730;
  border-radius:8px;
  background:#1d1b17;
  box-shadow:0 14px 34px #0009;
}
.topbar .file-menu-popover button { color:#f3efe6; }
.topbar .file-menu-popover button:hover { background:#34302a; }
.topbar kbd { border-color:#3b3730; border-radius:5px; background:#14120f; color:#b5afa2; }
.topbar .topbar-save,.topbar .topbar-controls {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  flex:none;
  height:36px;
  min-height:36px;
  padding:0 12px;
  border:1px solid #2e2b25;
  border-radius:8px;
  background:#1d1b17;
  color:#f3efe6;
  font:500 13px/1 'IBM Plex Sans',sans-serif;
  white-space:nowrap;
  cursor:pointer;
}
.topbar .topbar-save:hover,.topbar .topbar-controls:hover { background:#26231e; border-color:#484136; }
.topbar .topbar-save svg,.topbar .topbar-controls svg { flex:none; }
.topbar .mode-segment {
  display:flex;
  align-self:stretch;
  align-items:stretch;
  justify-content:center;
  gap:8px;
  height:56px;
  min-width:max-content;
  margin:0;
  padding:0;
  border:0;
  border-radius:0;
  background:transparent;
}
.topbar .mode-segment button {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  height:56px;
  min-height:56px;
  padding:0 16px;
  border:0;
  border-bottom:2px solid transparent;
  border-radius:0;
  background:transparent;
  color:#b5afa2;
  font:500 13px/1 'IBM Plex Sans',sans-serif;
  cursor:pointer;
}
.topbar .mode-segment button:hover { background:#1d1b17; color:#f3efe6; }
.topbar .mode-segment button.active {
  border-bottom-color:#e8572b;
  background:transparent;
  color:#f3efe6;
  box-shadow:none;
}
.topbar .global-search-wrap {
  flex:0 1 260px;
  width:min(260px,22vw);
  max-width:260px;
  min-width:155px;
}
.topbar .global-search {
  height:36px;
  min-height:36px;
  gap:8px;
  padding:0 8px 0 12px;
  border:1px solid #2e2b25;
  border-radius:8px;
  background:#1d1b17;
  color:#b5afa2;
  box-shadow:none;
  transition:border-color .12s ease,background-color .12s ease;
}
.topbar .global-search:hover { border-color:#494238; background:#211e19; }
.topbar .global-search:focus-within {
  border-color:#e8572b;
  background:#1d1b17;
  box-shadow:0 0 0 2px #e8572b24;
}
.topbar .global-search input {
  min-height:0;
  padding:0;
  background:transparent;
  color:#f3efe6;
  font:400 13px/1.3 'IBM Plex Sans',sans-serif;
}
.topbar .global-search input::placeholder { color:#8b8478; }
.topbar .global-search .search-glass { stroke:currentColor; }
.topbar .search-shortcut {
  gap:3px;
  margin:0;
  padding:3px 7px;
  border:1px solid #e8572b;
  border-radius:5px;
  background:#14120f;
}
.topbar .search-shortcut kbd {
  min-width:0;
  height:auto;
  padding:0;
  border:0;
  border-radius:0;
  background:transparent;
  color:#f3efe6;
  font:500 10px/1 'IBM Plex Sans',sans-serif;
  box-shadow:none;
}
.topbar .global-search-clear { min-height:22px; width:22px; border:0; background:transparent; color:#b5afa2; }
.topbar .global-search-results {
  top:calc(100% + 7px);
  border:1px solid #3b3730;
  border-radius:9px;
  background:#1d1b17;
  color:#f3efe6;
  box-shadow:0 16px 38px #0009;
}
.topbar .global-search-results-heading { border-bottom-color:#2e2b25; color:#b5afa2; }
.topbar .global-search-result { color:#f3efe6; }
.topbar .global-search-result:hover { background:#34302a; }
.topbar .global-search-result small { color:#b5afa2; }
.topbar .global-search-empty { color:#b5afa2; }
.viewport-tools-overlay {
  position:fixed;
  z-index:45;
  top:68px;
  right:264px;
  display:flex;
  align-items:center;
  gap:6px;
  max-width:calc(100vw - 24px);
  padding:4px;
  border:1px solid #2e2b25;
  border-radius:12px;
  background:rgba(20,18,15,.92);
  color:#f3efe6;
  box-shadow:0 8px 22px #0003;
  backdrop-filter:blur(10px);
}
.viewport-camera-switch { display:flex; align-items:center; gap:2px; min-width:0; }
.viewport-tool {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  height:36px;
  min-height:36px;
  padding:0 12px;
  border:1px solid transparent;
  border-radius:8px;
  background:transparent;
  color:#b5afa2;
  font:500 12px/1 'IBM Plex Sans',sans-serif;
  white-space:nowrap;
  cursor:pointer;
}
.viewport-tool:hover { background:#26231e; color:#f3efe6; }
.viewport-tool.active { background:#34302a; color:#f3efe6; }
.viewport-tool svg { flex:none; }
.viewport-tools-divider { height:24px; }
.topbar .render-settings { position:relative; flex:none; }
.topbar .render-settings-trigger {
  display:flex;
  align-items:center;
  gap:7px;
  height:36px;
  min-height:36px;
  padding:0 10px;
  border:1px solid transparent;
  border-radius:8px;
  background:transparent;
  color:#f3efe6;
  font:500 12px/1 'IBM Plex Sans',sans-serif;
  white-space:nowrap;
  cursor:pointer;
}
.topbar .render-settings-trigger:hover,.topbar .render-settings[open] .render-settings-trigger { background:#26231e; border-color:#3c372f; }
.topbar .render-settings-trigger.active { color:#f3efe6; background:#26231e; }
.topbar .render-settings-icon { width:8px; height:8px; border-radius:50%; background:#e8572b; font-size:0; }
.topbar .render-settings-chevron { color:#b5afa2; font-size:12px; }
.topbar .render-settings-popover {
  top:calc(100% + 7px);
  right:0;
  width:min(360px,calc(100vw - 24px));
  max-height:min(76vh,720px);
  overflow:auto;
  border-color:#3b3730;
  border-radius:10px;
  background:#1d1b17;
  color:#f3efe6;
  box-shadow:0 16px 40px #000a;
}
.topbar .render-settings-heading,.topbar .render-settings-section-title { color:#f3efe6; }
.topbar .render-settings-description,.topbar .render-settings-help,.topbar .render-settings-note { color:#b5afa2; }
.topbar .render-settings-field>span:first-child { color:#b5afa2; }
.topbar .render-settings-number-wrap,.topbar .render-settings-select { border-color:#3b3730; background:#14120f; color:#f3efe6; }
.topbar .render-settings input[type="number"],.topbar .render-settings select {
  border-color:#3b3730;
  background:#14120f;
  color:#f3efe6;
}
.topbar .render-settings input[type="checkbox"],.topbar .render-settings input[type="range"] { accent-color:#e8572b; }
.topbar .render-settings-range-labels { color:#8b8478; }
.topbar .render-settings-everything { border-color:#2e2b25; background:#211e19; }
.topbar .render-settings-everything strong { color:#f3efe6; }
.topbar .render-settings-everything small { color:#b5afa2; }
.topbar .render-settings-section { border-top-color:#2e2b25; }
.topbar .render-settings-note { border-top-color:#2e2b25; }
.topbar .topbar-fullscreen {
  display:grid;
  place-items:center;
  flex:none;
  width:36px;
  height:36px;
  min-height:36px;
  padding:0;
  border:1px solid transparent;
  border-radius:8px;
  background:transparent;
  color:#f3efe6;
  cursor:pointer;
}
.topbar .topbar-fullscreen svg { display:block; width:16px; height:16px; }
.topbar .topbar-fullscreen:hover,.topbar .topbar-fullscreen.active { border-color:#3c372f; background:#26231e; }
:global(.app.world-fullscreen) .viewport-tools-overlay { top:12px; }
@media(max-width:1180px) {
  .topbar { gap:8px; }
  .viewport-tools-overlay { right:215px; }
  .topbar-left,.topbar-right { gap:6px; }
  .topbar .pname { width:112px; }
  .topbar .global-search-wrap { width:200px; flex-basis:200px; }
  .topbar .mode-segment button { padding-inline:12px; }
}
@media(max-width:960px) {
  .topbar { grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:5px; padding-inline:8px; }
  .topbar .brand-mark { width:30px; }
  .topbar-left,.topbar-right { gap:4px; }
  .topbar .pname { width:88px; padding-inline:7px; }
  .topbar .global-search-wrap { min-width:120px; width:160px; flex-basis:160px; }
  .topbar .topbar-save,.topbar .topbar-controls { width:36px; padding:0; }
  .topbar .topbar-save span,.topbar .topbar-controls span { display:none; }
  .topbar .topbar-divider { display:none; }
  .topbar .mode-segment button { padding-inline:10px; }
}
@media(max-width:900px) {
  .viewport-tools-overlay { transform:scale(.84); transform-origin:top right; }
}
@media(max-width:820px) {
  .viewport-tools-overlay { transform:scale(.76); }
}
@media(max-width:760px) {
  .topbar { grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:3px; padding-inline:5px; }
  .topbar .brand-mark { display:none; }
  .topbar .pname { width:76px; min-width:58px; }
  .topbar .global-search-wrap { width:120px; flex-basis:120px; min-width:100px; }
  .topbar .mode-segment button { padding-inline:7px; font-size:11px; }
  .viewport-tools-overlay { right:187px; gap:2px; padding:3px; transform:scale(.92); transform-origin:top right; }
  .viewport-tool { gap:4px; padding-inline:7px; font-size:11px; }
}

</style>
