/**
 * WorldSubsystem - World and Physics Management
 *
 * Encapsulates World, CollisionSystem, TerrainMesh, GrassLayer, HumanoidAvatar management.
 * Provides high-level world operations without exposing internal implementation.
 */

import { Subsystem, SubsystemConfig, SubsystemContext } from '../core/Subsystem.js';
import { EngineConfig, WorldConfig, WorldSubsystemConfig } from '../core/EngineConfig.js';
import { EngineEventMap, EngineEvents } from '../core/EngineEventBus.js';
import { DIContainer } from '../core/DIContainer.js';

import { World } from '../world/World.js';
import { CollisionSystem } from '../world/CollisionSystem.js';
import { TerrainMesh } from '../world/map/TerrainMesh.js';
import { GrassLayer } from '../world/map/GrassLayer.js';
import { HumanoidAvatar } from '../world/HumanoidAvatar.js';
import type { Heightfield } from '../world/worldGeneration/Heightfield.js';
import type { GameObject } from '../model/object/GameObject.js';
import * as THREE from 'three';
import { createPrimitive } from '../model/object/Primitives.js';
import { PRIMITIVE_DEFS } from '../model/object/defs.js';
import type { ObjectType } from '../project/format.js';
import { reserveId } from '../lib/id.js';

/** Result of a raycast operation */
export interface RaycastResult {
  hit: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  object: GameObject | null;
}

export class WorldSubsystem extends Subsystem {
  // World management
  private world: World | null = null;
  private collisionSystem: CollisionSystem | null = null;
  private terrainMesh: TerrainMesh | null = null;
  private grassLayer: GrassLayer | null = null;
  private avatar: HumanoidAvatar | null = null;

  // Entity tracking
  private entities = new Map<string, GameObject>();
  private entityCounter = 0;

  // Configuration
  private subsystemConfig: WorldSubsystemConfig;

  constructor(config: WorldSubsystemConfig = { name: 'world', autoCreateWorld: true, collisionLayers: [], enableTerrain: true, enableGrass: true, enableAvatar: true, enablePhysics: true }) {
    super({
      priority: 100, // High priority - world needed early
      dependencies: [],
      autoStart: true,
      debug: config.debug ?? false,
      ...config,
    });
    this.subsystemConfig = config;
  }

  // === Lifecycle ===

  protected async onInitialize(context: SubsystemContext): Promise<void> {
    this.log('Initializing WorldSubsystem...');

    // Get world config
    const worldConfig = context.config.world;
    const subsystemConfig = context.config.subsystems.world;

    // Create world if auto-create enabled
    if (this.subsystemConfig.autoCreateWorld ?? subsystemConfig.autoCreateWorld) {
      await this.createWorld(worldConfig);
    }

    // Initialize physics
    await this.initializePhysics(worldConfig);

    // Initialize terrain if enabled
    if (this.subsystemConfig.enableTerrain ?? subsystemConfig.enableTerrain) {
      await this.initializeTerrain();
    }

    // Initialize grass if enabled
    if (this.subsystemConfig.enableGrass ?? subsystemConfig.enableGrass) {
      await this.initializeGrass();
    }

    // Initialize avatar if enabled
    if (this.subsystemConfig.enableAvatar ?? subsystemConfig.enableAvatar) {
      await this.initializeAvatar();
    }

    // Register collision layers (placeholder - CollisionSystem doesn't have this)
    this.registerCollisionLayers(subsystemConfig.collisionLayers);

    this.log('WorldSubsystem initialized');
  }

  protected async onStart(): Promise<void> {
    this.log('Starting WorldSubsystem...');

    // Start physics simulation
    if (this.collisionSystem) {
      // Physics system is stepped manually in onFixedUpdate
    }

    // Emit world created event
    if (this.world) {
      this.emit(EngineEvents.WORLD_CREATED, { worldId: 'main', timestamp: Date.now() });
    }
  }

  protected async onStop(): Promise<void> {
    this.log('Stopping WorldSubsystem...');

    // Stop physics
    if (this.collisionSystem) {
      // Nothing special needed - stepped in onFixedUpdate
    }
  }

