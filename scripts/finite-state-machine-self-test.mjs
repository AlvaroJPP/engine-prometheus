import assert from 'node:assert/strict'
import { FiniteStateMachine } from '../engine/runtime/FiniteStateMachine.ts'

const log = []
const context = { energy: 3, ticks: 0 }
const machine = new FiniteStateMachine()
  .addState('idle', { onEnter: (_ctx, previous) => log.push(['enter-idle', previous]) })
  .addState('run', {
    onEnter: (_ctx, previous) => log.push(['enter-run', previous]),
    onUpdate: (ctx, dt) => { ctx.ticks += dt },
    onExit: (_ctx, next) => log.push(['exit-run', next]),
  })
  .addState('tired', { onEnter: () => log.push(['enter-tired']) })
  .addTransition({ from: 'idle', to: 'run', guard: ctx => ctx.energy > 0 })
  .addTransition({ from: 'run', to: 'tired', guard: ctx => ctx.energy <= 0 })
machine.start('idle', context)
assert.equal(machine.transitionTo('run', context), true)
machine.update(context, 0.25)
assert.equal(context.ticks, 0.25)
context.energy = 0
assert.equal(machine.tryTransitions(context), true)
assert.equal(machine.currentState, 'tired')
assert.deepEqual(log, [['enter-idle', null], ['enter-run', 'idle'], ['exit-run', 'tired'], ['enter-tired']])
assert.equal(machine.transitionTo('idle', context), false)
machine.stop(context)
assert.equal(machine.currentState, null)
console.log('Finite state machine self-test passed.')
