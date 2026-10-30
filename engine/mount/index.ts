// Mount System - Generic Mount/Seat System for Engine Prometheus

// Core types and configuration - VALUE EXPORTS (classes, functions, constants)
export {
  createMountPoint,
  createDefaultMountConfig,
  createMountAnimationMapping,
  DEFAULT_MOUNT_POINT,
  DEFAULT_MOUNT_CONTROL_BINDINGS,
  DEFAULT_MOUNT_BEHAVIOR_CONFIG,
} from './MountPoint.ts'

// Animation mapping
export {
  MountAnimationMapper,
  createDefaultAnimationMapping,
  createAnimationMappingFromConfig,
  extractAnimationClips,
  detectAvailableMountRoles,
} from './MountAnimationMapper.ts'

// Core system
export {
  MountSystem,
  createMountConfigFromLegacy,
} from './MountSystem.ts'

// High-level controller
export {
  MountController,
  createMountController,
  registerMountScriptActions,
  registerMountScriptConditions,
  registerMountScriptTriggers,
} from './MountController.ts'

// Editor integration
export {
  MountPointGizmo,
  MountPointGizmoManager,
  serializeMountConfig,
  deserializeMountConfig,
} from './MountEditorIntegration.ts'

// TYPE EXPORTS (interfaces, types)
export type {
  MountPoint,
  MountConfig,
  MountAnimationMapping,
  MountAnimationRole,
  MountMovementState,
  MountState,
  MountBehaviorConfig,
  MountControlBindings,
  MountResult,
  MountError,
  DismountResult,
  DismountError,
  MountSystemContext,
  MountInput,
  MountPointPropertyPanel,
} from './MountPoint.ts'

export type {
  EngineMountControllerContext,
} from './MountController.ts'