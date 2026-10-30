/**
 * Animation Registry
 *
 * Global registry for animation profiles with auto-detection capabilities.
 */

import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import * as THREE from 'three'
import {
  type AnimationProfile,
  type AnimationProfileId,
  AnimationProfileBuilder,
  createAnimationProfileId,
  createBoneId,
  createIKTargetId,
  type BoneMapping,
  type IKTargetProfile,
} from './AnimationProfile'

// ============================================================================
// Registry Storage
// ============================================================================

const profileMap = new Map<AnimationProfileId, AnimationProfile>()

/**
 * AnimationRegistry - Static class for managing animation profiles globally.
 */
export class AnimationRegistry {
  /**
   * Register an animation profile globally.
   */
  static register(profile: AnimationProfile): void {
    profileMap.set(profile.id, profile)
  }

  /**
   * Get an animation profile by ID.
   */
  static get(id: string): AnimationProfile | null {
    const profileId = createAnimationProfileId(id)
    return profileMap.get(profileId) ?? null
  }

  /**
   * Get all registered animation profiles.
   */
  static list(): readonly AnimationProfile[] {
    return Array.from(profileMap.values())
  }

  /**
   * Create a custom animation profile from overrides.
   */
  static createCustom(overrides: Partial<AnimationProfile> & { baseId?: string }): AnimationProfile {
    const baseId = overrides.baseId ?? 'humanoid_v1'
    const base = AnimationRegistry.get(baseId)
    if (!base) {
      throw new Error(`Base animation profile not found: ${baseId}`)
    }

    const builder = new AnimationProfileBuilder()
      .setId(overrides.id ?? `${base.id}_custom`)
      .setName(overrides.name ?? `${base.name} (Custom)`)
      .setVersion(
        overrides.version?.major ?? base.version.major,
        overrides.version?.minor ?? base.version.minor,
        overrides.version?.patch ?? base.version.patch,
        overrides.version?.label ?? base.version.label ?? ''
      )
      .setDescription(overrides.description ?? base.description ?? '')
      .setAuthor(overrides.author ?? base.author ?? '')
      .setSkeleton(overrides.skeleton ?? base.skeleton)

    for (const locomotion of overrides.locomotionProfiles ?? base.locomotionProfiles) {
      builder.addLocomotionProfile(locomotion)
    }

    for (const state of overrides.states ?? base.states) {
      builder.addState(state)
    }

    for (const transition of overrides.transitions ?? base.transitions) {
      builder.addTransition(transition)
    }

    builder.setFallback(overrides.fallback ?? base.fallback)

    for (const layer of overrides.layers ?? base.layers) {
      builder.addLayer(layer)
    }

    for (const param of overrides.parameters ?? base.parameters) {
      builder.addParameter(param)
    }

    for (const event of overrides.events ?? base.events) {
      builder.addEvent(event)
    }

    builder.setDefaultState(overrides.defaultState ?? base.defaultState)

    for (const tag of overrides.tags ?? base.tags) {
      builder.addTag(tag)
    }

    if (overrides.metadata) {
      for (const [key, value] of overrides.metadata) {
        builder.setMetadata(key, value)
      }
    }

    return builder.build()
  }

