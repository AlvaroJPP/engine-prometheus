import * as THREE from 'three'
import type { GameModuleContext } from '../../../engine/runtime/GameModule'
import { getAnimationControllerFromObject } from '../../../engine/world/AnimationController'
import { calculateVeilborneWeaponDamage, VEILBORNE_RUNTIME_WEAPONS, type VeilborneDamageType } from './VeilborneCombat'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import type { VeilborneCombatRuntime } from './VeilborneCombatRuntime'
import type { VeilborneVisualEffects } from './VeilborneVisualEffects'

const PACKAGE_ID = 'veilborne_rpg'

type AIProfile = {
  attackRange: number
  moveSpeed: number
  damage: number
  cooldown: number
  damageType: VeilborneDamageType
  postureDamage: number
  ranged: boolean
}

const PROFILES: Record<string, AIProfile> = {
  melee: { attackRange: 2, moveSpeed: 2.8, damage: 12, cooldown: 1.4, damageType: 'physical', postureDamage: 8, ranged: false },
  ranged_caster: { attackRange: 9, moveSpeed: 2.3, damage: 18, cooldown: 1.8, damageType: 'arcane', postureDamage: 6, ranged: true },
  flanker: { attackRange: 1.8, moveSpeed: 4, damage: 10, cooldown: 1.05, damageType: 'physical', postureDamage: 7, ranged: false },
  guard_breaker: { attackRange: 2.7, moveSpeed: 1.7, damage: 24, cooldown: 2, damageType: 'physical', postureDamage: 20, ranged: false },
  boss_phases: { attackRange: 3.2, moveSpeed: 2.3, damage: 28, cooldown: 1.7, damageType: 'shadow', postureDamage: 24, ranged: false },
}

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
  private readonly attackCooldowns = new Map<string, number>()

  constructor(context: GameModuleContext, combat: VeilborneCombatRuntime, effects: VeilborneVisualEffects) {
    this.context = context
    this.combat = combat
    this.effects = effects
  }

  update(dt: number): void {
    const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1))
    for (const [id, remaining] of this.attackCooldowns) {
      const next = Math.max(0, remaining - step)
      if (next <= 0) this.attackCooldowns.delete(id)
      else this.attackCooldowns.set(id, next)
    }

    const player = this.combat.getPlayerCombatant()
    const { avatar, logic, world, collisions } = this.context
    if (!player.alive) {
      for (const { instance, object } of this.combat.getHostilePackages()) {
        this.setState(instance, 'idle')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState('idle')
      }
      return
    }

    const playerPosition = avatar.mesh.position
    for (const { instance, object } of this.combat.getHostilePackages()) {
      if (instance.variables.ai_enabled === false) {
        this.setState(instance, 'idle')
        continue
      }

      const profileName = typeof instance.variables.ai_profile === 'string'
        ? instance.variables.ai_profile.trim().toLowerCase()
        : 'melee'
      const profile = PROFILES[profileName] ?? PROFILES.melee!
      const customStats = instance.variables.ai_custom_stats === true
      const number = (name: string, fallback: number): number => {
        const value = instance.variables[name]
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback
      }
      const attackRange = Math.max(0.5, customStats ? number('attack_range', profile.attackRange) : profile.attackRange)
      const moveSpeed = Math.max(0, customStats ? number('move_speed', profile.moveSpeed) : profile.moveSpeed)
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
      const ratio = targetState.resources.vitality / Math.max(1, targetState.resources.maxVitality)
      if (profileName === 'boss_phases') {
        const phase = ratio <= 0.25 ? 3 : ratio <= 0.6 ? 2 : 1
        if (instance.variables.boss_phase !== phase) logic.setPackageVariable(instance.id, 'boss_phase', phase)
        if (phase === 2) attackDamage *= 1.2
        if (phase === 3) attackDamage *= 1.45
      }

      const stagger = targetState.statuses.some(status => status.id === 'stagger')
      if (stagger) {
        this.setState(instance, 'staggered')
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState('idle')
        continue
      }

      const directionX = dx / distance
      const directionZ = dz / distance
      const targetYaw = Math.atan2(directionX, directionZ)
      const movingToward = distance > attackRange * 0.94
      const movingAway = profile.ranged && distance < attackRange * 0.62
      const slowStatus = targetState.statuses.find(status => status.id === 'slow')
      const slowMultiplier = slowStatus ? Math.max(0.2, 1 - slowStatus.potency) : 1
      let nextX = object.mesh.position.x
      let nextZ = object.mesh.position.z
      let moving = false

      if ((movingToward || movingAway) && moveSpeed > 0) {
        const direction = movingAway ? -1 : 1
        const stepDistance = Math.min(
          moveSpeed * slowMultiplier * step,
          Math.max(0, Math.abs(distance - attackRange * (movingAway ? 0.72 : 0.94))),
        )
        nextX = THREE.MathUtils.clamp(nextX + directionX * stepDistance * direction, -49, 49)
        nextZ = THREE.MathUtils.clamp(nextZ + directionZ * stepDistance * direction, -49, 49)
        moving = stepDistance > 1e-5
      }

      const currentRotation = object.mesh.rotation.y
      if (moving || Math.abs(currentRotation - targetYaw) > 0.01) {
        const bounds = new THREE.Box3().setFromObject(object.mesh)
        const bottomOffset = object.mesh.position.y - bounds.min.y
        const groundYRaw = world.terrain.heightAt(nextX, nextZ)
        const groundY = Number.isFinite(groundYRaw) ? groundYRaw + bottomOffset : object.mesh.position.y
        const canMove = !moving || collisions.canMoveObjectTo(object.id, { x: nextX, y: groundY, z: nextZ })
        world.update(object.id, {
          x: canMove ? nextX : object.mesh.position.x,
          y: canMove ? groundY : object.mesh.position.y,
          z: canMove ? nextZ : object.mesh.position.z,
          rotationY: targetYaw * 180 / Math.PI,
        })
        const controller = getAnimationControllerFromObject(object.mesh)
        if (controller) controller.setState(moving && canMove ? 'run' : 'idle')
      }

      if (distance <= attackRange) {
        const key = 'ai-attack:' + instance.ownerObjectId
        const cooling = (this.attackCooldowns.get(key) ?? 0) > 0
        this.setState(instance, cooling ? 'recover' : 'attack')
        if (!cooling) {
          const silenced = targetState.statuses.some(status => status.id === 'silence')
          if (profile.ranged && silenced) {
            this.attackCooldowns.set(key, Math.min(0.4, attackCooldown))
            this.setState(instance, 'recover')
          } else {
            this.attackCooldowns.set(key, attackCooldown)
            const controller = getAnimationControllerFromObject(object.mesh)
            if (controller) controller.playOneShot(profile.ranged ? 'ability_1' : 'primary_action')
            logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'enemy_attack')
            const result = this.combat.receiveIncomingDamage(attackDamage, attackType, postureDamage, instance.ownerObjectId)
            const source = object.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0))
            this.effects.spawnEffect(source, DAMAGE_COLORS[attackType], 0.35, 0.28)
            if (result.damage > 0 || result.absorbedByWard > 0) {
              this.effects.spawnEffect(
                avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.85, 0)),
                DAMAGE_COLORS[attackType],
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
                this.combat.getWorldPoint(object.id) ?? object.mesh.position.clone(),
                0xe3f5ff,
                0.8,
                0.34,
              )
              if (counter.killed) break
            }
            if (result.killed) break
          }
        }
      } else {
        this.setState(instance, 'pursue')
      }
    }
  }

  clear(): void {
    this.attackCooldowns.clear()
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
