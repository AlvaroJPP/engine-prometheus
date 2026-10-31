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
  colliderType: 'box' | 'sphere' | 'capsule' | 'mesh' | 'none'
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
                  <small v-else>{{ component.height.toFixed(2) }} u · {{ component.colliderType === 'none' ? 'Sem colisor' : component.colliderType === 'sphere' ? 'Esfera' : component.colliderType === 'capsule' ? 'Cápsula' : component.colliderType === 'mesh' ? 'Malha estática' : 'Caixa' }}</small>
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

<style scoped src="./SceneHierarchy.css"></style>
