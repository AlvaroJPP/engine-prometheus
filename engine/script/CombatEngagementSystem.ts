import * as THREE from 'three'
import type { World } from '../world/World.ts'
import type { BehaviorPackageInstance, PackageJsonValue, PackageScalar } from './packages.ts'
import type { RuleEngine } from './RuleEngine.ts'
import { TimedCombatActionScheduler } from './TimedCombatActionScheduler.ts'

export interface CombatEngagementProfile {
  attackRange: number
  moveSpeed: number
  damage: number
  cooldown: number
  damageType: string
  postureDamage: number
  ranged: boolean
}

export interface CombatActorState {
  alive: boolean
  statuses: readonly { id: string; potency?: number }[]
}

export interface CombatEngagementSchema {
  actorRoleVariable: string
  actorRoleValue: PackageScalar
  actorFactionVariable: string
  actorFactionValue: PackageScalar
  enabledVariable: string
  profileVariable: string
  profilesConfigKey: string
  defaultProfile: string
  customStatsVariable: string
  perceptionRangeVariable: string
  stateVariable: string
  damageMultiplierVariable: string
  attackRangeVariable: string
  moveSpeedVariable: string
  damageVariable: string
  cooldownVariable: string
  damageTypeVariable: string
  postureDamageVariable: string
  autonomousPackageId: string
  autonomousModeVariable: string
  autonomousSpeedVariable: string
  autonomousPerceptionVariable: string
  autonomousStopDistanceVariable: string
  attackEvent: string
  spottedEvent: string
  lostTargetEvent: string
  staggerStatusId: string
  slowStatusId: string
  silenceStatusId: string
  idleState: string
  pursueState: string
  attackState: string
  recoverState: string
  staggeredState: string
  deadState: string
  idleMode: string
  followMode: string
  fleeMode: string
  lookMode: string
  retreatRatio: number
  stoppingDistanceRatio: number
  attackOriginHeight: number
  targetImpactHeight: number
}

export interface CombatAttackIntent {
  ownerObjectId: string
  instance: BehaviorPackageInstance
  profile: CombatEngagementProfile
  damage: number
  damageType: string
  postureDamage: number
  origin: THREE.Vector3
  target: THREE.Vector3
}

export interface CombatEngagementDependencies {
  world: World
  logic: Pick<RuleEngine, 'listPackages' | 'installPackage' | 'updatePackage' | 'setPackageVariable' | 'triggerPackageEvent'>
  getTargetPosition(): THREE.Vector3
  isTargetAlive(): boolean
  getActorState(instance: BehaviorPackageInstance): CombatActorState
}

type JsonRecord = Record<string, PackageJsonValue>
type Settings = CombatEngagementSchema

const MANAGED_AGENT_VARIABLE = 'combat_behavior_managed_by'

/**
 * Generic combat engagement policy.
 *
 * Package data describes actor filters, profile fields, state variables and event IDs.
 * This system decides when actors pursue, retreat, recover or request an attack; the
 * game/module still resolves the final impact (block, parry, damage numbers, etc.).
 */
export class CombatEngagementSystem {
  private readonly dependencies: CombatEngagementDependencies
  private readonly fallback: CombatEngagementSchema
  private readonly cooldowns = new TimedCombatActionScheduler<string>()

  constructor(dependencies: CombatEngagementDependencies, fallback: CombatEngagementSchema) {
    this.dependencies = dependencies
    this.fallback = fallback
  }

