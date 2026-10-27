import type { BehaviorPackageInstance, PackageJsonValue, PackageScalar } from './packages'
import {
  applyCombatDamage,
  type CombatActorState,
  type TimedCombatStatus,
} from './CombatModel'
import { clampFinite, mergeTimedEffect, restoreResource, spendResource, tickTimedEffects } from './CombatPrimitives'

export interface PackageDamageOptions {
  packageId?: string
  amount: number
  damageType: string
  healthVariable?: string
  maximumHealthVariable?: string
  resistanceVariable?: string
  postureVariable?: string
  maximumPostureVariable?: string
  postureDamage?: number
  criticalMultiplier?: number
  aliveVariable?: string
  damagedEvent?: string
  healthChangedEvent?: string
  postureBrokenEvent?: string
  defeatedEvent?: string
}

export interface PackageResourceOptions {
  packageId?: string
  resourceVariable: string
  maximumResourceVariable: string
  amount: number
  changedEvent?: string
  aliveVariable?: string
  revivedEvent?: string
}

export interface PackageCombatStatus extends TimedCombatStatus {
  source?: string
  damageType?: string
  modifiers?: Record<string, PackageScalar>
}

/** Adaptador genérico entre pacotes serializados e o modelo de combate reutilizável. */
export class CombatPackageRuntime {
  private readonly getPackages: () => BehaviorPackageInstance[]
  private readonly emitChanged: (ownerObjectId: string) => void
  private readonly triggerEvent: (ownerObjectId: string, packageId: string, eventId: string) => boolean

  constructor(dependencies: {
    getPackages: () => BehaviorPackageInstance[]
    emitChanged: (ownerObjectId: string) => void
    triggerEvent: (ownerObjectId: string, packageId: string, eventId: string) => boolean
  }) {
    this.getPackages = dependencies.getPackages
    this.emitChanged = dependencies.emitChanged
    this.triggerEvent = dependencies.triggerEvent
  }

  damage(ownerObjectId: string, options: PackageDamageOptions): ReturnType<typeof applyCombatDamage> {
    const instance = this.findInstance(ownerObjectId, options.packageId)
    const healthVariable = options.healthVariable ?? 'health'
    const maximumHealthVariable = options.maximumHealthVariable ?? 'max_health'
    const currentHealth = this.readNumber(instance, healthVariable)
    const maximumHealth = Math.max(1, this.readNumber(instance, maximumHealthVariable))
    const postureVariable = options.postureVariable
    const maximumPostureVariable = options.maximumPostureVariable
    const resources: Record<string, number> = {
      [healthVariable]: currentHealth,
      [maximumHealthVariable]: maximumHealth,
    }
    if (postureVariable && maximumPostureVariable) {
      resources[postureVariable] = this.readNumber(instance, postureVariable)
      resources[maximumPostureVariable] = Math.max(1, this.readNumber(instance, maximumPostureVariable))
    }

    const resistance = this.readResistance(instance, options.damageType, options.resistanceVariable)
    const actor: CombatActorState = {
      id: ownerObjectId,
      resources,
      attributes: {},
      resistances: { [options.damageType]: resistance },
      statuses: [],
      alive: currentHealth > 0 && instance.variables[options.aliveVariable ?? 'alive'] !== false,
    }
    const result = applyCombatDamage(actor, {
      amount: options.amount,
      damageType: options.damageType,
      resourceKey: healthVariable,
      maximumResourceKey: maximumHealthVariable,
      resistanceKey: options.damageType,
      postureDamage: options.postureDamage,
      postureResourceKey: postureVariable,
      maximumPostureKey: maximumPostureVariable,
      criticalMultiplier: options.criticalMultiplier,
    })

    instance.variables[healthVariable] = resources[healthVariable]!
    if (postureVariable && maximumPostureVariable) instance.variables[postureVariable] = resources[postureVariable]!
    if (Object.prototype.hasOwnProperty.call(instance.variables, options.aliveVariable ?? 'alive')) {
      instance.variables[options.aliveVariable ?? 'alive'] = !result.killed
    }
    if (Object.prototype.hasOwnProperty.call(instance.variables, 'last_damage')) {
      instance.variables.last_damage = result.resourceDamage
    }
    if (Object.prototype.hasOwnProperty.call(instance.variables, 'last_damage_type')) {
      instance.variables.last_damage_type = options.damageType
    }

    if (result.resourceDamage > 0) {
      this.triggerEvent(ownerObjectId, instance.packageId, options.damagedEvent ?? 'damaged')
      this.triggerEvent(ownerObjectId, instance.packageId, options.healthChangedEvent ?? 'health_changed')
    }
    if (result.postureBroken) this.triggerEvent(ownerObjectId, instance.packageId, options.postureBrokenEvent ?? 'posture_broken')
    if (result.killed) this.triggerEvent(ownerObjectId, instance.packageId, options.defeatedEvent ?? 'defeated')
    if (result.resourceDamage > 0 || result.postureDamage > 0) this.emitChanged(ownerObjectId)
    return result
  }

