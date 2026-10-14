<script setup lang="ts">
import type { ObjectInfo, TerrainInfo } from '@engine'

defineProps<{
  objects: ObjectInfo[]
  terrain: TerrainInfo
  selectedId: string | null
  terrainId: string
  rootOpen: boolean
}>()

const emit = defineEmits<{
  'update:rootOpen': [value: boolean]
  'select-item': [id: string]
  'toggle-terrain': []
  'toggle-visible': [id: string]
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
          :class="{ active: object.id === selectedId, hidden: !object.visible }"
          @click="emit('select-item', object.id)"
        >
          <span class="ico" :class="object.type" />
          <span class="name">{{ object.name }}</span>
          <button class="eye" :class="{ off: !object.visible }" title="Mostrar/ocultar" @click.stop="emit('toggle-visible', object.id)" />
        </div>
      </template>
    </div>

    <div class="panel-foot">
      <span>{{ objects.length }} objetos construídos</span>
      <span class="local"><i class="dot ok" /> LOCAL</span>
    </div>
  </aside>
</template>
