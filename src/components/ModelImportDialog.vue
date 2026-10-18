<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import {
  getStaticMeshCollisionData,
  invalidateStaticMeshCollider,
  releaseStaticMeshCollider,
} from '@engine/world/StaticMeshCollider'
import { loadAssetFile } from '@/lib/assets/AssetImporter'
import type { AssetImportPackageContext, AssetPackageFile } from '@/lib/assets/AssetImporter'
import { AnimationController, inferAnimationRole } from '@engine/world/AnimationController'
import { BEHAVIOR_PACKAGE_DEFINITIONS, DEFAULT_CONTROL_MAPS, DEFAULT_MODEL_CONTROL_BINDINGS } from '@engine'
import type { AnimationRole, BehaviorPackageDefinition, ControlMapBindings, ModelControlBindings, PackageJsonValue, PackageScalar } from '@engine'
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { analyzeRiggingInput, applyRigPose, autoRigModel, captureRigPose, rebindRigModel } from '@/lib/animation/Rigging'
import type { AutoRigPreset } from '@/lib/animation/Rigging'
import {
  createReusableAnimationAsset,
  findAnimationNode,
  getTransformTrackPath,
  parseReusableAnimationClip,
  retargetAnimationClip,
  rankTargetBoneCandidates,
  suggestAutonomousBoneMappingsDetailed,
} from '@/lib/animation/AnimationRetargeting'
import type { ReusableAnimationAsset } from '@/lib/animation/AnimationRetargeting'

type ImportBehaviorPackageDraft = {
  variables: Record<string, PackageScalar>
  config: Record<string, PackageJsonValue>
}

// Clona valores JSON recursivamente sem structuredClone: dados lidos de refs do Vue
// podem ser Proxy reativos, que structuredClone rejeita.
function clonePackageJsonValue(value: PackageJsonValue): PackageJsonValue {
  if (Array.isArray(value)) return value.map(clonePackageJsonValue)
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, PackageJsonValue> = {}
    for (const [key, nested] of Object.entries(value)) {
      copy[key] = clonePackageJsonValue(nested)
    }
    return copy
  }
  return value
}

function clonePackageJsonRecord(record: Record<string, PackageJsonValue>): Record<string, PackageJsonValue> {
  return clonePackageJsonValue(record) as Record<string, PackageJsonValue>
}

function cloneImportBehaviorPackageSettings(
  settings: Record<string, ImportBehaviorPackageDraft>,
): Record<string, ImportBehaviorPackageDraft> {
  return Object.fromEntries(Object.entries(settings).map(([id, draft]) => [id, {
    variables: { ...draft.variables },
    config: clonePackageJsonRecord(draft.config),
  }]))
}
type ImportModelStateDraft = {
  id: string
  nodePath: string
  variable: string
  operator: 'equals' | 'not_equals'
  value: PackageScalar
  visibleWhenMatched: boolean
}
type ModelImportBatchItem = {
  partId: string
  name: string
  model: THREE.Object3D
  height: number
}

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
const thumbnailFileInput = ref<HTMLInputElement | null>(null)
const customThumbnail = ref<string | null>(null)
const customThumbnailFileName = ref('')
const thumbnailImageError = ref('')
const canvas = ref<HTMLCanvasElement | null>(null)
const fileName = ref('')
const error = ref('')
const loading = ref(false)
const modelHeight = ref(2)
const originalHeight = ref(0)
const dimensions = ref<[number, number, number]>([0, 0, 0])
const model = shallowRef<THREE.Object3D | null>(null)
const previewParts = shallowRef<Array<{ id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }>>([])
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
    .filter(part => part.object !== activeRoot && isDescendantOf(part.object, activeRoot))
    .map(part => ({
      path: getPreviewModelNodePath(part.object, activeRoot),
      name: part.name,
      meshCount: part.meshCount,
    }))
    .filter(node => node.path)
  const rootPath = getPreviewModelNodePath(activeRoot, activeRoot)
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

type ModelDiagnostic = {
  id: string
  name: string
  type: string
  depth: number
  meshInfo: string
  materials: string
}
type GltfMetadata = {
  images: Array<{ index: number; name: string; mimeType: string; uri: string; bufferView: number | null }>
  textures: Array<{ index: number; name: string; source: number | null }>
  materials: Array<{ index: number; name: string; baseColorTexture: number | null; normalTexture: number | null; occlusionTexture: number | null; emissiveTexture: number | null; baseColorFactor: number[] | null }>
  animations: Array<{ index: number; name: string; channels: number }>
}
const modelDiagnostics = shallowRef<ModelDiagnostic[]>([])
const diagnosticSummary = ref({ nodes: 0, meshes: 0, skinned: 0, materials: 0, textures: 0, clips: 0 })
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
const animationRoleBaseOptions: Array<{ value: AnimationRole; label: string }> = [
  { value: 'ignore', label: 'Não usar' },
  { value: 'idle', label: 'Parado / repouso' },
  { value: 'walk', label: 'Andar para frente' },
  { value: 'walk_slow', label: 'Andar devagar (alternância de caminhada)' },
  { value: 'walk_backward', label: 'Andar para trás' },
  { value: 'walk_left', label: 'Deslocar para esquerda' },
  { value: 'walk_right', label: 'Deslocar para direita' },
  { value: 'walk_diagonal_left', label: 'Andar na diagonal esquerda' },
  { value: 'walk_diagonal_right', label: 'Andar na diagonal direita' },
  { value: 'walk_backward_diagonal_left', label: 'Andar para trás e esquerda' },
  { value: 'walk_backward_diagonal_right', label: 'Andar para trás e direita' },
  { value: 'run', label: 'Correr para frente' },
  { value: 'run_backward', label: 'Correr para trás' },
  { value: 'run_left', label: 'Correr para esquerda' },
  { value: 'run_right', label: 'Correr para direita' },
  { value: 'run_diagonal_left', label: 'Correr na diagonal esquerda' },
  { value: 'run_diagonal_right', label: 'Correr na diagonal direita' },
  { value: 'run_backward_diagonal_left', label: 'Correr para trás e esquerda' },
  { value: 'run_backward_diagonal_right', label: 'Correr para trás e direita' },
  { value: 'run_stop', label: 'Parar após correr' },
  { value: 'jump', label: 'Pular' },
  { value: 'crouch', label: 'Agachar parado' },
  { value: 'crouch_walk', label: 'Mover agachado' },
  { value: 'prone', label: 'Deitado / rastejar parado' },
  { value: 'prone_crawl', label: 'Rastejar em movimento' },
  { value: 'dodge', label: 'Esquiva' },
  { value: 'slide', label: 'Deslizar' },
  { value: 'roll', label: 'Rolamento evasivo' },
  { value: 'interact', label: 'Interagir' },
  { value: 'primary_action', label: 'Ação principal / ataque' },
  { value: 'secondary_action', label: 'Ação secundária / defesa' },
  { value: 'inventory', label: 'Abrir inventário' },
  { value: 'use_item', label: 'Usar item' },
  { value: 'reload', label: 'Recarregar' },
  { value: 'ability_1', label: 'Habilidade 1' },
  { value: 'ability_2', label: 'Habilidade 2' },
  { value: 'ability_3', label: 'Habilidade 3' },
  { value: 'ability_4', label: 'Habilidade 4' },
  { value: 'emote', label: 'Emote / gesto' },
  { value: 'mount', label: 'Montar / subir' },
  { value: 'dismount', label: 'Desmontar / descer' },
]
const animationRoleControlBindingKeys: Partial<Record<AnimationRole, keyof ControlMapBindings>> = {
  walk: 'forward',
  walk_slow: 'walkToggle',
  walk_backward: 'backward',
  walk_left: 'left',
  walk_right: 'right',
  walk_diagonal_left: 'left',
  walk_diagonal_right: 'right',
  walk_backward_diagonal_left: 'left',
  walk_backward_diagonal_right: 'right',
  run: 'run',
  run_backward: 'backward',
  run_left: 'left',
  run_right: 'right',
  run_diagonal_left: 'left',
  run_diagonal_right: 'right',
  run_backward_diagonal_left: 'left',
  run_backward_diagonal_right: 'right',
  run_stop: 'run',
  jump: 'jump',
  crouch: 'crouchToggle',
  crouch_walk: 'crouchToggle',
  prone: 'proneToggle',
  prone_crawl: 'proneToggle',
  dodge: 'dodge',
  slide: 'slide',
  roll: 'roll',
  interact: 'interact',
  mount: 'interact',
  dismount: 'interact',
  primary_action: 'primaryAction',
  secondary_action: 'secondaryAction',
  inventory: 'inventory',
  use_item: 'useItem',
  reload: 'reload',
  ability_1: 'ability1',
  ability_2: 'ability2',
  ability_3: 'ability3',
  ability_4: 'ability4',
  emote: 'emote',
}
const activeControlMapBindings = computed(() => props.controlMap ?? DEFAULT_CONTROL_MAPS[0]!.bindings)
const animationRoleOptions = computed(() => animationRoleBaseOptions.map(option => {
  const bindingKey = animationRoleControlBindingKeys[option.value]
  if (!bindingKey) return option
  const keyCode = activeControlMapBindings.value[bindingKey] ?? DEFAULT_CONTROL_MAPS[0]!.bindings[bindingKey]
  return { ...option, label: `${option.label} · ${formatControlKey(keyCode)}` }
}))
type RigPose = ReturnType<typeof captureRigPose>
type RigKeyframe = { time: number; pose: RigPose }
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
const RETARGET_ANIMATION_LIBRARY_KEY = 'engine-prometheus.reusable-animations.v1'
const retargetFileInput = ref<HTMLInputElement | null>(null)
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
const retargetSourceNodeNames = computed(() => {
  const asset = retargetLibraryAsset.value
  if (asset) {
    // Novos itens guardam quais nós são ossos reais; para itens antigos,
    // preserva o comportamento porque a biblioteca não armazena o GLB original.
    const sourceBones = asset.sourceBoneNames ?? asset.sourceNodeNames
    return sourceBones.filter(name => !!asset.sourcePose[name])
  }
  const root = retargetSourceRoot.value
  const clip = retargetSourceClip.value
  if (!root || !clip) return []
  const names = [...new Set(clip.tracks
    .map(getTransformTrackPath)
    .filter((path): path is NonNullable<ReturnType<typeof getTransformTrackPath>> => path !== null)
    .map(path => path.nodeName))]
  // O destino do retarget é um rig esquelético: wrappers e pivôs de malha
  // animados não devem inflacionar a taxa de cobertura dos ossos.
  return names.filter(name => findAnimationNode(root, name) instanceof THREE.Bone)
})
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
const skinTokensRigCompatible = computed(() => {
  const root = model.value
  if (!root || props.initialAsset) return false
  let hasStaticMesh = false
  let hasSkinnedMesh = false
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) hasSkinnedMesh = true
    else if (node instanceof THREE.Mesh && node.geometry.getAttribute('position')?.count) hasStaticMesh = true
  })
  return skinTokensOperation.value === 'rig' ? hasStaticMesh && !hasSkinnedMesh : hasSkinnedMesh
})
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
  if (!rigHelper) return
  scene?.remove(rigHelper)
  rigHelper.geometry.dispose()
  const material = rigHelper.material
  if (Array.isArray(material)) material.forEach(item => item.dispose())
  else material.dispose()
  rigHelper = null
}

function refreshRigHelper() {
  if (!model.value || !scene || rigBones.value.length === 0) return
  removeRigHelper()
  rigHelper = new THREE.SkeletonHelper(model.value)
  rigHelper.name = 'ModelWorkspaceRigHelper'
  rigHelper.renderOrder = 999
  rigHelper.frustumCulled = false
  scene.add(rigHelper)
  rigHelper.updateMatrixWorld(true)
}

function ensureGroupRootForRig(): THREE.Object3D | null {
  const current = model.value
  if (!current || !(current instanceof THREE.Mesh) || current instanceof THREE.SkinnedMesh) return current
  const host = current.parent ?? scene
  if (!host) return current

  // Formatos como STL/PLY podem chegar como Mesh raiz, sem um nó Group.
  // Um wrapper permite inserir Bones como irmãos da malha sem perder os transforms.
  const wrapper = new THREE.Group()
  wrapper.name = current.name || 'RigRoot'
  wrapper.userData = { ...current.userData }
  wrapper.position.copy(current.position)
  wrapper.quaternion.copy(current.quaternion)
  wrapper.scale.copy(current.scale)
  host.add(wrapper)
  wrapper.add(current)
  current.position.set(0, 0, 0)
  current.quaternion.identity()
  current.scale.set(1, 1, 1)
  current.updateMatrix()
  wrapper.updateWorldMatrix(true, true)
  model.value = wrapper
  return wrapper
}

function createRig() {
  let root = model.value
  if (!root || props.initialAsset || loading.value) return
  error.value = ''
  try {
    previewAnimationController?.stop()
    const rigRoot = ensureGroupRootForRig()
    if (!rigRoot) return
    root = rigRoot
    const result = autoRigModel(root, rigPreset.value)
    rigBones.value = result.bones
    rigPreset.value = result.preset
    selectedRigBoneName.value = result.bones[0]?.name ?? ''
    rigRestPose.value = captureRigPose(result.bones)
    rigKeyframes.value = []
    rigFrameTime.value = 0
    rigDuration.value = 1
    rigMessage.value = result.message
    root.userData.importNeedsReexport = true
    root.userData.importRigPreset = result.preset
    root.userData.importRigGenerated = result.created || (
      result.bones.length > 0 && result.bones.every(bone => bone.userData.generatedRigBone === true)
    )
    refreshRigHelper()
    refreshPreviewParts()
    refreshModelDiagnostics()
  } catch (cause) {
    rigMessage.value = ''
    error.value = cause instanceof Error ? cause.message : 'Não foi possível criar o rig.'
  }
}

function applySelectedBoneTransform() {
  const bone = selectedRigBone.value
  if (!bone) return
  previewAnimationController?.stop()
  const root = model.value
  if (root) root.userData.importNeedsReexport = true
  const positionChanged = Math.abs(bone.position.x - bonePositionDraft.value.x) > 1e-5 ||
    Math.abs(bone.position.y - bonePositionDraft.value.y) > 1e-5 ||
    Math.abs(bone.position.z - bonePositionDraft.value.z) > 1e-5

  if (root?.userData.importRigGenerated === true && positionChanged) {
    // Reposicionar um pivô redefine o repouso do rig. Quadros antigos são
    // descartados porque dependiam da posição anterior do osso.
    applyRigPose(rigBones.value, rigRestPose.value)
    bone.position.set(bonePositionDraft.value.x, bonePositionDraft.value.y, bonePositionDraft.value.z)
    root.updateWorldMatrix(true, true)
    rebindRigModel(root)
    rigRestPose.value = captureRigPose(rigBones.value)
    rigKeyframes.value = []
    rigFrameTime.value = 0
    rigDuration.value = 1
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(bone.rotation.x),
      y: THREE.MathUtils.radToDeg(bone.rotation.y),
      z: THREE.MathUtils.radToDeg(bone.rotation.z),
    }
    rigMessage.value = 'Pivô ajustado e pose de repouso atualizada. Grave novamente os quadros-chave.'
  } else {
    bone.rotation.set(
      THREE.MathUtils.degToRad(boneRotationDraft.value.x),
      THREE.MathUtils.degToRad(boneRotationDraft.value.y),
      THREE.MathUtils.degToRad(boneRotationDraft.value.z),
      bone.rotation.order,
    )
  }
  bone.updateMatrixWorld(true)
  root?.updateWorldMatrix(true, true)
  rigHelper?.updateMatrixWorld(true)
}

function resetRigPose() {
  if (!rigBones.value.length) return
  previewAnimationController?.stop()
  applyRigPose(rigBones.value, rigRestPose.value)
  if (selectedRigBone.value) {
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.x),
      y: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.y),
      z: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.z),
    }
    bonePositionDraft.value = {
      x: selectedRigBone.value.position.x,
      y: selectedRigBone.value.position.y,
      z: selectedRigBone.value.position.z,
    }
  }
  rigHelper?.updateMatrixWorld(true)
}

function recordRigKeyframe() {
  if (!rigBones.value.length || !model.value) return
  if (!Number.isFinite(rigFrameTime.value) || rigFrameTime.value < 0) {
    rigMessage.value = 'O tempo do quadro precisa ser zero ou positivo.'
    return
  }
  previewAnimationController?.stop()
  const time = Number(rigFrameTime.value.toFixed(3))
  const pose = captureRigPose(rigBones.value)
  const existing = rigKeyframes.value.findIndex(frame => Math.abs(frame.time - time) < 0.001)
  const frame = { time, pose }
  if (existing >= 0) {
    rigKeyframes.value = rigKeyframes.value.map((item, index) => index === existing ? frame : item)
  } else {
    rigKeyframes.value = [...rigKeyframes.value, frame].sort((a, b) => a.time - b.time)
  }
  rigDuration.value = Math.max(rigDuration.value, time, 0.1)
  rigMessage.value = `Pose gravada em ${time.toFixed(2)} s (${rigBones.value.length} ossos).`
}

function applyRigFrame(frame: RigKeyframe) {
  rigFrameTime.value = frame.time
  applyRigPose(rigBones.value, frame.pose)
  if (selectedRigBone.value) {
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.x),
      y: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.y),
      z: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.z),
    }
  }
  rigHelper?.updateMatrixWorld(true)
  rigMessage.value = `Pose de ${frame.time.toFixed(2)} s aplicada para edição.`
}

function clearRigKeyframesForNewClip() {
  rigKeyframes.value = []
  rigFrameTime.value = 0
  rigClipName.value = `Animacao ${previewAnimations.value.length + 1}`
  rigMessage.value = 'Linha do tempo limpa. Grave a pose inicial em 0 s e as próximas poses nos tempos desejados.'
}

function createRigAnimation() {
  const root = model.value
  if (!root || !rigBones.value.length || props.initialAsset) return
  const frames = [...rigKeyframes.value].sort((a, b) => a.time - b.time)
  if (frames.length < 2 || frames[0]!.time === frames[frames.length - 1]!.time) {
    rigMessage.value = 'Grave pelo menos duas poses em tempos diferentes (por exemplo, 0 s e 1 s).'
    return
  }
  const name = rigClipName.value.trim()
  if (!name) {
    rigMessage.value = 'Digite um nome para a animação.'
    return
  }
  const clipFrames = frames[0]!.time > 0 ? [{ ...frames[0]!, time: 0 }, ...frames] : frames
  const duration = Math.max(0.1, rigDuration.value, clipFrames[clipFrames.length - 1]!.time)
  const times = clipFrames.map(frame => frame.time)
  const tracks: THREE.KeyframeTrack[] = []

  for (const bone of rigBones.value) {
    const positions: number[] = []
    const quaternions: number[] = []
    const scales: number[] = []
    for (const frame of clipFrames) {
      const transform = frame.pose[bone.name]
      if (!transform) continue
      positions.push(...transform.position)
      quaternions.push(...transform.quaternion)
      scales.push(...transform.scale)
    }
    if (positions.length !== times.length * 3 || quaternions.length !== times.length * 4 || scales.length !== times.length * 3) continue
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, positions))
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, quaternions))
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, scales))
  }
  if (!tracks.length) {
    rigMessage.value = 'Não existem trilhas válidas para exportar. Confira o rig e grave as poses novamente.'
    return
  }

  const clip = new THREE.AnimationClip(name, duration, tracks)
  const clips = [...previewAnimations.value, clip]
  const newIndex = clips.length - 1
  const nextRoles = { ...animationRoles.value, [String(newIndex)]: rigClipRole.value }
  root.userData.importNeedsReexport = true
  root.userData.importHasModifiedAnimations = true
  root.userData.importAnimations = clips
  root.userData.importAnimationRoles = nextRoles
  animationRoles.value = nextRoles
  animationClipRevision.value += 1
  previewAnimationIndex.value = newIndex
  refreshModelDiagnostics()
  selectPreviewAnimation(newIndex)
  rigMessage.value = `Animação "${name}" criada com ${tracks.length / 3} trilhas e associada ao papel "${animationRoleBaseOptions.find(option => option.value === rigClipRole.value)?.label ?? rigClipRole.value}". Ela será exportada junto com o modelo.`
}

function setRigTime(value: number) {
  rigFrameTime.value = Math.max(0, Number.isFinite(value) ? value : 0)
}

function normalizeControlBindings(value: unknown): ModelControlBindings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ModelControlBindings>
    : {}
  const read = (key: ControlBindingAction): string => {
    const candidate = raw[key]
    return typeof candidate === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(candidate)
      ? candidate
      : DEFAULT_MODEL_CONTROL_BINDINGS[key]
  }
  return {
    forward: read('forward'),
    backward: read('backward'),
    left: read('left'),
    right: read('right'),
    run: read('run'),
    jump: read('jump'),
    interact: read('interact'),
  }
}

function formatControlKey(code: string): string {
  const names: Record<string, string> = {
    Space: 'Espaço',
    ShiftLeft: 'Shift esquerdo',
    ShiftRight: 'Shift direito',
    ControlLeft: 'Ctrl esquerdo',
    ControlRight: 'Ctrl direito',
    AltLeft: 'Alt esquerdo',
    AltRight: 'Alt direito',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    CapsLock: 'Caps Lock',
  }
  if (names[code]) return names[code]!
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6)
  return code
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

/** Gera uma prévia leve; a colisão em runtime continua usando todos os triângulos no BVH. */
function createStaticColliderPreviewGeometry(source: THREE.BufferGeometry, maxTriangles = 60_000): { geometry: THREE.BufferGeometry; sampled: boolean } {
  const position = source.getAttribute('position')
  const index = source.getIndex()
  const triangleCount = Math.floor((index ? index.count : position?.count ?? 0) / 3)
  const stride = Math.max(1, Math.ceil(triangleCount / maxTriangles))
  const output = new Float32Array(Math.ceil(triangleCount / stride) * 18)
  let cursor = 0

  const writeVertex = (vertexIndex: number) => {
    output[cursor++] = position.getX(vertexIndex)
    output[cursor++] = position.getY(vertexIndex)
    output[cursor++] = position.getZ(vertexIndex)
  }

  for (let triangle = 0; triangle < triangleCount; triangle += stride) {
    const a = index ? index.getX(triangle * 3) : triangle * 3
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
    const d = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
    writeVertex(a); writeVertex(b)
    writeVertex(b); writeVertex(d)
    writeVertex(d); writeVertex(a)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(cursor === output.length ? output : output.slice(0, cursor), 3))
  return { geometry, sampled: stride > 1 }
}

function updateColliderPreview() {
  colliderPreviewNotice.value = ''
  if (!scene || !model.value) return
  if (colliderPreview) {
    scene.remove(colliderPreview)
    colliderPreview.geometry.dispose()
    ;(colliderPreview.material as THREE.Material).dispose()
    colliderPreview = null
  }
  if (!model.value || colliderType.value === 'none') return
  if (colliderType.value === 'mesh') {
    const collisionData = getStaticMeshCollisionData(model.value)
    if (!collisionData) {
      colliderPreviewNotice.value = 'Não foi possível preparar a malha estática. Confira se o modelo contém peças estáticas e se não ultrapassa 5 milhões de triângulos. Partes animadas não entram neste colisor.'
      return
    }
    const preview = createStaticColliderPreviewGeometry(collisionData.geometry)
    colliderPreviewNotice.value = `Malha pronta: ${collisionData.partCount} partes estáticas · ${collisionData.triangleCount.toLocaleString('pt-BR')} triângulos${preview.sampled ? ' · contorno amostrado para manter a prévia fluida' : ''}.`
    model.value.updateWorldMatrix(true, true)
    colliderPreview = new THREE.LineSegments(
      preview.geometry,
      new THREE.LineBasicMaterial({ color: 0x65e6a0, depthTest: false, transparent: true, opacity: 0.72 }),
    )
    colliderPreview.name = 'import-collider-preview'
    colliderPreview.renderOrder = 1000
    colliderPreview.matrixAutoUpdate = false
    colliderPreview.matrix.copy(model.value.matrixWorld)
    colliderPreview.matrixWorldNeedsUpdate = true
    scene.add(colliderPreview)
    return
  }
  const [width, height, depth] = colliderSize.value.map(value => Math.max(0.05, value))
  let geometry: THREE.BufferGeometry
  if (colliderType.value === 'sphere') {
    geometry = new THREE.IcosahedronGeometry(Math.max(width, height, depth) / 2, 2)
  } else if (colliderType.value === 'capsule') {
    const radius = Math.max(0.025, Math.min(width, depth) / 4)
    geometry = new THREE.CapsuleGeometry(radius, Math.max(0, height - radius * 2), 4, 8)
    geometry.scale(width / Math.max(radius * 2, 0.05), 1, depth / Math.max(radius * 2, 0.05))
  } else {
    geometry = new THREE.BoxGeometry(width, height, depth)
  }
  geometry.translate(...colliderOffset.value)
  colliderPreview = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x65e6a0, depthTest: false, transparent: true, opacity: 0.98 }),
  )
  colliderPreview.name = 'import-collider-preview'
  colliderPreview.renderOrder = 1000
  const selectedPart = !isEditingSavedComponent.value && selectedPartId.value
    ? findPreviewPart(selectedPartId.value)
    : undefined
  if (selectedPart) {
    const partBounds = new THREE.Box3().setFromObject(selectedPart.object)
    if (!partBounds.isEmpty()) colliderPreview.position.copy(partBounds.getCenter(new THREE.Vector3()))
  }
  scene.add(colliderPreview)
  geometry.dispose()
}

/** Identifica cenários largos e multipartes para iniciar com colisão de malha estática. */
function shouldDefaultToStaticCityCollider(root: THREE.Object3D): boolean {
  let meshCount = 0
  let triangleCount = 0
  let hasAnimatedGeometry = false
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const position = node.geometry.getAttribute('position')
    if (!position || position.count < 3) return
    meshCount += 1
    if (node instanceof THREE.SkinnedMesh || (node.geometry.morphAttributes.position?.length ?? 0) > 0) {
      hasAnimatedGeometry = true
    }
    const index = node.geometry.getIndex()
    triangleCount += Math.floor((index ? index.count : position.count) / 3)
  })

  // Evita mudar automaticamente o colisor de personagens, veículos ou arquivos
  // com clipes de animação. A malha estática continua selecionável manualmente.
  const clips = root.userData.importAnimations
  const hasAnimationClips = Array.isArray(clips) && clips.length > 0
  if (hasAnimatedGeometry || hasAnimationClips || meshCount === 0) return false

  // A biblioteca salva modelos já normalizados pela altura final. Para que
  // cidades importadas anteriormente também sejam reconhecidas, use proporção e
  // detalhe além da extensão absoluta, que pode ter diminuído após a normalização.
  const [width, height, depth] = dimensions.value
  const footprint = Math.max(width, depth)
  const aspectRatio = footprint / Math.max(height, 0.1)
  const detailedScene = triangleCount >= 800 || meshCount >= 12
  const wideLandscape = footprint >= 18 && detailedScene
  const manyIndependentParts = meshCount >= 36 && footprint >= 8
  const scaleNormalizedCity = footprint >= 8 && aspectRatio >= 3 && triangleCount >= 800
  return wideLandscape || manyIndependentParts || scaleNormalizedCity
}

