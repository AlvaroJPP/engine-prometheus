import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ENGINE_VERSION, TERRAIN_ID, BEHAVIOR_PACKAGE_DEFINITIONS, getBehaviorPackageDefinition } from '@engine'
import type { LogicRule, BehaviorPackageInstance, BehaviorPackageDefinition, PackageJsonValue, PackageScalar, ControlMapSettings } from '@engine'
import { CAMERA_LABELS, useEditor } from '@/composables/useEditor'
import { loadControlMapSettings, saveControlMapSettings } from '@/lib/controls/controlMapSettings'
import { useViewportLayout } from '@/composables/useViewportLayout'
import { useWorldFullscreen } from '@/composables/useWorldFullscreen'
import { useVisualScriptController } from '@/composables/useVisualScriptController'
import { useComponentLibraryController } from '@/composables/useComponentLibraryController'

export function useAppController() {
const appRoot = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const viewportRoot = ref<HTMLElement | null>(null)
const rootOpen = ref(true)
const sidebarCollapsed = ref(false)
const inspectorTab = ref<'transform' | 'color' | 'variables' | 'nodes' | 'packages'>('transform')
const executionMode = ref<'edit' | 'running'>('edit')
const worldFullscreen = ref(false)
const playerHudSettingsOpen = ref(false)

const {
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
} = useViewportLayout({
  executionMode,
  worldFullscreen,
  sidebarCollapsed,
  viewportRoot,
  playerHudSettingsOpen,
})


watch(executionMode, (mode) => {
  // A configuração da HUD pertence ao modo de edição; ao iniciar o jogo, feche-a.
  if (mode !== 'edit') playerHudSettingsOpen.value = false
})
const controlMapsOpen = ref(false)
const controlMapSettings = ref<ControlMapSettings>(loadControlMapSettings())
const activeControlMap = computed(() =>
  controlMapSettings.value.profiles.find(profile => profile.id === controlMapSettings.value.activeProfileId)
  ?? controlMapSettings.value.profiles[0]!,
)
const firstPersonMode = ref(false)
const publicLibraryOpen = ref(false)

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
  createLogicVariable(newVariableName.value, neconst {
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
} = useVisualScriptController({
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
})
con: '↻', label: 'Rotacionar' },
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
const {
  backfillMissingComponentThumbnails,
  closeModelImport,
  handleModelImport,
  handleSaveAnimationSource,
  handleUsePlayerModel,
  modelImportOpen,
  moveSavedComponentGroup,
  placeSavedComponent,
  placeableSavedComponents,
  previewAnimationSourceAsset,
  previewComponentAsset,
  previewSavedComponent,
  removeSavedComponent,
  renameSavedComponent,
  savedAnimationSourceOptions,
  savedComponents,
  useSavedAnimationSource,
} = useComponentLibraryController({
  status,
  setPlayerModelAsset,
  setBuildComponentPlacement,
})

function closeQuickAddOutside(event: PointerEvent) {
  const target = event.target
  if (target instanceof Element && !target.closest('.quick-add-wrap')) quickAddOpen.value = false
}

onMounted(() => {
  window.addEventListener('pointerdown', closeQuickAddOutside)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeQuickAddOutside)
})

const { fullscreenTransition, toggleWorldFullscreen } = useWorldFullscreen({
  appRoot,
  worldFullscreen,
  beforeEnter: () => { quickAddOpen.value = false },
  refreshViewportLayoutBounds,
  viewportLayoutRefresh,
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
