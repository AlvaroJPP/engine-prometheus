import type { PackageJsonValue } from '../../../engine/script/packages.ts'
import type { CombatEngagementSchema } from '../../../engine/script/CombatEngagementSystem.ts'

export interface VeilborneAIProfile {
  attackRange: number
  moveSpeed: number
  damage: number
  cooldown: number
  damageType: string
  postureDamage: number
  ranged: boolean
}

export const VEILBORNE_AI_PROFILES: Readonly<Record<string, VeilborneAIProfile>> = Object.freeze({
  melee: { attackRange: 2, moveSpeed: 2.8, damage: 12, cooldown: 1.4, damageType: 'physical', postureDamage: 8, ranged: false },
  ranged_caster: { attackRange: 9, moveSpeed: 2.3, damage: 18, cooldown: 1.8, damageType: 'arcane', postureDamage: 6, ranged: true },
  flanker: { attackRange: 1.8, moveSpeed: 4, damage: 10, cooldown: 1.05, damageType: 'physical', postureDamage: 7, ranged: false },
  guard_breaker: { attackRange: 2.7, moveSpeed: 1.7, damage: 24, cooldown: 2, damageType: 'physical', postureDamage: 20, ranged: false },
  boss_phases: { attackRange: 3.2, moveSpeed: 2.3, damage: 28, cooldown: 1.7, damageType: 'shadow', postureDamage: 24, ranged: false },
})

/** Data-only schema that binds VEILBORNE actor variables to the generic combat engagement module. */
export const VEILBORNE_COMBAT_ENGAGEMENT_SCHEMA: CombatEngagementSchema = {
  actorRoleVariable: 'entity_role',
  actorRoleValue: 'combatant',
  actorFactionVariable: 'faction',
  actorFactionValue: 'hostile',
  enabledVariable: 'ai_enabled',
  profileVariable: 'ai_profile',
  profilesConfigKey: 'aiProfiles',
  defaultProfile: 'melee',
  customStatsVariable: 'ai_custom_stats',
  perceptionRangeVariable: 'perception_range',
  stateVariable: 'ai_state',
  damageMultiplierVariable: 'ai_damage_multiplier',
  attackRangeVariable: 'attack_range',
  moveSpeedVariable: 'move_speed',
  damageVariable: 'attack_damage',
  cooldownVariable: 'attack_cooldown',
  damageTypeVariable: 'attack_damage_type',
  postureDamageVariable: 'attack_posture_damage',
  autonomousPackageId: 'autonomous_agent',
  autonomousModeVariable: 'mode',
  autonomousSpeedVariable: 'move_speed',
  autonomousPerceptionVariable: 'perception_range',
  autonomousStopDistanceVariable: 'stopping_distance',
  attackEvent: 'enemy_attack',
  spottedEvent: 'enemy_spotted',
  lostTargetEvent: 'enemy_lost_target',
  staggerStatusId: 'stagger',
  slowStatusId: 'slow',
  silenceStatusId: 'silence',
  idleState: 'idle',
  pursueState: 'pursue',
  attackState: 'attack',
  recoverState: 'recover',
  staggeredState: 'staggered',
  deadState: 'dead',
  idleMode: 'idle',
  followMode: 'follow_player',
  fleeMode: 'flee_player',
  lookMode: 'look_at_player',
  retreatRatio: 0.62,
  stoppingDistanceRatio: 0.94,
  attackOriginHeight: 0.9,
  targetImpactHeight: 0.85,
}

export const VEILBORNE_AI_PROFILE_OPTIONS = Object.freeze([
  { value: 'melee', label: 'Corpo a corpo' },
  { value: 'ranged_caster', label: 'Conjurador à distância' },
  { value: 'flanker', label: 'Flanqueador' },
  { value: 'guard_breaker', label: 'Quebra-guarda' },
  { value: 'boss_phases', label: 'Chefe com fases' },
])

function asRecord(value: PackageJsonValue | undefined): Record<string, PackageJsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function readNumber(record: Record<string, PackageJsonValue>, key: string, fallback: number): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Loads a content preset from the package instance config, with backward-compatible defaults. */
export function resolveVeilborneAIProfile(
  profileId: string,
  config: Record<string, PackageJsonValue>,
): VeilborneAIProfile {
  const fallback = VEILBORNE_AI_PROFILES[profileId] ?? VEILBORNE_AI_PROFILES.melee!
  const profiles = asRecord(config.aiProfiles)
  const raw = profiles ? asRecord(profiles[profileId]) : null
  if (!raw) return { ...fallback }
  const damageType = typeof raw.damageType === 'string' && raw.damageType.trim()
    ? raw.damageType
    : fallback.damageType
  return {
    attackRange: Math.max(0.5, readNumber(raw, 'attackRange', fallback.attackRange)),
    moveSpeed: Math.max(0, readNumber(raw, 'moveSpeed', fallback.moveSpeed)),
    damage: Math.max(0, readNumber(raw, 'damage', fallback.damage)),
    cooldown: Math.max(0.2, readNumber(raw, 'cooldown', fallback.cooldown)),
    damageType,
    postureDamage: Math.max(0, readNumber(raw, 'postureDamage', fallback.postureDamage)),
    ranged: typeof raw.ranged === 'boolean' ? raw.ranged : fallback.ranged,
  }
}