function changeColliderType(value: 'box' | 'sphere' | 'capsule' | 'mesh' | 'none') {
  colliderType.value = value
  // Malha estática usa o transform das superfícies reais. Não aplica o offset
  // de caixas/cápsulas de um modo anterior, para preview e runtime coincidirem.
  if (value === 'mesh') colliderOffset.value = [0, 0, 0]
  if (value === 'sphere') {
    const diameter = Math.max(0.05, Math.min(...colliderSize.value))
    colliderSize.value = [diameter, diameter, diameter]
  }
  updateColliderPreview()
}

function setColliderVector(field: 'colliderSize' | 'colliderOffset', axis: 0 | 1 | 2, value: number) {
  if (!Number.isFinite(value)) return
  const vector: [number, number, number] = [...(field === 'colliderSize' ? colliderSize.value : colliderOffset.value)]
  const safeValue = field === 'colliderSize' ? Math.max(0.05, Math.min(100, value)) : Math.max(-100, Math.min(100, value))
  vector[axis] = safeValue
  if (field === 'colliderSize') {
    if (colliderType.value === 'sphere') vector.splice(0, 3, safeValue, safeValue, safeValue)
    colliderSize.value = vector
  } else colliderOffset.value = vector
  updateColliderPreview()
}

const recoverableColorImages = computed(() => (gltfMetadata.value?.images ?? []).filter(image => image.uri.startsWith('data:image/')))
const materialsMissingColorTexture = computed(() => (gltfMetadata.value?.materials ?? []).filter(material => material.baseColorTexture === null))

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let frame = 0
let resizeObserver: ResizeObserver | null = null
let currentObjectUrl = ''
let previewMixer: THREE.AnimationMixer | null = null
let previewAnimationController: AnimationController | null = null
let previewAnimationRoot: THREE.Object3D | null = null

function previewRoleForClip(clip: THREE.AnimationClip): string {
  return `preview:${clip.uuid}`
}

/** O editor usa o mesmo controlador de pesos/transições, inclusive ao trocar clipes. */
function ensurePreviewAnimationController(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): AnimationController {
  if (!previewMixer || !previewAnimationController || previewAnimationRoot !== root) {
    previewAnimationController?.dispose()
    previewMixer?.stopAllAction()
    previewMixer = new THREE.AnimationMixer(root)
    const actions = new Map<string, THREE.AnimationAction>()
    for (const clip of clips) actions.set(previewRoleForClip(clip), previewMixer.clipAction(clip))
    previewAnimationController = new AnimationController(previewMixer, actions)
    previewAnimationRoot = root
  } else {
    // Rigging/retargeting pode adicionar novos clipes durante a sessão; registre-os
    // no mixer existente sem recriar a pose do modelo.
    for (const clip of clips) {
      const role = previewRoleForClip(clip)
      if (!previewAnimationController.hasRole(role)) {
        previewAnimationController.actions.set(role, previewMixer.clipAction(clip))
      }
    }
  }
  return previewAnimationController
}

function clearPreviewAnimationController(): void {
  previewAnimationController?.dispose()
  previewAnimationController = null
  previewAnimationRoot = null
  previewMixer = null
}

type RetargetRestPose = ReturnType<typeof captureRigPose>
const retargetRestPoseByModel = new WeakMap<THREE.Object3D, RetargetRestPose>()

function captureRetargetRestPose(root: THREE.Object3D): RetargetRestPose {
  const bones: THREE.Bone[] = []
  root.traverse(node => { if (node instanceof THREE.Bone) bones.push(node) })
  return captureRigPose(bones)
}

function restoreRetargetRestPose(root: THREE.Object3D, bones?: THREE.Bone[]): boolean {
  const pose = retargetRestPoseByModel.get(root)
  if (!pose || Object.keys(pose).length === 0) return false
  const targetBones = bones ?? (() => {
    const result: THREE.Bone[] = []
    root.traverse(node => { if (node instanceof THREE.Bone) result.push(node) })
    return result
  })()
  applyRigPose(targetBones, pose)
  root.updateWorldMatrix(true, true)
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.update()
  })
  return true
}
const previewClock = new THREE.Clock()

function disposeModel(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      geometries.add(child.geometry)
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
      childMaterials.forEach(material => {
        materials.add(material)
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value)
        }
      })
    }
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => texture.dispose())
}

function refreshPreviewParts() {
  const root = model.value
  if (!root) {
    previewParts.value = []
    selectedPartId.value = ''
    soloPartId.value = ''
    return
  }

  // Conte os nós de baixo para cima: a quantidade de malhas de cada grupo é
  // calculada uma só vez, em vez de percorrer seus descendentes repetidamente.
  const nodes: Array<{ node: THREE.Object3D; depth: number }> = []
  const collect = (node: THREE.Object3D, depth: number) => {
    nodes.push({ node, depth })
    for (const child of node.children) collect(child, depth + 1)
  }
  collect(root, -1)

  const meshCounts = new Map<THREE.Object3D, number>()
  for (const entry of nodes) meshCounts.set(entry.node, entry.node instanceof THREE.Mesh ? 1 : 0)
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const entry = nodes[index]!
    const parent = entry.node.parent
    if (parent) {
      meshCounts.set(parent, (meshCounts.get(parent) ?? 0) + (meshCounts.get(entry.node) ?? 0))
    }
  }

  const parts: Array<{ id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }> = []
  let unnamedIndex = 0
  for (const { node, depth } of nodes) {
    if (node === root) continue
    const meshCount = meshCounts.get(node) ?? 0
    if (!meshCount) continue
    unnamedIndex += 1
    parts.push({
      id: node.uuid,
      name: node.name.trim() || (node instanceof THREE.Mesh ? `Malha ${unnamedIndex}` : `Grupo ${unnamedIndex}`),
      object: node,
      depth,
      meshCount,
    })
  }

  previewParts.value = parts
  const validIds = new Set(parts.map(part => part.id))
  batchSelectedPartIds.value = batchSelectedPartIds.value.filter(id => validIds.has(id))
  batchSavedPartIds.value = batchSavedPartIds.value.filter(id => validIds.has(id))
  if (!parts.some(part => part.id === selectedPartId.value)) selectedPartId.value = ''
  if (!parts.some(part => part.id === soloPartId.value)) soloPartId.value = ''
}

function findPreviewPart(id: string) {
  return previewParts.value.find(part => part.id === id)
}

function isObjectWithin(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function toggleBatchPartSelection(
  part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number },
  checked: boolean,
) {
  if (!checked) {
    batchSelectedPartIds.value = batchSelectedPartIds.value.filter(id => id !== part.id)
    return
  }

  // A seleção usa grupos mutuamente exclusivos: salvar um grupo já inclui seus
  // descendentes, então selecionar um filho substitui o pai e vice-versa.
  const next = batchSelectedPartIds.value.filter(id => {
    const selected = findPreviewPart(id)
    if (!selected) return false
    return selected.id !== part.id
      && !isObjectWithin(selected.object, part.object)
      && !isObjectWithin(part.object, selected.object)
  })
  next.push(part.id)
  batchSelectedPartIds.value = next
}

function clearBatchSelection() {
  batchSelectedPartIds.value = []
}

function setColliderFromPreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  const bounds = new THREE.Box3().setFromObject(part.object)
  if (bounds.isEmpty()) return
  const size = bounds.getSize(new THREE.Vector3())
  // O componente será normalizado para a altura escolhida ao colocá-lo no
  // mundo, por isso o colisor também precisa usar essa escala final.
  const scale = modelHeight.value / Math.max(size.y, 0.05)
  const scaledSize: [number, number, number] = [
    Math.max(0.05, size.x * scale),
    Math.max(0.05, size.y * scale),
    Math.max(0.05, size.z * scale),
  ]
  if (colliderType.value === 'sphere') {
    const diameter = Math.max(0.05, Math.min(...scaledSize))
    colliderSize.value = [diameter, diameter, diameter]
  } else {
    colliderSize.value = scaledSize
  }
  colliderOffset.value = [0, 0, 0]
}

function selectPreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  if (soloPartId.value) restorePreviewVisibility()
  selectedPartId.value = part.id
  if (!props.initialAsset) {
    componentName.value = part.name
    setColliderFromPreviewPart(part)
  }
  fitCamera(part.object)
  updateColliderPreview()
}

function togglePreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  if (soloPartId.value) restorePreviewVisibility()
  part.object.visible = !part.object.visible
  if (model.value) invalidateStaticMeshCollider(model.value)
  updateColliderPreview()
}

function showOnlyPreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  const root = model.value
  if (!root) return
  if (soloPartId.value === part.id) {
    restorePreviewVisibility()
  } else {
    // Os ancestrais precisam permanecer visíveis: no Three.js, esconder um pai
    // também esconde todos os seus descendentes, mesmo que o filho esteja visible=true.
    invalidateStaticMeshCollider(root)
    root.traverse(node => {
      const isPart = node === part.object
      const isChild = isDescendantOf(node, part.object)
      const isParent = isDescendantOf(part.object, node)
      node.visible = node === root || isPart || isChild || isParent
    })
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
  const wholeModelSize: [number, number, number] = [
    Math.max(0.05, dimensions.value[0] * scale),
    Math.max(0.05, dimensions.value[1] * scale),
    Math.max(0.05, dimensions.value[2] * scale),
  ]
  if (colliderType.value === 'sphere') {
    const diameter = Math.max(0.05, Math.min(...wholeModelSize))
    colliderSize.value = [diameter, diameter, diameter]
  } else {
    colliderSize.value = wholeModelSize
  }
  colliderOffset.value = [0, 0, 0]
  fitCamera(root)
  updateColliderPreview()
}

function isDescendantOf(node: THREE.Object3D, ancestor: THREE.Object3D) {
  let current: THREE.Object3D | null = node
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function restorePreviewVisibility() {
  const root = model.value
  root?.traverse(node => { node.visible = true })
  if (root) invalidateStaticMeshCollider(root)
  soloPartId.value = ''
}

/** Restaura a renderização de malhas importadas antes de avaliar uma animação. */
function restoreModelRenderableMeshes(root: THREE.Object3D) {
  root.traverse(node => {
    node.visible = true
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) material.visible = true
    // Malhas esqueléticas não devem ser descartadas pelo frustum com bounds de repouso.
    if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false
  })
  root.updateMatrixWorld(true)
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.update()
  })
  invalidateStaticMeshCollider(root)
}

function deletePreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
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
  const metadata = gltfMetadata.value
  const materialInfo = metadata?.materials.find(item => item.index === materialIndex)
  const imageIndex = Number(textureRepairSelections.value[String(materialIndex)])
  const imageInfo = metadata?.images.find(image => image.index === imageIndex)
  if (!root || !materialInfo || !imageInfo?.uri.startsWith('data:image/')) {
    textureRepairMessage.value = 'Selecione uma imagem incorporada válida para este material.'
    return
  }
  textureRepairBusy.value = true
  textureRepairMessage.value = ''
  try {
    const texture = await new THREE.TextureLoader().loadAsync(imageInfo.uri)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.needsUpdate = true
    let assigned = 0
    const recoveredTextures = (root.userData.importRecoveredTextures as THREE.Texture[] | undefined) ?? []
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      for (const material of materials) {
        if (material.name !== materialInfo.name || !('map' in material)) continue
        const standard = material as THREE.MeshStandardMaterial
        // Só substitua mapas ausentes ou aplicados por esta ferramenta; nunca
        // sobrescreva uma textura original válida do arquivo.
        if (standard.map && !recoveredTextures.includes(standard.map)) continue
        standard.map = texture
        standard.needsUpdate = true
        assigned += 1
      }
    })
    if (!assigned) {
      texture.dispose()
      throw new Error(`Não encontrei malhas usando o material "${materialInfo.name || `Material ${materialIndex}`}" sem mapa de cor.`)
    }
    const applied = (root.userData.importRecoveredColorTextures as Record<string, number> | undefined) ?? {}
    applied[String(materialIndex)] = imageIndex
    root.userData.importRecoveredColorTextures = applied
    root.userData.importNeedsReexport = true
    recoveredTextures.push(texture)
    root.userData.importRecoveredTextures = recoveredTextures
    textureRepairMessage.value = `Imagem ${imageIndex} aplicada ao material ${materialInfo.name || materialIndex}. O mapa normal e os demais mapas foram preservados.`
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

  const rows: ModelDiagnostic[] = []
  const materialIds = new Set<string>()
  const textureIds = new Set<string>()
  let meshes = 0
  let skinned = 0
  root.traverse((node) => {
    const depth = (() => {
      let value = 0
      let parent = node.parent
      while (parent && parent !== root) { value += 1; parent = parent.parent }
      return value
    })()
    const isMesh = node instanceof THREE.Mesh
    const mesh = isMesh ? node as THREE.Mesh : null
    let meshInfo = ''
    let materialsText = ''
    if (mesh) {
      meshes += 1
      if (mesh instanceof THREE.SkinnedMesh) skinned += 1
      const geometry = mesh.geometry
      const position = geometry.getAttribute('position')
      meshInfo = `vértices: ${position?.count ?? 0}; grupos: ${geometry.groups.length}`
      if (mesh instanceof THREE.SkinnedMesh) {
        const skinIndex = geometry.getAttribute('skinIndex')
        const skinWeight = geometry.getAttribute('skinWeight')
        const bones = mesh.skeleton?.bones ?? []
        if (!skinIndex || !skinWeight || !position) {
          meshInfo += `; SKINNING INVÁLIDO: skinIndex=${skinIndex ? 'ok' : 'ausente'}, skinWeight=${skinWeight ? 'ok' : 'ausente'}, vértices=${position?.count ?? 0}`
        } else {
          // Inspecione influências reais por malha. Ter ossos Femur/Tibia no rig
          // não significa que os vértices das pernas estejam ponderados para eles.
          // Em malhas enormes, amostre até 50 mil vértices para manter a UI fluida.
          const vertexCount = position.count
          const step = Math.max(1, Math.ceil(vertexCount / 50000))
          const lowerBody = /hip|pelvis|waist|femur|thigh|leg|tibia|calf|shin|knee|foot|toe|ankle/i
          const lowerInfluenceCounts = new Map<string, number>()
          let sampledVertices = 0
          let zeroWeightVertices = 0
          let invalidJointIndices = 0
          let unnormalizedWeightVertices = 0
          const read = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, component: number) =>
            component === 0 ? attribute.getX(vertex)
              : component === 1 ? attribute.getY(vertex)
                : component === 2 ? attribute.getZ(vertex)
                  : attribute.getW(vertex)
          for (let vertex = 0; vertex < vertexCount; vertex += step) {
            sampledVertices += 1
            let weightSum = 0
            for (let influence = 0; influence < Math.min(4, skinIndex.itemSize, skinWeight.itemSize); influence += 1) {
              const jointIndex = Math.round(read(skinIndex, vertex, influence))
              const weight = read(skinWeight, vertex, influence)
              if (!Number.isFinite(weight) || weight <= 1e-5) continue
              weightSum += weight
              const joint = bones[jointIndex]
              if (!joint) {
                invalidJointIndices += 1
                continue
              }
              if (lowerBody.test(joint.name)) {
                lowerInfluenceCounts.set(joint.name, (lowerInfluenceCounts.get(joint.name) ?? 0) + 1)
              }
            }
            if (weightSum <= 1e-5) zeroWeightVertices += 1
            else if (Math.abs(weightSum - 1) > 0.08) unnormalizedWeightVertices += 1
          }
          const lowerSummary = [...lowerInfluenceCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([name, count]) => `${name}:${Math.round(count * 100 / Math.max(1, sampledVertices))}%`)
            .join(', ') || 'NENHUMA INFLUÊNCIA ENCONTRADA'
          meshInfo += `; skinning: ${bones.length} ossos, skinIndex=${skinIndex.itemSize} canais, skinWeight=${skinWeight.itemSize} canais; amostra=${sampledVertices}/${vertexCount} vértices; sem peso=${zeroWeightVertices}; índices inválidos=${invalidJointIndices}; pesos não normalizados=${unnormalizedWeightVertices}; influência inferior: ${lowerSummary}`
          if (step > 1) meshInfo += ` (amostragem 1:${step})`
        }
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materialsText = materials.map((material) => {
        materialIds.add(material.uuid)
        const maps = ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']
          .filter((key) => {
            const texture = (material as unknown as Record<string, unknown>)[key]
            if (texture instanceof THREE.Texture) textureIds.add(texture.uuid)
            return texture instanceof THREE.Texture
          })
        const mapInfo = maps.length ? `texturas: ${maps.join(', ')}` : 'sem mapas de textura reconhecidos'
        const color = 'color' in material && (material as THREE.Material & { color?: THREE.Color }).color
        return `${material.name || 'material sem nome'} [${material.type}; ${mapInfo}; cor: ${color ? '#' + color.getHexString() : 'n/a'}]`
      }).join(' | ')
    }
    rows.push({
      id: node.uuid,
      name: node.name || '(sem nome)',
      type: node.type,
      depth,
      meshInfo,
      materials: materialsText,
    })
  })
  const clips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
  modelDiagnostics.value = rows
  diagnosticSummary.value = {
    nodes: rows.length,
    meshes,
    skinned,
    materials: materialIds.size,
    textures: textureIds.size,
    clips: clips.length,
  }
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

function createImportBehaviorPackageDraft(definition: BehaviorPackageDefinition): ImportBehaviorPackageDraft {
  const variables = Object.fromEntries(definition.variables.map(variable => [variable.name, variable.defaultValue])) as Record<string, PackageScalar>
  const config = clonePackageJsonRecord(definition.defaultConfig)
  if (definition.id === 'mount') {
    const defaults = config.controlBindings && typeof config.controlBindings === 'object' && !Array.isArray(config.controlBindings)
      ? config.controlBindings as Record<string, PackageJsonValue>
      : {}
    config.controlBindings = { ...defaults, ...controlBindings.value } as Record<string, PackageJsonValue>
    config.interactionKey = controlBindings.value.interact
  }
  return { variables, config }
}

function ensureImportBehaviorPackageDraft(packageId: string): ImportBehaviorPackageDraft {
  const definition = BEHAVIOR_PACKAGE_DEFINITIONS.find(item => item.id === packageId)
  if (!definition) return { variables: {}, config: {} }
  const defaults = createImportBehaviorPackageDraft(definition)
  const existing = selectedBehaviorPackageSettings.value[packageId]
  const draft: ImportBehaviorPackageDraft = existing
    ? {
        variables: { ...defaults.variables, ...existing.variables },
        config: { ...defaults.config, ...existing.config },
      }
    : defaults

  const current = selectedBehaviorPackageSettings.value[packageId]
  const currentControls = current?.config.controlBindings
  if (definition.id === 'mount' && currentControls && typeof currentControls === 'object' && !Array.isArray(currentControls)) {
    draft.config.controlBindings = {
      ...((defaults.config.controlBindings && typeof defaults.config.controlBindings === 'object' && !Array.isArray(defaults.config.controlBindings))
        ? defaults.config.controlBindings as Record<string, PackageJsonValue>
        : {}),
      ...(currentControls as Record<string, PackageJsonValue>),
    }
  }
  selectedBehaviorPackageSettings.value = { ...selectedBehaviorPackageSettings.value, [packageId]: draft }
  return draft
}

function toggleImportBehaviorPackage(packageId: string, checked: boolean) {
  if (checked) {
    if (!selectedBehaviorPackageIds.value.includes(packageId)) {
      selectedBehaviorPackageIds.value = [...selectedBehaviorPackageIds.value, packageId]
    }
    ensureImportBehaviorPackageDraft(packageId)
    return
  }
  selectedBehaviorPackageIds.value = selectedBehaviorPackageIds.value.filter(id => id !== packageId)
}

function importPackageVariableValue(packageId: string, name: string, fallback: PackageScalar): PackageScalar {
  return selectedBehaviorPackageSettings.value[packageId]?.variables[name] ?? fallback
}

function updateImportPackageVariable(
  packageId: string,
  variable: BehaviorPackageDefinition['variables'][number],
  event: Event,
) {
  if (isReadOnlyPreview.value || variable.readOnly) return
  const target = event.target as HTMLInputElement
  let value: PackageScalar
  if (variable.type === 'boolean') {
    value = target.checked
  } else if (variable.type === 'number') {
    const raw = target.value.trim().replace(',', '.')
    const parsed = Number(raw)
    if (raw === '' || !Number.isFinite(parsed)) return
    value = Math.max(variable.min ?? Number.NEGATIVE_INFINITY, Math.min(variable.max ?? Number.POSITIVE_INFINITY, parsed))
  } else {
    value = target.value
  }
  const draft = ensureImportBehaviorPackageDraft(packageId)
  selectedBehaviorPackageSettings.value = {
    ...selectedBehaviorPackageSettings.value,
    [packageId]: { ...draft, variables: { ...draft.variables, [variable.name]: value } },
  }
}

function importPackageConfigValue(packageId: string, key: string, fallback: PackageJsonValue): PackageJsonValue {
  return selectedBehaviorPackageSettings.value[packageId]?.config[key] ?? fallback
}

function updateImportPackageConfigValue(packageId: string, key: string, value: PackageJsonValue) {
  if (isReadOnlyPreview.value) return
  const draft = ensureImportBehaviorPackageDraft(packageId)
  selectedBehaviorPackageSettings.value = {
    ...selectedBehaviorPackageSettings.value,
    [packageId]: { ...draft, config: { ...draft.config, [key]: value } },
  }
}

function isSimplePackageConfigValue(key: string, value: PackageJsonValue): boolean {
  return !['interactionKey', 'seatOffset', 'controlBindings', 'modelStates'].includes(key)
    && (typeof value === 'string' || typeof value === 'number')
}

function formatPackageConfigLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())
}

function updateImportPackageConfigScalar(packageId: string, key: string, fallback: PackageJsonValue, event: Event) {
  if (isReadOnlyPreview.value) return
  const target = event.target as HTMLInputElement
  const raw = target.value.trim()
  if (typeof fallback === 'number') {
    const parsed = Number(raw.replace(',', '.'))
    if (raw === '' || !Number.isFinite(parsed)) return
    updateImportPackageConfigValue(packageId, key, parsed)
  } else {
    updateImportPackageConfigValue(packageId, key, target.value)
  }
}

function setImportPackageInteractionKey(packageId: string, keyCode: string) {
  const draft = ensureImportBehaviorPackageDraft(packageId)
  const current = draft.config.controlBindings && typeof draft.config.controlBindings === 'object' && !Array.isArray(draft.config.controlBindings)
    ? draft.config.controlBindings as Record<string, PackageJsonValue>
    : {}
  updateImportPackageConfigValue(packageId, 'interactionKey', keyCode)
  const nextDraft = ensureImportBehaviorPackageDraft(packageId)
  selectedBehaviorPackageSettings.value = {
    ...selectedBehaviorPackageSettings.value,
    [packageId]: {
      ...nextDraft,
      config: {
        ...nextDraft.config,
        controlBindings: { ...current, interact: keyCode },
      },
    },
  }
}

function importPackageVectorValue(packageId: string, key: string, axis: 0 | 1 | 2, fallback: number): number {
  const value = importPackageConfigValue(packageId, key, [0, 0.55, 0])
  if (!Array.isArray(value)) return fallback
  const parsed = Number(value[axis])
  return Number.isFinite(parsed) ? parsed : fallback
}

function setImportPackageVector(packageId: string, key: string, axis: 0 | 1 | 2, event: Event) {
  if (isReadOnlyPreview.value) return
  const target = event.target as HTMLInputElement
  const parsed = Number(target.value.trim().replace(',', '.'))
  if (!Number.isFinite(parsed)) return
  const value = importPackageConfigValue(packageId, key, [0, 0.55, 0])
  const vector: [number, number, number] = Array.isArray(value) && value.length === 3
    ? [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
    : [0, 0.55, 0]
  vector[axis] = Math.max(-10, Math.min(10, parsed))
  updateImportPackageConfigValue(packageId, key, vector)
}

function importPackageControlBindingValue(packageId: string, key: keyof ModelControlBindings): string {
  const value = importPackageConfigValue(packageId, 'controlBindings', {})
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = (value as Record<string, PackageJsonValue>)[key]
    if (typeof item === 'string' && item) return item
  }
  return DEFAULT_MODEL_CONTROL_BINDINGS[key]
}

function setImportPackageControlBinding(packageId: string, key: keyof ModelControlBindings, event: Event) {
  if (isReadOnlyPreview.value) return
  const value = (event.target as HTMLInputElement).value.trim()
  if (!value) return
  const current = importPackageConfigValue(packageId, 'controlBindings', {})
  const bindings = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, PackageJsonValue>
    : {}
  updateImportPackageConfigValue(packageId, 'controlBindings', { ...bindings, [key]: value })
  if (key === 'interact') updateImportPackageConfigValue(packageId, 'interactionKey', value)
}

function getPreviewModelNodePath(node: THREE.Object3D, rootOverride?: THREE.Object3D): string {
  const root = rootOverride ?? model.value
  if (!root) return ''
  const segments: string[] = []
  let current: THREE.Object3D | null = node
  while (current && current !== root) {
    const label = current.name.trim() || current.type
    const parent: THREE.Object3D | null = current.parent
    const siblings = parent?.children.filter(sibling => (sibling.name.trim() || sibling.type) === label) ?? []
    const duplicateIndex = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0
    segments.unshift(duplicateIndex > 0 ? label + '#' + duplicateIndex : label)
    current = parent
  }
  if (current !== root) return ''
  // Prefixo versionado: o nome da raiz do GLB pode mudar quando o importador
  // conserva os bytes originais. A versão 2 identifica caminhos relativos à raiz visual.
  return ['@v2', 'ImportedVisualPivot', ...segments].join('/')
}

