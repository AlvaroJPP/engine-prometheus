/**
 * MountSubsystem - Universal Mount/Seat System
 *
 * Encapsulates MountSystem, MountController, MountAnimationMapper.
 * Provides high-level mounting operations with DI integration.
 */

import { Subsystem, SubsystemConfig, SubsystemContext } from '../core/Subsystem.js';
import { EngineConfig } from '../core/EngineConfig.js';
import { EngineEventMap, EngineEvents } from '../core/EngineEventBus.js';
import { DIContainer } from '../core/DIContainer.js';

import { MountSystem } from '../mount/MountSystem.js';
import { MountController, createMountController, EngineMountControllerContext } from '../mount/MountController.js';
import { MountAnimationMapper, createDefaultAnimationMapping } from '../mount/MountAnimationMapper.js';
import type { MountAnimationMapping } from '../mount/MountPoint.js';
import { HumanoidAvatar } from '../world/HumanoidAvatar.js';
import { World } from '../world/World.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { CollisionSystem } from '../world/CollisionSystem.js';
import * as THREE from 'three';

/** Mount subsystem configuration */
export interface MountSubsystemConfig {
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

  /** Auto-create mount controller on init */
  autoCreateController?: boolean;

  /** Default control bindings for mounting */
  defaultControlBindings?: Record<string, string>;

  /** Enable mount system by default */
  enabled?: boolean;
}

export class MountSubsystem extends Subsystem {
  // Core mount systems
  private mountSystem: MountSystem | null = null;
  private mountController: MountController | null = null;
  private animationMapping: MountAnimationMapping | null = null;

  // Dependencies (resolved from other subsystems)
  private world: World | null = null;
  private physicsWorld: PhysicsWorld | null = null;
  private collisionSystem: CollisionSystem | null = null;
  private avatar: HumanoidAvatar | null = null;
  private cameraYawGetter: (() => number) | null = null;

  // Configuration
  private subsystemConfig: MountSubsystemConfig;

  constructor(config: MountSubsystemConfig = {
    name: 'mount',
    autoCreateController: true,
    enabled: true,
    debug: false,
  }) {
    super({
      priority: 60, // After input (70), render (80), world (100)
      dependencies: ['world', 'render', 'input'],
      autoStart: true,
      debug: config.debug ?? false,
      ...config,
    });
    this.subsystemConfig = config;
  }

  // === Lifecycle ===

  protected async onInitialize(context: SubsystemContext): Promise<void> {
    this.log('Initializing MountSubsystem...');

    // Resolve dependencies from DI container (set by other subsystems)
    await this.resolveDependencies();

    // Create animation mapping
    this.animationMapping = createDefaultAnimationMapping();

    // Register in DI
    this.container?.registerInstance('mount:animationMapping', this.animationMapping);
    this.container?.registerInstance('mount:subsystem', this);

    // Create mount system if we have required dependencies
    if (this.world && this.physicsWorld && this.avatar && this.collisionSystem) {
      await this.createMountSystem();
    } else {
      this.logWarn('MountSystem dependencies not fully available, will create in onStart');
    }

    this.log('MountSubsystem initialized');
  }

  protected async onStart(): Promise<void> {
    this.log('Starting MountSubsystem...');

    // Ensure mount system is created now that all subsystems are initialized
    if (!this.mountSystem && this.world && this.physicsWorld && this.avatar && this.collisionSystem) {
      await this.createMountSystem();
    }

    // Create mount controller if enabled
    if (this.subsystemConfig.autoCreateController && this.mountSystem) {
      await this.createMountController();
    }

    // Emit module started event (using existing event)
    if (this.mountSystem) {
      this.emit(EngineEvents.MODULE_STARTED, {
        moduleId: 'mount',
        timestamp: Date.now(),
      });
    }
  }

  protected async onStop(): Promise<void> {
    this.log('Stopping MountSubsystem...');

    // Stop mount controller
    if (this.mountController) {
      this.mountController.dispose();
      this.mountController = null;
    }
  }

  protected async onDispose(): Promise<void> {
    this.log('Disposing MountSubsystem...');

    // Dispose mount controller
    if (this.mountController) {
      this.mountController.dispose();
      this.mountController = null;
    }

    // Dispose mount system
    if (this.mountSystem) {
      this.mountSystem.dispose();
      this.mountSystem = null;
    }

    // Clear animation mapping reference
    this.animationMapping = null;

    // Clear references
    this.world = null;
    this.physicsWorld = null;
    this.collisionSystem = null;
    this.avatar = null;
    this.cameraYawGetter = null;
  }

  protected onUpdate(deltaTime: number, time: number): void {
    if (this.mountController) {
      this.mountController.update(deltaTime);
    } else if (this.mountSystem) {
      this.mountSystem.update(deltaTime);
    }
  }

  protected onFixedUpdate(deltaTime: number): void {
    // Mount system handles its own fixed updates internally
  }

