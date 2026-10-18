/**
 * VEILBORNE: regras puras de combate.
 *
 * Estas funções não dependem de Three.js nem da cena. Podem ser chamadas pelo
 * runtime do Engine Prometheus, Visual Script ou por testes unitários.
 * Resistências são percentuais de 0 a 100.
 */
export type VeilborneDamageType = 'physical' | 'fire' | 'frost' | 'storm' | 'blood' | 'shadow' | 'spirit' | 'arcane'
export type VeilborneAttribute = 'strength' | 'dexterity' | 'intellect' | 'will'
export type VeilborneStatusId = 'burn' | 'bleed' | 'poison' | 'frost' | 'shock' | 'curse' | 'silence' | 'slow' | 'stagger' | 'life_drain'

export interface VeilborneResources {
  vitality: number
  maxVitality: number
  ether: number
  maxEther: number
  stamina: number
  maxStamina: number
  posture: number
  maxPosture: number
}

export interface VeilborneAttributes {
  strength: number
  dexterity: number
  intellect: number
  will: number
  resistance: number
}

export interface VeilborneCombatant {
  id: string
  resources: VeilborneResources
  attributes: VeilborneAttributes
  resistances: Partial<Record<VeilborneDamageType, number>>
  statuses: VeilborneStatus[]
  alive: boolean
}

export interface VeilborneStatus {
  id: VeilborneStatusId
  remainingSeconds: number
  potency: number
  stacks: number
}

export interface VeilborneDamagePacket {
  amount: number
  type: VeilborneDamageType
  postureDamage?: number
  canCrit?: boolean
  criticalMultiplier?: number
}

export interface VeilborneDamageResult {
  vitalityDamage: number
  postureDamage: number
  killed: boolean
  postureBroken: boolean
}

export interface VeilborneWeaponProfile {
  baseDamage: number
  damageType: VeilborneDamageType
  scaling: Partial<Record<VeilborneAttribute, number>>
  staminaCost: number
  postureDamage: number
  criticalMultiplier?: number
}

export interface VeilborneSpellProfile {
  id: string
  damage: number
  damageType: VeilborneDamageType
  etherCost: number
  castTimeSeconds: number
  cooldownSeconds: number
  scalingAttribute: 'intellect' | 'will'
  scaling: number
  postureDamage?: number
}

export interface VeilborneSigilProfile {
  id: string
  etherCost: number
  radius: number
  durationSeconds: number
  cooldownSeconds: number
  damage?: number
  damageType?: VeilborneDamageType
}

export interface VeilborneCombatConfig {
  dodgeStaminaCost: number
  dodgeInvulnerabilitySeconds: number
  parryWindowSeconds: number
  postureRecoveryPerSecond: number
}

export const VEILBORNE_DEFAULT_COMBAT_CONFIG: Readonly<VeilborneCombatConfig> = Object.freeze({
  dodgeStaminaCost: 22,
  dodgeInvulnerabilitySeconds: 0.22,
  parryWindowSeconds: 0.2,
  postureRecoveryPerSecond: 8,
})

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min

export function createVeilborneCombatant(id: string, overrides: Partial<VeilborneResources> = {}): VeilborneCombatant {
  const resources: VeilborneResources = {
    vitality: 100, maxVitality: 100,
    ether: 100, maxEther: 100,
    stamina: 100, maxStamina: 100,
    posture: 0, maxPosture: 100,
    ...overrides,
  }
  resources.maxVitality = Math.max(1, resources.maxVitality)
  resources.maxEther = Math.max(1, resources.maxEther)
  resources.maxStamina = Math.max(1, resources.maxStamina)
  resources.maxPosture = Math.max(1, resources.maxPosture)
  resources.vitality = clamp(resources.vitality, 0, resources.maxVitality)
  resources.ether = clamp(resources.ether, 0, resources.maxEther)
  resources.stamina = clamp(resources.stamina, 0, resources.maxStamina)
  resources.posture = clamp(resources.posture, 0, resources.maxPosture)
  return {
    id,
    resources,
    attributes: { strength: 10, dexterity: 10, intellect: 10, will: 10, resistance: 10 },
    resistances: {},
    statuses: [],
    alive: resources.vitality > 0,
  }
}

export function calculateVeilborneWeaponDamage(
  weapon: VeilborneWeaponProfile,
  attributes: VeilborneAttributes,
  options: { heavy?: boolean; chargedMultiplier?: number; critical?: boolean } = {},
): number {
  const scalingBonus = Object.entries(weapon.scaling).reduce((sum, [attribute, coefficient]) => {
    const score = attributes[attribute as VeilborneAttribute] ?? 0
    return sum + Math.max(0, score) * Math.max(0, coefficient ?? 0)
  }, 0)
  const attackMultiplier = options.heavy ? 1.35 : 1
  const chargedMultiplier = clamp(options.chargedMultiplier ?? 1, 1, 5)
  const criticalMultiplier = options.critical ? Math.max(1, weapon.criticalMultiplier ?? 1.75) : 1
  return Math.max(0, Math.round((weapon.baseDamage + scalingBonus) * attackMultiplier * chargedMultiplier * criticalMultiplier))
}