function importPackageModelStates(packageId: string): ImportModelStateDraft[] {
  const raw = importPackageConfigValue(packageId, 'modelStates', [])
  if (!Array.isArray(raw)) return []
  const states: ImportModelStateDraft[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, PackageJsonValue>
    const value = record.value
    if (typeof record.id !== 'string' || typeof record.nodePath !== 'string' || !record.nodePath
      || typeof record.variable !== 'string' || !record.variable
      || (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string')) continue
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

function writeImportPackageModelStates(packageId: string, states: ImportModelStateDraft[]) {
  updateImportPackageConfigValue(packageId, 'modelStates', states.map(state => ({
    id: state.id,
    nodePath: state.nodePath,
    variable: state.variable,
    operator: state.operator,
    value: state.value,
    visibleWhenMatched: state.visibleWhenMatched,
  })) as unknown as PackageJsonValue)
}

function addImportPackageModelState(packageId: string) {
  if (isReadOnlyPreview.value || !previewPackageModelNodes.value.length) return
  const definition = BEHAVIOR_PACKAGE_DEFINITIONS.find(item => item.id === packageId)
  if (!definition) return
  const variable = definition.variables.find(item => item.name === 'mounted') ?? definition.variables[0]
  if (!variable) return
  const node = previewPackageModelNodes.value[0]!
  const state: ImportModelStateDraft = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'mount-state-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
    nodePath: node.path,
    variable: variable.name,
    operator: 'equals',
    value: variable.name === 'mounted' ? true : variable.defaultValue,
    visibleWhenMatched: true,
  }
  writeImportPackageModelStates(packageId, [...importPackageModelStates(packageId), state])
}

function updateImportPackageModelState(packageId: string, stateId: string, patch: Partial<ImportModelStateDraft>) {
  writeImportPackageModelStates(packageId, importPackageModelStates(packageId).map(state =>
    state.id === stateId ? { ...state, ...patch } : state,
  ))
}

function onImportPackageModelStateValueChange(packageId: string, stateId: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const trimmed = raw.trim()
  const value: PackageScalar = trimmed === 'true' ? true
    : trimmed === 'false' ? false
      : trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw
  updateImportPackageModelState(packageId, stateId, { value })
}

function removeImportPackageModelState(packageId: string, stateId: string) {
  writeImportPackageModelStates(packageId, importPackageModelStates(packageId).filter(state => state.id !== stateId))
}

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
  clearPreviewAnimationController()
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
    scene?.remove(model.value)
    releaseStaticMeshCollider(model.value)
    const recoveredTextures = model.value.userData.importRecoveredTextures as THREE.Texture[] | undefined
    recoveredTextures?.forEach(texture => texture.dispose())
    const ownedUrls = new Set<string>()
    model.value.traverse(node => {
      const url = node.userData.importOwnedObjectUrl
      if (typeof url === 'string') ownedUrls.add(url)
      const packageUrls = node.userData.importOwnedObjectUrls
      if (Array.isArray(packageUrls)) {
        for (const packageUrl of packageUrls) {
          if (typeof packageUrl === 'string') ownedUrls.add(packageUrl)
        }
      }
    })
    ownedUrls.forEach(url => URL.revokeObjectURL(url))
    disposeModel(model.value)
  }
  model.value = null
  if (colliderPreview) { scene?.remove(colliderPreview); colliderPreview.geometry.dispose(); (colliderPreview.material as THREE.Material).dispose(); colliderPreview = null }
  textureRepairSelections.value = {}
  textureRepairMessage.value = ''
  refreshModelDiagnostics()
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
  currentObjectUrl = ''
}

function disposePreview() {
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  resizeObserver = null
  controls?.dispose()
  controls = null
  clearLoadedModel()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
}

function fitCamera(object: THREE.Object3D) {
  if (!scene || !camera || !controls) return
  const bounds = new THREE.Box3().setFromObject(object)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  controls.target.copy(center)
  const span = Math.max(size.x, size.y, size.z, 0.1)
  camera.position.set(center.x + span * 1.7, center.y + span * 1.15, center.z + span * 2.1)
  camera.near = Math.max(0.01, span / 1000)
  camera.far = Math.max(100, span * 100)
  camera.updateProjectionMatrix()
  controls.update()
}

function initPreview() {
  if (!canvas.value || renderer) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#20232a')
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(canvas.value.clientWidth, canvas.value.clientHeight, false)
  scene.add(new THREE.HemisphereLight(0xe4edff, 0x55515a, 2))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(4, 8, 6)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9dbaff, 0.8)
  fill.position.set(-5, 3, -4)
  scene.add(fill)
  const grid = new THREE.GridHelper(20, 20, 0x858b98, 0x454a55)
  grid.position.y = -0.002
  scene.add(grid)
  controls = new OrbitControls(camera, canvas.value)
  controls.enableDamping = true
  resizeObserver = new ResizeObserver(() => {
    if (!canvas.value || !renderer || !camera) return
    const w = Math.max(1, canvas.value.clientWidth)
    const h = Math.max(1, canvas.value.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(canvas.value)
  const animate = () => {
    frame = requestAnimationFrame(animate)
    controls?.update()
    if (previewPlaying.value) previewAnimationController?.update(Math.min(previewClock.getDelta(), 0.1))
    if (scene && camera && renderer) renderer.render(scene, camera)
  }
  animate()
  if (model.value) {
    scene.add(model.value)
    fitCamera(model.value)
  }
}

function centerAndMeasure(object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) throw new Error('O arquivo não contém uma malha 3D visível.')
  const size = bounds.getSize(new THREE.Vector3())
  if (![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x, size.y, size.z) <= 0) {
    throw new Error('Não foi possível calcular o tamanho deste modelo.')
  }
  dimensions.value = [size.x, size.y, size.z]
  originalHeight.value = size.y
  // Guarde o centro em coordenadas do modelo. A correção de posição precisa
  // ser aplicada depois da escala; alterar position antes da escala deixa o
  // deslocamento enorme em assets cujas coordenadas originais são muito grandes.
  const center = bounds.getCenter(new THREE.Vector3())
  object.userData.importCenter = center.toArray()
  return size.y
}

async function parseFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'glb' && ext !== 'gltf') {
    return await loadAssetFile(file)
  }
  const buffer = await file.arrayBuffer()
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader()
    const url = URL.createObjectURL(file)
    currentObjectUrl = url
    return await new Promise<THREE.Object3D>((resolve, reject) => {
      loader.parse(buffer, url.substring(0, url.lastIndexOf('/') + 1), gltf => {
        // GLTFLoader mantém as animações separadas da hierarquia da cena; guarde-as
        // no root para transferi-las junto com o modelo ao confirmar a importação.
        gltf.scene.userData.importAnimations = gltf.animations ?? []
        if (ext === 'glb') gltf.scene.userData.importSourceGlbBytes = buffer.slice(0)
        // Preserve metadata from the original glTF JSON so we can distinguish
        // an embedded image from a texture actually assigned to baseColorTexture.
        gltf.scene.userData.importGltfMetadata = {
          images: (gltf.parser.json.images ?? []).map((image: { name?: string; mimeType?: string; uri?: string; bufferView?: number }, index: number) => ({
            index,
            name: image.name ?? '',
            mimeType: image.mimeType ?? '',
            uri: image.uri ?? '',
            bufferView: image.bufferView ?? null,
          })),
          textures: (gltf.parser.json.textures ?? []).map((texture: { name?: string; source?: number }, index: number) => ({
            index,
            name: texture.name ?? '',
            source: texture.source ?? null,
          })),
          materials: (gltf.parser.json.materials ?? []).map((material: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index?: number }; baseColorFactor?: number[] }; normalTexture?: { index?: number }; occlusionTexture?: { index?: number }; emissiveTexture?: { index?: number } }, index: number) => ({
            index,
            name: material.name ?? '',
            baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
            normalTexture: material.normalTexture?.index ?? null,
            occlusionTexture: material.occlusionTexture?.index ?? null,
            emissiveTexture: material.emissiveTexture?.index ?? null,
            baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
          })),
          animations: (gltf.parser.json.animations ?? []).map((clip: { name?: string; channels?: unknown[] }, index: number) => ({
            index,
            name: clip.name ?? '',
            channels: clip.channels?.length ?? 0,
          })),
        }
        resolve(gltf.scene)
      }, reject)
    })
  }
  throw new Error('Não foi possível interpretar o arquivo GLB/glTF.')
}

async function showLoadedModel(loaded: THREE.Object3D, displayName: string, targetHeight = 2, preserveRetargetSource = false) {
  clearLoadedModel(preserveRetargetSource)
  colliderType.value = 'box'
  colliderOffset.value = [0, 0, 0]
  loaded.name = displayName.replace(/\.[^.]+$/, '') || 'Modelo importado'
  componentName.value = loaded.name
  partSearch.value = ''
  const height = centerAndMeasure(loaded)
  colliderType.value = shouldDefaultToStaticCityCollider(loaded) ? 'mesh' : 'box'
  const safeTargetHeight = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : 2
  const initialScale = safeTargetHeight / height
  loaded.scale.setScalar(initialScale)
  const center = new THREE.Vector3().fromArray(loaded.userData.importCenter as [number, number, number])
  loaded.position.set(-center.x * initialScale, -center.y * initialScale, -center.z * initialScale)
  restoreModelRenderableMeshes(loaded)
  modelHeight.value = safeTargetHeight
  colliderSize.value = [Math.max(0.05, dimensions.value[0] * safeTargetHeight / height), safeTargetHeight, Math.max(0.05, dimensions.value[2] * safeTargetHeight / height)]
  controlBindings.value = normalizeControlBindings(loaded.userData.importControlBindings)
  loaded.userData.importControlBindings = { ...controlBindings.value }
  model.value = loaded
  retargetRestPoseByModel.set(loaded, captureRetargetRestPose(loaded))
  refreshPreviewParts()
  refreshModelDiagnostics()
  const clips = loaded.userData.importAnimations as THREE.AnimationClip[] | undefined
  animationClipRevision.value += 1
  rigBones.value = []
  rigRestPose.value = {}
  selectedRigBoneName.value = ''
  rigKeyframes.value = []
  rigFrameTime.value = 0
  rigDuration.value = 1
  rigMessage.value = ''
  const savedRoles = loaded.userData.importAnimationRoles as Record<string, AnimationRole> | undefined
  const nextRoles: Record<string, AnimationRole> = {}
  ;(clips ?? []).forEach((clip, index) => {
    const savedRole = savedRoles?.[String(index)]
    const guessed = guessedAnimationRole(clip.name)
    const guessedIsDiagonal = ['walk_diagonal_left', 'walk_diagonal_right', 'run_diagonal_left', 'run_diagonal_right'].includes(guessed)
    const recognizedRoles: AnimationRole[] = animationRoleBaseOptions.map(option => option.value)
    // Atualiza classificações automáticas antigas que guardaram um papel genérico.
    nextRoles[String(index)] = savedRole && recognizedRoles.includes(savedRole) && !(guessedIsDiagonal && ['ignore', 'walk', 'run'].includes(savedRole))
      ? savedRole
      : guessed
  })
  animationRoles.value = nextRoles
  loaded.userData.importAnimationRoles = { ...nextRoles }
  previewAnimationIndex.value = 0
  previewPlaying.value = true
  if (clips?.length) {
    const controller = ensurePreviewAnimationController(loaded, clips)
    controller.setState(previewRoleForClip(clips[0]!))
    previewClock.start()
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  initPreview()
  if (!scene) throw new Error('Não foi possível iniciar a pré-visualização 3D.')
  scene.add(loaded)
  fitCamera(loaded)
  updateColliderPreview()
  // Se o modelo B foi escolhido primeiro, importar o modelo A não deve apagar
  // a origem salva. Leva o usuário de volta ao painel de retargeting após carregar A.
  if (preserveRetargetSource && (retargetSourceRoot.value || selectedRetargetLibraryId.value)) {
    activeSetupTab.value = 'rigging'
  }
}

async function parseGlbBytes(bytes: ArrayBuffer, manager?: THREE.LoadingManager): Promise<THREE.Object3D> {
  const loader = new GLTFLoader(manager ?? new THREE.LoadingManager())
  return await new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(bytes, '', (gltf) => {
      gltf.scene.userData.importAnimations = gltf.animations ?? []
      gltf.scene.userData.importGltfMetadata = {
        images: (gltf.parser.json.images ?? []).map((image: { name?: string; mimeType?: string; uri?: string; bufferView?: number }, index: number) => ({
          index, name: image.name ?? '', mimeType: image.mimeType ?? '', uri: image.uri ?? '', bufferView: image.bufferView ?? null,
        })),
        textures: (gltf.parser.json.textures ?? []).map((texture: { name?: string; source?: number }, index: number) => ({
          index, name: texture.name ?? '', source: texture.source ?? null,
        })),
        materials: (gltf.parser.json.materials ?? []).map((material: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index?: number }; baseColorFactor?: number[] }; normalTexture?: { index?: number }; occlusionTexture?: { index?: number }; emissiveTexture?: { index?: number } }, index: number) => ({
          index, name: material.name ?? '',
          baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
          normalTexture: material.normalTexture?.index ?? null,
          occlusionTexture: material.occlusionTexture?.index ?? null,
          emissiveTexture: material.emissiveTexture?.index ?? null,
          baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
        })),
        animations: (gltf.parser.json.animations ?? []).map((clip: { name?: string; channels?: unknown[] }, index: number) => ({
          index, name: clip.name ?? '', channels: clip.channels?.length ?? 0,
        })),
      }
      resolve(gltf.scene)
    }, reject)
  })
}

function encodeArrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)))
  }
  return btoa(binary)
}

function decodeBase64ArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

type ZipModelBundle = {
  primary_path: string
  files: Array<{ path: string; base64: string }>
}

type ZipImportContext = AssetImportPackageContext & {
  objectUrls: string[]
}

function normalizeZipPath(value: string): string {
  let decoded = value.replace(/\\/g, '/')
  try { decoded = decodeURIComponent(decoded) } catch { /* Mantém o caminho original se houver escapes inválidos. */ }
  const parts: string[] = []
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/').toLocaleLowerCase()
}

function zipDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index + 1) : ''
}

function zipMimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'gltf': case 'json': return 'model/gltf+json'
    case 'glb': return 'model/gltf-binary'
    case 'fbx': return 'application/octet-stream'
    case 'obj': return 'text/plain'
    case 'mtl': return 'text/plain'
    case 'dae': return 'model/vnd.collada+xml'
    case 'bin': return 'application/octet-stream'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}

/** Cria URLs virtuais para os arquivos do pacote, mantendo seus caminhos relativos. */
function createZipImportContext(bundle: ZipModelBundle): { primaryFile: File; context: ZipImportContext } {
  const files: AssetPackageFile[] = bundle.files.map(entry => {
    const bytes = decodeBase64ArrayBuffer(entry.base64)
    const fileName = entry.path.replace(/\\/g, '/').split('/').pop() || 'recurso.bin'
    return {
      path: entry.path.replace(/\\/g, '/'),
      file: new File([bytes], fileName, { type: zipMimeType(entry.path) }),
    }
  })
  const primaryKey = normalizeZipPath(bundle.primary_path)
  const primaryEntry = files.find(entry => normalizeZipPath(entry.path) === primaryKey)
  if (!primaryEntry) throw new Error('O pacote ZIP não contém os dados do modelo principal indicado pelo importador.')

  const urls: string[] = []
  const urlsByPath = new Map<string, string>()
  const urlsByBasename = new Map<string, string[]>()
  for (const entry of files) {
    const url = URL.createObjectURL(entry.file)
    urls.push(url)
    urlsByPath.set(normalizeZipPath(entry.path), url)
    const basename = normalizeZipPath(entry.path.split('/').pop() || entry.path)
    const matching = urlsByBasename.get(basename) ?? []
    matching.push(url)
    urlsByBasename.set(basename, matching)
  }

  const baseDirectory = zipDirectory(bundle.primary_path)
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((rawUrl: string) => {
    if (/^(data:|blob:|https?:|file:)/i.test(rawUrl)) return rawUrl
    const withoutQuery = rawUrl.split(/[?#]/, 1)[0] ?? rawUrl
    const candidates = [
      normalizeZipPath(withoutQuery),
      normalizeZipPath(baseDirectory + withoutQuery),
    ]
    for (const candidate of candidates) {
      const match = urlsByPath.get(candidate)
      if (match) return match
    }
    const basename = normalizeZipPath(withoutQuery.split(/[\\/]/).pop() || withoutQuery)
    const byName = urlsByBasename.get(basename)
    if (byName?.length === 1) return byName[0]!
    return rawUrl
  })

  return {
    primaryFile: primaryEntry.file,
    context: { primaryPath: bundle.primary_path, files, manager, objectUrls: urls },
  }
}


async function chooseSkinTokensExecutable() {
  if (!isTauri()) {
    skinTokensMessage.value = 'O backend local exige o aplicativo desktop Tauri; não pode ser executado na prévia do navegador.'
    return
  }
  try {
    const selected = await openNativeDialog({
      multiple: false,
      directory: false,
      title: 'Selecionar executável local SkinTokens',
      filters: [{ name: 'Executável SkinTokens', extensions: ['exe'] }],
    })
    if (typeof selected === 'string' && selected) {
      skinTokensExecutablePath.value = selected
      skinTokensMessage.value = 'Executável selecionado. Clique em “Testar backend local” para verificar o modelo e o checkpoint.'
    }
  } catch (cause) {
    skinTokensMessage.value = cause instanceof Error ? cause.message : 'Não foi possível selecionar o executável.'
  }
}

async function testSkinTokensBackend() {
  if (!isTauri()) {
    skinTokensMessage.value = 'O backend local exige o aplicativo desktop Tauri.'
    return
  }
  if (!skinTokensExecutablePath.value.trim()) {
    skinTokensMessage.value = 'Instale o backend gratuito e selecione o executável skintokens.exe.'
    return
  }
  skinTokensLoading.value = true
  skinTokensMessage.value = 'Verificando o executável e o checkpoint local...'
  try {
    const result = await invoke<string>('skintokens_doctor', { executablePath: skinTokensExecutablePath.value.trim() })
    skinTokensMessage.value = 'Backend local disponível. ' + result
  } catch (cause) {
    skinTokensMessage.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    skinTokensLoading.value = false
  }
}

async function runSkinTokensRigging() {
  await performSkinTokensRigging(false)
}

async function performSkinTokensRigging(preserveRetargetSource: boolean) {
  const root = model.value
  if (!root || skinTokensLoading.value) return
  if (!isTauri()) {
    skinTokensMessage.value = 'Abra o Engine Prometheus como aplicativo desktop Tauri para executar IA local.'
    return
  }
  if (!skinTokensExecutablePath.value.trim()) {
    skinTokensMessage.value = 'Instale o backend gratuito usando scripts/install-skintokens.ps1 e informe o caminho de skintokens.exe.'
    return
  }
  if (!skinTokensRigCompatible.value) {
    skinTokensMessage.value = skinTokensOperation.value === 'rig'
      ? 'Para gerar um rig novo, importe um modelo sem malha esquelética. Se o modelo já tiver rig, selecione “Melhorar pesos do rig atual”.'
      : 'A operação de pesos exige um modelo que já tenha pelo menos uma malha SkinnedMesh com esqueleto.'
    return
  }

  skinTokensLoading.value = true
  skinTokensMessage.value = 'Preparando o GLB e executando SkinTokens localmente. A primeira execução pode demorar; o arquivo não é enviado para um serviço remoto.'
  try {
    const operation = skinTokensOperation.value
    const sourceClips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    const sourceRolesByName = new Map<string, AnimationRole>()
    sourceClips.forEach((clip, index) => {
      const role = animationRoles.value[String(index)]
      if (role) sourceRolesByName.set(clip.name, role)
    })
    const preservedControls = { ...controlBindings.value }
    const preservedColliderType = colliderType.value
    const preservedColliderSize = [...colliderSize.value] as [number, number, number]
    const preservedColliderOffset = [...colliderOffset.value] as [number, number, number]
    const preservedComponentName = componentName.value
    let inputGlb: ArrayBuffer
    const originalGlb = root.userData.importSourceGlbBytes
    if (originalGlb instanceof ArrayBuffer && root.userData.importNeedsReexport !== true) {
      // Para importações GLB intactas, reutiliza o arquivo binário original e
      // evita perder extensões, texturas compactadas ou metadados no exportador Three.js.
      inputGlb = originalGlb.slice(0)
    } else {
      const exportRoot = cloneSkinnedModel(root)
      exportRoot.userData = { ...exportRoot.userData }
      for (const key of [
        'importAnimations', 'importGltfMetadata', 'importRecoveredTextures',
        'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl',
        'importAnimationRoles', 'importControlBindings', 'importColliderType',
        'importColliderSize', 'importColliderOffset', 'importRigPreset',
        'importRigGenerated', 'importRigBoneNames', 'importSourceGlbBytes',
        'importNeedsReexport',
      ]) delete exportRoot.userData[key]
      exportRoot.updateMatrixWorld(true)
      const exporter = new GLTFExporter()
      const exported = await exporter.parseAsync(exportRoot, { binary: true, animations: sourceClips })
      if (!(exported instanceof ArrayBuffer)) throw new Error('Não foi possível exportar o modelo para GLB.')
      inputGlb = exported
    }
    if (inputGlb.byteLength > 300 * 1024 * 1024) throw new Error('O GLB excede o limite de 300 MB para processamento local.')

    const outputBase64 = await invoke<string>('run_skintokens_glb', {
      executablePath: skinTokensExecutablePath.value.trim(),
      glbBase64: encodeArrayBufferBase64(inputGlb),
      operation,
      modelClass: skinTokensResolvedClass.value,
    })
    const outputBytes = decodeBase64ArrayBuffer(outputBase64)
    const loaded = await parseGlbBytes(outputBytes)
    const displayName = fileName.value || root.name || 'Modelo com rig de IA'
    const targetHeight = Math.max(0.1, modelHeight.value)
    let detectedBones: THREE.Bone[] = []
    let generatedPreset: AutoRigPreset = skinTokensResolvedClass.value === 'humanoid'
      ? 'humanoid'
      : skinTokensResolvedClass.value === 'quadruped' ? 'quadruped' : 'ai'

    if (operation === 'rig') {
      loaded.userData.importRigGenerated = true
      loaded.userData.importRigPreset = generatedPreset
    }
    loaded.userData.importNeedsReexport = true
    loaded.traverse(node => {
      if (!(node instanceof THREE.Bone)) return
      if (operation === 'rig') {
        node.userData.generatedRigBone = true
        node.userData.generatedRigPreset = generatedPreset
      }
      detectedBones.push(node)
    })
    if (!detectedBones.length) throw new Error('O resultado da IA não contém ossos reconhecíveis. Confira o relatório/diagnóstico do SkinTokens e tente novamente.')

    await showLoadedModel(loaded, displayName, targetHeight, preserveRetargetSource)
    // Preserve configurações do importador que não fazem parte do arquivo GLB original.
    componentName.value = preservedComponentName || loaded.name
    controlBindings.value = preservedControls
    colliderType.value = preservedColliderType
    colliderSize.value = preservedColliderSize
    colliderOffset.value = preservedColliderOffset
    loaded.userData.importControlBindings = { ...preservedControls }
    loaded.userData.importColliderType = colliderType.value
    loaded.userData.importColliderSize = [...colliderSize.value]
    loaded.userData.importColliderOffset = [...colliderOffset.value]
    const outputClips = (loaded.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    const outputRoles: Record<string, AnimationRole> = {}
    outputClips.forEach((clip, index) => {
      outputRoles[String(index)] = sourceRolesByName.get(clip.name) ?? guessedAnimationRole(clip.name)
    })
    animationRoles.value = outputRoles
    loaded.userData.importAnimationRoles = { ...outputRoles }
    animationClipRevision.value += 1
    // Também disponibiliza os ossos preservados na operação de pesos, sem marcá-los
    // como rig gerado nem liberar o reposicionamento de juntas de um esqueleto existente.
    rigBones.value = detectedBones
    selectedRigBoneName.value = detectedBones[0]?.name ?? ''
    rigRestPose.value = captureRigPose(detectedBones)
    rigKeyframes.value = []
    rigFrameTime.value = 0
    rigDuration.value = 1
    if (operation === 'rig') {
      rigPreset.value = generatedPreset
      rigMessage.value = 'Rig criado pela IA local. Revise a posição dos ossos e teste a deformação antes de criar animações.'
    } else {
      rigMessage.value = 'Os pesos foram recalculados pela IA. O esqueleto existente foi preservado; a posição das juntas permanece bloqueada para evitar alteração acidental do rig original.'
    }
    refreshRigHelper()
    skinTokensMessage.value = operation === 'rig'
      ? 'Rig por IA concluído: ' + detectedBones.length + ' ossos. O modelo agora está na prévia; confira juntas, pesos e pose antes de salvar.'
      : 'Pesos de deformação recalculados pela IA local. O esqueleto do modelo foi preservado; confira as deformações antes de salvar.'
  } catch (cause) {
    skinTokensMessage.value = cause instanceof Error ? cause.message : 'O processamento de IA local falhou.'
  } finally {
    skinTokensLoading.value = false
  }
}

async function importBlendZip() {
  loading.value = true
  error.value = ''
  let zipContext: ZipImportContext | null = null
  let importedSuccessfully = false
  try {
    // A seleção nativa e a leitura segura do ZIP são fornecidas pelo app desktop Tauri.
    if (!isTauri()) {
      error.value = 'A importação por ZIP requer o aplicativo desktop Tauri. Execute `npm run tauri dev` e abra o Engine Prometheus pela janela do aplicativo.'
      return
    }
    const selected = await openNativeDialog({
      multiple: false,
      directory: false,
      title: 'Selecionar pacote ZIP com modelo 3D, materiais e texturas',
      filters: [{ name: 'Pacote de modelo 3D', extensions: ['zip'] }],
    })
    if (!selected || Array.isArray(selected)) return
    fileName.value = selected.split(/[\\/]/).pop() || 'Modelo 3D.zip'

    const bundle = await invoke<ZipModelBundle>('load_model_zip', { zipPath: selected })
    const packageData = createZipImportContext(bundle)
    zipContext = packageData.context
    const primaryFile = packageData.primaryFile
    const extension = primaryFile.name.split('.').pop()?.toLowerCase()
    let loaded: THREE.Object3D

    if (extension === 'glb') {
      loaded = await parseGlbBytes(await primaryFile.arrayBuffer(), zipContext.manager)
    } else if (extension === 'gltf') {
      const loader = new GLTFLoader(zipContext.manager)
      const jsonText = await primaryFile.text()
      loaded = await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.parse(jsonText, '', (gltf) => {
          gltf.scene.userData.importAnimations = gltf.animations ?? []
          gltf.scene.userData.importGltfMetadata = {
            images: (gltf.parser.json.images ?? []).map((image: { name?: string; mimeType?: string; uri?: string; bufferView?: number }, index: number) => ({
              index, name: image.name ?? '', mimeType: image.mimeType ?? '', uri: image.uri ?? '', bufferView: image.bufferView ?? null,
            })),
            textures: (gltf.parser.json.textures ?? []).map((texture: { name?: string; source?: number }, index: number) => ({
              index, name: texture.name ?? '', source: texture.source ?? null,
            })),
            materials: (gltf.parser.json.materials ?? []).map((material: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index?: number }; baseColorFactor?: number[] }; normalTexture?: { index?: number }; occlusionTexture?: { index?: number }; emissiveTexture?: { index?: number } }, index: number) => ({
              index, name: material.name ?? '',
              baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
              normalTexture: material.normalTexture?.index ?? null,
              occlusionTexture: material.occlusionTexture?.index ?? null,
              emissiveTexture: material.emissiveTexture?.index ?? null,
              baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
            })),
            animations: (gltf.parser.json.animations ?? []).map((clip: { name?: string; channels?: unknown[] }, index: number) => ({
              index, name: clip.name ?? '', channels: clip.channels?.length ?? 0,
            })),
          }
          resolve(gltf.scene)
        }, reject)
      })
    } else {
      loaded = await loadAssetFile(primaryFile, zipContext)
    }

    await showLoadedModel(
      loaded,
      bundle.primary_path.replace(/\\/g, '/').split('/').pop() || primaryFile.name,
      2,
      Boolean(retargetSourceRoot.value || selectedRetargetLibraryId.value),
    )
    loaded.userData.importOwnedObjectUrls = zipContext.objectUrls
    importedSuccessfully = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause || 'Falha ao importar o modelo do ZIP.')
    fileName.value = ''
    clearLoadedModel()
  } finally {
    if (!importedSuccessfully) zipContext?.objectUrls.forEach(url => URL.revokeObjectURL(url))
    loading.value = false
  }
}
async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  loading.value = true
  error.value = ''
  fileName.value = file.name
  try {
    const loaded = await parseFile(file)
    await showLoadedModel(loaded, file.name, 2, Boolean(retargetSourceRoot.value || selectedRetargetLibraryId.value))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Falha ao ler o modelo.'
    fileName.value = ''
    clearLoadedModel()
  } finally {
    loading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

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
        const restoreStaticCityCollider = Boolean(model.value && shouldDefaultToStaticCityCollider(model.value))
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

function loadRetargetAnimationLibrary() {
  try {
    const raw = window.localStorage.getItem(RETARGET_ANIMATION_LIBRARY_KEY)
    if (!raw) {
      retargetLibrary.value = []
      return
    }
    const parsed: unknown = JSON.parse(raw)
    retargetLibrary.value = Array.isArray(parsed)
      ? parsed.filter((item): item is ReusableAnimationAsset => Boolean(
        item && typeof item === 'object'
        && typeof (item as ReusableAnimationAsset).id === 'string'
        && typeof (item as ReusableAnimationAsset).name === 'string'
        && typeof (item as ReusableAnimationAsset).sourceName === 'string'
        && (item as ReusableAnimationAsset).clipJson
        && typeof (item as ReusableAnimationAsset).clipJson === 'object'
        && Array.isArray((item as ReusableAnimationAsset).sourceNodeNames)
        && (item as ReusableAnimationAsset).sourcePose
        && typeof (item as ReusableAnimationAsset).sourcePose === 'object',
      ))
      : []
  } catch (cause) {
    console.warn('[AnimationRetargeting] Não foi possível ler a biblioteca local.', cause)
    retargetLibrary.value = []
  }
}

function persistRetargetAnimationLibrary() {
  try {
    window.localStorage.setItem(RETARGET_ANIMATION_LIBRARY_KEY, JSON.stringify(retargetLibrary.value))
    return true
  } catch (cause) {
    console.warn('[AnimationRetargeting] Não foi possível salvar a biblioteca local.', cause)
    retargetMessage.value = 'Não foi possível guardar a animação. A biblioteca local pode estar sem espaço.'
    return false
  }
}

function clearRetargetSource() {
  const previous = retargetSourceRoot.value
  retargetSourceRoot.value = null
  retargetSourceBytes.value = null
  selectedSavedAnimationSourceId.value = ''
  if (previous) disposeModel(previous)
  retargetSourceFileName.value = ''
  retargetSourceClipIndex.value = 0
  selectedRetargetLibraryId.value = ''
  selectedRetargetLibraryClip.value = null
  retargetBoneMap.value = {}
  retargetCollapsedSourceNames.value = []
  retargetClipName.value = ''
}

async function chooseRetargetAnimationSource(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  retargetLoading.value = true
  retargetMessage.value = ''
  error.value = ''
  try {
    if (!file.name.toLowerCase().endsWith('.glb')) {
      throw new Error('Escolha um arquivo GLB com animações incorporadas.')
    }
    const sourceBytes = await file.arrayBuffer()
    const loaded = await parseGlbBytes(sourceBytes)
    loaded.userData.importSourceGlbBytes = sourceBytes.slice(0)
    loaded.updateWorldMatrix(true, true)
    const clips = (loaded.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    if (clips.length === 0) {
      disposeModel(loaded)
      throw new Error('Esse GLB não contém clipes de animação. Escolha um modelo animado.')
    }
    // Importar o modelo B como origem de animação não pode remover nem deixar
    // invisível o modelo A, que continua sendo o destino do retargeting.
    const targetBeforeSourceLoad = model.value
    if (targetBeforeSourceLoad) {
      restorePreviewVisibility()
      restoreModelRenderableMeshes(targetBeforeSourceLoad)
      if (scene && targetBeforeSourceLoad.parent !== scene) scene.add(targetBeforeSourceLoad)
      targetBeforeSourceLoad.updateMatrixWorld(true)
      if (targetBeforeSourceLoad.parent === scene) fitCamera(targetBeforeSourceLoad)
      updateColliderPreview()
    }

    clearRetargetSource()
    retargetSourceRoot.value = loaded
    retargetSourceBytes.value = sourceBytes.slice(0)
    retargetSourceFileName.value = file.name
    retargetSourceClipIndex.value = 0
    retargetClipName.value = clips[0]?.name?.trim() || file.name.replace(/\.glb$/i, '')
    retargetMessage.value = `Origem carregada: ${clips.length} animação(ões). O modelo A foi mantido como destino. Faça o mapeamento para o rig de destino e aplique.`
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível abrir o modelo de animação.'
  } finally {
    retargetLoading.value = false
    if (retargetFileInput.value) retargetFileInput.value.value = ''
  }
}

function selectSavedAnimationSource(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  if (id) emit('load-animation-source', id)
}

function saveRetargetSourceToLibrary() {
  const root = retargetSourceRoot.value
  const bytes = retargetSourceBytes.value
    ?? (root?.userData.importSourceGlbBytes instanceof ArrayBuffer ? root.userData.importSourceGlbBytes : null)
  if (!root || !bytes || bytes.byteLength <= 20) {
    retargetMessage.value = 'Não há um GLB original disponível para salvar como fonte de animação.'
    return
  }
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  const height = bounds.isEmpty() ? 2 : Math.max(0.1, bounds.getSize(new THREE.Vector3()).y)
  const name = retargetSourceFileName.value.replace(/\\.glb$/i, '').trim() || root.name || 'Fonte de animação'
  emit('save-animation-source', { name, bytes: bytes.slice(0), height })
  retargetMessage.value = `"${name}" enviado à biblioteca de importados como fonte de animações. Ele não será inserido no mundo.`
}

async function loadSavedAnimationSource(asset: NonNullable<typeof props.animationSourceAsset>) {
  retargetLoading.value = true
  try {
    const bytes = asset.bytes.slice(0)
    const loaded = await parseGlbBytes(bytes)
    loaded.userData.importSourceGlbBytes = bytes.slice(0)
    loaded.updateWorldMatrix(true, true)
    const clips = (loaded.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    if (clips.length === 0) {
      disposeModel(loaded)
      throw new Error('Esta fonte não contém clipes de animação válidos.')
    }

    // O arquivo da biblioteca é apenas a origem (modelo B). Nunca substitui o
    // modelo A que já está aberto no importador.
    const target = model.value
    if (target) {
      restorePreviewVisibility()
      restoreModelRenderableMeshes(target)
      if (scene && target.parent !== scene) scene.add(target)
      target.updateMatrixWorld(true)
      if (target.parent === scene) fitCamera(target)
      updateColliderPreview()
    }
    clearRetargetSource()
    retargetSourceRoot.value = loaded
    retargetSourceBytes.value = bytes
    selectedSavedAnimationSourceId.value = asset.id
    retargetSourceFileName.value = asset.name + '.glb'
    retargetSourceClipIndex.value = 0
    retargetClipName.value = clips[0]?.name?.trim() || asset.name
    activeSetupTab.value = 'rigging'
    retargetMessage.value = `Fonte "${asset.name}" carregada. O modelo A permanece como destino; escolha a animação e execute o retargeting.`
    await nextTick()
    ensureRetargetPreviewStages()
    refreshRetargetSourcePreview()
    refreshRetargetTargetPreview()
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível carregar a fonte de animação.'
  } finally {
    retargetLoading.value = false
  }
}

function onRetargetSourceClipChanged() {
  const clip = retargetSourceClip.value
  if (clip) retargetClipName.value = clip.name?.trim() || 'Animação reutilizada'
  retargetMessage.value = ''
  retargetBoneMap.value = {}
}

function selectRetargetLibraryAsset(id: string) {
  selectedRetargetLibraryId.value = id
  selectedRetargetLibraryClip.value = null
  if (id) {
    const asset = retargetLibrary.value.find(item => item.id === id)
    if (!asset) {
      selectedRetargetLibraryId.value = ''
      return
    }
    try {
      selectedRetargetLibraryClip.value = parseReusableAnimationClip(asset)
      if (retargetSourceRoot.value) {
        const previous = retargetSourceRoot.value
        retargetSourceRoot.value = null
        retargetSourceBytes.value = null
        selectedSavedAnimationSourceId.value = ''
        disposeModel(previous)
      }
      retargetSourceFileName.value = ''
      retargetClipName.value = asset.name
      rigClipRole.value = asset.role
      retargetMessage.value = `Animação "${asset.name}" carregada da biblioteca. Selecione os ossos de destino e aplique-a ao modelo atual.`
    } catch (cause) {
      retargetMessage.value = cause instanceof Error ? cause.message : 'A animação salva está inválida.'
      selectedRetargetLibraryId.value = ''
      selectedRetargetLibraryClip.value = null
    }
  } else {
    selectedRetargetLibraryClip.value = null
    retargetMessage.value = retargetSourceRoot.value
      ? 'Usando a animação do arquivo GLB carregado.'
      : 'Carregue um GLB animado ou escolha uma animação da biblioteca.'
  }
  retargetBoneMap.value = {}
}

function setRetargetBoneMapping(sourceName: string, targetName: string) {
  retargetBoneMap.value = { ...retargetBoneMap.value, [sourceName]: targetName }
  // A manual assignment replaces only this row's inferred collapsed-joint rule.
  retargetCollapsedSourceNames.value = retargetCollapsedSourceNames.value.filter(name => name !== sourceName)
}

function retargetableAssetForCurrentSource(): ReusableAnimationAsset | null {
  const libraryAsset = retargetLibraryAsset.value
  if (libraryAsset) {
    return {
      ...libraryAsset,
      name: retargetClipName.value.trim() || libraryAsset.name,
      role: rigClipRole.value,
    }
  }
  const root = retargetSourceRoot.value
  const clip = retargetSourceClip.value
  if (!root || !clip) return null
  const asset = createReusableAnimationAsset(
    root,
    clip,
    retargetSourceFileName.value || root.name || 'Modelo de origem',
    rigClipRole.value,
  )
  asset.name = retargetClipName.value.trim() || asset.name
  return asset
}

type RetargetPreviewStage = {
  key: 'source' | 'target'
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  resizeObserver: ResizeObserver
  frame: number
  clock: THREE.Clock
  root: THREE.Object3D | null
  mixer: THREE.AnimationMixer | null
  /** Última posição mundial para manter o personagem dentro do enquadramento durante root motion. */
  lastRootWorldPosition: THREE.Vector3 | null
}

let retargetSourcePreviewStage: RetargetPreviewStage | null = null
let retargetTargetPreviewStage: RetargetPreviewStage | null = null

// Clones do preview precisam de geometria/material próprios para a limpeza das
// miniaturas nunca liberar recursos do modelo real que continuará no editor.
function cloneRetargetPreviewObject(source: THREE.Object3D): THREE.Object3D {
  const clone = cloneSkinnedModel(source)
  clone.updateMatrixWorld(true)
  clone.traverse(node => {
    // A prévia de peças permite ocultar/isolá-las durante a inspeção do modelo.
    // A cena de animação sempre apresenta o personagem completo.
    node.visible = true
    if (node instanceof THREE.Mesh) {
      // Evita que uma submalha deformada pela animação desapareça por bounds
      // de repouso desatualizados, principalmente nas pernas e na pelve.
      node.frustumCulled = false
      node.geometry = node.geometry.clone()
      node.material = Array.isArray(node.material)
        ? node.material.map(material => {
            const clonedMaterial = material.clone()
            clonedMaterial.visible = true
            return clonedMaterial
          })
        : node.material.clone()
      if (!Array.isArray(node.material)) node.material.visible = true
      if (node instanceof THREE.SkinnedMesh) node.skeleton.update()
    }
  })
  clone.updateMatrixWorld(true)
  return clone
}

function disposeRetargetPreviewObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points) {
      geometries.add(node.geometry)
      const list = Array.isArray(node.material) ? node.material : [node.material]
      list.forEach(material => materials.add(material))
    }
  })
  geometries.forEach(geometry => geometry.dispose())
  // Os materiais são clones; as texturas são referências compartilhadas e não
  // devem ser descartadas enquanto o modelo principal estiver aberto.
  materials.forEach(material => material.dispose())
}