  protected onRuntimeModeChangeImpl(from: string, to: string): void {
    this.log(`Runtime mode change: ${from} -> ${to}`);

    if (to === 'play') {
      // Ensure mount controller is active for gameplay
      if (this.mountSystem && !this.mountController && this.subsystemConfig.autoCreateController) {
        this.createMountController();
      }
    } else if (to === 'editor') {
      // In editor, we might want to disable automatic mounting
      // but keep the system available for testing
    }
  }

  // === Dependency Resolution ===

  private async resolveDependencies(): Promise<void> {
    // Get World from WorldSubsystem
    this.world = this.container?.resolve<World>('world:world') ?? null;
    if (!this.world) {
      this.logWarn('World not available in DI container');
    }

    // Get PhysicsWorld from WorldSubsystem
    this.physicsWorld = this.container?.resolve<PhysicsWorld>('world:physicsWorld') ?? null;
    if (!this.physicsWorld) {
      this.logWarn('PhysicsWorld not available in DI container');
    }

    // Get CollisionSystem from WorldSubsystem
    this.collisionSystem = this.container?.resolve<CollisionSystem>('world:collisionSystem') ?? null;
    if (!this.collisionSystem) {
      this.logWarn('CollisionSystem not available in DI container');
    }

    // Get Avatar from WorldSubsystem
    this.avatar = this.container?.resolve<HumanoidAvatar>('world:avatar') ?? null;
    if (!this.avatar) {
      this.logWarn('HumanoidAvatar not available in DI container');
    }

    // Get camera yaw getter from RenderSubsystem
    const orbitCamera = this.container?.resolve<any>('render:orbitCamera');
    if (orbitCamera && typeof orbitCamera.getYaw === 'function') {
      this.cameraYawGetter = () => orbitCamera.getYaw();
    } else {
      this.logWarn('OrbitCamera not available for camera yaw');
      // Fallback
      this.cameraYawGetter = () => 0;
    }
  }

  // === Mount System Creation ===

  private async createMountSystem(): Promise<void> {
    if (!this.world || !this.physicsWorld || !this.avatar || !this.collisionSystem) {
      throw new Error('Cannot create MountSystem: missing required dependencies');
    }

    this.log('Creating MountSystem...');

    // Get visual root from avatar (avatar.mesh is a Group, find the visual root inside)
    const playerVisualRoot = this.findVisualRoot(this.avatar.mesh);

    // For collision mesh, we'll use the visual root (the avatar handles collisions internally)
    const playerCollisionMesh = playerVisualRoot;

    // Create camera target updater
    const updateCameraTarget = (position: THREE.Vector3): void => {
      const orbitCam = this.container?.resolve<any>('render:orbitCamera');
      if (orbitCam && typeof orbitCam.setTarget === 'function') {
        orbitCam.setTarget(position);
      }
    };

    // Create collision check function using WorldSubsystem's collision system
    // Since CollisionSystem doesn't have a simple checkCollision, we'll use physics raycast
    const collidesWithObjects = (mesh: THREE.Mesh): boolean => {
      // Use physics world raycast if available
      if (this.physicsWorld && typeof this.physicsWorld.raycast === 'function') {
        const position = mesh.position.clone();
        const result = this.physicsWorld.raycast(position, new THREE.Vector3(0, -1, 0), 10);
        // RayColliderToi has 'toi' (time of impact), hit means toi is not null/undefined
        return result?.toi !== undefined && result?.toi !== null;
      }
      // Fallback: return false as conservative estimate
      return false;
    };

    // Create MountSystemContext with the required interface
    // Note: Some functions use avatar's private methods via fallback constants
    const PLAYER_RADIUS = 0.5;
    const PLAYER_HEIGHT = 1.8;

    const context: EngineMountControllerContext = {
      world: this.world,
      physicsWorld: this.physicsWorld,
      playerVisualRoot,
      playerCollisionMesh,
      getCameraYaw: this.cameraYawGetter!,
      getPlayerRadius: () => PLAYER_RADIUS,
      getStandingPlayerHeight: () => PLAYER_HEIGHT,
      getBodyScale: () => 1.0,
      collidesWithObjects,
      updateCameraTarget,
      emitScriptEvent: (eventName: string, data: Record<string, unknown>) => {
        this.emit(EngineEvents.SCRIPT_TRIGGER, {
          eventId: eventName,
          scope: 'global',
          payload: data,
          timestamp: Date.now(),
        });
      },
      getScriptVariable: (_name: string, _objectId?: string) => undefined,
      setScriptVariable: (_name: string, _value: unknown, _objectId?: string) => {},
    };

    this.mountSystem = new MountSystem(context);
    await this.mountSystem.initialize();

    // Register in DI
    this.container?.registerInstance('mount:system', this.mountSystem);
  }

