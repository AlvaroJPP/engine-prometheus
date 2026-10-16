<script setup lang="ts">
import { ref } from 'vue'
import type { ObjectInfo, TerrainInfo } from '@engine'

interface ComponentEntry { id: string; name: string; kind?: 'object' | 'entity'; height: number; colliderType: 'box' | 'sphere' | 'capsule' | 'none'; colliderSize: [number, number, number]; colliderOffset: [number, number, number]; createdAt: number }
const activeTab = ref<'hierarchy' | 'components'>('hierarchy')

defineProps<{
  objects: ObjectInfo[]
  terrain: TerrainInfo
  selectedId: string | null
  groupSelection: string[]
  terrainId: string
  rootOpen: boolean
  components: ComponentEntry[]
}>()

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
}>()
</script>

<template>
  <aside class="panel left">
    <div class="panel-head">
      <div>
        <div class="eyebrow">WORKSPACE</div>
        <div class="h">{{ activeTab === 'hierarchy' ? 'Hierarquia' : 'Componentes' }}</div>
      </div>
      <span class="badge">{{ activeTab === 'hierarchy' ? objects.length + 1 : components.length }}</span>
    </div>

    <nav class="library-tabs" aria-label="Painel lateral">
      <button :class="{ active: activeTab === 'hierarchy' }" @click="activeTab = 'hierarchy'">☷ Hierarquia</button>
      <button :class="{ active: activeTab === 'components' }" @click="activeTab = 'components'">▦ Componentes <span>{{ components.length }}</span></button>
    </nav>

    <template v-if="activeTab === 'hierarchy'">
    <div class="hierarchy-actions">
      <button :disabled="groupSelection.length < 2" @click="emit('group-selected')">Agrupar ({{ groupSelection.length }})</button>
      <button :disabled="groupSelection.length === 0" @click="emit('ungroup-selected')">Desagrupar</button>
    </div>

    <div class="tree">
      <div class="row root" @click="emit('update:rootOpen', !rootOpen)">
        <span class="chev" :class="{ open: rootOpen }">›</span>
        <span class="ico world" />
        <span class="name">Mundo principal</span>
      </div>
      <template v-if="rootOpen">
        <div
          class="row child terrain"
          :class="{ active: selectedId === terrainId }"
          @click="emit('select-item', terrainId)"
        >
          <span class="ico rect" />
          <span class="name">Terreno editável</span>
          <button class="eye" :class="{ off: !terrain.visible }" title="Mostrar/ocultar" @click.stop="emit('toggle-terrain')" />
        </div>
        <div
          v-for="object in objects"
          :key="object.id"
          class="row child"
          :class="{ active: object.id === selectedId, 'group-selected': groupSelection.includes(object.id), hidden: !object.visible }"
          @click="emit('select-item', object.id, $event.ctrlKey || $event.metaKey)"
        >
          <span class="ico" :class="object.type" />
          <span class="name">{{ object.name }}</span>
          <button class="eye" :class="{ off: !object.visible }" title="Mostrar/ocultar objeto" @click.stop="emit('toggle-visible', object.id)" />
          <button class="row-action" :class="{ active: object.locked }" :title="object.locked ? 'Desbloquear posição' : 'Bloquear posição'" @click.stop="emit('toggle-lock', object.id)">{{ object.locked ? '🔒' : '🔓' }}</button>
          <button class="row-action" :class="{ active: !object.wireframeVisible }" :title="object.wireframeVisible ? 'Ocultar linhas dos polígonos' : 'Mostrar linhas dos polígonos'" @click.stop="emit('toggle-wireframe', object.id)">{{ object.wireframeVisible ? '▱' : '▰' }}</button>
        </div>
      </template>
    </div>

    </template>

    <div v-else class="component-library">
      <div class="component-library-intro"><strong>Biblioteca reutilizável</strong><p>Importe um modelo uma vez. Depois clique para inserir cópias com o mesmo tamanho, material e colisor.</p></div>
      <div v-if="!components.length" class="component-library-empty"><span>▧</span><strong>Nenhum componente salvo</strong><small>Use “Importar modelo 3D” para adicionar seu primeiro componente.</small></div>
      <div v-for="component in components" :key="component.id" class="saved-component">
        <button class="saved-component-place" :title="'Adicionar ' + component.name + ' ao mundo'" @click="emit('place-component', component.id)"><span class="saved-component-icon">{{ component.kind === 'entity' ? '♟' : '▧' }}</span><span class="saved-component-copy"><strong>{{ component.name }}</strong><small>{{ component.kind === 'entity' ? 'Entidade · ' : '' }}{{ component.height.toFixed(2) }} u · {{ component.colliderType === 'none' ? 'Sem colisor' : component.colliderType === 'sphere' ? 'Esfera' : component.colliderType === 'capsule' ? 'Cápsula' : 'Caixa' }}</small></span><span class="saved-component-add">＋</span></button>
        <button class="saved-component-preview" :aria-label="'Ver animações de ' + component.name" title="Pré-visualizar modelo e animações" @click="emit('preview-component', component.id)">▶</button>
        <button class="saved-component-delete" :aria-label="'Excluir componente ' + component.name" title="Excluir da biblioteca" @click="emit('delete-component', component.id)">×</button>
      </div>
    </div>

    <div class="panel-foot">
      <span>{{ activeTab === 'hierarchy' ? objects.length + ' objetos construídos' : components.length + ' componentes salvos' }}</span>
      <span class="local"><i class="dot ok" /> LOCAL</span>
    </div>
  </aside>
