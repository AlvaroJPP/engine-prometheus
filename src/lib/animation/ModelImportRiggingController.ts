import * as THREE from 'three'
import type { AnimationRole } from '@engine'
import { ANIMATION_ROLE_BASE_OPTIONS } from '@engine'
import { autoRigModel, applyRigPose, captureRigPose, prepareRigRootContainer, applyRigBoneTransformDraft } from './Rigging'
import { upsertRigAnimationKeyframe } from './RigKeyframeTimeline'
import { buildRigAnimationFromKeyframes } from './RigAnimationBuilder'
import type { AutoRigPreset } from './Rigging'
import type { RigAnimationKeyframe as RigKeyframe, RigAnimationPose as RigPose } from './RigAnimationClip'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type DraftVector3 = { x: number; y: number; z: number }
type ModelImportRiggingContext = {
  props: { initialAsset?: { id?: string; name: string } | null }
  model: WritableValue<THREE.Object3D | null>
  loading: ReadonlyValue<boolean>
  error: WritableValue<string>
  getScene: () => THREE.Scene | null
  rigPreset: WritableValue<AutoRigPreset>
  rigBones: WritableValue<THREE.Bone[]>
  selectedRigBoneName: WritableValue<string>
  rigRestPose: WritableValue<RigPose>
  rigKeyframes: WritableValue<RigKeyframe[]>
  rigFrameTime: WritableValue<number>
  rigDuration: WritableValue<number>
  rigMessage: WritableValue<string>
  rigClipName: WritableValue<string>
  rigClipRole: WritableValue<AnimationRole>
  boneRotationDraft: WritableValue<DraftVector3>
  bonePositionDraft: WritableValue<DraftVector3>
  selectedRigBone: ReadonlyValue<THREE.Bone | null>
  previewAnimationRuntime: { controller?: { stop: () => void } | null }
  previewAnimations: ReadonlyValue<THREE.AnimationClip[]>
  animationRoles: WritableValue<Record<string, AnimationRole>>
  animationClipRevision: WritableValue<number>
  previewAnimationIndex: WritableValue<number>
  refreshRigHelper: () => void
  updateRigHelper: () => void
  refreshPreviewParts: () => void
  refreshModelDiagnostics: () => void
  selectPreviewAnimation: (index: number) => void
}

export function createModelImportRiggingController(context: ModelImportRiggingContext) {
  const {
    props,
    model,
    loading,
    error,
    getScene,
    rigPreset,
    rigBones,
    selectedRigBoneName,
    rigRestPose,
    rigKeyframes,
    rigFrameTime,
    rigDuration,
    rigMessage,
    rigClipName,
    rigClipRole,
    boneRotationDraft,
    bonePositionDraft,
    selectedRigBone,
    previewAnimationRuntime,
    previewAnimations,
    animationRoles,
    animationClipRevision,
    previewAnimationIndex,
    refreshRigHelper,
    updateRigHelper,
    refreshPreviewParts,
    refreshModelDiagnostics,
    selectPreviewAnimation,
  } = context

function ensureGroupRootForRig(): THREE.Object3D | null {
  const current = model.value
  const preparedRoot = prepareRigRootContainer(current, getScene())
  if (preparedRoot && preparedRoot !== current) model.value = preparedRoot
  return preparedRoot
}

function createRig() {
  let root = model.value
  if (!root || props.initialAsset || loading.value) return
  error.value = ''
  try {
    previewAnimationRuntime.controller?.stop()
    const rigRoot = ensureGroupRootForRig()
    if (!rigRoot) return
    root = rigRoot
    const result = autoRigModel(root, rigPreset.value)
    rigBones.value = result.bones
    rigPreset.value = result.preset
    selectedRigBoneName.value = result.bones[0]?.name ?? ''
    rigRestPose.value = captureRigPose(result.bones)
    rigKeyframes.value = []
    rigFrameTime.value = 0
    rigDuration.value = 1
    rigMessage.value = result.message
    root.userData.importNeedsReexport = true
    root.userData.importRigPreset = result.preset
    root.userData.importRigGenerated = result.created || (
      result.bones.length > 0 && result.bones.every(bone => bone.userData.generatedRigBone === true)
    )
    refreshRigHelper()
    refreshPreviewParts()
    refreshModelDiagnostics()
  } catch (cause) {
    rigMessage.value = ''
    error.value = cause instanceof Error ? cause.message : 'Não foi possível criar o rig.'
  }
}

function applySelectedBoneTransform() {
  const bone = selectedRigBone.value
  if (!bone) return
  previewAnimationRuntime.controller?.stop()
  const root = model.value
  if (root) root.userData.importNeedsReexport = true

  const result = applyRigBoneTransformDraft({
    bone,
    root,
    bones: rigBones.value,
    restPose: rigRestPose.value,
    position: bonePositionDraft.value,
    rotationDegrees: boneRotationDraft.value,
    generatedRig: root?.userData.importRigGenerated === true,
  })
  if (result.pivotChanged) {
    rigRestPose.value = result.restPose ?? rigRestPose.value
    // Reposicionar um pivô redefine o repouso; quadros antigos dependiam da posição anterior.
    rigKeyframes.value = []
    rigFrameTime.value = 0
    rigDuration.value = 1
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(bone.rotation.x),
      y: THREE.MathUtils.radToDeg(bone.rotation.y),
      z: THREE.MathUtils.radToDeg(bone.rotation.z),
    }
    rigMessage.value = 'Pivô ajustado e pose de repouso atualizada. Grave novamente os quadros-chave.'
  }
  updateRigHelper()
}

