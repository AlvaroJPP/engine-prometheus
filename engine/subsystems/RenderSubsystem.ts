/**
 * RenderSubsystem - Viewport, Camera, Render Loop
 *
 * Encapsulates Viewport, OrbitCamera, render loop, ViewportDiagnostics.
 * Provides high-level rendering operations without exposing internal implementation.
 */

import { Subsystem, SubsystemConfig, SubsystemContext } from '../core/Subsystem.js';
import { EngineConfig, RenderingConfig, RenderSubsystemConfig } from '../core/EngineConfig.js';
import { EngineEventMap, EngineEvents } from '../core/EngineEventBus.js';
import { DIContainer } from '../core/DIContainer.js';

import { Viewport, PerformancePreset, ViewportRenderStats } from '../view/Viewport.js';
import { OrbitCamera } from '../view/OrbitCamera.js';
import { CameraPreset, CameraData } from '../project/format.js';
import { ViewportDiagnostics } from '../view/ViewportDiagnostics.js';
import * as THREE from 'three';

/** Camera interface */
export interface Camera {
  camera: THREE.Camera;
  update(): void;
  resize(aspect: number): void;
}

/** Extended camera types */
export interface OrbitCameraExtended extends Camera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target: THREE.Vector3;
  preset: CameraPreset;
  yaw: number;
  pitch: number;
  distance: number;
  firstPerson: boolean;
  setFirstPersonMode(enabled: boolean): void;
  setPreset(preset: CameraPreset): void;
  rotate(dx: number, dy: number): void;
  zoom(deltaY: number): void;
  pan(dx: number, dy: number): void;
  getState(): CameraData;
  restore(d: CameraData): void;
}

export interface RenderStats {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  memory: {
    geometries: number;
    textures: number;
  };
}

export class RenderSubsystem extends Subsystem {
  // Core rendering
  private viewport: Viewport | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private activeCamera: Camera | null = null;
  private cameras = new Map<string, Camera>();

  // Camera types
  private orbitCamera: OrbitCameraExtended | null = null;
  private firstPersonCamera: Camera | null = null;
  private freeCamera: Camera | null = null;

  // Render layers (using THREE.Scene as layers)
  private layers = new Map<string, THREE.Scene>();
  private layerOrder: string[] = [];

  // Post-processing
  private postProcessingEnabled = false;
  private postEffects: any[] = [];

  // Stats
  private stats: RenderStats = {
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    memory: { geometries: 0, textures: 0 },
  };
  private frameTimes: number[] = [];
  private lastFrameTime = 0;

  // Diagnostics
  private diagnostics: ViewportDiagnostics | null = null;

  // Configuration
  private subsystemConfig: RenderSubsystemConfig;

  constructor(config: RenderSubsystemConfig = { name: 'render', autoCreateViewport: true, defaultCamera: 'orbit', postProcessing: false, frustumCulling: true, layers: ['Default', 'UI', 'Debug', 'PostProcess'] }) {
    super({
      priority: 80, // After world
      dependencies: ['world'],
      autoStart: true,
      debug: config.debug ?? false,
      ...config,
    });
    this.subsystemConfig = config;
  }

  // === Lifecycle ===

  protected async onInitialize(context: SubsystemContext): Promise<void> {
    this.log('Initializing RenderSubsystem...');

    const renderConfig = context.config.rendering;
    const subsystemConfig = context.config.subsystems.render;

    // Create renderer
    await this.createRenderer(renderConfig);

    // Create scene
    await this.createScene();

    // Create cameras
    await this.createCameras(subsystemConfig.defaultCamera);

    // Create viewport if auto-create
    if (this.subsystemConfig.autoCreateViewport ?? subsystemConfig.autoCreateViewport) {
      await this.createViewport(renderConfig);
    }

    // Setup render layers
    this.setupRenderLayers(subsystemConfig.layers);

    // Setup post-processing
    this.postProcessingEnabled = this.subsystemConfig.postProcessing ?? subsystemConfig.postProcessing;
    if (this.postProcessingEnabled) {
      await this.initializePostProcessing();
    }

    // Setup frustum culling (enabled by default on Object3D)
    // this.renderer!.setFrustumCulling(this.subsystemConfig.frustumCulling ?? subsystemConfig.frustumCulling);

    // Initialize diagnostics
    await this.initializeDiagnostics();

    // Register in DI
    this.container?.registerInstance('render:viewport', this.viewport);
    this.container?.registerInstance('render:renderer', this.renderer);
    this.container?.registerInstance('render:scene', this.scene);
    this.container?.registerInstance('render:activeCamera', this.activeCamera);

    this.log('RenderSubsystem initialized');
  }

