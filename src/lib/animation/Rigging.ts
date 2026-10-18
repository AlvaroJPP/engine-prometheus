import * as THREE from 'three'

export type AutoRigPreset = 'auto' | 'humanoid' | 'quadruped' | 'chain' | 'modular'
export type ConcreteAutoRigPreset = Exclude<AutoRigPreset, 'auto'>

export interface AutoRigAnalysis {
  recommendedPreset: ConcreteAutoRigPreset
  dimensions: { width: number; height: number; depth: number }
  meshCount: number
  namedPartCount: number
  nestedPartCount: number
  hasExistingRig: boolean
  reason: string
}

export interface AutoRigResult {
  bones: THREE.Bone[]
  preset: AutoRigPreset
  created: boolean
  convertedMeshes: number
  message: string
}

interface JointSpec {
  name: string
  position: THREE.Vector3
  parent?: string
  mesh?: THREE.Mesh
}

interface ModularRigPlan {
  specs: JointSpec[]
  meshToJointName: Map<THREE.Mesh, string>
}

interface RigSegment {
  boneIndex: number
  start: THREE.Vector3
  end: THREE.Vector3
}

function distanceToSegmentSquared(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
  const segment = end.clone().sub(start)
  const denominator = segment.lengthSq()
  if (denominator < 1e-10) return point.distanceToSquared(start)
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / denominator, 0, 1)
  return point.distanceToSquared(start.addScaledVector(segment, t))
}

const SEMANTIC_PART_PATTERN = /head|neck|torso|chest|spine|hips?|pelvis|shoulder|upper.?arm|forearm|elbow|hand|thigh|knee|shin|calf|foot|hoof|tail|wing|claw|jaw|wheel|tire|door|hood|roof|chassis|hull|fuselage|rudder|propeller|engine|gear|blade|track|arm|leg|body|frame|base|joint|segment|limb|antenna|cannon|turret/i
const HUMANOID_NAME_PATTERN = /human|humanoid|character|person|player|soldier|npc|mixamo|mannequin/i
const QUADRUPED_NAME_PATTERN = /horse|dog|cat|wolf|cow|bull|pig|deer|bear|dragon|animal|quadruped|lizard|dinosaur|goat|sheep|lion|tiger|fox|camel|elephant|boar|mount/i
const MODULAR_NAME_PATTERN = /car|vehicle|truck|bus|motorcycle|bike|robot|mech|machine|aircraft|plane|spaceship|ship|tank|weapon|furniture|prop|mechanical/i

function collectStaticMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse(node => {
    if (node instanceof THREE.Mesh && !(node instanceof THREE.SkinnedMesh) && node.visible &&
        node.geometry.getAttribute('position')?.count) meshes.push(node)
  })
  return meshes
}

function meshDepth(mesh: THREE.Object3D, root: THREE.Object3D): number {
  let depth = 0
  let node = mesh.parent
  while (node && node !== root) {
    depth += 1
    node = node.parent
  }
  return depth
}

