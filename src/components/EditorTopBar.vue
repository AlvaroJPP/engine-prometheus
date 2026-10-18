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
  grassDensityPercent: number
  grassRenderDistanceMode: 'global' | 'all' | 'custom'
  grassRenderDistance: number
  grassNearDetailDistance: number
  grassMiddleDetailDistance: number
  grassOcclusionEnabled: boolean
  grassOcclusionIntervalMs: number
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
  'grass-density-change': [value: number]
  'grass-render-distance-change': [value: string]
  'grass-near-detail-change': [value: number]
  'grass-middle-detail-change': [value: number]
  'grass-occlusion-enabled-change': [value: boolean]
  'grass-occlusion-interval-change': [value: number]
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
    <div class="brand">
      <div class="logo" aria-hidden="true">P</div>
      <div class="brand-copy">
        <div class="title">Prometheus</div>
      </div>
    </div>

    <div class="project">
      <input :value="projectName" class="pname" aria-label="Nome do projeto" title="Edite o nome do projeto; alterações precisam ser salvas." spellcheck="false" @input="emit('update:projectName', ($event.target as HTMLInputElement).value); emit('mark-dirty')" />
      <span class="save-state" :class="dirty ? 'is-dirty' : 'is-saved'"><i class="dot" :class="dirty ? 'warn' : 'ok'" />{{ dirty ? 'Não salvo' : 'Salvo' }}</span>
    </div>

    <details class="file-menu">
      <summary data-tooltip="Crie um projeto, abra um arquivo existente ou salve as alterações.">Arquivo <span aria-hidden="true">▾</span></summary>
      <div class="file-menu-popover">
        <button title="Cria um projeto vazio em uma nova cena." @click="emit('new-project')">Novo projeto</button>
        <button title="Abre um projeto salvo no formato do Engine Prometheus." @click="emit('open-project')">Abrir projeto…</button>
        <button @click="emit('save-project', false)">Salvar <kbd>Ctrl S</kbd></button>
        <button title="Salva o projeto com outro nome ou em outro arquivo." @click="emit('save-project', true)">Salvar como…</button>
      </div>
    </details>

    <button class="topbar-save" title="Salvar projeto (Ctrl+S)" @click="emit('save-project', false)">Salvar</button>

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

    <div class="mode-segment" aria-label="Modo do editor">
      <button :class="{ active: executionMode !== 'running' }" @click="emit('edit-world')" :title="executionMode === 'running' ? 'Interromper execução e voltar ao modo de edição' : 'Modo de edição'" :data-tooltip="executionMode === 'running' ? 'Para o jogo e retorna às ferramentas de edição.' : 'Edita objetos, terreno, iluminação e lógica da cena.'">Editar</button>
      <button :class="{ active: executionMode === 'running' }" @click="emit('run-world')" title="Executar cena" data-tooltip="Executa a cena para testar o jogador, as colisões e os eventos.">Jogar</button>
    </div>

    <div class="topbar-spacer" />

    <details class="render-settings">
      <summary class="cam render-settings-trigger" :class="{ active: renderAll }" title="Configurar a renderização geral do mundo">
        <span class="render-settings-icon" aria-hidden="true">◌</span>
        {{ renderAll ? 'Render · Tudo' : 'Render' }}
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
            <span><strong>Oclusão da grama</strong><small>Evita montar instâncias de grama escondidas por objetos opacos. Desativar pode ajudar quando a cena não tem muitos obstáculos.</small></span>
          </label>
          <label class="render-settings-field render-settings-fog-field"><span>Frequência da oclusão</span>
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
    <button
      class="topbar-fullscreen"
      type="button"
      :class="{ active: worldFullscreen }"
      :title="fullscreenToggleTitle"
      :aria-label="fullscreenToggleTitle"
      :aria-pressed="worldFullscreen"
      @click="emit('toggle-world-fullscreen')"
    >
      <svg v-if="!worldFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5" />
      </svg>
      <span>{{ worldFullscreen ? 'Voltar ao editor' : 'Tela cheia do mundo' }}</span>
    </button>
    <button class="cam" :class="{ active: firstPersonMode }" :title="firstPersonMode ? 'Sair da visão em primeira pessoa.' : 'Entrar na visão em primeira pessoa para inspecionar o mundo do ponto de vista do jogador.'" @click="emit('toggle-first-person')">{{ firstPersonMode ? 'Sair 1ª pessoa' : '1ª pessoa' }}</button>
    <button class="cam" :title="`Alterna o enquadramento da câmera. Atual: ${cameraLabel}.`" @click="emit('cycle-camera')">{{ cameraLabel === 'Câmera livre' ? 'Câmera livre' : cameraLabel }}</button>
    <button class="cam" title="Personalize mapas de teclas, ações de movimento e atalhos do jogador." @click="emit('open-control-maps')">Controles</button>
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

</style>
