import {
  applyPercentageDiscount,
  calculateScaledMagnitude,
  clampFinite,
  isWithinTimeWindow,
  restoreResource,
  spendResource,
} from '../../../engine/script/CombatPrimitives.ts'
import {
  applyCombatDamage,
  applyCombatStatus,
  createCombatActorState,
  updateCombatActor,
  type CombatActorState,
  type TimedCombatStatus,
} from '../../../engine/script/CombatModel.ts'

/**
 * VEILBORNE: regras puras de combate.
 *
 * Estas funções não dependem de Three.js nem da cena. Podem ser chamadas pelo
 * runtime do Engine Prometheus, Visual Script ou por testes unitários.
 * Resistências são percentuais de 0 a 100.
 */
export type VeilborneDamageType = 'physical' | 'fire' | 'frost' | 'storm' | 'blood' | 'shadow' | 'spirit' | 'arcane'
export type VeilborneAttribute = 'strength' | 'dexterity' | 'intellect' | 'will'
export type VeilborneStatusId = 'burn' | 'bleed' | 'poison' | 'frost' | 'shock' | 'curse' | 'silence' | 'slow' | 'stagger' | 'life_drain' | 'marked'

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

export interface VeilborneCombatant extends CombatActorState<
  VeilborneResources,
  VeilborneAttributes,
  Partial<Record<VeilborneDamageType, number>>,
  VeilborneStatus
> {}

export interface VeilborneStatus extends TimedCombatStatus {
  id: VeilborneStatusId
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

const clamp = (value: number, min: number, max: number): number => clampFinite(value, min, max)

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
  const actor = createCombatActorState(
    id,
    resources,
    { strength: 10, dexterity: 10, intellect: 10, will: 10, resistance: 10 },
    {},
    'vitality',
  )
  return {
    ...actor,
    statuses: [],
    alive: resources.vitality > 0,
  }
}

export function calculateVeilborneWeaponDamage(
  weapon: VeilborneWeaponProfile,
  attributes: VeilborneAttributes,
  options: { heavy?: boolean; chargedMultiplier?: number; critical?: boolean } = {},
): number {
  const multipliers = [
    options.heavy ? 1.35 : 1,
    clamp(options.chargedMultiplier ?? 1, 1, 5),
    options.critical ? Math.max(1, weapon.criticalMultiplier ?? 1.75) : 1,
  ]
  return calculateScaledMagnitude(weapon.baseDamage, attributes, weapon.scaling, multipliers)
}

export function calculateVeilborneSpellDamage(spell: VeilborneSpellProfile, attributes: VeilborneAttributes): number {
  return calculateScaledMagnitude(
    spell.damage,
    attributes,
    { [spell.scalingAttribute]: spell.scaling },
  )
}

export function spendVeilborneResource(
  combatant: VeilborneCombatant,
  resource: 'ether' | 'stamina',
  amount: number,
): boolean {
  const maximumKey = resource === 'ether' ? 'maxEther' : 'maxStamina'
  const result = spendResource(
    combatant.resources[resource],
    combatant.resources[maximumKey],
    amount,
  )
  if (!result.accepted) return false
  combatant.resources[resource] = result.value
  return true
}

export function restoreVeilborneResource(
  combatant: VeilborneCombatant,
  resource: 'vitality' | 'ether' | 'stamina',
  amount: number,
): number {
  if (!combatant.alive && resource !== 'vitality') return 0
  const maximumKey = resource === 'vitality' ? 'maxVitality' : resource === 'ether' ? 'maxEther' : 'maxStamina'
  const result = restoreResource(
    combatant.resources[resource],
    combatant.resources[maximumKey],
    amount,
  )
  combatant.resources[resource] = result.value
  if (resource === 'vitality' && result.value > 0) combatant.alive = true
  return result.changed
}

