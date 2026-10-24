import * as THREE from 'three'
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { parseModelImportFile } from './ModelImportFileParser'
import { parseGltfModel } from './GltfModelParser'
import { loadZipPrimaryModel } from './ZipPrimaryModelLoader'
import { createZipImportContext, type ZipImportContext, type ZipModelBundle } from './ZipModelImport'
import { prepareStarterCatalogBehaviorPreset } from './StarterCatalogBehaviorPreset'
import { shouldDefaultToStaticCityCollider } from './ModelColliderDefaults'
import { calculateModelImportTransform } from './ModelImportNormalization'
import { normalizeModelControlBindings } from './ModelControlBindings'
import { resolveImportedAnimationRoles } from '../animation/AnimationRoleOptions'
import { storeRetargetRestPose } from '../animation/RetargetRestPose'
import { revokeOwnedObjectUrls } from './ModelOwnedObjectUrls'
import { previewAnimationRoleForClip, type ModelPreviewAnimationRuntime } from '../animation/ModelPreviewAnimationRuntime'
import type { ModelControlBindings, AnimationRole } from '@engine'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type ModelImportLoadingContext = {
  canvas: ReadonlyValue<HTMLCanvasElement | null>
  fileInput: ReadonlyValue<HTMLInputElement | null>
  loading: WritableValue<boolean>
  error: WritableValue<string>
  fileName: WritableValue<string>
  componentName: WritableValue<string>
  model: WritableValue<THREE.Object3D | null>
  modelHeight: WritableValue<number>
  dimensions: WritableValue<[number, number, number]>
  colliderType: WritableValue<'box' | 'sphere' | 'capsule' | 'mesh' | 'none'>
  colliderSize: WritableValue<[number, number, number]>
  colliderOffset: WritableValue<[number, number, number]>
  controlBindings: WritableValue<ModelControlBindings>
  partSearch: WritableValue<string>
  selectedBehaviorPackageIds: WritableValue<string[]>
  selectedBehaviorPackageSettings: WritableValue<Record<string, any>>
  activeSetupTab: WritableValue<'model' | 'controls' | 'animations' | 'rigging' | 'technical'>
  starterAssetCatalogOpen: WritableValue<boolean>
  selectedRetargetLibraryId: ReadonlyValue<string>
  retargetSourceRoot: ReadonlyValue<THREE.Object3D | null>
  animationClipRevision: WritableValue<number>
  rigBones: WritableValue<THREE.Bone[]>
  rigRestPose: WritableValue<Record<string, { position: number[]; quaternion: number[]; scale: number[] }>>
  selectedRigBoneName: WritableValue<string>
  rigKeyframes: WritableValue<Array<{ time: number; pose: Record<string, { position: number[]; quaternion: number[]; scale: number[] }> }>>
  rigFrameTime: WritableValue<number>
  rigDuration: WritableValue<number>
  rigMessage: WritableValue<string>
  animationRoles: WritableValue<Record<string, AnimationRole>>
  previewAnimationIndex: WritableValue<number>
  previewPlaying: WritableValue<boolean>
  previewAnimationRuntime: ModelPreviewAnimationRuntime
  previewClock: THREE.Clock
  clearLoadedModel: (preserveRetargetSource?: boolean) => void
  centerAndMeasure: (object: THREE.Object3D) => number
  fitCamera: (object: THREE.Object3D) => void
  initPreview: () => void
  refreshPreviewParts: () => void
  refreshModelDiagnostics: () => void
  updateColliderPreview: () => void
  restoreModelRenderableMeshes: (root: THREE.Object3D) => void
  guessedAnimationRole: (name: string) => AnimationRole
  getScene: () => THREE.Scene | null
  setCurrentObjectUrl: (url: string) => void
}
type StarterAssetCatalogPayload = {
  name: string
  bytes: ArrayBuffer
  role: 'player' | 'enemy' | 'loot' | 'object'
  height: number
  itemId?: string
  aiProfile?: string
  sourceName?: string
}

