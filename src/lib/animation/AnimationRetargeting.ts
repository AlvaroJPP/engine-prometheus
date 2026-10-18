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
  /** Orientação mundial do pai em repouso; permite converter eixos entre rigs diferentes. */
  sourceParentWorldQuaternion?: Record<string, [number, number, number, number]>
  sourceNodeNames: string[]
  sourceHeight: number
  createdAt: string
}

export type RetargetAnimationResult = {
  clip: THREE.AnimationClip
  mappedTracks: number
  skippedTracks: string[]
  unmappedTracks: string[]
  unsupportedTracks: string[]
  conflictingTracks: string[]
  invalidTracks: string[]
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
  const found = THREE.PropertyBinding.findNode(root, name) as THREE.Object3D | null
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
  root.updateWorldMatrix(true, true)
  const sourcePose: Record<string, AnimationPoseSnapshot> = {}
  const sourceParentWorldQuaternion: Record<string, [number, number, number, number]> = {}
  for (const track of clip.tracks) {
    const path = getTransformTrackPath(track)
    if (!path || sourcePose[path.nodeName]) continue
    const node = findAnimationNode(root, path.nodeName)
    if (!node) continue
    sourcePose[path.nodeName] = snapshotNode(node)
    const parentQuaternion = new THREE.Quaternion()
    if (node.parent) node.parent.getWorldQuaternion(parentQuaternion)
    sourceParentWorldQuaternion[path.nodeName] = parentQuaternion.toArray() as [number, number, number, number]
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
    sourceParentWorldQuaternion,
    sourceNodeNames,
    sourceHeight: objectHeight(root),
    createdAt: new Date().toISOString(),
  }
}

