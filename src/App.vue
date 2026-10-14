<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { ENGINE_VERSION, TERRAIN_ID } from '@engine'
import type { ToolMode, TransformMode, LogicRule } from '@engine'
import { CAMERA_LABELS, useEditor } from '@/composables/useEditor'
import EditorTopBar from '@/components/EditorTopBar.vue'
import EditorToolbar from '@/components/EditorToolbar.vue'
import ExecutionDock from '@/components/ExecutionDock.vue'
import SceneHierarchy from '@/components/SceneHierarchy.vue'

const canvas = ref<HTMLCanvasElement | null>(null)
const rootOpen = ref(true)
const inspectorTab = ref<'transform' | 'color' | 'variables' | 'nodes'>('transform')
const executionMode = ref<'edit' | 'running' | 'stopped'>('edit')
const publicLibraryOpen = ref(false)
const {
  projectName,
  dirty,
  status,
  objects,
  terrain,
  selectedId,
  tool,
  transform,
  cameraPreset,
  brushStrength,
  brushRadius,
  gridVisible,
  logicRules, logicVariables, globalLogicVariables, useGlobalVariableOnObject, ruleTrigger, ruleAction, ruleConditionEnabled,
  toggleLogicVariable, createLogicVariable, setLogicVariableValue, deleteLogicVariable, addLogicRule, toggleLogicRule, deleteLogicRule, moveLogicRule, updateLogicRule, importLogicRule,
  markDirty,
  setTool,
  setTransform,
  addPrimitive,
  addClickableCubeExample,
  cycleCamera,
  selectItem,
  toggleVisible,
  toggleTerrain,
  toggleGrid,
  removeSelected,
  onRename,
  onNumber,
  onColor,
  colorHex,
  regenerateTerrain,
  clearTerrain,
  newProject,
  openProject,
  saveProject,
} = useEditor(canvas)

const newVariableName = ref('')
const newVariableValue = ref('false')
const newVariableType = ref<'string' | 'number' | 'boolean'>('boolean')
function onNewVariableTypeChange(type: 'string' | 'number' | 'boolean') {
  newVariableType.value = type
  newVariableValue.value = type === 'string' ? '' : type === 'number' ? '0' : 'false'
}
const newEventName = ref('')
const sidebarScriptDraft = ref("// Cole seu JavaScript aqui\napi.set('has_key', true)")
const conditionVariable = ref('has_key')
const conditionOperator = ref<'equals' | 'not_equals' | 'greater_than' | 'less_than'>('equals')
const conditionValue = ref('true')
function submitVariable(scope: 'global' | 'object' = 'object') {
  createLogicVariable(newVariableName.value, newVariableValue.value, scope, newVariableType.value)
  newVariableName.value = ''
}

const graphOpen = ref(false)
const graphSelection = ref<{ ruleId: string; part: 'trigger' | 'condition' | 'action' } | null>(null)
const dragNode = ref<{ ruleId: string; part: 'trigger' | 'condition' | 'action'; dx: number; dy: number } | null>(null)
const graphPan = ref({ x: 0, y: 0 })
const graphZoom = ref(1)
const dragCanvas = ref<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
const graphViewport = ref<HTMLElement | null>(null)
const graphStage = ref<HTMLElement | null>(null)
const portPositions = ref<Record<string, { x: number; y: number }>>({})
let graphPortObserver: ResizeObserver | null = null
let graphMeasureQueued = false
function measureGraphPorts() {
  if (graphMeasureQueued) return
  graphMeasureQueued = true
  void nextTick(() => {
    graphMeasureQueued = false
    const stage = graphStage.value
    if (!stage) return
    const stageRect = stage.getBoundingClientRect()
    const zoom = graphZoom.value || 1
    const next: Record<string, { x: number; y: number }> = {}
    stage.querySelectorAll<HTMLElement>('[data-port-key]').forEach((port) => {
      const key = port.dataset.portKey
      if (!key) return
      const rect = port.getBoundingClientRect()
      next[key] = { x: (rect.left + rect.width / 2 - stageRect.left) / zoom, y: (rect.top + rect.height / 2 - stageRect.top) / zoom }
    })
    const previousKeys = Object.keys(portPositions.value)
    const nextKeys = Object.keys(next)
    const changed = previousKeys.length !== nextKeys.length || nextKeys.some(key => {
      const before = portPositions.value[key], after = next[key]
      return !before || !after || Math.abs(before.x - after.x) > 0.25 || Math.abs(before.y - after.y) > 0.25
    })
    if (changed) portPositions.value = next
  })
}
onMounted(() => {
  graphPortObserver = new ResizeObserver(measureGraphPorts)
  if (graphViewport.value) graphPortObserver.observe(graphViewport.value)
  if (graphStage.value) graphPortObserver.observe(graphStage.value)
  measureGraphPorts()
})
onUpdated(measureGraphPorts)
watch([graphNodes, graphVisibleRules, graphZoom, graphPan], measureGraphPorts, { deep: true })
onBeforeUnmount(() => graphPortObserver?.disconnect())
const graphObjectFilter = ref<'selected' | 'all'>('selected')
const graphVisibleRules = computed(() => {
  if (graphObjectFilter.value === 'all' || !objects.value.some(object => object.id === selectedId.value)) return logicRules.value
  return logicRules.value.filter(rule =>
    (rule.trigger.type === 'object_clicked' && rule.trigger.objectId === selectedId.value) ||
    rule.actions.some(action => 'objectId' in action && action.objectId === selectedId.value)
  )
})
function defaultGraphLayout(index: number) {
  const top = 70 + index * 250
  return {
    trigger: { x: 70, y: top },
    condition: { x: 430, y: top },
    action: { x: 790, y: top },
  }
}
function layoutForGraph(rule: LogicRule, index: number) {
  const saved = rule.graphLayout
  const isHorizontalLayout = !!saved &&
    saved.trigger.x < saved.condition.x &&
    saved.condition.x < saved.action.x &&
    Math.abs(saved.trigger.y - saved.condition.y) < 100 &&
    Math.abs(saved.condition.y - saved.action.y) < 100
  return isHorizontalLayout ? saved! : defaultGraphLayout(index)
}
const graphNodes = computed(() => graphVisibleRules.value.flatMap((rule, index) => {
  const layout = layoutForGraph(rule, index)
  return (['condition', 'action'] as const).map(part => ({ rule, part, x: layout[part].x, y: layout[part].y }))
}))
const graphEdges = computed(() => graphVisibleRules.value.flatMap((rule) => {
  const eventPort = portPositions.value[`event:${rule.id}`]
  const conditionIn = portPositions.value[`condition-in:${rule.id}`]
  const conditionOut = portPositions.value[`condition-out:${rule.id}`]
  const actionIn = portPositions.value[`action-in:${rule.id}`]
  if (!eventPort || !conditionIn || !conditionOut || !actionIn) return []

  // Os pontos são medidos no DOM: centro real de cada círculo, sem estimar alturas.
  const yellowDx = Math.max(36, Math.abs(conditionIn.x - eventPort.x) * 0.45)
  const redDx = Math.max(36, Math.abs(actionIn.x - conditionOut.x) * 0.45)
  const yellowPath = `M ${eventPort.x} ${eventPort.y} C ${eventPort.x + yellowDx} ${eventPort.y}, ${conditionIn.x - yellowDx} ${conditionIn.y}, ${conditionIn.x} ${conditionIn.y}`
  const redPath = `M ${conditionOut.x} ${conditionOut.y} C ${conditionOut.x + redDx} ${conditionOut.y}, ${actionIn.x - redDx} ${actionIn.y}, ${actionIn.x} ${actionIn.y}`
  return [
    { id: rule.id + '-a', kind: 'trigger-condition', d: yellowPath },
    { id: rule.id + '-b', kind: 'condition-action', d: redPath },
  ]
}))
const selectedGraphRule = computed(() => logicRules.value.find(rule => rule.id === graphSelection.value?.ruleId) ?? null)
const globalConditionVariables = computed(() => Object.fromEntries(Object.entries(globalLogicVariables.value).filter(([name]) => !Object.prototype.hasOwnProperty.call(logicVariables.value, name))))

