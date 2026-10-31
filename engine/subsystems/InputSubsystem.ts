/**
 * InputSubsystem - PointerController, Keyboard, TransformControls
 *
 * Encapsulates PointerController, ControlMaps, TransformControls.
 * Provides high-level input operations without exposing internal implementation.
 */

import { Subsystem, SubsystemConfig, SubsystemContext } from '../core/Subsystem.js';
import { EngineConfig, InputConfig, InputSubsystemConfig, ControlMapConfig } from '../core/EngineConfig.js';
import { EngineEventMap, EngineEvents } from '../core/EngineEventBus.js';
import { DIContainer } from '../core/DIContainer.js';

import { PointerController } from '../input/PointerController.js';
import { DEFAULT_CONTROL_MAPS, ControlMapBindings, ControlMapProfile, ControlMapSettings, createDefaultControlMapSettings } from '../input/ControlMaps.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as THREE from 'three';
import type { EditorState, ToolMode, BrushSettings, TransformMode } from '../EditorState.js';

export interface InputState {
  /** Current pointer position (normalized -1 to 1) */
  pointer: { x: number; y: number };

  /** Pointer delta since last frame */
  pointerDelta: { x: number; y: number };

  /** Mouse buttons state */
  buttons: Map<number, boolean>;

  /** Keyboard keys state */
  keys: Map<string, boolean>;

  /** Active control scheme */
  activeScheme: string;

  /** Action states (mapped from keys/buttons) */
  actions: Map<string, boolean>;

  /** Axis states (mapped from keys/axes) */
  axes: Map<string, number>;
}

export class InputSubsystem extends Subsystem {
  // Input devices
  private pointerController: PointerController | null = null;
  private transformControls: TransformControls | null = null;

  // Control mapping
  private controlMaps = new Map<string, ControlMapBindings>();
  private controlMapProfiles = new Map<string, ControlMapProfile>();
  private activeControlMap: ControlMapBindings | null = null;
  private activeScheme = 'wasd';

  // Input state
  private inputState: InputState = {
    pointer: { x: 0, y: 0 },
    pointerDelta: { x: 0, y: 0 },
    buttons: new Map(),
    keys: new Map(),
    activeScheme: 'wasd',
    actions: new Map(),
    axes: new Map(),
  };

  // Action/Axis maps for current scheme
  private actionMap: Record<string, string[]> = {};
  private axisMap: Record<string, { positive: string[]; negative: string[] }> = {};

  // Event handlers
  private boundHandlers: Map<string, EventListener> = new Map();

  // Configuration
  private subsystemConfig: InputSubsystemConfig;

  constructor(config: InputSubsystemConfig = { name: 'input', defaultControlScheme: 'wasd', enableTransformControls: true, enableGamepad: false, controlMaps: {} }) {
    super({
      priority: 90, // Before render
      dependencies: ['render', 'world'],
      autoStart: true,
      debug: config.debug ?? false,
      ...config,
    });
    this.subsystemConfig = config;
  }

  // === Lifecycle ===

  protected async onInitialize(context: SubsystemContext): Promise<void> {
    this.log('Initializing InputSubsystem...');

    const inputConfig = context.config.input;
    const renderConfig = context.config.rendering;
    const subsystemConfig = context.config.subsystems.input;

    // Get canvas from rendering config
    const canvas = renderConfig.canvas;
    let canvasElement: HTMLCanvasElement | undefined;
    if (typeof canvas === 'string') {
      canvasElement = document.querySelector(canvas) as HTMLCanvasElement | undefined;
    } else {
      canvasElement = canvas;
    }

    if (!canvasElement) {
      this.logWarn('No canvas provided for input subsystem');
    }

    // Create pointer controller
    if (this.subsystemConfig.enableTransformControls ?? subsystemConfig.enableTransformControls) {
      await this.createPointerController(inputConfig, canvasElement);
    }

    // Load control maps
    const controlMaps = this.subsystemConfig.controlMaps ?? subsystemConfig.controlMaps;
    if (Object.keys(controlMaps).length === 0) {
      // Register default control maps
      for (const profile of DEFAULT_CONTROL_MAPS) {
        this.registerControlMapProfile(profile);
      }
    } else {
      for (const [name, mapConfig] of Object.entries(controlMaps)) {
        this.registerControlMap(name, mapConfig);
      }
    }

    // Set default control scheme (only if it exists)
    const defaultScheme = this.subsystemConfig.defaultControlScheme ?? subsystemConfig.defaultControlScheme;
    if (this.controlMaps.has(defaultScheme)) {
      this.setControlScheme(defaultScheme);
    } else if (this.controlMaps.size > 0) {
      // Fall back to first available scheme
      const firstScheme = this.controlMaps.keys().next().value;
      if (firstScheme) {
        this.setControlScheme(firstScheme);
      }
    }

    // Create transform controls (editor)
    if (this.subsystemConfig.enableTransformControls ?? subsystemConfig.enableTransformControls) {
      await this.createTransformControls(canvasElement);
    }

    // Register in DI
    this.container?.registerInstance('input:pointerController', this.pointerController);
    this.container?.registerInstance('input:transformControls', this.transformControls);
    this.container?.registerInstance('input:activeControlMap', this.activeControlMap);

    this.log('InputSubsystem initialized');
  }

