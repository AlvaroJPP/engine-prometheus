<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ObjectInfo, ObjectType, SceneFolderData } from '@engine'
import UiIcon from './UiIcon.vue'

type TreeRow =
  | { type: 'folder'; folder: SceneFolderData; depth: number; count: number }
  | { type: 'object'; object: ObjectInfo; depth: number }

const props = defineProps<{
  objects: ObjectInfo[]
  folders: SceneFolderData[]
  selectedId: string | null
  groupSelection: string[]
  projectName: string
  searchQuery: string
}>()

const emit = defineEmits<{
  (event: 'select', id: string, additive: boolean): void
  (event: 'toggle-visibility', id: string): void
  (event: 'add-object', type: ObjectType): void
  (event: 'add-spawn'): void
  (event: 'group'): void
  (event: 'ungroup'): void
  (event: 'copy'): void
  (event: 'paste'): void
  (event: 'remove'): void
  (event: 'import-model'): void
  (event: 'update:searchQuery', value: string): void
  (event: 'create-folder', folder: SceneFolderData): void
  (event: 'rename-folder', id: string, name: string): void
  (event: 'delete-folder', id: string): void
  (event: 'move-object', objectId: string, folderId: string | null): void
  (event: 'move-folder', folderId: string, parentId: string | null): void
}>()

const activeTab = ref<'hierarchy' | 'components'>('hierarchy')
const collapsed = ref<string[]>([])
const editingFolderId = ref<string | null>(null)
const editingFolderName = ref('')
const editingInput = ref<HTMLInputElement | null>(null)
const draggedItem = ref<{ type: 'folder' | 'object'; id: string } | null>(null)
const dragOverId = ref<string | null>(null)

function isExpanded(id: string) {
  return !collapsed.value.includes(id)
}

function toggleFolder(id: string) {
  collapsed.value = isExpanded(id)
    ? [...collapsed.value, id]
    : collapsed.value.filter(value => value !== id)
}

function makeId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function startCreateFolder(parentId: string | null) {
  const id = makeId()
  const folder: SceneFolderData = { id, name: 'Nova pasta', parentId }
  emit('create-folder', folder)
  editingFolderId.value = id
  editingFolderName.value = folder.name
  if (parentId !== null) collapsed.value = collapsed.value.filter(value => value !== parentId)
  void nextTick(() => editingInput.value?.focus())
}

function finishFolderRename() {
  const id = editingFolderId.value
  if (!id) return
  const value = editingFolderName.value.trim()
  editingFolderId.value = null
  if (value) emit('rename-folder', id, value)
}

function cancelFolderRename() {
  editingFolderId.value = null
}

function folderHasMatchingContent(folderId: string, query: string): boolean {
  const directObjects = props.objects.filter(object => object.folderId === folderId)
  if (directObjects.some(object => object.name.toLocaleLowerCase().includes(query))) return true
  return props.folders
    .filter(folder => folder.parentId === folderId)
    .some(folder => folder.name.toLocaleLowerCase().includes(query) || folderHasMatchingContent(folder.id, query))
}

function countFolderObjects(folderId: string): number {
  const direct = props.objects.filter(object => object.folderId === folderId).length
  return direct + props.folders
    .filter(folder => folder.parentId === folderId)
    .reduce((sum, folder) => sum + countFolderObjects(folder.id), 0)
}

