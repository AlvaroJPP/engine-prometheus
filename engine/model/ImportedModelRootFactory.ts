import * as THREE from 'three'
import { clamp, snap } from '../lib/math'
import type { SceneObjectData } from '../project/format'
import type { AnimationRole } from '../script/packages'
import { setupImportedModelAnimations } from './ImportedModelAnimationSetup'

export interface ImportedModelRootFactoryOptions {
  model: THREE.Object3D
  name: string
  targetHeight: number
  originalSize: THREE.Vector3
  restoreData?: SceneObjectData
  cameraTarget: THREE.Vector3
  groundHeightAt: (x: number, z: number) => number
}

export interface CreatedImportedModelRoot {
  root: THREE.Mesh
  height: number
  explicitRoles: Record<string, AnimationRole> | undefined
}

/** Creates the editable scene root and attaches the normalized imported visual hierarchy. */
export function createImportedModelRoot(options: ImportedModelRootFactoryOptions): CreatedImportedModelRoot {
  const { model, name, targetHeight, originalSize, restoreData, cameraTarget, groundHeightAt } = options
  const height = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : originalSize.y
  const scaleFactor = height / originalSize.y
  model.scale.multiplyScalar(scaleFactor)
  model.updateMatrixWorld(true)
  const scaledBounds = new THREE.Box3().setFromObject(model)
  const visualCenter = scaledBounds.getCenter(new THREE.Vector3())
  const finalSize = scaledBounds.getSize(new THREE.Vector3())
  const visualPivot = new THREE.Group()
  visualPivot.name = 'ImportedVisualPivot'
  visualPivot.position.copy(visualCenter).negate()
  visualPivot.add(model)

  const {
    explicitRoles,
    animationMixer,
    animationController,
    animationFallbackAction,
    animationActions,
  } = setupImportedModelAnimations(model, name)

  const proxyGeometry = new THREE.BoxGeometry(
    Math.max(finalSize.x, 0.05),
    Math.max(height, 0.05),
    Math.max(finalSize.z, 0.05),
  )
  const proxyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  })
  const root = new THREE.Mesh(proxyGeometry, proxyMaterial)
  root.name = name.trim() || 'Modelo importado'
  const x = clamp(snap(cameraTarget.x, 0.5), -48, 48)
  const z = clamp(snap(cameraTarget.z, 0.5), -48, 48)
  const importOffset = model.userData.importOffset as [number, number] | undefined
  root.position.set(
    restoreData?.position[0] ?? x + (importOffset?.[0] ?? 0) * scaleFactor,
    restoreData?.position[1] ?? groundHeightAt(x, z) + height / 2,
    restoreData?.position[2] ?? z + (importOffset?.[1] ?? 0) * scaleFactor,
  )
  if (restoreData) {
    root.rotation.set(...restoreData.rotation)
    root.scale.set(...restoreData.scale)
    root.visible = restoreData.visible
  }
  if (animationMixer && animationController) {
    root.userData.importAnimationMixer = animationMixer
    root.userData.importAnimationActions = animationActions
    root.userData.importAnimationFallbackAction = animationFallbackAction
    root.userData.importAnimationController = animationController
    root.userData.importAnimationState = animationController.currentState
  }
  root.add(visualPivot)
  root.updateMatrixWorld(true)
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.visible = true
      // Frustum culling is unsafe for animated skinned meshes whose bounds change with their pose.
      child.frustumCulled = !(child instanceof THREE.SkinnedMesh)
    }
  })
  root.frustumCulled = false
  root.updateMatrixWorld(true)
  return { root, height, explicitRoles }
}
