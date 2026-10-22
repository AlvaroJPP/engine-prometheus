import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

type ViewportLayoutId = 'render' | 'fps' | 'axes' | 'tools'
type ViewportLayoutItem = { x: number; y: number; scale: number }
type ViewportLayoutSettings = Record<ViewportLayoutId, ViewportLayoutItem>

interface UseViewportLayoutOptions {
  executionMode: Ref<'edit' | 'running'>
  worldFullscreen: Ref<boolean>
  sidebarCollapsed: Ref<boolean>
  viewportRoot: Ref<HTMLElement | null>
  playerHudSettingsOpen: Ref<boolean>
}

export function useViewportLayout({
  executionMode,
  worldFullscreen,
  sidebarCollapsed,
  viewportRoot,
  playerHudSettingsOpen,
}: UseViewportLayoutOptions) {
const VIEWPORT_LAYOUT_STORAGE_KEY = 'engine-prometheus.viewport-layout.v7'
const LEGACY_VIEWPORT_LAYOUT_STORAGE_KEY_V6 = 'engine-prometheus.viewport-layout.v6'
const LEGACY_VIEWPORT_LAYOUT_STORAGE_KEY_V5 = 'engine-prometheus.viewport-layout.v5'
const DEFAULT_VIEWPORT_LAYOUT: ViewportLayoutSettings = {
  render: { x: 0.29, y: 0.015, scale: 1 },
  fps: { x: 0.66, y: 0.11, scale: 1 },
  axes: { x: 0.015, y: 0.78, scale: 1 },
  tools: { x: 0.015, y: 0.02, scale: 1 },
}
function boundedLayoutNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}
function loadViewportLayout(): ViewportLayoutSettings {
  try {
    const current = localStorage.getItem(VIEWPORT_LAYOUT_STORAGE_KEY)
    const migratingLegacyLayout = current === null
    const saved = JSON.parse(
      current
        ?? localStorage.getItem(LEGACY_VIEWPORT_LAYOUT_STORAGE_KEY_V6)
        ?? localStorage.getItem(LEGACY_VIEWPORT_LAYOUT_STORAGE_KEY_V5)
        ?? '{}',
    ) as Partial<ViewportLayoutSettings>
    const result = {} as ViewportLayoutSettings
    for (const id of ['render', 'fps', 'axes', 'tools'] as const) {
      const candidate = saved[id]
      const fallback = DEFAULT_VIEWPORT_LAYOUT[id]
      result[id] = {
        x: boundedLayoutNumber(candidate?.x, fallback.x, 0, 1),
        y: boundedLayoutNumber(candidate?.y, fallback.y, 0, 1),
        // A redução da barra é feita pela área rolável, não pela escala visual.
        scale: id === 'tools' && migratingLegacyLayout
          ? 1
          : boundedLayoutNumber(candidate?.scale, fallback.scale, 0.55, 1.6),
      }
    }
    if (migratingLegacyLayout) {
      localStorage.setItem(VIEWPORT_LAYOUT_STORAGE_KEY, JSON.stringify(result))
    }
    return result
  } catch {
    return { render: { ...DEFAULT_VIEWPORT_LAYOUT.render }, fps: { ...DEFAULT_VIEWPORT_LAYOUT.fps }, axes: { ...DEFAULT_VIEWPORT_LAYOUT.axes }, tools: { ...DEFAULT_VIEWPORT_LAYOUT.tools } }
  }
}
const viewportLayout = ref<ViewportLayoutSettings>(loadViewportLayout())
const viewportLayoutConfigOpen = ref(false)
const viewportLayoutEditMode = ref(false)
const activeViewportLayoutItem = ref<ViewportLayoutId>('render')
const viewportLayoutBounds = ref({ left: 0, top: 0, width: 0, height: 0 })
const viewportLayoutRefresh = ref(0)
const viewportLayoutItems: Array<{ id: ViewportLayoutId; label: string; description: string; icon: string }> = [
  { id: 'render', label: 'Render e câmera', description: 'Menu superior e controles de visualização', icon: '◈' },
  { id: 'fps', label: 'FPS e renderização', description: 'FPS, triângulos, draws e tempos do motor', icon: 'ϟ' },
  { id: 'axes', label: 'Eixos X · Y · Z', description: 'Indicadores de largura, altura e profundidade', icon: 'XYZ' },
  { id: 'tools', label: 'Ferramentas 3D', description: 'Selecionar, mover, rotacionar, escalar e criar', icon: '⌖' },
]
// A barra de ferramentas fica bloqueada no modo de lateral recolhida.
const selectableViewportLayoutItems = computed(() =>
  sidebarCollapsed.value
    ? viewportLayoutItems.filter(item => item.id !== 'tools')
    : viewportLayoutItems,
)
watch(sidebarCollapsed, (collapsed) => {
  if (collapsed && activeViewportLayoutItem.value === 'tools') {
    activeViewportLayoutItem.value = 'render'
  }
})
type ViewportLayoutDrag = {
  id: ViewportLayoutId
  mode: 'move' | 'resize'
  pointerX: number
  pointerY: number
  originX: number
  originY: number
  scale: number
  width: number
  height: number
}
let viewportLayoutDrag: ViewportLayoutDrag | null = null
let viewportLayoutResizeObserver: ResizeObserver | null = null

