import assert from 'node:assert/strict'
import { DIContainer } from '../engine/core/DIContainer.ts'
import { EngineCore } from '../engine/core/EngineCore.ts'
import { EngineEventBus } from '../engine/core/EngineEventBus.ts'

const bus = new EngineEventBus()
const wildcardEvents = []
bus.onAny(event => wildcardEvents.push(event), { once: true })
bus.emit('first', { value: 1 })
bus.emit('second', { value: 2 })
assert.deepEqual(wildcardEvents, [{ name: 'first', data: { value: 1 } }], 'wildcard listener receives event name and payload and is removed once')
assert.equal(bus.listenerCount('*'), 0, 'wildcard listener count is accurate')

await assert.rejects(bus.waitFor('never', 5), /Timeout waiting for event/)
assert.equal(bus.listenerCount('never'), 0, 'waitFor removes its listener after timeout')

const removalBus = new EngineEventBus()
const removalCalls = []
removalBus.on('remove-all', () => {
  removalCalls.push('first')
  removalBus.offAll('remove-all')
})
removalBus.on('remove-all', () => removalCalls.push('second'))
removalBus.emit('remove-all', {})
removalBus.emit('remove-all', {})
assert.deepEqual(removalCalls, ['first'], 'offAll called during dispatch prevents remaining listeners from firing')

const parent = new DIContainer()
let scopedDisposals = 0
parent.registerScoped('scoped-service', () => ({
  dispose() { scopedDisposals += 1 },
}))
const scope = parent.createScope()
const scopedA = scope.resolve('scoped-service')
assert.equal(scope.resolve('scoped-service'), scopedA, 'scoped services are stable within a scope')
await scope.dispose()
assert.equal(scopedDisposals, 1, 'disposing a scope disposes its scoped services')
assert.equal(parent.resolve('scoped-service') === scopedA, false, 'scope disposal does not pollute the parent')

const root = new DIContainer()
let inheritedFactoryCalls = 0
root.registerScoped('deep-scoped', () => ({ id: ++inheritedFactoryCalls }))
const middle = root.createChild()
const leaf = middle.createScope()
const deepOne = leaf.resolve('deep-scoped')
assert.equal(leaf.resolve('deep-scoped'), deepOne, 'nested scopes reuse scoped services inherited from an ancestor')
await leaf.dispose()
assert.equal(inheritedFactoryCalls, 1, 'nested inherited scope factory runs once')

let borrowedDisposed = false
const borrowed = { dispose() { borrowedDisposed = true } }
const valueContainer = new DIContainer()
valueContainer.registerValue('borrowed', borrowed)
await valueContainer.dispose()
assert.equal(borrowedDisposed, false, 'registered values are not disposed by the container')

const core = new EngineCore({ config: { debug: { logging: false } } })
let disposeEventReceived = false
core.events.once('engine:dispose', () => { disposeEventReceived = true })
await core.dispose()
assert.equal(disposeEventReceived, true, 'EngineCore emits dispose before releasing its event bus')

const missingDependencyCore = new EngineCore({ config: { debug: { logging: false } } })
class DependentSubsystem extends (await import('../engine/core/Subsystem.ts')).Subsystem {
  constructor() { super({ name: 'dependent', dependencies: ['missing-service'] }) }
  async onInitialize() {}
  async onStart() {}
  async onStop() {}
  async onDispose() {}
  onUpdate() {}
  onFixedUpdate() {}
  onLateUpdate() {}
  onResizeImpl() {}
  onRuntimeModeChangeImpl() {}
}
missingDependencyCore.registerSubsystem(new DependentSubsystem())
await assert.rejects(missingDependencyCore.initialize(), /Missing required dependency/)
await missingDependencyCore.dispose()

const rollbackCore = new EngineCore({ config: { debug: { logging: false } } })
const rollbackEvents = []
class InitializingSubsystem extends (await import('../engine/core/Subsystem.ts')).Subsystem {
  constructor(name, shouldFail = false) {
    super({ name })
    this.shouldFail = shouldFail
  }
  async onInitialize() {
    rollbackEvents.push(`initialize:${this.name}`)
    if (this.shouldFail) throw new Error('intentional initialization failure')
  }
  async onDispose() { rollbackEvents.push(`dispose:${this.name}`) }
}
rollbackCore.registerSubsystem(new InitializingSubsystem('ready-first'))
rollbackCore.registerSubsystem(new InitializingSubsystem('fails-second', true))
await assert.rejects(rollbackCore.initialize(), /intentional initialization failure/)
assert.deepEqual(rollbackEvents, [
  'initialize:ready-first',
  'initialize:fails-second',
  'dispose:fails-second',
  'dispose:ready-first',
], 'initialization rollback disposes the failing subsystem and previously initialized subsystems')
await rollbackCore.dispose()

bus.dispose()
console.log('Core lifecycle regression self-test passed.')
