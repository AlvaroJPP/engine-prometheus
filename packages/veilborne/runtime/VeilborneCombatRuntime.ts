import * as THREE from 'three'
import type { GameModuleContext } from '../../../engine/runtime/GameModule'
import { getAnimationControllerFromObject } from '../../../engine/world/AnimationController'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import {
  applyVeilborneDamage,
  applyVeilborneStatus,
  calculateVeilborneSpellDamage,
  calculateVeilborneWeaponDamage,
  createVeilborneCombatant,
  restoreVeilborneResource,
  spendVeilborneResource,
  tickVeilborneStatuses,
  VEILBORNE_DEFAULT_SPELL_SLOTS,
  VEILBORNE_RUNTIME_SPELLS,
  VEILBORNE_RUNTIME_WEAPONS,
  type VeilborneCombatant,
  type VeilborneDamageType,
  type VeilborneStatusId,
} from './VeilborneCombat'
import type { VeilborneVisualEffects } from './VeilborneVisualEffects'

export type VeilborneHostile = {
  instance: BehaviorPackageInstance
  object: NonNullable<ReturnType<GameModuleContext['world']['get']>>
}

const PACKAGE_ID = 'veilborne_rpg'

/**
 * Estado de combate do VEILBORNE, isolado do Engine Prometheus.
 * Converte variáveis persistidas dos pacotes em combatentes temporários e
 * mantém a sincronização de vida/postura entre runtime e mundo salvo.
 */
export class VeilborneCombatRuntime {
  private readonly context: GameModuleContext
  private readonly visualEffects: VeilborneVisualEffects
  private playerState: VeilborneCombatant | null = null
  private readonly targetStates = new Map<string, VeilborneCombatant>()
  private readonly statusTickTimers = new Map<string, number>()
  private readonly cooldowns = new Map<string, number>()
  private heavyChargeStartedAt: number | null = null
  private pendingCast: {
    spellId: string
    remainingSeconds: number
    targetId: string | null
    impactPosition: THREE.Vector3
  } | null = null

  constructor(context: GameModuleContext, visualEffects: VeilborneVisualEffects) {
    this.context = context
    this.visualEffects = visualEffects
  }

  isEnabled(): boolean {
    return this.context.logic.listPackages().some(
      instance => instance.enabled && instance.packageId === PACKAGE_ID,
    )
  }

  ensurePlayerVariables(): void {
    if (!this.isEnabled()) return

    const defaults: Array<[string, boolean | number | string]> = [
      ['vida', 100], ['vida_max', 100], ['eter', 100], ['eter_max', 100],
      ['vigor', 100], ['vigor_max', 100], ['postura', 0], ['postura_max', 100],
      ['forca', 10], ['destreza', 10], ['intelecto', 10], ['vontade', 10], ['resistencia', 10],
      ['res_fisica', 0], ['res_chama', 0], ['res_geada', 0], ['res_tempestade', 0],
      ['res_sangue', 0], ['res_sombra', 0], ['res_espirito', 0], ['res_arcano', 0],
      ['ecos', 0], ['nivel', 1], ['experiencia', 0], ['experiencia_proximo_nivel', 100],
      ['pontos_atributo', 0], ['arquetipo', 'custom'], ['morto', false],
      ['arma_equipada', 'starter_arcane_sword'],
      ['magia_1', VEILBORNE_DEFAULT_SPELL_SLOTS[0]],
      ['magia_2', VEILBORNE_DEFAULT_SPELL_SLOTS[1]],
      ['magia_3', VEILBORNE_DEFAULT_SPELL_SLOTS[2]],
      ['magia_4', VEILBORNE_DEFAULT_SPELL_SLOTS[3]],
      ['sigilo_1', 'ward'], ['sigilo_2', 'blast'], ['sigilo_3', 'hunter_mark'], ['sigilo_4', 'slow_field'],
      ['sigilo_selecionado', 1], ['sigilo_ativo', 'ward'],
      ['bloqueando', false], ['aparo_total', 0], ['aparo_sucesso', false],
      ['jogador_morreu', false], ['jogador_atordoado', false],
      ['alvo_travado', false], ['alvo_veilborne_id', ''],
      ['carregando_ataque', false], ['carga_ataque', 0],
      ['ward_remaining', 0], ['ward_absorption', 0],
      ['inventario_json', '[]'], ['item_use_request', ''], ['loot_notice', ''],
      ['checkpoint_id', ''], ['checkpoint_x', 0], ['checkpoint_y', 0], ['checkpoint_z', 0],
      ['ecos_perdidos', 0], ['ponto_de_morte_x', 0], ['ponto_de_morte_y', 0], ['ponto_de_morte_z', 0],
      ['morte_contagem', 0],
    ]

    for (const [name, value] of defaults) {
      if (this.context.logic.getVariable(name) === undefined) this.context.logic.setVariable(name, value)
    }
  }

