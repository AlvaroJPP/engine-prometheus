import assert from 'node:assert/strict'
import { EntityComponentRuntime } from '../engine/runtime/EntityComponentRuntime.ts'
import { EntityQueryRuntime } from '../engine/runtime/EntityQueryRuntime.ts'

const entities = new EntityComponentRuntime()
entities.defineComponent('position')
entities.defineComponent('renderable')
entities.defineComponent('logic')
entities.defineComponent('sleeping')

entities.create('alpha')
entities.addComponent('alpha', 'position', { x: 1 })
entities.addComponent('alpha', 'renderable', true)
entities.create('beta')
entities.addComponent('beta', 'position', { x: 2 })
entities.addComponent('beta', 'logic', true)
entities.addComponent('beta', 'sleeping', true)
entities.create('gamma')
entities.addComponent('gamma', 'renderable', true)
entities.setEnabled('gamma', false)

const runtime = new EntityQueryRuntime(entities)
const query = runtime.create('active-positioned', {
  allOf: ['position'],
  anyOf: ['renderable', 'logic'],
  noneOf: ['sleeping'],
})
assert.equal(query.size, 1)
assert.deepEqual(query.getEntities(), ['alpha'])
assert.equal(query.has('alpha'), true)
assert.equal(query.has('beta'), false)

const events = []
query.subscribe(event => events.push([event.type, event.entityId]))
entities.create('delta')
entities.addComponent('delta', 'position', { x: 4 })
assert.deepEqual(events, [])
entities.addComponent('delta', 'logic', true)
assert.deepEqual(events, [['enter', 'delta']])
entities.addComponent('delta', 'sleeping', true)
assert.deepEqual(events.at(-1), ['exit', 'delta'])
entities.removeComponent('delta', 'sleeping')
assert.deepEqual(events.at(-1), ['enter', 'delta'])
entities.setEnabled('delta', false)
assert.deepEqual(events.at(-1), ['exit', 'delta'])
entities.setEnabled('delta', true)
assert.deepEqual(events.at(-1), ['enter', 'delta'])
entities.destroy('alpha')
assert.deepEqual(events.at(-1), ['exit', 'alpha'], 'destruction must evict query results before removing components')
assert.deepEqual(query.getEntities(), ['delta'])

const includeDisabled = runtime.create('all-renderables', {
  anyOf: ['renderable', 'logic'],
  includeDisabled: true,
})
assert.deepEqual(includeDisabled.getEntities(), ['beta', 'delta', 'gamma'])
const excludingDisabled = runtime.create('enabled-renderables', { anyOf: ['renderable', 'logic'] })
assert.deepEqual(excludingDisabled.getEntities(), ['beta', 'delta'])
assert.deepEqual(runtime.list().map(item => item.id), [
  'active-positioned',
  'all-renderables',
  'enabled-renderables',
])
assert.equal(runtime.list()[0].size, 1)

assert.throws(() => runtime.create('invalid', { allOf: ['position'], noneOf: ['position'] }), /cannot require and exclude/i)
assert.throws(() => runtime.create('empty-filter', { allOf: [''] }), /cannot contain empty/i)
assert.throws(() => runtime.create('  '), /non-empty identifier/i)
assert.throws(() => runtime.create('active-positioned'), /already exists/i)

// Query notifications are reentrant-safe when a callback changes the same entity.
const reentrantEvents = []
const reentrant = runtime.create('reentrant', { allOf: ['position'], noneOf: ['sleeping'] })
reentrant.subscribe(event => {
  reentrantEvents.push(event.type)
  if (event.type === 'enter') entities.addComponent(event.entityId, 'sleeping', true)
})
entities.create('reentrant-entity')
entities.addComponent('reentrant-entity', 'position', {})
assert.deepEqual(reentrantEvents, ['enter', 'exit'])
assert.equal(reentrant.has('reentrant-entity'), false)

// Listener failures are isolated so they do not leave the query cache inconsistent.
const safeQuery = runtime.create('listener-isolation', { allOf: ['position'] })
const originalConsoleError = console.error
console.error = () => {}
try {
  safeQuery.subscribe(() => { throw new Error('expected query listener failure') })
  entities.create('safe')
  entities.addComponent('safe', 'position', {})
  assert.equal(safeQuery.has('safe'), true)
} finally {
  console.error = originalConsoleError
}

// Clearing invalidates old handles but leaves the query runtime reusable.
const staleHandle = runtime.create('stale', {})
runtime.clear()
assert.equal(runtime.size, 0)
assert.deepEqual(staleHandle.getEntities(), [], 'cleared handles must not expose stale cached entity IDs')
assert.throws(() => staleHandle.subscribe(() => {}), /disposed/i)
const reusedId = runtime.create('stale', {})
assert.equal(reusedId.size, 4)
staleHandle.dispose()
assert.equal(runtime.list().some(item => item.id === 'stale'), true)

runtime.dispose()
assert.throws(() => runtime.create('after-dispose'), /disposed/i)
query.dispose()
includeDisabled.dispose()
excludingDisabled.dispose()
reentrant.dispose()
safeQuery.dispose()
reusedId.dispose()
console.log('Entity query runtime self-test passed.')