/** Lê um clipe salvo no formato JSON utilizado pelo próprio Three.js. */
export function parseReusableAnimationClip(asset: ReusableAnimationAsset): THREE.AnimationClip {
  return THREE.AnimationClip.parse(asset.clipJson as unknown as Parameters<typeof THREE.AnimationClip.parse>[0])
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
  const unmappedTracks: string[] = []
  const unsupportedTracks: string[] = []
  const conflictingTracks: string[] = []
  const invalidTracks: string[] = []
  const claimedTargets = new Set<string>()
  const skipTrack = (track: THREE.KeyframeTrack, category: string[]) => {
    skippedTracks.push(track.name)
    category.push(track.name)
  }

  for (const track of sourceClip.tracks) {
    const path = getTransformTrackPath(track)
    if (!path) {
      skipTrack(track, unsupportedTracks)
      continue
    }

    const targetName = boneMap[path.nodeName]
    const targetBone = targetName ? targetByName.get(targetName) : undefined
    const sourceRest = asset.sourcePose[path.nodeName]
    if (!targetBone || !sourceRest) {
      skipTrack(track, unmappedTracks)
      continue
    }

    const targetTrackName = `${targetBone.name}.${path.property}`
    // Avoid two source nodes writing to the same target property during one clip.
    if (claimedTargets.has(targetTrackName)) {
      skipTrack(track, conflictingTracks)
      continue
    }
    claimedTargets.add(targetTrackName)

    const times = Array.from(track.times)
    const sourceValues = Array.from(track.values as ArrayLike<number>)
    const stride = track.getValueSize()
    if (!times.length || stride <= 0 || sourceValues.length !== times.length * stride ||
        times.some(time => !Number.isFinite(time)) || sourceValues.some(value => !Number.isFinite(value))) {
      skipTrack(track, invalidTracks)
      continue
    }

    const values: number[] = []
    if (path.property === 'quaternion' && stride === 4) {
      const sourceRestQ = new THREE.Quaternion(...sourceRest.quaternion)
      const targetRestQ = targetBone.quaternion.clone()
      const inverseSourceRest = sourceRestQ.clone().invert()
      const parentRest = asset.sourceParentWorldQuaternion?.[path.nodeName]
      const sourceParentWorld = parentRest && parentRest.length === 4
        ? new THREE.Quaternion(...parentRest).normalize()
        : null
      const targetParentWorld = new THREE.Quaternion()
      if (targetBone.parent) targetBone.parent.getWorldQuaternion(targetParentWorld)
      const inverseTargetParentWorld = targetParentWorld.clone().invert()
      const inverseSourceParentWorld = sourceParentWorld?.clone().invert() ?? null
      for (let frame = 0; frame < times.length; frame++) {
        const offset = frame * 4
        const sourceQ = new THREE.Quaternion(
          sourceValues[offset]!,
          sourceValues[offset + 1]!,
          sourceValues[offset + 2]!,
          sourceValues[offset + 3]!,
        ).normalize()
        const delta = inverseSourceRest.clone().multiply(sourceQ).normalize()
        // Converte a rotação relativa da base local de origem para a base local do
        // destino usando as orientações dos pais em repouso. Assets antigos não
        // possuem esse dado e continuam usando o caminho compatível anterior.
        let targetDelta = delta
        if (sourceParentWorld && inverseSourceParentWorld) {
          const worldDelta = sourceParentWorld.clone().multiply(delta)
            .multiply(inverseSourceParentWorld).normalize()
          targetDelta = inverseTargetParentWorld.clone().multiply(worldDelta)
            .multiply(targetParentWorld).normalize()
        }
        targetRestQ.clone().multiply(targetDelta).normalize().toArray(values, values.length)
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

    skipTrack(track, unsupportedTracks)
  }

  if (!tracks.length) {
    throw new Error('Nenhuma trilha pôde ser transferida. Confira se o rig de destino possui ossos compatíveis e se eles estão mapeados.')
  }

  const retargeted = new THREE.AnimationClip(name.trim() || sourceClip.name || asset.name, sourceClip.duration, tracks)
  return {
    clip: retargeted,
    mappedTracks: tracks.length,
    skippedTracks,
    unmappedTracks,
    unsupportedTracks,
    conflictingTracks,
    invalidTracks,
  }
}

type BoneNameSignature = {
  original: string
  normalized: string
  compact: string
  tokens: string[]
  role: string
  side: 'left' | 'right' | null
  zone: 'front' | 'hind' | null
  level: number | null
  digit: string | null
  specificity: number
}

const BONE_PREFIX_TOKENS = new Set([
  'mixamorig', 'armature', 'skeleton', 'skel', 'rig', 'deform', 'deformer',
  'def', 'org', 'bip001', 'bip01', 'bone', 'bones', 'joint', 'jnt', 'bn',
  'reference', 'rootnode',
])

function signatureForBoneName(name: string): BoneNameSignature {
  // O nome do canal pode vir qualificado como Armature|mixamorig:Hips.
  // Para comparar, usamos o segmento final e preservamos sufixos .001 como índices.
  const leaf = name.split(/[|/:]/).filter(Boolean).pop() ?? name
  const expanded = leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.]+(?=\d+$)/g, ' ')
  const rawTokens = expanded.split(/[^a-z0-9]+/).filter(Boolean)
  const tokens = rawTokens.filter(token => !BONE_PREFIX_TOKENS.has(token))
  const compact = tokens.join('')
  const normalized = tokens.join('_')

  const has = (...values: string[]) => values.some(value =>
    tokens.includes(value) || compact.includes(value),
  )
  let side: BoneNameSignature['side'] = null
  if (
    has('left', 'lhs', 'lft', 'gauche', 'links', 'izquierdo', 'izquierda', 'esquerdo', 'esquerda') ||
    /^(l)(?=(arm|leg|hand|foot|shoulder|clavicle|thigh|calf|forearm|upperarm|lowerarm|toe|finger|eye))/.test(compact) ||
    /(?:^|_)(l|left)$/.test(normalized)
  ) side = 'left'
  else if (
    has('right', 'rhs', 'rgt', 'droite', 'rechts', 'derecho', 'derecha', 'direito', 'direita') ||
    /^(r)(?=(arm|leg|hand|foot|shoulder|clavicle|thigh|calf|forearm|upperarm|lowerarm|toe|finger|eye))/.test(compact) ||
    /(?:^|_)(r|right)$/.test(normalized)
  ) side = 'right'

  let zone: BoneNameSignature['zone'] = null
  // Evita usar substring "fore": "forearm" é antebraço, não perna dianteira.
  if (
    tokens.some(token => ['front', 'foreleg', 'forelimb', 'frontleg', 'frontlimb'].includes(token)) ||
    (tokens.includes('fore') && tokens.some(token => ['leg', 'limb'].includes(token))) ||
    /(?:^|_)front(?:_|leg|limb|$)/.test(normalized)
  ) zone = 'front'
  else if (
    tokens.some(token => ['hind', 'hindleg', 'hindlimb', 'rear', 'backleg', 'backlimb'].includes(token)) ||
    /(?:^|_)(hind|rear|back)(?:_|leg|limb|$)/.test(normalized)
  ) zone = 'hind'

  const numericSuffix = (value: string): number | null => {
    const match = value.match(/(?:^|[^a-z])(?:spine|neck|tail|finger|phalange|toe|thumb|index|middle|ring|pinky|little)[ _-]*0*(\d+)$/) ??
      value.match(/(?:spine|neck|tail|finger|phalange|toe|thumb|index|middle|ring|pinky|little)0*(\d+)$/)
    return match ? Number(match[1]) : null
  }
  let level = numericSuffix(normalized)

  let digit: string | null = null
  if (has('thumb', 'pollex')) digit = 'thumb'
  else if (has('index', 'pointer', 'forefinger', 'digit2')) digit = 'index'
  else if (has('middle', 'medius', 'digit3')) digit = 'middle'
  else if (has('ring', 'digit4')) digit = 'ring'
  else if (has('pinky', 'littlefinger', 'little', 'digit5')) digit = 'little'

  let role = ''
  if (has('pelvis', 'hips', 'hip', 'waist', 'bassin')) role = 'pelvis'
  else if (has('root', 'master', 'origin', 'worldroot')) role = 'root'
  else if (has('clavicle', 'collar', 'shoulder', 'shoulderjoint')) role = 'shoulder'
  else if (has('neck', 'cervical')) role = 'neck'
  else if (has('head', 'skull', 'cranium', 'headtop')) role = 'head'
  else if (has('jaw', 'mandible')) role = 'jaw'
  else if (has('eye', 'eyeball', 'eyelid')) role = 'eye'
  else if (has('thumb', 'pollex', 'index', 'pointer', 'forefinger', 'middle', 'medius', 'ring', 'pinky', 'littlefinger', 'little', 'phalange', 'finger', 'digit2', 'digit3', 'digit4', 'digit5')) role = 'finger'
  else if (has('wrist', 'hand', 'palm')) role = 'hand'
  else if (has('forearm', 'lowerarm', 'armdown', 'elbow', 'ulna', 'radius')) role = 'lower_arm'
  else if (has('upperarm', 'uparm', 'armup', 'bicep', 'biceps', 'humerus') || /^(left|right|l|r)?arm$/.test(compact)) role = 'upper_arm'
  else if (has('thigh', 'upleg', 'upperleg', 'femur', 'hipjoint')) role = 'thigh'
  else if (has('calf', 'shin', 'lowerleg', 'legdown', 'knee', 'tibia', 'fibula', 'kneecap')) role = 'lower_leg'
  else if (has('ankle', 'foot', 'heel', 'paw', 'hoof')) role = 'foot'
  else if (has('toe', 'toes', 'ball')) role = 'toe'
  else if (has('tail', 'tailbase', 'tailtip')) role = 'tail'
  else if (has('chest', 'upperchest', 'thorax', 'ribcage', 'torso')) {
    role = 'spine'
    level = level ?? (has('upperchest') ? 3 : has('chest', 'thorax') ? 2 : null)
  } else if (has('spine', 'vertebra', 'lumbar', 'backbone')) role = 'spine'
  else if (has('leg', 'limb', 'foreleg', 'hindleg')) role = 'leg'
  else if (has('arm', 'limbarm')) role = 'upper_arm'
  else if (has('finger')) role = 'finger'

  // "Spine2", "Spine_02" e "spine.002" passam a ter a mesma assinatura.
  if (role === 'spine' && level === null) {
    const joined = tokens.join('_')
    if (/upper[_]?spine|spine[_]?upper/.test(joined)) level = 2
    else if (/lower[_]?spine|spine[_]?lower/.test(joined)) level = 1
  }
  // Em rigs quadrúpedes alguns ossos são chamados FrontLeg/HindLeg sem segmento.
  if (!role && zone && has('leg', 'limb')) role = 'leg'

  const meaningful = tokens.filter(token =>
    !['left', 'right', 'l', 'r', 'front', 'fore', 'hind', 'rear', 'back'].includes(token) &&
    !/^\d+$/.test(token),
  )
  const specificity =
    (role ? 3 : 0) +
    (side ? 2 : 0) +
    (zone ? 2 : 0) +
    (level !== null ? 1 : 0) +
    (digit ? 1 : 0)

  return { original: name, normalized, compact, tokens: meaningful, role, side, zone, level, digit, specificity }
}

function tokenSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const left = new Set(a)
  const right = new Set(b)
  let overlap = 0
  for (const token of left) if (right.has(token)) overlap += 1
  const union = new Set([...left, ...right]).size
  return union ? overlap / union : 0
}

function ancestorSignatures(node: THREE.Object3D | null | undefined): BoneNameSignature[] {
  const result: BoneNameSignature[] = []
  let current = node?.parent ?? null
  while (current && result.length < 6) {
    if (current.name) {
      const signature = signatureForBoneName(current.name)
      if (signature.role) result.push(signature)
    }
    current = current.parent
  }
  return result
}

function ancestorContextScore(source: BoneNameSignature[], target: BoneNameSignature[]): number {
  let score = 0
  const count = Math.min(source.length, target.length, 4)
  for (let index = 0; index < count; index += 1) {
    const a = source[index]!
    const b = target[index]!
    if (a.role && a.role === b.role) {
      score += 7
      if (a.side && b.side && a.side === b.side) score += 3
      if (a.zone && b.zone && a.zone === b.zone) score += 3
    } else if (a.role && b.role) {
      // Se o mesmo nível da hierarquia representa outra parte anatômica, isso
      // é sinal de que a correspondência pode estar cruzando ramos do esqueleto.
      score -= 5
    }
  }
  return THREE.MathUtils.clamp(score, -15, 24)
}

