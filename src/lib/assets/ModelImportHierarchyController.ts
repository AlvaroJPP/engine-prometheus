import * as THREE from 'three'
import {
  calculateImportColliderSize,
  calculateImportColliderSizeFromObjectBounds,
} from './ModelColliderSizing'
import { reconcileModelPreviewPartState } from './ModelPreviewPartState'
import {
  restoreModelPreviewVisibility,
  setModelPreviewSoloVisibility,
  toggleModelPreviewBatchSelection,
} from './ModelPreviewSelection'
import { restoreRenderableMeshes } from '../animation/ModelRenderableMeshes'
import { invalidateStaticMeshCollider } from '@engine/world/StaticMeshCollider'
import type { ModelPreviewPart } from './ModelPreviewParts'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type ModelImportHierarchyContext = {
  props: { initialAsset?: unknown }
  model: WritableValue<THREE.Object3D | null>
  previewParts: WritableValue<ModelPreviewPart[]>
  selectedPartId: WritableValue<string>
  soloPartId: WritableValue<string>
  batchSelectedPartIds: WritableValue<string[]>
  batchSavedPartIds: WritableValue<string[]>
  componentName: WritableValue<string>
  colliderType: ReadonlyValue<'box' | 'sphere' | 'capsule' | 'mesh' | 'none'>
  colliderSize: WritableValue<[number, number, number]>
  colliderOffset: WritableValue<[number, number, number]>
  modelHeight: ReadonlyValue<number>
  originalHeight: ReadonlyValue<number>
  dimensions: ReadonlyValue<[number, number, number]>
  fileName: ReadonlyValue<string>
  fitCamera: (object: THREE.Object3D) => void
  updateColliderPreview: () => void
  refreshModelDiagnostics: () => void
}

export function createModelImportHierarchyController(context: ModelImportHierarchyContext) {
  const {
    props,
    model,
    previewParts,
    selectedPartId,
    soloPartId,
    batchSelectedPartIds,
    batchSavedPartIds,
    componentName,
    colliderType,
    colliderSize,
    colliderOffset,
    modelHeight,
    originalHeight,
    dimensions,
    fileName,
    fitCamera,
    updateColliderPreview,
    refreshModelDiagnostics,
  } = context

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



  return {
    refreshPreviewParts,
    findPreviewPart,
    toggleBatchPartSelection,
    clearBatchSelection,
    selectPreviewPart,
    togglePreviewPart,
    showOnlyPreviewPart,
    selectWholeModel,
    restorePreviewVisibility,
    restoreModelRenderableMeshes,
    deletePreviewPart,
  }
}
