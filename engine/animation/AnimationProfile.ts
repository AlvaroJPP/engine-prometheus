/**
 * Animation Profile Type System
 *
 * Comprehensive type definitions for animation profiles including skeleton mapping,
 * locomotion blending, state machines, transitions, and procedural fallbacks.
 */

/** Unique identifier for animation profiles. */
export type AnimationProfileId = string & { readonly __brand: unique symbol }

/** Unique identifier for animation states. */
export type AnimationStateId = string & { readonly __brand: unique symbol }

/** Unique identifier for bones in a skeleton. */
export type BoneId = string & { readonly __brand: unique symbol }

/** Unique identifier for animation parameters. */
export type AnimationParameterId = string & { readonly __brand: unique symbol }

/** Unique identifier for IK targets. */
export type IKTargetId = string & { readonly __brand: unique symbol }

/** Creates a branded AnimationProfileId. */
export function createAnimationProfileId(id: string): AnimationProfileId {
  return id as AnimationProfileId
}

/** Creates a branded AnimationStateId. */
export function createAnimationStateId(id: string): AnimationStateId {
  return id as AnimationStateId
}

/** Creates a branded BoneId. */
export function createBoneId(id: string): BoneId {
  return id as BoneId
}

/** Creates a branded AnimationParameterId. */
export function createAnimationParameterId(id: string): AnimationParameterId {
  return id as AnimationParameterId
}

/** Creates a branded IKTargetId. */
export function createIKTargetId(id: string): IKTargetId {
  return id as IKTargetId
}

/** Version info for animation profiles. */
export interface ProfileVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly label?: string
}

/** Bone mapping pattern for skeleton retargeting. */
export interface BoneMapping {
  readonly sourceBone: BoneId
  readonly targetBone: BoneId
  readonly required: boolean
  readonly fallbackBone?: BoneId
}

/** Root bone configuration. */
export interface RootBoneConfig {
  readonly boneId: BoneId
  readonly positionOffset: readonly [number, number, number]
  readonly rotationOffset: readonly [number, number, number, number]
  readonly scale: number
}

/** IK target configuration for feet, hands, etc. */
export interface IKTargetProfile {
  readonly id: IKTargetId
  readonly name: string
  readonly boneChain: readonly BoneId[]
  readonly targetBone: BoneId
  readonly effectorType: 'position' | 'rotation' | 'positionAndRotation'
  readonly weight: number
  readonly priority: number
  readonly constraints?: {
    readonly minDistance?: number
    readonly maxDistance?: number
    readonly rotationLimits?: {
      readonly min: readonly [number, number, number]
      readonly max: readonly [number, number, number]
    }
  }
  readonly solverIterations: number
  readonly solverTolerance: number
}

/** Skeleton profile defining bone hierarchy and mappings. */
export interface SkeletonProfile {
  readonly rootBone: RootBoneConfig
  readonly boneMappings: readonly BoneMapping[]
  readonly ikTargets: readonly IKTargetProfile[]
  readonly boneHierarchy: readonly {
    readonly boneId: BoneId
    readonly parentId: BoneId | null
    readonly name: string
  }[]
  readonly bindPose: readonly {
    readonly boneId: BoneId
    readonly position: readonly [number, number, number]
    readonly rotation: readonly [number, number, number, number]
    readonly scale: readonly [number, number, number]
  }[]
}

/** Animation parameter definition for runtime values. */
export interface AnimationParameter {
  readonly id: AnimationParameterId
  readonly name: string
  readonly type: 'float' | 'int' | 'bool' | 'trigger' | 'vector2' | 'vector3'
  readonly defaultValue: number | boolean | readonly [number, number] | readonly [number, number, number]
  readonly minValue?: number
  readonly maxValue?: number
  readonly description?: string
  readonly isSynchronized: boolean
  readonly networkPriority: 'high' | 'medium' | 'low'
}

/** Parameter value at runtime. */
export type AnimationParameterValue =
  | number
  | boolean
  | readonly [number, number]
  | readonly [number, number, number]