function createRetargetPreviewStage(canvasElement: HTMLCanvasElement, key: 'source' | 'target'): RetargetPreviewStage {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#20232a')
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
  const renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, alpha: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(Math.max(1, canvasElement.clientWidth), Math.max(1, canvasElement.clientHeight), false)

  scene.add(new THREE.HemisphereLight(0xe4edff, 0x55515a, 2))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(4, 8, 6)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0x9dbaff, 0.75)
  fillLight.position.set(-5, 3, -4)
  scene.add(fillLight)

  const controls = new OrbitControls(camera, canvasElement)
  controls.enableDamping = true
  controls.enablePan = true
  const stage: RetargetPreviewStage = {
    key,
    renderer,
    scene,
    camera,
    controls,
    resizeObserver: new ResizeObserver(() => {
      const width = Math.max(1, canvasElement.clientWidth)
      const height = Math.max(1, canvasElement.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }),
    frame: 0,
    clock: new THREE.Clock(),
    root: null,
    mixer: null,
    lastRootWorldPosition: null,
  }
  stage.resizeObserver.observe(canvasElement)

  const renderFrame = () => {
    stage.frame = requestAnimationFrame(renderFrame)
    stage.controls.update()
    const delta = Math.min(stage.clock.getDelta(), 0.1)
    const playing = stage.key === 'source'
      ? retargetSourcePreviewPlaying.value
      : retargetTargetPreviewPlaying.value
    if (playing) stage.mixer?.update(delta)
    // Root motion pode mover todo o clone para fora da câmera fixa. Na prévia
    // do destino, deslocamos câmera e alvo pelo mesmo delta, sem alterar a
    // trajetória do modelo salvo nem mexer na visualização do clipe de origem.
    if (stage.key === 'target' && stage.root && stage.mixer && playing) {
      const currentRootWorldPosition = stage.root.getWorldPosition(new THREE.Vector3())
      if (stage.lastRootWorldPosition) {
        const followDelta = currentRootWorldPosition.clone().sub(stage.lastRootWorldPosition)
        stage.camera.position.add(followDelta)
        stage.controls.target.add(followDelta)
      }
      stage.lastRootWorldPosition = currentRootWorldPosition
    }
    stage.renderer.render(stage.scene, stage.camera)
  }
  stage.clock.start()
  renderFrame()
  return stage
}

function fitRetargetPreviewCamera(stage: RetargetPreviewStage, object: THREE.Object3D) {
  object.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) return
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const span = Math.max(size.x, size.y, size.z, 0.1)
  stage.controls.target.copy(center)
  stage.camera.position.set(center.x + span * 1.7, center.y + span * 1.1, center.z + span * 2.1)
  stage.camera.near = Math.max(0.01, span / 1000)
  stage.camera.far = Math.max(100, span * 100)
  stage.camera.updateProjectionMatrix()
  stage.controls.update()
}

function setRetargetPreviewObject(stage: RetargetPreviewStage, root: THREE.Object3D | null, clip: THREE.AnimationClip | null = null) {
  if (stage.mixer) {
    stage.mixer.stopAllAction()
    if (stage.root) stage.mixer.uncacheRoot(stage.root)
  }
  stage.mixer = null
  if (stage.root) {
    stage.scene.remove(stage.root)
    disposeRetargetPreviewObject(stage.root)
  }
  stage.root = root
  stage.lastRootWorldPosition = null
  if (!root) return
  stage.scene.add(root)
  root.updateWorldMatrix(true, true)
  stage.lastRootWorldPosition = root.getWorldPosition(new THREE.Vector3())
  fitRetargetPreviewCamera(stage, root)
  if (clip) {
    stage.mixer = new THREE.AnimationMixer(root)
    stage.mixer.clipAction(clip).reset().play()
    stage.clock.start()
    if (stage.key === 'source') retargetSourcePreviewPlaying.value = true
    else retargetTargetPreviewPlaying.value = true
  }
}

function ensureRetargetPreviewStages() {
  if (!retargetSourcePreviewStage && retargetSourcePreviewCanvas.value) {
    retargetSourcePreviewStage = createRetargetPreviewStage(retargetSourcePreviewCanvas.value, 'source')
  }
  if (!retargetTargetPreviewStage && retargetTargetPreviewCanvas.value) {
    retargetTargetPreviewStage = createRetargetPreviewStage(retargetTargetPreviewCanvas.value, 'target')
  }
}

function disposeRetargetPreviewStage(stage: RetargetPreviewStage | null) {
  if (!stage) return
  cancelAnimationFrame(stage.frame)
  stage.resizeObserver.disconnect()
  stage.controls.dispose()
  stage.mixer?.stopAllAction()
  if (stage.root) {
    stage.scene.remove(stage.root)
    disposeRetargetPreviewObject(stage.root)
  }
  stage.scene.clear()
  stage.renderer.dispose()
}

function disposeRetargetPreviews() {
  disposeRetargetPreviewStage(retargetSourcePreviewStage)
  disposeRetargetPreviewStage(retargetTargetPreviewStage)
  retargetSourcePreviewStage = null
  retargetTargetPreviewStage = null
}

function refreshRetargetSourcePreview() {
  const stage = retargetSourcePreviewStage
  const source = retargetSourceRoot.value
  const clip = retargetSourceClip.value
  if (!stage || !source || !clip) {
    if (stage) setRetargetPreviewObject(stage, null)
    retargetSourcePreviewPlaying.value = false
    return
  }
  setRetargetPreviewObject(stage, cloneRetargetPreviewObject(source), clip)
  retargetSourcePreviewPlaying.value = true
}

function refreshRetargetTargetPreview() {
  const stage = retargetTargetPreviewStage
  const sourceClip = retargetSourceClip.value
  const target = model.value
  if (!stage) return
  if (!target) {
    setRetargetPreviewObject(stage, null)
    retargetPreviewStatus.value = 'Carregue o modelo que receberá a animação.'
    return
  }

  const previewModel = cloneRetargetPreviewObject(target)
  try {
    const previewBones: THREE.Bone[] = []
    previewModel.traverse(node => { if (node instanceof THREE.Bone) previewBones.push(node) })
    const storedTargetRestPose = retargetRestPoseByModel.get(target)
    if (storedTargetRestPose && Object.keys(storedTargetRestPose).length > 0) {
      applyRigPose(previewBones, storedTargetRestPose)
      previewModel.updateMatrixWorld(true)
    } else if (Object.keys(rigRestPose.value).length > 0) {
      applyRigPose(previewBones, rigRestPose.value)
    }
    if (!sourceClip) {
      setRetargetPreviewObject(stage, previewModel)
      retargetPreviewStatus.value = 'Selecione uma animação de origem.'
      return
    }
    const asset = retargetableAssetForCurrentSource()
    if (!asset) {
      setRetargetPreviewObject(stage, previewModel)
      retargetPreviewStatus.value = 'Não foi possível ler a animação de origem.'
      return
    }
    const bounds = new THREE.Box3().setFromObject(previewModel)
    const measuredHeight = bounds.isEmpty() ? 0 : bounds.getSize(new THREE.Vector3()).y
    const targetHeight = originalHeight.value > 1e-5 ? originalHeight.value : Math.max(0.1, measuredHeight)
    const clipName = retargetClipName.value.trim() || asset.name || sourceClip.name || 'Prévia retargetada'
    const result = retargetAnimationClip(
      asset,
      previewBones,
      retargetBoneMap.value,
      clipName,
      targetHeight,
      retargetCollapsedSourceNames.value,
      previewModel,
    )
    setRetargetPreviewObject(stage, previewModel, result.clip)
    retargetPreviewStatus.value = 'Prévia no destino: ' + result.mappedTracks + ' trilha(s) transferida(s)' +
      (result.rootMotionTracks ? '; deslocamento global do corpo preservado' : '; nenhum canal de deslocamento global detectado') +
      (result.skippedTracks.length ? '; ' + result.skippedTracks.length + ' ignorada(s).' : '.')
  } catch (cause) {
    setRetargetPreviewObject(stage, previewModel)
    retargetPreviewStatus.value = cause instanceof Error
      ? cause.message
      : 'Não foi possível gerar a prévia no modelo de destino.'
  }
}

function toggleRetargetSourcePreviewPlayback() {
  retargetSourcePreviewPlaying.value = !retargetSourcePreviewPlaying.value
  if (retargetSourcePreviewPlaying.value) retargetSourcePreviewStage?.clock.start()
}

function toggleRetargetTargetPreviewPlayback() {
  retargetTargetPreviewPlaying.value = !retargetTargetPreviewPlaying.value
  if (retargetTargetPreviewPlaying.value) retargetTargetPreviewStage?.clock.start()
}

function saveRetargetAnimationToLibrary() {
  const root = retargetSourceRoot.value
  const clip = retargetSourceClip.value
  if (!root || !clip || selectedRetargetLibraryId.value) {
    retargetMessage.value = 'Carregue uma animação de um arquivo GLB antes de guardá-la na biblioteca.'
    return
  }
  try {
    const asset = createReusableAnimationAsset(
      root,
      clip,
      retargetSourceFileName.value || root.name || 'Modelo de origem',
      rigClipRole.value,
    )
    asset.name = retargetClipName.value.trim() || asset.name
    retargetLibrary.value = [...retargetLibrary.value, asset]
    if (persistRetargetAnimationLibrary()) {
      retargetMessage.value = `"${asset.name}" foi guardada na biblioteca local e poderá ser usada em outros modelos.`
    }
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível guardar essa animação.'
  }
}

function deleteRetargetLibraryAsset() {
  const id = selectedRetargetLibraryId.value
  if (!id) return
  retargetLibrary.value = retargetLibrary.value.filter(asset => asset.id !== id)
  selectedRetargetLibraryId.value = ''
  selectedRetargetLibraryClip.value = null
  retargetBoneMap.value = {}
  if (persistRetargetAnimationLibrary()) retargetMessage.value = 'Animação removida da biblioteca local.'
}

