import { watch } from 'vue'
import * as THREE from 'three'
import type { AnimationRole } from '@engine'
import { calculateModelImportTransform, normalizeModelImportHeight } from './ModelImportNormalization'
import { createPlayerModelBytes } from './ModelPlayerExport'
import { createCustomModelThumbnail } from './CustomModelThumbnail'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type ModelImportAssetActionsContext = {
  props: { initialAsset?: { name: string; bytes: ArrayBuffer } | null }
  emit: {
    (event: 'use-player', payload: { name: string; bytes: ArrayBuffer; animationRoles: Record<string, AnimationRole>; height: number }): void
    (event: 'close'): void
  }
  model: ReadonlyValue<THREE.Object3D | null>
  modelHeight: WritableValue<number>
  originalHeight: ReadonlyValue<number>
  colliderSize: WritableValue<[number, number, number]>
  loading: WritableValue<boolean>
  error: WritableValue<string>
  fileName: ReadonlyValue<string>
  animationRoles: ReadonlyValue<Record<string, AnimationRole>>
  customThumbnail: WritableValue<string | null>
  customThumbnailFileName: WritableValue<string>
  thumbnailImageError: WritableValue<string>
  updateColliderPreview: () => void
  fitCamera: (object: THREE.Object3D) => void
  capturePreviewThumbnail: () => string | undefined
}

export function createModelImportAssetActionsController(context: ModelImportAssetActionsContext) {
  const {
    props,
    emit,
    model,
    modelHeight,
    originalHeight,
    colliderSize,
    loading,
    error,
    fileName,
    animationRoles,
    customThumbnail,
    customThumbnailFileName,
    thumbnailImageError,
    updateColliderPreview,
    fitCamera,
    capturePreviewThumbnail,
  } = context

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


  return {
    setModelHeight,
    useAsPlayerModel,
    chooseThumbnailImage,
    clearCustomThumbnail,
  }
}