/** Runtime parameter bag. */
export interface AnimationParameterBag {
  readonly values: ReadonlyMap<AnimationParameterId, AnimationParameterValue>
  readonly triggers: ReadonlySet<AnimationParameterId>
}

/** Blend tree node types. */
export type BlendTreeNodeType = '1d' | '2d' | 'direct' | 'additive' | 'override'

/** 1D blend tree configuration. */
export interface BlendTree1DConfig {
  readonly type: '1d'
  readonly parameter: AnimationParameterId
  readonly thresholds: readonly number[]
  readonly clips: readonly string[]
  readonly loop: boolean
  readonly speedMultiplier: number
}

/** 2D blend tree configuration. */
export interface BlendTree2DConfig {
  readonly type: '2d'
  readonly parameterX: AnimationParameterId
  readonly parameterY: AnimationParameterId
  readonly positions: readonly (readonly [number, number])[]
  readonly clips: readonly string[]
  readonly blendType: 'simple' | 'freeform' | 'cartesian'
  readonly loop: boolean
  readonly speedMultiplier: number
}

/** Direct animation clip reference. */
export interface BlendTreeDirectConfig {
  readonly type: 'direct'
  readonly clip: string
  readonly loop: boolean
  readonly speedMultiplier: number
  readonly normalizedTime?: number
}

/** Additive animation layer. */
export interface BlendTreeAdditiveConfig {
  readonly type: 'additive'
  readonly baseNode: BlendTreeNode
  readonly additiveNode: BlendTreeNode
  readonly weight: number
  readonly weightParameter?: AnimationParameterId
}

/** Override animation layer. */
export interface BlendTreeOverrideConfig {
  readonly type: 'override'
  readonly baseNode: BlendTreeNode
  readonly overrideNode: BlendTreeNode
  readonly weight: number
  readonly weightParameter?: AnimationParameterId
}

/** Blend tree node - discriminated union for complex blending. */
export type BlendTreeNode =
  | BlendTree1DConfig
  | BlendTree2DConfig
  | BlendTreeDirectConfig
  | BlendTreeAdditiveConfig
  | BlendTreeOverrideConfig

/** Blend tree node with children (for nested structures). */
export interface BlendTreeNodeRef {
  readonly node: BlendTreeNode
  readonly children: readonly BlendTreeNodeRef[]
}

/** Locomotion type classification. */
export type LocomotionType =
  | 'walk'
  | 'run'
  | 'sprint'
  | 'crouchWalk'
  | 'crouchRun'
  | 'prone'
  | 'swim'
  | 'fly'
  | 'climb'
  | 'custom'

/** Speed range for locomotion states. */
export interface SpeedRange {
  readonly min: number
  readonly max: number
  readonly optimal: number
}

/** Locomotion profile with blend tree configuration. */
export interface LocomotionProfile {
  readonly type: LocomotionType
  readonly name: string
  readonly speedRange: SpeedRange
  readonly blendTree: BlendTreeNodeRef
  readonly transitionDuration: number
  readonly exitDuration: number
  readonly footIKEnabled: boolean
  readonly footIKTargets: readonly IKTargetId[]
  readonly rootMotionEnabled: boolean
  readonly rootMotionScale: number
  readonly turnSensitivity: number
  readonly accelerationTime: number
  readonly decelerationTime: number
}

/** Animation state definition with parameters. */
export interface StateProfile {
  readonly id: AnimationStateId
  readonly name: string
  readonly tags: readonly string[]
  readonly blendTree: BlendTreeNodeRef
  readonly parameters: readonly AnimationParameter[]
  readonly defaultParameterValues: ReadonlyMap<AnimationParameterId, AnimationParameterValue>
  readonly loop: boolean
  readonly speed: number
  readonly normalizedTime: number
  readonly isLooping: boolean
  readonly canTransitionToSelf: boolean
  readonly exitTime: number
  readonly exitTimeParameter?: AnimationParameterId
  readonly onEnterCallbacks: readonly string[]
  readonly onExitCallbacks: readonly string[]
  readonly onUpdateCallbacks: readonly string[]
  readonly requiredIKTargets: readonly IKTargetId[]
  readonly layerMask: number
  readonly weight: number
  readonly priority: number
}

