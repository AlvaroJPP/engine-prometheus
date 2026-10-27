import * as THREE from 'three'
import { getAnimationControllerFromObject } from '../../../engine/world/AnimationController'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import {
  applyVeilborneDamage,
  applyVeilborneStatus,
  calculateVeilborneSpellDamage,
  calculateVeilborneWeaponDamage,
  restoreVeilborneResource,
  spendVeilborneResource,
  VEILBORNE_DEFAULT_SPELL_SLOTS,
  VEILBORNE_RUNTIME_SPELLS,
  VEILBORNE_RUNTIME_WEAPONS,
  VeilborneDamageType,
  VeilborneStatusId,
} from './VeilborneCombat'

import { VeilborneCombatRuntimeBase } from './VeilborneCombatRuntimeBase'

export type { VeilborneHostile } from './VeilborneCombatRuntimeBase'

export class VeilborneCombatRuntime extends VeilborneCombatRuntimeBase {
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.context.isRuntimeActive() || !this.isEnabled()) return false
    const bindings = this.context.getControlBindings()
    const combatActions = [
      bindings.primaryAction, bindings.secondaryAction,
      bindings.ability1, bindings.ability2, bindings.ability3, bindings.ability4,
    ]
    if (this.playerStaggerRemaining > 0 || this.context.avatar.isActionLocked()) return combatActions.includes(event.code)
    if (event.code === bindings.useItem) {
      this.activateSigil()
      return true
    }
    if (event.code === bindings.reload) {
      this.cycleSigil()
      return true
    }
    if (event.code === bindings.primaryAction) {
      this.performWeaponAttack(false)
      return true
    }
    if (event.code === bindings.secondaryAction) {
      this.beginHeavyCharge()
      return true
    }
    const abilitySlots = [bindings.ability1, bindings.ability2, bindings.ability3, bindings.ability4]
    const slotIndex = abilitySlots.indexOf(event.code)
    if (slotIndex >= 0) {
      this.beginSpellCast(slotIndex)
      return true
    }
    return false
  }

  handleKeyUp(event: KeyboardEvent): void {
    const bindings = this.context.getControlBindings()
    if (event.code !== bindings.secondaryAction || this.heavyChargeStartedAt === null) return
    const startedAt = this.heavyChargeStartedAt
    this.heavyChargeStartedAt = null
    if (this.context.logic.getVariable('carregando_ataque') !== undefined) {
      this.context.logic.setVariable('carregando_ataque', false)
    }
    if (this.context.logic.getVariable('carga_ataque') !== undefined) {
      this.context.logic.setVariable('carga_ataque', 0)
    }
    if (!this.context.isRuntimeActive() || !this.isEnabled() || this.playerStaggerRemaining > 0 || this.context.avatar.isActionLocked()) return
    const duration = Math.max(0, performance.now() / 1000 - startedAt)
    this.performWeaponAttack(true, 1 + Math.min(1.5, duration * 0.75))
  }

  handleInputBlur(): void {
    this.heavyChargeStartedAt = null
    this.pendingCast = null
    this.parryStartedAt = Number.NEGATIVE_INFINITY
    this.parrySuccessRemaining = 0
    if (!this.isEnabled()) return

    // Evita manter stagger e bloqueio de ações depois que a janela perde foco.
    this.playerStaggerRemaining = 0
    this.context.avatar.setActionLock(0)
    const { logic } = this.context
    if (logic.getVariable('jogador_atordoado') !== undefined) logic.setVariable('jogador_atordoado', false)
    if (logic.getVariable('carregando_ataque') !== undefined) logic.setVariable('carregando_ataque', false)
    if (logic.getVariable('carga_ataque') !== undefined) logic.setVariable('carga_ataque', 0)
    if (logic.getVariable('bloqueando') !== undefined) logic.setVariable('bloqueando', false)
    if (logic.getVariable('aparo_sucesso') !== undefined) logic.setVariable('aparo_sucesso', false)
  }

  update(dt: number): void {
    this.visualEffects.update(dt)
    for (const [key, remaining] of this.cooldowns) {
      const next = Math.max(0, remaining - Math.max(0, Number.isFinite(dt) ? dt : 0))
      if (next <= 0) this.cooldowns.delete(key)
      else this.cooldowns.set(key, next)
    }
    if (!this.context.isRuntimeActive() || !this.isEnabled()) return

    this.ensurePlayerVariables()
    const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1))
    if (this.pendingCast) {
      this.pendingCast.remainingSeconds -= step
      if (this.pendingCast.remainingSeconds <= 0) this.resolveSpellCast()
    }
    if (this.heavyChargeStartedAt !== null) {
      const charge = THREE.MathUtils.clamp(performance.now() / 1000 - this.heavyChargeStartedAt, 0, 2) / 2
      this.context.logic.setVariable('carga_ataque', charge)
    }
    if (this.playerStaggerRemaining > 0) {
      this.playerStaggerRemaining = Math.max(0, this.playerStaggerRemaining - step)
      if (this.playerStaggerRemaining <= 0 && this.context.logic.getVariable('jogador_atordoado') !== undefined) {
        this.context.logic.setVariable('jogador_atordoado', false)
      }
    }
    if (this.parrySuccessRemaining > 0) {
      this.parrySuccessRemaining = Math.max(0, this.parrySuccessRemaining - step)
      if (this.parrySuccessRemaining <= 0 && this.context.logic.getVariable('aparo_sucesso') === true) {
        this.context.logic.setVariable('aparo_sucesso', false)
      }
    }
    const player = this.getPlayerCombatant()
    if (player.alive) {
      restoreVeilborneResource(player, 'stamina', 16 * step)
      restoreVeilborneResource(player, 'ether', 1.6 * step)
      player.resources.posture = Math.max(0, player.resources.posture - 8 * step)
      this.syncPlayerCombatant(player)
    }
    this.updateActiveSigils(step)
    this.updateWard(step)
    this.tickHostileStatuses(step)
  }


  receiveIncomingDamage(
    amount: number,
    type: VeilborneDamageType = 'physical',
    postureDamage = 0,
    attackerObjectId?: string,
  ): { damage: number; absorbedByWard: number; blocked: boolean; parried: boolean; killed: boolean } {
    if (!this.context.isRuntimeActive() || !this.isEnabled()) {
      return {
        damage: Math.max(0, Number.isFinite(amount) ? amount : 0),
        absorbedByWard: 0,
        blocked: false,
        parried: false,
        killed: false,
      }
    }

    const player = this.getPlayerCombatant()
    if (!player.alive) return { damage: 0, absorbedByWard: 0, blocked: false, parried: false, killed: true }

    const now = performance.now() / 1000
    if (now - this.parryStartedAt >= 0 && now - this.parryStartedAt <= 0.2) {
      this.parryStartedAt = Number.NEGATIVE_INFINITY
      this.parrySuccessRemaining = 0.55
      player.resources.posture = Math.max(0, player.resources.posture - Math.max(18, postureDamage * 2))
      restoreVeilborneResource(player, 'stamina', 12)
      this.syncPlayerCombatant(player)
      this.context.logic.setVariable('aparo_sucesso', true)
      this.context.logic.setVariable('aparo_total', Math.max(0, this.readNumber('aparo_total', 0)) + 1)
      if (attackerObjectId) {
        const attackerPackage = this.context.logic.listPackages(attackerObjectId).find(item => item.packageId === PACKAGE_ID)
        if (attackerPackage) this.context.logic.triggerPackageEvent(attackerObjectId, PACKAGE_ID, 'parry_success')
      }
      this.visualEffects.spawnEffect(
        this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.05, 0)),
        0xe3f5ff,
        1.05,
        0.42,
      )
      this.context.invalidate()
      return { damage: 0, absorbedByWard: 0, blocked: false, parried: true, killed: false }
    }

    let remainingDamage = Math.max(0, Number.isFinite(amount) ? amount : 0)
    const resistance = THREE.MathUtils.clamp(player.resistances[type] ?? 0, -100, 95)
    remainingDamage *= 1 - resistance / 100

    const wardValue = Math.max(this.wardAbsorption, this.readNumber('ward_absorption', 0))
    const absorbedByWard = Math.min(Math.max(0, wardValue), remainingDamage)
    if (absorbedByWard > 0) {
      remainingDamage -= absorbedByWard
      this.wardAbsorption = Math.max(0, wardValue - absorbedByWard)
      this.context.logic.setVariable('ward_absorption', this.wardAbsorption)
      this.visualEffects.spawnEffect(
        this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
        0x9b80ff,
        0.42,
        0.24,
      )
      if (this.wardAbsorption <= 0) this.clearWard()
    }

    let blocked = false
    let actualPostureDamage = Math.max(0, Number.isFinite(postureDamage) ? postureDamage : 0)
    if (this.context.logic.getVariable('bloqueando') === true && remainingDamage > 0 &&
      spendVeilborneResource(player, 'stamina', 12)) {
      blocked = true
      remainingDamage *= 0.35
      actualPostureDamage *= 0.4
    }

    const previousVitality = player.resources.vitality
    player.resources.vitality = Math.max(0, previousVitality - remainingDamage)
    player.resources.posture = Math.min(
      player.resources.maxPosture,
      player.resources.posture + actualPostureDamage,
    )
    player.alive = player.resources.vitality > 0
    const postureBroken = player.alive && player.resources.posture >= player.resources.maxPosture
    if (postureBroken) {
      player.resources.posture = 0
      this.resetCombatInputs()
      this.playerStaggerRemaining = 0.85
      this.context.avatar.setActionLock(0.85)
      this.context.logic.setVariable('jogador_atordoado', true)
      this.visualEffects.spawnEffect(
        this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)),
        0xffb26b,
        0.9,
        0.4,
      )
    }

    const damage = previousVitality - player.resources.vitality
    this.syncPlayerCombatant(player)
    if (!player.alive) {
      const deathWasHandled = this.context.logic.getVariable('jogador_morreu') === true
      this.context.logic.setVariable('jogador_morreu', true)
      this.resetCombatInputs()
      this.context.logic.setVariable('morte_contagem', 0)
      if (!deathWasHandled) this.onPlayerDeath?.()
    }

    if (attackerObjectId) {
      const attackerPackage = this.context.logic.listPackages(attackerObjectId).find(item => item.packageId === PACKAGE_ID)
      if (attackerPackage) this.context.logic.triggerPackageEvent(attackerObjectId, PACKAGE_ID, 'player_hit')
    }
    if (blocked) {
      this.visualEffects.spawnEffect(
        this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
        0xb0d9ff,
        0.55,
        0.25,
      )
    }
    this.context.invalidate()
    return { damage, absorbedByWard, blocked, parried: false, killed: !player.alive }
  }

  private beginHeavyCharge(): void {
    if (this.heavyChargeStartedAt !== null || (this.cooldowns.get('attack:heavy') ?? 0) > 0) return
    if (!this.getPlayerCombatant().alive) return
    this.heavyChargeStartedAt = performance.now() / 1000
    this.context.logic.setVariable('carregando_ataque', true)
    this.context.logic.setVariable('carga_ataque', 0)
  }

  private performWeaponAttack(heavy: boolean, chargedMultiplier = 1): void {
    const player = this.getPlayerCombatant()
    if (!player.alive) return
    const weaponId = this.readString('arma_equipada', 'starter_arcane_sword')
    const weapon = VEILBORNE_RUNTIME_WEAPONS[weaponId] ?? VEILBORNE_RUNTIME_WEAPONS.starter_arcane_sword!
    const cooldownKey = heavy ? 'attack:heavy' : 'attack:quick'
    if ((this.cooldowns.get(cooldownKey) ?? 0) > 0) return
    const chargeScale = heavy ? Math.max(1, Math.min(2.5, chargedMultiplier)) : 1
    const cost = weapon.staminaCost * (heavy ? 1.65 + (chargeScale - 1) * 0.4 : 1)
    if (!spendVeilborneResource(player, 'stamina', cost)) return

    const target = this.findTarget(weapon.range)
    const targetPosture = target ? this.readTargetPosture(target.instance) : 0
    const targetPostureMax = target ? this.readTargetPostureMax(target.instance) : 100
    const damage = calculateVeilborneWeaponDamage(weapon, player.attributes, {
      heavy,
      chargedMultiplier: chargeScale,
      critical: !!target && target.instance.variables.morto !== true && targetPosture >= targetPostureMax * 0.72,
    })
    const playerController = getAnimationControllerFromObject(this.context.avatar.mesh)
    if (playerController) playerController.playOneShot(heavy ? 'secondary_action' : 'primary_action')
    this.cooldowns.set(cooldownKey, heavy ? 0.62 + (chargeScale - 1) * 0.12 : 1.5)
    this.syncPlayerCombatant(player)

    const position = target
      ? this.getWorldPoint(target.object.id) ?? target.object.mesh.position.clone()
      : this.context.avatar.mesh.position.clone().add(
        new THREE.Vector3(
          Math.sin(this.context.avatar.mesh.rotation.y),
          0.9,
          Math.cos(this.context.avatar.mesh.rotation.y),
        ).multiplyScalar(Math.min(weapon.range * 0.7, 1.8)),
      )
    this.visualEffects.spawnEffect(position, weapon.damageType === 'arcane' ? 0x9c77ff : 0xd3d8e8, heavy ? 0.95 : 0.7, 0.24, true)
    if (target) {
      const hit = this.applyDamageToTarget(
        target.instance,
        damage,
        weapon.damageType,
        weapon.postureDamage * (heavy ? 1.6 + (chargeScale - 1) * 0.35 : 1),
      )
      if (hit.damage > 0) this.visualEffects.spawnEffect(position, 0xffd09a, 0.35 + Math.min(0.5, hit.damage / 100), 0.28)
    }
    this.context.invalidate()
  }

  private beginSpellCast(slotIndex: number): void {
    const player = this.getPlayerCombatant()
    if (!player.alive || this.pendingCast) return
    const slotName = 'magia_' + (slotIndex + 1)
    const defaultSpellId = VEILBORNE_DEFAULT_SPELL_SLOTS[slotIndex] ?? 'arcane_bolt'
    const spellId = this.readString(slotName, defaultSpellId)
    const spell = VEILBORNE_RUNTIME_SPELLS[spellId] ?? VEILBORNE_RUNTIME_SPELLS[defaultSpellId]!
    const cooldownKey = 'spell:' + spell.id
    if ((this.cooldowns.get(cooldownKey) ?? 0) > 0) return
    if (!spendVeilborneResource(player, 'ether', spell.etherCost)) return

    const target = this.findTarget(spell.range)
    const forward = new THREE.Vector3(
      Math.sin(this.context.avatar.mesh.rotation.y), 0, Math.cos(this.context.avatar.mesh.rotation.y),
    ).normalize()
    const impactPosition = target
      ? target.object.mesh.position.clone()
      : this.context.avatar.mesh.position.clone().addScaledVector(forward, Math.min(spell.range * 0.45, 7))
    impactPosition.y += 0.7
    const origin = this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.05, 0))
    const projectileDuration = spell.targeting === 'projectile'
      ? Math.max(spell.castTimeSeconds, origin.distanceTo(impactPosition) / Math.max(1, spell.projectileSpeed ?? 24))
      : spell.castTimeSeconds
    this.pendingCast = {
      spellId: spell.id,
      remainingSeconds: projectileDuration,
      targetId: target?.object.id ?? null,
      impactPosition,
    }
    this.cooldowns.set(cooldownKey, spell.cooldownSeconds)
    this.syncPlayerCombatant(player)
    if (spell.targeting === 'projectile') {
      this.visualEffects.spawnProjectile(origin, impactPosition, spell.visualColor, projectileDuration)
    } else {
      this.visualEffects.spawnEffect(origin, spell.visualColor, 0.32, Math.max(0.2, spell.castTimeSeconds + 0.08))
    }
    if (projectileDuration <= 0) this.resolveSpellCast()
  }

  private resolveSpellCast(): void {
    const pending = this.pendingCast
    this.pendingCast = null
    if (!pending) return
    const spell = VEILBORNE_RUNTIME_SPELLS[pending.spellId]
    if (!spell) return
    const player = this.getPlayerCombatant()
    if (!player.alive) return

    if (spell.id === 'blink_step') {
      const origin = this.context.avatar.mesh.position.clone()
      const forward = new THREE.Vector3(
        Math.sin(this.context.avatar.mesh.rotation.y), 0, Math.cos(this.context.avatar.mesh.rotation.y),
      ).normalize()
      const rayOrigin = origin.clone().add(new THREE.Vector3(0, 0.8, 0))
      const raycaster = new THREE.Raycaster(rayOrigin, forward, 0, spell.range)
      const roots = this.context.world.list().map(object => object.mesh)
      const firstHit = raycaster.intersectObjects(roots, true).find(hit => hit.distance > 0.12)
      const travel = Math.max(0, Math.min(spell.range, firstHit ? firstHit.distance - 0.75 : spell.range))
      if (travel > 0.4) {
        this.context.avatar.mesh.position.addScaledVector(forward, travel)
        this.context.avatar.resetVerticalState()
        this.visualEffects.spawnEffect(origin.add(new THREE.Vector3(0, 0.65, 0)), spell.visualColor, 0.48, 0.38)
        this.visualEffects.spawnEffect(this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.65, 0)), spell.visualColor, 0.62, 0.42)
      }
      this.context.invalidate()
      return
    }

    const target = pending.targetId
      ? this.getHostilePackages().find(candidate => candidate.object.id === pending.targetId)
      : undefined
    const targetStillAtImpact = Boolean(target && (
      spell.targeting !== 'projectile'
      || Math.hypot(
        target.object.mesh.position.x - pending.impactPosition.x,
        target.object.mesh.position.z - pending.impactPosition.z,
      ) <= Math.max(1.35, spell.radius)
    ))
    const center = target && targetStillAtImpact ? target.object.mesh.position.clone() : pending.impactPosition.clone()
    this.visualEffects.spawnEffect(
      center.clone().add(new THREE.Vector3(0, 0.55, 0)),
      spell.visualColor,
      spell.radius > 0 ? Math.max(0.45, spell.radius * 0.45) : 0.45,
      0.42,
    )
    const candidates = spell.radius > 0
      ? this.getHostilePackages().filter(candidate =>
        Math.hypot(candidate.object.mesh.position.x - center.x, candidate.object.mesh.position.z - center.z) <= spell.radius,
      )
      : target && targetStillAtImpact ? [target] : []

    let totalDamage = 0
    for (const candidate of candidates) {
      const result = this.applyDamageToTarget(
        candidate.instance,
        calculateVeilborneSpellDamage(spell, player.attributes),
        spell.damageType,
        spell.postureDamage ?? 0,
        spell.statusEffect
          ? { id: spell.statusEffect, potency: spell.statusPotency ?? 1, durationSeconds: spell.statusDurationSeconds ?? 2 }
          : undefined,
      )
      totalDamage += result.damage
      const point = this.getWorldPoint(candidate.object.id)
      if (point) this.visualEffects.spawnEffect(point, spell.visualColor, 0.34, 0.3)
    }
    if (spell.id === 'blood_siphon' && totalDamage > 0) {
      restoreVeilborneResource(player, 'vitality', totalDamage * 0.55)
      this.syncPlayerCombatant(player)
    }
    this.context.invalidate()
  }

  applyDamageToTarget(
    instance: BehaviorPackageInstance,
    amount: number,
    damageType: VeilborneDamageType,
    postureDamage: number,
    status?: { id: VeilborneStatusId; potency: number; durationSeconds: number },
  ): { damage: number; killed: boolean } {
    const target = this.getTargetCombatant(instance)
    if (!target.alive) return { damage: 0, killed: true }
    const marked = target.statuses.some(item => item.id === 'marked')
    const result = applyVeilborneDamage(target, {
      amount: marked ? amount * 1.2 : amount,
      type: damageType,
      postureDamage,
    })
    if (status && target.alive) {
      applyVeilborneStatus(target, {
        id: status.id,
        potency: status.potency,
        remainingSeconds: status.durationSeconds,
        stacks: 1,
      })
    }
    if (result.postureBroken && target.alive) {
      target.resources.posture = 0
      applyVeilborneStatus(target, {
        id: 'stagger',
        potency: 1,
        remainingSeconds: 1.15,
        stacks: 1,
      })
    }
    this.syncTarget(instance, target)
    const hitObject = this.context.world.get(instance.ownerObjectId)
    if (result.vitalityDamage > 0 && hitObject) {
      const hitPoint = this.getWorldPoint(instance.ownerObjectId) ?? hitObject.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0))
      this.visualEffects.spawnDamageNumber(hitPoint, result.vitalityDamage, result.killed)
      this.visualEffects.spawnEffect(hitPoint, result.killed ? 0xffd7a0 : 0xff4358, result.killed ? 0.72 : 0.46, 0.34)
    }
    if (result.postureBroken && !result.killed) {
      this.context.logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'posture_broken')
    }
    if (result.killed) this.handleDefeatedTarget(instance)
    return { damage: result.vitalityDamage, killed: result.killed }
  }

}
