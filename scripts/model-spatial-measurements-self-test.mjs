import assert from 'node:assert/strict'
import * as THREE from 'three'
import { measureModelImportSpatialData } from '../src/lib/assets/ModelSpatialMeasurements.ts'

const root = new THREE.Group()
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 4, 6),
  new THREE.MeshBasicMaterial(),
)
mesh.position.set(5, 10, -2)
root.add(mesh)

const measurement = measureModelImportSpatialData(root)
assert.deepEqual(measurement.dimensions, [2, 4, 6])
assert.equal(measurement.height, 4)
assert.deepEqual(measurement.center, [5, 10, -2], 'The center should use the transformed world-space bounds')

const nestedRoot = new THREE.Group()
const parent = new THREE.Group()
parent.position.set(-3, 2, 7)
parent.scale.set(2, 0.5, 3)
const nestedMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 4, 6),
  new THREE.MeshBasicMaterial(),
)
nestedMesh.position.set(1, 4, -2)
parent.add(nestedMesh)
nestedRoot.add(parent)

const nestedMeasurement = measureModelImportSpatialData(nestedRoot)
assert.deepEqual(nestedMeasurement.dimensions, [4, 2, 18], 'Measurements must include parent transforms')
assert.deepEqual(nestedMeasurement.center, [-1, 4, 1], 'Center must include nested position and scale')
assert.equal(nestedMeasurement.height, 2)

assert.throws(
  () => measureModelImportSpatialData(new THREE.Group()),
  /O arquivo não contém uma malha 3D visível/,
)
const invalidRoot = new THREE.Group()
const invalidMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
invalidMesh.position.set(Number.NaN, 0, 0)
invalidRoot.add(invalidMesh)
assert.throws(
  () => measureModelImportSpatialData(invalidRoot),
  /Não foi possível calcular o tamanho deste modelo/,
  'Non-finite dimensions must be rejected',
)

console.log('Model spatial measurements self-test passed.')
