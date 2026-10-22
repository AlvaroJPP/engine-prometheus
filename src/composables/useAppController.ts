import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ENGINE_VERSION, TERRAIN_ID, markEntity, BEHAVIOR_PACKAGE_DEFINITIONS, getBehaviorPackageDefinition } from '@engine'
import type { ToolMode, TransformMode, LogicRule, BehaviorPackageInstance, BehaviorPackageDefinition, PackageJsonValue, PackageScalar, ControlMapSettings } from '@engine'
import { CAMERA_LABELS, useEditor } from '@/composables/useEditor'
import { loadControlMapSettings, saveControlMapSettings } from '@/lib/controls/controlMapSettings'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import { deleteSavedComponent, getSavedComponent, listSavedComponents, saveComponentAsset, saveComponentAssets } from '@/lib/assets/ComponentLibrary'
import type { SavedComponent } from '@/lib/assets/ComponentLibrary'
import { generateComponentThumbnail } from '@/lib/assets/ComponentThumbnail'

export function useAppController() {
function clonePackageJsonValue(value: PackageJsonValue): PackageJsonValue {
  if (Array.isArray(value)) return value.map(clonePackageJsonValue)
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, PackageJsonValue> = {}
    for (const [key, nested] of Object.entries(value)) copy[key] = clonePackageJsonValue(nested)
    return copy
  }
  return value
}

function clonePackageJsonRecord(record: Record<string, PackageJsonValue>): Record<string, PackageJsonValue> {
  return clonePackageJsonValue(record) as Record<string, PackageJsonValue>
}

function cloneSavedBehaviorPackageSettings(
  settings: NonNullable<SavedComponent['behaviorPackageSettings']>,
): NonNullable<SavedComponent['behaviorPackageSettings']> {
  return Object.fromEntries(Object.entries(settings).map(([id, draft]) => [id, {
    variables: { ...draft.variables },
    config: clonePackageJsonRecord(draft.config),
  }]))
}

const appRoot = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let unlistenNativeWindowResize: (() => void) | null = null
const rootOpen = ref(true)
const sidebarCollapsed = ref(false)
const inspectorTab = ref<'transform' | 'color' | 'variables' | 'nodes' | 'packages'>('transform')
const executionMode = ref<'edit' | 'running'>('edit')
const worldFullscreen = ref(false)
const playerHudSettingsOpen = ref(false)

type ViewportLayoutId = 'render' | 'fps' | 'axes' | 'tools'
type ViewportLayoutItem = { x: number; y: number; scale: number }
type ViewportLayoutSettings = Record<ViewportLayoutId, ViewportLayoutItem>

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
const viewportRoot = ref<HTMLElement | null>(null)
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

watch(executionMode, (mode) => {
  // A configuração da HUD pertence ao modo de edição; ao iniciar o jogo, feche-a.
  if (mode !== 'edit') playerHudSettingsOpen.value = false
})
const fullscreenTransition = ref(false)
const controlMapsOpen = ref(false)
const controlMapSettings = ref<ControlMapSettings>(loadControlMapSettings())
const activeControlMap = computed(() =>
  controlMapSettings.value.profiles.find(profile => profile.id === controlMapSettings.value.activeProfileId)
  ?? controlMapSettings.value.profiles[0]!,
)
const firstPersonMode = ref(false)
const publicLibraryOpen = ref(false)
const modelImportOpen = ref(false)
const quickAddOpen = ref(false)
const previewComponentAsset = ref<{ id?: string; name: string; bytes: ArrayBuffer; height?: number; colliderType?: SavedComponent['colliderType']; colliderSize?: [number, number, number]; colliderOffset?: [number, number, number]; kind?: SavedComponent['kind']; libraryType?: SavedComponent['libraryType']; logic?: SavedComponent['logic']; animationRoles?: Record<string, import('@engine').AnimationRole>; controlBindings?: Partial<import('@engine').ModelControlBindings>; behaviorPackageIds?: string[]; behaviorPackageSettings?: Record<string, { variables: Record<string, PackageScalar>; config: Record<string, PackageJsonValue> }>; thumbnail?: string } | null>(null)
const previewAnimationSourceAsset = ref<{ id: string; name: string; bytes: ArrayBuffer; height?: number; libraryType: 'animation-source' } | null>(null)
const savedComponents = ref<Array<Omit<SavedComponent, 'bytes'>>>([])
const placeableSavedComponents = computed(() => savedComponents.value.filter(component => component.libraryType !== 'animation-source'))
const savedAnimationSourceOptions = computed(() => savedComponents.value
  .filter(component => component.libraryType === 'animation-source')
  .map(({ id, name, height, thumbnail }) => ({ id, name, height, thumbnail })))
const componentBusy = ref(false)
let componentThumbnailBackfillRunning = false
const {
  projectName,
  dirty,
  status,
  fps,
  renderStats,
  ioProgress,
  objects,
  selectedModelNodes,
  terrain,
  selectedId,
  groupSelection,
  tool,
  transform,
  cameraPreset,
  brushStrength,
  brushRadius,
  gridVisible,
  polygonLinesVisible,
  performanceMode,
  renderDistance,
  renderAll,
  renderResolutionScale,
  renderFpsLimit,
  renderFogEnabled,
  renderFogDistanceScale,
  renderDynamicResolution,
  renderDynamicResolutionTargetFps,
  renderDynamicResolutionMinScale,
  grassVisible,
  grassUseDetailedModel,
  grassDensityPercent,
  grassRenderDistanceMode,
  grassRenderDistance,
  grassNearDetailDistance,
  grassMiddleDetailDistance,
  grassOcclusionEnabled,
  grassOcclusionIntervalMs,
  wallOcclusionQuality,
  grassWindPercent,
  playerModelName,
  playerModelCustom,
  playerModelHeight,
  setPlayerModelFile,
  setPlayerModelAsset,
  resetPlayerModel,
  skyTextureDataUrl, timeOfDay, dayNightCycleEnabled, dayNightCycleSpeed,
  setSkyTexture, setTimeOfDay, setDayNightCycleEnabled, setDayNightCycleSpeed,
  logicRules, behaviorPackages, logicVariables, globalLogicVariables, readRuntimeGlobalVariables, useGlobalVariableOnObject, ruleTrigger, rulePackageId, rulePackageEventId, rulePackageVariableName, rulePackageVariableValue, ruleAction, ruleConditionEnabled,
  installBehaviorPackage, updateBehaviorPackage, removeBehaviorPackage,
  createLogicVariable, setLogicVariableValue, setRuntimeGlobalVariable, deleteLogicVariable, addLogicRule, toggleLogicRule, deleteLogicRule, moveLogicRule, updateLogicRule, importLogicRule,
  markDirty,
  setTool,
  setTransform,
  addPrimitive,
  addSpawnPlatform,
  setBuildComponentPlacement,
  addClickableCubeExample,
  cycleCamera,
  setControlBindings,
  setFirstPersonMode,
  setRuntimeMode,
  selectItem,
  groupSelectedObjects,
  ungroupSelectedObjects,
  toggleVisible,
  toggleObjectLock,
  toggleObjectWireframe,
  toggleTerrain,
  toggleGrid,
  togglePolygonLines,
  togglePerformanceMode,
  setPerformanceMode,
  setRenderDistance,
  setRenderAll,
  setRenderResolutionScale,
  setRenderFpsLimit,
  setRenderFogEnabled,
  setRenderFogDistanceScale,
  setRenderDynamicResolution,
  setRenderDynamicResolutionTargetFps,
  setRenderDynamicResolutionMinScale,
  setGrassVisible,
  setGrassUseDetailedModel,
  setGrassDensityPercent,
  setGrassRenderDistance,
  setGrassDetailDistance,
  setGrassOcclusionEnabled,
  setGrassOcclusionInterval,
  setWallOcclusionQuality,
  setGrassWindPercent,
  removeSelected,
  onRename,
  onNumber,
  onColliderChange,
  onColliderVectorChange,
  colliderDebugVisible,
  toggleColliderDebug,
  onColor,
  onTexture,
  onTextureRepeat,
  onFaceTexture,
  colorHex,
  regenerateTerrain,
  clearTerrain,
  newProject,
  openProject,
  saveProject,
} = useEditor(canvas)