const treeRows = computed<TreeRow[]>(() => {
  const result: TreeRow[] = []
  const query = props.searchQuery.trim().toLocaleLowerCase()

  const appendObjects = (parentId: string | null, depth: number, inheritedMatch: boolean) => {
    for (const object of props.objects.filter(item => item.folderId === parentId)) {
      if (query && !inheritedMatch && !object.name.toLocaleLowerCase().includes(query)) continue
      result.push({ type: 'object', object, depth })
    }
  }

  const appendFolders = (parentId: string | null, depth: number, inheritedMatch: boolean) => {
    const children = props.folders
      .filter(folder => folder.parentId === parentId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

    for (const folder of children) {
      const ownMatch = !query || folder.name.toLocaleLowerCase().includes(query)
      const hasMatch = ownMatch || (!inheritedMatch && query !== '' && folderHasMatchingContent(folder.id, query))
      if (query && !inheritedMatch && !hasMatch) continue

      result.push({ type: 'folder', folder, depth, count: countFolderObjects(folder.id) })

      const expanded = query !== '' || isExpanded(folder.id)
      if (!expanded) continue
      const matchAllChildren = inheritedMatch || ownMatch
      appendFolders(folder.id, depth + 1, matchAllChildren)
      appendObjects(folder.id, depth + 1, matchAllChildren)
    }
  }

  appendFolders(null, 0, false)
  appendObjects(null, 0, false)
  return result
})

function objectIcon(object: ObjectInfo) {
  const name = object.name.toLocaleLowerCase()
  if (/terreno|terrain/.test(name)) return 'terreno'
  if (/floresta|forest|arvore|árvore|tree/.test(name)) return 'floresta'
  if (/rio|river/.test(name)) return 'rio'
  if (/player|jogador/.test(name)) return 'player'
  if (/guarda|guard/.test(name)) return 'guarda'
  if (/baú|bau|chest/.test(name)) return 'bau'
  if (object.importedModel) return 'box'
  if (object.type === 'platform') return 'terreno'
  return 'square'
}

function startDrag(event: DragEvent, type: 'folder' | 'object', id: string) {
  draggedItem.value = { type, id }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${type}:${id}`)
  }
}

function finishDrag() {
  draggedItem.value = null
  dragOverId.value = null
}

function dropOnFolder(targetFolderId: string | null) {
  const source = draggedItem.value
  if (!source) return
  if (source.type === 'object') emit('move-object', source.id, targetFolderId)
  else if (source.id !== targetFolderId) emit('move-folder', source.id, targetFolderId)
  finishDrag()
}

function folderDragOver(event: DragEvent, folderId: string) {
  if (!draggedItem.value) return
  if (draggedItem.value.type === 'folder' && draggedItem.value.id === folderId) return
  event.preventDefault()
  dragOverId.value = folderId
}

function rootDragOver(event: DragEvent) {
  if (!draggedItem.value) return
  event.preventDefault()
  dragOverId.value = 'root'
}

function isFolderDragging(folderId: string) {
  return draggedItem.value?.type === 'folder' && draggedItem.value.id === folderId
}
</script>

<template>
  <aside class="hierarchy-panel">
    <div class="hierarchy-tabs">
      <button type="button" :class="{ active: activeTab === 'hierarchy' }" @click="activeTab = 'hierarchy'">Hierarquia</button>
      <button type="button" :class="{ active: activeTab === 'components' }" @click="activeTab = 'components'">Componentes (0)</button>
    </div>

    <template v-if="activeTab === 'hierarchy'">
      <div class="hierarchy-search-tools">
        <label class="hierarchy-search">
          <UiIcon name="search" :size="16" />
          <input :value="searchQuery" type="search" placeholder="Buscar objetos…" aria-label="Buscar objetos" @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)" />
        </label>
        <button class="hierarchy-new-folder" type="button" aria-label="Criar pasta na raiz" title="Criar pasta" @click="startCreateFolder(null)">
          <UiIcon name="plus" :size="17" />
        </button>
      </div>

      <div class="hierarchy-scroll">
        <div
          class="tree-root"
          :class="{ 'drop-target': dragOverId === 'root' }"
          role="button"
          tabindex="0"
          data-testid="scene-root"
          @click="toggleFolder('root')"
          @dragover="rootDragOver"
          @dragleave="dragOverId = null"
          @drop.prevent.stop="dropOnFolder(null)"
          @keydown.enter="toggleFolder('root')"
        >
          <span class="tree-chevron"><UiIcon name="chevron-down" :size="13" /></span>
          <span class="tree-folder root-folder-icon"><UiIcon name="house" :size="16" /></span>
          <strong>{{ projectName || 'Mundo principal' }}</strong>
          <small>{{ objects.length }}</small>
        </div>

        <template v-if="isExpanded('root')">
          <template v-for="row in treeRows" :key="row.type === 'folder' ? 'folder-' + row.folder.id : 'object-' + row.object.id">
            <div
              v-if="row.type === 'folder'"
              class="tree-folder-row"
              :class="{ 'drop-target': dragOverId === row.folder.id, 'drag-source': isFolderDragging(row.folder.id) }"
              :style="{ paddingLeft: (13 + row.depth * 12) + 'px' }"
              :data-testid="'folder-row-' + row.folder.id"
              :data-folder-id="row.folder.id"
              draggable="true"
              @click="toggleFolder(row.folder.id)"
              @dblclick.stop="editingFolderId = row.folder.id; editingFolderName = row.folder.name; void nextTick(() => editingInput?.focus())"
              @dragstart="startDrag($event, 'folder', row.folder.id)"
              @dragend="finishDrag"
              @dragover="folderDragOver($event, row.folder.id)"
              @dragleave="dragOverId = null"
              @drop.prevent.stop="dropOnFolder(row.folder.id)"
            >
              <span class="tree-chevron" :class="{ collapsed: !isExpanded(row.folder.id) }"><UiIcon name="chevron-down" :size="12" /></span>
              <span class="tree-folder"><UiIcon name="folder" :size="15" /></span>
              <input
                v-if="editingFolderId === row.folder.id"
                ref="editingInput"
                v-model="editingFolderName"
                class="tree-folder-rename"
                aria-label="Nome da pasta"
                maxlength="64"
                @click.stop
                @keydown.enter.prevent.stop="finishFolderRename"
                @keydown.esc.prevent.stop="cancelFolderRename"
                @blur="finishFolderRename"
              />
              <span v-else class="tree-folder-name">{{ row.folder.name }}</span>
              <small class="tree-folder-count">{{ row.count || '' }}</small>
              <span class="tree-folder-actions" @click.stop>
                <button type="button" :aria-label="'Criar subpasta em ' + row.folder.name" title="Criar subpasta" @click="startCreateFolder(row.folder.id)"><UiIcon name="plus" :size="13" /></button>
                <button type="button" :aria-label="'Renomear pasta ' + row.folder.name" title="Renomear pasta" @click="editingFolderId = row.folder.id; editingFolderName = row.folder.name; void nextTick(() => editingInput?.focus())"><UiIcon name="pencil" :size="12" /></button>
                <button type="button" :aria-label="'Excluir pasta ' + row.folder.name" title="Excluir pasta; conteúdo volta para a pasta pai" @click="emit('delete-folder', row.folder.id)"><UiIcon name="trash" :size="12" /></button>
              </span>
            </div>

            <div
              v-else
              class="tree-object"
              :class="{ selected: selectedId === row.object.id, multi: groupSelection.includes(row.object.id) && selectedId !== row.object.id }"
              :style="{ paddingLeft: (29 + row.depth * 12) + 'px' }"
              :data-testid="'scene-object-' + row.object.id"
              :data-folder-id="row.object.folderId ?? 'root'"
              draggable="true"
              tabindex="0"
              @click="emit('select', row.object.id, $event.ctrlKey || $event.metaKey)"
              @keydown.enter="emit('select', row.object.id, $event.ctrlKey || $event.metaKey)"
              @dragstart="startDrag($event, 'object', row.object.id)"
              @dragend="finishDrag"
            >
              <span class="object-type-icon"><UiIcon :name="objectIcon(row.object)" :size="15" /></span>
              <span class="tree-object-name">{{ row.object.name }}</span>
              <button class="tree-eye" type="button" :aria-label="row.object.visible ? 'Ocultar ' + row.object.name : 'Mostrar ' + row.object.name" :title="row.object.visible ? 'Ocultar objeto' : 'Mostrar objeto'" @click.stop="emit('toggle-visibility', row.object.id)">
                <UiIcon name="eye" :size="13" />
              </button>
            </div>
          </template>
        </template>

        <div v-if="treeRows.length === 0 && !searchQuery" class="hierarchy-hint">Crie pastas para organizar sua cena ou adicione objetos diretamente na raiz</div>
        <div v-else-if="treeRows.length === 0 && searchQuery" class="hierarchy-hint">Nenhum item encontrado.</div>
        <div v-if="treeRows.length > 0" class="tree-root-drop" :class="{ 'drop-target': dragOverId === 'root' }" @dragover="rootDragOver" @dragleave="dragOverId = null" @drop.prevent.stop="dropOnFolder(null)">Solte aqui para mover para a raiz</div>
      </div>

      <div class="hierarchy-actions">
        <div class="hierarchy-action-row">
          <button type="button" :disabled="groupSelection.length < 2" @click="emit('group')">Agrupar</button>
          <button type="button" :disabled="groupSelection.length === 0" @click="emit('ungroup')">Desagrupar</button>
        </div>
        <div class="hierarchy-icon-row">
          <button type="button" aria-label="Adicionar cubo" title="Adicionar cubo" @click="emit('add-object', 'cube')"><UiIcon name="plus" :size="17" /></button>
          <button type="button" aria-label="Duplicar objeto" title="Duplicar" :disabled="!selectedId" @click="emit('copy'); emit('paste')"><UiIcon name="copy" :size="15" /></button>
          <button type="button" aria-label="Excluir objeto" title="Excluir selecionado" :disabled="!selectedId" @click="emit('remove')"><UiIcon name="trash" :size="15" /></button>
        </div>
      </div>
    </template>

    <div v-else class="component-library-empty">
      <UiIcon name="box" :size="30" />
      <strong>Componentes (0)</strong>
      <p>A biblioteca de componentes será conectada a esta área na próxima etapa.</p>
      <button type="button" @click="emit('import-model')">Importar modelo 3D</button>
    </div>
  </aside>
</template>