  protected async onDispose(): Promise<void> {
    this.log('Disposing WorldSubsystem...');

    // Dispose avatar
    if (this.avatar) {
      this.avatar.dispose();
      this.avatar = null;
    }

    // Dispose grass
    if (this.grassLayer) {
      this.grassLayer.dispose();
      this.grassLayer = null;
    }

    // Dispose terrain
    if (this.terrainMesh) {
      this.terrainMesh.dispose();
      this.terrainMesh = null;
    }

    // Dispose collision system
    if (this.collisionSystem) {
      this.collisionSystem.dispose();
      this.collisionSystem = null;
    }

    // Dispose world - we need to clean up objects manually
    if (this.world) {
      this.emit(EngineEvents.WORLD_DISPOSED, { worldId: 'main', timestamp: Date.now() });
      // World doesn't have public dispose, clean up objects
      for (const obj of this.world.list()) {
        this.world.remove(obj.id);
      }
      this.world = null;
    }

    // Clear entities
    this.entities.clear();
  }

  protected onUpdate(deltaTime: number, time: number): void {
    // Update terrain
    if (this.terrainMesh) {
      // Terrain updates are event-driven, not per-frame
    }

    // Update grass
    if (this.grassLayer) {
      // GrassLayer has its own update cycle via updateVisibility
    }

    // Update avatar
    if (this.avatar) {
      this.avatar.update(deltaTime);
    }
  }

  protected onFixedUpdate(deltaTime: number): void {
    // Fixed timestep physics - CollisionSystem.update(simulateContacts)
    if (this.collisionSystem && this.world) {
      this.collisionSystem.update(true);
    }
  }

  protected onLateUpdate(deltaTime: number, time: number): void {
    // Late updates (e.g., avatar IK) - avatar already handles this internally
  }

  protected onResizeImpl(width: number, height: number): void {
    // Update world bounds if needed
  }

  protected onRuntimeModeChangeImpl(from: string, to: string): void {
    // Handle runtime mode changes
    if (to === 'play') {
      // Enable physics simulation
    } else if (to === 'editor') {
      // Pause physics, enable gizmos
    }
  }

  // === World Management ===

  async createWorld(config: WorldConfig): Promise<World> {
    if (this.world) {
      this.logWarn('World already exists, disposing previous');
      await this.disposeWorld();
    }

    this.log('Creating world...');

    this.world = new World();
    // World constructor handles initialization

    // Register in DI container
    this.container?.registerInstance('world:world', this.world);

    this.emit(EngineEvents.WORLD_CREATED, { worldId: 'main', timestamp: Date.now() });
    return this.world;
  }

  async disposeWorld(): Promise<void> {
    if (!this.world) return;

    this.emit(EngineEvents.WORLD_DISPOSED, { worldId: 'main', timestamp: Date.now() });
    // Clean up all objects
    for (const obj of this.world.list()) {
      this.world.remove(obj.id);
    }
    this.world = null;
  }

  getWorld(): World | null {
    return this.world;
  }

  requireWorld(): World {
    if (!this.world) {
      throw new Error('World not initialized');
    }
    return this.world;
  }

  // === Physics ===

  private async initializePhysics(config: WorldConfig): Promise<void> {
    this.log('Initializing physics...');

    if (!this.world) {
      throw new Error('World must be initialized before physics');
    }

    this.collisionSystem = new CollisionSystem(this.world);

    // Register in DI container
    this.container?.registerInstance('world:collisionSystem', this.collisionSystem);
  }

  getCollisionSystem(): CollisionSystem | null {
    return this.collisionSystem;
  }

  // === Terrain ===

  private async initializeTerrain(): Promise<void> {
    this.log('Initializing terrain...');

    if (!this.world) {
      throw new Error('World must be initialized before terrain');
    }

    // TerrainMesh is created inside World constructor
    this.terrainMesh = this.world.terrain;

    // The grass layer is part of TerrainMesh
    this.grassLayer = this.terrainMesh.grass;

    this.container?.registerInstance('world:terrainMesh', this.terrainMesh);
    this.container?.registerInstance('world:grassLayer', this.grassLayer);
  }

  getTerrain(): TerrainMesh | null {
    return this.terrainMesh;
  }

  // === Grass ===

