import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { PointerController } from './input/PointerController'
import { createEditorState } from './EditorState'
import type { BrushSettings, EditorState, ToolMode, TransformMode } from './EditorState'
import { randomSeed, resetIds, uuid } from './lib/id'
import type { ObjectInfo, ObjectPatch } from './model/object/GameObject'
import { MAIN_SCENE_PATH } from './project/format'
import type { CameraPreset, ObjectType, PlayerModelData, ProjectBundle, SceneObjectData } from './project/format'
import { buildBundle, objectFromData } from './project/serialize'
import { restoreImportedProjectModels } from './project/ImportedModelProjectRestorer'
import { restorePlayerModelFromProject } from './project/PlayerModelProjectRestorer'
import type { ProjectMeta } from './project/serialize'
import { ProjectFormatError } from './project/validate'
import { OrbitCamera } from './view/OrbitCamera'
import { Viewport } from './view/Viewport'
import type { ViewportRenderStats } from './view/Viewport'
import { clamp, snap } from './lib/math'
import { decodeBase64ArrayBuffer } from './lib/BinaryEncoding'
import { DEFAULT_PLAYER_SETTINGS, sanitizePlayerSettings } from './player/PlayerSettings'
import type { PlayerSettings } from './player/PlayerSettings'
import { World } from './world/World'
import type { GrassRenderOptions } from './world/map/GrassLayer'
import { CollisionSystem } from './world/CollisionSystem'
import { ModelOcclusionSystem } from './world/ModelOcclusionSystem'
import { ModelLodSystem } from './world/ModelLodSystem'
import { HumanoidAvatar } from './world/HumanoidAvatar'
import { validateImportedModel } from './model/validateImportedModel'
import { splitStaticModelIntoSpatialParts } from './model/ImportedModelSpatialGrouping'
import { prepareImportedModelGeometry } from './model/ImportedModelGeometryPreparation'
import { createImportedModelRoot } from './model/ImportedModelRootFactory'
import { prepareCustomPlayerModel } from './model/prepareCustomPlayerModel'
import { applyImportedModelMetadata } from './model/ImportedModelMetadata'
import type { TerrainInfo } from './world/World'
import { RuleEngine } from './script/RuleEngine'
import { AutonomousBehaviorCoordinator } from './script/AutonomousBehaviorCoordinator'
import { EngineBehaviorTreeRuntime } from './script/EngineBehaviorTreeRuntime'
import { MountModelStateController } from './script/MountModelStateController'
import type { LogicRule } from './script/types'
import type { AnimationRole, BehaviorPackageInstance } from './script/packages'
import { DEFAULT_CONTROL_MAPS } from './input/ControlMaps'
import type { ControlMapBindings } from './input/ControlMaps'
import type { Entity } from './model/entity/Entity'
import { GameModuleRegistry } from './runtime/GameModuleRegistry'
import { createRuntimeFrameUpdateHandler } from './runtime/RuntimeFrameCoordinator'
import { BuildComponentPlacementController } from './runtime/BuildComponentPlacementController'
import { EngineVisualSettingsController } from './runtime/EngineVisualSettingsController'
import { configureRuntimeMode } from './runtime/RuntimeModeCoordinator'
import { handleRuntimeKeyDown } from './runtime/RuntimeKeyboardHandler'
import { resolveModelControlBindings } from './script/ModelControlBindings'
import { placeSpawnPlatform } from './world/SpawnPlatformPlacement'
import { dispatchMouseBinding, isInteractiveRuntimeTarget, mouseButtonBindingCode } from './input/RuntimePointerBindings'
import type { EngineGameModule, GameModuleContext } from './runtime/GameModule'
import { EngineFacade } from './core/EngineFacade.js'
import { PRESET_ORDER } from './view/cameraPresets'

export interface EngineOptions {
  /** Módulos de jogos fornecidos pela aplicação que hospeda a engine. */
  gameModules?: readonly EngineGameModule[]
}

/**
 * Engine - Main entry point for the Prometheus Engine.
 *
 * This class maintains 100% backward compatibility with existing code.
 * Internally delegates to EngineFacade which uses EngineCore + subsystems.
 */
export class Engine {
  // Delegate to facade for all public API
  private readonly facade: EngineFacade;

  // --- Public properties (delegated to facade) ---
  public get world() { return this.facade.world; }
  public get collisions() { return this.facade.collisions; }
  public get state(): EditorState { return this.facade.state; }
  public get logic(): RuleEngine { return this.facade.logic; }
  public get events() { return this.facade.events; }
  public get viewport(): Viewport | null { return this.facade.viewport; }
  public get orbit(): OrbitCamera | null { return this.facade.orbit; }
  public get input(): PointerController | null { return this.facade.input; }
  public get terrain() { return this.facade.terrain; }
  public get grass() { return this.facade.grass; }
  public get avatar() { return this.facade.avatar; }