/** Heurística explícita para recomendar um gerador sem impor a mesma anatomia a todo GLB. */
export function analyzeRiggingInput(root: THREE.Object3D): AutoRigAnalysis {
  root.updateWorldMatrix(true, true)
  const meshes = collectStaticMeshes(root)
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.isEmpty() ? new THREE.Vector3() : bounds.getSize(new THREE.Vector3())
  const width = Math.max(0, size.x)
  const height = Math.max(0, size.y)
  const depth = Math.max(0, size.z)
  const allNames = [root.name, ...meshes.map(mesh => mesh.name)].join(' ')
  const namedPartCount = meshes.filter(mesh => SEMANTIC_PART_PATTERN.test(mesh.name)).length
  const nestedPartCount = meshes.filter(mesh => {
    let parent = mesh.parent
    while (parent && parent !== root) {
      if (parent instanceof THREE.Mesh && !(parent instanceof THREE.SkinnedMesh)) return true
      parent = parent.parent
    }
    return false
  }).length
  let hasExistingRig = false
  root.traverse(node => { if (node instanceof THREE.SkinnedMesh) hasExistingRig = true })

  let recommendedPreset: ConcreteAutoRigPreset
  let reason: string
  if (hasExistingRig) {
    recommendedPreset = 'humanoid'
    reason = 'O arquivo já contém uma malha esquelética; o gerador deve preservar os ossos e pesos existentes.'
  } else if (QUADRUPED_NAME_PATTERN.test(allNames)) {
    recommendedPreset = 'quadruped'
    reason = 'Nomes do modelo sugerem um animal/quadrúpede; confira a orientação da cabeça e dos membros antes de rigar.'
  } else if (HUMANOID_NAME_PATTERN.test(allNames) ||
    (height > 1e-5 && height >= width * 1.22 && height >= depth * 1.18)) {
    recommendedPreset = 'humanoid'
    reason = 'O nome ou as proporções verticais sugerem um personagem humanoide.'
  } else if (
    (MODULAR_NAME_PATTERN.test(allNames) && meshes.length >= 2) ||
    (meshes.length >= 5 && (namedPartCount >= 2 || nestedPartCount >= 2)) ||
    (meshes.length >= 9 && height < Math.max(width, depth) * 1.4)
  ) {
    recommendedPreset = 'modular'
    reason = 'O modelo parece composto por peças separadas; cada malha receberá um pivô/osso próprio e pesos rígidos por peça.'
  } else if (Math.max(width, depth) > height * 1.28) {
    recommendedPreset = 'quadruped'
    reason = 'O modelo é mais largo/comprido do que alto; o rig quadrúpede é uma base e pode exigir reposicionamento das juntas.'
  } else {
    recommendedPreset = 'chain'
    reason = 'Não há sinal confiável de anatomia conhecida; uma corrente neutra evita inventar braços/pernas, mas deve ser ajustada ao objeto.'
  }

  return {
    recommendedPreset,
    dimensions: { width, height, depth },
    meshCount: meshes.length,
    namedPartCount,
    nestedPartCount,
    hasExistingRig,
    reason,
  }
}

function sanitizedPartName(name: string, index: number): string {
  const part = name.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42)
  return 'Part_' + (part || 'Mesh') + '_' + String(index + 1).padStart(3, '0')
}

