<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createUIScreen,
  createUIElement,
  createUIScreenId,
  createUIScreenFromPreset,
  UI_SCREEN_PRESETS,
  UIWorkspaceHistory,
  alignUIElement,
  alignUIElements,
  distributeUIElements,
  duplicateUIElement,
  getClampedUIElementPosition,
  getResizedUIElementRect,
  getUIElementIdsInRect,
  getUIElementsBounds,
  reorderUIElement,
  resizeUIElements,
  type UIElementDefinition,
  type UIElementRect,
  type UIElementAxis,
  type UIElementKind,
  type UIElementGroupAlignment,
  type UIScreenPresetId,
  type UIWorkspaceSnapshot,
} from '@engine'
import { uiWorkspaceState } from '@/lib/ui/uiWorkspaceState'

defineProps<{ projectName?: string }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const selectedElementId = ref('')
const selectedElementIds = ref<string[]>([])
const previewMode = ref(false)
const showGrid = ref(true)
const snapToGrid = ref(true)
const statusMessage = ref('As alterações são incluídas ao salvar o projeto.')
const canvasStage = ref<HTMLElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const imageTargetId = ref('')
type UIResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const dragState = ref<{
  startX: number
  startY: number
  width: number
  height: number
  origins: Array<{ id: string; x: number; y: number; width: number; height: number }>
} | null>(null)
const marqueeSelection = ref<{
  startX: number
  startY: number
  endX: number
  endY: number
  additive: boolean
  originalIds: string[]
} | null>(null)
const selectionResize = ref<{
  handle: UIResizeHandle
  startX: number
  startY: number
  stageWidth: number
  stageHeight: number
  originBounds: UIElementRect
  elementIds: string[]
  originalElements: UIElementDefinition[]
} | null>(null)
const clipboardElement = ref<UIElementDefinition[] | null>(null)
const canUndo = ref(false)
const canRedo = ref(false)
const editHistory = new UIWorkspaceHistory(40)
let historyReady = false
let restoringHistory = false
let historyTimer: ReturnType<typeof setTimeout> | null = null

function workspaceSnapshot(): UIWorkspaceSnapshot {
  return {
    screens: JSON.parse(JSON.stringify(uiWorkspaceState.screens)) as typeof uiWorkspaceState.screens,
    activeScreenId: uiWorkspaceState.activeScreenId,
  }
}

function refreshHistoryAvailability(): void {
  canUndo.value = editHistory.canUndo
  canRedo.value = editHistory.canRedo
}

function captureHistoryNow(): void {
  const hadPendingCapture = historyTimer !== null
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = null
  if (!historyReady || restoringHistory || !hadPendingCapture) return
  editHistory.record(workspaceSnapshot())
  refreshHistoryAvailability()
}

function scheduleHistoryCapture(): void {
  if (!historyReady || restoringHistory) return
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(captureHistoryNow, 300)
}

function restoreWorkspaceSnapshot(snapshot: UIWorkspaceSnapshot): void {
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = null
  restoringHistory = true
  uiWorkspaceState.screens = JSON.parse(JSON.stringify(snapshot.screens)) as typeof uiWorkspaceState.screens
  uiWorkspaceState.activeScreenId = uiWorkspaceState.screens.some(screen => screen.id === snapshot.activeScreenId)
    ? snapshot.activeScreenId
    : uiWorkspaceState.screens[0]?.id ?? ''
  clearSelection()
  finishElementDrag()
  cancelCanvasSelection()
  finishSelectionResize()
  refreshHistoryAvailability()
  void nextTick(() => {
    restoringHistory = false
  })
}

function undoWorkspace(): void {
  captureHistoryNow()
  const snapshot = editHistory.undo()
  if (!snapshot) return
  restoreWorkspaceSnapshot(snapshot)
  statusMessage.value = 'Última alteração desfeita.'
}

function redoWorkspace(): void {
  captureHistoryNow()
  const snapshot = editHistory.redo()
  if (!snapshot) return
  restoreWorkspaceSnapshot(snapshot)
  statusMessage.value = 'Alteração refeita.'
}

const activeScreen = computed(() =>
  uiWorkspaceState.screens.find(screen => screen.id === uiWorkspaceState.activeScreenId) ?? null,
)
const selectedElement = computed(() =>
  activeScreen.value?.elements.find(element => element.id === selectedElementId.value) ?? null,
)
const selectedElements = computed(() => {
  const ids = new Set(selectedElementIds.value)
  return activeScreen.value?.elements.filter(element => ids.has(element.id)) ?? []
})
const selectionGroupId = computed(() => {
  const elements = selectedElements.value
  const groupId = elements[0]?.groupId
  return elements.length > 1 && groupId && elements.every(element => element.groupId === groupId) ? groupId : ''
})
const activeElementIndex = computed(() =>
  activeScreen.value?.elements.findIndex(element => element.id === selectedElementId.value) ?? -1,
)
const selectionBounds = computed<UIElementRect | null>(() => getUIElementsBounds(selectedElements.value))
const selectionFrameStyle = computed(() => {
  const bounds = selectionBounds.value
  return bounds ? {
    left: `${bounds.x}%`,
    top: `${bounds.y}%`,
    width: `${bounds.width}%`,
    height: `${bounds.height}%`,
  } : {}
})
const marqueeStyle = computed(() => {
  const rect = marqueeSelection.value
  if (!rect) return {}
  return {
    left: `${Math.min(rect.startX, rect.endX)}%`,
    top: `${Math.min(rect.startY, rect.endY)}%`,
    width: `${Math.abs(rect.endX - rect.startX)}%`,
    height: `${Math.abs(rect.endY - rect.startY)}%`,
  }
})

