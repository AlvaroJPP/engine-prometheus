import assert from 'node:assert/strict'
import { GameModuleRegistry } from '../engine/runtime/GameModuleRegistry.ts'
import type { EngineGameModule, GameModuleContext } from '../engine/runtime/GameModule.ts'

const calls: string[] = []
const context = {} as GameModuleContext
const registry = new GameModuleRegistry()
const module: EngineGameModule = {
  id: 'test-game',
  onAttach: () => calls.push('attach'),
  onRuntimeStart: () => calls.push('start'),
  update: dt => calls.push(`update:${dt}`),
  onRuntimeStop: () => calls.push('stop'),
  onDispose: () => calls.push('dispose'),
}

const unregister = registry.register(module)
registry.attach(context)
registry.update(0.016)
registry.start()
registry.update(0.016)
registry.stop()
registry.update(0.016)
assert.deepEqual(calls, ['attach', 'start', 'update:0.016', 'stop'])
unregister()
assert.deepEqual(calls, ['attach', 'start', 'update:0.016', 'stop', 'dispose'])
registry.dispose()

const faultyRegistry = new GameModuleRegistry()
let badUpdates = 0
faultyRegistry.register({ id: 'bad-game', update: () => { badUpdates += 1; throw new Error('expected test failure') } })
faultyRegistry.attach(context)
faultyRegistry.start()
faultyRegistry.update(0.01)
faultyRegistry.update(0.01)
assert.equal(badUpdates, 1, 'a module that throws must not break each subsequent frame')
faultyRegistry.dispose()

console.log('Game module registry self-test passed.')