  protected async onStart(): Promise<void> {
    this.log('Starting InputSubsystem...');

    // Start listening for events (only in browser environment)
    if (typeof window !== 'undefined') {
      this.attachEventListeners();
    } else {
      this.log('Skipping event listeners in headless environment');
    }
  }

  protected async onStop(): Promise<void> {
    this.log('Stopping InputSubsystem...');

    this.detachEventListeners();
  }

  protected async onDispose(): Promise<void> {
    this.log('Disposing InputSubsystem...');

    this.detachEventListeners();

    // Dispose transform controls
    if (this.transformControls) {
      this.transformControls.dispose();
      this.transformControls = null;
    }

    // Dispose pointer controller
    if (this.pointerController) {
      this.pointerController.dispose();
      this.pointerController = null;
    }

    // Clear control maps
    this.controlMaps.clear();
    this.controlMapProfiles.clear();
    this.activeControlMap = null;
  }

  protected onUpdate(deltaTime: number, time: number): void {
    // Update input state
    this.updateInputState(deltaTime);

    // Update transform controls
    if (this.transformControls) {
      // TransformControls auto-updates when attached to camera
    }

    // Process action/axis mappings
    this.processMappings();
  }

  protected onFixedUpdate(deltaTime: number): void {
    // Fixed timestep input processing
  }

  protected onLateUpdate(deltaTime: number, time: number): void {
    // Reset pointer delta after frame
    this.inputState.pointerDelta = { x: 0, y: 0 };
  }

  protected onResizeImpl(width: number, height: number): void {
    // Viewport handles resize internally via ResizeObserver
  }

  protected onRuntimeModeChangeImpl(from: string, to: string): void {
    if (to === 'play') {
      // Disable transform controls, enable game controls
      this.setTransformControlsEnabled(false);
      this.setControlScheme('wasd'); // Game uses default scheme
    } else if (to === 'editor') {
      // Enable transform controls, enable editor controls
      this.setTransformControlsEnabled(true);
      this.setControlScheme('wasd');
    }
  }

  // === Pointer Controller ===

  private async createPointerController(config: InputConfig, canvas: HTMLCanvasElement | undefined): Promise<void> {
    this.log('Creating pointer controller...');

    if (!canvas) {
      this.logWarn('Canvas not available, pointer controller will be created later');
      return;
    }

    // Get orbit camera from render subsystem
    const orbitCamera = this.container?.resolve<{ camera: THREE.Camera }>('render:activeCamera')?.camera;
    if (!(orbitCamera instanceof THREE.PerspectiveCamera)) {
      this.logWarn('Orbit camera not available yet, will be set later');
    }

    // Get world from world subsystem
    const world = this.container?.resolve<any>('world:world');
    if (!world) {
      this.logWarn('World not available yet, pointer controller will be created later');
      return;
    }

    // Get editor state - this will be provided by the editor
    const editorState: EditorState = {
      tool: 'select' as ToolMode,
      transform: 'translate' as TransformMode,
      buildShape: 'cube' as any,
      brush: { radius: 5, strength: 0.5 },
    };

    const isGizmoDragging = () => this.transformControls?.dragging ?? false;

    this.pointerController = new PointerController(
      canvas,
      orbitCamera as any, // OrbitCamera has .camera property
      world,
      editorState,
      isGizmoDragging,
      undefined, // onBuildAt
      undefined, // onRuntimeObjectClick
    );

    // Setup event forwarding
    // PointerController handles its own events internally
  }

  getPointerController(): PointerController | null {
    return this.pointerController;
  }