function clampPercent(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function pointerPercentPosition(event: PointerEvent): { x: number; y: number } | null {
  const bounds = canvasStage.value?.getBoundingClientRect()
  if (!bounds || !bounds.width || !bounds.height) return null
  return {
    x: clampPercent((event.clientX - bounds.left) / bounds.width * 100),
    y: clampPercent((event.clientY - bounds.top) / bounds.height * 100),
  }
}

function setSelection(ids: string[], primaryId = ''): void {
  const screen = activeScreen.value
  const requested = new Set(ids)
  selectedElementIds.value = screen?.elements.filter(element => requested.has(element.id)).map(element => element.id) ?? []
  selectedElementId.value = primaryId && selectedElementIds.value.includes(primaryId)
    ? primaryId
    : selectedElementIds.value.at(-1) ?? ''
}

function clearSelection(): void {
  setSelection([], '')
}

function elementSelectionIds(id: string): string[] {
  const screen = activeScreen.value
  const element = screen?.elements.find(item => item.id === id)
  if (!screen || !element?.groupId) return [id]
  return screen.elements.filter(item => item.groupId === element.groupId).map(item => item.id)
}

function beginCanvasSelection(event: PointerEvent): void {
  if (previewMode.value || event.button !== 0 || event.target !== canvasStage.value) return
  const point = pointerPercentPosition(event)
  if (!point) return
  event.preventDefault()
  const additive = event.shiftKey || event.ctrlKey || event.metaKey
  marqueeSelection.value = {
    startX: point.x,
    startY: point.y,
    endX: point.x,
    endY: point.y,
    additive,
    originalIds: additive ? [...selectedElementIds.value] : [],
  }
  window.addEventListener('pointermove', moveCanvasSelection)
  window.addEventListener('pointerup', finishCanvasSelection)
  window.addEventListener('pointercancel', finishCanvasSelection)
}

function moveCanvasSelection(event: PointerEvent): void {
  const selection = marqueeSelection.value
  const point = pointerPercentPosition(event)
  if (!selection || !point) return
  selection.endX = point.x
  selection.endY = point.y
}

function detachCanvasSelectionListeners(): void {
  window.removeEventListener('pointermove', moveCanvasSelection)
  window.removeEventListener('pointerup', finishCanvasSelection)
  window.removeEventListener('pointercancel', finishCanvasSelection)
}

function cancelCanvasSelection(): void {
  detachCanvasSelectionListeners()
  marqueeSelection.value = null
}

function finishCanvasSelection(): void {
  const selection = marqueeSelection.value
  detachCanvasSelectionListeners()
  marqueeSelection.value = null
  const screen = activeScreen.value
  if (!selection || !screen) return

  const left = Math.min(selection.startX, selection.endX)
  const right = Math.max(selection.startX, selection.endX)
  const top = Math.min(selection.startY, selection.endY)
  const bottom = Math.max(selection.startY, selection.endY)
  const hasArea = right - left > 0.15 || bottom - top > 0.15
  const hits = hasArea ? getUIElementIdsInRect(screen.elements, {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }) : []
  const hitIds = new Set(hits)
  for (const id of hits) {
    const hit = screen.elements.find(element => element.id === id)
    if (!hit?.groupId) continue
    for (const member of screen.elements) {
      if (member.groupId === hit.groupId) hitIds.add(member.id)
    }
  }
  const requestedIds = new Set([...(selection.additive ? selection.originalIds : []), ...hitIds])
  const nextIds = screen.elements.filter(element => requestedIds.has(element.id)).map(element => element.id)
  setSelection(nextIds, hits.at(-1) ?? nextIds.at(-1) ?? '')
}

function beginSelectionResize(event: PointerEvent, handle: UIResizeHandle): void {
  if (previewMode.value || event.button !== 0) return
  const screen = activeScreen.value
  const bounds = canvasStage.value?.getBoundingClientRect()
  const originBounds = selectionBounds.value
  if (!screen || !bounds || !bounds.width || !bounds.height || !originBounds) return
  event.preventDefault()
  event.stopPropagation()
  selectionResize.value = {
    handle,
    startX: event.clientX,
    startY: event.clientY,
    stageWidth: bounds.width,
    stageHeight: bounds.height,
    originBounds: { ...originBounds },
    elementIds: [...selectedElementIds.value],
    originalElements: screen.elements.map(element => ({ ...element })),
  }
  window.addEventListener('pointermove', moveSelectionResize)
  window.addEventListener('pointerup', finishSelectionResize)
  window.addEventListener('pointercancel', finishSelectionResize)
}

function moveSelectionResize(event: PointerEvent): void {
  const resize = selectionResize.value
  const screen = activeScreen.value
  if (!resize || !screen) return

  const dx = (event.clientX - resize.startX) / resize.stageWidth * 100
  const dy = (event.clientY - resize.startY) / resize.stageHeight * 100
  const targetBounds = getResizedUIElementRect(
    resize.originBounds,
    resize.handle,
    dx,
    dy,
    {
      snapToGrid: snapToGrid.value,
      gridSize: 2.5,
      preserveAspectRatio: event.shiftKey,
    },
  )
  const resized = resizeUIElements(
    resize.originalElements,
    resize.elementIds,
    resize.originBounds,
    targetBounds,
  )
  const resizedById = new Map(resized.map(element => [element.id, element]))
  const ids = new Set(resize.elementIds)
  for (const element of screen.elements) {
    if (!ids.has(element.id)) continue
    const next = resizedById.get(element.id)
    if (next) Object.assign(element, { x: next.x, y: next.y, width: next.width, height: next.height })
  }
}

function finishSelectionResize(): void {
  selectionResize.value = null
  window.removeEventListener('pointermove', moveSelectionResize)
  window.removeEventListener('pointerup', finishSelectionResize)
  window.removeEventListener('pointercancel', finishSelectionResize)
}

function selectElement(id: string, extend = false): void {
  if (previewMode.value) return
  const members = elementSelectionIds(id)
  if (!extend) {
    setSelection(members, id)
    return
  }
  const next = new Set(selectedElementIds.value)
  if (members.every(memberId => next.has(memberId))) members.forEach(memberId => next.delete(memberId))
  else members.forEach(memberId => next.add(memberId))
  const nextIds = [...next]
  setSelection(nextIds, next.has(id) ? id : nextIds.at(-1) ?? '')
}

function cloneElementsWithFreshIds(sources: readonly UIElementDefinition[], startCount: number): UIElementDefinition[] {
  const nextGroupIds = new Map<string, string>()
  return sources.map((source, index) => {
    const copy = duplicateUIElement(source, startCount + index)
    copy.name = (source.name + ' - cópia').slice(0, 80)
    if (source.groupId) {
      if (!nextGroupIds.has(source.groupId)) nextGroupIds.set(source.groupId, createUIScreenId('group'))
      copy.groupId = nextGroupIds.get(source.groupId)
    }
    return copy
  })
}

function copyElement(): void {
  const sources = selectedElements.value.length
    ? selectedElements.value
    : selectedElement.value ? [selectedElement.value] : []
  if (!sources.length) return
  clipboardElement.value = JSON.parse(JSON.stringify(sources)) as UIElementDefinition[]
  statusMessage.value = sources.length > 1
    ? sources.length + ' elementos copiados. Troque de tela e use Colar para reutilizá-los.'
    : 'Elemento copiado. Troque de tela e use Colar para reutilizá-lo.'
}

function pasteElement(): void {
  const screen = activeScreen.value
  const sources = clipboardElement.value
  if (!screen || !sources?.length || previewMode.value) return
  const pasted = cloneElementsWithFreshIds(sources, screen.elements.length)
  screen.elements.push(...pasted)
  setSelection(pasted.map(element => element.id), pasted[0]?.id ?? '')
  statusMessage.value = pasted.length > 1
    ? pasted.length + ' elementos colados em "' + screen.name + '".'
    : 'Elemento colado em "' + screen.name + '".'
}

watch(() => uiWorkspaceState.activeScreenId, () => {
  finishElementDrag()
  cancelCanvasSelection()
  finishSelectionResize()
  clearSelection()
}, { flush: 'sync' })

watch(() => uiWorkspaceState.screens, scheduleHistoryCapture, { deep: true, flush: 'post' })

function createScreen(): void {
  const screen = createUIScreen(`Tela ${uiWorkspaceState.screens.length + 1}`)
  uiWorkspaceState.screens.push(screen)
  uiWorkspaceState.activeScreenId = screen.id
  clearSelection()
  statusMessage.value = 'Tela criada. Configure os elementos e marque “Ativa no jogo” quando quiser exibi-la.'
}

function addPreset(presetId: UIScreenPresetId): void {
  const screen = createUIScreenFromPreset(presetId)
  uiWorkspaceState.screens.push(screen)
  uiWorkspaceState.activeScreenId = screen.id
  clearSelection()
  previewMode.value = false
  statusMessage.value = 'Modelo "' + screen.name + '" adicionado. Revise os elementos e ative a tela no jogo quando estiver pronta.'
}

function duplicateScreen(): void {
  const source = activeScreen.value
  if (!source) return
  const screen = JSON.parse(JSON.stringify(source)) as typeof source
  screen.id = createUIScreenId('screen')
  screen.name = (source.name + ' - cópia').slice(0, 80)
  for (const element of screen.elements) element.id = createUIScreenId('element')
  uiWorkspaceState.screens.push(screen)
  uiWorkspaceState.activeScreenId = screen.id
  statusMessage.value = 'Cópia da tela criada.'
}

function deleteScreen(): void {
  const screen = activeScreen.value
  if (!screen) return
  const index = uiWorkspaceState.screens.findIndex(item => item.id === screen.id)
  uiWorkspaceState.screens.splice(index, 1)
  uiWorkspaceState.activeScreenId = uiWorkspaceState.screens[Math.max(0, index - 1)]?.id ?? uiWorkspaceState.screens[0]?.id ?? ''
  clearSelection()
  statusMessage.value = 'Tela removida. Salve o projeto para registrar a alteração.'
}

function addElement(kind: UIElementKind): void {
  const screen = activeScreen.value
  if (!screen) {
    createScreen()
  }
  const target = activeScreen.value
  if (!target) return
  const element = createUIElement(kind, target.elements.length)
  target.elements.push(element)
  setSelection([element.id], element.id)
  previewMode.value = false
  statusMessage.value = `${element.name} adicionado à tela.`
}

function duplicateElement(): void {
  const screen = activeScreen.value
  const sources = selectedElements.value
  if (!screen || !sources.length) return
  const copies = cloneElementsWithFreshIds(sources, screen.elements.length)
  screen.elements.push(...copies)
  setSelection(copies.map(element => element.id), copies[0]?.id ?? '')
  statusMessage.value = copies.length > 1
    ? copies.length + ' elementos duplicados.'
    : 'Elemento "' + sources[0].name + '" duplicado.'
}

function groupSelectedElements(): void {
  const screen = activeScreen.value
  const ids = new Set(selectedElements.value.map(element => element.id))
  if (!screen || ids.size < 2) return
  const groupId = createUIScreenId('group')
  for (const element of screen.elements) {
    if (ids.has(element.id)) element.groupId = groupId
  }
  setSelection([...ids], selectedElementId.value)
  statusMessage.value = ids.size + ' elementos agrupados. Arraste qualquer membro para mover o grupo.'
}

function ungroupSelectedElements(): void {
  const screen = activeScreen.value
  const groupId = selectionGroupId.value
  if (!screen || !groupId) return
  const members = screen.elements.filter(element => element.groupId === groupId)
  for (const element of members) delete element.groupId
  setSelection(members.map(element => element.id), selectedElementId.value)
  statusMessage.value = members.length + ' elementos desagrupados.'
}



function moveSelectedLayer(direction: 'front' | 'back'): void {
  const screen = activeScreen.value
  if (!screen || !selectedElementId.value) return
  const reordered = reorderUIElement(screen.elements, selectedElementId.value, direction === 'front' ? 1 : -1)
  if (reordered === screen.elements) return
  screen.elements.splice(0, screen.elements.length, ...reordered)
  statusMessage.value = direction === 'front' ? 'Elemento trazido para frente.' : 'Elemento enviado para trás.'
}

function alignSelected(axis: 'horizontal' | 'vertical'): void {
  const element = selectedElement.value
  if (!element) return
  Object.assign(element, alignUIElement(element, axis))
  statusMessage.value = axis === 'horizontal' ? 'Elemento centralizado no eixo X da tela.' : 'Elemento centralizado no eixo Y da tela.'
}

function alignSelectedGroup(alignment: UIElementGroupAlignment): void {
  const screen = activeScreen.value
  if (!screen || selectedElements.value.length < 2) return
  const aligned = alignUIElements(screen.elements, selectedElementIds.value, alignment)
  screen.elements.splice(0, screen.elements.length, ...aligned)
  const labels: Record<UIElementGroupAlignment, string> = {
    left: 'à esquerda',
    right: 'à direita',
    top: 'ao topo',
    bottom: 'à base',
    'horizontal-center': 'ao centro horizontal',
    'vertical-center': 'ao centro vertical',
  }
  statusMessage.value = selectedElements.value.length + ' elementos alinhados ' + labels[alignment] + '.'
}

function distributeSelectedGroup(axis: UIElementAxis): void {
  const screen = activeScreen.value
  if (!screen || selectedElements.value.length < 3) return
  const distributed = distributeUIElements(screen.elements, selectedElementIds.value, axis)
  if (distributed === screen.elements) {
    statusMessage.value = 'Não há espaço suficiente para distribuir os elementos sem sobreposição.'
    return
  }
  screen.elements.splice(0, screen.elements.length, ...distributed)
  statusMessage.value = selectedElements.value.length +
    (axis === 'horizontal' ? ' elementos distribuídos horizontalmente.' : ' elementos distribuídos verticalmente.')
}

function applySelectionBoundsField(field: keyof UIElementRect, event: Event): void {
  const screen = activeScreen.value
  const bounds = selectionBounds.value
  const input = event.target as HTMLInputElement | null
  if (!screen || !bounds || selectedElements.value.length < 2 || !input) return
  const parsed = Number(input.value)
  if (!Number.isFinite(parsed)) {
    input.value = String(bounds[field])
    return
  }

  const target: UIElementRect = { ...bounds }
  switch (field) {
    case 'x':
      target.x = clampPercent(parsed, 0, 100 - bounds.width)
      break
    case 'y':
      target.y = clampPercent(parsed, 0, 100 - bounds.height)
      break
    case 'width':
      target.width = clampPercent(parsed, 1, 100 - bounds.x)
      break
    case 'height':
      target.height = clampPercent(parsed, 1, 100 - bounds.y)
      break
  }
  target.x = Number(target.x.toFixed(2))
  target.y = Number(target.y.toFixed(2))
  target.width = Number(target.width.toFixed(2))
  target.height = Number(target.height.toFixed(2))

  const transformed = resizeUIElements(screen.elements, selectedElementIds.value, bounds, target)
  screen.elements.splice(0, screen.elements.length, ...transformed)
  statusMessage.value = 'Transformação numérica aplicada à seleção de ' + selectedElements.value.length + ' elementos.'
}

function moveSelectedBy(dx: number, dy: number): void {
  const elements = selectedElements.value
  if (!elements.length) return
  const minX = Math.min(...elements.map(element => element.x))
  const minY = Math.min(...elements.map(element => element.y))
  const maxX = Math.max(...elements.map(element => element.x + element.width))
  const maxY = Math.max(...elements.map(element => element.y + element.height))
  const safeDx = Math.max(-minX, Math.min(100 - maxX, dx))
  const safeDy = Math.max(-minY, Math.min(100 - maxY, dy))
  for (const element of elements) {
    element.x = Number((element.x + safeDx).toFixed(2))
    element.y = Number((element.y + safeDy).toFixed(2))
  }
}



function handleKeyboardShortcut(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )) return

  const key = event.key.toLowerCase()
  const modifier = event.ctrlKey || event.metaKey

  if (modifier && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoWorkspace()
    else undoWorkspace()
    return
  }
  if (modifier && key === 'y') {
    event.preventDefault()
    redoWorkspace()
    return
  }
  if (modifier && key === 'c' && selectedElements.value.length && !previewMode.value) {
    event.preventDefault()
    copyElement()
    return
  }
  if (modifier && key === 'v' && clipboardElement.value?.length && activeScreen.value && !previewMode.value) {
    event.preventDefault()
    pasteElement()
    return
  }
  if (modifier && key === 'd') {
    if (!previewMode.value && selectedElement.value) {
      event.preventDefault()
      duplicateElement()
    }
    return
  }
  if (event.key === 'Escape') {
    if (previewMode.value) previewMode.value = false
    else clearSelection()
    return
  }
  if (previewMode.value) return

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedElement.value) {
      event.preventDefault()
      removeElement()
    }
    return
  }

  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const direction = directions[event.key]
  if (!direction || !selectedElement.value) return
  event.preventDefault()
  const step = event.shiftKey ? 5 : snapToGrid.value ? 2.5 : 1
  moveSelectedBy(direction[0] * step, direction[1] * step)
}

