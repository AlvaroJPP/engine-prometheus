/**
 * AutoMapper - Intelligent Animation Mapping
 *
 * Automatically maps animation clips from GLTF to animation profiles
 * with fallback generation for missing states.
 */

import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { AnimationClip, AnimationAction } from 'three'
import {
  type AnimationProfile,
  type AnimationStateId,
  createAnimationStateId,
} from './AnimationProfile'
import { AnimationRegistry, detectSkeletonType } from './AnimationRegistry'

// ============================================================================
// Types
// ============================================================================

/** Result of automatic animation mapping. */
export interface MappedAnimations {
  /** Map of state ID to AnimationAction */
  actions: Map<string, AnimationAction>
  /** Default parameter values */
  parameters: Map<string, number | boolean | readonly [number, number] | readonly [number, number, number]>
  /** States from profile that have no matching clip */
  missingStates: string[]
  /** Clips that couldn't be mapped to any state */
  extraClips: AnimationClip[]
  /** The profile used for mapping */
  profile: AnimationProfile
  /** Detected skeleton type */
  skeletonType: 'humanoid' | 'quadruped' | 'generic'
}

/** Clip matching result. */
interface ClipMatch {
  clip: AnimationClip
  stateId: AnimationStateId
  confidence: number
  matchedBy: 'exact' | 'pattern' | 'inferred' | 'fallback'
}

/** Procedural animation data. */
export interface ProceduralAnimations {
  clips: Map<string, AnimationClip>
  description: string
}

// ============================================================================
// Animation Name Patterns
// ============================================================================

