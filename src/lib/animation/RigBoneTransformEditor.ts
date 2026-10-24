import * as THREE from 'three'
import { applyRigPose, captureRigPose, rebindRigModel } from './Rigging'

type DraftVector3 = { x: number; y: number; z: number }
type RigRestPose = ReturnType<typeof captureRigPose>

export type RigBoneTransformDraftResult = {
  pivotChanged: boolean
  restPose?: RigRestPose
}

/** Applies the inspector's bone rotation or rebases a generated rig pivot. */
export function applyRigBoneTransformDraft(options: {
  bone: THREE.Bone
  root: THREE.Object3D | null
  bones: THREE.Bone[]
  restPose: RigRestPose
  position: DraftVector3
  rotationDegrees: DraftVector3
  generatedRig: boolean
}): RigBoneTransformDraftResult {
  const { bone, root, bones, restPose, position, rotationDegrees, generatedRig } = options
  const positionChanged = Math.abs(bone.position.x - position.x) > 1e-5 ||
    Math.abs(bone.position.y - position.y) > 1e-5 ||
    Math.abs(bone.position.z - position.z) > 1e-5
  const pivotChanged = Boolean(root && generatedRig && positionChanged)
  let nextRestPose: RigRestPose | undefined

  if (pivotChanged && root) {
    // A generated rig's pivot defines its rest pose, so old keyframes must be discarded by the caller.
    applyRigPose(bones, restPose)
    bone.position.set(position.x, position.y, position.z)
    root.updateWorldMatrix(true, true)
    rebindRigModel(root)
    nextRestPose = captureRigPose(bones)
  } else {
    bone.rotation.set(
      THREE.MathUtils.degToRad(rotationDegrees.x),
      THREE.MathUtils.degToRad(rotationDegrees.y),
      THREE.MathUtils.degToRad(rotationDegrees.z),
      bone.rotation.order,
    )
  }

  bone.updateMatrixWorld(true)
  root?.updateWorldMatrix(true, true)
  return { pivotChanged, restPose: nextRestPose }
}
