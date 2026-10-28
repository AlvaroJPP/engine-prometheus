import assert from 'node:assert/strict'
import { EntityComponentRuntime } from '../engine/runtime/EntityComponentRuntime.ts'
import { EntityQueryRuntime } from '../engine/runtime/EntityQueryRuntime.ts'
import { EntityBatchProcessor } from '../engine/runtime/EntityBatchProcessor.ts'

const entities = new EntityComponentRuntime()
entities.defineComponent('position')
entities.defineComponent('velocity')
for (const [id, x] of [['alpha', 1], ['beta', 2]]) {
  entities.create(id)
  entities.addComponent(id, 'position', { x })
  entities.addComponent(id, 'velocity', { x: 0 })
}
const queries = new EntityQueryRuntime(entities)
const query = queries.create('movable', { allOf: ['position', 'velocity'] })
const processor = new EntityBatchProcessor(entities)
const errors = []
const reportedErrors = []
const view = processor.createView(query, entityId => ({ entityId }), {
  onError: (entityId, error) => reportedErrors.push([entityId, error.message]),
})
assert.deepEqual(view.entityIds, ['alpha', 'beta'])
assert.equal(view.size, 2)
assert.equal(view.has('alpha'), true)
assert.deepEqual(view.getComponent('alpha', 'position'), { x: 1 })
assert.equal(view.hasComponent('beta', 'velocity'), true)
assert.deepEqual(view.getContext('beta'), { entityId: 'beta' })

const processed = []
const report = view.forEach(item => {
  processed.push([item.entityId, item.context.entityId, item.getComponent('position')?.x])
  if (item.entityId === 'alpha') {
    entities.removeComponent('beta', 'velocity')
    entities.create('gamma')
    entities.addComponent('gamma', 'position', { x: 3 })
    entities.addComponent('gamma', 'velocity', { x: 0 })
  }
})
assert.deepEqual(processed, [['alpha', 'alpha', 1]])
assert.deepEqual(report, {
  candidateCount: 2,
  processedCount: 1,
  skippedCount: 1,
  failures: [],
})
assert.equal(query.has('gamma'), true, 'new matches should be visible to the next batch')
assert.deepEqual(view.entityIds, ['alpha', 'beta'], 'existing batches must keep their original candidate snapshot')
assert.equal(view.has('beta'), false)
assert.equal(view.getComponent('beta', 'position'), undefined)

const failingView = processor.createView(query, id => ({ id }), {
  onError: (id, error) => reportedErrors.push([id, error.message]),
})
const failed = failingView.forEach(item => {
  if (item.entityId === 'alpha') throw new Error('expected failure')
  errors.push(item.entityId)
})
assert.equal(failed.failures.length, 1)
assert.equal(failed.failures[0].entityId, 'alpha')
assert.deepEqual(reportedErrors, [['alpha', 'expected failure']])
assert.deepEqual(errors, ['gamma'], 'one entity callback failure must not block remaining batch items')

const eligibilityView = processor.createView(query, id => id, {
  isEligible: id => id !== 'gamma',
})
assert.equal(eligibilityView.has('gamma'), false)
assert.deepEqual(eligibilityView.entityIds, ['alpha', 'gamma'])
assert.deepEqual(eligibilityView.forEach(item => errors.push(item.entityId)).processedCount, 1)
assert.deepEqual(errors, ['gamma', 'alpha'])

query.dispose()
queries.dispose()
console.log('Entity batch processor self-test passed.')