const viewportLayoutUsableHeight = computed(() => Math.max(
  1,
  viewportLayoutBounds.value.height - (executionMode.value === 'edit' && !worldFullscreen.value ? 28 : 0),
))
function getViewportLayoutTarget(id: ViewportLayoutId): HTMLElement | null {
  const selectors: Record<ViewportLayoutId, string> = {
    render: '.viewport-tools-overlay',
    fps: '.viewport-fps',
    axes: '.axes',
    tools: '.toolbar',
  }
  return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(selectors[id])
}
function getViewportLayoutMaximumScale(id: ViewportLayoutId, element?: HTMLElement | null): number {
  const target = element ?? getViewportLayoutTarget(id)
  const rect = viewportLayoutBounds.value
  const usableHeight = viewportLayoutUsableHeight.value
  if (!target || rect.width <= 0 || usableHeight <= 0) return 1.6

  const width = Math.max(1, target.offsetWidth)
  const height = Math.max(1, target.offsetHeight)
  const availableWidth = Math.max(1, rect.width - 8)
  const availableHeight = Math.max(1, usableHeight - 8)

  // A barra lateral recolhida tem largura fixa e rolagem interna.
  // Sua escala é bloqueada separadamente no layout; aqui evitamos usar a
  // altura total do conteúdo para limitar o tamanho visual.
  const anchoredRail = id === 'tools' && sidebarCollapsed.value && !worldFullscreen.value
  if (anchoredRail) {
    return Math.max(0.55, Math.min(1.6, availableWidth / width))
  }

  // O tamanho máximo depende da viewport inteira, não da posição atual.
  // Assim, FPS e eixos não encolhem durante o arraste nem ficam presos no meio.
  return Math.max(0.55, Math.min(1.6, availableWidth / width, availableHeight / height))
}
function getViewportLayoutEffectiveScale(id: ViewportLayoutId, element?: HTMLElement | null): number {
  const target = element ?? getViewportLayoutTarget(id)
  const requestedScale = viewportLayout.value[id].scale
  return target ? Math.min(requestedScale, getViewportLayoutMaximumScale(id, target)) : requestedScale
}
function getViewportLayoutMinimumX(id: ViewportLayoutId, scaledWidth = 0): number {
  if (!sidebarCollapsed.value || worldFullscreen.value || (id !== 'fps' && id !== 'axes')) return 0
  // Mantém os indicadores fora da faixa fixa usada pela lateral recolhida.
  const width = Math.max(1, viewportLayoutBounds.value.width)
  const isNarrowWindow = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
  const railClearance = isNarrowWindow ? 172 : 188
  return Math.min(railClearance, Math.max(0, width - scaledWidth - 4))
}

