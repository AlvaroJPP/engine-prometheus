import * as THREE from 'three'

export type AutoRigPreset = 'humanoid' | 'quadruped' | 'chain'

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

function createJointSpecs(bounds: THREE.Box3, preset: AutoRigPreset): JointSpec[] {
  const min = bounds.min
  const max = bounds.max
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
    return {
      bones: existingBones,
      preset,
      created: false,
      convertedMeshes: 0,
      message: 'Rig existente detectado. Os ossos e pesos originais foram preservados.',
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

  const specs = createJointSpecs(bounds, preset)
  const boneByName = new Map<string, THREE.Bone>()
  const positionByBone = new Map<THREE.Bone, THREE.Vector3>()
  const bones: THREE.Bone[] = []
  for (const spec of specs) {
    const bone = new THREE.Bone()
    bone.name = `Rig_${spec.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`
    bone.userData.generatedRigBone = true
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
  if (!segments.length) throw new Error('O rig não gerou segmentos de ossos utilizáveis.')

  const prepared: Array<{ original: THREE.Mesh; skinned: THREE.SkinnedMesh }> = []
  for (const original of staticMeshes) {
    const sourcePosition = original.geometry.getAttribute('position')
    if (!sourcePosition || sourcePosition.count === 0) continue

    const geometry = original.geometry.clone()
    const indices = new Array<number>(sourcePosition.count * 4).fill(0)
    const weights = new Array<number>(sourcePosition.count * 4).fill(0)
    const rootPoint = new THREE.Vector3()
    const localPoint = new THREE.Vector3()
    for (let vertex = 0; vertex < sourcePosition.count; vertex++) {
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

  root.userData.importRigPreset = preset
  root.userData.importRigGenerated = true
  root.userData.importRigBoneNames = bones.map(bone => bone.name)
  return {
    bones,
    preset,
    created: true,
    convertedMeshes: prepared.length,
    message: `Rig ${preset} criado com ${bones.length} ossos e ${prepared.length} malhas esqueléticas. Confira a deformação, pois o peso automático é uma base inicial.`,
  }
}

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
