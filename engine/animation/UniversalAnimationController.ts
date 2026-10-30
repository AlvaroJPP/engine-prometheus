/**
 * Universal Animation Controller
 *
 * Profile-driven animation controller that replaces the hardcoded AnimationController.
 * Supports any animation profile with dynamic state machines, blend trees, and parameters.
 */

import * as THREE from 'three'
import { AnimationMixer, AnimationAction, AnimationClip } from 'three'
import {
  type AnimationProfile,
  type AnimationStateId,
  type AnimationParameterId,
  type AnimationParameter,
  type AnimationParameterValue,
  type AnimationLayer,
  type BlendTreeNodeRef,
  type BlendTree1DConfig,
  type BlendTree2DConfig,
  type BlendTreeDirectConfig,
  type BlendTreeAdditiveConfig,
  type BlendTreeOverrideConfig,
  type StateProfile,
  type TransitionRule,
  createAnimationProfileId,
  createAnimationStateId,
  createAnimationParameterId,
  createBoneId,
} from './AnimationProfile'

// ============================================================================
// Types
// ============================================================================

/** Internal state for a layer. */
interface LayerState {
  readonly layer: AnimationLayer
  currentAction: AnimationAction | null
  nextAction: AnimationAction | null
  transitionProgress: number
  transitionDuration: number
  weight: number
}

/** Active transition between states. */
interface ActiveTransition {
  readonly fromState: AnimationStateId
  readonly toState: AnimationStateId
  readonly startTime: number
  readonly duration: number
  readonly layer: number
}

/** One-shot animation queue entry. */
interface OneShotEntry {
  readonly stateId: AnimationStateId
  readonly action: AnimationAction
  readonly holdAtEnd: boolean
  readonly startTime: number
  readonly priority: number
  layer: number
}

/** Blend tree evaluation result. */
interface BlendResult {
  readonly action: AnimationAction
  readonly weight: number
  readonly speedMultiplier: number
}

// ============================================================================
// UniversalAnimationController
// ============================================================================

/**
 * Universal Animation Controller
 *
 * Driven by an AnimationProfile, supports:
 * - Dynamic state machines with blend trees (1D, 2D, direct, additive, override)
 * - Parameter-driven transitions
 * - Layered playback with masks
 * - IK target integration
 * - One-shot animations with priority
 * - Procedural fallback
 */
export class UniversalAnimationController {
  private readonly mixer: AnimationMixer
  private readonly profile: AnimationProfile

  // State management
  private _currentState: AnimationStateId
  private _previousState: AnimationStateId | null = null
  private _stateTime: number = 0
  private _activeTransitions: ActiveTransition[] = []
  private _oneShots: OneShotEntry[] = []

  // Parameters
  private parameterBag: Map<AnimationParameterId, number> = new Map()
  private triggers: Set<AnimationParameterId> = new Set()

  // Layers
  private layerStates: LayerState[] = []

  // Actions built from profile + clips
  private stateActions: Map<AnimationStateId, AnimationAction> = new Map()

  // Flags
  private disposed: boolean = false
  private isPaused: boolean = false