function removeElement(id?: string): void {
  const screen = activeScreen.value
  if (!screen) return
  const ids = new Set(id ? [id] : selectedElementIds.value.length ? selectedElementIds.value : selectedElementId.value ? [selectedElementId.value] : [])
  if (!ids.size) return
  const removed = screen.elements.filter(element => ids.has(element.id)).length
  if (!removed) return
  screen.elements.splice(0, screen.elements.length, ...screen.elements.filter(element => !ids.has(element.id)))
  clearSelection()
  statusMessage.value = removed > 1 ? removed + ' elementos removidos.' : 'Elemento removido.'
}



function elementStyle(element: UIElementDefinition): Record<string, string> {
  return {
    left: `${element.x}%`,
    top: `${element.y}%`,
    width: `${element.width}%`,
    height: `${element.height}%`,
    color: element.color,
    backgroundColor: element.kind === 'text' || element.kind === 'image' && element.imageDataUrl
      ? (element.kind === 'text' ? 'transparent' : element.background)
      : element.background,
    fontSize: `${(element.fontSize / 1280 * 100).toFixed(3)}cqw`,
    fontWeight: String(element.fontWeight),
    textAlign: element.textAlign,
    justifyContent: element.textAlign === 'left' ? 'flex-start' : element.textAlign === 'right' ? 'flex-end' : 'center',
    opacity: String(element.opacity),
    borderRadius: `${element.borderRadius}px`,
  }
}