</template>

<style scoped>
.hierarchy-actions{display:flex;gap:5px;padding:0 10px 9px}.hierarchy-actions button{flex:1;min-width:0;padding:6px 4px;border:1px solid #414756;border-radius:4px;background:#292d37;color:#cbd2de;font-size:10px;cursor:pointer}.hierarchy-actions button:disabled{opacity:.4;cursor:default}.row.group-selected{outline:1px solid #b78048;outline-offset:-1px}.row-action{border:0;background:transparent;color:#8f99aa;cursor:pointer;padding:2px 3px;font-size:12px}.row-action.active{color:#f3c34e}
.library-tabs{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:7px 9px;border-bottom:1px solid #242a35;background:#171b23}.library-tabs button{min-width:0;padding:7px 4px;border:1px solid transparent;border-radius:4px;background:transparent;color:#9ba4b4;font-size:10px;cursor:pointer}.library-tabs button.active{border-color:#554034;background:#332720;color:#f0c39a}.library-tabs button span{margin-left:3px;color:#e9a76e}.component-library{min-height:0;flex:1;overflow:auto;padding:9px}.component-library-intro{padding:9px;border:1px solid #303744;border-radius:5px;background:#1b2029}.component-library-intro strong{font-size:11px;color:#e0e5ee}.component-library-intro p{margin:6px 0 0;color:#929caf;font-size:10px;line-height:1.5}.component-library-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px 12px;color:#a5adbc;text-align:center}.component-library-empty>span{font-size:28px;color:#d99057}.component-library-empty strong{font-size:11px}.component-library-empty small{font-size:10px;line-height:1.5;color:#858fa0}.saved-component{display:flex;align-items:stretch;gap:3px;margin-top:7px}.saved-component-place{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding:9px 7px;border:1px solid #303744;border-radius:5px;background:#202631;color:#dce2eb;text-align:left;cursor:pointer}.saved-component-place:hover{border-color:#bc7846;background:#2b2928}.saved-component-icon{display:grid;place-items:center;flex:none;width:31px;height:31px;border-radius:4px;background:#332920;color:#e9a76e;font-size:18px}.saved-component-copy{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}.saved-component-copy strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.saved-component-copy small{color:#929caf;font-size:9px}.saved-component-add{color:#e9a76e;font-size:18px}.saved-component-preview{width:28px;border:1px solid #303744;border-radius:4px;background:#202631;color:#e9a76e;cursor:pointer}.saved-component-preview:hover{border-color:#bc7846;background:#2b2928}.saved-component-delete{width:25px;border:1px solid #303744;border-radius:4px;background:#202631;color:#9a9fac;cursor:pointer}.saved-component-delete:hover{border-color:#a24e4e;color:#ff9696}
</style>