export type BoneSimilarityCandidate = {
  targetName: string
  score: number
  exactName: boolean
}

type BoneSpatialSignature = {
  x: number
  y: number
  z: number
  segmentLength: number
  depth: number
  childCount: number
  hasChildren: boolean
}

function nearestBoneChildren(node: THREE.Object3D, boneSet: Set<THREE.Object3D>): THREE.Object3D[] {
  const result: THREE.Object3D[] = []
  const queue = [...node.children]
  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index]!
    if (boneSet.has(candidate)) result.push(candidate)
    else queue.push(...candidate.children)
  }
  return result
}

/**
 * Cria features espaciais independentes da escala e da posição externa do GLB.
 * Elas servem como desempate; nomes, lateralidade e anatomia continuam tendo
 * prioridade para não forçar uma transferência apenas porque dois ossos ocupam
 * posições visualmente próximas.
 */
function buildBoneSpatialProfiles(
  root: THREE.Object3D | null | undefined,
  bones: THREE.Object3D[],
): Map<THREE.Object3D, BoneSpatialSignature> {
  const profiles = new Map<THREE.Object3D, BoneSpatialSignature>()
  if (!root || bones.length === 0) return profiles

  root.updateWorldMatrix(true, true)
  const inverseRoot = root.matrixWorld.clone().invert()
  const positions = new Map<THREE.Object3D, THREE.Vector3>()
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)

  for (const bone of bones) {
    const position = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot)
    positions.set(bone, position)
    min.min(position)
    max.max(position)
  }

  const center = min.clone().add(max).multiplyScalar(0.5)
  const size = max.clone().sub(min)
  const scale = Math.max(size.x, size.y, size.z, 1e-6)
  const boneSet = new Set(bones)
  const depths = new Map<THREE.Object3D, number>()
  let maxDepth = 0

  for (const bone of bones) {
    let depth = 0
    let ancestor = bone.parent
    while (ancestor && ancestor !== root) {
      if (boneSet.has(ancestor)) depth += 1
      ancestor = ancestor.parent
    }
    depths.set(bone, depth)
    maxDepth = Math.max(maxDepth, depth)
  }

  for (const bone of bones) {
    const position = positions.get(bone)!
    let segmentLength = 0
    const children = nearestBoneChildren(bone, boneSet)
    if (children.length > 0) {
      segmentLength = children.reduce((sum, child) =>
        sum + position.distanceTo(positions.get(child)!), 0) / children.length / scale
    } else {
      let ancestor = bone.parent
      while (ancestor && ancestor !== root && !boneSet.has(ancestor)) ancestor = ancestor.parent
      const parentPosition = ancestor ? positions.get(ancestor) : undefined
      if (parentPosition) segmentLength = position.distanceTo(parentPosition) / scale
    }

    profiles.set(bone, {
      x: (position.x - center.x) / scale,
      y: (position.y - center.y) / scale,
      z: (position.z - center.z) / scale,
      segmentLength,
      depth: (depths.get(bone) ?? 0) / Math.max(1, maxDepth),
      childCount: children.length,
      hasChildren: children.length > 0,
    })
  }
  return profiles
}