export function applyVeilborneDamage(
  target: VeilborneCombatant,
  packet: VeilborneDamagePacket,
): VeilborneDamageResult {
  const result = applyCombatDamage(target, {
    amount: packet.amount,
    damageType: packet.type,
    resourceKey: 'vitality',
    maximumResourceKey: 'maxVitality',
    resistanceKey: packet.type,
    postureDamage: packet.postureDamage,
    postureResourceKey: 'posture',
    maximumPostureKey: 'maxPosture',
    criticalMultiplier: packet.canCrit ? Math.max(1, packet.criticalMultiplier ?? 1) : 1,
  })
  return {
    vitalityDamage: result.resourceDamage,
    postureDamage: result.postureDamage,
    killed: result.killed,
    postureBroken: result.postureBroken,
  }
}

export function applyVeilborneStatus(
  target: VeilborneCombatant,
  status: VeilborneStatus,
): void {
  applyCombatStatus(target, status)
}

export function tickVeilborneStatuses(target: VeilborneCombatant, deltaSeconds: number): void {
  updateCombatActor(target, deltaSeconds, {
    postureResourceKey: 'posture',
    resourceLimits: { posture: 'maxPosture' },
    postureRecoveryPerSecond: VEILBORNE_DEFAULT_COMBAT_CONFIG.postureRecoveryPerSecond,
  })
}

export function canVeilborneDodge(combatant: VeilborneCombatant, cost = VEILBORNE_DEFAULT_COMBAT_CONFIG.dodgeStaminaCost): boolean {
  return combatant.alive && combatant.resources.stamina >= Math.max(0, cost)
}

export function isVeilborneParrySuccessful(attackTimeSeconds: number, parryStartSeconds: number, windowSeconds = VEILBORNE_DEFAULT_COMBAT_CONFIG.parryWindowSeconds): boolean {
  return isWithinTimeWindow(attackTimeSeconds, parryStartSeconds, windowSeconds)
}

export function calculateVeilborneSigilCost(sigil: VeilborneSigilProfile, will: number): number {
  const discount = clamp(Math.max(0, will) * 0.002, 0, 0.35)
  return applyPercentageDiscount(sigil.etherCost, discount)
}

export interface VeilborneRuntimeWeapon extends VeilborneWeaponProfile {
  id: string
  name: string
  range: number
}

export interface VeilborneRuntimeSpell extends VeilborneSpellProfile {
  name: string
  range: number
  radius: number
  targeting: 'single' | 'area' | 'projectile'
  /** Velocidade opcional dos feitiços que viajam como projéteis, em unidades/s. */
  projectileSpeed?: number
  visualColor: number
  statusEffect?: VeilborneStatusId
  statusPotency?: number
  statusDurationSeconds?: number
}

/** Arsenal inicial de runtime; projetos podem substituir esses perfis por dados de itens próprios. */
export const VEILBORNE_RUNTIME_WEAPONS: Readonly<Record<string, VeilborneRuntimeWeapon>> = Object.freeze({
  starter_arcane_sword: {
    id: 'starter_arcane_sword', name: 'Lâmina do Véu', baseDamage: 18,
    damageType: 'physical', scaling: { strength: 0.8, dexterity: 0.45 },
    staminaCost: 16, postureDamage: 14, criticalMultiplier: 1.75, range: 2.65,
  },
  starter_rune_staff: {
    id: 'starter_rune_staff', name: 'Cajado das Cinzas', baseDamage: 9,
    damageType: 'arcane', scaling: { intellect: 0.9, will: 0.35 },
    staminaCost: 10, postureDamage: 8, criticalMultiplier: 1.5, range: 2.9,
  },
  hunters_dagger: {
    id: 'hunters_dagger', name: 'Adaga do Caçador', baseDamage: 11,
    damageType: 'physical', scaling: { dexterity: 1.1 },
    staminaCost: 9, postureDamage: 7, criticalMultiplier: 2.1, range: 1.85,
  },
  oathbreaker_greatsword: {
    id: 'oathbreaker_greatsword', name: 'Espadão Quebrajuramentos', baseDamage: 29,
    damageType: 'physical', scaling: { strength: 1.25 },
    staminaCost: 28, postureDamage: 25, criticalMultiplier: 1.8, range: 3.2,
  },
})