  protected async onStart(): Promise<void> {
    this.log('Starting RenderSubsystem...');

    // Start render loop (handled by EngineCore)
    // Just mark as ready
  }

  protected async onStop(): Promise<void> {
    this.log('Stopping RenderSubsystem...');
  }

  protected async onDispose(): Promise<void> {
    this.log('Disposing RenderSubsystem...');

    // Dispose post effects
    for (const effect of this.postEffects) {
      effect.dispose?.();
    }
    this.postEffects = [];

    // Dispose cameras
    for (const camera of this.cameras.values()) {
      camera.camera?.dispose?.();
    }
    this.cameras.clear();
    this.orbitCamera = null;
    this.firstPersonCamera = null;
    this.freeCamera = null;
    this.activeCamera = null;

    // Dispose viewport
    if (this.viewport) {
      this.viewport.dispose();
      this.viewport = null;
    }

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    // Dispose scene
    if (this.scene) {
      this.scene.traverse((obj) => {
        // Only dispose geometry/material for Mesh objects
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose?.();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose?.());
            } else {
              obj.material.dispose?.();
            }
          }
        }
      });
      this.scene = null;
    }

    // Dispose diagnostics
    if (this.diagnostics) {
      this.diagnostics.dispose();
      this.diagnostics = null;
    }
  }

  protected onUpdate(deltaTime: number, time: number): void {
    // Update active camera
    if (this.activeCamera) {
      this.activeCamera.update();
    }

    // Update post-processing
    if (this.postProcessingEnabled) {
      for (const effect of this.postEffects) {
        effect.update?.(deltaTime);
      }
    }

    // Diagnostics updates automatically via Viewport

    // Update stats
    this.updateStats(deltaTime);
  }

  protected onFixedUpdate(deltaTime: number): void {
    // Fixed timestep updates if needed
  }

  protected onLateUpdate(deltaTime: number, time: number): void {
    // Late render updates
  }

  protected onResizeImpl(width: number, height: number): void {
    if (this.renderer) {
      this.renderer.setSize(width, height, false);
    }

    if (this.viewport) {
      // Viewport handles resize via ResizeObserver
    }

    // Update camera aspect ratios
    for (const camera of this.cameras.values()) {
      camera.resize(width / height);
    }
  }

  protected onRuntimeModeChangeImpl(from: string, to: string): void {
    if (to === 'play') {
      // Hide gizmos, show game UI
      this.setCameraMode('game');
    } else if (to === 'editor') {
      // Show gizmos, enable selection
      this.setCameraMode('editor');
    }
  }

  // === Renderer ===

  private async createRenderer(config: RenderingConfig): Promise<void> {
    this.log(`Creating renderer...`);

    // Resolve canvas element
    let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
    if (typeof config.canvas === 'string') {
      canvas = document.querySelector(config.canvas) as HTMLCanvasElement | undefined;
    } else {
      canvas = config.canvas;
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: config.antialias,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(config.width, config.height);
    this.renderer.setPixelRatio(config.pixelRatio);
    this.renderer.shadowMap.enabled = config.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = this.getToneMapping(config.toneMapping);
    this.renderer.outputColorSpace = config.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  }

  private getToneMapping(mode: string): THREE.ToneMapping {
    return {
      none: THREE.NoToneMapping,
      aces: THREE.ACESFilmicToneMapping,
      reinhard: THREE.ReinhardToneMapping,
      cineon: THREE.CineonToneMapping,
    }[mode] || THREE.NoToneMapping;
  }

  getRenderer(): THREE.WebGLRenderer | null {
    return this.renderer;
  }

  // === Scene ===

  private async createScene(): Promise<void> {
    this.log('Creating scene...');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
  }

  getScene(): THREE.Scene | null {
    return this.scene;
  }

  // === Cameras ===

  private async createCameras(defaultType: string): Promise<void> {
    this.log('Creating cameras...');

    const width = this.config?.rendering.width ?? 1920;
    const height = this.config?.rendering.height ?? 1080;
    const aspect = width / height;

    // Orbit camera (editor default)
    this.orbitCamera = new OrbitCamera();
    this.orbitCamera.camera.aspect = aspect;
    this.orbitCamera.camera.updateProjectionMatrix();
    this.cameras.set('orbit', this.wrapCamera(this.orbitCamera));

    // First person camera (uses orbit camera in first person mode)
    this.firstPersonCamera = this.wrapCamera(this.orbitCamera);
    this.cameras.set('firstperson', this.firstPersonCamera);

    // Free camera (uses orbit camera)
    this.freeCamera = this.wrapCamera(this.orbitCamera);
    this.cameras.set('free', this.freeCamera);

    // Set default active camera
    this.setActiveCamera(this.subsystemConfig.defaultCamera ?? defaultType);
  }

  private wrapCamera(orbitCam: OrbitCameraExtended): Camera {
    return {
      camera: orbitCam.camera,
      update: () => orbitCam.update(),
      resize: (aspect: number) => orbitCam.resize(aspect),
    };
  }

  setActiveCamera(type: 'orbit' | 'firstperson' | 'free' | Camera): void {
    const camera = typeof type === 'string' ? this.cameras.get(type) : type;

    if (!camera) {
      this.logWarn(`Camera not found: ${type}`);
      return;
    }

    const previousPreset = this.activeCamera ? this.getCameraPreset(this.activeCamera) : 'none';
    const newPreset = typeof type === 'string' ? type : this.getCameraPreset(camera);

    this.activeCamera = camera;
    this.container?.registerInstance('render:activeCamera', this.activeCamera);
    this.emit(EngineEvents.CAMERA_CHANGED, {
      preset: newPreset,
      previousPreset,
      timestamp: Date.now(),
    });

    this.log(`Active camera: ${typeof type === 'string' ? type : 'custom'}`);
  }

  private getCameraPreset(camera: Camera): string {
    // Find the preset name from the cameras map
    for (const [name, cam] of this.cameras.entries()) {
      if (cam === camera) return name;
    }
    return 'custom';
  }

  getActiveCamera(): Camera | null {
    return this.activeCamera;
  }

  getCamera(type: 'orbit' | 'firstperson' | 'free'): Camera | undefined {
    return this.cameras.get(type);
  }

  getOrbitCamera(): OrbitCameraExtended | null {
    return this.orbitCamera;
  }

  // Camera mode switching
  private setCameraMode(mode: 'editor' | 'game'): void {
    if (mode === 'editor') {
      this.setActiveCamera('orbit');
      if (this.orbitCamera) {
        this.orbitCamera.setFirstPersonMode(false);
      }
    } else {
      this.setActiveCamera('firstperson');
      if (this.orbitCamera) {
        this.orbitCamera.setFirstPersonMode(true);
      }
    }
  }

  // === Viewport ===

  private async createViewport(config: RenderingConfig): Promise<void> {
    this.log('Creating viewport...');

    // Resolve canvas element
    let canvas: HTMLCanvasElement | undefined;
    if (typeof config.canvas === 'string') {
      canvas = document.querySelector(config.canvas) as HTMLCanvasElement | undefined;
    } else {
      canvas = config.canvas;
    }

    if (!canvas) {
      throw new Error('Canvas is required for viewport creation');
    }

    this.viewport = new Viewport(canvas, (aspect: number) => {
      // Notify cameras of aspect change
      for (const camera of this.cameras.values()) {
        camera.resize(aspect);
      }
    });

    // Set up stats listeners
    this.viewport.setRenderStatsListener((stats: ViewportRenderStats) => {
      this.stats.fps = stats.fps;
      this.stats.drawCalls = stats.drawCalls;
      this.stats.triangles = stats.triangles;
      this.stats.geometries = stats.geometries;
      this.stats.textures = stats.textures;
    });
  }

  getViewport(): Viewport | null {
    return this.viewport;
  }

  // === Render Layers ===

  private setupRenderLayers(layerNames: string[]): void {
    this.layerOrder = [...layerNames];

    for (const name of layerNames) {
      const layer = new THREE.Scene();
      layer.name = name;
      this.layers.set(name, layer);
      this.scene?.add(layer);
    }
  }

  getLayer(name: string): THREE.Scene | undefined {
    return this.layers.get(name);
  }

  addLayer(name: string, order?: number): THREE.Scene {
    const layer = new THREE.Scene();
    layer.name = name;
    this.layers.set(name, layer);

    if (order !== undefined) {
      this.layerOrder.splice(order, 0, name);
    } else {
      this.layerOrder.push(name);
    }

    this.scene?.add(layer);
    return layer;
  }

  removeLayer(name: string): boolean {
    const layer = this.layers.get(name);
    if (!layer) return false;

    this.scene?.remove(layer);
    layer.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose?.());
          } else {
            obj.material.dispose?.();
          }
        }
      }
    });
    this.layers.delete(name);
    this.layerOrder = this.layerOrder.filter(l => l !== name);
    return true;
  }

  // === Post Processing ===

  private async initializePostProcessing(): Promise<void> {
    this.log('Initializing post-processing...');

    // TODO: Setup EffectComposer, passes when needed
    // this.postEffects = [
    //   new RenderPass(this.scene!, this.activeCamera!.camera),
    //   new BloomPass(),
    //   new FXAAPass(),
    // ];
  }

  addPostEffect(effect: any): void {
    this.postEffects.push(effect);
  }

  removePostEffect(effect: any): boolean {
    const index = this.postEffects.indexOf(effect);
    if (index === -1) return false;

    this.postEffects.splice(index, 1);
    effect.dispose?.();
    return true;
  }

  setPostProcessing(enabled: boolean): void {
    this.postProcessingEnabled = enabled;
  }

  isPostProcessingEnabled(): boolean {
    return this.postProcessingEnabled;
  }

  // === Diagnostics ===

  private async initializeDiagnostics(): Promise<void> {
    this.log('Initializing diagnostics...');

    if (this.viewport) {
      // Access diagnostics via reflection or add getter
      // For now, we'll use the internal diagnostics from Viewport
      // this.diagnostics = this.viewport.diagnostics; // private
    }
  }

  getDiagnostics(): ViewportDiagnostics | null {
    return this.diagnostics;
  }

  // === Stats ===

  private updateStats(deltaTime: number): void {
    const now = performance.now();
    this.frameTimes.push(now - this.lastFrameTime);
    this.lastFrameTime = now;

    // Keep last 60 frames
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Calculate FPS
    if (this.frameTimes.length > 1) {
      const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.stats.fps = Math.round(1000 / avgFrameTime);
      this.stats.frameTime = avgFrameTime;
    }

    // Get actual renderer stats
    if (this.renderer) {
      this.stats.drawCalls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      this.stats.geometries = this.renderer.info.memory.geometries;
      this.stats.textures = this.renderer.info.memory.textures;
      this.stats.memory.geometries = this.renderer.info.memory.geometries;
      this.stats.memory.textures = this.renderer.info.memory.textures;
    }
  }

  getStats(): RenderStats {
    return { ...this.stats };
  }

  // === Rendering ===

  render(): void {
    if (!this.renderer || !this.scene || !this.activeCamera) return;

    if (this.postProcessingEnabled && this.postEffects.length > 0) {
      // Post-processing render
      // this.postEffects[this.postEffects.length - 1].render();
    } else {
      this.renderer.render(this.scene, this.activeCamera.camera);
    }
  }

  // === Shadow Settings ===

  setShadows(enabled: boolean): void {
    if (this.config) {
      this.config.rendering.shadows = enabled;
    }
    if (this.renderer) {
      this.renderer.shadowMap.enabled = enabled;
    }
  }

  setShadowMapSize(size: number): void {
    if (this.config) {
      this.config.rendering.shadowMapSize = size;
    }
    // Recreate shadow maps would require re-creating materials
  }

  // === Tone Mapping ===

  setToneMapping(mode: 'none' | 'aces' | 'reinhard' | 'cineon'): void {
    if (this.config) {
      this.config.rendering.toneMapping = mode;
    }
    if (this.renderer) {
      this.renderer.toneMapping = this.getToneMapping(mode);
    }
  }

  // === Performance Preset ===

  setPerformancePreset(preset: PerformancePreset): void {
    if (this.viewport) {
      this.viewport.setPerformancePreset(preset);
    }
  }

  // === Debug ===

  setStatsVisible(visible: boolean): void {
    if (this.config) {
      this.config.rendering.showStats = visible;
    }
    if (this.diagnostics) {
      // this.diagnostics.setVisible(visible);
    }
  }
}