function spatialSimilarityScore(source: BoneSpatialSignature, target: BoneSpatialSignature): number {
  const positionDistance =
    Math.abs(source.x - target.x) * 0.6 +
    Math.abs(source.y - target.y) +
    Math.abs(source.z - target.z) * 0.6
  const positionScore = 6 - Math.min(1.2, positionDistance) * 10
  const lengthDifference = Math.abs(source.segmentLength - target.segmentLength)
  const lengthScore = 2 - Math.min(1, lengthDifference) * 4
  const depthDifference = Math.abs(source.depth - target.depth)
  const depthScore = 1.5 - Math.min(1, depthDifference) * 3
  // Estruturas com nomes opacos ainda podem ser alinhadas pela forma do grafo:
  // profundidade relativa, bifurcações e posição terminal/importância do nó.
  const childDifference = Math.abs(source.childCount - target.childCount)
  const branchScore = source.childCount === target.childCount
    ? 5
    : Math.max(-4, 3 - childDifference * 2)
  const terminalScore = source.hasChildren === target.hasChildren ? 3 : -2.5
  return positionScore + lengthScore + depthScore + branchScore + terminalScore
}

function scoreBonePair(
  source: BoneNameSignature,
  target: BoneNameSignature,
  sourceAncestors: BoneNameSignature[],
  targetAncestors: BoneNameSignature[],
  sourceSpatial?: BoneSpatialSignature,
  targetSpatial?: BoneSpatialSignature,
): number {
  if (source.side && target.side && source.side !== target.side) return Number.NEGATIVE_INFINITY
  if (source.zone && target.zone && source.zone !== target.zone) return Number.NEGATIVE_INFINITY
  if (source.digit && target.digit && source.digit !== target.digit) return Number.NEGATIVE_INFINITY

  const limbRoles = new Set(['shoulder', 'upper_arm', 'lower_arm', 'hand', 'thigh', 'lower_leg', 'leg', 'foot', 'toe'])
  const crossAnatomyLimb = source.role && target.role && source.role !== target.role &&
    limbRoles.has(source.role) && limbRoles.has(target.role)
  const rootPelvisPair = source.role && target.role && source.role !== target.role &&
    ['root', 'pelvis'].includes(source.role) && ['root', 'pelvis'].includes(target.role)
  if (source.role && target.role && source.role !== target.role && !crossAnatomyLimb && !rootPelvisPair) {
    // Não confunde cabeça/coluna/cauda entre si, mas permite transferir movimento
    // entre segmentos de membros em esqueletos de anatomias diferentes.
    return Number.NEGATIVE_INFINITY
  }

  let score = 0
  if (source.normalized === target.normalized || source.compact === target.compact) score += 120
  if (source.role && source.role === target.role) score += 72
  else if (crossAnatomyLimb) score += 26
  else if (rootPelvisPair) score += 20
  else if (!source.role || !target.role) score += 12 + tokenSimilarity(source.tokens, target.tokens) * 35

  if (source.side && target.side && source.side === target.side) score += 24
  else if (!source.side && target.side) score -= 7

  if (source.zone && target.zone && source.zone === target.zone) score += 20
  else if (!source.zone && target.zone) score -= 4

  if (source.level !== null && target.level !== null) {
    score += source.level === target.level ? 18 : -22
  } else if (source.level !== null || target.level !== null) {
    score -= 2
  }
  if (source.digit && target.digit && source.digit === target.digit) score += 18

  const similarity = tokenSimilarity(source.tokens, target.tokens)
  score += similarity * 24
  if (source.compact.length >= 4 && target.compact.length >= 4) {
    if (source.compact.endsWith(target.compact) || target.compact.endsWith(source.compact)) score += 8
  }
  score += ancestorContextScore(sourceAncestors, targetAncestors)
  if (sourceSpatial && targetSpatial) {
    score += spatialSimilarityScore(sourceSpatial, targetSpatial)
  }
  return score
}

