/**
 * Engine Configuration Types
 *
 * Centralized configuration for EngineCore and all subsystems.
 * Provides type-safe configuration with sensible defaults.
 */

export interface EngineConfig {
  /** Engine identification */
  name: string;
  version: string;

  /** Runtime mode */
  runtimeMode: RuntimeMode;

  /** Rendering configuration */
  rendering: RenderingConfig;

  /** Input configuration */
  input: InputConfig;

  /** World/Physics configuration */
  world: WorldConfig;

  /** Subsystem configurations */
  subsystems: SubsystemConfigs;

  /** Development/debug flags */
  debug: DebugConfig;
}

export type RuntimeMode = 'editor' | 'play' | 'headless';

export interface RenderingConfig {
  /** Target canvas element or selector */
  canvas?: HTMLCanvasElement | string;

  /** Renderer backend */
  renderer: 'webgl2' | 'webgpu' | 'auto';

  /** Viewport dimensions */
  width: number;
  height: number;

  /** Pixel ratio (for HiDPI) */
  pixelRatio: number;

  /** Enable antialiasing */
  antialias: boolean;

  /** Enable shadows */
  shadows: boolean;

  /** Shadow map resolution */
  shadowMapSize: number;

  /** Maximum lights */
  maxLights: number;

  /** Tone mapping */
  toneMapping: 'none' | 'aces' | 'reinhard' | 'cineon';

  /** Color space */
  colorSpace: 'srgb' | 'linear';

  /** Frustum culling */
  frustumCulling: boolean;

  /** Render stats overlay */
  showStats: boolean;
}

export interface InputConfig {
  /** Enable pointer controller */
  pointer: boolean;

  /** Enable keyboard input */
  keyboard: boolean;

  /** Enable gamepad input */
  gamepad: boolean;

  /** Pointer sensitivity */
  pointerSensitivity: number;

  /** Double click threshold (ms) */
  doubleClickThreshold: number;

  /** Touch support */
  touch: boolean;
}

export interface WorldConfig {
  /** Gravity vector */
  gravity: { x: number; y: number; z: number };

  /** Physics timestep (fixed) */
  fixedTimestep: number;

  /** Maximum sub-steps per frame */
  maxSubSteps: number;

  /** Broadphase type */
  broadphase: 'sap' | 'grid' | 'dynamic';

  /** Enable continuous collision detection */
  ccd: boolean;

  /** World bounds for culling */
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

export interface SubsystemConfigs {
  world: WorldSubsystemConfig;
  render: RenderSubsystemConfig;
  input: InputSubsystemConfig;
  mount: MountSubsystemConfig;
}

/** Base config for all subsystems */
export interface BaseSubsystemConfig {
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

export interface WorldSubsystemConfig extends BaseSubsystemConfig {
  /** Auto-create default world on init */
  autoCreateWorld: boolean;

  /** Default collision layers */
  collisionLayers: string[];

  /** Enable terrain system */
  enableTerrain: boolean;

  /** Enable grass/vegetation */
  enableGrass: boolean;

  /** Enable avatar system */
  enableAvatar: boolean;

  /** Enable physics simulation */
  enablePhysics: boolean;
}

export interface RenderSubsystemConfig extends BaseSubsystemConfig {
  /** Auto-create viewport on init */
  autoCreateViewport: boolean;

  /** Default camera type */
  defaultCamera: 'orbit' | 'firstperson' | 'free';

  /** Enable post-processing */
  postProcessing: boolean;

  /** Enable frustum culling */
  frustumCulling: boolean;

  /** Render layers */
  layers: string[];
}

export interface InputSubsystemConfig extends BaseSubsystemConfig {
  /** Default control scheme */
  defaultControlScheme: string;

  /** Enable transform controls (editor) */
  enableTransformControls: boolean;

  /** Enable gamepad support */
  enableGamepad?: boolean;

  /** Control map configurations */
  controlMaps: Record<string, ControlMapConfig>;
}

export interface MountSubsystemConfig extends BaseSubsystemConfig {
  /** Auto-create mount controller on init */
  autoCreateController?: boolean;

  /** Default control bindings for mounting */
  defaultControlBindings?: Record<string, string>;

  /** Enable mount system by default */
  enabled?: boolean;
}

export interface ControlMapConfig {
  /** Map name */
  name: string;

  /** Key bindings */
  bindings: Record<string, string>;

