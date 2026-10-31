/**
 * Subsystem Base Class
 *
 * Base class for all engine subsystems. Provides lifecycle management,
 * dependency injection integration, and event bus access.
 */

import { DIContainer } from './DIContainer.js';
import { EngineEventBus, EngineEventMap, EngineEvents } from './EngineEventBus.js';
import { EngineConfig, SubsystemConfigs } from './EngineConfig.js';

export type SubsystemState = 'uninitialized' | 'initializing' | 'ready' | 'running' | 'stopping' | 'disposed' | 'error';

export interface SubsystemConfig {
  /** Subsystem name (unique) */
  name: string;

  /** Subsystem priority (higher = initialized first) */
  priority?: number;

  /** Dependencies on other subsystems */
  dependencies?: string[];

  /** Auto-start with engine */
  autoStart?: boolean;

  /** Enable debug logging for this subsystem */
  debug?: boolean;
}

export interface SubsystemContext {
  /** Engine configuration */
  config: EngineConfig;

  /** DI Container */
  container: DIContainer;

  /** Event bus */
  events: EngineEventBus<EngineEventMap>;

  /** Engine core reference */
  engine: EngineCore;
}

/**
 * Abstract base class for subsystems
 */
export abstract class Subsystem {
  public readonly name: string;
  public readonly priority: number;
  public readonly dependencies: string[];
  public readonly autoStart: boolean;
  public readonly debug: boolean;

  protected state: SubsystemState = 'uninitialized';
  protected config: EngineConfig | null = null;
  protected container: DIContainer | null = null;
  protected events: EngineEventBus<EngineEventMap> | null = null;
  protected engine: EngineCore | null = null;
  protected initPromise: Promise<void> | null = null;
  protected error: Error | null = null;

  constructor(config: SubsystemConfig) {
    this.name = config.name;
    this.priority = config.priority ?? 0;
    this.dependencies = config.dependencies ?? [];
    this.autoStart = config.autoStart ?? true;
    this.debug = config.debug ?? false;
  }

  /**
   * Get current state
   */
  getState(): SubsystemState {
    return this.state;
  }

  /**
   * Check if subsystem is ready
   */
  isReady(): boolean {
    return this.state === 'ready' || this.state === 'running';
  }

  /**
   * Check if subsystem is running
   */
  isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * Check if subsystem has error
   */
  hasError(): boolean {
    return this.state === 'error';
  }

  /**
   * Get last error
   */
  getError(): Error | null {
    return this.error;
  }

  /**
   * Initialize subsystem
   * Called once during engine initialization
   */
  async initialize(context: SubsystemContext): Promise<void> {
    if (this.state !== 'uninitialized') {
      this.log(`Already initialized (state: ${this.state})`);
      return;
    }

    this.setState('initializing');
    this.config = context.config;
    this.container = context.container;
    this.events = context.events;
    this.engine = context.engine;

    try {
      this.log('Initializing...');
      await this.onInitialize(context);
      this.setState('ready');
      this.log('Initialized');

      // Emit registered event
      this.events?.emit(EngineEvents.SUBSYSTEM_REGISTERED, {
        name: this.name,
        subsystem: this
      });
    } catch (error) {
      this.error = error as Error;
      this.setState('error');
      this.logError('Initialization failed', error);
      throw error;
    }
  }

  /**
   * Start subsystem
   * Called after all subsystems are initialized
   */
  async start(): Promise<void> {
    if (!this.isReady()) {
      throw new Error(`Cannot start subsystem ${this.name}: not ready (state: ${this.state})`);
    }

    if (this.state === 'running') {
      this.log('Already running');
      return;
    }

    this.setState('running');

    try {
      this.log('Starting...');
      await this.onStart();
      this.log('Started');
    } catch (error) {
      this.error = error as Error;
      this.setState('error');
      this.logError('Start failed', error);
      throw error;
    }
  }

