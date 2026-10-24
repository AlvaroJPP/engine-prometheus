<script setup lang="ts">
import { computed, isReadonly, isRef, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { disposeThreeObjectResources } from '@/lib/assets/ThreeObjectResources'
import { revokeOwnedObjectUrls } from '@/lib/assets/ModelOwnedObjectUrls'
import { createModelColliderPreview, disposeModelColliderPreview } from '@/lib/assets/ModelColliderPreview'
import { disposeImportedModelResources } from '@/lib/assets/ModelImportResourceCleanup'
import {
  calculateImportColliderSize,
  calculateImportColliderSizeFromObjectBounds,
  normalizeImportColliderForType,
  updateImportColliderVector,
} from '@/lib/assets/ModelColliderSizing'
import { measureModelImportSpatialData } from '@/lib/assets/ModelSpatialMeasurements'
import { calculateModelImportTransform, normalizeModelImportHeight } from '@/lib/assets/ModelImportNormalization'
import { shouldDefaultToStaticCityCollider } from '@/lib/assets/ModelColliderDefaults'
import { createRigPreviewHelper, disposeRigPreviewHelper } from '@/lib/animation/RigPreviewHelper'
import { getModelPreviewNodePath } from '@/lib/assets/ModelPreviewParts'
import { fitModelPreviewCamera } from '@/lib/assets/ModelPreviewCamera'
import { startModelPreviewRenderLoop } from '@/lib/assets/ModelPreviewRenderLoop'
import { createModelPreviewStage } from '@/lib/assets/ModelPreviewStage'
import type { ModelImportBatchItem } from '@/lib/assets/ModelImportBatchPreparation'
import { createPlayerModelBytes } from '@/lib/assets/ModelPlayerExport'
import { reconcileModelPreviewPartState } from '@/lib/assets/ModelPreviewPartState'
import type { ModelPreviewPart } from '@/lib/assets/ModelPreviewParts'
import {
  isWithinModelPreviewTree,
  restoreModelPreviewVisibility,
  setModelPreviewSoloVisibility,
  toggleModelPreviewBatchSelection,
} from '@/lib/assets/ModelPreviewSelection'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import {
  invalidateStaticMeshCollider,
  releaseStaticMeshCollider,
} from '@engine/world/StaticMeshCollider'
import { analyzeModelDiagnostics } from '@/lib/assets/ModelDiagnostics'
import { recoverModelBaseColorTexture } from '@/lib/assets/ModelColorTextureRecovery'
import type { ModelDiagnostic, ModelDiagnosticSummary } from '@/lib/assets/ModelDiagnostics'
import { formatModelControlKey } from '@/lib/assets/ModelControlBindings'

import type { GltfMetadata } from '@/lib/assets/GltfMetadata'
import { AnimationController, inferAnimationRole } from '@engine/world/AnimationController'
import { BEHAVIOR_PACKAGE_DEFINITIONS, DEFAULT_CONTROL_MAPS, DEFAULT_MODEL_CONTROL_BINDINGS } from '@engine'
import type { AnimationRole, ControlMapBindings, ModelControlBindings } from '@engine'
import { isTauri } from '@tauri-apps/api/core'
import { analyzeRiggingInput } from '@/lib/animation/Rigging'
import { isSkinTokensRigCompatible } from '@/lib/animation/SkinTokensRigCompatibility'
import { collectRetargetSourceBoneNames } from '@/lib/animation/RetargetSourceBones'
import { createModelImportRetargetingController } from '@/lib/animation/ModelImportRetargetingController'
import { createModelImportRiggingController } from '@/lib/animation/ModelImportRiggingController'
import { createModelImportSkinTokensController } from '@/lib/assets/ModelImportSkinTokensController'
import { createModelImportBehaviorPackageController } from '@/lib/assets/ModelImportBehaviorPackageController'
import { createModelImportLoadingController } from '@/lib/assets/ModelImportLoadingController'
import { createModelImportSaveController } from '@/lib/assets/ModelImportSaveController'
import { captureModelPreviewThumbnail } from '@/lib/assets/ModelPreviewThumbnail'
import { createCustomModelThumbnail } from '@/lib/assets/CustomModelThumbnail'
import { ModelPreviewAnimationRuntime, previewAnimationRoleForClip } from '@/lib/animation/ModelPreviewAnimationRuntime'
import { restoreRenderableMeshes } from '@/lib/animation/ModelRenderableMeshes'
import type { RigAnimationKeyframe as RigKeyframe, RigAnimationPose as RigPose } from '@/lib/animation/RigAnimationClip'
import type { AutoRigPreset } from '@/lib/animation/Rigging'
import { cloneImportBehaviorPackageSettings } from '@/lib/assets/ImportBehaviorPackageDrafts'
import type { ImportBehaviorPackageDraft } from '@/lib/assets/ImportBehaviorPackageDrafts'
import {
  formatPackageConfigLabel,
  isSimplePackageConfigValue,
} from '@/lib/assets/ImportBehaviorPackageConfig'
import { ANIMATION_ROLE_BASE_OPTIONS, ANIMATION_ROLE_CONTROL_BINDING_KEYS } from '@/lib/animation/AnimationRoleOptions'
import { rankTargetBoneCandidates } from '@/lib/animation/AnimationRetargeting'
import type { ReusableAnimationAsset } from '@/lib/animation/AnimationRetargeting'
import StarterAssetCatalogDialog from '@/components/StarterAssetCatalogDialog.vue'
import ModelImportRightPanel from '@/components/ModelImportRightPanel.vue'

type ModelImportPayload = {
  name: string
  model: THREE.Object3D
  height: number
  thumbnail?: string
  componentId?: string
  sourceGlbBytes?: ArrayBuffer
  batchModels?: ModelImportBatchItem[]
}

const props = defineProps<{ open: boolean; saveModel: (payload: ModelImportPayload) => Promise<boolean>; controlMap?: Partial<ControlMapBindings>; initialAsset?: { id?: string; name: string; bytes: ArrayBuffer; height?: number; colliderType?: 'box' | 'sphere' | 'capsule' | 'mesh' | 'none'; colliderSize?: [number, number, number]; colliderOffset?: [number, number, number]; kind?: 'object' | 'entity'; libraryType?: 'object' | 'animated-model' | 'animation-source'; animationRoles?: Record<string, AnimationRole>; controlBindings?: Partial<ModelControlBindings>; behaviorPackageIds?: string[]; behaviorPackageSettings?: Record<string, ImportBehaviorPackageDraft>; thumbnail?: string } | null; animationSourceAsset?: { id: string; name: string; bytes: ArrayBuffer; height?: number; libraryType?: 'animation-source' } | null; animationSourceOptions?: Array<{ id: string; name: string; height?: number; thumbnail?: string }> }>()
const isEditingSavedComponent = computed(() => Boolean(props.initialAsset?.id))

const isReadOnlyPreview = computed(() => Boolean(props.initialAsset) && !isEditingSavedComponent.value)

const emit = defineEmits<{
  close: []
  'use-player': [payload: { name: string; bytes: ArrayBuffer; animationRoles: Record<string, AnimationRole>; height: number }]
  'save-animation-source': [payload: { name: string; bytes: ArrayBuffer; height: number }]
  'load-animation-source': [id: string]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const customThumbnail = ref<string | null>(null)
const customThumbnailFileName = ref('')
const thumbnailImageError = ref('')
const canvas = ref<HTMLCanvasElement | null>(null)
const fileName = ref('')
const error = ref('')
const loading = ref(false)
const starterAssetCatalogOpen = ref(false)
const modelHeight = ref(2)
const originalHeight = ref(0)
const dimensions = ref<[number, number, number]>([0, 0, 0])
const model = shallowRef<THREE.Object3D | null>(null)
const previewParts = shallowRef<Array<ModelPreviewPart>>([])
const selectedPartId = ref('')
const batchSelectedPartIds = ref<string[]>([])
const batchSavedPartIds = ref<string[]>([])
const batchNotice = ref('')
const batchSelectedCount = computed(() => batchSelectedPartIds.value.length)
const soloPartId = ref('')
const partSearch = ref('')
const componentName = ref('')
const selectedBehaviorPackageIds = ref<string[]>([])
const selectedBehaviorPackageSettings = ref<Record<string, ImportBehaviorPackageDraft>>({})

const selectedBehaviorPackageDefinitions = computed(() => BEHAVIOR_PACKAGE_DEFINITIONS.filter(definition =>
  selectedBehaviorPackageIds.value.includes(definition.id),
))

const previewPackageModelNodes = computed(() => {
  const baseModel = model.value
  if (!baseModel) return []
  const chosenPart = !isEditingSavedComponent.value && selectedPartId.value
    ? findPreviewPart(selectedPartId.value)
    : undefined
  const activeRoot = chosenPart?.object ?? baseModel
  const result = previewParts.value
    .filter(part => part.object !== activeRoot && isWithinModelPreviewTree(part.object, activeRoot))
    .map(part => ({
      path: getModelPreviewNodePath(part.object, activeRoot),
      name: part.name,
      meshCount: part.meshCount,
    }))
    .filter(node => node.path)
  const rootPath = getModelPreviewNodePath(activeRoot, activeRoot)
  const rootPart = chosenPart
    ? { path: rootPath, name: chosenPart.name, meshCount: chosenPart.meshCount }
    : {
        path: rootPath,
        name: baseModel.name.trim() || 'Modelo inteiro',
        meshCount: previewParts.value.reduce((count, part) => part.depth === 0 ? count + part.meshCount : count, 0),
      }
  // A raiz fica disponível no seletor, mas os filhos aparecem primeiro para
  // que a criação de um novo estado visual escolha uma parte, não o modelo inteiro.
  return rootPart.meshCount > 0 ? [...result, rootPart] : result
})

const modelDiagnostics = shallowRef<ModelDiagnostic[]>([])
const diagnosticSummary = ref<ModelDiagnosticSummary>({ nodes: 0, meshes: 0, skinned: 0, materials: 0, textures: 0, clips: 0 })
const previewAnimationIndex = ref(0)
const previewPlaying = ref(true)
const animationClipRevision = ref(0)
const animationRoles = ref<Record<string, AnimationRole>>({})
const previewAnimations = computed(() => {
  const revision = animationClipRevision.value
  void revision
  return (model.value?.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
})
type SetupTab = 'model' | 'controls' | 'animations' | 'rigging' | 'technical'
type ControlBindingAction = keyof ModelControlBindings
const activeSetupTab = ref<SetupTab>('model')
const controlBindings = ref<ModelControlBindings>({ ...DEFAULT_MODEL_CONTROL_BINDINGS })
const listeningForBinding = ref<ControlBindingAction | null>(null)
const setupTabs: Array<{ id: SetupTab; label: string; description: string }> = [
  { id: 'model', label: 'Modelo', description: 'Nome, escala e colisão' },
  { id: 'controls', label: 'Controles', description: 'Teclas e comandos' },
  { id: 'animations', label: 'Animações', description: 'Mapear e testar clipes' },
  { id: 'rigging', label: 'Rig & keyframes', description: 'Criar rig e animar ossos' },
  { id: 'technical', label: 'Avançado', description: 'Diagnóstico e texturas' },
]
const controlBindingFields: Array<{ key: ControlBindingAction; label: string; description: string }> = [
  { key: 'forward', label: 'Mover para frente', description: 'Deslocamento para frente' },
  { key: 'backward', label: 'Mover para trás', description: 'Deslocamento para trás' },
  { key: 'left', label: 'Mover para esquerda', description: 'Deslocamento lateral esquerdo' },
  { key: 'right', label: 'Mover para direita', description: 'Deslocamento lateral direito' },
  { key: 'run', label: 'Correr', description: 'Mantida pressionada durante o movimento' },
  { key: 'jump', label: 'Pular', description: 'Salto do personagem ou montaria' },
  { key: 'interact', label: 'Interagir / montar', description: 'Montar e desmontar quando o pacote Montaria estiver instalado' },
]
const activeControlMapBindings = computed(() => props.controlMap ?? DEFAULT_CONTROL_MAPS[0]!.bindings)
const animationRoleOptions = computed(() => ANIMATION_ROLE_BASE_OPTIONS.map(option => {
  const bindingKey = ANIMATION_ROLE_CONTROL_BINDING_KEYS[option.value]
  if (!bindingKey) return option
  const keyCode = activeControlMapBindings.value[bindingKey] ?? DEFAULT_CONTROL_MAPS[0]!.bindings[bindingKey]
  return { ...option, label: `${option.label} · ${formatModelControlKey(keyCode)}` }
}))
const rigPreset = ref<AutoRigPreset>('auto')
const rigBones = shallowRef<THREE.Bone[]>([])
const rigRestPose = shallowRef<RigPose>({})
const selectedRigBoneName = ref('')
const rigKeyframes = ref<RigKeyframe[]>([])
const rigFrameTime = ref(0)
const rigDuration = ref(1)
const rigClipName = ref('Animacao personalizada')
const rigClipRole = ref<AnimationRole>('mount')
const rigMessage = ref('')
type SkinTokensOperation = 'rig' | 'skin'
type SkinTokensClassChoice = 'auto' | 'humanoid' | 'quadruped' | 'custom'
const skinTokensExecutablePath = ref(typeof localStorage !== 'undefined' ? localStorage.getItem('engine-prometheus.skintokens.executable') ?? '' : '')
const skinTokensOperation = ref<SkinTokensOperation>('rig')
const skinTokensClassChoice = ref<SkinTokensClassChoice>('auto')
const skinTokensLoading = ref(false)
const skinTokensMessage = ref('')
const skinTokensClassOptions: Array<{ value: SkinTokensClassChoice; label: string }> = [
  { value: 'auto', label: 'Detectar classe automaticamente' },
  { value: 'humanoid', label: 'Humanoide' },
  { value: 'quadruped', label: 'Quadrúpede' },
  { value: 'custom', label: 'Outro modelo / anatomia' },
]
watch(skinTokensExecutablePath, value => {
  if (typeof localStorage !== 'undefined') {
    if (value.trim()) localStorage.setItem('engine-prometheus.skintokens.executable', value.trim())
    else localStorage.removeItem('engine-prometheus.skintokens.executable')
  }
})

// Biblioteca de animações reutilizáveis. Armazena clipes e poses de repouso,
// sem guardar a geometria do modelo de origem.
const retargetSourceRoot = shallowRef<THREE.Object3D | null>(null)
const retargetSourceBytes = shallowRef<ArrayBuffer | null>(null)
const selectedSavedAnimationSourceId = ref('')
const retargetSourceFileName = ref('')
const retargetSourceClipIndex = ref(0)
const retargetLibrary = ref<ReusableAnimationAsset[]>([])
const selectedRetargetLibraryId = ref('')
const selectedRetargetLibraryClip = shallowRef<THREE.AnimationClip | null>(null)
const retargetBoneMap = ref<Record<string, string>>({})
const retargetCollapsedSourceNames = ref<string[]>([])
const retargetClipName = ref('')
const retargetMessage = ref('')
const retargetLoading = ref(false)
const retargetAutonomousLoading = ref(false)
const retargetAutonomousStage = ref('')
const retargetSourcePreviewCanvas = ref<HTMLCanvasElement | null>(null)
const retargetTargetPreviewCanvas = ref<HTMLCanvasElement | null>(null)
const retargetSourcePreviewPlaying = ref(true)
const retargetTargetPreviewPlaying = ref(true)
const retargetPreviewStatus = ref('Selecione uma animação e mapeie os ossos para gerar a prévia no destino.')
const retargetLibraryAsset = computed(() =>
  retargetLibrary.value.find(asset => asset.id === selectedRetargetLibraryId.value) ?? null,
)
const retargetSourceClips = computed(() =>
  (retargetSourceRoot.value?.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? [],
)
const retargetSourceClip = computed(() => selectedRetargetLibraryId.value
  ? selectedRetargetLibraryClip.value
  : retargetSourceClips.value[retargetSourceClipIndex.value] ?? null,
)
const retargetSourceNodeNames = computed(() => collectRetargetSourceBoneNames(
  retargetLibraryAsset.value,
  retargetSourceRoot.value,
  retargetSourceClip.value,
))
const retargetTargetBones = computed(() => {
  if (rigBones.value.length) return rigBones.value
  const bones: THREE.Bone[] = []
  model.value?.traverse(node => { if (node instanceof THREE.Bone) bones.push(node) })
  return bones
})
const retargetBoneCandidateRanking = computed(() => rankTargetBoneCandidates(
  retargetSourceNodeNames.value,
  retargetTargetBones.value,
  retargetSourceRoot.value,
  model.value,
))
function retargetSuggestedBonesFor(sourceName: string) {
  return (retargetBoneCandidateRanking.value[sourceName] ?? []).slice(0, 3)
}
function retargetOtherBonesFor(sourceName: string) {
  const suggested = new Set(retargetSuggestedBonesFor(sourceName).map(candidate => candidate.targetName))
  return retargetTargetBones.value.filter(bone => !suggested.has(bone.name))
}
const hasRetargetMapping = computed(() =>
  retargetSourceNodeNames.value.some(name => !!retargetBoneMap.value[name]),
)
const retargetMappedBoneCount = computed(() =>
  Object.values(retargetBoneMap.value).filter(Boolean).length,
)
const boneRotationDraft = ref({ x: 0, y: 0, z: 0 })
const bonePositionDraft = ref({ x: 0, y: 0, z: 0 })
const selectedRigBone = computed(() => rigBones.value.find(bone => bone.name === selectedRigBoneName.value) ?? null)
const rigInputAnalysis = computed(() => model.value ? analyzeRiggingInput(model.value) : null)
const skinTokensResolvedClass = computed<'humanoid' | 'quadruped' | 'custom'>(() => {
  if (skinTokensClassChoice.value !== 'auto') return skinTokensClassChoice.value
  const guess = rigInputAnalysis.value?.recommendedPreset
  return guess === 'humanoid' ? 'humanoid' : guess === 'quadruped' ? 'quadruped' : 'custom'
})
const skinTokensRigCompatible = computed(() => isSkinTokensRigCompatible(
  model.value,
  skinTokensOperation.value,
  Boolean(props.initialAsset),
))
const rigPresetOptions: Array<{ value: AutoRigPreset; label: string }> = [
  { value: 'auto', label: 'Detectar automaticamente (recomendado)' },
  { value: 'humanoid', label: 'Humanoide / personagem' },
  { value: 'quadruped', label: 'Quadrúpede / cavalo / animal' },
  { value: 'chain', label: 'Corrente genérica / objeto orgânico' },
  { value: 'modular', label: 'Por peças / robôs / veículos / objetos articulados' },
  { value: 'ai', label: 'Rig gerado por IA' },
]
watch(selectedRigBone, bone => {
  if (!bone) return
  boneRotationDraft.value = {
    x: THREE.MathUtils.radToDeg(bone.rotation.x),
    y: THREE.MathUtils.radToDeg(bone.rotation.y),
    z: THREE.MathUtils.radToDeg(bone.rotation.z),
  }
  bonePositionDraft.value = { x: bone.position.x, y: bone.position.y, z: bone.position.z }
})
const filteredPreviewParts = computed(() => {
  const query = partSearch.value.trim().toLocaleLowerCase('pt-BR')
  if (!query) return previewParts.value
  return previewParts.value.filter(part => part.name.toLocaleLowerCase('pt-BR').includes(query))
})
const previewComponentDimensions = computed(() => {
  if (!model.value) return { x: 0, y: 0, z: 0 }
  const selectedPart = !isEditingSavedComponent.value && selectedPartId.value
    ? findPreviewPart(selectedPartId.value)
    : undefined
  if (selectedPart) {
    const bounds = new THREE.Box3().setFromObject(selectedPart.object)
    if (!bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3())
      const scale = modelHeight.value / Math.max(size.y, 0.05)
      return { x: size.x * scale, y: modelHeight.value, z: size.z * scale }
    }
  }
  const scale = originalHeight.value > 0 ? modelHeight.value / originalHeight.value : 1
  return {
    x: dimensions.value[0] * scale,
    y: modelHeight.value,
    z: dimensions.value[2] * scale,
  }
})

function guessedAnimationRole(name: string): AnimationRole {
  return inferAnimationRole(name)
}

function setAnimationRole(index: number, role: AnimationRole) {
  if (!previewAnimations.value[index]) return
  animationRoles.value = { ...animationRoles.value, [String(index)]: role }
  if (model.value) model.value.userData.importAnimationRoles = { ...animationRoles.value }
}

let rigHelper: THREE.SkeletonHelper | null = null

function removeRigHelper() {
  disposeRigPreviewHelper(rigHelper, scene)
  rigHelper = null
}

function refreshRigHelper() {
  if (!model.value || !scene || rigBones.value.length === 0) return
  removeRigHelper()
  rigHelper = createRigPreviewHelper(model.value)
  scene.add(rigHelper)
  rigHelper.updateMatrixWorld(true)
}

function startControlBindingCapture(action: ControlBindingAction) {
  if (!model.value || isReadOnlyPreview.value) return
  listeningForBinding.value = action
  error.value = ''
}

function captureControlBindingKey(event: KeyboardEvent) {
  const action = listeningForBinding.value
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (event.code === 'Escape') {
    listeningForBinding.value = null
    return
  }
  if (!event.code || /^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(event.code)) return
  const next = { ...controlBindings.value, [action]: event.code }
  controlBindings.value = next
  if (model.value) model.value.userData.importControlBindings = { ...next }
  listeningForBinding.value = null
}

function resetControlBindings() {
  if (!model.value || isReadOnlyPreview.value) return
  controlBindings.value = { ...DEFAULT_MODEL_CONTROL_BINDINGS }
  model.value.userData.importControlBindings = { ...controlBindings.value }
}

const textureRepairSelections = ref<Record<string, string>>({})
const textureRepairBusy = ref(false)
const textureRepairMessage = ref('')
const gltfMetadata = computed(() => model.value?.userData.importGltfMetadata as GltfMetadata | undefined)
const colliderType = ref<'box' | 'sphere' | 'capsule' | 'mesh' | 'none'>('box')
const colliderPreviewNotice = ref('')
const colliderSize = ref<[number, number, number]>([1, 1, 1])
const colliderOffset = ref<[number, number, number]>([0, 0, 0])
let colliderPreview: THREE.LineSegments | null = null

function updateColliderPreview() {
  colliderPreviewNotice.value = ''
  if (!scene || !model.value) return
  disposeModelColliderPreview(scene, colliderPreview)
  colliderPreview = null
  if (!model.value || colliderType.value === 'none') return

  const selectedPart = !isEditingSavedComponent.value && selectedPartId.value
    ? findPreviewPart(selectedPartId.value)
    : undefined
  const result = createModelColliderPreview({
    model: model.value,
    type: colliderType.value,
    size: colliderSize.value,
    offset: colliderOffset.value,
    selectedPart: selectedPart?.object,
  })
  colliderPreviewNotice.value = result.notice
  if (!result.preview) return
  colliderPreview = result.preview
  scene.add(colliderPreview)
}

function changeColliderType(value: 'box' | 'sphere' | 'capsule' | 'mesh' | 'none') {
  colliderType.value = value
  const normalized = normalizeImportColliderForType(value, colliderSize.value, colliderOffset.value)
  colliderSize.value = normalized.size
  colliderOffset.value = normalized.offset
  updateColliderPreview()
}

function setColliderVector(field: 'colliderSize' | 'colliderOffset', axis: 0 | 1 | 2, value: number) {
  const current = field === 'colliderSize' ? colliderSize.value : colliderOffset.value
  const vector = updateImportColliderVector(current, field, axis, value, colliderType.value)
  if (!vector) return
  if (field === 'colliderSize') colliderSize.value = vector
  else colliderOffset.value = vector
  updateColliderPreview()
}

const recoverableColorImages = computed(() => (gltfMetadata.value?.images ?? []).filter(image => image.uri.startsWith('data:image/')))
const materialsMissingColorTexture = computed(() => (gltfMetadata.value?.materials ?? []).filter(material => material.baseColorTexture === null))

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let stopPreviewRenderLoop: (() => void) | null = null
let currentObjectUrl = ''
const previewAnimationRuntime = new ModelPreviewAnimationRuntime(AnimationController)

const {
  createRig,
  applySelectedBoneTransform,
  resetRigPose,
  recordRigKeyframe,
  applyRigFrame,
  clearRigKeyframesForNewClip,
  createRigAnimation,
  setRigTime,
} = createModelImportRiggingController({
  props,
  model,
  loading,
  error,
  getScene: () => scene,
  rigPreset,
  rigBones,
  selectedRigBoneName,
  rigRestPose,
  rigKeyframes,
  rigFrameTime,
  rigDuration,
  rigMessage,
  rigClipName,
  rigClipRole,
  boneRotationDraft,
  bonePositionDraft,
  selectedRigBone,
  previewAnimationRuntime,
  previewAnimations,
  animationRoles,
  animationClipRevision,
  previewAnimationIndex,
  refreshRigHelper,
  updateRigHelper: () => rigHelper?.updateMatrixWorld(true),
  refreshPreviewParts,
  refreshModelDiagnostics,
  selectPreviewAnimation,
})

const previewClock = new THREE.Clock()

function disposeModel(object: THREE.Object3D) {
  disposeThreeObjectResources(object, 'renderables')
}

function refreshPreviewParts() {
  const state = reconcileModelPreviewPartState(
    model.value,
    selectedPartId.value,
    soloPartId.value,
    batchSelectedPartIds.value,
    batchSavedPartIds.value,
  )
  previewParts.value = state.parts
  selectedPartId.value = state.selectedPartId
  soloPartId.value = state.soloPartId
  batchSelectedPartIds.value = state.batchSelectedPartIds
  batchSavedPartIds.value = state.batchSavedPartIds
}

function findPreviewPart(id: string) {
  return previewParts.value.find(part => part.id === id)
}

function toggleBatchPartSelection(
  part: ModelPreviewPart,
  checked: boolean,
) {
  batchSelectedPartIds.value = toggleModelPreviewBatchSelection(
    batchSelectedPartIds.value,
    previewParts.value,
    part,
    checked,
  )
}

function clearBatchSelection() {
  batchSelectedPartIds.value = []
}

function setColliderFromPreviewPart(part: ModelPreviewPart) {
  const size = calculateImportColliderSizeFromObjectBounds(
    part.object,
    modelHeight.value,
    colliderType.value,
  )
  if (!size) return
  colliderSize.value = size
  colliderOffset.value = [0, 0, 0]
}

function selectPreviewPart(part: ModelPreviewPart) {
  if (soloPartId.value) restorePreviewVisibility()
  selectedPartId.value = part.id
  if (!props.initialAsset) {
    componentName.value = part.name
    setColliderFromPreviewPart(part)
  }
  fitCamera(part.object)
  updateColliderPreview()
}

function togglePreviewPart(part: ModelPreviewPart) {
  if (soloPartId.value) restorePreviewVisibility()
  part.object.visible = !part.object.visible
  if (model.value) invalidateStaticMeshCollider(model.value)
  updateColliderPreview()
}

function showOnlyPreviewPart(part: ModelPreviewPart) {
  const root = model.value
  if (!root) return
  if (soloPartId.value === part.id) {
    restorePreviewVisibility()
  } else {
    // Os ancestrais precisam permanecer visíveis: no Three.js, esconder um pai
    // também esconde todos os seus descendentes, mesmo que o filho esteja visible=true.
    invalidateStaticMeshCollider(root)
    setModelPreviewSoloVisibility(root, part.object)
    soloPartId.value = part.id
    selectedPartId.value = part.id
    if (!props.initialAsset) {
      componentName.value = part.name
      setColliderFromPreviewPart(part)
    }
    fitCamera(part.object)
    updateColliderPreview()
  }
}

function selectWholeModel() {
  const root = model.value
  if (!root) return
  restorePreviewVisibility()
  selectedPartId.value = ''
  componentName.value = root.name.trim() || fileName.value.replace(/\.[^.]+$/, '') || 'Modelo 3D'
  const scale = originalHeight.value > 0 ? modelHeight.value / originalHeight.value : 1
  colliderSize.value = calculateImportColliderSize(dimensions.value, scale, colliderType.value)
  colliderOffset.value = [0, 0, 0]
  fitCamera(root)
  updateColliderPreview()
}

function restorePreviewVisibility() {
  const root = model.value
  if (root) restoreModelPreviewVisibility(root)
  if (root) invalidateStaticMeshCollider(root)
  soloPartId.value = ''
}

/** Restaura a renderização de malhas importadas antes de avaliar uma animação. */
function restoreModelRenderableMeshes(root: THREE.Object3D) {
  restoreRenderableMeshes(root)
  invalidateStaticMeshCollider(root)
}

function deletePreviewPart(part: ModelPreviewPart) {
  if (!model.value || !part.object.parent) return
  invalidateStaticMeshCollider(model.value)
  part.object.removeFromParent()
  model.value.userData.importNeedsReexport = true
  model.value.updateMatrixWorld(true)
  refreshPreviewParts()
  refreshModelDiagnostics()
  updateColliderPreview()
  if (model.value) fitCamera(model.value)
}


async function applyRecoveredColorTexture(materialIndex: number) {
  const root = model.value
  if (!root) return
  const imageIndex = Number(textureRepairSelections.value[String(materialIndex)])
  textureRepairBusy.value = true
  textureRepairMessage.value = ''
  try {
    await recoverModelBaseColorTexture(root, gltfMetadata.value, materialIndex, imageIndex)
    const materialName = gltfMetadata.value?.materials.find(item => item.index === materialIndex)?.name
    textureRepairMessage.value = `Imagem ${imageIndex} aplicada ao material ${materialName || materialIndex}. O mapa normal e os demais mapas foram preservados.`
    refreshModelDiagnostics()
  } catch (e) {
    textureRepairMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    textureRepairBusy.value = false
  }
}

function refreshModelDiagnostics() {
  const root = model.value
  if (!root) {
    modelDiagnostics.value = []
    diagnosticSummary.value = { nodes: 0, meshes: 0, skinned: 0, materials: 0, textures: 0, clips: 0 }
    return
  }

  const result = analyzeModelDiagnostics(root)
  modelDiagnostics.value = result.rows
  diagnosticSummary.value = result.summary
}

const importPackageControlBindingFields: Array<{ key: keyof ModelControlBindings; label: string }> = [
  { key: 'forward', label: 'Mover para frente' },
  { key: 'backward', label: 'Mover para trás' },
  { key: 'left', label: 'Mover para esquerda' },
  { key: 'right', label: 'Mover para direita' },
  { key: 'run', label: 'Correr' },
  { key: 'jump', label: 'Pular' },
  { key: 'interact', label: 'Interagir / montar' },
]

const {
  ensureImportBehaviorPackageDraft,
  toggleImportBehaviorPackage,
  importPackageVariableValue,
  updateImportPackageVariable,
  importPackageConfigValue,
  updateImportPackageConfigValue,
  updateImportPackageConfigScalar,
  setImportPackageInteractionKey,
  importPackageVectorValue,
  setImportPackageVector,
  importPackageControlBindingValue,
  setImportPackageControlBinding,
  importPackageModelStates,
  writeImportPackageModelStates,
  addImportPackageModelState,
  updateImportPackageModelState,
  onImportPackageModelStateValueChange,
  removeImportPackageModelState,
} = createModelImportBehaviorPackageController({
  controlBindings,
  selectedBehaviorPackageIds,
  selectedBehaviorPackageSettings,
  isReadOnlyPreview,
  previewPackageModelNodes,
})

function clearLoadedModel(preserveRetargetSource = false) {
  if (!preserveRetargetSource) clearRetargetSource()
  selectedBehaviorPackageIds.value = []
  selectedBehaviorPackageSettings.value = {}
  customThumbnail.value = null
  customThumbnailFileName.value = ''
  thumbnailImageError.value = ''
  activeSetupTab.value = 'model'
  listeningForBinding.value = null
  controlBindings.value = { ...DEFAULT_MODEL_CONTROL_BINDINGS }
  previewParts.value = []
  selectedPartId.value = ''
  batchSelectedPartIds.value = []
  batchSavedPartIds.value = []
  batchNotice.value = ''
  soloPartId.value = ''
  partSearch.value = ''
  componentName.value = ''
  selectedBehaviorPackageIds.value = []
  previewAnimationRuntime.clear()
  previewAnimationIndex.value = 0
  previewPlaying.value = true
  animationRoles.value = {}
  removeRigHelper()
  rigBones.value = []
  rigRestPose.value = {}
  selectedRigBoneName.value = ''
  rigKeyframes.value = []
  rigFrameTime.value = 0
  rigDuration.value = 1
  rigMessage.value = ''
  animationClipRevision.value = 0
  if (model.value) {
    disposeImportedModelResources(model.value, {
      scene,
      releaseStaticCollider: releaseStaticMeshCollider,
    })
  }
  model.value = null
  if (colliderPreview) { disposeModelColliderPreview(scene, colliderPreview); colliderPreview = null }
  textureRepairSelections.value = {}
  textureRepairMessage.value = ''
  refreshModelDiagnostics()
  if (currentObjectUrl) revokeOwnedObjectUrls([currentObjectUrl])
  currentObjectUrl = ''
}

function disposePreview() {
  stopPreviewRenderLoop?.()
  stopPreviewRenderLoop = null
  controls?.dispose()
  controls = null
  clearLoadedModel()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
}

function fitCamera(object: THREE.Object3D) {
  fitModelPreviewCamera(object, camera, controls)
}

function initPreview() {
  if (!canvas.value || renderer) return
  const stage = createModelPreviewStage(canvas.value)
  scene = stage.scene
  camera = stage.camera
  renderer = stage.renderer
  controls = stage.controls
  stopPreviewRenderLoop = startModelPreviewRenderLoop({
    canvasElement: canvas.value,
    getCanvas: () => canvas.value,
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
    getControls: () => controls,
    clock: previewClock,
    isAnimationPlaying: () => previewPlaying.value,
    updateAnimation: deltaSeconds => previewAnimationRuntime.controller?.update(deltaSeconds),
  })
  if (model.value) {
    scene.add(model.value)
    fitCamera(model.value)
  }
}

function centerAndMeasure(object: THREE.Object3D) {
  const measurement = measureModelImportSpatialData(object)
  dimensions.value = measurement.dimensions
  originalHeight.value = measurement.height
  // Corrija a posição apenas depois da escala para evitar deslocamentos
  // enormes em assets cujas coordenadas originais são muito grandes.
  object.userData.importCenter = measurement.center
  return measurement.height
}

const {
  showLoadedModel,
  parseGlbBytes,
  importBlendZip,
  loadCatalogAsset,
  chooseFile,
} = createModelImportLoadingController({
  fileInput,
  loading,
  error,
  fileName,
  componentName,
  model,
  modelHeight,
  dimensions,
  colliderType,
  colliderSize,
  colliderOffset,
  controlBindings,
  partSearch,
  selectedBehaviorPackageIds,
  selectedBehaviorPackageSettings,
  activeSetupTab,
  starterAssetCatalogOpen,
  selectedRetargetLibraryId,
  retargetSourceRoot,
  animationClipRevision,
  rigBones,
  rigRestPose,
  selectedRigBoneName,
  rigKeyframes,
  rigFrameTime,
  rigDuration,
  rigMessage,
  animationRoles,
  previewAnimationIndex,
  previewPlaying,
  previewAnimationRuntime,
  previewClock,
  clearLoadedModel,
  centerAndMeasure,
  fitCamera,
  initPreview,
  refreshPreviewParts,
  refreshModelDiagnostics,
  updateColliderPreview,
  restoreModelRenderableMeshes,
  guessedAnimationRole,
  getScene: () => scene,
  setCurrentObjectUrl: (url: string) => { currentObjectUrl = url },
})
const {
  chooseSkinTokensExecutable,
  testSkinTokensBackend,
  runSkinTokensRigging,
  performSkinTokensRigging,
} = createModelImportSkinTokensController({
  model,
  skinTokensExecutablePath,
  skinTokensOperation,
  skinTokensLoading,
  skinTokensMessage,
  skinTokensResolvedClass,
  skinTokensRigCompatible,
  animationRoles,
  controlBindings,
  colliderType,
  colliderSize,
  colliderOffset,
  componentName,
  fileName,
  modelHeight,
  animationClipRevision,
  rigBones,
  selectedRigBoneName,
  rigRestPose,
  rigKeyframes,
  rigFrameTime,
  rigDuration,
  rigPreset,
  rigMessage,
  parseGlbBytes,
  showLoadedModel,
  guessedAnimationRole,
  refreshRigHelper,
})
watch(() => props.open, async (open) => {
  if (open) {
    loadRetargetAnimationLibrary()
    window.addEventListener('keydown', captureControlBindingKey, true)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    initPreview()
    if (props.initialAsset) {
      loading.value = true
      try {
        const loaded = await parseGlbBytes(props.initialAsset.bytes.slice(0))
        loaded.userData.importAnimationRoles = props.initialAsset.animationRoles
        loaded.userData.importControlBindings = props.initialAsset.controlBindings
        loaded.userData.importHasModifiedAnimations = props.initialAsset.libraryType === 'animated-model'
        fileName.value = props.initialAsset.name
        await showLoadedModel(loaded, props.initialAsset.name, props.initialAsset.height ?? 2)

        // Ao editar, restaure também o colisor armazenado. Sem isso, abrir e
        // salvar um componente substituía silenciosamente a colisão por um box.
        const savedColliderType = props.initialAsset.colliderType
        // Atualiza componentes de cidade salvos antes do colisor côncavo.
        // Para modelos comuns, mantém a forma que o usuário já havia escolhido.
        const restoreStaticCityCollider = Boolean(model.value && shouldDefaultToStaticCityCollider(model.value, dimensions.value))
        colliderType.value = restoreStaticCityCollider
          ? 'mesh'
          : savedColliderType === 'sphere' || savedColliderType === 'capsule' || savedColliderType === 'mesh' || savedColliderType === 'none'
            ? savedColliderType
            : 'box'
        const savedColliderSize = props.initialAsset.colliderSize
        if (Array.isArray(savedColliderSize) && savedColliderSize.length === 3
          && savedColliderSize.every(value => Number.isFinite(value))) {
          colliderSize.value = [...savedColliderSize] as [number, number, number]
        }
        const savedColliderOffset = props.initialAsset.colliderOffset
        if (colliderType.value === 'mesh') {
          colliderOffset.value = [0, 0, 0]
        } else if (Array.isArray(savedColliderOffset) && savedColliderOffset.length === 3
          && savedColliderOffset.every(value => Number.isFinite(value))) {
          colliderOffset.value = [...savedColliderOffset] as [number, number, number]
        }
        if (model.value) {
          model.value.userData.importColliderType = colliderType.value
          model.value.userData.importColliderSize = [...colliderSize.value]
          model.value.userData.importColliderOffset = [...colliderOffset.value]
        }
        updateColliderPreview()

        selectedBehaviorPackageIds.value = [...new Set((props.initialAsset.behaviorPackageIds ?? []).filter(id =>
          BEHAVIOR_PACKAGE_DEFINITIONS.some(definition => definition.id === id),
        ))]
        selectedBehaviorPackageSettings.value = cloneImportBehaviorPackageSettings(props.initialAsset.behaviorPackageSettings ?? {})
        componentName.value = props.initialAsset.name
        customThumbnail.value = props.initialAsset.thumbnail ?? null
        customThumbnailFileName.value = props.initialAsset.thumbnail ? 'Miniatura salva' : ''
        for (const packageId of selectedBehaviorPackageIds.value) ensureImportBehaviorPackageDraft(packageId)
      } catch (e) {
        error.value = e instanceof Error ? e.message : 'Não foi possível abrir o componente para edição.'
      } finally { loading.value = false }
    }
  } else {
    window.removeEventListener('keydown', captureControlBindingKey, true)
    listeningForBinding.value = null
    clearRetargetSource()
    retargetMessage.value = ''
    disposePreview()
    error.value = ''
  }
})

const {
  loadRetargetAnimationLibrary,
  clearRetargetSource,
  chooseRetargetAnimationSource,
  selectSavedAnimationSource,
  saveRetargetSourceToLibrary,
  onRetargetSourceClipChanged,
  selectRetargetLibraryAsset,
  setRetargetBoneMapping,
  disposeRetargetPreviews,
  toggleRetargetSourcePreviewPlayback,
  toggleRetargetTargetPreviewPlayback,
  saveRetargetAnimationToLibrary,
  deleteRetargetLibraryAsset,
  applyRetargetedAnimation,
  runAutonomousRetargeting,
  autoMapRetargetBones,
} = createModelImportRetargetingController({
  props,
  emit,
  activeSetupTab,
  animationClipRevision,
  animationRoles,
  error,
  fitCamera,
  getScene: () => scene,
  guessedAnimationRole,
  isReadOnlyPreview,
  loading,
  model,
  originalHeight,
  parseGlbBytes,
  disposeModel,
  performSkinTokensRigging,
  previewAnimationIndex,
  selectPreviewAnimation,
  previewAnimationRuntime,
  previewAnimations,
  refreshModelDiagnostics,
  restoreModelRenderableMeshes,
  restorePreviewVisibility,
  retargetAutonomousLoading,
  retargetAutonomousStage,
  retargetBoneMap,
  retargetClipName,
  retargetCollapsedSourceNames,
  retargetLibrary,
  retargetLibraryAsset,
  retargetLoading,
  retargetMessage,
  retargetPreviewStatus,
  retargetSourceBytes,
  retargetSourceClip,
  retargetSourceClipIndex,
  retargetSourceFileName,
  retargetSourceNodeNames,
  retargetSourcePreviewCanvas,
  retargetSourcePreviewPlaying,
  retargetSourceRoot,
  retargetTargetBones,
  retargetTargetPreviewCanvas,
  retargetTargetPreviewPlaying,
  rigBones,
  rigClipRole,
  rigRestPose,
  selectedRetargetLibraryClip,
  selectedRetargetLibraryId,
  selectedSavedAnimationSourceId,
  skinTokensExecutablePath,
  skinTokensLoading,
  skinTokensMessage,
  skinTokensOperation,
  skinTokensRigCompatible,
  updateColliderPreview,
})
function selectPreviewAnimation(index: number) {
  previewAnimationIndex.value = index
  const root = model.value
  const clip = previewAnimations.value[index]
  if (!root || !clip) return
  const controller = previewAnimationRuntime.ensure(root, previewAnimations.value)
  controller.setState(previewAnimationRoleForClip(clip), true)
  previewPlaying.value = true
  previewClock.start()
}

function togglePreviewAnimationPlayback() {
  if (!previewAnimations.value.length) return
  previewPlaying.value = !previewPlaying.value
  if (previewPlaying.value) previewClock.start()
}

function setModelHeight(value: number) {
  if (model.value) modelHeight.value = normalizeModelImportHeight(value) ?? modelHeight.value
}

watch(modelHeight, (height, previousHeight) => {
  if (!model.value || !Number.isFinite(height) || height <= 0 || originalHeight.value <= 0) return
  const centerData = model.value.userData.importCenter as [number, number, number] | undefined
  const transform = centerData?.length === 3
    ? calculateModelImportTransform(centerData, originalHeight.value, height)
    : null
  model.value.scale.setScalar(transform?.scale ?? height / originalHeight.value)
  if (transform) model.value.position.set(...transform.position)
  model.value.updateMatrixWorld(true)
  fitCamera(model.value)
  const factor = height / Math.max(0.1, previousHeight)
  colliderSize.value = colliderSize.value.map(value => Math.max(0.05, value * factor)) as [number, number, number]
  updateColliderPreview()
})

async function useAsPlayerModel() {
  const root = model.value
  if (!root || loading.value) return
  loading.value = true
  error.value = ''
  try {
    // Ativos já salvos usam o GLB original; modelos importados são exportados em um clone esquelético.
    const bytes = await createPlayerModelBytes(root, props.initialAsset?.bytes)

    const name = props.initialAsset?.name || fileName.value || root.name || 'Jogador'
    emit('use-player', { name, bytes, animationRoles: { ...animationRoles.value }, height: modelHeight.value })
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error
      ? `Não foi possível usar este ativo como jogador: ${cause.message}`
      : 'Não foi possível exportar o modelo para o jogador.'
  } finally {
    loading.value = false
  }
}

function capturePreviewThumbnail(): string | undefined {
  return captureModelPreviewThumbnail(canvas.value, renderer, scene, camera, [colliderPreview, rigHelper])
}

async function chooseThumbnailImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  thumbnailImageError.value = ''

  try {
    customThumbnail.value = await createCustomModelThumbnail(file)
    customThumbnailFileName.value = file.name
  } catch (cause) {
    thumbnailImageError.value = cause instanceof Error ? cause.message : 'Não foi possível usar essa imagem.'
  } finally {
    input.value = ''
  }
}

function clearCustomThumbnail() {
  customThumbnail.value = null
  customThumbnailFileName.value = ''
  thumbnailImageError.value = ''
}

const { saveSelectedParts, confirmImport } = createModelImportSaveController({
  props,
  emit,
  model,
  loading,
  error,
  batchSelectedPartIds,
  batchSavedPartIds,
  batchNotice,
  modelHeight,
  originalHeight,
  colliderType,
  colliderSize,
  colliderOffset,
  controlBindings,
  animationRoles,
  selectedBehaviorPackageIds,
  ensureImportBehaviorPackageDraft,
  findPreviewPart,
  fileName,
  componentName,
  selectedPartId,
  customThumbnail,
  capturePreviewThumbnail,
  getScene: () => scene,
  previewAnimationRuntime,
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', captureControlBindingKey, true)
  disposeRetargetPreviews()
  disposePreview()
})

const rightPanelBindingSources = {
  ANIMATION_ROLE_BASE_OPTIONS,
  BEHAVIOR_PACKAGE_DEFINITIONS,
  DEFAULT_MODEL_CONTROL_BINDINGS,
  activeSetupTab,
  addImportPackageModelState,
  animationRoleOptions,
  animationRoles,
  applyRecoveredColorTexture,
  applyRetargetedAnimation,
  applyRigFrame,
  applySelectedBoneTransform,
  autoMapRetargetBones,
  bonePositionDraft,
  boneRotationDraft,
  changeColliderType,
  chooseRetargetAnimationSource,
  chooseSkinTokensExecutable,
  chooseThumbnailImage,
  clearCustomThumbnail,
  clearRigKeyframesForNewClip,
  colliderOffset,
  colliderPreviewNotice,
  colliderSize,
  colliderType,
  componentName,
  controlBindingFields,
  controlBindings,
  createRig,
  createRigAnimation,
  customThumbnail,
  customThumbnailFileName,
  deleteRetargetLibraryAsset,
  diagnosticSummary,
  error,
  fileName,
  formatModelControlKey,
  formatPackageConfigLabel,
  hasRetargetMapping,
  importPackageConfigValue,
  importPackageControlBindingFields,
  importPackageControlBindingValue,
  importPackageModelStates,
  importPackageVariableValue,
  importPackageVectorValue,
  isEditingSavedComponent,
  isReadOnlyPreview,
  isSimplePackageConfigValue,
  isTauri,
  listeningForBinding,
  loading,
  materialsMissingColorTexture,
  model,
  modelDiagnostics,
  modelHeight,
  onImportPackageModelStateValueChange,
  onRetargetSourceClipChanged,
  previewAnimationIndex,
  previewAnimations,
  previewComponentDimensions,
  previewPackageModelNodes,
  recordRigKeyframe,
  recoverableColorImages,
  removeImportPackageModelState,
  resetControlBindings,
  resetRigPose,
  retargetAutonomousLoading,
  retargetAutonomousStage,
  retargetBoneMap,
  retargetClipName,
  retargetCollapsedSourceNames,
  retargetLibrary,
  retargetLoading,
  retargetMappedBoneCount,
  retargetMessage,
  retargetOtherBonesFor,
  retargetPreviewStatus,
  retargetSourceBytes,
  retargetSourceClip,
  retargetSourceClipIndex,
  retargetSourceClips,
  retargetSourceFileName,
  retargetSourceNodeNames,
  retargetSourcePreviewPlaying,
  retargetSourceRoot,
  retargetSuggestedBonesFor,
  retargetTargetBones,
  retargetTargetPreviewPlaying,
  rigBones,
  rigClipName,
  rigClipRole,
  rigDuration,
  rigFrameTime,
  rigInputAnalysis,
  rigKeyframes,
  rigMessage,
  rigPreset,
  rigPresetOptions,
  runAutonomousRetargeting,
  runSkinTokensRigging,
  saveRetargetAnimationToLibrary,
  saveRetargetSourceToLibrary,
  selectPreviewAnimation,
  selectRetargetLibraryAsset,
  selectSavedAnimationSource,
  selectedBehaviorPackageDefinitions,
  selectedBehaviorPackageIds,
  selectedRetargetLibraryId,
  selectedRigBone,
  selectedRigBoneName,
  selectedSavedAnimationSourceId,
  setAnimationRole,
  setColliderVector,
  setImportPackageControlBinding,
  setImportPackageInteractionKey,
  setImportPackageVector,
  setModelHeight,
  setRetargetBoneMapping,
  setRigTime,
  skinTokensClassChoice,
  skinTokensClassOptions,
  skinTokensExecutablePath,
  skinTokensLoading,
  skinTokensMessage,
  skinTokensOperation,
  skinTokensResolvedClass,
  skinTokensRigCompatible,
  startControlBindingCapture,
  testSkinTokensBackend,
  textureRepairBusy,
  textureRepairMessage,
  textureRepairSelections,
  thumbnailImageError,
  toggleImportBehaviorPackage,
  toggleRetargetSourcePreviewPlayback,
  toggleRetargetTargetPreviewPlayback,
  updateImportPackageConfigScalar,
  updateImportPackageModelState,
  updateImportPackageVariable,
  dialogProps: props,
  animationSourceOptions: props.animationSourceOptions,
  setRetargetSourcePreviewCanvas: (element: unknown) => {
    retargetSourcePreviewCanvas.value = typeof HTMLCanvasElement !== 'undefined' && element instanceof HTMLCanvasElement
      ? element
      : null
  },
  setRetargetTargetPreviewCanvas: (element: unknown) => {
    retargetTargetPreviewCanvas.value = typeof HTMLCanvasElement !== 'undefined' && element instanceof HTMLCanvasElement
      ? element
      : null
  },
}
const rightPanelBindings = new Proxy(rightPanelBindingSources, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver)
    return isRef(value) ? value.value : value
  },
  set(target, property, nextValue, receiver) {
    const source = Reflect.get(target, property, receiver)
    if (isRef(source)) {
      if (!isReadonly(source)) source.value = nextValue
      return true
    }
    return Reflect.set(target, property, nextValue, receiver)
  },
}) as any
</script>

