/**
 * Quadruped Animation Profile
 *
 * Standard quadruped animation profile for 4-legged creatures (dogs, horses, cats, etc.).
 */

import {
  type AnimationStateId,
  type AnimationParameterId,
  AnimationProfileBuilder,
  createAnimationStateId,
  createBoneId,
  createAnimationParameterId,
  createIKTargetId,
  DEFAULT_ANIMATION_PARAMETERS,
  LOCOMOTION_TYPE_PRESETS,
  type LocomotionProfile,
  type StateProfile,
  type TransitionRule,
  type BlendTreeNodeRef,
  type BlendTree1DConfig,
  type BlendTree2DConfig,
  type BlendTreeDirectConfig,
} from '../AnimationProfile'
import {
  createQuadrupedBoneMappings,
  createQuadrupedIKTargets,
  registerAnimationProfile,
} from '../AnimationRegistry'

// ============================================================================
// State IDs (prefixados com _ para evitar "unused" - usados como identificadores de estado)
// ============================================================================

const _STATE_IDLE = createAnimationStateId('idle')
const _STATE_WALK = createAnimationStateId('walk')
const _STATE_TROT = createAnimationStateId('trot')
const _STATE_RUN = createAnimationStateId('run')
const _STATE_GALLOP = createAnimationStateId('gallop')
const _STATE_JUMP = createAnimationStateId('jump')
const _STATE_JUMP_START = createAnimationStateId('jump_start')
const _STATE_JUMP_LAND = createAnimationStateId('jump_land')
const _STATE_CROUCH = createAnimationStateId('crouch')
const _STATE_CROUCH_IDLE = createAnimationStateId('crouch_idle')
const _STATE_CROUCH_WALK = createAnimationStateId('crouch_walk')
const _STATE_LIE_DOWN = createAnimationStateId('lie_down')
const _STATE_LIE_IDLE = createAnimationStateId('lie_idle')
const _STATE_SLEEP = createAnimationStateId('sleep')
const _STATE_EAT = createAnimationStateId('eat')
const _STATE_DRINK = createAnimationStateId('drink')
const _STATE_ATTACK = createAnimationStateId('attack')
const _STATE_BITE = createAnimationStateId('bite')
const _STATE_HOWL = createAnimationStateId('howl')
const _STATE_SHAKE = createAnimationStateId('shake')
const _STATE_SNIFF = createAnimationStateId('sniff')
const _STATE_DEATH = createAnimationStateId('death')

// ============================================================================
// Parameter IDs
// ============================================================================

const PARAM_SPEED = createAnimationParameterId('speed')
const PARAM_DIRECTION = createAnimationParameterId('direction')
const PARAM_IS_GROUNDED = createAnimationParameterId('isGrounded')
const PARAM_IS_MOVING = createAnimationParameterId('isMoving')
const PARAM_JUMP = createAnimationParameterId('jump')
const PARAM_CROUCH = createAnimationParameterId('crouch')
const PARAM_VELOCITY = createAnimationParameterId('velocity')

// ============================================================================
// Build Blend Trees
// ============================================================================

function createWalkBlendTree(): BlendTreeNodeRef {
  LOCOMOTION_TYPE_PRESETS.get('walk')!

  return {
    node: {
      type: '2d',
      parameterX: PARAM_SPEED,
      parameterY: PARAM_DIRECTION,
      positions: [
        [0, 0],       // idle center
        [1, 0],       // walk forward
        [1, -90],     // walk left
        [1, 90],      // walk right
        [1, -135],    // walk backward left
        [1, 135],     // walk backward right
        [1, -180],    // walk backward
        [1, 180],     // walk backward (other side)
        [0.5, -45],   // walk diagonal left
        [0.5, 45],    // walk diagonal right
        [0.5, -135],  // walk backward diagonal left
        [0.5, 135],   // walk backward diagonal right
      ],
      clips: [
        'idle',
        'walk',
        'walk_left',
        'walk_right',
        'walk_backward_diagonal_left',
        'walk_backward_diagonal_right',
        'walk_backward',
        'walk_backward',
        'walk_diagonal_left',
        'walk_diagonal_right',
        'walk_backward_diagonal_left',
        'walk_backward_diagonal_right',
      ],
      blendType: 'freeform',
      loop: true,
      speedMultiplier: 1,
    } as BlendTree2DConfig,
    children: [],
  }
}

function createTrotBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '2d',
      parameterX: PARAM_SPEED,
      parameterY: PARAM_DIRECTION,
      positions: [
        [2, 0],      // trot forward
        [2, -90],    // trot left
        [2, 90],     // trot right
        [2, -135],   // trot backward left
        [2, 135],    // trot backward right
        [2, -180],   // trot backward
        [2, 180],    // trot backward
        [2.5, -45],  // trot diagonal left
        [2.5, 45],   // trot diagonal right
        [2.5, -135], // trot backward diagonal left
        [2.5, 135],  // trot backward diagonal right
        [3, 0],      // run forward
      ],
      clips: [
        'trot',
        'trot_left',
        'trot_right',
        'trot_backward_diagonal_left',
        'trot_backward_diagonal_right',
        'trot_backward',
        'trot_backward',
        'trot_diagonal_left',
        'trot_diagonal_right',
        'trot_backward_diagonal_left',
        'trot_backward_diagonal_right',
        'run',
      ],
      blendType: 'freeform',
      loop: true,
      speedMultiplier: 1,
    } as BlendTree2DConfig,
    children: [],
  }
}

function createRunBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '2d',
      parameterX: PARAM_SPEED,
      parameterY: PARAM_DIRECTION,
      positions: [
        [3, 0],       // run forward
        [3, -90],     // run left
        [3, 90],      // run right
        [3, -135],    // run backward left
        [3, 135],     // run backward right
        [3, -180],    // run backward
        [3, 180],     // run backward
        [4, -45],     // run diagonal left
        [4, 45],      // run diagonal right
        [4, -135],    // run backward diagonal left
        [4, 135],     // run backward diagonal right
        [5, 0],       // gallop forward
      ],
      clips: [
        'run',
        'run_left',
        'run_right',
        'run_backward_diagonal_left',
        'run_backward_diagonal_right',
        'run_backward',
        'run_backward',
        'run_diagonal_left',
        'run_diagonal_right',
        'run_backward_diagonal_left',
        'run_backward_diagonal_right',
        'gallop',
      ],
      blendType: 'freeform',
      loop: true,
      speedMultiplier: 1,
    } as BlendTree2DConfig,
    children: [],
  }
}

function createGallopBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '1d',
      parameter: PARAM_SPEED,
      thresholds: [4, 5, 6, 7, 8],
      clips: [
        'gallop',
        'gallop_fast',
        'gallop_faster',
        'gallop_fastest',
        'gallop_fastest',
      ],
      loop: true,
      speedMultiplier: 1,
    } as BlendTree1DConfig,
    children: [],
  }
}

function createCrouchWalkBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '2d',
      parameterX: PARAM_SPEED,
      parameterY: PARAM_DIRECTION,
      positions: [
        [0, 0],       // crouch idle
        [1, 0],       // crouch walk forward
        [1, -90],     // crouch walk left
        [1, 90],      // crouch walk right
        [1, -180],    // crouch walk backward
        [0.5, -45],   // crouch walk diagonal left
        [0.5, 45],    // crouch walk diagonal right
        [0.5, -135],  // crouch walk backward diagonal left
        [0.5, 135],   // crouch walk backward diagonal right
      ],
      clips: [
        'crouch_idle',
        'crouch_walk',
        'crouch_walk_left',
        'crouch_walk_right',
        'crouch_walk_backward',
        'crouch_walk_diagonal_left',
        'crouch_walk_diagonal_right',
        'crouch_walk_backward_diagonal_left',
        'crouch_walk_backward_diagonal_right',
      ],
      blendType: 'freeform',
      loop: true,
      speedMultiplier: 0.7,
    } as BlendTree2DConfig,
    children: [],
  }
}

function createJumpBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: 'direct',
      clip: 'jump',
      loop: false,
      speedMultiplier: 1,
    } as BlendTreeDirectConfig,
    children: [],
  }
}

function createInteractionBlendTree(clipName: string): BlendTreeNodeRef {
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
    footIKEnabled: preset.footIKEnabled ?? true,
    footIKTargets: [
      createIKTargetId('frontLeftPaw'),
      createIKTargetId('frontRightPaw'),
      createIKTargetId('backLeftPaw'),
      createIKTargetId('backRightPaw'),
    ],
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

const quadrupedProfile = new AnimationProfileBuilder()
  .setId('quadruped_v1')
  .setName('Standard Quadruped')
  .setVersion(1, 0, 0)
  .setDescription('Standard quadruped animation profile for 4-legged creatures (dogs, horses, cats, etc.)')
  .setAuthor('Engine Prometheus')
  .setSkeleton({
    rootBone: {
      boneId: createBoneId('spine1'),
      positionOffset: [0, 0, 0],
      rotationOffset: [0, 0, 0, 1],
      scale: 1,
    },
    boneMappings: createQuadrupedBoneMappings(),
    ikTargets: createQuadrupedIKTargets(),
    boneHierarchy: [
      { boneId: createBoneId('root'), parentId: null, name: 'Root' },
      { boneId: createBoneId('spine1'), parentId: createBoneId('root'), name: 'Spine 1' },
      { boneId: createBoneId('spine2'), parentId: createBoneId('spine1'), name: 'Spine 2' },
      { boneId: createBoneId('spine3'), parentId: createBoneId('spine2'), name: 'Spine 3' },
      { boneId: createBoneId('neck'), parentId: createBoneId('spine3'), name: 'Neck' },
      { boneId: createBoneId('head'), parentId: createBoneId('neck'), name: 'Head' },
      { boneId: createBoneId('tail1'), parentId: createBoneId('spine3'), name: 'Tail 1' },
      { boneId: createBoneId('tail2'), parentId: createBoneId('tail1'), name: 'Tail 2' },
      { boneId: createBoneId('tail3'), parentId: createBoneId('tail2'), name: 'Tail 3' },
      { boneId: createBoneId('front_left_shoulder'), parentId: createBoneId('spine2'), name: 'Front Left Shoulder' },
      { boneId: createBoneId('front_left_leg'), parentId: createBoneId('front_left_shoulder'), name: 'Front Left Leg' },
      { boneId: createBoneId('front_left_paw'), parentId: createBoneId('front_left_leg'), name: 'Front Left Paw' },
      { boneId: createBoneId('front_right_shoulder'), parentId: createBoneId('spine2'), name: 'Front Right Shoulder' },
      { boneId: createBoneId('front_right_leg'), parentId: createBoneId('front_right_shoulder'), name: 'Front Right Leg' },
      { boneId: createBoneId('front_right_paw'), parentId: createBoneId('front_right_leg'), name: 'Front Right Paw' },
      { boneId: createBoneId('back_left_shoulder'), parentId: createBoneId('spine1'), name: 'Back Left Shoulder' },
      { boneId: createBoneId('back_left_leg'), parentId: createBoneId('back_left_shoulder'), name: 'Back Left Leg' },
      { boneId: createBoneId('back_left_paw'), parentId: createBoneId('back_left_leg'), name: 'Back Left Paw' },
      { boneId: createBoneId('back_right_shoulder'), parentId: createBoneId('spine1'), name: 'Back Right Shoulder' },
      { boneId: createBoneId('back_right_leg'), parentId: createBoneId('back_right_shoulder'), name: 'Back Right Leg' },
      { boneId: createBoneId('back_right_paw'), parentId: createBoneId('back_right_leg'), name: 'Back Right Paw' },
    ],
    bindPose: [],
  })
  .addLocomotionProfile(createLocomotionProfile(
    'Walk',
    'walk',
    { min: 0, max: 2, optimal: 1 },
    createWalkBlendTree()
  ))
  .addLocomotionProfile(createLocomotionProfile(
    'Trot',
    'run',
    { min: 2, max: 4, optimal: 3 },
    createTrotBlendTree()
  ))
  .addLocomotionProfile(createLocomotionProfile(
    'Run',
    'run',
    { min: 4, max: 6, optimal: 5 },
    createRunBlendTree()
  ))
  .addLocomotionProfile(createLocomotionProfile(
    'Gallop',
    'sprint',
    { min: 6, max: 10, optimal: 8 },
    createGallopBlendTree()
  ))
  .addLocomotionProfile(createLocomotionProfile(
    'Crouch Walk',
    'crouchWalk',
    { min: 0, max: 1.5, optimal: 0.8 },
    createCrouchWalkBlendTree()
  ))
  .addState(createStateProfile(_STATE_IDLE, 'Idle', {
    node: { type: 'direct', clip: 'idle', loop: true, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }))
  .addState(createStateProfile(_STATE_WALK, 'Walk', createWalkBlendTree()))
  .addState(createStateProfile(_STATE_TROT, 'Trot', createTrotBlendTree()))
  .addState(createStateProfile(_STATE_RUN, 'Run', createRunBlendTree()))
  .addState(createStateProfile(_STATE_GALLOP, 'Gallop', createGallopBlendTree()))
  .addState(createStateProfile(_STATE_JUMP, 'Jump', createJumpBlendTree(), false))
  .addState(createStateProfile(_STATE_JUMP_START, 'Jump Start', {
    node: { type: 'direct', clip: 'jump_start', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false))
  .addState(createStateProfile(_STATE_JUMP_LAND, 'Jump Land', {
    node: { type: 'direct', clip: 'jump_land', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false))
  .addState(createStateProfile(_STATE_CROUCH, 'Crouch', {
    node: { type: 'direct', clip: 'crouch', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false))
  .addState(createStateProfile(_STATE_CROUCH_IDLE, 'Crouch Idle', {
    node: { type: 'direct', clip: 'crouch_idle', loop: true, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }))
  .addState(createStateProfile(_STATE_CROUCH_WALK, 'Crouch Walk', createCrouchWalkBlendTree()))
  .addState(createStateProfile(_STATE_LIE_DOWN, 'Lie Down', {
    node: { type: 'direct', clip: 'lie_down', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false))
  .addState(createStateProfile(_STATE_LIE_IDLE, 'Lie Idle', {
    node: { type: 'direct', clip: 'lie_idle', loop: true, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }))
  .addState(createStateProfile(_STATE_SLEEP, 'Sleep', {
    node: { type: 'direct', clip: 'sleep', loop: true, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }))
  .addState(createStateProfile(_STATE_EAT, 'Eat', createInteractionBlendTree('eat'), false, 1, ['behavior'], 5))
  .addState(createStateProfile(_STATE_DRINK, 'Drink', createInteractionBlendTree('drink'), false, 1, ['behavior'], 5))
  .addState(createStateProfile(_STATE_ATTACK, 'Attack', createInteractionBlendTree('attack'), false, 1, ['combat'], 10))
  .addState(createStateProfile(_STATE_BITE, 'Bite', createInteractionBlendTree('bite'), false, 1, ['combat'], 10))
  .addState(createStateProfile(_STATE_HOWL, 'Howl', createInteractionBlendTree('howl'), false, 1, ['behavior'], 3))
  .addState(createStateProfile(_STATE_SHAKE, 'Shake', createInteractionBlendTree('shake'), false, 1, ['behavior'], 3))
  .addState(createStateProfile(_STATE_SNIFF, 'Sniff', createInteractionBlendTree('sniff'), false, 1, ['behavior'], 2))
  .addState(createStateProfile(_STATE_DEATH, 'Death', {
    node: { type: 'direct', clip: 'death', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false, 1, ['death'], 20))
  .addTransition(createTransition('*', _STATE_IDLE, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: false },
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_WALK, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterLess', parameterId: PARAM_SPEED, value: 2 },
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_TROT, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterGreaterOrEqual', parameterId: PARAM_SPEED, value: 2 },
    { type: 'parameterLess', parameterId: PARAM_SPEED, value: 4 },
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_RUN, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterGreaterOrEqual', parameterId: PARAM_SPEED, value: 4 },
    { type: 'parameterLess', parameterId: PARAM_SPEED, value: 6 },
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_GALLOP, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterGreaterOrEqual', parameterId: PARAM_SPEED, value: 6 },
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_JUMP, [
    { type: 'triggerActivated', parameterId: PARAM_JUMP },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ], false, 0, 0.1, 20))
  .addTransition(createTransition('*', _STATE_CROUCH_IDLE, [
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: true },
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_CROUCH_WALK, [
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: true },
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_LIE_IDLE, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('lie_down') },
  ], false, 0, 1.0, 5))
  .addTransition(createTransition('*', _STATE_SLEEP, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('sleep') },
  ], false, 0, 1.0, 3))
  .addTransition(createTransition('*', _STATE_EAT, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('eat') },
  ], false, 0, 0.5, 5))
  .addTransition(createTransition('*', _STATE_DRINK, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('drink') },
  ], false, 0, 0.5, 5))
  .addTransition(createTransition('*', _STATE_ATTACK, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('attack') },
  ], false, 0, 0.1, 15))
  .addTransition(createTransition('*', _STATE_BITE, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('bite') },
  ], false, 0, 0.1, 15))
  .addTransition(createTransition('*', _STATE_HOWL, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('howl') },
  ], false, 0, 0.5, 3))
  .addTransition(createTransition('*', _STATE_SHAKE, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('shake') },
  ], false, 0, 0.3, 3))
  .addTransition(createTransition('*', _STATE_SNIFF, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('sniff') },
  ], false, 0, 0.3, 2))
  .addTransition(createTransition('*', _STATE_DEATH, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('death') },
  ], false, 0, 0.5, 25))
  .setFallback({
    enabled: true,
    fallbackType: 'procedural',
    proceduralConfig: {
      type: 'twoBoneIK',
      targetParameter: PARAM_VELOCITY,
      damping: 0.1,
      stiffness: 0.8,
      maxDistance: 0.5,
      boneChain: [
        createBoneId('front_left_shoulder'),
        createBoneId('front_left_leg'),
        createBoneId('front_left_paw'),
      ],
    },
    triggerConditions: [
      { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: false },
    ],
    priority: 1,
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
    name: 'Head & Neck',
    weight: 1,
    weightParameter: createAnimationParameterId('headWeight'),
    mask: [
      createBoneId('neck'),
      createBoneId('head'),
    ],
    additive: false,
    syncGroup: 0,
  })
  .addLayer({
    id: 2,
    name: 'Tail',
    weight: 1,
    weightParameter: createAnimationParameterId('tailWeight'),
    mask: [
      createBoneId('tail1'),
      createBoneId('tail2'),
      createBoneId('tail3'),
    ],
    additive: false,
    syncGroup: 1,
  })
  .addLayer({
    id: 3,
    name: 'Additive',
    weight: 1,
    weightParameter: createAnimationParameterId('additiveWeight'),
    mask: [],
    additive: true,
  })
  .setDefaultState(_STATE_IDLE)
  .addTag('quadruped')
  .addTag('four-legged')
  .addTag('standard')
  .setMetadata('compatibleRigs', ['generic', 'custom'])
  .setMetadata('boneNamingConvention', 'standard_quadruped')
  .build()

// Register the profile
registerAnimationProfile(quadrupedProfile)

export { quadrupedProfile }
export default quadrupedProfile