/**
 * Retorna as melhores opções para cada canal com a pontuação composta usada
 * pelo auto-mapeamento. O score é um indicador comparativo, não uma probabilidade.
 */
export function rankTargetBoneCandidates(
  sourceNames: string[],
  targetBones: THREE.Bone[],
  sourceRoot?: THREE.Object3D | null,
  targetRoot?: THREE.Object3D | null,
): Record<string, BoneSimilarityCandidate[]> {
  if (!sourceNames.length || !targetBones.length) return {}

  const targetSignatures = targetBones.map(bone => signatureForBoneName(bone.name))
  const targetAncestors = targetBones.map(bone => ancestorSignatures(bone))
  const sourceSignatures = sourceNames.map(name => signatureForBoneName(name))
  const sourceAncestors = sourceNames.map(name =>
    ancestorSignatures(sourceRoot ? findAnimationNode(sourceRoot, name) : null),
  )
  const sourceNodeNames = new Set(sourceNames
    .map(name => sourceRoot ? findAnimationNode(sourceRoot, name) : null)
    .filter((node): node is THREE.Object3D => node !== null))
  const sourceStructureNodes: THREE.Object3D[] = []
  sourceRoot?.traverse(node => {
    if (node instanceof THREE.Bone || sourceNodeNames.has(node)) sourceStructureNodes.push(node)
  })
  const sourceSpatial = buildBoneSpatialProfiles(sourceRoot, sourceStructureNodes)
  const targetSpatial = buildBoneSpatialProfiles(targetRoot, targetBones)
  const bySource: Record<string, BoneSimilarityCandidate[]> = {}

  sourceSignatures.forEach((source, sourceIndex) => {
    const sourceNode = sourceRoot ? findAnimationNode(sourceRoot, source.original) : null
    const sourceFeatures = sourceNode ? sourceSpatial.get(sourceNode) : undefined
    bySource[source.original] = targetBones.map((bone, targetIndex) => {
      const targetSignature = targetSignatures[targetIndex]!
      const score = scoreBonePair(
        source,
        targetSignature,
        sourceAncestors[sourceIndex]!,
        targetAncestors[targetIndex]!,
        sourceFeatures,
        targetSpatial.get(bone),
      )
      return {
        targetName: bone.name,
        score,
        exactName: source.normalized === targetSignature.normalized ||
          source.compact === targetSignature.compact,
      }
    })
      .filter(candidate => Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score || a.targetName.localeCompare(b.targetName))
  })

  return bySource
}

/**
 * Gera mapeamentos globais um-para-um. Usa semântica anatômica, hierarquia e,
 * como refinamento, posição relativa, profundidade e tamanho dos segmentos.
 * Associações ambíguas ficam vazias para não transferir movimento ao osso errado.
 */