  syncMovementPackages(runtimeEnabled: boolean): void {
    const { logic } = this.dependencies
    const packages = logic.listPackages()
    const actors = this.combatActors(packages)
    const activeOwners = new Set(actors.map(({ instance }) => instance.ownerObjectId))

    for (const agent of packages) {
      if (
        agent.packageId === 'autonomous_agent'
        && typeof agent.variables[MANAGED_AGENT_VARIABLE] === 'string'
        && !activeOwners.has(agent.ownerObjectId)
        && agent.variables.mode !== 'idle'
      ) {
        logic.setPackageVariable(agent.id, 'mode', 'idle')
        agent.variables.mode = 'idle'
      }
    }

    for (const { instance, settings, profile } of actors) {
      if (!this.dependencies.world.get(instance.ownerObjectId)) continue
      const state = this.dependencies.getActorState(instance)
      const targetPosition = this.dependencies.getTargetPosition()
      const actorPosition = this.dependencies.world.get(instance.ownerObjectId)!.mesh.position
      const distance = Math.hypot(
        targetPosition.x - actorPosition.x,
        targetPosition.z - actorPosition.z,
      )
      const shouldRun = runtimeEnabled
        && instance.enabled
        && instance.variables[settings.enabledVariable] !== false
        && state.alive
        && this.dependencies.isTargetAlive()
      let agent = packages.find(candidate =>
        candidate.ownerObjectId === instance.ownerObjectId
        && candidate.packageId === settings.autonomousPackageId,
      )
      if (!agent && !shouldRun) continue
      if (!agent) {
        agent = logic.installPackage(instance.ownerObjectId, settings.autonomousPackageId)
        logic.setPackageVariable(agent.id, MANAGED_AGENT_VARIABLE, instance.packageId)
        agent.variables[MANAGED_AGENT_VARIABLE] = instance.packageId
        packages.push(agent)
      }

      // Preserve custom movement behavior installed by the creator.
      if (agent.variables[MANAGED_AGENT_VARIABLE] !== instance.packageId) continue
      if (!agent.enabled) {
        logic.updatePackage(agent.id, { enabled: true })
        agent.enabled = true
      }

      const staggered = state.statuses.some(status => status.id === settings.staggerStatusId)
      const slow = state.statuses.find(status => status.id === settings.slowStatusId)
      const slowMultiplier = slow
        ? Math.max(0.2, 1 - this.finite(slow.potency, 1))
        : 1
      const perceptionRange = Math.max(
        1,
        this.number(instance, settings.perceptionRangeVariable, 18),
      )
      const attackRange = this.resolveProfile(instance, settings, profile).attackRange
      const mode = !shouldRun || staggered || distance > perceptionRange || distance < 0.001
        ? settings.idleMode
        : profile.ranged && distance < attackRange * settings.retreatRatio
          ? settings.fleeMode
          : distance > attackRange * settings.stoppingDistanceRatio
            ? settings.followMode
            : settings.lookMode
      const setIfChanged = (name: string, value: string | number | boolean): void => {
        if (agent!.variables[name] === value) return
        logic.setPackageVariable(agent!.id, name, value)
        agent!.variables[name] = value
      }
      setIfChanged(settings.autonomousModeVariable, mode)
      setIfChanged(settings.autonomousSpeedVariable, profile.moveSpeed * slowMultiplier)
      setIfChanged(settings.autonomousPerceptionVariable, perceptionRange)
      setIfChanged(
        settings.autonomousStopDistanceVariable,
        attackRange * settings.stoppingDistanceRatio,
      )
    }
  }

  update(runtimeEnabled: boolean, deltaSeconds: number): CombatAttackIntent[] {
    this.cooldowns.update(deltaSeconds)
    const { logic, world } = this.dependencies
    if (!runtimeEnabled || !this.dependencies.isTargetAlive()) {
      this.syncMovementPackages(false)
      this.cooldowns.clear()
      for (const { instance, settings } of this.combatActors(logic.listPackages())) {
        this.setState(instance, settings, settings.idleState)
      }
      return []
    }

    const targetPosition = this.dependencies.getTargetPosition().clone()
    const attacks: CombatAttackIntent[] = []

    for (const { instance, settings, profile: baseProfile } of this.combatActors(logic.listPackages())) {
      const object = world.get(instance.ownerObjectId)
      if (!object) continue
      if (!instance.enabled || instance.variables[settings.enabledVariable] === false) {
        this.setState(instance, settings, settings.idleState)
        continue
      }

      const state = this.dependencies.getActorState(instance)
      if (!state.alive) {
        this.setState(instance, settings, settings.deadState)
        continue
      }

      const profile = this.resolveProfile(instance, settings, baseProfile)
      const perceptionRange = Math.max(1, this.number(instance, settings.perceptionRangeVariable, 18))
      const dx = targetPosition.x - object.mesh.position.x
      const dz = targetPosition.z - object.mesh.position.z
      const distance = Math.hypot(dx, dz)
      if (distance > perceptionRange || distance < 0.001) {
        this.setState(instance, settings, settings.idleState)
        continue
      }
      if (state.statuses.some(status => status.id === settings.staggerStatusId)) {
        this.setState(instance, settings, settings.staggeredState)
        continue
      }

      if (distance > profile.attackRange) {
        this.setState(instance, settings, settings.pursueState)
        continue
      }

      const actionId = instance.packageId + ':' + instance.ownerObjectId
      if (!this.cooldowns.canExecute(actionId)) {
        this.setState(instance, settings, settings.recoverState)
        continue
      }
      if (profile.ranged && state.statuses.some(status => status.id === settings.silenceStatusId)) {
        this.cooldowns.startCooldown(actionId, Math.min(0.4, profile.cooldown))
        this.setState(instance, settings, settings.recoverState)
        continue
      }

      this.cooldowns.startCooldown(actionId, profile.cooldown)
      this.setState(instance, settings, settings.attackState)
      logic.triggerPackageEvent(instance.ownerObjectId, instance.packageId, settings.attackEvent)

      const updated = logic.listPackages(instance.ownerObjectId)
        .find(candidate => candidate.id === instance.id) ?? instance
      const multiplier = updated.variables[settings.damageMultiplierVariable]
      const damageMultiplier = typeof multiplier === 'number' && Number.isFinite(multiplier)
        ? Math.max(0, multiplier)
        : 1
      const objectPosition = object.mesh.position
      attacks.push({
        ownerObjectId: instance.ownerObjectId,
        instance: updated,
        profile,
        damage: profile.damage * damageMultiplier,
        damageType: profile.damageType,
        postureDamage: profile.postureDamage,
        origin: objectPosition.clone().add(new THREE.Vector3(0, settings.attackOriginHeight, 0)),
        target: targetPosition.clone().add(new THREE.Vector3(0, settings.targetImpactHeight, 0)),
      })
    }

    return attacks
  }

