<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ObjectInfo, TerrainInfo } from '@engine'

interface ComponentEntry {
  id: string
  name: string
  kind?: 'object' | 'entity'
  group?: string
  libraryType?: 'object' | 'animated-model' | 'animation-source'
  thumbnail?: string
  height: number
  colliderType: 'box' | 'sphere' | 'capsule' | 'none'
  colliderSize: [number, number, number]
  colliderOffset: [number, number, number]
  createdAt: number
}

const activeTab = ref<'hierarchy' | 'components'>('hierarchy')
const activeLibraryCategory = ref<'object' | 'animated-model' | 'animation-source'>('object')
const libraryCategories: Array<'object' | 'animated-model' | 'animation-source'> = ['object', 'animated-model', 'animation-source']
const libraryCategoryLabels: Record<'object' | 'animated-model' | 'animation-source', string> = {
  object: 'Objetos',
  'animated-model': 'Animações modificadas',
  'animation-source': 'Fontes de animação',
}
const hierarchySearch = ref('')
const componentSearch = ref('')
const editingComponentId = ref<string | null>(null)
const editingComponentName = ref('')
const collapsedGroups = ref<Record<string, boolean>>({})
const GROUPS_STORAGE_KEY = 'engine-prometheus-component-groups'
const DEFAULT_COMPONENT_GROUPS = ['Veículos', 'Personagens', 'Construções', 'Natureza', 'Geral']

function loadCustomComponentGroups(): string[] {
  try {
    const value = window.localStorage.getItem(GROUPS_STORAGE_KEY)
    const parsed: unknown = value ? JSON.parse(value) : []
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
          .filter(name => !DEFAULT_COMPONENT_GROUPS.some(group => group.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')))
      : []
  } catch {
    return []
  }
}
const customComponentGroups = ref<string[]>(loadCustomComponentGroups())

function persistCustomComponentGroups() {
  try {
    window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(customComponentGroups.value))
  } catch {
    // A biblioteca continua utilizável mesmo quando o armazenamento do navegador está desativado.
  }
}

function inferComponentGroup(name: string): string {
  const value = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[_-]+/g, ' ')
  if (/\b(car|carro|vehicle|veiculo|moto|motorcycle|bike|truck|caminhao|van)\b/.test(value)) return 'Veículos'
  if (/\b(cj|boneco|person|personagem|human|humano|player|npc|character|cavalo|horse|animal|avatar|rider)\b/.test(value)) return 'Personagens'
  if (/\b(casa|house|building|build|construcao|medieval|porta|door|parede|wall|platform|plataforma|muro)\b/.test(value)) return 'Construções'
  if (/\b(grama|grass|tree|arvore|nature|natureza|planta|plant|rock|pedra|stone|bush|flor|flower)\b/.test(value)) return 'Natureza'
  return 'Geral'
}

function componentGroup(component: ComponentEntry): string {
  return component.group?.trim() || inferComponentGroup(component.name)
}

const props = defineProps<{
  objects: ObjectInfo[]
  terrain: TerrainInfo
  selectedId: string | null
  groupSelection: string[]
  terrainId: string
  rootOpen: boolean
  components: ComponentEntry[]
}>()

const libraryCategoryCounts = computed(() => ({
  object: props.components.filter(component => (component.libraryType ?? 'object') === 'object').length,
  'animated-model': props.components.filter(component => component.libraryType === 'animated-model').length,
  'animation-source': props.components.filter(component => component.libraryType === 'animation-source').length,
}))


const filteredObjects = computed(() => {
  const query = hierarchySearch.value.trim().toLocaleLowerCase('pt-BR')
  if (!query) return props.objects
  return props.objects.filter(object =>
    object.name.toLocaleLowerCase('pt-BR').includes(query)
    || object.type.toLocaleLowerCase('pt-BR').includes(query)
    || object.id.toLocaleLowerCase('pt-BR').includes(query),
  )
})
const terrainMatches = computed(() => {
  const query = hierarchySearch.value.trim().toLocaleLowerCase('pt-BR')
  return !query || 'terreno editável terreno editavel terrain'.includes(query)
})