  /** Axis mappings */
  axes: Record<string, { positive: string; negative: string }>;
}

export interface DebugConfig {
  /** Enable debug logging */
  logging: boolean;

  /** Log level */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';

  /** Show performance metrics */
  showPerformance: boolean;

  /** Enable GPU timers */
  gpuTimers: boolean;

  /** Validate contracts */
  validateContracts: boolean;
}

/**
 * Default configuration factory
 */
export function createDefaultConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const defaults: EngineConfig = {
    name: 'Prometheus Engine',
    version: '1.0.0',
    runtimeMode: 'editor',
    rendering: {
      canvas: undefined,
      renderer: 'auto',
      width: 1920,
      height: 1080,
      pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      antialias: true,
      shadows: true,
      shadowMapSize: 2048,
      maxLights: 8,
      toneMapping: 'aces',
      colorSpace: 'srgb',
      frustumCulling: true,
      showStats: false,
    },
    input: {
      pointer: true,
      keyboard: true,
      gamepad: false,
      pointerSensitivity: 1.0,
      doubleClickThreshold: 300,
      touch: true,
    },
    world: {
      gravity: { x: 0, y: -9.81, z: 0 },
      fixedTimestep: 1 / 60,
      maxSubSteps: 4,
      broadphase: 'sap',
      ccd: true,
      bounds: {
        min: { x: -10000, y: -10000, z: -10000 },
        max: { x: 10000, y: 10000, z: 10000 },
      },
    },
    subsystems: {
      world: {
        name: 'world',
        autoCreateWorld: true,
        collisionLayers: ['Default', 'Player', 'Enemy', 'Terrain', 'Trigger'],
        enableTerrain: true,
        enableGrass: true,
        enableAvatar: true,
        enablePhysics: true,
      },
      render: {
        name: 'render',
        autoCreateViewport: true,
        defaultCamera: 'orbit',
        postProcessing: false,
        frustumCulling: true,
        layers: ['Default', 'UI', 'Debug', 'PostProcess'],
      },
      input: {
        name: 'input',
        defaultControlScheme: 'default',
        enableTransformControls: true,
        enableGamepad: false,
        controlMaps: {},
      },
      mount: {
        name: 'mount',
        autoCreateController: true,
        enabled: true,
        defaultControlBindings: {
          forward: 'KeyW',
          backward: 'KeyS',
          left: 'KeyA',
          right: 'KeyD',
          run: 'ShiftLeft',
          sprint: 'ShiftLeft',
          jump: 'Space',
          interact: 'KeyE',
          action1: 'KeyQ',
          action2: 'KeyR',
          action3: 'KeyF',
          action4: 'KeyC',
        },
      },
    },
    debug: {
      logging: true,
      logLevel: 'info',
      showPerformance: false,
      gpuTimers: false,
      validateContracts: false,
    },
  };

  return deepMerge(defaults, overrides) as EngineConfig;
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }

  return result;
}

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && value.constructor === Object;
}

/**
 * Validates an EngineConfig object, throwing on invalid values.
 * @param config - The config to validate
 * @throws {Error} If config is invalid
 */
