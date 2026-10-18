import assert from 'node:assert/strict'
import * as THREE from 'three'
import { analyzeRiggingInput, autoRigModel } from '../src/lib/animation/Rigging.ts'

function addBox(parent, name, size, position) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshStandardMaterial(),
  )
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  parent.add(mesh)
  return mesh
}

// The auto detector should identify a human-proportioned single mesh.
{
  const root = new THREE.Group()
  root.name = 'TestPerson'
  addBox(root, 'BodyMesh', [0.8, 2, 0.5], [0, 1, 0])
  const analysis = analyzeRiggingInput(root)
  assert.equal(analysis.recommendedPreset, 'humanoid')
  assert.equal(analysis.meshCount, 1)
}

// Names and proportions are used as hints, not as a guarantee of quality.
{
  const root = new THREE.Group()
  root.name = 'HorseModel'
  addBox(root, 'CombinedMesh', [1.2, 1.4, 2.8], [0, 0.7, 0])
  assert.equal(analyzeRiggingInput(root).recommendedPreset, 'quadruped')
}

// Modular models should receive one bone per mesh and rigid normalized weights.
{
  const root = new THREE.Group()
  root.name = 'TestVehicle'
  addBox(root, 'Chassis', [2, 0.45, 1.2], [0, 0.7, 0])
  addBox(root, 'Wheel_FL', [0.35, 0.35, 0.2], [-0.72, 0.24, 0.58])
  addBox(root, 'Wheel_FR', [0.35, 0.35, 0.2], [0.72, 0.24, 0.58])
  addBox(root, 'Wheel_BL', [0.35, 0.35, 0.2], [-0.72, 0.24, -0.58])
  addBox(root, 'Wheel_BR', [0.35, 0.35, 0.2], [0.72, 0.24, -0.58])

  const analysis = analyzeRiggingInput(root)
  assert.equal(analysis.recommendedPreset, 'modular')

  const result = autoRigModel(root, 'auto')
  assert.equal(result.created, true)
  assert.equal(result.preset, 'modular')
  assert.equal(result.bones.length, 5)
  assert.equal(result.convertedMeshes, 5)

  const skinnedMeshes = []
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) skinnedMeshes.push(node)
  })
  assert.equal(skinnedMeshes.length, 5)

  for (const mesh of skinnedMeshes) {
    const indices = mesh.geometry.getAttribute('skinIndex')
    const weights = mesh.geometry.getAttribute('skinWeight')
    assert.ok(indices && weights, 'mesh must have skinIndex and skinWeight attributes')
    assert.equal(indices.count, weights.count)
    for (let vertex = 0; vertex < weights.count; vertex += 1) {
      const sum = weights.getX(vertex) + weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex)
      assert.ok(Math.abs(sum - 1) < 1e-5, 'skin weights must sum to one')
      assert.ok(Math.abs(weights.getX(vertex) - 1) < 1e-5, 'modular mesh must use its rigid bone influence')
      assert.ok(weights.getY(vertex) === 0 && weights.getZ(vertex) === 0 && weights.getW(vertex) === 0)
    }
  }
}

// A loaded skinned model must be preserved rather than receiving a second rig.
{
  const root = new THREE.Group()
  root.name = 'AlreadyRigged'
  const bone = new THREE.Bone()
  bone.name = 'ExistingBone'
  root.add(bone)

  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(geometry.getAttribute('position').count * 4).fill(0), 4))
  const weights = new Array(geometry.getAttribute('position').count * 4).fill(0)
  for (let i = 0; i < geometry.getAttribute('position').count; i += 1) weights[i * 4] = 1
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
  root.add(mesh)
  root.updateWorldMatrix(true, true)
  const skeleton = new THREE.Skeleton([bone])
  skeleton.calculateInverses()
  mesh.bind(skeleton, mesh.matrixWorld.clone())

  const result = autoRigModel(root, 'auto')
  assert.equal(result.created, false)
  assert.equal(result.bones.length, 1)
  assert.equal(result.bones[0], bone)
}

console.log('Rigging self-test passed: auto detection, modular rigid weights, and existing-skeleton preservation.')