/** Patterns for matching clip names to state IDs (used by inferAnimationRole). */
const STATE_NAME_PATTERNS: Record<string, RegExp[]> = {
  idle: [/^idle$/i, /^stand$/i, /^rest$/i, /^breath$/i, /^neutral$/i, /^stationary$/i, /^wait$/i, /^parado$/i, /^descanso$/i, /^respirar$/i],
  walk: [/^walk$/i, /^locomotion$/i, /^move$/i, /^stride$/i, /^trot$/i, /^step$/i, /^strafe$/i, /^sidestep$/i, /^sideways$/i, /^andar$/i, /^caminhar$/i],
  walk_slow: [/^walk.?slow$/i, /^slow.?walk$/i, /^walk.?tired$/i, /^caminhar.?devagar$/i],
  walk_backward: [/^walk.?backward$/i, /^walk.?back$/i, /^move.?back$/i, /^walk.?tras$/i, /^caminhar.?tras$/i],
  walk_left: [/^walk.?left$/i, /^strafe.?left$/i, /^side.?left$/i, /^walk.?esquerda$/i, /^caminhar.?esquerda$/i],
  walk_right: [/^walk.?right$/i, /^strafe.?right$/i, /^side.?right$/i, /^walk.?direita$/i, /^caminhar.?direita$/i],
  walk_diagonal_left: [/^walk.?diagonal.?left$/i, /^walk.?diag.?left$/i, /^walk.?forward.?left$/i, /^walk.?front.?left$/i, /^caminhar.?diagonal.?esquerda$/i],
  walk_diagonal_right: [/^walk.?diagonal.?right$/i, /^walk.?diag.?right$/i, /^walk.?forward.?right$/i, /^walk.?front.?right$/i, /^caminhar.?diagonal.?direita$/i],
  walk_backward_diagonal_left: [/^walk.?backward.?diagonal.?left$/i, /^walk.?back.?diag.?left$/i, /^walk.?back.?left$/i, /^caminhar.?tras.?diagonal.?esquerda$/i],
  walk_backward_diagonal_right: [/^walk.?backward.?diagonal.?right$/i, /^walk.?back.?diag.?right$/i, /^walk.?back.?right$/i, /^caminhar.?tras.?diagonal.?direita$/i],
  run: [/^run$/i, /^sprint$/i, /^gallop$/i, /^canter$/i, /^jog$/i, /^dash$/i, /^correr$/i, /^corrida$/i],
  run_backward: [/^run.?backward$/i, /^run.?back$/i, /^correr.?tras$/i],
  run_left: [/^run.?left$/i, /^correr.?esquerda$/i],
  run_right: [/^run.?right$/i, /^correr.?direita$/i],
  run_diagonal_left: [/^run.?diagonal.?left$/i, /^run.?diag.?left$/i, /^run.?forward.?left$/i, /^correr.?diagonal.?esquerda$/i],
  run_diagonal_right: [/^run.?diagonal.?right$/i, /^run.?diag.?right$/i, /^run.?forward.?right$/i, /^correr.?diagonal.?direita$/i],
  run_backward_diagonal_left: [/^run.?backward.?diagonal.?left$/i, /^run.?back.?diag.?left$/i],
  run_backward_diagonal_right: [/^run.?backward.?diagonal.?right$/i, /^run.?back.?diag.?right$/i],
  run_stop: [/^run.?stop$/i, /^stop.?run$/i, /^stop.?running$/i, /^braking$/i, /^brake$/i, /^deceleration$/i],
  jump: [/^jump$/i, /^leap$/i, /^hop$/i, /^fall$/i, /^saut$/i, /^salto$/i, /^pular$/i, /^pulo$/i],
  jump_start: [/^jump.?start$/i, /^jump.?up$/i, /^jump.?takeoff$/i],
  jump_loop: [/^jump.?loop$/i, /^jump.?air$/i, /^jump.?mid$/i],
  jump_land: [/^jump.?land$/i, /^jump.?down$/i, /^land$/i, /^landing$/i],
  crouch: [/^crouch$/i, /^squat$/i, /^kneel$/i, /^agachar$/i, /^agachado$/i],
  crouch_idle: [/^crouch.?idle$/i, /^crouch.?stand$/i, /^agachado.?parado$/i],
  crouch_walk: [/^crouch.?walk$/i, /^crouch.?move$/i, /^squat.?walk$/i, /^agachado.?caminhar$/i],
  crouch_run: [/^crouch.?run$/i, /^crouch.?sprint$/i],
  prone: [/^prone$/i, /^lying$/i, /^lie$/i, /^deitado$/i],
  prone_idle: [/^prone.?idle$/i, /^prone.?rest$/i],
  prone_crawl: [/^prone.?crawl$/i, /^crawl$/i, /^rastejar$/i, /^rastejando$/i],
  dodge: [/^dodge$/i, /^evade$/i, /^sidestep.?dodge$/i, /^esquiva$/i],
  dodge_left: [/^dodge.?left$/i, /^esquiva.?esquerda$/i],
  dodge_right: [/^dodge.?right$/i, /^esquiva.?direita$/i],
  dodge_backward: [/^dodge.?backward$/i, /^dodge.?back$/i, /^esquiva.?tras$/i],
  slide: [/^slide$/i, /^sliding$/i, /^deslizar$/i, /^escorregar$/i],
  roll: [/^roll$/i, /^rolling$/i, /^somersault$/i, /^rolamento$/i, /^rolar$/i],
  roll_forward: [/^roll.?forward$/i, /^roll.?front$/i],
  roll_left: [/^roll.?left$/i],
  roll_right: [/^roll.?right$/i],
  roll_backward: [/^roll.?backward$/i, /^roll.?back$/i],
  interact: [/^interact$/i, /^interaction$/i, /^use.?object$/i, /^interagir$/i, /^interacao$/i],
  primary_action: [/^primary.?action$/i, /^primary.?attack$/i, /^attack$/i, /^strike$/i, /^punch$/i, /^slash$/i, /^shoot$/i, /^melee$/i, /^atacar$/i, /^ataque$/i],
  secondary_action: [/^secondary.?action$/i, /^secondary.?attack$/i, /^block$/i, /^parry$/i, /^defend$/i, /^defesa$/i, /^bloquear$/i],
  inventory: [/^inventory$/i, /^inventario$/i],
  use_item: [/^use.?item$/i, /^consume$/i, /^drinking$/i, /^eating$/i, /^usar.?item$/i, /^usar.?objeto$/i],
  reload: [/^reload$/i, /^recarregar$/i, /^recarga$/i],
  ability_1: [/^ability.?1$/i, /^skill.?1$/i, /^spell.?1$/i],
  ability_2: [/^ability.?2$/i, /^skill.?2$/i, /^spell.?2$/i],
  ability_3: [/^ability.?3$/i, /^skill.?3$/i, /^spell.?3$/i],
  ability_4: [/^ability.?4$/i, /^skill.?4$/i, /^spell.?4$/i],
  emote: [/^emote$/i, /^gesture$/i, /^dance$/i, /^wave$/i, /^danca$/i, /^gesto$/i],
  mount: [/^mount$/i, /^mounting$/i, /^saddling$/i, /^get.?on$/i, /^riding$/i, /^montar$/i, /^montando$/i, /^cavalgar$/i, /^cavalgando$/i],
  dismount: [/^dismount$/i, /^unmount$/i, /^get.?off$/i, /^dismounting$/i, /^desmontar$/i, /^desmontando$/i],
  death: [/^death$/i, /^dead$/i, /^dying$/i, /^die$/i, /^killed$/i, /^knockout$/i, /^knockdown$/i, /^morte$/i, /^morrer$/i, /^morto$/i, /^morrendo$/i, /^derrotado$/i, /^derrota$/i],
}

