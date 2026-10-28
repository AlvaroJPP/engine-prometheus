import * as THREE from 'three'
import { clamp } from '../lib/math'
import type { SceneObjectData } from '../project/format'
import type { AnimationRole, ModelControlBindings } from '../script/packages'
import { markEntity } from './entity/Entity'

export interface ImportedModelMetadataOptions {
  height: number
  restoreData?: SceneObjectData
  explicitRoles: Record<string, AnimationRole> | undefined
  isStaticCityLike: boolean
}

/** Applies persisted model metadata and migrates legacy static-scene colliders. */
export function applyImportedModelMetadata(
  root: THREE.Mesh,
  model: THREE.Object3D,
  options: ImportedModelMetadataOptions,
): string {
  const { height, restoreData, explicitRoles, isStaticCityLike } = options
  const id = `model_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
  root.userData.id = id
  root.userData.locked = false
  root.userData.groupId = null
  root.userData.wireframeVisible = false
  root.userData.mass = 1
  const importColliderType = model.userData.importColliderType
  root.userData.colliderType = importColliderType === 'box' || importColliderType === 'sphere' || importColliderType === 'capsule' || importColliderType === 'mesh' || importColliderType === 'none'
    ? importColliderType
    : 'box'
  const importedColliderSize = model.userData.importColliderSize
  if (Array.isArray(importedColliderSize) && importedColliderSize.length === 3 && importedColliderSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
    root.userData.colliderSize = importedColliderSize.map((value: number) => clamp(value, 0.05, 100))
  }
  const importedColliderOffset = model.userData.importColliderOffset
  if (Array.isArray(importedColliderOffset) && importedColliderOffset.length === 3 && importedColliderOffset.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
    root.userData.colliderOffset = importedColliderOffset.map((value: number) => clamp(value, -100, 100))
  }
  root.userData.importedModel = true
  root.userData.importAnimationRoles = explicitRoles ? { ...explicitRoles } : undefined
  const importedControlBindings = model.userData.importControlBindings
    ?? restoreData?.importControlBindings
  root.userData.importControlBindings = importedControlBindings && typeof importedControlBindings === 'object'
    ? { ...importedControlBindings as Partial<ModelControlBindings> }
    : undefined
  const componentId = typeof model.userData.componentId === 'string' ? model.userData.componentId : null
  const componentLogic = Array.isArray(model.userData.componentLogic) ? model.userData.componentLogic : []
  if (model.userData.sceneKind === 'entity') {
    markEntity(root, { componentId, componentLogic })
  } else {
    root.userData.sceneKind = 'object'
    root.userData.componentId = componentId ?? undefined
    root.userData.componentLogic = componentLogic
  }
  root.userData.importedModelData = typeof model.userData.importedModelData === 'string' ? model.userData.importedModelData : restoreData?.importedModelData
  root.userData.importedModelHeight = height
  root.userData.sourceUrl = typeof model.userData.sourceUrl === 'string' ? model.userData.sourceUrl : restoreData?.sourceUrl
  if (restoreData) {
    root.userData.locked = restoreData.locked ?? false
    root.userData.groupId = restoreData.groupId ?? null
    root.userData.wireframeVisible = restoreData.wireframeVisible ?? false
    root.userData.mass = restoreData.mass ?? 1
    if (restoreData.colliderType) root.userData.colliderType = restoreData.colliderType
    if (restoreData.colliderSize) root.userData.colliderSize = [...restoreData.colliderSize]
    if (restoreData.colliderOffset) root.userData.colliderOffset = [...restoreData.colliderOffset]
  }
  if ((isStaticCityLike || importColliderType === 'mesh') && root.userData.colliderType === 'box') {
    root.userData.colliderType = 'mesh'
    root.userData.colliderOffset = [0, 0, 0]
    console.info('[Engine] Colisor de cenário atualizado automaticamente para malha estática:', root.name)
  }
  return id
}
