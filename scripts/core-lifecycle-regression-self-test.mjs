import assert from 'node:assert/strict'
import { DIContainer } from '../engine/core/DIContainer.ts'
import { EngineCore } from '../engine/core/EngineCore.ts'
import { EngineEventBus } from '../engine/core/EngineEventBus.ts'

const bus = new EngineEventBus()
let wildcardCalls = 0
bus.onAny(() => { wildcardCalls += 1 }, { once: true })
bus.emit('first', {})
bus.emit('second', {})
assert.equal(wildcardCalls, 1, 'wildcard once-listener is removed from the wildcard channel')

await assert.rejects(bus.waitFor('never', 5), /Timeout waiting for event/)
assert.equal(bus.listenerCount('never'), 0, 'waitFor removes its listener after timeout')

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

bus.dispose()
console.log('Core lifecycle regression self-test passed.')
