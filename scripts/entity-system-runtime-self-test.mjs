import assert from 'node:assert/strict'
import { EntityComponentRuntime } from '../engine/runtime/EntityComponentRuntime.ts'
import { EntitySystemRuntime } from '../engine/runtime/EntitySystemRuntime.ts'

const entities = new EntityComponentRuntime()
entities.defineComponent('transform')
entities.defineComponent('dead')
entities.create('actor')
entities.addComponent('actor', 'transform', { x: 0 })
const calls = []
const systems = new EntitySystemRuntime(entities, entityId => ({
  entityId,
  hasTransform: entities.hasComponent(entityId, 'transform'),
}))
const unregister = systems.register({
  id: 'movement',
  requiredComponents: ['transform'],
  excludedComponents: ['dead'],
  priority: 5,
  onEntityEnter: (id, context) => calls.push(['enter', id, context.hasTransform]),
  updateEntity: (dt, id) => calls.push(['update', id, dt]),
  onEntityExit: id => calls.push(['exit', id]),
})
assert.deepEqual(systems.list(), [{
  id: 'movement',
  enabled: true,
  active: false,
  priority: 5,
  matchedEntityCount: 0,
  faultedEntityCount: 0,
}])
systems.start()
assert.deepEqual(calls, [['enter', 'actor', true]])

entities.create('npc')
entities.addComponent('npc', 'transform', { x: 3 })
assert.deepEqual(calls.at(-1), ['enter', 'npc', true])
systems.update(0.25)
assert.deepEqual(calls.slice(-2), [
  ['update', 'actor', 0.25],
  ['update', 'npc', 0.25],
])

entities.addComponent('actor', 'dead', { reason: 'test' })
assert.deepEqual(calls.at(-1), ['exit', 'actor'])
assert.equal(systems.list()[0].matchedEntityCount, 1)
entities.removeComponent('actor', 'dead')
assert.deepEqual(calls.at(-1), ['enter', 'actor', true])

entities.setEnabled('npc', false)
assert.deepEqual(calls.at(-1), ['exit', 'npc'])
entities.setEnabled('npc', true)
assert.deepEqual(calls.at(-1), ['enter', 'npc', true])

assert.equal(systems.setEnabled('movement', false), true)
assert.deepEqual(calls.slice(-2), [['exit', 'npc'], ['exit', 'actor']])
assert.equal(systems.setEnabled('movement', true), true)
assert.deepEqual(calls.slice(-2), [['enter', 'actor', true], ['enter', 'npc', true]])
assert.equal(systems.resetEntityFault('movement', 'actor'), false)

assert.throws(() => systems.register({
  id: 'invalid',
  requiredComponents: ['transform'],
  excludedComponents: ['transform'],
}), /cannot require and exclude/i)
assert.throws(() => systems.register({ id: '   ' }), /non-empty identifier/i)
assert.throws(() => systems.register({
  id: 'empty-component',
  requiredComponents: [''],
}), /cannot contain empty/i)

unregister()
assert.equal(systems.size, 0)
assert.equal(calls.at(-1)[0], 'exit')
systems.stop()
systems.dispose()
assert.throws(() => systems.register({ id: 'after-dispose' }), /disposed/i)

// A failure on one entity is isolated to that entity; other matching entities
// continue to be updated, and a caller may explicitly reset the fault.
const faultEntities = new EntityComponentRuntime()
faultEntities.defineComponent('active')
for (const id of ['a', 'b']) {
  faultEntities.create(id)
  faultEntities.addComponent(id, 'active', true)
}
const faultCalls = []
let failFirstEntityUpdate = true
const faultSystems = new EntitySystemRuntime(faultEntities, entityId => ({ entityId }))
const originalConsoleError = console.error
console.error = () => {}
try {
  faultSystems.register({
    id: 'fault-isolation',
    requiredComponents: ['active'],
    onEntityEnter: id => faultCalls.push(['enter', id]),
    onEntityExit: id => faultCalls.push(['exit', id]),
    updateEntity: (_dt, id) => {
      faultCalls.push(['update', id])
      if (id === 'a' && failFirstEntityUpdate) {
        failFirstEntityUpdate = false
        throw new Error('expected entity-local fault')
      }
    },
  })
  faultSystems.start()
  faultSystems.update(0.1)
  assert.deepEqual(faultCalls, [
    ['enter', 'a'], ['enter', 'b'],
    ['update', 'a'], ['exit', 'a'],
    ['update', 'b'],
  ])
  assert.equal(faultSystems.list()[0].faultedEntityCount, 1)
  assert.equal(faultSystems.resetEntityFault('fault-isolation', 'a'), true)
  assert.deepEqual(faultCalls.at(-1), ['enter', 'a'])
  faultSystems.update(0.1)
  assert.deepEqual(faultCalls.slice(-2), [['update', 'a'], ['update', 'b']])
  assert.equal(faultCalls.filter(call => call[0] === 'update' && call[1] === 'a').length, 2)
} finally {
  console.error = originalConsoleError
}
faultSystems.dispose()

// Entity cleanup callbacks are invoked while its components still exist.
const cleanupEntities = new EntityComponentRuntime()
cleanupEntities.defineComponent('marker')
cleanupEntities.create('cleanup')
cleanupEntities.addComponent('cleanup', 'marker', true)
let exitSawComponent = false
let lateSystemEnters = 0
let unregisterLateSystem
const cleanupSystems = new EntitySystemRuntime(cleanupEntities, id => ({
  hasMarker: cleanupEntities.hasComponent(id, 'marker'),
}))
cleanupSystems.register({
  id: 'cleanup-system',
  requiredComponents: ['marker'],
  onEntityExit: (_id, context) => {
    exitSawComponent = context.hasMarker
    unregisterLateSystem = cleanupSystems.register({
      id: 'registered-during-destroy',
      requiredComponents: ['marker'],
      onEntityEnter: () => { lateSystemEnters += 1 },
    })
  },
})
cleanupSystems.start()
cleanupEntities.destroy('cleanup')
assert.equal(exitSawComponent, true)
assert.equal(lateSystemEnters, 0, 'a system registered during destruction must not enter the destroying entity')
unregisterLateSystem?.()
cleanupSystems.dispose()

console.log('Entity system runtime self-test passed.')