function viewportLayoutStyle(id: ViewportLayoutId): Record<string, string> {
  void viewportLayoutRefresh.value
  const bounds = viewportLayoutBounds.value
  const item = viewportLayout.value[id]
  const target = getViewportLayoutTarget(id)
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, viewportLayoutUsableHeight.value)
  const lockedCollapsedToolbar = id === 'tools' && sidebarCollapsed.value && !worldFullscreen.value
  const scale = lockedCollapsedToolbar ? 1 : getViewportLayoutEffectiveScale(id, target)
  const scaledWidth = (target?.offsetWidth || 180) * scale
  const scaledHeight = (target?.offsetHeight || 80) * scale
  const minX = getViewportLayoutMinimumX(id, scaledWidth)
  const maxX = Math.max(minX, width - scaledWidth - 4)
  const localX = Math.max(minX, Math.min(item.x * width, maxX))
  const localY = Math.max(0, Math.min(item.y * height, height - scaledHeight - 4))
  // FPS e eixos ficam dentro de .viewport, cujo contain: paint torna o
  // posicionamento fixo relativo à própria viewport. Para eles, use coordenadas
  // locais; somar bounds.left/top deslocava os controles e os prendia no meio.
  const positionedInsideViewport = id === 'fps' || id === 'axes'
  const left = positionedInsideViewport ? localX : bounds.left + localX
  const top = positionedInsideViewport ? localY : bounds.top + localY
  return {
    '--viewport-layout-left': Math.round(left) + 'px',
    '--viewport-layout-top': Math.round(top) + 'px',
    '--viewport-layout-scale': String(scale),
  }
}
function viewportLayoutOutlineStyle(id: ViewportLayoutId): Record<string, string> {
  void viewportLayoutRefresh.value
  const root = viewportRoot.value
  const target = getViewportLayoutTarget(id)
  if (!root || !target) return { left: '0px', top: '0px', width: '1px', height: '1px' }
  const rootRect = root.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return {
    left: Math.round(targetRect.left - rootRect.left) + 'px',
    top: Math.round(targetRect.top - rootRect.top) + 'px',
    width: Math.max(1, Math.round(targetRect.width)) + 'px',
    height: Math.max(1, Math.round(targetRect.height)) + 'px',
  }
}
function persistViewportLayout(): void {
  try {
    localStorage.setItem(VIEWPORT_LAYOUT_STORAGE_KEY, JSON.stringify(viewportLayout.value))
  } catch {
    // O layout continua funcionando nesta sessão mesmo se o armazenamento estiver indisponível.
  }
}
function clampViewportLayoutItem(id: ViewportLayoutId): void {
  if (id === 'tools' && sidebarCollapsed.value) return
  const root = viewportRoot.value
  if (!root) return
  const rootRect = root.getBoundingClientRect()
  const width = Math.max(1, rootRect.width)
  const height = Math.max(1, rootRect.height - (executionMode.value === 'edit' && !worldFullscreen.value ? 28 : 0))
  viewportLayoutBounds.value = { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: rootRect.height }
  const target = getViewportLayoutTarget(id)
  const item = viewportLayout.value[id]
  if (!target) return
  const effectiveScale = getViewportLayoutEffectiveScale(id, target)
  const targetWidth = Math.max(1, target.offsetWidth) * effectiveScale
  const targetHeight = Math.max(1, target.offsetHeight) * effectiveScale
  const minX = getViewportLayoutMinimumX(id, targetWidth)
  const maxX = Math.max(minX, width - targetWidth - 4)
  const maxY = Math.max(0, height - targetHeight - 4)
  item.x = Math.max(minX, Math.min(maxX, item.x * width)) / width
  item.y = Math.max(0, Math.min(maxY, item.y * height)) / height
}
function clampAllViewportLayoutItems(): void {
  for (const item of viewportLayoutItems) {
    if (sidebarCollapsed.value && item.id === 'tools') continue
    clampViewportLayoutItem(item.id)
  }
  viewportLayoutRefresh.value += 1
}
function refreshViewportLayoutBounds(): void {
  const root = viewportRoot.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  // Não reescreva x/y ao redimensionar a viewport. Os valores são frações
  // da área útil e precisam continuar iguais ao recolher/expandir a hierarquia.
  viewportLayoutBounds.value = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  void nextTick(() => {
    const updatedRect = root.getBoundingClientRect()
    viewportLayoutBounds.value = {
      left: updatedRect.left,
      top: updatedRect.top,
      width: updatedRect.width,
      height: updatedRect.height,
    }
    viewportLayoutRefresh.value += 1
  })
}
function toggleViewportLayoutConfig(): void {
  if (viewportLayoutConfigOpen.value) {
    viewportLayoutConfigOpen.value = false
    viewportLayoutEditMode.value = false
    return
  }
  viewportLayoutConfigOpen.value = true
}
function updateViewportLayoutPercent(axis: 'x' | 'y', value: number): void {
  const id = activeViewportLayoutItem.value
  if (id === 'tools' && sidebarCollapsed.value) return
  const item = viewportLayout.value[id]
  item[axis] = Math.max(0, Math.min(1, value / 100))
  viewportLayoutRefresh.value += 1
  void nextTick(() => clampViewportLayoutItem(activeViewportLayoutItem.value))
}
function updateViewportLayoutScale(value: number): void {
  const id = activeViewportLayoutItem.value
  if (id === 'tools' && sidebarCollapsed.value) return
  viewportLayout.value[id].scale = Math.max(0.55, Math.min(getViewportLayoutMaximumScale(id), value / 100))
  viewportLayoutRefresh.value += 1
  void nextTick(() => clampViewportLayoutItem(id))
}
function resetViewportLayoutItem(id: ViewportLayoutId): void {
  if (id === 'tools' && sidebarCollapsed.value) return
  viewportLayout.value[id] = { ...DEFAULT_VIEWPORT_LAYOUT[id] }
  void nextTick(() => {
    clampViewportLayoutItem(id)
    viewportLayoutRefresh.value += 1
    persistViewportLayout()
  })
}
function resetAllViewportLayout(): void {
  viewportLayout.value = {
    render: { ...DEFAULT_VIEWPORT_LAYOUT.render },
    fps: { ...DEFAULT_VIEWPORT_LAYOUT.fps },
    axes: { ...DEFAULT_VIEWPORT_LAYOUT.axes },
    tools: sidebarCollapsed.value
      ? { ...viewportLayout.value.tools }
      : { ...DEFAULT_VIEWPORT_LAYOUT.tools },
  }
  void nextTick(() => {
    clampAllViewportLayoutItems()
    persistViewportLayout()
  })
}
function openHudSettingsFromViewportLayout(): void {
  playerHudSettingsOpen.value = true
  viewportLayoutConfigOpen.value = false
  viewportLayoutEditMode.value = false
}
function beginViewportLayoutDrag(event: PointerEvent, id: ViewportLayoutId, mode: 'move' | 'resize'): void {
  if (id === 'tools' && sidebarCollapsed.value) return
  event.preventDefault()
  event.stopPropagation()
  const root = viewportRoot.value
  const target = getViewportLayoutTarget(id)
  if (!root || !target) return
  const item = viewportLayout.value[id]
  const rootRect = root.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  viewportLayout.value[id].x = Math.max(0, targetRect.left - rootRect.left) / Math.max(1, rootRect.width)
  viewportLayout.value[id].y = Math.max(0, targetRect.top - rootRect.top) / Math.max(1, rootRect.height)
  activeViewportLayoutItem.value = id
  viewportLayoutDrag = {
    id,
    mode,
    pointerX: event.clientX,
    pointerY: event.clientY,
    originX: item.x * rootRect.width,
    originY: item.y * Math.max(1, rootRect.height - (executionMode.value === 'edit' && !worldFullscreen.value ? 28 : 0)),
    scale: item.scale,
    width: Math.max(1, target.offsetWidth) * getViewportLayoutEffectiveScale(id, target),
    height: Math.max(1, target.offsetHeight) * getViewportLayoutEffectiveScale(id, target),
  }
  window.addEventListener('pointermove', moveViewportLayoutDrag)
  window.addEventListener('pointerup', finishViewportLayoutDrag)
  window.addEventListener('pointercancel', finishViewportLayoutDrag)
}
function moveViewportLayoutDrag(event: PointerEvent): void {
  const drag = viewportLayoutDrag
  const root = viewportRoot.value
  const target = drag ? getViewportLayoutTarget(drag.id) : null
  if (!drag || !root || !target) return
  if (drag.id === 'tools' && sidebarCollapsed.value) {
    finishViewportLayoutDrag()
    return
  }
  event.preventDefault()
  const rootRect = root.getBoundingClientRect()
  const width = Math.max(1, rootRect.width)
  const usableHeight = Math.max(1, rootRect.height - (executionMode.value === 'edit' && !worldFullscreen.value ? 28 : 0))
  const dx = event.clientX - drag.pointerX
  const dy = event.clientY - drag.pointerY
  const item = viewportLayout.value[drag.id]
  let effectiveScale = getViewportLayoutEffectiveScale(drag.id, target)
  if (drag.mode === 'move') {
    const targetWidth = target.offsetWidth * effectiveScale
    const minX = getViewportLayoutMinimumX(drag.id, targetWidth)
    const maxX = Math.max(minX, width - targetWidth - 4)
    const maxY = Math.max(0, usableHeight - target.offsetHeight * effectiveScale - 4)
    item.x = Math.max(minX, Math.min(maxX, drag.originX + dx)) / width
    item.y = Math.max(0, Math.min(maxY, drag.originY + dy)) / usableHeight
  } else {
    const unit = Math.max(120, drag.width, drag.height)
    const requestedScale = drag.scale + (dx + dy) / (2 * unit)
    item.scale = Math.max(0.55, Math.min(getViewportLayoutMaximumScale(drag.id, target), requestedScale))
    effectiveScale = getViewportLayoutEffectiveScale(drag.id, target)
    const targetWidth = target.offsetWidth * effectiveScale
    const minX = getViewportLayoutMinimumX(drag.id, targetWidth)
    const maxX = Math.max(minX, width - targetWidth - 4)
    const maxY = Math.max(0, usableHeight - target.offsetHeight * effectiveScale - 4)
    item.x = Math.max(minX, Math.min(maxX, item.x * width)) / width
    item.y = Math.max(0, Math.min(maxY, item.y * usableHeight)) / usableHeight
  }
  viewportLayoutBounds.value = { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: rootRect.height }
  viewportLayoutRefresh.value += 1
}
function finishViewportLayoutDrag(): void {
  if (!viewportLayoutDrag) return
  const changedId = viewportLayoutDrag.id
  viewportLayoutDrag = null
  window.removeEventListener('pointermove', moveViewportLayoutDrag)
  window.removeEventListener('pointerup', finishViewportLayoutDrag)
  window.removeEventListener('pointercancel', finishViewportLayoutDrag)
  // Finaliza apenas o item manipulado; os demais mantêm suas coordenadas
  // proporcionais mesmo que a viewport tenha acabado de mudar de tamanho.
  clampViewportLayoutItem(changedId)
  viewportLayoutRefresh.value += 1
  persistViewportLayout()
}
function handleViewportLayoutWindowResize(): void {
  refreshViewportLayoutBounds()
}