export function calculateVeilborneSpellDamage(spell: VeilborneSpellProfile, attributes: VeilborneAttributes): number {
  const score = Math.max(0, attributes[spell.scalingAttribute])
  return Math.max(0, Math.round(spell.damage + score * Math.max(0, spell.scaling)))
}

export function spendVeilborneResource(
  combatant: VeilborneCombatant,
  resource: 'ether' | 'stamina',
  amount: number,
): boolean {
  const cost = Math.max(0, Number.isFinite(amount) ? amount : 0)
  if (!combatant.alive || combatant.resources[resource] < cost) return false
  combatant.resources[resource] = clamp(combatant.resources[resource] - cost, 0, combatant.resources[resource === 'ether' ? 'maxEther' : 'maxStamina'])
  return true
}

export function restoreVeilborneResource(
  combatant: VeilborneCombatant,
  resource: 'vitality' | 'ether' | 'stamina',
  amount: number,
): number {
  if (!combatant.alive && resource !== 'vitality') return 0
  const maximumKey = resource === 'vitality' ? 'maxVitality' : resource === 'ether' ? 'maxEther' : 'maxStamina'
  const before = combatant.resources[resource]
  combatant.resources[resource] = clamp(before + Math.max(0, Number.isFinite(amount) ? amount : 0), 0, combatant.resources[maximumKey])
  if (resource === 'vitality' && combatant.resources.vitality > 0) combatant.alive = true
  return combatant.resources[resource] - before
}

export function applyVeilborneDamage(
  target: VeilborneCombatant,
  packet: VeilborneDamagePacket,
): VeilborneDamageResult {
  if (!target.alive) return { vitalityDamage: 0, postureDamage: 0, killed: true, postureBroken: false }
  const rawDamage = Math.max(0, Number.isFinite(packet.amount) ? packet.amount : 0)
  const resistance = clamp(target.resistances[packet.type] ?? 0, -100, 95)
  const critical = packet.canCrit ? Math.max(1, packet.criticalMultiplier ?? 1) : 1
  const vitalityDamage = Math.max(0, Math.round(rawDamage * (1 - resistance / 100) * critical))
  const postureDamage = Math.max(0, Number.isFinite(packet.postureDamage) ? packet.postureDamage! : 0)
  const previousPosture = target.resources.posture
  target.resources.vitality = clamp(target.resources.vitality - vitalityDamage, 0, target.resources.maxVitality)
  target.resources.posture = clamp(previousPosture + postureDamage, 0, target.resources.maxPosture)
  const killed = target.resources.vitality <= 0
  const postureBroken = previousPosture < target.resources.maxPosture && target.resources.posture >= target.resources.maxPosture
  target.alive = !killed
  return { vitalityDamage: Math.min(vitalityDamage, target.resources.vitality + vitalityDamage), postureDamage, killed, postureBroken }
}

export function applyVeilborneStatus(
  target: VeilborneCombatant,
  status: VeilborneStatus,
): void {
  if (!target.alive || status.remainingSeconds <= 0) return
  const existing = target.statuses.find(item => item.id === status.id)
  if (existing) {
    existing.remainingSeconds = Math.max(existing.remainingSeconds, status.remainingSeconds)
    existing.potency = Math.max(existing.potency, status.potency)
    existing.stacks = clamp(existing.stacks + Math.max(1, status.stacks), 1, 99)
    return
  }
  target.statuses.push({
    id: status.id,
    remainingSeconds: status.remainingSeconds,
    potency: Math.max(0, status.potency),
    stacks: clamp(Math.round(status.stacks), 1, 99),
  })
}

export function tickVeilborneStatuses(target: VeilborneCombatant, deltaSeconds: number): void {
  const delta = clamp(deltaSeconds, 0, 1)
  target.statuses = target.statuses
    .map(status => ({ ...status, remainingSeconds: Math.max(0, status.remainingSeconds - delta) }))
    .filter(status => status.remainingSeconds > 0)
  target.resources.posture = clamp(
    target.resources.posture - VEILBORNE_DEFAULT_COMBAT_CONFIG.postureRecoveryPerSecond * delta,
    0,
    target.resources.maxPosture,
  )
}

export function canVeilborneDodge(combatant: VeilborneCombatant, cost = VEILBORNE_DEFAULT_COMBAT_CONFIG.dodgeStaminaCost): boolean {
  return combatant.alive && combatant.resources.stamina >= Math.max(0, cost)
}

export function isVeilborneParrySuccessful(attackTimeSeconds: number, parryStartSeconds: number, windowSeconds = VEILBORNE_DEFAULT_COMBAT_CONFIG.parryWindowSeconds): boolean {
  if (![attackTimeSeconds, parryStartSeconds, windowSeconds].every(Number.isFinite) || windowSeconds < 0) return false
  return attackTimeSeconds >= parryStartSeconds && attackTimeSeconds <= parryStartSeconds + windowSeconds
}

export function calculateVeilborneSigilCost(sigil: VeilborneSigilProfile, will: number): number {
  const discount = clamp(Math.max(0, will) * 0.002, 0, 0.35)
  return Math.max(0, Math.ceil(sigil.etherCost * (1 - discount)))
}
