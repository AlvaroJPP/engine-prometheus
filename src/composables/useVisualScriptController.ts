import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getBehaviorPackageDefinition } from '@engine'
import type {
  BehaviorPackageInstance,
  ControlMapProfile,
  LogicRule,
  ObjectInfo,
  ToolMode,
  TransformMode,
} from '@engine'

interface UseVisualScriptControllerOptions {
  executionMode: Ref<'edit' | 'running'>
  controlMapsOpen: Ref<boolean>
  activeControlMap: ComputedRef<ControlMapProfile>
  objects: Ref<ObjectInfo[]>
  selectedId: Ref<string | null>
  logicRules: Ref<LogicRule[]>
  behaviorPackages: Ref<BehaviorPackageInstance[]>
  globalLogicVariables: Ref<Record<string, boolean | number | string>>
  logicVariables: Ref<Record<string, boolean | number | string>>
  toggleFirstPerson: () => void
  cycleCameraView: () => void
  returnToEdit: () => void
  updateLogicRule: (rule: LogicRule) => void
}

export function useVisualScriptController({
  executionMode,
  controlMapsOpen,
  activeControlMap,
  objects,
  selectedId,
  logicRules,
  behaviorPackages,
  globalLogicVariables,
  logicVariables,
  toggleFirstPerson,
  cycleCameraView,
  returnToEdit,
  updateLogicRule,
}: UseVisualScriptControllerOptions) {
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
function onRuntimeCameraKeydown(event: KeyboardEvent) {
  if (event.repeat || executionMode.value !== 'running' || controlMapsOpen.value) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
  const bindings = activeControlMap.value.bindings

  if (event.code === bindings.toggleFirstPerson) {
    event.preventDefault()
    toggleFirstPerson()
    return
  }
  if (event.code === bindings.cycleCamera) {
    event.preventDefault()
    cycleCameraView()
    return
  }
  if (event.code === bindings.exitRuntime) {
    event.preventDefault()
    returnToEdit()
  }
}

onMounted(() => {
  graphPortObserver = new ResizeObserver(measureGraphPorts)
  if (graphViewport.value) graphPortObserver.observe(graphViewport.value)
  if (graphStage.value) graphPortObserver.observe(graphStage.value)
  window.addEventListener('keydown', onRuntimeCameraKeydown)
  measureGraphPorts()
})
watch(graphOpen, async (open) => {
  if (!open) return
  await nextTick()
  if (graphViewport.value) graphPortObserver?.observe(graphViewport.value)
  if (graphStage.value) graphPortObserver?.observe(graphStage.value)
  measureGraphPorts()
})
onUpdated(measureGraphPorts)
onBeforeUnmount(() => {
  graphPortObserver?.disconnect()
  window.removeEventListener('keydown', onRuntimeCameraKeydown)
})
const graphObjectFilter = ref<'selected' | 'all'>('all')
const graphObjectSearch = ref('')
function ownerOfRule(rule: LogicRule): string | undefined {
  return rule.ownerObjectId ??
    (rule.trigger.type === 'object_clicked' || rule.trigger.type === 'package_event'
      ? rule.trigger.objectId
      : (rule.actions.find(action => 'objectId' in action) as Extract<LogicRule['actions'][number], { objectId: string }> | undefined)?.objectId)
}
const graphVisibleRules = computed(() => {
  if (graphObjectFilter.value === 'all' || !objects.value.some(object => object.id === selectedId.value)) return logicRules.value
  return logicRules.value.filter(rule => ownerOfRule(rule) === selectedId.value)
})
// No modo "Todos os objetos", cada objeto ganha seu próprio grupo visual no grafo.
const graphObjectGroups = computed(() => {
  if (graphObjectFilter.value !== 'all') return []
  return objects.value.map((object, index) => {
    const rules = logicRules.value.filter(rule => ownerOfRule(rule) === object.id)
    return {
      object,
      rules,
      index,
      top: 35 + index * Math.max(220, 145 + rules.length * 170),
      height: Math.max(190, 125 + rules.length * 170),
    }
  })
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
  // Qualquer posição salva é válida: o usuário pode organizar os nós livremente,
  // inclusive em colunas ou em alturas diferentes.
  return rule.graphLayout ?? defaultGraphLayout(index)
}
const graphNodes = computed(() => {
  if (graphObjectFilter.value === 'all') {
    return graphObjectGroups.value.flatMap(group => group.rules.flatMap((rule, index) => {
      const defaults = {
        trigger: { x: 70, y: group.top + 48 + index * 170 },
        condition: { x: 430, y: group.top + 48 + index * 170 },
        action: { x: 790, y: group.top + 48 + index * 170 },
      }
      const layout = rule.graphLayout ?? defaults
      return (['condition', 'action'] as const).map(part => ({
        rule, part, x: layout[part].x, y: layout[part].y,
      }))
    }))
  }
  return graphVisibleRules.value.flatMap((rule, index) => {
    const layout = layoutForGraph(rule, index)
    return (['condition', 'action'] as const).map(part => ({ rule, part, x: layout[part].x, y: layout[part].y }))
  })
})
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
watch([graphNodes, graphVisibleRules, graphZoom, graphPan], measureGraphPorts, { deep: true })
const selectedGraphRule = computed(() => logicRules.value.find(rule => rule.id === graphSelection.value?.ruleId) ?? null)
const selectedGraphRuleOwnerObjectId = computed(() => {
  const rule = selectedGraphRule.value
  if (!rule) return null
  if (rule.ownerObjectId) return rule.ownerObjectId
  if (rule.trigger.type === 'object_clicked' || rule.trigger.type === 'package_event') return rule.trigger.objectId
  return selectedId.value
})
const selectedGraphRulePackages = computed(() =>
  behaviorPackages.value.filter(instance => instance.ownerObjectId === selectedGraphRuleOwnerObjectId.value),
)
const selectedGraphRuleActionPackageDefinition = computed(() => {
  const action = selectedGraphRule.value?.actions[0]
  return action?.type === 'set_package_variable' ? getBehaviorPackageDefinition(action.packageId) : undefined
})
const selectedGraphRuleActionVariables = computed(() =>
  selectedGraphRuleActionPackageDefinition.value?.variables.filter(variable => !variable.readOnly) ?? [],
)
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
  if (part === 'trigger') {
    if (rule.trigger.type === 'object_clicked') return 'Quando clicar no objeto'
    if (rule.trigger.type === 'key_pressed') return `Ao pressionar ${rule.trigger.key}`
    if (rule.trigger.type === 'package_event') return `Pacote: ${rule.trigger.eventId}`
    return 'Ao entrar na área'
  }
  if (part === 'condition') {
    if (!rule.conditions.length) return 'Sem condição'
    return rule.conditions.map(c => {
      const operator = c.operator === 'not_equals' ? '≠' : c.operator === 'greater_than' ? '>' : c.operator === 'less_than' ? '<' : '='
      return `${c.name} ${operator} ${String(c.value)}`
    }).join(' E ')
  }
  const action = rule.actions[0]; if (!action) return 'Sem ação'
  if (action.type === 'javascript' || action.type === 'script') {
    const firstLine = action.code.split(String.fromCharCode(10)).map(line => line.trim()).find(Boolean)
    return firstLine ? (firstLine.length > 42 ? firstLine.slice(0, 39) + '…' : firstLine) : 'Script vazio — clique para editar'
  }
  return action.type === 'rotate'
    ? `Girar ${action.degrees}°`
    : action.type === 'move'
      ? `Mover para X ${action.x ?? 0}`
      : action.type === 'set_visible'
        ? (action.visible ? 'Mostrar objeto' : 'Ocultar objeto')
        : action.type === 'set_variable'
          ? `Definir ${action.name} = ${String(action.value)}`
          : action.type === 'set_package_variable'
            ? `Pacote ${action.packageId}: ${action.name} = ${String(action.value)}`
            : 'Executar ação'
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

function changeGraphRulePackage(packageId: string) {
  const rule = selectedGraphRule.value
  if (!rule || rule.trigger.type !== 'package_event') return
  const definition = getBehaviorPackageDefinition(packageId)
  patchSelectedTrigger({ packageId, eventId: definition?.triggers[0]?.id ?? 'interact' })
}

function changeGraphRuleActionPackage(packageId: string) {
  const rule = selectedGraphRule.value
  const action = rule?.actions[0]
  if (!rule || action?.type !== 'set_package_variable') return
  const definition = getBehaviorPackageDefinition(packageId)
  const variable = definition?.variables.find(item => !item.readOnly)
  patchSelectedAction({ packageId, name: variable?.name ?? '', value: variable?.defaultValue ?? false })
}
function patchSelectedCondition(patch: Record<string, unknown>) {
  const rule = selectedGraphRule.value
  if (!rule) return
  const current = rule.conditions[0] ?? { type: 'variable' as const, name: 'has_key', operator: 'equals' as const, value: true }
  updateLogicRule({ ...rule, conditions: [{ ...current, ...patch } as LogicRule['conditions'][number], ...rule.conditions.slice(1)] })
}
function setSelectedTriggerType(type: 'object_clicked' | 'enter_area' | 'key_pressed' | 'package_event') {
  const rule = selectedGraphRule.value
  if (!rule) return
  const ownerId = rule.ownerObjectId ??
    (rule.trigger.type === 'object_clicked' || rule.trigger.type === 'package_event'
      ? rule.trigger.objectId
      : selectedId.value ?? objects.value[0]?.id ?? '')

  let trigger: LogicRule['trigger']
  if (type === 'object_clicked') {
    const currentObjectId = rule.trigger.type === 'object_clicked' ? rule.trigger.objectId : ownerId
    trigger = {
      type,
      objectId: objects.value.find(object => object.id === currentObjectId)?.id ?? objects.value[0]?.id ?? '',
    }
  } else if (type === 'key_pressed') {
    trigger = { type, key: rule.trigger.type === 'key_pressed' ? rule.trigger.key : 'KeyE' }
  } else if (type === 'package_event') {
    const previousPackageId = rule.trigger.type === 'package_event' ? rule.trigger.packageId : undefined
    const instance = selectedGraphRulePackages.value.find(item => item.packageId === previousPackageId)
      ?? selectedGraphRulePackages.value[0]
    const packageId = instance?.packageId ?? previousPackageId ?? 'mount'
    const definition = getBehaviorPackageDefinition(packageId)
    trigger = {
      type,
      objectId: ownerId,
      packageId,
      eventId: rule.trigger.type === 'package_event'
        ? rule.trigger.eventId
        : definition?.triggers[0]?.id ?? 'interact',
    }
  } else {
    trigger = {
      type,
      center: rule.trigger.type === 'enter_area' ? [...rule.trigger.center] as [number, number, number] : [0, 1, 0],
      radius: rule.trigger.type === 'enter_area' ? rule.trigger.radius : 2,
    }
  }
  updateLogicRule({ ...rule, trigger })
}

function setSelectedActionType(type: 'move' | 'rotate' | 'set_visible' | 'set_variable' | 'set_package_variable' | 'script' | 'javascript') {
  const rule = selectedGraphRule.value
  if (!rule) return
  const old = rule.actions[0]
  const target = rule.ownerObjectId ??
    (old && 'objectId' in old ? old.objectId : undefined) ??
    selectedId.value ??
    objects.value[0]?.id ??
    ''
  const previousPackageAction = old?.type === 'set_package_variable' ? old : undefined
  const packageInstance = selectedGraphRulePackages.value.find(instance => instance.packageId === previousPackageAction?.packageId)
    ?? selectedGraphRulePackages.value.find(instance => instance.enabled)
    ?? selectedGraphRulePackages.value[0]
  const packageId = previousPackageAction?.packageId ?? packageInstance?.packageId ?? 'mount'
  const packageDefinition = getBehaviorPackageDefinition(packageId)
  const variableName = previousPackageAction?.name
    ?? packageDefinition?.variables.find(variable => !variable.readOnly)?.name
    ?? 'speed'

  const action: LogicRule['actions'][number] = type === 'move'
    ? { type, objectId: target, x: 2, y: 0, z: 0 }
    : type === 'rotate'
      ? { type, objectId: target, degrees: 45 }
      : type === 'set_visible'
        ? { type, objectId: target, visible: false }
        : type === 'set_variable'
          ? { type, name: 'has_key', value: true }
          : type === 'set_package_variable'
            ? { type, objectId: target, packageId, name: variableName, value: previousPackageAction?.value ?? 4.2 }
            : type === 'javascript'
              ? { type, code: "api.set('has_key', true)\napi.set('score', 0)\napi.add('score', 1)\n// api.move('{ID_OBJECT}', 2, 0, 1)" }
              : { type, code: 'set has_key = true\nset score = 0\nadd score 1' }
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
  { id: 'grass', icon: '♧', label: 'Pintar grama' },
]

const TRANSFORMS: Array<{ id: TransformMode; icon: string; label: string }> = [
  { id: 'move', icon: '↔', label: 'Mover' },
  { id: 'rotate', icon: '↻', label: 'Rotacionar' },
  { id: 'scale', icon: '⤢', label: 'Escalar' },
]


  return {
    TOOLS,
    TRANSFORMS,
    changeGraphRuleActionPackage,
    changeGraphRulePackage,
    dragCanvas,
    endNodeDrag,
    globalConditionVariables,
    graphEdges,
    graphNodes,
    graphObjectFilter,
    graphObjectGroups,
    graphObjectSearch,
    graphOpen,
    graphPan,
    graphSelection,
    graphStage,
    graphViewport,
    graphVisibleRules,
    graphZoom,
    moveNode,
    nodeTitle,
    onGraphWheel,
    onScriptDraftInput,
    ownerOfRule,
    patchSelectedAction,
    patchSelectedCondition,
    patchSelectedTrigger,
    portPositions,
    resetGraphView,
    ruleValueFromInput,
    scriptDraft,
    selectedGraphRule,
    selectedGraphRuleActionVariables,
    selectedGraphRulePackages,
    selectedGraphRuleOwnerObjectId,
    setSelectedActionType,
    setSelectedTriggerType,
    startGraphPan,
    startNodeDrag,
    zoomGraph,
  }
}
