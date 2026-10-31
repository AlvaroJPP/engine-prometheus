import { Subsystem, SubsystemConfig, SubsystemContext } from '../core/Subsystem.js';
import { EngineConfig, MountSubsystemConfig } from '../core/EngineConfig.js';
import { EngineEventMap, EngineEvents } from '../core/EngineEventBus.js';
import { DIContainer } from '../core/DIContainer.js';
import * as THREE from 'three';

// Import mount system types
import type {
  MountPoint,
  MountConfig,
  MountState,
  MountMovementState,
  MountBehaviorConfig,
  MountControlBindings,
  MountResult,
  DismountResult,
  MountSystemContext,
  MountInput,
  MountError,
  DismountError,
  MountAnimationRole,
} from '../mount/MountPoint.js';

import { MountSystem } from '../mount/MountSystem.js';
import { MountController, createMountController, EngineMountControllerContext } from '../mount/MountController.js';
import { MountAnimationMapper, createDefaultAnimationMapping } from '../mount/MountAnimationMapper.js';
import { World } from '../world/World.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { HumanoidAvatar } from '../world/HumanoidAvatar.js';

/**
 * MountSubsystem - Integrates the mount system with the engine lifecycle and DI container
 * Priority: 70 (after InputSubsystem at 80, before RenderSubsystem at 90)
 * Dependencies: ['world', 'render', 'input']
 */
export class MountSubsystem extends Subsystem {
  private mountSystem: MountSystem | null = null;
  private mountController: MountController | null = null;
  private animationMapper: MountAnimationMapper | null = null;
  private subsystemConfig: MountSubsystemConfig;

  constructor(config: MountSubsystemConfig = {
    name: 'mount',
    enabled: true,
    autoCreateController: true,
    defaultControlBindings: {},
  }) {
    super(config);
    this.subsystemConfig = config;
  }

  protected async onInitialize(context: SubsystemContext): Promise<void> {
    this.log('Initializing MountSubsystem...');

    // Check if mount subsystem is enabled
    if (!this.subsystemConfig.enabled) {
      this.log('MountSubsystem is disabled, skipping initialization');
      return;
    }

    // Resolve required dependencies from other subsystems
    const worldSubsystem = context.engine.getSubsystem<WorldSubsystem>('world');
    const renderSubsystem = context.engine.getSubsystem<RenderSubsystem>('render');
    const inputSubsystem = context.engine.getSubsystem<InputSubsystem>('input');

    if (!worldSubsystem) {
      throw new Error('MountSubsystem requires WorldSubsystem to be registered');
    }
    if (!renderSubsystem) {
      throw new Error('MountSubsystem requires RenderSubsystem to be registered');
    }
    if (!inputSubsystem) {
      throw new Error('MountSubsystem requires InputSubsystem to be registered');
    }

    const world = worldSubsystem.getWorld();
    const avatar = worldSubsystem.getAvatar();

    if (!world) {
      throw new Error('MountSubsystem requires World to be initialized in WorldSubsystem');
    }

    // Get camera yaw function from render subsystem
    const getCameraYaw = () => {
      const camera = renderSubsystem.getActiveCamera();
      if (camera && 'getYaw' in camera) {
        return (camera as any).getYaw();
      }
      return 0;
    };

    // Get player visual and collision mesh from avatar
    // HumanoidAvatar extends THREE.Object3D and has a mesh property
    let playerVisualRoot: THREE.Mesh | null = null;
    let playerCollisionMesh: THREE.Mesh | null = null;

    if (avatar) {
      // The avatar's visual root is its mesh or the avatar itself
      if (avatar.mesh && avatar.mesh instanceof THREE.Mesh) {
        playerVisualRoot = avatar.mesh;
      } else if (avatar instanceof THREE.Mesh) {
        playerVisualRoot = avatar;
      }

      // For collision mesh, check if avatar has a collision mesh
      // In HumanoidAvatar, the collision is handled internally, so we use the visual mesh
      playerCollisionMesh = playerVisualRoot;
    }

    if (!playerVisualRoot) {
      this.logWarn('Player visual root not found, mount system may not work correctly');
    }
    if (!playerCollisionMesh) {
      this.logWarn('Player collision mesh not found, mount system may not work correctly');
    }

    // PhysicsWorld is optional - if not available, mount system will use raycasting
    // Note: WorldSubsystem doesn't create PhysicsWorld by default, only CollisionSystem
    // We'll pass undefined for physicsWorld and let MountSystem handle it
    const physicsWorld: PhysicsWorld | null = null;

    // Create mount system context
    const mountContext: MountSystemContext = {
      world: world as unknown as World,
      physicsWorld: physicsWorld as unknown as PhysicsWorld,
      playerVisualRoot: playerVisualRoot!,
      playerCollisionMesh: playerCollisionMesh!,
      getCameraYaw,
      getPlayerRadius: () => 0.5, // Default radius, could be enhanced later
      getStandingPlayerHeight: () => 1.8, // Default height
      getBodyScale: () => 1, // Default scale
      collidesWithObjects: (mesh: THREE.Mesh) => worldSubsystem.raycast(mesh.position, new THREE.Vector3(0, -1, 0), 2).hit,
      updateCameraTarget: (position: THREE.Vector3) => {
        const camera = renderSubsystem.getActiveCamera();
        if (camera && 'setTarget' in camera) {
          (camera as any).setTarget(position);
        }
      },
      emitScriptEvent: (eventName: string, data: Record<string, unknown>) => {
        context.events.emit('script:event' as any, { eventName, data });
      },
      getScriptVariable: (name: string, objectId?: string) => {
        // TODO: Integrate with script system
        return undefined;
      },
      setScriptVariable: (name: string, value: unknown, objectId?: string) => {
        // TODO: Integrate with script system
      },
    };

    // Create and initialize mount system
    this.mountSystem = new MountSystem(mountContext);
    await this.mountSystem.initialize();

    // Create animation mapper
    this.animationMapper = new MountAnimationMapper(createDefaultAnimationMapping());

    // Register mount system in DI container
    this.container?.registerInstance('mount:system', this.mountSystem);
    this.container?.registerInstance('mount:animationMapper', this.animationMapper);

    // Create mount controller if enabled
    if (this.subsystemConfig.autoCreateController) {
      const controllerContext: EngineMountControllerContext = {
        world: world as unknown as World,
        physicsWorld: physicsWorld as unknown as PhysicsWorld,
        playerVisualRoot: playerVisualRoot!,
        playerCollisionMesh: playerCollisionMesh!,
        getCameraYaw,
        getPlayerRadius: mountContext.getPlayerRadius,
        getStandingPlayerHeight: mountContext.getStandingPlayerHeight,
        getBodyScale: mountContext.getBodyScale,
        collidesWithObjects: mountContext.collidesWithObjects,
        updateCameraTarget: mountContext.updateCameraTarget,
        emitScriptEvent: mountContext.emitScriptEvent,
        getScriptVariable: mountContext.getScriptVariable,
        setScriptVariable: mountContext.setScriptVariable,
      };

      this.mountController = createMountController(controllerContext);
      await this.mountController.initialize();

      // Register mount controller in DI container
      this.container?.registerInstance('mount:controller', this.mountController);
    }

    // Register default control bindings if provided
    if (this.subsystemConfig.defaultControlBindings) {
      this.container?.registerInstance('mount:defaultControlBindings', this.subsystemConfig.defaultControlBindings);
    }

    this.log('MountSubsystem initialized');
  }