  setPointerControllerCanvas(canvas: HTMLCanvasElement): void {
    if (this.pointerController) {
      this.pointerController.dispose();
    }
    // Recreate with new canvas - would need orbit camera and world
    // This is a placeholder for dynamic canvas changes
  }

  // === Control Maps ===

  registerControlMapProfile(profile: ControlMapProfile): void {
    this.log(`Registering control map profile: ${profile.name}`);

    this.controlMapProfiles.set(profile.id, profile);
    this.controlMaps.set(profile.id, { ...profile.bindings });

    // If this is the active scheme, switch to it
    if (profile.id === this.activeScheme) {
      this.activeControlMap = this.controlMaps.get(profile.id) ?? null;
      this.buildMappings(this.activeControlMap!);
    }
  }

  registerControlMap(name: string, config: ControlMapConfig): void {
    this.log(`Registering control map: ${name}`);

    // Merge with default bindings
    const baseBindings = DEFAULT_CONTROL_MAPS[0]?.bindings ?? {};
    const bindings: ControlMapBindings = {
      ...baseBindings,
      ...config.bindings,
    } as ControlMapBindings;

    this.controlMaps.set(name, bindings);

    // If this is the active scheme, switch to it
    if (name === this.activeScheme) {
      this.activeControlMap = bindings;
      this.buildMappings(bindings);
    }
  }

  getControlMap(name: string): ControlMapBindings | undefined {
    return this.controlMaps.get(name);
  }

  getControlMapProfile(name: string): ControlMapProfile | undefined {
    return this.controlMapProfiles.get(name);
  }

  setControlScheme(name: string): boolean {
    const controlMap = this.controlMaps.get(name);
    if (!controlMap) {
      this.logWarn(`Control map not found: ${name}`);
      return false;
    }

    this.activeScheme = name;
    this.activeControlMap = controlMap;
    this.inputState.activeScheme = name;
    this.buildMappings(controlMap);

    this.log(`Control scheme changed to: ${name}`);
    return true;
  }

  getActiveScheme(): string {
    return this.activeScheme;
  }

  getAvailableSchemes(): string[] {
    return Array.from(this.controlMaps.keys());
  }

  private buildMappings(controlMap: ControlMapBindings): void {
    // Build action map (action -> key codes)
    this.actionMap = {};
    for (const [action, keyCode] of Object.entries(controlMap)) {
      if (keyCode) {
        this.actionMap[action] = [keyCode];
      }
    }

    // Build axis map
    this.axisMap = {
      moveX: { positive: ['right'], negative: ['left'] },
      moveZ: { positive: ['backward'], negative: ['forward'] },
    };
  }

  private processMappings(): void {
    // Process keyboard input through mappings
    for (const [action, keyCodes] of Object.entries(this.actionMap)) {
      const isActive = keyCodes.some(code => this.inputState.keys.get(code) ?? false);
      this.inputState.actions.set(action, isActive);
    }

    // Process axis input
    for (const [axis, { positive, negative }] of Object.entries(this.axisMap)) {
      let value = 0;
      if (positive.some(code => this.inputState.keys.get(code) ?? false)) value += 1;
      if (negative.some(code => this.inputState.keys.get(code) ?? false)) value -= 1;
      this.inputState.axes.set(axis, value);
    }
  }

  // === Transform Controls ===

  private async createTransformControls(canvas: HTMLCanvasElement | undefined): Promise<void> {
    this.log('Creating transform controls...');

    if (!canvas) {
      this.logWarn('Canvas not available, transform controls will be created later');
      return;
    }

    // Get active camera
    const activeCamera = this.container?.resolve<{ camera: THREE.Camera }>('render:activeCamera');
    if (!activeCamera?.camera) {
      this.logWarn('Active camera not available, transform controls will be created later');
      return;
    }

    this.transformControls = new TransformControls(activeCamera.camera, canvas);
    this.transformControls.setMode('translate');
    this.transformControls.addEventListener('change', () => this.onTransformChange());
    this.transformControls.addEventListener('objectChange', () => this.onTransformChange());

    // Add to scene
    const scene = this.container?.resolve<THREE.Scene>('render:scene');
    if (scene) {
      scene.add(this.transformControls as unknown as THREE.Object3D);
    }
  }

  getTransformControls(): TransformControls | null {
    return this.transformControls;
  }

  setTransformControlsEnabled(enabled: boolean): void {
    if (this.transformControls) {
      this.transformControls.enabled = enabled;
      (this.transformControls as unknown as THREE.Object3D).visible = enabled;
    }
  }