function createModularRigSpecs(root: THREE.Object3D, meshes: THREE.Mesh[]): ModularRigPlan {
  if (!meshes.length) return { specs: [], meshToJointName: new Map() }
  root.updateWorldMatrix(true, true)
  const inverseRoot = root.matrixWorld.clone().invert()
  const records = meshes.map((mesh, index) => {
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox?.clone()
    const localCenter = box?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3()
    const center = mesh.localToWorld(localCenter).applyMatrix4(inverseRoot)
    const meshSize = box?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(0.01, 0.01, 0.01)
    const scale = mesh.getWorldScale(new THREE.Vector3())
    const volume = Math.max(1e-6, Math.abs(meshSize.x * scale.x * meshSize.y * scale.y * meshSize.z * scale.z))
    const name = mesh.name || ('Mesh_' + (index + 1))
    const nameWeight = /body|torso|chassis|hull|frame|main|base|root|core|fuselage/i.test(name) ? 3 : 1
    const semanticWeight = SEMANTIC_PART_PATTERN.test(name) ? 1.3 : 1
    return { mesh, index, center, volume, score: Math.log1p(volume) * nameWeight * semanticWeight, name, depth: meshDepth(mesh, root) }
  })

  // Parte principal: prioriza nomes de corpo/chassi/base e depois a peça de maior volume.
  const main = [...records].sort((a, b) => b.score - a.score || a.index - b.index)[0]!
  const ordered = [main, ...records.filter(record => record !== main).sort((a, b) => a.depth - b.depth || a.index - b.index)]
  const meshToJointName = new Map<THREE.Mesh, string>()
  const specs: JointSpec[] = []
  const assigned = new Set<typeof records[number]>()
  const targetName = (record: typeof records[number]) => sanitizedPartName(record.name, record.index)

  for (const record of ordered) {
    let parentRecord: typeof records[number] | undefined
    // Primeiro, respeita a hierarquia real do GLTF quando a malha possui uma malha ancestral.
    let ancestor = record.mesh.parent
    while (ancestor && ancestor !== root && !parentRecord) {
      if (ancestor instanceof THREE.Mesh && !(ancestor instanceof THREE.SkinnedMesh)) {
        parentRecord = records.find(item => item.mesh === ancestor && assigned.has(item))
      }
      ancestor = ancestor.parent
    }

    // Quando o arquivo achatou todas as peças no mesmo nível, tenta relações por nomes.
    if (!parentRecord && record !== main) {
      const name = record.name.toLowerCase()
      const parentHint: RegExp[] = []
      if (/head|jaw|ear|eye|horn/.test(name)) parentHint.push(/neck|head|body|torso|chest|main|root|core/)
      else if (/neck/.test(name)) parentHint.push(/chest|torso|body|spine|main|root/)
      else if (/hand|palm|finger|wrist|forearm|elbow/.test(name)) parentHint.push(/arm|shoulder|chest|torso|body|main|root/)
      else if (/foot|hoof|toe|ankle|knee|calf|shin/.test(name)) parentHint.push(/leg|thigh|hip|pelvis|body|chassis|main|root/)
      else if (/thigh|upper.?leg|shoulder|upper.?arm|front.?leg|hind.?leg/.test(name)) parentHint.push(/hips|pelvis|chest|torso|body|spine|chassis|main|root/)
      else if (/wheel|tire|door|hood|roof|window|bumper|mirror/.test(name)) parentHint.push(/chassis|body|frame|hull|main|root|base/)
      else if (/wing|rudder|fin|propeller|engine|landing.?gear/.test(name)) parentHint.push(/fuselage|body|hull|chassis|main|root/)
      for (const pattern of parentHint) {
        parentRecord = ordered.find(candidate => candidate !== record && assigned.has(candidate) && pattern.test(candidate.name))
        if (parentRecord) break
      }
    }

    // Fallback topológico: liga a peça ao pivô já criado geometricamente mais próximo.
    if (!parentRecord && record !== main) {
      let bestDistance = Number.POSITIVE_INFINITY
      for (const candidate of assigned) {
        const distance = record.center.distanceToSquared(candidate.center)
        if (distance < bestDistance) {
          bestDistance = distance
          parentRecord = candidate
        }
      }
    }

    const spec: JointSpec = {
      name: targetName(record),
      position: record.center.clone(),
      ...(parentRecord ? { parent: targetName(parentRecord) } : {}),
      mesh: record.mesh,
    }
    specs.push(spec)
    assigned.add(record)
    meshToJointName.set(record.mesh, spec.name)
  }

  return { specs, meshToJointName }
}

