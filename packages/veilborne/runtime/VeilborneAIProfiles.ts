import type { PackageJsonValue } from '../../../engine/script/packages.ts'

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