export function validateConfig(config: EngineConfig): void {
  // Validate name
  if (!config.name || typeof config.name !== 'string') {
    throw new Error('EngineConfig.name must be a non-empty string');
  }

  // Validate version
  if (!config.version || typeof config.version !== 'string') {
    throw new Error('EngineConfig.version must be a non-empty string');
  }

  // Validate runtimeMode
  if (!['editor', 'play', 'headless'].includes(config.runtimeMode)) {
    throw new Error(`EngineConfig.runtimeMode must be 'editor', 'play', or 'headless', got: ${config.runtimeMode}`);
  }

  // Validate rendering
  if (!config.rendering || typeof config.rendering !== 'object') {
    throw new Error('EngineConfig.rendering must be an object');
  }
  if (typeof config.rendering.width !== 'number' || config.rendering.width <= 0) {
    throw new Error('EngineConfig.rendering.width must be a positive number');
  }
  if (typeof config.rendering.height !== 'number' || config.rendering.height <= 0) {
    throw new Error('EngineConfig.rendering.height must be a positive number');
  }
  if (typeof config.rendering.pixelRatio !== 'number' || config.rendering.pixelRatio <= 0) {
    throw new Error('EngineConfig.rendering.pixelRatio must be a positive number');
  }
  if (!['webgl2', 'webgpu', 'auto'].includes(config.rendering.renderer)) {
    throw new Error(`EngineConfig.rendering.renderer must be 'webgl2', 'webgpu', or 'auto', got: ${config.rendering.renderer}`);
  }
  if (!['none', 'aces', 'reinhard', 'cineon'].includes(config.rendering.toneMapping)) {
    throw new Error(`EngineConfig.rendering.toneMapping must be 'none', 'aces', 'reinhard', or 'cineon', got: ${config.rendering.toneMapping}`);
  }
  if (!['srgb', 'linear'].includes(config.rendering.colorSpace)) {
    throw new Error(`EngineConfig.rendering.colorSpace must be 'srgb' or 'linear', got: ${config.rendering.colorSpace}`);
  }

  // Validate input
  if (!config.input || typeof config.input !== 'object') {
    throw new Error('EngineConfig.input must be an object');
  }
  if (typeof config.input.pointerSensitivity !== 'number' || config.input.pointerSensitivity < 0) {
    throw new Error('EngineConfig.input.pointerSensitivity must be a non-negative number');
  }
  if (typeof config.input.doubleClickThreshold !== 'number' || config.input.doubleClickThreshold < 0) {
    throw new Error('EngineConfig.input.doubleClickThreshold must be a non-negative number');
  }

  // Validate world
  if (!config.world || typeof config.world !== 'object') {
    throw new Error('EngineConfig.world must be an object');
  }
  if (!config.world.gravity || typeof config.world.gravity !== 'object') {
    throw new Error('EngineConfig.world.gravity must be an object with x, y, z');
  }
  if (typeof config.world.gravity.x !== 'number' || typeof config.world.gravity.y !== 'number' || typeof config.world.gravity.z !== 'number') {
    throw new Error('EngineConfig.world.gravity.x, y, z must be numbers');
  }
  if (typeof config.world.fixedTimestep !== 'number' || config.world.fixedTimestep <= 0) {
    throw new Error('EngineConfig.world.fixedTimestep must be a positive number');
  }
  if (typeof config.world.maxSubSteps !== 'number' || config.world.maxSubSteps < 1) {
    throw new Error('EngineConfig.world.maxSubSteps must be a number >= 1');
  }
  if (!['sap', 'grid', 'dynamic'].includes(config.world.broadphase)) {
    throw new Error(`EngineConfig.world.broadphase must be 'sap', 'grid', or 'dynamic', got: ${config.world.broadphase}`);
  }

  // Validate subsystems
  if (!config.subsystems || typeof config.subsystems !== 'object') {
    throw new Error('EngineConfig.subsystems must be an object');
  }
  if (!config.subsystems.world || !config.subsystems.render || !config.subsystems.input || !config.subsystems.mount) {
    throw new Error('EngineConfig.subsystems must have world, render, input, and mount configs');
  }

  // Validate mount subsystem config
  const mountConfig = config.subsystems.mount;
  if (mountConfig) {
    if (typeof mountConfig.autoCreateController !== 'undefined' && typeof mountConfig.autoCreateController !== 'boolean') {
      throw new Error('EngineConfig.subsystems.mount.autoCreateController must be a boolean');
    }
    if (typeof mountConfig.enabled !== 'undefined' && typeof mountConfig.enabled !== 'boolean') {
      throw new Error('EngineConfig.subsystems.mount.enabled must be a boolean');
    }
    if (mountConfig.defaultControlBindings && typeof mountConfig.defaultControlBindings !== 'object') {
      throw new Error('EngineConfig.subsystems.mount.defaultControlBindings must be an object');
    }
  }

  // Validate debug
  if (!config.debug || typeof config.debug !== 'object') {
    throw new Error('EngineConfig.debug must be an object');
  }
  if (!['trace', 'debug', 'info', 'warn', 'error'].includes(config.debug.logLevel)) {
    throw new Error(`EngineConfig.debug.logLevel must be 'trace', 'debug', 'info', 'warn', or 'error', got: ${config.debug.logLevel}`);
  }
}

/**
 * Deep merges a partial config into a full config, returning a new config.
 * Uses isPlainObject to properly handle nested objects.
 */
export function deepMergeConfig(target: EngineConfig, source: Partial<EngineConfig>): EngineConfig {
  const result = { ...target } as unknown as Record<string, unknown>;

  for (const key of Object.keys(source) as Array<keyof EngineConfig>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue !== undefined && isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMergeConfig(targetValue as unknown as EngineConfig, sourceValue as Partial<EngineConfig>);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }

  return result as unknown as EngineConfig;
}