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

// Registro reentrante durante onRuntimeStart deve iniciar o módulo novo apenas uma vez.
const reentrantStartRegistry = new GameModuleRegistry()
const reentrantStartCalls = []
let unregisterNested = null
reentrantStartRegistry.register({
  id: 'parent-start-registration',
  onRuntimeStart: () => {
    reentrantStartCalls.push('parent-start')
    unregisterNested = reentrantStartRegistry.register({
      id: 'nested-start-registration',
      onAttach: () => reentrantStartCalls.push('nested-attach'),
      onRuntimeStart: () => reentrantStartCalls.push('nested-start'),
      onRuntimeStop: () => reentrantStartCalls.push('nested-stop'),
      onDispose: () => reentrantStartCalls.push('nested-dispose'),
    })
  },
})
reentrantStartRegistry.attach(context)
reentrantStartRegistry.start()
assert.deepEqual(
  reentrantStartCalls,
  ['parent-start', 'nested-attach', 'nested-start'],
  'um módulo registrado durante start deve ser iniciado exatamente uma vez',
)
reentrantStartRegistry.stop()
unregisterNested?.()
reentrantStartRegistry.dispose()

// Registro criado durante onRuntimeStop não pode ser iniciado num runtime que está encerrando.
const reentrantStopRegistry = new GameModuleRegistry()
const reentrantStopCalls = []
let unregisterLateStop = null
reentrantStopRegistry.register({
  id: 'parent-stop-registration',
  onRuntimeStart: () => reentrantStopCalls.push('parent-start'),
  onRuntimeStop: () => {
    reentrantStopCalls.push('parent-stop')
    unregisterLateStop = reentrantStopRegistry.register({
      id: 'late-stop-registration',
      onAttach: () => reentrantStopCalls.push('late-attach'),
      onRuntimeStart: () => reentrantStopCalls.push('late-start'),
      onRuntimeStop: () => reentrantStopCalls.push('late-stop'),
      onDispose: () => reentrantStopCalls.push('late-dispose'),
    })
  },
})
reentrantStopRegistry.attach(context)
reentrantStopRegistry.start()
reentrantStopRegistry.stop()
assert.deepEqual(
  reentrantStopCalls,
  ['parent-start', 'parent-stop', 'late-attach'],
  'um módulo criado durante stop deve ser anexado sem iniciar no runtime encerrado',
)
unregisterLateStop?.()
reentrantStopRegistry.dispose()

// Se um módulo encerrar o runtime dentro de onRuntimeStart, a inicialização
// deve parar e o módulo parcialmente iniciado precisa receber onRuntimeStop.
const stopDuringStartRegistry = new GameModuleRegistry()
const stopDuringStartCalls = []
stopDuringStartRegistry.register({
  id: 'stop-during-start',
  onRuntimeStart: () => {
    stopDuringStartCalls.push('first-start')
    stopDuringStartRegistry.stop()
  },
  onRuntimeStop: () => stopDuringStartCalls.push('first-stop'),
})
stopDuringStartRegistry.register({
  id: 'must-not-start-after-stop',
  onRuntimeStart: () => stopDuringStartCalls.push('second-start'),
})
stopDuringStartRegistry.attach(context)
stopDuringStartRegistry.start()
assert.deepEqual(
  stopDuringStartCalls,
  ['first-start', 'first-stop'],
  'start deve interromper a iteração quando um callback encerra o runtime',
)
stopDuringStartRegistry.dispose()

// Um módulo que se remove durante onRuntimeStart não pode voltar a ser
// marcado como ativo depois de onDispose.
const selfRemovingRegistry = new GameModuleRegistry()
const selfRemovingCalls = []
let unregisterSelf = null
unregisterSelf = selfRemovingRegistry.register({
  id: 'self-removing-module',
  onRuntimeStart: () => {
    selfRemovingCalls.push('start')
    unregisterSelf?.()
  },
  onRuntimeStop: () => selfRemovingCalls.push('stop'),
  onDispose: () => selfRemovingCalls.push('dispose'),
})
selfRemovingRegistry.attach(context)
selfRemovingRegistry.start()
assert.deepEqual(
  selfRemovingCalls,
  ['start', 'dispose'],
  'um módulo removido durante a inicialização não deve ser reativado nem receber stop',
)
selfRemovingRegistry.stop()
selfRemovingRegistry.dispose()
assert.deepEqual(selfRemovingCalls, ['start', 'dispose'])

// Registro dinâmico que encerra o runtime durante onRuntimeStart precisa
// receber onRuntimeStop e não pode deixar módulos seguintes ativos.
const dynamicStopRegistry = new GameModuleRegistry()
const dynamicStopCalls = []
dynamicStopRegistry.attach(context)
dynamicStopRegistry.start()
const unregisterDynamicStop = dynamicStopRegistry.register({
  id: 'dynamic-stop-during-start',
  onRuntimeStart: () => {
    dynamicStopCalls.push('start')
    dynamicStopRegistry.stop()
  },
  onRuntimeStop: () => dynamicStopCalls.push('stop'),
  update: () => dynamicStopCalls.push('update'),
})
assert.deepEqual(dynamicStopCalls, ['start', 'stop'])
dynamicStopRegistry.update(0.016)
assert.deepEqual(dynamicStopCalls, ['start', 'stop'])
unregisterDynamicStop()
dynamicStopRegistry.dispose()

// Um módulo registrado dinamicamente pode se remover dentro de onRuntimeStart.
// Ele deve ser descartado uma vez e nunca marcado como ativo.
const dynamicSelfRemoveRegistry = new GameModuleRegistry()
const dynamicSelfRemoveCalls = []
let unregisterDynamicSelf = null
dynamicSelfRemoveRegistry.attach(context)
dynamicSelfRemoveRegistry.start()
unregisterDynamicSelf = dynamicSelfRemoveRegistry.register({
  id: 'dynamic-self-removing-module',
  onRuntimeStart: () => {
    dynamicSelfRemoveCalls.push('start')
    // The disposer is returned only after register() completes, so exercise
    // reentrant self-removal through the registry's public unregister API.
    dynamicSelfRemoveRegistry.unregister('dynamic-self-removing-module')
  },
  onRuntimeStop: () => dynamicSelfRemoveCalls.push('stop'),
  onDispose: () => dynamicSelfRemoveCalls.push('dispose'),
  update: () => dynamicSelfRemoveCalls.push('update'),
})
assert.deepEqual(dynamicSelfRemoveCalls, ['start', 'dispose'])
dynamicSelfRemoveRegistry.update(0.016)
assert.deepEqual(dynamicSelfRemoveCalls, ['start', 'dispose'])
dynamicSelfRemoveRegistry.stop()
dynamicSelfRemoveRegistry.dispose()
assert.deepEqual(dynamicSelfRemoveCalls, ['start', 'dispose'])

console.log('Game module registry self-test passed.')
