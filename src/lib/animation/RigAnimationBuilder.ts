import * as THREE from 'three'
import type { RigAnimationKeyframe } from './RigAnimationClip'
import { createRigAnimationClip } from './RigAnimationClip'
import { prepareRigAnimationFrames } from './RigKeyframeTimeline'

export type RigAnimationBuildFailure =
  | 'insufficient-keyframes'
  | 'missing-name'
  | 'no-valid-tracks'

export type RigAnimationBuildResult =
  | { ok: true; name: string; duration: number; clip: THREE.AnimationClip }
  | { ok: false; reason: RigAnimationBuildFailure }

/**
 * Validates a recorded rig timeline and builds a Three.js animation clip.
 * Keeps frame ordering, the initial pose-at-zero rule, duration bounds,
 * and the existing user-visible validation order in one domain helper.
 */
export function buildRigAnimationFromKeyframes(options: {
  rawName: string
  requestedDuration: number
  bones: THREE.Bone[]
  keyframes: readonly RigAnimationKeyframe[]
}): RigAnimationBuildResult {
  const frames = prepareRigAnimationFrames(options.keyframes)
  if (!frames) return { ok: false, reason: 'insufficient-keyframes' }

  const name = options.rawName.trim()
  if (!name) return { ok: false, reason: 'missing-name' }

  const duration = Math.max(0.1, options.requestedDuration, frames[frames.length - 1]!.time)
  const clip = createRigAnimationClip(name, duration, options.bones, frames)
  if (!clip) return { ok: false, reason: 'no-valid-tracks' }

  return { ok: true, name, duration, clip }
}
