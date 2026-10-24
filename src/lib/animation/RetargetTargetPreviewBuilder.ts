import * as THREE from 'three'
import { applyRigPose } from './Rigging'
import { retargetAnimationClip, type ReusableAnimationAsset } from './AnimationRetargeting'
import { getRetargetRestPose } from './RetargetRestPose'

type RetargetTargetPreviewBuildResult = {
  clip: THREE.AnimationClip | null
  status: string
}

/**
 * Prepares the destination preview from its cloned model and the current retargeting inputs.
 * Rest-pose application, clip generation, and preview-specific status stay outside the dialog.
 */
export function buildRetargetTargetPreview(options: {
  target: THREE.Object3D
  previewModel: THREE.Object3D
  sourceClip: THREE.AnimationClip | null
  asset: ReusableAnimationAsset | null
  boneMap: Record<string, string>
  collapsedSourceNames: string[]
  originalHeight: number
  clipName: string
  fallbackRestPose: Parameters<typeof applyRigPose>[1]
}): RetargetTargetPreviewBuildResult {
  const {
    target,
    previewModel,
    sourceClip,
    asset,
    boneMap,
    collapsedSourceNames,
    originalHeight,
    clipName,
    fallbackRestPose,
  } = options

  const previewBones: THREE.Bone[] = []
  previewModel.traverse(node => { if (node instanceof THREE.Bone) previewBones.push(node) })
  const storedTargetRestPose = getRetargetRestPose(target)
  if (storedTargetRestPose && Object.keys(storedTargetRestPose).length > 0) {
    applyRigPose(previewBones, storedTargetRestPose)
    previewModel.updateWorldMatrix(true, true)
  } else if (Object.keys(fallbackRestPose).length > 0) {
    applyRigPose(previewBones, fallbackRestPose)
  }

  if (!sourceClip) {
    return { clip: null, status: 'Selecione uma animação de origem.' }
  }
  if (!asset) {
    return { clip: null, status: 'Não foi possível ler a animação de origem.' }
  }

  const bounds = new THREE.Box3().setFromObject(previewModel)
  const measuredHeight = bounds.isEmpty() ? 0 : bounds.getSize(new THREE.Vector3()).y
  const targetHeight = originalHeight > 1e-5 ? originalHeight : Math.max(0.1, measuredHeight)
  const resolvedClipName = clipName.trim() || asset.name || sourceClip.name || 'Prévia retargetada'
  const result = retargetAnimationClip(
    asset,
    previewBones,
    boneMap,
    resolvedClipName,
    targetHeight,
    collapsedSourceNames,
    previewModel,
  )
  const status = 'Prévia no destino: ' + result.mappedTracks + ' trilha(s) transferida(s)' +
    (result.rootMotionTracks ? '; deslocamento global do corpo preservado' : '; nenhum canal de deslocamento global detectado') +
    (result.skippedTracks.length ? '; ' + result.skippedTracks.length + ' ignorada(s).' : '.')

  return { clip: result.clip, status }
}
