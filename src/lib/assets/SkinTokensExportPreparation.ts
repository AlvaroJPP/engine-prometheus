import * as THREE from 'three'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'

const IMPORTER_ONLY_USER_DATA_KEYS = [
  'importAnimations',
  'importGltfMetadata',
  'importRecoveredTextures',
  'importRecoveredColorTextures',
  'importCenter',
  'importOwnedObjectUrl',
  'importAnimationRoles',
  'importControlBindings',
  'importColliderType',
  'importColliderSize',
  'importColliderOffset',
  'importRigPreset',
  'importRigGenerated',
  'importRigBoneNames',
  'importSourceGlbBytes',
  'importNeedsReexport',
] as const

/**
 * Clones a model for SkinTokens GLB export without mutating the live import preview.
 * Importer-only metadata is removed from the clone so it cannot leak into glTF extras.
 */
export function prepareSkinTokensExportRoot(root: THREE.Object3D): THREE.Object3D {
  const exportRoot = cloneSkinnedModel(root)
  exportRoot.userData = { ...exportRoot.userData }
  for (const key of IMPORTER_ONLY_USER_DATA_KEYS) {
    delete exportRoot.userData[key]
  }
  exportRoot.updateMatrixWorld(true)
  return exportRoot
}
