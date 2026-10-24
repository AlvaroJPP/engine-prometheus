import * as THREE from 'three'
import type { AnimationRole } from '@engine'

export type RetargetClipIntegration = {
  clips: THREE.AnimationClip[]
  index: number
  roles: Record<string, AnimationRole>
}

/**
 * Insere ou substitui o clipe transferido pelo nome normalizado e sincroniza
 * os metadados do modelo usados na exportação e no mapeamento de papéis.
 */
export function integrateRetargetedAnimationClip(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  fallbackClips: THREE.AnimationClip[],
  currentRoles: Record<string, AnimationRole>,
  role: AnimationRole,
): RetargetClipIntegration {
  const clips = [
    ...((root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? fallbackClips),
  ]
  const normalizedName = clip.name.trim().toLocaleLowerCase()
  const existingIndex = normalizedName
    ? clips.findIndex(existing => existing.name.trim().toLocaleLowerCase() === normalizedName)
    : -1
  const index = existingIndex >= 0 ? existingIndex : clips.length

  if (existingIndex >= 0) clips[existingIndex] = clip
  else clips.push(clip)

  const roles = { ...currentRoles, [String(index)]: role }
  root.userData.importNeedsReexport = true
  root.userData.importHasModifiedAnimations = true
  root.userData.importAnimations = clips
  root.userData.importAnimationRoles = roles

  return { clips, index, roles }
}
