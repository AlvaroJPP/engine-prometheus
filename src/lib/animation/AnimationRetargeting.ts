import * as THREE from 'three'
import type { AnimationRole } from '@engine'
import { findAnimationNode } from './BoneMapping'

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
  /** Objetos não ósseos da origem que contêm o rig e carregam movimento global (ex.: Armature.position). */
  sourceMotionNodeNames?: string[]
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
  /** Trilhas de deslocamento global aplicadas ao objeto raiz do modelo de destino. */
  rootMotionTracks: number
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
  const sourceMotionNodeNames = [...new Set(clip.tracks
    .map(getTransformTrackPath)
    .filter((path): path is TransformTrackPath => path !== null && path.property === 'position')
    .filter(path => {
      const node = findAnimationNode(root, path.nodeName)
      if (!node || node instanceof THREE.Bone) return false
      let containsBone = false
      node.traverse(child => { if (child instanceof THREE.Bone) containsBone = true })
      return containsBone
    })
    .map(path => path.nodeName))]
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
    sourceMotionNodeNames,
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
  targetRoot?: THREE.Object3D,
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
  const rootMotionContributions: Array<{
    track: THREE.KeyframeTrack
    sourceName: string
    sourceRestPosition: THREE.Vector3
    sourceParentWorld: THREE.Quaternion | null
    order: number
  }> = []
  let mappedSourceTracks = 0
  let rootMotionTracks = 0
  let mergedTracks = 0

  for (let trackIndex = 0; trackIndex < sourceClip.tracks.length; trackIndex += 1) {
    const track = sourceClip.tracks[trackIndex]!
    const path = getTransformTrackPath(track)
    if (!path) {
      skipTrack(track, unsupportedTracks)
      continue
    }
    const sourceLeafName = path.nodeName.split(/[./|:]/).filter(Boolean).pop() ?? path.nodeName
    const legacyMotionContainer = !asset.sourceBoneNames?.includes(path.nodeName) &&
      /^(scene|armature|skeleton|rig|root|rootnode|modelroot|characterroot)$/i.test(sourceLeafName)
    const isSourceMotionContainer = asset.sourceMotionNodeNames?.includes(path.nodeName) || legacyMotionContainer
    const sourceRole = signatureForBoneName(path.nodeName).role
    // Um container animado não deve ser associado acidentalmente a um osso pelo
    // mapeamento automático; sua translação move o personagem inteiro.
    const targetName = isSourceMotionContainer ? undefined : boneMap[path.nodeName]
    const targetBone = targetName ? targetByName.get(targetName) : undefined
    const sourceRest = asset.sourcePose[path.nodeName]
    if (!sourceRest) {
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

    const targetRole = targetBone ? signatureForBoneName(targetBone.name).role : ''
    const isRootMotionBone = path.property === 'position' &&
      (['root', 'pelvis'].includes(sourceRole) ||
        (!sourceRole && ['root', 'pelvis'].includes(targetRole)))
    // Em muitos clips (incluindo animações Mixamo) o deslocamento do salto ou
    // da locomoção só está em Hips.position/Root.position, não no objeto Armature.
    // Raiz/contêineres podem carregar deslocamentos pequenos; para a pelve, exigimos
    // uma excursão maior para não transformar o balanço normal da caminhada em
    // movimento global e apagar sua animação local.
    if (targetRoot && path.property === 'position' && stride === 3 &&
        (isSourceMotionContainer || isRootMotionBone)) {
      const parentRest = asset.sourceParentWorldQuaternion?.[path.nodeName]
      const sourceParentWorld = parentRest && parentRest.length === 4
        ? new THREE.Quaternion(...parentRest).normalize()
        : null
      const targetParentWorld = new THREE.Quaternion()
      if (targetRoot.parent) targetRoot.parent.getWorldQuaternion(targetParentWorld)
      const inverseTargetParentWorld = targetParentWorld.clone().invert()
      const sourceRestPosition = safeRestVector(sourceRest.position, new THREE.Vector3())
      const peaks = [0, 0, 0]
      for (let frame = 0; frame < times.length; frame += 1) {
        const offset = frame * 3
        const delta = new THREE.Vector3(
          sourceValues[offset]! - sourceRestPosition.x,
          sourceValues[offset + 1]! - sourceRestPosition.y,
          sourceValues[offset + 2]! - sourceRestPosition.z,
        )
        if (sourceParentWorld) delta.applyQuaternion(sourceParentWorld)
        delta.applyQuaternion(inverseTargetParentWorld).multiplyScalar(scaleRatio)
        peaks[0] = Math.max(peaks[0]!, Math.abs(delta.x))
        peaks[1] = Math.max(peaks[1]!, Math.abs(delta.y))
        peaks[2] = Math.max(peaks[2]!, Math.abs(delta.z))
      }
      const rootLikeChannel = isSourceMotionContainer || sourceRole === 'root'
      const horizontalThreshold = Math.max(0.01, targetSourceHeight * (rootLikeChannel ? 0.001 : 0.035))
      const verticalThreshold = Math.max(0.01, targetSourceHeight * (rootLikeChannel ? 0.001 : 0.08))
      const hasEnvironmentalMotion = peaks[0]! > horizontalThreshold ||
        peaks[2]! > horizontalThreshold || peaks[1]! > verticalThreshold
      if (hasEnvironmentalMotion) {
        rootMotionContributions.push({
          track,
          sourceName: path.nodeName,
          sourceRestPosition,
          sourceParentWorld,
          order: trackIndex,
        })
        mappedSourceTracks += 1
        continue
      }
    }

    if (!targetBone) {
      skipTrack(track, unmappedTracks)
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
        // Alguns rigs nomeiam o osso que carrega o movimento como RootNode,
        // Motion ou Bone.001. Se ele foi mapeado para a raiz/pelve, o mapeamento
        // explícito deve permitir transferir sua translação mesmo sem nome padrão.
        const sourceCanCarryRootMotion = ['root', 'pelvis', ''].includes(sourceRole)
        const isRootTrack = sourceCanCarryRootMotion && ['root', 'pelvis'].includes(targetRole)
        const isPelvisTrack = sourceCanCarryRootMotion && ['pelvis', 'root'].includes(targetRole)
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
        const sourceParentRest = asset.sourceParentWorldQuaternion?.[path.nodeName]
        const sourceParentWorld = sourceParentRest && sourceParentRest.length === 4
          ? new THREE.Quaternion(...sourceParentRest).normalize()
          : null
        const targetParentWorld = new THREE.Quaternion()
        if (targetBone.parent) targetBone.parent.getWorldQuaternion(targetParentWorld)
        const inverseTargetParentWorld = targetParentWorld.clone().invert()
        const convertPositionDelta = (x: number, y: number, z: number) => {
          const delta = new THREE.Vector3(x, y, z)
          // Posição é relativa ao pai: convertemos os eixos da origem para mundo,
          // depois para os eixos do pai de destino antes de aplicar a escala.
          if (sourceParentWorld) delta.applyQuaternion(sourceParentWorld)
          delta.applyQuaternion(inverseTargetParentWorld)
          return delta.multiplyScalar(scaleRatio)
        }
        // A pelve normalmente carrega o deslocamento do corpo em animações como
        // salto, aterrissagem, esquiva e passos laterais. O limite anterior de
        // 15% da altura descartava justamente esses movimentos. Mantemos um
        // limite amplo, relativo à escala do personagem, e validamos todos os
        // frames abaixo para não propagar offsets absurdos de rigs incompatíveis.
        const maxOffset = Math.max(0.05, targetSourceHeight * (isRootTrack ? 2 : 1.25))
        let unsafePosition = false
        for (let frame = 0; frame < times.length; frame += 1) {
          const offset = frame * 3
          const delta = convertPositionDelta(
            sourceValues[offset]! - sourceRestVector.x,
            sourceValues[offset + 1]! - sourceRestVector.y,
            sourceValues[offset + 2]! - sourceRestVector.z,
          )
          if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || !Number.isFinite(delta.z) ||
              delta.length() > maxOffset) {
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
          const delta = convertPositionDelta(
            sourceValues[offset]! - sourceRestVector.x,
            sourceValues[offset + 1]! - sourceRestVector.y,
            sourceValues[offset + 2]! - sourceRestVector.z,
          )
          values.push(
            targetRestVector.x + delta.x,
            targetRestVector.y + delta.y,
            targetRestVector.z + delta.z,
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

  if (targetRoot && rootMotionContributions.length) {
    const outputTimes = [...new Set(rootMotionContributions.flatMap(item => Array.from(item.track.times)))].sort((a, b) => a - b)
    if (outputTimes.length) {
      const rootBasePosition = targetRoot.position.clone()
      const targetParentWorld = new THREE.Quaternion()
      if (targetRoot.parent) targetRoot.parent.getWorldQuaternion(targetParentWorld)
      const inverseTargetParentWorld = targetParentWorld.clone().invert()
      const interpolants = rootMotionContributions.map(contribution => ({
        contribution,
        interpolant: (contribution.track as THREE.KeyframeTrack & {
          createInterpolant: () => { evaluate: (time: number) => ArrayLike<number> }
        }).createInterpolant(),
      }))
      const deltaAt = (item: typeof interpolants[number], time: number): THREE.Vector3 | null => {
        const sourceValue = item.interpolant.evaluate(time) as ArrayLike<number>
        if (sourceValue.length < 3 || !Number.isFinite(sourceValue[0]) ||
            !Number.isFinite(sourceValue[1]) || !Number.isFinite(sourceValue[2])) return null
        const delta = new THREE.Vector3(
          sourceValue[0]! - item.contribution.sourceRestPosition.x,
          sourceValue[1]! - item.contribution.sourceRestPosition.y,
          sourceValue[2]! - item.contribution.sourceRestPosition.z,
        )
        if (item.contribution.sourceParentWorld) delta.applyQuaternion(item.contribution.sourceParentWorld)
        delta.applyQuaternion(inverseTargetParentWorld).multiplyScalar(scaleRatio)
        return [delta.x, delta.y, delta.z].every(Number.isFinite) ? delta : null
      }

      // Root motion pode estar distribuído: a raiz leva o personagem adiante,
      // enquanto Hips carrega a elevação do salto. Escolhemos por eixo a trilha
      // com maior movimento para não somar duas vezes o mesmo deslocamento quando
      // o rig anima simultaneamente Armature, Root e Hips.
      const invalidItems = new Set<number>()
      const perCandidatePeaks = interpolants.map((item, index) => {
        const peaks = [0, 0, 0]
        for (const time of item.contribution.track.times) {
          const delta = deltaAt(item, time)
          if (!delta) {
            invalidItems.add(index)
            break
          }
          peaks[0] = Math.max(peaks[0]!, Math.abs(delta.x))
          peaks[1] = Math.max(peaks[1]!, Math.abs(delta.y))
          peaks[2] = Math.max(peaks[2]!, Math.abs(delta.z))
        }
        return peaks
      })
      const selectedByAxis = [0, 1, 2].map(axis => {
        let bestIndex = -1
        let bestPeak = Math.max(1e-5, targetSourceHeight * 1e-4)
        for (let index = 0; index < perCandidatePeaks.length; index += 1) {
          if (invalidItems.has(index)) continue
          const peak = perCandidatePeaks[index]![axis]!
          if (peak > bestPeak) {
            bestPeak = peak
            bestIndex = index
          }
        }
        return bestIndex
      })

      const values: number[] = []
      let invalidRootMotion = selectedByAxis.every(index => index < 0)
      const maxRootOffset = Math.max(1, targetSourceHeight * 100)
      for (const time of outputTimes) {
        const offset = new THREE.Vector3()
        for (let axis = 0; axis < 3; axis += 1) {
          const candidateIndex = selectedByAxis[axis]!
          if (candidateIndex < 0) continue
          const delta = deltaAt(interpolants[candidateIndex]!, time)
          if (!delta) {
            invalidRootMotion = true
            break
          }
          offset.setComponent(axis, delta.getComponent(axis))
        }
        if (invalidRootMotion || offset.length() > maxRootOffset) {
          invalidRootMotion = true
          break
        }
        values.push(
          rootBasePosition.x + offset.x,
          rootBasePosition.y + offset.y,
          rootBasePosition.z + offset.z,
        )
      }
      if (!invalidRootMotion && values.length === outputTimes.length * 3) {
        const rootNodeName = targetRoot.name || 'root'
        const interpolation = interpolants.length === 1
          ? interpolants[0]!.contribution.track.getInterpolation()
          : THREE.InterpolateLinear
        tracks.push(new THREE.VectorKeyframeTrack(rootNodeName + '.position', outputTimes, values, interpolation))
        rootMotionTracks = 1
      } else {
        for (const item of rootMotionContributions) skipTrack(item.track, invalidTracks)
      }
    } else {
      for (const item of rootMotionContributions) skipTrack(item.track, invalidTracks)
    }
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
    rootMotionTracks,
  }
}

export {
  findAnimationNode,
  rankTargetBoneCandidates,
  suggestTargetBoneMappings,
  suggestAutonomousBoneMappingsDetailed,
  suggestAutonomousBoneMappings,
  suggestTargetBone,
} from './BoneMapping'
export type {
  BoneSimilarityCandidate,
  AutonomousBoneMappingResult,
} from './BoneMapping'