export function createModelImportLoadingController(context: ModelImportLoadingContext) {
  const {
    canvas,
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
    getScene,
    setCurrentObjectUrl,
  } = context

async function parseFile(file: File) {
  return parseModelImportFile(file, url => {
    currentObjectUrl = url
  })
}

async function showLoadedModel(loaded: THREE.Object3D, displayName: string, targetHeight = 2, preserveRetargetSource = false) {
  clearLoadedModel(preserveRetargetSource)
  colliderType.value = 'box'
  colliderOffset.value = [0, 0, 0]
  loaded.name = displayName.replace(/\.[^.]+$/, '') || 'Modelo importado'
  componentName.value = loaded.name
  partSearch.value = ''
  const height = centerAndMeasure(loaded)
  colliderType.value = shouldDefaultToStaticCityCollider(loaded, dimensions.value) ? 'mesh' : 'box'
  const transform = calculateModelImportTransform(loaded.userData.importCenter as [number, number, number], height, targetHeight)
  loaded.scale.setScalar(transform.scale)
  loaded.position.set(...transform.position)
  restoreModelRenderableMeshes(loaded)
  modelHeight.value = transform.height
  colliderSize.value = [
    Math.max(0.05, dimensions.value[0] * transform.scale),
    transform.height,
    Math.max(0.05, dimensions.value[2] * transform.scale),
  ]
  controlBindings.value = normalizeModelControlBindings(loaded.userData.importControlBindings)
  loaded.userData.importControlBindings = { ...controlBindings.value }
  model.value = loaded
  storeRetargetRestPose(loaded)
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
  const nextRoles = resolveImportedAnimationRoles(clips ?? [], savedRoles, guessedAnimationRole)
  animationRoles.value = nextRoles
  loaded.userData.importAnimationRoles = { ...nextRoles }
  previewAnimationIndex.value = 0
  previewPlaying.value = true
  if (clips?.length) {
    const controller = previewAnimationRuntime.ensure(loaded, clips)
    controller.setState(previewAnimationRoleForClip(clips[0]!))
    previewClock.start()
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  initPreview()
  const currentScene = getScene()
  if (!currentScene) throw new Error('Não foi possível iniciar a pré-visualização 3D.')
  currentScene.add(loaded)
  fitCamera(loaded)
  updateColliderPreview()
  // Se o modelo B foi escolhido primeiro, importar o modelo A não deve apagar
  // a origem salva. Leva o usuário de volta ao painel de retargeting após carregar A.
  if (preserveRetargetSource && (retargetSourceRoot.value || selectedRetargetLibraryId.value)) {
    activeSetupTab.value = 'rigging'
  }
}

async function parseGlbBytes(bytes: ArrayBuffer, manager?: THREE.LoadingManager): Promise<THREE.Object3D> {
  return parseGltfModel(bytes, '', manager)
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
    const loaded = await loadZipPrimaryModel(primaryFile, zipContext)

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
    if (!importedSuccessfully && zipContext) revokeOwnedObjectUrls(zipContext.objectUrls)
    loading.value = false
  }
}
async function loadCatalogAsset(asset: {
  name: string
  bytes: ArrayBuffer
  role: 'player' | 'enemy' | 'loot' | 'object'
  height: number
  itemId?: string
  aiProfile?: string
  sourceName?: string
}) {
  starterAssetCatalogOpen.value = false
  loading.value = true
  error.value = ''
  const chosenFileName = asset.name.replace(/\.glb$/i, '') + '.glb'
  fileName.value = chosenFileName
  try {
    const sourceBytes = asset.bytes.slice(0)
    const loaded = await parseGlbBytes(sourceBytes)
    loaded.userData.importSourceGlbBytes = sourceBytes.slice(0)
    loaded.userData.importAttribution = asset.sourceName ?? 'Modelo procedural criado pelo Engine Prometheus.'
    await showLoadedModel(loaded, chosenFileName, asset.height)
    fileName.value = chosenFileName
    componentName.value = asset.name
    const behaviorPreset = prepareStarterCatalogBehaviorPreset(asset, controlBindings.value)
    selectedBehaviorPackageIds.value = behaviorPreset.packageIds
    selectedBehaviorPackageSettings.value = behaviorPreset.packageSettings

    activeSetupTab.value = 'model'
  } catch (cause) {
    error.value = 'Não foi possível carregar o modelo inicial: ' + (cause instanceof Error ? cause.message : String(cause || 'erro desconhecido'))
    fileName.value = ''
    clearLoadedModel()
  } finally {
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


  return {
    parseFile,
    showLoadedModel,
    parseGlbBytes,
    importBlendZip,
    loadCatalogAsset,
    chooseFile,
  }
}