function beginElementDrag(event: PointerEvent, element: UIElementDefinition): void {
  if (previewMode.value || event.button !== 0 || !activeScreen.value) return
  const stage = canvasStage.value
  if (!stage) return
  const bounds = stage.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  event.preventDefault()
  event.stopPropagation()

  const extendSelection = event.shiftKey || event.ctrlKey || event.metaKey
  if (extendSelection) {
    selectElement(element.id, true)
    return
  }
  if (!selectedElementIds.value.includes(element.id)) selectElement(element.id)
  else selectedElementId.value = element.id

  const screen = activeScreen.value
  const ids = new Set(selectedElementIds.value.includes(element.id) ? selectedElementIds.value : [element.id])
  const origins = screen.elements.filter(item => ids.has(item.id)).map(item => ({
    id: item.id, x: item.x, y: item.y, width: item.width, height: item.height,
  }))
  dragState.value = {
    startX: event.clientX,
    startY: event.clientY,
    width: bounds.width,
    height: bounds.height,
    origins,
  }
  window.addEventListener('pointermove', moveElement)
  window.addEventListener('pointerup', finishElementDrag)
  window.addEventListener('pointercancel', finishElementDrag)
}

function moveElement(event: PointerEvent): void {
  const drag = dragState.value
  const screen = activeScreen.value
  if (!drag || !screen) return

  let dx = (event.clientX - drag.startX) / drag.width * 100
  let dy = (event.clientY - drag.startY) / drag.height * 100
  if (snapToGrid.value) {
    dx = Math.round(dx / 2.5) * 2.5
    dy = Math.round(dy / 2.5) * 2.5
  }
  const minX = Math.min(...drag.origins.map(origin => origin.x))
  const minY = Math.min(...drag.origins.map(origin => origin.y))
  const maxX = Math.max(...drag.origins.map(origin => origin.x + origin.width))
  const maxY = Math.max(...drag.origins.map(origin => origin.y + origin.height))
  dx = Math.max(-minX, Math.min(100 - maxX, dx))
  dy = Math.max(-minY, Math.min(100 - maxY, dy))

  for (const origin of drag.origins) {
    const element = screen.elements.find(item => item.id === origin.id)
    if (!element) continue
    Object.assign(element, getClampedUIElementPosition(element, origin.x + dx, origin.y + dy))
  }
}



