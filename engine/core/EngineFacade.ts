/**
 * EngineFacade - Drop-in replacement for Engine.ts
 *
 * Maintains exact same public API as the current Engine class.
 * Internally creates components synchronously (like old Engine.ts)
 * and uses EngineCore for lifecycle management.
 */

import * as THREE from 'three';
import { EngineCore } from './EngineCore.js';
import { EngineConfig, createDefaultConfig, RuntimeMode } from './EngineConfig.js';
import { WorldSubsystem } from '../subsystems/WorldSubsystem.js';
import { RenderSubsystem } from '../subsystems/RenderSubsystem.js';
import { InputSubsystem } from '../subsystems/InputSubsystem.js';
import { EditorState, createEditorState, BrushSettings, ToolMode, TransformMode } from '../EditorState.js';
import { RuleEngine } from '../script/RuleEngine.js';
import { HumanoidAvatar } from '../world/HumanoidAvatar.js';
import { Viewport } from '../view/Viewport.js';
import { PointerController } from '../input/PointerController.js';
import { OrbitCamera } from '../view/OrbitCamera.js';
import { CollisionSystem } from '../world/CollisionSystem.js';
import { TerrainMesh } from '../world/map/TerrainMesh.js';
import { GrassLayer } from '../world/map/GrassLayer.js';
import { World } from '../world/World.js';
import { ProjectMeta } from '../project/serialize.js';
import { uuid } from '../lib/id.js';
import { EngineGameModule, GameModuleContext } from '../runtime/GameModule.js';
import { GameModuleRegistry } from '../runtime/GameModuleRegistry.js';
import { EngineVisualSettingsController } from '../runtime/EngineVisualSettingsController.js';
import { ModelOcclusionSystem } from '../world/ModelOcclusionSystem.js';
import { ModelLodSystem } from '../world/ModelLodSystem.js';
import { AutonomousBehaviorCoordinator } from '../script/AutonomousBehaviorCoordinator.js';
import { EngineBehaviorTreeRuntime } from '../script/EngineBehaviorTreeRuntime.js';
import { MountModelStateController } from '../script/MountModelStateController.js';
import { BuildComponentPlacementController } from '../runtime/BuildComponentPlacementController.js';
import type { LogicRule } from '../script/types.js';
import type { BehaviorPackageInstance } from '../script/packages.js';
import type { AnimationRole } from '../script/packages.js';
import type { ControlMapBindings } from '../input/ControlMaps.js';
import { DEFAULT_CONTROL_MAPS } from '../input/ControlMaps.js';
import type { Entity } from '../model/entity/Entity.js';
import type { ObjectInfo, ObjectPatch } from '../model/object/GameObject.js';
import type { CameraPreset, ObjectType, PlayerModelData, ProjectBundle, SceneObjectData } from '../project/format.js';
import { buildBundle, objectFromData } from '../project/serialize.js';
import { restoreImportedProjectModels } from '../project/ImportedModelProjectRestorer.js';
import { restorePlayerModelFromProject } from '../project/PlayerModelProjectRestorer.js';
import { ProjectFormatError } from '../project/validate.js';
import type { ViewportRenderStats } from '../view/Viewport.js';
import { clamp, snap } from '../lib/math.js';
import { decodeBase64ArrayBuffer } from '../lib/BinaryEncoding.js';
import { DEFAULT_PLAYER_SETTINGS, sanitizePlayerSettings } from '../player/PlayerSettings.js';
import type { PlayerSettings } from '../player/PlayerSettings.js';
import type { GrassRenderOptions } from '../world/map/GrassLayer.js';
import { validateImportedModel } from '../model/validateImportedModel.js';
import { splitStaticModelIntoSpatialParts } from '../model/ImportedModelSpatialGrouping.js';
import { prepareImportedModelGeometry } from '../model/ImportedModelGeometryPreparation.js';
import { createImportedModelRoot } from '../model/ImportedModelRootFactory.js';
import { prepareCustomPlayerModel } from '../model/prepareCustomPlayerModel.js';
import { applyImportedModelMetadata } from '../model/ImportedModelMetadata.js';
import type { TerrainInfo } from '../world/World.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PRESET_ORDER } from '../view/cameraPresets.js';
import { randomSeed, resetIds } from '../lib/id.js';
import { placeSpawnPlatform } from '../world/SpawnPlatformPlacement.js';
import { dispatchMouseBinding, isInteractiveRuntimeTarget, mouseButtonBindingCode } from '../input/RuntimePointerBindings.js';
import { handleRuntimeKeyDown } from '../runtime/RuntimeKeyboardHandler.js';
import { resolveModelControlBindings } from '../script/ModelControlBindings.js';
import { configureRuntimeMode } from '../runtime/RuntimeModeCoordinator.js';
import { createRuntimeFrameUpdateHandler } from '../runtime/RuntimeFrameCoordinator.js';
import type { GameObject } from '../model/object/GameObject.js';

export interface EngineOptions {
  /** Módulos de jogos fornecidos pela aplicação que hospeda a engine. */
  gameModules?: readonly EngineGameModule[];
}

export class EngineFacade {
  private core: EngineCore;
  private initialized = false;

  // --- Core components (created synchronously like old Engine.ts) ---
  public readonly world: World;
  public readonly collisions: CollisionSystem;
  public readonly state: EditorState = createEditorState();
  public readonly logic: RuleEngine;

  // --- Runtime controllers ---
  private modelOcclusion!: ModelOcclusionSystem;
  private modelLod!: ModelLodSystem;
  private visualSettings!: EngineVisualSettingsController;
  private behaviorTreeRuntime = new EngineBehaviorTreeRuntime();
  private autonomousBehaviorCoordinator!: AutonomousBehaviorCoordinator;
  private buildComponentPlacement!: BuildComponentPlacementController;
  private mountModelStateController!: MountModelStateController;
  private transformControls!: TransformControls;

  // --- Render components ---
  private viewportInstance!: Viewport;
  private orbitInstance!: OrbitCamera;
  private inputInstance!: PointerController;

  // --- Game modules ---
  private readonly gameModules = new GameModuleRegistry();

