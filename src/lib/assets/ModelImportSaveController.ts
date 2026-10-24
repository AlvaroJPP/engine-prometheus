import * as THREE from 'three'
import { prepareModelImportBatchItems, type ModelImportBatchItem } from './ModelImportBatchPreparation'
import { prepareModelImportSelectedPart } from './ModelImportSelectedPart'
import { clonePackageJsonRecord } from '../PackageJson'
import { getStaticMeshCollisionData } from '@engine/world/StaticMeshCollider'
import type { ModelPreviewPart } from './ModelPreviewParts'
import type { ImportBehaviorPackageDraft } from './ImportBehaviorPackageDrafts'
import type { ModelControlBindings, AnimationRole } from '@engine'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type ModelImportSavePayload = {
  name: string
  model: THREE.Object3D
  height: number
  thumbnail?: string
  componentId?: string
  sourceGlbBytes?: ArrayBuffer
  batchModels?: ModelImportBatchItem[]
}
type ModelImportSaveContext = {
  props: {
    initialAsset?: { id?: string; name: string } | null
    saveModel: (payload: ModelImportSavePayload) => Promise<boolean>
  }
  emit: (event: 'close') => void
  model: WritableValue<THREE.Object3D | null>
  loading: WritableValue<boolean>
  error: WritableValue<string>
  batchSelectedPartIds: WritableValue<string[]>
  batchSavedPartIds: WritableValue<string[]>
  batchNotice: WritableValue<string>
  modelHeight: ReadonlyValue<number>
  originalHeight: ReadonlyValue<number>
  colliderType: ReadonlyValue<'box' | 'sphere' | 'capsule' | 'mesh' | 'none'>
  colliderSize: ReadonlyValue<[number, number, number]>
  colliderOffset: ReadonlyValue<[number, number, number]>
  controlBindings: ReadonlyValue<ModelControlBindings>
  animationRoles: ReadonlyValue<Record<string, AnimationRole>>
  selectedBehaviorPackageIds: ReadonlyValue<string[]>
  ensureImportBehaviorPackageDraft: (packageId: string) => ImportBehaviorPackageDraft
  findPreviewPart: (id: string) => ModelPreviewPart | undefined
  fileName: ReadonlyValue<string>
  componentName: ReadonlyValue<string>
  selectedPartId: ReadonlyValue<string>
  customThumbnail: ReadonlyValue<string | null>
  capturePreviewThumbnail: () => string
  getScene: () => THREE.Scene | null
  previewAnimationRuntime: { clear: () => void }
}

export function createModelImportSaveController(context: ModelImportSaveContext) {
  const {
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
    getScene,
    previewAnimationRuntime,
  } = context

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
    entries.push(...prepareModelImportBatchItems({
      root,
      parts,
      scaleFactor: modelHeight.value / Math.max(originalHeight.value, 0.05),
      colliderType: colliderType.value,
      controlBindings: controlBindings.value,
      behaviorPackageIds: selectedBehaviorPackageIds.value,
      ensureBehaviorPackageDraft: ensureImportBehaviorPackageDraft,
    }))

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
      const preparedPart = prepareModelImportSelectedPart(root, chosenPart, modelHeight.value)
      imported = preparedPart.model
      importedHeight = preparedPart.height
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

    previewAnimationRuntime.clear()
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
  return { saveSelectedParts, confirmImport }
}