function createJointSpecs(bounds: THREE.Box3, preset: AutoRigPreset): JointSpec[] {
  const min = bounds.min
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const h = Math.max(size.y, 0.1)
  const w = Math.max(size.x, 0.1)
  const d = Math.max(size.z, 0.1)
  const y = (ratio: number) => min.y + h * ratio
  const x = (ratio: number) => center.x + w * ratio
  const z = (ratio: number) => center.z + d * ratio

  if (preset === 'quadruped') {
    return [
      { name: 'Root', position: new THREE.Vector3(center.x, y(0.44), center.z) },
      { name: 'Spine', parent: 'Root', position: new THREE.Vector3(center.x, y(0.62), z(-0.06)) },
      { name: 'Chest', parent: 'Spine', position: new THREE.Vector3(center.x, y(0.64), z(0.2)) },
      { name: 'Neck', parent: 'Chest', position: new THREE.Vector3(center.x, y(0.72), z(0.34)) },
      { name: 'Head', parent: 'Neck', position: new THREE.Vector3(center.x, y(0.78), z(0.47)) },
      { name: 'Tail', parent: 'Spine', position: new THREE.Vector3(center.x, y(0.6), z(-0.45)) },
      { name: 'FrontLeg.L', parent: 'Chest', position: new THREE.Vector3(x(-0.22), y(0.55), z(0.23)) },
      { name: 'FrontKnee.L', parent: 'FrontLeg.L', position: new THREE.Vector3(x(-0.22), y(0.28), z(0.25)) },
      { name: 'FrontHoof.L', parent: 'FrontKnee.L', position: new THREE.Vector3(x(-0.22), y(0.05), z(0.27)) },
      { name: 'FrontLeg.R', parent: 'Chest', position: new THREE.Vector3(x(0.22), y(0.55), z(0.23)) },
      { name: 'FrontKnee.R', parent: 'FrontLeg.R', position: new THREE.Vector3(x(0.22), y(0.28), z(0.25)) },
      { name: 'FrontHoof.R', parent: 'FrontKnee.R', position: new THREE.Vector3(x(0.22), y(0.05), z(0.27)) },
      { name: 'BackLeg.L', parent: 'Spine', position: new THREE.Vector3(x(-0.22), y(0.53), z(-0.28)) },
      { name: 'BackKnee.L', parent: 'BackLeg.L', position: new THREE.Vector3(x(-0.22), y(0.28), z(-0.31)) },
      { name: 'BackHoof.L', parent: 'BackKnee.L', position: new THREE.Vector3(x(-0.22), y(0.05), z(-0.32)) },
      { name: 'BackLeg.R', parent: 'Spine', position: new THREE.Vector3(x(0.22), y(0.53), z(-0.28)) },
      { name: 'BackKnee.R', parent: 'BackLeg.R', position: new THREE.Vector3(x(0.22), y(0.28), z(-0.31)) },
      { name: 'BackHoof.R', parent: 'BackKnee.R', position: new THREE.Vector3(x(0.22), y(0.05), z(-0.32)) },
    ]
  }

  if (preset === 'chain') {
    return [
      { name: 'Root', position: new THREE.Vector3(center.x, y(0.02), center.z) },
      { name: 'Joint.01', parent: 'Root', position: new THREE.Vector3(center.x, y(0.25), center.z) },
      { name: 'Joint.02', parent: 'Joint.01', position: new THREE.Vector3(center.x, y(0.5), center.z) },
      { name: 'Joint.03', parent: 'Joint.02', position: new THREE.Vector3(center.x, y(0.75), center.z) },
      { name: 'Joint.04', parent: 'Joint.03', position: new THREE.Vector3(center.x, y(0.98), center.z) },
    ]
  }

  return [
    { name: 'Root', position: new THREE.Vector3(center.x, min.y, center.z) },
    { name: 'Hips', parent: 'Root', position: new THREE.Vector3(center.x, y(0.51), center.z) },
    { name: 'Spine', parent: 'Hips', position: new THREE.Vector3(center.x, y(0.61), center.z) },
    { name: 'Chest', parent: 'Spine', position: new THREE.Vector3(center.x, y(0.72), center.z) },
    { name: 'Neck', parent: 'Chest', position: new THREE.Vector3(center.x, y(0.84), center.z) },
    { name: 'Head', parent: 'Neck', position: new THREE.Vector3(center.x, y(0.93), center.z) },
    { name: 'Shoulder.L', parent: 'Chest', position: new THREE.Vector3(x(-0.17), y(0.78), center.z) },
    { name: 'Elbow.L', parent: 'Shoulder.L', position: new THREE.Vector3(x(-0.34), y(0.65), center.z) },
    { name: 'Hand.L', parent: 'Elbow.L', position: new THREE.Vector3(x(-0.43), y(0.54), center.z) },
    { name: 'Shoulder.R', parent: 'Chest', position: new THREE.Vector3(x(0.17), y(0.78), center.z) },
    { name: 'Elbow.R', parent: 'Shoulder.R', position: new THREE.Vector3(x(0.34), y(0.65), center.z) },
    { name: 'Hand.R', parent: 'Elbow.R', position: new THREE.Vector3(x(0.43), y(0.54), center.z) },
    { name: 'Thigh.L', parent: 'Hips', position: new THREE.Vector3(x(-0.1), y(0.45), center.z) },
    { name: 'Knee.L', parent: 'Thigh.L', position: new THREE.Vector3(x(-0.12), y(0.25), z(0.015)) },
    { name: 'Foot.L', parent: 'Knee.L', position: new THREE.Vector3(x(-0.12), y(0.05), z(0.04)) },
    { name: 'Thigh.R', parent: 'Hips', position: new THREE.Vector3(x(0.1), y(0.45), center.z) },
    { name: 'Knee.R', parent: 'Thigh.R', position: new THREE.Vector3(x(0.12), y(0.25), z(0.015)) },
    { name: 'Foot.R', parent: 'Knee.R', position: new THREE.Vector3(x(0.12), y(0.05), z(0.04)) },
  ]
}

