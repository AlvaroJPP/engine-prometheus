<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ENGINE_VERSION, TERRAIN_ID, markEntity, BEHAVIOR_PACKAGE_DEFINITIONS, getBehaviorPackageDefinition } from '@engine'
import type { ToolMode, TransformMode, LogicRule, BehaviorPackageInstance, BehaviorPackageDefinition, PackageJsonValue, PackageScalar, ControlMapSettings } from '@engine'
import { CAMERA_LABELS, useEditor } from '@/composables/useEditor'
import ControlMapsDialog from '@/components/ControlMapsDialog.vue'
import { loadControlMapSettings, saveControlMapSettings } from '@/lib/controls/controlMapSettings'
import EditorTopBar from '@/components/EditorTopBar.vue'
import EditorToolbar from '@/components/EditorToolbar.vue'
import SceneHierarchy from '@/components/SceneHierarchy.vue'
import ModelImportDialog from '@/components/ModelImportDialog.vue'
import FaceTextureEditor from '@/components/FaceTextureEditor.vue'
import PlayerHUD from '@/components/PlayerHUD.vue'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import { deleteSavedComponent, getSavedComponent, listSavedComponents, saveComponentAsset, saveComponentAssets } from '@/lib/assets/ComponentLibrary'
import type { SavedComponent } from '@/lib/assets/ComponentLibrary'
import { generateComponentThumbnail } from '@/lib/assets/ComponentThumbnail'

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

const canvas = ref<HTMLCanvasElement | null>(null)
const rootOpen = ref(true)
const sidebarCollapsed = ref(false)
const inspectorTab = ref<'transform' | 'color' | 'variables' | 'nodes' | 'packages'>('transform')
const executionMode = ref<'edit' | 'running'>('edit')
const worldFullscreen = ref(false)
const playerHudSettingsOpen = ref(false)

type ViewportLayoutId = 'render' | 'fps' | 'axes' | 'tools'
type ViewportLayoutItem = { x: number; y: number; scale: number }
type ViewportLayoutSettings = Record<ViewportLayoutId, ViewportLayoutItem>

const VIEWPORT_LAYOUT_STORAGE_KEY = 'engine-prometheus.viewport-layout.v1'
const DEFAULT_VIEWPORT_LAYOUT: ViewportLayoutSettings = {
  render: { x: 0.29, y: 0.015, scale: 1 },
  fps: { x: 0.66, y: 0.04, scale: 1 },
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
    const saved = JSON.parse(localStorage.getItem(VIEWPORT_LAYOUT_STORAGE_KEY) || '{}') as Partial<ViewportLayoutSettings>
    const result = {} as ViewportLayoutSettings
    for (const id of ['render', 'fps', 'axes', 'tools'] as const) {
      const candidate = saved[id]
      const fallback = DEFAULT_VIEWPORT_LAYOUT[id]
      result[id] = {
        x: boundedLayoutNumber(candidate?.x, fallback.x, 0, 1),
        y: boundedLayoutNumber(candidate?.y, fallback.y, 0, 1),
        scale: boundedLayoutNumber(candidate?.scale, fallback.scale, 0.55, 1.6),
      }
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
  if (!target || rect.width <= 0 || viewportLayoutUsableHeight.value <= 0) return 1.6
  const width = Math.max(1, target.offsetWidth)
  const height = Math.max(1, target.offsetHeight)
  return Math.max(0.55, Math.min(1.6, (rect.width - 8) / width, (viewportLayoutUsableHeight.value - 8) / height))
}
function viewportLayoutStyle(id: ViewportLayoutId): Record<string, string> {
  void viewportLayoutRefresh.value
  const bounds = viewportLayoutBounds.value
  const item = viewportLayout.value[id]
  const target = getViewportLayoutTarget(id)
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, viewportLayoutUsableHeight.value)
  const scaledWidth = (target?.offsetWidth || 180) * item.scale
  const scaledHeight = (target?.offsetHeight || 80) * item.scale
  const localX = Math.max(0, Math.min(item.x * width, width - scaledWidth - 4))
  const localY = Math.max(0, Math.min(item.y * height, height - scaledHeight - 4))
  return {
    '--viewport-layout-left': Math.round(bounds.left + localX) + 'px',
    '--viewport-layout-top': Math.round(bounds.top + localY) + 'px',
    '--viewport-layout-scale': String(item.scale),
    '--viewport-layout-max-width': Math.max(120, width - localX - 8) + 'px',
    '--viewport-layout-max-height': Math.max(80, height - localY - 8) + 'px',
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
  const root = viewportRoot.value
  if (!root) return
  const rootRect = root.getBoundingClientRect()
  const width = Math.max(1, rootRect.width)
  const height = Math.max(1, rootRect.height - (executionMode.value === 'edit' && !worldFullscreen.value ? 28 : 0))
  viewportLayoutBounds.value = { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: rootRect.height }
  const target = getViewportLayoutTarget(id)
  const item = viewportLayout.value[id]
  if (!target) return
  item.scale = Math.min(item.scale, getViewportLayoutMaximumScale(id, target))
  const targetWidth = Math.max(1, target.offsetWidth) * item.scale
  const targetHeight = Math.max(1, target.offsetHeight) * item.scale
  const maxX = Math.max(0, width - targetWidth - 4)
  const maxY = Math.max(0, height - targetHeight - 4)
  item.x = Math.max(0, Math.min(maxX, item.x * width)) / width
  item.y = Math.max(0, Math.min(maxY, item.y * height)) / height
}
function clampAllViewportLayoutItems(): void {
  for (const item of viewportLayoutItems) clampViewportLayoutItem(item.id)
  viewportLayoutRefresh.value += 1
}
function refreshViewportLayoutBounds(): void {
  const root = viewportRoot.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  viewportLayoutBounds.value = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  void nextTick(() => {
    clampAllViewportLayoutItems()
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
  const item = viewportLayout.value[activeViewportLayoutItem.value]
  item[axis] = Math.max(0, Math.min(1, value / 100))
  viewportLayoutRefresh.value += 1
  void nextTick(() => clampViewportLayoutItem(activeViewportLayoutItem.value))
}
function updateViewportLayoutScale(value: number): void {
  const id = activeViewportLayoutItem.value
  viewportLayout.value[id].scale = Math.max(0.55, Math.min(getViewportLayoutMaximumScale(id), value / 100))
  viewportLayoutRefresh.value += 1
  void nextTick(() => clampViewportLayoutItem(id))
}
function resetViewportLayoutItem(id: ViewportLayoutId): void {
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
    tools: { ...DEFAULT_VIEWPORT_LAYOUT.tools },
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
    width: Math.max(1, target.offsetWidth) * item.scale,
    height: Math.max(1, target.offsetHeight) * item.scale,
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
  event.preventDefault()
  const rootRect = root.getBoundingClientRect()
  const width = Math.max(1, rootRect.width)
  const usableHeight = Math.max(1, rootRect.height - (executionMode.value === 'edit' && !worldFullscreen.value ? 28 : 0))
  const dx = event.clientX - drag.pointerX
  const dy = event.clientY - drag.pointerY
  const item = viewportLayout.value[drag.id]
  if (drag.mode === 'move') {
    const maxX = Math.max(0, width - target.offsetWidth * item.scale - 4)
    const maxY = Math.max(0, usableHeight - target.offsetHeight * item.scale - 4)
    item.x = Math.max(0, Math.min(maxX, drag.originX + dx)) / width
    item.y = Math.max(0, Math.min(maxY, drag.originY + dy)) / usableHeight
  } else {
    const unit = Math.max(120, drag.width, drag.height)
    const requestedScale = drag.scale + (dx + dy) / (2 * unit)
    item.scale = Math.max(0.55, Math.min(getViewportLayoutMaximumScale(drag.id, target), requestedScale))
    const maxX = Math.max(0, width - target.offsetWidth * item.scale - 4)
    const maxY = Math.max(0, usableHeight - target.offsetHeight * item.scale - 4)
    item.x = Math.max(0, Math.min(maxX, item.x * width)) / width
    item.y = Math.max(0, Math.min(maxY, item.y * usableHeight)) / usableHeight
  }
  viewportLayoutBounds.value = { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: rootRect.height }
  viewportLayoutRefresh.value += 1
}
function finishViewportLayoutDrag(): void {
  if (!viewportLayoutDrag) return
  viewportLayoutDrag = null
  window.removeEventListener('pointermove', moveViewportLayoutDrag)
  window.removeEventListener('pointerup', finishViewportLayoutDrag)
  window.removeEventListener('pointercancel', finishViewportLayoutDrag)
  clampAllViewportLayoutItems()
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

  if (entering) {
    worldFullscreen.value = true
    quickAddOpen.value = false
    try {
      if (isTauri()) {
        await getCurrentWindow().setFullscreen(true)
      } else if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      }
    } catch (error) {
      // Mesmo sem a API de tela cheia do host, o viewport continua ocupando
      // toda a área da janela por meio do modo CSS.
      console.warn('A tela cheia do host não está disponível; mantendo o viewport expandido.', error)
    }
  } else {
    worldFullscreen.value = false
    try {
      if (isTauri()) {
        const appWindow = getCurrentWindow()
        if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false)
      } else if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
    } catch (error) {
      console.warn('Não foi possível restaurar o tamanho da janela.', error)
    }
  }

  fullscreenTransition.value = false
  await nextTick()
}

function handleWorldFullscreenKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !worldFullscreen.value) return

  // No navegador, deixe o próprio Fullscreen API tratar Esc para não disputar
  // com a saída da tela cheia nativa. Se só o modo CSS estiver ativo, saia daqui.
  if (!isTauri() && document.fullscreenElement) return

  event.preventDefault()
  void toggleWorldFullscreen()
}

