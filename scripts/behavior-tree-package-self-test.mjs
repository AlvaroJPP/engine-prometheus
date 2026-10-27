import assert from 'node:assert/strict'
import { BehaviorTreePackageSystem } from '../engine/script/BehaviorTreePackageSystem.ts'

const makeInstance = (id, tree, overrides = {}) => ({
  id,
  packageId: 'custom_behavior',
  ownerObjectId: `object-${id}`,
  enabled: true,
  variables: {},
  config: { behaviorTree: tree },
  ...overrides,
})

{
  const calls = []
  const system = new BehaviorTreePackageSystem()
  const instance = makeInstance('npc', {
    id: 'root',
    type: 'sequence',
    children: [
      { id: 'wait', type: 'wait', durationSeconds: 0.2 },
      { id: 'talk', type: 'action', action: 'talk' },
    ],
  })
  const handlersFor = () => ({
    action: name => {
      calls.push(name)
      return 'success'
    },
  })

  const first = system.update({
    instances: [instance], context: {}, dt: 0.1, runtimeEnabled: true, handlersFor,
  })
  assert.equal(instance.variables.behavior_tree_status, 'running')
  assert.deepEqual(first.map(item => [item.previousStatus, item.status]), [['none', 'running']])
  assert.equal(system.hasRuntime('npc'), true)

  const second = system.update({
    instances: [instance], context: {}, dt: 0.1, runtimeEnabled: true, handlersFor,
  })
  assert.equal(instance.variables.behavior_tree_status, 'success')
  assert.deepEqual(second.map(item => [item.previousStatus, item.status]), [['running', 'success']])
  assert.deepEqual(calls, ['talk'])
  assert.equal(system.update({
    instances: [instance], context: {}, dt: 0.1, runtimeEnabled: true, handlersFor,
  }).length, 1, 'completed root status transitions when a fresh execution starts')
}

{
  const system = new BehaviorTreePackageSystem()
  const instance = makeInstance('broken', { id: 'bad', type: 'teleport' })
  assert.throws(() => system.update({
    instances: [instance], context: {}, dt: 0.1, runtimeEnabled: true, handlersFor: () => ({}),
  }), /Tipo de nó desconhecido/)
}

{
  const system = new BehaviorTreePackageSystem()
  const instance = makeInstance('disabled', {
    id: 'root', type: 'wait', durationSeconds: 1,
  }, { enabled: false })
  assert.deepEqual(system.update({
    instances: [instance], context: {}, dt: 0.1, runtimeEnabled: true, handlersFor: () => ({}),
  }), [])
  assert.equal(system.hasRuntime('disabled'), false)
  assert.equal('behavior_tree_status' in instance.variables, false)
}

{
  const system = new BehaviorTreePackageSystem()
  const instance = makeInstance('replace', { id: 'old', type: 'wait', durationSeconds: 10 })
  const update = (dt) => system.update({
    instances: [instance], context: {}, dt, runtimeEnabled: true, handlersFor: () => ({}),
  })
  update(1)
  instance.config.behaviorTree = { id: 'new', type: 'wait', durationSeconds: 0 }
  update(0)
  assert.equal(instance.variables.behavior_tree_status, 'success', 'changed serialized trees replace prior runtime state')
}

{
  const system = new BehaviorTreePackageSystem()
  const instance = makeInstance('removed', { id: 'root', type: 'wait', durationSeconds: 10 })
  system.update({
    instances: [instance], context: {}, dt: 0.1, runtimeEnabled: true, handlersFor: () => ({}),
  })
  assert.equal(system.hasRuntime('removed'), true)
  system.update({
    instances: [], context: {}, dt: 0.1, runtimeEnabled: true, handlersFor: () => ({}),
  })
  assert.equal(system.hasRuntime('removed'), false)
  system.update({
    instances: [instance], context: {}, dt: 0.1, runtimeEnabled: false, handlersFor: () => ({}),
  })
  assert.equal(system.hasRuntime('removed'), false)
}

console.log('Behavior tree package system self-test passed.')
