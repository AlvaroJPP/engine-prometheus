import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { ENGINE_VERSION, TERRAIN_ID, markEntity, BEHAVIOR_PACKAGE_DEFINITIONS, getBehaviorPackageDefinition } from '@engine'
import type { ToolMode, TransformMode, LogicRule, BehaviorPackageInstance, BehaviorPackageDefinition, PackageJsonValue, PackageScalar, ControlMapSettings } from '@engine'
import { CAMERA_LABELS, useEditor } from '@/composables/useEditor'
import { loadControlMapSettings, saveControlMapSettings } from '@/lib/controls/controlMapSettings'
import * as THREE from 'three'
import { useViewportLayout } from '@/composables/useViewportLayout'
import { useWorldFullscreen } from '@/composables/useWorldFullscreen'
import { useVisualScriptController } from '@/composables/useVisualScriptController'
import { useVisualScriptController } from '@/composables/useVisualScriptController'
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
