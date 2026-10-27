import {
  clampFinite,
  mergeTimedEffect,
  resolveResistedMagnitude,
  tickTimedEffects,
} from './CombatPrimitives.ts'

/** Dados numéricos de um ator, sem nomes de recursos específicos de qualquer jogo. */
export interface CombatActorState<
  Resources extends object = Record<string, number>,
  Attributes extends object = Record<string, number>,
  Resistances extends object = Record<string, number>,
  Status extends TimedCombatStatus = TimedCombatStatus,
> {
  id: string
  resources: Resources
  attributes: Attributes
  resistances: Resistances
  statuses: Status[]
  alive: boolean
}

/** Estado temporizado genérico que pode representar dano periódico, lentidão ou outras regras. */
export interface TimedCombatStatus {
  id: string
  remainingSeconds: number
  potency: number
  stacks: number
}

/** Configura qual recurso de qualquer ator será afetado por um pacote de dano. */
export interface CombatDamagePacket {
  amount: number
  damageType: string
  resourceKey?: string
  maximumResourceKey?: string
  resistanceKey?: string
  postureDamage?: number
  postureResourceKey?: string
  maximumPostureKey?: string
  criticalMultiplier?: number
}

/** Resultado neutro do sistema de dano, independente de vida, escudos ou postura. */
export interface CombatDamageResult {
  resourceKey: string
  resourceDamage: number
  postureDamage: number
  killed: boolean
  postureBroken: boolean
}

/** Cria um estado de ator a partir de schemas de recursos, atributos e resistências. */
export function createCombatActorState<
  Resources extends object,
  Attributes extends object,
  Resistances extends object,
>(
  id: string,
  resources: Resources,
  attributes: Attributes,
  resistances: Resistances,
  healthKey = 'health',
): CombatActorState<Resources, Attributes, Resistances> {
  const resourceValues = resources as Record<string, number>
  const health = resourceValues[healthKey]
  return {
    id,
    resources: { ...resources },
    attributes: { ...attributes },
    resistances: { ...resistances },
    statuses: [],
    alive: typeof health !== 'number' || (Number.isFinite(health) && health > 0),
  }
}

/** Aplica dano a um recurso configurável e, opcionalmente, causa dano de postura. */
export function applyCombatDamage<
  Resources extends object,
  Attributes extends object,
  Resistances extends object,
  Status extends TimedCombatStatus,
>(
  target: CombatActorState<Resources, Attributes, Resistances, Status>,
  packet: CombatDamagePacket,
): CombatDamageResult {
  const resourceKey = packet.resourceKey ?? 'health'
  const maximumResourceKey = packet.maximumResourceKey ?? 'maxHealth'
  const resources = target.resources as Record<string, number>
  const resistances = target.resistances as Record<string, number>
  if (!target.alive) {
    return { resourceKey, resourceDamage: 0, postureDamage: 0, killed: true, postureBroken: false }
  }

  const current = resources[resourceKey]
  const maximum = resources[maximumResourceKey]
  if (
    typeof current !== 'number'
    || !Number.isFinite(current)
    || typeof maximum !== 'number'
    || !Number.isFinite(maximum)
  ) {
    throw new Error(
      `O ator "${target.id}" precisa dos recursos numéricos finitos "${resourceKey}" e "${maximumResourceKey}".`,
    )
  }

  const resistance = resistances[packet.resistanceKey ?? packet.damageType] ?? 0
  const multiplier = Math.max(1, Number.isFinite(packet.criticalMultiplier) ? packet.criticalMultiplier! : 1)
  const resolved = resolveResistedMagnitude(packet.amount, resistance, multiplier)
  const safeMaximum = Math.max(0, maximum)
  const safeCurrent = clampFinite(current, 0, safeMaximum)
  const resourceDamage = Math.min(safeCurrent, resolved)
  resources[resourceKey] = safeCurrent - resourceDamage

  let appliedPostureDamage = 0
  let postureBroken = false
  const postureKey = packet.postureResourceKey
  const maxPostureKey = packet.maximumPostureKey
  if (postureKey && maxPostureKey) {
    const before = resources[postureKey]
    const postureMaximum = resources[maxPostureKey]
    if (
      typeof before === 'number'
      && Number.isFinite(before)
      && typeof postureMaximum === 'number'
      && Number.isFinite(postureMaximum)
    ) {
      const safePostureMaximum = Math.max(0, postureMaximum)
      const safePosture = clampFinite(before, 0, safePostureMaximum)
      appliedPostureDamage = Math.max(0, Number.isFinite(packet.postureDamage) ? packet.postureDamage! : 0)
      resources[postureKey] = clampFinite(
        safePosture + appliedPostureDamage,
        0,
        safePostureMaximum,
      )
      postureBroken = safePosture < safePostureMaximum
        && resources[postureKey]! >= safePostureMaximum
    }
  }

  const killed = resources[resourceKey]! <= 0
  target.alive = !killed
  return { resourceKey, resourceDamage, postureDamage: appliedPostureDamage, killed, postureBroken }
}

