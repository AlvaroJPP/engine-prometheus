/**
 * EngineCore - Minimal Engine Nucleus
 *
 * Core engine functionality: lifecycle, DI container, event bus, subsystem management.
 * Does NOT replace Engine.ts - that's done by EngineFacade.
 */

import { DIContainer } from './DIContainer.js';
import { EngineEventBus, EngineEventMap, EngineEvents } from './EngineEventBus.js';
import { Subsystem, SubsystemState, SubsystemConfig, SubsystemContext } from './Subsystem.js';
import { EngineConfig, createDefaultConfig, RuntimeMode } from './EngineConfig.js';

export interface EngineCoreOptions {
  /** Configuration overrides */
  config?: Partial<EngineConfig>;

  /** Parent DI container (for testing/embedding) */
  parentContainer?: DIContainer;

  /** Parent event bus (for testing/embedding) */
  parentEvents?: EngineEventBus<EngineEventMap>;
}

export class EngineCore {
  public readonly container: DIContainer;
  public readonly events: EngineEventBus<EngineEventMap>;
  public readonly subsystems: Map<string, Subsystem> = new Map();
  public readonly config: EngineConfig;

  private state: 'uninitialized' | 'initializing' | 'ready' | 'running' | 'stopping' | 'disposed' | 'error' = 'uninitialized';
  private error: Error | null = null;
  private frameId = 0;
  private lastTime = 0;
  private animationFrameId: number | null = null;
  private fixedTimestepAccumulator = 0;
  private subsystemInitOrder: Subsystem[] = [];

  constructor(options: EngineCoreOptions = {}) {
    // Create config
    this.config = createDefaultConfig(options.config);

    // Create DI container
    this.container = options.parentContainer || new DIContainer();

    // Create event bus
    this.events = options.parentEvents || new EngineEventBus<EngineEventMap>();

    // Register core services
    this.registerCoreServices();
  }

  /**
   * Register core engine services in DI container
   */
  private registerCoreServices(): void {
    // Don't register engine:core to avoid circular disposal
    // The engine is available via SubsystemContext.engine
    this.container.registerInstance('engine:config', this.config);
    this.container.registerInstance('engine:events', this.events);
    // Note: Don't register container in itself to avoid circular disposal
  }

  /**
   * Register cross-cutting engine services (singletons)
   * Called by EngineFacade after creating engine-specific services
   */
  registerEngineServices(services: Record<string, any>): void {
    for (const [token, instance] of Object.entries(services)) {
      this.container.registerInstance(token, instance);
    }
  }

  /**
   * Get current engine state
   */
  getState(): typeof this.state {
    return this.state;
  }

  /**
   * Check if engine is running
   */
  isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * Check if engine is ready
   */
  isReady(): boolean {
    return this.state === 'ready' || this.state === 'running';
  }

  /**
   * Get last error
   */
  getError(): Error | null {
    return this.error;
  }

  /**
   * Get current runtime mode
   */
  getRuntimeMode(): RuntimeMode {
    return this.config.runtimeMode;
  }

  /**
   * Set runtime mode
   */
  setRuntimeMode(mode: RuntimeMode): void {
    const from = this.config.runtimeMode;
    if (from === mode) return;

    this.config.runtimeMode = mode;
    this.events.emit(EngineEvents.RUNTIME_MODE_CHANGED, { from, to: mode });

    // Notify subsystems
    for (const subsystem of this.subsystems.values()) {
      subsystem.onRuntimeModeChange(from, mode);
    }
  }

  /**
   * Initialize engine and all subsystems
   */
  async initialize(): Promise<void> {
    if (this.state !== 'uninitialized') {
      throw new Error(`Engine already initialized (state: ${this.state})`);
    }

    this.state = 'initializing';
    this.error = null;

    try {
      this.log('Initializing engine...');

      // Create subsystem context
      const context: SubsystemContext = {
        config: this.config,
        container: this.container,
        events: this.events,
        engine: this,
      };

      // Sort subsystems by priority and dependencies
      this.subsystemInitOrder = this.resolveInitOrder();

      // Initialize all subsystems
      for (const subsystem of this.subsystemInitOrder) {
        if (subsystem.getState() === 'uninitialized') {
          await subsystem.initialize(context);
        }
      }

      this.state = 'ready';
      this.events.emit(EngineEvents.INIT, { timestamp: Date.now() });
      this.log('Engine initialized');

    } catch (error) {
      const err = error as Error;
      this.error = err;
      this.state = 'error';
      this.events.emit(EngineEvents.ERROR, { error: err, timestamp: Date.now() });
      this.logError('Initialization failed', err);
      throw error;
    }
  }