function updateControlMapSettings(settings: ControlMapSettings) {
  controlMapSettings.value = settings
  saveControlMapSettings(settings)
}
watch(activeControlMap, profile => {
  if (profile) setControlBindings(profile.bindings)
}, { immediate: true, deep: true })

// Mantém as variáveis expostas ao HUD sincronizadas com eventos e scripts executados no modo Run.
let hudVariablePollTimer: number | null = null
function syncHudRuntimeVariables() {
  globalLogicVariables.value = readRuntimeGlobalVariables()
}
watch(executionMode, mode => {
  if (hudVariablePollTimer !== null) {
    window.clearInterval(hudVariablePollTimer)
    hudVariablePollTimer = null
  }
  syncHudRuntimeVariables()
  if (mode === 'running') {
    hudVariablePollTimer = window.setInterval(syncHudRuntimeVariables, 100)
  }
}, { immediate: true })
onBeforeUnmount(() => {
  if (hudVariablePollTimer !== null) window.clearInterval(hudVariablePollTimer)
})

const skyFileInput = ref<HTMLInputElement | null>(null)
const playerModelFileInput = ref<HTMLInputElement | null>(null)
const skyTextureName = ref('')
function onSkyTextureSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) { status.value = 'Escolha um arquivo de imagem para o céu.'; return }
  if (file.size > 20 * 1024 * 1024) { status.value = 'A textura do céu deve ter no máximo 20 MB.'; return }
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result !== 'string') return
    skyTextureName.value = file.name
    setSkyTexture(reader.result)
  }
  reader.onerror = () => { status.value = 'Não foi possível ler a imagem do céu.' }
  reader.readAsDataURL(file)
}
function clearSkyTexture() { skyTextureName.value = ''; setSkyTexture('') }
async function onPlayerModelSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await setPlayerModelFile(file)
}
const timeOfDayLabel = computed(() => {
  const totalMinutes = Math.round(Math.max(0, Math.min(24, timeOfDay.value)) * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
})
function handleTimeOfDayKeydown(event: KeyboardEvent) {
  const keySteps: Record<string, number> = {
    ArrowRight: 0.25,
    ArrowUp: 0.25,
    ArrowLeft: -0.25,
    ArrowDown: -0.25,
    PageUp: 1,
    PageDown: -1,
  }
  const step = keySteps[event.key]
  if (step === undefined) return
  event.preventDefault()
  setTimeOfDay(Number(Math.max(0, Math.min(24, timeOfDay.value + step)).toFixed(4)))
}

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

const viewportCursorClass = computed(() => {
  if (tool.value === 'terrain') return 'cursor-editar-terreno'
  if (tool.value === 'grass') return 'cursor-pintar-grama'
  if (tool.value === 'build') return 'cursor-construir'
  if (tool.value === 'select' && selectedId.value && selectedId.value !== TERRAIN_ID) {
    if (transform.value === 'rotate') return 'cursor-rotacionar'
    if (transform.value === 'scale') return 'cursor-escalar'
    return 'cursor-mover'
  }
  return 'cursor-selecionar'
})

const selected = computed(() => objects.value.find((o) => o.id === selectedId.value) ?? null)
const inspectorMode = computed(() => selected.value ? 'object' : selectedId.value === TERRAIN_ID ? 'terrain' : 'environment')
watch(selectedId, () => { inspectorTab.value = 'transform'; publicLibraryOpen.value = false })
function copyObjectId(id: string) {
  void navigator.clipboard?.writeText(id)
}
function toggleFirstPerson() {
  firstPersonMode.value = !firstPersonMode.value
  setFirstPersonMode(firstPersonMode.value)
}
function cycleCameraView() {
  if (firstPersonMode.value) {
    firstPersonMode.value = false
    setFirstPersonMode(false)
  }
  cycleCamera()
}
function handleHudToggleCamera() {
  if (executionMode.value === 'running') cycleCameraView()
}
function handleHudExitRuntime() {
  if (executionMode.value === 'running') returnToEdit()
}
function handleHudGlobalVariable(name: string, value: string | number | boolean) {
  if (executionMode.value !== 'running') return
  // Equipamentos, arquétipos e espaços de habilidade escrevem diretamente
  // no runtime para que a seleção afete imediatamente a lógica de combate.
  setRuntimeGlobalVariable(name, value)
}
function runWorld() {
  graphOpen.value = false
  if (firstPersonMode.value) {
    firstPersonMode.value = false
    setFirstPersonMode(false)
  }
  setRuntimeMode(true)
  executionMode.value = 'running'
  status.value = `Modo Run ativo · mapa “${activeControlMap.value.name}”. Use Controles para personalizar as teclas.`
}
function returnToEdit() {
  // Atualiza a interface mesmo se algum recurso do runtime falhar ao ser encerrado.
  try {
    if (firstPersonMode.value) {
      firstPersonMode.value = false
      setFirstPersonMode(false)
    }
    setRuntimeMode(false)
  } catch (error) {
    console.error('Falha ao encerrar o modo Run:', error)
    status.value = 'Ocorreu um erro ao encerrar o jogo. O editor foi reativado; confira o console.'
  } finally {
    executionMode.value = 'edit'
    if (!status.value.includes('Ocorreu um erro ao encerrar')) {
      status.value = 'Modo de edição · câmera livre e ferramentas habilitadas.'
    }
  }
}
const selectedObjectRules = computed(() => logicRules.value.filter(rule => ownerOfRule(rule) === selectedId.value))
const selectedObjectPackages = computed(() => behaviorPackages.value.filter(instance => instance.ownerObjectId === selectedId.value))
const selectedRulePackageDefinition = computed(() => getBehaviorPackageDefinition(rulePackageId.value))
const selectedRulePackageVariables = computed(() => selectedObjectPackages.value.find(instance => instance.packageId === rulePackageId.value)?.variables ?? {})
const selectedWritablePackageVariables = computed(() => selectedRulePackageDefinition.value?.variables.filter(variable => !variable.readOnly) ?? [])

watch(rulePackageId, (packageId) => {
  const definition = getBehaviorPackageDefinition(packageId)
  if (!definition) return
  if (!definition.triggers.some(trigger => trigger.id === rulePackageEventId.value)) {
    rulePackageEventId.value = definition.triggers[0]?.id ?? ''
  }
  if (!definition.variables.some(variable => variable.name === rulePackageVariableName.value && !variable.readOnly)) {
    rulePackageVariableName.value = definition.variables.find(variable => !variable.readOnly)?.name ?? ''
  }
}, { immediate: true })

watch([ruleTrigger, rulePackageId, selectedRulePackageVariables, logicVariables], () => {
  const available = ruleTrigger.value === 'package_event'
    ? selectedRulePackageVariables.value
    : logicVariables.value
  if (!Object.prototype.hasOwnProperty.call(available, conditionVariable.value)) {
    conditionVariable.value = Object.keys(available)[0] ?? 'has_key'
  }
})

function onRulePackageChange(packageId: string) {
  rulePackageId.value = packageId
}
const installedPackageDefinitions = computed(() => selectedObjectPackages.value.flatMap(instance => {
  const definition = getBehaviorPackageDefinition(instance.packageId)
  return definition ? [{ instance, definition }] : []
}))
const availableBehaviorPackages = computed(() => BEHAVIOR_PACKAGE_DEFINITIONS.filter(definition =>
  !selectedObjectPackages.value.some(instance => instance.packageId === definition.id),
))

function onPackageVariableChange(instance: BehaviorPackageInstance, variable: BehaviorPackageDefinition['variables'][number], event: Event) {
  const target = event.target as HTMLInputElement | HTMLSelectElement
  let value: PackageScalar
  if (variable.type === 'boolean') {
    value = (target as HTMLInputElement).checked
  } else if (variable.type === 'number') {
    const raw = target.value.trim().replace(',', '.')
    const parsed = Number(raw)
    if (raw === '' || !Number.isFinite(parsed)) return
    value = Math.max(variable.min ?? Number.NEGATIVE_INFINITY, Math.min(variable.max ?? Number.POSITIVE_INFINITY, parsed))
  } else {
    value = target.value
  }
  updateBehaviorPackage(instance.id, { variables: { [variable.name]: value } })
}

function onPackageConfigChange(instance: BehaviorPackageInstance, name: string, value: PackageJsonValue) {
  updateBehaviorPackage(instance.id, { config: { [name]: value } })
}

function onPackageSeatOffsetChange(instance: BehaviorPackageInstance, axis: 0 | 1 | 2, event: Event) {
  const target = event.target as HTMLInputElement
  const parsed = Number(target.value.trim().replace(',', '.'))
  if (!Number.isFinite(parsed)) return
  const raw = instance.config.seatOffset
  const offset: [number, number, number] = Array.isArray(raw) && raw.length === 3
    ? [Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0]
    : [0, 0.55, 0]
  offset[axis] = Math.max(-10, Math.min(10, parsed))
  onPackageConfigChange(instance, 'seatOffset', offset)
}


type MountModelStateDraft = {
  id: string
  nodePath: string
  variable: string
  operator: 'equals' | 'not_equals'
  value: PackageScalar
  visibleWhenMatched: boolean
}

function getMountModelStates(instance: BehaviorPackageInstance): MountModelStateDraft[] {
  const raw = instance.config.modelStates
  if (!Array.isArray(raw)) return []
  const states: MountModelStateDraft[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, PackageJsonValue>
    const value = record.value
    if (typeof record.id !== 'string' || typeof record.nodePath !== 'string' || !record.nodePath ||
        typeof record.variable !== 'string' || !record.variable ||
        (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string')) continue
    states.push({
      id: record.id,
      nodePath: record.nodePath,
      variable: record.variable,
      operator: record.operator === 'not_equals' ? 'not_equals' : 'equals',
      value,
      visibleWhenMatched: record.visibleWhenMatched !== false,
    })
  }
  return states
}

function writeMountModelStates(instance: BehaviorPackageInstance, states: MountModelStateDraft[]) {
  onPackageConfigChange(instance, 'modelStates', states.map(state => ({
    id: state.id,
    nodePath: state.nodePath,
    variable: state.variable,
    operator: state.operator,
    value: state.value,
    visibleWhenMatched: state.visibleWhenMatched,
  })) as unknown as PackageJsonValue)
}

function mountStateVariableOptions(instance: BehaviorPackageInstance): Array<{ name: string; value: PackageScalar }> {
  const options = new Map<string, PackageScalar>()
  Object.entries(instance.variables).forEach(([name, value]) => options.set(name, value))
  Object.entries(logicVariables.value).forEach(([name, value]) => { if (!options.has(name)) options.set(name, value) })
  Object.entries(globalLogicVariables.value).forEach(([name, value]) => { if (!options.has(name)) options.set(name, value) })
  return [...options.entries()].map(([name, value]) => ({ name, value }))
}

function updateMountModelState(
  instance: BehaviorPackageInstance,
  stateId: string,
  patch: Partial<MountModelStateDraft>,
) {
  const states = getMountModelStates(instance).map(state => state.id === stateId ? { ...state, ...patch } : state)
  writeMountModelStates(instance, states)
}

function addMountModelState(instance: BehaviorPackageInstance) {
  const firstNode = selectedModelNodes.value[0]
  if (!firstNode) {
    status.value = 'Este objeto não possui partes de modelo 3D configuráveis. Importe um GLB com nós ou malhas.'
    return
  }
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'mount-state-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  const states = getMountModelStates(instance)
  states.push({
    id,
    nodePath: firstNode.path,
    variable: 'mounted',
    operator: 'equals',
    value: true,
    visibleWhenMatched: true,
  })
  writeMountModelStates(instance, states)
}

function removeMountModelState(instance: BehaviorPackageInstance, stateId: string) {
  writeMountModelStates(instance, getMountModelStates(instance).filter(state => state.id !== stateId))
}

function onMountModelStateValueChange(instance: BehaviorPackageInstance, stateId: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const trimmed = raw.trim()
  const value: PackageScalar = trimmed === 'true' ? true
    : trimmed === 'false' ? false
      : trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw
  updateMountModelState(instance, stateId, { value })
}

function addBehaviorPackage(packageId: string) {
  const instanceId = installBehaviorPackage(packageId)
  if (instanceId) inspectorTab.value = 'packages'
}

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
const publicLogicRules = computed(() => logicRules.value.filter(rule => ownerOfRule(rule) !== selectedId.value))
const cameraLabel = computed(() => CAMERA_LABELS[cameraPreset.value])
async function refreshSavedComponents() {
  try {
    savedComponents.value = await listSavedComponents()
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível carregar a biblioteca de componentes.'
  }
}

async function backfillMissingComponentThumbnails() {
  if (componentThumbnailBackfillRunning) return
  const missing = savedComponents.value.filter(component => !component.thumbnail)
  if (!missing.length) return

  componentThumbnailBackfillRunning = true
  let changed = false
  try {
    for (const metadata of missing) {
      try {
        const component = await getSavedComponent(metadata.id)
        if (!component || component.thumbnail) continue
        const thumbnail = await generateComponentThumbnail(component.bytes)
        if (!thumbnail) continue
        component.thumbnail = thumbnail
        await saveComponentAsset(component)
        changed = true
        savedComponents.value = savedComponents.value.map(item =>
          item.id === component.id ? { ...item, thumbnail } : item,
        )
      } catch (error) {
        console.warn('[ComponentLibrary] Não foi possível criar a miniatura de ' + metadata.name + '.', error)
      }
      // Permite que a interface responda entre uma miniatura e a próxima.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    }
    if (changed) await refreshSavedComponents()
  } finally {
    componentThumbnailBackfillRunning = false
  }
}

async function renameSavedComponent(id: string, requestedName: string) {
  const name = requestedName.trim().slice(0, 80)
  if (!name) {
    status.value = 'Informe um nome para o componente.'
    return
  }
  const normalized = name.toLocaleLowerCase('pt-BR')
  const duplicate = savedComponents.value.find(
    component => component.id !== id && component.name.trim().toLocaleLowerCase('pt-BR') === normalized,
  )
  if (duplicate) {
    status.value = 'Já existe um componente chamado "' + duplicate.name + '". Escolha outro nome.'
    return
  }

  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    // Atualiza apenas os metadados. O GLB, animações, colisor e ID permanecem intactos.
    component.name = name
    await saveComponentAsset(component)
    await refreshSavedComponents()
    status.value = 'Componente renomeado para "' + name + '".'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível renomear o componente.'
  }
}

async function handleUsePlayerModel(payload: { name: string; bytes: ArrayBuffer; animationRoles: Record<string, import('@engine').AnimationRole>; height: number }) {
  await setPlayerModelAsset(payload.bytes, payload.name, payload.animationRoles, payload.height)
}

async function handleSaveAnimationSource(payload: { name: string; bytes: ArrayBuffer; height: number }) {
  if (componentBusy.value) throw new Error('A biblioteca está ocupada. Tente salvar a fonte novamente.')
  if (!(payload.bytes instanceof ArrayBuffer) || payload.bytes.byteLength <= 20) {
    throw new Error('O GLB da fonte de animações está vazio ou inválido.')
  }
  componentBusy.value = true
  try {
    let thumbnail: string | undefined
    try {
      thumbnail = await generateComponentThumbnail(payload.bytes)
    } catch {
      thumbnail = undefined
    }
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2)
    const source: SavedComponent = {
      id,
      name: payload.name.trim() || 'Fonte de animação',
      libraryType: 'animation-source',
      kind: 'object',
      height: Number.isFinite(payload.height) && payload.height > 0 ? payload.height : 2,
      colliderType: 'none',
      colliderSize: [1, 1, 1],
      colliderOffset: [0, 0, 0],
      animationRoles: {},
      thumbnail,
      bytes: payload.bytes.slice(0),
      createdAt: Date.now(),
    }
    await saveComponentAsset(source)
    await refreshSavedComponents()
    status.value = 'Fonte de animações "' + source.name + '" salva. Ela fica na biblioteca de fontes e não será inserida no mundo.'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível salvar a fonte de animações.'
  } finally {
    componentBusy.value = false
  }
}

async function useSavedAnimationSource(id: string) {
  try {
    const source = await getSavedComponent(id)
    if (!source) throw new Error('Esta fonte de animações não está mais na biblioteca.')
    if (source.libraryType !== 'animation-source') {
      throw new Error('Este item não está categorizado como fonte de animações.')
    }
    // Se a janela já está aberta, mantém intacto o modelo A que está sendo editado.
    // Se estiver fechada, abre a fonte primeiro; depois, carregue o modelo A como destino.
    const targetAlreadyOpen = modelImportOpen.value
    if (!targetAlreadyOpen) previewComponentAsset.value = null
    previewAnimationSourceAsset.value = {
      id: source.id,
      name: source.name,
      bytes: source.bytes.slice(0),
      height: source.height,
      libraryType: 'animation-source',
    }
    modelImportOpen.value = true
    status.value = targetAlreadyOpen
      ? 'Carregando "' + source.name + '" como origem; o modelo A aberto foi mantido como destino.'
      : 'Fonte "' + source.name + '" carregada. Abra o modelo A no importador para usá-lo como destino.'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível carregar a fonte de animações.'
  }
}

async function previewSavedComponent(id: string) {
  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    previewComponentAsset.value = {
      id: component.id,
      name: component.name,
      bytes: component.bytes.slice(0),
      height: component.height,
      colliderType: component.colliderType,
      colliderSize: [...component.colliderSize],
      colliderOffset: [...component.colliderOffset],
      kind: component.kind,
      libraryType: component.libraryType ?? 'object',
      logic: component.logic,
      animationRoles: component.animationRoles,
      controlBindings: component.controlBindings,
      behaviorPackageIds: component.behaviorPackageIds,
      behaviorPackageSettings: component.behaviorPackageSettings,
      thumbnail: component.thumbnail,
    }
    modelImportOpen.value = true
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível abrir a prévia do componente.'
  }
}

function closeModelImport() {
  modelImportOpen.value = false
  previewComponentAsset.value = null
  previewAnimationSourceAsset.value = null
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

function disposeComponentSource(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    geometries.add(node.geometry)
    const list = Array.isArray(node.material) ? node.material : [node.material]
    list.forEach(material => {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    })
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => texture.dispose())
}

async function handleModelImport(payload: { name: string; model: import('three').Object3D; height: number; thumbnail?: string; componentId?: string; sourceGlbBytes?: ArrayBuffer; batchModels?: Array<{ partId: string; name: string; model: import('three').Object3D; height: number }> }): Promise<boolean> {
  if (componentBusy.value) {
    throw new Error('A biblioteca de componentes está ocupada com outra operação. Tente salvar novamente em alguns segundos.')
  }

  if (payload.batchModels?.length) {
    componentBusy.value = true
    const entries = payload.batchModels
    const savedComponents: SavedComponent[] = []
    status.value = `Preparando ${entries.length} componentes a partir do mesmo modelo…`
    try {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!
        status.value = `Exportando componente ${index + 1} de ${entries.length}: ${entry.name}…`
        const exportRoot = cloneSkinnedModel(entry.model)
        exportRoot.userData = { ...exportRoot.userData }
        for (const key of [
          'importAnimations', 'importGltfMetadata', 'importRecoveredTextures',
          'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl',
          'importAnimationRoles', 'importControlBindings', 'importRigPreset',
          'importRigGenerated', 'importRigBoneNames', 'importBehaviorPackageIds',
          'importBehaviorPackageSettings', 'importSourceGlbBytes', 'importNeedsReexport',
        ]) {
          delete exportRoot.userData[key]
        }

        const exporter = new GLTFExporter()
        const exported = await exporter.parseAsync(exportRoot, { binary: true, animations: [] })
        if (!(exported instanceof ArrayBuffer) || exported.byteLength <= 20) {
          throw new Error(`O exportador não gerou um GLB válido para "${entry.name}".`)
        }

        const modelData = entry.model.userData
        let thumbnail: string | undefined
        try {
          thumbnail = await generateComponentThumbnail(exported)
        } catch {
          thumbnail = undefined
        }

        const rawSize = modelData.importColliderSize
        const rawOffset = modelData.importColliderOffset
        const colliderType = modelData.importColliderType
        const id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + '-' + index.toString(36) + Math.random().toString(36).slice(2)
        savedComponents.push({
          id,
          name: entry.name.trim() || 'Modelo 3D',
          height: entry.height,
          colliderType: colliderType === 'sphere' || colliderType === 'capsule' || colliderType === 'mesh' || colliderType === 'none' ? colliderType : 'box',
          colliderSize: Array.isArray(rawSize) && rawSize.length === 3
            ? [...rawSize] as [number, number, number]
            : [1, 1, 1],
          colliderOffset: Array.isArray(rawOffset) && rawOffset.length === 3
            ? [...rawOffset] as [number, number, number]
            : [0, 0, 0],
          kind: 'object',
          libraryType: 'object',
          logic: undefined,
          behaviorPackageIds: Array.isArray(modelData.importBehaviorPackageIds)
            ? [...new Set((modelData.importBehaviorPackageIds as unknown[]).filter((value): value is string => typeof value === 'string'))]
            : [],
          behaviorPackageSettings: modelData.importBehaviorPackageSettings && typeof modelData.importBehaviorPackageSettings === 'object'
            ? modelData.importBehaviorPackageSettings as SavedComponent['behaviorPackageSettings']
            : {},
          animationRoles: {},
          controlBindings: modelData.importControlBindings as Partial<import('@engine').ModelControlBindings> | undefined,
          thumbnail,
          bytes: exported,
          createdAt: Date.now(),
        })
      }

      status.value = `Gravando ${savedComponents.length} componentes na biblioteca…`
      await saveComponentAssets(savedComponents)
      await refreshSavedComponents()
      status.value = `Pronto: ${savedComponents.length} componentes salvos da mesma importação. Você pode selecionar mais partes no importador sem abrir o arquivo novamente.`
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      status.value = `Não foi possível salvar o lote de componentes: ${message}`
      throw new Error(message)
    } finally {
      componentBusy.value = false
    }
  }

  if (payload.componentId) {
    componentBusy.value = true
    status.value = 'Exportando edições e salvando o componente existente…'
    let saved = false
    try {
      const existing = await getSavedComponent(payload.componentId)
      if (!existing) throw new Error('Este componente não está mais na biblioteca.')
      const modelData = payload.model.userData
      const rawPackageIds = modelData.importBehaviorPackageIds
      const rawPackageSettings = modelData.importBehaviorPackageSettings
      const animations = (modelData.importAnimations as THREE.AnimationClip[] | undefined) ?? []

      // Editar um componente precisa persistir o modelo 3D, não apenas os metadados.
      // Exporte um clone para incluir mudanças de malha, transformações, texturas,
      // remoções de partes e rigging sem modificar/destruir a prévia antes do commit.
      const exportRoot = cloneSkinnedModel(payload.model)
      const editorOnlyKeys = [
        'importAnimations', 'importGltfMetadata', 'importRecoveredTextures',
        'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl',
        'importAnimationRoles', 'importControlBindings', 'importRigPreset',
        'importRigGenerated', 'importRigBoneNames', 'importBehaviorPackageIds',
        'importBehaviorPackageSettings', 'importSourceGlbBytes', 'importNeedsReexport',
        'importColliderType', 'importColliderSize', 'importColliderOffset',
        'sceneKind', 'componentLogic',
      ]
      exportRoot.traverse(node => {
        node.userData = { ...node.userData }
        for (const key of editorOnlyKeys) delete node.userData[key]
      })
      const exporter = new GLTFExporter()
      const exported = await exporter.parseAsync(exportRoot, {
        binary: true,
        animations,
        // A hierarquia tem controles temporários de visibilidade para inspeção;
        // não deixe um nó apenas oculto na prévia desaparecer do componente salvo.
        onlyVisible: false,
      })
      if (!(exported instanceof ArrayBuffer) || exported.byteLength <= 20) {
        throw new Error('O exportador não gerou um GLB válido para o componente editado.')
      }

      const rawColliderType = modelData.importColliderType
      const rawColliderSize = modelData.importColliderSize
      const rawColliderOffset = modelData.importColliderOffset
      const validColliderSize = Array.isArray(rawColliderSize)
        && rawColliderSize.length === 3
        && rawColliderSize.every(value => typeof value === 'number' && Number.isFinite(value))
        ? rawColliderSize as [number, number, number]
        : existing.colliderSize
      const validColliderOffset = Array.isArray(rawColliderOffset)
        && rawColliderOffset.length === 3
        && rawColliderOffset.every(value => typeof value === 'number' && Number.isFinite(value))
        ? rawColliderOffset as [number, number, number]
        : existing.colliderOffset

      const updated: SavedComponent = {
        ...existing,
        name: payload.name.trim() || existing.name,
        libraryType: modelData.importHasModifiedAnimations === true
          ? 'animated-model'
          : (existing.libraryType ?? 'object'),
        height: Number.isFinite(payload.height) && payload.height > 0 ? payload.height : existing.height,
        bytes: exported,
        colliderType: rawColliderType === 'sphere' || rawColliderType === 'capsule' || rawColliderType === 'mesh' || rawColliderType === 'none'
          ? rawColliderType
          : 'box',
        colliderSize: validColliderSize,
        colliderOffset: validColliderOffset,
        // Tipo semântico e lógica são armazenados fora do GLB; mantê-los evita
        // apagar a configuração de entidade/eventos ao editar a aparência.
        kind: existing.kind,
        logic: existing.logic,
        behaviorPackageIds: Array.isArray(rawPackageIds)
          ? [...new Set(rawPackageIds.filter((id): id is string => typeof id === 'string'))]
          : [],
        behaviorPackageSettings: rawPackageSettings && typeof rawPackageSettings === 'object'
          ? rawPackageSettings as SavedComponent['behaviorPackageSettings']
          : {},
        animationRoles: modelData.importAnimationRoles as Record<string, import('@engine').AnimationRole> | undefined,
        controlBindings: modelData.importControlBindings as Partial<import('@engine').ModelControlBindings> | undefined,
        thumbnail: payload.thumbnail || existing.thumbnail,
      }
      await saveComponentAsset(updated)
      saved = true
      await refreshSavedComponents()
      status.value = 'Modelo 3D, colisão e configurações de "' + updated.name + '" salvos no componente existente.'
      return true
    } catch (error) {
      status.value = 'Não foi possível salvar as alterações: ' + (error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      componentBusy.value = false
      if (saved) disposeComponentSource(payload.model)
    }
  }

  componentBusy.value = true
  status.value = 'Salvando modelo na biblioteca de componentes…'
  let exportRoot: import('three').Object3D | null = null
  let savedComponentId: string | null = null
  let saveError: unknown = null
  try {
    let result: ArrayBuffer
    if (payload.sourceGlbBytes instanceof ArrayBuffer && payload.sourceGlbBytes.byteLength > 20) {
      // GLB já foi validado pelo GLTFLoader. Preserve o arquivo original quando
      // não houve edição da malha: evita falhas do GLTFExporter com texturas/
      // extensões válidas que o Three consegue carregar, mas não reexportar.
      result = payload.sourceGlbBytes.slice(0)
    } else {
      exportRoot = cloneSkinnedModel(payload.model)
      exportRoot.userData = { ...exportRoot.userData }
      for (const key of ['importAnimations', 'importGltfMetadata', 'importRecoveredTextures', 'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl', 'importRigPreset', 'importRigGenerated', 'importRigBoneNames', 'importBehaviorPackageIds', 'importBehaviorPackageSettings', 'importSourceGlbBytes', 'importNeedsReexport']) {
        delete exportRoot.userData[key]
      }

      const exporter = new GLTFExporter()
      const exported = await exporter.parseAsync(exportRoot, {
        binary: true,
        animations: (payload.model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? [],
      })
      if (!(exported instanceof ArrayBuffer)) throw new Error('O exportador não gerou um arquivo GLB válido.')
      result = exported
    }

    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2)
    const colliderType = payload.model.userData.importColliderType
    const size = payload.model.userData.importColliderSize
    const offset = payload.model.userData.importColliderOffset
    const rawPackageIds = payload.model.userData.importBehaviorPackageIds
    const rawPackageSettings = payload.model.userData.importBehaviorPackageSettings
    const component: SavedComponent = {
      id,
      name: payload.name.trim() || 'Modelo 3D',
      height: payload.height,
      colliderType: colliderType === 'sphere' || colliderType === 'capsule' || colliderType === 'mesh' || colliderType === 'none' ? colliderType : 'box',
      colliderSize: Array.isArray(size) && size.length === 3 ? [...size] as [number, number, number] : [1, 1, 1],
      colliderOffset: Array.isArray(offset) && offset.length === 3 ? [...offset] as [number, number, number] : [0, 0, 0],
      kind: payload.model.userData.sceneKind === 'entity' ? 'entity' : 'object',
      libraryType: payload.model.userData.importHasModifiedAnimations === true ? 'animated-model' : 'object',
      logic: Array.isArray(payload.model.userData.componentLogic) ? payload.model.userData.componentLogic as LogicRule[] : undefined,
      behaviorPackageIds: Array.isArray(rawPackageIds)
        ? [...new Set(rawPackageIds.filter((id): id is string => typeof id === 'string'))]
        : [],
      behaviorPackageSettings: rawPackageSettings && typeof rawPackageSettings === 'object'
        ? rawPackageSettings as SavedComponent['behaviorPackageSettings']
        : {},
      animationRoles: payload.model.userData.importAnimationRoles as Record<string, import('@engine').AnimationRole> | undefined,
      controlBindings: payload.model.userData.importControlBindings as Partial<import('@engine').ModelControlBindings> | undefined,
      thumbnail: payload.thumbnail,
      bytes: result,
      createdAt: Date.now(),
    }
    await saveComponentAsset(component)
    savedComponentId = id
    await refreshSavedComponents()
    status.value = 'Componente "' + component.name + '" salvo. Preparando para construir no mundo…'
  } catch (error) {
    saveError = error
    status.value = 'Não foi possível salvar o componente: ' + (error instanceof Error ? error.message : String(error))
  } finally {
    componentBusy.value = false
    // O clone compartilha recursos com a prévia: só os descartamos após gravar com sucesso.
    if (savedComponentId) {
      if (exportRoot) disposeComponentSource(exportRoot)
      disposeComponentSource(payload.model)
    }
  }

  if (!savedComponentId) {
    if (saveError instanceof Error) throw saveError
    throw new Error('O componente não foi gravado na biblioteca.')
  }

  await placeSavedComponent(savedComponentId)
  return true
}

async function placeSavedComponent(id: string) {
  if (componentBusy.value) return
  componentBusy.value = true
  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    if (component.libraryType === 'animation-source') {
      status.value = '"' + component.name + '" é uma fonte de animações. Use "Usar origem" na biblioteca para carregá-la no retargeting; fontes não são inseridas no mundo.'
      return
    }
    const loader = new GLTFLoader()
    const model = await new Promise<import('three').Object3D>((resolve, reject) => {
      loader.parse(component.bytes.slice(0), '', gltf => {
        gltf.scene.userData.importAnimations = gltf.animations ?? []
        gltf.scene.userData.importAnimationRoles = component.animationRoles
        gltf.scene.userData.importControlBindings = component.controlBindings
        resolve(gltf.scene)
      }, reject)
    })
    // Não renomeie nem transforme o nó raiz do glTF aqui: os clips podem usar
    // seu nome e seus transforms. Engine.addImportedModel aplica escala e centro
    // num pivô externo, mantendo animação, seleção e colisor alinhados.
    model.updateMatrixWorld(true)
    const sourceBounds = new THREE.Box3().setFromObject(model)
    const sourceSize = sourceBounds.getSize(new THREE.Vector3())
    if (sourceBounds.isEmpty() || sourceSize.y <= 0) throw new Error('O componente não contém dimensões válidas.')
    model.userData.importPart = true
    if (component.kind === 'entity') {
      // A biblioteca declara a semântica. O GLB é marcado como entidade genérica
      // antes de entrar no World; o Engine transfere esses metadados para a raiz.
      markEntity(model, {
        componentId: component.id,
        componentLogic: component.logic ?? [],
      })
    } else {
      model.userData.sceneKind = 'object'
      model.userData.componentId = component.id
      model.userData.componentLogic = component.logic ?? []
    }
    model.userData.importedModelData = arrayBufferToBase64(component.bytes)
    model.userData.importedModelHeight = component.height
    model.userData.importBehaviorPackageIds = [...(component.behaviorPackageIds ?? [])]
    model.userData.importBehaviorPackageSettings = cloneSavedBehaviorPackageSettings(component.behaviorPackageSettings ?? {})
    model.userData.importColliderType = component.colliderType
    model.userData.importColliderSize = [...component.colliderSize]
    model.userData.importColliderOffset = [...component.colliderOffset]
    setBuildComponentPlacement(component.name, model, component.height)
    status.value = 'Componente "' + component.name + '" selecionado. Clique em Construir e depois no ponto do mundo onde deseja colocá-lo.'
  } catch (error) {
    status.value = 'Não foi possível inserir o componente: ' + (error instanceof Error ? error.message : String(error))
  } finally {
    componentBusy.value = false
  }
}

