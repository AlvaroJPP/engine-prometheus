import assert from 'node:assert/strict'
import {
  calculateModelImportTransform,
  normalizeModelImportHeight,
} from '../src/lib/assets/ModelImportNormalization.ts'

assert.equal(normalizeModelImportHeight(2), 2)
assert.equal(normalizeModelImportHeight(1.236), 1.24, 'User-entered height rounds to two decimals')
assert.equal(normalizeModelImportHeight(0.1), 0.1)
assert.equal(normalizeModelImportHeight(0.01), 0.1, 'Model height has a 0.1 minimum')
assert.equal(normalizeModelImportHeight(-20), 0.1, 'Negative model height clamps to the minimum')
assert.equal(normalizeModelImportHeight(10001), 10000, 'Model height clamps at 10000')
assert.equal(normalizeModelImportHeight(Number.NaN), null, 'NaN input should be ignored')
assert.equal(normalizeModelImportHeight(Number.POSITIVE_INFINITY), null, 'Infinite input should be ignored')

assert.deepEqual(
  calculateModelImportTransform([10, 20, -4], 4, 8),
  { height: 8, scale: 2, position: [-20, -40, 8] },
  'The measured model center is negated after scale is calculated',
)
assert.deepEqual(
  calculateModelImportTransform([1, -2, 3], 4, 1.5),
  { height: 1.5, scale: 0.375, position: [-0.375, 0.75, -1.125] },
)
assert.deepEqual(
  calculateModelImportTransform([1, 2, 3], 4, 0),
  { height: 2, scale: 0.5, position: [-0.5, -1, -1.5] },
  'Invalid target height uses the default import height of 2',
)
assert.deepEqual(
  calculateModelImportTransform([0, 0, 0], 2, Number.NaN),
  { height: 2, scale: 1, position: [-0, -0, -0] },
  'Non-finite target height uses the default import height',
)

console.log('Model import normalization self-test passed.')
