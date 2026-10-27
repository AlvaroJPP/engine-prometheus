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

// A falha no meio de onAttach ainda precisa permitir a limpeza dos recursos
// que o módulo já criou antes de lançar a exceção.
const partialAttachRegistry = new GameModuleRegistry()
const partialAttachCalls = []
const previousConsoleError = console.error
console.error = () => {}
try {
  partialAttachRegistry.register({
    id: 'partial-attach-game',
    onAttach: () => {
      partialAttachCalls.push('attach-started')
      throw new Error('expected partial attach failure')
    },
    onRuntimeStart: () => partialAttachCalls.push('start'),
    onDispose: () => partialAttachCalls.push('dispose'),
  })
  partialAttachRegistry.attach(context)
  partialAttachRegistry.start()
  assert.deepEqual(partialAttachCalls, ['attach-started'])
  partialAttachRegistry.dispose()
  assert.deepEqual(
    partialAttachCalls,
    ['attach-started', 'dispose'],
    'onDispose deve ser chamado quando onAttach falha parcialmente',
  )
} finally {
  console.error = previousConsoleError
}

// A falha em onRuntimeStart não deve deixar o módulo ativo, mas deve liberar
// os recursos criados durante onAttach quando o registro for descartado.
const failedStartRegistry = new GameModuleRegistry()
const failedStartCalls = []
console.error = () => {}
try {
  failedStartRegistry.register({
    id: 'failed-start-game',
    onAttach: () => failedStartCalls.push('attach'),
    onRuntimeStart: () => {
      failedStartCalls.push('start')
      throw new Error('expected runtime start failure')
    },
    update: () => failedStartCalls.push('update'),
    onRuntimeStop: () => failedStartCalls.push('stop'),
    onDispose: () => failedStartCalls.push('dispose'),
  })
  failedStartRegistry.attach(context)
  failedStartRegistry.start()
  failedStartRegistry.update(0.016)
  assert.deepEqual(failedStartCalls, ['attach', 'start'])
  failedStartRegistry.dispose()
  assert.deepEqual(
    failedStartCalls,
    ['attach', 'start', 'dispose'],
    'módulos que falham ao iniciar não devem atualizar nem receber stop, mas precisam de dispose',
  )
} finally {
  console.error = previousConsoleError
}

console.log('Game module registry self-test passed.')