  setTransformControlsMode(mode: 'translate' | 'rotate' | 'scale'): void {
    if (this.transformControls) {
      this.transformControls.setMode(mode);
    }
  }

  attachTransformControls(object: THREE.Object3D): void {
    if (this.transformControls) {
      this.transformControls.attach(object);
    }
  }

  detachTransformControls(): void {
    if (this.transformControls) {
      this.transformControls.detach();
    }
  }

  // === Event Handlers ===

  private attachEventListeners(): void {
    // Window events
    const handlers: [string, EventListener][] = [
      ['keydown', this.onKeyDown.bind(this) as EventListener],
      ['keyup', this.onKeyUp.bind(this) as EventListener],
      ['pointerdown', this.onPointerDown.bind(this) as EventListener],
      ['pointerup', this.onPointerUp.bind(this) as EventListener],
      ['pointermove', this.onPointerMove.bind(this) as EventListener],
      ['wheel', this.onWheel.bind(this) as EventListener],
      ['contextmenu', this.onContextMenu.bind(this) as EventListener],
    ];

    for (const [event, handler] of handlers) {
      window.addEventListener(event, handler);
      this.boundHandlers.set(event, handler);
    }
  }

  private detachEventListeners(): void {
    if (typeof window === 'undefined') return;
    for (const [event, handler] of this.boundHandlers) {
      window.removeEventListener(event, handler);
    }
    this.boundHandlers.clear();
  }

  private onKeyDown(event: KeyboardEvent): void {
    this.inputState.keys.set(event.code, true);
    this.emit(EngineEvents.INPUT_KEY_DOWN, { event, timestamp: Date.now() });
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.inputState.keys.set(event.code, false);
    this.emit(EngineEvents.INPUT_KEY_UP, { event, timestamp: Date.now() });
  }

  private onPointerDown(event: PointerEvent): void {
    this.inputState.buttons.set(event.button, true);
    this.emit(EngineEvents.INPUT_POINTER_DOWN, { event, timestamp: Date.now() });
  }

  private onPointerUp(event: PointerEvent): void {
    this.inputState.buttons.set(event.button, false);
    this.emit(EngineEvents.INPUT_POINTER_UP, { event, timestamp: Date.now() });
  }

  private onPointerMove(event: PointerEvent): void {
    // Calculate normalized coordinates (-1 to 1)
    const canvas = this.config?.rendering.canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      this.inputState.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.inputState.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Calculate delta
      this.inputState.pointerDelta.x = event.movementX / rect.width * 2;
      this.inputState.pointerDelta.y = -event.movementY / rect.height * 2;
    }

    this.emit(EngineEvents.INPUT_POINTER_MOVE, { event, timestamp: Date.now() });
  }

  private onWheel(event: WheelEvent): void {
    this.emit(EngineEvents.INPUT_WHEEL, { event, timestamp: Date.now() });
  }

  private onContextMenu(event: Event): void {
    // Prevent context menu on right click in canvas
    if (event.target === this.config?.rendering.canvas) {
      event.preventDefault();
    }
  }

  private onTransformChange(): void {
    // Emit transform change event
    this.emit(EngineEvents.INPUT_TRANSFORM_CHANGE, {
      object: this.transformControls?.object ?? null,
      timestamp: Date.now(),
    });
  }

  // === Input State Access ===

  getInputState(): Readonly<InputState> {
    return this.inputState;
  }

  isKeyPressed(code: string): boolean {
    return this.inputState.keys.get(code) ?? false;
  }

  isButtonPressed(button: number): boolean {
    return this.inputState.buttons.get(button) ?? false;
  }

  getPointerPosition(): { x: number; y: number } {
    return { ...this.inputState.pointer };
  }

  getPointerDelta(): { x: number; y: number } {
    return { ...this.inputState.pointerDelta };
  }

  isActionActive(action: string): boolean {
    return this.inputState.actions.get(action) ?? false;
  }

  getAxisValue(axis: string): number {
    return this.inputState.axes.get(axis) ?? 0;
  }

  // === Action/Axis Queries (for gameplay) ===

  getActionValue(action: string): number {
    return this.isActionActive(action) ? 1 : 0;
  }

  getAxis(axis: string): number {
    return this.getAxisValue(axis);
  }

  // === Vibration ===

  vibrate(pattern: number | number[]): void {
    // TODO: Implement gamepad vibration when gamepad support is added
  }

  private updateInputState(deltaTime: number): void {
    // Input state is updated via event handlers
    // This method can be used for polling-based devices (gamepads)
  }
}