  private async initializeGrass(): Promise<void> {
    this.log('Initializing grass...');

    // GrassLayer is already created as part of TerrainMesh
    if (!this.grassLayer && this.terrainMesh) {
      this.grassLayer = this.terrainMesh.grass;
    }

    if (this.grassLayer) {
      this.container?.registerInstance('world:grassLayer', this.grassLayer);
    }
  }

  getGrass(): GrassLayer | null {
    return this.grassLayer;
  }

  // === Avatar ===

  private async initializeAvatar(): Promise<void> {
    this.log('Initializing avatar...');

    if (!this.world) {
      throw new Error('World must be initialized before avatar');
    }

    // Create camera target and getCameraYaw for HumanoidAvatar
    const cameraTarget = new THREE.Vector3();
    const getCameraYaw = () => 0; // Will be updated by RenderSubsystem

    this.avatar = new HumanoidAvatar(this.world, cameraTarget, getCameraYaw);

    this.container?.registerInstance('world:avatar', this.avatar);
    this.container?.registerInstance('world:cameraTarget', cameraTarget);
    this.container?.registerInstance('world:getCameraYaw', getCameraYaw);
  }

  getAvatar(): HumanoidAvatar | null {
    return this.avatar;
  }

  // === Entity Management ===

  createEntity(name?: string): GameObject {
    if (!this.world) {
      throw new Error('World not initialized');
    }

    const id = `entity_${++this.entityCounter}`;
    const entityName = name || id;

    // Create a primitive object at origin
    const obj = createPrimitive('cube', { position: [0, 0.5, 0] });
    obj.id = id;
    obj.name = entityName;

    this.world.add(obj);
    this.entities.set(id, obj);
    this.emit(EngineEvents.WORLD_ENTITY_ADDED, { entity: obj as any, timestamp: Date.now() });

    return obj;
  }

  removeEntity(entity: GameObject | string): boolean {
    const id = typeof entity === 'string' ? entity : entity.id;
    const ent = this.entities.get(id);

    if (!ent) return false;

    this.entities.delete(id);
    this.emit(EngineEvents.WORLD_ENTITY_REMOVED, { entity: ent as any, timestamp: Date.now() });

    this.world?.remove(id);

    return true;
  }

  getEntity(id: string): GameObject | undefined {
    return this.entities.get(id);
  }

  getAllEntities(): GameObject[] {
    return Array.from(this.entities.values());
  }

  // === Collision Layers ===

  private registerCollisionLayers(layers: string[]): void {
    // CollisionSystem doesn't have registerLayers method
    // This is a placeholder for future implementation
    if (this.collisionSystem && layers.length > 0) {
      this.logWarn('CollisionSystem.registerLayers not implemented');
    }
  }

  // === Raycasting ===

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance = Infinity): RaycastResult {
    // CollisionSystem doesn't have raycast - implement basic raycast using Three.js
    if (!this.world) {
      return { hit: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, object: null };
    }

    const raycaster = new THREE.Raycaster(origin, direction.normalize(), 0, maxDistance);
    const pickables = this.world.list()
      .filter(o => this.world!.isObjectVisible(o))
      .map(o => o.mesh);

    const intersects = raycaster.intersectObjects(pickables, true);

    if (intersects.length > 0) {
      const hit = intersects[0];
      // Find the GameObject from the mesh
      let hitObject: GameObject | null = null;
      for (const obj of this.world.list()) {
        if (obj.mesh === hit.object || obj.mesh.getObjectByProperty('uuid', hit.object.uuid)) {
          hitObject = obj;
          break;
        }
      }
      return {
        hit: true,
        point: hit.point,
        normal: hit.face?.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() ?? new THREE.Vector3(0, 1, 0),
        distance: hit.distance,
        object: hitObject,
      };
    }

    return { hit: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, object: null };
  }

  // === Gravity ===

  setGravity(gravity: THREE.Vector3): void {
    // CollisionSystem doesn't have setGravity - gravity is configured via WorldConfig
    if (this.config) {
      this.config.world.gravity = { x: gravity.x, y: gravity.y, z: gravity.z };
    }
  }

  getGravity(): THREE.Vector3 {
    const g = this.config?.world.gravity ?? { x: 0, y: -9.81, z: 0 };
    return new THREE.Vector3(g.x, g.y, g.z);
  }
}