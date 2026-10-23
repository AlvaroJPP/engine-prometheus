import * as THREE from 'three'
import {
  findAnimationNode,
  getTransformTrackPath,
} from './AnimationRetargeting'
import type { ReusableAnimationAsset } from './AnimationRetargeting'

/**
 * Lists only real source bones that participate in the selected animation.
 * Older library entries may not contain sourceBoneNames, so they retain the
 * historical sourceNodeNames fallback.
 */
export function collectRetargetSourceBoneNames(
  asset: ReusableAnimationAsset | null,
  root: THREE.Object3D | null,
  clip: THREE.AnimationClip | null,
): string[] {
  if (asset) {
    const sourceBones = asset.sourceBoneNames ?? asset.sourceNodeNames
    return sourceBones.filter(name => Boolean(asset.sourcePose[name]))
  }

  if (!root || !clip) return []

  const names = [...new Set(clip.tracks
    .map(getTransformTrackPath)
    .filter((path): path is NonNullable<ReturnType<typeof getTransformTrackPath>> => path !== null)
    .map(path => path.nodeName))]

  // Retargeting targets a skeleton: animated wrappers and mesh pivots do not
  // count as bones when calculating mapping coverage.
  return names.filter(name => findAnimationNode(root, name) instanceof THREE.Bone)
}
