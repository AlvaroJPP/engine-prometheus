import * as THREE from 'three'
import assert from 'node:assert/strict'
import {
  calculateImportColliderSize,
  calculateImportColliderSizeFromObjectBounds,
  normalizeImportColliderForType,
  updateImportColliderVector,
} from '../src/lib/assets/ModelColliderSizing.ts'

assert.deepEqual(
  calculateImportColliderSize([1, 2, 3], 2, 'box'),
  [2, 4, 6],
  'Box dimensions should follow the final model scale',
)
assert.deepEqual(
  calculateImportColliderSize([0.8, 2, 1.2], 2, 'sphere'),
  [1.6, 1.6, 1.6],
  'A sphere should use the smallest scaled dimension for its diameter',
)
assert.deepEqual(
  calculateImportColliderSize([1, 2, 3], 0.5, 'capsule'),
  [0.5, 1, 1.5],
  'Capsule sizing should retain its scaled dimensions',
)
assert.deepEqual(
  calculateImportColliderSize([0, -2, 0.01], 1, 'box'),
  [0.05, 0.05, 0.05],
  'Every collider dimension should respect the 0.05 minimum',
)
assert.deepEqual(
  calculateImportColliderSize([0.01, 0.03, 0.02], 1, 'sphere'),
  [0.05, 0.05, 0.05],
  'Sphere sizing should preserve the minimum diameter',
)
assert.deepEqual(
  calculateImportColliderSize([1, 2, 3], 1, 'mesh'),
  [1, 2, 3],
  'Mesh collider sizing should preserve its measured dimensions',
)


assert.deepEqual(
  normalizeImportColliderForType('sphere', [3, 1.2, 2], [4, -2, 8]),
  { size: [1.2, 1.2, 1.2], offset: [4, -2, 8] },
  'Switching to a sphere should equalize dimensions and retain the offset',
)
assert.deepEqual(
  normalizeImportColliderForType('mesh', [3, 1.2, 2], [4, -2, 8]),
  { size: [3, 1.2, 2], offset: [0, 0, 0] },
  'Mesh colliders reset the previous offset',
)
assert.deepEqual(
  normalizeImportColliderForType('box', [3, 1.2, 2], [4, -2, 8]),
  { size: [3, 1.2, 2], offset: [4, -2, 8] },
  'Box and capsule settings stay unchanged when switching modes',
)
assert.deepEqual(
  normalizeImportColliderForType('sphere', [0.01, 0.1, 0.08], [0, 1, 2]).size,
  [0.05, 0.05, 0.05],
  'Sphere diameter honors the minimum size',
)

assert.deepEqual(
  updateImportColliderVector([1, 2, 3], 'colliderSize', 1, 120, 'box'),
  [1, 100, 3],
  'Collider sizes are capped at 100',
)
assert.deepEqual(
  updateImportColliderVector([1, 2, 3], 'colliderSize', 1, -2, 'box'),
  [1, 0.05, 3],
  'Collider sizes enforce the 0.05 minimum',
)
assert.deepEqual(
  updateImportColliderVector([1, 2, 3], 'colliderOffset', 0, -120, 'box'),
  [-100, 2, 3],
  'Offsets are clamped to the supported range',
)
assert.deepEqual(
  updateImportColliderVector([1, 2, 3], 'colliderOffset', 1, 7, 'mesh'),
  [1, 7, 3],
  'Offset vector axes can be edited for all collider types',
)
assert.deepEqual(
  updateImportColliderVector([1, 2, 3], 'colliderSize', 2, 4, 'sphere'),
  [4, 4, 4],
  'Editing any sphere diameter synchronizes all axes',
)
assert.equal(
  updateImportColliderVector([1, 2, 3], 'colliderSize', 2, Number.NaN, 'box'),
  null,
  'Non-finite input is ignored',
)


const measuredRoot = new THREE.Group()
const measuredMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 4, 6),
  new THREE.MeshBasicMaterial(),
)
measuredMesh.position.set(10, 20, -4)
measuredRoot.add(measuredMesh)
measuredRoot.updateMatrixWorld(true)
assert.deepEqual(
  calculateImportColliderSizeFromObjectBounds(measuredRoot, 8, 'box'),
  [4, 8, 12],
  'Collider size follows global bounds and the requested component height',
)
assert.deepEqual(
  calculateImportColliderSizeFromObjectBounds(measuredRoot, 8, 'sphere'),
  [4, 4, 4],
  'Object-bound sphere sizing uses the smallest scaled dimension',
)
const scaledMeasuredRoot = new THREE.Group()
scaledMeasuredRoot.scale.set(2, 0.5, 1)
scaledMeasuredRoot.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshBasicMaterial()))
assert.deepEqual(
  calculateImportColliderSizeFromObjectBounds(scaledMeasuredRoot, 4, 'box'),
  [8, 4, 12],
  'Global bounds account for parent scale',
)
assert.equal(
  calculateImportColliderSizeFromObjectBounds(new THREE.Group(), 2, 'box'),
  null,
  'Parts without geometry do not replace the current collider size',
)

measuredMesh.geometry.dispose()
measuredMesh.material.dispose()

console.log('Model collider sizing self-test passed.')