export const VEILBORNE_RUNTIME_SPELLS: Readonly<Record<string, VeilborneRuntimeSpell>> = Object.freeze({
  arcane_bolt: {
    id: 'arcane_bolt', name: 'Dardo do Véu', damage: 20, damageType: 'arcane',
    etherCost: 8, castTimeSeconds: 0.18, cooldownSeconds: 0.45, scalingAttribute: 'intellect',
    scaling: 0.8, postureDamage: 6, range: 24, radius: 0, targeting: 'projectile', projectileSpeed: 26, visualColor: 0x8c7cff,
  },
  cinder_burst: {
    id: 'cinder_burst', name: 'Explosão de Brasa', damage: 34, damageType: 'fire',
    etherCost: 22, castTimeSeconds: 0.48, cooldownSeconds: 4, scalingAttribute: 'intellect',
    scaling: 1.1, postureDamage: 18, range: 16, radius: 4.5, targeting: 'projectile', projectileSpeed: 18, visualColor: 0xff713b,
    statusEffect: 'burn', statusPotency: 3, statusDurationSeconds: 4,
  },
  frost_chain: {
    id: 'frost_chain', name: 'Corrente Glacial', damage: 16, damageType: 'frost',
    etherCost: 16, castTimeSeconds: 0.3, cooldownSeconds: 3, scalingAttribute: 'intellect',
    scaling: 0.7, postureDamage: 8, range: 20, radius: 2, targeting: 'projectile', projectileSpeed: 24, visualColor: 0x79ddff,
    statusEffect: 'slow', statusPotency: 0.35, statusDurationSeconds: 3,
  },
  blood_siphon: {
    id: 'blood_siphon', name: 'Dreno Rubro', damage: 14, damageType: 'blood',
    etherCost: 18, castTimeSeconds: 0.26, cooldownSeconds: 5, scalingAttribute: 'will',
    scaling: 0.8, postureDamage: 8, range: 12, radius: 0, targeting: 'projectile', projectileSpeed: 20, visualColor: 0xd82e55,
    statusEffect: 'bleed', statusPotency: 2, statusDurationSeconds: 5,
  },
  blink_step: {
    id: 'blink_step', name: 'Passo Entre Véus', damage: 0, damageType: 'arcane',
    etherCost: 20, castTimeSeconds: 0.05, cooldownSeconds: 6, scalingAttribute: 'will',
    scaling: 0, postureDamage: 0, range: 7, radius: 0, targeting: 'single', visualColor: 0x9b69ff,
  },
  storm_lance: {
    id: 'storm_lance', name: 'Lança da Tempestade', damage: 39, damageType: 'storm',
    etherCost: 24, castTimeSeconds: 0.42, cooldownSeconds: 4.5, scalingAttribute: 'intellect',
    scaling: 1.15, postureDamage: 18, range: 26, radius: 0.8, targeting: 'projectile', projectileSpeed: 28, visualColor: 0xffe77a,
    statusEffect: 'shock', statusPotency: 1, statusDurationSeconds: 2,
  },
})

export const VEILBORNE_DEFAULT_SPELL_SLOTS = Object.freeze([
  'arcane_bolt',
  'cinder_burst',
  'frost_chain',
  'blood_siphon',
] as const)
export interface VeilborneRuntimeSigil extends VeilborneSigilProfile {
  name: string
  category: 'offensive' | 'defensive' | 'trap' | 'utility' | 'movement'
  shape: 'circle' | 'triangle' | 'eye' | 'hexagon' | 'square'
  trigger: 'on_cast' | 'enemy_enter'
  effect: 'ward' | 'blast' | 'mark' | 'slow' | 'silence'
  visualColor: number
  postureDamage?: number
  statusEffect?: VeilborneStatusId
  statusPotency?: number
}