  /**
   * Start engine (begin render loop)
   */
  async start(): Promise<void> {
    if (!this.isReady()) {
      throw new Error(`Engine not ready (state: ${this.state})`);
    }

    if (this.state === 'running') {
      this.log('Already running');
      return;
    }

    try {
      this.log('Starting engine...');

      // Start all subsystems
      for (const subsystem of this.subsystemInitOrder) {
        if (subsystem.autoStart && subsystem.isReady()) {
          await subsystem.start();
        }
      }

      this.state = 'running';
      this.lastTime = performance.now();
      this.events.emit(EngineEvents.START, { timestamp: Date.now() });

      // Start render loop
      this.startRenderLoop();

      this.log('Engine started');

    } catch (error) {
      const err = error as Error;
      this.error = err;
      this.state = 'error';
      this.events.emit(EngineEvents.ERROR, { error: err, timestamp: Date.now() });
      this.logError('Start failed', err);
      throw error;
    }
  }

  /**
   * Stop engine (pause render loop)
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      this.log(`Not running (state: ${this.state})`);
      return;
    }

    this.state = 'stopping';

    try {
      this.log('Stopping engine...');

      // Stop render loop
      this.stopRenderLoop();

      // Stop all subsystems (reverse order)
      for (const subsystem of [...this.subsystemInitOrder].reverse()) {
        if (subsystem.isRunning()) {
          await subsystem.stop();
        }
      }

      this.state = 'ready';
      this.events.emit(EngineEvents.STOP, { timestamp: Date.now() });
      this.log('Engine stopped');

    } catch (error) {
      const err = error as Error;
      this.error = err;
      this.state = 'error';
      this.events.emit(EngineEvents.ERROR, { error: err, timestamp: Date.now() });
      this.logError('Stop failed', err);
      throw error;
    }
  }

  /**
   * Dispose engine and all resources
   */
  async dispose(): Promise<void> {
    if (this.state === 'disposed') {
      this.log('Already disposed');
      return;
    }

    // Stop if running
    if (this.state === 'running') {
      await this.stop();
    }

    try {
      this.log('Disposing engine...');

      // Dispose all subsystems (reverse order)
      for (const subsystem of [...this.subsystemInitOrder].reverse()) {
        if (subsystem.getState() !== 'disposed') {
          await subsystem.dispose();
        }
      }

      // Clear subsystems
      this.subsystems.clear();
      this.subsystemInitOrder = [];

      // Dispose core services
      await this.container.dispose();
      this.events.dispose();

      this.state = 'disposed';
      this.events.emit(EngineEvents.DISPOSE, { timestamp: Date.now() });
      this.log('Engine disposed');

    } catch (error) {
      const err = error as Error;
      this.error = err;
      this.state = 'error';
      this.logError('Dispose failed', err);
      throw error;
    }
  }

  /**
   * Register a subsystem
   */
  registerSubsystem(subsystem: Subsystem): void {
    if (this.subsystems.has(subsystem.name)) {
      throw new Error(`Subsystem already registered: ${subsystem.name}`);
    }

    this.subsystems.set(subsystem.name, subsystem);
    this.log(`Registered subsystem: ${subsystem.name}`);
  }

  /**
   * Unregister a subsystem
   */
  unregisterSubsystem(name: string): boolean {
    const subsystem = this.subsystems.get(name);
    if (!subsystem) return false;

    // Dispose if initialized
    if (subsystem.getState() !== 'uninitialized') {
      subsystem.dispose().catch(err => this.logError(`Error disposing subsystem ${name}`, err));
    }

    this.subsystems.delete(name);
    this.events.emit(EngineEvents.SUBSYSTEM_UNREGISTERED, { name });
    this.log(`Unregistered subsystem: ${name}`);
    return true;
  }

  /**
   * Get a subsystem by name
   */
  getSubsystem<T extends Subsystem>(name: string): T | undefined {
    return this.subsystems.get(name) as T | undefined;
  }

  /**
   * Get a subsystem by name (throws if not found)
   */
  requireSubsystem<T extends Subsystem>(name: string): T {
    const subsystem = this.getSubsystem<T>(name);
    if (!subsystem) {
      throw new Error(`Subsystem not found: ${name}`);
    }
    return subsystem;
  }

  /**
   * Get all registered subsystems
   */
  getAllSubsystems(): Subsystem[] {
    return Array.from(this.subsystems.values());
  }

