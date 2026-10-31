#!/usr/bin/env node
/**
 * EngineCore Self-Test
 *
 * Tests EngineCore, DIContainer, EventBus, and all subsystems.
 */

import { EngineCore } from '../dist/engine/core/EngineCore.js';
import { DIContainer } from '../dist/engine/core/DIContainer.js';
import { EngineEventBus, EngineEvents } from '../dist/engine/core/EngineEventBus.js';
import { createDefaultConfig } from '../dist/engine/core/EngineConfig.js';
import { WorldSubsystem } from '../dist/engine/subsystems/WorldSubsystem.js';
import { RenderSubsystem } from '../dist/engine/subsystems/RenderSubsystem.js';
import { InputSubsystem } from '../dist/engine/subsystems/InputSubsystem.js';
import { Subsystem } from '../dist/engine/core/Subsystem.js';

console.log('='.repeat(60));
console.log('EngineCore Self-Test');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  const pass = actual === expected;
  if (pass) {
    console.log(`  ✓ ${message} (${actual})`);
    passed++;
  } else {
    console.error(`  ✗ ${message}: expected ${expected}, got ${actual}`);
    failed++;
  }
}

async function runTests() {
  // ============================================
  // Test 1: EngineConfig
  // ============================================
  console.log('\n[1] Testing EngineConfig...');

  const defaultConfig = createDefaultConfig();
  assert(defaultConfig.name === 'Prometheus Engine', 'Default config has correct name');
  assert(defaultConfig.version === '1.0.0', 'Default config has correct version');
  assert(defaultConfig.runtimeMode === 'editor', 'Default runtime mode is editor');
  assert(defaultConfig.rendering.width === 1920, 'Default width is 1920');
  assert(defaultConfig.rendering.height === 1080, 'Default height is 1080');
  assert(defaultConfig.world.gravity.y === -9.81, 'Default gravity is -9.81');

  // Test config merging
  const customConfig = createDefaultConfig({
    name: 'Test Engine',
    runtimeMode: 'play',
    rendering: { width: 800, height: 600 },
  });
  assertEqual(customConfig.name, 'Test Engine', 'Custom name applied');
  assertEqual(customConfig.runtimeMode, 'play', 'Custom runtime mode applied');
  assertEqual(customConfig.rendering.width, 800, 'Custom width applied');
  assertEqual(customConfig.rendering.height, 600, 'Custom height applied');
  // Ensure other defaults preserved
  assertEqual(customConfig.rendering.antialias, true, 'Antialias preserved');

  // ============================================
  // Test 2: DIContainer
  // ============================================
  console.log('\n[2] Testing DIContainer...');

  const container = new DIContainer();

  // Singleton registration
  container.registerSingleton('service:a', () => ({ value: 42 }));
  const a1 = container.resolve('service:a');
  const a2 = container.resolve('service:a');
  assert(a1 === a2, 'Singleton returns same instance');
  assertEqual(a1.value, 42, 'Singleton factory works');

  // Transient registration
  container.registerTransient('service:b', () => ({ id: Math.random() }));
  const b1 = container.resolve('service:b');
  const b2 = container.resolve('service:b');
  assert(b1 !== b2, 'Transient returns new instance each time');

  // Scoped registration
  container.registerScoped('service:c', () => ({ scopeId: Math.random() }));
  const scope1 = container.createScope();
  const c1 = scope1.resolve('service:c');
  const c2 = scope1.resolve('service:c');
  assert(c1 === c2, 'Scoped returns same instance within scope');

  const scope2 = container.createScope();
  const c3 = scope2.resolve('service:c');
  assert(c1 !== c3, 'Scoped returns different instance across scopes');

  // Instance registration
  const instance = { name: 'test' };
  container.registerInstance('service:instance', instance);
  assert(container.resolve('service:instance') === instance, 'Instance registration works');

  // Value registration
  container.registerValue('service:value', 'hello');
  assertEqual(container.resolve('service:value'), 'hello', 'Value registration works');

  // Parent container inheritance
  const parent = new DIContainer();
  parent.registerSingleton('service:parent', () => ({ from: 'parent' }));
  const child = new DIContainer(parent);
  assertEqual(child.resolve('service:parent').from, 'parent', 'Parent container inheritance works');

  // Child can override
  child.registerSingleton('service:parent', () => ({ from: 'child' }));
  assertEqual(child.resolve('service:parent').from, 'child', 'Child can override parent');

  // Required resolution throws
  try {
    container.resolveRequired('service:missing');
    assert(false, 'Should throw for missing required service');
  } catch (e) {
    assert(true, 'Throws for missing required service');
  }

  // Optional resolution returns undefined
  const optional = container.resolve('service:missing', { required: false });
  assert(optional === undefined, 'Optional resolution returns undefined');

  await container.dispose();

  // ============================================
  // Test 3: EngineEventBus
  // ============================================
  console.log('\n[3] Testing EngineEventBus...');

  const eventBus = new EngineEventBus();

  // Basic emit/on
  let received = false;
  let receivedData = null;
  const unsubscribe = eventBus.on('test:event', (data) => {
    received = true;
    receivedData = data;
  });

  eventBus.emit('test:event', { foo: 'bar' });
  assert(received, 'Event listener called');
  assertEqual(receivedData.foo, 'bar', 'Event data passed correctly');

  // Unsubscribe
  unsubscribe();
  received = false;
  eventBus.emit('test:event', { foo: 'baz' });
  assert(!received, 'Unsubscribed listener not called');

  // Once
  let onceCount = 0;
  eventBus.once('test:once', () => onceCount++);
  eventBus.emit('test:once');
  eventBus.emit('test:once');
  assertEqual(onceCount, 1, 'Once listener called only once');

  // Priority
  const order = [];
  eventBus.on('test:priority', () => order.push(1), { priority: 10 });
  eventBus.on('test:priority', () => order.push(2), { priority: 5 });
  eventBus.on('test:priority', () => order.push(3), { priority: 15 });
  eventBus.emit('test:priority');
  assertEqual(order.join(','), '3,1,2', 'Priority ordering works');

  // Filter
  let filtered = false;
  eventBus.on('test:filter', () => { filtered = true; }, { filter: (d) => d.value > 5 });
  eventBus.emit('test:filter', { value: 3 });
  assert(!filtered, 'Filter prevents listener call');
  eventBus.emit('test:filter', { value: 10 });
  assert(filtered, 'Filter allows listener call');

  // Async handler
  let asyncCalled = false;
  eventBus.on('test:async', async () => {
    await new Promise(r => setTimeout(r, 10));
    asyncCalled = true;
  }, { async: true });
  eventBus.emit('test:async');
  // Give async time to run
  await new Promise(r => setTimeout(r, 20));
  assert(asyncCalled, 'Async handler executed');

  // waitFor
  const waitPromise = eventBus.waitFor('test:wait', 1000);
  setTimeout(() => eventBus.emit('test:wait', { data: 'waited' }), 50);
  const waitedData = await waitPromise;
  assertEqual(waitedData.data, 'waited', 'waitFor resolves with event data');

  // waitFor timeout
  try {
    await eventBus.waitFor('test:timeout', 50);
    assert(false, 'Should timeout');
  } catch (e) {
    assert(true, 'waitFor times out correctly');
  }

  // Event history
  eventBus.emit('test:history', { seq: 1 });
  eventBus.emit('test:history', { seq: 2 });
  const history = eventBus.getHistory('test:history');
  assertEqual(history.length, 2, 'History records events');
  assertEqual(history[0].data.seq, 1, 'History order correct');

  // Listener count
  eventBus.on('test:count', () => {});
  eventBus.on('test:count', () => {});
  assertEqual(eventBus.listenerCount('test:count'), 2, 'Listener count correct');

  eventBus.dispose();

  // ============================================
  // Test 4: EngineCore
  // ============================================
  console.log('\n[4] Testing EngineCore...');

  const core = new EngineCore({
    config: { name: 'Test Engine', debug: { logging: false } }
  });

  // Initial state
  assertEqual(core.getState(), 'uninitialized', 'Initial state is uninitialized');
  assert(!core.isRunning(), 'Not running initially');
  assert(!core.isReady(), 'Not ready initially');

  // Register subsystems before init
  const worldSub = new WorldSubsystem({ name: 'world', autoCreateWorld: true, collisionLayers: [], enableTerrain: true, enableGrass: true, enableAvatar: true, enablePhysics: true });
  const renderSub = new RenderSubsystem({ name: 'render', autoCreateViewport: true, defaultCamera: 'orbit', postProcessing: false, frustumCulling: true, layers: ['Default', 'UI', 'Debug', 'PostProcess'] });
  const inputSub = new InputSubsystem({ name: 'input', defaultControlScheme: 'default', enableTransformControls: true, enableGamepad: false, controlMaps: {} });

  core.registerSubsystem(worldSub);
  core.registerSubsystem(renderSub);
  core.registerSubsystem(inputSub);

  assertEqual(core.getAllSubsystems().length, 3, 'Three subsystems registered');

  // Get subsystem
  assert(core.getSubsystem('world') === worldSub, 'Get subsystem works');
  assert(core.getSubsystem('render') === renderSub, 'Get render subsystem works');
  assert(core.getSubsystem('input') === inputSub, 'Get input subsystem works');

  // Require subsystem throws if missing
  try {
    core.requireSubsystem('missing');
    assert(false, 'Should throw for missing subsystem');
  } catch (e) {
    assert(true, 'Throws for missing required subsystem');
  }

  // Initialize
  await core.initialize();
  assertEqual(core.getState(), 'ready', 'State is ready after init');
  assert(core.isReady(), 'Is ready after init');

  // Check subsystems initialized
  assertEqual(worldSub.getState(), 'ready', 'World subsystem ready');
  assertEqual(renderSub.getState(), 'ready', 'Render subsystem ready');
  assertEqual(inputSub.getState(), 'ready', 'Input subsystem ready');

  // Start
  await core.start();
  assertEqual(core.getState(), 'running', 'State is running after start');
  assert(core.isRunning(), 'Is running after start');

  // Check subsystems running
  assertEqual(worldSub.getState(), 'running', 'World subsystem running');
  assertEqual(renderSub.getState(), 'running', 'Render subsystem running');
  assertEqual(inputSub.getState(), 'running', 'Input subsystem running');

  // Step
  await core.step(1/60);
  assert(true, 'Step executes without error');

  // Stop
  await core.stop();
  assertEqual(core.getState(), 'ready', 'State is ready after stop');
  assert(!core.isRunning(), 'Not running after stop');

  // Check subsystems stopped
  assertEqual(worldSub.getState(), 'ready', 'World subsystem ready after stop');
  assertEqual(renderSub.getState(), 'ready', 'Render subsystem ready after stop');
  assertEqual(inputSub.getState(), 'ready', 'Input subsystem ready after stop');

  // Dispose
  await core.dispose();
  assertEqual(core.getState(), 'disposed', 'State is disposed');
  assertEqual(worldSub.getState(), 'disposed', 'World subsystem disposed');
  assertEqual(renderSub.getState(), 'disposed', 'Render subsystem disposed');
  assertEqual(inputSub.getState(), 'disposed', 'Input subsystem disposed');

  // ============================================
  // Test 5: Subsystem Lifecycle
  // ============================================
  console.log('\n[5] Testing Subsystem Lifecycle...');

  const core2 = new EngineCore({ config: { debug: { logging: false } } });

  // Test dependency ordering
  class DepA extends Subsystem {
    constructor() { super({ name: 'depA', priority: 10 }); }
    async onInitialize() { this.log('DepA init'); }
    async onStart() { this.log('DepA start'); }
    async onStop() { this.log('DepA stop'); }
    async onDispose() { this.log('DepA dispose'); }
    onUpdate() {}
    onFixedUpdate() {}
    onLateUpdate() {}
    onResizeImpl() {}
    onRuntimeModeChangeImpl() {}
  }

  class DepB extends Subsystem {
    constructor() { super({ name: 'depB', priority: 5, dependencies: ['depA'] }); }
    async onInitialize() { this.log('DepB init'); }
    async onStart() { this.log('DepB start'); }
    async onStop() { this.log('DepB stop'); }
    async onDispose() { this.log('DepB dispose'); }
    onUpdate() {}
    onFixedUpdate() {}
    onLateUpdate() {}
    onResizeImpl() {}
    onRuntimeModeChangeImpl() {}
  }

  const depA = new DepA();
  const depB = new DepB();

  core2.registerSubsystem(depB); // Register B first
  core2.registerSubsystem(depA); // Register A second

  await core2.initialize();

  // Check init order (depA should be before depB due to dependency)
  const initOrder = core2['subsystemInitOrder'].map(s => s.name);
  assertEqual(initOrder.join(','), 'depA,depB', 'Dependency ordering works');

  await core2.dispose();

  // Test circular dependency detection
  const core3 = new EngineCore({ config: { debug: { logging: false } } });

  class CircularA extends Subsystem {
    constructor() { super({ name: 'circularA', dependencies: ['circularB'] }); }
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

  class CircularB extends Subsystem {
    constructor() { super({ name: 'circularB', dependencies: ['circularA'] }); }
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

  core3.registerSubsystem(new CircularA());
  core3.registerSubsystem(new CircularB());

  try {
    await core3.initialize();
    assert(false, 'Should detect circular dependency');
  } catch (e) {
    assert(e.message.includes('Circular dependency'), 'Circular dependency detected');
  }

  await core3.dispose();

  // ============================================
  // Test 6: Runtime Mode Changes
  // ============================================
  console.log('\n[6] Testing Runtime Mode Changes...');

  const core4 = new EngineCore({ config: { debug: { logging: false } } });
  core4.registerSubsystem(new WorldSubsystem({ name: 'world', autoCreateWorld: true, collisionLayers: [], enableTerrain: true, enableGrass: true, enableAvatar: true, enablePhysics: true }));
  core4.registerSubsystem(new RenderSubsystem({ name: 'render', autoCreateViewport: true, defaultCamera: 'orbit', postProcessing: false, frustumCulling: true, layers: ['Default', 'UI', 'Debug', 'PostProcess'] }));
  core4.registerSubsystem(new InputSubsystem({ name: 'input', defaultControlScheme: 'default', enableTransformControls: true, enableGamepad: false, controlMaps: {} }));

  await core4.initialize();
  await core4.start();

  // Track mode changes
  const modeChanges = [];
  core4.events.on(EngineEvents.RUNTIME_MODE_CHANGED, (data) => {
    modeChanges.push(data);
  });

  core4.setRuntimeMode('play');
  assertEqual(core4.getRuntimeMode(), 'play', 'Runtime mode changed to play');
  assertEqual(modeChanges.length, 1, 'Mode change event emitted');
  assertEqual(modeChanges[0].from, 'editor', 'From editor');
  assertEqual(modeChanges[0].to, 'play', 'To play');

  core4.setRuntimeMode('play'); // Same mode
  assertEqual(modeChanges.length, 1, 'No duplicate event for same mode');

  core4.setRuntimeMode('headless');
  assertEqual(modeChanges.length, 2, 'Second mode change event emitted');

  await core4.stop();
  await core4.dispose();

  // ============================================
  // Test 7: EngineFacade
  // ============================================
  console.log('\n[7] Testing EngineFacade...');

  const { EngineFacade } = await import('../dist/engine/core/EngineFacade.js');

  const facade = new EngineFacade({ debug: { logging: false } });

  // Check initial properties
  assert(facade.world === null, 'World initially null');
  assert(facade.viewport === null, 'Viewport initially null');
  assert(facade.input === null, 'Input initially null');
  assert(facade.keyboard === null, 'Keyboard initially null');
  assertEqual(facade.runtimeMode, 'editor', 'Default runtime mode editor');

  // Initialize
  await facade.init();
  assert(facade.initialized, 'Facade initialized');

  // Check subsystems created
  assert(facade.world !== null, 'World created after init');
  assert(facade.viewport !== null, 'Viewport created after init');
  assert(facade.input !== null, 'Input created after init');
  assert(facade.keyboard !== null, 'Keyboard created after init');

  // Start
  await facade.start();
  assert(facade.isRunning(), 'Facade running');

  // Runtime mode
  facade.setRuntimeMode('play');
  assertEqual(facade.getRuntimeMode(), 'play', 'Facade runtime mode changed');

  // Stop
  await facade.stop();
  assert(!facade.isRunning(), 'Facade stopped');

  // Dispose
  await facade.dispose();
  assert(!facade.initialized, 'Facade disposed');
  assert(facade.world === null, 'World null after dispose');

  // ============================================
  // Test 8: Integration Test
  // ============================================
  console.log('\n[8] Integration Test...');

  const core5 = new EngineCore({ config: { debug: { logging: false } } });

  // Register all subsystems
  core5.registerSubsystem(new WorldSubsystem({ name: 'world', autoCreateWorld: true, collisionLayers: [], enableTerrain: true, enableGrass: true, enableAvatar: true, enablePhysics: true }));
  core5.registerSubsystem(new RenderSubsystem({ name: 'render', autoCreateViewport: true, defaultCamera: 'orbit', postProcessing: false, frustumCulling: true, layers: ['Default', 'UI', 'Debug', 'PostProcess'] }));
  core5.registerSubsystem(new InputSubsystem({ name: 'input', defaultControlScheme: 'default', enableTransformControls: true, enableGamepad: false, controlMaps: {} }));

  // Full lifecycle
  await core5.initialize();
  assert(core5.isReady(), 'Core ready after init');

  await core5.start();
  assert(core5.isRunning(), 'Core running after start');

  // Simulate a few frames
  for (let i = 0; i < 3; i++) {
    await core5.step(1/60);
  }
  assert(true, 'Multiple steps work');

  // Resize
  core5.onResize(1920, 1080);
  assert(true, 'Resize works');

  await core5.stop();
  assert(core5.isReady(), 'Core ready after stop');

  await core5.dispose();
  assertEqual(core5.getState(), 'disposed', 'Core disposed');

  // ============================================
  // Summary
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exitCode = 1;
});