// Mantém o texto do editor separado da renderização do grafo. Atualizar a regra
// a cada tecla não deve recriar o valor do textarea nem descartar o rascunho.
const scriptDraft = ref('')
watch(
  () => {
    const rule = selectedGraphRule.value
    const action = rule?.actions[0]
    return { ruleId: rule?.id ?? '', type: action?.type ?? '', code: action && 'code' in action ? action.code : '' }
  },
  (current, previous) => {
    // Recarregar o rascunho somente quando a seleção muda. O código é atualizado
    // a cada tecla no motor; sincronizá-lo de volta aqui pode sobrescrever o texto
    // que ainda está sendo digitado durante o refresh reativo.
    if (!previous || current.ruleId !== previous.ruleId || current.type !== previous.type) {
      scriptDraft.value = current.code
    }
  },
  { immediate: true },
)
function onScriptDraftInput(event: Event) {
  const code = (event.target as HTMLTextAreaElement).value
  scriptDraft.value = code
  patchSelectedAction({ code })
}
function startNodeDrag(event: PointerEvent, ruleId: string, part: 'trigger' | 'condition' | 'action') {
  if (!graphViewport.value) return
  const node = graphNodes.value.find(n => n.rule.id === ruleId && n.part === part)
  if (!node) return
  const bounds = graphViewport.value.getBoundingClientRect()
  graphSelection.value = { ruleId, part }
  dragCanvas.value = null
  dragNode.value = {
    ruleId,
    part,
    dx: (event.clientX - bounds.left - graphPan.value.x) / graphZoom.value + graphViewport.value.scrollLeft - node.x,
    dy: (event.clientY - bounds.top - graphPan.value.y) / graphZoom.value + graphViewport.value.scrollTop - node.y,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function startGraphPan(event: PointerEvent) {
  if (!graphViewport.value || (event.target as HTMLElement).closest('.graph-node, button, input, select, textarea')) return
  dragNode.value = null
  dragCanvas.value = {
    startX: event.clientX,
    startY: event.clientY,
    originX: graphPan.value.x,
    originY: graphPan.value.y,
  }
  graphViewport.value.classList.add('is-panning')
  graphViewport.value.setPointerCapture(event.pointerId)
}
function zoomGraph(delta: number, clientX?: number, clientY?: number) {
  const viewport = graphViewport.value
  if (!viewport) return
  const bounds = viewport.getBoundingClientRect()
  const anchorX = (clientX ?? (bounds.left + bounds.width / 2)) - bounds.left
  const anchorY = (clientY ?? (bounds.top + bounds.height / 2)) - bounds.top
  const previousZoom = graphZoom.value
  const nextZoom = Math.min(2.5, Math.max(0.35, Number((previousZoom + delta).toFixed(2))))
  if (nextZoom === previousZoom) return
  graphPan.value = {
    x: anchorX - (anchorX - graphPan.value.x) * (nextZoom / previousZoom),
    y: anchorY - (anchorY - graphPan.value.y) * (nextZoom / previousZoom),
  }
  graphZoom.value = nextZoom
}
function onGraphWheel(event: WheelEvent) {
  zoomGraph(event.deltaY < 0 ? 0.1 : -0.1, event.clientX, event.clientY)
}
function resetGraphView() {
  graphPan.value = { x: 0, y: 0 }
  graphZoom.value = 1
}
function moveNode(event: PointerEvent) {
  if (!graphViewport.value) return
  if (dragCanvas.value) {
    graphPan.value = {
      x: dragCanvas.value.originX + event.clientX - dragCanvas.value.startX,
      y: dragCanvas.value.originY + event.clientY - dragCanvas.value.startY,
    }
    return
  }
  if (!dragNode.value) return
  const bounds = graphViewport.value.getBoundingClientRect()
  const { ruleId, part, dx, dy } = dragNode.value
  const ruleIndex = logicRules.value.findIndex(r => r.id === ruleId)
  const rule = logicRules.value[ruleIndex]; if (!rule || ruleIndex < 0) return
  const visibleIndex = graphVisibleRules.value.findIndex(r => r.id === ruleId)
  const current = layoutForGraph(rule, Math.max(0, visibleIndex))
  const next = { ...current, [part]: { x: Math.max(8, (event.clientX - bounds.left - graphPan.value.x) / graphZoom.value + graphViewport.value.scrollLeft - dx), y: Math.max(8, (event.clientY - bounds.top - graphPan.value.y) / graphZoom.value + graphViewport.value.scrollTop - dy) } }
  updateLogicRule({ ...rule, graphLayout: next })
}
function endNodeDrag() {
  dragNode.value = null
  dragCanvas.value = null
  graphViewport.value?.classList.remove('is-panning')
}
function nodeTitle(rule: LogicRule, part: 'trigger' | 'condition' | 'action') {
  if (part === 'trigger') return rule.trigger.type === 'object_clicked' ? 'Quando clicar no objeto' : 'Ao entrar na área'
  if (part === 'condition') return rule.conditions.length ? `Condição: ${rule.conditions.map(c => `${c.name} = ${String(c.value)}`).join(', ')}` : 'Sem condição'
  const action = rule.actions[0]; if (!action) return 'Sem ação'
  return action.type === 'rotate' ? `Girar ${action.degrees}°` : action.type === 'move' ? `Mover para X ${action.x ?? 0}` : action.type === 'set_visible' ? (action.visible ? 'Mostrar objeto' : 'Ocultar objeto') : action.type === 'set_variable' ? `Definir ${action.name} = ${String(action.value)}` : 'Executar script'
}

function patchSelectedAction(patch: Record<string, unknown>) {
  const rule = selectedGraphRule.value
  const action = rule?.actions[0]
  if (!rule || !action) return
  updateLogicRule({ ...rule, actions: [{ ...action, ...patch } as LogicRule['actions'][number], ...rule.actions.slice(1)] })
}
function patchSelectedTrigger(patch: Record<string, unknown>) {
  const rule = selectedGraphRule.value
  if (!rule) return
  updateLogicRule({ ...rule, trigger: { ...rule.trigger, ...patch } as LogicRule['trigger'] })
}
function patchSelectedCondition(patch: Record<string, unknown>) {
  const rule = selectedGraphRule.value
  if (!rule) return
  const current = rule.conditions[0] ?? { type: 'variable' as const, name: 'has_key', operator: 'equals' as const, value: true }
  updateLogicRule({ ...rule, conditions: [{ ...current, ...patch } as LogicRule['conditions'][number], ...rule.conditions.slice(1)] })
}
function setSelectedTriggerType(type: 'object_clicked' | 'enter_area') {
  const rule = selectedGraphRule.value
  if (!rule) return
  const trigger: LogicRule['trigger'] = type === 'object_clicked'
    ? { type, objectId: objects.value.find(o => o.id === (rule.trigger.type === 'object_clicked' ? rule.trigger.objectId : ''))?.id ?? objects.value[0]?.id ?? '' }
    : { type, center: rule.trigger.type === 'enter_area' ? [...rule.trigger.center] as [number, number, number] : [0, 1, 0], radius: rule.trigger.type === 'enter_area' ? rule.trigger.radius : 2 }
  updateLogicRule({ ...rule, trigger })
}
function setSelectedActionType(type: 'move' | 'rotate' | 'set_visible' | 'set_variable' | 'script' | 'javascript') {
  const rule = selectedGraphRule.value
  if (!rule) return
  const old = rule.actions[0]
  const target = old && 'objectId' in old ? old.objectId : selectedId.value ?? objects.value[0]?.id ?? ''
  const action: LogicRule['actions'][number] = type === 'move'
    ? { type, objectId: target, x: 2, y: 0, z: 0 }
    : type === 'rotate'
      ? { type, objectId: target, degrees: 45 }
      : type === 'set_visible'
        ? { type, objectId: target, visible: false }
        : type === 'set_variable' ? { type, name: 'has_key', value: true } : type === 'javascript' ? { type, code: "api.set('has_key', true)\napi.set('score', 0)\napi.add('score', 1)\n// api.move('{ID_OBJECT}', 2, 0, 1)" } : { type, code: 'set has_key = true\nset score = 0\nadd score 1' }
  updateLogicRule({ ...rule, actions: [action, ...rule.actions.slice(1)] })
}
function ruleValueFromInput(value: string): boolean | number | string {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

const TOOLS: Array<{ id: ToolMode; icon: string; label: string }> = [
  { id: 'select', icon: '↖', label: 'Selecionar' },
  { id: 'build', icon: '◇', label: 'Construir' },
  { id: 'terrain', icon: '~', label: 'Editar terreno' },
]

const TRANSFORMS: Array<{ id: TransformMode; icon: string; label: string }> = [
  { id: 'move', icon: '↔', label: 'Mover' },
  { id: 'rotate', icon: '↻', label: 'Rotacionar' },
  { id: 'scale', icon: '⤢', label: 'Escalar' },
]

const selected = computed(() => objects.value.find((o) => o.id === selectedId.value) ?? null)
const inspectorMode = computed(() => selected.value ? 'object' : selectedId.value === TERRAIN_ID ? 'terrain' : 'environment')
watch(selectedId, () => { inspectorTab.value = 'transform'; publicLibraryOpen.value = false })
function copyObjectId(id: string) {
  void navigator.clipboard?.writeText(id)
}
function runWorld() {
  graphOpen.value = false
  executionMode.value = 'running'
  status.value = 'Modo Run ativo · pré-visualização da cena'
}
function stopWorld() {
  executionMode.value = 'stopped'
  status.value = 'Execução interrompida'
}
function returnToEdit() {
  executionMode.value = 'edit'
  status.value = 'Modo de edição'
}
const selectedObjectRules = computed(() => logicRules.value.filter(rule =>
  (rule.trigger.type === 'object_clicked' && rule.trigger.objectId === selectedId.value) ||
  rule.actions.some(action => 'objectId' in action && action.objectId === selectedId.value)
))
function openObjectRule(rule: LogicRule) {
  graphSelection.value = {
    ruleId: rule.id,
    part: rule.trigger.type === 'object_clicked' && rule.trigger.objectId === selectedId.value ? 'trigger' : 'action',
  }
  graphOpen.value = true
}

function importPublicRule(rule: LogicRule) {
  const importedId = importLogicRule(rule)
  if (!importedId) return
  graphSelection.value = { ruleId: importedId, part: 'trigger' }
  graphOpen.value = true
}
const publicLogicRules = computed(() => logicRules.value.filter(rule =>
  rule.trigger.type === 'object_clicked' && rule.trigger.objectId !== selectedId.value
))
const cameraLabel = computed(() => CAMERA_LABELS[cameraPreset.value])
const hint = 'Arraste para orbitar · Botão direito move · Roda para zoom · W mover · E rotacionar · R escalar'
</script>

<template>
  <div class="app">
    <EditorTopBar
      v-model:project-name="projectName"
      :dirty="dirty"
      :camera-label="cameraLabel"
      @mark-dirty="markDirty"
      @new-project="newProject"
      @open-project="openProject"
      @save-project="saveProject"
      @cycle-camera="cycleCamera"
    />

    <EditorToolbar
      :tools="TOOLS"
      :transforms="TRANSFORMS"
      :tool="tool"
      :transform="transform"
      :inspector-mode="inspectorMode"
      :graph-open="graphOpen"
      :grid-visible="gridVisible"
      @set-tool="setTool"
      @set-transform="setTransform"
      @toggle-graph="graphOpen = !graphOpen"
      @add-primitive="addPrimitive"
      @add-clickable-example="addClickableCubeExample"
      @toggle-grid="toggleGrid"
    />

    <div class="main">
      <SceneHierarchy
        v-model:root-open="rootOpen"
        :objects="objects"
        :terrain="terrain"
        :selected-id="selectedId"
        :terrain-id="TERRAIN_ID"
        @select-item="selectItem"
        @toggle-terrain="toggleTerrain"
        @toggle-visible="toggleVisible"
      />

      <!-- Viewport -->
      <main class="viewport">
        <canvas ref="canvas" class="canvas" :class="'tool-' + tool" />
        <div class="chips">
          <span class="chip grid-state">{{ gridVisible ? 'MALHA ATIVA' : 'MALHA OCULTA' }}</span>
          <span class="chip live"><i class="dot ok" /> MUNDO PRINCIPAL</span>
          <span class="chip">ÓRBITA LIVRE</span>
        </div>
        <div class="axes">
          <span class="axis"><b class="ax-x">X</b> largura</span>
          <span class="axis"><b class="ax-y">Y</b> altura</span>
          <span class="axis"><b class="ax-z">Z</b> profundidade</span>
        </div>
        <div class="statusbar">
          <span class="seg"><i class="dot ok" /> Motor 3D ativo</span>
          <span class="seg">Terreno procedural</span>
          <span class="seg grow-text">{{ status || hint }}</span>
        </div>
      </main>

      <!-- Inspetor -->
      <aside class="panel right" :class="{ 'has-selection': inspectorMode === 'object', 'terrain-selection': inspectorMode === 'terrain', 'no-selection': inspectorMode === 'environment' }">
        <div class="inspector-heading">
          <div class="inspector-heading-top">
            <span class="eyebrow">PROPRIEDADES</span>
            <span class="inspector-context">{{ inspectorMode === 'object' ? 'OBJETO' : inspectorMode === 'terrain' ? 'TERRENO' : 'CENA' }}</span>
          </div>
          <div class="inspector-title-row">
            <span class="inspector-object-icon" :class="{ selected: inspectorMode === 'object', terrain: inspectorMode === 'terrain' }">{{ inspectorMode === 'object' ? '◇' : inspectorMode === 'terrain' ? '▤' : '⌂' }}</span>
            <div class="inspector-title-copy">
              <div class="h">{{ selected ? selected.name : inspectorMode === 'terrain' ? 'Terreno editável' : 'Mundo principal' }}</div>
              <div class="inspector-description">{{ selected ? (selected.type === 'cube' ? 'Cubo · GameObject' : 'Plataforma · GameObject') : inspectorMode === 'terrain' ? 'Superfície procedural' : 'Nenhum objeto selecionado' }}</div>
            </div>
            <span v-if="selected" class="selection-indicator" title="Objeto selecionado"></span>
          </div>
          <div v-if="inspectorMode === 'environment'" class="selection-empty-hint">Selecione um item na hierarquia ou diretamente no viewport para editar suas propriedades.</div>
        </div>
        <nav v-if="inspectorMode === 'object'" class="inspector-tabs" aria-label="Modos de propriedades">
          <button :class="{ active: inspectorTab === 'transform' }" title="Tamanho e posicionamento" @click="inspectorTab = 'transform'"><span>↔</span><small>Transform</small></button>
          <button :class="{ active: inspectorTab === 'color' }" title="Cor e material" @click="inspectorTab = 'color'"><span>◉</span><small>Cor</small></button>
          <button :class="{ active: inspectorTab === 'variables' }" title="Identidade e variáveis" @click="inspectorTab = 'variables'"><span>{ }</span><small>Variáveis</small></button>
          <button :class="{ active: inspectorTab === 'nodes' }" title="Nós e eventos do objeto" @click="inspectorTab = 'nodes'"><span>⌘</span><small>Nós</small></button>
        </nav>

        <div class="scroll">
          <section v-if="inspectorMode === 'environment'">
            <h4>Ambiente</h4>
            <dl>
              <dt>Dimensão</dt>
              <dd class="mono">3D · X/Y/Z</dd>
              <dt>Terreno</dt>
              <dd class="mono">100 × 100 unidades</dd>
              <dt>Relevo</dt>
              <dd class="mono">Procedural + editável</dd>
            </dl>
          </section>

          <section v-if="inspectorMode === 'terrain'">
            <h4>Ferramentas do terreno</h4>
            <p class="muted">
              Selecione Editar terreno e clique no chão para elevar. Segure Shift e clique para rebaixar.
            </p>
            <div class="slider-row"><span>Força do pincel</span><b class="mono">{{ brushStrength.toFixed(2) }}</b></div>
            <input v-model.number="brushStrength" type="range" min="0.2" max="3" step="0.05" />
            <div class="slider-row"><span>Raio do pincel</span><b class="mono">{{ brushRadius.toFixed(1) }}</b></div>
            <input v-model.number="brushRadius" type="range" min="1" max="12" step="0.5" />
            <div class="btn-row">
              <button class="ghost" @click="regenerateTerrain">Novo relevo</button>
              <button class="ghost" @click="clearTerrain">Limpar edições</button>
            </div>
          </section>

          <section v-if="inspectorMode === 'object' && selected">
            <h4>{{ inspectorTab === 'variables' ? 'Identidade e variáveis' : 'Eventos e regras' }}</h4>
            <p v-if="inspectorTab === 'variables'" class="muted">Dados e valores pertencentes exclusivamente a este objeto.</p>
            <p v-else-if="inspectorTab === 'nodes'" class="muted">Eventos associados a este objeto. A lista mostra apenas regras vinculadas a ele.</p>
            <template v-if="inspectorTab === 'variables'">
            <div class="object-meta">
              <div><span>ID</span><code>{{ selected.id }}</code><button class="meta-copy" title="Copiar ID" @click="copyObjectId(selected.id)">⧉</button></div>
              <div><span>TIPO</span><strong>{{ selected.type === 'cube' ? 'Cube / GameObject' : 'Platform / GameObject' }}</strong></div>
            </div>
            <div class="component-caption">VARIÁVEIS DO OBJETO · VALORES INDEPENDENTES</div>
            <div class="variable-table-head" aria-hidden="true">
              <span>ID</span><span>TYPE</span><span>VALUE</span><span></span>
            </div>
            <div v-for="(value, name) in logicVariables" :key="'obj-' + name" class="variable-row object-variable-row">
              <code class="variable-id" :title="String(name)">{{ name }}</code>
              <span class="variable-type">{{ typeof value }}</span>
              <input class="variable-value" :aria-label="'Valor de ' + String(name)" :value="String(value)" @change="setLogicVariableValue(String(name), ($event.target as HTMLInputElement).value, 'object')" />
              <button class="variable-delete" :aria-label="'Excluir variável do objeto ' + String(name)" title="Excluir variável deste objeto" @click="deleteLogicVariable(String(name), 'object')">×</button>
            </div>
            <p v-if="!Object.keys(logicVariables).length" class="muted">Nenhuma variável própria neste objeto.</p>
            <div class="component-caption">VARIÁVEIS GLOBAIS REUTILIZÁVEIS</div>
            <p class="muted">Adicione uma cópia ao objeto para que cada objeto mantenha seu próprio valor.</p>
            <div class="variable-table-head global-variable-head" aria-hidden="true">
              <span>ID</span><span>TYPE</span><span>VALUE</span><span></span><span></span>
            </div>
            <div v-for="(value, name) in globalLogicVariables" :key="'global-' + name" class="variable-row global-variable-row">
              <code class="variable-id" :title="String(name)">{{ name }}</code>
              <span class="variable-type">{{ typeof value }}</span>
              <input class="variable-value" :aria-label="'Valor global de ' + String(name)" :value="String(value)" @change="setLogicVariableValue(String(name), ($event.target as HTMLInputElement).value, 'global')" />
              <button class="ghost variable-copy" title="Copiar para este objeto" :disabled="Object.prototype.hasOwnProperty.call(logicVariables, name)" @click="useGlobalVariableOnObject(String(name))">＋</button>
              <button class="variable-delete" :aria-label="'Excluir variável global ' + String(name)" title="Excluir variável global" @click="deleteLogicVariable(String(name), 'global')">×</button>
            </div>
            <div class="variable-create">
              <input v-model="newVariableName" placeholder="nome_da_variavel" spellcheck="false" />
              <select :value="newVariableType" aria-label="Tipo da nova variável" @change="onNewVariableTypeChange(($event.target as HTMLSelectElement).value as 'string' | 'number' | 'boolean')">
                <option value="string">String · texto</option>
                <option value="number">Number · número</option>
                <option value="boolean">Boolean · verdadeiro/falso</option>
              </select>
              <label v-if="newVariableType === 'boolean'" class="field variable-initial-value">Valor inicial
                <select v-model="newVariableValue">
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </label>
              <label v-else class="field variable-initial-value">Valor inicial
                <input v-model="newVariableValue" :type="newVariableType === 'number' ? 'number' : 'text'" :placeholder="newVariableType === 'number' ? '0' : 'Texto inicial'" />
              </label>
              <button class="ghost" @click="submitVariable('object')">+ Variável do objeto</button>
              <button class="ghost" @click="submitVariable('global')">+ Variável global</button>
            </div>
            </template>
            <template v-if="inspectorTab === 'nodes'">
            <label class="field">Gatilho
              <select v-model="ruleTrigger"><option value="object_clicked">Clicar no objeto selecionado</option><option value="enter_area">Objeto entrar na área (centro 0,1,0)</option></select>
            </label>
            <label class="field">Ação
              <select v-model="ruleAction"><option value="rotate">Girar +45°</option><option value="move">Mover para X=2</option><option value="set_visible">Ocultar objeto</option><option value="set_variable">Definir has_key = true</option><option value="javascript">JavaScript livre (colar código)</option><option value="script">Script Prometheus</option></select>
            </label>
            <label class="checkline"><input v-model="ruleConditionEnabled" type="checkbox" /> Exigir condição baseada em variável</label>
            <template v-if="ruleConditionEnabled">
              <label class="field">Variável
                <select v-model="conditionVariable">
                  <option v-for="(value, name) in logicVariables" :key="name" :value="String(name)">{{ name }} ({{ String(value) }})</option>
                </select>
              </label>
              <label class="field">Comparação
                <select v-model="conditionOperator">
                  <option value="equals">É igual a</option>
                  <option value="not_equals">É diferente de</option>
                  <option value="greater_than">É maior que</option>
                  <option value="less_than">É menor que</option>
                </select>
              </label>
              <label class="field">Valor esperado
                <input v-model="conditionValue" placeholder="true, false, 10 ou texto" />
              </label>
              <p class="muted">A ação só será executada se a variável escolhida atender à comparação.</p>
            </template>
            <template v-if="ruleAction === 'javascript'">
              <label class="field">Código JavaScript
                <textarea v-model="sidebarScriptDraft" class="script-editor" spellcheck="false" rows="8" placeholder="// Cole seu código JavaScript aqui"></textarea>
              </label>
              <p class="muted">O código será salvo na ação da nova regra e executado quando o gatilho e as condições forem satisfeitos.</p>
            </template>
            <label class="field">Nome do evento
              <input v-model="newEventName" placeholder="Ex.: Clique para abrir porta" spellcheck="false" />
            </label>
            <button class="ghost full" @click="addLogicRule(ruleAction === 'javascript' ? sidebarScriptDraft : undefined, ruleConditionEnabled ? { type: 'variable', name: conditionVariable, operator: conditionOperator, value: ruleValueFromInput(conditionValue) } : undefined, newEventName); newEventName = ''">+ Adicionar evento ao objeto selecionado</button>
            <div v-if="selectedObjectRules.length" class="rule-list">
              <div v-for="(rule, index) in selectedObjectRules" :key="rule.id" class="rule-item">
                <div class="rule-order" :title="'Prioridade ' + (index + 1)">
                  <button class="ghost" :disabled="index === 0" title="Subir na hierarquia (maior prioridade)" @click="moveLogicRule(rule.id, -1)">↑</button>
                  <button class="ghost" :disabled="index === logicRules.length - 1" title="Descer na hierarquia (menor prioridade)" @click="moveLogicRule(rule.id, 1)">↓</button>
                  <span class="muted">{{ index + 1 }}</span>
                </div>
                <label class="checkline"><input type="checkbox" :checked="rule.enabled" @change="toggleLogicRule(rule)" /><span>{{ rule.name }} · {{ rule.trigger.type === 'object_clicked' ? 'Clique' : 'Entrada na área' }}</span></label>
                <button class="ghost" title="Editar evento" @click="graphSelection = { ruleId: rule.id, part: 'trigger' }; graphOpen = true">Editar</button>
                <button class="rule-delete" title="Excluir regra" @click="deleteLogicRule(rule.id)">×</button>
              </div>
            </div>
            <p v-else class="muted">Este objeto ainda não tem nós ou eventos associados.</p>
            <button class="ghost full public-library-toggle" @click="publicLibraryOpen = !publicLibraryOpen">{{ publicLibraryOpen ? 'Fechar biblioteca pública' : '＋ Importar evento da biblioteca pública' }}</button>
            <div v-if="publicLibraryOpen" class="public-library-list">
              <p class="muted">Importar cria uma cópia independente vinculada a este objeto.</p>
              <div v-for="rule in publicLogicRules" :key="'public-' + rule.id" class="public-library-item">
                <span>{{ rule.name }}</span>
                <button class="ghost" @click="importPublicRule(rule)">Importar</button>
              </div>
              <p v-if="!publicLogicRules.length" class="muted">Nenhum evento público disponível para importar.</p>
            </div>

            </template>
          </section>

          <section class="object-components">
            <h4>{{ selected ? (inspectorTab === 'transform' ? 'Transformação' : inspectorTab === 'color' ? 'Aparência e material' : inspectorTab === 'nodes' ? 'Nós do objeto' : 'Dados do objeto') : selectedId === TERRAIN_ID ? 'Terreno editável' : 'Cena' }}</h4>
            <template v-if="selected">
              <template v-if="inspectorTab === 'transform'">
              <label class="field">Nome do objeto
                <input :value="selected.name" spellcheck="false" @change="onRename" />
              </label>

              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon transform-icon">↔</span><strong>Transform</strong><span class="component-menu">⋮</span></div>
                <div class="unity-component-body">
                  <div class="component-caption">POSITION</div>
                  <div class="grid3">
                    <label class="field">X<input class="mono" type="number" step="0.1" :value="selected.x.toFixed(2)" @change="onNumber('x', $event)" /></label>
                    <label class="field">Y<input class="mono" type="number" step="0.1" :value="selected.y.toFixed(2)" @change="onNumber('y', $event)" /></label>
                    <label class="field">Z<input class="mono" type="number" step="0.1" :value="selected.z.toFixed(2)" @change="onNumber('z', $event)" /></label>
                  </div>
                  <div class="component-caption">ROTATION</div>
                  <div class="grid3">
                    <label class="field">X<input class="mono" type="number" step="1" :value="selected.rotationX.toFixed(0)" @change="onNumber('rotationX', $event)" /></label>
                    <label class="field">Y<input class="mono" type="number" step="1" :value="selected.rotationY.toFixed(0)" @change="onNumber('rotationY', $event)" /></label>
                    <label class="field">Z<input class="mono" type="number" step="1" :value="selected.rotationZ.toFixed(0)" @change="onNumber('rotationZ', $event)" /></label>
                  </div>
                  <div class="component-caption">SCALE</div>
                  <div class="grid3">
                    <label class="field">X<input class="mono" type="number" min="0.1" step="0.1" :value="selected.scaleX.toFixed(2)" @change="onNumber('scaleX', $event)" /></label>
                    <label class="field">Y<input class="mono" type="number" min="0.1" step="0.1" :value="selected.scaleY.toFixed(2)" @change="onNumber('scaleY', $event)" /></label>
                    <label class="field">Z<input class="mono" type="number" min="0.1" step="0.1" :value="selected.scaleZ.toFixed(2)" @change="onNumber('scaleZ', $event)" /></label>
                  </div>
                  <p class="component-note">Transformação sincronizada com o gizmo 3D do viewport.</p>
                </div>
              </div>

              </template>
              <template v-if="inspectorTab === 'color'">
              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon renderer-icon">◈</span><strong>Mesh Renderer</strong><span class="component-menu">⋮</span></div>
                <div class="unity-component-body">
                  <label class="checkline component-enabled"><input type="checkbox" :checked="selected.visible" @change="toggleVisible(selected.id)" /> Renderer habilitado</label>
                  <label class="field">Material · cor base
                    <input type="color" class="color" :value="colorHex(selected.color)" @input="onColor" />
                  </label>
                  <div class="component-readonly"><span>Mesh</span><strong>{{ selected.type === 'cube' ? 'Cube Mesh' : 'Platform Mesh' }}</strong></div>
                  <div class="component-readonly"><span>Shader</span><strong>Standard / PBR</strong></div>
                </div>
              </div>

              </template>
              <template v-if="inspectorTab === 'nodes'">
              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon script-icon">⌘</span><strong>Event Script</strong><span class="component-count">{{ selectedObjectRules.length }}</span></div>
                <div class="unity-component-body">
                  <p class="muted">Eventos que usam este objeto como alvo ou ação.</p>
                  <div v-if="selectedObjectRules.length" class="attached-rules">
                    <button v-for="rule in selectedObjectRules" :key="rule.id" class="attached-rule" @click="openObjectRule(rule)">
                      <span class="attached-rule-status" :class="{ disabled: !rule.enabled }"></span>
                      <span>{{ rule.name }}</span><span class="rule-open">›</span>
                    </button>
                  </div>
                  <p v-else class="component-note">Nenhum evento associado a este objeto.</p>
                  <button class="ghost full add-component-btn" @click="addLogicRule(); graphOpen = true">+ Adicionar evento</button>
                </div>
              </div>

              </template>
              <button v-if="inspectorTab === 'transform' || inspectorTab === 'nodes'" class="danger" @click="removeSelected">Excluir GameObject (Del)</button>
            </template>
            <p v-else-if="selectedId === TERRAIN_ID" class="muted">
              Terreno editável · semente <span class="mono">{{ terrain.seed }}</span> ·
              <span class="mono">{{ terrain.edits }}</span> pontos editados.
            </p>
            <p v-else class="muted">
              Selecione um GameObject na hierarquia ou no mundo para editar seus componentes.
            </p>
          </section>
        </div>

        <div class="panel-foot">
          <span>ENGINE PROMETHEUS</span>
          <span class="mono">{{ ENGINE_VERSION }}</span>
        </div>
      </aside>
    </div>
    <ExecutionDock :mode="executionMode" @run="runWorld" @stop="stopWorld" @edit="returnToEdit" />
    <div v-if="graphOpen" class="graph-overlay">
      <header class="graph-top"><div class="graph-title-group"><strong>VISUAL SCRIPT</strong><span class="graph-subtitle">Diagrama por objeto · Evento → Condição → Ação</span><label class="graph-object-filter">Mostrar <select v-model="graphObjectFilter" @change="resetGraphView"><option value="selected">Objeto selecionado</option><option value="all">Todos os objetos</option></select></label></div><div class="graph-actions"><button class="ghost" @click="addLogicRule">+ Criar fluxo</button><button class="primary" @click="saveProject(false)">Salvar projeto</button><button class="ghost" @click="graphOpen = false">Voltar ao mundo ✕</button></div></header>
      <div class="graph-body">
        <aside class="graph-library property-source">
          <div class="eyebrow">OBJETO SELECIONADO</div>
          <h3>PROPRIEDADE</h3>
          <div class="property-event-list">
            <div class="property-event active"><span class="event-icon">↖</span><span>Ao Clicar</span><i></i></div>
            <div class="property-event muted"><span class="event-icon">⌁</span><span>Ao Pressionar</span></div>
            <div class="property-event muted"><span class="event-icon">⌖</span><span>Ao Passar o Mouse</span></div>
            <div class="property-event muted"><span class="event-icon">▶</span><span>Iniciar</span></div>
            <div class="property-event muted"><span class="event-icon">↻</span><span>Ao Alterar</span></div>
          </div>
          <div class="property-character" aria-hidden="true">
            <div class="character-shadow"></div><div class="character-head"><span class="character-hair"></span><span class="character-face"></span></div>
            <div class="character-body"></div><div class="character-arm left-arm"></div><div class="character-arm right-arm"></div>
            <div class="character-leg left-leg"></div><div class="character-leg right-leg"></div><div class="character-shoe left-shoe"></div><div class="character-shoe right-shoe"></div>
          </div>
          <div class="property-object-name">{{ selected?.name ?? 'Objeto da cena' }}</div>
          <div class="graph-tip">O evento inicia o fluxo. Conecte-o a requisitos e ações para definir o comportamento do objeto.</div>
        </aside>
        <div ref="graphViewport" class="graph-canvas" :class="{ 'is-panning': dragCanvas }" @pointerdown="startGraphPan" @pointermove="moveNode" @pointerup="endNodeDrag" @pointercancel="endNodeDrag" @wheel.prevent="onGraphWheel">
          <div class="graph-zoom-controls" @pointerdown.stop>
            <button title="Aproximar" aria-label="Aproximar" @click="zoomGraph(0.15)">＋</button>
            <span>{{ Math.round(graphZoom * 100) }}%</span>
            <button title="Afastar" aria-label="Afastar" @click="zoomGraph(-0.15)">−</button>
            <button title="Restaurar visualização inicial" aria-label="Restaurar visualização inicial" @click="resetGraphView">⌂</button>
          </div>
          <div ref="graphStage" class="graph-stage" :style="{ transform: `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphZoom})` }">
            <div v-if="!graphVisibleRules.length" class="graph-empty"><div class="empty-icon">⌘</div><h2>Nenhum fluxo criado</h2><p v-if="graphObjectFilter === 'selected' && selected">Este objeto ainda não tem eventos associados. Crie uma regra ou escolha “Todos os objetos”.</p><p v-else>Adicione uma regra no painel direito, em “Motor de regras”.</p><button class="ghost" @click="graphOpen = false">Voltar ao editor</button></div>
            <svg class="graph-wires" width="1800" height="6000" aria-hidden="true"><path v-for="edge in graphEdges" :key="edge.id" :class="edge.kind" :d="edge.d" /></svg>
            <article class="graph-node trigger-list" :style="{ left: '30px', top: '50px' }">
              <div class="node-head"><span>EVENTOS / GATILHOS</span><span>{{ graphVisibleRules.length }}</span></div>
              <button v-for="(rule, index) in graphVisibleRules" :key="rule.id" class="event-list-row" :class="{ chosen: graphSelection?.ruleId === rule.id && graphSelection?.part === 'trigger', disabled: !rule.enabled }" @pointerdown.stop @click.stop="graphSelection = { ruleId: rule.id, part: 'trigger' }">
                <span class="event-row-icon">↖</span><span class="event-row-copy"><strong>{{ rule.trigger.type === 'object_clicked' ? 'Ao Clicar' : 'Ao Entrar na Área' }}</strong><small>{{ rule.name }}</small></span><span class="event-row-port" :data-port-key="`event:${rule.id}`"></span>
              </button>
              <div v-if="!graphVisibleRules.length" class="event-list-empty">Nenhum evento criado</div>
            </article>
            <article v-for="node in graphNodes" :key="node.rule.id + node.part" class="graph-node" :class="[node.part, { chosen: graphSelection?.ruleId === node.rule.id && graphSelection?.part === node.part }]" :style="{ left: `${node.x}px`, top: `${node.y}px` }" @pointerdown.stop="startNodeDrag($event, node.rule.id, node.part)" @click.stop="graphSelection = { ruleId: node.rule.id, part: node.part }"><div class="node-head"><span>{{ node.part === 'condition' ? 'CONDIÇÃO' : 'AÇÃO' }}</span><span>{{ node.rule.enabled ? '●' : '○' }}</span></div><div class="node-title">{{ nodeTitle(node.rule, node.part) }}</div><div class="node-foot"><span class="node-port" :data-port-key="`${node.part}-in:${node.rule.id}`"></span>{{ node.rule.name }}<span class="node-port out" :data-port-key="`${node.part}-out:${node.rule.id}`"></span></div></article>
          </div>
        </div>
        <aside class="graph-inspector">
          <div class="eyebrow">INSPECTOR</div>
          <template v-if="selectedGraphRule && graphSelection">
            <h3>{{ graphSelection.part === 'trigger' ? 'Evento' : graphSelection.part === 'condition' ? 'Condição' : 'Ação' }}</h3>
            <label class="field">Nome do fluxo
              <input :value="selectedGraphRule.name" spellcheck="false" @change="updateLogicRule({ ...selectedGraphRule, name: ($event.target as HTMLInputElement).value })" />
            </label>
            <label class="checkline"><input type="checkbox" :checked="selectedGraphRule.enabled" @change="toggleLogicRule(selectedGraphRule)" /> Fluxo habilitado</label>
            <template v-if="graphSelection.part === 'trigger'">
              <label class="field">Tipo de evento
                <select :value="selectedGraphRule.trigger.type" @change="setSelectedTriggerType(($event.target as HTMLSelectElement).value as 'object_clicked' | 'enter_area')">
                  <option value="object_clicked">Ao clicar no objeto</option>
                  <option value="enter_area">Ao entrar em uma área</option>
                </select>
              </label>
              <template v-if="selectedGraphRule.trigger.type === 'object_clicked'">
                <label class="field">Objeto-alvo
                  <select :value="selectedGraphRule.trigger.objectId" @change="patchSelectedTrigger({ objectId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="obj in objects" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                  </select>
                </label>
              </template>
              <template v-else>
                <div class="component-caption">CENTRO DA ÁREA</div>
                <div class="grid3">
                  <label class="field">X<input type="number" :value="selectedGraphRule.trigger.center[0]" @change="patchSelectedTrigger({ center: [Number(($event.target as HTMLInputElement).value), selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[1] : 1, selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[2] : 0] })" /></label>
                  <label class="field">Y<input type="number" :value="selectedGraphRule.trigger.center[1]" @change="patchSelectedTrigger({ center: [selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[0] : 0, Number(($event.target as HTMLInputElement).value), selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[2] : 0] })" /></label>
                  <label class="field">Z<input type="number" :value="selectedGraphRule.trigger.center[2]" @change="patchSelectedTrigger({ center: [selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[0] : 0, selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[1] : 1, Number(($event.target as HTMLInputElement).value)] })" /></label>
                </div>
                <label class="field">Raio da área
                  <input type="number" min="0.1" step="0.1" :value="selectedGraphRule.trigger.radius" @change="patchSelectedTrigger({ radius: Math.max(0.1, Number(($event.target as HTMLInputElement).value)) })" />
                </label>
              </template>
            </template>
            <template v-else-if="graphSelection.part === 'condition'">
              <label class="checkline"><input type="checkbox" :checked="selectedGraphRule.conditions.length > 0" @change="updateLogicRule({ ...selectedGraphRule, conditions: ($event.target as HTMLInputElement).checked ? [{ type: 'variable', name: 'has_key', operator: 'equals', value: true }] : [] })" /> Exigir condição</label>
              <template v-if="selectedGraphRule.conditions.length">
                <label class="field">Variável exigida
                  <select :value="selectedGraphRule.conditions[0]?.name ?? ''" @change="patchSelectedCondition({ name: ($event.target as HTMLSelectElement).value })">
                    <option value="" disabled>Selecione uma variável</option>
                    <option v-for="(value, name) in logicVariables" :key="'local-' + name" :value="name">{{ name }} · objeto = {{ String(value) }}</option>
                    <option v-for="(value, name) in globalConditionVariables" :key="'global-' + name" :value="name">{{ name }} · global = {{ String(value) }}</option>
                  </select>
                </label>
                <label class="field">Comparação
                  <select :value="selectedGraphRule.conditions[0]?.operator ?? 'equals'" @change="patchSelectedCondition({ operator: ($event.target as HTMLSelectElement).value })">
                    <option value="equals">É igual a</option><option value="not_equals">É diferente de</option><option value="greater_than">Maior que</option><option value="less_than">Menor que</option>
                  </select>
                </label>
                <label class="field">Valor
                  <input :value="String(selectedGraphRule.conditions[0]?.value ?? true)" @change="patchSelectedCondition({ value: ruleValueFromInput(($event.target as HTMLInputElement).value) })" />
                </label>
                <p class="muted">Use true/false para booleanos ou um número para comparações numéricas.</p>
              </template>
              <p v-else class="muted">Sem condição: o evento executa sempre que for disparado.</p>
            </template>
            <template v-else>
              <label class="field">Tipo de ação
                <select :value="selectedGraphRule.actions[0]?.type ?? 'rotate'" @change="setSelectedActionType(($event.target as HTMLSelectElement).value as 'move' | 'rotate' | 'set_visible' | 'set_variable' | 'script' | 'javascript')">
                  <option value="move">Mover objeto</option><option value="rotate">Rotacionar objeto</option><option value="set_visible">Visibilidade</option><option value="set_variable">Definir variável</option><option value="script">Script Prometheus (comandos)</option><option value="javascript">JavaScript livre</option>
                </select>
              </label>
              <template v-if="selectedGraphRule.actions[0] && 'objectId' in selectedGraphRule.actions[0]">
                <label class="field">Objeto afetado
                  <select :value="selectedGraphRule.actions[0].objectId" @change="patchSelectedAction({ objectId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="obj in objects" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                  </select>
                </label>
              </template>
              <div v-if="selectedGraphRule.actions[0]?.type === 'move'" class="component-box">
                <div class="component-caption">POSIÇÃO DE DESTINO</div>
                <div class="grid3">
                  <label class="field">X<input type="number" step="0.1" :value="selectedGraphRule.actions[0].x ?? 0" @change="patchSelectedAction({ x: Number(($event.target as HTMLInputElement).value) })" /></label>
                  <label class="field">Y<input type="number" step="0.1" :value="selectedGraphRule.actions[0].y ?? 0" @change="patchSelectedAction({ y: Number(($event.target as HTMLInputElement).value) })" /></label>
                  <label class="field">Z<input type="number" step="0.1" :value="selectedGraphRule.actions[0].z ?? 0" @change="patchSelectedAction({ z: Number(($event.target as HTMLInputElement).value) })" /></label>
                </div>
              </div>
              <label v-else-if="selectedGraphRule.actions[0]?.type === 'rotate'" class="field">Ângulo (graus)
                <input type="number" step="1" :value="selectedGraphRule.actions[0].degrees" @change="patchSelectedAction({ degrees: Number(($event.target as HTMLInputElement).value) })" />
              </label>
              <label v-else-if="selectedGraphRule.actions[0]?.type === 'set_visible'" class="field">Visibilidade
                <select :value="String(selectedGraphRule.actions[0].visible)" @change="patchSelectedAction({ visible: ($event.target as HTMLSelectElement).value === 'true' })"><option value="true">Mostrar</option><option value="false">Ocultar</option></select>
              </label>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'javascript'">
                <p class="muted">JavaScript executado depois do gatilho e de todas as condições. API: <code>api</code>, <code>vars</code>, <code>world</code> e <code>console</code>.</p>
                <label class="field">Código JavaScript
                  <textarea class="script-editor" spellcheck="false" rows="12" :value="scriptDraft" @input="onScriptDraftInput"></textarea>
                </label>
                <div class="component-box">
                  <div class="component-caption">EXEMPLOS</div>
                  <p class="muted mono">api.set('score', 10)</p>
                  <p class="muted mono">api.add('score', 1)</p>
                  <p class="muted mono">api.toggle('has_key')</p>
                  <p class="muted mono">api.move('{ID_OBJECT}', 2, 0, 1)</p>
                  <p class="muted mono">api.rotate('{ID_OBJECT}', 45)</p>
                  <p class="muted mono">api.setVisible('{ID_OBJECT}', false)</p>
                  <p class="muted mono">api.setColor('{ID_OBJECT}', '#0000FF')</p>
                  <p class="muted">Também pode ler e alterar variáveis com vars.nome ou vars['nome']. Execute apenas scripts confiáveis: JavaScript roda com as permissões do app.</p>
                </div>
              </template>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'script'">
                <p class="muted">Script Prometheus (comandos seguros, uma instrução por linha). Não é JavaScript livre.</p>
                <label class="field">Código do evento
                  <textarea class="script-editor" spellcheck="false" rows="9" :value="selectedGraphRule.actions[0].code" @input="patchSelectedAction({ code: ($event.target as HTMLTextAreaElement).value })"></textarea>
                </label>
                <div class="component-box">
                  <div class="component-caption">COMANDOS DISPONÍVEIS</div>
                  <p class="muted mono">set nome = valor</p>
                  <p class="muted mono">add pontuacao 1</p>
                  <p class="muted mono">toggle tem_chave</p>
                  <p class="muted mono">rotate {ID_OBJECT} 45</p>
                  <p class="muted mono">move {ID_OBJECT} 2 0 1</p>
                  <p class="muted mono">visible {ID_OBJECT} false</p>
                  <p class="muted">Valores: true, false, números ou textos entre aspas. Use # para comentários.</p>
                </div>
              </template>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'set_variable'">
                <label class="field">Escopo da variável
                  <select :value="selectedGraphRule.actions[0].scope ?? 'object'" @change="patchSelectedAction({ scope: ($event.target as HTMLSelectElement).value as 'global' | 'object' })"><option value="object">Somente objeto do evento</option><option value="global">Global (compartilhada)</option></select>
                </label>
                <label class="field">Nome da variável<input :value="selectedGraphRule.actions[0].name" @change="patchSelectedAction({ name: ($event.target as HTMLInputElement).value })" /></label>
                <label class="field">Valor<input :value="String(selectedGraphRule.actions[0].value)" @change="patchSelectedAction({ value: ruleValueFromInput(($event.target as HTMLInputElement).value) })" /></label>
                <p class="muted">Use global quando quiser alterar um único valor compartilhado. Use objeto para alterar apenas o valor deste objeto.</p>
              </template>
            </template>
            <button class="danger" @click="deleteLogicRule(selectedGraphRule.id); graphSelection = null">Excluir fluxo</button>
          </template>
          <p v-else class="muted">Selecione um nó no gráfico para editar suas propriedades.</p>
          <div class="graph-rule-count">{{ logicRules.length }} fluxo(s) · {{ graphNodes.length }} nós</div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --bg: #12151c;
  --panel: #161a22;
  --panel-2: #1a1f29;
  --line: #242a35;
  --text: #d6dae3;
  --muted: #8a93a6;
  --accent: #c5533f;
  --accent-dark: #a4443a;
  --green: #5bd08a;
  --warn: #e0b04a;
}

.app { display: flex; flex-direction: column; height: 100%; background: var(--bg); color: var(--text); }
.grow { flex: 1; }
.mono { font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace; }

/* topo */
.topbar { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 3px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 8px; flex: none; }
.logo { width: 25px; height: 25px; border-radius: 5px; background: #4a2128; color: #f0897a; border: 1px solid #6b2f38; display: grid; place-items: center; font-weight: 800; font-size: 12px; }
.title { font-weight: 700; letter-spacing: 0.1em; font-size: 11px; white-space: nowrap; }
.subtitle { font-size: 8px; letter-spacing: 0.12em; color: var(--muted); margin-top: 1px; white-space: nowrap; }
.project { display: flex; align-items: center; gap: 6px; margin-left: 10px; }
.pname { width: 170px; padding: 4px 7px; background: transparent; border: 1px solid transparent; }
.pname:hover, .pname:focus { border-color: var(--line); background: var(--bg); }
.filebtns { display: flex; gap: 6px; flex: none; }
.filebtns .ghost { white-space: nowrap; }
.cam { display: inline-flex; align-items: center; gap: 6px; background: #3a1f24; border: 1px solid #6b2f38; color: #f3b3a8; padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; white-space: nowrap; flex: none; }
.cam:hover { background: #46262c; }
.cam-ring { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #f0897a; box-shadow: inset 0 0 0 2px #3a1f24, inset 0 0 0 6px #f0897a; }

/* barra de ferramentas */
.toolbar { display: flex; align-items: center; gap: 2px; padding: 0 10px; background: var(--panel); border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: thin; scrollbar-color: #2c3340 transparent; }
.tool { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 0; border-radius: 0; background: transparent; color: var(--text); white-space: nowrap; }
.tool:hover { background: #1d222c; }
.tool.active { background: var(--accent-dark); color: #fff; }
.tool-ico { opacity: 0.85; }
.full { width: 100%; }
.checkline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin: 10px 0; }
.checkline input { accent-color: var(--accent); }
.rule-list { margin-top: 10px; }
.rule-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--line); padding: 8px 0; }
.rule-item .checkline { flex: 1; margin: 0; }
.rule-delete { background: transparent; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; }
.tool.add { padding-left: 18px; padding-right: 18px; }
.vsep { width: 1px; height: 18px; background: var(--line); margin: 0 6px; flex: none; }

/* layout central */
.main { flex: 1; display: flex; min-height: 0; }
.panel { display: flex; flex-direction: column; background: var(--panel); min-height: 0; }
.panel.left { width: 210px; border-right: 1px solid var(--line); flex: none; }
.panel.right { width: 270px; border-left: 1px solid var(--line); flex: none; }
.panel-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.eyebrow { font-size: 10px; letter-spacing: 0.16em; color: var(--muted); }
.h { font-weight: 700; font-size: 16px; margin-top: 3px; }
.badge { background: #232a35; border-radius: 6px; padding: 4px 9px; font-weight: 700; }
.panel-foot { display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; border-top: 1px solid var(--line); font-size: 10.5px; color: var(--muted); letter-spacing: 0.02em; margin-top: auto; white-space: nowrap; gap: 8px; }
.local { display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.08em; }

.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.ok { background: var(--green); }
.dot.warn { background: var(--warn); }

/* hierarquia */
.tree { flex: 1; overflow-y: auto; }
.row { display: flex; align-items: center; gap: 10px; padding: 11px 16px; cursor: pointer; border-bottom: 1px solid var(--line); }
.row:hover { background: #1c212b; }
.row.root { font-weight: 700; background: var(--panel-2); }
.row.child { padding-left: 22px; }
.row.child .name { flex: 1; }
.row.active { background: #1f2b2a; box-shadow: inset 2px 0 0 var(--green); }
.row.terrain .name { color: #a8dca0; }
.row.hidden .name { opacity: 0.45; }
.chev { display: inline-block; width: 10px; color: var(--muted); transition: transform 0.15s; }
.chev.open { transform: rotate(90deg); }
.ico { display: inline-block; width: 12px; height: 12px; flex: none; }
.ico.world { background: #6d7ea8; border-radius: 3px; }
.ico.rect { border: 2px solid #a8dca0; border-radius: 2px; height: 9px; }
.ico.cube { border: 2px solid #f0897a; transform: rotate(45deg) scale(0.8); border-radius: 2px; }
.ico.platform { background: #e0566f; transform: skewX(-20deg); height: 10px; }
.eye { width: 10px; height: 10px; padding: 0; border-radius: 50%; border: 2px solid #7f8aa3; background: #7f8aa3; box-shadow: inset 0 0 0 2px var(--panel); }
.eye.off { background: transparent; box-shadow: none; opacity: 0.5; }

/* viewport */
.viewport { position: relative; flex: 1; min-width: 0; background: var(--bg); }
.canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
.canvas.tool-terrain { cursor: crosshair; }
.canvas.tool-build { cursor: copy; }
.chips { position: absolute; top: 16px; left: 16px; display: flex; gap: 8px; pointer-events: none; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--line); background: rgba(22, 26, 34, 0.85); border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; white-space: nowrap; }
.chip.live { color: #e6e9f0; }
.axes { position: absolute; left: 14px; bottom: 44px; display: flex; gap: 8px; pointer-events: none; }
.axis { padding: 6px 10px; border: 1px solid var(--line); background: rgba(22, 26, 34, 0.9); border-radius: 6px; font-size: 12px; }
.axis b { margin-right: 4px; }
.ax-x { color: #f0705f; } .ax-y { color: #8fd68a; } .ax-z { color: #6fb7f0; }
.statusbar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; background: rgba(14, 17, 23, 0.92); border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
.seg { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; white-space: nowrap; }
.seg.grow-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; display: block; }

/* inspetor */
.scroll { flex: 1; overflow-y: auto; }
.scroll section { padding: 16px 18px; border-bottom: 1px solid var(--line); }
.scroll h4 { margin: 0 0 12px; font-size: 14px; font-weight: 700; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 9px 12px; margin: 0; font-size: 12px; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; font-weight: 700; }
.muted { color: var(--muted); font-size: 12px; line-height: 1.6; margin: 0 0 12px; }
.slider-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin: 10px 0 6px; }
.slider-row b { color: var(--text); }
input[type='range'] { width: 100%; accent-color: var(--accent); }
.btn-row { display: flex; gap: 8px; margin-top: 14px; }
.btn-row .ghost { flex: 1; padding: 7px 6px; white-space: nowrap; font-size: 11.5px; }
.field { display: block; font-size: 11px; color: var(--muted); margin-bottom: 10px; }
.field input { display: block; width: 100%; margin-top: 5px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
input.color { padding: 2px; height: 32px; cursor: pointer; }

/* controles */
button { font: inherit; cursor: pointer; }
.ghost { background: #1d222c; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 12px; font-size: 12px; }
.ghost:hover { background: #252b37; }
.danger { width: 100%; margin-top: 4px; background: transparent; color: #f3a79b; border: 1px solid #6b2f38; border-radius: 8px; padding: 8px; }
.danger:hover { background: #2b1a1e; }
input { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; box-sizing: border-box; }
input:focus { outline: none; border-color: var(--accent); }

/* telas estreitas */
@media (max-width: 1100px) {
  .hide-narrow { display: none; }
}
@media (max-width: 1000px) {
  .pname { display: none; }
  .project { margin-left: 4px; }
  .panel.left { width: 190px; }
  .panel.right { width: 250px; }
  .tool { padding: 12px 10px; gap: 6px; }
  .full { width: 100%; }
.checkline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin: 10px 0; }
.checkline input { accent-color: var(--accent); }
.rule-list { margin-top: 10px; }
.rule-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--line); padding: 8px 0; }
.rule-item .checkline { flex: 1; margin: 0; }
.rule-delete { background: transparent; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; }
.tool.add { padding-left: 12px; padding-right: 12px; }
  .vsep { margin: 0 4px; }
  .panel-head { padding: 14px 14px; }
  .panel-foot { padding: 10px 12px; }
  .local { letter-spacing: 0.04em; }
  .row { padding-left: 12px; padding-right: 12px; }
  .row.child { padding-left: 18px; }
}
@media (max-width: 860px) {
  .tool { padding: 12px 7px; }
  .full { width: 100%; }
.checkline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin: 10px 0; }
.checkline input { accent-color: var(--accent); }
.rule-list { margin-top: 10px; }
.rule-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--line); padding: 8px 0; }
.rule-item .checkline { flex: 1; margin: 0; }
.rule-delete { background: transparent; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; }
.tool.add { padding-left: 9px; padding-right: 9px; }
}
</style>

<style>
.graph-overlay { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: #10131a; color: #e1e5ed; }
.graph-actions .primary { border:1px solid #f5a34d; background:#e98524; color:#252525; padding:6px 12px; border-radius:4px; font-weight:700; cursor:pointer; }
.graph-actions .primary:hover { background:#f5a34d; }
.graph-top { height: 58px; flex: none; display:flex; align-items:center; justify-content:space-between; padding:0 18px; border-bottom:1px solid #2a303d; background:#171b24; }
.graph-title-group { display:flex; align-items:center; gap:14px; min-width:0; }
.graph-object-filter { display:flex; align-items:center; gap:6px; color:#9aa4b7; font-size:11px; }
.graph-object-filter select { max-width:180px; border:1px solid #414958; border-radius:4px; padding:5px 7px; background:#222833; color:#e1e5ed; font-size:11px; }
.graph-node { width:300px; min-height:120px; }
.graph-node .node-title { font-size:13px; }
.graph-node .node-foot { justify-content:center; }
.graph-top strong { letter-spacing:.12em; font-size:13px; } .graph-subtitle { margin-left:16px; color:#8e98aa; font-size:12px; } .graph-actions { display:flex; gap:8px; }
.graph-body { display:grid; grid-template-columns:210px minmax(0,1fr) 245px; min-height:0; flex:1; }
.graph-library,.graph-inspector { padding:18px 14px; background:#171b24; overflow:auto; } .graph-library { border-right:1px solid #2a303d; } .graph-inspector { border-left:1px solid #2a303d; } .graph-library h3,.graph-inspector h3 { font-size:14px; margin:10px 0 14px; } .graph-library p { font-size:12px; line-height:1.6; color:#8993a6; }
.node-legend { padding:10px 12px; margin:8px 0; border-radius:6px; background:#202632; font-size:12px; border-left:3px solid; } .node-legend.trigger { border-color:#d8a34a; } .node-legend.condition { border-color:#6c9de6; } .node-legend.action { border-color:#65bf91; } .graph-tip { margin-top:26px; padding-top:14px; border-top:1px solid #2a303d; font-size:11px; line-height:1.6; color:#7f899c; }
.graph-canvas { position:relative; flex:1; overflow:hidden; min-width:0; min-height:0; background-color:#11151d; background-image:radial-gradient(#343b49 1px,transparent 1px); background-size:22px 22px; touch-action:none; cursor:grab; } .graph-canvas.is-panning { cursor:grabbing; } .graph-stage { position:absolute; inset:0 auto auto 0; width:1800px; height:6000px; transform-origin:0 0; will-change:transform; } .graph-zoom-controls { position:absolute; z-index:5; top:12px; right:12px; display:flex; align-items:center; gap:5px; padding:5px; border:1px solid #414141; border-radius:5px; background:#303030ee; box-shadow:0 3px 10px #0005; cursor:default; } .graph-zoom-controls button { width:29px; height:28px; border:1px solid #4b4b4b; border-radius:3px; background:#3b3b3b; color:#eee; font-size:18px; line-height:1; } .graph-zoom-controls button:hover { background:#51402f; border-color:#e98524; } .graph-zoom-controls span { min-width:42px; text-align:center; color:#ccc; font-size:10px; font-variant-numeric:tabular-nums; } .graph-wires { position:absolute; inset:0; width:1800px; height:6000px; pointer-events:none; overflow:visible; } .graph-wires path { fill:none; stroke:#8a96ad; stroke-width:3; }
.graph-wires { z-index:0; }
.graph-node { z-index:1; }
.graph-node .node-port, .event-row-port { z-index:3; }
.graph-node { position:absolute; width:300px; min-height:120px; border:1px solid #3b4352; background:#1c222d; border-radius:8px; box-shadow:0 10px 24px #0004; cursor:grab; user-select:none; z-index:1; } .graph-node:active { cursor:grabbing; } .graph-node.chosen { outline:2px solid #d36a55; outline-offset:2px; } .graph-node.trigger { border-top:3px solid #d8a34a; } .graph-node.condition { border-top:3px solid #6c9de6; } .graph-node.action { border-top:3px solid #65bf91; } .node-head { display:flex; justify-content:space-between; padding:10px 12px 8px; font-size:9px; letter-spacing:.13em; color:#aab4c5; border-bottom:1px solid #303746; } .node-title { padding:13px 12px; min-height:44px; font-size:12px; line-height:1.5; } .node-foot { position:relative; display:flex; align-items:center; justify-content:center; padding:7px; border-top:1px solid #303746; color:#7f899c; font-size:10px; } .node-port { position:absolute; left:-5px; top:50%; width:9px; height:9px; border-radius:50%; background:#8a96ad; border:2px solid #1c222d; } .node-port.out { left:auto; right:-5px; } .graph-empty { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; width:min(360px,90%); } .graph-empty h2 { font-size:18px; } .graph-empty p { color:#8e98aa; font-size:12px; line-height:1.6; } .empty-icon { font-size:32px; color:#d36a55; } .graph-rule-count { border-top:1px solid #2a303d; margin-top:24px; padding-top:12px; font-size:11px; color:#8e98aa; }
@media(max-width:800px) { .graph-body { grid-template-columns:150px minmax(0,1fr); } .graph-inspector { display:none; } .graph-subtitle { display:none; } }
</style>


<style>
/* Tema visual inspirado no Blender: painéis grafite, controles compactos e seleção laranja. */
:root {
  --bg: #282828;
  --panel: #303030;
  --panel-2: #383838;
  --line: #202020;
  --text: #dedede;
  --muted: #a0a0a0;
  --accent: #e98524;
  --accent-dark: #b96313;
  --green: #83b879;
  --warn: #e4b65c;
}

.app { background: #282828; color: #dedede; }
.topbar {
  min-height: 32px;
  height: 32px;
  gap: 7px;
  padding: 2px 7px;
  background: #252525;
  border-bottom: 1px solid #171717;
}
.brand { gap: 7px; }
.logo {
  width: 23px;
  height: 23px;
  border-radius: 4px;
  background: #e98524;
  color: #252525;
  border: 1px solid #f5a34d;
}
.title { font-size: 10px; letter-spacing: .07em; }
.subtitle { display: none; }
.project { margin-left: 8px; }
.pname { font-size: 11px; padding: 3px 6px; border-radius: 3px; }
.filebtns { gap: 2px; }
.filebtns .ghost,
.ghost {
  padding: 4px 8px;
  border-radius: 3px;
  border-color: #202020;
  background: #3a3a3a;
  color: #dedede;
  font-size: 11px;
}
.filebtns .ghost:hover,
.ghost:hover { background: #4a4a4a; }
.cam {
  padding: 4px 8px;
  border-radius: 3px;
  background: #3b332a;
  border-color: #59442d;
  color: #f2bd83;
}
.cam:hover { background: #4b3c2d; }

.toolbar {
  min-height: 32px;
  height: 32px;
  gap: 1px;
  padding: 0 5px;
  background: #333;
  border-bottom: 1px solid #1d1d1d;
}
.tool {
  height: 29px;
  padding: 0 9px;
  gap: 5px;
  border-radius: 3px;
  color: #d2d2d2;
  font-size: 11px;
}
.tool:hover { background: #484848; }
.tool.active {
  background: #51402f;
  box-shadow: inset 0 -2px 0 #e98524;
  color: #fff;
}
.tool.add { padding-left: 9px; padding-right: 9px; }
.tool-ico { color: #c7c7c7; }
.vsep { height: 19px; margin: 0 4px; background: #505050; }

.main { background: #282828; }
.panel { background: #303030; }
.panel.left { width: 225px; border-right: 1px solid #1c1c1c; }
.panel.right { width: 285px; border-left: 1px solid #1c1c1c; }
.panel-head {
  padding: 9px 11px;
  background: #383838;
  border-bottom: 1px solid #222;
}
.eyebrow { font-size: 9px; letter-spacing: .1em; color: #a4a4a4; }
.h { font-size: 13px; margin-top: 2px; }
.badge { padding: 3px 7px; border-radius: 3px; background: #252525; }
.panel-foot {
  padding: 6px 9px;
  background: #292929;
  border-top: 1px solid #202020;
  font-size: 10px;
}
.tree { background: #303030; }
.row {
  gap: 8px;
  padding: 6px 10px;
  min-height: 27px;
  border-bottom: 0;
  font-size: 11px;
}
.row.root { background: #383838; }
.row.child { padding-left: 23px; }
.row:hover { background: #454545; }
.row.active {
  background: #51402f;
  box-shadow: inset 2px 0 0 #e98524;
}
.row.terrain .name { color: #b9d5a7; }
.chev { width: 8px; }

.viewport { background: #242424; }
.chips { top: 9px; left: 9px; gap: 4px; }
.chip {
  padding: 4px 7px;
  border-radius: 3px;
  border-color: #3b3b3b;
  background: rgba(38, 38, 38, .9);
  font-size: 9px;
  letter-spacing: .05em;
}
.axes { left: 9px; bottom: 35px; gap: 4px; }
.axis {
  padding: 4px 7px;
  border-radius: 3px;
  background: rgba(38, 38, 38, .92);
  font-size: 10px;
}
.statusbar { background: #292929; border-top-color: #1c1c1c; font-size: 10px; }
.seg { padding: 5px 9px; }

.scroll section { padding: 11px 12px; border-bottom-color: #242424; }
.scroll h4 { margin-bottom: 9px; font-size: 12px; }
dl { gap: 7px 10px; font-size: 11px; }
.muted { font-size: 11px; }
.field { font-size: 10px; }
.field input,
input,
select {
  border-radius: 3px;
  border-color: #202020;
  background: #252525;
  color: #dedede;
  padding: 5px 7px;
  font-size: 11px;
}
input:focus, select:focus { border-color: #e98524; }
input[type='range'] { accent-color: #e98524; }
.checkline { font-size: 11px; }
.danger {
  border-radius: 3px;
  border-color: #704137;
  color: #f0a18b;
  padding: 6px;
}
.danger:hover { background: #412d29; }
.eye { border-color: #aaa; background: #aaa; }
.eye.off { background: transparent; }

@media (max-width: 1000px) {
  .tool { height: 29px; padding: 0 7px; }
  .panel.left { width: 195px; }
  .panel.right { width: 260px; }
}
@media (max-width: 860px) {
  .tool { height: 29px; padding: 0 6px; }
}
</style>

<style>
/* Workspace de lógica inspirado no Unity: hierarquia de nós, inspector por componente e controles editáveis. */
.graph-overlay { background:#202020; color:#e6e6e6; }
.graph-top { height:38px; padding:0 10px; background:#303030; border-bottom:1px solid #171717; }
.graph-top strong { font-size:11px; letter-spacing:.08em; }
.graph-subtitle { font-size:10px; margin-left:10px; }
.graph-body { grid-template-columns:190px minmax(0,1fr) 285px; }
.graph-library,.graph-inspector { padding:12px 10px; background:#303030; }
.graph-library { border-right:1px solid #191919; }
.graph-inspector { border-left:1px solid #191919; }
.graph-library h3,.graph-inspector h3 { margin:8px 0 12px; font-size:13px; }
.graph-canvas { background-color:#252525; background-image:linear-gradient(#303030 1px,transparent 1px),linear-gradient(90deg,#303030 1px,transparent 1px); background-size:20px 20px; }
.graph-wires path { stroke:#a4a4a4; stroke-width:2; }
.graph-node { width:232px; min-height:122px; border-radius:4px; background:#383838; border-color:#1d1d1d; box-shadow:0 3px 8px #0005; }
.graph-node.chosen { outline:2px solid #e98524; outline-offset:0; }
.graph-node.trigger { border-top:3px solid #b98b48; }
.graph-node.condition { border-top:3px solid #6b9ecb; }
.graph-node.action { border-top:3px solid #70a878; }
.node-head { padding:8px 10px 7px; background:#303030; border-bottom-color:#242424; font-size:9px; }
.node-title { padding:12px 10px; min-height:40px; font-size:11px; }
.node-foot { background:#303030; border-top-color:#242424; }
.graph-inspector .field { margin:10px 0; font-size:10px; }
.graph-inspector .field input,.graph-inspector .field select { margin-top:4px; width:100%; }
.graph-inspector .grid3 { gap:5px; }
.graph-inspector .component-caption { margin:10px 0 7px; color:#aaa; font-size:9px; font-weight:700; letter-spacing:.09em; }
.graph-inspector .component-box { border:1px solid #202020; background:#292929; padding:8px; margin:8px 0 12px; }
.graph-inspector .checkline { margin:10px 0; color:#d0d0d0; }
.variable-row { display:flex; align-items:center; gap:6px; }
.variable-row .field { flex:1; min-width:0; }
.variable-row input { width:100%; }
.variable-create { display:grid; grid-template-columns:1fr 1fr; gap:5px; margin:10px 0 14px; }
.variable-create .full { grid-column:1 / -1; }
.script-editor { display:block; width:100%; min-height:150px; resize:vertical; padding:8px; background:#202020; color:#d9e7d1; border:1px solid #181818; border-radius:3px; font:11px/1.5 'Cascadia Mono',Consolas,monospace; white-space:pre; }
.graph-inspector .ghost,.graph-inspector .danger { border-radius:3px; }
.graph-rule-count { border-top-color:#1d1d1d; }
@media(max-width:900px) { .graph-body { grid-template-columns:145px minmax(0,1fr); } .graph-inspector { display:none; } }
</style>

<style>
/* Inspetor de componentes inspirado no Inspector do Unity. */
.object-components > h4 { margin-bottom:12px; }
.unity-component { margin:10px 0; border:1px solid #1d1d1d; border-radius:3px; overflow:hidden; background:#292929; }
.unity-component-head { min-height:31px; display:flex; align-items:center; gap:8px; padding:0 8px; background:#383838; border-bottom:1px solid #202020; font-size:11px; }
.unity-component-head strong { font-size:11px; font-weight:600; flex:1; color:#e2e2e2; }
.component-icon { width:18px; height:18px; display:grid; place-items:center; border-radius:3px; font-size:13px; background:#242424; color:#e98524; }
.renderer-icon { color:#85b4d9; }
.script-icon { color:#83bb8b; }
.component-menu { color:#aaa; font-size:17px; line-height:1; }
.component-count { min-width:18px; text-align:center; padding:2px 5px; border-radius:8px; background:#242424; color:#bdbdbd; font-size:10px; }
.unity-component-body { padding:9px 8px 8px; }
.unity-component-body .field { margin-bottom:8px; }
.unity-component-body .grid3 { gap:5px; }
.unity-component-body .field input { padding:5px 4px; min-width:0; }
.component-caption { margin:3px 0 6px; color:#999; font-size:9px; font-weight:700; letter-spacing:.08em; }
.component-note { margin:5px 0 2px; color:#999; font-size:10px; line-height:1.5; }
.component-enabled { color:#ddd; padding-bottom:8px; border-bottom:1px solid #202020; }
.component-readonly { display:flex; justify-content:space-between; gap:8px; padding:6px 0 0; font-size:10px; color:#999; }
.component-readonly strong { color:#cfcfcf; font-weight:500; text-align:right; }
.attached-rules { display:flex; flex-direction:column; gap:4px; margin:8px 0; }
.attached-rule { display:flex; align-items:center; gap:7px; width:100%; padding:7px; text-align:left; border:1px solid #202020; border-radius:3px; background:#333; color:#ddd; font-size:10px; }
.attached-rule:hover { background:#414141; border-color:#555; }
.attached-rule > span:nth-child(2) { flex:1; }
.attached-rule-status { width:7px; height:7px; border-radius:50%; background:#83bb8b; }
.attached-rule-status.disabled { background:#666; }
.rule-open { color:#aaa; font-size:16px; }
.add-component-btn { margin-top:8px; }
.object-components .danger { margin-top:8px; }
@media(max-width:1000px) { .unity-component-body .field input { font-size:10px; } }
</style>


<style>
/* Inspector contextual: cabeçalho enxuto e conteúdo organizado por estado de seleção. */
.panel.right {
  width: 292px;
  min-width: 250px;
  background: #292929;
  border-left: 1px solid #1b1b1b;
}
.inspector-heading {
  flex: none;
  padding: 11px 12px 12px;
  background: #323232;
  border-bottom: 1px solid #1c1c1c;
}
.inspector-heading-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.inspector-context {
  padding: 3px 6px;
  border: 1px solid #484848;
  border-radius: 3px;
  color: #aaa;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .07em;
}
.inspector-title-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.inspector-object-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border: 1px solid #4a4a4a;
  border-radius: 4px;
  background: #252525;
  color: #bcbcbc;
  font-size: 20px;
}
.inspector-object-icon.selected {
  color: #f0a04c;
  border-color: #76502e;
  background: #3b3025;
}
.inspector-object-icon.terrain {
  color: #9ecb91;
  border-color: #40513b;
  background: #293328;
}
.inspector-title-copy { min-width: 0; flex: 1; }
.inspector-title-copy .h {
  margin: 0;
  overflow: hidden;
  color: #f0f0f0;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspector-description {
  margin-top: 4px;
  color: #999;
  font-size: 10px;
}
.selection-indicator {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: #e98524;
  box-shadow: 0 0 0 3px #e985241c;
}
.selection-empty-hint {
  margin-top: 11px;
  padding: 9px;
  border: 1px solid #424242;
  border-radius: 3px;
  background: #2a2a2a;
  color: #aaa;
  font-size: 10px;
  line-height: 1.5;
}
.panel.right .scroll {
  min-height: 0;
  background: #292929;
  scrollbar-color: #505050 transparent;
}
.panel.right .scroll > section {
  padding: 12px;
  border-bottom: 1px solid #1e1e1e;
}
.panel.right .scroll > section > h4 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 11px;
  color: #e4e4e4;
  font-size: 11px;
  font-weight: 650;
}
.panel.right .scroll > section > h4::before {
  width: 3px;
  height: 12px;
  border-radius: 1px;
  background: #777;
  content: "";
}
.panel.right.has-selection .scroll > section.object-components > h4::before {
  background: #e98524;
}
.panel.right .component-caption {
  margin-top: 12px;
  color: #969696;
  font-size: 9px;
  letter-spacing: .055em;
}
.panel.right .unity-component {
  margin: 8px 0;
  border-color: #1c1c1c;
  background: #292929;
}
.panel.right .unity-component-head {
  min-height: 32px;
  background: #353535;
}
.panel.right .unity-component-body { padding: 10px 8px 7px; }
.panel.right .field input,
.panel.right .field select,
.panel.right input:not([type="checkbox"]):not([type="range"]):not([type="color"]) {
  min-height: 27px;
  border-color: #1d1d1d;
  background: #202020;
}
.panel.right .field input:focus,
.panel.right .field select:focus { border-color: #a66a32; }
.panel.right .variable-row { gap: 5px; }
.panel.right .variable-row .ghost { min-width: 28px; padding: 4px 7px; }
.panel.right .variable-create { gap: 6px; }
.panel.right .rule-item {
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 0;
  border-top-color: #252525;
}
.panel.right .rule-item .checkline { min-width: 0; }
.panel.right .panel-foot {
  min-height: 28px;
  border-top-color: #1c1c1c;
  background: #252525;
}
.panel.right .danger { margin-top: 10px; }
@media (max-width: 1000px) {
  .panel.right { width: 260px; min-width: 235px; }
  .inspector-heading { padding: 10px; }
}
@media (max-width: 700px) {
  .panel.right { width: 235px; min-width: 210px; }
  .inspector-heading { padding: 8px; }
  .inspector-object-icon { width: 28px; height: 28px; }
  .panel.right .scroll > section { padding: 9px; }
}
</style>

<style>
.inspector-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));flex:none;padding:5px 7px 0;gap:3px;background:#2b2b2b;border-bottom:1px solid #1a1a1a}
.inspector-tabs button{min-width:0;min-height:47px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid transparent;border-bottom:2px solid transparent;border-radius:3px 3px 0 0;background:transparent;color:#a5a5a5;cursor:pointer}
.inspector-tabs button>span{font-size:16px;line-height:17px}.inspector-tabs button small{font-size:9px;white-space:nowrap}
.inspector-tabs button:hover{background:#383838;color:#eee}.inspector-tabs button.active{border-color:#3b3b3b;border-bottom-color:#e98524;background:#353535;color:#f1f1f1}
.object-meta{margin:8px 0 14px;border:1px solid #202020;border-radius:3px;background:#252525}
.object-meta>div{min-height:33px;display:flex;align-items:center;gap:8px;padding:6px 8px}.object-meta>div+div{border-top:1px solid #353535}
.object-meta span{width:34px;flex:none;color:#929292;font-size:9px;font-weight:700;letter-spacing:.05em}
.object-meta code,.object-meta strong{min-width:0;overflow:hidden;color:#d3d3d3;font-size:10px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.object-meta code{flex:1;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.meta-copy{padding:2px 5px;border:1px solid #484848;border-radius:3px;background:#333;color:#bbb;cursor:pointer}
.execution-dock{position:absolute;z-index:12;left:50%;bottom:25px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:12px;min-height:86px;padding:9px 15px 7px;border:1px solid #454b53;border-radius:48px;background:linear-gradient(180deg,#3c4148 0%,#24282e 48%,#171a1f 100%);box-shadow:inset 0 1px 1px #ffffff35,inset 0 -2px 3px #0008,0 8px 28px #0009;backdrop-filter:blur(12px)}
.media-orb{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;flex:none;width:57px;height:57px;padding:0;border:1px solid #77818d;border-radius:50%;color:#f5f7fa;cursor:pointer;box-shadow:inset 0 2px 2px #ffffff8a,inset 0 -5px 7px #0008,0 2px 4px #0009;transition:transform .12s ease,filter .12s ease}
.media-orb::before{position:absolute;content:"";top:3px;left:7px;right:7px;height:43%;border-radius:50% 50% 45% 45%;background:linear-gradient(180deg,#ffffff6b,#ffffff08);pointer-events:none}
.media-orb:hover{filter:brightness(1.18);transform:translateY(-1px)}
.media-orb:active{transform:translateY(1px);box-shadow:inset 0 3px 7px #0008,0 1px 2px #0008}
.media-orb .orb-glyph{position:relative;z-index:1;font-size:17px;line-height:1;text-shadow:0 1px 2px #0009}
.media-orb small{position:relative;z-index:1;font-size:9px;font-weight:750;line-height:1;text-shadow:0 1px 2px #000}
.media-stop{width:49px;height:49px;background:linear-gradient(180deg,#e8f0f6 0%,#8398aa 17%,#465d70 52%,#263747 100%);border-color:#a8bac8;margin-top:4px}
.media-stop .orb-glyph{color:#fff;font-size:13px}
.media-run{width:69px;height:69px;background:linear-gradient(180deg,#e9ffd9 0%,#9bd76d 15%,#4caa35 48%,#216b20 100%);border:2px solid #c7f3a9;box-shadow:inset 0 2px 3px #ffffffc2,inset 0 -7px 9px #174c16b8,0 0 0 3px #1b241d,0 3px 8px #000b}
.media-run .orb-glyph{font-size:23px}
.media-edit{width:49px;height:49px;margin-top:4px;background:linear-gradient(180deg,#fff1d4 0%,#e9b86d 17%,#b97a31 53%,#70431e 100%);border-color:#f0c58b}
.media-edit .orb-glyph{font-size:17px}
.media-orb.active{filter:brightness(1.2);outline:1px solid #ffffff80;outline-offset:2px}
.media-stop.active{box-shadow:inset 0 2px 2px #ffffff8a,inset 0 -5px 7px #0008,0 0 0 2px #d8e6f2,0 2px 5px #0009}
.media-run.active{box-shadow:inset 0 2px 3px #ffffffc2,inset 0 -7px 9px #174c16b8,0 0 0 3px #1b241d,0 0 0 5px #8be36d,0 3px 8px #000b}
.media-edit.active{box-shadow:inset 0 2px 2px #ffffff8a,inset 0 -5px 7px #0008,0 0 0 2px #f0c58b,0 2px 5px #0009}
.dock-state{display:flex;align-items:center;gap:6px;margin-left:3px;padding:0 3px;color:#b8bec7;font-size:9px;font-weight:700;letter-spacing:.04em;white-space:nowrap}
.dock-state i{width:6px;height:6px;border-radius:50%;background:#9c9c9c}.dock-state i.running{background:#83e46f;box-shadow:0 0 0 3px #83bd771a}.dock-state i.stopped{background:#ed786f}.dock-state i.edit{background:#efb567}
@media(max-width:850px){.execution-dock{bottom:32px;gap:8px;min-height:72px;padding:7px 10px}.media-orb{width:45px;height:45px}.media-run{width:59px;height:59px}.media-orb .orb-glyph{font-size:14px}.media-run .orb-glyph{font-size:20px}.media-orb small{font-size:8px}.dock-state{display:none}.inspector-tabs{padding-inline:4px;gap:1px}.inspector-tabs button small{font-size:8px}}
</style>

<style>
.public-library-toggle{margin-top:10px}
.public-library-list{margin-top:8px;padding:8px;border:1px solid #202020;border-radius:3px;background:#252525}
.public-library-list>p{margin:2px 0 8px;font-size:10px;line-height:1.5}
.public-library-item{display:flex;align-items:center;gap:6px;padding:7px 0;border-top:1px solid #363636}
.public-library-item span{flex:1;min-width:0;color:#ddd;font-size:10px;overflow-wrap:anywhere}
.public-library-item .ghost{flex:none}
</style>


<style>
/* Variáveis em linhas compactas: ID, TYPE e VALUE alinhados como uma tabela. */
.variable-table-head,
.variable-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(48px, .65fr) minmax(0, 1fr) 27px;
  align-items: center;
  gap: 6px;
}
.variable-table-head {
  margin: 9px 0 4px;
  padding: 0 6px;
  color: #929292;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .06em;
}
.variable-row {
  min-width: 0;
  margin: 0 0 5px;
  padding: 5px;
  border: 1px solid #202020;
  border-radius: 3px;
  background: #303030;
}
.variable-id {
  min-width: 0;
  overflow: hidden;
  color: #dedede;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.variable-type {
  min-width: 0;
  overflow: hidden;
  color: #a8b9a0;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.variable-row .variable-value {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 27px;
  padding: 5px 6px;
  border: 1px solid #1c1c1c;
  border-radius: 3px;
  background: #202020;
  color: #f0f0f0;
  font-size: 10px;
}
.variable-row .variable-value:focus { border-color: #a66a32; outline: none; }
.global-variable-head,
.global-variable-row {
  grid-template-columns: minmax(0, 1fr) minmax(48px, .65fr) minmax(0, 1fr) 27px 27px;
}
.variable-delete {
  width: 27px;
  min-width: 27px;
  height: 27px;
  padding: 0;
  border: 1px solid #50302d;
  border-radius: 3px;
  background: #342624;
  color: #ef9b91;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.variable-delete:hover { background: #63332e; color: #fff; }
.variable-delete:focus-visible { outline: 1px solid #ef9b91; outline-offset: 1px; }

.variable-row .variable-copy {
  min-width: 0;
  padding: 4px 5px;
}
@media (max-width: 1000px) {
  .variable-table-head, .variable-row { gap: 4px; }
  .variable-row { padding: 4px; }
  .variable-id, .variable-type, .variable-row .variable-value { font-size: 9px; }
}
</style>

<style>
.variable-create { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px; margin:10px 0 14px; }
.variable-create > input:first-child,
.variable-create > select,
.variable-create > .variable-initial-value { grid-column:1 / -1; width:100%; min-width:0; box-sizing:border-box; }
.variable-create .variable-initial-value { margin:0; }
.variable-create .variable-initial-value input,
.variable-create .variable-initial-value select { display:block; width:100%; box-sizing:border-box; margin-top:4px; }
.variable-create > button { min-width:0; white-space:normal; line-height:1.4; }
</style>

<style>

/* Visual Script: propriedade à esquerda, requisitos e ações com conexões coloridas. */
.graph-library.property-source { padding:16px 12px; display:flex; flex-direction:column; background:#20232c; }
.property-source h3 { margin:7px 0 14px!important; font-size:14px!important; letter-spacing:.11em; color:#f0f1f5; }
.property-event-list { display:flex; flex-direction:column; gap:7px; }
.property-event { min-height:38px; display:flex; align-items:center; gap:9px; padding:0 9px; border:1px solid #353a48; border-radius:5px; background:#292d37; color:#b4bac7; font-size:11px; }
.property-event .event-icon { width:20px; text-align:center; font-size:15px; }
.property-event.active { border-color:#f3c34e; box-shadow:0 0 0 1px #f3c34e,0 0 13px #f3c34e25; color:#fff2c5; background:#393426; }
.property-event.active i { margin-left:auto; width:6px; height:6px; border-radius:50%; background:#f3c34e; box-shadow:0 0 8px #f3c34e; }
.property-event.muted { opacity:.48; }
.property-character { height:178px; position:relative; margin:20px 0 5px; overflow:hidden; border-radius:7px; background:radial-gradient(ellipse at 50% 70%,#363e50 0, #252a34 50%,#20232c 78%); }
.character-shadow { position:absolute; bottom:14px; left:50%; width:85px; height:15px; transform:translateX(-50%); border-radius:50%; background:#11151c; }
.character-head { position:absolute; z-index:3; left:calc(50% - 20px); top:22px; width:40px; height:45px; border-radius:45% 45% 43% 43%; background:#dca77c; box-shadow:inset -6px -2px #bd805b; }
.character-hair { position:absolute; left:-2px; top:-5px; width:43px; height:20px; border-radius:55% 45% 20% 20%; background:#68432e; box-shadow:inset 0 -4px #4a3024; }
.character-face { position:absolute; left:9px; top:23px; width:4px; height:4px; border-radius:50%; background:#392b25; box-shadow:16px 0 #392b25,7px 10px 0 -1px #9a5147; }
.character-body { position:absolute; z-index:2; left:calc(50% - 25px); top:65px; width:50px; height:55px; border-radius:12px 12px 7px 7px; background:linear-gradient(90deg,#245b9d,#377fc4 55%,#1f548e); }
.character-arm { position:absolute; z-index:1; top:69px; width:14px; height:48px; border-radius:8px; background:#dca77c; }
.left-arm { left:calc(50% - 34px); transform:rotate(12deg); }.right-arm { left:calc(50% + 20px); transform:rotate(-12deg); }
.character-leg { position:absolute; z-index:1; top:113px; width:18px; height:43px; border-radius:4px 4px 7px 7px; background:linear-gradient(90deg,#24476f,#4775a5); }
.left-leg { left:calc(50% - 20px); }.right-leg { left:calc(50% + 2px); }
.character-shoe { position:absolute; z-index:2; bottom:12px; width:22px; height:9px; border-radius:5px 7px 3px 3px; background:#d9dce2; }
.left-shoe { left:calc(50% - 23px); }.right-shoe { left:calc(50% + 1px); }
.property-object-name { text-align:center; color:#dce1eb; font-size:11px; font-weight:600; }
.property-source .graph-tip { margin-top:auto; padding-top:13px; }
.graph-node { width:232px; min-height:130px; border-radius:7px; background:#252934; border:1px solid #414756; overflow:visible; }
.graph-node.trigger { border:1px solid #f1bd45; box-shadow:0 0 0 1px #f1bd4544,0 5px 18px #0005; }
.graph-node.condition { border:1px solid #9a6cf0; box-shadow:0 0 0 1px #9a6cf055,0 5px 18px #0005; }
.graph-node.action { border:1px solid #e86659; box-shadow:0 0 0 1px #e8665944,0 5px 18px #0005; }
.graph-node.condition .node-head { color:#d7c4ff; background:#30283f; }
.graph-node.action .node-head { color:#ffb4a9; background:#3d292d; }
.graph-node.trigger .node-head { color:#ffe39a; background:#3a3323; }
.graph-node .node-port { z-index:3; width:11px; height:11px; border-width:2px; background:#f3c34e; border-color:#252934; box-shadow:0 0 7px currentColor; }
.graph-node.condition .node-port { background:#a27aff; }
.graph-node.action .node-port { background:#f07868; }
.graph-wires path { stroke-width:3; filter:drop-shadow(0 0 3px currentColor); }
.graph-wires path.trigger-condition { stroke:#f3b94b; color:#f3b94b; }
.graph-wires path.condition-action { stroke:#e56b60; color:#e56b60; }
.graph-node .node-foot { color:#c1c6d1; }
@media(max-width:800px) { .property-character { height:130px; } }

</style>
\n<style>\n
/* Os eventos compartilham uma única lista; condições e ações permanecem como nós individuais. */
.graph-node.trigger-list { width:270px; min-height:0; padding-bottom:5px; border:1px solid #f1bd45; border-top:3px solid #f1bd45; background:#252934; }
.trigger-list .node-head { min-height:35px; align-items:center; }
.event-list-row { position:relative; display:flex; align-items:center; gap:9px; width:calc(100% - 14px); min-height:48px; margin:5px 7px; padding:5px 9px; text-align:left; border:1px solid #45424a; border-radius:4px; background:#30313a; color:#ececf2; cursor:pointer; }
.event-list-row:hover { background:#3a3940; border-color:#b99a4a; }
.event-list-row.chosen { border-color:#f3c34e; background:#433a27; box-shadow:0 0 0 1px #f3c34e55; }
.event-list-row.disabled { opacity:.55; }
.event-row-icon { display:grid; place-items:center; width:25px; height:25px; flex:none; border-radius:4px; background:#45402f; color:#f3c34e; font-size:16px; }
.event-row-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
.event-row-copy strong { font-size:11px; font-weight:600; }
.event-row-copy small { overflow:hidden; color:#9ea6b5; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
.event-row-port { position:absolute; right:-6px; top:50%; width:11px; height:11px; transform:translateY(-50%); border:2px solid #252934; border-radius:50%; background:#f3c34e; box-shadow:0 0 7px #f3c34e88; }
.event-list-empty { padding:16px 10px; color:#9ea6b5; font-size:11px; }
.graph-node.condition { border-color:#9a6cf0; border-top:3px solid #9a6cf0; }
.graph-node.action { border-color:#e86659; border-top:3px solid #e86659; }
.graph-node.condition .node-port { background:#a27aff; }
.graph-node.action .node-port { background:#f07868; }
.graph-wires path.trigger-condition { stroke:#f3b94b; color:#f3b94b; }
.graph-wires path.condition-action { stroke:#e56b60; color:#e56b60; }

</style>