/** Sigilos iniciais usados pelo runtime; seus dados podem ser substituídos por conteúdo de projeto. */
export const VEILBORNE_RUNTIME_SIGILS: Readonly<Record<string, VeilborneRuntimeSigil>> = Object.freeze({
  ward: {
    id: 'ward', name: 'Selo Guardião', category: 'defensive', shape: 'circle', trigger: 'on_cast',
    effect: 'ward', radius: 0, durationSeconds: 8, etherCost: 18, cooldownSeconds: 12, visualColor: 0x9b80ff,
  },
  blast: {
    id: 'blast', name: 'Selo de Ruptura', category: 'offensive', shape: 'triangle', trigger: 'enemy_enter',
    effect: 'blast', radius: 3.5, durationSeconds: 20, etherCost: 20, cooldownSeconds: 10,
    damage: 42, damageType: 'arcane', postureDamage: 28, visualColor: 0xff604c,
  },
  hunter_mark: {
    id: 'hunter_mark', name: 'Marca do Caçador', category: 'utility', shape: 'eye', trigger: 'on_cast',
    effect: 'mark', radius: 18, durationSeconds: 12, etherCost: 14, cooldownSeconds: 8, visualColor: 0xe94b70,
    statusEffect: 'marked', statusPotency: 1.2,
  },
  slow_field: {
    id: 'slow_field', name: 'Círculo de Lentidão', category: 'trap', shape: 'hexagon', trigger: 'enemy_enter',
    effect: 'slow', radius: 5, durationSeconds: 8, etherCost: 17, cooldownSeconds: 14, visualColor: 0x75dfff,
    statusEffect: 'slow', statusPotency: 0.45,
  },
  silence_seal: {
    id: 'silence_seal', name: 'Selo do Silêncio', category: 'trap', shape: 'square', trigger: 'enemy_enter',
    effect: 'silence', radius: 3, durationSeconds: 10, etherCost: 16, cooldownSeconds: 16, visualColor: 0xdca4ff,
    statusEffect: 'silence', statusPotency: 1,
  },
})

export interface VeilborneRuntimeItem {
  id: string
  name: string
  category: 'consumable' | 'currency'
  effect: 'restore_vitality' | 'restore_ether' | 'restore_stamina' | 'area_damage' | 'add_echoes'
  amount: number
  damageType?: VeilborneDamageType
  radius?: number
  range?: number
  postureDamage?: number
  visualColor: number
  description: string
}

/** Itens consumíveis e fragmentos iniciais disponíveis para inventários e drops. */
export const VEILBORNE_RUNTIME_ITEMS: Readonly<Record<string, VeilborneRuntimeItem>> = Object.freeze({
  lesser_vitality_vial: {
    id: 'lesser_vitality_vial', name: 'Frasco de Vitalidade', category: 'consumable',
    effect: 'restore_vitality', amount: 45, visualColor: 0xe64b5d,
    description: 'Recupera 45 pontos de vida.',
  },
  ether_vial: {
    id: 'ether_vial', name: 'Frasco de Éter', category: 'consumable',
    effect: 'restore_ether', amount: 40, visualColor: 0x9f83ff,
    description: 'Recupera 40 pontos de éter.',
  },
  vigor_vial: {
    id: 'vigor_vial', name: 'Tônico de Vigor', category: 'consumable',
    effect: 'restore_stamina', amount: 45, visualColor: 0x7ee0b6,
    description: 'Recupera 45 pontos de vigor.',
  },
  ember_bomb: {
    id: 'ember_bomb', name: 'Bomba de Brasa', category: 'consumable',
    effect: 'area_damage', amount: 30, damageType: 'fire', radius: 3.2, range: 12,
    postureDamage: 14, visualColor: 0xff713b,
    description: 'Explode em área e causa 30 de dano de chama.',
  },
  echo_fragment: {
    id: 'echo_fragment', name: 'Fragmento de Ecos', category: 'currency',
    effect: 'add_echoes', amount: 25, visualColor: 0xe9bf75,
    description: 'Concede 25 Ecos.',
  },
})