export function suggestTargetBoneMappings(
  sourceNames: string[],
  targetBones: THREE.Bone[],
  sourceRoot?: THREE.Object3D | null,
  targetRoot?: THREE.Object3D | null,
): Record<string, string> {
  if (!sourceNames.length || !targetBones.length) return {}

  const sourceSignatures = sourceNames.map(name => signatureForBoneName(name))
  const ranked = rankTargetBoneCandidates(sourceNames, targetBones, sourceRoot, targetRoot)
  const viable = sourceSignatures.map((source, sourceIndex) => {
    const candidates = (ranked[source.original] ?? []).filter(candidate => {
      const target = signatureForBoneName(candidate.targetName)
      // Quando ambos os rigs usam nomes genéricos (Bone.001, joint_03 etc.),
      // o score semântico naturalmente é menor; aceita o caminho estrutural apenas
      // com score mínimo e margem suficiente contra alternativas equivalentes.
      const threshold = source.role && target.role ? 48 : 19
      return candidate.score >= threshold
    })
    const best = candidates[0]
    if (!best) return { sourceName: source.original, sourceIndex, candidates: [] as Array<BoneSimilarityCandidate & { targetIndex: number }> }

    const second = candidates[1]
    const bestTargetSignature = signatureForBoneName(best.targetName)
    const hasSemanticPair = !!source.role && !!bestTargetSignature.role
    const closeAmbiguity = !!second && best.score - second.score < (hasSemanticPair ? 11 : 5)
    // Nomes e papéis reconhecíveis podem resolver empates; rigs com nomes
    // genéricos precisam de uma vantagem estrutural clara contra o segundo candidato.
    if (closeAmbiguity && !best.exactName) {
      return { sourceName: source.original, sourceIndex, candidates: [] as Array<BoneSimilarityCandidate & { targetIndex: number }> }
    }

    return {
      sourceName: source.original,
      sourceIndex,
      candidates: candidates
        .filter(candidate => candidate.score >= best.score - 16)
        .map(candidate => ({
          ...candidate,
          targetIndex: targetBones.findIndex(bone => bone.name === candidate.targetName),
        })),
    }
  })

  const proposals = viable.flatMap(entry => entry.candidates.map(candidate => ({
    sourceName: entry.sourceName,
    sourceIndex: entry.sourceIndex,
    ...candidate,
    sourceSpecificity: sourceSignatures[entry.sourceIndex]!.specificity,
  }))).sort((a, b) =>
    b.score - a.score ||
    b.sourceSpecificity - a.sourceSpecificity ||
    a.sourceIndex - b.sourceIndex ||
    a.targetIndex - b.targetIndex,
  )

  const result: Record<string, string> = {}
  const claimedSources = new Set<string>()
  const claimedTargets = new Set<string>()
  for (const proposal of proposals) {
    if (claimedSources.has(proposal.sourceName) || claimedTargets.has(proposal.targetName)) continue
    result[proposal.sourceName] = proposal.targetName
    claimedSources.add(proposal.sourceName)
    claimedTargets.add(proposal.targetName)
  }
  return result
}


/**
 * Starts with conservative semantic mappings, then fills safe gaps using mapped
 * parent branches as an anchor. It never reuses a target bone or bypasses hard
 * side/anatomy constraints.
 */