<template>
  <div v-if="open" class="model-import-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="model-import-dialog" role="dialog" aria-modal="true" aria-labelledby="model-import-title">
      <header class="model-import-header">
        <div class="model-import-brand"><span class="model-import-brand-icon">P</span><div><span class="model-import-kicker">ENGINE PROMETHEUS / MODEL WORKSPACE</span><h2 id="model-import-title">{{ isEditingSavedComponent ? 'Editar componente 3D' : 'Configurar modelo 3D' }}</h2></div></div>
        <div class="model-import-header-status"><span class="model-import-status-dot" :class="{ ready: !!model, busy: loading }"></span>{{ loading ? 'Processando arquivo…' : model ? 'Prévia pronta' : 'Aguardando arquivo' }}</div>
        <button class="model-import-close" aria-label="Fechar" title="Fechar janela" @click="emit('close')">×</button>
      </header>

      <div class="model-import-toolbar">
        <div class="model-import-toolbar-group">
          <button class="model-toolbar-button" :disabled="loading || !!props.initialAsset" title="Abre modelos animados de exemplo e itens preparados para VEILBORNE." @click="starterAssetCatalogOpen = true"><span>✦</span> Modelos iniciais</button>
          <button class="model-toolbar-button model-toolbar-primary" :disabled="loading" title="Abre um arquivo para visualizar, inspecionar e importar um modelo ou textura." @click="fileInput?.click()"><span>＋</span> Abrir arquivo</button>
          <button class="model-toolbar-button" :disabled="loading" title="Importa um ZIP com GLB, glTF, FBX, OBJ/MTL, STL, PLY, DAE ou 3DS e resolve recursos auxiliares incluídos." @click="importBlendZip"><span>▤</span> Importar pacote ZIP</button>
          <input ref="fileInput" class="model-file-input" type="file" accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.dae,.3ds,.png,.jpg,.jpeg,.webp,.svg" @change="chooseFile" />
        </div>
        <div class="model-import-toolbar-file"><span class="toolbar-file-dot"></span><span>{{ fileName || 'Nenhum arquivo selecionado' }}</span></div>
      </div>

      <nav class="model-import-tabs" aria-label="Configuração do modelo">
        <button
          v-for="tab in setupTabs"
          :key="tab.id"
          type="button"
          class="model-import-tab"
          :class="{ active: activeSetupTab === tab.id }"
          :disabled="!model && tab.id !== 'model' && tab.id !== 'technical'"
          @click="activeSetupTab = tab.id"
        >
          <strong>{{ tab.label }}</strong><small>{{ tab.description }}</small>
        </button>
      </nav>

      <div class="model-import-workspace">
        <aside class="model-import-left-panel">
          <section class="model-panel-section">
            <div class="model-panel-heading"><span>01</span> ORIGEM DO ATIVO</div>
            <button class="model-file-dropzone" :disabled="loading" title="Clique para escolher o arquivo do modelo; os formatos compatíveis aparecem no seletor." @click="fileInput?.click()">
              <span class="model-dropzone-icon">↥</span><strong>Selecionar arquivo</strong><small>Escolha um arquivo no seu computador</small>
              <span class="model-dropzone-formats">3D · GLB · GLTF · FBX · OBJ · STL · PLY · DAE · 3DS</span>
              <span class="model-dropzone-formats">2D · PNG · JPG · WEBP · SVG</span>
            </button>
            <p class="model-panel-hint">Para glTF com arquivos dependentes, use um ZIP contendo o .gltf, .bin e as texturas.</p>
          </section>
          <div class="model-panel-separator"></div>
          <section class="model-panel-section model-hierarchy-section">
            <div class="model-panel-heading"><span>02</span> HIERARQUIA <b>{{ previewParts.length }}</b></div>
            <p class="model-panel-hint">Marque várias partes com o botão ＋ ao lado de cada nome e use “Salvar selecionados”. Você pode repetir o lote com outras partes sem reabrir o arquivo.</p>
            <div v-if="batchSelectedCount" class="model-batch-selection-summary"><span>{{ batchSelectedCount }} {{ batchSelectedCount === 1 ? 'parte marcada' : 'partes marcadas' }} para salvar</span><button type="button" :disabled="loading" @click="clearBatchSelection">Limpar seleção</button></div>
            <p v-if="batchNotice" class="model-batch-notice" role="status" aria-live="polite">{{ batchNotice }}</p>
            <label class="model-part-search">FILTRAR HIERARQUIA
              <input v-model="partSearch" type="search" placeholder="Ex.: castelo, casa, taverna" :disabled="!previewParts.length" title="Filtra os nós e as partes do modelo pela nomenclatura." />
            </label>
            <div v-if="filteredPreviewParts.length" class="model-preview-parts">
              <div v-for="(part, index) in filteredPreviewParts" :key="part.id" class="model-preview-part" :class="{ 'is-selected': selectedPartId === part.id, 'is-batch-selected': batchSelectedPartIds.includes(part.id) }" :style="{ paddingLeft: (5 + Math.min(part.depth, 5) * 8) + 'px' }">
                <button type="button" class="model-preview-part-select" :title="`Selecionar ${part.name} para visualizar`" @click="selectPreviewPart(part)">
                  <span class="model-preview-part-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="model-tree-cube">◇</span>
                  <span class="model-preview-part-name" :title="part.name">{{ part.name }}</span>
                  <small>{{ batchSavedPartIds.includes(part.id) ? '✓ salvo' : part.meshCount }}</small>
                </button>
                <button type="button" class="model-preview-part-batch" :class="{ active: batchSelectedPartIds.includes(part.id), saved: batchSavedPartIds.includes(part.id) }" :disabled="loading || !!props.initialAsset" :aria-pressed="batchSelectedPartIds.includes(part.id)" :aria-label="`Marcar ${part.name} para salvar em lote`" :title="batchSelectedPartIds.includes(part.id) ? 'Remover do lote' : batchSavedPartIds.includes(part.id) ? 'Este item já foi salvo nesta sessão; ainda é possível salvá-lo novamente' : 'Adicionar ao lote de componentes'" @click="toggleBatchPartSelection(part, !batchSelectedPartIds.includes(part.id))">{{ batchSelectedPartIds.includes(part.id) ? '✓' : '+' }}</button>
                <button class="model-preview-part-eye" :aria-label="`Mostrar ou ocultar ${part.name}`" :title="part.object.visible ? 'Ocultar parte' : 'Mostrar parte'" @click="togglePreviewPart(part)">{{ part.object.visible ? '◉' : '○' }}</button>
                <button class="model-preview-part-solo" :class="{ active: soloPartId === part.id }" :aria-label="`Visualizar somente ${part.name}`" title="Isolar parte" @click="showOnlyPreviewPart(part)">1×</button>
                <button class="model-preview-part-delete" :aria-label="`Remover ${part.name} da importação`" title="Remover parte" @click="deletePreviewPart(part)">×</button>
              </div>
              <button class="model-preview-show-all" title="Seleciona a raiz do modelo para visualizar ou editar o conjunto." @click="selectWholeModel">Selecionar modelo inteiro</button>
              <button class="model-preview-show-all" title="Reativa a visibilidade de todas as partes ocultadas na prévia." @click="restorePreviewVisibility">Mostrar todas as partes na prévia</button>
            </div>
            <div v-else-if="previewParts.length" class="model-hierarchy-empty"><span>⌕</span><p>Nenhuma parte encontrada</p><small>Tente outro nome ou apague o filtro.</small></div>
            <div v-else class="model-hierarchy-empty"><span>◇</span><p>Nenhuma malha carregada</p><small>A hierarquia aparecerá aqui após abrir um modelo.</small></div>
          </section>
        </aside>

        <main class="model-import-center-panel">
          <div class="model-viewport-topline"><span><i></i> VIEWPORT DE PRÉ-VISUALIZAÇÃO</span><span>PERSP · 3D</span></div>
          <div class="model-import-preview">
            <canvas ref="canvas" />
            <div v-if="!model && !loading" class="model-import-empty">
              <span class="upload-glyph">◇</span><strong>Seu ativo começa aqui</strong><small>Abra um modelo 3D ou uma imagem 2D para visualizar</small>
              <button class="model-import-primary" title="Abre um arquivo de modelo para carregar na prévia." @click="fileInput?.click()">Abrir arquivo</button>
            </div>
            <div v-if="loading" class="model-import-loading"><span class="model-loading-spinner"></span><strong>Preparando pré-visualização</strong><small>Carregando geometria, materiais e texturas</small></div>
            <div v-if="skinTokensLoading" class="model-import-loading model-skintokens-viewport-loading" role="status" aria-live="polite" aria-busy="true">
              <span class="model-loading-spinner"></span>
              <strong>{{ skinTokensMessage.startsWith('Verificando') ? 'Verificando IA local' : skinTokensOperation === 'rig' ? 'Gerando rig com IA' : 'Recalculando pesos com IA' }}</strong>
              <small>{{ skinTokensMessage.startsWith('Verificando') ? 'Carregando e verificando o modelo local…' : 'Analisando geometria e calculando deformações. Isso pode levar alguns minutos.' }}</small>
              <div class="model-skintokens-viewport-progress" role="progressbar" aria-label="Processamento de rigging por IA" aria-valuetext="Progresso indeterminado"><span></span></div>
              <small>O editor está aguardando o resultado. A barra não representa uma porcentagem real.</small>
            </div>
            <div class="preview-badge"><span class="model-live-dot"></span> LIVE PREVIEW</div>
            <div v-if="model && previewAnimations.length" class="preview-animation-controls">
              <label>ANIMAÇÃO
                <select :value="previewAnimationIndex" title="Escolha qual clipe de animação reproduzir na prévia do modelo." @change="selectPreviewAnimation(Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="(clip, index) in previewAnimations" :key="index" :value="index">{{ clip.name || ('Animação ' + (index + 1)) }} · {{ clip.duration.toFixed(2) }}s</option>
                </select>
              </label>
              <button :title="previewPlaying ? 'Pausa a animação atual na prévia.' : 'Reproduz a animação selecionada na prévia.'" @click="togglePreviewAnimationPlayback">{{ previewPlaying ? 'Ⅱ Pausar' : '▶ Reproduzir' }}</button>
            </div>
            <div v-else-if="model" class="preview-animation-empty">Este modelo não contém animações embutidas.</div>
            <div v-if="model" class="preview-dimensions">X {{ dimensions[0].toFixed(2) }} <b>·</b> Y {{ modelHeight.toFixed(2) }} <b>·</b> Z {{ dimensions[2].toFixed(2) }} <small>unidades</small></div>
            <div class="model-viewport-controls"><span>BOTÃO ESQUERDO · ORBITAR</span><span>SCROLL · ZOOM</span></div>
          </div>
          <div class="model-viewport-statusbar"><span><i></i> {{ model ? (model.name || 'Modelo carregado') : 'Viewport inativo' }}</span><span>{{ diagnosticSummary.meshes }} malhas <b>·</b> {{ diagnosticSummary.materials }} materiais <b>·</b> {{ diagnosticSummary.clips }} animações</span></div>
        </main>

        <ModelImportRightPanel :bindings="rightPanelBindings" />
      </div>

      <footer class="model-import-footer">
        <div class="model-footer-leading">
          <div class="model-footer-state"><span class="model-import-status-dot" :class="{ ready: !!model, busy: loading }"></span><span>{{ loading ? (isEditingSavedComponent ? 'Salvando alterações…' : 'Salvando componente…') : isEditingSavedComponent ? 'Editando componente existente' : props.initialAsset ? 'Pré-visualização do componente' : model ? 'Componente pronto para salvar' : 'Nenhum ativo selecionado' }}</span></div>
          <p v-if="error" class="model-footer-error" role="alert" aria-live="assertive">{{ error }}</p>
        </div>
        <div class="model-footer-actions"><button type="button" class="model-import-secondary" title="Fecha a janela sem salvar um novo componente." @click="emit('close')">{{ props.initialAsset ? 'Fechar prévia' : 'Cancelar' }}</button><button v-if="batchSelectedCount && !props.initialAsset && !isEditingSavedComponent" type="button" class="model-import-secondary model-import-batch-save" :disabled="loading" :title="`Salva ${batchSelectedCount} partes em componentes separados e mantém este modelo aberto.`" @click="saveSelectedParts">{{ loading ? 'Salvando lote…' : `Salvar ${batchSelectedCount} selecionados` }}</button><button v-if="model" type="button" class="model-import-secondary" :disabled="loading" :title="`Usa este modelo como jogador com altura de ${modelHeight.toFixed(2)} unidades.`" @click="useAsPlayerModel">Usar como jogador</button><button v-if="!props.initialAsset || isEditingSavedComponent" type="button" class="model-import-primary" :disabled="!model || loading" :title="isEditingSavedComponent ? 'Salva as alterações no componente existente, sem criar uma cópia.' : 'Salva o modelo e suas configurações como componente reutilizável.'" @click="confirmImport"><span>{{ loading ? '…' : isEditingSavedComponent ? '✓' : '＋' }}</span> {{ loading ? 'Salvando…' : isEditingSavedComponent ? 'Salvar alterações' : 'Salvar componente' }}</button></div>
      </footer>
    </section>
  </div>
  <StarterAssetCatalogDialog
    :open="starterAssetCatalogOpen"
    @close="starterAssetCatalogOpen = false"
    @load-model="loadCatalogAsset"
  />
</template>

<style src="./ModelImportDialog.css"></style>
