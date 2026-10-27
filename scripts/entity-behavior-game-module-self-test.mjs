import assert from 'node:assert/strict'
import { EntityComponentRuntime } from '../engine/runtime/EntityComponentRuntime.ts'
import { EntityBehaviorRuntime } from '../engine/runtime/EntityBehaviorRuntime.ts'
import { createEntityBehaviorGameModule } from '../engine/runtime/EntityBehaviorGameModule.ts'
import { GameModuleRegistry } from '../engine/runtime/GameModuleRegistry.ts'

const entities = new EntityComponentRuntime()
entities.create('actor')
const calls = []
const behaviorRuntime = new EntityBehaviorRuntime(entities, entityId => ({ entityId }))
behaviorRuntime.add('actor', {
  id: 'run-loop',
  onAttach: context => calls.push(`attach:${context.entityId}`),
  onStart: context => calls.push(`start:${context.entityId}`),
  update: (dt, context) => calls.push(`update:${dt}:${context.entityId}`),
  onStop: context => calls.push(`stop:${context.entityId}`),
  onDetach: context => calls.push(`detach:${context.entityId}`),
})

assert.throws(() => createEntityBehaviorGameModule('  ', behaviorRuntime), /non-empty identifier/i)
const registry = new GameModuleRegistry()
const unregister = registry.register(createEntityBehaviorGameModule('entity-behaviors', behaviorRuntime))
registry.attach({})
registry.start()
registry.update(0.25)
registry.stop()
assert.deepEqual(calls, [
  'attach:actor',
  'start:actor',
  'update:0.25:actor',
  'stop:actor',
])
unregister()
assert.deepEqual(calls, [
  'attach:actor',
  'start:actor',
  'update:0.25:actor',
  'stop:actor',
  'detach:actor',
])
registry.dispose()
assert.equal(behaviorRuntime.size, 0)
console.log('Entity behavior game-module adapter self-test passed.')