  constructor(
    mixer: AnimationMixer,
    profile: AnimationProfile,
    clips: AnimationClip[]
  ) {
    this.mixer = mixer
    this.profile = profile
    this._currentState = profile.defaultState

    // Build actions from clips matched to profile states
    this.buildActionsFromClips(clips)

    // Initialize parameter bag with defaults from profile
    for (const param of profile.parameters) {
      if (typeof param.defaultValue === 'number') {
        this.parameterBag.set(param.id, param.defaultValue)
      }
    }

    // Initialize layers
    this.initializeLayers()

    // Start default state
    this.playState(this._currentState, 0)
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private buildActionsFromClips(clips: AnimationClip[]): void {
    // Create a map of clip name to clip for quick lookup
    const clipMap = new Map<string, AnimationClip>()
    for (const clip of clips) {
      clipMap.set(clip.name, clip)
    }

    // For each state in the profile, find matching clip and create action
    for (const state of this.profile.states) {
      const clipName = this.getClipNameForState(state)
      const clip = clipMap.get(clipName)
      if (clip) {
        const action = this.mixer.clipAction(clip)
        action.loop = state.loop ? THREE.LoopRepeat : THREE.LoopOnce
        action.clampWhenFinished = !state.loop
        action.timeScale = state.speed
        this.stateActions.set(state.id, action)
      }
    }
  }

  private getClipNameForState(state: StateProfile): string {
    // Try to get clip name from blend tree
    const directClip = this.extractDirectClip(state.blendTree)
    if (directClip) return directClip
    // Fallback to state name
    return state.name
  }

  private extractDirectClip(nodeRef: BlendTreeNodeRef): string | null {
    const node = nodeRef.node
    if (node.type === 'direct') {
      return node.clip
    }
    // For blend trees, check children
    for (const child of nodeRef.children) {
      const result = this.extractDirectClip(child)
      if (result) return result
    }
    return null
  }

  private initializeLayers(): void {
    this.layerStates = this.profile.layers.map((layer, _index) => ({
      layer,
      currentAction: null,
      nextAction: null,
      transitionProgress: 0,
      transitionDuration: 0,
      weight: layer.weight,
    }))
  }

  // ============================================================================
  // Public API - State Control
  // ============================================================================

  /** Get current state ID as string. */
  get currentState(): string {
    return this._currentState.toString()
  }

  /** Get currently playing one-shot state ID. */
  get activeOneShot(): string | null {
    if (this._oneShots.length === 0) return null
    // Return highest priority one-shot
    return this._oneShots.reduce((max, shot) => shot.priority > max.priority ? shot : max).stateId.toString()
  }

  /** Check if a state exists in the profile. */
  hasState(stateId: string): boolean {
    return this.profile.states.some(s => s.id === stateId)
  }

  /** Get the AnimationAction for a state. */
  getStateClip(stateId: string): AnimationAction | null {
    return this.stateActions.get(createAnimationStateId(stateId)) ?? null
  }

  // ============================================================================
  // Public API - Parameter Control
  // ============================================================================

  /** Set a parameter value (numeric only). */
  setParameter(name: string, value: number): void {
    const paramId = createAnimationParameterId(name)
    const param = this.profile.parameters.find(p => p.id === paramId)
    if (!param) {
      console.warn(`[UniversalAnimationController] Unknown parameter: ${name}`)
      return
    }

    // Validate and clamp
    let validatedValue = value
    if (param.minValue !== undefined) validatedValue = Math.max(param.minValue, value)
    if (param.maxValue !== undefined) validatedValue = Math.min(param.maxValue, validatedValue)

    this.parameterBag.set(paramId, validatedValue)

    // Handle triggers
    if (param.type === 'trigger' && value > 0) {
      this.triggers.add(paramId)
    }
  }

  /** Get a parameter value as number. */
  getParameter(name: string): number {
    const value = this.parameterBag.get(createAnimationParameterId(name))
    return value ?? 0
  }

  // ============================================================================
  // Public API - State Transitions
  // ============================================================================

  /**
   * Request a state change. Uses profile transitions for smooth blending.
   * Optional params can be passed to set parameters atomically with the state change.
   */
  setState(stateId: string, params?: Record<string, number>): boolean {
    const targetState = createAnimationStateId(stateId)

    if (!this.hasState(targetState)) {
      console.warn(`[UniversalAnimationController] State not found: ${stateId}`)
      return false
    }

    // Set parameters if provided
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        this.setParameter(name, value)
      }
    }

    // Check if already in this state
    if (this._currentState === targetState) {
      return true
    }

    // Check transition rules
    const transition = this.findTransition(this._currentState, targetState)
    if (!transition) {
      console.warn(`[UniversalAnimationController] No valid transition from ${this._currentState} to ${targetState}`)
      return false
    }

    // Validate conditions
    if (!this.evaluateConditions(transition.conditions)) {
      return false
    }

