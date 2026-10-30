// Animation module exports for Engine Prometheus

export {
  // ID factories
  createAnimationProfileId,
  createAnimationStateId,
  createBoneId,
  createAnimationParameterId,
  createIKTargetId,

  // Branded types
  type AnimationProfileId,
  type AnimationStateId,
  type BoneId,
  type AnimationParameterId,
  type IKTargetId,

  // Core profile types
  type ProfileVersion,
  type SkeletonProfile,
  type LocomotionProfile,
  type StateProfile,
  type TransitionRule,
  type FallbackProfile,
  type AnimationProfile,

  // Supporting types
  type BoneMapping,
  type RootBoneConfig,
  type IKTargetProfile,
  type AnimationParameter,
  type AnimationParameterValue,
  type AnimationParameterBag,
  type BlendTreeNode,
  type BlendTreeNodeRef,
  type BlendTree1DConfig,
  type BlendTree2DConfig,
  type BlendTreeDirectConfig,
  type BlendTreeAdditiveConfig,
  type BlendTreeOverrideConfig,
  type LocomotionType,
  type SpeedRange,
  type TransitionCondition,
  type TransitionConditionType,
  type AnimationLayer,
  type AnimationEvent,
  type AnimationProfileValidationResult,
  type AnimationRuntimeState,

  // Builder and utilities
  AnimationProfileBuilder,
  createAnimationProfileBuilder,
  validateAnimationProfile,

  // Presets and defaults
  DEFAULT_ANIMATION_PARAMETERS,
  LOCOMOTION_TYPE_PRESETS,
} from './AnimationProfile'

export {
  // Registry
  AnimationRegistry,
  registerAnimationProfile,
  getAnimationProfile,
  listAnimationProfiles,
  createCustomAnimationProfile,
  detectSkeletonType,
  matchAnimationProfile,
  initializeBuiltinProfiles,
  clearAnimationProfiles,

  // Helper functions for building profiles
  createHumanoidBoneMappings,
  createQuadrupedBoneMappings,
  createGenericBoneMappings,
  createHumanoidIKTargets,
  createQuadrupedIKTargets,
  createGenericIKTargets,
} from './AnimationRegistry'

export {
  // AutoMapper
  autoMapAnimations,
  extractAllClips,
  validateAnimationCompatibility,
  createMappingReport,

  // Types
  type MappedAnimations,
  type ProceduralAnimations,
} from './AutoMapper'

export {
  // Universal Controller
  UniversalAnimationController,
  createLegacyController,
} from './UniversalAnimationController'

// Built-in profiles (import to trigger registration)
import './profiles/humanoid'
import './profiles/quadruped'
import './profiles/generic'

export { humanoidProfile } from './profiles/humanoid'
export { quadrupedProfile } from './profiles/quadruped'
export { genericProfile } from './profiles/generic'