  clear(): void {
    this.cooldowns.clear()
  }

  private combatActors(packages: BehaviorPackageInstance[]): Array<{
    instance: BehaviorPackageInstance
    settings: Settings
    profile: CombatEngagementProfile
  }> {
    const actors: Array<{ instance: BehaviorPackageInstance; settings: Settings; profile: CombatEngagementProfile }> = []
    for (const instance of packages) {
      const settings = this.readSettings(instance)
      if (!settings) continue
      if (instance.variables[settings.actorRoleVariable] !== settings.actorRoleValue) continue
      if (instance.variables[settings.actorFactionVariable] !== settings.actorFactionValue) continue
      const profile = this.resolveProfile(instance, settings, this.fallbackProfile(instance, settings))
      actors.push({ instance, settings, profile })
    }
    return actors
  }

  private readSettings(instance: BehaviorPackageInstance): Settings | null {
    const raw = this.asRecord(instance.config.combatBehavior)
    if (!raw) return this.fallback
    const scalar = (key: keyof CombatEngagementSchema): PackageScalar =>
      this.readScalar(raw, key, this.fallback[key]) as PackageScalar
    const string = (key: keyof CombatEngagementSchema): string =>
      this.readString(raw, key, this.fallback[key] as string)
    const ratio = (key: keyof CombatEngagementSchema): number =>
      Math.max(0, this.readNumber(raw, key, this.fallback[key] as number))
    return {
      actorRoleVariable: string('actorRoleVariable'),
      actorRoleValue: scalar('actorRoleValue'),
      actorFactionVariable: string('actorFactionVariable'),
      actorFactionValue: scalar('actorFactionValue'),
      enabledVariable: string('enabledVariable'),
      profileVariable: string('profileVariable'),
      profilesConfigKey: string('profilesConfigKey'),
      defaultProfile: string('defaultProfile'),
      customStatsVariable: string('customStatsVariable'),
      perceptionRangeVariable: string('perceptionRangeVariable'),
      stateVariable: string('stateVariable'),
      damageMultiplierVariable: string('damageMultiplierVariable'),
      attackRangeVariable: string('attackRangeVariable'),
      moveSpeedVariable: string('moveSpeedVariable'),
      damageVariable: string('damageVariable'),
      cooldownVariable: string('cooldownVariable'),
      damageTypeVariable: string('damageTypeVariable'),
      postureDamageVariable: string('postureDamageVariable'),
      autonomousPackageId: string('autonomousPackageId'),
      autonomousModeVariable: string('autonomousModeVariable'),
      autonomousSpeedVariable: string('autonomousSpeedVariable'),
      autonomousPerceptionVariable: string('autonomousPerceptionVariable'),
      autonomousStopDistanceVariable: string('autonomousStopDistanceVariable'),
      attackEvent: string('attackEvent'),
      spottedEvent: string('spottedEvent'),
      lostTargetEvent: string('lostTargetEvent'),
      staggerStatusId: string('staggerStatusId'),
      slowStatusId: string('slowStatusId'),
      silenceStatusId: string('silenceStatusId'),
      idleState: string('idleState'),
      pursueState: string('pursueState'),
      attackState: string('attackState'),
      recoverState: string('recoverState'),
      staggeredState: string('staggeredState'),
      deadState: string('deadState'),
      idleMode: string('idleMode'),
      followMode: string('followMode'),
      fleeMode: string('fleeMode'),
      lookMode: string('lookMode'),
      retreatRatio: ratio('retreatRatio'),
      stoppingDistanceRatio: ratio('stoppingDistanceRatio'),
      attackOriginHeight: this.readNumber(raw, 'attackOriginHeight', this.fallback.attackOriginHeight),
      targetImpactHeight: this.readNumber(raw, 'targetImpactHeight', this.fallback.targetImpactHeight),
    }
  }