/** Anexa ou acumula um efeito com duração, potência e stacks, preservando outros metadados. */
export function applyCombatStatus<
  Resources extends object,
  Attributes extends object,
  Resistances extends object,
  Status extends TimedCombatStatus,
>(
  target: CombatActorState<Resources, Attributes, Resistances, Status>,
  status: Status,
): void {
  if (!target.alive || status.remainingSeconds <= 0) return
  target.statuses = mergeTimedEffect(target.statuses, status)
}

/** Atualiza timers e regeneração/redução de recursos com chaves declaradas pelo pacote. */
export function updateCombatActor<
  Resources extends object,
  Attributes extends object,
  Resistances extends object,
  Status extends TimedCombatStatus,
>(
  target: CombatActorState<Resources, Attributes, Resistances, Status>,
  deltaSeconds: number,
  options: {
    resourceRecoveryPerSecond?: Record<string, number>
    resourceLimits?: Record<string, string>
    postureResourceKey?: string
    postureRecoveryPerSecond?: number
    healthKey?: string
  } = {},
): void {
  const delta = clampFinite(deltaSeconds, 0, 1, 0)
  target.statuses = tickTimedEffects(target.statuses, delta)
  const resources = target.resources as Record<string, number>

  for (const [key, rate] of Object.entries(options.resourceRecoveryPerSecond ?? {})) {
    const value = resources[key]
    const maximumKey = options.resourceLimits?.[key]
    const maximum = maximumKey ? resources[maximumKey] : undefined
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || typeof maximum !== 'number'
      || !Number.isFinite(maximum)
      || !Number.isFinite(rate)
    ) continue
    resources[key] = clampFinite(
      value + rate * delta,
      0,
      Math.max(0, maximum),
    )
  }

  const postureKey = options.postureResourceKey
  if (postureKey && Number.isFinite(resources[postureKey])) {
    const maximumKey = options.resourceLimits?.[postureKey]
    const configuredMaximum = maximumKey ? resources[maximumKey] : undefined
    const postureMaximum = typeof configuredMaximum === 'number' && Number.isFinite(configuredMaximum)
      ? Math.max(0, configuredMaximum)
      : Number.MAX_SAFE_INTEGER
    const recoveryRate = Number.isFinite(options.postureRecoveryPerSecond)
      ? Math.max(0, options.postureRecoveryPerSecond!)
      : 0
    resources[postureKey] = clampFinite(
      resources[postureKey]! - recoveryRate * delta,
      0,
      postureMaximum,
    )
  }

  const healthKey = options.healthKey
  if (healthKey && typeof resources[healthKey] === 'number') {
    target.alive = Number.isFinite(resources[healthKey]!) && resources[healthKey]! > 0
  }
}