function syncWorldFullscreenAfterBrowserExit() {
  if (!isTauri() && worldFullscreen.value && !document.fullscreenElement) {
    worldFullscreen.value = false
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', closeQuickAddOutside)
  window.addEventListener('keydown', handleWorldFullscreenKeydown)
  document.addEventListener('fullscreenchange', syncWorldFullscreenAfterBrowserExit)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeQuickAddOutside)
  window.removeEventListener('keydown', handleWorldFullscreenKeydown)
  document.removeEventListener('fullscreenchange', syncWorldFullscreenAfterBrowserExit)
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
</script>

<template>
  <div class="app" :class="{ 'is-running': executionMode === 'running', 'world-fullscreen': worldFullscreen, 'sidebar-collapsed': sidebarCollapsed }">
    <EditorTopBar
      v-model:project-name="projectName"
      :viewport-layout-style="viewportLayoutStyle('render')"
      :dirty="dirty"
      :camera-label="cameraLabel"
      :first-person-mode="firstPersonMode"
      :render-distance="renderDistance"
      :render-all="renderAll"
      :performance-mode="performanceMode"
      :render-resolution-scale="renderResolutionScale"
      :render-fps-limit="renderFpsLimit"
      :render-fog-enabled="renderFogEnabled"
      :render-fog-distance-scale="renderFogDistanceScale"
      :render-dynamic-resolution="renderDynamicResolution"
      :render-dynamic-resolution-target-fps="renderDynamicResolutionTargetFps"
      :render-dynamic-resolution-min-scale="renderDynamicResolutionMinScale"
      :grass-visible="grassVisible"
      :grass-use-detailed-model="grassUseDetailedModel"
      :grass-density-percent="grassDensityPercent"
      :grass-render-distance-mode="grassRenderDistanceMode"
      :grass-render-distance="grassRenderDistance"
      :grass-near-detail-distance="grassNearDetailDistance"
      :grass-middle-detail-distance="grassMiddleDetailDistance"
      :grass-occlusion-enabled="grassOcclusionEnabled"
      :grass-occlusion-interval-ms="grassOcclusionIntervalMs"
      :wall-occlusion-quality="wallOcclusionQuality"
      :grass-wind-percent="grassWindPercent"
      :execution-mode="executionMode"
      :world-fullscreen="worldFullscreen"
      :objects="objects"
      :components="placeableSavedComponents"
      @select-object="selectItem"
      @place-component="placeSavedComponent"
      @open-model-import="previewComponentAsset = null; modelImportOpen = true"
      @run-world="runWorld"
      @edit-world="returnToEdit"
      @toggle-world-fullscreen="toggleWorldFullscreen"
      @render-distance-change="setRenderDistance"
      @render-all-change="setRenderAll"
      @performance-mode-change="setPerformanceMode"
      @render-resolution-scale-change="setRenderResolutionScale"
      @render-fps-limit-change="setRenderFpsLimit"
      @render-fog-enabled-change="setRenderFogEnabled"
      @render-fog-distance-scale-change="setRenderFogDistanceScale"
      @render-dynamic-resolution-change="setRenderDynamicResolution"
      @render-dynamic-resolution-target-fps-change="setRenderDynamicResolutionTargetFps"
      @render-dynamic-resolution-min-scale-change="setRenderDynamicResolutionMinScale"
      @grass-visible-change="setGrassVisible"
      @grass-use-detailed-model-change="setGrassUseDetailedModel"
      @grass-density-change="setGrassDensityPercent"
      @grass-render-distance-change="setGrassRenderDistance"
      @grass-near-detail-change="(value) => setGrassDetailDistance('near', value)"
      @grass-middle-detail-change="(value) => setGrassDetailDistance('middle', value)"
      @grass-occlusion-enabled-change="setGrassOcclusionEnabled"
      @grass-occlusion-interval-change="setGrassOcclusionInterval"
      @wall-occlusion-quality-change="setWallOcclusionQuality"
      @grass-wind-change="setGrassWindPercent"
      @toggle-first-person="toggleFirstPerson"
      @open-control-maps="controlMapsOpen = true"
      @mark-dirty="markDirty"
      @new-project="newProject"
      @open-project="openProject"
      @save-project="saveProject"
      @cycle-camera="cycleCameraView"
    />

    <ControlMapsDialog
      v-if="controlMapsOpen"
      :open="controlMapsOpen"
      :settings="controlMapSettings"
      @update:open="controlMapsOpen = $event"
      @update:settings="updateControlMapSettings"
    />

    <EditorToolbar
      class="viewport-layout-positioned"
      :style="viewportLayoutStyle('tools')"
      :tools="TOOLS"
      :transforms="TRANSFORMS"
      :tool="tool"
      :transform="transform"
      :inspector-mode="inspectorMode"
      :graph-open="graphOpen"
      :grid-visible="gridVisible"
      :polygon-lines-visible="polygonLinesVisible"
      :performance-mode="performanceMode"
      @set-tool="setTool"
      @set-transform="setTransform"
      @toggle-graph="graphOpen = !graphOpen"
      @open-model-import="previewComponentAsset = null; modelImportOpen = true"
      @add-primitive="addPrimitive"
      @add-spawn-platform="addSpawnPlatform"
      @add-clickable-example="addClickableCubeExample"
      @toggle-grid="toggleGrid"
      @toggle-polygon-lines="togglePolygonLines"
      @toggle-performance-mode="togglePerformanceMode"
    />

    <button
      v-if="sidebarCollapsed"
      class="sidebar-hamburger"
      type="button"
      aria-label="Expandir painel lateral"
      title="Expandir hierarquia e biblioteca"
      :aria-expanded="!sidebarCollapsed"
      @click="sidebarCollapsed = false"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 5.5h14M3 10h14M3 14.5h14" />
        <path d="m7 7 3 3-3 3" />
      </svg>
      <span>Abrir painel</span>
    </button>

    <div v-if="sidebarCollapsed" class="collapsed-sidebar-actions" aria-label="Criação e importação">
      <div class="quick-add-wrap collapsed-sidebar-add-wrap">
        <button
          class="collapsed-sidebar-action collapsed-sidebar-add-trigger"
          type="button"
          :aria-expanded="quickAddOpen"
          aria-haspopup="menu"
          title="Adicionar objetos à cena"
          @click.stop="quickAddOpen = !quickAddOpen"
        >
          <span class="collapsed-sidebar-action-icon" aria-hidden="true">＋</span>
          <span>Adicionar</span>
          <span class="quick-add-chevron" aria-hidden="true">▾</span>
        </button>
        <div v-if="quickAddOpen" class="quick-add-popover collapsed-sidebar-add-popover" role="menu" @click.stop>
          <div class="quick-add-heading">CRIAR NA CENA</div>
          <button role="menuitem" title="Adiciona um cubo à cena. Atalho indicado: 1." @click="addPrimitive('cube'); quickAddOpen = false"><span class="quick-add-icon">◇</span><span><strong>Cubo</strong><small>Objeto geométrico</small></span><kbd>1</kbd></button>
          <button role="menuitem" title="Adiciona uma plataforma retangular. Atalho indicado: 2." @click="addPrimitive('platform'); quickAddOpen = false"><span class="quick-add-icon">▱</span><span><strong>Plataforma</strong><small>Superfície retangular</small></span><kbd>2</kbd></button>
          <button role="menuitem" title="Cria um marcador para o ponto inicial do jogador." @click="addSpawnPlatform(); quickAddOpen = false"><span class="quick-add-icon">◎</span><span><strong>Spawn do jogador</strong><small>Ponto inicial do personagem</small></span></button>
          <button role="menuitem" title="Cria um objeto de exemplo com evento de clique para testar o Visual Script." @click="addClickableCubeExample(); quickAddOpen = false"><span class="quick-add-icon">⌘</span><span><strong>Exemplo interativo</strong><small>Objeto com evento de clique</small></span></button>
        </div>
      </div>
      <button
        class="collapsed-sidebar-action"
        type="button"
        title="Importa arquivos 3D e configura modelo e animações"
        aria-label="Importar modelo 3D"
        @click="quickAddOpen = false; previewComponentAsset = null; modelImportOpen = true"
      >
        <span class="collapsed-sidebar-action-icon" aria-hidden="true">▧</span>
        <span>Importar 3D</span>
      </button>
    </div>

    <div class="main">
      <SceneHierarchy
        v-model:root-open="rootOpen"
        :components="savedComponents"
        :objects="objects"
        :terrain="terrain"
        :selected-id="selectedId"
        :group-selection="groupSelection"
        :terrain-id="TERRAIN_ID"
        @select-item="selectItem"
        @group-selected="groupSelectedObjects"
        @ungroup-selected="ungroupSelectedObjects"
        @toggle-terrain="toggleTerrain"
        @toggle-visible="toggleVisible"
        @toggle-lock="toggleObjectLock"
        @toggle-wireframe="toggleObjectWireframe"
        @place-component="placeSavedComponent"
        @rename-component="renameSavedComponent"
        @delete-component="removeSavedComponent"
        @preview-component="previewSavedComponent"
        @move-component="moveSavedComponentGroup"
        @use-animation-source="useSavedAnimationSource"
        @open-model-import="previewAnimationSourceAsset = null; previewComponentAsset = null; modelImportOpen = true"
        @open-components="backfillMissingComponentThumbnails"
        @collapse-sidebar="sidebarCollapsed = true"
      />

      <!-- Viewport -->
      <main ref="viewportRoot" class="viewport">
        <canvas ref="canvas" class="canvas" :class="['tool-' + tool, viewportCursorClass]" />
        <PlayerHUD
          v-if="executionMode === 'running' || playerHudSettingsOpen"
          :player-name="playerModelName"
          :camera-mode="firstPersonMode ? 'Primeira pessoa' : CAMERA_LABELS[cameraPreset]"
          :fps="fps"
          :control-map-name="activeControlMap.name"
          :first-person="firstPersonMode"
          :settings-open="playerHudSettingsOpen"
          :editor-preview="executionMode !== 'running'"
          :world-fullscreen="worldFullscreen"
          :bindings="activeControlMap.bindings"
          :game-variables="globalLogicVariables"
          @toggle-camera="handleHudToggleCamera"
          @exit-runtime="handleHudExitRuntime"
          @settings-open-change="playerHudSettingsOpen = $event"
          @set-global-variable="handleHudGlobalVariable"
        />
        <div class="viewport-actions" aria-label="Ações rápidas da cena">
          <div class="quick-add-wrap">
            <button class="quick-add-trigger" :aria-expanded="quickAddOpen" title="Adicionar objetos à cena." data-tooltip="Crie primitivas, plataformas, ponto inicial do jogador e exemplos interativos." @click.stop="quickAddOpen = !quickAddOpen"><span>＋</span> Adicionar <span class="quick-add-chevron">▾</span></button>
            <div v-if="quickAddOpen" class="quick-add-popover" @click.stop>
              <div class="quick-add-heading">CRIAR NA CENA</div>
              <button title="Adiciona um cubo à cena. Atalho indicado: 1." @click="addPrimitive('cube'); quickAddOpen = false"><span class="quick-add-icon">◇</span><span><strong>Cubo</strong><small>Objeto geométrico</small></span><kbd>1</kbd></button>
              <button title="Adiciona uma plataforma retangular. Atalho indicado: 2." @click="addPrimitive('platform'); quickAddOpen = false"><span class="quick-add-icon">▱</span><span><strong>Plataforma</strong><small>Superfície retangular</small></span><kbd>2</kbd></button>
              <button title="Cria um marcador para o ponto inicial do jogador." @click="addSpawnPlatform(); quickAddOpen = false"><span class="quick-add-icon">◎</span><span><strong>Spawn do jogador</strong><small>Ponto inicial do personagem</small></span></button>
              <button title="Cria um objeto de exemplo com evento de clique para testar o Visual Script." @click="addClickableCubeExample(); quickAddOpen = false"><span class="quick-add-icon">⌘</span><span><strong>Exemplo interativo</strong><small>Objeto com evento de clique</small></span></button>
            </div>
          </div>
          <button class="model-import-launch" title="Importa arquivos 3D, configura o modelo e as animações antes de salvar na biblioteca." aria-label="Importar modelo 3D" @click="previewComponentAsset = null; modelImportOpen = true"><span aria-hidden="true">＋</span> Importar 3D</button>
        </div>
        <div v-if="!modelImportOpen && executionMode !== 'running'" class="viewport-fps viewport-layout-positioned" :style="viewportLayoutStyle('fps')" aria-label="Diagnóstico de renderização">
          <div class="viewport-fps-head" :class="{ 'fps-low': fps > 0 && fps < 30, 'fps-medium': fps >= 30 && fps < 50 }">
            <span class="fps-indicator" />
            <span>FPS</span>
            <strong>{{ fps || '—' }}</strong>
          </div>
          <div class="viewport-render-stats">
            <span><strong>{{ (renderStats.triangles / 1000).toFixed(1) }}k</strong> tris</span>
            <span><strong>{{ renderStats.drawCalls }}</strong> draws</span>
            <span title="Tempo de submissão dos comandos WebGL"><strong>{{ renderStats.cpuRenderMs.toFixed(1) }}</strong> ms render</span>
            <span title="Tempo gasto atualizando controles, colisões e sistemas do motor"><strong>{{ renderStats.cpuUpdateMs.toFixed(1) }}</strong> ms loop</span>
          </div>
        </div>
        <div class="chips">
          <span class="chip grid-state">{{ gridVisible ? 'MALHA ATIVA' : 'MALHA OCULTA' }}</span>
          <span class="chip">ÓRBITA LIVRE</span>
        </div>
        <div class="axes viewport-layout-positioned" :style="viewportLayoutStyle('axes')">
          <span class="axis"><b class="ax-x">X</b> largura</span>
          <span class="axis"><b class="ax-y">Y</b> altura</span>
          <span class="axis"><b class="ax-z">Z</b> profundidade</span>
        </div>
        <div class="statusbar" aria-label="Status do editor">
          <span class="seg">{{ groupSelection.length > 1 ? groupSelection.length + ' objetos selecionados' : inspectorMode === 'terrain' ? 'Terreno selecionado' : selectedId ? '1 objeto selecionado' : objects.length + ' objetos na cena' }}</span>
          <span class="seg"><i class="dot ok" /> Motor 3D ativo</span>
          <span class="seg">Terreno procedural</span>
          <span class="seg grow-text">{{ status || hint }}</span>
          <span class="seg status-version">v{{ ENGINE_VERSION }}</span>
        </div>

        <button
          v-if="executionMode === 'edit' && !worldFullscreen"
          class="viewport-layout-config-trigger"
          type="button"
          :aria-expanded="viewportLayoutConfigOpen"
          aria-controls="viewport-layout-config-panel"
          aria-label="Configurar posições e tamanhos da viewport"
          title="Configurar a posição e o tamanho dos menus da viewport"
          @click.stop="toggleViewportLayoutConfig"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
            <path d="m19.2 13.7 1.2.9-1.5 2.6-1.4-.6a7.8 7.8 0 0 1-1.4.8l-.2 1.5h-3l-.3-1.5a7.4 7.4 0 0 1-1.4-.8l-1.4.6-1.5-2.6 1.2-.9a7.1 7.1 0 0 1 0-1.6l-1.2-.9 1.5-2.6 1.4.6a7.8 7.8 0 0 1 1.4-.8l.3-1.5h3l.2 1.5a7.8 7.8 0 0 1 1.4.8l1.4-.6 1.5 2.6-1.2.9a7.1 7.1 0 0 1 0 1.6Z" />
          </svg>
        </button>

        <div
          v-if="viewportLayoutConfigOpen && executionMode === 'edit' && !worldFullscreen"
          id="viewport-layout-config-panel"
          class="viewport-layout-config-panel"
          role="dialog"
          aria-label="Configuração da viewport"
          @pointerdown.stop
          @wheel.stop
        >
          <header class="viewport-layout-config-heading">
            <span class="viewport-layout-config-icon" aria-hidden="true">⚙</span>
            <div><strong>Layout da viewport</strong><small>Posicione e dimensione os menus do editor</small></div>
            <button type="button" class="viewport-layout-close" aria-label="Fechar configurações" @click="toggleViewportLayoutConfig">×</button>
          </header>

          <div class="viewport-layout-items" role="group" aria-label="Selecionar menu para ajustar">
            <button
              v-for="item in viewportLayoutItems"
              :key="item.id"
              type="button"
              class="viewport-layout-item"
              :class="{ active: activeViewportLayoutItem === item.id }"
              @click="activeViewportLayoutItem = item.id"
            >
              <span class="viewport-layout-item-icon" aria-hidden="true">{{ item.icon }}</span>
              <span class="viewport-layout-item-copy"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
              <span class="viewport-layout-item-check" aria-hidden="true">{{ activeViewportLayoutItem === item.id ? '●' : '○' }}</span>
            </button>
          </div>

          <div class="viewport-layout-adjustments">
            <div class="viewport-layout-section-title">POSIÇÃO E TAMANHO</div>
            <label class="viewport-layout-range">
              <span>Horizontal <strong>{{ Math.round(viewportLayout[activeViewportLayoutItem].x * 100) }}%</strong></span>
              <input type="range" min="0" max="100" step="1" :value="Math.round(viewportLayout[activeViewportLayoutItem].x * 100)" @input="updateViewportLayoutPercent('x', Number(($event.target as HTMLInputElement).value))" @change="persistViewportLayout" />
            </label>
            <label class="viewport-layout-range">
              <span>Vertical <strong>{{ Math.round(viewportLayout[activeViewportLayoutItem].y * 100) }}%</strong></span>
              <input type="range" min="0" max="100" step="1" :value="Math.round(viewportLayout[activeViewportLayoutItem].y * 100)" @input="updateViewportLayoutPercent('y', Number(($event.target as HTMLInputElement).value))" @change="persistViewportLayout" />
            </label>
            <label class="viewport-layout-range">
              <span>Tamanho <strong>{{ Math.round(viewportLayout[activeViewportLayoutItem].scale * 100) }}%</strong></span>
              <input type="range" min="55" max="160" step="5" :value="Math.round(viewportLayout[activeViewportLayoutItem].scale * 100)" @input="updateViewportLayoutScale(Number(($event.target as HTMLInputElement).value))" @change="persistViewportLayout" />
            </label>
            <div class="viewport-layout-actions">
              <button type="button" class="viewport-layout-secondary" @click="resetViewportLayoutItem(activeViewportLayoutItem)">Restaurar este menu</button>
              <button type="button" class="viewport-layout-secondary" @click="resetAllViewportLayout">Restaurar tudo</button>
            </div>
          </div>

          <div class="viewport-layout-panel-footer">
            <button type="button" class="viewport-layout-drag-toggle" :class="{ active: viewportLayoutEditMode }" @click="viewportLayoutEditMode = !viewportLayoutEditMode">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1v14M1 8h14M5 3l3-2 3 2M5 13l3 2 3-2M3 5 1 8l2 3M13 5l2 3-2 3" /></svg>
              {{ viewportLayoutEditMode ? 'Concluir posicionamento' : 'Mover e redimensionar na viewport' }}
            </button>
            <button type="button" class="viewport-layout-hud-button" @click="openHudSettingsFromViewportLayout">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4" /></svg>
              Configurar HUD
            </button>
            <p>Arraste pelo ícone de movimento ou use a alça no canto inferior direito de cada contorno. Tudo fica limitado à área útil da viewport.</p>
          </div>
        </div>

        <div v-if="viewportLayoutEditMode && executionMode === 'edit' && !worldFullscreen" class="viewport-layout-handles" aria-label="Controles para mover e redimensionar menus">
          <div v-for="item in viewportLayoutItems" :key="'outline-' + item.id" class="viewport-layout-outline" :style="viewportLayoutOutlineStyle(item.id)">
            <button type="button" class="viewport-layout-move-handle" :title="'Arrastar para mover: ' + item.label" :aria-label="'Mover ' + item.label" @pointerdown="beginViewportLayoutDrag($event, item.id, 'move')"><span aria-hidden="true">⠿</span></button>
            <span class="viewport-layout-outline-name" aria-hidden="true">{{ item.label }}</span>
            <button type="button" class="viewport-layout-resize-handle" :title="'Arrastar para redimensionar: ' + item.label" :aria-label="'Redimensionar ' + item.label" @pointerdown="beginViewportLayoutDrag($event, item.id, 'resize')"><span aria-hidden="true">↘</span></button>
          </div>
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
          <button :class="{ active: inspectorTab === 'packages' }" title="Pacotes de comportamento" @click="inspectorTab = 'packages'"><span>▣</span><small>Pacotes</small></button>
        </nav>

        <div class="scroll">
          <section v-if="inspectorMode === 'environment'">
            <h4>Ambiente</h4>
            <dl>
              <dt>Dimensão</dt><dd class="mono">3D · X/Y/Z</dd>
              <dt>Terreno</dt><dd class="mono">100 × 100 unidades</dd>
              <dt>Relevo</dt><dd class="mono">Procedural + editável</dd>
            </dl>
            <div class="environment-editor">
              <h4>Modelo do jogador</h4>
              <p class="muted">Substitua o visual do personagem controlado em Run. A importação direta usa 1,8 unidade; para escolher outro tamanho, abra Importar 3D, ajuste “Altura final” e clique em “Usar como jogador”. A colisão e as dimensões físicas acompanham a altura escolhida.</p>
              <input ref="playerModelFileInput" type="file" accept=".glb,model/gltf-binary" hidden @change="onPlayerModelSelected" />
              <button class="primary environment-button" title="Substitui o visual do jogador. A física acompanha a altura configurada no Importador 3D; os controles permanecem iguais." @click="playerModelFileInput?.click()">{{ playerModelCustom ? 'Trocar modelo do jogador' : 'Importar modelo do jogador' }}</button>
              <div class="environment-file">
                <span>♟ {{ playerModelName }}</span>
                <button v-if="playerModelCustom" class="ghost" title="Remove o modelo personalizado e volta ao personagem padrão." @click="resetPlayerModel">Restaurar padrão</button>
              </div>
              <p class="component-note">Aceita arquivos GLB de até 30 MB. <span v-if="playerModelCustom">Altura atual: <strong>{{ playerModelHeight.toFixed(2) }} u</strong>. </span>Modelos com animações embutidas podem usar clipes nomeados idle, walk, run e jump; modelos estáticos serão exibidos sem animação de movimento.</p>
              <h4>Céu</h4>
              <p class="muted">Use uma imagem panorâmica ou uma textura de céu para envolver a cena.</p>
              <input ref="skyFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden @change="onSkyTextureSelected" />
              <button class="primary environment-button" title="Carrega uma imagem para usar como textura do céu da cena." @click="skyFileInput?.click()">{{ skyTextureDataUrl ? 'Trocar textura do céu' : 'Importar textura do céu' }}</button>
              <div v-if="skyTextureDataUrl" class="environment-file"><span>▧ {{ skyTextureName || 'Textura carregada' }}</span><button class="ghost" title="Remove a textura personalizada do céu." @click="clearSkyTexture">Remover</button></div>
              <h4>Dia e noite</h4>
              <div class="day-night-time-heading">
                <label for="day-night-time-slider">Horário</label>
                <output class="day-night-time-value mono" for="day-night-time-slider">{{ timeOfDayLabel }}</output>
              </div>
              <input
                id="day-night-time-slider"
                class="environment-range day-night-time-slider"
                type="range"
                min="0"
                max="24"
                step="0.05"
                :value="timeOfDay"
                :style="{ '--time-progress': `${(timeOfDay / 24) * 100}%` }"
                :aria-valuetext="timeOfDayLabel"
                aria-label="Horário do dia" title="Define a hora atual de 00:00 a 24:00 e atualiza a iluminação da cena."
                @input="setTimeOfDay(Number(($event.target as HTMLInputElement).value))"
                @keydown="handleTimeOfDayKeydown"
              />
              <div class="day-night-color-band" aria-hidden="true"></div>
              <div class="day-night-time-ticks" aria-hidden="true">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </div>
              <label class="checkline"><input type="checkbox" :checked="dayNightCycleEnabled" title="Ativa a passagem automática do tempo durante a execução ou visualização da cena." @change="setDayNightCycleEnabled(($event.target as HTMLInputElement).checked)" /> Ciclo automático de dia/noite</label>
              <div class="day-night-speed-control" :class="{ 'is-disabled': !dayNightCycleEnabled }">
                <div class="slider-row"><span>Velocidade do ciclo</span><b class="mono">{{ dayNightCycleSpeed.toFixed(2) }} h/s</b></div>
                <input class="environment-range" type="range" min="0.01" max="4" step="0.01" :value="dayNightCycleSpeed" :disabled="!dayNightCycleEnabled" aria-label="Velocidade do ciclo dia/noite" title="Ajusta quantas horas do mundo passam por segundo." @input="setDayNightCycleSpeed(Number(($event.target as HTMLInputElement).value))" />
              </div>
              <p class="component-note">O céu, o horário e o ciclo são salvos com o projeto.</p>
            </div>
          </section>

          <section v-if="inspectorMode === 'terrain' || tool === 'grass'">
            <h4>Ferramentas do terreno</h4>
            <p class="muted">
              Selecione Editar terreno e clique no chão para elevar. Segure Shift e clique para rebaixar.
            </p>
            <div class="slider-row"><span>Força do pincel</span><b class="mono">{{ brushStrength.toFixed(2) }}</b></div>
            <input v-model.number="brushStrength" type="range" min="0.2" max="3" step="0.05" title="Controla quanto o terreno sobe ou desce a cada passada do pincel." />
            <div class="slider-row"><span>Raio do pincel</span><b class="mono">{{ brushRadius.toFixed(1) }}</b></div>
            <input v-model.number="brushRadius" type="range" min="1" max="12" step="0.5" title="Define a área afetada por cada passada do pincel de terreno." />
            <div class="btn-row">
              <button class="ghost" title="Gera um novo relevo procedural e descarta as alterações de altura atuais." @click="regenerateTerrain">Novo relevo</button>
              <button class="ghost" title="Apaga as alterações manuais de altura e restaura o terreno de sua semente atual." @click="clearTerrain">Limpar edições</button>
            </div>
            <div class="grass-paint-panel">
              <h4>Grama</h4>
              <p class="muted">Escolha Pintar grama na barra superior e arraste sobre o terreno. Segure Shift para apagar os tufos que você pintou.</p>
              <div class="slider-row"><span>Tamanho do pincel</span><b class="mono">{{ brushRadius.toFixed(1) }}</b></div>
              <input v-model.number="brushRadius" type="range" min="0.5" max="12" step="0.5" title="Define o raio da área em que os tufos de grama são pintados ou apagados." />
              <div class="slider-row"><span>Densidade</span><b class="mono">{{ brushStrength.toFixed(2) }}</b></div>
              <input v-model.number="brushStrength" type="range" min="0.2" max="3" step="0.1" title="Controla a densidade de grama adicionada a cada passada do pincel." />
              <p class="component-note">A grama pintada é salva junto com o projeto. Configure a distância de renderização pelo menu Render na barra superior.</p>
            </div>
          </section>

          <section v-if="inspectorMode === 'object' && selected">
            <h4>{{ inspectorTab === 'variables' ? 'Identidade e variáveis' : inspectorTab === 'packages' ? 'Pacotes de comportamento' : 'Eventos e regras' }}</h4>
            <p v-if="inspectorTab === 'variables'" class="muted">Dados e valores pertencentes exclusivamente a este objeto.</p>
            <p v-else-if="inspectorTab === 'nodes'" class="muted">Eventos associados a este objeto. A lista mostra apenas regras vinculadas a ele.</p>
            <p v-else-if="inspectorTab === 'packages'" class="muted">Instale comportamentos reutilizáveis que acrescentam variáveis, gatilhos, condições e ações ao objeto.</p>
            <template v-if="inspectorTab === 'variables'">
            <div class="object-meta">
              <div><span>ID</span><code>{{ selected.id }}</code><button class="meta-copy" title="Copiar ID" @click="copyObjectId(selected.id)">⧉</button></div>
              <div><span>TIPO</span><strong>{{ selected.type === 'cube' ? 'Cube / GameObject' : 'Platform / GameObject' }}</strong></div>
            </div>
            <div class="component-caption">VARIÁVEIS DO OBJETO · VALORES INDEPENDENTES</div>
            <div class="variable-table-head" aria-hidden="true">
              <span>ID</span><span>TIPO</span><span>VALOR</span><span></span>
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
              <span>ID</span><span>TIPO</span><span>VALOR</span><span></span><span></span>
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
              <select v-model="ruleTrigger"><option value="object_clicked">Clicar no objeto selecionado</option><option value="enter_area">Objeto entrar na área (centro 0,1,0)</option><option value="key_pressed">Tecla pressionada</option><option value="package_event">Evento de pacote</option></select>
            </label>
            <template v-if="ruleTrigger === 'package_event'">
              <label class="field">Pacote instalado
                <select :value="rulePackageId" @change="onRulePackageChange(($event.target as HTMLSelectElement).value)">
                  <option v-for="entry in selectedObjectPackages" :key="entry.id" :value="entry.packageId">{{ getBehaviorPackageDefinition(entry.packageId)?.name ?? entry.packageId }}</option>
                </select>
              </label>
              <label class="field">Gatilho do pacote
                <select v-model="rulePackageEventId">
                  <option v-for="trigger in selectedRulePackageDefinition?.triggers ?? []" :key="trigger.id" :value="trigger.id">{{ trigger.label }}</option>
                </select>
              </label>
              <p v-if="!selectedObjectPackages.length" class="component-note">Instale primeiro um pacote na aba Pacotes deste objeto. O gatilho ficará disponível aqui.</p>
              <p v-else class="component-note">{{ selectedRulePackageDefinition?.triggers.find(trigger => trigger.id === rulePackageEventId)?.description ?? '' }}</p>
            </template>
            <label class="field">Ação
              <select v-model="ruleAction"><option value="rotate">Girar +45°</option><option value="move">Mover para X=2</option><option value="set_visible">Ocultar objeto</option><option value="set_variable">Definir variável global/do objeto</option><option value="set_package_variable">Definir variável de pacote</option><option value="javascript">JavaScript livre (colar código)</option><option value="script">Script Prometheus</option></select>
            </label>
            <template v-if="ruleAction === 'set_package_variable'">
              <label class="field">Pacote alvo
                <select :value="rulePackageId" @change="onRulePackageChange(($event.target as HTMLSelectElement).value)">
                  <option v-for="entry in selectedObjectPackages" :key="entry.id" :value="entry.packageId">{{ getBehaviorPackageDefinition(entry.packageId)?.name ?? entry.packageId }}</option>
                </select>
              </label>
              <label class="field">Variável do pacote
                <select v-model="rulePackageVariableName">
                  <option v-for="variable in selectedWritablePackageVariables" :key="variable.name" :value="variable.name">{{ variable.label }} ({{ variable.name }})</option>
                </select>
              </label>
              <label class="field">Novo valor
                <input v-model="rulePackageVariableValue" placeholder="true, false, 4.2 ou texto" />
              </label>
              <p v-if="!selectedObjectPackages.length" class="component-note">Instale primeiro um pacote neste objeto.</p>
            </template>
            <label class="checkline"><input v-model="ruleConditionEnabled" type="checkbox" /> Exigir condição baseada em variável</label>
            <template v-if="ruleConditionEnabled">
              <label class="field">Variável
                <select v-model="conditionVariable">
                  <option v-for="(value, name) in (ruleTrigger === 'package_event' ? selectedRulePackageVariables : logicVariables)" :key="name" :value="String(name)">{{ name }} ({{ String(value) }})</option>
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
                <label class="checkline"><input type="checkbox" :checked="rule.enabled" @change="toggleLogicRule(rule)" /><span>{{ rule.name }} · {{ rule.trigger.type === 'object_clicked' ? 'Clique' : rule.trigger.type === 'key_pressed' ? `Tecla ${rule.trigger.key}` : rule.trigger.type === 'package_event' ? `Pacote: ${rule.trigger.eventId}` : 'Entrada na área' }}</span></label>
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
                  <div class="transform-property-row">
                    <span class="transform-property-label">Posição</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x" title="Posição horizontal no eixo X."><span>X</span><input class="mono" type="number" step="0.1" :value="selected.x.toFixed(2)" @change="onNumber('x', $event)" /></label>
                      <label class="axis-value axis-y" title="Altura do objeto no eixo Y."><span>Y</span><input class="mono" type="number" step="0.1" :value="selected.y.toFixed(2)" @change="onNumber('y', $event)" /></label>
                      <label class="axis-value axis-z" title="Posição de profundidade no eixo Z."><span>Z</span><input class="mono" type="number" step="0.1" :value="selected.z.toFixed(2)" @change="onNumber('z', $event)" /></label>
                    </div>
                  </div>
                  <div class="transform-property-row">
                    <span class="transform-property-label">Rotação</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x" title="Rotação em graus ao redor do eixo X."><span>X</span><input class="mono" type="number" step="1" :value="selected.rotationX.toFixed(0)" @change="onNumber('rotationX', $event)" /></label>
                      <label class="axis-value axis-y" title="Rotação em graus ao redor do eixo Y."><span>Y</span><input class="mono" type="number" step="1" :value="selected.rotationY.toFixed(0)" @change="onNumber('rotationY', $event)" /></label>
                      <label class="axis-value axis-z" title="Rotação em graus ao redor do eixo Z."><span>Z</span><input class="mono" type="number" step="1" :value="selected.rotationZ.toFixed(0)" @change="onNumber('rotationZ', $event)" /></label>
                    </div>
                  </div>
                  <div class="transform-property-row">
                    <span class="transform-property-label">Escala</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x" title="Escala do objeto no eixo X."><span>X</span><input class="mono" type="number" min="0.1" :max="selected.importedModel ? 10000 : 20" step="0.1" :value="selected.scaleX.toFixed(2)" @change="onNumber('scaleX', $event)" /></label>
                      <label class="axis-value axis-y" title="Escala do objeto no eixo Y."><span>Y</span><input class="mono" type="number" min="0.1" :max="selected.importedModel ? 10000 : 20" step="0.1" :value="selected.scaleY.toFixed(2)" @change="onNumber('scaleY', $event)" /></label>
                      <label class="axis-value axis-z" title="Escala do objeto no eixo Z."><span>Z</span><input class="mono" type="number" min="0.1" :max="selected.importedModel ? 10000 : 20" step="0.1" :value="selected.scaleZ.toFixed(2)" @change="onNumber('scaleZ', $event)" /></label>
                    </div>
                  </div>
                  <div class="component-caption">FÍSICA</div>
                  <label class="field">Massa (kg)
                    <input class="mono" type="number" min="0" max="1000000" step="0.1" :value="selected.mass.toFixed(2)" @change="onNumber('mass', $event)" />
                  </label>
                  <p class="component-note">Massa 0 = corpo estático. A massa distribui a correção de penetração durante colisões.</p>
                  <div class="collider-type-row">
                    <label class="field">Tipo de colisor
                      <select :value="selected.colliderType" @change="onColliderChange(selected.id, $event)">
                        <option value="auto">Automático (malha)</option>
                        <option v-if="selected.importedModel" value="mesh">Malha estática (cidade / terreno · BVH)</option>
                        <option value="box">Caixa (Box)</option>
                        <option value="sphere">Esfera (Sphere)</option>
                        <option value="capsule">Cápsula (Capsule)</option>
                        <option value="none">Sem colisão</option>
                      </select>
                    </label>
                    <button class="ghost collider-visibility-button" :class="{ active: colliderDebugVisible }" title="Mostra ou esconde a forma física usada para colisões no mundo." @click="toggleColliderDebug">{{ colliderDebugVisible ? 'Ocultar' : 'Ver no mundo' }}</button>
                  </div>
                  <p class="component-note">Malha estática usa os triângulos reais e um BVH espacial, ideal para cidades e terrenos não animados. Preserva ruas e espaços vazios entre prédios. Caixa, esfera e cápsula usam formas simplificadas.</p>
<div v-if="selected.colliderType !== 'mesh'" class="transform-property-row collider-vector-row">
                    <span class="transform-property-label">Tamanho</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x"><span>X</span><input class="mono" type="number" min="0.05" step="0.1" :value="selected.colliderSize[0].toFixed(2)" @input="onColliderVectorChange(selected.id, 'colliderSize', 0, $event)" @change="onColliderVectorChange(selected.id, 'colliderSize', 0, $event)" /></label>
                      <label class="axis-value axis-y"><span>Y</span><input class="mono" type="number" min="0.05" step="0.1" :value="selected.colliderSize[1].toFixed(2)" @input="onColliderVectorChange(selected.id, 'colliderSize', 1, $event)" @change="onColliderVectorChange(selected.id, 'colliderSize', 1, $event)" /></label>
                      <label class="axis-value axis-z"><span>Z</span><input class="mono" type="number" min="0.05" step="0.1" :value="selected.colliderSize[2].toFixed(2)" @input="onColliderVectorChange(selected.id, 'colliderSize', 2, $event)" @change="onColliderVectorChange(selected.id, 'colliderSize', 2, $event)" /></label>
                    </div>
                  </div>
                  <div v-if="selected.colliderType !== 'mesh'" class="transform-property-row collider-vector-row">
                    <span class="transform-property-label">Deslocar</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x"><span>X</span><input class="mono" type="number" step="0.1" :value="selected.colliderOffset[0].toFixed(2)" @input="onColliderVectorChange(selected.id, 'colliderOffset', 0, $event)" @change="onColliderVectorChange(selected.id, 'colliderOffset', 0, $event)" /></label>
                      <label class="axis-value axis-y"><span>Y</span><input class="mono" type="number" step="0.1" :value="selected.colliderOffset[1].toFixed(2)" @input="onColliderVectorChange(selected.id, 'colliderOffset', 1, $event)" @change="onColliderVectorChange(selected.id, 'colliderOffset', 1, $event)" /></label>
                      <label class="axis-value axis-z"><span>Z</span><input class="mono" type="number" step="0.1" :value="selected.colliderOffset[2].toFixed(2)" @input="onColliderVectorChange(selected.id, 'colliderOffset', 2, $event)" @change="onColliderVectorChange(selected.id, 'colliderOffset', 2, $event)" /></label>
                    </div>
                  </div>
                  <p class="component-note">Ajustar dimensões ativa um colisor personalizado em caixa quando o tipo está em Automático. O deslocamento reposiciona a forma sem mover a malha visual.</p>
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
                  <label class="field">Material · textura
                    <select :value="selected.texturePreset" @change="onTexture">
                      <option value="none">Sem textura</option>
                      <option value="grass">Grama</option>
                      <option value="stone">Pedra</option>
                      <option value="brick">Tijolo</option>
                      <option value="wood">Madeira</option>
                      <option value="sand">Areia</option>
                      <option value="metal">Metal</option>
                    </select>
                  </label>
                  <label class="field">Repetição da textura · {{ selected.textureRepeat }}×
                    <input type="range" min="1" max="8" step="1" :value="selected.textureRepeat" :disabled="selected.texturePreset === 'none'" @change="onTextureRepeat" />
                  </label>
                  <FaceTextureEditor :model-value="selected.faceTextures ?? {}" @update-face-texture="onFaceTexture" />
                  <p class="component-note">Texturas procedurais aplicadas ao cubo ou à plataforma e salvas junto com o projeto.</p>
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
              <template v-if="inspectorTab === 'packages'">
                <div class="unity-component">
                  <div class="unity-component-head"><span class="component-icon script-icon">▣</span><strong>Comportamentos instalados</strong><span class="component-count">{{ selectedObjectPackages.length }}</span></div>
                  <div class="unity-component-body">
                    <div v-if="!installedPackageDefinitions.length" class="package-empty">
                      <strong>Nenhum pacote instalado</strong>
                      <p class="muted">Os pacotes adicionam comportamentos sem exigir regras manuais específicas para cada objeto.</p>
                    </div>
                    <article v-for="entry in installedPackageDefinitions" :key="entry.instance.id" class="behavior-package-card">
                      <div class="behavior-package-header">
                        <div><strong>{{ entry.definition.name }}</strong><p class="muted">{{ entry.definition.description }}</p></div>
                        <button class="variable-delete" :aria-label="'Remover pacote ' + entry.definition.name" title="Remover pacote" @click="removeBehaviorPackage(entry.instance.id)">×</button>
                      </div>
                      <label class="checkline"><input type="checkbox" :checked="entry.instance.enabled" @change="updateBehaviorPackage(entry.instance.id, { enabled: ($event.target as HTMLInputElement).checked })" /> Pacote habilitado</label>

                      <div class="component-caption">VARIÁVEIS</div>
                      <div v-for="variable in entry.definition.variables" :key="variable.name" class="package-variable">
                        <label v-if="variable.type === 'boolean'" class="checkline">
                          <input type="checkbox" :checked="entry.instance.variables[variable.name] === true" :disabled="variable.readOnly === true" @change="onPackageVariableChange(entry.instance, variable, $event)" />
                          {{ variable.label }}
                        </label>
                        <label v-else class="field">{{ variable.label }}
                          <input :type="variable.type === 'number' ? 'number' : 'text'" :value="String(entry.instance.variables[variable.name] ?? variable.defaultValue)" :min="variable.min" :max="variable.max" :step="variable.step" :disabled="variable.readOnly === true" @change="onPackageVariableChange(entry.instance, variable, $event)" />
                        </label>
                        <p class="component-note">{{ variable.description }}</p>
                      </div>

                      <template v-if="entry.instance.packageId === 'mount'">
                        <div class="component-caption">CONFIGURAÇÃO DA MONTARIA</div>
                        <label class="field">Tecla para montar / desmontar
                          <select :value="String(entry.instance.config.interactionKey ?? 'KeyE')" @change="onPackageConfigChange(entry.instance, 'interactionKey', ($event.target as HTMLSelectElement).value)">
                            <option value="KeyE">E</option><option value="KeyF">F</option><option value="KeyR">R</option><option value="KeyQ">Q</option><option value="KeyG">G</option>
                          </select>
                        </label>
                        <div class="component-caption">POSIÇÃO DO JOGADOR SOBRE A MONTARIA</div>
                        <div class="grid3">
                          <label class="field">Offset X<input type="number" step="0.05" :value="Array.isArray(entry.instance.config.seatOffset) ? Number(entry.instance.config.seatOffset[0]) : 0" @change="onPackageSeatOffsetChange(entry.instance, 0, $event)" /></label>
                          <label class="field">Offset Y<input type="number" step="0.05" :value="Array.isArray(entry.instance.config.seatOffset) ? Number(entry.instance.config.seatOffset[1]) : 0.55" @change="onPackageSeatOffsetChange(entry.instance, 1, $event)" /></label>
                          <label class="field">Offset Z<input type="number" step="0.05" :value="Array.isArray(entry.instance.config.seatOffset) ? Number(entry.instance.config.seatOffset[2]) : 0" @change="onPackageSeatOffsetChange(entry.instance, 2, $event)" /></label>
                        </div>

                        <div class="component-caption">ESTADOS VISUAIS DO MODELO</div>
                        <p class="component-note">Mostre ou oculte grupos/malhas do GLB conforme uma variável. Exemplo: a parte “Cavaleiro” fica visível apenas quando <code>mounted = true</code>. A malha não é removida do arquivo.</p>
                        <button class="ghost full add-component-btn" :disabled="selectedModelNodes.length === 0" @click="addMountModelState(entry.instance)">+ Adicionar estado visual</button>
                        <p v-if="selectedModelNodes.length === 0" class="component-note">Nenhum nó de modelo detectado neste objeto. Importe um modelo 3D que tenha a hierarquia de partes preservada.</p>
                        <div v-for="state in getMountModelStates(entry.instance)" :key="state.id" class="mount-model-state">
                          <label class="field">Parte / grupo do GLB
                            <select :value="state.nodePath" @change="updateMountModelState(entry.instance, state.id, { nodePath: ($event.target as HTMLSelectElement).value })">
                              <option v-for="node in selectedModelNodes" :key="node.path" :value="node.path">{{ node.name }} · {{ node.meshCount }} malha(s) — {{ node.path }}</option>
                            </select>
                          </label>
                          <label class="field">Variável da condição
                            <select :value="state.variable" @change="updateMountModelState(entry.instance, state.id, { variable: ($event.target as HTMLSelectElement).value })">
                              <option v-for="variable in mountStateVariableOptions(entry.instance)" :key="variable.name" :value="variable.name">{{ variable.name }} = {{ String(variable.value) }}</option>
                            </select>
                          </label>
                          <div class="grid3">
                            <label class="field">Comparação
                              <select :value="state.operator" @change="updateMountModelState(entry.instance, state.id, { operator: ($event.target as HTMLSelectElement).value as 'equals' | 'not_equals' })">
                                <option value="equals">Igual a</option>
                                <option value="not_equals">Diferente de</option>
                              </select>
                            </label>
                            <label class="field">Valor esperado
                              <input type="text" :value="String(state.value)" @change="onMountModelStateValueChange(entry.instance, state.id, $event)" />
                            </label>
                          </div>
                          <label class="checkline"><input type="checkbox" :checked="state.visibleWhenMatched" @change="updateMountModelState(entry.instance, state.id, { visibleWhenMatched: ($event.target as HTMLInputElement).checked })" /> Exibir quando a condição for verdadeira</label>
                          <button class="variable-delete" :aria-label="'Remover estado de ' + state.nodePath" title="Remover estado visual" @click="removeMountModelState(entry.instance, state.id)">Remover estado ×</button>
                        </div>
                      </template>

                      <div class="component-caption">GATILHOS</div>
                      <div class="package-slot-list"><div v-for="trigger in entry.definition.triggers" :key="trigger.id"><strong>{{ trigger.label }}</strong><small>{{ trigger.description }}</small></div></div>
                      <div class="component-caption">CONDIÇÕES</div>
                      <div class="package-slot-list"><div v-for="condition in entry.definition.conditions" :key="condition.id"><strong>{{ condition.label }}</strong><small>{{ condition.description }}</small></div></div>
                      <div class="component-caption">AÇÕES</div>
                      <div class="package-slot-list"><div v-for="action in entry.definition.actions" :key="action.id"><strong>{{ action.label }}</strong><small>{{ action.description }}</small></div></div>
                    </article>

                    <div class="component-caption">ADICIONAR PACOTE</div>
                    <button v-for="definition in availableBehaviorPackages" :key="definition.id" class="ghost full add-component-btn" @click="addBehaviorPackage(definition.id)">
                      + {{ definition.name }}
                      <span class="muted">{{ definition.description }}</span>
                    </button>
                    <p v-if="!availableBehaviorPackages.length" class="component-note">Todos os pacotes disponíveis já estão instalados neste objeto.</p>
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
    <div v-if="graphOpen" class="graph-overlay">
      <header class="graph-top"><div class="graph-title-group"><strong>VISUAL SCRIPT</strong><span class="graph-subtitle">Diagrama por objeto · Evento → Condição → Ação</span><label class="graph-object-filter">Mostrar <select v-model="graphObjectFilter" @change="resetGraphView"><option value="all">Todos os objetos</option><option value="selected">Objeto selecionado</option></select></label></div><div class="graph-actions"><button class="ghost" @click="addLogicRule()">+ Criar fluxo</button><button class="primary" @click="saveProject(false)">Salvar projeto</button><button class="ghost" @click="graphOpen = false">Voltar ao mundo ✕</button></div></header>
      <div class="graph-body">
        <aside class="graph-library property-source">
          <div class="graph-object-heading">
            <div><div class="eyebrow">HIERARQUIA DA CENA</div><h3>Objetos</h3></div>
            <span class="graph-object-total">{{ objects.length }}</span>
          </div>
          <label class="graph-object-search">
            <span aria-hidden="true">⌕</span>
            <input v-model="graphObjectSearch" type="search" placeholder="Buscar objeto..." aria-label="Buscar objeto na cena" />
            <button v-if="graphObjectSearch" type="button" title="Limpar busca" @click="graphObjectSearch = ''">×</button>
          </label>
          <div class="graph-object-picker">
            <div class="graph-object-section-label"><span>NA CENA</span><span>{{ objects.filter(object => object.name.toLowerCase().includes(graphObjectSearch.trim().toLowerCase())).length }} itens</span></div>
            <button v-for="object in objects.filter(object => object.name.toLowerCase().includes(graphObjectSearch.trim().toLowerCase()))" :key="object.id" class="graph-object-picker-row" :class="{ active: selectedId === object.id }" :title="object.name" @click="selectItem(object.id)">
              <span class="object-picker-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 21 7.4 12 12 3 7.4 12 2.8Z"/><path d="M3 7.4v9.2l9 4.6 9-4.6V7.4M12 12v9.2"/></svg></span>
              <span class="object-picker-copy"><span class="object-picker-name">{{ object.name }}</span><span class="object-picker-type">{{ object.type === 'cube' ? 'Cubo · GameObject' : 'Plataforma · GameObject' }}</span></span>
              <span class="object-picker-count" :title="logicRules.filter(rule => ownerOfRule(rule) === object.id).length + ' eventos'"><span class="object-count-dot"></span>{{ logicRules.filter(rule => ownerOfRule(rule) === object.id).length }}</span>
            </button>
            <div v-if="!objects.length" class="graph-object-empty"><span>◇</span><strong>Nenhum objeto criado</strong><small>Adicione um objeto à cena para começar.</small></div>
            <div v-else-if="!objects.some(object => object.name.toLowerCase().includes(graphObjectSearch.trim().toLowerCase()))" class="graph-object-empty"><strong>Nenhum resultado</strong><small>Tente buscar por outro nome.</small></div>
          </div>
          <div class="graph-tip"><strong>Dica</strong><span>Selecione um objeto para focar sua edição. Todos os fluxos continuam visíveis no modo global.</span></div>
        </aside>
        <div ref="graphViewport" class="graph-canvas" :class="['cursor-visual-script', { 'is-panning': dragCanvas }]" @pointerdown="startGraphPan" @pointermove="moveNode" @pointerup="endNodeDrag" @pointercancel="endNodeDrag" @wheel.prevent="onGraphWheel">
          <div class="graph-zoom-controls" @pointerdown.stop>
            <button title="Aproximar" aria-label="Aproximar" @click="zoomGraph(0.15)">＋</button>
            <span>{{ Math.round(graphZoom * 100) }}%</span>
            <button title="Afastar" aria-label="Afastar" @click="zoomGraph(-0.15)">−</button>
            <button title="Restaurar visualização inicial" aria-label="Restaurar visualização inicial" @click="resetGraphView">⌂</button>
          </div>
          <div ref="graphStage" class="graph-stage" :style="{ transform: `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphZoom})` }">
            <div v-if="!graphVisibleRules.length" class="graph-empty"><div class="empty-icon">⌘</div><h2>Nenhum fluxo criado</h2><p v-if="graphObjectFilter === 'selected' && selected">Este objeto ainda não tem eventos associados. Crie uma regra ou escolha “Todos os objetos”.</p><p v-else>Adicione uma regra no painel direito, em “Motor de regras”.</p><button class="ghost" @click="graphOpen = false">Voltar ao editor</button></div>
            <svg class="graph-wires" width="1800" height="6000" aria-hidden="true"><path v-for="edge in graphEdges" :key="edge.id" :class="edge.kind" :d="edge.d" /></svg>
            <template v-if="graphObjectFilter === 'all'">
              <section v-for="group in graphObjectGroups" :key="group.object.id" class="graph-object-group" :style="{ left: '12px', top: `${group.top}px`, height: `${group.height}px` }">
                <header class="graph-object-group-head">
                  <span class="object-group-icon">◇</span>
                  <strong>{{ group.object.name }}</strong>
                  <span class="object-group-count">{{ group.rules.length }} evento(s)</span>
                </header>
                <article class="graph-node trigger-list" :style="{ left: '18px', top: '43px' }">
                  <div class="node-head"><span>EVENTOS / GATILHOS</span><span>{{ group.rules.length }}</span></div>
                  <button v-for="rule in group.rules" :key="rule.id" class="event-list-row" :class="{ chosen: graphSelection?.ruleId === rule.id && graphSelection?.part === 'trigger', disabled: !rule.enabled }" @pointerdown.stop @click.stop="graphSelection = { ruleId: rule.id, part: 'trigger' }">
                    <span class="event-row-icon">↖</span><span class="event-row-copy"><strong>{{ nodeTitle(rule, 'trigger') }}</strong><small>{{ rule.name }}</small></span><span class="event-row-port" :data-port-key="`event:${rule.id}`"></span>
                  </button>
                  <div v-if="!group.rules.length" class="event-list-empty">Nenhum evento neste objeto</div>
                </article>
              </section>
            </template>
            <article v-else class="graph-node trigger-list" :style="{ left: '30px', top: '50px' }">
              <div class="node-head"><span>EVENTOS / GATILHOS</span><span>{{ graphVisibleRules.length }}</span></div>
              <button v-for="rule in graphVisibleRules" :key="rule.id" class="event-list-row" :class="{ chosen: graphSelection?.ruleId === rule.id && graphSelection?.part === 'trigger', disabled: !rule.enabled }" @pointerdown.stop @click.stop="graphSelection = { ruleId: rule.id, part: 'trigger' }">
                <span class="event-row-icon">↖</span><span class="event-row-copy"><strong>{{ nodeTitle(rule, 'trigger') }}</strong><small>{{ rule.name }}</small></span><span class="event-row-port" :data-port-key="`event:${rule.id}`"></span>
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
                <select :value="selectedGraphRule.trigger.type" @change="setSelectedTriggerType(($event.target as HTMLSelectElement).value as 'object_clicked' | 'enter_area' | 'key_pressed' | 'package_event')">
                  <option value="object_clicked">Ao clicar no objeto</option>
                  <option value="enter_area">Ao entrar em uma área</option>
                  <option value="key_pressed">Ao pressionar uma tecla</option><option value="package_event">Evento de pacote</option>
                </select>
              </label>
              <template v-if="selectedGraphRule.trigger.type === 'key_pressed'">
                <label class="field">Tecla (código)
                  <input :value="selectedGraphRule.trigger.key" @change="patchSelectedTrigger({ key: ($event.target as HTMLInputElement).value })" placeholder="KeyE" />
                </label>
              </template>
              <template v-if="selectedGraphRule.trigger.type === 'object_clicked'">
                <label class="field">Objeto-alvo
                  <select :value="selectedGraphRule.trigger.objectId" @change="patchSelectedTrigger({ objectId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="obj in objects" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                  </select>
                </label>
              </template>
              <template v-if="selectedGraphRule.trigger.type === 'package_event'">
                <label class="field">Pacote
                  <select :value="selectedGraphRule.trigger.packageId" @change="changeGraphRulePackage(($event.target as HTMLSelectElement).value)">
                    <option v-for="instance in selectedGraphRulePackages" :key="instance.id" :value="instance.packageId">{{ getBehaviorPackageDefinition(instance.packageId)?.name ?? instance.packageId }}</option>
                  </select>
                </label>
                <label class="field">Gatilho do pacote
                  <select :value="selectedGraphRule.trigger.eventId" @change="patchSelectedTrigger({ eventId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="trigger in getBehaviorPackageDefinition(selectedGraphRule.trigger.packageId)?.triggers ?? []" :key="trigger.id" :value="trigger.id">{{ trigger.label }}</option>
                  </select>
                </label>
                <p v-if="!selectedGraphRulePackages.length" class="component-note">Instale um pacote neste objeto antes de usar este gatilho.</p>
              </template>
              <template v-if="selectedGraphRule.trigger.type === 'enter_area'">
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
                <select :value="selectedGraphRule.actions[0]?.type ?? 'rotate'" @change="setSelectedActionType(($event.target as HTMLSelectElement).value as 'move' | 'rotate' | 'set_visible' | 'set_variable' | 'set_package_variable' | 'script' | 'javascript')">
                  <option value="move">Mover elemento</option><option value="rotate">Rotacionar elemento</option><option value="set_visible">Visibilidade</option><option value="set_variable">Definir variável</option><option value="set_package_variable">Definir variável de pacote</option><option value="script">Script Prometheus (comandos)</option><option value="javascript">JavaScript livre</option>
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
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'set_package_variable'">
                <label class="field">Pacote alvo
                  <select :value="selectedGraphRule.actions[0].packageId" @change="changeGraphRuleActionPackage(($event.target as HTMLSelectElement).value)">
                    <option v-for="instance in selectedGraphRulePackages" :key="instance.id" :value="instance.packageId">{{ getBehaviorPackageDefinition(instance.packageId)?.name ?? instance.packageId }}</option>
                  </select>
                </label>
                <label class="field">Variável do pacote
                  <select :value="selectedGraphRule.actions[0].name" @change="patchSelectedAction({ name: ($event.target as HTMLSelectElement).value })">
                    <option v-for="variable in selectedGraphRuleActionVariables" :key="variable.name" :value="variable.name">{{ variable.label }} ({{ variable.name }})</option>
                  </select>
                </label>
                <label class="field">Novo valor
                  <input :value="String(selectedGraphRule.actions[0].value)" @change="patchSelectedAction({ value: ruleValueFromInput(($event.target as HTMLInputElement).value) })" />
                </label>
              </template>
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
    <div v-if="ioProgress.active" class="project-io-overlay" role="status" aria-live="polite">
      <section class="project-io-card">
        <div class="project-io-icon">{{ ioProgress.kind === 'save' ? '↓' : '↑' }}</div>
        <div class="project-io-heading">{{ ioProgress.kind === 'save' ? 'Salvando projeto' : 'Carregando projeto' }}</div>
        <p class="project-io-message">{{ ioProgress.message }}</p>
        <div class="project-io-track"><div class="project-io-fill" :style="{ width: ioProgress.percent + '%' }"></div></div>
        <div class="project-io-meta"><span>Não feche o aplicativo durante esta operação</span><strong>{{ ioProgress.percent }}%</strong></div>
      </section>
    </div>
    <ModelImportDialog :open="modelImportOpen" :initial-asset="previewComponentAsset" :animation-source-asset="previewAnimationSourceAsset" :animation-source-options="savedAnimationSourceOptions" :control-map="activeControlMap.bindings" :save-model="handleModelImport" @close="closeModelImport" @use-player="handleUsePlayerModel" @save-animation-source="handleSaveAnimationSource" @load-animation-source="useSavedAnimationSource" />
  </div>
</template>

<style>
:root {
  --bg: #0e1013;
  --panel: #14171c;
  --panel-2: #181c23;
  --line: #252a33;
  --text: #e6e8ec;
  --muted: #9aa1ae;
  --accent: #f5a524;
  --accent-dark: #8a5a0a;
  --green: #3fb950;
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
.viewport { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; contain: paint; isolation: isolate; background: var(--bg); }
.viewport > .statusbar { position: absolute !important; left: 0 !important; right: 0 !important; bottom: 0 !important; }
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
.collider-visibility-button.active { border-color: #45e6a4; color: #45e6a4; background: rgba(69, 230, 164, 0.08); }
.collider-grid { margin-bottom: 8px; }
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

/* Agrupamento no modo "Todos os objetos": cada objeto tem uma caixa própria. */
.graph-object-group { position:absolute; width:1160px; border:1px solid #50545c; border-radius:8px; background:rgba(30,34,40,.72); box-shadow:0 8px 22px #0003; z-index:0; }
.graph-object-group-head { height:34px; display:flex; align-items:center; gap:9px; padding:0 12px; border-bottom:1px solid #414751; border-radius:8px 8px 0 0; background:#353b45; color:#e4e8ef; font-size:12px; }
.object-group-icon { color:#e98524; font-size:17px; }
.object-group-count { margin-left:auto; color:#aeb7c6; font-size:10px; }
.graph-object-group .trigger-list { left:18px; top:43px; }
.graph-object-group .trigger-list { z-index:1; }
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
  width: 204px;
  min-width: 175px;
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
  .panel.right { width: 182px; min-width: 165px; }
  .inspector-heading { padding: 10px; }
  .inspector-tabs button small { font-size: 8px; }
}
@media (max-width: 700px) {
  .panel.right { width: 165px; min-width: 147px; }
  .inspector-heading { padding: 8px; }
  .inspector-object-icon { width: 28px; height: 28px; }
  .inspector-tabs button small { font-size: 7px; }
  .panel.right .scroll > section { padding: 9px; }
}
</style>

<style>
.inspector-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));flex:none;padding:5px 7px 0;gap:3px;background:#2b2b2b;border-bottom:1px solid #1a1a1a}
.inspector-tabs button{min-width:0;min-height:47px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid transparent;border-bottom:2px solid transparent;border-radius:3px 3px 0 0;background:transparent;color:#a5a5a5;cursor:pointer}
.inspector-tabs button>span{font-size:16px;line-height:17px}.inspector-tabs button small{font-size:9px;white-space:nowrap}
.inspector-tabs button:hover{background:#383838;color:#eee}.inspector-tabs button.active{border-color:#3b3b3b;border-bottom-color:#e98524;background:#353535;color:#f1f1f1}
.behavior-package-card{margin:10px 0;padding:10px;border:1px solid #414141;border-radius:4px;background:#292929}
.behavior-package-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.behavior-package-header strong{font-size:12px;color:#f0f0f0}
.behavior-package-header p{margin:5px 0 0;font-size:10px;line-height:1.45}
.mount-model-state{display:grid;gap:7px;margin:8px 0;padding:9px;border:1px solid #414141;border-radius:4px;background:#202020}.mount-model-state select,.mount-model-state input{min-width:0}.mount-model-state .variable-delete{justify-self:end}
.package-variable{padding:6px 0;border-bottom:1px solid #373737}
.package-variable:last-child{border-bottom:0}
.package-variable .component-note{margin:3px 0 0}
.package-slot-list{display:grid;gap:5px;margin:7px 0 12px}
.package-slot-list>div{padding:7px 8px;border:1px solid #3c3c3c;border-radius:3px;background:#242424}
.package-slot-list strong{display:block;font-size:10px;color:#e2e2e2}
.package-slot-list small{display:block;margin-top:3px;color:#a5a5a5;font-size:9px;line-height:1.45}
.package-empty{padding:12px;border:1px dashed #555;border-radius:4px}
.package-empty strong{font-size:11px;color:#ddd}
.package-empty p{margin:5px 0 0}
.object-meta{margin:8px 0 14px;border:1px solid #202020;border-radius:3px;background:#252525}
.object-meta>div{min-height:33px;display:flex;align-items:center;gap:8px;padding:6px 8px}.object-meta>div+div{border-top:1px solid #353535}
.object-meta span{width:34px;flex:none;color:#929292;font-size:9px;font-weight:700;letter-spacing:.05em}
.object-meta code,.object-meta strong{min-width:0;overflow:hidden;color:#d3d3d3;font-size:10px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.object-meta code{flex:1;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.meta-copy{padding:2px 5px;border:1px solid #484848;border-radius:3px;background:#333;color:#bbb;cursor:pointer}
@media(max-width:850px){.inspector-tabs{padding-inline:4px;gap:1px}.inspector-tabs button small{font-size:8px}}
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

<style>
.graph-object-heading{display:flex;align-items:center;justify-content:space-between;margin:0 0 14px}
.graph-object-heading h3{margin:4px 0 0;font-size:16px;font-weight:650;letter-spacing:.01em;color:#edf0f6}
.graph-object-total{display:grid;place-items:center;min-width:28px;height:26px;padding:0 8px;border:1px solid #3a414f;border-radius:6px;background:#222630;color:#bfc7d5;font-size:11px;font-variant-numeric:tabular-nums}
.graph-object-search{display:flex;align-items:center;gap:8px;height:34px;margin-bottom:16px;padding:0 9px;border:1px solid #3a404d;border-radius:6px;background:#20232b;color:#8e98a9}
.graph-object-search:focus-within{border-color:#d98a39;box-shadow:0 0 0 2px #d98a3918}
.graph-object-search>span{font-size:20px;line-height:1}
.graph-object-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#e5e9f0;font:inherit;font-size:11px}
.graph-object-search input::placeholder{color:#727c8d}
.graph-object-search button{border:0;background:transparent;color:#aeb6c4;cursor:pointer;font-size:16px}
.graph-object-section-label{display:flex;justify-content:space-between;margin-bottom:7px;color:#7f899b;font-size:9px;font-weight:700;letter-spacing:.11em}
.graph-object-picker{display:flex;flex-direction:column;gap:4px;max-height:calc(100% - 150px);overflow:auto;padding:0 2px 8px 0}
.graph-object-picker-row{display:flex;align-items:center;gap:9px;width:100%;min-height:48px;padding:7px 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:#c5cad5;text-align:left;cursor:pointer;transition:background .12s,border-color .12s}
.graph-object-picker-row:hover{border-color:#3b414e;background:#2b303a}
.graph-object-picker-row.active{border-color:#8c5b2e;background:linear-gradient(90deg,#4a3525 0%,#302a27 100%);color:#fff}
.object-picker-icon{display:grid;place-items:center;flex:none;width:30px;height:30px;border:1px solid #424958;border-radius:6px;background:#252a34;color:#d7a16b}
.object-picker-icon svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.graph-object-picker-row.active .object-picker-icon{border-color:#9d6837;background:#503923;color:#ffc17f}
.object-picker-copy{display:flex;flex:1;flex-direction:column;gap:3px;min-width:0}
.object-picker-name{overflow:hidden;color:#e0e5ed;font-size:11px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.object-picker-type{overflow:hidden;color:#7f8999;font-size:9px;text-overflow:ellipsis;white-space:nowrap}
.graph-object-picker-row.active .object-picker-type{color:#c5a17d}
.object-picker-count{display:flex;align-items:center;justify-content:center;gap:5px;flex:none;min-width:25px;padding:4px 6px;border:1px solid #3b414d;border-radius:5px;background:#242831;color:#aeb6c4;font-size:10px;font-variant-numeric:tabular-nums}
.object-count-dot{width:4px;height:4px;border-radius:50%;background:#778396}
.graph-object-picker-row.active .object-picker-count{border-color:#76502e;background:#3a2e25;color:#f3c38f}
.graph-object-picker-row.active .object-count-dot{background:#e8a45c}
.graph-object-empty{display:flex;align-items:center;flex-direction:column;gap:7px;padding:28px 8px;color:#929cad;text-align:center}
.graph-object-empty>span{font-size:26px;color:#7f8999}
.graph-object-empty strong{font-size:11px;font-weight:600;color:#cbd2de}
.graph-object-empty small{font-size:10px;line-height:1.5;color:#858fa0}
.graph-tip{display:flex;flex-direction:column;gap:4px;margin-top:14px;padding:10px;border:1px solid #353b47;border-radius:6px;background:#242831;color:#8f99aa;font-size:10px;line-height:1.5}
.graph-tip strong{color:#c9d0dc;font-size:10px}
</style>

<style>
/* Durante Run, bloqueia a edição da cena, mas mantém o viewport e a barra superior interativos. */
.app.is-running * { pointer-events:none !important; }
.app.is-running canvas.canvas,
.app.is-running .topbar,
.app.is-running .topbar * { pointer-events:auto !important; }
/* Run blocks editor interaction globally; explicitly restore pointer input for
   the interactive HUD controls without making the full-screen HUD intercept
   clicks intended for the 3D canvas. */
.app.is-running .player-hud { pointer-events:none !important; }
.app.is-running .player-hud .hud-settings-panel,
.app.is-running .player-hud .hud-settings-panel *,
.app.is-running .player-hud .hud-controls,
.app.is-running .player-hud .hud-controls *,
.app.is-running .player-hud .hud-actions,
.app.is-running .player-hud .hud-actions *,
.app.is-running .player-hud button,
.app.is-running .player-hud input,
.app.is-running .player-hud .hud-custom-image.is-positioning {
  pointer-events:auto !important;
}
.app.is-running .player-hud .hud-custom-image.is-positioning {
  cursor:move !important;
}
/* O Arsenal precisa receber eventos de ponteiro para que selects e rolagem
   funcionem em Run, em vez de deixar o canvas capturar a roda e aplicar zoom. */
.app.is-running .player-hud .veilborne-loadout-trigger,
.app.is-running .player-hud .veilborne-loadout-panel,
.app.is-running .player-hud .veilborne-loadout-panel * {
  pointer-events:auto !important;
}
.app.is-running .model-import-launch { display:none !important; }
.model-import-launch{position:absolute;z-index:8;top:54px;right:16px;display:flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #5b4a39;border-radius:4px;background:#29251fdd;color:#f0c18f;font-size:10px;font-weight:650;cursor:pointer;box-shadow:0 4px 16px #0004}
.model-import-launch:hover{border-color:#d19a64;background:#3b3025;color:#ffe0bd}
.model-import-launch span{font-size:17px;line-height:10px}
</style>

<style>
.project-io-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:24px;background:rgba(10,12,16,.72);backdrop-filter:blur(3px)}
.project-io-card{width:min(420px,100%);padding:24px;border:1px solid #454b57;border-radius:8px;background:#242830;color:#edf0f6;box-shadow:0 20px 70px #0008}
.project-io-icon{display:grid;place-items:center;width:38px;height:38px;margin-bottom:16px;border:1px solid #5e4b35;border-radius:7px;background:#342a20;color:#f0b879;font-size:23px}
.project-io-heading{font-size:16px;font-weight:650}
.project-io-message{min-height:20px;margin:9px 0 18px;color:#aeb6c4;font-size:12px;overflow-wrap:anywhere}
.project-io-track{height:7px;overflow:hidden;border-radius:10px;background:#11151b}
.project-io-fill{height:100%;border-radius:10px;background:#d89a55;transition:width .18s ease}
.project-io-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;color:#8993a3;font-size:10px}
.project-io-meta strong{color:#f0c18f;font-size:11px;font-variant-numeric:tabular-nums}
.environment-editor{display:flex;flex-direction:column;gap:9px;margin-top:18px;padding-top:14px;border-top:1px solid #353b47}.environment-editor h4{margin:8px 0 0}.environment-button{width:100%;min-height:34px}.environment-file{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#aeb6c4;font-size:10px;overflow-wrap:anywhere}.environment-file button{flex:none}.environment-range{width:100%;accent-color:#d89a55}.environment-editor .checkline{margin:4px 0}
</style>


<style>
.viewport-fps{position:absolute;z-index:8;top:15px;right:16px;display:flex;flex-direction:column;align-items:stretch;gap:4px;min-height:27px;padding:5px 9px 6px;border:1px solid #383f49;border-radius:4px;background:#1d2229e8;color:#aab3c0;font-size:10px;font-weight:700;letter-spacing:.06em;font-variant-numeric:tabular-nums;backdrop-filter:blur(4px);pointer-events:none}
.viewport-fps-head{display:flex;align-items:center;gap:7px;min-height:22px}
.viewport-fps .fps-indicator{width:6px;height:6px;border-radius:50%;background:#8edb7e;box-shadow:0 0 0 3px #8edb7e18}
.viewport-fps strong{min-width:17px;color:#d6f5c1;font-size:12px;text-align:right}
.viewport-fps-head.fps-medium .fps-indicator{background:#e9c16f;box-shadow:0 0 0 3px #e9c16f18}
.viewport-fps-head.fps-medium strong{color:#f1cb82}
.viewport-fps-head.fps-low .fps-indicator{background:#f07870;box-shadow:0 0 0 3px #f0787018}
.viewport-fps-head.fps-low strong{color:#ffaaa2}
.viewport-render-stats{display:flex;align-items:center;gap:7px;border-top:1px solid #343b46;padding-top:5px;color:#9da8b7;font-size:9px;letter-spacing:0;white-space:nowrap}
.viewport-render-stats strong{min-width:0;color:#e3e9f1;font-size:10px;font-weight:800;text-align:left}
</style>


<style>
/* Final cascade layer: keep the redesign ahead of legacy App.vue rules. */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
:root {
  --bg: #0e1013;
  --panel: #14171c;
  --panel-2: #181c23;
  --line: #252a33;
  --text: #e6e8ec;
  --muted: #9aa1ae;
  --accent: #f5a524;
  --accent-dark: #5a3c0d;
  --green: #3fb950;
}
html, body, #app { width:100%; height:100%; margin:0; }
body { overflow:hidden; background:var(--bg); color:var(--text); font-family:'IBM Plex Sans',sans-serif; font-size:12px; }
* { box-sizing:border-box; }
button, input, select, textarea { font:inherit; }
button { min-height:32px; border-radius:6px; }
input, select, textarea { min-height:32px; border-color:#2c323d; border-radius:6px; background:#0e1013; color:#e6e8ec; }
input:focus, select:focus, textarea:focus { outline:1px solid #f5a524; border-color:#f5a524; }
.mono, code, kbd, .viewport-fps, .variable-id, .variable-type { font-family:'IBM Plex Mono',monospace !important; }
.app { background:#0e1013 !important; color:#e6e8ec !important; }
.topbar { position:relative; z-index:30; display:flex; flex:none; align-items:center; gap:8px; height:48px; min-height:48px; padding:0 12px; background:#14171c; border-bottom:1px solid #252a33; }
.brand { gap:8px; }
.logo { width:26px; height:26px; border:1px solid #765016; border-radius:6px; background:#f5a524; color:#1a1204; font-weight:800; }
.title { color:#e6e8ec; font-size:11px; letter-spacing:.08em; }
.project { display:flex; align-items:center; gap:6px; min-width:0; margin:0 4px 0 0; }
.pname { width:125px; height:30px; padding:0 6px; border-color:transparent; background:transparent; font-size:12px; font-weight:600; }
.pname:hover,.pname:focus { border-color:#2c323d; background:#0e1013; }
.cam { height:32px; min-height:32px; padding:0 10px; border:1px solid #2c323d; border-radius:6px; background:#181c23; color:#e6e8ec; font-size:11px; font-weight:500; }
.cam:hover { background:#252a33; }
.cam.active { border-color:#7d5b1b; background:#292314; color:#f5c56b; }
.topbar .render-settings-trigger { display:flex; align-items:center; gap:6px; }
.grow, .topbar .grow { flex:1; }
.filebtns { display:none; }
.main { min-height:0; flex:1; display:flex; overflow:hidden; }
.panel { min-height:0; background:#14171c; }
.panel.left { width:264px; min-width:264px; flex:0 0 264px; border-right:1px solid #252a33; }
.panel.right { width:340px; min-width:340px; flex:0 0 340px; border-left:1px solid #252a33; }
.panel-head { min-height:50px; padding:9px 14px; border-bottom:1px solid #252a33; }
.panel-head .eyebrow { display:none; }
.panel-head .h { margin:0; font-size:14px; font-weight:600; }
.badge { padding:3px 7px; border:1px solid #2c323d; border-radius:5px; background:#181c23; color:#9aa1ae; font:10px 'IBM Plex Mono',monospace; }
.library-tabs { display:grid; grid-template-columns:1fr 1fr; gap:0; padding:0 8px; height:40px; flex:none; border-bottom:1px solid #252a33; background:#0b0d10; }
.library-tabs button { min-height:39px; padding:0 8px; border:0; border-bottom:2px solid transparent; border-radius:0; background:transparent; color:#9aa1ae; font-size:11px; }
.library-tabs button.active { border-bottom-color:#f5a524; background:transparent; color:#e6e8ec; }
.library-tabs button span { color:#f5a524; }
.hierarchy-actions { order:5; padding:8px; border-top:1px solid #252a33; }
.hierarchy-actions button { min-height:32px; border:1px solid #2c323d; border-radius:6px; background:#181c23; color:#e6e8ec; font-size:11px; }
.hierarchy-actions button:disabled { opacity:.35; }
.tree { min-height:0; flex:1; overflow-y:auto; overflow-x:hidden; padding:8px; }
.row { min-height:32px; gap:8px; padding:5px 8px; border:0; border-radius:5px; color:#cdd1d8; }
.row.root { margin-bottom:3px; background:#181c23; }
.row.child { padding-left:24px; }
.row.active { position:relative; background:#352710; box-shadow:inset 3px 0 #f5a524; color:#ffe0a3; }
.row.active .name { color:#ffe0a3; }
.row .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
.row-action,.eye { min-width:22px; min-height:22px; border:0; background:transparent; }
.row-action { color:#9aa1ae; }
.row-action.active { color:#f5a524; }
.chev { transition:none; }
.ico.world { background:#f5a524; }
.ico.cube { border-color:#f5a524; }
.row.terrain .name { color:#9aa1ae; }
.component-library { min-height:0; flex:1; overflow-y:auto; overflow-x:hidden; padding:10px; }
.component-library-intro { padding:10px; border:1px solid #252a33; border-radius:7px; background:#181c23; }
.component-library-intro strong { color:#e6e8ec; font-size:11px; }
.component-library-intro p { margin:4px 0 0; color:#9aa1ae; font-size:10px; line-height:1.45; }
.saved-component { gap:4px; margin-top:6px; align-items:center; }
.saved-component-place { min-height:52px; padding:6px; gap:8px; border-color:#252a33; border-radius:6px; background:#181c23; }
.saved-component-place:hover { border-color:#8a641c; background:#211c12; }
.saved-component-icon { width:34px; height:34px; border:1px solid #493719; background:#292314; color:#f5a524; }
.saved-component-copy strong { color:#e6e8ec; font-size:11px; overflow-wrap:anywhere; white-space:normal; }
.saved-component-copy small { color:#9aa1ae; font-size:9px; line-height:1.3; }
.saved-component-add { color:#f5a524; }
.saved-component-edit,.saved-component-preview,.saved-component-delete { min-width:26px; min-height:30px; width:26px; border-color:#2c323d; border-radius:5px; background:#14171c; }
.saved-component-preview { color:#f5a524; }
.saved-component-delete { color:#ff7b72; }
.panel-foot { min-height:32px; padding:6px 10px; border-top:1px solid #252a33; font-size:10px; letter-spacing:0; }
.viewport { position:relative; min-width:0; flex:1; background:#0e1013; }
.model-import-launch { position:absolute !important; z-index:12 !important; top:12px !important; right:14px !important; min-height:34px; padding:0 12px !important; border:1px solid #8a641c !important; border-radius:6px !important; background:#f5a524 !important; color:#1a1204 !important; font-weight:700; }
.chips { top:14px; left:14px; gap:6px; }
.chip { min-height:26px; padding:4px 8px; border-color:#252a33; border-radius:5px; background:#14171ce8; color:#9aa1ae; font-size:9px; letter-spacing:.06em; }
.chip.live { color:#e6e8ec; }
.chip .dot { width:6px; height:6px; }
.viewport-fps { top:48px !important; left:14px !important; right:auto !important; gap:3px !important; padding:6px 8px !important; border-color:#252a33 !important; border-radius:6px !important; background:#14171ce8 !important; color:#9aa1ae !important; font-size:10px !important; }
.viewport-fps strong { color:#f5a524 !important; }
.viewport-render-stats { border-color:#252a33 !important; color:#9aa1ae !important; }
.viewport-render-stats strong { color:#e6e8ec !important; }
.axes { left:14px; bottom:42px; gap:5px; }
.axis { padding:4px 7px; border-color:#252a33; border-radius:5px; background:#14171ce8; color:#9aa1ae; font-size:10px; }
.ax-x { color:#ff6b6b !important; } .ax-y { color:#5bd67b !important; } .ax-z { color:#6ea8ff !important; }
.statusbar { position:fixed !important; z-index:15; left:264px !important; right:340px !important; bottom:0 !important; height:28px; min-height:28px; background:#0b0d10f2 !important; border-top:1px solid #252a33 !important; font-size:10px !important; }
.seg { padding:0 10px !important; height:27px; }
.scroll { min-height:0; overflow-y:auto; overflow-x:hidden !important; scrollbar-width:thin; scrollbar-color:#2c323d transparent; }
.scroll section { padding:12px 14px; border-bottom:1px solid #252a33; }
.scroll h4 { margin:0 0 9px; color:#e6e8ec; font-size:12px; font-weight:600; }
.muted,.component-note { color:#9aa1ae; font-size:10px; line-height:1.45; }
.inspector-heading { padding:12px 14px 10px; border-bottom:1px solid #252a33; }
.inspector-heading-top { display:flex; align-items:center; justify-content:space-between; }
.inspector-heading .eyebrow { font-size:9px; letter-spacing:.1em; }
.inspector-context { padding:3px 6px; border:1px solid #2c323d; border-radius:4px; color:#9aa1ae; font:9px 'IBM Plex Mono',monospace; }
.inspector-title-row { gap:9px; margin-top:8px; }
.inspector-object-icon { display:grid; place-items:center; width:34px; height:34px; border:1px solid #493719; border-radius:6px; background:#292314; color:#f5a524; font-size:19px; }
.inspector-title-copy { min-width:0; }
.inspector-title-copy .h { overflow:hidden; margin:0; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.inspector-description { margin-top:3px; color:#9aa1ae; font-size:10px; }
.selection-empty-hint { margin-top:8px; color:#7b8290; font-size:10px; line-height:1.4; }
.inspector-tabs { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); flex:none; gap:0; padding:0 6px; background:#0b0d10; border-bottom:1px solid #252a33; }
.inspector-tabs button { min-width:0; min-height:43px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; padding:4px 1px 2px; border:0; border-top:2px solid transparent; border-bottom:0; border-radius:0; background:transparent; color:#9aa1ae; cursor:pointer; }
.inspector-tabs button span { font-size:14px; }
.inspector-tabs button small { overflow:hidden; max-width:100%; font-size:9px; text-overflow:clip; white-space:nowrap; }
.inspector-tabs button.active { border-top-color:#f5a524; background:#14171c; color:#e6e8ec; }
.scroll section > * { max-width:100%; }
.scroll input:not([type=checkbox]):not([type=range]), .scroll select, .scroll textarea { max-width:100%; min-width:0; }
.scroll .grid3 { grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
.scroll .grid2 { grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
.scroll .object-meta { gap:6px; }
.scroll .object-meta > div { min-width:0; }
.scroll .object-meta code { max-width:190px; overflow:hidden; text-overflow:ellipsis; }
.scroll .variable-create { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px; }
.scroll .variable-create > * { min-width:0; width:100%; }
.scroll .variable-create input,.scroll .variable-create select { min-width:0; width:100%; }
.scroll .variable-create button { padding:4px 6px; font-size:10px; }
.scroll .variable-table-head,.scroll .variable-row { grid-template-columns:minmax(0,1fr) 54px minmax(0,1fr) 26px; gap:4px; }
.scroll .variable-id { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.scroll .variable-value { min-width:0; width:100%; }
.scroll .rule-item,.scroll .rule-row { min-width:0; }
.scroll .danger { min-height:32px; margin:0; border-color:#6a2e2e; color:#ff7b72; }
.scroll button.primary,.scroll .primary { min-height:32px; background:#f5a524; border-color:#f5a524; color:#1a1204; }
.scroll .environment-editor { display:flex; flex-direction:column; gap:8px; }
.scroll .environment-editor h4 { margin:8px 0 0; }
.scroll .environment-editor h4:first-child { margin-top:0; }
.scroll .environment-button { width:auto; align-self:flex-start; }
.scroll .environment-range { accent-color:#f5a524; }
.scroll input[type=range] { accent-color:#f5a524; }
.scroll input:disabled,.scroll select:disabled { opacity:.45; }
.toolbar { position:fixed; z-index:25; top:58px; left:276px; display:flex; flex-direction:column; align-items:stretch; gap:5px; width:42px; max-height:calc(100vh - 110px); padding:5px; overflow-x:hidden; overflow-y:auto; border:1px solid #252a33; border-radius:8px; background:#14171ceF; box-shadow:0 6px 24px #0004; scrollbar-width:none; }
.toolbar-group { display:flex; flex-direction:column; gap:3px; }
.toolbar-separator { display:block; width:100%; height:1px; margin:1px 0; background:#252a33; }
.toolbar .tool { display:flex; align-items:center; justify-content:center; width:30px; min-width:30px; min-height:32px; height:32px; padding:0; border:1px solid transparent; border-radius:5px; background:transparent; color:#9aa1ae; }
.toolbar .tool:hover { border-color:#2c323d; background:#181c23; color:#e6e8ec; }
.toolbar .tool.active { border-color:#8a641c; background:#352710; color:#f5a524; }
.toolbar .tool-ico { display:block; font-size:16px; line-height:1; opacity:1; }
.toolbar .tool-label { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media(max-width:1100px) {
  .panel.left { width:220px; min-width:220px; flex-basis:220px; }
  .panel.right { width:290px; min-width:290px; flex-basis:290px; }
  .toolbar { left:232px; }
  .statusbar { left:220px !important; right:290px !important; }
  .brand { display:none; }
}
@media(max-width:760px) {
  .panel.left { width:180px; min-width:180px; flex-basis:180px; }
  .panel.right { width:250px; min-width:250px; flex-basis:250px; }
  .toolbar { left:188px; }
  .statusbar { left:180px !important; right:250px !important; }
  .mode-segment { display:none; }
}


/* Status strip spans the complete application window. */
.statusbar { left:0 !important; right:0 !important; }
.status-version { margin-left:auto; font-family:'IBM Plex Mono',monospace; }
@media(max-width:1100px) { .statusbar { left:0 !important; right:0 !important; } }
@media(max-width:760px) { .statusbar { left:0 !important; right:0 !important; } }



/* Refinamento visual: hierarquia, estados de interação e uso do espaço. */
:root {
  color-scheme: dark;
  --surface-raised: #191e26;
  --surface-hover: #202631;
  --line-strong: #323a47;
  --text-soft: #b9c1ce;
  --focus-ring: #f5a524;
}
.app {
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}
.topbar {
  gap: 10px;
  padding-inline: 14px;
  border-bottom-color: #2b3039;
  box-shadow: 0 1px 0 #ffffff03;
}
.topbar > * { min-width: 0; }
.topbar button,
.topbar summary,
.file-menu-popover button,
.mode-segment button {
  transition: background-color .14s ease, border-color .14s ease, color .14s ease;
}
.file-menu > summary:hover,
.cam:hover,
.render-settings > summary:hover {
  border-color: var(--line-strong);
  background: var(--surface-hover);
}
.file-menu[open] > summary,
.render-settings[open] > summary {
  border-color: #6f531e;
}
.global-search:focus-within {
  border-color: #8a641c;
  box-shadow: 0 0 0 2px #f5a52416;
}
.global-search-results,
.file-menu-popover,
.render-settings-popover {
  border-color: #353d49;
  box-shadow: 0 16px 38px #0009, 0 1px 0 #ffffff05 inset;
}
.main { min-width: 0; }
.panel.left,
.panel.right {
  min-height: 0;
  overflow: hidden;
  padding-bottom: 28px;
  background: linear-gradient(180deg, #151920 0%, #13161b 100%);
}
.panel.left { box-shadow: inset -1px 0 #ffffff03; }
.panel.right { box-shadow: inset 1px 0 #ffffff03; }
.panel.left .panel-head {
  min-height: 58px;
  padding: 11px 14px;
  background: #151920;
}
.panel-head .h { letter-spacing: -.015em; }
.panel-head .badge {
  min-width: 27px;
  text-align: center;
  border-color: #333b47;
  background: #202630;
}
.panel.left .library-tabs {
  gap: 4px;
  height: 44px;
  padding: 5px 8px;
  background: #101318;
}
.panel.left .library-tabs button {
  min-height: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 5px;
  border-bottom: 1px solid transparent;
}
.panel.left .library-tabs button:hover {
  background: #1b2028;
  color: #e6e8ec;
}
.panel.left .library-tabs button.active {
  border-color: #4b3a20;
  border-bottom-color: #8a641c;
  background: #282216;
  color: #f4c36d;
}
.panel.left .library-tabs button span {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
}
.panel.left .hierarchy-actions {
  display: flex;
  gap: 6px;
  padding: 9px 9px 8px;
  border-top: 0;
  border-bottom: 1px solid #252a33;
  background: #14171c;
}
.panel.left .hierarchy-actions button {
  flex: 1;
  min-width: 0;
  transition: background-color .14s ease, border-color .14s ease, color .14s ease;
}
.panel.left .hierarchy-actions button:not(:disabled):hover {
  border-color: #73541e;
  background: #262115;
  color: #f5c56b;
}
.panel.left .tree { padding: 8px 7px 10px; }
.panel.left .row {
  display: flex;
  align-items: center;
  min-width: 0;
  margin: 2px 0;
  padding-top: 5px;
  padding-bottom: 5px;
  border: 1px solid transparent;
  border-radius: 5px;
  transition: background-color .12s ease, border-color .12s ease;
}
.panel.left .row.root {
  min-height: 34px;
  margin-bottom: 5px;
  border-color: #252b35;
  background: #1b2028;
  color: #e4e8ef;
}
.panel.left .row.child { padding-left: 19px; }
.panel.left .row:hover:not(.active) {
  border-color: #2b323e;
  background: #1b2028;
}
.panel.left .row.active {
  border-color: #5e471d;
  background: #2b2417;
  box-shadow: inset 2px 0 #f5a524;
}
.panel.left .row .name {
  flex: 1;
  min-width: 0;
  padding-right: 2px;
}
.panel.left .row .eye,
.panel.left .row .row-action {
  flex: none;
  opacity: .48;
  transition: opacity .12s ease, color .12s ease, background-color .12s ease;
}
.panel.left .row:hover .eye,
.panel.left .row:hover .row-action,
.panel.left .row.active .eye,
.panel.left .row.active .row-action,
.panel.left .row .row-action.active { opacity: 1; }
.panel.left .row .eye:hover,
.panel.left .row .row-action:hover {
  background: #2b323d;
  border-radius: 4px;
  color: #f5c56b;
}
.panel.left .row .row-action.active { color: #f5c56b; }
.panel.left .component-library { padding: 10px; }
.panel.left .component-library-intro {
  border-color: #303744;
  background: linear-gradient(145deg, #1b2028, #171b22);
}
.panel.left .saved-component-place {
  transition: border-color .14s ease, background-color .14s ease, transform .14s ease;
}
.panel.left .saved-component-place:active { transform: translateY(1px); }
.panel.right .inspector-heading {
  background: linear-gradient(180deg, #191e26, #151920);
  border-bottom-color: #2d333e;
}
.panel.right .inspector-tabs {
  padding-inline: 7px;
  background: #101318;
  border-bottom-color: #2d333e;
}
.panel.right .inspector-tabs button {
  position: relative;
  gap: 4px;
  min-height: 45px;
  border-radius: 5px 5px 0 0;
}
.panel.right .inspector-tabs button:hover:not(.active) {
  background: #1a1f27;
  color: #e6e8ec;
}
.panel.right .inspector-tabs button.active {
  background: #1b1f26;
  color: #f4c36d;
}
.panel.right .scroll {
  padding-bottom: 10px;
  scrollbar-gutter: stable;
}
.panel.right .scroll section {
  padding: 13px 14px;
  border-bottom-color: #252b34;
}
.panel.right .scroll section h4 {
  display: flex;
  align-items: center;
  gap: 7px;
  letter-spacing: -.01em;
}
.panel.right .scroll .grid3,
.panel.right .scroll .grid2 { min-width: 0; }
.panel.right .scroll input:not([type=checkbox]):not([type=range]),
.panel.right .scroll select,
.panel.right .scroll textarea {
  border-color: #303744;
  background: #0f1217;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.panel.right .scroll input:not([type=checkbox]):not([type=range]):hover,
.panel.right .scroll select:hover,
.panel.right .scroll textarea:hover { border-color: #424c5b; }
.panel.right .scroll .field { min-width: 0; }
.panel.right .scroll .variable-row,
.panel.right .scroll .rule-row,
.panel.right .scroll .rule-item { border-color: #2a303a; }
.panel.right .scroll .ghost,
.panel.right .scroll button:not(.primary):not(.danger):not(.variable-delete) {
  transition: background-color .12s ease, border-color .12s ease, color .12s ease;
}
.panel.right .scroll .ghost:hover,
.panel.right .scroll button:not(.primary):not(.danger):not(.variable-delete):hover {
  border-color: #46505e;
  background-color: #202630;
}
.panel.right .scroll button.primary,
.panel.right .scroll .primary {
  box-shadow: 0 1px 0 #ffffff20 inset;
  transition: filter .12s ease, transform .12s ease;
}
.panel.right .scroll button.primary:hover,
.panel.right .scroll .primary:hover { filter: brightness(1.06); }
.panel.right .scroll button.primary:active,
.panel.right .scroll .primary:active { transform: translateY(1px); }
.viewport { isolation: isolate; }
.model-import-launch {
  box-shadow: 0 3px 12px #0004, 0 1px 0 #ffffff36 inset;
  transition: filter .14s ease, transform .14s ease, box-shadow .14s ease;
}
.model-import-launch:hover {
  filter: brightness(1.07);
  box-shadow: 0 5px 17px #0005, 0 1px 0 #ffffff40 inset;
}
.model-import-launch:active { transform: translateY(1px); }
.chips { gap: 5px; }
.chip { backdrop-filter: blur(8px); }
.viewport-fps { backdrop-filter: blur(10px); box-shadow: 0 4px 14px #0003; }.toolbar {
  gap: 6px;
  border-color: #2d333e;
  background: #151920f5;
  box-shadow: 0 8px 24px #0005, 0 1px 0 #ffffff05 inset;
  backdrop-filter: blur(10px);
}
.toolbar .tool {
  flex-shrink: 0;
  transition: background-color .12s ease, border-color .12s ease, color .12s ease;
}
.toolbar .tool:focus-visible { outline: 2px solid #f5a524; outline-offset: 1px; }
.toolbar .tool.active {
  border-color: #6f531e;
  background: #2b2417;
  color: #f5c56b;
}
.toolbar .tool:active { transform: translateY(1px); }
.statusbar {
  display: flex;
  gap: 0;
  padding-inline: 6px;
  border-top-color: #303640 !important;
  background: #0b0d10f5 !important;
  box-shadow: 0 -3px 12px #00012;
  backdrop-filter: blur(10px);
}
.statusbar .seg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-inline: 9px !important;
}
.statusbar .seg + .seg { border-left: 1px solid #242a33; }
.statusbar .seg.grow-text { white-space: nowrap; }
.statusbar .status-version { flex: none; }
button:focus-visible,
summary:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid #f5a524;
  outline-offset: 2px;
}
button:disabled { cursor: not-allowed; }
::selection { background: #74511680; color: #fff5df; }
@media (max-width: 1100px) {
  .brand { display: flex !important; }
  .brand-copy { display: none !important; }
  .panel.left, .panel.right { padding-bottom: 28px; }
  .toolbar { max-height: calc(100dvh - 110px); }
}
@media (max-width: 760px) {
  .statusbar .seg:not(.grow-text):not(.status-version) { display: none; }
  .statusbar .seg.grow-text { border-left: 0; }
  .toolbar { max-height: calc(100dvh - 100px); }
}
@media (max-height: 720px) {
  .toolbar { max-height: calc(100dvh - 92px); }
  .chips { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}


/* Secondary refinement: unify the inspector cards, data tables and controls. */
.panel.right .inspector-description {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel.right .selection-indicator {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8bd49c;
  box-shadow: 0 0 0 3px #8bd49c14;
}
.panel.right .scroll .unity-component {
  margin: 12px 0;
  overflow: hidden;
  border: 1px solid #303744;
  border-radius: 7px;
  background: #171c24;
  box-shadow: 0 2px 8px #00012;
}
.panel.right .scroll .unity-component-head {
  min-height: 36px;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid #303744;
  background: #1e242e;
  color: #e6e8ec;
}
.panel.right .scroll .unity-component-head strong {
  min-width: 0;
  overflow: hidden;
  color: #e4e8ef;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 650;
}
.panel.right .scroll .component-icon {
  flex: none;
  border: 1px solid #333c49;
  border-radius: 5px;
  background: #13171d;
}
.panel.right .scroll .component-menu {
  color: #8792a2;
  cursor: default;
}
.panel.right .scroll .unity-component-body { padding: 10px; }
.panel.right .scroll .component-caption {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 12px 0 7px;
  color: #929eaf;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .09em;
}
.panel.right .scroll .component-caption::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #2b323d;
}
.panel.right .scroll .component-caption:first-child { margin-top: 0; }
.panel.right .scroll .component-note {
  margin: 6px 0 10px;
  color: #8f9aaa;
  font-size: 10px;
  line-height: 1.5;
}
.panel.right .scroll .component-enabled {
  padding: 2px 0 10px;
  border-bottom-color: #303744;
}
.panel.right .scroll .component-readonly {
  padding: 8px 0 0;
  color: #929eaf;
  font-size: 10px;
}
.panel.right .scroll .component-readonly strong {
  max-width: 66%;
  color: #d5dbe5;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  overflow-wrap: anywhere;
}
.panel.right .scroll .component-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding-inline: 5px;
  border: 1px solid #37414e;
  border-radius: 5px;
  background: #141920;
  color: #c2cbd8;
  font: 10px 'IBM Plex Mono', monospace;
}
.panel.right .scroll .object-meta {
  overflow: hidden;
  border-color: #303744;
  border-radius: 6px;
  background: #171c24;
}
.panel.right .scroll .object-meta > div { min-width: 0; }
.panel.right .scroll .object-meta > div + div { border-top-color: #303744; }
.panel.right .scroll .object-meta span {
  width: 40px;
  color: #8f9aaa;
  letter-spacing: .08em;
}
.panel.right .scroll .object-meta code,
.panel.right .scroll .object-meta strong {
  color: #dce2eb;
}
.panel.right .scroll .meta-copy {
  border-color: #37404d;
  border-radius: 5px;
  background: #202631;
  color: #bfc8d6;
}
.panel.right .scroll .meta-copy:hover {
  border-color: #8a641c;
  color: #f5c56b;
}
.panel.right .scroll .variable-table-head {
  margin-top: 12px;
  padding-inline: 7px;
  color: #8591a2;
  font: 700 9px 'IBM Plex Mono', monospace;
  letter-spacing: .08em;
}
.panel.right .scroll .variable-row {
  gap: 5px;
  margin-bottom: 5px;
  padding: 5px;
  border-color: #303744;
  border-radius: 6px;
  background: #171c24;
}
.panel.right .scroll .variable-row:focus-within {
  border-color: #76571e;
  background: #1b2028;
}
.panel.right .scroll .variable-id {
  color: #e1c18b;
  font-size: 10px;
}
.panel.right .scroll .variable-type {
  color: #9aa7b8;
  font-size: 9px;
}
.panel.right .scroll .variable-value {
  min-width: 0;
  border-color: #333c49;
  background: #10141a;
  font: 10px 'IBM Plex Mono', monospace;
}
.panel.right .scroll .variable-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  width: 24px;
  min-height: 25px;
  height: 25px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #a0a8b4;
}
.panel.right .scroll .variable-delete:hover {
  border-color: #60373a;
  background: #2b1b1e;
  color: #ff9b91;
}
.panel.right .scroll .variable-create {
  padding: 9px;
  border: 1px solid #303744;
  border-radius: 7px;
  background: #141920;
}
.panel.right .scroll .variable-create > button {
  min-height: 34px;
}
.panel.right .scroll .variable-create > button:first-of-type {
  border-color: #67501f;
  background: #292316;
  color: #f2c36f;
}
.panel.right .scroll .variable-create > button:last-of-type {
  border-color: #303744;
  background: #1d232c;
  color: #c6cfdb;
}
.panel.right .scroll .attached-rule {
  gap: 9px;
  padding: 9px;
  border-color: #303744;
  border-radius: 6px;
  background: #1a2029;
}
.panel.right .scroll .attached-rule:hover {
  border-color: #67501f;
  background: #242116;
}
.panel.right .scroll .attached-rule-status {
  flex: none;
  box-shadow: 0 0 0 3px #83bb8b12;
}
.panel.right .scroll .attached-rule-status.disabled {
  box-shadow: none;
}
.panel.right .scroll .package-empty {
  padding: 12px;
  border: 1px dashed #3a4351;
  border-radius: 6px;
  background: #141920;
}
.panel.right .scroll .package-empty strong { color: #d7dee8; }
.panel.right .scroll .behavior-package-card {
  margin: 10px 0;
  padding: 11px;
  border-color: #323b48;
  border-radius: 7px;
  background: #1a2029;
}
.panel.right .scroll .behavior-package-header { align-items: center; }
.panel.right .scroll .behavior-package-header strong { color: #e6e8ec; }
.panel.right .scroll .behavior-package-header .variable-delete { flex: none; }
.panel.right .scroll .rule-item {
  gap: 6px;
  padding: 7px 0;
  border-top-color: #2d3440;
}
.panel.right .scroll .rule-order { flex: none; }
.panel.right .scroll .rule-order button {
  min-width: 26px;
  min-height: 26px;
  padding: 3px 5px;
}
.panel.right .scroll .rule-item .checkline {
  min-width: 0;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.panel.right .scroll input[type="checkbox"],
.panel.right .scroll input[type="radio"] { accent-color: #f5a524; }
.panel.right .scroll input[type="range"] {
  height: 18px;
  accent-color: #f5a524;
  cursor: pointer;
}
.panel.right .scroll input[type="range"]:disabled { cursor: not-allowed; }
.panel.right .scroll input.color {
  width: 100%;
  height: 36px;
  min-height: 36px;
  padding: 3px;
  border-radius: 6px;
  cursor: pointer;
}
.panel.right .scroll .checkline {
  gap: 8px;
  color: #b2bccb;
  line-height: 1.4;
}
.panel.right .scroll .checkline input { flex: none; }
.panel.right .scroll .field {
  color: #aeb8c7;
  line-height: 1.4;
}
.panel.right .scroll .field > input,
.panel.right .scroll .field > select { margin-top: 6px; }
.panel.right .scroll .field > input[type="number"] { font-family: 'IBM Plex Mono', monospace; }
.panel.right .scroll .field > input[type="number"]::-webkit-inner-spin-button { opacity: .55; }
.panel.right .scroll .public-library-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  border-top: 1px solid #2b323d;
}
.panel.right .scroll .public-library-item > span {
  min-width: 0;
  color: #d9e0ea;
  overflow-wrap: anywhere;
}
.panel.right .scroll .collider-visibility-button.active {
  border-color: #6d5624;
  background: #2a2518;
  color: #f5c56b;
}
@media (max-width: 760px) {
  .panel.right .scroll .unity-component-body { padding: 8px; }
  .panel.right .scroll .component-caption { letter-spacing: .045em; }
  .panel.right .scroll .variable-row { gap: 3px; padding: 4px; }
  .panel.right .scroll .variable-table-head { letter-spacing: 0; }
}
</style>



<style>
/* Layout measurements from the supplied Editor Prometheus reference. */
.panel.left { width:282px !important; min-width:282px !important; flex:0 0 282px !important; }
.panel.right { width:252px !important; min-width:252px !important; flex:0 0 252px !important; }
.toolbar { left:297px !important; }
.viewport-fps {
  top:68px !important;
  left:auto !important;
  right:16px !important;
}
.model-import-launch { top:12px !important; right:14px !important; }
.quick-add-wrap {
  position:absolute;
  z-index:13;
  top:12px;
  right:194px;
}
.quick-add-trigger {
  display:flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  height:34px;
  min-height:34px;
  padding:0 11px;
  border:1px solid #303947;
  border-radius:6px;
  background:#141920;
  color:#e2e7ef;
  box-shadow:0 3px 12px #0003;
  font-size:11px;
  font-weight:600;
}
.quick-add-trigger > span:first-child {
  color:#f5c56b;
  font-size:16px;
  line-height:1;
}
.quick-add-trigger:hover,
.quick-add-trigger[aria-expanded="true"] {
  border-color:#73561f;
  background:#242116;
  color:#f6d28b;
}
.quick-add-chevron { color:#9aa6b6; font-size:10px; }
.quick-add-popover {
  position:absolute;
  top:calc(100% + 7px);
  right:0;
  display:flex;
  flex-direction:column;
  gap:3px;
  width:240px;
  padding:6px;
  border:1px solid #343d4a;
  border-radius:8px;
  background:#171c24;
  box-shadow:0 15px 40px #0009;
}
.quick-add-heading {
  padding:7px 8px 8px;
  border-bottom:1px solid #2c333f;
  color:#8692a4;
  font:700 9px 'IBM Plex Mono',monospace;
  letter-spacing:.1em;
}
.quick-add-popover > button {
  display:flex;
  align-items:center;
  gap:9px;
  min-height:43px;
  padding:5px 8px;
  border:1px solid transparent;
  border-radius:5px;
  background:transparent;
  color:#dce3ed;
  text-align:left;
}
.quick-add-popover > button:hover {
  border-color:#394351;
  background:#222832;
}
.quick-add-icon {
  display:grid;
  place-items:center;
  flex:none;
  width:28px;
  height:28px;
  border:1px solid #394250;
  border-radius:5px;
  background:#202631;
  color:#f2c36f;
  font-size:15px;
}
.quick-add-popover > button > span:nth-child(2) {
  display:flex;
  flex:1;
  flex-direction:column;
  gap:3px;
  min-width:0;
}
.quick-add-popover strong { font-size:11px; font-weight:600; }
.quick-add-popover small { color:#8995a7; font-size:9px; }
.quick-add-popover kbd {
  border-color:#3a4351;
  color:#96a2b2;
  font-size:9px;
}
@media (max-width:1180px) {
  .panel.left { width:220px !important; min-width:220px !important; flex-basis:220px !important; }
  .panel.right { width:203px !important; min-width:203px !important; flex-basis:203px !important; }
  .toolbar { left:232px !important; }
  .quick-add-wrap { right:190px; }
  .model-import-launch { right:12px !important; }
  .viewport-fps { top:62px !important; }
}
@media (max-width:760px) {
  .panel.left { width:180px !important; min-width:180px !important; flex-basis:180px !important; }
  .panel.right { width:175px !important; min-width:175px !important; flex-basis:175px !important; }
  .toolbar { left:188px !important; }
  .quick-add-wrap { right:12px; top:54px; }
  .model-import-launch { top:12px !important; right:12px !important; }
  .viewport-fps { top:100px !important; right:12px !important; }
  .quick-add-popover { width:min(240px, calc(100vw - 220px)); }
}
</style>



<style>
/* Compact axis rows to match the supplied inspector reference. */
.panel.right .scroll .transform-property-row {
  display:flex;
  align-items:center;
  gap:9px;
  min-width:0;
  margin:7px 0;
}
.panel.right .scroll .transform-property-label {
  flex:0 0 63px;
  color:#9aa6b6;
  font-size:10px;
}
.panel.right .scroll .transform-axis-grid {
  display:grid;
  flex:1;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:5px;
  min-width:0;
}
.panel.right .scroll .axis-value {
  display:flex;
  align-items:center;
  gap:5px;
  min-width:0;
  min-height:32px;
  margin:0;
  padding:0 6px;
  border:1px solid #2f3744;
  border-radius:5px;
  background:#10141a;
  cursor:text;
  font-size:10px;
  font-weight:700;
}
.panel.right .scroll .axis-value:focus-within {
  border-color:#8a641c;
  box-shadow:0 0 0 2px #f5a52412;
}
.panel.right .scroll .axis-value > span { flex:none; }
.panel.right .scroll .axis-value.axis-x > span { color:#ff7777; }
.panel.right .scroll .axis-value.axis-y > span { color:#6bdc91; }
.panel.right .scroll .axis-value.axis-z > span { color:#76aaff; }
.panel.right .scroll .axis-value input {
  flex:1;
  width:100%;
  min-width:0;
  height:29px;
  min-height:29px;
  margin:0;
  padding:0;
  border:0;
  border-radius:0;
  outline:0;
  background:transparent;
  color:#e5eaf1;
  text-align:right;
  font:10px 'IBM Plex Mono',monospace;
}
.panel.right .scroll .axis-value input:focus {
  outline:none;
  box-shadow:none;
}
.panel.right .scroll .collider-type-row {
  display:grid;
  grid-template-columns:minmax(0,1fr) 100px;
  align-items:end;
  gap:7px;
}
.panel.right .scroll .collider-type-row .field { min-width:0; margin-bottom:9px; }
.panel.right .scroll .collider-type-row .collider-visibility-button {
  min-height:32px;
  margin-bottom:9px;
  padding-inline:7px;
  white-space:nowrap;
  font-size:10px;
}
@media (max-width: 1180px) {
  .panel.right .scroll .transform-property-row { gap:5px; }
  .panel.right .scroll .transform-property-label { flex-basis:54px; font-size:9px; }
  .panel.right .scroll .transform-axis-grid { gap:3px; }
  .panel.right .scroll .axis-value { gap:3px; padding-inline:4px; }
  .panel.right .scroll .axis-value input { font-size:9px; }
}

</style>

<style>
/* Final alignment to the seven-page editor reference PDF. */
.panel.left .panel-head { display:none !important; }
.panel.left .library-tabs {
  order:0;
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:0;
  height:42px;
  padding:0 8px;
  border-bottom:1px solid #292f39;
  background:#14171c;
}
.panel.left .library-tabs button {
  min-width:0;
  height:42px;
  min-height:42px;
  padding:0 5px;
  border:0;
  border-bottom:2px solid transparent;
  border-radius:0;
  background:transparent;
  color:#96a0b0;
  font-size:11px;
  white-space:nowrap;
}
.panel.left .library-tabs button.active {
  border-color:transparent;
  border-bottom:2px solid #f5a524;
  background:transparent;
  color:#e7ebf2;
}
.panel.left .library-tabs button .tab-icon { display:none; }
.panel.left .library-tabs button .tab-count {
  margin-left:3px;
  color:#9ba6b7;
}
.panel.left .hierarchy-search { order:1; }
.panel.left .tree { order:2; }
.panel.left .hierarchy-actions { order:5; }
.panel.left .component-library { order:2; }
.panel.left .component-library-footer { order:5; }
.quick-add-wrap { right:181px; }
@media(max-width:1180px) { .quick-add-wrap { right:190px; } }
</style>



<style>
/* Fix range selector dimensions: brush radius and strength must not inherit
   the 32px height/padding used by text inputs. */
.panel.right .scroll input[type="range"],
.panel.right .scroll .environment-editor input[type="range"],
.panel.right .scroll .grass-paint-panel input[type="range"] {
  appearance: none;
  -webkit-appearance: none;
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 18px;
  min-height: 18px;
  margin: 5px 0 9px;
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: none;
  background: transparent;
  color: inherit;
  accent-color: #f5a524;
  cursor: pointer;
}
.panel.right .scroll input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border: 0;
  border-radius: 999px;
  background: #394250;
}
.panel.right .scroll input[type="range"]::-moz-range-track {
  height: 4px;
  border: 0;
  border-radius: 999px;
  background: #394250;
}
.panel.right .scroll input[type="range"]::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: #b98228;
}
.panel.right .scroll input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border: 2px solid #171c24;
  border-radius: 50%;
  background: #f5b942;
  box-shadow: 0 0 0 1px #a97822, 0 1px 3px #0008;
}
.panel.right .scroll input[type="range"]::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid #171c24;
  border-radius: 50%;
  background: #f5b942;
  box-shadow: 0 0 0 1px #a97822, 0 1px 3px #0008;
}
.panel.right .scroll input[type="range"]:hover::-webkit-slider-thumb {
  background: #ffd477;
  box-shadow: 0 0 0 2px #f5a52424, 0 1px 3px #0008;
}
.panel.right .scroll input[type="range"]:hover::-moz-range-thumb {
  background: #ffd477;
  box-shadow: 0 0 0 2px #f5a52424, 0 1px 3px #0008;
}
.panel.right .scroll input[type="range"]:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px #f5a52435, 0 0 0 1px #a97822;
}
.panel.right .scroll input[type="range"]:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 3px #f5a52435, 0 0 0 1px #a97822;
}
.panel.right .scroll input[type="range"]:disabled {
  opacity: .38;
  cursor: not-allowed;
}
.panel.right .scroll .slider-row {
  align-items: center;
  min-height: 18px;
  gap: 10px;
  margin: 10px 0 3px;
}
.panel.right .scroll .slider-row > span {
  min-width: 0;
  line-height: 1.35;
}
.panel.right .scroll .slider-row > b {
  flex: none;
  min-width: 44px;
  padding: 2px 5px;
  border: 1px solid #333d4b;
  border-radius: 4px;
  background: #11161d;
  color: #e9c17a;
  font: 10px 'IBM Plex Mono', monospace;
  text-align: right;
}
</style>






<style>
/* Controle de horário do ciclo solar: a trilha e a faixa cromática usam a mesma escala 0–24 h. */
.day-night-time-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin:10px 0 7px;
  color:#E6E8EC;
  font:400 13px/1.4 'IBM Plex Sans', Inter, 'Segoe UI', sans-serif;
}
.day-night-time-heading label { cursor:pointer; }
.day-night-time-value {
  color:#F5A524;
  font:500 12px/1.2 'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace;
  font-variant-numeric:tabular-nums;
  letter-spacing:.025em;
}
.day-night-time-slider,
.panel.right .scroll .day-night-time-slider {
  -webkit-appearance:none;
  appearance:none;
  display:block;
  box-sizing:border-box;
  width:100%;
  min-width:0;
  height:20px;
  margin:0;
  padding:0;
  border:0;
  outline:0;
  background:transparent;
  accent-color:#F5A524;
  cursor:pointer;
  touch-action:pan-y;
}
.day-night-time-slider::-webkit-slider-runnable-track {
  box-sizing:border-box;
  height:6px;
  border:1px solid #2C323D;
  border-radius:999px;
  background:linear-gradient(
    90deg,
    #F5A524 0%,
    #F5A524 var(--time-progress, 50%),
    #101319 var(--time-progress, 50%),
    #101319 100%
  );
}
.day-night-time-slider::-webkit-slider-thumb {
  -webkit-appearance:none;
  appearance:none;
  box-sizing:border-box;
  width:14px;
  height:14px;
  margin-top:-5px;
  border:2px solid #FFD17C;
  border-radius:50%;
  background:#F5A524;
  box-shadow:0 0 0 2px #F5A52422,0 1px 3px #0008;
}
.day-night-time-slider::-moz-range-track {
  box-sizing:border-box;
  height:6px;
  border:1px solid #2C323D;
  border-radius:999px;
  background:linear-gradient(
    90deg,
    #F5A524 0%,
    #F5A524 var(--time-progress, 50%),
    #101319 var(--time-progress, 50%),
    #101319 100%
  );
}
.day-night-time-slider::-moz-range-progress {
  box-sizing:border-box;
  height:6px;
  border:1px solid #F5A524;
  border-radius:999px;
  background:#F5A524;
}
.day-night-time-slider::-moz-range-thumb {
  box-sizing:border-box;
  width:14px;
  height:14px;
  border:2px solid #FFD17C;
  border-radius:50%;
  background:#F5A524;
  box-shadow:0 0 0 2px #F5A52422,0 1px 3px #0008;
}
.day-night-time-slider:focus-visible::-webkit-slider-thumb {
  box-shadow:0 0 0 3px #F5A52433,0 0 0 1px #FFD17C;
}
.day-night-time-slider:focus-visible::-moz-range-thumb {
  box-shadow:0 0 0 3px #F5A52433,0 0 0 1px #FFD17C;
}
.day-night-color-band {
  width:100%;
  height:6px;
  margin-top:1px;
  border:1px solid #2C323D;
  border-radius:4px;
  box-sizing:border-box;
  background:linear-gradient(
    90deg,
    #2A3566 0%,
    #F2A65A 25%,
    #8CC4F5 50%,
    #F2A65A 75%,
    #2A3566 100%
  );
  pointer-events:none;
}
.day-night-time-ticks {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:4px;
  width:100%;
  margin-top:5px;
  color:#7B8290;
  font:400 10px/1.25 'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace;
  font-variant-numeric:tabular-nums;
  user-select:none;
}
.day-night-time-ticks span { min-width:0; }
.day-night-time-ticks span:first-child { text-align:left; }
.day-night-time-ticks span:last-child { text-align:right; }
.day-night-speed-control { min-width:0; }
.day-night-speed-control.is-disabled { opacity:.5; }
.day-night-speed-control input:disabled { cursor:not-allowed; }
@media(max-width:700px) {
  .day-night-time-heading { margin-top:8px; }
  .day-night-time-ticks { font-size:10px; }
}
</style>


<style>
/* Tela cheia do mundo: amplia apenas o viewport e oculta os painéis do editor. */
.app.world-fullscreen {
  position:fixed !important;
  inset:0 !important;
  z-index:10000 !important;
  width:100vw !important;
  height:100vh !important;
  height:100dvh !important;
  min-height:0 !important;
  overflow:hidden !important;
  background:#0e1013 !important;
}
.app.world-fullscreen > .topbar,
.app.world-fullscreen > .toolbar,
.app.world-fullscreen .panel.left,
.app.world-fullscreen .panel.right {
  display:none !important;
}
.app.world-fullscreen .main {
  position:fixed !important;
  inset:0 !important;
  z-index:10001 !important;
  display:block !important;
  width:100vw !important;
  height:100vh !important;
  height:100dvh !important;
  min-height:0 !important;
  margin:0 !important;
  padding:0 !important;
  overflow:hidden !important;
}
.app.world-fullscreen .viewport {
  position:fixed !important;
  inset:0 !important;
  z-index:10002 !important;
  display:block !important;
  width:100vw !important;
  height:100vh !important;
  height:100dvh !important;
  min-width:0 !important;
  margin:0 !important;
  border:0 !important;
  overflow:hidden !important;
}
.app.world-fullscreen .viewport > :not(.canvas):not(.player-hud) {
  display:none !important;
}
/* Cohesive warm charcoal / coral theme from the latest toolbar reference. */
:root {
  --bg:#14120f;
  --panel:#191713;
  --panel-2:#1d1b17;
  --line:#2e2b25;
  --text:#f3efe6;
  --muted:#b5afa2;
  --accent:#e8572b;
  --accent-dark:#542517;
  --green:#8cae78;
}
body,.app { background:#14120f !important; color:#f3efe6 !important; }
.app { font-family:'IBM Plex Sans',sans-serif !important; }
.main { background:#14120f !important; }
.panel { background:#191713 !important; color:#f3efe6; }
.panel.left { border-right-color:#2e2b25 !important; }
.panel.right { border-left-color:#2e2b25 !important; }
.panel-head,.inspector-heading { border-color:#2e2b25 !important; background:#191713 !important; }
.panel-head .h,.inspector-title-copy .h { color:#f3efe6 !important; }
.panel-head .eyebrow,.inspector-heading .eyebrow { color:#b5afa2 !important; }
.badge,.inspector-context { border-color:#3b3730 !important; background:#1d1b17 !important; color:#b5afa2 !important; }
.library-tabs { border-bottom-color:#2e2b25 !important; background:#14120f !important; }
.library-tabs button { color:#b5afa2 !important; }
.library-tabs button.active { border-bottom-color:#e8572b !important; background:#1d1b17 !important; color:#f3efe6 !important; }
.library-tabs button span { color:#e8572b !important; }
.tree,.component-library { background:#191713 !important; }
.component-library-intro { border-color:#2e2b25 !important; background:#1d1b17 !important; }
.component-library-intro strong,.saved-component-copy strong { color:#f3efe6 !important; }
.component-library-intro p,.saved-component-copy small { color:#b5afa2 !important; }
.row { color:#d6d0c5 !important; }
.row.root { background:#1d1b17 !important; }
.row.active { background:#34241c !important; box-shadow:inset 3px 0 #e8572b !important; color:#ffd4c5 !important; }
.row.active .name { color:#ffd4c5 !important; }
.saved-component-place { border-color:#2e2b25 !important; background:#1d1b17 !important; }
.saved-component-place:hover { border-color:#9a4b30 !important; background:#282019 !important; }
.saved-component-icon,.inspector-object-icon { border-color:#663623 !important; background:#34241c !important; color:#e8572b !important; }
.saved-component-add,.saved-component-preview { color:#e8572b !important; }
.saved-component-edit,.saved-component-preview,.saved-component-delete { border-color:#3b3730 !important; background:#191713 !important; }
.hierarchy-actions { border-top-color:#2e2b25 !important; }
.hierarchy-actions button { border-color:#3b3730 !important; background:#1d1b17 !important; color:#f3efe6 !important; }
.hierarchy-actions button:hover { border-color:#75412e !important; background:#282019 !important; }
.panel-foot { border-top-color:#2e2b25 !important; background:#14120f !important; color:#b5afa2 !important; }
.toolbar { border-color:#2e2b25 !important; background:rgba(20,18,15,.96) !important; box-shadow:0 8px 24px #0005 !important; }
.toolbar .tool { color:#b5afa2 !important; }
.toolbar .tool:hover { border-color:#3b3730 !important; background:#1d1b17 !important; color:#f3efe6 !important; }
.toolbar .tool.active,.toolbar .grid-toggle.active { border-color:#783d27 !important; background:#34241c !important; color:#ff997d !important; }
.toolbar .tool:focus-visible { outline-color:#e8572b !important; }
.viewport { background:#14120f !important; }
.chip,.axis { border-color:#2e2b25 !important; background:rgba(20,18,15,.9) !important; color:#b5afa2 !important; }
.chip.live { color:#f3efe6 !important; }
.grid-state { color:#ff997d !important; }
.chips,.axes { left:72px !important; }
.ax-x { color:#f07870 !important; }
.ax-y { color:#8cae78 !important; }
.ax-z { color:#80a9df !important; }
.viewport-fps {
  top:104px !important;
  left:auto !important;
  right:14px !important;
  border-color:#2e2b25 !important;
  border-radius:8px !important;
  background:rgba(20,18,15,.92) !important;
  color:#b5afa2 !important;
  box-shadow:0 6px 18px #0003 !important;
}
.viewport-fps strong { color:#f3efe6 !important; }
.viewport-fps .fps-indicator { box-shadow:none !important; }
.viewport-render-stats { border-top-color:#2e2b25 !important; color:#b5afa2 !important; }
.viewport-render-stats strong { color:#f3efe6 !important; }
.model-import-launch {
  top:58px !important;
  right:14px !important;
  border-color:#e8572b !important;
  border-radius:8px !important;
  background:#e8572b !important;
  color:#14120f !important;
  box-shadow:0 4px 12px #0003 !important;
}
.model-import-launch:hover { filter:brightness(1.06); background:#ed6741 !important; }
.model-import-launch span { color:#14120f !important; }
.quick-add-wrap { top:58px !important; right:194px !important; }
.quick-add-trigger {
  border-color:#3b3730 !important;
  border-radius:8px !important;
  background:#1d1b17 !important;
  color:#f3efe6 !important;
  box-shadow:none !important;
}
.quick-add-trigger:hover,.quick-add-trigger[aria-expanded="true"] {
  border-color:#75412e !important;
  background:#282019 !important;
  color:#f3efe6 !important;
}
.quick-add-trigger > span:first-child { color:#e8572b !important; }
.quick-add-chevron { color:#b5afa2 !important; }
.quick-add-popover { border-color:#3b3730 !important; border-radius:9px !important; background:#1d1b17 !important; }
.quick-add-heading { border-bottom-color:#2e2b25 !important; color:#b5afa2 !important; }
.quick-add-popover > button { color:#f3efe6 !important; }
.quick-add-popover > button:hover { border-color:#3b3730 !important; background:#34302a !important; }
.quick-add-icon { border-color:#3b3730 !important; background:#26231e !important; color:#e8572b !important; }
.quick-add-popover small,.quick-add-popover kbd { color:#b5afa2 !important; }
.statusbar { border-top-color:#2e2b25 !important; background:rgba(20,18,15,.96) !important; color:#b5afa2 !important; }
.statusbar .seg { border-right-color:#2e2b25 !important; }
.inspector-tabs { border-bottom-color:#2e2b25 !important; background:#14120f !important; }
.inspector-tabs button { color:#b5afa2 !important; }
.inspector-tabs button.active { border-top-color:#e8572b !important; background:#1d1b17 !important; color:#f3efe6 !important; }
.inspector-tabs button.active span { color:#ff997d !important; }
.inspector-description,.selection-empty-hint,.muted,.component-note { color:#b5afa2 !important; }
.panel.right .scroll section { border-bottom-color:#2e2b25 !important; }
.panel.right .scroll input:not([type=checkbox]):not([type=range]),
.panel.right .scroll select,.panel.right .scroll textarea {
  border-color:#3b3730 !important;
  border-radius:7px !important;
  background:#14120f !important;
  color:#f3efe6 !important;
}
.panel.right .scroll input:focus,.panel.right .scroll select:focus,.panel.right .scroll textarea:focus {
  border-color:#e8572b !important;
  outline:1px solid #e8572b !important;
}
.panel.right .scroll input[type=range],.panel.right .scroll input[type=checkbox] { accent-color:#e8572b !important; }
.panel.right .scroll button.primary,.panel.right .scroll .primary {
  border-color:#e8572b !important;
  background:#e8572b !important;
  color:#14120f !important;
  box-shadow:none !important;
}
.panel.right .scroll .ghost,
.panel.right .scroll button:not(.primary):not(.danger):not(.variable-delete) {
  border-color:#3b3730 !important;
  background:#1d1b17 !important;
  color:#f3efe6 !important;
}
.panel.right .scroll .ghost:hover,
.panel.right .scroll button:not(.primary):not(.danger):not(.variable-delete):hover {
  border-color:#75412e !important;
  background:#282019 !important;
}
.panel.right .scroll .danger { border-color:#74372c !important; background:#271916 !important; color:#ff9d8b !important; }
.panel.right .scroll .collider-visibility-button.active { border-color:#75412e !important; background:#34241c !important; color:#ff997d !important; }
.project-io-overlay { background:rgba(12,10,8,.78) !important; }
.project-io-card { border-color:#3b3730 !important; border-radius:10px !important; background:#1d1b17 !important; color:#f3efe6 !important; }
.project-io-icon { border-color:#75412e !important; background:#34241c !important; color:#e8572b !important; }
.project-io-message,.project-io-meta { color:#b5afa2 !important; }
.project-io-fill { background:#e8572b !important; }
@media(max-width:1180px) {
  .quick-add-wrap { right:190px !important; }
  .model-import-launch { right:12px !important; }
  .viewport-fps { top:104px !important; }
}
@media(max-width:760px) {
  .quick-add-wrap { right:174px !important; top:58px !important; }
  .model-import-launch { top:58px !important; right:12px !important; }
  .viewport-fps { top:104px !important; right:12px !important; }
  .chips { left:72px !important; }
}

.app.world-fullscreen { background:#14120f !important; }
/* Keep the viewport controls reachable when the scene is fullscreen.
   The header becomes a zero-height overlay container; only its viewport toolbar remains. */
.app.world-fullscreen > .topbar {
  position:fixed !important;
  inset:0 0 auto 0 !important;
  z-index:10004 !important;
  display:block !important;
  width:100% !important;
  height:0 !important;
  min-height:0 !important;
  padding:0 !important;
  overflow:visible !important;
  border:0 !important;
  background:transparent !important;
  pointer-events:none !important;
}
.app.world-fullscreen > .topbar > :not(.viewport-tools-overlay) {
  display:none !important;
}
.app.world-fullscreen .viewport-tools-overlay {
  top:12px !important;
  right:12px !important;
  z-index:10005 !important;
  pointer-events:auto !important;
}
/* Clean viewport layout: creation actions left, view controls right, diagnostics at the bottom. */
.viewport-actions {
  position:absolute;
  z-index:16;
  top:12px;
  left:72px;
  display:flex;
  align-items:center;
  gap:6px;
  max-width:calc(100% - 96px);
}
.viewport-actions .quick-add-wrap {
  position:relative !important;
  top:auto !important;
  right:auto !important;
  left:auto !important;
  flex:none;
}
.viewport-actions .quick-add-trigger {
  height:36px;
  min-height:36px;
  padding:0 12px;
  border-color:#2e2b25 !important;
  border-radius:8px;
  background:rgba(29,27,23,.96) !important;
  color:#f3efe6 !important;
  box-shadow:0 4px 14px #0003 !important;
  font-size:12px;
  font-weight:500;
  white-space:nowrap;
}
.viewport-actions .quick-add-trigger:hover,
.viewport-actions .quick-add-trigger[aria-expanded="true"] {
  border-color:#75412e !important;
  background:#282019 !important;
}
.viewport-actions .quick-add-trigger > span:first-child {
  color:#e8572b !important;
  font-size:16px;
}
.viewport-actions .quick-add-popover {
  top:calc(100% + 7px);
  left:0;
  right:auto;
  max-height:min(65vh,560px);
  overflow:auto;
  border-color:#3b3730 !important;
  background:#1d1b17 !important;
  box-shadow:0 16px 36px #0008;
}
.viewport-actions .model-import-launch {
  position:static !important;
  top:auto !important;
  right:auto !important;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  flex:none;
  height:36px;
  min-height:36px;
  padding:0 12px !important;
  border:1px solid #2e2b25 !important;
  border-radius:8px !important;
  background:rgba(29,27,23,.96) !important;
  color:#f3efe6 !important;
  box-shadow:0 4px 14px #0003 !important;
  font-size:12px;
  font-weight:500;
  white-space:nowrap;
}
.viewport-actions .model-import-launch:hover {
  border-color:#75412e !important;
  background:#282019 !important;
  color:#f3efe6 !important;
  filter:none;
}
.viewport-actions .model-import-launch > span { color:#e8572b !important; font-size:15px; }
.viewport-fps {
  top:auto !important;
  right:14px !important;
  bottom:38px !important;
  left:auto !important;
  flex-direction:row !important;
  align-items:center !important;
  gap:10px !important;
  width:max-content;
  max-width:calc(100% - 92px);
  min-height:30px !important;
  padding:4px 8px !important;
  border-color:#2e2b25 !important;
  border-radius:8px !important;
  background:rgba(20,18,15,.92) !important;
  box-shadow:0 4px 14px #0003 !important;
}
.viewport-fps-head { gap:6px !important; min-height:20px !important; }
.viewport-fps .fps-indicator { flex:none; }
.viewport-fps strong { font-size:12px !important; }
.viewport-render-stats {
  display:flex;
  align-items:center;
  gap:9px !important;
  padding:0 0 0 9px !important;
  border-top:0 !important;
  border-left:1px solid #2e2b25;
  font-size:9px !important;
}
.viewport-render-stats span { white-space:nowrap; }
.chips {
  top:auto !important;
  bottom:76px !important;
  left:72px !important;
  right:auto !important;
}
.axes {
  bottom:38px !important;
  left:72px !important;
  right:auto !important;
}
@media(max-width:1180px) {
  .viewport-actions { left:56px; max-width:calc(100% - 72px); }
}
@media(max-width:900px) {
  .viewport-actions { gap:4px; }
  .viewport-actions .quick-add-trigger,
  .viewport-actions .model-import-launch { padding-inline:9px !important; font-size:11px; }
  .viewport-render-stats span:nth-child(n+3) { display:none; }
  .chips { bottom:72px !important; }
}
@media(max-width:760px) {
  .viewport-actions { left:54px; top:10px; }
  .viewport-actions .quick-add-trigger { padding-inline:8px; }
  .viewport-actions .model-import-launch { padding-inline:8px !important; }
  .viewport-actions .quick-add-trigger { gap:4px; }
  .viewport-fps { max-width:calc(100% - 90px); right:8px !important; bottom:36px !important; gap:6px !important; }
  .viewport-render-stats { gap:6px !important; padding-left:6px !important; }
  .viewport-render-stats span:nth-child(n+2) { display:none; }
  .chips { left:54px !important; bottom:70px !important; }
  .axes { left:54px !important; bottom:36px !important; }
}


/* Collapsible workspace sidebar and labeled recovery toolbar. */
.sidebar-hamburger {
  position:fixed;
  z-index:29;
  top:68px;
  left:12px;
  display:grid;
  place-items:center;
  width:36px;
  height:36px;
  min-height:36px;
  padding:0;
  border:1px solid #3b3730;
  border-radius:8px;
  background:rgba(29,27,23,.97);
  color:#f3efe6;
  box-shadow:0 5px 16px #0004;
  cursor:pointer;
}
.sidebar-hamburger svg { display:block; width:19px; height:19px; }
.sidebar-hamburger:hover { border-color:#75412e; background:#34241c; color:#ff997d; }
.sidebar-hamburger:focus-visible,.sidebar-collapse-button:focus-visible { outline:2px solid #e8572b; outline-offset:2px; }

.panel.left .panel-head {
  display:flex !important;
  align-items:center;
  justify-content:flex-start;
  gap:10px;
  min-height:46px;
  height:46px;
  padding:5px 10px;
  border-bottom:1px solid #2e2b25 !important;
  background:#191713 !important;
}
.panel.left .panel-head-title { display:flex; flex:1; flex-direction:column; gap:1px; min-width:0; }
.panel.left .panel-head .eyebrow { font-size:9px; letter-spacing:.1em; }
.panel.left .panel-head .h { overflow:hidden; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.sidebar-collapse-button {
  display:grid;
  place-items:center;
  flex:none;
  width:32px;
  height:32px;
  min-height:32px;
  padding:0;
  border:1px solid #3b3730;
  border-radius:7px;
  background:#1d1b17;
  color:#b5afa2;
  cursor:pointer;
}
.sidebar-collapse-button svg { display:block; width:18px; height:18px; }
.sidebar-collapse-button:hover { border-color:#75412e; background:#34241c; color:#ff997d; }
.app.sidebar-collapsed .panel.left { display:none !important; }

/* Collapsed workspace: compact rail docked directly below the top bar. */
.app.sidebar-collapsed .toolbar {
  position:fixed !important;
  top:56px !important;
  bottom:28px !important;
  left:0 !important;
  right:auto !important;
  width:172px !important;
  min-width:172px !important;
  max-width:calc(100vw - 18px) !important;
  height:auto !important;
  min-height:0 !important;
  max-height:none !important;
  margin:0 !important;
  padding:132px 7px 10px !important;
  display:flex !important;
  flex-direction:column !important;
  align-items:stretch !important;
  justify-content:flex-start !important;
  gap:6px !important;
  overflow-x:hidden !important;
  overflow-y:auto !important;
  border:0 !important;
  border-right:1px solid #363129 !important;
  border-radius:0 !important;
  background:#191713 !important;
  box-shadow:4px 0 18px #0003 !important;
  scrollbar-width:thin;
  scrollbar-color:#494137 transparent;
}
.app.sidebar-collapsed .toolbar .toolbar-group {
  display:flex !important;
  flex:none;
  width:100%;
  flex-direction:column;
  align-items:stretch;
  gap:3px;
}
/* Keep section labels visible, while preserving the full tool names. */
.app.sidebar-collapsed .toolbar .toolbar-group::before {
  display:block;
  padding:5px 7px 4px;
  color:#8f877a;
  font-size:9px;
  font-weight:700;
  line-height:1.2;
  letter-spacing:.1em;
  text-transform:uppercase;
}
.app.sidebar-collapsed .toolbar .toolbar-group:nth-of-type(1)::before { content:"FERRAMENTAS"; }
.app.sidebar-collapsed .toolbar .toolbar-group:nth-of-type(2)::before { content:"TRANSFORMAR"; }
.app.sidebar-collapsed .toolbar .toolbar-group:nth-of-type(3)::before { content:"INSERIR E LÓGICA"; }
.app.sidebar-collapsed .toolbar .toolbar-group:nth-of-type(4)::before { content:"VISUALIZAÇÃO"; }
.app.sidebar-collapsed .toolbar .toolbar-separator {
  display:block;
  flex:none;
  width:auto;
  height:1px;
  margin:1px 4px 2px;
  background:#2e2b25;
}
.app.sidebar-collapsed .toolbar .tool {
  display:flex !important;
  flex-direction:row;
  align-items:center;
  justify-content:flex-start !important;
  gap:8px;
  width:100% !important;
  min-width:0 !important;
  height:auto !important;
  min-height:34px !important;
  padding:5px 7px !important;
  border:1px solid transparent !important;
  border-radius:6px !important;
  background:transparent !important;
  color:#b5afa2 !important;
  box-sizing:border-box;
  text-align:left;
  transition:background-color .12s ease,border-color .12s ease,color .12s ease;
}
.app.sidebar-collapsed .toolbar .tool:hover {
  border-color:#3b3730 !important;
  background:#26231e !important;
  color:#f3efe6 !important;
}
.app.sidebar-collapsed .toolbar .tool.active {
  border-color:#75412e !important;
  background:#34241c !important;
  color:#ff997d !important;
}
.app.sidebar-collapsed .toolbar .tool-ico {
  display:grid;
  place-items:center;
  flex:none;
  width:20px;
  font-size:16px;
  line-height:1;
  text-align:center;
}
.app.sidebar-collapsed .toolbar .tool-label {
  position:static !important;
  display:block;
  flex:1;
  width:auto !important;
  height:auto !important;
  min-width:0;
  margin:0 !important;
  padding:0 !important;
  overflow:hidden !important;
  clip:auto !important;
  border:0 !important;
  color:inherit !important;
  background:transparent !important;
  box-shadow:none !important;
  font-size:11px;
  line-height:1.25;
  text-align:left;
  text-overflow:ellipsis;
  white-space:nowrap !important;
}
.app.sidebar-collapsed .toolbar .tool:focus-visible {
  outline:2px solid #e8572b;
  outline-offset:1px;
}
/* Quick actions docked into the upper part of the collapsed sidebar. */
.app.sidebar-collapsed:not(.world-fullscreen) .viewport-actions {
  display:none !important;
}
.collapsed-sidebar-actions { display:none; }
.app.sidebar-collapsed .collapsed-sidebar-actions {
  position:fixed;
  z-index:30;
  top:98px;
  left:0;
  display:flex;
  flex-direction:column;
  align-items:stretch;
  gap:5px;
  width:172px;
  box-sizing:border-box;
  padding:6px 7px 9px;
  border-right:1px solid #363129;
  border-bottom:1px solid #2e2b25;
  background:#191713;
}
.app.sidebar-collapsed .collapsed-sidebar-add-wrap {
  position:relative !important;
  z-index:32;
  top:auto !important;
  right:auto !important;
  left:auto !important;
  width:100%;
}
.app.sidebar-collapsed .collapsed-sidebar-action {
  display:flex;
  align-items:center;
  justify-content:flex-start;
  gap:9px;
  width:100%;
  min-width:0;
  height:34px;
  min-height:34px;
  padding:0 8px;
  border:1px solid #3b3730;
  border-radius:6px;
  background:#211e19;
  color:#e4ded3;
  font:500 11px/1 'IBM Plex Sans',sans-serif;
  text-align:left;
  white-space:nowrap;
  cursor:pointer;
  box-sizing:border-box;
}
.app.sidebar-collapsed .collapsed-sidebar-action:hover,
.app.sidebar-collapsed .collapsed-sidebar-add-trigger[aria-expanded="true"] {
  border-color:#75412e;
  background:#34241c;
  color:#f3efe6;
}
.app.sidebar-collapsed .collapsed-sidebar-action-icon {
  display:grid;
  place-items:center;
  flex:none;
  width:20px;
  color:#e8572b;
  font-size:17px;
  line-height:1;
}
.app.sidebar-collapsed .collapsed-sidebar-add-trigger .quick-add-chevron {
  margin-left:auto;
  color:#b5afa2;
  font-size:10px;
}
.app.sidebar-collapsed .collapsed-sidebar-add-popover {
  z-index:50;
  top:calc(100% + 5px) !important;
  right:auto !important;
  left:0 !important;
  width:240px;
  max-width:calc(100vw - 184px);
  box-sizing:border-box;
}
.app.sidebar-collapsed .collapsed-sidebar-add-popover > button {
  min-width:0;
}

/* The reopen control is the menu's own header, flush against the top bar. */
.app.sidebar-collapsed .sidebar-hamburger {
  position:fixed;
  z-index:31;
  top:56px;
  left:0;
  display:flex;
  align-items:center;
  justify-content:flex-start;
  gap:10px;
  width:172px;
  height:42px;
  min-height:42px;
  padding:0 12px;
  border:0;
  border-right:1px solid #363129;
  border-bottom:1px solid #2e2b25;
  border-radius:0;
  background:#191713;
  color:#b5afa2;
  box-shadow:none;
  font:500 12px/1 'IBM Plex Sans',sans-serif;
  text-align:left;
}
.app.sidebar-collapsed .sidebar-hamburger svg { flex:none; width:18px; height:18px; }
.app.sidebar-collapsed .sidebar-hamburger span { display:block; }
.app.sidebar-collapsed .sidebar-hamburger:hover { border-color:#363129; background:#26231e; color:#ff997d; }
.app.world-fullscreen .sidebar-hamburger { display:none !important; }
@media(max-width:760px) {
  .app.sidebar-collapsed .toolbar {
    top:56px !important;
    bottom:28px !important;
    left:0 !important;
    width:160px !important;
    min-width:160px !important;
    max-width:calc(100vw - 12px) !important;
    padding:132px 5px 8px !important;
  }
  .app.sidebar-collapsed .collapsed-sidebar-actions {
    top:98px;
    width:160px;
    max-width:calc(100vw - 12px);
    padding:6px 5px 8px;
  }
  .app.sidebar-collapsed .collapsed-sidebar-action {
    height:32px;
    min-height:32px;
    padding-inline:7px;
  }
  .app.sidebar-collapsed .collapsed-sidebar-add-popover {
    max-width:calc(100vw - 172px);
  }
  .app.sidebar-collapsed .toolbar .tool {
    min-height:32px !important;
    padding:5px 6px !important;
    gap:7px;
  }
  .app.sidebar-collapsed .toolbar .tool-label { font-size:10px; }
  .app.sidebar-collapsed .sidebar-hamburger {
    top:56px;
    left:0;
    width:160px;
    max-width:calc(100vw - 12px);
    padding-inline:10px;
  }
}
/* A barra de status fica fixa sobre os últimos 28 px da janela; a HUD termina antes dela. */
.app:not(.world-fullscreen) .viewport > .player-hud {
  bottom:28px !important;
  height:auto !important;
}

/* The HUD must use only the area to the right of the collapsed editor rail. */
.app.sidebar-collapsed:not(.world-fullscreen) .viewport > .player-hud {
  left:172px !important;
  right:0 !important;
  width:calc(100% - 172px) !important;
}
@media(max-width:760px) {
  .app.sidebar-collapsed:not(.world-fullscreen) .viewport > .player-hud {
    left:160px !important;
    width:calc(100% - 160px) !important;
  }
}

/* Keep viewport indicators outside the collapsed sidebar's footprint. */
.app.sidebar-collapsed:not(.world-fullscreen) .chips,
.app.sidebar-collapsed:not(.world-fullscreen) .axes {
  left:188px !important;
}
@media(max-width:760px) {
  .app.sidebar-collapsed:not(.world-fullscreen) .chips,
  .app.sidebar-collapsed:not(.world-fullscreen) .axes {
    left:172px !important;
  }
}
</style>

<style>
/* Configuração do layout: os quatro elementos usam coordenadas medidas a partir da viewport. */
.app .toolbar.viewport-layout-positioned,
.app .viewport-fps.viewport-layout-positioned,
.app .axes.viewport-layout-positioned,
.app .viewport-tools-overlay.viewport-layout-positioned {
  position: fixed !important;
  left: var(--viewport-layout-left, 0px) !important;
  top: var(--viewport-layout-top, 0px) !important;
  right: auto !important;
  bottom: auto !important;
  transform: scale(var(--viewport-layout-scale, 1)) !important;
  transform-origin: top left !important;
  max-width: var(--viewport-layout-max-width, 100%) !important;
}
.app .toolbar.viewport-layout-positioned {
  box-sizing: border-box !important;
  width: 42px !important;
  min-width: 42px !important;
  max-height: var(--viewport-layout-max-height, 80vh) !important;
  height: auto !important;
  min-height: 0 !important;
  padding: 5px !important;
  gap: 5px !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
}
.app .toolbar.viewport-layout-positioned .toolbar-group { width: 100%; align-items: stretch; flex: none; gap: 3px; }
.app .toolbar.viewport-layout-positioned .toolbar-separator { flex: none; width: 100%; }
.app .toolbar.viewport-layout-positioned .tool {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  width: 30px !important;
  min-width: 30px !important;
  min-height: 32px !important;
  height: 32px !important;
  padding: 0 !important;
  gap: 0 !important;
}
.app .toolbar.viewport-layout-positioned .tool-ico { flex: none; width: auto; font-size: 16px; }
.app .toolbar.viewport-layout-positioned .tool-label {
  position: absolute !important;
  display: block !important;
  width: 1px !important;
  height: 1px !important;
  min-width: 0 !important;
  margin: -1px !important;
  padding: 0 !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
.app .viewport-tools-overlay.viewport-layout-positioned {
  max-width: var(--viewport-layout-max-width, calc(100vw - 24px)) !important;
}
.app .axes.viewport-layout-positioned { display: flex; }
.viewport-layout-config-trigger {
  position: absolute;
  z-index: 140;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid #51412e;
  border-radius: 8px;
  background: rgba(25, 22, 18, .96);
  color: #f0c28c;
  box-shadow: 0 5px 18px #0006;
  cursor: pointer;
}
.viewport-layout-config-trigger svg { width: 19px; height: 19px; }
.viewport-layout-config-trigger:hover,
.viewport-layout-config-trigger[aria-expanded="true"] { border-color: #e5a567; background: #34281d; color: #ffe0b8; }
.viewport-layout-config-panel {
  position: absolute;
  z-index: 150;
  top: 58px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  width: min(360px, calc(100% - 24px));
  max-height: calc(100% - 70px);
  overflow: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  padding: 13px;
  border: 1px solid #45392b;
  border-radius: 9px;
  background: rgba(24, 22, 19, .98);
  color: #eee8de;
  box-shadow: 0 18px 45px #000a;
  font: 11px/1.4 'IBM Plex Sans', sans-serif;
  text-shadow: none;
}
.viewport-layout-config-heading { display: flex; align-items: center; gap: 9px; padding-bottom: 10px; border-bottom: 1px solid #373027; }
.viewport-layout-config-icon { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border: 1px solid #59442f; border-radius: 7px; background: #30251b; color: #f0ba7c; font-size: 17px; }
.viewport-layout-config-heading > div { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.viewport-layout-config-heading strong { color: #fff4e6; font-size: 13px; font-weight: 650; }
.viewport-layout-config-heading small { color: #a79b8b; font-size: 10px; }
.viewport-layout-close { display: grid; place-items: center; flex: none; width: 27px; height: 27px; border: 1px solid #39342d; border-radius: 5px; background: #211e19; color: #bdb2a3; font-size: 18px; cursor: pointer; }
.viewport-layout-items { display: flex; flex-direction: column; gap: 4px; }
.viewport-layout-item { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 48px; padding: 6px 8px; border: 1px solid #302c26; border-radius: 6px; background: #201e1a; color: #e3ddd4; text-align: left; cursor: pointer; }
.viewport-layout-item:hover { border-color: #65503b; background: #29251f; }
.viewport-layout-item.active { border-color: #9a6439; background: #34271b; }
.viewport-layout-item-icon { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 5px; background: #302a22; color: #edb579; font: 600 12px 'IBM Plex Mono', monospace; }
.viewport-layout-item-copy { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.viewport-layout-item-copy strong { color: #f4eee4; font-size: 11px; font-weight: 650; }
.viewport-layout-item-copy small { color: #9e9486; font-size: 9px; line-height: 1.3; }
.viewport-layout-item-check { color: #e5a567; font-size: 11px; }
.viewport-layout-adjustments { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; border-top: 1px solid #373027; }
.viewport-layout-section-title { color: #aa9f91; font: 700 9px 'IBM Plex Mono', monospace; letter-spacing: .08em; }
.viewport-layout-range { display: flex; flex-direction: column; gap: 5px; color: #bfb5a7; font-size: 10px; }
.viewport-layout-range > span { display: flex; justify-content: space-between; gap: 12px; }
.viewport-layout-range strong { color: #f0bf87; font: 600 10px 'IBM Plex Mono', monospace; }
.viewport-layout-range input { width: 100%; margin: 0; accent-color: #e3a05f; cursor: pointer; }
.viewport-layout-actions { display: flex; gap: 6px; }
.viewport-layout-secondary { flex: 1; min-height: 29px; padding: 5px 7px; border: 1px solid #39342c; border-radius: 5px; background: #211e19; color: #bfb4a4; font-size: 10px; cursor: pointer; }
.viewport-layout-secondary:hover { border-color: #68503a; color: #fff0de; }
.viewport-layout-panel-footer { display: flex; flex-direction: column; gap: 7px; padding-top: 10px; border-top: 1px solid #373027; }
.viewport-layout-drag-toggle,.viewport-layout-hud-button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 34px; padding: 7px 9px; border: 1px solid #62503a; border-radius: 6px; background: #30261c; color: #efc18c; font-size: 10px; font-weight: 650; cursor: pointer; }
.viewport-layout-drag-toggle svg,.viewport-layout-hud-button svg { flex: none; width: 15px; height: 15px; }
.viewport-layout-drag-toggle.active { border-color: #e4a467; background: #493321; color: #ffe2bd; }
.viewport-layout-hud-button { border-color: #3c454c; background: #23282d; color: #d0d8e0; }
.viewport-layout-hud-button:hover { border-color: #797f85; background: #2c3339; }
.viewport-layout-panel-footer p { margin: 1px 0 0; color: #8f8678; font-size: 9px; line-height: 1.45; }
.viewport-layout-handles { position: absolute; z-index: 130; inset: 0; overflow: hidden; pointer-events: none; }
.viewport-layout-outline { position: absolute; box-sizing: border-box; min-width: 20px; min-height: 20px; border: 1px solid #efad65; border-radius: 3px; background: #ed9e4510; box-shadow: 0 0 0 1px #100d09a8, 0 0 0 1px #f1b7762b inset; pointer-events: none; }
.viewport-layout-move-handle,.viewport-layout-resize-handle { position: absolute; z-index: 2; display: grid; place-items: center; width: 23px; height: 21px; padding: 0; border: 1px solid #7f5834; border-radius: 4px; background: #35261b; color: #ffd09a; font-size: 15px; line-height: 1; pointer-events: auto; cursor: grab; touch-action: none; }
.viewport-layout-move-handle { top: 2px; left: 2px; }
.viewport-layout-resize-handle { right: 2px; bottom: 2px; cursor: nwse-resize; }
.viewport-layout-move-handle:active { cursor: grabbing; }
.viewport-layout-outline-name { position: absolute; top: 3px; left: 29px; max-width: calc(100% - 58px); overflow: hidden; padding: 4px 6px; border-radius: 3px; background: #20170fef; color: #f7d5ad; font: 600 9px 'IBM Plex Sans', sans-serif; white-space: nowrap; text-overflow: ellipsis; pointer-events: none; }
@media(max-width:760px) {
  .viewport-layout-config-panel { right: 8px; top: 54px; width: min(350px, calc(100% - 16px)); max-height: calc(100% - 62px); padding: 10px; }
  .viewport-layout-config-trigger { right: 8px; top: 8px; width: 34px; height: 34px; }
  .viewport-layout-item { min-height: 43px; }
}
</style>