  private async createMountController(): Promise<void> {
    if (!this.mountSystem || !this.world || !this.physicsWorld || !this.avatar || !this.collisionSystem) {
      throw new Error('Cannot create MountController: missing required dependencies');
    }

    this.log('Creating MountController...');

    const playerVisualRoot = this.findVisualRoot(this.avatar.mesh);
    const playerCollisionMesh = playerVisualRoot;

    const PLAYER_RADIUS = 0.5;
    const PLAYER_HEIGHT = 1.8;

    this.mountController = createMountController({
      world: this.world,
      physicsWorld: this.physicsWorld,
      playerVisualRoot,
      playerCollisionMesh,
      getCameraYaw: this.cameraYawGetter!,
      getPlayerRadius: () => PLAYER_RADIUS,
      getStandingPlayerHeight: () => PLAYER_HEIGHT,
      getBodyScale: () => 1.0,
      collidesWithObjects: (mesh: THREE.Mesh) => {
        // Use physics world raycast if available
        if (this.physicsWorld && typeof this.physicsWorld.raycast === 'function') {
          const position = mesh.position.clone();
          const result = this.physicsWorld.raycast(position, new THREE.Vector3(0, -1, 0), 10);
          // RayColliderToi has 'toi' (time of impact), hit means toi is not null/undefined
          return result?.toi !== undefined && result?.toi !== null;
        }
        return false;
      },
      updateCameraTarget: (position: THREE.Vector3) => {
        const orbitCam = this.container?.resolve<any>('render:orbitCamera');
        if (orbitCam && typeof orbitCam.setTarget === 'function') {
          orbitCam.setTarget(position);
        }
      },
      emitScriptEvent: (eventName: string, data: Record<string, unknown>) => {
        this.emit(EngineEvents.SCRIPT_TRIGGER, {
          eventId: eventName,
          scope: 'global',
          payload: data,
          timestamp: Date.now(),
        });
      },
      getScriptVariable: (_name: string, _objectId?: string) => undefined,
      setScriptVariable: (_name: string, _value: unknown, _objectId?: string) => {},
    });

    await this.mountController.initialize();

    // Update DI registration
    this.container?.registerInstance('mount:controller', this.mountController);

    this.log('MountController created and initialized');
  }

  /**
   * Find the visual root mesh within the avatar's group hierarchy.
   * The avatar.mesh is a THREE.Group containing the visualRoot group.
   * We traverse to find the first Mesh.
   */
  private findVisualRoot(group: THREE.Group): THREE.Mesh {
    let foundMesh: THREE.Mesh | null = null;
    group.traverse((object) => {
      if (object instanceof THREE.Mesh && !foundMesh) {
        foundMesh = object;
      }
    });
    // If no mesh found, create a dummy mesh
    if (!foundMesh) {
      foundMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1.8, 1),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      group.add(foundMesh);
    }
    return foundMesh;
  }

  // === Public API ===

  /** Get the MountSystem instance */
  getMountSystem(): MountSystem | null {
    return this.mountSystem;
  }

  /** Get the MountController instance */
  getMountController(): MountController | null {
    return this.mountController;
  }

  /** Get the MountAnimationMapping instance */
  getAnimationMapping(): MountAnimationMapping | null {
    return this.animationMapping;
  }

  /** Check if mount system is available */
  isMountSystemReady(): boolean {
    return this.mountSystem !== null && this.mountController !== null;
  }

  /** Try to mount on a nearby object */
  async tryMount(nearbyObjects: THREE.Mesh[]): Promise<{ success: boolean; error?: string }> {
    if (!this.mountController) {
      return { success: false, error: 'Mount controller not initialized' };
    }
    return this.mountController.tryMount(nearbyObjects);
  }

  /** Mount on a specific object */
  async mount(targetObject: THREE.Mesh, mountPointId?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.mountController) {
      return { success: false, error: 'Mount controller not initialized' };
    }
    return this.mountController.mount(targetObject, mountPointId);
  }

  /** Dismount from current mount */
  async dismount(): Promise<{ success: boolean; error?: string }> {
    if (!this.mountController) {
      return { success: false, error: 'Mount controller not initialized' };
    }
    return this.mountController.dismount();
  }

  /** Check if currently mounted */
  isMounted(): boolean {
    return this.mountController?.isMounted() ?? false;
  }

  /** Get current mount state */
  getMountState() {
    return this.mountController?.getState();
  }

  /** Register mount script actions/conditions/triggers */
  async registerScriptExtensions(
    registerAction: (name: string, handler: any) => void,
    registerCondition: (name: string, handler: any) => void,
    registerTrigger: (name: string, handler: any) => void
  ): Promise<void> {
    // Import the registration functions
    const { registerMountScriptActions, registerMountScriptConditions, registerMountScriptTriggers } =
      await import('../mount/MountController.js');

    registerMountScriptActions(registerAction);
    registerMountScriptConditions(registerCondition);
    registerMountScriptTriggers(registerTrigger);
  }
}