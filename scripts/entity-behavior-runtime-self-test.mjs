import assert from 'node:assert/strict'
import { EntityComponentRuntime } from '../engine/runtime/EntityComponentRuntime.ts'
import { EntityBehaviorRuntime } from '../engine/runtime/EntityBehaviorRuntime.ts'

const entities = new EntityComponentRuntime()
entities.create('hero')
const calls = []
const behaviorRuntime = new EntityBehaviorRuntime(entities, entityId => ({ entityId }))

behaviorRuntime.add('hero', {
  id: 'slow',
  priority: 10,
  onAttach: context => calls.push(`attach:slow:${context.entityId}`),
  onStart: context => calls.push(`start:slow:${context.entityId}`),
  update: (dt, context) => calls.push(`update:slow:${dt}:${context.entityId}`),
  onStop: context => calls.push(`stop:slow:${context.entityId}`),
  onDetach: context => calls.push(`detach:slow:${context.entityId}`),
})
behaviorRuntime.add('hero', {
  id: 'fast',
  priority: 1,
  onAttach: context => calls.push(`attach:fast:${context.entityId}`),
  onStart: context => calls.push(`start:fast:${context.entityId}`),
  update: (dt, context) => calls.push(`update:fast:${dt}:${context.entityId}`),
  onStop: context => calls.push(`stop:fast:${context.entityId}`),
  onDetach: context => calls.push(`detach:fast:${context.entityId}`),
})
assert.throws(() => behaviorRuntime.add('missing', { id: 'missing-behavior' }), /missing entity/i)
assert.throws(() => behaviorRuntime.add('hero', { id: 'fast' }), /already exists/i)
assert.deepEqual(behaviorRuntime.list('hero').map(item => item.id), ['fast', 'slow'])

behaviorRuntime.start()
behaviorRuntime.update(0.25)
assert.deepEqual(calls, [
  'attach:slow:hero',
  'attach:fast:hero',
  'start:fast:hero',
  'start:slow:hero',
  'update:fast:0.25:hero',
  'update:slow:0.25:hero',
])
entities.setEnabled('hero', false)
entities.setEnabled('hero', true)
assert.equal(behaviorRuntime.setEnabled('hero', 'fast', false), true)
behaviorRuntime.update(-2)
assert.deepEqual(calls.slice(6), [
  'stop:slow:hero',
  'stop:fast:hero',
  'start:fast:hero',
  'start:slow:hero',
  'stop:fast:hero',
  'update:slow:0:hero',
])
assert.equal(behaviorRuntime.remove('hero', 'slow'), true)
assert.equal(behaviorRuntime.remove('hero', 'slow'), false)
assert.equal(behaviorRuntime.size, 1)
assert.equal(entities.destroy('hero'), true)
assert.equal(behaviorRuntime.size, 0)
assert.deepEqual(calls.slice(-4), [
  'update:slow:0:hero',
  'stop:slow:hero',
  'detach:slow:hero',
  'detach:fast:hero',
], 'entity destruction must detach remaining behaviors after removing active ones')
// fast was already disabled, so teardown should not call stop a second time.
assert.equal(calls.filter(call => call === 'stop:fast:hero').length, 2)
behaviorRuntime.stop()
behaviorRuntime.dispose()
assert.throws(() => behaviorRuntime.add('other', { id: 'x' }), /disposed/i)

// A failing behavior is quarantined and cannot break other entities' updates.
const errorEntities = new EntityComponentRuntime()
errorEntities.create('a')
errorEntities.create('b')
const errorRuntime = new EntityBehaviorRuntime(errorEntities, entityId => ({ entityId }))
let failingUpdates = 0
let healthyUpdates = 0
const originalConsoleError = console.error
console.error = () => {}
try {
  errorRuntime.add('a', {
    id: 'unstable',
    update: () => { failingUpdates += 1; throw new Error('expected failure') },
    onStop: () => calls.push('unstable-stop'),
  })
  errorRuntime.add('b', { id: 'healthy', update: () => { healthyUpdates += 1 } })
  errorRuntime.start()
  errorRuntime.update(0.1)
  errorRuntime.update(0.1)
  assert.equal(failingUpdates, 1)
  assert.equal(healthyUpdates, 2)
  assert.equal(errorRuntime.list('a')[0].faulted, true)
} finally {
  console.error = originalConsoleError
}
errorRuntime.dispose()

// Behaviors are stopped before component teardown, so their cleanup can still
// inspect the entity's components while responding to destruction.
const orderedEntities = new EntityComponentRuntime()
orderedEntities.defineComponent('marker')
orderedEntities.create('ordered')
orderedEntities.addComponent('ordered', 'marker', { ready: true })
let detachSawMarker = false
const orderedRuntime = new EntityBehaviorRuntime(
  orderedEntities,
  entityId => ({ entityId, hasMarker: orderedEntities.hasComponent(entityId, 'marker') }),
)
orderedRuntime.add('ordered', {
  id: 'reads-components-on-detach',
  onDetach: context => { detachSawMarker = context.hasMarker },
})
orderedRuntime.start()
orderedEntities.destroy('ordered')
assert.equal(detachSawMarker, true)
orderedRuntime.dispose()
console.log('Entity behavior runtime self-test passed.')