    // Execute transition
    this.transitionToState(targetState, transition.duration)
    return true
  }

  /**
   * Play a one-shot animation (returns to previous state after).
   */
  playOneShot(stateId: string, holdAtEnd: boolean = false): boolean {
    const targetState = createAnimationStateId(stateId)

    if (!this.hasState(targetState)) {
      console.warn(`[UniversalAnimationController] One-shot state not found: ${stateId}`)
      return false
    }

    const state = this.profile.states.find(s => s.id === targetState)
    if (!state) return false

    const action = this.getStateClip(targetState)
    if (!action) return false

    const priority = state.priority

    // Cancel lower priority one-shots on same layer
    this._oneShots = this._oneShots.filter(shot => !(shot.layer === 0 && shot.priority <= priority))

    action.reset()
    action.play()
    action.setEffectiveWeight(1)

    this._oneShots.push({
      stateId: targetState,
      action,
      holdAtEnd,
      startTime: this.mixer.time,
      priority,
      layer: 0,
    })

    return true
  }

  /** Cancel a specific one-shot or all one-shots. */
  cancelOneShot(stateId?: string): boolean {
    if (stateId) {
      const targetState = createAnimationStateId(stateId)
      const index = this._oneShots.findIndex(s => s.stateId === targetState)
      if (index >= 0) {
        const shot = this._oneShots[index]
        shot.action.fadeOut(0.1)
        this._oneShots.splice(index, 1)
        return true
      }
      return false
    } else {
      // Cancel all
      for (const shot of this._oneShots) {
        shot.action.fadeOut(0.1)
      }
      this._oneShots = []
      return true
    }
  }

  // ============================================================================
  // Public API - Blending
  // ============================================================================

  /**
   * Set blend weights for directional locomotion (used by humanoid profiles).
   * This is a high-level API for 2D blend trees.
   */
  setBlendWeights(weights: Map<string, number>, speedFactor: number = 1): string | null {
    // Find the locomotion profile that supports 2D blending
    const locomotionProfile = this.profile.locomotionProfiles.find(l =>
      l.blendTree.node.type === '2d'
    )

    if (!locomotionProfile) return null

    // Apply weights to base layer actions
    let dominantAction: AnimationAction | null = null
    let dominantWeight = 0

    for (const [stateId, weight] of weights) {
      if (weight <= 0) continue

      const action = this.getStateClip(stateId)
      if (!action) continue

      action.setEffectiveWeight(weight)

      if (weight > dominantWeight) {
        dominantWeight = weight
        dominantAction = action
      }
    }

    // Set speed multiplier
    if (dominantAction) {
      dominantAction.timeScale = speedFactor * locomotionProfile.rootMotionScale
      return dominantAction.getClip().name
    }

    return null
  }

  // ============================================================================
  // Public API - Update
  // ============================================================================

  /** Update the animation controller. */
  update(dt: number): void {
    if (this.disposed || this.isPaused) return

    // Update parameter triggers (they fire once per frame)
    const triggersToReset: AnimationParameterId[] = []
    for (const triggerId of this.triggers) {
      triggersToReset.push(triggerId)
    }
    for (const id of triggersToReset) {
      this.triggers.delete(id)
    }

    // Update layer weights from parameters
    this.updateLayerWeights()

    // Evaluate transitions
    this.evaluateTransitions()

    // Update one-shots
    this.updateOneShots(dt)

    // Update mixer
    this.mixer.update(dt)

    // Update state time
    this._stateTime += dt
  }

  // ============================================================================
  // Public API - Control
  // ============================================================================

  /** Pause animation updates. */
  pause(): void {
    this.isPaused = true
  }

  /** Resume animation updates. */
  resume(): void {
    this.isPaused = false
  }

  /** Stop all animations. */
  stop(): void {
    for (const layerState of this.layerStates) {
      if (layerState.currentAction) {
        layerState.currentAction.stop()
        layerState.currentAction = null
      }
      if (layerState.nextAction) {
        layerState.nextAction.stop()
        layerState.nextAction = null
      }
    }

    for (const shot of this._oneShots) {
      shot.action.stop()
    }
    this._oneShots = []

    this._activeTransitions = []
    this._stateTime = 0
  }

  /** Dispose the controller. */
  dispose(): void {
    this.disposed = true
    this.stop()
    this.parameterBag.clear()
    this.triggers.clear()
    this.stateActions.clear()
  }

  // ============================================================================
  // Internal - Action Management
  // ============================================================================

  /** Get active action on a layer. */
  private getActiveAction(layerIndex: number): AnimationAction | null {
    const layerState = this.layerStates[layerIndex]
    return layerState?.currentAction ?? null
  }

  // ============================================================================
  // Internal - Blend Tree Evaluation
  // ============================================================================

  /** Evaluate a blend tree and return the blended action. */
  private evaluateBlendTree(
    nodeRef: BlendTreeNodeRef,
    _layerIndex: number
  ): BlendResult | null {
    const node = nodeRef.node
    const paramValues = this.parameterBag

    switch (node.type) {
      case 'direct':
        return this.evaluateDirect(node, _layerIndex)

      case '1d':
        return this.evaluate1D(node, paramValues, _layerIndex)

      case '2d':
        return this.evaluate2D(node, paramValues, _layerIndex)

      case 'additive':
        return this.evaluateAdditive(node, _layerIndex)

      case 'override':
        return this.evaluateOverride(node, _layerIndex)

      default:
        return null
    }
  }

  private evaluateDirect(node: BlendTreeDirectConfig, _layerIndex: number): BlendResult | null {
    const action = this.stateActions.get(createAnimationStateId(node.clip))
    if (!action) return null

    return {
      action,
      weight: 1,
      speedMultiplier: node.speedMultiplier,
    }
  }

  private evaluate1D(
    node: BlendTree1DConfig,
    paramValues: Map<AnimationParameterId, number>,
    _layerIndex: number
  ): BlendResult | null {
    const paramValue = paramValues.get(node.parameter) ?? 0
    const thresholds = node.thresholds
    const clips = node.clips

    if (clips.length === 0) return null

    // Find the two clips to blend between
    let index = 0
    while (index < thresholds.length - 1 && paramValue > thresholds[index + 1]) {
      index++
    }

    if (index >= clips.length - 1) {
      // Past the last threshold, use last clip
      const action = this.stateActions.get(createAnimationStateId(clips[clips.length - 1]))
      return action ? { action, weight: 1, speedMultiplier: node.speedMultiplier } : null
    }

    if (index < 0) {
      // Before first threshold, use first clip
      const action = this.stateActions.get(createAnimationStateId(clips[0]))
      return action ? { action, weight: 1, speedMultiplier: node.speedMultiplier } : null
    }

    // Blend between two clips
    const t = (paramValue - thresholds[index]) / (thresholds[index + 1] - thresholds[index])
    const clipA = clips[index]
    const clipB = clips[index + 1]

    const actionA = this.stateActions.get(createAnimationStateId(clipA))
    const actionB = this.stateActions.get(createAnimationStateId(clipB))

    if (!actionA || !actionB) return actionA ? { action: actionA, weight: 1, speedMultiplier: node.speedMultiplier } : null

    // Crossfade
    actionA.setEffectiveWeight(1 - t)
    actionB.setEffectiveWeight(t)

    return {
      action: t > 0.5 ? actionB : actionA,
      weight: 1,
      speedMultiplier: node.speedMultiplier,
    }
  }

  private evaluate2D(
    node: BlendTree2DConfig,
    paramValues: Map<AnimationParameterId, number>,
    _layerIndex: number
  ): BlendResult | null {
    const paramX = paramValues.get(node.parameterX) ?? 0
    const paramY = paramValues.get(node.parameterY) ?? 0
    const positions = node.positions
    const clips = node.clips

    if (clips.length === 0) return null

    // Find closest position and blend
    // For freeform cartesian, we need barycentric or nearest neighbor
    // Simplified: find nearest clip
    let bestIndex = 0
    let bestDistance = Infinity

    for (let i = 0; i < positions.length; i++) {
      const [px, py] = positions[i]
      const dx = paramX - px
      const dy = paramY - py
      const dist = dx * dx + dy * dy
      if (dist < bestDistance) {
        bestDistance = dist
        bestIndex = i
      }
    }

    const action = this.stateActions.get(createAnimationStateId(clips[bestIndex]))
    if (!action) return null

    return {
      action,
      weight: 1,
      speedMultiplier: node.speedMultiplier,
    }
  }

  private evaluateAdditive(node: BlendTreeAdditiveConfig, _layerIndex: number): BlendResult | null {
    const base = this.evaluateBlendTree({ node: node.baseNode, children: [] }, 0)
    const additive = this.evaluateBlendTree({ node: node.additiveNode, children: [] }, 0)

    if (!base) return null
    if (!additive) return base

    // Apply additive weight
    const weight = node.weightParameter
      ? (this.parameterBag.get(node.weightParameter) ?? node.weight)
      : node.weight

    additive.action.setEffectiveWeight(weight)
    additive.action.enabled = true

    return {
      action: base.action,
      weight: 1,
      speedMultiplier: base.speedMultiplier,
    }
  }

  private evaluateOverride(node: BlendTreeOverrideConfig, _layerIndex: number): BlendResult | null {
    const base = this.evaluateBlendTree({ node: node.baseNode, children: [] }, 0)
    const override = this.evaluateBlendTree({ node: node.overrideNode, children: [] }, 0)

    if (!base) return override
    if (!override) return base

    // Apply override weight
    const weight = node.weightParameter
      ? (this.parameterBag.get(node.weightParameter) ?? node.weight)
      : node.weight

    if (weight >= 1) {
      return override
    }

    // Crossfade
    override.action.setEffectiveWeight(weight)
    base.action.setEffectiveWeight(1 - weight)

    return {
      action: weight > 0.5 ? override.action : base.action,
      weight: 1,
      speedMultiplier: override.speedMultiplier,
    }
  }

  // ============================================================================
  // Internal - State Transitions
  // ============================================================================

  /** Find a valid transition between states. */
  private findTransition(
    fromState: AnimationStateId,
    toState: AnimationStateId
  ): TransitionRule | null {
    // Find matching transition
    const transitions = this.profile.transitions.filter(t =>
      (t.fromState === '*' || t.fromState === fromState) &&
      t.toState === toState
    )

    if (transitions.length === 0) return null

    // Sort by priority and find first valid
    transitions.sort((a, b) => b.priority - a.priority)

    for (const transition of transitions) {
      if (this.evaluateConditions(transition.conditions)) {
        return transition
      }
    }

    return null
  }

  /** Evaluate transition conditions. */
  private evaluateConditions(conditions: readonly { type: string; parameterId?: AnimationParameterId; value?: AnimationParameterValue; minValue?: number; maxValue?: number }[]): boolean {
    for (const condition of conditions) {
      const paramValue = condition.parameterId ? this.parameterBag.get(condition.parameterId) : undefined

      switch (condition.type) {
        case 'parameterEquals':
          if (paramValue !== condition.value) return false
          break
        case 'parameterNotEquals':
          if (paramValue === condition.value) return false
          break
        case 'parameterGreater':
          if (typeof paramValue !== 'number' || typeof condition.value !== 'number' || paramValue <= condition.value) return false
          break
        case 'parameterLess':
          if (typeof paramValue !== 'number' || typeof condition.value !== 'number' || paramValue >= condition.value) return false
          break
        case 'parameterGreaterOrEqual':
          if (typeof paramValue !== 'number' || typeof condition.value !== 'number' || paramValue < condition.value) return false
          break
        case 'parameterLessOrEqual':
          if (typeof paramValue !== 'number' || typeof condition.value !== 'number' || paramValue > condition.value) return false
          break
        case 'parameterInRange':
          if (typeof paramValue !== 'number' || typeof condition.minValue !== 'number' || typeof condition.maxValue !== 'number') return false
          if (paramValue < condition.minValue || paramValue > condition.maxValue) return false
          break
        case 'triggerActivated':
          if (!this.triggers.has(condition.parameterId!)) return false
          break
        case 'timeElapsed':
          if (this._stateTime < (condition.value as number ?? 0)) return false
          break
      }
    }
    return true
  }

  /** Execute a state transition. */
  private transitionToState(targetState: AnimationStateId, duration: number): void {
    const fromState = this._currentState

    // Record transition
    this._activeTransitions.push({
      fromState,
      toState: targetState,
      startTime: this.mixer.time,
      duration,
      layer: 0, // Base layer for now
    })

    // Update state
    this._previousState = this._currentState
    this._currentState = targetState
    this._stateTime = 0

    // Play new state
    this.playState(targetState, duration)

    // Call onExit/onEnter callbacks
    this.callStateCallbacks(fromState, 'exit')
    this.callStateCallbacks(targetState, 'enter')
  }

  /** Play a state on the base layer. */
  private playState(stateId: AnimationStateId, fadeDuration: number): void {
    const state = this.profile.states.find(s => s.id === stateId)
    if (!state) return

    const layerState = this.layerStates[0]
    if (!layerState) return

    const blendResult = this.evaluateBlendTree(state.blendTree, 0)
    if (!blendResult) return

    const action = blendResult.action

    // Crossfade from current action
    if (layerState.currentAction && layerState.currentAction !== action) {
      layerState.currentAction.crossFadeTo(action, fadeDuration, true)
    } else {
      action.reset()
      action.play()
      action.setEffectiveWeight(1)
    }

    layerState.currentAction = action
    layerState.nextAction = null
    layerState.transitionProgress = 0
    layerState.transitionDuration = fadeDuration
  }

  /** Evaluate all possible transitions from current state. */
  private evaluateTransitions(): void {
    // Check transitions from current state
    const transitions = this.profile.transitions.filter(t =>
      t.fromState === '*' || t.fromState === this._currentState
    )

    for (const transition of transitions) {
      if (transition.toState === this._currentState) continue

      if (this.evaluateConditions(transition.conditions)) {
        // Check exit time
        if (transition.hasExitTime) {
          const currentAction = this.getActiveAction(0)
          if (currentAction) {
            const clip = currentAction.getClip()
            const normalizedTime = clip.duration > 0 ? currentAction.time / clip.duration : 0
            if (normalizedTime < transition.exitTime) continue
          }
        }

        // Execute transition
        this.transitionToState(transition.toState, transition.duration)
        break
      }
    }

    // Clean up completed transitions
    this._activeTransitions = this._activeTransitions.filter(t =>
      this.mixer.time - t.startTime < t.duration
    )
  }

  // ============================================================================
  // Internal - One-shots
  // ============================================================================

  private updateOneShots(_deltaSeconds: number): void {
    for (let i = this._oneShots.length - 1; i >= 0; i--) {
      const shot = this._oneShots[i]
      const action = shot.action
      const clip = action.getClip()

      if (clip.duration > 0) {
        const normalizedTime = action.time / clip.duration

        // Check if one-shot finished
        if (normalizedTime >= 1 && !shot.holdAtEnd) {
          action.fadeOut(0.1)
          this._oneShots.splice(i, 1)

          // Resume previous state
          if (this._oneShots.length === 0 && this._previousState) {
            this.setState(this._previousState.toString())
          }
        }
      }
    }
  }

  // ============================================================================
  // Internal - Layer Weights
  // ============================================================================

  private updateLayerWeights(): void {
    for (let i = 0; i < this.layerStates.length; i++) {
      const layerState = this.layerStates[i]
      const layer = layerState.layer

      if (layer.weightParameter) {
        const weight = this.parameterBag.get(layer.weightParameter) ?? layer.weight
        layerState.weight = THREE.MathUtils.clamp(weight, 0, 1)
      }

      // Apply layer weight to actions
      if (layerState.currentAction) {
        layerState.currentAction.setEffectiveWeight(layerState.weight)
      }
      if (layerState.nextAction) {
        layerState.nextAction.setEffectiveWeight(layerState.weight)
      }
    }
  }

  // ============================================================================
  // Internal - Callbacks
  // ============================================================================

  private callStateCallbacks(stateId: AnimationStateId, phase: 'enter' | 'exit'): void {
    const state = this.profile.states.find(s => s.id === stateId)
    if (!state) return

    const callbacks = phase === 'enter' ? state.onEnterCallbacks : state.onExitCallbacks

    for (const _callbackName of callbacks) {
      // Events would be handled via external callback system if needed
    }
  }
}