function applyRetargetedAnimation() {
  const root = model.value
  const clip = retargetSourceClip.value
  const targetBones = retargetTargetBones.value
  if (!root || !clip || targetBones.length === 0) {
    retargetMessage.value = 'O modelo de destino precisa ter um rig. Crie o rig ou carregue um modelo que já possua ossos.'
    return
  }

  const asset = retargetableAssetForCurrentSource()
  if (!asset) {
    retargetMessage.value = 'Carregue um GLB animado ou escolha uma animação da biblioteca.'
    return
  }

  try {
    previewAnimationController?.stop()
    const hasStoredTargetRestPose = restoreRetargetRestPose(root, targetBones)
    if (!hasStoredTargetRestPose && rigBones.value.length && Object.keys(rigRestPose.value).length > 0) {
      applyRigPose(targetBones, rigRestPose.value)
    }
    root.updateWorldMatrix(true, true)
    const targetHeight = originalHeight.value > 1e-5
      ? originalHeight.value
      : Math.max(0.1, new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y)
    const name = retargetClipName.value.trim() || asset.name || clip.name || 'Animação reutilizada'
    const result = retargetAnimationClip(
      asset,
      targetBones,
      retargetBoneMap.value,
      name,
      targetHeight,
      retargetCollapsedSourceNames.value,
      root,
    )
    const currentClips = [...((root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? previewAnimations.value)]
    const normalizedClipName = result.clip.name.trim().toLocaleLowerCase()
    const existingClipIndex = normalizedClipName
      ? currentClips.findIndex(existing => existing.name.trim().toLocaleLowerCase() === normalizedClipName)
      : -1
    const newIndex = existingClipIndex >= 0 ? existingClipIndex : currentClips.length
    if (existingClipIndex >= 0) currentClips[existingClipIndex] = result.clip
    else currentClips.push(result.clip)
    const nextRoles = { ...animationRoles.value, [String(newIndex)]: rigClipRole.value }
    root.userData.importNeedsReexport = true
    root.userData.importHasModifiedAnimations = true
    root.userData.importAnimations = currentClips
    // A transferência muda ossos, não deve ocultar as malhas ligadas ao rig.
    restoreModelRenderableMeshes(root)
    root.userData.importAnimationRoles = nextRoles
    animationRoles.value = nextRoles
    animationClipRevision.value += 1
    previewAnimationIndex.value = newIndex
    refreshModelDiagnostics()
    selectPreviewAnimation(newIndex)
    const skippedDetails = [
      result.unmappedTracks.length ? `${result.unmappedTracks.length} sem correspondência de osso/pose de repouso (inclui nós auxiliares da origem)` : '',
      result.unsupportedTracks.length ? `${result.unsupportedTracks.length} de tipo não suportado (por exemplo, morph targets)` : '',
      result.conflictingTracks.length ? `${result.conflictingTracks.length} em conflito com outra trilha do mesmo osso` : '',
      result.invalidTracks.length ? `${result.invalidTracks.length} com dados inválidos` : '',
      result.collapsedTracks.length ? `${result.collapsedTracks.length} posições/escalas de juntas recolhidas foram ignoradas (as rotações foram combinadas)` : '',
      result.unsafeScaleTracks.length ? `${result.unsafeScaleTracks.length} canais de escala inseguros foram ignorados para preservar a geometria do modelo A` : '',
      result.unsafePositionTracks.length ? `${result.unsafePositionTracks.length} canais de posição incompatíveis foram ignorados para não deslocar/colapsar os membros` : '',
    ].filter(Boolean).join('; ')
    const mergedSummary = result.mergedTracks
      ? `; ${result.mergedTracks} rotação(ões) de juntas ausentes combinada(s)`
      : ''
    const rootMotionSummary = result.rootMotionTracks
      ? '; movimento global do corpo preservado no objeto raiz'
      : '; nenhum canal de deslocamento global detectado (a origem pode usar outro nó ou uma animação in-place)'
    retargetMessage.value = `"${result.clip.name}" aplicada: ${result.mappedTracks} trilha(s) de origem aproveitada(s) em ${result.outputTracks} trilha(s) de destino${mergedSummary}${rootMotionSummary}${result.skippedTracks.length ? `; ${result.skippedTracks.length} não transferida(s) (${skippedDetails || 'motivo não classificado'})` : ''}. O clipe será salvo junto do modelo quando confirmar a importação.`
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível transferir a animação.'
  }
}


async function runAutonomousRetargeting() {
  if (retargetAutonomousLoading.value || retargetLoading.value || loading.value) return

  const initialTarget = model.value
  const sourceClip = retargetSourceClip.value
  const sourceNames = [...retargetSourceNodeNames.value]
  if (!initialTarget) {
    retargetMessage.value = 'Carregue primeiro o modelo A, que receberá a animação.'
    return
  }
  if (!sourceClip || sourceNames.length === 0) {
    retargetMessage.value = 'Carregue um GLB animado do modelo B e selecione um clipe com trilhas de transformação.'
    return
  }
  if (isReadOnlyPreview.value) {
    retargetMessage.value = 'Este ativo está em modo de visualização. Abra-o para edição antes de transferir animações.'
    return
  }
  if (skinTokensLoading.value) {
    retargetMessage.value = 'Aguarde a operação de IA em andamento antes de iniciar o retargeting autônomo.'
    return
  }

  // Não retargetear nem salvar um personagem com partes temporariamente
  // escondidas pelo modo "Isolar parte" do painel de inspeção.
  restorePreviewVisibility()

  retargetAutonomousLoading.value = true
  let generatedRig = false
  try {
    const asset = retargetableAssetForCurrentSource()
    if (!asset || !asset.sourceNodeNames.length) {
      throw new Error('Não consegui extrair poses de repouso do modelo B. Confira se o clipe anima ossos ou outros nós com posição, rotação ou escala.')
    }

    retargetAutonomousStage.value = 'Etapa 1/3 · Verificando o rig do modelo A'
    let targetRoot = model.value
    if (!targetRoot) throw new Error('O modelo A deixou de estar disponível.')

    const inspectRig = (root: THREE.Object3D) => {
      const bones: THREE.Bone[] = []
      let hasSkinnedMesh = false
      root.traverse(node => {
        if (node instanceof THREE.Bone) bones.push(node)
        if (node instanceof THREE.SkinnedMesh) hasSkinnedMesh = true
      })
      return { bones, hasSkinnedMesh }
    }

    let targetRig = inspectRig(targetRoot)
    if (targetRig.bones.length === 0 || !targetRig.hasSkinnedMesh) {
      if (!isTauri()) {
        throw new Error('Para fazer o fluxo autônomo completo, abra o aplicativo desktop Tauri e configure o SkinTokens local. O destino ainda não tem um rig esquelético utilizável.')
      }
      if (!skinTokensExecutablePath.value.trim()) {
        throw new Error('O modelo A não tem um rig pronto. Instale o SkinTokens com scripts/install-skintokens.ps1 e informe o caminho de skintokens.exe no painel de IA local.')
      }
      skinTokensOperation.value = 'rig'
      if (!skinTokensRigCompatible.value) {
        throw new Error('A IA não pode gerar um rig para a estrutura atual. Verifique se o modelo A contém malhas estáticas válidas e não mistura malhas estáticas e esqueléticas incompatíveis.')
      }

      retargetAutonomousStage.value = 'Etapa 1/3 · A IA local está gerando o esqueleto e os pesos do modelo A'
      const targetBeforeAi = targetRoot
      await performSkinTokensRigging(true)
      if (model.value === targetBeforeAi) {
        throw new Error(skinTokensMessage.value || 'A IA local não conseguiu preparar o rig do modelo A.')
      }
      targetRoot = model.value
      if (!targetRoot) throw new Error('A IA terminou, mas o modelo A não foi carregado novamente.')
      targetRig = inspectRig(targetRoot)
      if (targetRig.bones.length === 0 || !targetRig.hasSkinnedMesh) {
        throw new Error('A IA não produziu um rig esquelético com malha deformável. O modelo não foi retargetado.')
      }
      generatedRig = true
      activeSetupTab.value = 'rigging'
      await nextTick()
    }

    retargetAutonomousStage.value = 'Etapa 2/3 · Relacionando ossos por anatomia, hierarquia e geometria'
    targetRoot.updateWorldMatrix(true, true)
    const mappingResult = suggestAutonomousBoneMappingsDetailed(
      sourceNames,
      targetRig.bones,
      retargetSourceRoot.value,
      targetRoot,
    )
    const mapping = mappingResult.mapping
    retargetCollapsedSourceNames.value = mappingResult.collapsedSourceNames
    retargetBoneMap.value = Object.fromEntries(sourceNames.map(name => [name, mapping[name] ?? '']))
    const mappedNames = sourceNames.filter(name => Boolean(mapping[name]))
    if (mappedNames.length === 0) {
      throw new Error('Não encontrei correspondências seguras entre os ossos dos modelos A e B. O rig foi preservado; revise os ossos manualmente ou escolha modelos com anatomias mais semelhantes.')
    }

    if (!retargetClipName.value.trim()) {
      retargetClipName.value = sourceClip.name?.trim() || (retargetSourceFileName.value || 'Animação') + ' transferida'
    }
    const guessedRole = guessedAnimationRole(sourceClip.name || retargetSourceFileName.value)
    if (guessedRole !== 'ignore') rigClipRole.value = guessedRole

    retargetAutonomousStage.value = 'Etapa 3/3 · Adaptando a animação e validando as trilhas transferidas'
    const revisionBeforeTransfer = animationClipRevision.value
    applyRetargetedAnimation()

    const finalRoot = model.value
    const finalClips = (finalRoot?.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    // A transferência pode atualizar um clipe existente em vez de aumentar a lista.
    if (animationClipRevision.value === revisionBeforeTransfer || finalClips.length === 0) {
      throw new Error(retargetMessage.value || 'A transferência não gerou nem atualizou um clipe válido.')
    }

    const transferReport = retargetMessage.value
    const coverage = Math.round((mappedNames.length / Math.max(1, sourceNames.length)) * 100)
    const uniqueDestinationCount = new Set(Object.values(mapping)).size
    const destinationUse = Math.round((uniqueDestinationCount / Math.max(1, targetRig.bones.length)) * 100)
    const destinationIsCapacityLimited = targetRig.bones.length < sourceNames.length &&
      uniqueDestinationCount >= Math.floor(targetRig.bones.length * 0.9)
    const qualityLead = coverage < 60 && !destinationIsCapacityLimited
      ? 'Retargeting concluído com cobertura baixa; revise as associações antes de usar. '
      : coverage < 80 && !destinationIsCapacityLimited
        ? 'Retargeting concluído; a cobertura é parcial e precisa de revisão. '
        : 'Fluxo autônomo concluído. '
    const capacityNote = destinationIsCapacityLimited
      ? 'O modelo A tem ' + targetRig.bones.length + ' ossos para ' + sourceNames.length + ' ossos animados na origem; ' + destinationUse + '% dos ossos do destino estão em uso. '
      : 'Foram utilizados ' + destinationUse + '% dos ossos disponíveis no destino. '
    const collapseNote = mappingResult.collapsedSourceNames.length
      ? mappingResult.collapsedSourceNames.length + ' junta(s) da origem foram recolhidas em ossos existentes; as rotações compatíveis foram combinadas. '
      : ''
    retargetMessage.value = qualityLead
      + (generatedRig ? 'A IA local gerou o rig e os pesos do modelo A; ' : 'O rig existente do modelo A foi mantido; ')
      + mappedNames.length + '/' + sourceNames.length + ' ossos da origem associados (' + coverage + '%: ' + mappingResult.directMappedCount + ' associação(ões) direta(s) e ' + mappingResult.collapsedSourceNames.length + ' recolhida(s)). '
      + capacityNote + collapseNote + transferReport + ' Confira a prévia antes de confirmar a importação.'
    retargetPreviewStatus.value = 'Retargeting concluído · ' + mappedNames.length + '/' + sourceNames.length + ' nós da origem associados (' + coverage + '%). Confira a deformação do modelo A.'
    retargetTargetPreviewPlaying.value = true
    await nextTick()
    refreshRetargetTargetPreview()
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível concluir o retargeting autônomo.'
  } finally {
    retargetAutonomousLoading.value = false
    retargetAutonomousStage.value = ''
  }
}

function autoMapRetargetBones() {
  const sourceNames = retargetSourceNodeNames.value
  const result = suggestAutonomousBoneMappingsDetailed(
    sourceNames,
    retargetTargetBones.value,
    retargetSourceRoot.value,
    model.value,
  )
  const mapping = result.mapping
  retargetCollapsedSourceNames.value = result.collapsedSourceNames
  retargetBoneMap.value = Object.fromEntries(sourceNames.map(name => [name, mapping[name] ?? '']))
  retargetMessage.value = `Mapeamento automático: ${Object.keys(mapping).length}/${sourceNames.length}; ${result.directMappedCount} associação(ões) direta(s) e ${result.collapsedSourceNames.length} junta(s) recolhida(s) em ossos compatíveis. As linhas ignoradas têm sugestões candidatas; confira antes de aplicar.`
}

watch(
  () => props.animationSourceAsset?.id ?? '',
  async id => {
    const asset = props.animationSourceAsset
    if (!id || !asset || asset.libraryType !== 'animation-source') return
    await loadSavedAnimationSource(asset)
  },
)

watch(
  () => [
    selectedRetargetLibraryId.value,
    retargetSourceRoot.value?.uuid ?? '',
    retargetSourceClip.value?.uuid ?? '',
    retargetSourceNodeNames.value.join('|'),
    retargetTargetBones.value.map(bone => bone.name).join('|'),
  ].join('::'),
  () => {
    autoMapRetargetBones()
    if (retargetSourceClip.value && !retargetClipName.value.trim()) {
      retargetClipName.value = retargetSourceClip.value.name || 'Animação reutilizada'
    }
  },
)

watch(
  () => [
    activeSetupTab.value,
    retargetSourceRoot.value?.uuid ?? '',
    retargetSourceClip.value?.uuid ?? '',
    selectedRetargetLibraryId.value,
  ].join('::'),
  async () => {
    await nextTick()
    if (activeSetupTab.value !== 'rigging' || !retargetSourceClip.value) {
      disposeRetargetPreviews()
      return
    }
    ensureRetargetPreviewStages()
    refreshRetargetSourcePreview()
    refreshRetargetTargetPreview()
  },
)

watch(
  () => [
    activeSetupTab.value,
    model.value?.uuid ?? '',
    retargetSourceClip.value?.uuid ?? '',
    JSON.stringify(retargetBoneMap.value),
    retargetTargetBones.value.map(bone => bone.name).join('|'),
    JSON.stringify(rigRestPose.value),
  ].join('::'),
  async () => {
    await nextTick()
    if (activeSetupTab.value !== 'rigging' || !retargetSourceClip.value) return
    ensureRetargetPreviewStages()
    refreshRetargetTargetPreview()
  },
)

function selectPreviewAnimation(index: number) {
  previewAnimationIndex.value = index
  const root = model.value
  const clip = previewAnimations.value[index]
  if (!root || !clip) return
  const controller = ensurePreviewAnimationController(root, previewAnimations.value)
  controller.setState(previewRoleForClip(clip), true)
  previewPlaying.value = true
  previewClock.start()
}

function togglePreviewAnimationPlayback() {
  if (!previewAnimations.value.length) return
  previewPlaying.value = !previewPlaying.value
  if (previewPlaying.value) previewClock.start()
}

function setModelHeight(value: number) {
  if (!model.value || !Number.isFinite(value)) return
  const normalized = THREE.MathUtils.clamp(value, 0.1, 10000)
  modelHeight.value = Math.round(normalized * 100) / 100
}

watch(modelHeight, (height, previousHeight) => {
  if (!model.value || !Number.isFinite(height) || height <= 0 || originalHeight.value <= 0) return
  const targetScale = height / originalHeight.value
  model.value.scale.setScalar(targetScale)
  const centerData = model.value.userData.importCenter as [number, number, number] | undefined
  if (centerData && centerData.length === 3) {
    model.value.position.set(
      -centerData[0] * targetScale,
      -centerData[1] * targetScale,
      -centerData[2] * targetScale,
    )
  }
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
    let bytes: ArrayBuffer
    if (props.initialAsset) {
      // Prévia de componente salvo: reutiliza o GLB exato, sem reexportar o ativo.
      bytes = props.initialAsset.bytes.slice(0)
    } else {
      // Exporta o modelo inteiro com as animações e os papéis configurados no workspace.
      // SkeletonUtils mantém os bones ligados corretamente durante a exportação.
      const exportRoot = cloneSkinnedModel(root)
      exportRoot.userData = { ...exportRoot.userData }
      for (const key of [
        'importAnimations', 'importGltfMetadata', 'importRecoveredTextures',
        'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl',
        'importAnimationRoles', 'importControlBindings',
        'importRigPreset', 'importRigGenerated', 'importRigBoneNames',
        'importSourceGlbBytes', 'importNeedsReexport',
      ]) {
        delete exportRoot.userData[key]
      }
      exportRoot.updateMatrixWorld(true)
      const exporter = new GLTFExporter()
      const clips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
      const exported = await exporter.parseAsync(exportRoot, { binary: true, animations: clips })
      if (!(exported instanceof ArrayBuffer)) throw new Error('O exportador não gerou um arquivo GLB válido.')
      bytes = exported
    }

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
  const source = canvas.value
  if (!source || !renderer || !scene || !camera || source.width < 1 || source.height < 1) return undefined

  // Não inclua a visualização de colisão nem as linhas de rig na imagem da biblioteca.
  const helpers: THREE.Object3D[] = []
  if (colliderPreview) helpers.push(colliderPreview)
  if (rigHelper) helpers.push(rigHelper)
  const previousVisibility = helpers.map(item => item.visible)
  try {
    helpers.forEach(item => { item.visible = false })
    renderer.render(scene, camera)

    const size = 160
    const thumbnail = document.createElement('canvas')
    thumbnail.width = size
    thumbnail.height = size
    const context = thumbnail.getContext('2d')
    if (!context) return undefined
    context.fillStyle = '#20232a'
    context.fillRect(0, 0, size, size)

    const padding = 8
    const scale = Math.min((size - padding * 2) / source.width, (size - padding * 2) / source.height)
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    context.drawImage(source, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height)
    return thumbnail.toDataURL('image/webp', 0.82)
  } catch (cause) {
    console.warn('[ModelImportDialog] Não foi possível gerar a miniatura do modelo.', cause)
    return undefined
  } finally {
    helpers.forEach((item, index) => { item.visible = previousVisibility[index] ?? true })
    renderer?.render(scene!, camera!)
  }
}

async function chooseThumbnailImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  thumbnailImageError.value = ''

  if (!file.type.startsWith('image/')) {
    thumbnailImageError.value = 'Escolha um arquivo PNG, JPG, WEBP ou SVG.'
    input.value = ''
    return
  }
  if (file.size > 12 * 1024 * 1024) {
    thumbnailImageError.value = 'A imagem precisa ter menos de 12 MB.'
    input.value = ''
    return
  }

  try {
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem.'))
      reader.onerror = () => reject(reader.error ?? new Error('Não foi possível ler a imagem.'))
      reader.readAsDataURL(file)
    })
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('O arquivo escolhido não é uma imagem válida.'))
      element.src = source
    })

    const size = 256
    const thumbnailCanvas = document.createElement('canvas')
    thumbnailCanvas.width = size
    thumbnailCanvas.height = size
    const context = thumbnailCanvas.getContext('2d')
    if (!context) throw new Error('Não foi possível preparar a miniatura.')
    context.fillStyle = '#20232a'
    context.fillRect(0, 0, size, size)

    const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight)
    const width = Math.max(1, Math.round(image.naturalWidth * ratio))
    const height = Math.max(1, Math.round(image.naturalHeight * ratio))
    context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height)
    customThumbnail.value = thumbnailCanvas.toDataURL('image/webp', 0.84)
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

async function saveSelectedParts() {
  if (loading.value) return
  const root = model.value
  if (!root) {
    error.value = 'Carregue um modelo 3D antes de selecionar partes.'
    return
  }

  const parts = batchSelectedPartIds.value
    .map(id => findPreviewPart(id))
    .filter((part): part is NonNullable<typeof part> => Boolean(part))
  if (parts.length === 0) {
    error.value = 'Marque pelo menos uma parte da hierarquia para salvar em lote.'
    return
  }

  loading.value = true
  error.value = ''
  batchNotice.value = ''
  const entries: ModelImportBatchItem[] = []
  try {
    root.updateMatrixWorld(true)
    const scaleFactor = modelHeight.value / Math.max(originalHeight.value, 0.05)

    for (const part of parts) {
      const relativeMatrix = new THREE.Matrix4()
        .copy(root.matrixWorld)
        .invert()
        .multiply(part.object.matrixWorld)
      const imported = cloneSkinnedModel(part.object)
      imported.matrix.copy(relativeMatrix)
      imported.matrix.decompose(imported.position, imported.quaternion, imported.scale)
      imported.matrixAutoUpdate = true
      imported.name = part.name
      imported.traverse(node => { node.visible = true })
      imported.updateMatrixWorld(true)

      const bounds = new THREE.Box3().setFromObject(imported)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) {
        throw new Error(`Não foi possível calcular as dimensões de "${part.name}".`)
      }

      imported.position.sub(center)
      imported.scale.multiplyScalar(scaleFactor)
      imported.position.multiplyScalar(scaleFactor)
      imported.updateMatrixWorld(true)

      const scaledSize: [number, number, number] = [
        Math.max(0.05, size.x * scaleFactor),
        Math.max(0.05, size.y * scaleFactor),
        Math.max(0.05, size.z * scaleFactor),
      ]
      let partColliderSize = scaledSize
      if (colliderType.value === 'sphere') {
        const diameter = Math.max(0.05, Math.min(...scaledSize))
        partColliderSize = [diameter, diameter, diameter]
      }

      if (colliderType.value === 'mesh') {
        const partCollisionData = getStaticMeshCollisionData(imported)
        if (!partCollisionData) {
          throw new Error(`A parte "${part.name}" não pode usar malha estática. Ela precisa conter geometria estática e ficar abaixo de 5 milhões de triângulos.`)
        }
      }
      imported.userData.importColliderType = colliderType.value
      imported.userData.importColliderSize = partColliderSize
      // Cada parte é centralizada durante a extração, então seu colisor também
      // começa no centro local próprio, sem herdar o offset do modelo-cidade.
      imported.userData.importColliderOffset = [0, 0, 0]
      imported.userData.importAnimations = []
      imported.userData.importAnimationRoles = {}
      imported.userData.importControlBindings = { ...controlBindings.value }
      imported.userData.importBehaviorPackageIds = [...selectedBehaviorPackageIds.value]
      const behaviorPackageSettings: Record<string, ImportBehaviorPackageDraft> = {}
      for (const packageId of selectedBehaviorPackageIds.value) {
        const draft = ensureImportBehaviorPackageDraft(packageId)
        behaviorPackageSettings[packageId] = {
          variables: { ...draft.variables },
          config: clonePackageJsonRecord(draft.config),
        }
      }
      imported.userData.importBehaviorPackageSettings = behaviorPackageSettings
      imported.userData.sceneKind = 'object'
      imported.userData.componentLogic = []

      entries.push({
        partId: part.id,
        name: part.name,
        model: imported,
        height: Math.max(0.05, scaledSize[1]),
      })
    }

    const saved = await props.saveModel({
      name: fileName.value.replace(/\.[^.]+$/, '') || 'Importação em lote',
      model: root,
      height: modelHeight.value,
      batchModels: entries,
    })
    if (!saved) throw new Error('O aplicativo não confirmou a gravação dos componentes.')

    batchSavedPartIds.value = [...new Set([...batchSavedPartIds.value, ...entries.map(entry => entry.partId)])]
    batchSelectedPartIds.value = []
    batchNotice.value = `Salvos ${entries.length} componentes. A importação continua aberta; selecione outras partes para criar mais componentes sem reabrir o arquivo.`
  } catch (cause) {
    error.value = 'Não foi possível salvar as partes selecionadas: ' + (cause instanceof Error ? cause.message : String(cause || 'Erro desconhecido'))
  } finally {
    loading.value = false
  }
}

