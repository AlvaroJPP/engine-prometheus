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
  'open-model-import': []
  'add-primitive': [type: 'cube' | 'platform']
  'add-spawn-platform': []
  'add-clickable-example': []
  'toggle-grid': []
  'toggle-polygon-lines': []
  'toggle-performance-mode': []
}>()

const toolHelp: Partial<Record<ToolMode, string>> = {
  select: 'Seleciona objetos para mover, girar, escalar ou editar suas propriedades.',
  build: 'Clique no mundo para posicionar o objeto atual. Ctrl + clique mantém o ponto exato atingido.',
  terrain: 'Esculpe o relevo com o pincel. Segure Shift para rebaixar o terreno.',
  grass: 'Pinta grama no terreno. Segure Shift para apagar grama pintada.',
}
const transformHelp: Record<TransformMode, string> = {
  move: 'Move o objeto pelos eixos X, Y e Z usando o gizmo 3D.',
  rotate: 'Gira o objeto pelos eixos X, Y e Z usando os anéis do gizmo.',
  scale: 'Altera a escala do objeto pelos eixos do gizmo 3D.',
}
function toolTooltip(item: ToolOption): string {
  return toolHelp[item.id] ?? `Ativa a ferramenta ${item.label.toLocaleLowerCase('pt-BR')}.`
}
</script>

<template>
  <nav class="toolbar" aria-label="Ferramentas do viewport">
    <div class="toolbar-group">
      <button v-for="item in props.tools.filter((entry) => entry.id !== 'terrain' || props.inspectorMode !== 'object')" :key="item.id" class="tool" :class="{ active: props.tool === item.id }" :title="item.label" :data-tooltip="toolTooltip(item)" :aria-label="item.label" @click="emit('set-tool', item.id)">
        <span class="tool-ico" aria-hidden="true">{{ item.icon }}</span><span class="tool-label">{{ item.label }}</span>
      </button>
    </div>
    <span class="toolbar-separator" />
    <div class="toolbar-group">
      <button v-for="item in props.transforms" :key="item.id" class="tool" :class="{ active: props.tool === 'select' && props.transform === item.id }" :title="item.label" :data-tooltip="transformHelp[item.id]" :aria-label="item.label" @click="emit('set-transform', item.id)">
        <span class="tool-ico" aria-hidden="true">{{ item.icon }}</span><span class="tool-label">{{ item.label }}</span>
      </button>
    </div>
    <span class="toolbar-separator" />
    <div class="toolbar-group">
      <button class="tool" title="Adicionar modelo 3D" data-tooltip="Importa um modelo 3D, configura suas opções e prepara o componente para ser colocado no mundo." aria-label="Adicionar modelo 3D" @click="emit('open-model-import')"><span class="tool-ico" aria-hidden="true">▧</span><span class="tool-label">Modelo 3D</span></button>
      <button class="tool" :class="{ active: props.graphOpen }" title="Visual Script" data-tooltip="Abre o grafo de eventos para configurar gatilhos, condições e ações do objeto selecionado." aria-label="Visual Script" @click="emit('toggle-graph')"><span class="tool-ico" aria-hidden="true">⌘</span><span class="tool-label">Visual Script</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Adicionar cubo" data-tooltip="Adiciona um cubo simples ao mundo." aria-label="Adicionar cubo" @click="emit('add-primitive', 'cube')"><span class="tool-ico" aria-hidden="true">◇</span><span class="tool-label">Cubo</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Adicionar plataforma" data-tooltip="Adiciona uma plataforma retangular ao mundo." aria-label="Adicionar plataforma" @click="emit('add-primitive', 'platform')"><span class="tool-ico" aria-hidden="true">▱</span><span class="tool-label">Plataforma</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Adicionar spawn do jogador" data-tooltip="Cria a referência de posicionamento inicial do jogador." aria-label="Adicionar spawn do jogador" @click="emit('add-spawn-platform')"><span class="tool-ico" aria-hidden="true">◎</span><span class="tool-label">Spawn</span></button>
      <button v-if="props.inspectorMode === 'environment'" class="tool" title="Criar exemplo clicável" data-tooltip="Insere um objeto de exemplo com um evento de clique configurável." aria-label="Criar exemplo clicável" @click="emit('add-clickable-example')"><span class="tool-ico" aria-hidden="true">▣</span><span class="tool-label">Exemplo clicável</span></button>
    </div>
    <span class="toolbar-separator" />
    <div class="toolbar-group">
      <button class="tool grid-toggle" :class="{ active: props.gridVisible }" @click="emit('toggle-grid')" title="Mostrar ou ocultar malha" data-tooltip="Exibe ou oculta a grade de referência no chão." aria-label="Mostrar ou ocultar malha"><span class="tool-ico" aria-hidden="true">▦</span><span class="tool-label">Malha</span></button>
      <button class="tool grid-toggle" :class="{ active: props.polygonLinesVisible }" @click="emit('toggle-polygon-lines')" :title="props.polygonLinesVisible ? 'Ocultar linhas dos polígonos' : 'Mostrar linhas dos polígonos'" :data-tooltip="props.polygonLinesVisible ? 'Oculta o wireframe sobre os modelos.' : 'Exibe o wireframe para inspecionar a malha dos modelos.'" aria-label="Alternar linhas dos polígonos"><span class="tool-ico" aria-hidden="true">⬡</span><span class="tool-label">Linhas</span></button>
      <button class="tool grid-toggle" :class="{ active: props.performanceMode !== 'quality' }" @click="emit('toggle-performance-mode')" :title="props.performanceMode === 'quality' ? 'Modo qualidade. Clique para equilibrado.' : props.performanceMode === 'balanced' ? 'Modo equilibrado. Clique para econômico.' : props.performanceMode === 'economy' ? 'Modo econômico. Clique para automático.' : 'Modo automático. Clique para qualidade.'" aria-label="Alternar modo de desempenho"><span class="tool-ico" aria-hidden="true">ϟ</span><span class="tool-label">{{ props.performanceMode === 'quality' ? 'Qualidade' : props.performanceMode === 'balanced' ? 'Equilibrado' : props.performanceMode === 'economy' ? 'Econômico' : 'Auto' }}</span></button>
    </div>
  </nav>
</template>
