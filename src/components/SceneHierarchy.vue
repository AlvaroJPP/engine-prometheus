<script setup lang="ts">
import type { ObjectInfo, TerrainInfo } from '@engine'

defineProps<{
  objects: ObjectInfo[]
  terrain: TerrainInfo
  selectedId: string | null
  groupSelection: string[]
  terrainId: string
  rootOpen: boolean
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
}>()
</script>

<template>
  <aside class="panel left">
    <div class="panel-head">
      <div>
        <div class="eyebrow">CENA ATUAL</div>
        <div class="h">Hierarquia</div>
      </div>
      <span class="badge">{{ objects.length + 1 }}</span>
    </div>

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

    <div class="panel-foot">
      <span>{{ objects.length }} objetos construídos</span>
      <span class="local"><i class="dot ok" /> LOCAL</span>
    </div>
  </aside>
</template>

<style scoped>
.hierarchy-actions{display:flex;gap:5px;padding:0 10px 9px}.hierarchy-actions button{flex:1;min-width:0;padding:6px 4px;border:1px solid #414756;border-radius:4px;background:#292d37;color:#cbd2de;font-size:10px;cursor:pointer}.hierarchy-actions button:disabled{opacity:.4;cursor:default}.row.group-selected{outline:1px solid #b78048;outline-offset:-1px}.row-action{border:0;background:transparent;color:#8f99aa;cursor:pointer;padding:2px 3px;font-size:12px}.row-action.active{color:#f3c34e}
</style>