async function removeSavedComponent(id: string) {
  const component = savedComponents.value.find(item => item.id === id)
  if (!component || !window.confirm('Excluir "' + component.name + '" da biblioteca? Os objetos já colocados no mundo não serão removidos.')) return
  try {
    await deleteSavedComponent(id)
    await refreshSavedComponents()
    status.value = 'Componente removido da biblioteca.'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível excluir o componente.'
  }
}

onMounted(() => {
  void (async () => {
    // Remove da biblioteca local o componente legado criado por versões anteriores.
    try {
      await deleteSavedComponent('builtin-horse-low-poly')
    } catch (error) {
      console.warn('[ComponentLibrary] Não foi possível remover um componente legado.', error)
    }
    await refreshSavedComponents()
  })()
})

async function moveSavedComponentGroup(id: string, group: string) {
  const normalizedGroup = group.trim().slice(0, 48)
  if (!normalizedGroup) return
  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    if (component.group === normalizedGroup) return
    component.group = normalizedGroup
    await saveComponentAsset(component)
    await refreshSavedComponents()
    status.value = 'Componente movido para "' + normalizedGroup + '".'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível mover o componente de grupo.'
  }
}

function closeQuickAddOutside(event: PointerEvent) {
  const target = event.target
  if (target instanceof Element && !target.closest('.quick-add-wrap')) quickAddOpen.value = false
}