/** Transition condition types. */
export type TransitionConditionType =
  | 'parameterEquals'
  | 'parameterNotEquals'
  | 'parameterGreater'
  | 'parameterLess'
  | 'parameterGreaterOrEqual'
  | 'parameterLessOrEqual'
  | 'parameterInRange'
  | 'triggerActivated'
  | 'timeElapsed'
  | 'stateTimeNormalized'
  | 'custom'

/** Transition condition definition. */
export interface TransitionCondition {
  readonly type: TransitionConditionType
  readonly parameterId?: AnimationParameterId
  readonly value?: AnimationParameterValue
  readonly minValue?: number
  readonly maxValue?: number
  readonly customEvaluator?: string
}

/** State transition rule with conditions. */
export interface TransitionRule {
  readonly fromState: AnimationStateId | '*'
  readonly toState: AnimationStateId
  readonly conditions: readonly TransitionCondition[]
  readonly hasExitTime: boolean
  readonly exitTime: number
  readonly duration: number
  readonly offset: number
  readonly interruptionSource: 'none' | 'currentState' | 'nextState' | 'both'
  readonly orderedInterruption: boolean
  readonly canTransitionToSelf: boolean
  readonly priority: number
  readonly description?: string
}

/** Procedural animation fallback configuration. */
export interface FallbackProfile {
  readonly enabled: boolean
  readonly fallbackType: 'procedural' | 'idle' | 'disabled' | 'ragdoll'
  readonly proceduralConfig?: {
    readonly type: 'twoBoneIK' | 'fabric' | 'spring' | 'lookAt' | 'reach'
    readonly targetParameter?: AnimationParameterId
    readonly damping: number
    readonly stiffness: number
    readonly maxDistance: number
    readonly boneChain: readonly BoneId[]
  }
  readonly idleConfig?: {
    readonly idleClips: readonly string[]
    readonly blendDuration: number
    readonly randomizeStartTime: boolean
  }
  readonly ragdollConfig?: {
    readonly blendDuration: number
    readonly collisionLayers: readonly number[]
    readonly getUpEnabled: boolean
    readonly getUpAnimation?: string
  }
  readonly triggerConditions: readonly TransitionCondition[]
  readonly priority: number
}

/** Animation layer configuration for layered playback. */
export interface AnimationLayer {
  readonly id: number
  readonly name: string
  readonly weight: number
  readonly weightParameter?: AnimationParameterId
  readonly mask: readonly BoneId[]
  readonly additive: boolean
  readonly syncGroup?: number
}

/** Animation event definition. */
export interface AnimationEvent {
  readonly name: string
  readonly normalizedTime: number
  readonly parameterId?: AnimationParameterId
  readonly floatValue?: number
  readonly intValue?: number
  readonly stringValue?: string
  readonly triggerOnce: boolean
}

/** Main animation profile combining all subsystems. */
export interface AnimationProfile {
  readonly id: AnimationProfileId
  readonly name: string
  readonly version: ProfileVersion
  readonly description?: string
  readonly author?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly skeleton: SkeletonProfile
  readonly locomotionProfiles: readonly LocomotionProfile[]
  readonly states: readonly StateProfile[]
  readonly transitions: readonly TransitionRule[]
  readonly fallback: FallbackProfile
  readonly layers: readonly AnimationLayer[]
  readonly parameters: readonly AnimationParameter[]
  readonly events: readonly AnimationEvent[]
  readonly defaultState: AnimationStateId
  readonly tags: readonly string[]
  readonly metadata: ReadonlyMap<string, unknown>
}

/** Animation profile validation result. */
export interface AnimationProfileValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly missingStates: readonly AnimationStateId[]
  readonly missingParameters: readonly AnimationParameterId[]
  readonly circularTransitions: readonly [AnimationStateId, AnimationStateId][]
}

