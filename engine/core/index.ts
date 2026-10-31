/**
 * Engine Core - Main Export
 *
 * Core engine functionality: EngineCore, DIContainer, EventBus, Subsystem base,
 * Configuration, and all built-in subsystems.
 */

// Engine Core
export { EngineCore } from './EngineCore.js';
export type { EngineCoreOptions } from './EngineCore.js';

// Configuration
export { createDefaultConfig } from './EngineConfig.js';
export type {
  EngineConfig,
  RuntimeMode,
  RenderingConfig,
  InputConfig,
  WorldConfig,
  SubsystemConfigs,
  WorldSubsystemConfig,
  RenderSubsystemConfig,
  InputSubsystemConfig,
  ControlMapConfig,
  DebugConfig,
  BaseSubsystemConfig,
} from './EngineConfig.js';

// Dependency Injection
export { DIContainer } from './DIContainer.js';
export type { ServiceToken, ServiceRegistration, Lifetime, ResolveOptions } from './DIContainer.js';
export { Injectable, Inject, resolveDependencies } from './DIContainer.js';

// Event Bus
export { EngineEventBus } from './EngineEventBus.js';
export type { EventMap, EventName, ListenerOptions, EventListener, ListenerEntry } from './EngineEventBus.js';
export { EngineEvents } from './EngineEventBus.js';
export type { EngineEventMap } from './EngineEventBus.js';

// Subsystem Base
export { Subsystem } from './Subsystem.js';
export type { SubsystemConfig, SubsystemState, SubsystemContext } from './Subsystem.js';

// Built-in Subsystems
export {
  WorldSubsystem,
  RenderSubsystem,
  InputSubsystem,
} from '../subsystems/index.js';

export type {
  RenderStats,
  InputState,
} from '../subsystems/index.js';