async function toggleWorldFullscreen() {
  if (fullscreenTransition.value) return
  fullscreenTransition.value = true
  const entering = !worldFullscreen.value

  try {
    if (entering) {
      quickAddOpen.value = false

      // Primeiro deixe o sistema nativo colocar o WebView em tela cheia.
      // Só aplique o layout que oculta os painéis depois da troca de janela,
      // para não mudar o canvas enquanto o Windows redimensiona sua superfície.
      if (isTauri()) {
        const appWindow = getCurrentWindow()
        await appWindow.setFullscreen(true)

        if (!(await appWindow.isFullscreen())) {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          })
          await appWindow.setFullscreen(true)
        }

        if (!(await appWindow.isFullscreen())) {
          console.warn('O Tauri não confirmou a tela cheia nativa; aplicando o modo expandido do viewport.')
        }
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
      } else if (!document.fullscreenElement) {
        const fullscreenTarget = appRoot.value
        const request = fullscreenTarget && typeof fullscreenTarget.requestFullscreen === 'function'
          ? fullscreenTarget.requestFullscreen()
          : document.documentElement.requestFullscreen()
        await request
      }

      worldFullscreen.value = true
      await syncFullscreenViewportBounds()
    } else {
      // Saia do modo nativo antes de reativar o layout normal dos painéis.
      if (isTauri()) {
        const appWindow = getCurrentWindow()
        if (await appWindow.isFullscreen()) {
          await appWindow.setFullscreen(false)
          if (await appWindow.isFullscreen()) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            await appWindow.setFullscreen(false)
          }
        }
      } else if (document.fullscreenElement) {
        await document.exitFullscreen()
      }

      worldFullscreen.value = false
    }
  } catch (error) {
    console.warn('Não foi possível concluir a transição nativa de tela cheia; usando o layout recuperável da viewport.', error)
    // Se o host recusar a operação, ainda permita expandir/recolher a cena via CSS.
    worldFullscreen.value = entering
    if (entering) await syncFullscreenViewportBounds()
  } finally {
    fullscreenTransition.value = false
  }

  await settleViewportAfterFullscreenChange()
}

