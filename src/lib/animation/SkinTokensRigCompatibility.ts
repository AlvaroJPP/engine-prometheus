import * as THREE from 'three'

export type SkinTokensOperation = 'rig' | 'skin'

/** Determines whether the selected Skin Tokens operation can run on a model. */
export function isSkinTokensRigCompatible(
  root: THREE.Object3D | null,
  operation: SkinTokensOperation,
  hasInitialAsset: boolean,
): boolean {
  if (!root || hasInitialAsset) return false

  let hasStaticMesh = false
  let hasSkinnedMesh = false

  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) hasSkinnedMesh = true
    else if (node instanceof THREE.Mesh && node.geometry.getAttribute('position')?.count) {
      hasStaticMesh = true
    }
  })

  return operation === 'rig' ? hasStaticMesh && !hasSkinnedMesh : hasSkinnedMesh
}