// Quadruped specific patterns
const QUADRUPED_STATE_PATTERNS: Record<string, RegExp[]> = {
  idle: [/^idle$/i, /^stand$/i, /^rest$/i, /^neutral$/i, /^parado$/i],
  walk: [/^walk$/i, /^walk.?slow$/i, /^slow.?walk$/i, /^andar$/i, /^caminhar$/i],
  trot: [/^trot$/i, /^trot.?fast$/i, /^trocar$/i],
  canter: [/^canter$/i, /^canter.?left$/i, /^canter.?right$/i, /^galope.?leve$/i],
  gallop: [/^gallop$/i, /^gallop.?fast$/i, /^run$/i, /^sprint$/i, /^galope$/i, /^correr$/i],
  walk_backward: [/^walk.?backward$/i, /^walk.?back$/i, /^andar.?tras$/i],
  trot_backward: [/^trot.?backward$/i, /^trot.?back$/i],
  turn_left: [/^turn.?left$/i, /^turn.?esquerda$/i],
  turn_right: [/^turn.?right$/i, /^turn.?direita$/i],
  jump: [/^jump$/i, /^leap$/i, /^salto$/i, /^pular$/i],
  jump_start: [/^jump.?start$/i, /^jump.?up$/i],
  jump_loop: [/^jump.?loop$/i, /^jump.?air$/i],
  jump_land: [/^jump.?land$/i, /^land$/i, /^landing$/i],
  rest: [/^rest$/i, /^sleep$/i, /^lie.?down$/i, /^deitar$/i, /^dormir$/i],
  sleep: [/^sleep$/i, /^dormir$/i],
  eat: [/^eat$/i, /^graze$/i, /^comer$/i, /^pastar$/i],
  drink: [/^drink$/i, /^beber$/i],
  attack: [/^attack$/i, /^bite$/i, /^atacar$/i, /^morder$/i],
  bite: [/^bite$/i, /^morder$/i],
  kick: [/^kick$/i, /^buck.?kick$/i, /^coice$/i],
  rear: [/^rear$/i, /^rear.?up$/i, /^empinar$/i],
  buck: [/^buck$/i, /^corcova$/i],
  spook: [/^spook$/i, /^startle$/i, /^assustar$/i, /^assustado$/i],
  death: [/^death$/i, /^dead$/i, /^dying$/i, /^die$/i, /^morte$/i, /^morrer$/i, /^morto$/i],
}

// Generic state patterns (minimal)
const GENERIC_STATE_PATTERNS: Record<string, RegExp[]> = {
  idle: [/^idle$/i, /^stand$/i, /^rest$/i, /^neutral$/i],
  move: [/^move$/i, /^walk$/i, /^run$/i, /^locomotion$/i, /^move.?slow$/i, /^move.?fast$/i],
  action: [/^action$/i, /^attack$/i, /^interact$/i, /^use$/i],
  jump: [/^jump$/i, /^leap$/i],
  death: [/^death$/i, /^dead$/i, /^die$/i],
}

// ============================================================================
// Main AutoMapper Functions
// ============================================================================

/**
 * Automatically map animation clips from GLTF to an animation profile.
 */