  protected async onStart(): Promise<void> {
    this.log('Starting MountSubsystem...');
    // Mount system doesn't need a separate start phase
  }

  protected async onStop(): Promise<void> {
    this.log('Stopping MountSubsystem...');
    // Could pause mount system updates here if needed
  }

  protected async onDispose(): Promise<void> {
    this.log('Disposing MountSubsystem...');

    if (this.mountController) {
      this.mountController.dispose();
      this.mountController = null;
    }

    if (this.mountSystem) {
      this.mountSystem.dispose();
      this.mountSystem = null;
    }

    if (this.animationMapper) {
      this.animationMapper.dispose();
      this.animationMapper = null;
    }

    // Clear DI registrations
    this.container?.registerInstance('mount:system', null as any);
    this.container?.registerInstance('mount:controller', null as any);
    this.container?.registerInstance('mount:animationMapper', null as any);
    this.container?.registerInstance('mount:defaultControlBindings', null as any);
  }

  protected onUpdate(deltaTime: number, time: number): void {
    if (this.mountSystem) {
      this.mountSystem.update(deltaTime);
    }
    if (this.animationMapper) {
      this.animationMapper.update(deltaTime);
    }
  }

  protected onFixedUpdate(deltaTime: number): void {
    // Mount system doesn't need fixed update
  }

  protected onLateUpdate(deltaTime: number, time: number): void {
    // Mount system doesn't need late update
  }

  protected onResizeImpl(width: number, height: number): void {
    // No resize handling needed
  }

  protected onRuntimeModeChangeImpl(from: string, to: string): void {
    this.log(`Runtime mode changed: ${from} -> ${to}`);
    // Could adjust mount behavior based on mode (editor/play/headless)
  }

  // Public accessors for the mount system
  getMountSystem(): MountSystem | null {
    return this.mountSystem;
  }

  getMountController(): MountController | null {
    return this.mountController;
  }

  getAnimationMapper(): MountAnimationMapper | null {
    return this.animationMapper;
  }

  isMountSystemEnabled(): boolean {
    return this.subsystemConfig.enabled && this.mountSystem !== null;
  }

  // Forward methods from mount system for convenience
  async mount(targetObject: THREE.Mesh, preferredMountPointId?: string): Promise<MountResult | null> {
    if (!this.mountSystem) return null;
    return this.mountSystem.mount(targetObject, preferredMountPointId);
  }

  async dismount(): Promise<DismountResult | null> {
    if (!this.mountSystem) return null;
    return this.mountSystem.dismount();
  }

  isMounted(): boolean {
    return this.mountSystem?.isMounted() ?? false;
  }

  getMountState(): MountState | null {
    return this.mountSystem?.getState() ?? null;
  }
}

// Type imports for Subsystem context (to avoid circular imports)
import { WorldSubsystem } from './WorldSubsystem.js';
import { RenderSubsystem } from './RenderSubsystem.js';
import { InputSubsystem } from './InputSubsystem.js';