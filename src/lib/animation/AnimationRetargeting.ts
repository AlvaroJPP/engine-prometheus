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

function scoreBonePair(
  source: BoneNameSignature,
  target: BoneNameSignature,
  sourceAncestors: BoneNameSignature[],
  targetAncestors: BoneNameSignature[],
): number {
  if (source.side && target.side && source.side !== target.side) return Number.NEGATIVE_INFINITY
  if (source.zone && target.zone && source.zone !== target.zone) return Number.NEGATIVE_INFINITY
  if (source.digit && target.digit && source.digit !== target.digit) return Number.NEGATIVE_INFINITY

  if (source.role && target.role && source.role !== target.role) {
    // "Spine" e "Chest" foram canonizados na mesma família; outros papéis
    // anatômicos não devem ser combinados só porque os nomes parecem próximos.
    return Number.NEGATIVE_INFINITY
  }

  let score = 0
  if (source.normalized === target.normalized || source.compact === target.compact) score += 120
  if (source.role && source.role === target.role) score += 72
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
  return score
}

/**
 * Gera mapeamentos automáticos globais e um-para-um. Combina semântica anatômica,
 * lado, região, nível do osso e contexto da hierarquia em vez de depender só do nome.
 * Associações ambíguas ficam sem preencher para evitar transferir movimento ao osso errado.
 */
export function suggestTargetBoneMappings(
  sourceNames: string[],
  targetBones: THREE.Bone[],
  sourceRoot?: THREE.Object3D | null,
): Record<string, string> {
  if (!sourceNames.length || !targetBones.length) return {}

  const targetSignatures = targetBones.map(bone => signatureForBoneName(bone.name))
  const targetAncestors = targetBones.map(bone => ancestorSignatures(bone))
  const sourceSignatures = sourceNames.map(name => signatureForBoneName(name))
  const sourceAncestors = sourceNames.map(name => ancestorSignatures(sourceRoot ? findAnimationNode(sourceRoot, name) : null))

  const ranked = sourceSignatures.map((source, sourceIndex) => {
    const candidates = targetBones.map((bone, targetIndex) => ({
      targetName: bone.name,
      targetIndex,
      score: scoreBonePair(source, targetSignatures[targetIndex]!, sourceAncestors[sourceIndex]!, targetAncestors[targetIndex]!),
      exactName: source.normalized === targetSignatures[targetIndex]!.normalized ||
        source.compact === targetSignatures[targetIndex]!.compact,
    }))
      .filter(candidate => Number.isFinite(candidate.score) && candidate.score >= 48)
      .sort((a, b) => b.score - a.score || a.targetIndex - b.targetIndex)

    const best = candidates[0]
    if (!best) return { sourceName: source.original, sourceIndex, candidates: [] as typeof candidates }

    const second = candidates[1]
    const closeAmbiguity = !!second && best.score - second.score < 11
    // Uma correspondência de nome exata supera a ambiguidade apenas quando há
    // um alvo exato único; nomes genéricos como "Arm" não escolhem lado ao acaso.
    if (closeAmbiguity && !best.exactName) {
      return { sourceName: source.original, sourceIndex, candidates: [] as typeof candidates }
    }

    return {
      sourceName: source.original,
      sourceIndex,
      candidates: candidates.filter(candidate => candidate.score >= best.score - 16),
    }
  })

  // Prioriza candidatos mais confiáveis, sem permitir que dois canais conduzam
  // o mesmo osso de destino. As associações conflitantes ficam para ajuste manual.
  const proposals = ranked.flatMap(entry => entry.candidates.map(candidate => ({
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

/** Compatibilidade para chamadas individuais: agora usa a mesma lógica semântica. */
export function suggestTargetBone(sourceName: string, targetBones: THREE.Bone[]): string {
  return suggestTargetBoneMappings([sourceName], targetBones)[sourceName] ?? ''
}
