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
  performanceMode: 'quality' | 'balanced' | 'economy' | 'auto'
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
  'toggle-performance-mode': []
}>()
</script>

<template>
  <nav class="toolbar" aria-label="Ferramentas do viewport">
    <div class="toolbar-group">
      <button v-for="item in props.tools.filter((entry) => entry.id !== 'terrain' || props.inspectorMode !== 'object')" :key="item.id" class="tool" :class="{ active: props.tool === item.id }" :title="item.label" :aria-label="item.label" @click="emit('set-tool', item.id)">
        <span class="tool-ico" aria-hidden="true">{{ item.icon }}</span><span class="tool-label">{{ item.label }}</span>
      </button>
    </div>
    <span class="toolbar-separator" />
    <div class="toolbar-group">
      <button v-for="item in props.transforms" :key="item.id" class="tool" :class="{ active: props.tool === 'select' && props.transform === item.id }" :title="item.label" :aria-label="item.label" @click="emit('set-transform', item.id)">
        <span class="tool-ico" aria-hidden="true">{{ item.icon }}</span><span class="tool-label">{{ item.label }}</span>
      </button>
    </div>
    <span class="toolbar-separator" />
    <div class="toolbar-group">
      <button class="tool" :class="{ active: props.graphOpen }" title="Visual Script" aria-label="Visual Script" @click="emit('toggle-graph')"><span class="tool-ico" aria-hidden="true">⌘</span><span class="tool-label">Visual Script</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Adicionar cubo" aria-label="Adicionar cubo" @click="emit('add-primitive', 'cube')"><span class="tool-ico" aria-hidden="true">◇</span><span class="tool-label">Cubo</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Adicionar plataforma" aria-label="Adicionar plataforma" @click="emit('add-primitive', 'platform')"><span class="tool-ico" aria-hidden="true">▱</span><span class="tool-label">Plataforma</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Adicionar spawn do jogador" aria-label="Adicionar spawn do jogador" @click="emit('add-spawn-platform')"><span class="tool-ico" aria-hidden="true">◎</span><span class="tool-label">Spawn</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Criar exemplo clicável" aria-label="Criar exemplo clicável" @click="emit('add-clickable-example')"><span class="tool-ico" aria-hidden="true">▣</span><span class="tool-label">Exemplo clicável</span></button>
    </div>
    <span class="toolbar-separator" />
    <div class="toolbar-group">
      <button class="tool grid-toggle" :class="{ active: props.gridVisible }" @click="emit('toggle-grid')" title="Mostrar ou ocultar malha" aria-label="Mostrar ou ocultar malha"><span class="tool-ico" aria-hidden="true">▦</span><span class="tool-label">Malha</span></button>
      <button class="tool grid-toggle" :class="{ active: props.polygonLinesVisible }" @click="emit('toggle-polygon-lines')" :title="props.polygonLinesVisible ? 'Ocultar linhas dos polígonos' : 'Mostrar linhas dos polígonos'" aria-label="Alternar linhas dos polígonos"><span class="tool-ico" aria-hidden="true">⬡</span><span class="tool-label">Linhas</span></button>
      <button class="tool grid-toggle" :class="{ active: props.performanceMode !== 'quality' }" @click="emit('toggle-performance-mode')" :title="props.performanceMode === 'quality' ? 'Modo qualidade. Clique para equilibrado.' : props.performanceMode === 'balanced' ? 'Modo equilibrado. Clique para econômico.' : props.performanceMode === 'economy' ? 'Modo econômico. Clique para automático.' : 'Modo automático. Clique para qualidade.'" aria-label="Alternar modo de desempenho"><span class="tool-ico" aria-hidden="true">ϟ</span><span class="tool-label">{{ props.performanceMode === 'quality' ? 'Qualidade' : props.performanceMode === 'balanced' ? 'Equilibrado' : props.performanceMode === 'economy' ? 'Econômico' : 'Auto' }}</span></button>
    </div>
  </nav>
</template>
