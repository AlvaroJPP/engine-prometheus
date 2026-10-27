import assert from 'node:assert/strict'
import { EntityComponentRuntime } from '../engine/runtime/EntityComponentRuntime.ts'

const calls = []
const entities = new EntityComponentRuntime()
entities.defineComponent('transform', {
  onAttach: (id, value) => calls.push(['attach-transform', id, value.x]),
  onRemove: (id, value) => calls.push(['remove-transform', id, value.x]),
})
entities.defineComponent('health', {
  onAttach: id => calls.push(['attach-health', id]),
  onRemove: id => calls.push(['remove-health', id]),
})

const events = []
entities.subscribe(event => events.push(event.type))
entities.create('hero')
assert.equal(entities.size, 1)
assert.equal(entities.addComponent('hero', 'transform', { x: 2, y: 0, z: 4 }), true)
assert.equal(entities.addComponent('hero', 'health', { current: 10 }), true)
assert.equal(entities.addComponent('hero', 'health', { current: 20 }), false)
assert.deepEqual(entities.getComponent('hero', 'transform'), { x: 2, y: 0, z: 4 })
assert.equal(entities.hasComponent('hero', 'health'), true)
assert.deepEqual(entities.query(['transform', 'health']), ['hero'])
assert.deepEqual(entities.get('hero').componentTypes, ['transform', 'health'])

assert.equal(entities.setEnabled('hero', false), true)
assert.deepEqual(entities.query(['transform']), [])
assert.deepEqual(entities.query(['transform'], { includeDisabled: true }), ['hero'])
assert.equal(entities.setEnabled('hero', false), false)
assert.equal(entities.removeComponent('hero', 'health'), true)
assert.equal(entities.removeComponent('hero', 'health'), false)
assert.equal(entities.destroy('hero'), true)
assert.equal(entities.destroy('hero'), false)
assert.equal(entities.get('hero'), undefined)
assert.equal(entities.size, 0)
assert.deepEqual(calls, [
  ['attach-transform', 'hero', 2],
  ['attach-health', 'hero'],
  ['remove-health', 'hero'],
  ['remove-transform', 'hero', 2],
])
assert.deepEqual(events, [
  'entity-created',
  'component-added',
  'component-added',
  'entity-enabled-changed',
  'component-removed',
  'component-removed',
  'entity-destroyed',
])

assert.throws(() => entities.create('  '), /identifier must not be empty/i)
entities.create('other')
assert.throws(() => entities.create('other'), /already exists/i)
entities.clear()
assert.equal(entities.size, 0)
console.log('Entity component runtime self-test passed.')
