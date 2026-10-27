import assert from 'node:assert/strict'
import {
  BehaviorTreeRuntime,
  validateBehaviorTree,
} from '../engine/script/BehaviorTree.ts'

{
  const calls = []
  let actionTicks = 0
  const tree = {
    id: 'root',
    type: 'sequence',
    children: [
      { id: 'ready', type: 'condition', condition: 'ready' },
      { id: 'prepare', type: 'action', action: 'prepare' },
      { id: 'work', type: 'action', action: 'work' },
    ],
  }
  const runtime = new BehaviorTreeRuntime({
    condition: name => {
      calls.push(name)
      return true
    },
    action: name => {
      calls.push(name)
      if (name === 'work' && actionTicks++ < 2) return 'running'
      return 'success'
    },
  })
  runtime.setTree(tree)
  assert.equal(runtime.tick({}, 0.016), 'running')
  assert.deepEqual(calls, ['ready', 'prepare', 'work'])
  assert.equal(runtime.tick({}, 0.016), 'running')
  assert.deepEqual(calls, ['ready', 'prepare', 'work', 'work'], 'sequence resumes at its running child')
  assert.equal(runtime.tick({}, 0.016), 'success')
  assert.deepEqual(calls, ['ready', 'prepare', 'work', 'work', 'work'])
  assert.equal(runtime.tick({}, 0.016), 'success')
  assert.equal(calls.filter(name => name === 'prepare').length, 2, 'completed sequences may start again on the next tick')
}

{
  const calls = []
  const runtime = new BehaviorTreeRuntime({
    action: name => {
      calls.push(name)
      return name === 'first' ? 'failure' : 'success'
    },
  })
  runtime.setTree({
    id: 'root-selector',
    type: 'selector',
    children: [
      { id: 'fail-first', type: 'action', action: 'first' },
      { id: 'succeed-second', type: 'action', action: 'second' },
    ],
  })
  assert.equal(runtime.tick({}, 0.016), 'success')
  assert.deepEqual(calls, ['first', 'second'])
}

{
  let finished = false
  const runtime = new BehaviorTreeRuntime({
    action: name => {
      assert.equal(name, 'after-wait')
      finished = true
      return 'success'
    },
  })
  runtime.setTree({
    id: 'wait-sequence',
    type: 'sequence',
    children: [
      { id: 'pause', type: 'wait', durationSeconds: 0.5 },
      { id: 'after', type: 'action', action: 'after-wait' },
    ],
  })
  assert.equal(runtime.tick({}, 0.2), 'running')
  assert.equal(finished, false)
  assert.equal(runtime.tick({}, 0.3), 'success')
  assert.equal(finished, true, 'sequence continues after wait completes in that tick')
}

{
  const runtime = new BehaviorTreeRuntime({
    action: name => name === 'left' ? 'success' : 'running',
  })
  runtime.setTree({
    id: 'parallel-root',
    type: 'parallel',
    successThreshold: 2,
    failureThreshold: 2,
    children: [
      { id: 'left', type: 'action', action: 'left' },
      { id: 'right', type: 'action', action: 'right' },
    ],
  })
  assert.equal(runtime.tick({}, 0.016), 'running')
  runtime.setTree({
    id: 'parallel-root-2',
    type: 'parallel',
    successThreshold: 1,
    children: [
      { id: 'success', type: 'action', action: 'left' },
      { id: 'running', type: 'action', action: 'right' },
    ],
  })
  assert.equal(runtime.tick({}, 0.016), 'success', 'parallel completes after reaching its success threshold')
}

{
  const runtime = new BehaviorTreeRuntime()
  assert.equal(runtime.hasTree(), false)
  assert.throws(() => runtime.tick({}, 0.016), /Nenhuma árvore/)
  runtime.setTree({ id: 'wait', type: 'wait', durationSeconds: 1 })
  assert.equal(runtime.hasTree(), true)
  assert.equal(runtime.tick({}, 0.25), 'running')
  runtime.reset()
  assert.equal(runtime.tick({}, 0.25), 'running', 'reset restarts wait timers')
}

assert.throws(
  () => validateBehaviorTree({
    id: 'duplicate-root',
    type: 'sequence',
    children: [
      { id: 'same', type: 'wait', durationSeconds: 0 },
      { id: 'same', type: 'action', action: 'noop' },
    ],
  }),
  /Identificador de nó duplicado/,
)
assert.throws(
  () => validateBehaviorTree({ id: 'bad-wait', type: 'wait', durationSeconds: -1 }),
  /Duração inválida/,
)
assert.throws(
  () => validateBehaviorTree({
    id: 'bad-parallel',
    type: 'parallel',
    successThreshold: 3,
    children: [{ id: 'child', type: 'wait', durationSeconds: 0 }],
  }),
  /Limite de sucesso inválido/,
)
assert.throws(
  () => validateBehaviorTree({ id: 'cycle', type: 'sequence', children: [] }).children.push(
    { id: 'cycle', type: 'wait', durationSeconds: 0 },
  ),
  /read only|Cannot add property|frozen|duplicate/i,
  'test setup mutation must not be accepted as a valid way to alter a readonly node',
)

console.log('Generic behavior tree self-test passed.')
