import assert from 'node:assert/strict'
import { BehaviorTreeRuntime } from '../engine/script/BehaviorTree.ts'
import { BehaviorTreeHandlerRegistry } from '../engine/script/BehaviorTreeHandlerRegistry.ts'

const registry = new BehaviorTreeHandlerRegistry()
const context = { stamina: 3, activated: false }
const dispose = registry.registerNamespace('player', {
  conditions: {
    has_stamina: (params, ctx) => ctx.stamina >= (params.minimum ?? 1),
  },
  actions: {
    spend_stamina: (params, ctx) => {
      const amount = params.amount ?? 1
      if (typeof amount !== 'number' || amount <= 0 || ctx.stamina < amount) return 'failure'
      ctx.stamina -= amount
      return 'success'
    },
    activate: (_params, ctx) => { ctx.activated = true; return 'success' },
  },
})
const runtime = new BehaviorTreeRuntime(registry.createHandlers())
runtime.setTree({
  id: 'root',
  type: 'sequence',
  children: [
    { id: 'has-stamina', type: 'condition', condition: 'player:has_stamina', parameters: { minimum: 2 } },
    { id: 'spend', type: 'action', action: 'player:spend_stamina', parameters: { amount: 2 } },
    { id: 'activate', type: 'action', action: 'player:activate' },
  ],
})
assert.equal(runtime.tick(context, 0.016), 'success')
assert.deepEqual(context, { stamina: 1, activated: true })
assert.equal(registry.conditionCount, 1)
assert.equal(registry.actionCount, 2)
assert.throws(() => registry.registerAction('player:activate', () => 'success'), /already registered/)
dispose()
assert.equal(registry.conditionCount, 0)
assert.equal(registry.actionCount, 0)
assert.equal(runtime.tick(context, 0.016), 'failure', 'unregistered nodes fail safely')
const previous = registry.registerAction('test', () => 'success')
registry.registerAction('test', () => 'failure', true)
previous()
assert.equal(registry.createHandlers().action('test', {}, context), 'failure', 'old disposer must not unregister replacement')
console.log('Behavior tree handler registry self-test passed.')