export function autoMapAnimations(
  gltf: GLTF,
  profile?: AnimationProfile
): MappedAnimations {
  // 1. Determine profile to use
  const usedProfile = profile ?? AnimationRegistry.match(gltf) ?? AnimationRegistry.get('generic_v1')
  if (!usedProfile) {
    throw new Error('No animation profile available for mapping')
  }

  // 2. Detect skeleton type
  const skeletonType = detectSkeletonType(gltf)

  // 3. Get clips from GLTF
  const clips = gltf.animations ?? []

  // 4. Match clips to profile states
  const { matches, missingStates, extraClips } = matchClipsToProfile(clips, usedProfile, skeletonType)

  // 5. Create AnimationMixer and actions
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const actions = new Map<string, AnimationAction>()

  for (const match of matches) {
    const action = mixer.clipAction(match.clip)
    // Configure action based on state profile
    const stateProfile = usedProfile.states.find(s => s.id === match.stateId)
    if (stateProfile) {
      action.loop = stateProfile.loop ? THREE.LoopRepeat : THREE.LoopOnce
      action.clampWhenFinished = !stateProfile.loop
      action.timeScale = stateProfile.speed
    }
    actions.set(match.stateId, action)
  }

  // 6. Generate procedural fallbacks for missing states
  const procedural = generateProceduralFallbacks(usedProfile, missingStates)
  for (const [stateId, clip] of procedural.clips) {
    if (!actions.has(stateId)) {
      const action = mixer.clipAction(clip)
      action.loop = THREE.LoopRepeat
      action.clampWhenFinished = false
      actions.set(stateId, action)
    }
  }

  // 7. Build default parameters
  const parameters = new Map<string, number | boolean | readonly [number, number] | readonly [number, number, number]>()
  for (const param of usedProfile.parameters) {
    parameters.set(param.id, param.defaultValue)
  }

  return {
    actions,
    parameters,
    missingStates: [...new Set(missingStates)],
    extraClips,
    profile: usedProfile,
    skeletonType,
  }
}

/**
 * Match animation clips to profile states.
 */
function matchClipsToProfile(
  clips: AnimationClip[],
  profile: AnimationProfile,
  skeletonType: 'humanoid' | 'quadruped' | 'generic'
): { matches: ClipMatch[]; missingStates: string[]; extraClips: AnimationClip[] } {
  const patterns = getPatternsForSkeletonType(skeletonType)
  const matches: ClipMatch[] = []
  const usedClips = new Set<AnimationClip>()
  const stateIds = new Set(profile.states.map(s => s.id))
  const missingStates: string[] = []

  // First pass: exact name matches
  for (const state of profile.states) {
    const exactClip = clips.find(c => c.name.toLowerCase() === state.name.toLowerCase() ||
                                       c.name.toLowerCase() === state.id.toString().toLowerCase())
    if (exactClip && !usedClips.has(exactClip)) {
      matches.push({
        clip: exactClip,
        stateId: state.id,
        confidence: 1.0,
        matchedBy: 'exact',
      })
      usedClips.add(exactClip)
    }
  }

  // Second pass: pattern matching
  for (const state of profile.states) {
    if (matches.some(m => m.stateId === state.id)) continue

    const statePatterns = patterns[state.name] ?? patterns[state.id.toString()] ?? []
    for (const clip of clips) {
      if (usedClips.has(clip)) continue

      for (const pattern of statePatterns) {
        if (pattern.test(clip.name)) {
          matches.push({
            clip,
            stateId: state.id,
            confidence: 0.8,
            matchedBy: 'pattern',
          })
          usedClips.add(clip)
          break
        }
      }
      if (matches.some(m => m.stateId === state.id)) break
    }
  }

  // Third pass: infer from clip name (using existing inferAnimationRole logic)
  for (const clip of clips) {
    if (usedClips.has(clip)) continue

    const inferredRole = inferAnimationRoleFromClip(clip, skeletonType)
    if (inferredRole && stateIds.has(inferredRole)) {
      matches.push({
        clip,
        stateId: inferredRole,
        confidence: 0.6,
        matchedBy: 'inferred',
      })
      usedClips.add(clip)
    }
  }

  // Find missing states
  for (const state of profile.states) {
    if (!matches.some(m => m.stateId === state.id)) {
      missingStates.push(state.id.toString())
    }
  }

  // Find extra clips
  const extraClips = clips.filter(c => !usedClips.has(c))

  return { matches, missingStates, extraClips }
}

/**
 * Get name patterns for a skeleton type.
 */
function getPatternsForSkeletonType(type: 'humanoid' | 'quadruped' | 'generic'): Record<string, RegExp[]> {
  switch (type) {
    case 'humanoid':
      return STATE_NAME_PATTERNS
    case 'quadruped':
      return QUADRUPED_STATE_PATTERNS
    default:
      return GENERIC_STATE_PATTERNS
  }
}

/**
 * Infer animation role from clip name (similar to existing inferAnimationRole).
 */