export function suggestAutonomousBoneMappings(
  sourceNames: string[],
  targetBones: THREE.Bone[],
  sourceRoot?: THREE.Object3D | null,
  targetRoot?: THREE.Object3D | null,
): Record<string, string> {
  const result = suggestTargetBoneMappings(sourceNames, targetBones, sourceRoot, targetRoot)
  if (!sourceRoot || !targetRoot || !sourceNames.length || !targetBones.length) return result

  const claimedTargets = new Set(Object.values(result))
  const targetByName = new Map<string, THREE.Bone>()
  for (const bone of targetBones) if (!targetByName.has(bone.name)) targetByName.set(bone.name, bone)

  const sourceNodeByName = new Map<string, THREE.Object3D>()
  const sourceNameByNode = new Map<THREE.Object3D, string>()
  const sourceDepthByName = new Map<string, number>()
  for (const name of sourceNames) {
    const node = findAnimationNode(sourceRoot, name)
    if (!node) continue
    sourceNodeByName.set(name, node)
    if (!sourceNameByNode.has(node)) sourceNameByNode.set(node, name)
    let depth = 0
    let ancestor = node.parent
    while (ancestor && ancestor !== sourceRoot) {
      depth += 1
      ancestor = ancestor.parent
    }
    sourceDepthByName.set(name, depth)
  }

  const nearestMappedSourceAncestor = (node: THREE.Object3D | undefined) => {
    let ancestor = node?.parent ?? null
    while (ancestor && ancestor !== sourceRoot) {
      const sourceName = sourceNameByNode.get(ancestor)
      const targetName = sourceName ? result[sourceName] : undefined
      const targetBone = targetName ? targetByName.get(targetName) : undefined
      if (sourceName && targetBone) return { sourceName, targetBone }
      ancestor = ancestor.parent
    }
    return null
  }
  const distanceFromTargetAncestor = (node: THREE.Object3D, ancestor: THREE.Object3D): number | null => {
    let current: THREE.Object3D | null = node
    let distance = 0
    while (current) {
      if (current === ancestor) return distance
      current = current.parent
      distance += 1
    }
    return null
  }

  const ranking = rankTargetBoneCandidates(sourceNames, targetBones, sourceRoot, targetRoot)
  const sourceSignatureByName = new Map<string, BoneNameSignature>(
    sourceNames.map(name => [name, signatureForBoneName(name)] as const),
  )
  const limbRoles = new Set(['shoulder', 'upper_arm', 'lower_arm', 'hand', 'thigh', 'lower_leg', 'leg', 'foot', 'toe'])
  const maxPasses = Math.min(sourceNames.length, targetBones.length)

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let addedThisPass = false
    const pending = sourceNames
      .filter(name => !result[name])
      .sort((a, b) => (sourceDepthByName.get(a) ?? 0) - (sourceDepthByName.get(b) ?? 0))

    for (const sourceName of pending) {
      const sourceSignature = sourceSignatureByName.get(sourceName)!
      const mappedAncestor = nearestMappedSourceAncestor(sourceNodeByName.get(sourceName))
      const candidates = (ranking[sourceName] ?? [])
        .filter(candidate => !claimedTargets.has(candidate.targetName))
        .map(candidate => {
          const targetBone = targetByName.get(candidate.targetName)
          if (!targetBone) return null
          const targetSignature = signatureForBoneName(candidate.targetName)
          const sameRole = !!sourceSignature.role && sourceSignature.role === targetSignature.role
          const crossLimb = !!sourceSignature.role && !!targetSignature.role &&
            sourceSignature.role !== targetSignature.role &&
            limbRoles.has(sourceSignature.role) && limbRoles.has(targetSignature.role)
          const rootPelvis = !!sourceSignature.role && !!targetSignature.role &&
            sourceSignature.role !== targetSignature.role &&
            ['root', 'pelvis'].includes(sourceSignature.role) &&
            ['root', 'pelvis'].includes(targetSignature.role)

          let hierarchyBonus = 0
          if (mappedAncestor) {
            const targetGap = distanceFromTargetAncestor(targetBone, mappedAncestor.targetBone)
            if (targetGap === null || targetGap === 0) hierarchyBonus -= 28
            else hierarchyBonus += Math.max(12, 34 - Math.max(0, targetGap - 1) * 3)
          }

          let minimumScore = 19
          if (sameRole) minimumScore = 40
          else if (crossLimb || rootPelvis) minimumScore = 25
          else if (!sourceSignature.role || !targetSignature.role) minimumScore = mappedAncestor ? 13 : 19

          return {
            targetName: candidate.targetName,
            score: candidate.score + hierarchyBonus,
            exactName: candidate.exactName,
            minimumScore,
            hasParentAnchor: !!mappedAncestor,
          }
        })
        .filter(candidate => candidate !== null)
        .filter(candidate => candidate.score >= candidate.minimumScore)
        .sort((a, b) => b.score - a.score || a.targetName.localeCompare(b.targetName))

      const best = candidates[0]
      if (!best) continue
      const second = candidates[1]
      const margin = best.score - (second?.score ?? Number.NEGATIVE_INFINITY)
      const requiredMargin = best.hasParentAnchor ? 3 : 7
      if (!best.exactName && second && margin < requiredMargin) continue

      result[sourceName] = best.targetName
      claimedTargets.add(best.targetName)
      addedThisPass = true
    }

    if (!addedThisPass) break
  }
  return result
}

/** Compatibilidade para chamadas individuais: agora usa a mesma lógica semântica. */
export function suggestTargetBone(sourceName: string, targetBones: THREE.Bone[]): string {
  return suggestTargetBoneMappings([sourceName], targetBones)[sourceName] ?? ''
}
