import * as THREE from 'three'
import type { captureRigPose } from './Rigging'

export type RigAnimationPose = ReturnType<typeof captureRigPose>

export type RigAnimationKeyframe = {
  time: number
  pose: RigAnimationPose
}

/**
 * Constrói um clipe Three.js a partir das poses gravadas na linha do tempo do rig.
 * Retorna null quando nenhuma trilha possui dados completos para todos os quadros.
 */
export function createRigAnimationClip(
  name: string,
  duration: number,
  bones: THREE.Bone[],
  frames: readonly RigAnimationKeyframe[],
): THREE.AnimationClip | null {
  const times = frames.map(frame => frame.time)
  const tracks: THREE.KeyframeTrack[] = []

  for (const bone of bones) {
    const positions: number[] = []
    const quaternions: number[] = []
    const scales: number[] = []

    for (const frame of frames) {
      const transform = frame.pose[bone.name]
      if (!transform) continue
      positions.push(...transform.position)
      quaternions.push(...transform.quaternion)
      scales.push(...transform.scale)
    }

    if (
      positions.length !== times.length * 3
      || quaternions.length !== times.length * 4
      || scales.length !== times.length * 3
    ) continue

    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, positions))
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, quaternions))
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, scales))
  }

  if (!tracks.length) return null
  return new THREE.AnimationClip(name, duration, tracks)
}
