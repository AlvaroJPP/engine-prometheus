import assert from 'node:assert/strict'
import {
  createImportModelStateDraft,
  parseImportModelStateValue,
  parseImportModelStates,
  serializeImportModelStates,
} from '../src/lib/assets/ImportModelStates.ts'

const validState = {
  id: 'state-mounted',
  nodePath: 'Root/Rider',
  variable: 'mounted',
  operator: 'not_equals',
  value: true,
  visibleWhenMatched: false,
}

const parsedStates = parseImportModelStates([
  validState,
  { ...validState, id: 'missing-path', nodePath: '' },
  { ...validState, id: 'missing-variable', variable: '' },
  { ...validState, id: 'invalid-value', value: null },
  { ...validState, id: 'invalid-value-type', value: { nested: true } },
  null,
  'not-an-object',
])

assert.deepEqual(parsedStates, [validState], 'Only complete visual states with scalar values should be accepted')
assert.deepEqual(serializeImportModelStates(parsedStates), [validState], 'Serialization should preserve valid state fields')
assert.deepEqual(parseImportModelStates(null), [], 'Non-array persisted data should safely normalize to an empty list')

assert.equal(parseImportModelStateValue('true'), true)
assert.equal(parseImportModelStateValue('false'), false)
assert.equal(parseImportModelStateValue(' 12.5 '), 12.5)
assert.equal(parseImportModelStateValue(' horse '), ' horse ', 'Non-boolean, non-numeric input should preserve the original text')

const mountedState = createImportModelStateDraft('Root/Rider', { name: 'mounted', defaultValue: false })
assert.equal(mountedState.nodePath, 'Root/Rider')
assert.equal(mountedState.variable, 'mounted')
assert.equal(mountedState.value, true, 'The mounted state should default to true so the rider can be shown')
assert.equal(mountedState.operator, 'equals')
assert.equal(mountedState.visibleWhenMatched, true)
assert.ok(mountedState.id.length > 0)

const regularState = createImportModelStateDraft('Root/Weapon', { name: 'equipped', defaultValue: false })
assert.equal(regularState.value, false, 'Non-mounted variables should retain their declared default')

console.log('Model import state self-test passed.')