  /**
   * Stop subsystem
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      this.log(`Not running (state: ${this.state})`);
      return;
    }

    this.setState('stopping');

    try {
      this.log('Stopping...');
      await this.onStop();
      this.setState('ready');
      this.log('Stopped');
    } catch (error) {
      this.error = error as Error;
      this.setState('error');
      this.logError('Stop failed', error);
      throw error;
    }
  }

  /**
   * Dispose subsystem
   * Called during engine shutdown
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
      this.log('Disposing...');
      await this.onDispose();
      this.setState('disposed');
      this.log('Disposed');
    } catch (error) {
      this.error = error as Error;
      this.setState('error');
      this.logError('Dispose failed', error);
      throw error;
    } finally {
      // Cleanup references
      this.config = null;
      this.container = null;
      this.events = null;
      this.engine = null;
    }
  }

  /**
   * Update subsystem (called each frame)
   */
  update(deltaTime: number, time: number): void {
    if (this.state === 'running') {
      this.onUpdate(deltaTime, time);
    }
  }

  /**
   * Fixed update (called at fixed timestep)
   */
  fixedUpdate(deltaTime: number): void {
    if (this.state === 'running') {
      this.onFixedUpdate(deltaTime);
    }
  }

  /**
   * Late update (called after all updates)
   */
  lateUpdate(deltaTime: number, time: number): void {
    if (this.state === 'running') {
      this.onLateUpdate(deltaTime, time);
    }
  }

  /**
   * Handle engine resize
   */
  onResize(width: number, height: number): void {
    this.onResizeImpl(width, height);
  }

  /**
   * Handle runtime mode change
   */
  onRuntimeModeChange(from: string, to: string): void {
    this.onRuntimeModeChangeImpl(from, to);
  }

  // Protected lifecycle hooks (override in subclasses)

  protected abstract onInitialize(context: SubsystemContext): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
  protected abstract onDispose(): Promise<void>;
  protected abstract onUpdate(deltaTime: number, time: number): void;
  protected abstract onFixedUpdate(deltaTime: number): void;
  protected abstract onLateUpdate(deltaTime: number, time: number): void;
  protected abstract onResizeImpl(width: number, height: number): void;
  protected abstract onRuntimeModeChangeImpl(from: string, to: string): void;

  // Helper methods

  protected setState(state: SubsystemState): void {
    this.state = state;
  }

  protected log(message: string, ...args: any[]): void {
    if (this.debug || this.config?.debug.logging) {
      console.log(`[${this.name}] ${message}`, ...args);
    }
  }

  protected logError(message: string, error: any): void {
    console.error(`[${this.name}] ${message}:`, error);
  }

  protected logWarn(message: string, ...args: any[]): void {
    console.warn(`[${this.name}] ${message}`, ...args);
  }

  // Convenience methods for event bus

  protected emit<K extends keyof EngineEventMap>(event: K, data: EngineEventMap[K]): boolean {
    return this.events?.emit(event, data) ?? false;
  }

  protected async emitAsync<K extends keyof EngineEventMap>(event: K, data: EngineEventMap[K]): Promise<boolean> {
    return this.events?.emitAsync(event, data) ?? false;
  }

  protected on<K extends keyof EngineEventMap>(event: K, listener: (data: EngineEventMap[K]) => void, options?: any): () => void {
    return this.events?.on(event, listener, options) ?? (() => {});
  }

  protected once<K extends keyof EngineEventMap>(event: K, listener: (data: EngineEventMap[K]) => void, options?: any): () => void {
    return this.events?.once(event, listener, options) ?? (() => {});
  }

  // Access to other subsystems

  protected getSubsystem<T extends Subsystem>(name: string): T | undefined {
    return this.engine?.getSubsystem<T>(name);
  }

  protected requireSubsystem<T extends Subsystem>(name: string): T {
    const subsystem = this.getSubsystem<T>(name);
    if (!subsystem) {
      throw new Error(`Required subsystem not found: ${name}`);
    }
    return subsystem;
  }

  // Container access

  protected resolve<T>(token: any, required = true): T | undefined {
    return this.container?.resolve(token, { required });
  }

  protected resolveRequired<T>(token: any): T {
    return this.container?.resolveRequired(token) as T;
  }

  protected register<T>(token: any, factory: (container: DIContainer) => T, lifetime?: 'singleton' | 'transient' | 'scoped'): void {
    this.container?.registerSingleton(token, factory);
  }
}

/**
 * EngineCore forward declaration for circular reference
 */
import { EngineCore } from './EngineCore.js';