/** Runtime animation state. */
export interface AnimationRuntimeState {
  readonly currentState: AnimationStateId
  readonly previousState: AnimationStateId | null
  readonly stateTime: number
  readonly normalizedTime: number
  readonly activeTransitions: readonly {
    readonly from: AnimationStateId
    readonly to: AnimationStateId
    readonly progress: number
    readonly duration: number
  }[]
  readonly parameterBag: AnimationParameterBag
  readonly activeLayers: readonly number[]
  readonly ikTargetPositions: ReadonlyMap<IKTargetId, readonly [number, number, number]>
  readonly ikTargetRotations: ReadonlyMap<IKTargetId, readonly [number, number, number, number]>
}

/** Animation profile builder for fluent construction. */
export class AnimationProfileBuilder {
  // Internal mutable profile type (without readonly)
  private profile: {
    id: AnimationProfileId
    name: string
    version: ProfileVersion
    description?: string
    author?: string
    createdAt: string
    updatedAt: string
    skeleton: SkeletonProfile
    locomotionProfiles: LocomotionProfile[]
    states: StateProfile[]
    transitions: TransitionRule[]
    fallback: FallbackProfile
    layers: AnimationLayer[]
    parameters: AnimationParameter[]
    events: AnimationEvent[]
    defaultState: AnimationStateId
    tags: string[]
    metadata: Map<string, unknown>
  } = {
    id: createAnimationProfileId(''),
    name: '',
    version: { major: 1, minor: 0, patch: 0 },
    skeleton: {
      rootBone: {
        boneId: createBoneId('root'),
        positionOffset: [0, 0, 0],
        rotationOffset: [0, 0, 0, 1],
        scale: 1,
      },
      boneMappings: [],
      ikTargets: [],
      boneHierarchy: [],
      bindPose: [],
    },
    locomotionProfiles: [],
    states: [],
    transitions: [],
    fallback: {
      enabled: true,
      fallbackType: 'idle',
      priority: 0,
      triggerConditions: [],
    },
    layers: [],
    parameters: [],
    events: [],
    defaultState: createAnimationStateId(''),
    tags: [],
    metadata: new Map(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  setId(id: string): this {
    this.profile.id = createAnimationProfileId(id)
    return this
  }

  setName(name: string): this {
    this.profile.name = name
    return this
  }

  setVersion(major: number, minor: number, patch: number, label?: string): this {
    this.profile.version = { major, minor, patch, label }
    return this
  }

  setDescription(description: string): this {
    this.profile.description = description
    return this
  }

  setAuthor(author: string): this {
    this.profile.author = author
    return this
  }

  setSkeleton(skeleton: SkeletonProfile): this {
    this.profile.skeleton = skeleton
    return this
  }

  addLocomotionProfile(locomotion: LocomotionProfile): this {
    this.profile.locomotionProfiles = [...(this.profile.locomotionProfiles ?? []), locomotion]
    return this
  }

  addState(state: StateProfile): this {
    this.profile.states = [...(this.profile.states ?? []), state]
    return this
  }

  addTransition(transition: TransitionRule): this {
    this.profile.transitions = [...(this.profile.transitions ?? []), transition]
    return this
  }

  setFallback(fallback: FallbackProfile): this {
    this.profile.fallback = fallback
    return this
  }

  addLayer(layer: AnimationLayer): this {
    this.profile.layers = [...(this.profile.layers ?? []), layer]
    return this
  }

  addParameter(parameter: AnimationParameter): this {
    this.profile.parameters = [...(this.profile.parameters ?? []), parameter]
    return this
  }

  addEvent(event: AnimationEvent): this {
    this.profile.events = [...(this.profile.events ?? []), event]
    return this
  }

  setDefaultState(stateId: AnimationStateId): this {
    this.profile.defaultState = stateId
    return this
  }

  addTag(tag: string): this {
    this.profile.tags = [...(this.profile.tags ?? []), tag]
    return this
  }

  setMetadata(key: string, value: unknown): this {
    const metadata = new Map(this.profile.metadata)
    metadata.set(key, value)
    this.profile.metadata = metadata
    return this
  }

  build(): AnimationProfile {
    if (!this.profile.id) throw new Error('AnimationProfile requires an id')
    if (!this.profile.name) throw new Error('AnimationProfile requires a name')
    if (!this.profile.defaultState) throw new Error('AnimationProfile requires a defaultState')
    if (!this.profile.skeleton) throw new Error('AnimationProfile requires a skeleton')
    if ((this.profile.states ?? []).length === 0) throw new Error('AnimationProfile requires at least one state')

    return {
      id: this.profile.id,
      name: this.profile.name,
      version: this.profile.version,
      description: this.profile.description,
      author: this.profile.author,
      createdAt: this.profile.createdAt,
      updatedAt: new Date().toISOString(),
      skeleton: this.profile.skeleton,
      locomotionProfiles: this.profile.locomotionProfiles ?? [],
      states: this.profile.states ?? [],
      transitions: this.profile.transitions ?? [],
      fallback: this.profile.fallback,
      layers: this.profile.layers ?? [],
      parameters: this.profile.parameters ?? [],
      events: this.profile.events ?? [],
      defaultState: this.profile.defaultState,
      tags: this.profile.tags ?? [],
      metadata: this.profile.metadata ?? new Map(),
    }
  }
}

/** Creates a new AnimationProfileBuilder. */
export function createAnimationProfileBuilder(): AnimationProfileBuilder {
  return new AnimationProfileBuilder()
}

/** Validates an animation profile. */
export function validateAnimationProfile(profile: AnimationProfile): AnimationProfileValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const missingStates: AnimationStateId[] = []
  const missingParameters: AnimationParameterId[] = []
  const circularTransitions: [AnimationStateId, AnimationStateId][] = []

  const stateIds = new Set(profile.states.map(s => s.id))
  const parameterIds = new Set(profile.parameters.map(p => p.id))

  // Check default state exists
  if (!stateIds.has(profile.defaultState)) {
    errors.push(`Default state "${profile.defaultState}" not found in states`)
    missingStates.push(profile.defaultState)
  }

  // Check transitions reference valid states
  for (const transition of profile.transitions) {
    if (transition.fromState !== '*' && !stateIds.has(transition.fromState)) {
      errors.push(`Transition from unknown state: "${transition.fromState}"`)
      missingStates.push(transition.fromState)
    }
    if (!stateIds.has(transition.toState)) {
      errors.push(`Transition to unknown state: "${transition.toState}"`)
      missingStates.push(transition.toState)
    }

    // Check for circular transitions
    if (transition.fromState !== '*' && transition.fromState === transition.toState && !transition.canTransitionToSelf) {
      circularTransitions.push([transition.fromState, transition.toState])
    }
  }

  // Check state parameters reference valid parameters
  for (const state of profile.states) {
    for (const param of state.parameters) {
      if (!parameterIds.has(param.id)) {
        warnings.push(`State "${state.id}" references unknown parameter: "${param.id}"`)
        missingParameters.push(param.id)
      }
    }
    if (state.exitTimeParameter && !parameterIds.has(state.exitTimeParameter)) {
      warnings.push(`State "${state.id}" references unknown exitTimeParameter: "${state.exitTimeParameter}"`)
      missingParameters.push(state.exitTimeParameter)
    }
  }

  // Check transition conditions reference valid parameters
  for (const transition of profile.transitions) {
    for (const condition of transition.conditions) {
      if (condition.parameterId && !parameterIds.has(condition.parameterId)) {
        warnings.push(`Transition "${transition.fromState}" -> "${transition.toState}" references unknown parameter: "${condition.parameterId}"`)
        missingParameters.push(condition.parameterId)
      }
    }
  }

  // Check IK targets exist in skeleton
  const skeletonIKTargets = new Set(profile.skeleton.ikTargets.map(t => t.id))
  for (const locomotion of profile.locomotionProfiles) {
    for (const ikTargetId of locomotion.footIKTargets) {
      if (!skeletonIKTargets.has(ikTargetId)) {
        warnings.push(`Locomotion "${locomotion.name}" references unknown IK target: "${ikTargetId}"`)
      }
    }
  }
  for (const state of profile.states) {
    for (const ikTargetId of state.requiredIKTargets) {
      if (!skeletonIKTargets.has(ikTargetId)) {
        warnings.push(`State "${state.id}" references unknown IK target: "${ikTargetId}"`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missingStates: [...new Set(missingStates)],
    missingParameters: [...new Set(missingParameters)],
    circularTransitions,
  }
}

/** Default animation parameter definitions. */
export const DEFAULT_ANIMATION_PARAMETERS: readonly AnimationParameter[] = [
  {
    id: createAnimationParameterId('speed'),
    name: 'Speed',
    type: 'float',
    defaultValue: 0,
    minValue: 0,
    maxValue: 10,
    description: 'Movement speed magnitude',
    isSynchronized: true,
    networkPriority: 'high',
  },
  {
    id: createAnimationParameterId('direction'),
    name: 'Direction',
    type: 'float',
    defaultValue: 0,
    minValue: -180,
    maxValue: 180,
    description: 'Movement direction in degrees',
    isSynchronized: true,
    networkPriority: 'high',
  },
  {
    id: createAnimationParameterId('isGrounded'),
    name: 'Is Grounded',
    type: 'bool',
    defaultValue: true,
    description: 'Whether the character is on the ground',
    isSynchronized: true,
    networkPriority: 'high',
  },
  {
    id: createAnimationParameterId('isMoving'),
    name: 'Is Moving',
    type: 'bool',
    defaultValue: false,
    description: 'Whether the character is moving',
    isSynchronized: true,
    networkPriority: 'medium',
  },
  {
    id: createAnimationParameterId('jump'),
    name: 'Jump',
    type: 'trigger',
    defaultValue: false,
    description: 'Jump trigger',
    isSynchronized: true,
    networkPriority: 'high',
  },
  {
    id: createAnimationParameterId('crouch'),
    name: 'Crouch',
    type: 'bool',
    defaultValue: false,
    description: 'Whether the character is crouching',
    isSynchronized: true,
    networkPriority: 'medium',
  },
  {
    id: createAnimationParameterId('aimDirection'),
    name: 'Aim Direction',
    type: 'vector2',
    defaultValue: [0, 0] as const,
    description: 'Aim direction in 2D',
    isSynchronized: true,
    networkPriority: 'medium',
  },
  {
    id: createAnimationParameterId('velocity'),
    name: 'Velocity',
    type: 'vector3',
    defaultValue: [0, 0, 0] as const,
    description: 'Current velocity vector',
    isSynchronized: true,
    networkPriority: 'high',
  },
]

/** Common locomotion type presets. */
export const LOCOMOTION_TYPE_PRESETS: ReadonlyMap<LocomotionType, Partial<LocomotionProfile>> = new Map([
  ['walk', {
    transitionDuration: 0.2,
    exitDuration: 0.1,
    footIKEnabled: true,
    rootMotionEnabled: true,
    rootMotionScale: 1,
    turnSensitivity: 1,
    accelerationTime: 0.3,
    decelerationTime: 0.2,
  }],
  ['run', {
    transitionDuration: 0.15,
    exitDuration: 0.1,
    footIKEnabled: true,
    rootMotionEnabled: true,
    rootMotionScale: 1,
    turnSensitivity: 0.8,
    accelerationTime: 0.2,
    decelerationTime: 0.15,
  }],
  ['sprint', {
    transitionDuration: 0.1,
    exitDuration: 0.15,
    footIKEnabled: true,
    rootMotionEnabled: true,
    rootMotionScale: 1,
    turnSensitivity: 0.5,
    accelerationTime: 0.4,
    decelerationTime: 0.3,
  }],
  ['crouchWalk', {
    transitionDuration: 0.25,
    exitDuration: 0.2,
    footIKEnabled: true,
    rootMotionEnabled: true,
    rootMotionScale: 0.7,
    turnSensitivity: 1.2,
    accelerationTime: 0.3,
    decelerationTime: 0.25,
  }],
  ['swim', {
    transitionDuration: 0.3,
    exitDuration: 0.2,
    footIKEnabled: false,
    rootMotionEnabled: true,
    rootMotionScale: 1,
    turnSensitivity: 1.5,
    accelerationTime: 0.5,
    decelerationTime: 0.4,
  }],
])