onMounted(() => {
  void nextTick(() => {
    refreshViewportLayoutBounds()
    if (viewportRoot.value && typeof ResizeObserver !== 'undefined') {
      viewportLayoutResizeObserver = new ResizeObserver(handleViewportLayoutWindowResize)
      viewportLayoutResizeObserver.observe(viewportRoot.value)
    }
    window.addEventListener('resize', handleViewportLayoutWindowResize)
    requestAnimationFrame(() => {
      refreshViewportLayoutBounds()
    })
  })
})
onBeforeUnmount(() => {
  viewportLayoutResizeObserver?.disconnect()
  viewportLayoutResizeObserver = null
  window.removeEventListener('resize', handleViewportLayoutWindowResize)
  window.removeEventListener('pointermove', moveViewportLayoutDrag)
  window.removeEventListener('pointerup', finishViewportLayoutDrag)
  window.removeEventListener('pointercancel', finishViewportLayoutDrag)
})

  return {
    activeViewportLayoutItem,
    beginViewportLayoutDrag,
    openHudSettingsFromViewportLayout,
    persistViewportLayout,
    refreshViewportLayoutBounds,
    resetAllViewportLayout,
    resetViewportLayoutItem,
    selectableViewportLayoutItems,
    toggleViewportLayoutConfig,
    updateViewportLayoutPercent,
    updateViewportLayoutScale,
    viewportLayout,
    viewportLayoutConfigOpen,
    viewportLayoutEditMode,
    viewportLayoutOutlineStyle,
    viewportLayoutRefresh,
    viewportLayoutStyle,
  }
}
