import * as THREE from 'three'
import type { AnimationRole } from '@engine'
import type { AutoRigPreset } from '@/lib/animation/Rigging'

export type SkinTokensOperation = 'rig' | 'weights'

export interface PreparedSkinTokensResult {
  detectedBones: THREE.Bone[]
  animationRoles: Record<string, AnimationRole>
}

/**
 * Marks and inspects a GLB returned by SkinTokens, preserving animation roles by clip name.
 * This function only prepares metadata on the newly parsed result; it does not touch the live preview.
 */
export function prepareSkinTokensRiggingResult(
  loaded: THREE.Object3D,
  operation: SkinTokensOperation,
  generatedPreset: AutoRigPreset,
  sourceRolesByName: ReadonlyMap<string, AnimationRole>,
  fallbackRole: (clipName: string) => AnimationRole,
): PreparedSkinTokensResult {
  if (operation === 'rig') {
    loaded.userData.importRigGenerated = true
    loaded.userData.importRigPreset = generatedPreset
  }
  loaded.userData.importNeedsReexport = true

  const detectedBones: THREE.Bone[] = []
  loaded.traverse(node => {
    if (!(node instanceof THREE.Bone)) return
    if (operation === 'rig') {
      node.userData.generatedRigBone = true
      node.userData.generatedRigPreset = generatedPreset
    }
    detectedBones.push(node)
  })

  const clips = (loaded.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
  const animationRoles: Record<string, AnimationRole> = {}
  clips.forEach((clip, index) => {
    animationRoles[String(index)] = sourceRolesByName.get(clip.name) ?? fallbackRole(clip.name)
  })

  return { detectedBones, animationRoles }
}
