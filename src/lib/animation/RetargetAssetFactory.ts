import * as THREE from 'three'
import type { AnimationRole } from '@engine'
import {
  createReusableAnimationAsset,
  type ReusableAnimationAsset,
} from './AnimationRetargeting'

export type RetargetAssetSource = {
  libraryAsset: ReusableAnimationAsset | null
  root: THREE.Object3D | null
  clip: THREE.AnimationClip | null
  sourceName: string
  clipName: string
  role: AnimationRole
}

/** Builds a retargeting asset from either the saved library or the active GLB clip. */
export function createRetargetAssetForSource(source: RetargetAssetSource): ReusableAnimationAsset | null {
  const { libraryAsset, root, clip, sourceName, clipName, role } = source
  const normalizedName = clipName.trim()

  if (libraryAsset) {
    return {
      ...libraryAsset,
      name: normalizedName || libraryAsset.name,
      role,
    }
  }

  if (!root || !clip) return null

  const asset = createReusableAnimationAsset(
    root,
    clip,
    sourceName || root.name || 'Modelo de origem',
    role,
  )
  asset.name = normalizedName || asset.name
  return asset
}