  // --- Transform controls (accessible for editor) ---
  public get transformControls(): TransformControls {
    // Access via facade's internal (would need getter)
    return (this.facade as any).transformControls;
  }

  constructor(canvas: HTMLCanvasElement, options: EngineOptions = {}) {
    this.facade = new EngineFacade(canvas, options);
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  async init(config?: any): Promise<void> {
    return this.facade.init(config);
  }

  async start(): Promise<void> {
    return this.facade.start();
  }

  async stop(): Promise<void> {
    return this.facade.stop();
  }

  async dispose(): Promise<void> {
    return this.facade.dispose();
  }

  // ========================================================================
  // Visual Settings
  // ========================================================================

  setFpsListener(listener: ((fps: number) => void) | null): void {
    this.facade.setFpsListener(listener);
  }

  setRenderStatsListener(listener: ((stats: ViewportRenderStats) => void) | null): void {
    this.facade.setRenderStatsListener(listener);
  }

  setPerformancePreset(preset: 'quality' | 'balanced' | 'economy'): void {
    this.facade.setPerformancePreset(preset);
  }

  setRenderOptions(options: {
    resolutionScale?: number | null;
    fpsLimit?: number | null;
    dynamicResolution?: boolean;
    dynamicResolutionTargetFps?: number;
    dynamicResolutionMinScale?: number;
  }): void {
    this.facade.setRenderOptions(options);
  }

  setGrassRenderOptions(options: GrassRenderOptions): void {
    this.facade.setGrassRenderOptions(options);
  }

  setFogEnabled(enabled: boolean): void {
    this.facade.setFogEnabled(enabled);
  }

  setFogDistanceScale(scale: number): void {
    this.facade.setFogDistanceScale(scale);
  }

  setPerformanceMode(enabled: boolean): void {
    this.facade.setPerformanceMode(enabled);
  }

  // ========================================================================
  // Entity access
  // ========================================================================

  getEntity(id: string): Entity | null {
    return this.facade.getEntity(id);
  }

  listEntities(): Entity[] {
    return this.facade.listEntities();
  }

  // ========================================================================
  // Logic / Rules
  // ========================================================================

  listRules(): LogicRule[] {
    return this.facade.listRules();
  }

  listBehaviorPackages(ownerObjectId?: string): BehaviorPackageInstance[] {
    return this.facade.listBehaviorPackages(ownerObjectId);
  }

  installBehaviorPackage(ownerObjectId: string, packageId: string): BehaviorPackageInstance {
    return this.facade.installBehaviorPackage(ownerObjectId, packageId);
  }

  async updateBehaviorPackage(
    id: string,
    patch: Partial<Pick<BehaviorPackageInstance, 'enabled' | 'variables' | 'config'>>,
  ): Promise<void> {
    return this.facade.updateBehaviorPackage(id, patch);
  }

  async removeBehaviorPackage(id: string): Promise<void> {
    return this.facade.removeBehaviorPackage(id);
  }

  upsertRule(rule: LogicRule): void {
    this.facade.upsertRule(rule);
  }

  removeRule(id: string): void {
    this.facade.removeRule(id);
  }

  moveRule(id: string, direction: -1 | 1): void {
    this.facade.moveRule(id, direction);
  }

  setLogicVariable(name: string, value: boolean | number | string, objectId?: string | null): void {
    this.facade.setLogicVariable(name, value, objectId);
  }

  removeLogicVariable(name: string, objectId?: string | null): boolean {
    return this.facade.removeLogicVariable(name, objectId);
  }

  logicVariables(objectId?: string | null): Record<string, boolean | number | string> {
    return this.facade.logicVariables(objectId);
  }

  // ========================================================================
  // Project meta
  // ========================================================================

  get projectName(): string {
    return this.facade.projectName;
  }

  setProjectName(name: string): void {
    this.facade.setProjectName(name);
  }

  // ========================================================================
  // Tool management
  // ========================================================================

  setTool(tool: ToolMode): void {
    this.facade.setTool(tool);
  }

  setTransform(mode: TransformMode): void {
    this.facade.setTransform(mode);
  }

  setBuildShape(type: ObjectType): void {
    this.facade.setBuildShape(type);
  }

  setBrush(brush: BrushSettings): void {
    this.facade.setBrush(brush);
  }

  // ========================================================================
  // Camera
  // ========================================================================

  get cameraPreset(): CameraPreset {
    return this.facade.cameraPreset;
  }

  // ========================================================================
  // Player model
  // ========================================================================

  getPlayerModelName(): string {
    return this.facade.getPlayerModelName();
  }

  getPlayerModelHeight(): number {
    return this.facade.getPlayerModelHeight();
  }

  hasCustomPlayerModel(): boolean {
    return this.facade.hasCustomPlayerModel();
  }

  getPlayerSettings(): PlayerSettings {
    return this.facade.getPlayerSettings();
  }

  setPlayerSettings(settings: Partial<PlayerSettings>): void {
    this.facade.setPlayerSettings(settings);
  }

  async setPlayerModelHeight(height: number): Promise<void> {
    return this.facade.setPlayerModelHeight(height);
  }

  async setPlayerModel(
    data: ArrayBuffer,
    name: string,
    animationRoles?: Record<string, AnimationRole>,
    height = 1.8,
  ): Promise<void> {
    return this.facade.setPlayerModel(data, name, animationRoles, height);
  }

  async resetPlayerModel(): Promise<void> {
    return this.facade.resetPlayerModel();
  }

  // ========================================================================
  // Controls
  // ========================================================================

  setControlBindings(bindings: ControlMapBindings): void {
    this.facade.setControlBindings(bindings);
  }

  // ========================================================================
  // Runtime mode
  // ========================================================================

  setRuntimeMode(enabled: boolean): void {
    this.facade.setRuntimeMode(enabled);
  }

  triggerPlayerEvent(eventId: string, payload: Record<string, boolean | number | string> = {}): boolean {
    return this.facade.triggerPlayerEvent(eventId, payload);
  }

  setFirstPersonMode(enabled: boolean): void {
    this.facade.setFirstPersonMode(enabled);
  }

  cycleCameraPreset(): CameraPreset {
    return this.facade.cycleCameraPreset();
  }

  // ========================================================================
  // Build component placement
  // ========================================================================

  setBuildComponentPlacement(name: string, model: THREE.Object3D, height: number): void {
    this.facade.setBuildComponentPlacement(name, model, height);
  }

  // ========================================================================
  // Objects
  // ========================================================================

  addPrimitive(type: ObjectType): void {
    this.facade.addPrimitive(type);
  }

  addSpawnPlatform(): void {
    this.facade.addSpawnPlatform();
  }

  addImportedModel(name: string, model: THREE.Object3D, targetHeight: number, restoreData?: SceneObjectData): void {
    this.facade.addImportedModel(name, model, targetHeight, restoreData);
  }

  select(id: string | null): void {
    this.facade.select(id);
  }

  selectedId(): string | null {
    return this.facade.selectedId();
  }

  async removeObject(id: string): Promise<void> {
    return this.facade.removeObject(id);
  }

  renameObject(id: string, name: string): void {
    this.facade.renameObject(id, name);
  }

  updateObject(id: string, patch: ObjectPatch): void {
    this.facade.updateObject(id, patch);
  }

  toggleObjectLock(id: string): void {
    this.facade.toggleObjectLock(id);
  }

  groupObjects(ids: string[]): void {
    this.facade.groupObjects(ids);
  }

  ungroupObjects(ids: string[]): void {
    this.facade.ungroupObjects(ids);
  }

  toggleObjectWireframe(id: string): void {
    this.facade.toggleObjectWireframe(id);
  }

  listObjects(): ObjectInfo[] {
    return this.facade.listObjects();
  }

  listImportedModelNodes(objectId: string): Array<{ path: string; name: string; meshCount: number }> {
    return this.facade.listImportedModelNodes(objectId);
  }

  // ========================================================================
  // Terrain
  // ========================================================================

  terrainInfo(): TerrainInfo {
    return this.facade.terrainInfo();
  }

  setTerrainVisible(visible: boolean): void {
    this.facade.setTerrainVisible(visible);
  }

  setRenderDistance(distance: number | null): void {
    this.facade.setRenderDistance(distance);
  }

  setGridVisible(visible: boolean): void {
    this.facade.setGridVisible(visible);
  }

  setColliderDebugVisible(visible: boolean): void {
    this.facade.setColliderDebugVisible(visible);
  }

  isColliderDebugVisible(): boolean {
    return this.facade.isColliderDebugVisible();
  }

  isGridVisible(): boolean {
    return this.facade.isGridVisible();
  }

  regenerateTerrain(): void {
    this.facade.regenerateTerrain();
  }

  clearTerrainEdits(): void {
    this.facade.clearTerrainEdits();
  }

  // ========================================================================
  // Project
  // ========================================================================

  async newProject(name = 'Novo Mundo'): Promise<void> {
    return this.facade.newProject(name);
  }

  exportProject(): ProjectBundle {
    return this.facade.exportProject();
  }

  async loadProject(
    bundle: ProjectBundle,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    return this.facade.loadProject(bundle, onProgress);
  }

  // ========================================================================
  // Game Modules
  // ========================================================================

  registerGameModule(module: EngineGameModule): () => void {
    return this.facade.registerGameModule(module);
  }
}