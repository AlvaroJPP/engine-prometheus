/**
 * Humanoid Animation Profile
 *
 * Standard humanoid animation profile compatible with Mixamo, Rigify, UE4/UE5 mannequin rigs.
 */

import {
  AnimationProfileBuilder,
  createAnimationStateId,
  createBoneId,
  createAnimationParameterId,
  createIKTargetId,
  DEFAULT_ANIMATION_PARAMETERS,
  LOCOMOTION_TYPE_PRESETS,
  type AnimationStateId,
  type AnimationParameterId,
  type LocomotionProfile,
  type StateProfile,
  type TransitionRule,
  type BlendTreeNodeRef,
  type BlendTree1DConfig,
  type BlendTree2DConfig,
  type BlendTreeDirectConfig,
} from '../AnimationProfile'
import {
  createHumanoidBoneMappings,
  createHumanoidIKTargets,
  registerAnimationProfile,
} from '../AnimationRegistry'

// ============================================================================
// State IDs (prefixados com _ para evitar "unused" - usados como identificadores de estado)
// ============================================================================

const _STATE_IDLE = createAnimationStateId('idle')
const _STATE_WALK = createAnimationStateId('walk')
const _STATE_RUN = createAnimationStateId('run')
const _STATE_SPRINT = createAnimationStateId('sprint')
const _STATE_JUMP = createAnimationStateId('jump')
const _STATE_JUMP_START = createAnimationStateId('jump_start')
const _STATE_JUMP_LOOP = createAnimationStateId('jump_loop')
const _STATE_JUMP_LAND = createAnimationStateId('jump_land')
const _STATE_CROUCH = createAnimationStateId('crouch')
const _STATE_CROUCH_IDLE = createAnimationStateId('crouch_idle')
const _STATE_CROUCH_WALK = createAnimationStateId('crouch_walk')
const _STATE_CROUCH_RUN = createAnimationStateId('crouch_run')
const _STATE_PRONE = createAnimationStateId('prone')
const _STATE_PRONE_IDLE = createAnimationStateId('prone_idle')
const _STATE_PRONE_CRAWL = createAnimationStateId('prone_crawl')
const _STATE_DODGE = createAnimationStateId('dodge')
const _STATE_SLIDE = createAnimationStateId('slide')
const _STATE_ROLL = createAnimationStateId('roll')
const _STATE_INTERACT = createAnimationStateId('interact')
const _STATE_PRIMARY_ACTION = createAnimationStateId('primary_action')
const _STATE_SECONDARY_ACTION = createAnimationStateId('secondary_action')
const _STATE_INVENTORY = createAnimationStateId('inventory')
const _STATE_USE_ITEM = createAnimationStateId('use_item')
const _STATE_RELOAD = createAnimationStateId('reload')
const _STATE_ABILITY_1 = createAnimationStateId('ability_1')
const _STATE_ABILITY_2 = createAnimationStateId('ability_2')
const _STATE_ABILITY_3 = createAnimationStateId('ability_3')
const _STATE_ABILITY_4 = createAnimationStateId('ability_4')
const _STATE_EMOTE = createAnimationStateId('emote')
const _STATE_MOUNT = createAnimationStateId('mount')
const _STATE_DISMOUNT = createAnimationStateId('dismount')
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
// Build Humanoid Profile
// ============================================================================