  /**
   * Detect skeleton type from GLTF.
   */
  static detectSkeletonType(gltf: GLTF): 'humanoid' | 'quadruped' | 'generic' {
    const boneNames = new Set<string>()
    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Bone || child instanceof THREE.SkinnedMesh) {
        boneNames.add(child.name.toLowerCase())
      }
    })

    // Check for humanoid patterns (Mixamo, Rigify, UE4/UE5 mannequin, etc.)
    const humanoidPatterns = [
      'hip', 'pelvis', 'spine', 'chest', 'neck', 'head',
      'leftshoulder', 'leftarm', 'leftforearm', 'lefthand',
      'rightshoulder', 'rightarm', 'rightforearm', 'righthand',
      'leftupleg', 'leftleg', 'leftfoot', 'lefttoes',
      'rightupleg', 'rightleg', 'rightfoot', 'righttoes',
      'mixamorig:',
      'root',
      'hips',
    ]

    // Check for quadruped patterns
    const quadrupedPatterns = [
      'front_left_', 'front_right_', 'back_left_', 'back_right_',
      'fl_', 'fr_', 'bl_', 'br_',
      'shoulder', 'elbow', 'wrist', 'paw',
      'hip', 'knee', 'ankle', 'hoof',
      'tail',
      'spine',
      'neck', 'head',
    ]

    let humanoidScore = 0
    let quadrupedScore = 0

    for (const name of boneNames) {
      for (const pattern of humanoidPatterns) {
        if (name.includes(pattern)) {
          humanoidScore++
          break
        }
      }
      for (const pattern of quadrupedPatterns) {
        if (name.includes(pattern)) {
          quadrupedScore++
          break
        }
      }
    }

    // Require a minimum threshold to avoid false positives
    if (humanoidScore >= 8) return 'humanoid'
    if (quadrupedScore >= 6) return 'quadruped'

    return 'generic'
  }

  /**
   * Match an animation profile for a GLTF automatically.
   */
  static match(gltf: GLTF): AnimationProfile | null {
    const skeletonType = AnimationRegistry.detectSkeletonType(gltf)

    switch (skeletonType) {
      case 'humanoid':
        return AnimationRegistry.get('humanoid_v1')
      case 'quadruped':
        return AnimationRegistry.get('quadruped_v1')
      default:
        return AnimationRegistry.get('generic_v1')
    }
  }

  /**
   * Initialize built-in animation profiles.
   * Call this during engine startup.
   */
  static async initializeBuiltinProfiles(): Promise<void> {
    // Profiles are registered by their respective modules
    // This function ensures they are loaded
    await import('./profiles/humanoid')
    await import('./profiles/quadruped')
    await import('./profiles/generic')
  }

  /**
   * Clear all registered profiles (mainly for testing).
   */
  static clear(): void {
    profileMap.clear()
  }

  /**
   * Get the number of registered profiles.
   */
  static size(): number {
    return profileMap.size
  }

  /**
   * Check if a profile is registered.
   */
  static has(id: string): boolean {
    const profileId = createAnimationProfileId(id)
    return profileMap.has(profileId)
  }
}

// ============================================================================
// Helper functions for building built-in profiles
// ============================================================================

/** Create standard humanoid bone mappings. */
export function createHumanoidBoneMappings(): readonly BoneMapping[] {
  const bones = [
    'root', 'hips', 'spine', 'chest', 'neck', 'head',
    'leftshoulder', 'leftarm', 'leftforearm', 'lefthand',
    'rightshoulder', 'rightarm', 'rightforearm', 'righthand',
    'leftupleg', 'leftleg', 'leftfoot', 'lefttoes',
    'rightupleg', 'rightleg', 'rightfoot', 'righttoes',
  ] as const

  return bones.map((name) => ({
    sourceBone: createBoneId(name),
    targetBone: createBoneId(name),
    required: ['root', 'hips', 'spine', 'head', 'leftupleg', 'rightupleg'].includes(name),
    fallbackBone: undefined,
  }))
}

/** Create standard quadruped bone mappings. */
export function createQuadrupedBoneMappings(): readonly BoneMapping[] {
  const bones = [
    'root',
    'spine1', 'spine2', 'spine3',
    'neck', 'head',
    'tail1', 'tail2', 'tail3',
    'front_left_shoulder', 'front_left_leg', 'front_left_paw',
    'front_right_shoulder', 'front_right_leg', 'front_right_paw',
    'back_left_shoulder', 'back_left_leg', 'back_left_paw',
    'back_right_shoulder', 'back_right_leg', 'back_right_paw',
  ] as const

  return bones.map((name) => ({
    sourceBone: createBoneId(name),
    targetBone: createBoneId(name),
    required: ['root', 'spine1', 'head', 'front_left_shoulder', 'front_right_shoulder', 'back_left_shoulder', 'back_right_shoulder'].includes(name),
    fallbackBone: undefined,
  }))
}

/** Create generic bone mappings (minimal). */
export function createGenericBoneMappings(): readonly BoneMapping[] {
  return [
    {
      sourceBone: createBoneId('root'),
      targetBone: createBoneId('root'),
      required: true,
      fallbackBone: undefined,
    },
  ]
}