function finishElementDrag(): void {
  dragState.value = null
  window.removeEventListener('pointermove', moveElement)
  window.removeEventListener('pointerup', finishElementDrag)
  window.removeEventListener('pointercancel', finishElementDrag)
}

function chooseImage(): void {
  if (!selectedElement.value || selectedElement.value.kind !== 'image') return
  imageTargetId.value = selectedElement.value.id
  imageInput.value?.click()
}

function importImage(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const id = imageTargetId.value
  input.value = ''
  if (!file || !id) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    statusMessage.value = 'Use uma imagem PNG, JPG ou WebP.'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    statusMessage.value = 'A imagem deve ter no máximo 5 MB.'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const element = activeScreen.value?.elements.find(item => item.id === id)
    if (!element || typeof reader.result !== 'string') return
    element.imageDataUrl = reader.result
    element.text = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imagem'
    statusMessage.value = `Imagem “${file.name}” adicionada. Salve o projeto para incluí-la no arquivo.`
  }
  reader.onerror = () => { statusMessage.value = 'Não foi possível ler esta imagem.' }
  reader.readAsDataURL(file)
}

function activatePreviewElement(element: UIElementDefinition): void {
  if (!previewMode.value || element.kind !== 'button') return
  if (element.action === 'navigate-screen') {
    const target = uiWorkspaceState.screens.find(screen => screen.id === element.targetScreenId)
    if (target) {
      uiWorkspaceState.activeScreenId = target.id
      statusMessage.value = `Prévia: abriu “${target.name}”.`
    } else {
      statusMessage.value = 'Escolha uma tela de destino nas propriedades do botão.'
    }
  } else if (element.action === 'set-variable') {
    statusMessage.value = `Prévia: o botão definiria “${element.variableName || 'variável'}” como “${element.variableValue}” durante o jogo.`
  }
}

onMounted(() => {
  editHistory.reset(workspaceSnapshot())
  historyReady = true
  refreshHistoryAvailability()
  window.addEventListener('keydown', handleKeyboardShortcut)
})
onBeforeUnmount(() => {
  historyReady = false
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = null
  window.removeEventListener('keydown', handleKeyboardShortcut)
  finishElementDrag()
  cancelCanvasSelection()
  finishSelectionResize()
})
</script>