function createWalkBlendTree(): BlendTreeNodeRef {
  LOCOMOTION_TYPE_PRESETS.get('walk')!

  return {
    node: {
      type: '2d',
      parameterX: PARAM_SPEED,
      parameterY: PARAM_DIRECTION,
      positions: [
        [0, 0],      // idle center
        [1, 0],      // walk forward
        [1, -90],    // walk left
        [1, 90],     // walk right
        [1, -135],   // walk backward left
        [1, 135],    // walk backward right
        [1, -180],   // walk backward
        [1, 180],    // walk backward (other side)
        [0.5, -45],  // walk diagonal left
        [0.5, 45],   // walk diagonal right
        [0.5, -135], // walk backward diagonal left
        [0.5, 135],  // walk backward diagonal right
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

function createRunBlendTree(): BlendTreeNodeRef {
  LOCOMOTION_TYPE_PRESETS.get('run')!

  return {
    node: {
      type: '2d',
      parameterX: PARAM_SPEED,
      parameterY: PARAM_DIRECTION,
      positions: [
        [2, 0],      // run forward
        [2, -90],    // run left
        [2, 90],     // run right
        [2, -135],   // run backward left
        [2, 135],    // run backward right
        [2, -180],   // run backward
        [2, 180],    // run backward (other side)
        [3, -45],    // run diagonal left
        [3, 45],     // run diagonal right
        [3, -135],   // run backward diagonal left
        [3, 135],    // run backward diagonal right
        [4, 0],      // sprint forward
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
        'sprint',
      ],
      blendType: 'freeform',
      loop: true,
      speedMultiplier: 1,
    } as BlendTree2DConfig,
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
        [0, 0],      // crouch idle
        [1, 0],      // crouch walk forward
        [1, -90],    // crouch walk left
        [1, 90],     // crouch walk right
        [1, -180],   // crouch walk backward
        [0.5, -45],  // crouch walk diagonal left
        [0.5, 45],   // crouch walk diagonal right
        [0.5, -135], // crouch walk backward diagonal left
        [0.5, 135],  // crouch walk backward diagonal right
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

function createProneCrawlBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '2d',
      parameterX: PARAM_SPEED,
      parameterY: PARAM_DIRECTION,
      positions: [
        [0, 0],      // prone idle
        [1, 0],      // prone crawl forward
        [1, -90],    // prone crawl left
        [1, 90],     // prone crawl right
        [1, -180],   // prone crawl backward
        [0.5, -45],  // prone crawl diagonal left
        [0.5, 45],   // prone crawl diagonal right
        [0.5, -135], // prone crawl backward diagonal left
        [0.5, 135],  // prone crawl backward diagonal right
      ],
      clips: [
        'prone_idle',
        'prone_crawl',
        'prone_crawl_left',
        'prone_crawl_right',
        'prone_crawl_backward',
        'prone_crawl_diagonal_left',
        'prone_crawl_diagonal_right',
        'prone_crawl_backward_diagonal_left',
        'prone_crawl_backward_diagonal_right',
      ],
      blendType: 'freeform',
      loop: true,
      speedMultiplier: 0.4,
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

function createDodgeBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '1d',
      parameter: PARAM_DIRECTION,
      thresholds: [-180, -90, 0, 90, 180],
      clips: [
        'dodge_backward',
        'dodge_left',
        'dodge',
        'dodge_right',
        'dodge_backward',
      ],
      loop: false,
      speedMultiplier: 1,
    } as BlendTree1DConfig,
    children: [],
  }
}

function createRollBlendTree(): BlendTreeNodeRef {
  return {
    node: {
      type: '1d',
      parameter: PARAM_DIRECTION,
      thresholds: [-180, -90, 0, 90, 180],
      clips: [
        'roll_backward',
        'roll_left',
        'roll_forward',
        'roll_right',
        'roll_backward',
      ],
      loop: false,
      speedMultiplier: 1,
    } as BlendTree1DConfig,
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
    footIKTargets: [createIKTargetId('leftFoot'), createIKTargetId('rightFoot')],
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

const humanoidProfile = new AnimationProfileBuilder()
  .setId('humanoid_v1')
  .setName('Standard Humanoid')
  .setVersion(1, 0, 0)
  .setDescription('Standard humanoid animation profile for bipedal characters (Mixamo, Rigify, UE mannequin compatible)')
  .setAuthor('Engine Prometheus')
  .setSkeleton({
    rootBone: {
      boneId: createBoneId('hips'),
      positionOffset: [0, 0, 0],
      rotationOffset: [0, 0, 0, 1],
      scale: 1,
    },
    boneMappings: createHumanoidBoneMappings(),
    ikTargets: createHumanoidIKTargets(),
    boneHierarchy: [
      { boneId: createBoneId('hips'), parentId: null, name: 'Hips' },
      { boneId: createBoneId('spine'), parentId: createBoneId('hips'), name: 'Spine' },
      { boneId: createBoneId('chest'), parentId: createBoneId('spine'), name: 'Chest' },
      { boneId: createBoneId('neck'), parentId: createBoneId('chest'), name: 'Neck' },
      { boneId: createBoneId('head'), parentId: createBoneId('neck'), name: 'Head' },
      { boneId: createBoneId('leftshoulder'), parentId: createBoneId('chest'), name: 'Left Shoulder' },
      { boneId: createBoneId('leftarm'), parentId: createBoneId('leftshoulder'), name: 'Left Arm' },
      { boneId: createBoneId('leftforearm'), parentId: createBoneId('leftarm'), name: 'Left Forearm' },
      { boneId: createBoneId('lefthand'), parentId: createBoneId('leftforearm'), name: 'Left Hand' },
      { boneId: createBoneId('rightshoulder'), parentId: createBoneId('chest'), name: 'Right Shoulder' },
      { boneId: createBoneId('rightarm'), parentId: createBoneId('rightshoulder'), name: 'Right Arm' },
      { boneId: createBoneId('rightforearm'), parentId: createBoneId('rightarm'), name: 'Right Forearm' },
      { boneId: createBoneId('righthand'), parentId: createBoneId('rightforearm'), name: 'Right Hand' },
      { boneId: createBoneId('leftupleg'), parentId: createBoneId('hips'), name: 'Left UpLeg' },
      { boneId: createBoneId('leftleg'), parentId: createBoneId('leftupleg'), name: 'Left Leg' },
      { boneId: createBoneId('leftfoot'), parentId: createBoneId('leftleg'), name: 'Left Foot' },
      { boneId: createBoneId('lefttoes'), parentId: createBoneId('leftfoot'), name: 'Left Toes' },
      { boneId: createBoneId('rightupleg'), parentId: createBoneId('hips'), name: 'Right UpLeg' },
      { boneId: createBoneId('rightleg'), parentId: createBoneId('rightupleg'), name: 'Right Leg' },
      { boneId: createBoneId('rightfoot'), parentId: createBoneId('rightleg'), name: 'Right Foot' },
      { boneId: createBoneId('righttoes'), parentId: createBoneId('rightfoot'), name: 'Right Toes' },
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
    'Run',
    'run',
    { min: 2, max: 4, optimal: 3 },
    createRunBlendTree()
  ))
  .addLocomotionProfile(createLocomotionProfile(
    'Sprint',
    'sprint',
    { min: 4, max: 8, optimal: 5 },
    createRunBlendTree()
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
  .addState(createStateProfile(_STATE_RUN, 'Run', createRunBlendTree()))
  .addState(createStateProfile(_STATE_SPRINT, 'Sprint', createRunBlendTree()))
  .addState(createStateProfile(_STATE_JUMP, 'Jump', createJumpBlendTree(), false))
  .addState(createStateProfile(_STATE_JUMP_START, 'Jump Start', {
    node: { type: 'direct', clip: 'jump_start', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false))
  .addState(createStateProfile(_STATE_JUMP_LOOP, 'Jump Loop', {
    node: { type: 'direct', clip: 'jump_loop', loop: true, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }))
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
  .addState(createStateProfile(_STATE_CROUCH_RUN, 'Crouch Run', createCrouchWalkBlendTree(), true, 1.5))
  .addState(createStateProfile(_STATE_PRONE, 'Prone', {
    node: { type: 'direct', clip: 'prone', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false))
  .addState(createStateProfile(_STATE_PRONE_IDLE, 'Prone Idle', {
    node: { type: 'direct', clip: 'prone_idle', loop: true, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }))
  .addState(createStateProfile(_STATE_PRONE_CRAWL, 'Prone Crawl', createProneCrawlBlendTree()))
  .addState(createStateProfile(_STATE_DODGE, 'Dodge', createDodgeBlendTree(), false, 1, ['dodge'], 10))
  .addState(createStateProfile(_STATE_SLIDE, 'Slide', {
    node: { type: 'direct', clip: 'slide', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false, 1, ['maneuver'], 10))
  .addState(createStateProfile(_STATE_ROLL, 'Roll', createRollBlendTree(), false, 1, ['maneuver'], 10))
  .addState(createStateProfile(_STATE_INTERACT, 'Interact', createInteractionBlendTree('interact'), false, 1, ['interaction'], 5))
  .addState(createStateProfile(_STATE_PRIMARY_ACTION, 'Primary Action', createInteractionBlendTree('primary_action'), false, 1, ['action'], 5))
  .addState(createStateProfile(_STATE_SECONDARY_ACTION, 'Secondary Action', createInteractionBlendTree('secondary_action'), false, 1, ['action'], 5))
  .addState(createStateProfile(_STATE_INVENTORY, 'Inventory', createInteractionBlendTree('inventory'), false, 1, ['ui'], 3))
  .addState(createStateProfile(_STATE_USE_ITEM, 'Use Item', createInteractionBlendTree('use_item'), false, 1, ['action'], 5))
  .addState(createStateProfile(_STATE_RELOAD, 'Reload', createInteractionBlendTree('reload'), false, 1, ['action'], 5))
  .addState(createStateProfile(_STATE_ABILITY_1, 'Ability 1', createInteractionBlendTree('ability_1'), false, 1, ['ability'], 5))
  .addState(createStateProfile(_STATE_ABILITY_2, 'Ability 2', createInteractionBlendTree('ability_2'), false, 1, ['ability'], 5))
  .addState(createStateProfile(_STATE_ABILITY_3, 'Ability 3', createInteractionBlendTree('ability_3'), false, 1, ['ability'], 5))
  .addState(createStateProfile(_STATE_ABILITY_4, 'Ability 4', createInteractionBlendTree('ability_4'), false, 1, ['ability'], 5))
  .addState(createStateProfile(_STATE_EMOTE, 'Emote', createInteractionBlendTree('emote'), false, 1, ['emote'], 2))
  .addState(createStateProfile(_STATE_MOUNT, 'Mount', {
    node: { type: 'direct', clip: 'mount', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false, 1, ['mount'], 5))
  .addState(createStateProfile(_STATE_DISMOUNT, 'Dismount', {
    node: { type: 'direct', clip: 'dismount', loop: false, speedMultiplier: 1 } as BlendTreeDirectConfig,
    children: [],
  }, false, 1, ['mount'], 5))
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
  .addTransition(createTransition('*', _STATE_RUN, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterGreaterOrEqual', parameterId: PARAM_SPEED, value: 2 },
    { type: 'parameterLess', parameterId: PARAM_SPEED, value: 4 },
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_SPRINT, [
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterGreaterOrEqual', parameterId: PARAM_SPEED, value: 4 },
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
  .addTransition(createTransition('*', _STATE_PRONE_IDLE, [
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: true }, // prone uses crouch param
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: false },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_PRONE_CRAWL, [
    { type: 'parameterEquals', parameterId: PARAM_CROUCH, value: true },
    { type: 'parameterEquals', parameterId: PARAM_IS_MOVING, value: true },
    { type: 'parameterEquals', parameterId: PARAM_IS_GROUNDED, value: true },
  ]))
  .addTransition(createTransition('*', _STATE_DODGE, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('dodge') },
  ], false, 0, 0.1, 15))
  .addTransition(createTransition('*', _STATE_SLIDE, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('slide') },
  ], false, 0, 0.1, 15))
  .addTransition(createTransition('*', _STATE_ROLL, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('roll') },
  ], false, 0, 0.1, 15))
  .addTransition(createTransition('*', _STATE_INTERACT, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('interact') },
  ], false, 0, 0.1, 10))
  .addTransition(createTransition('*', _STATE_PRIMARY_ACTION, [
    { type: 'triggerActivated', parameterId: createAnimationParameterId('primary_action') },
  ], false, 0, 0.1, 10))
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
        createBoneId('leftupleg'),
        createBoneId('leftleg'),
        createBoneId('leftfoot'),
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
    name: 'Upper Body',
    weight: 1,
    weightParameter: createAnimationParameterId('upperBodyWeight'),
    mask: [
      createBoneId('spine'),
      createBoneId('chest'),
      createBoneId('neck'),
      createBoneId('head'),
      createBoneId('leftshoulder'),
      createBoneId('leftarm'),
      createBoneId('leftforearm'),
      createBoneId('lefthand'),
      createBoneId('rightshoulder'),
      createBoneId('rightarm'),
      createBoneId('rightforearm'),
      createBoneId('righthand'),
    ],
    additive: false,
    syncGroup: 0,
  })
  .addLayer({
    id: 2,
    name: 'Additive',
    weight: 1,
    weightParameter: createAnimationParameterId('additiveWeight'),
    mask: [],
    additive: true,
  })
  .setDefaultState(_STATE_IDLE)
  .addTag('humanoid')
  .addTag('bipedal')
  .addTag('standard')
  .setMetadata('compatibleRigs', ['mixamo', 'rigify', 'ue4', 'ue5', 'unity'])
  .setMetadata('boneNamingConvention', 'mixamo')
  .build()

// Register the profile
registerAnimationProfile(humanoidProfile)

export { humanoidProfile }
export default humanoidProfile