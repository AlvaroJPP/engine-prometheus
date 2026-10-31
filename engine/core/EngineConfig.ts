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