<template>
  <section class="ui-workspace" aria-label="Workspace de interface do jogo">
    <header class="ui-workspace-header">
      <div class="ui-workspace-brand">
        <span class="ui-workspace-icon">UI</span>
        <div><strong>Workspace de UI</strong><small>{{ projectName || 'Projeto atual' }} · Menus, HUDs e telas 2D</small></div>
      </div>
      <div class="ui-workspace-header-actions">
        <span class="ui-save-hint"><i /> {{ statusMessage }}</span>
        <button type="button" class="ui-header-button" :disabled="!canUndo" title="Desfazer (Ctrl+Z)" @click="undoWorkspace">↶ Desfazer</button>
        <button type="button" class="ui-header-button" :disabled="!canRedo" title="Refazer (Ctrl+Y)" @click="redoWorkspace">↷ Refazer</button>
        <button type="button" class="ui-header-button" :disabled="!clipboardElement || !activeScreen || previewMode" title="Colar elemento (Ctrl+V)" @click="pasteElement">Colar</button>
        <button type="button" class="ui-header-button" @click="previewMode = !previewMode">{{ previewMode ? 'Voltar a editar' : 'Prévia' }}</button>
        <button type="button" class="ui-close-button" aria-label="Fechar Workspace de UI" title="Voltar ao editor 3D" @click="emit('close')">×</button>
      </div>
    </header>

    <div class="ui-workspace-body">
      <aside class="ui-left-panel">
        <div class="ui-panel-heading"><span>TELAS</span><button type="button" title="Criar tela" aria-label="Criar tela" @click="createScreen">＋</button></div>
        <button
          v-for="screen in uiWorkspaceState.screens"
          :key="screen.id"
          type="button"
          class="ui-screen-row"
          :class="{ active: screen.id === uiWorkspaceState.activeScreenId }"
          @click="uiWorkspaceState.activeScreenId = screen.id"
        >
          <span class="ui-screen-row-icon">▱</span>
          <span class="ui-screen-row-label"><strong>{{ screen.name }}</strong><small>{{ screen.width }} × {{ screen.height }}</small></span>
          <span v-if="screen.enabledInGame" class="ui-live-dot" title="Ativa durante o jogo" />
        </button>
        <button type="button" class="ui-add-screen" @click="createScreen">＋ Nova tela</button>
        <section class="ui-template-section" aria-label="Modelos de interface">
          <div class="ui-panel-heading"><span>MODELOS PRONTOS</span></div>
          <button
            v-for="preset in UI_SCREEN_PRESETS"
            :key="preset.id"
            type="button"
            class="ui-template-button"
            @click="addPreset(preset.id)"
          >
            <strong>{{ preset.name }}</strong>
            <small>{{ preset.description }}</small>
          </button>
        </section>
        <div class="ui-left-footer">
          <strong>Como funciona</strong>
          <p>Crie várias telas e conecte botões para navegar entre elas. As telas são gravadas no projeto em <code>ui/screens.json</code>.</p>
        </div>
      </aside>

      <main class="ui-center-panel">
        <div v-if="activeScreen" class="ui-canvas-toolbar">
          <div class="ui-canvas-title"><strong>{{ activeScreen.name }}</strong><small>{{ activeScreen.width }} × {{ activeScreen.height }} · 16:9</small></div>
          <div class="ui-widget-actions" aria-label="Adicionar elemento">
            <button type="button" :disabled="previewMode" @click="addElement('text')">T Texto</button>
            <button type="button" :disabled="previewMode" @click="addElement('button')">▣ Botão</button>
            <button type="button" :disabled="previewMode" @click="addElement('panel')">▤ Painel</button>
            <button type="button" :disabled="previewMode" @click="addElement('image')">▧ Imagem</button>
            <button type="button" :disabled="previewMode" @click="addElement('progress')">▰ Barra</button>
          </div>
          <div class="ui-canvas-options">
            <label title="Mostrar ou ocultar a grade visual"><input v-model="showGrid" type="checkbox" :disabled="previewMode" /> Grade</label>
            <label title="Alinhar os elementos à grade de 2,5% durante o arraste"><input v-model="snapToGrid" type="checkbox" :disabled="previewMode" /> Encaixar</label>
          </div>
        </div>
        <div v-if="selectedElements.length && !previewMode" class="ui-selection-toolbar" aria-label="Ações da seleção">
          <span>{{ selectedElements.length > 1 ? selectedElements.length + ' elementos selecionados' : selectedElement?.name }}</span>
          <button type="button" title="Copiar seleção (Ctrl+C)" @click="copyElement">Copiar</button>
          <button type="button" title="Duplicar seleção (Ctrl+D)" @click="duplicateElement">Duplicar</button>
          <button v-if="selectedElements.length > 1 && selectionGroupId" type="button" title="Desagrupar elementos selecionados" @click="ungroupSelectedElements">Desagrupar</button>
          <button v-else-if="selectedElements.length > 1" type="button" title="Agrupar elementos selecionados" @click="groupSelectedElements">Agrupar</button>
          <button v-if="selectedElements.length === 1" type="button" title="Trazer uma camada para frente" :disabled="activeElementIndex >= (activeScreen?.elements.length ?? 0) - 1" @click="moveSelectedLayer('front')">↑ Frente</button>
          <button v-if="selectedElements.length === 1" type="button" title="Enviar uma camada para trás" :disabled="activeElementIndex <= 0" @click="moveSelectedLayer('back')">↓ Atrás</button>
          <template v-if="selectedElements.length > 1">
            <button type="button" title="Alinhar as bordas esquerdas da seleção" @click="alignSelectedGroup('left')">← Esquerda</button>
            <button type="button" title="Centralizar a seleção no eixo X" @click="alignSelectedGroup('horizontal-center')">↔ Centro X</button>
            <button type="button" title="Alinhar as bordas direitas da seleção" @click="alignSelectedGroup('right')">Direita →</button>
            <button type="button" title="Alinhar os topos da seleção" @click="alignSelectedGroup('top')">↑ Topo</button>
            <button type="button" title="Centralizar a seleção no eixo Y" @click="alignSelectedGroup('vertical-center')">↕ Centro Y</button>
            <button type="button" title="Alinhar as bases da seleção" @click="alignSelectedGroup('bottom')">Base ↓</button>
            <button type="button" :disabled="selectedElements.length < 3" title="Distribuir os elementos com espaçamento horizontal uniforme" @click="distributeSelectedGroup('horizontal')">↔ Distribuir X</button>
            <button type="button" :disabled="selectedElements.length < 3" title="Distribuir os elementos com espaçamento vertical uniforme" @click="distributeSelectedGroup('vertical')">↕ Distribuir Y</button>
          </template>
          <template v-else>
            <button type="button" title="Centralizar horizontalmente na tela" @click="alignSelected('horizontal')">↔ Centro X</button>
            <button type="button" title="Centralizar verticalmente na tela" @click="alignSelected('vertical')">↕ Centro Y</button>
          </template>
        </div>

        <div v-if="activeScreen" class="ui-canvas-area">
          <div class="ui-screen-stage-wrap">
            <div
              ref="canvasStage"
              class="ui-screen-stage"
              :class="{ 'is-previewing': previewMode, 'grid-visible': showGrid }"
              :style="{ backgroundColor: activeScreen.background }"
              @pointerdown="beginCanvasSelection"
            >
              <div class="ui-stage-grid" aria-hidden="true" />
              <div
                v-for="element in activeScreen.elements"
                :key="element.id"
                class="ui-design-element"
                :class="['kind-' + element.kind, { selected: !previewMode && selectedElementIds.includes(element.id), hidden: element.kind === 'panel' && !element.text }]"
                :style="elementStyle(element)"
                @pointerdown="beginElementDrag($event, element)"
                @click.stop="previewMode && activatePreviewElement(element)"
              >
                <template v-if="element.kind === 'panel'">
                  <span v-if="element.text" class="ui-element-label">{{ element.text }}</span>
                </template>
                <template v-else-if="element.kind === 'image'">
                  <img v-if="element.imageDataUrl" :src="element.imageDataUrl" :alt="element.name" :style="{ objectFit: element.imageFit }" />
                  <span v-else class="ui-image-placeholder">▧<small>Importar imagem</small></span>
                </template>
                <template v-else-if="element.kind === 'progress'">
                  <span class="ui-progress-fill" :style="{ width: '68%', backgroundColor: element.color }" />
                  <span class="ui-progress-caption">{{ element.text || element.variableName }}</span>
                </template>
                <template v-else-if="element.kind === 'button'">
                  <button type="button" tabindex="-1" class="ui-preview-button" :style="{ color: element.color, backgroundColor: element.background, borderRadius: element.borderRadius + 'px', fontSize: 'inherit', fontWeight: element.fontWeight, textAlign: element.textAlign }">{{ element.text || 'Botão' }}</button>
                </template>
                <template v-else><span class="ui-element-label">{{ element.text }}</span></template>
              </div>
              <div
                v-if="!previewMode && selectionBounds"
                class="ui-multi-selection-frame"
                :style="selectionFrameStyle"
                aria-label="Redimensionar seleção"
              >
                <button type="button" class="ui-resize-handle handle-nw" aria-label="Redimensionar pelo canto superior esquerdo" @pointerdown.stop.prevent="beginSelectionResize($event, 'nw')" />
                <button type="button" class="ui-resize-handle handle-n" aria-label="Redimensionar pela borda superior" @pointerdown.stop.prevent="beginSelectionResize($event, 'n')" />
                <button type="button" class="ui-resize-handle handle-ne" aria-label="Redimensionar pelo canto superior direito" @pointerdown.stop.prevent="beginSelectionResize($event, 'ne')" />
                <button type="button" class="ui-resize-handle handle-e" aria-label="Redimensionar pela borda direita" @pointerdown.stop.prevent="beginSelectionResize($event, 'e')" />
                <button type="button" class="ui-resize-handle handle-se" aria-label="Redimensionar pelo canto inferior direito" @pointerdown.stop.prevent="beginSelectionResize($event, 'se')" />
                <button type="button" class="ui-resize-handle handle-s" aria-label="Redimensionar pela borda inferior" @pointerdown.stop.prevent="beginSelectionResize($event, 's')" />
                <button type="button" class="ui-resize-handle handle-sw" aria-label="Redimensionar pelo canto inferior esquerdo" @pointerdown.stop.prevent="beginSelectionResize($event, 'sw')" />
                <button type="button" class="ui-resize-handle handle-w" aria-label="Redimensionar pela borda esquerda" @pointerdown.stop.prevent="beginSelectionResize($event, 'w')" />
              </div>
              <div v-if="marqueeSelection && !previewMode" class="ui-selection-marquee" :style="marqueeStyle" aria-hidden="true" />
              <div v-if="!activeScreen.elements.length" class="ui-empty-canvas">
                <span>＋</span><strong>Sua tela começa aqui</strong><small>Adicione textos, botões, painéis, imagens ou barras no topo.</small>
              </div>
              <div class="ui-screen-dimensions">{{ activeScreen.width }} × {{ activeScreen.height }}</div>
            </div>
          </div>
          <p class="ui-canvas-tip">{{ previewMode ? 'Prévia interativa: botões podem navegar para outra tela.' : 'Arraste elementos para posicionar ou uma área vazia para selecionar por retângulo. Use as oito alças para redimensionar. Setas movem, Shift+setas movem mais, Ctrl+D duplica e Delete remove.' }}</p>
        </div>

        <div v-else class="ui-empty-workspace">
          <div class="ui-empty-workspace-icon">UI</div>
          <h2>Crie sua primeira interface</h2>
          <p>Monte menus principais, telas de pausa, diálogos, HUDs e barras de estado por meio de elementos visuais.</p>
          <button type="button" @click="createScreen">＋ Criar primeira tela</button>
        </div>
      </main>

      <aside class="ui-right-panel">
        <section class="ui-inspector-section">
          <div class="ui-panel-heading"><span>PROPRIEDADES DA TELA</span></div>
          <template v-if="activeScreen">
            <label class="ui-field">Nome
              <input v-model="activeScreen.name" maxlength="80" />
            </label>
            <label class="ui-field">Tipo de tela
              <select v-model="activeScreen.displayMode">
                <option value="screen">Tela navegável · menu, pausa ou diálogo</option>
                <option value="overlay">Overlay persistente · HUD</option>
              </select>
            </label>
            <label class="ui-field">Cor de fundo
              <span class="ui-color-field"><input v-model="activeScreen.background" type="color" /><input v-model="activeScreen.background" maxlength="7" /></span>
            </label>
            <label class="ui-check-field"><input v-model="activeScreen.enabledInGame" type="checkbox" /><span><strong>Ativa no jogo</strong><small>Inclui esta tela na interface durante o modo Jogar.</small></span></label>
            <div class="ui-inspector-actions">
              <button type="button" @click="duplicateScreen">Duplicar tela</button>
              <button type="button" class="danger" @click="deleteScreen">Excluir</button>
            </div>
          </template>
          <p v-else class="ui-inspector-empty">Crie uma tela para editar suas propriedades.</p>
        </section>

        <section class="ui-inspector-section ui-hierarchy-section">
          <div class="ui-panel-heading"><span>HIERARQUIA</span><span class="ui-count">{{ activeScreen?.elements.length ?? 0 }}</span></div>
          <button
            v-for="element in activeScreen?.elements ?? []"
            :key="element.id"
            type="button"
            class="ui-element-row"
            :class="{ active: selectedElementIds.includes(element.id) && !previewMode }"
            @click="selectElement(element.id, $event.shiftKey || $event.ctrlKey || $event.metaKey)"
          >
            <span class="ui-element-kind">{{ element.kind === 'text' ? 'T' : element.kind === 'button' ? '▣' : element.kind === 'panel' ? '▤' : element.kind === 'image' ? '▧' : '▰' }}</span>
            <span>{{ element.name }}</span>
            <span class="ui-element-position">{{ Math.round(element.x) }}%, {{ Math.round(element.y) }}%</span>
          </button>
          <p v-if="activeScreen && !activeScreen.elements.length" class="ui-inspector-empty">Nenhum elemento nesta tela.</p>
        </section>

        <section v-if="selectedElements.length > 1 && selectionBounds && !previewMode" class="ui-inspector-section ui-selection-transform">
          <div class="ui-panel-heading"><span>TRANSFORMAR SELEÇÃO</span><span class="ui-count">{{ selectedElements.length }}</span></div>
          <div class="ui-two-fields">
            <label class="ui-field">X · %
              <input type="number" min="0" :max="100 - selectionBounds.width" step="0.25" :value="selectionBounds.x" @change="applySelectionBoundsField('x', $event)" />
            </label>
            <label class="ui-field">Y · %
              <input type="number" min="0" :max="100 - selectionBounds.height" step="0.25" :value="selectionBounds.y" @change="applySelectionBoundsField('y', $event)" />
            </label>
          </div>
          <div class="ui-two-fields">
            <label class="ui-field">Largura · %
              <input type="number" min="1" :max="100 - selectionBounds.x" step="0.25" :value="selectionBounds.width" @change="applySelectionBoundsField('width', $event)" />
            </label>
            <label class="ui-field">Altura · %
              <input type="number" min="1" :max="100 - selectionBounds.y" step="0.25" :value="selectionBounds.height" @change="applySelectionBoundsField('height', $event)" />
            </label>
          </div>
          <small class="ui-field-help">Mova ou redimensione o conjunto inteiro com valores precisos, preservando as proporções internas da seleção.</small>
        </section>

        <section class="ui-inspector-section ui-element-properties">
          <div class="ui-panel-heading"><span>ELEMENTO SELECIONADO</span><button v-if="selectedElement && selectedElements.length === 1 && !previewMode" type="button" class="ui-delete-element" title="Remover elemento" @click="removeElement()">×</button></div>
          <template v-if="selectedElement && selectedElements.length === 1 && !previewMode">
            <label class="ui-field">Nome interno
              <input v-model="selectedElement.name" maxlength="80" />
            </label>
            <label v-if="selectedElement.kind !== 'image'" class="ui-field">Texto / rótulo
              <input v-model="selectedElement.text" maxlength="240" />
            </label>
            <div class="ui-two-fields">
              <label class="ui-field">X · %
                <input v-model.number="selectedElement.x" type="number" min="0" max="99" step="1" />
              </label>
              <label class="ui-field">Y · %
                <input v-model.number="selectedElement.y" type="number" min="0" max="99" step="1" />
              </label>
            </div>
            <div class="ui-two-fields">
              <label class="ui-field">Largura · %
                <input v-model.number="selectedElement.width" type="number" min="1" max="100" step="1" />
              </label>
              <label class="ui-field">Altura · %
                <input v-model.number="selectedElement.height" type="number" min="1" max="100" step="1" />
              </label>
            </div>
            <div v-if="selectedElement.kind !== 'image'" class="ui-two-fields">
              <label class="ui-field">Tamanho da fonte
                <input v-model.number="selectedElement.fontSize" type="number" min="8" max="96" step="1" />
              </label>
              <label class="ui-field">Raio da borda
                <input v-model.number="selectedElement.borderRadius" type="number" min="0" max="48" step="1" />
              </label>
            </div>
            <div v-if="selectedElement.kind !== 'image'" class="ui-two-fields">
              <label class="ui-field">Alinhamento do texto
                <select v-model="selectedElement.textAlign">
                  <option value="left">À esquerda</option>
                  <option value="center">Centralizado</option>
                  <option value="right">À direita</option>
                </select>
              </label>
              <label class="ui-field">Peso da fonte
                <select v-model.number="selectedElement.fontWeight">
                  <option :value="400">Normal · 400</option>
                  <option :value="500">Médio · 500</option>
                  <option :value="600">Seminegrito · 600</option>
                  <option :value="700">Negrito · 700</option>
                  <option :value="800">Extra negrito · 800</option>
                </select>
              </label>
            </div>
            <label class="ui-field">Opacidade · {{ Math.round(selectedElement.opacity * 100) }}%
              <input v-model.number="selectedElement.opacity" type="range" min="0" max="1" step="0.05" />
            </label>
            <label v-if="selectedElement.kind !== 'image'" class="ui-field">Cor do texto / preenchimento
              <span class="ui-color-field"><input v-model="selectedElement.color" type="color" /><input v-model="selectedElement.color" maxlength="9" /></span>
            </label>
            <label v-if="selectedElement.kind !== 'text'" class="ui-field">Cor de fundo
              <span class="ui-color-field"><input v-model="selectedElement.background" type="color" /><input v-model="selectedElement.background" maxlength="9" /></span>
            </label>
            <template v-if="selectedElement.kind === 'image'">
              <label class="ui-field">Ajuste da imagem
                <select v-model="selectedElement.imageFit">
                  <option value="contain">Conter · sem cortes</option>
                  <option value="cover">Cobrir · preencher com corte</option>
                  <option value="fill">Esticar · preencher tudo</option>
                </select>
              </label>
              <button type="button" class="ui-image-picker" @click="chooseImage">{{ selectedElement.imageDataUrl ? 'Trocar imagem' : '＋ Importar imagem' }}</button>
              <small class="ui-field-help">PNG, JPG ou WebP. Limite de 5 MB por arquivo.</small>
            </template>
            <template v-if="selectedElement.kind === 'progress'">
              <label class="ui-field">Variável global
                <input v-model="selectedElement.variableName" list="ui-global-variable-list" maxlength="80" placeholder="vida" />
              </label>
              <datalist id="ui-global-variable-list"><option value="vida" /><option value="mana" /><option value="stamina" /></datalist>
              <label class="ui-field">Valor máximo
                <input v-model.number="selectedElement.variableMax" type="number" min="1" max="1000000" />
              </label>
            </template>
            <template v-if="selectedElement.kind === 'button'">
              <label class="ui-field">Ao clicar
                <select v-model="selectedElement.action">
                  <option value="none">Nenhuma ação</option>
                  <option value="navigate-screen">Abrir outra tela</option>
                  <option value="set-variable">Definir variável global</option>
                </select>
              </label>
              <label v-if="selectedElement.action === 'navigate-screen'" class="ui-field">Tela de destino
                <select v-model="selectedElement.targetScreenId">
                  <option value="">Selecione uma tela</option>
                  <option v-for="screen in uiWorkspaceState.screens" :key="screen.id" :value="screen.id">{{ screen.name }}</option>
                </select>
              </label>
              <template v-if="selectedElement.action === 'set-variable'">
                <label class="ui-field">Nome da variável
                  <input v-model="selectedElement.variableName" maxlength="80" placeholder="menu_confirmado" />
                </label>
                <label class="ui-field">Valor
                  <input v-model="selectedElement.variableValue" maxlength="100" placeholder="true" />
                </label>
              </template>
            </template>
          </template>
          <p v-else class="ui-inspector-empty">{{ previewMode ? 'Saia da prévia para editar os elementos.' : selectedElements.length > 1 ? 'Vários elementos selecionados. Use Transformar seleção para ajustar posição e tamanho do conjunto.' : 'Selecione um elemento na tela ou na hierarquia.' }}</p>
        </section>
      </aside>
    </div>
    <input ref="imageInput" class="ui-hidden-input" type="file" accept="image/png,image/jpeg,image/webp" @change="importImage" />
  </section>
</template>

<style scoped src="./UIWorkspace.css"></style>