  /**
   * Manually step the engine (for headless/testing)
   */
  async step(deltaTime: number): Promise<void> {
    if (!this.isRunning()) {
      throw new Error('Engine not running');
    }

    const time = performance.now();
    await this.updateFrame(deltaTime, time);
  }

  /**
   * Resolve subsystem initialization order based on dependencies and priority
   */
  private resolveInitOrder(): Subsystem[] {
    const subsystems = Array.from(this.subsystems.values());
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: Subsystem[] = [];

    const visit = (subsystem: Subsystem) => {
      if (visited.has(subsystem.name)) return;
      if (visiting.has(subsystem.name)) {
        throw new Error(`Circular dependency detected involving: ${subsystem.name}`);
      }

      visiting.add(subsystem.name);

      // Visit dependencies first
      for (const depName of subsystem.dependencies) {
        const dep = this.subsystems.get(depName);
        if (dep) {
          visit(dep);
        } else {
          this.logWarn(`Dependency not found: ${depName} (required by ${subsystem.name})`);
        }
      }

      visiting.delete(subsystem.name);
      visited.add(subsystem.name);
      result.push(subsystem);
    };

    // Sort by priority first
    subsystems.sort((a, b) => b.priority - a.priority);

    for (const subsystem of subsystems) {
      visit(subsystem);
    }

    return result;
  }

  /**
   * Start the render loop
   */
  private startRenderLoop(): void {
    // Check if we're in a browser environment
    const hasRAF = typeof requestAnimationFrame !== 'undefined';
    const hasCancelRAF = typeof cancelAnimationFrame !== 'undefined';

    if (!hasRAF || !hasCancelRAF) {
      this.log('Running in headless mode - render loop disabled. Use step() for manual updates.');
      return;
    }

    const loop = (time: number) => {
      if (this.state !== 'running') return;

      const deltaTime = (time - this.lastTime) / 1000; // seconds
      this.lastTime = time;
      this.frameId++;

      this.updateFrame(deltaTime, time).catch(err => {
        this.logError('Frame update error', err);
        this.stop().catch(e => this.logError('Error stopping after frame error', e));
      });

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Stop the render loop
   */
  private stopRenderLoop(): void {
    if (this.animationFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Update a single frame
   */
  private async updateFrame(deltaTime: number, time: number): Promise<void> {
    // Clamp delta time to prevent spiral of death
    const clampedDelta = Math.min(deltaTime, 0.1);

    // Emit before render
    this.events.emit(EngineEvents.BEFORE_RENDER, { deltaTime: clampedDelta, time });

    // Fixed timestep updates
    this.fixedTimestepAccumulator += clampedDelta;
    const fixedTimestep = this.config.world.fixedTimestep;

    while (this.fixedTimestepAccumulator >= fixedTimestep) {
      for (const subsystem of this.subsystemInitOrder) {
        if (subsystem.isRunning()) {
          subsystem.fixedUpdate(fixedTimestep);
        }
      }
      this.fixedTimestepAccumulator -= fixedTimestep;
    }

    // Variable timestep updates
    for (const subsystem of this.subsystemInitOrder) {
      if (subsystem.isRunning()) {
        subsystem.update(clampedDelta, time);
      }
    }

    // Late updates
    for (const subsystem of this.subsystemInitOrder) {
      if (subsystem.isRunning()) {
        subsystem.lateUpdate(clampedDelta, time);
      }
    }

    // Emit frame event
    this.events.emit(EngineEvents.FRAME, {
      deltaTime: clampedDelta,
      time,
      frameId: this.frameId
    });

    // Emit after render
    this.events.emit(EngineEvents.AFTER_RENDER, { deltaTime: clampedDelta, time });
  }

  /**
   * Handle viewport resize
   */
  onResize(width: number, height: number): void {
    this.config.rendering.width = width;
    this.config.rendering.height = height;

    for (const subsystem of this.subsystems.values()) {
      subsystem.onResize(width, height);
    }

    this.events.emit(EngineEvents.RENDER_VIEWPORT_RESIZE, { width, height });
  }

  // Logging helpers

  private log(message: string, ...args: any[]): void {
    if (this.config.debug.logging) {
      console.log(`[EngineCore] ${message}`, ...args);
    }
  }

  private logError(message: string, error: any): void {
    console.error(`[EngineCore] ${message}:`, error);
  }

  private logWarn(message: string, ...args: any[]): void {
    console.warn(`[EngineCore] ${message}`, ...args);
  }
}