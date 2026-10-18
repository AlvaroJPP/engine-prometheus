import * as THREE from 'three'
import type { AnimationRole } from '@engine'

export type AnimationPoseSnapshot = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

export type ReusableAnimationAsset = {
  id: string
  name: string
  sourceName: string
  duration: number
  role: AnimationRole
  /** JSON puro do clipe original: pode ser salvo no localStorage e reaberto depois. */
  clipJson: Record<string, unknown>
  /** Pose de repouso do nó de origem, necessária para compensar rigs diferentes. */
  sourcePose: Record<string, AnimationPoseSnapshot>
  sourceNodeNames: string[]
  sourceHeight: number
  createdAt: string
}

export type RetargetAnimationResult = {
  clip: THREE.AnimationClip
  mappedTracks: number
  skippedTracks: string[]
}

export type TransformTrackPath = {
  nodeName: string
  property: 'position' | 'quaternion' | 'scale'
}

const TRANSFORM_PROPERTIES = new Set(['position', 'quaternion', 'scale'])

/** Retorna o nó/propriedade endereçados por uma trilha Three.js compatível com um rig. */
export function getTransformTrackPath(track: THREE.KeyframeTrack): TransformTrackPath | null {
  try {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name)
    const property = parsed.propertyName
    const nodeName = parsed.nodeName ?? ''
    if (!nodeName || !TRANSFORM_PROPERTIES.has(property)) return null
    return { nodeName, property: property as TransformTrackPath['property'] }
  } catch {
    return null
  }
}

/** Resolve nomes glTF/Mixamo e caminhos simples sem assumir uma hierarquia específica. */
export function findAnimationNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const found = THREE.PropertyBinding.findNode(root, name)
  if (found) return found
  const leaf = name.split(/[./|:]/).filter(Boolean).pop()
  if (!leaf) return null
  let match: THREE.Object3D | null = null
  root.traverse(node => {
    if (match || node.name !== leaf) return
    match = node
  })
  return match
}

function snapshotNode(node: THREE.Object3D): AnimationPoseSnapshot {
  return {
    position: node.position.toArray() as [number, number, number],
    quaternion: node.quaternion.toArray() as [number, number, number, number],
    scale: node.scale.toArray() as [number, number, number],
  }
}

function objectHeight(root: THREE.Object3D): number {
  root.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().setFromObject(root)
  const height = bounds.isEmpty() ? 0 : bounds.getSize(new THREE.Vector3()).y
  return Number.isFinite(height) && height > 1e-5 ? height : 1
}

