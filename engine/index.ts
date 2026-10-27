export { Engine } from './Engine'
export type { EngineOptions } from './Engine'
export type { EngineGameModule, GameModuleContext } from './runtime/GameModule'
export { GameModuleRegistry } from './runtime/GameModuleRegistry'
export { DEFAULT_CONTROL_MAPS, createDefaultControlMapSettings } from './input/ControlMaps'
export type { ControlMapBindings, ControlMapProfile, ControlMapSettings } from './input/ControlMaps'
export { parseProject, parseScene, parseSceneObject, ProjectFormatError } from './project/validate'
export { ENGINE_VERSION, MAIN_SCENE_PATH } from './project/format'
export { TERRAIN_ID } from './world/map/TerrainMesh'
export type { ProjectBundle, ProjectFile, SceneFile, SceneObjectData, ObjectType, CameraPreset, TextureFace, FaceTextureData, FaceTextureMap } from './project/format'
export type { ObjectInfo, ObjectPatch } from './model/object/GameObject'
export { getEntity, isEntityRoot, markEntity } from './model/entity/Entity'
export type { Entity, EntityMetadata } from './model/entity/Entity'
export type { TerrainInfo } from './world/World'
export type { ToolMode, TransformMode } from './EditorState'
export type { EngineEvents } from './world/events/types'

export { RuleEngine } from './script/RuleEngine'
export type { LogicEventsFile, LogicRule, RuleTrigger, RuleCondition, RuleAction } from './script/types'

export * from './script/packages'

export { BehaviorTreeRuntime, validateBehaviorTree } from './script/BehaviorTree'
export type {
  BehaviorTreeNode,
  BehaviorTreeStatus,
  BehaviorTreeParameters,
  BehaviorTreeHandlers,
  BehaviorTreeSequenceNode,
  BehaviorTreeSelectorNode,
  BehaviorTreeParallelNode,
  BehaviorTreeConditionNode,
  BehaviorTreeActionNode,
  BehaviorTreeWaitNode,
} from './script/BehaviorTree'

export { BehaviorTreePackageSystem, BEHAVIOR_TREE_CONFIG_KEY, BEHAVIOR_TREE_STATUS_VARIABLE } from './script/BehaviorTreePackageSystem'
export type { BehaviorTreePackageTransition } from './script/BehaviorTreePackageSystem'

export { EngineBehaviorTreeRuntime } from './script/EngineBehaviorTreeRuntime'
export type { EngineBehaviorTreeContext } from './script/EngineBehaviorTreeRuntime'

export { GridPathfinder } from './navigation/GridPathfinder'
export type { NavigationPoint, GridPathfinderOptions, GridPathfinderResult } from './navigation/GridPathfinder'

export { CooldownScheduler } from './runtime/CooldownScheduler'
export type { CooldownEntry } from './runtime/CooldownScheduler'
export { FiniteStateMachine } from './runtime/FiniteStateMachine'
export type { StateDefinition, StateTransition, StateTransitionGuard } from './runtime/FiniteStateMachine'
export { TagRegistry } from './world/TagRegistry'

export { ResourcePool } from './runtime/ResourcePool'
export type { ResourcePoolSnapshot, ResourceChange, ResourceChangeReason } from './runtime/ResourcePool'
export { SpatialHash3D } from './world/SpatialHash3D'
export type { SpatialPoint3, SpatialItem3, SpatialQueryResult } from './world/SpatialHash3D'
export { TriggerVolumeSystem } from './world/TriggerVolumeSystem'
export type { TriggerPoint3, TriggerSubject, TriggerVolume, TriggerEvent } from './world/TriggerVolumeSystem'
export { InteractionTargetSelector } from './script/InteractionTargetSelector'
export type { InteractionPoint3, InteractionTarget, InteractionSelection, InteractionSelectionOptions } from './script/InteractionTargetSelector'