/**
 * Creates a first-pass skeleton for static geometry and assigns smooth-ish
 * vertex weights using the closest bone segments. Existing skinned rigs are
 * preserved. The auto-rig is a starting point; joint positions and weights
 * can need correction for unusual shapes.
 */
export function autoRigModel(root: THREE.Object3D, preset: AutoRigPreset): AutoRigResult {
  root.updateWorldMatrix(true, true)
  const existingBones: THREE.Bone[] = []
  let hasSkinnedMesh = false
  root.traverse((node) => {
    if (node instanceof THREE.Bone) existingBones.push(node)
    if (node instanceof THREE.SkinnedMesh) hasSkinnedMesh = true
  })

  if (existingBones.length > 0 && hasSkinnedMesh) {
    const isGeneratedRig = existingBones.every(bone => bone.userData.generatedRigBone === true)
    const savedPreset = existingBones
      .map(bone => bone.userData.generatedRigPreset)
      .find(value => value === 'humanoid' || value === 'quadruped' || value === 'chain' || value === 'modular') as AutoRigPreset | undefined
    return {
      bones: existingBones,
      preset: savedPreset ?? preset,
      created: false,
      convertedMeshes: 0,
      message: isGeneratedRig
        ? 'Rig automático salvo detectado. Os ossos e pesos existentes foram preservados.'
        : 'Rig existente detectado. Os ossos e pesos originais foram preservados.',
    }
  }

  const staticMeshes: THREE.Mesh[] = []
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && !(node instanceof THREE.SkinnedMesh) && node.visible) {
      staticMeshes.push(node)
    }
  })
  if (!staticMeshes.length) {
    if (existingBones.length) {
      return {
        bones: existingBones,
        preset,
        created: false,
        convertedMeshes: 0,
        message: 'O modelo já contém ossos. O rig existente está disponível para animação.',
      }
    }
    throw new Error('Não encontrei malhas visíveis para rigar. Verifique se o modelo contém geometria 3D.')
  }

  const worldBounds = new THREE.Box3().setFromObject(root)
  if (worldBounds.isEmpty()) throw new Error('Não foi possível calcular os limites do modelo.')
  const inverseRoot = root.matrixWorld.clone().invert()
  const bounds = worldBounds.clone().applyMatrix4(inverseRoot)
  if (bounds.getSize(new THREE.Vector3()).length() < 1e-4) {
    throw new Error('O modelo é pequeno demais ou não possui dimensões válidas para criar um rig.')
  }

  const detected = preset === 'auto' ? analyzeRiggingInput(root) : null
  const effectivePreset: ConcreteAutoRigPreset = detected?.recommendedPreset ?? preset as ConcreteAutoRigPreset
  const modularPlan = effectivePreset === 'modular' ? createModularRigSpecs(root, staticMeshes) : null
  const specs = modularPlan?.specs ?? createJointSpecs(bounds, effectivePreset as Exclude<ConcreteAutoRigPreset, 'modular'>)
  if (!specs.length) throw new Error('Não foi possível determinar juntas para este modelo.')
  const boneByName = new Map<string, THREE.Bone>()
  const positionByBone = new Map<THREE.Bone, THREE.Vector3>()
  const bones: THREE.Bone[] = []
  for (const spec of specs) {
    const bone = new THREE.Bone()
    bone.name = `Rig_${spec.name.replace(/[^A-Za-z0-9_-]/g, '_')}`
    bone.userData.generatedRigBone = true
    bone.userData.generatedRigPreset = effectivePreset
    const parent = spec.parent ? boneByName.get(spec.parent) : undefined
    if (spec.parent && !parent) throw new Error(`A hierarquia do rig tem um pai ausente: ${spec.parent}`)
    if (parent) parent.add(bone)
    else root.add(bone)
    const parentPosition = parent ? positionByBone.get(parent) : undefined
    bone.position.copy(spec.position)
    if (parentPosition) bone.position.sub(parentPosition)
    boneByName.set(spec.name, bone)
    positionByBone.set(bone, spec.position.clone())
    bones.push(bone)
  }

  root.updateWorldMatrix(true, true)
  const segments: RigSegment[] = []
  const boneIndices = new Map(bones.map((bone, index) => [bone, index]))
  for (const bone of bones) {
    const start = positionByBone.get(bone)
    if (!start) continue
    for (const child of bone.children) {
      if (!(child instanceof THREE.Bone)) continue
      const end = positionByBone.get(child)
      const boneIndex = boneIndices.get(bone)
      if (end && boneIndex !== undefined) segments.push({ boneIndex, start, end })
    }
  }
  if (!segments.length && effectivePreset !== 'modular') throw new Error('O rig não gerou segmentos de ossos utilizáveis.')

  const prepared: Array<{ original: THREE.Mesh; skinned: THREE.SkinnedMesh }> = []
  for (const original of staticMeshes) {
    const sourcePosition = original.geometry.getAttribute('position')
    if (!sourcePosition || sourcePosition.count === 0) continue

    const geometry = original.geometry.clone()
    const indices = new Array<number>(sourcePosition.count * 4).fill(0)
    const weights = new Array<number>(sourcePosition.count * 4).fill(0)
    const rootPoint = new THREE.Vector3()
    const localPoint = new THREE.Vector3()
    const modularJointName = modularPlan?.meshToJointName.get(original)
    const modularBoneIndex = modularJointName ? bones.findIndex(bone => bone.name === 'Rig_' + modularJointName) : -1
    for (let vertex = 0; vertex < sourcePosition.count; vertex++) {
      if (modularBoneIndex >= 0) {
        // Peças separadas (rodas, portas, membros rígidos etc.) ficam presas ao
        // próprio pivô: pesos rígidos evitam deformar rodas/carenagens por distância.
        indices[vertex * 4] = modularBoneIndex
        weights[vertex * 4] = 1
        continue
      }
      localPoint.fromBufferAttribute(sourcePosition, vertex)
      rootPoint.copy(original.localToWorld(localPoint)).applyMatrix4(inverseRoot)
      const nearest = segments.map(segment => ({
        boneIndex: segment.boneIndex,
        distanceSquared: distanceToSegmentSquared(rootPoint, segment.start, segment.end),
      })).sort((a, b) => a.distanceSquared - b.distanceSquared).slice(0, 4)

      if (!nearest.length) {
        indices[vertex * 4] = 0
        weights[vertex * 4] = 1
        continue
      }
      if (nearest[0]!.distanceSquared < 1e-8) {
        indices[vertex * 4] = nearest[0]!.boneIndex
        weights[vertex * 4] = 1
        continue
      }

      const inverseDistances = nearest.map(item => 1 / Math.max(Math.sqrt(item.distanceSquared), 0.025))
      const total = inverseDistances.reduce((sum, value) => sum + value, 0)
      nearest.forEach((item, slot) => {
        indices[vertex * 4 + slot] = item.boneIndex
        weights[vertex * 4 + slot] = inverseDistances[slot]! / total
      })
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))

    const skinned = new THREE.SkinnedMesh(geometry, original.material)
    skinned.name = original.name
    skinned.position.copy(original.position)
    skinned.quaternion.copy(original.quaternion)
    skinned.scale.copy(original.scale)
    skinned.rotation.order = original.rotation.order
    skinned.matrixAutoUpdate = original.matrixAutoUpdate
    skinned.visible = original.visible
    skinned.castShadow = original.castShadow
    skinned.receiveShadow = original.receiveShadow
    skinned.frustumCulled = false
    skinned.renderOrder = original.renderOrder
    skinned.userData = { ...original.userData }
    for (const child of [...original.children]) skinned.add(child)
    const parent = original.parent
    if (!parent) continue
    parent.add(skinned)
    parent.remove(original)
    prepared.push({ original, skinned })
  }

  if (!prepared.length) {
    for (const bone of bones) bone.removeFromParent()
    throw new Error('Não foi possível converter as malhas em malhas esqueléticas.')
  }

  root.updateWorldMatrix(true, true)
  const skeleton = new THREE.Skeleton(bones)
  skeleton.calculateInverses()
  for (const { skinned } of prepared) {
    skinned.updateWorldMatrix(true, false)
    skinned.bind(skeleton, skinned.matrixWorld.clone())
    skinned.normalizeSkinWeights()
  }

  root.userData.importRigPreset = effectivePreset
  root.userData.importRigGenerated = true
  root.userData.importRigBoneNames = bones.map(bone => bone.name)
  const detectionNote = detected ? ' Detecção: ' + detected.reason : ''
  const qualityNote = effectivePreset === 'modular'
    ? ' Cada malha recebeu um pivô próprio e pesos rígidos; isso funciona melhor quando as malhas realmente representam peças articuladas.'
    : ' Os pesos por proximidade são uma inicialização heurística; malhas orgânicas de peça única podem exigir ajuste manual ou um rig externo.'
  return {
    bones,
    preset: effectivePreset,
    created: true,
    convertedMeshes: prepared.length,
    message: 'Rig ' + effectivePreset + ' criado com ' + bones.length + ' ossos e ' + prepared.length + ' malhas esqueléticas.' + detectionNote + qualityNote,
  }
}