const componentGroupOptions = computed(() => {
  const names = [
    ...DEFAULT_COMPONENT_GROUPS,
    ...customComponentGroups.value,
    ...props.components.map(componentGroup),
  ]
  return [...new Set(names)].sort((a, b) => {
    const ai = DEFAULT_COMPONENT_GROUPS.indexOf(a)
    const bi = DEFAULT_COMPONENT_GROUPS.indexOf(b)
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return a.localeCompare(b, 'pt-BR')
  })
})
const componentGroups = computed(() => {
  const query = componentSearch.value.trim().toLocaleLowerCase('pt-BR')
  const visibleComponents = props.components.filter(component =>
    (component.libraryType ?? 'object') === activeLibraryCategory.value
      && (!query || component.name.toLocaleLowerCase('pt-BR').includes(query)),
  )
  const names = componentGroupOptions.value.filter(name =>
    visibleComponents.some(component => componentGroup(component) === name)
    || customComponentGroups.value.includes(name),
  )
  return names.map(name => ({
    name,
    components: visibleComponents.filter(component => componentGroup(component) === name),
  }))
})

function addComponentGroup() {
  const requested = window.prompt('Nome do novo grupo de componentes:')
  const name = requested?.trim().slice(0, 48)
  if (!name) return
  if (componentGroupOptions.value.some(group => group.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
    window.alert('Já existe um grupo com esse nome.')
    return
  }
  customComponentGroups.value = [...customComponentGroups.value, name]
  persistCustomComponentGroups()
  collapsedGroups.value[name] = false
}

function beginComponentRename(component: ComponentEntry) {
  editingComponentId.value = component.id
  editingComponentName.value = component.name
}

function cancelComponentRename() {
  editingComponentId.value = null
  editingComponentName.value = ''
}

function saveComponentRename(component: ComponentEntry) {
  const name = editingComponentName.value.trim()
  if (!name) return
  if (name !== component.name) emit('rename-component', component.id, name)
  cancelComponentRename()
}

function updateComponentGroup(component: ComponentEntry, event: Event) {
  const group = (event.target as HTMLSelectElement).value
  emit('move-component', component.id, group)
}

const emit = defineEmits<{
  'update:rootOpen': [value: boolean]
  'select-item': [id: string, additive?: boolean]
  'group-selected': []
  'ungroup-selected': []
  'toggle-terrain': []
  'toggle-visible': [id: string]
  'toggle-lock': [id: string]
  'toggle-wireframe': [id: string]
  'place-component': [id: string]
  'preview-component': [id: string]
  'delete-component': [id: string]
  'rename-component': [id: string, name: string]
  'move-component': [id: string, group: string]
  'open-model-import': []
  'open-components': []
  'use-animation-source': [id: string]
  'collapse-sidebar': []
}>()
</script>

<template>
  <aside class="panel left">
    <div class="panel-head">
      <button
        class="sidebar-collapse-button"
        type="button"
        aria-label="Recolher painel lateral"
        title="Recolher hierarquia e biblioteca"
        @click="emit('collapse-sidebar')"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" />
          <path d="m13 7-3 3 3 3" />
        </svg>
      </button>
      <div class="panel-head-title">
        <div class="eyebrow">WORKSPACE</div>
        <div class="h">{{ activeTab === 'hierarchy' ? 'Hierarquia' : 'Componentes' }}</div>
      </div>
      <span class="badge">{{ activeTab === 'hierarchy' ? objects.length + 1 : components.length }}</span>
    </div>

    <nav class="library-tabs" aria-label="Painel lateral">
      <button :class="{ active: activeTab === 'hierarchy' }" title="Lista os objetos presentes no mundo e permite selecionar cada um." @click="activeTab = 'hierarchy'"><span class="tab-icon" aria-hidden="true">☷</span> Hierarquia</button>
      <button :class="{ active: activeTab === 'components' }" title="Abre a biblioteca de componentes salvos para reutilização na cena." @click="activeTab = 'components'; emit('open-components')"><span class="tab-icon" aria-hidden="true">▦</span> Componentes <span class="tab-count">{{ components.length }}</span></button>
    </nav>

    <template v-if="activeTab === 'hierarchy'">
      <label class="hierarchy-search">
        <span aria-hidden="true">⌕</span>
        <input v-model="hierarchySearch" type="search" placeholder="Buscar objetos…" aria-label="Buscar objetos na hierarquia" title="Filtra objetos por nome, tipo ou ID." />
        <button v-if="hierarchySearch" type="button" aria-label="Limpar busca" title="Limpa o filtro da hierarquia." @click="hierarchySearch = ''">×</button>
      </label>

      <div class="tree">
        <div class="row root" @click="emit('update:rootOpen', !rootOpen)">
          <span class="chev" :class="{ open: rootOpen || hierarchySearch.trim() }">›</span>
          <span class="ico world" />
          <span class="name">Mundo principal</span>
        </div>
        <template v-if="rootOpen || hierarchySearch.trim()">
          <div
            v-if="terrainMatches"
            class="row child terrain"
            :class="{ active: selectedId === terrainId }"
            @click="emit('select-item', terrainId)"
          >
            <span class="ico rect" />
            <span class="name">Terreno editável</span>
            <button class="eye" :class="{ off: !terrain.visible }" :title="terrain.visible ? 'Ocultar terreno' : 'Mostrar terreno'" :aria-label="terrain.visible ? 'Ocultar terreno' : 'Mostrar terreno'" :aria-pressed="terrain.visible" @click.stop="emit('toggle-terrain')" />
          </div>
          <div
            v-for="object in filteredObjects"
            :key="object.id"
            class="row child"
            :class="{ active: object.id === selectedId, 'group-selected': groupSelection.includes(object.id), hidden: !object.visible }"
            @click="emit('select-item', object.id, $event.ctrlKey || $event.metaKey)"
          >
            <span class="ico" :class="object.type" />
            <span class="name" :title="object.name">{{ object.name }}</span>
            <button class="eye" :class="{ off: !object.visible }" :title="object.visible ? 'Ocultar ' + object.name : 'Mostrar ' + object.name" :aria-label="object.visible ? 'Ocultar ' + object.name : 'Mostrar ' + object.name" :aria-pressed="object.visible" @click.stop="emit('toggle-visible', object.id)" />
            <button class="row-action lock-action" :class="{ active: object.locked }" :title="object.locked ? 'Desbloquear posição' : 'Bloquear posição'" :aria-label="object.locked ? 'Desbloquear posição de ' + object.name : 'Bloquear posição de ' + object.name" :aria-pressed="object.locked" @click.stop="emit('toggle-lock', object.id)">
              <svg v-if="object.locked" class="row-action-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3.1" y="7" width="9.8" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                <path d="M8 9.5v2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
              <svg v-else class="row-action-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3.1" y="7" width="9.8" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M10.8 7V4.8a2.8 2.8 0 0 0-5.6 0v1.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
            </button>
            <button class="row-action" :class="{ active: object.wireframeVisible }" :title="object.wireframeVisible ? 'Ocultar linhas dos polígonos' : 'Mostrar linhas dos polígonos'" aria-label="Alternar linhas dos polígonos" :aria-pressed="object.wireframeVisible" @click.stop="emit('toggle-wireframe', object.id)"><span class="wireframe-glyph" aria-hidden="true">{{ object.wireframeVisible ? '▱' : '▰' }}</span></button>
          </div>
          <div v-if="!filteredObjects.length && !terrainMatches" class="hierarchy-empty">Nenhum objeto encontrado para “{{ hierarchySearch }}”.</div>
        </template>
      </div>

      <div class="hierarchy-actions">
        <button :disabled="groupSelection.length < 2" title="Agrupa os objetos selecionados para transformá-los em conjunto." @click="emit('group-selected')">Agrupar <span v-if="groupSelection.length">({{ groupSelection.length }})</span></button>
        <button :disabled="groupSelection.length === 0" title="Remove o agrupamento dos objetos selecionados." @click="emit('ungroup-selected')">Desagrupar</button>
      </div>
    </template>

    <div v-else class="component-library">
      <div class="component-library-intro">
        <strong>Biblioteca de importados</strong>
        <p>Organize seus modelos por uso: objetos para construir o mundo, modelos com animações modificadas e arquivos usados apenas como fontes de movimento.</p>
      </div>

      <nav class="imported-category-tabs" aria-label="Categorias de importados">
        <button v-for="category in libraryCategories" :key="category"
          :class="{ active: activeLibraryCategory === category }"
          :title="libraryCategoryLabels[category]"
          @click="activeLibraryCategory = category; componentSearch = ''">
          <span>{{ category === 'object' ? '▧' : category === 'animated-model' ? '♟' : '▶' }}</span>
          <small>{{ libraryCategoryLabels[category] }}</small>
          <b>{{ libraryCategoryCounts[category] }}</b>
        </button>
      </nav>

      <label class="component-search-field">
        <span aria-hidden="true">⌕</span>
        <input v-model="componentSearch" type="search" placeholder="Buscar importados…" aria-label="Buscar na biblioteca de importados" />
        <button v-if="componentSearch" type="button" aria-label="Limpar busca" @click="componentSearch = ''">×</button>
      </label>

      <div class="component-groups-scroll">
        <div v-if="libraryCategoryCounts[activeLibraryCategory] === 0 && !componentSearch.trim()" class="component-library-empty">
          <span>{{ activeLibraryCategory === 'object' ? '▧' : activeLibraryCategory === 'animated-model' ? '♟' : '▶' }}</span>
          <strong>{{ activeLibraryCategory === 'object' ? 'Nenhum objeto importado' : activeLibraryCategory === 'animated-model' ? 'Nenhum modelo com animações modificadas' : 'Nenhuma fonte de animação' }}</strong>
          <small>{{ activeLibraryCategory === 'animation-source' ? 'Carregue um GLB animado na aba de rigging e salve-o como fonte de animação.' : 'Use Importar modelo para adicionar arquivos à biblioteca.' }}</small>
        </div>
        <div v-else-if="!componentGroups.some(group => group.components.length)" class="component-library-empty">
          <span>⌕</span><strong>Nenhum resultado</strong>
          <small>Experimente outro termo de busca.</small>
        </div>

        <section v-for="group in componentGroups" :key="group.name" class="component-group">
          <button class="component-group-heading" :aria-expanded="!collapsedGroups[group.name]" :title="collapsedGroups[group.name] ? 'Expandir este grupo de componentes.' : 'Recolher este grupo de componentes.'" @click="collapsedGroups[group.name] = !collapsedGroups[group.name]">
            <span class="component-group-chevron" :class="{ collapsed: collapsedGroups[group.name] }">›</span>
            <span class="component-group-name">{{ group.name }}</span>
            <span class="component-group-count">{{ group.components.length }}</span>
          </button>
          <div v-if="!collapsedGroups[group.name]" class="component-group-list">
            <article v-for="component in group.components" :key="component.id" class="saved-component-card">
              <div v-if="editingComponentId === component.id" class="saved-component-rename">
                <input
                  v-model="editingComponentName"
                  :aria-label="'Novo nome para ' + component.name"
                  :title="'Editar nome de ' + component.name"
                  maxlength="80"
                  autofocus
                  @keydown.enter.prevent="saveComponentRename(component)"
                  @keydown.esc.prevent="cancelComponentRename"
                />
                <button class="saved-component-rename-save" title="Salvar nome" aria-label="Salvar nome" :disabled="!editingComponentName.trim()" @click="saveComponentRename(component)">✓</button>
                <button class="saved-component-rename-cancel" title="Cancelar edição" aria-label="Cancelar edição" @click="cancelComponentRename">×</button>
              </div>
              <template v-else>
                <span class="saved-component-art" :class="{ entity: component.kind === 'entity', 'has-thumbnail': !!component.thumbnail, 'animation-source-art': component.libraryType === 'animation-source', 'animated-model-art': component.libraryType === 'animated-model' }" aria-hidden="true"><img v-if="component.thumbnail" :src="component.thumbnail" alt="" loading="lazy" /><span v-else>{{ component.libraryType === 'animation-source' ? '▶' : component.kind === 'entity' ? '♟' : component.libraryType === 'animated-model' ? '♬' : '▧' }}</span></span>
                <div class="saved-component-copy">
                  <strong :title="component.name">{{ component.name }}</strong>
                  <small v-if="component.libraryType === 'animation-source'">{{ component.height.toFixed(2) }} u · Fonte de animações</small>
                  <small v-else-if="component.libraryType === 'animated-model'">{{ component.height.toFixed(2) }} u · Animações modificadas</small>
                  <small v-else>{{ component.height.toFixed(2) }} u · {{ component.colliderType === 'none' ? 'Sem colisor' : component.colliderType === 'sphere' ? 'Esfera' : component.colliderType === 'capsule' ? 'Cápsula' : 'Caixa' }}</small>
                </div>
                <button v-if="component.libraryType === 'animation-source'" class="saved-component-insert saved-component-source" :title="'Carregar ' + component.name + ' como origem das animações'" @click="emit('use-animation-source', component.id)">Usar origem</button>
                <button v-else class="saved-component-insert" :title="'Inserir ' + component.name" @click="emit('place-component', component.id)">＋ Inserir</button>
                <details class="saved-component-menu">
                  <summary :aria-label="'Mais opções para ' + component.name" title="Mais opções">⋯</summary>
                  <div class="saved-component-menu-popover">
                    <button title="Altera o nome deste componente na biblioteca." @click="beginComponentRename(component)">Renomear</button>
                    <button v-if="component.libraryType !== 'animation-source'" title="Abre o componente em pré-visualização e permite editar suas configurações, salvando no próprio componente." @click="emit('preview-component', component.id)">Editar / pré-visualizar</button>
                    <label v-if="component.libraryType !== 'animation-source'">Grupo
                      <select :value="componentGroup(component)" aria-label="Grupo do componente" @change="updateComponentGroup(component, $event)">
                        <option v-for="name in componentGroupOptions" :key="name" :value="name">{{ name }}</option>
                      </select>
                    </label>
                    <button class="delete-option" title="Remove este componente salvo da biblioteca." @click="emit('delete-component', component.id)">Excluir</button>
                  </div>
                </details>
              </template>
            </article>
          </div>
        </section>
      </div>

      <div class="component-library-footer">
        <button title="Cria um grupo personalizado para organizar os componentes salvos." @click="addComponentGroup">＋ Novo grupo</button>
        <button class="import-component-button" title="Importa um modelo 3D e permite salvá-lo como componente reutilizável." @click="emit('open-model-import')">Importar modelo</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.hierarchy-actions{display:flex;gap:5px;padding:0 10px 9px}.hierarchy-actions button{flex:1;min-width:0;padding:6px 4px;border:1px solid #414756;border-radius:4px;background:#292d37;color:#cbd2de;font-size:10px;cursor:pointer}.hierarchy-actions button:disabled{opacity:.4;cursor:default}.row.group-selected{outline:1px solid #b78048;outline-offset:-1px}.row-action{border:0;background:transparent;color:#8f99aa;cursor:pointer;padding:2px 3px;font-size:12px}.row-action.active{color:#f3c34e}
.library-tabs{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:7px 9px;border-bottom:1px solid #242a35;background:#171b23}.library-tabs button{min-width:0;padding:7px 4px;border:1px solid transparent;border-radius:4px;background:transparent;color:#9ba4b4;font-size:10px;cursor:pointer}.library-tabs button.active{border-color:#554034;background:#332720;color:#f0c39a}.library-tabs button span{margin-left:3px;color:#e9a76e}.component-library{min-height:0;flex:1;overflow:auto;padding:9px}.component-library-intro{padding:9px;border:1px solid #303744;border-radius:5px;background:#1b2029}.imported-category-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:8px 0;padding:4px;border:1px solid #303744;border-radius:5px;background:#171b23}.imported-category-tabs button{display:flex;min-width:0;min-height:54px;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:5px 2px;border:1px solid transparent;border-radius:4px;background:transparent;color:#9ba4b4;cursor:pointer}.imported-category-tabs button.active{border-color:#765538;background:#33271f;color:#f0c39a}.imported-category-tabs button>span{font-size:14px;color:#e9a76e}.imported-category-tabs button small{overflow:hidden;max-width:100%;font-size:9px;text-align:center;line-height:1.25}.imported-category-tabs button b{color:#d6a06d;font:9px ui-monospace,monospace}.component-search-field{display:flex;align-items:center;gap:6px;margin:8px 0;padding:0 7px;border:1px solid #303744;border-radius:4px;background:#141820;color:#9ba4b4}.component-search-field input{flex:1;min-width:0;width:100%;padding:7px 0;border:0;background:transparent;outline:0;color:#e0e5ee;font-size:10px}.component-search-field button{border:0;background:transparent;color:#9ba4b4}.component-library-intro{padding:9px;border:1px solid #303744;border-radius:5px;background:#1b2029}.component-library-intro strong{font-size:11px;color:#e0e5ee}.component-library-intro p{margin:6px 0 0;color:#929caf;font-size:10px;line-height:1.5}.component-library-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px 12px;color:#a5adbc;text-align:center}.component-library-empty>span{font-size:28px;color:#d99057}.component-library-empty strong{font-size:11px}.component-library-empty small{font-size:10px;line-height:1.5;color:#858fa0}.saved-component{display:flex;align-items:stretch;gap:3px;margin-top:7px}.saved-component-place{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding:9px 7px;border:1px solid #303744;border-radius:5px;background:#202631;color:#dce2eb;text-align:left;cursor:pointer}.saved-component-place:hover{border-color:#bc7846;background:#2b2928}.saved-component-icon{display:grid;place-items:center;flex:none;width:31px;height:31px;border-radius:4px;background:#332920;color:#e9a76e;font-size:18px}.saved-component-copy{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}.saved-component-copy strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.saved-component-copy small{color:#929caf;font-size:9px}.saved-component-add{color:#e9a76e;font-size:18px}.saved-component-preview{width:28px;border:1px solid #303744;border-radius:4px;background:#202631;color:#e9a76e;cursor:pointer}.saved-component-preview:hover{border-color:#bc7846;background:#2b2928}.saved-component-delete{width:25px;border:1px solid #303744;border-radius:4px;background:#202631;color:#9a9fac;cursor:pointer}.saved-component-delete:hover{border-color:#a24e4e;color:#ff9696}
.saved-component-edit{width:27px;flex:none;border:1px solid #303744;border-radius:4px;background:#202631;color:#b7c0ce;cursor:pointer}.saved-component-edit:hover{border-color:#bc7846;color:#f0c39a}.saved-component-rename{display:flex;align-items:center;gap:3px;flex:1;min-width:0}.saved-component-rename input{box-sizing:border-box;flex:1;min-width:0;width:100%;padding:8px 6px;border:1px solid #9b704d;border-radius:4px;background:#171b23;color:#e2e7ef;font-size:10px;outline:0}.saved-component-rename-save,.saved-component-rename-cancel{width:26px;flex:none;border:1px solid #39404c;border-radius:4px;background:#222732;color:#cdd4df;cursor:pointer}.saved-component-rename-save{border-color:#4b8065;color:#99e2b4}.saved-component-rename-save:disabled{opacity:.4;cursor:default}.saved-component-rename-cancel{color:#dda5a0}

/* Refined hierarchy controls: consistent monochrome icons and clearer selection. */
.row.group-selected {
  border: 1px solid #604a2a;
  border-radius: 5px;
  background: #201d18;
  outline: none;
}
.row.group-selected.active {
  border-color: #7b5d24;
  background: #2b2417;
}
.eye {
  position: relative;
  flex: none;
  width: 14px;
  height: 11px;
  min-width: 14px;
  min-height: 11px;
  margin-inline: 3px;
  padding: 0;
  border: 1px solid #8a96a8;
  border-radius: 75% 15%;
  transform: rotate(45deg);
  background: #8a96a8;
  box-shadow: none;
  opacity: .62;
}
.eye::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: #151920;
}
.eye.off {
  border-color: #687385;
  background: transparent;
  box-shadow: none;
  opacity: .42;
}
.eye.off::after { background: #687385; }
.row:hover .eye,
.row.active .eye,
.eye:focus-visible { opacity: 1; }
.eye:hover {
  border-color: #f5c56b;
  background: #f5c56b;
}
.eye:hover::after { background: #151920; }
.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  min-width: 24px;
  min-height: 24px;
  padding: 0;
  border-radius: 5px;
  color: #8f99aa;
  line-height: 1;
}
.row-action-icon { display: block; width: 14px; height: 14px; }
.row-action[aria-pressed="true"] {
  color: #f5c56b;
  background: #2a2418;
}
.row-action:hover {
  border: 1px solid #414b5a;
  background: #252c37;
  color: #e5eaf2;
}
.row-action:focus-visible {
  outline: 2px solid #f5a524;
  outline-offset: 1px;
}
.wireframe-glyph { display: block; font-size: 13px; line-height: 1; }
.component-library .saved-component-place:focus-visible,
.component-library .saved-component-preview:focus-visible,
.component-library .saved-component-edit:focus-visible,
.component-library .saved-component-delete:focus-visible {
  outline: 2px solid #f5a524;
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .saved-component-place { transition: none; }
}

/* Reference-layout controls for hierarchy search and grouped component library. */
.panel.left .hierarchy-search {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 35px;
  margin: 9px 12px 8px;
  padding: 0 9px;
  border: 1px solid #2d3542;
  border-radius: 6px;
  background: #0f1319;
  color: #8290a3;
}
.panel.left .hierarchy-search > span { font-size: 19px; line-height: 1; }
.panel.left .hierarchy-search input {
  width: 100%;
  min-width: 0;
  height: 31px;
  min-height: 31px;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #e3e8f0;
  font-size: 11px;
}
.panel.left .hierarchy-search input:focus { outline: none; box-shadow: none; }
.panel.left .hierarchy-search input::placeholder { color: #778293; }
.panel.left .hierarchy-search:focus-within {
  border-color: #7a5a20;
  box-shadow: 0 0 0 2px #f5a52412;
}
.panel.left .hierarchy-search button {
  width: 22px;
  min-width: 22px;
  min-height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #97a2b2;
  font-size: 17px;
}
.panel.left .hierarchy-search button:hover { background: #262d38; color: #fff; }
.panel.left .tree { order: 3; min-height: 0; flex: 1; }
.panel.left .hierarchy-actions {
  order: 5;
  flex: none;
  margin-top: auto;
  padding: 9px 12px;
  border-top: 1px solid #262c36;
  border-bottom: 0;
  background: #13171d;
}
.panel.left .hierarchy-actions button {
  min-height: 34px;
  padding: 0 8px;
  white-space: nowrap;
}
.panel.left .hierarchy-empty {
  padding: 18px 10px;
  color: #8490a1;
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}
.panel.left .component-library {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 9px;
  padding: 10px 10px 0;
  overflow: hidden;
}
.panel.left .component-library-intro {
  flex: none;
  padding: 10px;
  border-color: #2e3541;
  border-radius: 6px;
  background: #171c24;
}
.panel.left .component-library-intro strong { font-size: 11px; }
.panel.left .component-library-intro p { font-size: 10px; line-height: 1.45; }
.panel.left .component-groups-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 8px;
  scrollbar-width: thin;
  scrollbar-color: #303947 transparent;
}
.panel.left .component-group { margin: 2px 0 7px; }
.panel.left .component-group-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 29px;
  padding: 4px 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #8f9bad;
  text-align: left;
}
.panel.left .component-group-heading:hover {
  border-color: #2e3541;
  background: #1b2028;
  color: #d8dee8;
}
.panel.left .component-group-chevron {
  flex: none;
  width: 10px;
  color: #8893a4;
  font-size: 16px;
  line-height: 1;
  transform: rotate(90deg);
  transition: transform .12s ease;
}
.panel.left .component-group-chevron.collapsed { transform: rotate(0); }
.panel.left .component-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .12em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.panel.left .component-group-count {
  color: #aab4c3;
  font: 10px 'IBM Plex Mono', monospace;
}
.panel.left .component-group-list { display: flex; flex-direction: column; gap: 5px; }
.panel.left .saved-component-card {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 60px;
  padding: 7px;
  border: 1px solid #282f3a;
  border-radius: 6px;
  background: #191e26;
  transition: border-color .12s ease, background-color .12s ease;
}
.panel.left .saved-component-card:hover {
  border-color: #3b4655;
  background: #1d232d;
}
.panel.left .saved-component-art {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  overflow: hidden;
  border: 1px solid #4b3a1e;
  border-radius: 5px;
  background: repeating-linear-gradient(135deg, #382b16 0, #382b16 5px, #292317 5px, #292317 10px);
  color: #e7b55b;
}
.panel.left .saved-component-art.entity {
  border-color: #3e4e54;
  background: repeating-linear-gradient(135deg, #253a3d 0, #253a3d 5px, #1c2b30 5px, #1c2b30 10px);
  color: #a9d3c6;
}
.panel.left .saved-component-art > span { font-size: 18px; opacity: .9; }
.panel.left .saved-component-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.panel.left .saved-component-copy strong {
  overflow: hidden;
  color: #e1e6ee;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel.left .saved-component-copy small {
  overflow: hidden;
  color: #8e9aac;
  font: 9px 'IBM Plex Mono', monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel.left .saved-component-insert {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 64px;
  min-height: 29px;
  padding: 0 7px;
  border: 1px solid #59431f;
  border-radius: 5px;
  background: #262115;
  color: #f1c06b;
  font-size: 10px;
}
.panel.left .saved-component-insert:hover {
  border-color: #93702c;
  background: #332a19;
}
.panel.left .saved-component-menu { position: relative; flex: none; }
.panel.left .saved-component-menu > summary {
  display: grid;
  place-items: center;
  width: 24px;
  min-height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #8f9aab;
  cursor: pointer;
  font-size: 16px;
  list-style: none;
}
.panel.left .saved-component-menu > summary::-webkit-details-marker { display: none; }
.panel.left .saved-component-menu > summary:hover,
.panel.left .saved-component-menu[open] > summary {
  border-color: #394351;
  background: #252c36;
  color: #f1c06b;
}
.panel.left .saved-component-menu-popover {
  position: absolute;
  z-index: 180;
  top: calc(100% + 4px);
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 180px;
  padding: 5px;
  border: 1px solid #394351;
  border-radius: 6px;
  background: #171c24;
  box-shadow: 0 12px 30px #0009;
}
.panel.left .saved-component-menu-popover > button {
  min-height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #d9e0e9;
  text-align: left;
  font-size: 10px;
}
.panel.left .saved-component-menu-popover > button:hover {
  background: #252c36;
  color: #f4c36f;
}
.panel.left .saved-component-menu-popover label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 8px;
  color: #8f9aab;
  font-size: 10px;
}
.panel.left .saved-component-menu-popover select {
  width: 100%;
  min-width: 0;
  min-height: 29px;
  padding: 0 6px;
  border: 1px solid #333d4b;
  border-radius: 4px;
  background: #0f1319;
  color: #e5eaf1;
  font-size: 10px;
}
.panel.left .saved-component-menu-popover > button.delete-option { color: #f19b94; }
.panel.left .saved-component-menu-popover > button.delete-option:hover { background: #2b1c1e; }
.panel.left .saved-component-rename {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 4px;
  min-width: 0;
}
.panel.left .saved-component-rename input {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 0 7px;
  border-color: #76571e;
  border-radius: 5px;
  background: #10141a;
  color: #e5eaf1;
  font-size: 11px;
}
.panel.left .saved-component-rename-save,
.panel.left .saved-component-rename-cancel {
  flex: none;
  width: 26px;
  min-width: 26px;
  min-height: 28px;
  border: 1px solid #36404e;
  border-radius: 5px;
  background: #202630;
  color: #dce3ed;
}
.panel.left .saved-component-rename-save { color: #9adcb2; }
.panel.left .saved-component-rename-cancel { color: #f19b94; }
.panel.left .component-library-footer {
  display: flex;
  flex: none;
  gap: 6px;
  padding: 9px 0 10px;
  border-top: 1px solid #252c36;
  background: #141920;
}
.panel.left .component-library-footer button {
  flex: 1;
  min-width: 0;
  min-height: 35px;
  padding: 0 7px;
  border: 1px solid #303947;
  border-radius: 5px;
  background: #1b2028;
  color: #c9d1de;
  font-size: 10px;
}
.panel.left .component-library-footer button:hover {
  border-color: #495566;
  background: #252c36;
}
.panel.left .component-library-footer button.import-component-button {
  border-color: #6b4f1e;
  background: #2a2418;
  color: #f3c36b;
}
.panel.left .component-library-footer button.import-component-button:hover {
  border-color: #98712c;
  background: #352b1a;
}
.panel.left .component-library-empty {
  padding: 25px 10px;
  border: 1px dashed #343d4a;
  border-radius: 6px;
  background: #141920;
}
@media (max-width: 1180px) {
  .panel.left .saved-component-card { gap: 5px; padding: 6px; }
  .panel.left .saved-component-art { width: 30px; height: 32px; }
  .panel.left .saved-component-insert { min-width: 51px; padding-inline: 5px; }
}
@media (max-width: 760px) {
  .panel.left .component-library-intro { padding: 8px; }
  .panel.left .saved-component-card { min-height: 54px; }
  .panel.left .saved-component-art { width: 26px; height: 29px; }
  .panel.left .saved-component-insert { min-width: 43px; font-size: 9px; }
  .panel.left .saved-component-copy small { font-size: 8px; }
}
.panel.left .saved-component-art.has-thumbnail {
  border-color: #3b4655;
  background: #20232a;
  color: transparent;
}
.panel.left .saved-component-art img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 2px;
  box-sizing: border-box;
}
</style>
