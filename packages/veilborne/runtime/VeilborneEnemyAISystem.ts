import * as THREE from 'three'
import type { GameModuleContext } from '../../../engine/runtime/GameModule'
import { getAnimationControllerFromObject } from '../../../engine/world/AnimationController'
import { TimedCombatActionScheduler } from '../../../engine/script/TimedCombatActionScheduler.ts'
import { resolveVeilborneAIProfile } from './VeilborneAIProfiles.ts'
import { calculateVeilborneWeaponDamage, VEILBORNE_RUNTIME_WEAPONS, type VeilborneDamageType } from './VeilborneCombat'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import type { VeilborneCombatRuntime } from './VeilborneCombatRuntime'
import type { VeilborneVisualEffects } from './VeilborneVisualEffects'

const PACKAGE_ID = 'veilborne_rpg'

interface PendingEnemyProjectile {
  attackerObjectId: string
  origin: THREE.Vector3
  targetPosition: THREE.Vector3
  damage: number
  damageType: VeilborneDamageType
  postureDamage: number
}

const AUTONOMOUS_PACKAGE_ID = 'autonomous_agent'

const DAMAGE_COLORS: Record<VeilborneDamageType, number> = {
  physical: 0xd3d8e8,
  fire: 0xff713b,
  frost: 0x79ddff,
  storm: 0xffe77a,
  blood: 0xd82e55,
  shadow: 0x8b6ee8,
  spirit: 0x8bf7d1,
  arcane: 0x8c7cff,
}

/** IA de inimigos VEILBORNE; mantém perseguição e ataques fora do núcleo genérico. */
export class VeilborneEnemyAISystem {
  private readonly context: GameModuleContext
  private readonly combat: VeilborneCombatRuntime
  private readonly effects: VeilborneVisualEffects
  private readonly actions = new TimedCombatActionScheduler<PendingEnemyProjectile>()

  constructor(context: GameModuleContext, combat: VeilborneCombatRuntime, effects: VeilborneVisualEffects) {
    this.context = context
    this.combat = combat
    this.effects = effects
  }

  syncAutonomousPackages(runtimeEnabled: boolean): void {
    const packages = this.context.logic.listPackages()
    const hostilePackages = packages.filter(instance =>
      instance.packageId === PACKAGE_ID
      && instance.variables.entity_role === 'combatant'
      && instance.variables.faction === 'hostile',
    )
    const hostileOwnerIds = new Set(hostilePackages.map(instance => instance.ownerObjectId))

    // Se o pacote de combate foi removido do objeto, não deixe o agente auxiliar
    // continuar perseguindo o jogador como um comportamento órfão.
    for (const agent of packages) {
      if (
        agent.packageId === AUTONOMOUS_PACKAGE_ID
        && agent.variables.veilborne_managed === true
        && !hostileOwnerIds.has(agent.ownerObjectId)
        && agent.variables.mode !== 'idle'
      ) {
        this.context.logic.setPackageVariable(agent.id, 'mode', 'idle')
        agent.variables.mode = 'idle'
      }
    }

    for (const hostile of hostilePackages) {
      if (!this.context.world.get(hostile.ownerObjectId)) continue;
      const shouldRun = runtimeEnabled && hostile.enabled && hostile.variables.ai_enabled !== false
      let agent = packages.find(instance =>
        instance.ownerObjectId === hostile.ownerObjectId
        && instance.packageId === AUTONOMOUS_PACKAGE_ID,
      )
      if (!agent && !shouldRun) continue
      if (!agent) {
        agent = this.context.logic.installPackage(hostile.ownerObjectId, AUTONOMOUS_PACKAGE_ID)
        this.context.logic.setPackageVariable(agent.id, 'veilborne_managed', true)
        agent.variables.veilborne_managed = true
        packages.push(agent)
      }

      // Pacotes autônomos criados pelo usuário mantêm sua configuração própria.
      if (agent.variables.veilborne_managed !== true) continue
      if (!agent.enabled) {
        this.context.logic.updatePackage(agent.id, { enabled: true })
        agent.enabled = true
      }

      const profileName = typeof hostile.variables.ai_profile === 'string'
        ? hostile.variables.ai_profile.trim().toLowerCase()
        : 'melee'
      const profile = resolveVeilborneAIProfile(profileName, hostile.config)
      const customStats = hostile.variables.ai_custom_stats === true
      const number = (name: string, fallback: number): number => {
        const value = hostile.variables[name]
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback
      }
      const attackRange = Math.max(0.5, customStats ? number('attack_range', profile.attackRange) : profile.attackRange)
      const moveSpeed = Math.max(0, customStats ? number('move_speed', profile.moveSpeed) : profile.moveSpeed)
      const perceptionRange = Math.max(1, number('perception_range', 18))
      const playerPosition = this.context.avatar.mesh.position
      const enemyPosition = this.context.world.get(hostile.ownerObjectId)?.mesh.position
      const distance = enemyPosition
        ? Math.hypot(playerPosition.x - enemyPosition.x, playerPosition.z - enemyPosition.z)
        : Number.POSITIVE_INFINITY
      const targetState = this.combat.getTargetCombatant(hostile)
      const staggered = targetState.statuses.some(status => status.id === 'stagger')
      const slowStatus = targetState.statuses.find(status => status.id === 'slow')
      const slowMultiplier = slowStatus ? Math.max(0.2, 1 - slowStatus.potency) : 1
      const mode = !shouldRun || staggered || distance > perceptionRange || distance < 0.001
        ? 'idle'
        : profile.ranged && distance < attackRange * 0.62
          ? 'flee_player'
          : distance > attackRange * 0.94
            ? 'follow_player'
            : 'look_at_player'
      const stopDistance = attackRange * 0.94
      const setIfChanged = (name: string, value: string | number | boolean): void => {
        if (agent!.variables[name] === value) return
        this.context.logic.setPackageVariable(agent!.id, name, value)
        agent!.variables[name] = value
      }
      setIfChanged('mode', mode)
      setIfChanged('move_speed', moveSpeed * slowMultiplier)
      setIfChanged('perception_range', perceptionRange)
      setIfChanged('stopping_distance', stopDistance)
    }
  }