async function confirmImport() {
  if (loading.value) return
  const root = model.value
  if (!root) {
    error.value = 'Carregue um modelo 3D antes de salvar o componente.'
    return
  }
  if (!fileName.value) {
    error.value = 'Não foi possível identificar o arquivo de origem. Reabra o modelo e tente salvar novamente.'
    return
  }

  loading.value = true
  error.value = ''
  try {
    const chosenPart = !props.initialAsset && selectedPartId.value
      ? findPreviewPart(selectedPartId.value)
      : undefined
    const chosenName = componentName.value.trim() || chosenPart?.name || root.name.trim() || 'Modelo 3D'
    let imported: THREE.Object3D
    let importedHeight = modelHeight.value

    if (chosenPart && chosenPart.object !== root) {
      root.updateMatrixWorld(true)
      const relativeMatrix = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(chosenPart.object.matrixWorld)
      imported = chosenPart.object.clone(true)
      imported.matrix.copy(relativeMatrix)
      imported.matrix.decompose(imported.position, imported.quaternion, imported.scale)
      imported.matrixAutoUpdate = true
      imported.name = chosenPart.name
      const bounds = new THREE.Box3().setFromObject(imported)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) {
        throw new Error('Não foi possível calcular o tamanho da parte selecionada.')
      }
      imported.position.sub(center)
      const scale = modelHeight.value / size.y
      imported.scale.multiplyScalar(scale)
      imported.position.multiplyScalar(scale)
      imported.userData.importAnimations = root.userData.importAnimations ?? []
      imported.userData.importGltfMetadata = root.userData.importGltfMetadata
      importedHeight = modelHeight.value
    } else {
      imported = root
    }

    if (colliderType.value === 'mesh') {
      const staticCollisionData = getStaticMeshCollisionData(imported)
      if (!staticCollisionData) {
        throw new Error('Não foi possível compilar a malha estática deste componente. Use apenas geometrias estáticas com até 5 milhões de triângulos; partes animadas ficam fora deste colisor.')
      }
    }
    imported.userData.importColliderType = colliderType.value
    imported.userData.importColliderSize = [...colliderSize.value]
    imported.userData.importColliderOffset = [...colliderOffset.value]
    imported.userData.importAnimationRoles = { ...animationRoles.value }
    imported.userData.importControlBindings = { ...controlBindings.value }
    imported.userData.importBehaviorPackageIds = [...selectedBehaviorPackageIds.value]
    const behaviorPackageSettings: Record<string, ImportBehaviorPackageDraft> = {}
    for (const packageId of selectedBehaviorPackageIds.value) {
      const draft = ensureImportBehaviorPackageDraft(packageId)
      behaviorPackageSettings[packageId] = {
        variables: { ...draft.variables },
        config: clonePackageJsonRecord(draft.config),
      }
    }
    imported.userData.importBehaviorPackageSettings = behaviorPackageSettings

    const thumbnail = customThumbnail.value ?? capturePreviewThumbnail()
    const sourceMetadata = root.userData.importGltfMetadata as { images?: Array<{ uri?: string }> } | undefined
    const hasOnlyEmbeddedTextures = (sourceMetadata?.images ?? []).every(image =>
      !image.uri || image.uri.startsWith('data:image/'),
    )
    const sourceGlbBytes = imported === root
      && root.userData.importNeedsReexport !== true
      && hasOnlyEmbeddedTextures
      && root.userData.importSourceGlbBytes instanceof ArrayBuffer
      ? root.userData.importSourceGlbBytes.slice(0)
      : undefined

    const saved = await props.saveModel({
      name: chosenName,
      model: imported,
      height: importedHeight,
      thumbnail,
      componentId: props.initialAsset?.id,
      sourceGlbBytes,
    })
    if (!saved) {
      error.value = 'O aplicativo não confirmou o salvamento. Verifique o status do editor no rodapé e tente novamente.'
      return
    }

    clearPreviewAnimationController()
    scene?.remove(root)
    if (imported === root) model.value = null
    emit('close')
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause || 'Erro desconhecido')
    error.value = 'Não foi possível salvar o componente: ' + message
  } finally {
    loading.value = false
  }
}
onBeforeUnmount(() => {
  window.removeEventListener('keydown', captureControlBindingKey, true)
  disposeRetargetPreviews()
  disposePreview()
})
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

        <aside class="model-import-right-panel">
          <section v-if="activeSetupTab === 'controls'" class="model-panel-section model-controls-section">
            <div class="model-panel-heading"><span>02</span> MAPA DE CONTROLES</div>
            <p class="model-panel-hint">Clique em uma tecla e pressione a nova combinação. Estas teclas são salvas junto ao modelo e serão usadas quando o componente receber o pacote de comportamento <strong>Montaria</strong>.</p>
            <div class="model-control-bindings">
              <div v-for="binding in controlBindingFields" :key="binding.key" class="model-control-row">
                <div class="model-control-copy">
                  <strong>{{ binding.label }}</strong>
                  <small>{{ binding.description }}</small>
                </div>
                <button
                  type="button"
                  class="model-control-key"
                  :class="{ listening: listeningForBinding === binding.key }"
                  :disabled="!model || isReadOnlyPreview"
                  @click="startControlBindingCapture(binding.key)"
                >{{ listeningForBinding === binding.key ? 'Pressione…' : formatControlKey(controlBindings[binding.key]) }}</button>
              </div>
            </div>
            <p v-if="listeningForBinding" class="model-control-capture-tip">Aguardando tecla para “{{ controlBindingFields.find(item => item.key === listeningForBinding)?.label }}”. Pressione Esc para cancelar.</p>
            <p class="model-control-note">Padrão: W/A/S/D movimentam, Shift corre, Espaço pula e E interage. As setas continuam aceitas para movimento. A tecla de interação também é usada para desmontar.</p>
            <button type="button" class="model-control-reset" :disabled="!model || isReadOnlyPreview" title="Descarta as alterações e restaura as teclas de movimento padrão para este modelo." @click="resetControlBindings">Restaurar teclas padrão</button>
          </section>

          <section v-if="activeSetupTab === 'animations'" class="model-panel-section model-animation-section">
            <div class="model-panel-heading"><span>03</span> MAPEAMENTO DE ANIMAÇÕES <b>{{ previewAnimations.length }}</b></div>
            <p class="model-panel-hint">Associe cada clipe a uma função do motor. Selecione “Prévia” para testar o clipe no viewport antes de salvar.</p>
            <div v-if="previewAnimations.length" class="model-animation-mapping-list">
              <article v-for="(clip, index) in previewAnimations" :key="index" class="model-animation-map-row" :class="{ active: previewAnimationIndex === index }">
                <div class="model-animation-map-head">
                  <strong :title="clip.name || ('Animação ' + (index + 1))">{{ clip.name || ('Animação ' + (index + 1)) }}</strong>
                  <small>{{ clip.duration.toFixed(2) }} s</small>
                </div>
                <select
                  :value="animationRoles[String(index)] ?? 'ignore'"
                  :disabled="isReadOnlyPreview"
                  :aria-label="'Função para ' + (clip.name || ('Animação ' + (index + 1)))"
                  @change="setAnimationRole(index, ($event.target as HTMLSelectElement).value as AnimationRole)"
                >
                  <option v-for="role in animationRoleOptions" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
                <button type="button" title="Seleciona e reproduz este clipe de animação na prévia." @click="selectPreviewAnimation(index)">▶ Prévia deste clipe</button>
              </article>
            </div>
            <div v-else class="model-setup-empty">
              <strong>Nenhuma animação encontrada</strong>
              <small>O arquivo precisa conter clipes de animação para configurar movimento automaticamente.</small>
            </div>
            <p class="model-control-note">As funções acompanham o mapa de controles ativo: movimento, caminhada lenta, postura, esquiva, rolamento, interação e ações de inventário/itens/habilidades. A tecla atual aparece ao lado do papel. Câmera e sair do jogo não acionam animações do personagem.</p>
          </section>

          <section v-if="activeSetupTab === 'rigging'" class="model-panel-section model-rigging-section">
            <div class="model-panel-heading"><span>04</span> RIGGING E ANIMAÇÃO POR OSSOS <b>{{ rigBones.length }}</b></div>
            <p class="model-panel-hint">Crie um esqueleto para modelos estáticos ou use os ossos de um modelo que já seja rigado. Depois ajuste a pose dos ossos e grave quadros-chave em tempos diferentes.</p>
            <div class="model-retarget-panel">
              <div class="model-rigging-subtitle">CAPTURAR E REUTILIZAR ANIMAÇÕES</div>
              <p class="model-panel-hint">Carregue um GLB animado de outro modelo, guarde o movimento na biblioteca e transfira as rotações para os ossos do rig atual. O arquivo original pode ser fechado depois de salvar na biblioteca.</p>
              <input ref="retargetFileInput" class="model-file-input" type="file" accept=".glb,model/gltf-binary" @change="chooseRetargetAnimationSource" />
              <button type="button" class="model-rigging-secondary" :disabled="retargetLoading || loading || retargetAutonomousLoading" @click="retargetFileInput?.click()">＋ Carregar GLB com animação</button>
              <button v-if="retargetSourceRoot && retargetSourceBytes" type="button" class="model-rigging-secondary model-retarget-save-source" :disabled="retargetLoading || retargetAutonomousLoading" @click="saveRetargetSourceToLibrary">▣ Salvar modelo B na biblioteca de importados</button>
              <label class="model-rigging-field">Fontes de animação importadas
                <select :value="selectedSavedAnimationSourceId" :disabled="retargetLoading || retargetAutonomousLoading || !(animationSourceOptions?.length)" @change="selectSavedAnimationSource">
                  <option value="">{{ animationSourceOptions?.length ? 'Escolher fonte salva…' : 'Nenhuma fonte salva' }}</option>
                  <option v-for="source in animationSourceOptions ?? []" :key="source.id" :value="source.id">{{ source.name }}</option>
                </select>
              </label>
              <p v-if="retargetSourceFileName" class="model-retarget-source">Origem: <strong>{{ retargetSourceFileName }}</strong></p>
              <label v-if="retargetSourceRoot" class="model-rigging-field">Animação extraída
                <select v-model.number="retargetSourceClipIndex" :disabled="retargetAutonomousLoading" @change="onRetargetSourceClipChanged">
                  <option v-for="(clip, index) in retargetSourceClips" :key="clip.uuid" :value="index">{{ clip.name || ('Animação ' + (index + 1)) }} · {{ clip.duration.toFixed(2) }} s</option>
                </select>
              </label>
              <label class="model-rigging-field">Biblioteca local de animações
                <select :value="selectedRetargetLibraryId" :disabled="retargetAutonomousLoading" @change="selectRetargetLibraryAsset(($event.target as HTMLSelectElement).value)">
                  <option value="">Usar arquivo GLB carregado acima</option>
                  <option v-for="asset in retargetLibrary" :key="asset.id" :value="asset.id">{{ asset.name }} · {{ asset.duration.toFixed(2) }} s</option>
                </select>
              </label>
              <button v-if="selectedRetargetLibraryId" type="button" class="model-rigging-secondary" @click="deleteRetargetLibraryAsset">Excluir da biblioteca local</button>
              <label v-if="retargetSourceClip" class="model-rigging-field">Nome do clipe no modelo de destino
                <input v-model.trim="retargetClipName" maxlength="80" placeholder="Ex.: Caminhada reutilizada" />
              </label>
              <label v-if="retargetSourceClip" class="model-rigging-field">Papel no jogo
                <select v-model="rigClipRole">
                  <option v-for="role in animationRoleBaseOptions.filter(option => option.value !== 'ignore')" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
              </label>
              <div v-if="retargetSourceClip && retargetSourceNodeNames.length" class="model-retarget-mapping-wrap">
                <div class="model-retarget-mapping-heading">
                  <div class="model-rigging-subtitle">MAPEAR OSSOS DE ORIGEM → RIG ATUAL <span>{{ retargetMappedBoneCount }}/{{ retargetSourceNodeNames.length }}</span></div>
                  <button type="button" class="model-retarget-auto-map" :disabled="!retargetTargetBones.length" title="Refaz as sugestões considerando nomes anatômicos, lado, segmento e hierarquia." @click="autoMapRetargetBones">↻ Refazer automático</button>
                </div>
                <p class="model-panel-hint">As sugestões usam sinônimos anatômicos, prefixos comuns de rigs e a hierarquia dos pais. Correspondências ambíguas ficam vazias para evitar misturar lados ou partes do corpo. “Ignorar” deixa o osso sem transferência.</p>
                <div class="model-retarget-mappings">
                  <label v-for="sourceName in retargetSourceNodeNames" :key="sourceName" class="model-retarget-map-row" :class="{ 'model-retarget-map-row-unmapped': !retargetBoneMap[sourceName] }">
                    <span :title="sourceName">
                      {{ sourceName }}
                      <small v-if="retargetCollapsedSourceNames.includes(sourceName)"> · junta recolhida</small>
                      <small v-else-if="!retargetBoneMap[sourceName]"> · revisar</small>
                    </span>
                    <select :value="retargetBoneMap[sourceName] ?? ''" :disabled="retargetTargetBones.length === 0 || retargetAutonomousLoading" @change="setRetargetBoneMapping(sourceName, ($event.target as HTMLSelectElement).value)">
                      <option value="">Ignorar</option>
                      <optgroup v-if="retargetSuggestedBonesFor(sourceName).length" label="Melhores sugestões automáticas">
                        <option v-for="candidate in retargetSuggestedBonesFor(sourceName)" :key="'suggested-' + candidate.targetName" :value="candidate.targetName">
                          {{ candidate.targetName }} · {{ Math.round(candidate.score) }} pts{{ candidate.exactName ? ' · nome compatível' : '' }}
                        </option>
                      </optgroup>
                      <optgroup label="Demais ossos do destino">
                        <option v-for="bone in retargetOtherBonesFor(sourceName)" :key="'all-' + bone.uuid" :value="bone.name">{{ bone.name }}</option>
                      </optgroup>
                    </select>
                  </label>
                </div>
              </div>
              <p v-else-if="retargetSourceClip" class="model-control-note">Nenhuma trilha de posição, rotação ou escala compatível foi encontrada neste clipe.</p>
              <div v-if="retargetSourceClip" class="model-retarget-previews">
                <article class="model-retarget-preview-card">
                  <header class="model-retarget-preview-heading">
                    <strong>01 · Animação capturada</strong>
                    <small>{{ retargetSourceClip.name || 'Clipe de origem' }}</small>
                  </header>
                  <div class="model-retarget-preview-viewport">
                    <canvas ref="retargetSourcePreviewCanvas" aria-label="Prévia da animação capturada no modelo de origem"></canvas>
                    <div v-if="!retargetSourceRoot" class="model-retarget-preview-overlay">
                      A biblioteca guarda o clipe e as poses, não o modelo original. Carregue o GLB de origem para visualizar este lado.
                    </div>
                  </div>
                  <button type="button" class="model-rigging-secondary model-retarget-preview-play" :disabled="!retargetSourceRoot" @click="toggleRetargetSourcePreviewPlayback">{{ retargetSourcePreviewPlaying ? 'Ⅱ Pausar origem' : '▶ Reproduzir origem' }}</button>
                </article>
                <article class="model-retarget-preview-card">
                  <header class="model-retarget-preview-heading">
                    <strong>02 · No modelo de destino</strong>
                    <small>Prévia temporária — ainda não salva</small>
                  </header>
                  <div class="model-retarget-preview-viewport">
                    <canvas ref="retargetTargetPreviewCanvas" aria-label="Prévia da animação retargetada no modelo de destino"></canvas>
                    <div v-if="!model" class="model-retarget-preview-overlay">Carregue o modelo de destino para ver a animação aplicada a ele.</div>
                  </div>
                  <p class="model-retarget-preview-status">{{ retargetPreviewStatus }}</p>
                  <button type="button" class="model-rigging-secondary model-retarget-preview-play" :disabled="!model" @click="toggleRetargetTargetPreviewPlayback">{{ retargetTargetPreviewPlaying ? 'Ⅱ Pausar destino' : '▶ Reproduzir destino' }}</button>
                </article>
              </div>
              <div class="model-retarget-actions">
                <button type="button" class="model-rigging-secondary" :disabled="!retargetSourceRoot || !retargetSourceClip || !!selectedRetargetLibraryId || retargetLoading || retargetAutonomousLoading" @click="saveRetargetAnimationToLibrary">Guardar na biblioteca</button>
                <button type="button" class="model-rigging-primary" :disabled="!model || !retargetSourceClip || !retargetTargetBones.length || !hasRetargetMapping || isReadOnlyPreview || retargetLoading || retargetAutonomousLoading" @click="applyRetargetedAnimation">Retargetar manualmente e adicionar ao rig</button>
              </div>
              <button type="button" class="model-rigging-primary model-retarget-autonomous-button" :disabled="!model || !retargetSourceClip || !retargetSourceNodeNames.length || isReadOnlyPreview || loading || retargetLoading || retargetAutonomousLoading || skinTokensLoading" @click="runAutonomousRetargeting">
                <span v-if="retargetAutonomousLoading" class="model-skintokens-button-spinner" aria-hidden="true"></span>
                {{ retargetAutonomousLoading ? 'Executando retargeting autônomo…' : '✦ Executar fluxo autônomo (IA + retargeting)' }}
              </button>
              <div v-if="retargetAutonomousLoading" class="model-skintokens-loading" role="status" aria-live="polite" aria-busy="true">
                <div class="model-skintokens-loading-heading">
                  <span class="model-skintokens-spinner" aria-hidden="true"></span>
                  <strong>Fluxo autônomo em execução</strong>
                </div>
                <p>{{ retargetAutonomousStage }}</p>
                <div class="model-skintokens-progress-track" aria-hidden="true"><span></span></div>
                <small>O rig local só será gerado por IA se o modelo A ainda não tiver malha esquelética utilizável. Os arquivos permanecem no computador.</small>
              </div>
              <p class="model-control-note">O fluxo autônomo prepara o rig do modelo A com SkinTokens local quando necessário, associa os ossos por anatomia, hierarquia e geometria, transfere o clipe e informa a cobertura do mapeamento. A biblioteca local também permite reutilizar animações neste dispositivo.</p>
              <p v-if="retargetMessage" class="model-rigging-status">{{ retargetMessage }}</p>
            </div>
            <div class="model-rigging-separator"></div>
            <section class="model-retarget-panel model-skintokens-panel">
              <div class="model-rigging-subtitle">RIGGING POR IA LOCAL · GRATUITO</div>
              <p class="model-panel-hint">SkinTokens/TokenRig gera esqueleto e pesos de deformação com um modelo aberto executado no seu computador. Não usa chave de API, créditos ou plano pago.</p>
              <label class="model-rigging-field">Executável SkinTokens
                <input v-model.trim="skinTokensExecutablePath" type="text" spellcheck="false" :disabled="skinTokensLoading || loading" placeholder="C:\...\skintokens\target\release\skintokens.exe" />
              </label>
              <div class="model-retarget-actions">
                <button type="button" class="model-rigging-secondary" :disabled="!isTauri() || skinTokensLoading || loading" @click="chooseSkinTokensExecutable">Selecionar executável</button>
                <button type="button" class="model-rigging-secondary" :disabled="!isTauri() || !skinTokensExecutablePath.trim() || skinTokensLoading || loading" @click="testSkinTokensBackend">Testar backend local</button>
              </div>
              <label class="model-rigging-field">Operação de IA
                <select v-model="skinTokensOperation" :disabled="skinTokensLoading || loading">
                  <option value="rig">Gerar esqueleto + pesos (modelo sem rig)</option>
                  <option value="skin">Melhorar pesos do rig existente</option>
                </select>
              </label>
              <label v-if="skinTokensOperation === 'rig'" class="model-rigging-field">Classe do modelo
                <select v-model="skinTokensClassChoice" :disabled="skinTokensLoading || loading">
                  <option v-for="option in skinTokensClassOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <p v-if="skinTokensOperation === 'rig' && skinTokensClassChoice === 'auto' && rigInputAnalysis" class="model-control-note">Classe detectada: <strong>{{ skinTokensResolvedClass }}</strong>. {{ rigInputAnalysis.reason }}</p>
              <button type="button" class="model-rigging-primary" :disabled="!model || !!props.initialAsset || !isTauri() || loading || skinTokensLoading || !skinTokensExecutablePath.trim() || !skinTokensRigCompatible" @click="runSkinTokensRigging">
                <span v-if="skinTokensLoading" class="model-skintokens-button-spinner" aria-hidden="true"></span>
                {{ skinTokensLoading ? (skinTokensMessage.startsWith('Verificando') ? 'Verificando backend…' : 'Processando modelo…') : skinTokensOperation === 'rig' ? 'Gerar rig com SkinTokens' : 'Recalcular pesos com SkinTokens' }}
              </button>
              <div v-if="skinTokensLoading" class="model-skintokens-loading" role="status" aria-live="polite" aria-busy="true">
                <div class="model-skintokens-loading-heading">
                  <span class="model-skintokens-spinner" aria-hidden="true"></span>
                  <div class="model-skintokens-loading-copy">
                    <strong>{{ skinTokensMessage.startsWith('Verificando') ? 'Verificando o backend local' : skinTokensOperation === 'rig' ? 'Gerando esqueleto e pesos' : 'Recalculando pesos de deformação' }}</strong>
                    <small>SkinTokens está trabalhando no computador</small>
                  </div>
                  <span class="model-skintokens-live-pill"><i></i> ATIVO</span>
                </div>
                <div class="model-skintokens-progress-track" role="progressbar" aria-label="Processamento local em andamento" aria-valuetext="Progresso indeterminado">
                  <span></span>
                </div>
                <p>{{ skinTokensMessage }}</p>
                <small class="model-skintokens-loading-note">A barra é indeterminada: o backend não fornece porcentagem real. Não feche o importador até a operação terminar.</small>
              </div>
              <p v-if="!skinTokensLoading && !skinTokensRigCompatible && model && !props.initialAsset" class="model-control-note">{{ skinTokensOperation === 'rig' ? 'Para gerar rig, o modelo deve conter malhas estáticas sem esqueleto. Modelos já rigados usam a opção de melhorar pesos.' : 'A operação de pesos exige que o modelo já tenha uma malha esquelética.' }}</p>
              <p v-if="skinTokensMessage && !skinTokensLoading" class="model-rigging-status">{{ skinTokensMessage }}</p>
              <p class="model-control-note">Instalação única no Windows: execute <code>powershell -ExecutionPolicy Bypass -File .\scripts\install-skintokens.ps1</code> na pasta do repositório. O instalador compila o backend em CPU e baixa os pesos abertos (aprox. 1,1 GB); depois é possível trabalhar offline. Sua RTX 3060 de 6 GB não é requisito, pois esta versão usa CPU.</p>
              <a class="model-control-note" href="https://github.com/chris-straka/skintokens" target="_blank" rel="noreferrer">Código-fonte e detalhes de licença do backend</a>
            </section>
            <div class="model-rigging-separator"></div>
            <label class="model-rigging-field">Modelo de rig
              <select v-model="rigPreset" :disabled="!model || !!props.initialAsset || loading" title="Escolha a estrutura de rig sugerida para o tipo de modelo selecionado.">
                <option v-for="option in rigPresetOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <button type="button" class="model-rigging-primary" :disabled="!model || !!props.initialAsset || loading" title="Gera um rig inicial para permitir selecionar ossos, ajustar poses e criar clipes." @click="createRig">
              {{ rigBones.length ? 'Recarregar rig existente' : 'Criar rig automático' }}
            </button>
            <p v-if="rigPreset === 'auto' && rigInputAnalysis" class="model-control-note">Detecção sugerida: <strong>{{ rigInputAnalysis.recommendedPreset }}</strong>. {{ rigInputAnalysis.reason }} Medidas aproximadas: {{ rigInputAnalysis.dimensions.width.toFixed(2) }} × {{ rigInputAnalysis.dimensions.height.toFixed(2) }} × {{ rigInputAnalysis.dimensions.depth.toFixed(2) }}; {{ rigInputAnalysis.meshCount }} malha(s).</p>
            <p class="model-control-note">O modo “Por peças” é indicado quando cada parte articulada é uma malha separada: cada uma recebe seu próprio pivô e pesos rígidos. Para malhas orgânicas únicas, os pesos por proximidade são apenas uma base inicial; confira a deformação e ajuste as juntas. Modelos arbitrários não podem ser rigados perfeitamente apenas por heurísticas.</p>

            <template v-if="rigBones.length">
              <div class="model-rigging-summary">
                <span><small>OSSOS</small><strong>{{ rigBones.length }}</strong></span>
                <span><small>QUADROS</small><strong>{{ rigKeyframes.length }}</strong></span>
                <span><small>CLIPES</small><strong>{{ previewAnimations.length }}</strong></span>
              </div>

              <label class="model-rigging-field">Osso selecionado
                <select v-model="selectedRigBoneName" title="Seleciona o osso do rig que receberá os ajustes de posição e rotação.">
                  <option v-for="bone in rigBones" :key="bone.uuid" :value="bone.name">{{ bone.name }}</option>
                </select>
              </label>
              <div v-if="selectedRigBone" class="model-rigging-rotation">
                <div class="model-rigging-subtitle">POSIÇÃO LOCAL · UNIDADES</div>
                <label>X<input v-model.number="bonePositionDraft.x" type="number" step="0.05" :disabled="model?.userData.importRigGenerated !== true" @change="applySelectedBoneTransform" /></label>
                <label>Y<input v-model.number="bonePositionDraft.y" type="number" step="0.05" :disabled="model?.userData.importRigGenerated !== true" @change="applySelectedBoneTransform" /></label>
                <label>Z<input v-model.number="bonePositionDraft.z" type="number" step="0.05" :disabled="model?.userData.importRigGenerated !== true" @change="applySelectedBoneTransform" /></label>
                <div class="model-rigging-subtitle">ROTAÇÃO LOCAL · GRAUS</div>
                <label>X<input v-model.number="boneRotationDraft.x" type="number" step="5" @change="applySelectedBoneTransform" /></label>
                <label>Y<input v-model.number="boneRotationDraft.y" type="number" step="5" @change="applySelectedBoneTransform" /></label>
                <label>Z<input v-model.number="boneRotationDraft.z" type="number" step="5" @change="applySelectedBoneTransform" /></label>
              </div>
              <button type="button" class="model-rigging-secondary" title="Retorna o rig à pose inicial de referência." @click="resetRigPose">Restaurar pose inicial</button>
              <div class="model-rigging-separator"></div>

              <div class="model-rigging-subtitle">LINHA DO TEMPO</div>
              <label class="model-rigging-field">Tempo do quadro (segundos)
                <input :value="rigFrameTime" type="number" min="0" max="120" step="0.1" @change="setRigTime(Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label class="model-rigging-field">Duração do clipe (segundos)
                <input v-model.number="rigDuration" type="number" min="0.1" max="120" step="0.1" />
              </label>
              <button type="button" class="model-rigging-primary" title="Grava a pose atual do rig como um quadro-chave no tempo indicado." @click="recordRigKeyframe">＋ Gravar pose neste tempo</button>
              <div v-if="rigKeyframes.length" class="model-rigging-frames">
                <button v-for="frame in rigKeyframes" :key="frame.time" type="button" @click="applyRigFrame(frame)" :class="{ active: Math.abs(rigFrameTime - frame.time) < 0.001 }">
                  <strong>{{ frame.time.toFixed(2) }} s</strong><span>Aplicar pose</span>
                </button>
              </div>
              <p class="model-control-note">Exemplo: grave uma pose em 0 s, gire os ossos, mude para 0,5 s e grave outra. O motor interpola entre as poses.</p>

              <div class="model-rigging-separator"></div>
              <div class="model-rigging-subtitle">SALVAR COMO NOVA ANIMAÇÃO</div>
              <label class="model-rigging-field">Nome
                <input v-model.trim="rigClipName" maxlength="80" placeholder="Ex.: Montar cavalo" />
              </label>
              <label class="model-rigging-field">Papel no jogo
                <select v-model="rigClipRole">
                  <option v-for="role in animationRoleBaseOptions.filter(option => option.value !== 'ignore')" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
              </label>
              <button type="button" class="model-rigging-primary" :disabled="rigKeyframes.length < 2 || !!props.initialAsset" title="Cria uma animação interpolando os quadros-chave gravados." @click="createRigAnimation">Criar clipe de animação</button>
              <button type="button" class="model-rigging-secondary" title="Limpa os quadros-chave atuais para começar outro clipe." @click="clearRigKeyframesForNewClip">Nova animação / limpar quadros</button>
              <p class="model-control-note">Para sincronizar a montagem, crie um clipe com o papel “Montar / subir” no jogador e outro com o mesmo papel no cavalo. O pacote Montaria dispara os dois quando o jogador monta.</p>
              <p v-if="rigMessage" class="model-rigging-status">{{ rigMessage }}</p>
            </template>
            <div v-else class="model-setup-empty">
              <strong>Nenhum rig carregado</strong>
              <small>Escolha Humanoide, Quadrúpede ou Corrente genérica e crie o rig. Se o modelo já tiver um esqueleto glTF, a ferramenta detectará os ossos existentes.</small>
            </div>
          </section>

          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>04</span> NOME DO COMPONENTE</div>
            <label class="model-component-name-field">Nome na biblioteca
              <input v-model.trim="componentName" maxlength="80" placeholder="Ex.: Taverna medieval" :disabled="!model || isReadOnlyPreview" />
            </label>
            <p class="model-panel-hint">Esse nome será usado na biblioteca e nas novas cópias colocadas no mundo.</p>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section model-behavior-packages-section">
            <div class="model-panel-heading"><span>04B</span> PACOTES DE COMPORTAMENTO <b>{{ selectedBehaviorPackageIds.length }}</b></div>
            <p class="model-panel-hint">Selecione os sistemas que este componente deve receber e configure aqui suas variáveis, controles, posição e estados visuais. As configurações também poderão ser ajustadas depois no painel Pacotes.</p>
            <div v-if="BEHAVIOR_PACKAGE_DEFINITIONS.length" class="model-behavior-package-list">
              <label
                v-for="definition in BEHAVIOR_PACKAGE_DEFINITIONS"
                :key="definition.id"
                class="model-behavior-package-card"
                :class="{ selected: selectedBehaviorPackageIds.includes(definition.id) }"
                :title="definition.description"
              >
                <input
                  type="checkbox"
                  :checked="selectedBehaviorPackageIds.includes(definition.id)"
                  :disabled="!model || isReadOnlyPreview"
                  @change="toggleImportBehaviorPackage(definition.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="model-behavior-package-check" aria-hidden="true">{{ selectedBehaviorPackageIds.includes(definition.id) ? '✓' : '' }}</span>
                <span class="model-behavior-package-copy">
                  <strong>{{ definition.name }}</strong>
                  <small>{{ definition.description }}</small>
                  <span class="model-behavior-package-meta">{{ definition.variables.length }} variáveis · {{ definition.triggers.length }} gatilhos · {{ definition.conditions.length }} condições · {{ definition.actions.length }} ações</span>
                </span>
              </label>
            </div>
            <div v-else class="model-setup-empty">
              <strong>Nenhum pacote disponível</strong>
              <small>Os pacotes instalados no motor aparecerão aqui quando estiverem disponíveis.</small>
            </div>

            <div v-if="selectedBehaviorPackageDefinitions.length" class="model-package-settings-list">
              <article v-for="definition in selectedBehaviorPackageDefinitions" :key="definition.id" class="model-package-settings-card">
                <div class="model-package-settings-header">
                  <div><strong>{{ definition.name }}</strong><small>Configurações deste pacote para o componente</small></div>
                  <span class="model-package-settings-badge">ATIVO</span>
                </div>

                <div class="model-package-subheading">VARIÁVEIS</div>
                <div v-for="variable in definition.variables" :key="variable.name" class="model-package-variable">
                  <label v-if="variable.type === 'boolean'" class="model-package-toggle">
                    <input
                      type="checkbox"
                      :checked="importPackageVariableValue(definition.id, variable.name, variable.defaultValue) === true"
                      :disabled="variable.readOnly === true || isReadOnlyPreview"
                      @change="updateImportPackageVariable(definition.id, variable, $event)"
                    />
                    <span><strong>{{ variable.label }}</strong><small>{{ variable.description }}</small></span>
                  </label>
                  <label v-else class="model-package-field">
                    <span><strong>{{ variable.label }}</strong><small>{{ variable.description }}</small></span>
                    <input
                      :type="variable.type === 'number' ? 'number' : 'text'"
                      :value="String(importPackageVariableValue(definition.id, variable.name, variable.defaultValue))"
                      :min="variable.min"
                      :max="variable.max"
                      :step="variable.step"
                      :disabled="variable.readOnly === true || isReadOnlyPreview"
                      @change="updateImportPackageVariable(definition.id, variable, $event)"
                    />
                  </label>
                </div>

                <template v-if="definition.id === 'mount'">
                  <div class="model-package-subheading">CONTROLES E INTERAÇÃO</div>
                  <label class="model-package-field">
                    <span><strong>Tecla para montar / desmontar</strong><small>Também atualiza o comando de interação do pacote.</small></span>
                    <select
                      :value="String(importPackageConfigValue(definition.id, 'interactionKey', 'KeyE'))"
                      :disabled="isReadOnlyPreview"
                      @change="setImportPackageInteractionKey(definition.id, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="KeyE">E</option><option value="KeyF">F</option><option value="KeyR">R</option><option value="KeyQ">Q</option><option value="KeyG">G</option>
                    </select>
                  </label>
                  <div class="model-package-subheading">POSIÇÃO DO JOGADOR</div>
                  <p class="model-panel-hint">Deslocamento relativo ao centro da montaria. Ajuste para posicionar o jogador sobre a sela.</p>
                  <div class="model-package-vector">
                    <label>X<input type="number" step="0.05" :value="importPackageVectorValue(definition.id, 'seatOffset', 0, 0)" :disabled="isReadOnlyPreview" @change="setImportPackageVector(definition.id, 'seatOffset', 0, $event)" /></label>
                    <label>Y<input type="number" step="0.05" :value="importPackageVectorValue(definition.id, 'seatOffset', 1, 0.55)" :disabled="isReadOnlyPreview" @change="setImportPackageVector(definition.id, 'seatOffset', 1, $event)" /></label>
                    <label>Z<input type="number" step="0.05" :value="importPackageVectorValue(definition.id, 'seatOffset', 2, 0)" :disabled="isReadOnlyPreview" @change="setImportPackageVector(definition.id, 'seatOffset', 2, $event)" /></label>
                  </div>

                  <div class="model-package-subheading">MAPEAMENTO DAS TECLAS DA MONTARIA</div>
                  <div class="model-package-bindings">
                    <label v-for="binding in importPackageControlBindingFields" :key="binding.key" class="model-package-field">
                      <span><strong>{{ binding.label }}</strong><small>Tecla física do teclado</small></span>
                      <input
                        :value="importPackageControlBindingValue(definition.id, binding.key)"
                        maxlength="32"
                        :disabled="isReadOnlyPreview"
                        :placeholder="DEFAULT_MODEL_CONTROL_BINDINGS[binding.key]"
                        @change="setImportPackageControlBinding(definition.id, binding.key, $event)"
                      />
                    </label>
                  </div>

                  <div class="model-package-subheading">ESTADOS VISUAIS DO MODELO</div>
                  <p class="model-panel-hint">Mostre ou oculte partes do GLB conforme uma variável do pacote, por exemplo: exibir o cavaleiro quando <code>mounted = true</code>.</p>
                  <button type="button" class="model-package-add-state" :disabled="!previewPackageModelNodes.length || isReadOnlyPreview" @click="addImportPackageModelState(definition.id)">＋ Adicionar estado visual</button>
                  <p v-if="!previewPackageModelNodes.length" class="model-panel-hint">O modelo precisa conter grupos ou malhas na hierarquia para criar estados visuais.</p>
                  <div v-for="state in importPackageModelStates(definition.id)" :key="state.id" class="model-package-state">
                    <label class="model-package-field">
                      <span><strong>Parte / grupo do GLB</strong></span>
                      <select :value="state.nodePath" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { nodePath: ($event.target as HTMLSelectElement).value })">
                        <option v-for="node in previewPackageModelNodes" :key="node.path" :value="node.path">{{ node.name }} · {{ node.meshCount }} malha(s)</option>
                      </select>
                    </label>
                    <label class="model-package-field">
                      <span><strong>Variável da condição</strong></span>
                      <select :value="state.variable" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { variable: ($event.target as HTMLSelectElement).value })">
                        <option v-for="variable in definition.variables" :key="variable.name" :value="variable.name">{{ variable.name }}</option>
                      </select>
                    </label>
                    <div class="model-package-state-grid">
                      <label class="model-package-field">
                        <span><strong>Comparação</strong></span>
                        <select :value="state.operator" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { operator: ($event.target as HTMLSelectElement).value as 'equals' | 'not_equals' })">
                          <option value="equals">Igual a</option><option value="not_equals">Diferente de</option>
                        </select>
                      </label>
                      <label class="model-package-field">
                        <span><strong>Valor esperado</strong></span>
                        <input type="text" :value="String(state.value)" :disabled="isReadOnlyPreview" @change="onImportPackageModelStateValueChange(definition.id, state.id, $event)" />
                      </label>
                    </div>
                    <label class="model-package-toggle">
                      <input type="checkbox" :checked="state.visibleWhenMatched" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { visibleWhenMatched: ($event.target as HTMLInputElement).checked })" />
                      <span><strong>Exibir quando a condição for verdadeira</strong></span>
                    </label>
                    <button type="button" class="model-package-remove-state" :disabled="isReadOnlyPreview" @click="removeImportPackageModelState(definition.id, state.id)">Remover estado ×</button>
                  </div>
                </template>

                <template v-for="(defaultValue, configKey) in definition.defaultConfig" :key="configKey">
                  <label v-if="isSimplePackageConfigValue(configKey, defaultValue)" class="model-package-field">
                    <span><strong>{{ formatPackageConfigLabel(configKey) }}</strong><small>Configuração do pacote</small></span>
                    <input
                      :type="typeof defaultValue === 'number' ? 'number' : 'text'"
                      :value="String(importPackageConfigValue(definition.id, configKey, defaultValue))"
                      :disabled="isReadOnlyPreview"
                      @change="updateImportPackageConfigScalar(definition.id, configKey, defaultValue, $event)"
                    />
                  </label>
                </template>
              </article>
            </div>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>04A</span> IMAGEM DE PREVIEW</div>
            <input
              ref="thumbnailFileInput"
              class="model-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              @change="chooseThumbnailImage"
            />
            <div class="model-preview-image-config">
              <div class="model-preview-image-frame">
                <img v-if="customThumbnail" :src="customThumbnail" alt="Prévia da imagem escolhida" />
                <span v-else>▧</span>
              </div>
              <div class="model-preview-image-copy">
                <strong :title="customThumbnailFileName">{{ customThumbnailFileName || 'Prévia 3D automática' }}</strong>
                <small>{{ customThumbnail ? 'Esta imagem aparecerá na biblioteca de componentes.' : 'Escolha uma imagem para usar no cartão do componente.' }}</small>
                <div class="model-preview-image-actions">
                  <button type="button" :disabled="!model || isReadOnlyPreview" title="Escolhe uma imagem JPG, PNG ou WEBP do computador para o cartão do componente." @click="thumbnailFileInput?.click()">Escolher imagem</button>
                  <button v-if="customThumbnail" type="button" :disabled="isReadOnlyPreview" title="Remove a imagem escolhida e volta a gerar a miniatura a partir da prévia 3D." @click="clearCustomThumbnail">Usar 3D</button>
                </div>
              </div>
            </div>
            <p v-if="thumbnailImageError" class="model-preview-image-error">{{ thumbnailImageError }}</p>
            <p class="model-panel-hint">A imagem é reduzida para 256 × 256 px para não ocupar muito espaço. Se nenhuma for escolhida, o editor usa a captura da prévia 3D.</p>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>05</span> TRANSFORMAÇÃO</div>
            <label class="model-height-label"><span>Altura final</span><strong>{{ modelHeight.toFixed(2) }} <small>u</small></strong></label>
            <div class="model-height-entry">
              <input class="model-height-number" type="number" min="0.1" max="10000" step="0.01" :value="modelHeight" :disabled="!model" title="Digite a altura final em unidades do mundo, até 10.000 unidades." @change="setModelHeight(Number(($event.target as HTMLInputElement).value))" />
              <span>unidades (u)</span>
            </div>
            <input v-model.number="modelHeight" class="model-height-slider" type="range" min="0.1" max="10" step="0.1" :disabled="!model" title="Ajuste rápido para tamanhos comuns até 10 unidades; use o campo numérico para valores maiores." />
            <p class="model-height-unit-note">Para modelos gigantes, digite o tamanho em unidades no campo acima.</p>
            <div class="model-height-presets"><button v-for="size in [0.5, 1, 1.8, 2, 3, 5]" :key="size" :class="{ active: Math.abs(modelHeight - size) < 0.05 }" :disabled="!model" @click="modelHeight = size">{{ size }}u</button></div>
            <div class="model-import-dimensions">
              <div><small>LARGURA X</small><strong>{{ previewComponentDimensions.x ? previewComponentDimensions.x.toFixed(2) : '—' }}</strong></div>
              <div><small>ALTURA Y</small><strong>{{ model ? previewComponentDimensions.y.toFixed(2) : '—' }}</strong></div>
              <div><small>PROF. Z</small><strong>{{ previewComponentDimensions.z ? previewComponentDimensions.z.toFixed(2) : '—' }}</strong></div>
            </div>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section model-collider-section">
            <div class="model-panel-heading"><span>06</span> COLISOR FÍSICO</div>
            <p class="model-collider-help">Escolha como o jogador e os objetos vão interagir com este modelo. Para cidades, prédios agrupados e terrenos importados, use <strong>Malha estática (cidade)</strong>: a colisão usa os triângulos reais e uma árvore BVH para consultar apenas a geometria próxima, preservando ruas e espaços vazios. Use apenas em cenários que não sejam animados. O contorno verde representa a colisão.</p>
            <label class="model-collider-field">Forma
              <select :value="colliderType" :disabled="!model" title="Escolha o formato da área física de colisão usada no jogo." @change="changeColliderType(($event.target as HTMLSelectElement).value as 'box' | 'sphere' | 'capsule' | 'mesh' | 'none')">
                <option value="box">Caixa</option>
                <option value="sphere">Esfera</option>
                <option value="capsule">Cápsula</option>
                <option value="mesh">Malha estática (cidade)</option>
                <option value="none">Sem colisão</option>
              </select>
            </label>
            <p v-if="colliderPreviewNotice" class="model-collider-example" role="status" aria-live="polite">{{ colliderPreviewNotice }}</p>
            <template v-if="colliderType !== 'mesh'">
              <div class="model-collider-subtitle">{{ colliderType === 'sphere' ? 'DIÂMETRO DA ESFERA (raio = metade)' : 'DIMENSÕES DO COLISOR' }}</div>
            <div class="model-collider-grid">
              <label>{{ colliderType === 'sphere' ? 'Diâmetro X' : 'Largura X' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[0]" :disabled="!model || colliderType === 'none' || colliderType === 'mesh'" @input="setColliderVector('colliderSize', 0, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>{{ colliderType === 'sphere' ? 'Diâmetro Y' : 'Altura Y' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[1]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 1, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>{{ colliderType === 'sphere' ? 'Diâmetro Z' : 'Prof. Z' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[2]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 2, Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
            <div class="model-collider-subtitle">DESLOCAMENTO RELATIVO AO CENTRO DO MODELO</div>
            <div class="model-collider-grid">
              <label>X<input type="number" step="0.1" :value="colliderOffset[0]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 0, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>Y<input type="number" step="0.1" :value="colliderOffset[1]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 1, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>Z<input type="number" step="0.1" :value="colliderOffset[2]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 2, Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
            <p class="model-collider-example">Exemplo: para uma esfera de raio 0,5, informe 1,0 nos três diâmetros. Em uma árvore, ajuste o deslocamento Y para posicionar a esfera no tronco.</p>
            </template>
          </section>
          <div v-if="activeSetupTab === 'technical'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'technical'" class="model-panel-section">
            <div class="model-panel-heading"><span>01</span> INFORMAÇÕES DO ARQUIVO</div>
            <div class="model-asset-info-row"><span>Arquivo</span><strong :title="fileName">{{ fileName || '—' }}</strong></div>
            <div class="model-asset-info-row"><span>Tipo</span><strong>{{ fileName ? (fileName.split('.').pop() || '—').toUpperCase() : '—' }}</strong></div>
            <div class="model-asset-info-row"><span>Geometria</span><strong>{{ diagnosticSummary.meshes }} malhas</strong></div>
            <div class="model-asset-info-row"><span>Materiais</span><strong>{{ diagnosticSummary.materials }}</strong></div>
            <div class="model-asset-info-row"><span>Texturas</span><strong>{{ diagnosticSummary.textures }}</strong></div>
            <div class="model-asset-info-row"><span>Animações</span><strong>{{ diagnosticSummary.clips }}</strong></div>
          </section>
          <div v-if="activeSetupTab === 'technical'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'technical'" class="model-panel-section model-diagnostic-section">
            <div class="model-panel-heading"><span>02</span> DIAGNÓSTICO E TEXTURAS</div>
                      <details class="model-diagnostics">
            <summary>DIAGNÓSTICO TÉCNICO DO MODELO</summary>
            <div class="model-diagnostics-summary">
              <span>Nós <b>{{ diagnosticSummary.nodes }}</b></span>
              <span>Malhas <b>{{ diagnosticSummary.meshes }}</b></span>
              <span>Skinned <b>{{ diagnosticSummary.skinned }}</b></span>
              <span>Materiais <b>{{ diagnosticSummary.materials }}</b></span>
              <span>Texturas <b>{{ diagnosticSummary.textures }}</b></span>
              <span>Animações <b>{{ diagnosticSummary.clips }}</b></span>
            </div>
            <p class="model-diagnostics-hint">URI data: indica imagem incorporada no JSON; URI externa indica arquivo referenciado. Imagens presentes no ZIP só serão usadas como cor se algum material as referenciar em baseColorTexture.</p>
            <div v-if="model" class="model-diagnostics-list">
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>GLTF</b><span>Imagens e texturas declaradas no arquivo</span></div>
                <template v-for="image in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.images ?? [])" :key="'image-' + image.index">
                  <small>Imagem {{ image.index }}: {{ image.name || '(sem nome)' }} · {{ image.mimeType || (image.uri.startsWith('data:') ? (image.uri.slice(5, image.uri.indexOf(';')) || 'tipo não declarado') : 'tipo não declarado') }} · {{ image.uri.startsWith('data:') ? 'incorporada (data URI)' : image.uri ? 'URI externa' : image.bufferView !== null ? 'incorporada por bufferView' : 'origem não identificada' }}</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.images?.length)">Nenhuma imagem declarada no JSON glTF.</small>
              </div>
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>MAPAS</b><span>Associação original de texturas por material</span></div>
                <template v-for="material in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.materials ?? [])" :key="'material-' + material.index">
                  <small>{{ material.name || ('Material ' + material.index) }}: cor={{ material.baseColorTexture ?? (((model.userData.importRecoveredColorTextures as Record<string, number> | undefined)?.[String(material.index)] !== undefined) ? 'imagem recuperada ' + (model.userData.importRecoveredColorTextures as Record<string, number>)[String(material.index)] : 'nenhuma') }}, normal={{ material.normalTexture ?? 'nenhuma' }}, oclusão={{ material.occlusionTexture ?? 'nenhuma' }}, emissiva={{ material.emissiveTexture ?? 'nenhuma' }}{{ material.baseColorFactor ? ', fator=' + material.baseColorFactor.join('/') : '' }}</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.materials?.length)">Nenhum material declarado no JSON glTF.</small>
              </div>
              <div v-if="materialsMissingColorTexture.length && recoverableColorImages.length" class="model-diagnostic-row model-texture-repair">
                <div class="model-diagnostic-title"><b>RECUPERAÇÃO</b><span>Aplicar imagem como cor principal</span></div>
                <p>O glTF não associa imagens à cor principal de alguns materiais. Selecione uma imagem para testar no material; os mapas normais e de oclusão serão mantidos.</p>
                <div v-for="material in materialsMissingColorTexture" :key="'repair-' + material.index" class="model-texture-repair-item">
                  <label :for="'repair-image-' + material.index">{{ material.name || ('Material ' + material.index) }}</label>
                  <select :id="'repair-image-' + material.index" v-model="textureRepairSelections[String(material.index)]" :disabled="textureRepairBusy">
                    <option value="">Selecionar imagem…</option>
                    <option v-for="image in recoverableColorImages" :key="image.index" :value="String(image.index)">Imagem {{ image.index }} · {{ image.mimeType || 'imagem' }}</option>
                  </select>
                  <button type="button" :disabled="textureRepairBusy || !textureRepairSelections[String(material.index)]" @click="applyRecoveredColorTexture(material.index)">{{ textureRepairBusy ? 'Aplicando…' : 'Aplicar textura' }}</button>
                </div>
                <small v-if="textureRepairMessage" class="model-texture-repair-message">{{ textureRepairMessage }}</small>
              </div>
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>CLIPS</b><span>Clipes de animação originais</span></div>
                <template v-for="clip in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.animations ?? [])" :key="'clip-' + clip.index">
                  <small>{{ clip.name || ('Animação ' + clip.index) }} · {{ clip.channels }} canais</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.animations?.length)">Nenhuma animação declarada no JSON glTF.</small>
              </div>
            </div>
            <div v-if="modelDiagnostics.length" class="model-diagnostics-list">
              <div v-for="item in modelDiagnostics" :key="item.id" class="model-diagnostic-row">
                <div class="model-diagnostic-title" :style="{ paddingLeft: (item.depth * 10) + 'px' }">
                  <b>{{ item.type }}</b><span>{{ item.name }}</span>
                </div>
                <small v-if="item.meshInfo">{{ item.meshInfo }}</small>
                <small v-if="item.materials">{{ item.materials }}</small>
              </div>
            </div>
          </details>
          </section>
          <p v-if="error" class="model-import-error">{{ error }}</p>
          <p class="model-import-tip">{{ isEditingSavedComponent ? 'Modo de edição: nome, controles, papéis de animação, miniatura e pacotes serão salvos no componente existente. A malha original será preservada.' : props.initialAsset ? 'Modo de pré-visualização: explore as abas, os clipes e os controles salvos. Nenhuma alteração será aplicada ao mundo.' : 'Configure o modelo, os controles e os clipes. A prévia não altera o mundo; salvar cria um componente reutilizável na biblioteca.' }}</p>
        </aside>
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
</template>

<style>
.model-import-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:18px;background:#090b0ff0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e5e7eb}
.model-import-dialog{display:flex;flex-direction:column;width:min(1500px,98vw);height:min(900px,96vh);min-height:540px;overflow:hidden;border:1px solid #343944;border-radius:8px;background:#17191e;box-shadow:0 30px 100px #000b}
.model-import-tabs{display:flex;gap:5px;padding:7px 12px;border-bottom:1px solid #30343c;background:#191c22;overflow-x:auto;flex:none}.model-import-tab{display:flex;flex-direction:column;gap:3px;min-width:112px;padding:7px 10px;border:1px solid #363c47;border-radius:4px;background:#20242b;color:#cbd1db;text-align:left;cursor:pointer}.model-import-tab strong{font-size:10px;font-weight:700}.model-import-tab small{color:#8d96a4;font-size:8px;white-space:nowrap}.model-import-tab.active{border-color:#9b704d;background:#3a2c22;color:#ffe0c3}.model-import-tab.active small{color:#c9a17c}.model-import-tab:disabled{opacity:.4;cursor:not-allowed}
.model-control-bindings{display:flex;flex-direction:column;gap:6px;margin-top:12px}.model-control-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px;border:1px solid #343943;border-radius:4px;background:#202329}.model-control-copy{display:flex;flex-direction:column;gap:4px;min-width:0}.model-control-copy strong{color:#e0e4eb;font-size:10px;font-weight:650}.model-control-copy small{color:#8f98a6;font-size:8px;line-height:1.4}.model-control-key{flex:none;min-width:76px;padding:8px;border:1px solid #6c543e;border-radius:4px;background:#33271e;color:#f5c79a;font:700 10px ui-monospace,monospace;cursor:pointer}.model-control-key.listening{border-color:#d19a64;background:#59412b;color:#fff0dd;animation:model-key-pulse 1s ease-in-out infinite alternate}.model-control-key:disabled{opacity:.5;cursor:not-allowed}.model-control-capture-tip{padding:8px;border:1px solid #805b3d;border-radius:4px;background:#30251e;color:#ffd9b5;font-size:9px;line-height:1.5}.model-control-note{margin:10px 0;color:#949dab;font-size:9px;line-height:1.6}.model-control-reset{width:100%;padding:8px;border:1px solid #424752;border-radius:4px;background:#252932;color:#d1d5dd;font-size:9px;cursor:pointer}.model-control-reset:disabled{opacity:.45;cursor:not-allowed}
.model-animation-mapping-list{display:flex;flex-direction:column;gap:7px;margin-top:12px}.model-animation-map-row{padding:8px;border:1px solid #343943;border-radius:4px;background:#202329}.model-animation-map-row.active{border-color:#9b704d;background:#2b251f}.model-animation-map-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px}.model-animation-map-head strong{overflow:hidden;color:#e0e4eb;font-size:10px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.model-animation-map-head small{flex:none;color:#999fac;font:9px ui-monospace,monospace}.model-animation-map-row select{width:100%;padding:7px;border:1px solid #414752;border-radius:4px;background:#191c22;color:#e7e9ef;font-size:9px}.model-animation-map-row select:disabled{opacity:.55}.model-animation-map-row button{width:100%;margin-top:6px;padding:7px;border:1px solid #414752;border-radius:4px;background:#292d35;color:#d4dae3;font-size:9px;cursor:pointer}.model-animation-map-row button:hover{border-color:#9b704d;background:#3a2c22}.model-setup-empty{display:flex;flex-direction:column;gap:6px;padding:20px 10px;border:1px dashed #414752;border-radius:4px;color:#a8b0bd;text-align:center}.model-setup-empty strong{font-size:10px}.model-setup-empty small{font-size:9px;line-height:1.5;color:#858f9e}@keyframes model-key-pulse{from{box-shadow:0 0 0 0 #d19a6430}to{box-shadow:0 0 0 3px #d19a6440}}

.model-import-header{display:flex;align-items:center;gap:20px;padding:13px 18px;border-bottom:1px solid #30343c;background:#1b1e24}
.model-import-brand{display:flex;align-items:center;gap:11px;min-width:0;flex:1}.model-import-brand-icon{display:grid;place-items:center;width:34px;height:34px;border:1px solid #805b3d;border-radius:5px;background:#30251e;color:#e0a36b;font-weight:800;font-size:19px}
.model-import-kicker{display:block;color:#bd8a60;font-size:9px;font-weight:750;letter-spacing:.15em}.model-import-header h2{margin:4px 0 0;font-size:17px;line-height:1.2;font-weight:650;letter-spacing:-.02em}
.model-import-header-status{display:flex;align-items:center;gap:8px;color:#9da4b0;font-size:10px}.model-import-status-dot,.toolbar-file-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#626a77}.model-import-status-dot.ready,.toolbar-file-dot{background:#80b89b}.model-import-status-dot.busy{background:#d5a46e;box-shadow:0 0 0 3px #d5a46e20}
.model-import-close{width:29px;height:29px;border:1px solid #3c414b;border-radius:4px;background:#252931;color:#aeb5c1;font-size:21px;cursor:pointer}.model-import-close:hover{background:#353a44;color:#fff}
.model-import-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:7px 14px;border-bottom:1px solid #30343c;background:#202329}.model-import-toolbar-group{display:flex;gap:7px}.model-toolbar-button{display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #414650;border-radius:4px;background:#292d35;color:#d5d9e1;font-size:10px;cursor:pointer}.model-toolbar-button span{color:#d4a171;font-size:14px}.model-toolbar-button:hover{background:#353a43}.model-toolbar-button:disabled{opacity:.45;cursor:wait}.model-toolbar-primary{border-color:#9b704d;background:#493526;color:#ffe0c3}.model-import-toolbar-file{display:flex;align-items:center;gap:8px;max-width:45%;overflow:hidden;color:#9fa7b4;font-size:10px}.model-import-toolbar-file span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.model-import-workspace{display:grid;grid-template-columns:245px minmax(300px,1fr) 275px;flex:1;min-height:0;overflow:hidden}
.model-import-left-panel{min-width:0;overflow:auto;background:#1b1e24;scrollbar-color:#414650 #1b1e24;scrollbar-width:thin}
.model-collider-section{display:flex;flex-direction:column;gap:9px}
.model-collider-help,.model-collider-example{margin:0;color:#9ca5b3;font-size:10px;line-height:1.5}
.model-collider-field{display:flex;flex-direction:column;gap:5px;color:#aeb6c4;font-size:10px}
.model-collider-field select,.model-collider-grid input{width:100%;min-width:0;box-sizing:border-box;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;padding:7px 6px;font:11px ui-monospace,monospace}
.model-collider-subtitle{color:#c69b75;font-size:9px;font-weight:750;letter-spacing:.08em;margin-top:3px}
.model-collider-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.model-collider-grid label{display:flex;flex-direction:column;gap:5px;color:#aeb6c4;font-size:9px;min-width:0}
.model-collider-grid input{padding:7px 4px}
.model-collider-grid input:disabled,.model-collider-field select:disabled{opacity:.45}
.model-import-right-panel{min-width:0;overflow:auto;background:#1b1e24;scrollbar-color:#414650 #1b1e24;scrollbar-width:thin}.model-import-left-panel{border-right:1px solid #30343c}.model-import-right-panel{border-left:1px solid #30343c}.model-panel-section{padding:15px 13px}.model-panel-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px;color:#c8cdd6;font-size:9px;font-weight:800;letter-spacing:.09em}.model-panel-heading>span{color:#bd8a60;font:10px ui-monospace,monospace}.model-panel-heading>b{display:grid;place-items:center;min-width:19px;height:17px;margin-left:auto;padding:0 5px;border-radius:3px;background:#30343d;color:#d8dce4;font-size:9px}.model-panel-separator{height:1px;background:#30343c}.model-panel-hint{margin:9px 0 0;color:#818a98;font-size:9px;line-height:1.65}
.model-file-input{display:none}.model-file-dropzone{display:flex;flex-direction:column;align-items:flex-start;gap:7px;width:100%;padding:13px 10px;border:1px dashed #4a505c;border-radius:5px;background:#20242b;color:#d9dde5;text-align:left;cursor:pointer}.model-file-dropzone:hover{border-color:#b98255;background:#29251f}.model-file-dropzone:disabled{opacity:.5;cursor:wait}.model-dropzone-icon{display:grid;place-items:center;width:28px;height:28px;border:1px solid #66503c;border-radius:4px;background:#33271e;color:#e1aa78;font-size:19px}.model-file-dropzone strong{font-size:10px}.model-file-dropzone small{color:#929aa7;font-size:9px}.model-dropzone-formats{color:#b7bdc8;font-size:8px;line-height:1.5}.model-hierarchy-section{padding-top:14px}.model-preview-parts{display:flex;flex-direction:column;gap:3px;max-height:none;overflow:visible}.model-preview-part{display:flex;align-items:center;gap:2px;min-width:0;padding:3px;border:1px solid transparent;border-radius:3px;background:transparent}.model-preview-part:hover{background:#252930}.model-preview-part.is-selected{border-color:#805b3d;background:#34291f}.model-preview-part-select{display:flex;align-items:center;gap:5px;flex:1;min-width:0;padding:4px 2px;border:0;background:transparent;color:#d5dae3;text-align:left;cursor:pointer}.model-preview-part-index{color:#727c8b;font:8px ui-monospace,monospace}.model-tree-cube{color:#d4a171;font-size:12px}.model-preview-part-name{flex:1;min-width:0;overflow:hidden;color:#cfd4de;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.model-preview-part-select small{flex:none;color:#8d96a5;font-size:8px}.model-preview-part-eye,.model-preview-part-solo{width:20px;height:21px;flex:none;border:1px solid #3b414b;border-radius:3px;background:#262a31;color:#b8c0cc;font-size:9px;cursor:pointer}.model-preview-part-solo.active{border-color:#ba8759;color:#f3c79f}.model-preview-part-delete{width:19px;height:21px;flex:none;border:1px solid transparent;border-radius:3px;background:transparent;color:#a77c78;font-size:15px;line-height:1;cursor:pointer}.model-preview-part-delete:hover{border-color:#6a3936;background:#3c2525;color:#ffb7ad}.model-preview-show-all{width:100%;margin-top:8px;padding:7px;border:1px solid #3c424d;border-radius:3px;background:#272b33;color:#c5cbd5;font-size:9px;cursor:pointer}.model-hierarchy-empty{display:flex;flex-direction:column;align-items:center;padding:24px 10px;text-align:center;color:#697382}.model-hierarchy-empty>span{font-size:25px;color:#4d5664}.model-hierarchy-empty p{margin:8px 0 4px;color:#aab1bd;font-size:10px}.model-hierarchy-empty small{font-size:9px;line-height:1.5}
.model-import-center-panel{display:flex;flex-direction:column;min-width:0;min-height:0;background:#13151a}.model-viewport-topline,.model-viewport-statusbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:31px;padding:0 12px;background:#1b1e24;color:#87909e;font:8px ui-monospace,monospace;letter-spacing:.07em}.model-viewport-topline{border-bottom:1px solid #2b3038}.model-viewport-topline span:first-child,.model-viewport-statusbar span:first-child{display:flex;align-items:center;gap:7px}.model-viewport-topline i,.model-viewport-statusbar i{width:5px;height:5px;border-radius:50%;background:#bd8a60}.model-viewport-statusbar{border-top:1px solid #2b3038;letter-spacing:0}.model-viewport-statusbar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-viewport-statusbar span:last-child{color:#8d96a4}.model-viewport-statusbar b{color:#555e6b}
.model-import-preview{position:relative;flex:1;min-height:280px;overflow:hidden;background-color:#171a20;background-image:radial-gradient(#343943 0.7px,transparent .7px);background-size:18px 18px}.model-import-preview canvas{display:block;width:100%;height:100%;min-height:280px;outline:0}.model-import-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:#171a20b8;pointer-events:none}.model-import-empty button{pointer-events:auto}.upload-glyph{display:grid;place-items:center;width:53px;height:53px;border:1px solid #555d6b;border-radius:9px;background:#22262e;color:#d7a06d;font-size:30px}.model-import-empty strong{font-size:14px;font-weight:600;color:#e1e4ea}.model-import-empty small{color:#929aa8;font-size:10px}.model-import-empty .model-import-primary{margin-top:4px}.preview-animation-controls{position:absolute;top:10px;right:10px;display:flex;align-items:flex-end;gap:6px;padding:7px;border:1px solid #414752;border-radius:4px;background:#1b1e24ed}.preview-animation-controls label{display:flex;flex-direction:column;gap:4px;color:#d4a171;font:8px ui-monospace,monospace;letter-spacing:.06em}.preview-animation-controls select{max-width:210px;padding:6px;border:1px solid #414752;border-radius:3px;background:#252932;color:#e0e4eb;font-size:9px}.preview-animation-controls button{padding:6px 8px;border:1px solid #9b704d;border-radius:3px;background:#493526;color:#ffe0c3;font-size:9px;cursor:pointer}.preview-animation-empty{position:absolute;top:10px;right:10px;padding:7px;border:1px solid #414752;border-radius:4px;background:#1b1e24ed;color:#aeb5c1;font-size:9px}.preview-badge{position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid #414752;border-radius:3px;background:#1b1e24e8;color:#c2c9d4;font:8px ui-monospace,monospace;letter-spacing:.1em;pointer-events:none}.model-live-dot{width:5px;height:5px;border-radius:50%;background:#82bd9c}.preview-dimensions{position:absolute;bottom:35px;left:12px;padding:7px 9px;border:1px solid #414752;border-radius:3px;background:#1b1e24ed;color:#e0e4eb;font:9px ui-monospace,monospace;pointer-events:none}.preview-dimensions b{color:#606a78}.preview-dimensions small{margin-left:4px;color:#8d96a4;font-size:8px}.model-viewport-controls{position:absolute;right:10px;bottom:10px;display:flex;gap:10px;color:#7e8795;font:7px ui-monospace,monospace;pointer-events:none}.model-import-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;background:#13151aeb;color:#e2e5ec;font-size:12px}.model-import-loading small{color:#8f98a6;font-size:9px}.model-loading-spinner{width:25px;height:25px;border:2px solid #414752;border-top-color:#d4a171;border-radius:50%;animation:model-import-spin .8s linear infinite}@keyframes model-import-spin{to{transform:rotate(360deg)}}
.model-retarget-panel{margin:14px 0 16px;padding:11px;border:1px solid #41414a;border-radius:5px;background:#1b1e24}.model-retarget-source{margin:7px 0;color:#8e98a7;font-size:9px;overflow-wrap:anywhere}.model-retarget-source strong{color:#d7dce5;font-weight:600}.model-retarget-mapping-wrap{margin-top:11px;padding-top:7px;border-top:1px solid #343943}.model-retarget-mapping-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.model-retarget-mapping-wrap .model-rigging-subtitle{display:flex;justify-content:space-between;gap:8px}.model-retarget-mapping-wrap .model-rigging-subtitle span{color:#aeb6c4}.model-retarget-auto-map{flex:none;padding:5px 7px;border:1px solid #75563e;border-radius:3px;background:#34291f;color:#efc39b;font-size:8px;font-weight:650;cursor:pointer}.model-retarget-auto-map:hover:not(:disabled){border-color:#b98255;background:#433020}.model-retarget-auto-map:disabled{opacity:.45;cursor:not-allowed}.model-retarget-mappings{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow:auto;margin-top:7px;padding-right:2px}.model-retarget-map-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:7px;color:#b5bdc9;font-size:9px}.model-retarget-map-row>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-retarget-map-row>span small{display:block;color:#d9a36f;font-size:8px;overflow:hidden;text-overflow:ellipsis}.model-retarget-map-row-unmapped>span{color:#e8b27f}.model-retarget-map-row select{width:100%;min-width:0;padding:6px 5px;border:1px solid #3a414d;border-radius:3px;background:#20242c;color:#e3e7ee;font-size:9px}.model-retarget-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}.model-retarget-actions button{height:100%;min-height:35px;line-height:1.4}.model-rigging-field{display:flex;flex-direction:column;gap:5px;margin-top:9px;color:#aeb6c4;font-size:10px}.model-rigging-field input,.model-rigging-field select{width:100%;box-sizing:border-box;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;padding:8px;font:10px Inter,ui-sans-serif,system-ui,sans-serif}.model-rigging-primary,.model-rigging-secondary{width:100%;margin-top:8px;padding:8px;border:1px solid #9b704d;border-radius:4px;background:#493526;color:#ffe0c3;font-size:10px;font-weight:650;cursor:pointer}.model-rigging-secondary{border-color:#424752;background:#252932;color:#d1d5dd}.model-rigging-primary:disabled,.model-rigging-secondary:disabled{opacity:.45;cursor:not-allowed}.model-rigging-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:11px}.model-rigging-summary span{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid #343943;border-radius:4px;background:#202329}.model-rigging-summary small{color:#8f98a6;font-size:8px}.model-rigging-summary strong{color:#e2ad7c;font:600 14px ui-monospace,monospace}.model-rigging-rotation{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:10px}.model-rigging-subtitle{grid-column:1/-1;margin-top:8px;color:#c69b75;font-size:9px;font-weight:750;letter-spacing:.08em}.model-rigging-rotation label{display:flex;flex-direction:column;gap:4px;color:#aeb6c4;font-size:9px}.model-rigging-rotation input{min-width:0;width:100%;box-sizing:border-box;padding:7px 4px;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;font:10px ui-monospace,monospace}.model-rigging-frames{display:flex;flex-direction:column;gap:4px;margin-top:8px}.model-rigging-frames button{display:flex;justify-content:space-between;gap:8px;padding:7px;border:1px solid #343943;border-radius:4px;background:#202329;color:#d1d5dd;font-size:9px;cursor:pointer}.model-rigging-frames button.active{border-color:#9b704d;background:#34291f}.model-rigging-frames span{color:#999fac}.model-rigging-separator{height:1px;margin:13px 0;background:#30343c}.model-rigging-status{padding:8px;border:1px solid #4d4538;border-radius:4px;background:#28251f;color:#e2c7a9;font-size:9px;line-height:1.5;overflow-wrap:anywhere}
.model-import-right-panel .model-panel-section{padding:15px 13px}.model-height-label{display:flex;align-items:center;justify-content:space-between;color:#c4cad4;font-size:10px}.model-height-label strong{color:#e2ad7c;font:600 15px ui-monospace,monospace}.model-height-label strong small{font-size:9px;color:#9a8068}.model-height-entry{display:flex;align-items:center;gap:8px;margin-top:9px}.model-height-number{width:100%;min-width:0;padding:8px 9px;border:1px solid #424854;border-radius:3px;background:#202329;color:#e4e8ef;font:600 12px ui-monospace,monospace}.model-height-number:focus{outline:1px solid #b27e50;border-color:#b27e50}.model-height-number:disabled{opacity:.4}.model-height-entry span{flex-shrink:0;color:#8e96a4;font-size:9px}.model-height-unit-note{margin:6px 0 0;color:#888f9c;font-size:9px;line-height:1.4}.model-height-slider{width:100%;margin:17px 0 13px;accent-color:#cb925e;cursor:pointer}.model-height-slider:disabled{opacity:.4}.model-height-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.model-height-presets button{padding:7px 2px;border:1px solid #3c424c;border-radius:3px;background:#252931;color:#b9c0cb;font-size:9px;cursor:pointer}.model-height-presets button.active{border-color:#9b704d;background:#3a2c22;color:#f2c79f}.model-height-presets button:disabled{opacity:.4;cursor:default}.model-import-dimensions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:15px}.model-import-dimensions>div{display:flex;flex-direction:column;gap:7px;padding:8px 5px;border:1px solid #343943;border-radius:3px;background:#202329;min-width:0}.model-import-dimensions small{font-size:7px;color:#8c95a3;letter-spacing:.04em}.model-import-dimensions strong{overflow:hidden;font:600 11px ui-monospace,monospace;color:#e0e4eb;text-overflow:ellipsis}.model-asset-info-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #2b3038;color:#8f98a6;font-size:9px}.model-asset-info-row:last-child{border-bottom:0}.model-asset-info-row strong{max-width:65%;overflow:hidden;color:#cbd1db;font-size:9px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.model-import-error{margin:10px;padding:9px;border:1px solid #743d3a;border-radius:4px;background:#3a2526;color:#ffb6ae;font-size:10px;line-height:1.5;overflow-wrap:anywhere}.model-import-tip{margin:0 13px 14px;color:#7f8997;font-size:9px;line-height:1.6}
.model-diagnostics{margin:0;border:1px solid #343943;border-radius:4px;background:#202329;padding:9px}.model-diagnostics summary{cursor:pointer;color:#c6cbd4;font-size:9px;font-weight:800;letter-spacing:.06em}.model-diagnostics-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:10px}.model-diagnostics-summary span{display:flex;justify-content:space-between;gap:4px;padding:5px;background:#292d35;border-radius:3px;color:#9da5b2;font-size:9px}.model-diagnostics-summary b{color:#f1bd85}.model-diagnostics-hint{color:#929aa8;font-size:9px;line-height:1.5}.model-diagnostics-list{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto}.model-texture-repair p{margin:7px 0;color:#929aa8;font-size:9px;line-height:1.5}.model-texture-repair-item{display:grid;grid-template-columns:1fr;gap:5px;margin-top:8px;padding:7px;border:1px solid #343943;border-radius:4px;background:#20232a}.model-texture-repair-item label{color:#dce0e8;font-size:9px}.model-texture-repair-item select{width:100%;padding:7px;border:1px solid #414752;border-radius:4px;background:#191c22;color:#e7e9ef;font-size:10px}.model-texture-repair-item button{padding:7px;border:1px solid #a66e3d;border-radius:4px;background:#3d3025;color:#ffd2a3;font-size:10px;cursor:pointer}.model-texture-repair-item button:disabled{opacity:.45;cursor:wait}.model-texture-repair-message{display:block;margin-top:8px;color:#d9b58f;font-size:9px;line-height:1.5}.model-diagnostic-row{padding:6px;border:1px solid #343943;border-radius:3px;background:#191c22}.model-diagnostic-title{display:flex;gap:6px;min-width:0;align-items:center}.model-diagnostic-title b{flex:none;color:#d49b62;font-size:8px}.model-diagnostic-title span{overflow:hidden;color:#dce0e8;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.model-diagnostic-row small{display:block;margin-top:4px;color:#929aa8;font-size:8px;line-height:1.45;overflow-wrap:anywhere}
.model-import-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:9px 16px;border-top:1px solid #343944;background:#1d2026;color:#969eac;font-size:10px}.model-footer-state{display:flex;align-items:center;gap:8px}.model-footer-actions{display:flex;gap:8px}.model-import-primary,.model-import-secondary{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 13px;border-radius:4px;font-size:10px;font-weight:650;cursor:pointer}.model-import-primary{border:1px solid #d19a64;background:#d19a64;color:#211911}.model-import-primary:hover:not(:disabled){background:#e0ad7d}.model-import-primary:disabled{opacity:.4;cursor:not-allowed}.model-import-secondary{border:1px solid #424752;background:#252932;color:#d1d5dd}.model-import-secondary:hover{background:#333842}
@media(max-width:1000px){.model-import-workspace{grid-template-columns:210px minmax(250px,1fr) 240px}.model-import-dialog{width:99vw}.model-panel-section{padding:12px 10px}.model-import-right-panel .model-panel-section{padding:12px 10px}}
@media(max-width:760px){.model-import-backdrop{padding:5px}.model-import-dialog{height:98vh;max-height:98vh;min-height:0;width:100%;border-radius:5px}.model-import-tabs{padding:6px;gap:4px}.model-import-tab{min-width:94px;padding:6px 8px}.model-import-header{padding:10px}.model-import-header-status{display:none}.model-import-toolbar{align-items:flex-start;flex-direction:column;padding:8px}.model-import-toolbar-file{max-width:100%;width:100%}.model-import-workspace{display:flex;flex-direction:column;overflow:auto}.model-import-center-panel{order:0;min-height:340px;flex:none}.model-import-preview{min-height:280px;flex:none}.model-import-preview canvas{height:280px;min-height:280px}.model-import-left-panel{order:1;overflow:visible;border-right:0;border-bottom:1px solid #30343c}.model-import-right-panel{order:2;overflow:visible;border-left:0}.model-hierarchy-section .model-preview-parts{max-height:230px;overflow:auto}.model-viewport-statusbar span:last-child{display:none}.model-import-footer{align-items:center;padding:8px;min-height:50px}.model-footer-state{font-size:9px}.model-footer-actions{gap:5px}.model-import-primary,.model-import-secondary{padding:8px;font-size:9px}}
@media(prefers-reduced-motion:reduce){.model-loading-spinner{animation:none}}
.model-part-search{display:flex;flex-direction:column;gap:5px;margin:10px 0;color:#9ca5b3;font-size:8px;font-weight:750;letter-spacing:.08em}.model-part-search input,.model-component-name-field input{box-sizing:border-box;width:100%;min-width:0;padding:8px 9px;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;font:11px Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:0}.model-part-search input:focus,.model-component-name-field input:focus{outline:1px solid #b98255;border-color:#b98255}.model-preview-parts{max-height:360px!important;overflow:auto!important;padding-right:2px}.model-preview-show-all{margin-top:6px}
.model-component-name-field{display:flex;flex-direction:column;gap:6px;color:#aeb6c4;font-size:10px}
.model-behavior-package-list{display:flex;flex-direction:column;gap:7px}
.model-behavior-package-card{position:relative;display:flex;align-items:flex-start;gap:9px;min-width:0;padding:10px;border:1px solid #373e49;border-radius:5px;background:#20242b;cursor:pointer}
.model-behavior-package-card.selected{border-color:#936744;background:#30271f}
.model-behavior-package-card input{position:absolute;opacity:0;width:1px;height:1px}
.model-behavior-package-check{display:grid;place-items:center;flex:none;width:16px;height:16px;margin-top:1px;border:1px solid #596271;border-radius:3px;background:#171b22;color:#211911;font-size:11px;font-weight:800}
.model-behavior-package-card.selected .model-behavior-package-check{border-color:#d19a64;background:#d19a64}
.model-behavior-package-card:focus-within{outline:1px solid #d19a64;outline-offset:2px}
.model-behavior-package-copy{display:flex;flex:1;flex-direction:column;gap:5px;min-width:0}
.model-behavior-package-copy strong{color:#e3e7ee;font-size:10px}
.model-behavior-package-copy small{color:#9ca5b3;font-size:9px;line-height:1.5}
.model-behavior-package-meta{color:#d0a47d;font-size:8px;line-height:1.4}
.model-package-settings-list{display:flex;flex-direction:column;gap:9px;margin-top:10px}
.model-package-settings-card{display:flex;flex-direction:column;gap:9px;padding:11px;border:1px solid #624a35;border-radius:5px;background:#191d23}
.model-package-settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding-bottom:8px;border-bottom:1px solid #35313a}
.model-package-settings-header>div{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.model-package-settings-header strong{color:#f0c69e;font-size:11px}
.model-package-settings-header small{color:#8f98a6;font-size:9px;line-height:1.4}
.model-package-settings-badge{flex:none;padding:4px 5px;border:1px solid #755534;border-radius:3px;color:#e5b17e;font-size:7px;font-weight:800;letter-spacing:.07em}
.model-package-subheading{margin-top:4px;color:#d5a87f;font-size:8px;font-weight:800;letter-spacing:.09em}
.model-package-variable{display:flex;flex-direction:column;gap:4px;padding:7px 0;border-bottom:1px solid #2a2f38}
.model-package-variable:last-child{border-bottom:0}
.model-package-field{display:flex;flex-direction:column;gap:6px;min-width:0;color:#aeb6c4;font-size:9px}
.model-package-field>span{display:flex;flex-direction:column;gap:3px}
.model-package-field strong{color:#d2d8e2;font-size:9px;font-weight:650}
.model-package-field small{color:#8792a2;font-size:8px;line-height:1.4}
.model-package-field input,.model-package-field select,.model-package-vector input{box-sizing:border-box;width:100%;min-width:0;padding:7px 6px;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;font:10px Inter,ui-sans-serif,system-ui,sans-serif}
.model-package-field input:disabled,.model-package-field select:disabled,.model-package-vector input:disabled{opacity:.55}
.model-package-field input:focus,.model-package-field select:focus,.model-package-vector input:focus{outline:1px solid #b98255;border-color:#b98255}
.model-package-toggle{display:flex;align-items:flex-start;gap:8px;min-width:0;color:#d2d8e2;font-size:9px}
.model-package-toggle input{flex:none;margin:2px 0 0;accent-color:#d19a64}
.model-package-toggle>span{display:flex;flex-direction:column;gap:4px;min-width:0}
.model-package-toggle strong{font-size:9px;font-weight:650}
.model-package-toggle small{color:#8792a2;font-size:8px;line-height:1.4}
.model-package-vector{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.model-package-vector label{display:flex;flex-direction:column;gap:4px;color:#aeb6c4;font-size:9px}
.model-package-bindings{display:flex;flex-direction:column;gap:7px}
.model-package-state{display:flex;flex-direction:column;gap:8px;padding:9px;border:1px solid #343943;border-radius:4px;background:#202329}
.model-package-state-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.model-package-add-state,.model-package-remove-state{width:100%;padding:7px;border:1px solid #805b3d;border-radius:4px;background:#34291f;color:#f0c69e;font-size:9px;cursor:pointer}
.model-package-remove-state{border-color:#4b3a3a;background:#2b2022;color:#dca4a0}
.model-package-add-state:disabled,.model-package-remove-state:disabled{opacity:.45;cursor:not-allowed}
.model-package-settings-card code{color:#e0b48c;font-size:9px}
.model-preview-image-config{display:flex;align-items:center;gap:10px;min-width:0}
.model-preview-image-frame{display:grid;place-items:center;flex:none;width:68px;height:68px;overflow:hidden;border:1px solid #3a414d;border-radius:5px;background:#20242c;color:#8893a4;font-size:23px}
.model-preview-image-frame img{display:block;width:100%;height:100%;object-fit:contain}
.model-preview-image-copy{display:flex;flex:1;flex-direction:column;gap:5px;min-width:0}
.model-preview-image-copy strong{overflow:hidden;color:#dce2eb;font-size:9px;text-overflow:ellipsis;white-space:nowrap}
.model-preview-image-copy small{color:#8f98a6;font-size:9px;line-height:1.45}
.model-preview-image-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}
.model-preview-image-actions button{padding:6px 7px;border:1px solid #424752;border-radius:4px;background:#252932;color:#d1d5dd;font-size:9px;cursor:pointer}
.model-preview-image-actions button:first-child{border-color:#9b704d;background:#493526;color:#ffe0c3}
.model-preview-image-actions button:disabled{opacity:.45;cursor:not-allowed}
.model-preview-image-error{margin:8px 0 0;color:#ffaaa3;font-size:9px;line-height:1.45}

.model-footer-leading{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.model-footer-error{margin:0;max-width:780px;color:#ffaaa3;font-size:10px;line-height:1.35;overflow-wrap:anywhere}
.model-import-footer{flex-wrap:wrap}
.model-import-footer .model-footer-actions{flex:none}
@media(max-width:760px){.model-footer-error{font-size:9px}.model-import-footer{align-items:stretch}.model-import-footer .model-footer-actions{width:100%;justify-content:flex-end}}

.model-preview-part-batch{display:grid;place-items:center;flex:none;width:19px;height:21px;border:1px solid #3b414b;border-radius:3px;background:#202832;color:#8f9baa;font-size:13px;font-weight:700;line-height:1;cursor:pointer}
.model-preview-part-batch.active{border-color:#c8915f;background:#4a3525;color:#ffe0c3}
.model-preview-part-batch.saved{border-color:#486e5b;color:#8ec7a4}
.model-preview-part-batch:disabled{opacity:.5;cursor:wait}
.model-preview-part.is-batch-selected{border-color:#765638;background:#30251d}
.model-batch-selection-summary{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:8px;padding:7px 8px;border:1px solid #5a4632;border-radius:4px;background:#28221c;color:#edc49e;font-size:9px;font-weight:650}.model-batch-selection-summary button{flex:none;padding:4px 5px;border:1px solid #514437;border-radius:3px;background:#211f1c;color:#cbb69f;font-size:8px;cursor:pointer}.model-batch-selection-summary button:disabled{opacity:.5;cursor:wait}
.model-batch-notice{margin:7px 0 0;color:#9fc9ad;font-size:9px;line-height:1.5;overflow-wrap:anywhere}
.model-import-batch-save{border-color:#805b3d;color:#f0c69e}
.model-import-batch-save:hover:not(:disabled){border-color:#bd8a60;background:#34291f}
.model-import-footer .model-footer-actions{flex-wrap:wrap;justify-content:flex-end}
.model-retarget-previews{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.model-retarget-preview-card{min-width:0;padding:8px;border:1px solid #343943;border-radius:4px;background:#171a20}
.model-retarget-preview-heading{display:flex;flex-direction:column;gap:4px;margin-bottom:7px;min-width:0}
.model-retarget-preview-heading strong{color:#e1e5ed;font-size:9px;font-weight:750}
.model-retarget-preview-heading small{overflow:hidden;color:#8f98a6;font-size:8px;text-overflow:ellipsis;white-space:nowrap}
.model-retarget-preview-viewport{position:relative;min-height:140px;overflow:hidden;border:1px solid #303641;border-radius:3px;background:#20232a;background-image:radial-gradient(#343943 .7px,transparent .7px);background-size:14px 14px}
.model-retarget-preview-viewport canvas{display:block;width:100%;height:140px;outline:0}
.model-retarget-preview-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;background:#171a20d9;color:#aeb6c4;font-size:9px;line-height:1.5;text-align:center;pointer-events:none}
.model-retarget-preview-status{margin:7px 0 0;color:#aeb6c4;font-size:8px;line-height:1.5;overflow-wrap:anywhere}
.model-retarget-preview-play{margin-top:6px}

/* Viewport overlay keeps the long-running AI operation visible even when the right panel is scrolled. */
.model-skintokens-viewport-loading{z-index:30;gap:12px;padding:22px;background:#101217ed;backdrop-filter:blur(3px);text-align:center}
.model-skintokens-viewport-loading>strong{color:#f0d5b9;font-size:13px;font-weight:750}
.model-skintokens-viewport-loading>small{max-width:360px;color:#a9b0bc;font-size:10px;line-height:1.6}
.model-skintokens-viewport-progress{position:relative;overflow:hidden;width:min(320px,76%);height:5px;border-radius:999px;background:#38302a;box-shadow:inset 0 0 0 1px #604832}
.model-skintokens-viewport-progress span{position:absolute;inset:0 auto 0 0;width:38%;border-radius:999px;background:linear-gradient(90deg,#98663f,#f0bb83,#d19a64);box-shadow:0 0 10px #d19a6440;animation:model-skintokens-progress 1.65s ease-in-out infinite}
/* SkinTokens local processing: visible indeterminate progress without fake percentages. */
.model-skintokens-loading{display:flex;flex-direction:column;gap:10px;margin-top:10px;padding:12px;border:1px solid #715439;border-radius:5px;background:linear-gradient(135deg,#29231e 0%,#1c2026 70%);box-shadow:inset 3px 0 0 #d19a64;animation:model-skintokens-appear .2s ease-out}
.model-skintokens-loading-heading{display:flex;align-items:center;gap:10px;min-width:0}
.model-skintokens-spinner,.model-skintokens-button-spinner{display:inline-block;flex:none;width:25px;height:25px;border:2px solid #48434a;border-top-color:#edb67f;border-right-color:#d19a64;border-radius:50%;animation:model-skintokens-spin .85s linear infinite}
.model-skintokens-loading-copy{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.model-skintokens-loading-copy strong{color:#f0d5b9;font-size:10px;font-weight:750}
.model-skintokens-loading-copy small{color:#a7adb8;font-size:8px;line-height:1.4}
.model-skintokens-live-pill{display:flex;align-items:center;gap:5px;flex:none;padding:4px 5px;border:1px solid #5c654f;border-radius:3px;background:#252c24;color:#bcd5aa;font:700 7px ui-monospace,monospace;letter-spacing:.08em}
.model-skintokens-live-pill i{width:5px;height:5px;border-radius:50%;background:#9ec87d;box-shadow:0 0 0 3px #9ec87d18;animation:model-skintokens-pulse 1.4s ease-in-out infinite}
.model-skintokens-progress-track{position:relative;overflow:hidden;width:100%;height:5px;border-radius:999px;background:#3b332d;box-shadow:inset 0 0 0 1px #574333}
.model-skintokens-progress-track span{position:absolute;inset:0 auto 0 0;width:38%;border-radius:999px;background:linear-gradient(90deg,#98663f,#f0bb83,#d19a64);box-shadow:0 0 10px #d19a6440;animation:model-skintokens-progress 1.65s ease-in-out infinite}
.model-skintokens-loading>p{margin:0;color:#d2c3b4;font-size:9px;line-height:1.5;overflow-wrap:anywhere}
.model-skintokens-loading-note{color:#8e98a5;font-size:8px;line-height:1.5}
.model-skintokens-button-spinner{width:12px;height:12px;margin-right:5px;vertical-align:-2px;border-width:1.5px}
@keyframes model-skintokens-spin{to{transform:rotate(360deg)}}
@keyframes model-skintokens-progress{0%{left:-40%}50%{left:42%}100%{left:105%}}
@keyframes model-skintokens-pulse{0%,100%{opacity:.65}50%{opacity:1;box-shadow:0 0 0 4px #9ec87d25}}
@keyframes model-skintokens-appear{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.model-skintokens-loading,.model-skintokens-spinner,.model-skintokens-button-spinner,.model-skintokens-live-pill i,.model-skintokens-progress-track span,.model-skintokens-viewport-progress span{animation:none}.model-skintokens-progress-track span,.model-skintokens-viewport-progress span{left:31%;width:38%}}

</style>