/** Recalculates bind matrices after adjusting joints in an auto-generated rig. */
export function rebindRigModel(root: THREE.Object3D): void {
  root.updateWorldMatrix(true, true)
  const meshes: THREE.SkinnedMesh[] = []
  const skeletons = new Set<THREE.Skeleton>()
  root.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return
    meshes.push(node)
    skeletons.add(node.skeleton)
  })
  for (const skeleton of skeletons) skeleton.calculateInverses()
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    mesh.bind(mesh.skeleton, mesh.matrixWorld.clone())
    mesh.normalizeSkinWeights()
  }
}

/** Captures each rig joint's local transform for a keyframe. */
export function captureRigPose(bones: THREE.Bone[]): Record<string, {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}> {
  const pose: Record<string, {
    position: [number, number, number]
    quaternion: [number, number, number, number]
    scale: [number, number, number]
  }> = {}
  for (const bone of bones) {
    pose[bone.name] = {
      position: bone.position.toArray() as [number, number, number],
      quaternion: bone.quaternion.toArray() as [number, number, number, number],
      scale: bone.scale.toArray() as [number, number, number],
    }
  }
  return pose
}

export function applyRigPose(
  bones: THREE.Bone[],
  pose: Record<string, { position: number[]; quaternion: number[]; scale: number[] }>,
): void {
  for (const bone of bones) {
    const value = pose[bone.name]
    if (!value || value.position.length !== 3 || value.quaternion.length !== 4 || value.scale.length !== 3) continue
    bone.position.fromArray(value.position)
    bone.quaternion.fromArray(value.quaternion)
    bone.scale.fromArray(value.scale)
    bone.updateMatrix()
  }
  if (bones[0]) bones[0]!.updateWorldMatrix(true, true)
}