  update(dt: number): void {
    const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1))
    this.updatePendingProjectiles(step)
    const player = this.combat.getPlayerCombatant()
    const { avatar, logic } = this.context
    if (!player.alive) {
      this.syncAutonomousPackages(false)
      this.actions.clear()
      for (const { instance, object } of this.combat.getHostilePackages()) {
        this.setState(instance, 'idle')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState('idle')
      }
      return
    }

    const playerPosition = avatar.mesh.position
    // A altura da malha procedural não é o piso quando o terreno está oculto.
    // Cacheie os topos das plataformas visíveis para manter NPCs na superfície real.
    for (const { instance, object } of this.combat.getHostilePackages()) {
      if (instance.variables.ai_enabled === false) {
        this.setState(instance, 'idle')
        continue
      }

      const profileName = typeof instance.variables.ai_profile === 'string'
        ? instance.variables.ai_profile.trim().toLowerCase()
        : 'melee'
      const profile = resolveVeilborneAIProfile(profileName, instance.config)
      const customStats = instance.variables.ai_custom_stats === true
      const number = (name: string, fallback: number): number => {
        const value = instance.variables[name]
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback
      }
      const attackRange = Math.max(0.5, customStats ? number('attack_range', profile.attackRange) : profile.attackRange)
      let attackDamage = Math.max(0, customStats ? number('attack_damage', profile.damage) : profile.damage)
      const attackCooldown = Math.max(0.2, customStats ? number('attack_cooldown', profile.cooldown) : profile.cooldown)
      const postureDamage = Math.max(0, customStats ? number('attack_posture_damage', profile.postureDamage) : profile.postureDamage)
      const rawType = customStats && typeof instance.variables.attack_damage_type === 'string'
        ? instance.variables.attack_damage_type
        : profile.damageType
      const attackType = (Object.prototype.hasOwnProperty.call(DAMAGE_COLORS, rawType) ? rawType : profile.damageType) as VeilborneDamageType
      const perceptionRange = Math.max(1, number('perception_range', 18))
      const dx = playerPosition.x - object.mesh.position.x
      const dz = playerPosition.z - object.mesh.position.z
      const distance = Math.hypot(dx, dz)
      if (distance > perceptionRange || distance < 0.001) {
        this.setState(instance, 'idle')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller && (controller.currentState === 'walk' || controller.currentState === 'run')) controller.setState('idle')
        continue
      }

      const targetState = this.combat.getTargetCombatant(instance)
      const stagger = targetState.statuses.some(status => status.id === 'stagger')
      if (stagger) {
        this.setState(instance, 'staggered')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState('idle')
        continue
      }

      // O deslocamento, a prevenção de obstáculos e a animação locomotora são
      // executados pelo AutonomousBehaviorSystem genérico da engine.
      if (distance <= attackRange) {
        const key = 'ai-attack:' + instance.ownerObjectId
        const cooling = !this.actions.canExecute(key)
        this.setState(instance, cooling ? 'recover' : 'attack')
        if (!cooling) {
          const silenced = targetState.statuses.some(status => status.id === 'silence')
          if (profile.ranged && silenced) {
            this.actions.startCooldown(key, Math.min(0.4, attackCooldown))
            this.setState(instance, 'recover')
          } else {
            this.actions.startCooldown(key, attackCooldown)
            const controller = getAnimationControllerFromObject(object.mesh)
            if (controller) controller.playOneShot(profile.ranged ? 'ability_1' : 'primary_action')
            logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'enemy_attack')
            const updatedInstance = logic.listPackages(instance.ownerObjectId).find(item => item.packageId === PACKAGE_ID)
            const multiplier = updatedInstance?.variables.ai_damage_multiplier
            if (typeof multiplier === 'number' && Number.isFinite(multiplier)) {
              attackDamage *= Math.max(0, multiplier)
            }
            const source = object.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0))
            if (profile.ranged) {
              const impact = avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.85, 0))
              const flightSeconds = THREE.MathUtils.clamp(source.distanceTo(impact) / 22, 0.2, 0.75)
              this.effects.spawnEffect(source, DAMAGE_COLORS[attackType], 0.24, 0.2)
              this.effects.spawnProjectile(source, impact, DAMAGE_COLORS[attackType], flightSeconds)
              this.actions.schedule({
                attackerObjectId: instance.ownerObjectId,
                origin: source.clone(),
                targetPosition: impact,
                damage: attackDamage,
                damageType: attackType,
                postureDamage,
              }, flightSeconds)
            } else if (this.resolveAttackImpact(instance, attackDamage, attackType, postureDamage, source)) {
              break
            }
          }
        }
      } else {
        this.setState(instance, 'pursue')
      }
    }
  }

  clear(): void {
    this.actions.clear()
  }

  private updatePendingProjectiles(dt: number): void {
    for (const projectile of this.actions.update(dt)) {
      this.effects.spawnEffect(projectile.targetPosition, DAMAGE_COLORS[projectile.damageType], 0.4, 0.32)
      if (!this.combat.getPlayerCombatant().alive) continue
      const playerPosition = this.context.avatar.mesh.position
      const planarDistance = Math.hypot(
        playerPosition.x - projectile.targetPosition.x,
        playerPosition.z - projectile.targetPosition.z,
      )
      // Esquivar para fora do ponto previsto evita o impacto do projétil.
      if (planarDistance > 1.45) continue
      const attacker = this.context.logic.listPackages(projectile.attackerObjectId).find(
        instance => instance.packageId === PACKAGE_ID,
      )
      if (!attacker) continue
      this.resolveAttackImpact(
        attacker,
        projectile.damage,
        projectile.damageType,
        projectile.postureDamage,
        projectile.origin,
      )
    }
  }

  private resolveAttackImpact(
    instance: BehaviorPackageInstance,
    damage: number,
    damageType: VeilborneDamageType,
    postureDamage: number,
    source: THREE.Vector3,
  ): boolean {
    const { avatar, logic } = this.context
    const result = this.combat.receiveIncomingDamage(damage, damageType, postureDamage, instance.ownerObjectId)
    this.effects.spawnEffect(source, DAMAGE_COLORS[damageType], 0.35, 0.28)
    if (result.damage > 0 || result.absorbedByWard > 0) {
      this.effects.spawnEffect(
        avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.85, 0)),
        DAMAGE_COLORS[damageType],
        result.blocked ? 0.38 : 0.52,
        0.3,
      )
    }
    if (result.parried) {
      const weaponIdRaw = logic.getVariable('arma_equipada')
      const weaponId = typeof weaponIdRaw === 'string' ? weaponIdRaw : 'starter_arcane_sword'
      const weapon = VEILBORNE_RUNTIME_WEAPONS[weaponId] ?? VEILBORNE_RUNTIME_WEAPONS.starter_arcane_sword!
      const counterDamage = Math.round(
        calculateVeilborneWeaponDamage(weapon, this.combat.getPlayerCombatant().attributes) * 0.8,
      )
      const counter = this.combat.applyDamageToTarget(
        instance,
        counterDamage,
        weapon.damageType,
        weapon.postureDamage * 1.5,
      )
      this.effects.spawnEffect(
        this.combat.getWorldPoint(instance.ownerObjectId) ?? source,
        0xe3f5ff,
        0.8,
        0.34,
      )
      return counter.killed
    }
    return result.killed
  }

  private setState(instance: BehaviorPackageInstance, next: string): void {
    const previous = typeof instance.variables.ai_state === 'string' ? instance.variables.ai_state : 'idle'
    if (previous === next) return
    this.context.logic.setPackageVariable(instance.id, 'ai_state', next)
    this.context.world.events.emit('behaviorPackageChanged', { ownerObjectId: instance.ownerObjectId })
    if ((next === 'pursue' || next === 'attack' || next === 'recover') && previous === 'idle') {
      this.context.logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'enemy_spotted')
    } else if (next === 'idle' && (previous === 'pursue' || previous === 'attack' || previous === 'recover')) {
      this.context.logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'enemy_lost_target')
    }
  }
}
