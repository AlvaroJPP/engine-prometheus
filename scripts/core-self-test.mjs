import assert from 'node:assert/strict'
import { DIContainer, InjectionToken, createToken } from '../engine/core/DIContainer.ts'
import { createEngineEventBus, EngineEvents } from '../engine/core/EngineEvents.ts'
import { createSubsystemToken, KnownSubsystems, isSubsystem, isSubsystemWithAPI } from '../engine/core/Subsystem.ts'

// ============ DIContainer Tests ============

console.log('Testing DIContainer...')

const container = new DIContainer()

// Test InjectionToken
const TestToken = new InjectionToken('test.token')
assert.equal(TestToken.name, 'test.token')
assert.equal(TestToken.toString(), 'InjectionToken(test.token)')

// Test createToken helper
const HelperToken = createToken('helper.token')
assert(HelperToken instanceof InjectionToken)
assert.equal(HelperToken.name, 'helper.token')

// Test register/resolve transient
container.register(TestToken, () => ({ value: 'transient' }))
const resolved1 = container.resolve(TestToken)
const resolved2 = container.resolve(TestToken)
assert.equal(resolved1.value, 'transient')
assert.equal(resolved2.value, 'transient')
assert.notStrictEqual(resolved1, resolved2) // new instance each time

// Test registerSingleton
const SingletonToken = createToken('singleton.token')
let factoryCalls = 0
container.registerSingleton(SingletonToken, () => {
  factoryCalls++
  return { value: factoryCalls }
})
const single1 = container.resolve(SingletonToken)
const single2 = container.resolve(SingletonToken)
assert.equal(factoryCalls, 1) // factory called only once
assert.strictEqual(single1, single2) // same instance
assert.equal(single1.value, 1)

// Test registerInstance
const InstanceToken = createToken('instance.token')
container.registerInstance(InstanceToken, 'pre-existing')
assert.equal(container.resolve(InstanceToken), 'pre-existing')

// Test tryResolve
assert.deepEqual(container.tryResolve(TestToken), { value: 'transient' })
assert.equal(container.tryResolve(createToken('non-existent')), undefined)

// Test has
assert.equal(container.has(TestToken), true)
assert.equal(container.has(createToken('non-existent')), false)

// Test createChild
const child = container.createChild()
child.register(TestToken, () => 'child-value')
assert.equal(child.resolve(TestToken), 'child-value')
assert.deepEqual(container.resolve(TestToken), { value: 'transient' }) // parent unchanged

// Test delete
assert.equal(container.delete(TestToken), true)
assert.equal(container.has(TestToken), false)
assert.equal(container.delete(TestToken), false) // already deleted

// Test clear
container.clear()
assert.equal(container.has(SingletonToken), false)
assert.equal(container.has(InstanceToken), false)

console.log('DIContainer tests passed!')

// ============ EngineEvents Tests ============

console.log('Testing EngineEvents...')

// Test EngineEvents constants
assert.equal(EngineEvents.ENGINE_INIT, 'engine:init')
assert.equal(EngineEvents.MODULE_STARTED, 'module:started')
assert.equal(EngineEvents.INPUT_KEYBOARD, 'input:keyboard')
assert.equal(EngineEvents.SCRIPT_TRIGGER, 'script:trigger')
assert.equal(EngineEvents.OBJECT_ADDED, 'object:added')
assert.equal(EngineEvents.CAMERA_CHANGED, 'camera:changed')
assert.equal(EngineEvents.DEBUG_LOG, 'debug:log')

// Test createEngineEventBus (async)
const bus = await createEngineEventBus()
assert(typeof bus.on === 'function')
assert(typeof bus.once === 'function')
assert(typeof bus.emit === 'function')
assert(typeof bus.listenerCount === 'function')
assert(typeof bus.clear === 'function')

// Test event bus basic functionality
let received = false
const unsub = bus.on('engine:init', () => { received = true })
bus.emit('engine:init', { timestamp: Date.now() })
assert.equal(received, true)
unsub()
received = false
bus.emit('engine:init', { timestamp: Date.now() })
assert.equal(received, false) // unsubscribed

console.log('EngineEvents tests passed!')

// ============ Subsystem Tests ============

console.log('Testing Subsystem...')

// Test createSubsystemToken
const PhysicsToken = createSubsystemToken('physics')
assert(PhysicsToken instanceof InjectionToken)
assert.equal(PhysicsToken.name, 'subsystem.physics')

// Test KnownSubsystems
assert.equal(KnownSubsystems.PHYSICS, 'physics')
assert.equal(KnownSubsystems.RENDER, 'render')
assert.equal(KnownSubsystems.INPUT, 'input')
assert.equal(KnownSubsystems.SCRIPTING, 'scripting')

// Test isSubsystem type guard
const validSubsystem = {
  name: 'test',
  dependencies: [],
  async initialize() {},
  async start() {},
  async stop() {},
  async dispose() {},
}
assert.equal(isSubsystem(validSubsystem), true)
assert.equal(isSubsystem({}), false)
assert.equal(isSubsystem(null), false)
assert.equal(isSubsystem('string'), false)
assert.equal(isSubsystem({ name: 'test' }), false) // missing methods

// Test isSubsystemWithAPI
const subsystemWithApi = {
  ...validSubsystem,
  api: { doSomething: () => {} },
}
assert.equal(isSubsystemWithAPI(subsystemWithApi), true)
assert.equal(isSubsystemWithAPI(validSubsystem), false)

console.log('Subsystem tests passed!')

console.log('\nAll self-tests passed!')