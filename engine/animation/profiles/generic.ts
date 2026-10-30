/**
 * Generic Animation Profile
 *
 * Minimal fallback animation profile for unknown or custom skeleton types.
 */

import {
  AnimationProfileBuilder,
  createAnimationStateId,
  createBoneId,
  createAnimationParameterId,
  DEFAULT_ANIMATION_PARAMETERS,
  LOCOMOTION_TYPE_PRESETS,
  type AnimationStateId,
  type AnimationParameterId,
  type LocomotionProfile,
  type StateProfile,
  type TransitionRule,
  type BlendTreeNodeRef,
  type BlendTree1DConfig,
  type BlendTreeDirectConfig,
} from '../AnimationProfile'
import {
  createGenericBoneMappings,
  createGenericIKTargets,
  registerAnimationProfile,
} from '../AnimationRegistry'

// ============================================================================
// State IDs
// ============================================================================

const STATE_IDLE = createAnimationStateId('idle')
const STATE_MOVE = createAnimationStateId('move')
const STATE_JUMP = createAnimationStateId('jump')
const STATE_ACTION = createAnimationStateId('action')
const STATE_DEATH = createAnimationStateId('death')

// ============================================================================
// Parameter IDs
// ============================================================================

const PARAM_SPEED = createAnimationParameterId('speed')
const PARAM_IS_GROUNDED = createAnimationParameterId('isGrounded')
const PARAM_IS_MOVING = createAnimationParameterId('isMoving')
const PARAM_JUMP = createAnimationParameterId('jump')

// ============================================================================
// Build Blend Trees
// ============================================================================

function createMoveBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '1d',
      parameter: PARAM_SPEED,
      thresholds: [0, 1, 3, 6, 10],
      clips: [
        'idle',
        'walk',
        'run',
        'sprint',
        'sprint',
      ],
      loop: true,
      speedMultiplier: 1,
    } as BlendTree1DConfig,
    children: [],
  }
}

function createActionBlendTree(clipName: string): BlendTreeNodeRef {
  return {
    node: {
      type: 'direct',
      clip: clipName,
      loop: false,
      speedMultiplier: 1,
    } as BlendTreeDirectConfig,
    children: [],
  }
}

function createLocomotionProfile(
  name: string,
  type: 'walk' | 'run' | 'sprint' | 'crouchWalk',
  speedRange: { min: number; max: number; optimal: number },
  blendTree: BlendTreeNodeRef
): LocomotionProfile {
  const preset = LOCOMOTION_TYPE_PRESETS.get(type)!

  return {
    type,
    name,
    speedRange,
    blendTree,
    transitionDuration: preset.transitionDuration ?? 0.2,
    exitDuration: preset.exitDuration ?? 0.1,
    footIKEnabled: false,
    footIKTargets: [],
    rootMotionEnabled: preset.rootMotionEnabled ?? true,
    rootMotionScale: preset.rootMotionScale ?? 1,
    turnSensitivity: preset.turnSensitivity ?? 1,
    accelerationTime: preset.accelerationTime ?? 0.3,
    decelerationTime: preset.decelerationTime ?? 0.2,
  }
}

function createStateProfile(
  id: AnimationStateId,
  name: string,
  blendTree: BlendTreeNodeRef,
  loop: boolean = true,
  speed: number = 1,
  tags: readonly string[] = [],
  priority: number = 0,
  layerMask: number = 0
): StateProfile {
  return {
    id,
    name,
    tags,
    blendTree,
    parameters: DEFAULT_ANIMATION_PARAMETERS,
    defaultParameterValues: new Map(),
    loop,
    speed,
    normalizedTime: 0,
    isLooping: loop,
    canTransitionToSelf: false,
    exitTime: 0.9,
    onEnterCallbacks: [],
    onExitCallbacks: [],
    onUpdateCallbacks: [],
    requiredIKTargets: [],
    layerMask,
    weight: 1,
    priority,
  }
}