/** Captura o clipe e as poses de repouso para que ele possa ser reutilizado sem o arquivo original. */
export function createReusableAnimationAsset(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  sourceName: string,
  role: AnimationRole,
  existingId?: string,
): ReusableAnimationAsset {
  const sourcePose: Record<string, AnimationPoseSnapshot> = {}
  for (const track of clip.tracks) {
    const path = getTransformTrackPath(track)
    if (!path || sourcePose[path.nodeName]) continue
    const node = findAnimationNode(root, path.nodeName)
    if (node) sourcePose[path.nodeName] = snapshotNode(node)
  }

  const sourceNodeNames = [...new Set(clip.tracks
    .map(getTransformTrackPath)
    .filter((path): path is TransformTrackPath => path !== null)
    .map(path => path.nodeName)
    .filter(name => sourcePose[name] !== undefined))]

  return {
    id: existingId ?? `anim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    name: clip.name?.trim() || 'Animação reutilizável',
    sourceName,
    duration: Math.max(0.01, Number.isFinite(clip.duration) ? clip.duration : 1),
    role,
    clipJson: clip.toJSON() as unknown as Record<string, unknown>,
    sourcePose,
    sourceNodeNames,
    sourceHeight: objectHeight(root),
    createdAt: new Date().toISOString(),
  }
}

/** Lê um clipe salvo no formato JSON utilizado pelo próprio Three.js. */
export function parseReusableAnimationClip(asset: ReusableAnimationAsset): THREE.AnimationClip {
  return THREE.AnimationClip.parse(asset.clipJson as Parameters<typeof THREE.AnimationClip.parse>[0])
}

function safeRestVector(values: number[], fallback: THREE.Vector3): THREE.Vector3 {
  if (values.length !== 3 || values.some(value => !Number.isFinite(value))) return fallback.clone()
  return new THREE.Vector3(values[0]!, values[1]!, values[2]!)
}

/**
 * Retarget local-transform tracks from a source rig to destination bones.
 * Quaternion animation is transferred as a delta from source rest pose to
 * destination rest pose; positions preserve offsets proportionally to model size.
 */
export function retargetAnimationClip(
  asset: ReusableAnimationAsset,
  targetBones: THREE.Bone[],
  boneMap: Record<string, string>,
  name: string,
  targetSourceHeight: number,
): RetargetAnimationResult {
  const sourceClip = parseReusableAnimationClip(asset)
  const targetByName = new Map<string, THREE.Bone>()
  for (const bone of targetBones) {
    if (!targetByName.has(bone.name)) targetByName.set(bone.name, bone)
  }

  const scaleRatio = THREE.MathUtils.clamp(
    (Number.isFinite(targetSourceHeight) && targetSourceHeight > 1e-5 ? targetSourceHeight : 1)
      / Math.max(1e-5, asset.sourceHeight),
    0.001,
    1000,
  )
  const tracks: THREE.KeyframeTrack[] = []
  const skippedTracks: string[] = []
  const claimedTargets = new Set<string>()

  for (const track of sourceClip.tracks) {
    const path = getTransformTrackPath(track)
    if (!path) {
      skippedTracks.push(track.name)
      continue
    }

    const targetName = boneMap[path.nodeName]
    const targetBone = targetName ? targetByName.get(targetName) : undefined
    const sourceRest = asset.sourcePose[path.nodeName]
    if (!targetBone || !sourceRest) {
      skippedTracks.push(track.name)
      continue
    }

    const targetTrackName = `${targetBone.name}.${path.property}`
    // Avoid two source nodes writing to the same target property during one clip.
    if (claimedTargets.has(targetTrackName)) {
      skippedTracks.push(track.name)
      continue
    }
    claimedTargets.add(targetTrackName)

    const times = Array.from(track.times)
    const sourceValues = Array.from(track.values as ArrayLike<number>)
    const stride = track.getValueSize()
    if (!times.length || stride <= 0 || sourceValues.length !== times.length * stride) {
      skippedTracks.push(track.name)
      continue
    }

    const values: number[] = []
    if (path.property === 'quaternion' && stride === 4) {
      const sourceRestQ = new THREE.Quaternion(...sourceRest.quaternion)
      const targetRestQ = targetBone.quaternion.clone()
      const inverseSourceRest = sourceRestQ.clone().invert()
      for (let frame = 0; frame < times.length; frame++) {
        const offset = frame * 4
        const sourceQ = new THREE.Quaternion(
          sourceValues[offset]!,
          sourceValues[offset + 1]!,
          sourceValues[offset + 2]!,
          sourceValues[offset + 3]!,
        )
        const delta = inverseSourceRest.clone().multiply(sourceQ).normalize()
        targetRestQ.clone().multiply(delta).normalize().toArray(values, values.length)
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(targetTrackName, times, values, track.getInterpolation()))
      continue
    }

    if ((path.property === 'position' || path.property === 'scale') && stride === 3) {
      if (path.property === 'position') {
        const sourceRestVector = safeRestVector(sourceRest.position, new THREE.Vector3())
        const targetRestVector = targetBone.position.clone()
        for (let frame = 0; frame < times.length; frame++) {
          const offset = frame * 3
          values.push(
            targetRestVector.x + (sourceValues[offset]! - sourceRestVector.x) * scaleRatio,
            targetRestVector.y + (sourceValues[offset + 1]! - sourceRestVector.y) * scaleRatio,
            targetRestVector.z + (sourceValues[offset + 2]! - sourceRestVector.z) * scaleRatio,
          )
        }
      } else {
        const sourceRestScale = safeRestVector(sourceRest.scale, new THREE.Vector3(1, 1, 1))
        const targetRestScale = targetBone.scale.clone()
        for (let frame = 0; frame < times.length; frame++) {
          const offset = frame * 3
          const ratioX = Math.abs(sourceRestScale.x) > 1e-6 ? sourceValues[offset]! / sourceRestScale.x : 1
          const ratioY = Math.abs(sourceRestScale.y) > 1e-6 ? sourceValues[offset + 1]! / sourceRestScale.y : 1
          const ratioZ = Math.abs(sourceRestScale.z) > 1e-6 ? sourceValues[offset + 2]! / sourceRestScale.z : 1
          values.push(targetRestScale.x * ratioX, targetRestScale.y * ratioY, targetRestScale.z * ratioZ)
        }
      }
      tracks.push(new THREE.VectorKeyframeTrack(targetTrackName, times, values, track.getInterpolation()))
      continue
    }

    skippedTracks.push(track.name)
  }

  if (!tracks.length) {
    throw new Error('Nenhuma trilha pôde ser transferida. Confira se o rig de destino possui ossos compatíveis e se eles estão mapeados.')
  }

  const retargeted = new THREE.AnimationClip(name.trim() || sourceClip.name || asset.name, sourceClip.duration, tracks)
  return { clip: retargeted, mappedTracks: tracks.length, skippedTracks }
}

/** Sugere correspondências por nome, ignorando prefixos comuns de exportadores. */
export function suggestTargetBone(sourceName: string, targetBones: THREE.Bone[]): string {
  const normalize = (name: string) => name
    .toLowerCase()
    .replace(/mixamorig|armature|skeleton|bip001|bip01|rig[_ .-]*/g, '')
    .replace(/left/g, 'l')
    .replace(/right/g, 'r')
    .replace(/[^a-z0-9]/g, '')
  const source = normalize(sourceName)
  if (!source) return ''
  const exact = targetBones.find(bone => normalize(bone.name) === source)
  if (exact) return exact.name

  const aliases: Record<string, string[]> = {
    hips: ['pelvis', 'hip', 'root', 'rigroot'],
    pelvis: ['hips', 'hip'],
    spine: ['spine1', 'spine01', 'torso'],
    chest: ['spine2', 'spine02', 'upperchest'],
    neck: ['neck1'],
    head: ['headtop'],
    upperarm_l: ['leftarm', 'arm_l', 'upperarml'],
    upperarm_r: ['rightarm', 'arm_r', 'upperarmr'],
    thigh_l: ['upleg_l', 'leftupleg', 'leg_l'],
    thigh_r: ['upleg_r', 'rightupleg', 'legr'],
  }
  const aliasTargets = aliases[source] ?? []
  const aliasMatch = targetBones.find(bone => aliasTargets.includes(normalize(bone.name)))
  if (aliasMatch) return aliasMatch.name

  const starts = targetBones.filter(bone => normalize(bone.name).endsWith(source) || source.endsWith(normalize(bone.name)))
  return starts.length === 1 ? starts[0]!.name : ''
}