/** Create humanoid IK targets. */
export function createHumanoidIKTargets(): readonly IKTargetProfile[] {
  return [
    {
      id: createIKTargetId('leftFoot'),
      name: 'Left Foot',
      boneChain: [createBoneId('leftupleg'), createBoneId('leftleg'), createBoneId('leftfoot')],
      targetBone: createBoneId('leftfoot'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 10,
      constraints: { minDistance: 0, maxDistance: 1 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
    {
      id: createIKTargetId('rightFoot'),
      name: 'Right Foot',
      boneChain: [createBoneId('rightupleg'), createBoneId('rightleg'), createBoneId('rightfoot')],
      targetBone: createBoneId('rightfoot'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 10,
      constraints: { minDistance: 0, maxDistance: 1 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
    {
      id: createIKTargetId('leftHand'),
      name: 'Left Hand',
      boneChain: [createBoneId('leftshoulder'), createBoneId('leftarm'), createBoneId('leftforearm'), createBoneId('lefthand')],
      targetBone: createBoneId('lefthand'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 8,
      constraints: { minDistance: 0, maxDistance: 1.5 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
    {
      id: createIKTargetId('rightHand'),
      name: 'Right Hand',
      boneChain: [createBoneId('rightshoulder'), createBoneId('rightarm'), createBoneId('rightforearm'), createBoneId('righthand')],
      targetBone: createBoneId('righthand'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 8,
      constraints: { minDistance: 0, maxDistance: 1.5 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
    {
      id: createIKTargetId('head'),
      name: 'Head LookAt',
      boneChain: [createBoneId('spine'), createBoneId('chest'), createBoneId('neck'), createBoneId('head')],
      targetBone: createBoneId('head'),
      effectorType: 'rotation',
      weight: 1,
      priority: 5,
      constraints: { rotationLimits: { min: [-0.8, -0.8, -0.8], max: [0.8, 0.8, 0.8] } },
      solverIterations: 5,
      solverTolerance: 0.01,
    },
  ]
}

/** Create quadruped IK targets. */
export function createQuadrupedIKTargets(): readonly IKTargetProfile[] {
  return [
    {
      id: createIKTargetId('frontLeftPaw'),
      name: 'Front Left Paw',
      boneChain: [createBoneId('front_left_shoulder'), createBoneId('front_left_leg'), createBoneId('front_left_paw')],
      targetBone: createBoneId('front_left_paw'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 10,
      constraints: { minDistance: 0, maxDistance: 1 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
    {
      id: createIKTargetId('frontRightPaw'),
      name: 'Front Right Paw',
      boneChain: [createBoneId('front_right_shoulder'), createBoneId('front_right_leg'), createBoneId('front_right_paw')],
      targetBone: createBoneId('front_right_paw'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 10,
      constraints: { minDistance: 0, maxDistance: 1 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
    {
      id: createIKTargetId('backLeftPaw'),
      name: 'Back Left Paw',
      boneChain: [createBoneId('back_left_shoulder'), createBoneId('back_left_leg'), createBoneId('back_left_paw')],
      targetBone: createBoneId('back_left_paw'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 10,
      constraints: { minDistance: 0, maxDistance: 1 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
    {
      id: createIKTargetId('backRightPaw'),
      name: 'Back Right Paw',
      boneChain: [createBoneId('back_right_shoulder'), createBoneId('back_right_leg'), createBoneId('back_right_paw')],
      targetBone: createBoneId('back_right_paw'),
      effectorType: 'positionAndRotation',
      weight: 1,
      priority: 10,
      constraints: { minDistance: 0, maxDistance: 1 },
      solverIterations: 10,
      solverTolerance: 0.001,
    },
  ]
}

/** Create generic IK targets (none). */
export function createGenericIKTargets(): readonly IKTargetProfile[] {
  return []
}

// ============================================================================
// Standalone wrapper functions for backward compatibility with index.ts
// ============================================================================

/** Register an animation profile globally. */
export function registerAnimationProfile(profile: AnimationProfile): void {
  AnimationRegistry.register(profile)
}

/** Get an animation profile by ID. */
export function getAnimationProfile(id: string): AnimationProfile | null {
  return AnimationRegistry.get(id)
}

/** Get all registered animation profiles. */
export function listAnimationProfiles(): readonly AnimationProfile[] {
  return AnimationRegistry.list()
}

/** Create a custom animation profile from overrides. */
export function createCustomAnimationProfile(overrides: Partial<AnimationProfile> & { baseId?: string }): AnimationProfile {
  return AnimationRegistry.createCustom(overrides)
}

/** Detect skeleton type from GLTF. */
export function detectSkeletonType(gltf: GLTF): 'humanoid' | 'quadruped' | 'generic' {
  return AnimationRegistry.detectSkeletonType(gltf)
}

/** Match an animation profile for a GLTF automatically. */
export function matchAnimationProfile(gltf: GLTF): AnimationProfile | null {
  return AnimationRegistry.match(gltf)
}

/** Initialize built-in animation profiles. */
export async function initializeBuiltinProfiles(): Promise<void> {
  return AnimationRegistry.initializeBuiltinProfiles()
}

/** Clear all registered profiles. */
export function clearAnimationProfiles(): void {
  AnimationRegistry.clear()
}