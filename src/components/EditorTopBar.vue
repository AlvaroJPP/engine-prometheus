<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{
  projectName: string
  dirty: boolean
  cameraLabel: string
  firstPersonMode: boolean
  grassRenderDistance: number
  grassRenderAll: boolean
  executionMode: 'edit' | 'running' | 'stopped'
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
  'grass-render-distance-change': [value: number]
  'grass-render-all-change': [value: boolean]
  'open-control-maps': []
  'run-world': []
  'edit-world': []
  'select-object': [id: string]
  'place-component': [id: string]
  'open-model-import': []
}>()
type SearchResult = { key: string; label: string; detail: string; action: 'object' | 'component' | 'save' | 'import' | 'edit' | 'run' | 'camera' | 'controls'; id?: string }
const searchQuery = ref('')
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
        <div class="title">ENGINE PROMETHEUS</div>
      </div>
    </div>

    <details class="file-menu">
      <summary>Arquivo <span aria-hidden="true">▾</span></summary>
      <div class="file-menu-popover">
        <button @click="emit('new-project')">Novo projeto</button>
        <button @click="emit('open-project')">Abrir projeto…</button>
        <button @click="emit('save-project', false)">Salvar <kbd>Ctrl S</kbd></button>
        <button @click="emit('save-project', true)">Salvar como…</button>
      </div>
    </details>

    <div class="project">
      <input :value="projectName" class="pname" aria-label="Nome do projeto" spellcheck="false" @input="emit('update:projectName', ($event.target as HTMLInputElement).value); emit('mark-dirty')" />
      <span class="save-state" :class="dirty ? 'is-dirty' : 'is-saved'"><i class="dot" :class="dirty ? 'warn' : 'ok'" />{{ dirty ? 'Não salvo' : 'Salvo' }}</span>
    </div>

    <div class="global-search-wrap">
      <label class="global-search">
        <span class="search-glass" aria-hidden="true">⌕</span>
        <input id="global-editor-search" v-model="searchQuery" type="search" placeholder="Buscar objetos, componentes e comandos…" aria-label="Busca global do editor" @keydown.esc="searchQuery = ''" />
        <kbd>Ctrl K</kbd>
      </label>
      <div v-if="searchQuery.trim()" class="global-search-results" role="listbox" aria-label="Resultados da busca">
        <button v-for="result in searchResults" :key="result.key" class="global-search-result" role="option" @mousedown.prevent="activateSearchResult(result)">
          <span class="global-search-result-main">{{ result.label }}</span><small>{{ result.detail }}</small>
        </button>
        <div v-if="!searchResults.length" class="global-search-empty">Nenhum resultado encontrado</div>
      </div>
    </div>

    <div class="mode-segment" aria-label="Modo do editor">
      <button :class="{ active: executionMode !== 'running' }" @click="emit('edit-world')" title="Modo de edição">Editar</button>
      <button :class="{ active: executionMode === 'running' }" @click="emit('run-world')" title="Executar cena">Jogar</button>
    </div>

    <div class="topbar-spacer" />

    <details class="render-settings">
      <summary class="cam render-settings-trigger" :class="{ active: grassRenderAll }" title="Configurar alcance de renderização da grama">
        <span class="render-settings-icon" aria-hidden="true">◌</span>
        {{ grassRenderAll ? 'Grama · Tudo' : 'Grama' }}
        <span class="render-settings-chevron">▾</span>
      </summary>
      <div class="render-settings-popover">
        <div class="render-settings-heading">Renderização da grama</div>
        <p class="render-settings-description">Defina a distância máxima a partir do jogador ou da câmera do editor.</p>
        <label class="render-settings-field">
          <span>Alcance máximo</span>
          <span class="render-settings-number-wrap">
            <input type="number" min="10" max="5000" step="1" :value="grassRenderDistance" :disabled="grassRenderAll" aria-label="Alcance máximo da grama em unidades" @change="emit('grass-render-distance-change', Number(($event.target as HTMLInputElement).value))" />
            <small>un.</small>
          </span>
        </label>
        <input class="render-settings-range" type="range" min="10" max="500" step="1" :value="Math.min(grassRenderDistance, 500)" :disabled="grassRenderAll" aria-label="Ajuste rápido do alcance da grama" @input="emit('grass-render-distance-change', Number(($event.target as HTMLInputElement).value))" />
        <div class="render-settings-range-labels"><span>10 unidades</span><span>500 unidades</span></div>
        <label class="render-settings-everything">
          <input type="checkbox" :checked="grassRenderAll" @change="emit('grass-render-all-change', ($event.target as HTMLInputElement).checked)" />
          <span><strong>Renderizar tudo</strong><small>Ignora a distância máxima e inclui toda a grama do mapa.</small></span>
        </label>
        <p class="render-settings-note">Quanto maior o alcance, maior o custo de renderização. A qualidade diminui gradualmente nos anéis mais distantes.</p>
      </div>
    </details>
    <button class="cam" :class="{ active: firstPersonMode }" @click="emit('toggle-first-person')">{{ firstPersonMode ? 'Sair 1ª pessoa' : '1ª pessoa' }}</button>
    <button class="cam" @click="emit('cycle-camera')">{{ cameraLabel === 'Câmera livre' ? 'Câmera livre' : cameraLabel }}</button>
    <button class="cam" @click="emit('open-control-maps')">Controles</button>
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
.global-search-wrap { position:relative; flex:1 1 260px; width:min(420px,30vw); max-width:420px; min-width:140px; }
.global-search { display:flex; align-items:center; gap:8px; flex:1 1 260px; width:100%; max-width:100%; min-width:0; height:32px; padding:0 7px 0 10px; border:1px solid #252a33; border-radius:6px; background:#0e1013; color:#9aa1ae; }
.global-search input { width:100%; min-width:0; border:0; outline:0; background:transparent; color:#e6e8ec; font-size:11px; }
.global-search input::placeholder { color:#7b8290; }
.search-glass { font-size:20px; line-height:1; }
.global-search-results { position:absolute; z-index:260; top:calc(100% + 5px); left:0; right:0; max-height:320px; overflow:auto; padding:4px; border:1px solid #2c323d; border-radius:7px; background:#14171c; box-shadow:0 12px 32px #0009; }
.global-search-result { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; min-height:34px; padding:5px 8px; border:0; border-radius:4px; background:transparent; color:#e6e8ec; text-align:left; cursor:pointer; }
.global-search-result:hover { background:#292314; color:#f5c56b; }
.global-search-result-main { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.global-search-result small { flex:none; color:#7b8290; font-size:10px; }
.global-search-empty { padding:12px 8px; color:#9aa1ae; font-size:11px; }

.mode-segment { display:flex; flex:none; padding:3px; gap:2px; border:1px solid #252a33; border-radius:7px; background:#0b0d10; }
.mode-segment button { height:26px; min-width:55px; padding:0 10px; border:0; border-radius:4px; background:transparent; color:#9aa1ae; font-size:11px; cursor:pointer; }
.mode-segment button.active { background:#f5a524; color:#1a1204; font-weight:700; }
.topbar-spacer { flex:1; min-width:4px; }
.save-state { display:flex; align-items:center; gap:5px; white-space:nowrap; font-size:10px; color:#9aa1ae; }
.save-state .dot { width:6px; height:6px; }
.save-state.is-saved { color:#3fb950; }
.save-state.is-dirty { color:#f5a524; }
.render-settings { position:relative; flex:none; }
.render-settings > summary { list-style:none; cursor:pointer; user-select:none; }
.render-settings > summary::-webkit-details-marker { display:none; }
.render-settings-trigger.active { background:#292314; border-color:#7d5b1b; color:#f5c56b; }
.render-settings-popover { position:absolute; z-index:200; top:calc(100% + 7px); right:0; width:min(330px,calc(100vw - 24px)); box-sizing:border-box; padding:14px; border:1px solid #252a33; border-radius:7px; background:#14171c; color:#e6e8ec; box-shadow:0 12px 32px #0009; }
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
  .global-search kbd { display:none; }
  .cam { padding-inline:7px; }
}
@media(max-width:760px) {
  .global-search-wrap { display:none; }
  .mode-segment { display:none; }
  .render-settings-trigger { gap:4px; padding-inline:7px; }
  .render-settings-icon { display:none; }
  .cam { padding-inline:7px; font-size:10px; }
}
</style>
