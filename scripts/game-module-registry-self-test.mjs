import assert from 'node:assert/strict'
import { GameModuleRegistry } from '../engine/runtime/GameModuleRegistry.ts'

const calls = []
const context = {}
const registry = new GameModuleRegistry()
const module = {
  id: 'test-game',
  onAttach: () => calls.push('attach'),
  onRuntimeStart: () => calls.push('start'),
  onKeyDown: (event) => { calls.push(`keydown:${event.code}`); return true },
  onKeyUp: (event) => calls.push(`keyup:${event.code}`),
  onInputBlur: () => calls.push('blur'),
  update: (dt) => calls.push(`update:${dt}`),
  onRuntimeStop: () => calls.push('stop'),
  onDispose: () => calls.push('dispose'),
}

const unregister = registry.register(module)
registry.attach(context)
registry.update(0.016)
registry.start()
assert.equal(registry.dispatchKeyDown({ code: 'Space' }), true)
registry.dispatchKeyUp({ code: 'Space' })
registry.dispatchInputBlur()
registry.update(0.016)
registry.stop()
registry.update(0.016)
assert.deepEqual(calls, ['attach', 'start', 'keydown:Space', 'keyup:Space', 'blur', 'update:0.016', 'stop'])
unregister()
assert.deepEqual(calls, ['attach', 'start', 'keydown:Space', 'keyup:Space', 'blur', 'update:0.016', 'stop', 'dispose'])
registry.dispose()

// Registering a game after the editor/runtime registry is attached must attach
// it immediately and start it immediately when Run is already active.
const dynamicRegistry = new GameModuleRegistry()
const dynamicCalls = []
dynamicRegistry.attach(context)
dynamicRegistry.start()
const unregisterDynamic = dynamicRegistry.register({
  id: 'late-game',
  onAttach: () => dynamicCalls.push('attach'),
  onRuntimeStart: () => dynamicCalls.push('start'),
  update: () => dynamicCalls.push('update'),
  onRuntimeStop: () => dynamicCalls.push('stop'),
  onDispose: () => dynamicCalls.push('dispose'),
})
assert.deepEqual(dynamicCalls, ['attach', 'start'])
dynamicRegistry.update(0.016)
assert.deepEqual(dynamicCalls, ['attach', 'start', 'update'])
unregisterDynamic()
assert.deepEqual(dynamicCalls, ['attach', 'start', 'update', 'stop', 'dispose'])
dynamicRegistry.dispose()

const faultyRegistry = new GameModuleRegistry()
let badUpdates = 0
const originalConsoleError = console.error
console.error = () => {}
try {
  faultyRegistry.register({ id: 'bad-game', update: () => { badUpdates += 1; throw new Error('expected test failure') } })
  faultyRegistry.attach(context)
  faultyRegistry.start()
  faultyRegistry.update(0.01)
  faultyRegistry.update(0.01)
  assert.equal(badUpdates, 1, 'a module that throws must not break each subsequent frame')
  faultyRegistry.dispose()
} finally {
  console.error = originalConsoleError
}

console.log('Game module registry self-test passed.')