function resetRigPose() {
  if (!rigBones.value.length) return
  previewAnimationRuntime.controller?.stop()
  applyRigPose(rigBones.value, rigRestPose.value)
  if (selectedRigBone.value) {
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.x),
      y: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.y),
      z: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.z),
    }
    bonePositionDraft.value = {
      x: selectedRigBone.value.position.x,
      y: selectedRigBone.value.position.y,
      z: selectedRigBone.value.position.z,
    }
  }
  updateRigHelper()
}

function recordRigKeyframe() {
  if (!rigBones.value.length || !model.value) return
  if (!Number.isFinite(rigFrameTime.value) || rigFrameTime.value < 0) {
    rigMessage.value = 'O tempo do quadro precisa ser zero ou positivo.'
    return
  }
  previewAnimationRuntime.controller?.stop()
  const time = Number(rigFrameTime.value.toFixed(3))
  const frame = { time, pose: captureRigPose(rigBones.value) }
  rigKeyframes.value = upsertRigAnimationKeyframe(rigKeyframes.value, frame)
  rigDuration.value = Math.max(rigDuration.value, time, 0.1)
  rigMessage.value = `Pose gravada em ${time.toFixed(2)} s (${rigBones.value.length} ossos).`
}

function applyRigFrame(frame: RigKeyframe) {
  rigFrameTime.value = frame.time
  applyRigPose(rigBones.value, frame.pose)
  if (selectedRigBone.value) {
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.x),
      y: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.y),
      z: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.z),
    }
  }
  updateRigHelper()
  rigMessage.value = `Pose de ${frame.time.toFixed(2)} s aplicada para edição.`
}

function clearRigKeyframesForNewClip() {
  rigKeyframes.value = []
  rigFrameTime.value = 0
  rigClipName.value = `Animacao ${previewAnimations.value.length + 1}`
  rigMessage.value = 'Linha do tempo limpa. Grave a pose inicial em 0 s e as próximas poses nos tempos desejados.'
}

function createRigAnimation() {
  const root = model.value
  if (!root || !rigBones.value.length || props.initialAsset) return

  const built = buildRigAnimationFromKeyframes({
    rawName: rigClipName.value,
    requestedDuration: rigDuration.value,
    bones: rigBones.value,
    keyframes: rigKeyframes.value,
  })
  if (!built.ok) {
    rigMessage.value = built.reason === 'insufficient-keyframes'
      ? 'Grave pelo menos duas poses em tempos diferentes (por exemplo, 0 s e 1 s).'
      : built.reason === 'missing-name'
        ? 'Digite um nome para a animação.'
        : 'Não existem trilhas válidas para exportar. Confira o rig e grave as poses novamente.'
    return
  }

  const { clip, name } = built
  const clips = [...previewAnimations.value, clip]
  const newIndex = clips.length - 1
  const nextRoles = { ...animationRoles.value, [String(newIndex)]: rigClipRole.value }
  root.userData.importNeedsReexport = true
  root.userData.importHasModifiedAnimations = true
  root.userData.importAnimations = clips
  root.userData.importAnimationRoles = nextRoles
  animationRoles.value = nextRoles
  animationClipRevision.value += 1
  previewAnimationIndex.value = newIndex
  refreshModelDiagnostics()
  selectPreviewAnimation(newIndex)
  rigMessage.value = `Animação "${name}" criada com ${clip.tracks.length / 3} trilhas e associada ao papel "${ANIMATION_ROLE_BASE_OPTIONS.find(option => option.value === rigClipRole.value)?.label ?? rigClipRole.value}". Ela será exportada junto com o modelo.`
}
function setRigTime(value: number) {
  rigFrameTime.value = Math.max(0, Number.isFinite(value) ? value : 0)
}


  return {
    createRig,
    applySelectedBoneTransform,
    resetRigPose,
    recordRigKeyframe,
    applyRigFrame,
    clearRigKeyframesForNewClip,
    createRigAnimation,
    setRigTime,
  }
}