// ============================================================================
// Backward Compatibility
// ============================================================================

/**
 * Create a UniversalAnimationController from legacy parameters.
 * Used for backward compatibility with old AnimationController API.
 */
export function createLegacyController(
  mixer: AnimationMixer,
  sourceActions: Map<string, AnimationAction>,
  options: {
    defaultState?: string
    locomotionBlendEnabled?: boolean
    proceduralFallbackEnabled?: boolean
  } = {}
): UniversalAnimationController {
  // Extract clips from source actions
  const clips: AnimationClip[] = []
  for (const action of sourceActions.values()) {
    clips.push(action.getClip())
  }

  // Create a minimal profile from legacy actions
  const profile = createLegacyProfile(sourceActions, options)

  return new UniversalAnimationController(mixer, profile, clips)
}

/** Create a minimal legacy-compatible profile. */
function createLegacyProfile(
  sourceActions: Map<string, AnimationAction>,
  options: {
    defaultState?: string
    locomotionBlendEnabled?: boolean
    proceduralFallbackEnabled?: boolean
  }
): AnimationProfile {
  const states: StateProfile[] = []
  const parameters: AnimationParameter[] = []

  for (const [stateId, action] of sourceActions) {
    states.push({
      id: createAnimationStateId(stateId),
      name: stateId,
      tags: [],
      blendTree: {
        node: {
          type: 'direct',
          clip: action.getClip().name,
          loop: true,
          speedMultiplier: 1,
        } as BlendTreeDirectConfig,
        children: [],
      },
      parameters: [],
      defaultParameterValues: new Map(),
      loop: true,
      speed: 1,
      normalizedTime: 0,
      isLooping: true,
      canTransitionToSelf: false,
      exitTime: 0.9,
      onEnterCallbacks: [],
      onExitCallbacks: [],
      onUpdateCallbacks: [],
      requiredIKTargets: [],
      layerMask: 0,
      weight: 1,
      priority: 0,
    })
  }

  // Add default parameters
  parameters.push(
    { id: createAnimationParameterId('speed'), name: 'Speed', type: 'float', defaultValue: 0, minValue: 0, maxValue: 10, description: 'Movement speed', isSynchronized: true, networkPriority: 'high' },
    { id: createAnimationParameterId('direction'), name: 'Direction', type: 'float', defaultValue: 0, minValue: -180, maxValue: 180, description: 'Movement direction', isSynchronized: true, networkPriority: 'high' },
    { id: createAnimationParameterId('isGrounded'), name: 'Is Grounded', type: 'bool', defaultValue: true, description: 'On ground', isSynchronized: true, networkPriority: 'high' },
    { id: createAnimationParameterId('isMoving'), name: 'Is Moving', type: 'bool', defaultValue: false, description: 'Is moving', isSynchronized: true, networkPriority: 'medium' },
    { id: createAnimationParameterId('jump'), name: 'Jump', type: 'trigger', defaultValue: false, description: 'Jump trigger', isSynchronized: true, networkPriority: 'high' },
  )

  const defaultStateId = options.defaultState ? createAnimationStateId(options.defaultState) : createAnimationStateId('idle')

  return {
    id: createAnimationProfileId('legacy_v1'),
    name: 'Legacy Profile',
    version: { major: 1, minor: 0, patch: 0 },
    description: 'Auto-generated legacy compatibility profile',
    skeleton: {
      rootBone: { boneId: createBoneId('root'), positionOffset: [0, 0, 0], rotationOffset: [0, 0, 0, 1], scale: 1 },
      boneMappings: [],
      ikTargets: [],
      boneHierarchy: [],
      bindPose: [],
    },
    locomotionProfiles: [],
    states,
    transitions: [],
    fallback: {
      enabled: options.proceduralFallbackEnabled ?? false,
      fallbackType: 'idle',
      priority: 0,
      triggerConditions: [],
    },
    layers: [
      { id: 0, name: 'Base', weight: 1, mask: [], additive: false },
    ],
    parameters,
    events: [],
    defaultState: defaultStateId,
    tags: ['legacy'],
    metadata: new Map(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}