async function syncFullscreenViewportBounds(): Promise<void> {
  if (!worldFullscreen.value) return

  // Use o tamanho real calculado pelo WebView, não a resolução do monitor.
  // O CSS aplica inset: 0 e o ResizeObserver mede o canvas já redimensionado.
  await nextTick()
  refreshViewportLayoutBounds()
  viewportLayoutRefresh.value += 1
  window.dispatchEvent(new Event('resize'))
}

function handleWorldFullscreenKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !worldFullscreen.value) return

  // No navegador, deixe o próprio Fullscreen API tratar Esc para não disputar
  // com a saída da tela cheia nativa. Se só o modo CSS estiver ativo, saia daqui.
  if (!isTauri() && document.fullscreenElement) return

  event.preventDefault()
  void toggleWorldFullscreen()
}

async function settleViewportAfterFullscreenChange(): Promise<void> {
  // Primeiro deixe o Windows/WebView concluir a troca de tamanho.
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

  // A primeira leitura pode retornar o tamanho anterior porque setFullscreen()
  // conclui antes do evento de redimensionamento do WebView. Leia novamente
  // somente depois dos dois frames para que a raiz não pare na antiga altura.
  if (worldFullscreen.value) {
    await syncFullscreenViewportBounds()
    // Uma segunda estabilização permite aplicar as dimensões atualizadas no DOM.
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  refreshViewportLayoutBounds()
  viewportLayoutRefresh.value += 1
  // Acorda o ResizeObserver do canvas e recalcula câmera/renderização.
  window.dispatchEvent(new Event('resize'))
}

function syncWorldFullscreenAfterBrowserExit() {
  if (!isTauri() && worldFullscreen.value && !document.fullscreenElement) {
    worldFullscreen.value = false
    void settleViewportAfterFullscreenChange()
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', closeQuickAddOutside)
  window.addEventListener('keydown', handleWorldFullscreenKeydown)
  document.addEventListener('fullscreenchange', syncWorldFullscreenAfterBrowserExit)
  if (isTauri()) {
    void getCurrentWindow().onResized(() => {
      if (worldFullscreen.value) void syncFullscreenViewportBounds()
    }).then((unlisten) => {
      unlistenNativeWindowResize = unlisten
    }).catch((error) => {
      console.warn('Não foi possível observar o redimensionamento da janela.', error)
    })
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeQuickAddOutside)
  window.removeEventListener('keydown', handleWorldFullscreenKeydown)
  document.removeEventListener('fullscreenchange', syncWorldFullscreenAfterBrowserExit)
  unlistenNativeWindowResize?.()
  unlistenNativeWindowResize = null
})

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

const hint = 'Arraste para orbitar · Botão direito move · Roda para zoom · W mover · E rotacionar · R escalar'

  return {
    CAMERA_LABELS,
    ENGINE_VERSION,
    TERRAIN_ID,
    TOOLS,
    TRANSFORMS,
    activeControlMap,
    activeViewportLayoutItem,
    addBehaviorPackage,
    addClickableCubeExample,
    addLogicRule,
    addMountModelState,
    addPrimitive,
    addSpawnPlatform,
    appRoot,
    availableBehaviorPackages,
    backfillMissingComponentThumbnails,
    beginViewportLayoutDrag,
    brushRadius,
    brushStrength,
    cameraLabel,
    cameraPreset,
    canvas,
    changeGraphRuleActionPackage,
    changeGraphRulePackage,
    clearSkyTexture,
    clearTerrain,
    closeModelImport,
    colliderDebugVisible,
    colorHex,
    conditionOperator,
    conditionValue,
    conditionVariable,
    controlMapSettings,
    controlMapsOpen,
    copyObjectId,
    cycleCameraView,
    dayNightCycleEnabled,
    dayNightCycleSpeed,
    deleteLogicRule,
    deleteLogicVariable,
    dirty,
    dragCanvas,
    endNodeDrag,
    executionMode,
    firstPersonMode,
    fps,
    getBehaviorPackageDefinition,
    getMountModelStates,
    globalConditionVariables,
    globalLogicVariables,
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
    grassDensityPercent,
    grassMiddleDetailDistance,
    grassNearDetailDistance,
    grassOcclusionEnabled,
    grassOcclusionIntervalMs,
    grassRenderDistance,
    grassRenderDistanceMode,
    grassUseDetailedModel,
    grassVisible,
    grassWindPercent,
    gridVisible,
    groupSelectedObjects,
    groupSelection,
    handleHudExitRuntime,
    handleHudGlobalVariable,
    handleHudToggleCamera,
    handleModelImport,
    handleSaveAnimationSource,
    handleTimeOfDayKeydown,
    handleUsePlayerModel,
    hint,
    importPublicRule,
    inspectorMode,
    inspectorTab,
    installedPackageDefinitions,
    ioProgress,
    logicRules,
    logicVariables,
    markDirty,
    modelImportOpen,
    mountStateVariableOptions,
    moveLogicRule,
    moveNode,
    moveSavedComponentGroup,
    newEventName,
    newProject,
    newVariableName,
    newVariableType,
    newVariableValue,
    nodeTitle,
    objects,
    onColliderChange,
    onColliderVectorChange,
    onColor,
    onFaceTexture,
    onGraphWheel,
    onMountModelStateValueChange,
    onNewVariableTypeChange,
    onNumber,
    onPackageConfigChange,
    onPackageSeatOffsetChange,
    onPackageVariableChange,
    onPlayerModelSelected,
    onRename,
    onRulePackageChange,
    onScriptDraftInput,
    onSkyTextureSelected,
    onTexture,
    onTextureRepeat,
    openHudSettingsFromViewportLayout,
    openObjectRule,
    openProject,
    ownerOfRule,
    patchSelectedAction,
    patchSelectedCondition,
    patchSelectedTrigger,
    performanceMode,
    persistViewportLayout,
    placeSavedComponent,
    placeableSavedComponents,
    playerHudSettingsOpen,
    playerModelCustom,
    playerModelFileInput,
    playerModelHeight,
    playerModelName,
    polygonLinesVisible,
    previewAnimationSourceAsset,
    previewComponentAsset,
    previewSavedComponent,
    projectName,
    publicLibraryOpen,
    publicLogicRules,
    quickAddOpen,
    regenerateTerrain,
    removeBehaviorPackage,
    removeMountModelState,
    removeSavedComponent,
    removeSelected,
    renameSavedComponent,
    renderAll,
    renderDistance,
    renderDynamicResolution,
    renderDynamicResolutionMinScale,
    renderDynamicResolutionTargetFps,
    renderFogDistanceScale,
    renderFogEnabled,
    renderFpsLimit,
    renderResolutionScale,
    renderStats,
    resetAllViewportLayout,
    resetGraphView,
    resetPlayerModel,
    resetViewportLayoutItem,
    returnToEdit,
    rootOpen,
    ruleAction,
    ruleConditionEnabled,
    rulePackageEventId,
    rulePackageId,
    rulePackageVariableName,
    rulePackageVariableValue,
    ruleTrigger,
    ruleValueFromInput,
    runWorld,
    saveProject,
    savedAnimationSourceOptions,
    savedComponents,
    scriptDraft,
    selectItem,
    selectableViewportLayoutItems,
    selected,
    selectedGraphRule,
    selectedGraphRuleActionVariables,
    selectedGraphRulePackages,
    selectedId,
    selectedModelNodes,
    selectedObjectPackages,
    selectedObjectRules,
    selectedRulePackageDefinition,
    selectedRulePackageVariables,
    selectedWritablePackageVariables,
    setDayNightCycleEnabled,
    setDayNightCycleSpeed,
    setGrassDensityPercent,
    setGrassDetailDistance,
    setGrassOcclusionEnabled,
    setGrassOcclusionInterval,
    setGrassRenderDistance,
    setGrassUseDetailedModel,
    setGrassVisible,
    setGrassWindPercent,
    setLogicVariableValue,
    setPerformanceMode,
    setRenderAll,
    setRenderDistance,
    setRenderDynamicResolution,
    setRenderDynamicResolutionMinScale,
    setRenderDynamicResolutionTargetFps,
    setRenderFogDistanceScale,
    setRenderFogEnabled,
    setRenderFpsLimit,
    setRenderResolutionScale,
    setSelectedActionType,
    setSelectedTriggerType,
    setTimeOfDay,
    setTool,
    setTransform,
    setWallOcclusionQuality,
    sidebarCollapsed,
    sidebarScriptDraft,
    skyFileInput,
    skyTextureDataUrl,
    skyTextureName,
    startGraphPan,
    startNodeDrag,
    status,
    submitVariable,
    terrain,
    timeOfDay,
    timeOfDayLabel,
    toggleColliderDebug,
    toggleFirstPerson,
    toggleGrid,
    toggleLogicRule,
    toggleObjectLock,
    toggleObjectWireframe,
    togglePerformanceMode,
    togglePolygonLines,
    toggleTerrain,
    toggleViewportLayoutConfig,
    toggleVisible,
    toggleWorldFullscreen,
    tool,
    transform,
    ungroupSelectedObjects,
    updateBehaviorPackage,
    updateControlMapSettings,
    updateLogicRule,
    updateMountModelState,
    updateViewportLayoutPercent,
    updateViewportLayoutScale,
    useGlobalVariableOnObject,
    useSavedAnimationSource,
    viewportCursorClass,
    viewportLayout,
    viewportLayoutConfigOpen,
    viewportLayoutEditMode,
    viewportLayoutOutlineStyle,
    viewportLayoutStyle,
    viewportRoot,
    wallOcclusionQuality,
    worldFullscreen,
    zoomGraph,
  }
}