  readNumber(name: string, fallback: number): number {
    const value = this.context.logic.getVariable(name)
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  readString(name: string, fallback: string): string {
    const value = this.context.logic.getVariable(name)
    return typeof value === 'string' && value.trim() ? value : fallback
  }

  getPlayerCombatant(): VeilborneCombatant {
    this.ensurePlayerVariables()
    const resources = {
      vitality: this.readNumber('vida', 100),
      maxVitality: Math.max(1, this.readNumber('vida_max', 100)),
      ether: this.readNumber('eter', 100),
      maxEther: Math.max(1, this.readNumber('eter_max', 100)),
      stamina: this.readNumber('vigor', 100),
      maxStamina: Math.max(1, this.readNumber('vigor_max', 100)),
      posture: this.readNumber('postura', 0),
      maxPosture: Math.max(1, this.readNumber('postura_max', 100)),
    }
    const player = this.playerState ?? createVeilborneCombatant('veilborne-player', resources)
    player.resources = {
      vitality: THREE.MathUtils.clamp(resources.vitality, 0, resources.maxVitality),
      maxVitality: resources.maxVitality,
      ether: THREE.MathUtils.clamp(resources.ether, 0, resources.maxEther),
      maxEther: resources.maxEther,
      stamina: THREE.MathUtils.clamp(resources.stamina, 0, resources.maxStamina),
      maxStamina: resources.maxStamina,
      posture: THREE.MathUtils.clamp(resources.posture, 0, resources.maxPosture),
      maxPosture: resources.maxPosture,
    }
    player.attributes = {
      strength: this.readNumber('forca', 10),
      dexterity: this.readNumber('destreza', 10),
      intellect: this.readNumber('intelecto', 10),
      will: this.readNumber('vontade', 10),
      resistance: this.readNumber('resistencia', 10),
    }
    player.resistances = {
      physical: this.readNumber('res_fisica', 0),
      fire: this.readNumber('res_chama', 0),
      frost: this.readNumber('res_geada', 0),
      storm: this.readNumber('res_tempestade', 0),
      blood: this.readNumber('res_sangue', 0),
      shadow: this.readNumber('res_sombra', 0),
      spirit: this.readNumber('res_espirito', 0),
      arcane: this.readNumber('res_arcano', 0),
    }
    player.alive = player.resources.vitality > 0 && this.context.logic.getVariable('morto') !== true
    this.playerState = player
    return player
  }

  syncPlayerCombatant(player: VeilborneCombatant): void {
    const { logic } = this.context
    logic.setVariable('vida', player.resources.vitality)
    logic.setVariable('eter', player.resources.ether)
    logic.setVariable('vigor', player.resources.stamina)
    logic.setVariable('postura', player.resources.posture)
    if (player.resources.vitality <= 0) logic.setVariable('morto', true)
    else if (logic.getVariable('morto') === true) logic.setVariable('morto', false)
  }

  getHostilePackages(): VeilborneHostile[] {
    const { logic, world } = this.context
    const hostiles: VeilborneHostile[] = []
    for (const instance of logic.listPackages()) {
      if (!instance.enabled || instance.packageId !== PACKAGE_ID) continue
      if (instance.variables.entity_role !== undefined && instance.variables.entity_role !== 'combatant') continue
      if (instance.variables.faction !== undefined && instance.variables.faction !== 'hostile') continue
      if (instance.variables.morto === true) continue
      if (typeof instance.variables.vida === 'number' && instance.variables.vida <= 0) continue
      const object = world.get(instance.ownerObjectId)
      if (object && world.isObjectVisible(object)) hostiles.push({ instance, object })
    }
    return hostiles
  }

  findTarget(maxRange: number): (VeilborneHostile & { distance: number }) | null {
    const playerPosition = this.context.avatar.mesh.position
    const forward = new THREE.Vector3(
      Math.sin(this.context.avatar.mesh.rotation.y),
      0,
      Math.cos(this.context.avatar.mesh.rotation.y),
    ).normalize()
    let best: (VeilborneHostile & { distance: number; score: number }) | null = null

    for (const candidate of this.getHostilePackages()) {
      const delta = candidate.object.mesh.position.clone().sub(playerPosition)
      delta.y = 0
      const distance = delta.length()
      if (distance > maxRange || distance < 0.001) continue
      const facing = forward.dot(delta.normalize())
      if (facing < -0.15) continue
      const score = distance + (1 - facing) * 1.2
      if (!best || score < best.score) best = { ...candidate, distance, score }
    }
    return best ? { instance: best.instance, object: best.object, distance: best.distance } : null
  }

  getTargetCombatant(instance: BehaviorPackageInstance): VeilborneCombatant {
    const variables = instance.variables
    const number = (name: string, fallback: number): number => {
      const value = variables[name]
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }
    const maxVitality = Math.max(1, number('vida_max', 100))
    const maxEther = Math.max(1, number('eter_max', 100))
    const maxStamina = Math.max(1, number('vigor_max', 100))
    const maxPosture = Math.max(1, number('postura_max', 100))
    const resources = {
      vitality: number('vida', maxVitality), maxVitality,
      ether: number('eter', maxEther), maxEther,
      stamina: number('vigor', maxStamina), maxStamina,
      posture: number('postura', 0), maxPosture,
    }
    const state = this.targetStates.get(instance.ownerObjectId) ??
      createVeilborneCombatant(instance.ownerObjectId, resources)
    state.resources = {
      vitality: THREE.MathUtils.clamp(resources.vitality, 0, maxVitality), maxVitality,
      ether: THREE.MathUtils.clamp(resources.ether, 0, maxEther), maxEther,
      stamina: THREE.MathUtils.clamp(resources.stamina, 0, maxStamina), maxStamina,
      posture: THREE.MathUtils.clamp(resources.posture, 0, maxPosture), maxPosture,
    }
    state.attributes = {
      strength: number('forca', 10),
      dexterity: number('destreza', 10),
      intellect: number('intelecto', 10),
      will: number('vontade', 10),
      resistance: number('resistencia', 10),
    }
    state.resistances = {
      physical: number('res_fisica', 0),
      fire: number('res_chama', 0),
      frost: number('res_geada', 0),
      storm: number('res_tempestade', 0),
      blood: number('res_sangue', 0),
      shadow: number('res_sombra', 0),
      spirit: number('res_espirito', 0),
      arcane: number('res_arcano', 0),
    }
    state.alive = state.resources.vitality > 0 && variables.morto !== true
    this.targetStates.set(instance.ownerObjectId, state)
    return state
  }

  syncTarget(instance: BehaviorPackageInstance, target: VeilborneCombatant, notify = true): void {
    const { logic, world, invalidate } = this.context
    logic.setPackageVariable(instance.id, 'vida', target.resources.vitality)
    logic.setPackageVariable(instance.id, 'postura', target.resources.posture)
    if (target.resources.vitality <= 0) {
      logic.setPackageVariable(instance.id, 'morto', true)
      target.alive = false
    }
    if (notify) {
      world.events.emit('behaviorPackageChanged', { ownerObjectId: instance.ownerObjectId })
      invalidate()
    }
  }


  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.context.isRuntimeActive() || !this.isEnabled()) return false
    const bindings = this.context.getControlBindings()
    const combatActions = [
      bindings.primaryAction, bindings.secondaryAction,
      bindings.ability1, bindings.ability2, bindings.ability3, bindings.ability4,
    ]
    if (this.context.avatar.isCombatStaggered()) return combatActions.includes(event.code)
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
    if (!this.context.isRuntimeActive() || !this.isEnabled() || this.context.avatar.isCombatStaggered()) return
    const duration = Math.max(0, performance.now() / 1000 - startedAt)
    this.performWeaponAttack(true, 1 + Math.min(1.5, duration * 0.75))
  }

  handleInputBlur(): void {
    this.heavyChargeStartedAt = null
    this.pendingCast = null
    this.context.logic.setVariable('carregando_ataque', false)
    this.context.logic.setVariable('carga_ataque', 0)
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
    const player = this.getPlayerCombatant()
    if (player.alive) {
      restoreVeilborneResource(player, 'stamina', 16 * step)
      restoreVeilborneResource(player, 'ether', 1.6 * step)
      player.resources.posture = Math.max(0, player.resources.posture - 8 * step)
      this.syncPlayerCombatant(player)
    }
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

    let remainingDamage = Math.max(0, Number.isFinite(amount) ? amount : 0)
    const resistance = THREE.MathUtils.clamp(player.resistances[type] ?? 0, -100, 95)
    remainingDamage *= 1 - resistance / 100

    const wardValue = this.readNumber('ward_absorption', 0)
    const absorbedByWard = Math.min(Math.max(0, wardValue), remainingDamage)
    if (absorbedByWard > 0) {
      remainingDamage -= absorbedByWard
      this.context.logic.setVariable('ward_absorption', Math.max(0, wardValue - absorbedByWard))
      this.visualEffects.spawnEffect(
        this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
        0x9b80ff,
        0.42,
        0.24,
      )
      if (wardValue - absorbedByWard <= 0) this.context.logic.setVariable('ward_remaining', 0)
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
      this.context.avatar.setCombatStagger(0.85)
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
      this.context.logic.setVariable('jogador_morreu', true)
      this.context.logic.setVariable('bloqueando', false)
      this.context.logic.setVariable('carregando_ataque', false)
      this.context.logic.setVariable('carga_ataque', 0)
      this.heavyChargeStartedAt = null
      this.pendingCast = null
      this.context.logic.setVariable('morte_contagem', 0)
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
      const hit = this.applyHit(
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
    const center = target ? target.object.mesh.position.clone() : pending.impactPosition.clone()
    this.visualEffects.spawnEffect(
      center.clone().add(new THREE.Vector3(0, 0.55, 0)),
      spell.visualColor,
      spell.radius > 0 ? Math.max(0.45, spell.radius * 0.45) : 0.45,
      0.42,
    )
    const candidates = spell.targeting === 'area' && spell.radius > 0
      ? this.getHostilePackages().filter(candidate =>
        Math.hypot(candidate.object.mesh.position.x - center.x, candidate.object.mesh.position.z - center.z) <= spell.radius,
      )
      : target ? [target] : []

    let totalDamage = 0
    for (const candidate of candidates) {
      const result = this.applyHit(
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

  private applyHit(
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

  private handleDefeatedTarget(instance: BehaviorPackageInstance): void {
    const object = this.context.world.get(instance.ownerObjectId)
    const controller = object ? getAnimationControllerFromObject(object.mesh) : undefined
    if (controller?.playOneShot('death', true, true)) {
      object!.mesh.userData.veilborneDeathAnimation = true
    } else if (controller?.actions.has('prone')) {
      controller.setState('prone', true)
    } else if (object) {
      object.mesh.userData.veilborneDeathFallback = true
      object.mesh.traverse(node => {
        const renderable = node as THREE.Mesh
        if (!renderable.isMesh || !renderable.material) return
        const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
        for (const material of materials) {
          if ('color' in material && material.color instanceof THREE.Color) material.color.lerp(new THREE.Color(0x5b343b), 0.48)
          if ('emissive' in material && material.emissive instanceof THREE.Color) material.emissive.set(0x24080d)
        }
      })
    }
    this.context.logic.setPackageVariable(instance.id, 'ai_state', 'dead')
    this.context.world.events.emit('behaviorPackageChanged', { ownerObjectId: instance.ownerObjectId })
    this.awardKillReward(instance)
    this.targetStates.delete(instance.ownerObjectId)
    this.context.logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'enemy_killed')
    this.context.invalidate()
  }

  private awardKillReward(instance: BehaviorPackageInstance): void {
    const profiles: Record<string, { echoes: number; experience: number }> = {
      melee: { echoes: 10, experience: 15 },
      ranged_caster: { echoes: 12, experience: 18 },
      flanker: { echoes: 14, experience: 20 },
      guard_breaker: { echoes: 22, experience: 40 },
      boss_phases: { echoes: 100, experience: 150 },
    }
    const profile = typeof instance.variables.ai_profile === 'string' ? instance.variables.ai_profile.trim().toLowerCase() : 'melee'
    const automatic = profiles[profile] ?? profiles.melee!
    const readReward = (name: string, fallback: number): number => {
      const value = instance.variables[name]
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
    }
    const echoes = readReward('eco_reward', automatic.echoes)
    const rewardExperience = readReward('xp_reward', automatic.experience)
    if (echoes > 0) this.context.logic.setVariable('ecos', Math.max(0, this.readNumber('ecos', 0)) + echoes)

    let level = Math.max(1, Math.floor(this.readNumber('nivel', 1)))
    let experience = Math.max(0, this.readNumber('experiencia', 0)) + rewardExperience
    let attributePoints = Math.max(0, Math.floor(this.readNumber('pontos_atributo', 0)))
    const thresholdForLevel = (currentLevel: number): number => Math.max(100, Math.floor(100 * Math.pow(currentLevel, 1.22)))
    let threshold = thresholdForLevel(level)
    let levelsGained = 0
    while (experience >= threshold && level < 999) {
      experience -= threshold
      level += 1
      levelsGained += 1
      attributePoints += 1
      threshold = thresholdForLevel(level)
    }
    this.context.logic.setVariable('nivel', level)
    this.context.logic.setVariable('experiencia', experience)
    this.context.logic.setVariable('experiencia_proximo_nivel', threshold)
    this.context.logic.setVariable('pontos_atributo', attributePoints)
    if (levelsGained > 0) {
      this.context.logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'level_up')
      this.visualEffects.spawnEffect(this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 0xe9bf75, 1.2, 0.7)
      this.context.invalidate()
    }
  }

  private readTargetPosture(instance: BehaviorPackageInstance): number {
    const value = instance.variables.postura
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  private readTargetPostureMax(instance: BehaviorPackageInstance): number {
    const value = instance.variables.postura_max
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 100
  }

  private getWorldPoint(objectId: string): THREE.Vector3 | null {
    const object = this.context.world.get(objectId)
    if (!object) return null
    const point = object.mesh.getWorldPosition(new THREE.Vector3())
    point.y += 0.65
    return point
  }

  tickHostileStatuses(dt: number): void {
    const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1))
    const activeIds = new Set<string>()
    for (const { instance } of this.getHostilePackages()) {
      activeIds.add(instance.ownerObjectId)
      const target = this.getTargetCombatant(instance)
      if (!target.alive) continue
      const statusesBeforeTick = target.statuses.map(status => ({ ...status }))
      for (const status of statusesBeforeTick) {
        if (status.id !== 'burn' && status.id !== 'bleed' && status.id !== 'poison') continue
        const key = instance.ownerObjectId + ':' + status.id
        let timer = (this.statusTickTimers.get(key) ?? 0) + step
        while (timer >= 1 && target.alive) {
          const type: VeilborneDamageType = status.id === 'burn' ? 'fire' : status.id === 'bleed' ? 'blood' : 'shadow'
          applyVeilborneDamage(target, { amount: status.potency * Math.max(1, status.stacks), type })
          timer -= 1
        }
        this.statusTickTimers.set(key, timer)
      }
      const statusIds = new Set(statusesBeforeTick.map(status => status.id))
      tickVeilborneStatuses(target, step)
      for (const statusId of statusIds) {
        if (!target.statuses.some(status => status.id === statusId)) {
          this.statusTickTimers.delete(instance.ownerObjectId + ':' + statusId)
        }
      }
      const wasAlive = instance.variables.morto !== true &&
        (typeof instance.variables.vida !== 'number' || instance.variables.vida > 0)
      this.syncTarget(instance, target, false)
      if (wasAlive && !target.alive) {
        this.context.logic.setPackageVariable(instance.id, 'ai_state', 'dead')
        this.awardKillReward(instance)
        this.targetStates.delete(instance.ownerObjectId)
        this.context.logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'enemy_killed')
      }
    }
    for (const id of this.targetStates.keys()) {
      if (!activeIds.has(id)) this.targetStates.delete(id)
    }
  }

  resetRuntimeState(): void {
    this.playerState = null
    this.targetStates.clear()
    this.statusTickTimers.clear()
    this.cooldowns.clear()
    this.heavyChargeStartedAt = null
    this.pendingCast = null
  }
}
