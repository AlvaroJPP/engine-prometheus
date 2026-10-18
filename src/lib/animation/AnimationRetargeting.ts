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
  /** Orientação mundial do pai em repouso; compatibilidade com assets de animação antigos. */
  sourceParentWorldQuaternion?: Record<string, [number, number, number, number]>
  /** Orientação mundial do próprio osso em repouso; converte corretamente os eixos de flexão/torção entre rigs. */
  sourceBoneWorldQuaternion?: Record<string, [number, number, number, number]>
  sourceNodeNames: string[]
  /** Nós do clipe que são ossos de fato; opcional para compatibilidade com a biblioteca antiga. */
  sourceBoneNames?: string[]
  /** Pai ósseo mais próximo por nome, para ordenar rotações quando juntas são recolhidas. */
  sourceParentNames?: Record<string, string | null>
  sourceHeight: number
  createdAt: string
}

export type RetargetAnimationResult = {
  clip: THREE.AnimationClip
  /** Trilhas da origem aproveitadas, incluindo rotações combinadas. */
  mappedTracks: number
  /** Trilhas efetivamente emitidas para o esqueleto de destino. */
  outputTracks: number
  /** Rotações adicionais de juntas da origem combinadas em uma junta de destino. */
  mergedTracks: number
  skippedTracks: string[]
  unmappedTracks: string[]
  unsupportedTracks: string[]
  conflictingTracks: string[]
  invalidTracks: string[]
  collapsedTracks: string[]
  /** Trilhas de escala inseguras foram preservadas na escala original do rig de destino. */
  unsafeScaleTracks: string[]
  /** Translações locais incompatíveis foram ignoradas para preservar o comprimento e a posição dos membros. */
  unsafePositionTracks: string[]
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
  const sourceBoneWorldQuaternion: Record<string, [number, number, number, number]> = {}
  for (const track of clip.tracks) {
    const path = getTransformTrackPath(track)
    if (!path || sourcePose[path.nodeName]) continue
    const node = findAnimationNode(root, path.nodeName)
    if (!node) continue
    sourcePose[path.nodeName] = snapshotNode(node)
    const parentQuaternion = new THREE.Quaternion()
    if (node.parent) node.parent.getWorldQuaternion(parentQuaternion)
    sourceParentWorldQuaternion[path.nodeName] = parentQuaternion.toArray() as [number, number, number, number]
    const boneWorldQuaternion = new THREE.Quaternion()
    node.getWorldQuaternion(boneWorldQuaternion)
    sourceBoneWorldQuaternion[path.nodeName] = boneWorldQuaternion.toArray() as [number, number, number, number]
  }

  const sourceNodeNames = [...new Set(clip.tracks
    .map(getTransformTrackPath)
    .filter((path): path is TransformTrackPath => path !== null)
    .map(path => path.nodeName)
    .filter(name => sourcePose[name] !== undefined))]
  const sourceBoneNames = sourceNodeNames.filter(name => findAnimationNode(root, name) instanceof THREE.Bone)
  const sourceBoneNameSet = new Set(sourceBoneNames)
  const sourceParentNames: Record<string, string | null> = {}
  for (const name of sourceBoneNames) {
    const sourceNode = findAnimationNode(root, name)
    let parent = sourceNode?.parent ?? null
    while (parent && parent !== root && !(parent instanceof THREE.Bone && sourceBoneNameSet.has(parent.name))) {
      parent = parent.parent
    }
    sourceParentNames[name] = parent instanceof THREE.Bone ? parent.name : null
  }

  return {
    id: existingId ?? `anim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    name: clip.name?.trim() || 'Animação reutilizável',
    sourceName,
    duration: Math.max(0.01, Number.isFinite(clip.duration) ? clip.duration : 1),
    role,
    clipJson: clip.toJSON() as unknown as Record<string, unknown>,
    sourcePose,
    sourceParentWorldQuaternion,
    sourceBoneWorldQuaternion,
    sourceNodeNames,
    sourceBoneNames,
    sourceParentNames,
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
  collapsedSourceNames: string[] = [],
): RetargetAnimationResult {
  const sourceClip = parseReusableAnimationClip(asset)
  const targetByName = new Map<string, THREE.Bone>()
  for (const bone of targetBones) if (!targetByName.has(bone.name)) targetByName.set(bone.name, bone)

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
  const collapsedTracks: string[] = []
  const unsafeScaleTracks: string[] = []
  const unsafePositionTracks: string[] = []
  const collapsedSources = new Set(collapsedSourceNames)
  const claimedTargets = new Set<string>()
  const quaternionGroups = new Map<string, {
    targetBone: THREE.Bone
    contributions: Array<{
      track: THREE.KeyframeTrack
      sourceName: string
      sourceRestQuaternion: THREE.Quaternion
      sourceParentWorld: THREE.Quaternion | null
      /** Orientação mundial da própria junta em repouso para alinhar os eixos anatômicos. */
      sourceBoneRestWorld: THREE.Quaternion | null
      order: number
    }>
  }>()
  const skipTrack = (track: THREE.KeyframeTrack, category: string[]) => {
    skippedTracks.push(track.name)
    category.push(track.name)
  }
  let mappedSourceTracks = 0
  let mergedTracks = 0

  for (let trackIndex = 0; trackIndex < sourceClip.tracks.length; trackIndex += 1) {
    const track = sourceClip.tracks[trackIndex]!
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

    const times = Array.from(track.times)
    const sourceValues = Array.from(track.values as ArrayLike<number>)
    const stride = track.getValueSize()
    if (!times.length || stride <= 0 || sourceValues.length !== times.length * stride ||
        times.some(time => !Number.isFinite(time)) || sourceValues.some(value => !Number.isFinite(value))) {
      skipTrack(track, invalidTracks)
      continue
    }

    const targetTrackName = targetBone.name + '.' + path.property
    if (path.property === 'quaternion' && stride === 4) {
      let group = quaternionGroups.get(targetTrackName)
      if (!group) {
        group = { targetBone, contributions: [] }
        quaternionGroups.set(targetTrackName, group)
      }
      if (group.contributions.some(item => item.sourceName === path.nodeName)) {
        skipTrack(track, conflictingTracks)
        continue
      }
      const parentRest = asset.sourceParentWorldQuaternion?.[path.nodeName]
      const sourceParentWorld = parentRest && parentRest.length === 4
        ? new THREE.Quaternion(...parentRest).normalize()
        : null
      const boneWorldRest = asset.sourceBoneWorldQuaternion?.[path.nodeName]
      const sourceBoneRestWorld = boneWorldRest && boneWorldRest.length === 4
        ? new THREE.Quaternion(...boneWorldRest).normalize()
        : null
      const restQuaternion = new THREE.Quaternion(...sourceRest.quaternion).normalize()
      if (restQuaternion.lengthSq() < 1e-8) restQuaternion.identity()
      group.contributions.push({
        track,
        sourceName: path.nodeName,
        sourceRestQuaternion: restQuaternion,
        sourceParentWorld,
        sourceBoneRestWorld,
        order: trackIndex,
      })
      continue
    }

    // A collapsed joint has no independent destination translation or scale.
    // Its rotation is composed with the primary joint rather than overwriting it.
    if (collapsedSources.has(path.nodeName)) {
      skipTrack(track, collapsedTracks)
      continue
    }
    if (claimedTargets.has(targetTrackName)) {
      skipTrack(track, conflictingTracks)
      continue
    }

    const values: number[] = []
    if ((path.property === 'position' || path.property === 'scale') && stride === 3) {
      if (path.property === 'position') {
        const sourceRole = signatureForBoneName(path.nodeName).role
        const targetRole = signatureForBoneName(targetBone.name).role
        const isRootTrack = sourceRole === 'root' && ['root', 'pelvis'].includes(targetRole)
        const isPelvisTrack = sourceRole === 'pelvis' && ['pelvis', 'root'].includes(targetRole)
        // Retargeting entre rigs diferentes não deve reposicionar juntas locais
        // de pernas, braços ou coluna: isso altera o comprimento da cadeia e pode
        // colapsar/deslocar a metade inferior inteira. Só transferimos movimento
        // de raiz/pelve, e apenas quando o deslocamento permanece plausível.
        if (!isRootTrack && !isPelvisTrack) {
          skipTrack(track, unsafePositionTracks)
          continue
        }
        const sourceRestVector = safeRestVector(sourceRest.position, new THREE.Vector3())
        const targetRestVector = targetBone.position.clone()
        const maxOffset = Math.max(0.05, targetSourceHeight * (isRootTrack ? 2 : 0.15))
        let unsafePosition = false
        for (let frame = 0; frame < times.length; frame += 1) {
          const offset = frame * 3
          const dx = (sourceValues[offset]! - sourceRestVector.x) * scaleRatio
          const dy = (sourceValues[offset + 1]! - sourceRestVector.y) * scaleRatio
          const dz = (sourceValues[offset + 2]! - sourceRestVector.z) * scaleRatio
          if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) ||
              Math.hypot(dx, dy, dz) > maxOffset) {
            unsafePosition = true
            break
          }
        }
        if (unsafePosition) {
          skipTrack(track, unsafePositionTracks)
          continue
        }
        for (let frame = 0; frame < times.length; frame += 1) {
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
        const scaleRatiosAreSafe = (rest: number, animated: number): boolean => {
          const ratio = Math.abs(rest) > 1e-6 ? animated / rest : 1
          // Escala nula/negativa ou extrema numa junta pode colapsar uma malha
          // inteira ligada à pelve/pernas. Em retargeting entre rigs diferentes,
          // é mais seguro manter a escala original do destino do que propagar
          // essa deformação da origem.
          return Number.isFinite(ratio) && ratio >= 0.05 && ratio <= 8
        }
        let unsafeScale = false
        for (let frame = 0; frame < times.length && !unsafeScale; frame += 1) {
          const offset = frame * 3
          unsafeScale = !scaleRatiosAreSafe(sourceRestScale.x, sourceValues[offset]!) ||
            !scaleRatiosAreSafe(sourceRestScale.y, sourceValues[offset + 1]!) ||
            !scaleRatiosAreSafe(sourceRestScale.z, sourceValues[offset + 2]!)
        }
        if (unsafeScale) {
          skipTrack(track, unsafeScaleTracks)
          continue
        }
        for (let frame = 0; frame < times.length; frame += 1) {
          const offset = frame * 3
          const ratioX = Math.abs(sourceRestScale.x) > 1e-6 ? sourceValues[offset]! / sourceRestScale.x : 1
          const ratioY = Math.abs(sourceRestScale.y) > 1e-6 ? sourceValues[offset + 1]! / sourceRestScale.y : 1
          const ratioZ = Math.abs(sourceRestScale.z) > 1e-6 ? sourceValues[offset + 2]! / sourceRestScale.z : 1
          values.push(targetRestScale.x * ratioX, targetRestScale.y * ratioY, targetRestScale.z * ratioZ)
        }
      }
      tracks.push(new THREE.VectorKeyframeTrack(targetTrackName, times, values, track.getInterpolation()))
      claimedTargets.add(targetTrackName)
      mappedSourceTracks += 1
      continue
    }
    skipTrack(track, unsupportedTracks)
  }

  const parentNames = asset.sourceParentNames ?? {}
  const sourceDepth = (name: string): number => {
    let depth = 0
    let current = name
    const seen = new Set<string>([name])
    while (parentNames[current]) {
      const parent = parentNames[current]!
      if (seen.has(parent)) break
      seen.add(parent)
      depth += 1
      current = parent
    }
    return depth
  }

  for (const [targetTrackName, group] of quaternionGroups) {
    const contributions = [...group.contributions].sort((a, b) =>
      sourceDepth(a.sourceName) - sourceDepth(b.sourceName) || a.order - b.order,
    )
    if (!contributions.length) continue
    const outputTimes = contributions.length === 1
      ? Array.from(contributions[0]!.track.times)
      : [...new Set(contributions.flatMap(item => Array.from(item.track.times)))].sort((a, b) => a - b)
    if (!outputTimes.length) {
      for (const contribution of contributions) skipTrack(contribution.track, invalidTracks)
      continue
    }

    const targetBone = group.targetBone
    const targetRestQuaternion = targetBone.quaternion.clone().normalize()
    const targetParentWorld = new THREE.Quaternion()
    if (targetBone.parent) targetBone.parent.getWorldQuaternion(targetParentWorld)
    const inverseTargetParentWorld = targetParentWorld.clone().invert()
    const targetBoneRestWorld = new THREE.Quaternion()
    targetBone.getWorldQuaternion(targetBoneRestWorld)
    targetBoneRestWorld.normalize()
    const inverseTargetBoneRestWorld = targetBoneRestWorld.clone().invert()
    const resultValues: number[] = []
    const interpolants = contributions.map(contribution => ({
      contribution,
      interpolant: (contribution.track as THREE.KeyframeTrack & {
        createInterpolant: () => { evaluate: (time: number) => ArrayLike<number> }
      }).createInterpolant(),
      inverseSourceRest: contribution.sourceRestQuaternion.clone().invert(),
      inverseSourceParentWorld: contribution.sourceParentWorld?.clone().invert() ?? null,
      inverseSourceBoneRestWorld: contribution.sourceBoneRestWorld?.clone().invert() ?? null,
    }))

    for (const time of outputTimes) {
      const combinedDelta = new THREE.Quaternion()
      for (const item of interpolants) {
        const sourceValue = item.interpolant.evaluate(time) as ArrayLike<number>
        if (sourceValue.length < 4) continue
        const sourceQuaternion = new THREE.Quaternion(
          sourceValue[0]!, sourceValue[1]!, sourceValue[2]!, sourceValue[3]!,
        ).normalize()
        if (sourceQuaternion.lengthSq() < 1e-8) sourceQuaternion.identity()
        const delta = item.inverseSourceRest.clone().multiply(sourceQuaternion).normalize()
        let targetDelta = delta
        if (item.contribution.sourceBoneRestWorld && item.inverseSourceBoneRestWorld) {
          // A delta local da origem representa uma rotação em torno dos eixos
          // do próprio osso em repouso. Converter usando só o pai ignora a
          // orientação do fêmur/tíbia/pé no bind pose e pode torcer as pernas.
          // Convertemos a delta para mundo através da base do osso de origem
          // e então para os eixos locais do osso de destino.
          const worldDelta = item.contribution.sourceBoneRestWorld.clone()
            .multiply(delta)
            .multiply(item.inverseSourceBoneRestWorld)
            .normalize()
          targetDelta = inverseTargetBoneRestWorld.clone()
            .multiply(worldDelta)
            .multiply(targetBoneRestWorld)
            .normalize()
        } else if (item.contribution.sourceParentWorld && item.inverseSourceParentWorld) {
          // Fallback para animações antigas salvas antes do metadado de base óssea.
          const worldDelta = item.contribution.sourceParentWorld.clone()
            .multiply(delta)
            .multiply(item.inverseSourceParentWorld)
            .normalize()
          targetDelta = inverseTargetParentWorld.clone()
            .multiply(worldDelta)
            .multiply(targetParentWorld)
            .normalize()
        }
        combinedDelta.multiply(targetDelta).normalize()
      }
      const targetQuaternion = targetRestQuaternion.clone().multiply(combinedDelta).normalize()
      resultValues.push(targetQuaternion.x, targetQuaternion.y, targetQuaternion.z, targetQuaternion.w)
    }

    const interpolation = contributions.length === 1
      ? contributions[0]!.track.getInterpolation()
      : THREE.InterpolateLinear
    tracks.push(new THREE.QuaternionKeyframeTrack(targetTrackName, outputTimes, resultValues, interpolation))
    mappedSourceTracks += contributions.length
    mergedTracks += Math.max(0, contributions.length - 1)
  }

  if (!tracks.length) {
    throw new Error('Nenhuma trilha pôde ser transferida. Confira se o rig de destino possui ossos compatíveis e se eles estão mapeados.')
  }
  const retargeted = new THREE.AnimationClip(name.trim() || sourceClip.name || asset.name, sourceClip.duration, tracks)
  return {
    clip: retargeted,
    mappedTracks: mappedSourceTracks,
    outputTracks: tracks.length,
    mergedTracks,
    skippedTracks,
    unmappedTracks,
    unsupportedTracks,
    conflictingTracks,
    invalidTracks,
    collapsedTracks,
    unsafeScaleTracks,
    unsafePositionTracks,
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
  // Permite que a coluna inferior concorra à pelve durante a etapa de
  // recolhimento de juntas. Sem essa exceção, o ranqueador descartava o par
  // por diferença de papel anatômico antes de canCollapse conseguir avaliá-lo.
  const lowerSpinePelvisPair = source.role === 'spine' && target.role === 'pelvis' &&
    (source.level === null || source.level <= 1 ||
      /lumbar|lower.?spine|spine.?low/i.test(source.original))
  const pelvisLowerSpinePair = source.role === 'pelvis' && target.role === 'spine' &&
    (target.level === null || target.level <= 1 ||
      /lumbar|lower.?spine|spine.?low/i.test(target.original))
  const torsoPelvisPair = lowerSpinePelvisPair || pelvisLowerSpinePair
  if (
    source.role && target.role && source.role !== target.role &&
    !crossAnatomyLimb && !rootPelvisPair && !torsoPelvisPair
  ) {
    // Não confunde cabeça/coluna/cauda entre si, mas permite transferir movimento
    // entre segmentos de membros em esqueletos de anatomias diferentes.
    return Number.NEGATIVE_INFINITY
  }

  let score = 0
  if (source.normalized === target.normalized || source.compact === target.compact) score += 120
  if (source.role && source.role === target.role) score += 72
  else if (crossAnatomyLimb) score += 26
  else if (rootPelvisPair) score += 20
  else if (torsoPelvisPair) score += 24
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
 * Hungarian assignment for rectangular cost matrices with rows <= columns.
 * Dummy columns represent intentionally unmatched source joints.
 */
function minimumCostAssignment(costs: number[][]): number[] {
  const rowCount = costs.length
  const columnCount = costs[0]?.length ?? 0
  if (rowCount === 0 || columnCount < rowCount || costs.some(row => row.length !== columnCount)) return []

  const u = new Array<number>(rowCount + 1).fill(0)
  const v = new Array<number>(columnCount + 1).fill(0)
  const p = new Array<number>(columnCount + 1).fill(0)
  const way = new Array<number>(columnCount + 1).fill(0)

  for (let i = 1; i <= rowCount; i += 1) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(columnCount + 1).fill(Number.POSITIVE_INFINITY)
    const used = new Array<boolean>(columnCount + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]!
      let delta = Number.POSITIVE_INFINITY
      let j1 = 0
      for (let j = 1; j <= columnCount; j += 1) {
        if (used[j]) continue
        const currentCost = costs[i0 - 1]![j - 1]!
        const cur = currentCost - u[i0]! - v[j]!
        if (cur < minv[j]!) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j]! < delta) {
          delta = minv[j]!
          j1 = j
        }
      }
      for (let j = 0; j <= columnCount; j += 1) {
        if (used[j]) {
          const assignedRow = p[j]!
          u[assignedRow] = u[assignedRow]! + delta
          v[j] = v[j]! - delta
        } else {
          minv[j] = minv[j]! - delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)

    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0 !== 0)
  }

  const assignment = new Array<number>(rowCount).fill(-1)
  for (let j = 1; j <= columnCount; j += 1) {
    const row = p[j]!
    if (row > 0) assignment[row - 1] = j - 1
  }
  return assignment
}

/**
 * Gera mapeamentos globais um-para-um. Usa semântica anatômica, hierarquia e,
 * como refinamento, posição relativa, profundidade e tamanho dos segmentos.
 * A atribuição global evita que uma associação local consuma o melhor destino
 * de outro osso. Associações ambíguas continuam sem preenchimento automático.
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

  const targetCount = targetBones.length
  const sourceCount = viable.length
  const forbiddenCost = 1_000_000
  const candidateScores = new Map<string, Map<string, number>>()
  for (const entry of viable) {
    candidateScores.set(entry.sourceName, new Map<string, number>(entry.candidates.map(candidate => [
      candidate.targetName,
      candidate.score,
    ] as const)))
  }

  // One dummy column per source makes an unmatched joint a valid outcome.
  const costs = viable.map(entry => {
    const scores = candidateScores.get(entry.sourceName)!
    return [
      ...targetBones.map(bone => {
        const score = scores.get(bone.name)
        return score === undefined ? forbiddenCost : -score
      }),
      ...new Array<number>(sourceCount).fill(0),
    ]
  })
  const assignment = minimumCostAssignment(costs)
  const result: Record<string, string> = {}
  const claimedTargets = new Set<string>()
  viable.forEach((entry, row) => {
    const column = assignment[row] ?? -1
    if (column < 0 || column >= targetCount) return
    const targetName = targetBones[column]?.name
    if (!targetName || claimedTargets.has(targetName)) return
    if (!candidateScores.get(entry.sourceName)?.has(targetName)) return
    result[entry.sourceName] = targetName
    claimedTargets.add(targetName)
  })
  return result
}


export type AutonomousBoneMappingResult = {
  mapping: Record<string, string>
  collapsedSourceNames: string[]
  directMappedCount: number
}

/**
 * Starts with conservative semantic mappings, then fills safe gaps using mapped
 * parent branches as an anchor. If the target has fewer joints, a restrained
 * pass can fold helper/twist or adjacent limb rotations into compatible targets.
 */
export function suggestAutonomousBoneMappingsDetailed(
  sourceNames: string[],
  targetBones: THREE.Bone[],
  sourceRoot?: THREE.Object3D | null,
  targetRoot?: THREE.Object3D | null,
): AutonomousBoneMappingResult {
  const result = suggestTargetBoneMappings(sourceNames, targetBones, sourceRoot, targetRoot)
  if (!sourceRoot || !targetRoot || !sourceNames.length || !targetBones.length) {
    return { mapping: result, collapsedSourceNames: [], directMappedCount: Object.keys(result).length }
  }

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

  const directMappedCount = Object.keys(result).length
  const collapsedSourceNames: string[] = []
  const boneDepth = (node: THREE.Object3D | undefined): number => {
    let depth = 0
    let current = node?.parent ?? null
    while (current && current !== sourceRoot) {
      if (current instanceof THREE.Bone) depth += 1
      current = current.parent
    }
    return depth
  }
  const isAncestorOrDescendant = (a: THREE.Object3D, b: THREE.Object3D): boolean => {
    let current: THREE.Object3D | null = a
    while (current) {
      if (current === b) return true
      current = current.parent
    }
    current = b
    while (current) {
      if (current === a) return true
      current = current.parent
    }
    return false
  }
  const helperPattern = /twist|roll|helper|deform|deformer|end|nub|aux|socket|virtual|bend|correction|offset/i
  const canCollapse = (sourceName: string, targetBone: THREE.Bone): boolean => {
    const source = signatureForBoneName(sourceName)
    const target = signatureForBoneName(targetBone.name)
    if (source.side && target.side && source.side !== target.side) return false
    if (source.zone && target.zone && source.zone !== target.zone) return false
    if (source.digit && target.digit && source.digit !== target.digit) return false
    if (source.role && target.role && source.role === target.role) {
      if (source.role === 'spine') return source.level === null || target.level === null || source.level !== target.level
      return helperPattern.test(sourceName)
    }
    if (source.role === 'lower_arm' && ['upper_arm', 'shoulder'].includes(target.role)) return true
    if (source.role === 'upper_arm' && target.role === 'shoulder') return true
    if (source.role === 'hand' && target.role === 'lower_arm') return true
    if (source.role === 'lower_leg' && ['thigh', 'leg'].includes(target.role)) return true
    if (source.role === 'foot' && target.role === 'lower_leg') return true
    if (source.role === 'toe' && target.role === 'foot') return true
    if (source.role === 'root' && target.role === 'pelvis') return true
    if (source.role === 'pelvis' && target.role === 'root') return true

    // Rigs mais simples podem não ter uma junta própria para a coluna lombar.
    // Nesses casos, a rotação da parte inferior da coluna deve ser combinada
    // com a pelve, em vez de ser descartada. A verificação de ancestralidade
    // abaixo ainda exige que a junta pertença ao mesmo ramo anatômico.
    if (
      source.role === 'spine' &&
      target.role === 'pelvis' &&
      (source.level === null || source.level <= 1 || /lumbar|lower.?spine|spine.?low/i.test(sourceName))
    ) return true

    // Se o rig não possuir pelve dedicada, preserva o movimento de quadril
    // na primeira junta de coluna disponível, sem o associar à coluna superior.
    if (
      source.role === 'pelvis' &&
      target.role === 'spine' &&
      (target.level === null || target.level <= 1)
    ) return true

    return false
  }

  // Detecta juntas auxiliares sem nomes anatômicos que estão no segmento
  // entre a pelve e a coluna. Muitos GLBs usam Bone.003/Jnt_07 para essas
  // juntas, então uma regra baseada apenas no nome perde o movimento lombar.
  const nearestSemanticAncestorRole = (node: THREE.Object3D): string => {
    let current = node.parent
    while (current && current !== sourceRoot) {
      const role = signatureForBoneName(current.name).role
      if (role) return role
      current = current.parent
    }
    return ''
  }
  const nearestSemanticDescendantRole = (node: THREE.Object3D): string => {
    const queue = node.children.map(child => ({ node: child, depth: 1 }))
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]!
      const role = signatureForBoneName(item.node.name).role
      if (role) return role
      for (const child of item.node.children) queue.push({ node: child, depth: item.depth + 1 })
      // Não percorre malhas nem grandes subárvores que não contêm ossos.
      if (item.depth > 64) break
    }
    return ''
  }
  const isLowerTorsoSource = (sourceName: string): boolean => {
    const signature = sourceSignatureByName.get(sourceName) ?? signatureForBoneName(sourceName)
    if (signature.role === 'spine') {
      return signature.level === null || signature.level <= 1 ||
        /lumbar|lower.?spine|spine.?low/i.test(sourceName)
    }
    if (signature.role === 'pelvis') return true
    if (signature.role) return false
    const node = sourceNodeByName.get(sourceName)
    if (!node) return false
    const ancestorRole = nearestSemanticAncestorRole(node)
    const descendantRole = nearestSemanticDescendantRole(node)
    return (ancestorRole === 'pelvis' && descendantRole === 'spine') ||
      (ancestorRole === 'spine' && descendantRole === 'pelvis')
  }

  const canCollapseAlongTorsoChain = (sourceName: string, mappedSourceName: string): boolean => {
    const sourceSignature = sourceSignatureByName.get(sourceName) ?? signatureForBoneName(sourceName)
    const mappedSignature = sourceSignatureByName.get(mappedSourceName) ?? signatureForBoneName(mappedSourceName)
    if (!isLowerTorsoSource(sourceName)) return false
    if (!['pelvis', 'spine'].includes(mappedSignature.role)) return false
    if (sourceSignature.side && mappedSignature.side && sourceSignature.side !== mappedSignature.side) return false
    if (sourceSignature.zone && mappedSignature.zone && sourceSignature.zone !== mappedSignature.zone) return false
    return true
  }

  const collapsedPending = sourceNames
    .filter(name => !result[name] && sourceNodeByName.has(name))
    .sort((a, b) => boneDepth(sourceNodeByName.get(a)) - boneDepth(sourceNodeByName.get(b)))
  for (const sourceName of collapsedPending) {
    const sourceNode = sourceNodeByName.get(sourceName)!
    const candidates = (ranking[sourceName] ?? [])
      .map(candidate => {
        const targetBone = targetByName.get(candidate.targetName)
        if (!targetBone) return null
        const linkedSources = Object.entries(result)
          .filter(([, mappedTargetName]) => mappedTargetName === candidate.targetName)
          .filter(([mappedSourceName]) => {
            const mappedSourceNode = sourceNodeByName.get(mappedSourceName)
            if (!mappedSourceNode || !isAncestorOrDescendant(sourceNode, mappedSourceNode)) return false
            return canCollapse(sourceName, targetBone) ||
              canCollapseAlongTorsoChain(sourceName, mappedSourceName)
          })
        if (!linkedSources.length) return null
        const sourceSignature = sourceSignatureByName.get(sourceName)!
        const targetSignature = signatureForBoneName(targetBone.name)
        const semanticBonus = sourceSignature.role && sourceSignature.role === targetSignature.role ? 14 : 0
        const torsoBonus = linkedSources.some(([mappedSourceName]) =>
          canCollapseAlongTorsoChain(sourceName, mappedSourceName),
        ) ? 18 : 0
        const closestMappedDepth = Math.min(...linkedSources.map(([mappedSourceName]) => {
          const mappedNode = sourceNodeByName.get(mappedSourceName)
          return mappedNode ? Math.abs(boneDepth(mappedNode) - boneDepth(sourceNode)) : Number.POSITIVE_INFINITY
        }))
        return {
          targetName: candidate.targetName,
          score: candidate.score + semanticBonus + torsoBonus - closestMappedDepth * 2,
        }
      })
      .filter((candidate): candidate is { targetName: string; score: number } => candidate !== null)
      .sort((a, b) => b.score - a.score || a.targetName.localeCompare(b.targetName))
      .sort((a, b) => b.score - a.score || a.targetName.localeCompare(b.targetName))
    const best = candidates[0]
    if (!best) continue
    result[sourceName] = best.targetName
    collapsedSourceNames.push(sourceName)
  }
  return { mapping: result, collapsedSourceNames, directMappedCount }
}

export function suggestAutonomousBoneMappings(
  sourceNames: string[],
  targetBones: THREE.Bone[],
  sourceRoot?: THREE.Object3D | null,
  targetRoot?: THREE.Object3D | null,
): Record<string, string> {
  return suggestAutonomousBoneMappingsDetailed(sourceNames, targetBones, sourceRoot, targetRoot).mapping
}

/** Compatibilidade para chamadas individuais: agora usa a mesma lógica semântica. */
export function suggestTargetBone(sourceName: string, targetBones: THREE.Bone[]): string {
  return suggestTargetBoneMappings([sourceName], targetBones)[sourceName] ?? ''
}