  restore(ownerObjectId: string, options: PackageResourceOptions): number {
    const instance = this.findInstance(ownerObjectId, options.packageId)
    const current = this.readNumber(instance, options.resourceVariable)
    const maximum = Math.max(0, this.readNumber(instance, options.maximumResourceVariable))
    const result = restoreResource(current, maximum, options.amount)
    instance.variables[options.resourceVariable] = result.value
    const aliveVariable = options.aliveVariable ?? 'alive'
    const wasAlive = instance.variables[aliveVariable] === true
    if (options.resourceVariable === 'health' && result.value > 0 && Object.prototype.hasOwnProperty.call(instance.variables, aliveVariable)) {
      instance.variables[aliveVariable] = true
    }
    if (result.changed > 0) {
      this.triggerEvent(ownerObjectId, instance.packageId, options.changedEvent ?? 'health_changed')
      if (!wasAlive && result.value > 0 && options.resourceVariable === 'health') {
        this.triggerEvent(ownerObjectId, instance.packageId, options.revivedEvent ?? 'revived')
      }
      this.emitChanged(ownerObjectId)
    }
    return result.changed
  }

  spend(ownerObjectId: string, options: PackageResourceOptions): boolean {
    const instance = this.findInstance(ownerObjectId, options.packageId)
    const current = this.readNumber(instance, options.resourceVariable)
    const maximum = Math.max(0, this.readNumber(instance, options.maximumResourceVariable))
    const result = spendResource(current, maximum, options.amount)
    if (!result.accepted) return false
    instance.variables[options.resourceVariable] = result.value
    if (result.changed !== 0) {
      this.triggerEvent(ownerObjectId, instance.packageId, options.changedEvent ?? 'resource_changed')
      this.emitChanged(ownerObjectId)
    }
    return true
  }

  applyStatus(ownerObjectId: string, status: PackageCombatStatus, packageId = 'combatant'): void {
    const instance = this.findInstance(ownerObjectId, packageId)
    const current = this.readStatuses(instance.config.statuses)
    const next = mergeTimedEffect(current, status)
    instance.config.statuses = next as unknown as PackageJsonValue
    this.triggerEvent(ownerObjectId, instance.packageId, 'status_applied')
    this.emitChanged(ownerObjectId)
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
    const delta = Math.min(deltaSeconds, 0.1)
    for (const instance of this.getPackages()) {
      if (!Array.isArray(instance.config.statuses)) continue
      const before = this.readStatuses(instance.config.statuses)
      if (!before.length) continue
      const next = tickTimedEffects(before, delta)
      if (next.every((status, index) => status.remainingSeconds === before[index]?.remainingSeconds) && next.length === before.length) continue
      instance.config.statuses = next as unknown as PackageJsonValue
      const stillActive = new Set(next.map(status => status.id))
      for (const status of before) {
        if (!stillActive.has(status.id)) this.triggerEvent(instance.ownerObjectId, instance.packageId, 'status_expired')
      }
      this.emitChanged(instance.ownerObjectId)
    }
  }

  private findInstance(ownerObjectId: string, packageId = 'combatant'): BehaviorPackageInstance {
    const instance = this.getPackages().find(item =>
      item.ownerObjectId === ownerObjectId && item.packageId === packageId && item.enabled,
    )
    if (!instance) {
      throw new Error(`Não existe um pacote de comportamento ativo "${packageId}" no objeto "${ownerObjectId}".`)
    }
    return instance
  }

  private readNumber(instance: BehaviorPackageInstance, variable: string): number {
    const value = instance.variables[variable]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`A variável "${variable}" do pacote "${instance.packageId}" precisa ser numérica.`)
    }
    return value
  }

  private readResistance(instance: BehaviorPackageInstance, damageType: string, variable?: string): number {
    if (variable) return clampFinite(this.readNumber(instance, variable), -100, 95)
    const resistances = instance.config.resistances
    if (resistances && typeof resistances === 'object' && !Array.isArray(resistances)) {
      const value = resistances[damageType]
      if (typeof value === 'number' && Number.isFinite(value)) return clampFinite(value, -100, 95)
    }
    const named = instance.variables[`resistance_${damageType}`]
    if (typeof named === 'number' && Number.isFinite(named)) return clampFinite(named, -100, 95)
    const fallback = instance.variables.resistance
    return typeof fallback === 'number' && Number.isFinite(fallback) ? clampFinite(fallback, -100, 95) : 0
  }

  private readStatuses(value: PackageJsonValue | undefined): PackageCombatStatus[] {
    if (!Array.isArray(value)) return []
    const result: PackageCombatStatus[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const record = item as Record<string, PackageJsonValue>
      if (
        typeof record.id !== 'string'
        || typeof record.remainingSeconds !== 'number'
        || typeof record.potency !== 'number'
        || typeof record.stacks !== 'number'
      ) continue
      const status: PackageCombatStatus = {
        id: record.id,
        remainingSeconds: record.remainingSeconds,
        potency: record.potency,
        stacks: record.stacks,
      }
      if (typeof record.source === 'string') status.source = record.source
      if (typeof record.damageType === 'string') status.damageType = record.damageType
      if (record.modifiers && typeof record.modifiers === 'object' && !Array.isArray(record.modifiers)) {
        const modifiers: Record<string, PackageScalar> = {}
        for (const [name, modifier] of Object.entries(record.modifiers)) {
          if (typeof modifier === 'string' || typeof modifier === 'number' || typeof modifier === 'boolean') {
            modifiers[name] = modifier
          }
        }
        status.modifiers = modifiers
      }
      result.push(status)
    }
    return result
  }
}
