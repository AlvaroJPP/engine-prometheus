import * as THREE from 'three'

/** Creates the skeleton overlay shown while editing a model's rig. */
export function createRigPreviewHelper(model: THREE.Object3D): THREE.SkeletonHelper {
  const helper = new THREE.SkeletonHelper(model)
  helper.name = 'ModelWorkspaceRigHelper'
  helper.renderOrder = 999
  helper.frustumCulled = false
  return helper
}

/** Removes the rig overlay and releases only its owned geometry and materials. */
export function disposeRigPreviewHelper(
  helper: THREE.SkeletonHelper | null,
  scene?: THREE.Scene | null,
): void {
  if (!helper) return
  scene?.remove(helper)
  helper.geometry.dispose()
  const material = helper.material
  if (Array.isArray(material)) material.forEach(item => item.dispose())
  else material.dispose()
}
