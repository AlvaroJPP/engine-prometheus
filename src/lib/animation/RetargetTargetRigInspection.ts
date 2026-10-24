import * as THREE from 'three'

export type RetargetTargetRigInspection = {
  bones: THREE.Bone[]
  hasSkinnedMesh: boolean
}

/**
 * Inspects the destination model before autonomous animation retargeting.
 * Returns every bone in traversal order and whether the model has a skinned mesh.
 */
export function inspectRetargetTargetRig(root: THREE.Object3D): RetargetTargetRigInspection {
  const bones: THREE.Bone[] = []
  let hasSkinnedMesh = false

  root.traverse(node => {
    if (node instanceof THREE.Bone) bones.push(node)
    if (node instanceof THREE.SkinnedMesh) hasSkinnedMesh = true
  })

  return { bones, hasSkinnedMesh }
}
