import * as THREE from 'three'
import { applyRigPose, captureRigPose } from './Rigging'

type RetargetRestPose = ReturnType<typeof captureRigPose>

const retargetRestPoseByModel = new WeakMap<THREE.Object3D, RetargetRestPose>()

/** Captura e memoriza a pose local dos ossos de um modelo para retargeting. */
export function storeRetargetRestPose(root: THREE.Object3D): RetargetRestPose {
  const bones: THREE.Bone[] = []
  root.traverse(node => { if (node instanceof THREE.Bone) bones.push(node) })
  const pose = captureRigPose(bones)
  retargetRestPoseByModel.set(root, pose)
  return pose
}

/** Recupera a pose previamente memorizada sem expor o mapa global do módulo. */
export function getRetargetRestPose(root: THREE.Object3D): RetargetRestPose | undefined {
  return retargetRestPoseByModel.get(root)
}

/** Restaura a pose de repouso e atualiza matrizes e esqueletos do modelo. */
export function restoreRetargetRestPose(root: THREE.Object3D, bones?: THREE.Bone[]): boolean {
  const pose = retargetRestPoseByModel.get(root)
  if (!pose || Object.keys(pose).length === 0) return false
  const targetBones = bones ?? (() => {
    const result: THREE.Bone[] = []
    root.traverse(node => { if (node instanceof THREE.Bone) result.push(node) })
    return result
  })()
  applyRigPose(targetBones, pose)
  root.updateWorldMatrix(true, true)
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.update()
  })
  return true
}
