import assert from 'node:assert/strict'
import {
  formatPackageConfigLabel,
  isSimplePackageConfigValue,
  parseImportPackageConfigScalar,
  readImportPackageVectorAxis,
  resolveImportPackageControlBinding,
  updateImportPackageVector,
} from '../src/lib/assets/ImportBehaviorPackageConfig.ts'

assert.equal(isSimplePackageConfigValue('speed', 1.5), true)
assert.equal(isSimplePackageConfigValue('title', 'Montaria'), true)
for (const key of ['interactionKey', 'seatOffset', 'controlBindings', 'modelStates']) {
  assert.equal(isSimplePackageConfigValue(key, 'x'), false, key)
}
assert.equal(isSimplePackageConfigValue('enabled', true), false)
assert.equal(isSimplePackageConfigValue('position', [0, 1, 0]), false)

assert.equal(formatPackageConfigLabel('maxSpeed'), 'Max Speed')
assert.equal(formatPackageConfigLabel('gravity'), 'Gravity')
assert.equal(formatPackageConfigLabel('URLValue'), 'URLValue')

assert.equal(parseImportPackageConfigScalar(' 1,25 ', 1), 1.25)
assert.equal(parseImportPackageConfigScalar('0', 1), 0)
assert.equal(parseImportPackageConfigScalar('', 1), null)
assert.equal(parseImportPackageConfigScalar('   ', 1), null)
assert.equal(parseImportPackageConfigScalar('NaN', 1), null)
assert.equal(parseImportPackageConfigScalar('  custom label  ', 'default'), '  custom label  ')
assert.equal(parseImportPackageConfigScalar('true', false), 'true')

assert.equal(readImportPackageVectorAxis([1, 0.55, -2], 2, 4), -2)
assert.equal(readImportPackageVectorAxis([1, 'not-a-number', 0], 1, 4), 4)
assert.equal(readImportPackageVectorAxis({ x: 1 }, 0, 7), 7)

assert.deepEqual(updateImportPackageVector([1, 0.55, 2], 1, '3,75'), [1, 3.75, 2])
assert.deepEqual(updateImportPackageVector([1, 0.55, 2], 2, '50'), [1, 0.55, 10])
assert.deepEqual(updateImportPackageVector([1, 0.55, 2], 0, '-50'), [-10, 0.55, 2])
assert.deepEqual(updateImportPackageVector([1], 2, '2'), [0, 0.55, 2])
assert.deepEqual(updateImportPackageVector({ x: 1 }, 0, '2'), [2, 0.55, 0])
assert.deepEqual(updateImportPackageVector([0, 0, 0], 0, ''), [0, 0, 0])
assert.equal(updateImportPackageVector([0, 0, 0], 0, 'Infinity'), null)

assert.equal(resolveImportPackageControlBinding({ forward: 'W' }, 'forward', 'ArrowUp'), 'W')
assert.equal(resolveImportPackageControlBinding({ forward: '' }, 'forward', 'ArrowUp'), 'ArrowUp')
assert.equal(resolveImportPackageControlBinding([], 'forward', 'ArrowUp'), 'ArrowUp')

console.log('Import behavior package config self-test passed.')
