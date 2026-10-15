<script setup lang="ts">
import type { ToolMode, TransformMode } from '@engine'

type ToolOption = { id: ToolMode; icon: string; label: string }
type TransformOption = { id: TransformMode; icon: string; label: string }

const props = defineProps<{
  tools: ToolOption[]
  transforms: TransformOption[]
  tool: ToolMode
  transform: TransformMode
  inspectorMode: 'object' | 'terrain' | 'environment'
  graphOpen: boolean
  gridVisible: boolean
  polygonLinesVisible: boolean
}>()

const emit = defineEmits<{
  'set-tool': [tool: ToolMode]
  'set-transform': [transform: TransformMode]
  'toggle-graph': []
  'add-primitive': [type: 'cube' | 'platform']
  'add-spawn-platform': []
  'add-clickable-example': []
  'toggle-grid': []
  'toggle-polygon-lines': []
}>()
</script>

<template>
  <nav class="toolbar">
    <button
      v-for="item in props.tools.filter((entry) => entry.id !== 'terrain' || props.inspectorMode !== 'object')"
      :key="item.id"
      class="tool"
      :class="{ active: props.tool === item.id }"
      @click="emit('set-tool', item.id)"
    >
      <span class="tool-ico">{{ item.icon }}</span>{{ item.label }}
    </button>
    <span class="vsep" />
    <button
      v-for="item in props.transforms"
      :key="item.id"
      class="tool"
      :class="{ active: props.tool === 'select' && props.transform === item.id }"
      @click="emit('set-transform', item.id)"
    >
      <span class="tool-ico">{{ item.icon }}</span>{{ item.label }}
    </button>
    <span class="vsep" />
    <button class="tool" :class="{ active: props.graphOpen }" @click="emit('toggle-graph')">⌘ Visual Script</button>
    <span class="vsep" />
    <button v-if="props.inspectorMode === 'environment'" class="tool add" @click="emit('add-primitive', 'cube')">+ Cubo</button>
    <button v-if="props.inspectorMode === 'environment'" class="tool add" @click="emit('add-clickable-example')" title="Cria um cubo azul clicável e configura a variável click">+ Exemplo clicável</button>
    <button v-if="props.inspectorMode === 'environment'" class="tool add" @click="emit('add-primitive', 'platform')">+ Plataforma</button>
    <button v-if="props.inspectorMode === 'environment'" class="tool add spawn-tool" @click="emit('add-spawn-platform')" title="Define onde o jogador aparece ao pressionar Run">◎ Spawn do jogador</button>
    <span class="vsep" />
    <button class="tool grid-toggle" :class="{ active: props.gridVisible }" @click="emit('toggle-grid')" title="Mostrar ou ocultar a malha">▦ Malha</button>
    <button class="tool grid-toggle" :class="{ active: props.polygonLinesVisible }" @click="emit('toggle-polygon-lines')" :title="props.polygonLinesVisible ? 'Ocultar linhas dos polígonos' : 'Mostrar linhas dos polígonos'">⬡ Linhas</button>
  </nav>
</template>