function createTransition(
  fromState: AnimationStateId | '*',
  toState: AnimationStateId,
  conditions: readonly { type: 'parameterEquals' | 'parameterNotEquals' | 'parameterGreater' | 'parameterLess' | 'parameterGreaterOrEqual' | 'parameterLessOrEqual' | 'parameterInRange' | 'triggerActivated' | 'timeElapsed' | 'stateTimeNormalized' | 'custom'; parameterId?: AnimationParameterId; value?: number | boolean; minValue?: number; maxValue?: number; customEvaluator?: string }[] = [],
  hasExitTime: boolean = false,
  exitTime: number = 0.9,
  duration: number = 0.2,
  priority: number = 0
): TransitionRule {
  return {
    fromState,
    toState,
    conditions: conditions.map(c => ({
      type: c.type,
      parameterId: c.parameterId,
      value: c.value,
      minValue: c.minValue,
      maxValue: c.maxValue,
      customEvaluator: c.customEvaluator,
    })),
    hasExitTime,
    exitTime,
    duration,
    offset: 0,
    interruptionSource: 'currentState',
    orderedInterruption: true,
    canTransitionToSelf: false,
    priority,
  }
}

// ============================================================================
// Build the Complete Profile
// ============================================================================

const genericProfile = new AnimationProfileBuilder()
  .setId('generic_v1')
  .setName('Generic')
  .setVersion(1, 0, 0)
  .setDescription('Generic fallback animation profile for unknown or custom skeleton types')
  .setAuthor('Engine Prometheus')
  .setSkeleton({
    rootBone: {
      boneId: createBoneId('root'),
      positionOffset: [0, 0, 0],
      rotationOffset: [0, 0, 0, 1],
      scale: 1,
    },
    boneMappings: createGenericBoneMappings(),
    ikTargets: createGenericIKTargets(),
    boneHierarchy: [
      { boneId: createBoneId('root'), parentId: null, name: 'Root' },
    ],
    bindPose: [],
  })
  .addLocomotionProfile(createLocomotionProfile(
    'Move',
    'walk',
    { min: 0, max: 10, optimal: 3 },
    createMoveBlendTree()
  ))
  .addState(createStateProfile(STATE_IDLE, 'Idle', {
    node: { type: 'direct', clip: 'idle', loop: true, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }))
  .addState(createStateProfile(STATE_MOVE, 'Move', createMoveBlendTree()))
  .addState(createStateProfile(STATE_JUMP, 'Jump', {
    node: { type: 'direct', clip: 'jump', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false))
  .addState(createStateProfile(STATE_ACTION, 'Action', createActionBlendTree('action'), false, 1, ['action'], 5))
  .addState(createStateProfile(STATE_DEATH, 'Death', {
    node: { type: 'direct', clip: 'death', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false, 1, ['death'], 20))
  .addTransition(createTransition('*', STATE_IDLE, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', STATE_MOVE, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', STATE_JUMP, [
    { type: 'triggerActivated', parameterId: PARAM_JUMP },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ], false, 0, 0.1, 20))
  .addTransition(createTransition('*', STATE_ACTION, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('action') },
  ], false, 0, 0.2, 10))
  .addTransition(createTransition('*', STATE_DEATH, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('death') },
  ], false, 0, 0.5, 25))
  .setFallback({
    enabled: true,
    fallbackType: 'idle',
    idleConfig: {
      idleClips: ['idle'],
      blendDuration: 0.5,
      randomizeStartTime: true,
    },
    triggerConditions: [],
    priority: 0,
  })
  .addLayer({
    id: 0,
    name: 'Base',
    weight: 1,
    mask: [],
    additive: false,
  })
  .addLayer({
    id: 1,
    name: 'Additive',
    weight: 1,
    weightParameter: createAnimationParameterId('additiveWeight'),
    mask: [],
    additive: true,
  })
  .setDefaultState(STATE_IDLE)
  .addTag('generic')
  .addTag('fallback')
  .addTag('minimal')
  .setMetadata('compatibleRigs', ['any'])
  .setMetadata('boneNamingConvention', 'none')
  .build()

// Register the profile
registerAnimationProfile(genericProfile)

export { genericProfile }
export default genericProfile