function inferAnimationRoleFromClip(
  clip: AnimationClip,
  skeletonType: 'humanoid' | 'quadruped' | 'generic'
): AnimationStateId | null {
  const name = clip.name.toLowerCase()

  // Normalize
  const normalized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s._|:-]+/g, '')

  if (!normalized) return null

  const patterns = getPatternsForSkeletonType(skeletonType)

  for (const [stateId, statePatterns] of Object.entries(patterns)) {
    for (const pattern of statePatterns) {
      if (pattern.test(normalized)) {
        return createAnimationStateId(stateId)
      }
    }
  }

  return null
}

/**
 * Generate procedural fallback animations for missing states.
 */
function generateProceduralFallbacks(
  profile: AnimationProfile,
  missingStates: string[]
): ProceduralAnimations {
  const clips = new Map<string, AnimationClip>()

  for (const stateId of missingStates) {
    const state = profile.states.find(s => s.id === stateId)
    if (!state) continue

    // Generate a simple procedural clip based on state type
    const clip = createProceduralClip(stateId, profile)
    if (clip) {
      clips.set(stateId, clip)
    }
  }

  return {
    clips,
    description: `Generated ${clips.size} procedural fallback clips for missing states`,
  }
}

/**
 * Create a simple procedural animation clip for a state.
 */
function createProceduralClip(
  stateId: string,
  profile: AnimationProfile
): AnimationClip | null {
  // For now, create a simple 1-frame clip that holds a pose
  // In a full implementation, this would generate actual procedural animations

  const tracks: THREE.KeyframeTrack[] = []

  // Add a simple position track for root (if available)
  const rootBone = profile.skeleton.rootBone
  if (rootBone) {
    const positionTrack = new THREE.VectorKeyframeTrack(
      `${rootBone.boneId}.position`,
      [0, 1],
      [0, 0, 0, 0, 0, 0]
    )
    tracks.push(positionTrack)
  }

  // Create a minimal clip
  const clip = new AnimationClip(stateId, 1, tracks)
  return clip
}

/**
 * Get all animation clips from a GLTF, including nested ones.
 */
export function extractAllClips(gltf: GLTF): AnimationClip[] {
  const clips: AnimationClip[] = []

  // Main animations
  if (gltf.animations) {
    clips.push(...gltf.animations)
  }

  // Animations in userData (some exporters put them there)
  if (gltf.userData.animations) {
    clips.push(...gltf.userData.animations)
  }

  // Check scene for animation clips
  gltf.scene.traverse((child) => {
    if (child.userData.animationClips) {
      clips.push(...child.userData.animationClips)
    }
  })

  return clips
}

/**
 * Validate that a GLTF has usable animations for a profile.
 */
export function validateAnimationCompatibility(
  gltf: GLTF,
  profile: AnimationProfile
): { compatible: boolean; coverage: number; missing: string[]; extra: string[] } {
  const clips = extractAllClips(gltf)
  const { matches, missingStates, extraClips } = matchClipsToProfile(clips, profile, detectSkeletonType(gltf))

  const requiredStates = profile.states.filter(s => s.priority > 5).map(s => s.id.toString())
  const coveredRequired = requiredStates.filter(id => matches.some(m => m.stateId === id))
  const coverage = requiredStates.length > 0 ? coveredRequired.length / requiredStates.length : 1

  return {
    compatible: coverage > 0.5, // At least 50% of high-priority states covered
    coverage,
    missing: missingStates,
    extra: extraClips.map(c => c.name),
  }
}

/**
 * Create a mapping report for debugging.
 */
export function createMappingReport(mapped: MappedAnimations): string {
  const lines = [
    `Animation Mapping Report`,
    `========================`,
    `Profile: ${mapped.profile.name} (${mapped.profile.id})`,
    `Skeleton Type: ${mapped.skeletonType}`,
    `Clips Mapped: ${mapped.actions.size}`,
    `Missing States: ${mapped.missingStates.length}`,
    `Extra Clips: ${mapped.extraClips.length}`,
    ``,
    `Mapped States:`,
  ]

  for (const [stateId, action] of mapped.actions) {
    lines.push(`  ${stateId}: ${action.getClip().name} (${action.loop ? 'loop' : 'once'})`)
  }

  if (mapped.missingStates.length > 0) {
    lines.push(``, `Missing States:`)
    for (const state of mapped.missingStates) {
      lines.push(`  ${state}`)
    }
  }

  if (mapped.extraClips.length > 0) {
    lines.push(``, `Extra Clips:`)
    for (const clip of mapped.extraClips) {
      lines.push(`  ${clip.name}`)
    }
  }

  return lines.join('\n')
}