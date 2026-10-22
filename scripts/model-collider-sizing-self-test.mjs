import assert from 'node:assert/strict'
import { calculateImportColliderSize } from '../src/lib/assets/ModelColliderSizing.ts'

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

console.log('Model collider sizing self-test passed.')