  private fallbackProfile(instance: BehaviorPackageInstance, settings: Settings): CombatEngagementProfile {
    const profileName = this.readString(instance.variables, settings.profileVariable, settings.defaultProfile)
    const profiles = this.asRecord(instance.config[settings.profilesConfigKey])
    const profile = profiles ? this.asRecord(profiles[profileName]) : null
    const fallback = profile ?? (profiles ? this.asRecord(profiles[settings.defaultProfile]) : null) ?? {}
    return this.profileFromRecord(fallback, {
      attackRange: 2,
      moveSpeed: 2.8,
      damage: 12,
      cooldown: 1.4,
      damageType: 'physical',
      postureDamage: 8,
      ranged: false,
    })
  }

  private resolveProfile(
    instance: BehaviorPackageInstance,
    settings: Settings,
    fallback: CombatEngagementProfile,
  ): CombatEngagementProfile {
    const profileName = this.readString(instance.variables, settings.profileVariable, settings.defaultProfile)
    const profiles = this.asRecord(instance.config[settings.profilesConfigKey])
    const profileRecord = profiles ? this.asRecord(profiles[profileName]) : null
    const profile = profileRecord
      ? this.profileFromRecord(profileRecord, fallback)
      : { ...fallback }
    if (instance.variables[settings.customStatsVariable] !== true) return profile

    return {
      attackRange: Math.max(0.5, this.number(instance, settings.attackRangeVariable, profile.attackRange)),
      moveSpeed: Math.max(0, this.number(instance, settings.moveSpeedVariable, profile.moveSpeed)),
      damage: Math.max(0, this.number(instance, settings.damageVariable, profile.damage)),
      cooldown: Math.max(0.2, this.number(instance, settings.cooldownVariable, profile.cooldown)),
      damageType: this.readString(instance.variables, settings.damageTypeVariable, profile.damageType),
      postureDamage: Math.max(0, this.number(instance, settings.postureDamageVariable, profile.postureDamage)),
      ranged: profile.ranged,
    }
  }

  private profileFromRecord(
    record: Record<string, PackageJsonValue>,
    fallback: CombatEngagementProfile,
  ): CombatEngagementProfile {
    return {
      attackRange: Math.max(0.5, this.readNumber(record, 'attackRange', fallback.attackRange)),
      moveSpeed: Math.max(0, this.readNumber(record, 'moveSpeed', fallback.moveSpeed)),
      damage: Math.max(0, this.readNumber(record, 'damage', fallback.damage)),
      cooldown: Math.max(0.2, this.readNumber(record, 'cooldown', fallback.cooldown)),
      damageType: this.readString(record, 'damageType', fallback.damageType),
      postureDamage: Math.max(0, this.readNumber(record, 'postureDamage', fallback.postureDamage)),
      ranged: this.readBoolean(record, 'ranged', fallback.ranged),
    }
  }

  private setState(instance: BehaviorPackageInstance, settings: Settings, next: string): void {
    const previous = this.readString(instance.variables, settings.stateVariable, settings.idleState)
    if (previous === next) return
    this.dependencies.logic.setPackageVariable(instance.id, settings.stateVariable, next)
    this.dependencies.world.events.emit('behaviorPackageChanged', { ownerObjectId: instance.ownerObjectId })
    if (
      (next === settings.pursueState || next === settings.attackState || next === settings.recoverState)
      && previous === settings.idleState
    ) {
      this.dependencies.logic.triggerPackageEvent(instance.ownerObjectId, instance.packageId, settings.spottedEvent)
    } else if (
      next === settings.idleState
      && (previous === settings.pursueState || previous === settings.attackState || previous === settings.recoverState)
    ) {
      this.dependencies.logic.triggerPackageEvent(instance.ownerObjectId, instance.packageId, settings.lostTargetEvent)
    }
  }

  private number(instance: BehaviorPackageInstance, key: string, fallback: number): number {
    return this.readNumber(instance.variables, key, fallback)
  }

  private finite(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private asRecord(value: PackageJsonValue | undefined): JsonRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as JsonRecord
      : null
  }

  private readScalar(record: JsonRecord, key: keyof CombatEngagementSchema, fallback: unknown): PackageScalar {
    const value = record[key]
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : fallback as PackageScalar
  }

  private readString(record: Record<string, PackageJsonValue>, key: string, fallback: string): string {
    const value = record[key]
    return typeof value === 'string' && value.trim() ? value : fallback
  }

  private readNumber(record: Record<string, PackageJsonValue>, key: keyof CombatEngagementSchema | string, fallback: number): number {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private readBoolean(record: Record<string, PackageJsonValue>, key: string, fallback: boolean): boolean {
    const value = record[key]
    return typeof value === 'boolean' ? value : fallback
  }
}