  // --- Player state ---
  private playerModelData: PlayerModelData | null = null;
  private playerSettings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
  private playerControlBindings: ControlMapBindings = { ...DEFAULT_CONTROL_MAPS[0]!.bindings };

  // --- Project meta ---
  private meta: ProjectMeta = { id: uuid(), name: 'Novo Mundo' };

  // --- Internal state ---
  private groupTransformSnapshot: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null = null;
  private cameraStateBeforeRun: ReturnType<OrbitCamera['getState']> | null = null;
  private runtimeModeActive = false;
  private readonly pressedMouseBindings = new Map<string, string>();
  private activeMountPackageId: string | null = null;
  private lastMountMovementState: string | null = null;
  private readonly viewportInvalidationOffs: Array<() => void> = [];

  // --- Public getters for render components (backward compatibility) ---
  public get viewport(): Viewport { return this.viewportInstance; }
  public get orbit(): OrbitCamera { return this.orbitInstance; }
  public get input(): PointerController { return this.inputInstance; }
  public get terrain(): TerrainMesh { return this.world.terrain; }
  public get grass(): GrassLayer { return this.world.terrain.grass; }
  public get avatar(): HumanoidAvatar | null { return this.avatarInstance; }

  // Expose avatar instance for internal use
  private avatarInstance: HumanoidAvatar | null = null;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions = {}) {
    // Register game modules
    for (const module of options.gameModules ?? []) this.gameModules.register(module);

    // Create EngineCore with subsystems (for lifecycle management)
    // Use createDefaultConfig to get all required RenderingConfig properties, override canvas
    const coreConfig = createDefaultConfig({
      rendering: { canvas }
    } as Partial<import('./EngineConfig.js').EngineConfig>);
    this.core = new EngineCore({ config: coreConfig });

    // Register subsystems (lightweight - they'll use DI container for components)
    this.core.registerSubsystem(new WorldSubsystem());
    this.core.registerSubsystem(new RenderSubsystem());
    this.core.registerSubsystem(new InputSubsystem());

    // ============================================================
    // SYNCHRONOUS INITIALIZATION (mirrors old Engine.ts constructor)
    // ============================================================

    // Create core components
    this.world = new World();
    this.collisions = new CollisionSystem(this.world);
    this.logic = new RuleEngine(this.world);

    // Create render components
    this.orbitInstance = new OrbitCamera();
    this.viewportInstance = new Viewport(canvas, (aspect) => this.orbitInstance.resize(aspect));

    // Runtime controllers
    this.modelOcclusion = new ModelOcclusionSystem();
    this.modelLod = new ModelLodSystem(() => {
      this.viewportInstance.invalidate();
    });
    this.visualSettings = new EngineVisualSettingsController(this.viewportInstance, this.world, this.modelLod);

    // Avatar
    this.avatarInstance = new HumanoidAvatar(this.world, this.orbitInstance.target, () => this.orbitInstance.yaw);
    this.autonomousBehaviorCoordinator = new AutonomousBehaviorCoordinator({
      world: this.world,
      logic: this.logic,
      collisions: this.collisions,
      avatar: this.avatarInstance,
      isRuntimeActive: () => this.runtimeModeActive,
      notifyPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      triggerPackageEvent: (ownerObjectId, packageId, eventId) =>
        this.triggerBehaviorPackageEvent(ownerObjectId, packageId, eventId),
    });
    this.avatarInstance.mesh.visible = false;
    this.avatarInstance.setEnabled(false);

    // Build component placement
    this.buildComponentPlacement = new BuildComponentPlacementController({
      world: this.world,
      logic: this.logic,
      transformControls: this.transformControls,
      addImportedModel: (name, model, height) => this.addImportedModel(name, model, height),
      installBehaviorPackage: (ownerObjectId, packageId) => this.installBehaviorPackage(ownerObjectId, packageId),
      updateBehaviorPackage: (id, patch) => this.updateBehaviorPackage(id, patch),
      emitTool: () => this.emitTool(),
    });

    // Transform controls
    this.transformControls = new TransformControls(this.orbitInstance.camera, canvas);
    this.world.scene.add(this.transformControls.getHelper());
    this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform);
    this.transformControls.setSpace('world');
    this.transformControls.addEventListener('objectChange', () => this.onTransformControlChange());
    this.transformControls.addEventListener('dragging-changed', (event: { value: unknown }) => this.onTransformControlDrag(event));

    // Mount model state controller
    this.mountModelStateController = new MountModelStateController(
      this.world,
      this.logic,
      this.modelOcclusion,
      this.collisions,
    );

    // Input controller
    this.inputInstance = new PointerController(
      canvas,
      this.orbitInstance,
      this.world,
      this.state,
      () => this.transformControls.dragging || this.transformControls.axis !== null,
      (x, y, z) => this.buildComponentPlacement.place(x, y, z),
      (id) => {
        this.events.emit('selectionChanged', { id });
      }
    );

    // Register core components in DI container for subsystems to use
    this.core.container.registerInstance('world:world', this.world);
    this.core.container.registerInstance('world:collisionSystem', this.collisions);
    this.core.container.registerInstance('render:viewport', this.viewportInstance);
    this.core.container.registerInstance('render:orbitCamera', this.orbitInstance);
    this.core.container.registerInstance('input:pointerController', this.inputInstance);

    // Setup event listeners
    this.setupEventListeners();

    // Start viewport with runtime frame handler
    this.startViewport();
  }

  private setupEventListeners(): void {
    // Use world events (legacy event bus) for backward compatibility
    const worldEvents = this.events; // returns this.world.events

    // Viewport invalidation events (from world events)
    this.viewportInvalidationOffs.push(
      worldEvents.on('renderInvalidated', () => this.viewport.invalidate()),
      worldEvents.on('objectAdded', () => this.viewport.invalidate()),
      worldEvents.on('objectRemoved', () => this.viewport.invalidate()),
      worldEvents.on('objectRenamed', () => this.viewport.invalidate()),
      worldEvents.on('objectChanged', () => this.viewport.invalidate()),
      worldEvents.on('objectAdded', () => this.modelOcclusion.invalidate()),
      worldEvents.on('objectRemoved', () => this.modelOcclusion.invalidate()),
      worldEvents.on('objectChanged', () => this.modelOcclusion.invalidate()),
      worldEvents.on('worldReset', () => {
        this.modelOcclusion.invalidate();
        this.modelLod.clear();
        this.viewport.invalidate();
      }),
      worldEvents.on('objectRemoved', ({ id }) => this.modelLod.remove(id as string)),
      worldEvents.on('objectChanged', () => this.modelLod.invalidate()),
      worldEvents.on('behaviorPackageChanged', () => this.viewport.invalidate()),
      worldEvents.on('objectClicked', () => this.viewport.invalidate()),
      worldEvents.on('collisionStarted', () => this.viewport.invalidate()),
      worldEvents.on('collisionEnded', () => this.viewport.invalidate()),
      worldEvents.on('selectionChanged', () => this.viewport.invalidate()),
      worldEvents.on('terrainChanged', () => this.viewport.invalidate()),
      worldEvents.on('worldReset', () => this.viewport.invalidate()),
      worldEvents.on('toolChanged', () => this.viewport.invalidate()),
      worldEvents.on('cameraChanged', () => this.viewport.invalidate()),
    );

    // Window events for runtime
    window.addEventListener('pointerdown', this.onRuntimePointerDown, true);
    window.addEventListener('pointerup', this.onRuntimePointerUp, true);
    window.addEventListener('keydown', this.onRuleKeyDown);
    window.addEventListener('keyup', this.onGameModuleKeyUp);
    window.addEventListener('blur', this.onGameModuleBlur);

    // Selection -> transform controls sync
    worldEvents.on('selectionChanged', ({ id }) => {
      const object = id ? this.world.get(id) : undefined;
      if (object && object.mesh.userData.locked !== true) this.transformControls.attach(object.mesh);
      else this.transformControls.detach();
    });

    // Tool changed -> transform controls sync
    this.events.on('toolChanged', ({ transform, tool }) => {
      this.transformControls.setMode(transform === 'move' ? 'translate' : transform);
      this.transformControls.enabled = tool === 'select';
    });

    // Object changed -> transform controls update
    worldEvents.on('objectChanged', ({ id }) => {
      if (this.world.getSelectedId() === id) this.transformControls.getHelper().updateMatrixWorld();
    });
  }

  private startViewport(): void {
    const moduleContext: GameModuleContext = {
      world: this.world,
      logic: this.logic,
      avatar: this.avatarInstance!,
      collisions: this.collisions,
      getControlBindings: () => ({ ...this.playerControlBindings }),
      setCameraTarget: (x, y, z) => this.orbit.target.set(x, y, z),
      isRuntimeActive: () => this.runtimeModeActive,
      invalidate: () => this.viewport.invalidate(),
    };
    this.gameModules.attach(moduleContext);

    this.viewport.start(createRuntimeFrameUpdateHandler({
      input: this.input,
      world: this.world,
      collisions: this.collisions,
      avatar: this.avatarInstance!,
      logic: this.logic,
      orbit: this.orbit,
      modelOcclusion: this.modelOcclusion,
      modelLod: this.modelLod,
      viewport: this.viewport,
      gameModules: this.gameModules,
      isRuntimeModeActive: () => this.runtimeModeActive,
      getActiveMountPackageId: () => this.activeMountPackageId,
      getLastMountMovementState: () => this.lastMountMovementState,
      setLastMountMovementState: state => { this.lastMountMovementState = state },
      updateAutonomousBehaviors: dt => this.autonomousBehaviorCoordinator.update(dt),
      updateBehaviorTrees: dt => this.updateBehaviorTrees(dt),
      notifyBehaviorPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      triggerBehaviorPackageEvent: (ownerObjectId, packageId, eventId) =>
        this.triggerBehaviorPackageEvent(ownerObjectId, packageId, eventId),
      triggerPlayerEvent: (eventId, payload) => this.logic.triggerPlayerEvent(eventId, payload),
      applyMountModelStates: instance => this.applyMountModelStates(instance),
    }));
  }

  // ========================================================================
  // EngineCore lifecycle delegation
  // ========================================================================

  async init(config?: Partial<EngineConfig>): Promise<void> {
    await this.core.initialize();
    this.initialized = true;
  }

  async start(): Promise<void> {
    await this.core.start();
  }

  async stop(): Promise<void> {
    await this.core.stop();
  }

  async dispose(): Promise<void> {
    // Dispose facade-specific resources first
    this.behaviorTreeRuntime.reset();
    this.gameModules.dispose();
    window.removeEventListener('pointerdown', this.onRuntimePointerDown, true);
    window.removeEventListener('pointerup', this.onRuntimePointerUp, true);
    window.removeEventListener('keydown', this.onRuleKeyDown);
    window.removeEventListener('keyup', this.onGameModuleKeyUp);
    window.removeEventListener('blur', this.onGameModuleBlur);
    this.input.dispose();
    this.avatarInstance?.dispose();
    this.collisions.dispose();
    this.modelLod.dispose();
    this.modelOcclusion.dispose();
    this.transformControls.dispose();
    for (const off of this.viewportInvalidationOffs) off();
    this.viewportInvalidationOffs.length = 0;
    this.viewport.dispose();

    // Then dispose core
    await this.core.dispose();
  }

  // Event system - return world's event bus for backward compatibility
  get events() {
    return this.world.events;
  }

  // ========================================================================
  // Visual Settings
  // ========================================================================

  setFpsListener(listener: ((fps: number) => void) | null): void {
    this.visualSettings.setFpsListener(listener);
  }

  setRenderStatsListener(listener: ((stats: ViewportRenderStats) => void) | null): void {
    this.visualSettings.setRenderStatsListener(listener);
  }

  setPerformancePreset(preset: 'quality' | 'balanced' | 'economy'): void {
    this.visualSettings.setPerformancePreset(preset);
  }

  setRenderOptions(options: {
    resolutionScale?: number | null;
    fpsLimit?: number | null;
    dynamicResolution?: boolean;
    dynamicResolutionTargetFps?: number;
    dynamicResolutionMinScale?: number;
  }): void {
    this.visualSettings.setRenderOptions(options);
  }

  setGrassRenderOptions(options: GrassRenderOptions): void {
    this.visualSettings.setGrassRenderOptions(options);
  }

  setFogEnabled(enabled: boolean): void {
    this.visualSettings.setFogEnabled(enabled);
  }

  setFogDistanceScale(scale: number): void {
    this.visualSettings.setFogDistanceScale(scale);
  }

  setPerformanceMode(enabled: boolean): void {
    this.visualSettings.setPerformanceMode(enabled);
  }

  // ========================================================================
  // Entity access
  // ========================================================================

  getEntity(id: string): Entity | null {
    return this.world.getEntity(id);
  }

  listEntities(): Entity[] {
    return this.world.listEntities();
  }

  // ========================================================================
  // Logic / Rules
  // ========================================================================

  listRules(): LogicRule[] {
    return this.logic.list();
  }

  listBehaviorPackages(ownerObjectId?: string): BehaviorPackageInstance[] {
    return this.logic.listPackages(ownerObjectId);
  }

  installBehaviorPackage(ownerObjectId: string, packageId: string): BehaviorPackageInstance {
    const alreadyInstalled = this.logic.listPackages(ownerObjectId).some(instance => instance.packageId === packageId);
    const instance = this.logic.installPackage(ownerObjectId, packageId);
    if (packageId === 'mount' && !alreadyInstalled) {
      const rawBindings = this.world.get(ownerObjectId)?.mesh.userData.importControlBindings;
      const controlBindings = resolveModelControlBindings(rawBindings);
      this.logic.updatePackage(instance.id, {
        config: {
          ...instance.config,
          interactionKey: controlBindings.interact,
          controlBindings: { ...controlBindings },
        },
      });
    }
    const installed = this.logic.listPackages(ownerObjectId).find(item => item.packageId === packageId) ?? instance;
    this.notifyBehaviorPackageChanged(ownerObjectId);
    return installed;
  }

  async updateBehaviorPackage(
    id: string,
    patch: Partial<Pick<BehaviorPackageInstance, 'enabled' | 'variables' | 'config'>>,
  ): Promise<void> {
    this.logic.updatePackage(id, patch);
    const instance = this.logic.listPackages().find(item => item.id === id);
    if (patch.enabled === false && this.activeMountPackageId === id) await this.dismountActiveMount();
    if (instance) this.notifyBehaviorPackageChanged(instance.ownerObjectId);
  }

  async removeBehaviorPackage(id: string): Promise<void> {
    const instance = this.logic.listPackages().find(item => item.id === id);
    if (instance?.packageId === 'mount') this.applyMountModelStates(instance, true, false);
    if (this.activeMountPackageId === id) await this.dismountActiveMount();
    this.logic.removePackage(id);
    this.mountModelStateController.forget(id);
  }

  upsertRule(rule: LogicRule): void {
    this.logic.upsert(rule);
  }

  removeRule(id: string): void {
    this.logic.remove(id);
  }

  moveRule(id: string, direction: -1 | 1): void {
    this.logic.move(id, direction);
  }

  setLogicVariable(name: string, value: boolean | number | string, objectId?: string | null): void {
    this.logic.setVariable(name, value, objectId);
  }

  removeLogicVariable(name: string, objectId?: string | null): boolean {
    return this.logic.removeVariable(name, objectId);
  }

  logicVariables(objectId?: string | null): Record<string, boolean | number | string> {
    return this.logic.variables(objectId);
  }

  // ========================================================================
  // Project meta
  // ========================================================================

  get projectName(): string {
    return this.meta.name;
  }

  setProjectName(name: string): void {
    const clean = name.trim();
    if (clean !== '') this.meta.name = clean;
  }

  // ========================================================================
  // Tool management
  // ========================================================================

  setTool(tool: ToolMode): void {
    const previousTool = this.state.tool;
    this.state.tool = tool;
    if (tool === 'grass') {
      this.transformControls.detach();
      this.transformControls.enabled = false;
    } else {
      this.transformControls.enabled = true;
      if (tool === 'select') {
        const id = this.world.getSelectedId();
        const selected = id ? this.world.get(id) : undefined;
        if (selected && selected.mesh.userData.locked !== true) this.transformControls.attach(selected.mesh);
      } else if (previousTool === 'grass') {
        this.transformControls.detach();
      }
    }
    this.emitTool();
  }

  setTransform(mode: TransformMode): void {
    this.state.transform = mode;
    this.state.tool = 'select';
    this.transformControls.setMode(mode === 'move' ? 'translate' : mode);
    this.transformControls.enabled = true;
    this.emitTool();
  }

  setBuildShape(type: ObjectType): void {
    this.state.buildShape = type;
  }

  setBrush(brush: BrushSettings): void {
    this.state.brush.strength = clamp(brush.strength, 0.1, 5);
    this.state.brush.radius = clamp(brush.radius, 0.5, 20);
  }

  private emitTool(): void {
    this.events.emit('toolChanged', { tool: this.state.tool, transform: this.state.transform });
  }

  // ========================================================================
  // Camera
  // ========================================================================

  get cameraPreset(): CameraPreset {
    return this.orbit.preset;
  }

  // ========================================================================
  // Player model
  // ========================================================================

  getPlayerModelName(): string {
    return this.playerModelData?.name ?? 'Modelo padrão (Dummy)';
  }

  getPlayerModelHeight(): number {
    return this.playerModelData?.height ?? 1.8;
  }

  hasCustomPlayerModel(): boolean {
    return this.playerModelData !== null;
  }

  getPlayerSettings(): PlayerSettings {
    return { ...this.playerSettings };
  }

  setPlayerSettings(settings: Partial<PlayerSettings>): void {
    this.playerSettings = sanitizePlayerSettings({ ...this.playerSettings, ...settings });
    this.avatarInstance!.setPlayerSettings(this.playerSettings);
    this.viewport.invalidate();
  }

  async setPlayerModelHeight(height: number): Promise<void> {
    if (!this.playerModelData) throw new Error('Importe um modelo GLB para ajustar a altura do jogador.');
    const nextHeight = clamp(Number.isFinite(height) ? height : (this.playerModelData.height ?? 1.8), 0.1, 10000);
    const model = this.playerModelData;
    await this.avatarInstance!.setCustomModel(
      decodeBase64ArrayBuffer(model.glbData),
      model.animationRoles,
      nextHeight,
    );
    this.playerModelData = { ...model, height: nextHeight };
    this.viewport.invalidate();
  }

  async setPlayerModel(
    data: ArrayBuffer,
    name: string,
    animationRoles?: Record<string, AnimationRole>,
    height = 1.8,
  ): Promise<void> {
    this.playerModelData = await prepareCustomPlayerModel(this.avatarInstance!, data, name, animationRoles, height);
    this.viewport.invalidate();
  }

  async resetPlayerModel(): Promise<void> {
    await this.avatarInstance!.resetDefaultModel();
    this.playerModelData = null;
    this.viewport.invalidate();
  }

  // ========================================================================
  // Controls
  // ========================================================================

  setControlBindings(bindings: ControlMapBindings): void {
    this.playerControlBindings = { ...bindings };
    this.avatarInstance!.setControlBindings(this.playerControlBindings);
  }

  // ========================================================================
  // Runtime mode
  // ========================================================================

  setRuntimeMode(enabled: boolean): void {
    const wasRuntimeActive = this.runtimeModeActive;
    configureRuntimeMode(enabled, {
      avatar: this.avatarInstance!,
      orbit: this.orbit,
      input: this.input,
      world: this.world,
      logic: this.logic,
      gameModules: this.gameModules,
      transformControls: this.transformControls,
      state: this.state,
      viewport: this.viewport,
      pressedMouseBindings: this.pressedMouseBindings,
      isRuntimeModeActive: () => this.runtimeModeActive,
      setRuntimeModeActive: active => { this.runtimeModeActive = active },
      getCameraStateBeforeRun: () => this.cameraStateBeforeRun,
      setCameraStateBeforeRun: state => { this.cameraStateBeforeRun = state },
      getActiveMountPackageId: () => this.activeMountPackageId,
      dismountActiveMount: () => this.dismountActiveMount(),
      emitTool: () => this.emitTool(),
    });
    if (enabled && !wasRuntimeActive && this.runtimeModeActive) {
      this.logic.triggerPlayerEvent('started', { projectName: this.meta.name });
    }
  }

  triggerPlayerEvent(eventId: string, payload: Record<string, boolean | number | string> = {}): boolean {
    return this.logic.triggerPlayerEvent(eventId, payload);
  }

  setFirstPersonMode(enabled: boolean): void {
    this.orbit.setFirstPersonMode(enabled);
    this.avatarInstance!.setFirstPersonMode(enabled);
    if (!enabled) this.orbit.update();
    this.events.emit('cameraChanged', { preset: this.orbit.preset });
  }

  cycleCameraPreset(): CameraPreset {
    const next = PRESET_ORDER[(PRESET_ORDER.indexOf(this.orbit.preset) + 1) % PRESET_ORDER.length] ?? 'free';
    const previous = this.orbit.preset;
    this.orbit.setFirstPersonMode(false);
    this.avatarInstance!.setFirstPersonMode(false);
    this.orbit.setPreset(next);
    this.events.emit('cameraChanged', { preset: next });
    return next;
  }

  // ========================================================================
  // Build component placement
  // ========================================================================

  setBuildComponentPlacement(name: string, model: THREE.Object3D, height: number): void {
    this.buildComponentPlacement.set(name, model, height);
  }

  // ========================================================================
  // Objects
  // ========================================================================

  addPrimitive(type: ObjectType): void {
    this.state.buildShape = type;
    const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48);
    const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48);
    this.world.place(type, x, this.world.terrain.heightAt(x, z), z);
  }

  addSpawnPlatform(): void {
    placeSpawnPlatform(this.world, this.orbit.target);
  }

  private onRuntimePointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType !== 'mouse' ||
      !this.cameraStateBeforeRun ||
      !this.runtimeModeActive
    ) return;

    const code = mouseButtonBindingCode(event.button);
    if (!code || isInteractiveRuntimeTarget(event.target)) return;

    const isMappedControl = Object.values(this.playerControlBindings).some(binding => binding === code);
    const dispatchedCode = isMappedControl ? code : null;

    if (!dispatchedCode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.pressedMouseBindings.has(code)) return;
    this.pressedMouseBindings.set(code, dispatchedCode);
    dispatchMouseBinding(dispatchedCode, 'keydown');
    if (code === this.playerControlBindings.interact) {
      this.logic.triggerPlayerEvent('interact', { key: code });
    }
  };

  private onRuntimePointerUp = (event: PointerEvent): void => {
    if (!this.cameraStateBeforeRun || !this.runtimeModeActive) return;
    const mouseCode = mouseButtonBindingCode(event.button);
    if (!mouseCode) return;
    const dispatchedCode = this.pressedMouseBindings.get(mouseCode);
    if (!dispatchedCode) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.pressedMouseBindings.delete(mouseCode);
    dispatchMouseBinding(dispatchedCode, 'keyup');
  };

  private onGameModuleKeyUp = (event: KeyboardEvent): void => {
    this.gameModules.dispatchKeyUp(event);
    if (this.runtimeModeActive && !event.repeat) {
      this.logic.triggerPlayerEvent('key_released', { key: event.code });
    }
  };

  private onGameModuleBlur = (): void => {
    for (const code of this.pressedMouseBindings.values()) dispatchMouseBinding(code, 'keyup');
    this.pressedMouseBindings.clear();
    this.gameModules.dispatchInputBlur();
  };

  private onRuleKeyDown = (event: KeyboardEvent): void => {
    const shouldDispatchPlayerInteract =
      this.runtimeModeActive &&
      !event.repeat &&
      event.code === this.playerControlBindings.interact;
    handleRuntimeKeyDown(event, {
      isRuntimeActive: () => this.cameraStateBeforeRun !== null,
      playerControlBindings: this.playerControlBindings,
      avatar: this.avatarInstance!,
      world: this.world,
      logic: this.logic,
      gameModules: this.gameModules,
      getActiveMountPackageId: () => this.activeMountPackageId,
      setActiveMountPackageId: id => { this.activeMountPackageId = id },
      getLastMountMovementState: () => this.lastMountMovementState,
      setLastMountMovementState: state => { this.lastMountMovementState = state },
      notifyBehaviorPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
      triggerBehaviorPackageEvent: (ownerObjectId, packageId, eventId) =>
        this.triggerBehaviorPackageEvent(ownerObjectId, packageId, eventId),
    });
    if (this.runtimeModeActive && !event.repeat) {
      this.logic.triggerPlayerEvent('key_pressed', { key: event.code });
    }
    if (shouldDispatchPlayerInteract) {
      this.logic.triggerPlayerEvent('interact', { key: event.code });
    }
  };

  // ========================================================================
  // Imported models
  // ========================================================================

  addImportedModel(name: string, model: THREE.Object3D, targetHeight: number, restoreData?: SceneObjectData): void {
    validateImportedModel(model);

    const importedAnimations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? [];
    if (model.userData.sceneKind !== 'entity' && model.userData.importPart !== true && importedAnimations.length === 0) {
      const spatialParts = splitStaticModelIntoSpatialParts(name, model);
      if (spatialParts) {
        for (const part of spatialParts) {
          this.addImportedModel(`${name} — ${part.label}`, part.model, targetHeight);
        }
        return;
      }
    }

    model.removeFromParent();
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error('O modelo importado não possui geometria visível.');

    const originalSize = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(originalSize.y) || originalSize.y <= 0) {
      throw new Error('Não foi possível calcular a altura do modelo importado.');
    }

    const preferredAnisotropy = Math.min(4, this.viewport.renderer.capabilities.getMaxAnisotropy());
    const { meshCount, triangleCount, importedMeshes } = prepareImportedModelGeometry(
      model,
      name,
      preferredAnisotropy,
      originalSize,
    );

    const { root, height, explicitRoles } = createImportedModelRoot({
      model,
      name,
      targetHeight,
      originalSize,
      restoreData,
      cameraTarget: this.orbit.target,
      groundHeightAt: (x, z) => this.world.terrain.heightAt(x, z),
    });

    const renderedBounds = new THREE.Box3().setFromObject(model);
    const renderedSize = renderedBounds.getSize(new THREE.Vector3());
    const hasAnimatedColliderGeometry = importedMeshes.some(mesh =>
      mesh instanceof THREE.SkinnedMesh || (mesh.geometry.morphAttributes.position?.length ?? 0) > 0,
    );
    const cityFootprint = Math.max(renderedSize.x, renderedSize.z);
    const cityAspectRatio = cityFootprint / Math.max(renderedSize.y, 0.1);
    const isStaticCityLike = importedAnimations.length === 0 &&
      !hasAnimatedColliderGeometry &&
      (
        (cityFootprint >= 18 && triangleCount >= 1_000) ||
        (meshCount >= 36 && cityFootprint >= 8) ||
        (cityFootprint >= 8 && cityAspectRatio >= 3 && triangleCount >= 800)
      );
    console.info('[Engine] Modelo na cena:', {
      name: root.name,
      rootPosition: root.position.toArray(),
      modelPosition: model.position.toArray(),
      bounds: renderedBounds.isEmpty() ? 'empty' : {
        min: renderedBounds.min.toArray(),
        max: renderedBounds.max.toArray(),
      },
      meshesVisible: importedMeshes.filter(mesh => mesh.visible).length,
      meshCount: importedMeshes.length,
    });

    const id = applyImportedModelMetadata(root, model, {
      height,
      restoreData,
      explicitRoles,
      isStaticCityLike,
    });
    const finalId = restoreData?.id ?? id;
    root.userData.id = finalId;
    this.world.add({ id: finalId, name: root.name, type: 'cube', mesh: root });
    void this.modelOcclusion.prepareRoot(root, importedAnimations.length > 0, this.world.scene)
      .then(() => this.modelLod.prepare(finalId, root, importedAnimations.length > 0))
      .then(() => this.viewport.invalidate())
      .catch((error) => {
        console.warn('[Engine] Não foi possível preparar otimizações do modelo:', root.name, error);
      });
    this.world.select(finalId);
    this.state.tool = 'select';
    this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform);
    this.transformControls.attach(root);
    this.emitTool();
  }

  select(id: string | null): void {
    this.world.select(id);
  }

  selectedId(): string | null {
    return this.world.getSelectedId();
  }

  async removeObject(id: string): Promise<void> {
    if (this.avatarInstance!.isMounted() && this.avatarInstance!.getMountedObjectId() === id) await this.dismountActiveMount();
    this.modelLod.remove(id);
    this.world.remove(id);
    this.logic.removeObjectVariables(id);
  }

  renameObject(id: string, name: string): void {
    this.world.rename(id, name);
  }

  updateObject(id: string, patch: ObjectPatch): void {
    if (patch.wireframeVisible === true) this.modelLod.forceOriginal(id);
    this.world.update(id, patch);
    const object = this.world.get(id);
    if (id === this.world.getSelectedId() && object?.mesh.userData.locked === true) this.transformControls.detach();
    else if (id === this.world.getSelectedId() && object) this.transformControls.attach(object.mesh);
  }

  toggleObjectLock(id: string): void {
    const object = this.world.get(id);
    if (!object) return;
    this.world.update(id, { locked: object.mesh.userData.locked !== true });
    if (id === this.world.getSelectedId()) {
      if (object.mesh.userData.locked === true) this.transformControls.detach();
      else this.transformControls.attach(object.mesh);
    }
  }

  groupObjects(ids: string[]): void {
    const unique = [...new Set(ids)].filter(id => this.world.get(id));
    if (unique.length < 2) return;
    const groupId = uuid();
    for (const id of unique) this.world.update(id, { groupId });
  }

  ungroupObjects(ids: string[]): void {
    for (const id of ids) if (this.world.get(id)) this.world.update(id, { groupId: null });
  }

  toggleObjectWireframe(id: string): void {
    const object = this.world.get(id);
    if (!object) return;
    const wireframeVisible = object.mesh.userData.wireframeVisible === false;
    if (wireframeVisible) this.modelLod.forceOriginal(id);
    this.world.update(id, { wireframeVisible });
  }

  listObjects(): ObjectInfo[] {
    return this.world.info();
  }

  listImportedModelNodes(objectId: string): Array<{ path: string; name: string; meshCount: number }> {
    return this.mountModelStateController.listImportedModelNodes(objectId);
  }

  // ========================================================================
  // Mount model states
  // ========================================================================

  private applyMountModelStates(
    instance: BehaviorPackageInstance,
    force = false,
    enabled = instance.enabled,
  ): void {
    this.mountModelStateController.apply(instance, force, enabled);
  }

  // ========================================================================
  // Terrain
  // ========================================================================

  terrainInfo(): TerrainInfo {
    return this.world.terrainInfo();
  }

  setTerrainVisible(visible: boolean): void {
    this.world.setTerrainVisible(visible);
  }

  setRenderDistance(distance: number | null): void {
    this.world.setRenderDistance(distance);
    this.viewport.invalidate();
  }

  setGridVisible(visible: boolean): void {
    this.world.setGridVisible(visible);
  }

  setColliderDebugVisible(visible: boolean): void {
    this.collisions.setDebugVisible(visible);
    this.viewport.invalidate();
  }

  isColliderDebugVisible(): boolean {
    return this.collisions.isDebugVisible();
  }

  isGridVisible(): boolean {
    return this.world.isGridVisible();
  }

  regenerateTerrain(): void {
    this.world.regenerateTerrain(randomSeed());
  }

  clearTerrainEdits(): void {
    this.world.clearTerrainEdits();
  }

  // ========================================================================
  // Project
  // ========================================================================

  async newProject(name = 'Novo Mundo'): Promise<void> {
    this.gameModules.stop();
    this.runtimeModeActive = false;
    resetIds();
    this.meta = { id: uuid(), name };
    this.playerSettings = { ...DEFAULT_PLAYER_SETTINGS };
    this.avatarInstance!.setPlayerSettings(this.playerSettings);
    this.orbit.setFirstPersonMode(false);
    this.avatarInstance!.setFirstPersonMode(false);
    this.orbit.setPreset('free');
    this.events.emit('cameraChanged', { preset: 'free' });
    if (this.avatarInstance!.isMounted() || this.activeMountPackageId) await this.dismountActiveMount();
    this.modelLod.clear();
    if (this.playerModelData) {
      this.playerModelData = null;
      void this.avatarInstance!.resetDefaultModel().catch((error: unknown) => {
        console.warn('[Engine] Não foi possível restaurar o avatar padrão ao criar um projeto novo.', error);
      });
    }
    this.world.replaceAll([], { seed: randomSeed(), visible: true, edits: [] });
    this.world.setEnvironment({ skyTextureDataUrl: '', timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1 });
    this.avatarInstance!.reset();
    this.collisions.clear();
    this.world.setGridVisible(true);
    this.setBrush({ strength: 1.5, radius: 4 });
    this.logic.load();
  }

  exportProject(): ProjectBundle {
    const bundle = buildBundle(this.world.list(), this.world.terrainData(), this.orbit.getState(), this.meta, {
      gridVisible: this.world.isGridVisible(),
      brushStrength: this.state.brush.strength,
      brushRadius: this.state.brush.radius,
    });
    bundle.project.settings.player = { ...this.playerSettings };
    const scenePath = bundle.project.scenes[0] ?? 'main';
    bundle.scenes[scenePath].environment = this.world.getEnvironment();
    if (this.playerModelData) bundle.scenes[scenePath].playerModel = { ...this.playerModelData };
    else delete bundle.scenes[scenePath].playerModel;
    bundle.logic = this.logic.exportData();
    return bundle;
  }

  async loadProject(
    bundle: ProjectBundle,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    this.gameModules.stop();
    this.runtimeModeActive = false;
    this.mountModelStateController.clear();
    const report = (message: string, percent: number) => onProgress?.(message, Math.max(0, Math.min(100, percent)));
    const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    this.orbit.setFirstPersonMode(false);
    this.avatarInstance!.setFirstPersonMode(false);
    if (this.avatarInstance!.isMounted() || this.activeMountPackageId) await this.dismountActiveMount();
    const firstPath = bundle.project.scenes[0] ?? 'main';
    const scene = bundle.scenes[firstPath];
    if (!scene) throw new ProjectFormatError('O projeto não tem nenhuma cena para carregar.');

    resetIds();
    this.meta = { id: bundle.project.id, name: bundle.project.name };
    this.playerSettings = sanitizePlayerSettings(bundle.project.settings.player);
    this.avatarInstance!.setPlayerSettings(this.playerSettings);
    this.orbit.restore(scene.camera);
    this.events.emit('cameraChanged', { preset: scene.camera.preset });

    report('Preparando o terreno e os objetos básicos…', 5);
    const regularObjects = scene.objects.filter(object => !object.importedModelData);
    const restoredObjects: ReturnType<typeof objectFromData>[] = [];
    for (let i = 0; i < regularObjects.length; i += 50) {
      const batch = regularObjects.slice(i, i + 50);
      for (const data of batch) restoredObjects.push(objectFromData(data));
      const percent = regularObjects.length
        ? 5 + Math.round((Math.min(i + batch.length, regularObjects.length) / regularObjects.length) * 20)
        : 25;
      report(`Preparando objetos básicos… ${Math.min(i + batch.length, regularObjects.length)}/${regularObjects.length}`, percent);
      if (i + 50 < regularObjects.length) await yieldToUi();
    }
    this.modelLod.clear();
    await this.world.replaceAllAsync(restoredObjects, scene.terrain, (loaded, total) => {
      const percent = total > 0 ? 25 + Math.round((loaded / total) * 3) : 28;
      report(
        total > 0
          ? `Restaurando grama pintada… ${loaded.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`
          : 'Terreno e grama prontos.',
        percent,
      );
    });
    this.world.setEnvironment(scene.environment ?? { timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1, skyTextureDataUrl: '' });
    report('Terreno pronto. Restaurando modelos 3D…', 28);

    await restoreImportedProjectModels(scene.objects, {
      report,
      yieldToUi,
      addImportedModel: (name, model, height, restoreData) =>
        this.addImportedModel(name, model, height, restoreData),
    });

    this.playerModelData = await restorePlayerModelFromProject(
      scene.playerModel,
      this.playerModelData,
      this.avatarInstance!,
      report,
    );

    report('Finalizando configurações do editor…', 93);
    const editorSettings = bundle.project.settings.editor;
    this.world.setGridVisible(editorSettings.gridVisible);
    this.setBrush({ strength: editorSettings.brushStrength, radius: editorSettings.brushRadius });
    this.logic.load(bundle.logic);

    report('Pré-processando geometria e visibilidade…', 96);
    await this.modelOcclusion.waitForPreparation();
    for (const object of this.world.list()) {
      if (object.mesh.userData.importedModel === true) {
        this.modelOcclusion.restoreObjectVisibility(object.mesh);
      }
    }

    for (const instance of this.logic.listPackages()) {
      if (instance.packageId === 'mount') this.applyMountModelStates(instance, true);
    }

    report('Preparando shaders e recursos gráficos…', 98);
    await this.viewport.precompile(this.world.scene, this.orbit.camera);
    report('Mundo carregado.', 100);
  }

  // ========================================================================
  // Game Modules
  // ========================================================================

  registerGameModule(module: EngineGameModule): () => void {
    return this.gameModules.register(module);
  }

  // ========================================================================
  // Internal helpers
  // ========================================================================

  private updateBehaviorTrees(dt: number): void {
    this.behaviorTreeRuntime.update({
      world: this.world,
      logic: this.logic,
      playerPosition: this.avatarInstance!.mesh.position,
      invalidate: () => this.viewport?.invalidate(),
      notifyPackageChanged: ownerObjectId => this.notifyBehaviorPackageChanged(ownerObjectId),
    }, dt, this.runtimeModeActive);
  }

  private notifyBehaviorPackageChanged(ownerObjectId: string): void {
    this.events.emit('behaviorPackageChanged', { ownerObjectId });
  }

  private triggerBehaviorPackageEvent(ownerObjectId: string, packageId: string, eventId: string): boolean {
    const executed = this.logic.triggerPackageEvent(ownerObjectId, packageId, eventId);
    this.notifyBehaviorPackageChanged(ownerObjectId);
    return executed;
  }

  private async dismountActiveMount(): Promise<void> {
    const packageId = this.activeMountPackageId;
    const packageInstance = packageId
      ? this.logic.listPackages().find(instance => instance.id === packageId)
      : undefined;
    const dismountResult = await this.avatarInstance!.dismount();
    const mountedObjectId = dismountResult.previousPosition ? packageInstance?.ownerObjectId : null;

    if (packageId) {
      this.logic.setPackageVariable(packageId, 'mounted', false);
      this.logic.setPackageVariable(packageId, 'movementState', 'idle');
    }
    this.activeMountPackageId = null;
    this.lastMountMovementState = null;

    if (packageInstance) {
      this.notifyBehaviorPackageChanged(packageInstance.ownerObjectId);
      if (mountedObjectId) {
        this.triggerBehaviorPackageEvent(mountedObjectId, packageInstance.packageId, 'dismounted');
      }
    }
  }

  private onTransformControlChange(): void {
    const id = this.world.getSelectedId();
    const selected = id ? this.world.get(id) : undefined;
    if (!id || !selected) return;
    const mesh = selected.mesh;
    const current = {
      position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
    };
    const previous = this.groupTransformSnapshot;
    if (previous && typeof mesh.userData.groupId === 'string') {
      const groupId = mesh.userData.groupId as string;
      const dx = current.position[0] - previous.position[0];
      const dy = current.position[1] - previous.position[1];
      const dz = current.position[2] - previous.position[2];
      const drx = current.rotation[0] - previous.rotation[0];
      const dry = current.rotation[1] - previous.rotation[1];
      const drz = current.rotation[2] - previous.rotation[2];
      const ratios = current.scale.map((v, i) => previous.scale[i] === 0 ? 1 : v / previous.scale[i]) as [number, number, number];
      const pivot = new THREE.Vector3(previous.position[0], previous.position[1], previous.position[2]);
      const deltaRotation = new THREE.Euler(drx, dry, drz, mesh.rotation.order);
      const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(deltaRotation);
      for (const sibling of this.world.list()) {
        if (sibling.id === id || sibling.mesh.userData.groupId !== groupId || sibling.mesh.userData.locked === true) continue;
        const other = sibling.mesh;
        other.position.sub(pivot);
        other.position.set(other.position.x * ratios[0], other.position.y * ratios[1], other.position.z * ratios[2]);
        other.position.applyMatrix4(rotationMatrix);
        other.position.add(pivot);
        other.position.x += dx; other.position.y += dy; other.position.z += dz;
        other.rotation.x += drx; other.rotation.y += dry; other.rotation.z += drz;
        other.scale.x *= ratios[0]; other.scale.y *= ratios[1]; other.scale.z *= ratios[2];
        this.world.notifyChanged(sibling.id);
      }
    }
    this.groupTransformSnapshot = current;
    this.world.notifyChanged(id);
  }

  private onTransformControlDrag(event: { value: unknown }): void {
    const isDragging = event.value === true;
    if (isDragging) {
      this.state.tool = 'select';
      const id = this.world.getSelectedId();
      const mesh = id ? this.world.get(id)?.mesh : undefined;
      this.groupTransformSnapshot = mesh ? { position: [mesh.position.x, mesh.position.y, mesh.position.z], rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] } : null;
    } else this.groupTransformSnapshot = null;
  }
}