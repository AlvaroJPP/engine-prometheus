import * as THREE from 'three'
import type { GameModuleContext } from '../../../engine/runtime/GameModule'
import { getAnimationControllerFromObject } from '../../../engine/world/AnimationController'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import {
  applyVeilborneDamage,
  applyVeilborneStatus,
  createVeilborneCombatant,
  spendVeilborneResource,
  tickVeilborneStatuses,
  VEILBORNE_DEFAULT_SPELL_SLOTS,
  VEILBORNE_RUNTIME_SIGILS,
  VeilborneCombatant,
  VeilborneDamageType,
} from './VeilborneCombat'
import { createVeilborneSigilVisual, createVeilborneWardMesh, disposeVeilborneVisual } from './VeilborneSigilVisuals'
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
export class VeilborneCombatRuntimeBase {
  protected readonly context: GameModuleContext
  protected readonly visualEffects: VeilborneVisualEffects
  protected playerState: VeilborneCombatant | null = null
  protected readonly targetStates = new Map<string, VeilborneCombatant>()
  protected readonly statusTickTimers = new Map<string, number>()
  protected readonly cooldowns = new Map<string, number>()
  protected heavyChargeStartedAt: number | null = null
  protected onPlayerDeath: (() => void) | null = null
  protected onEnemyKilled: ((instance: BehaviorPackageInstance) => void) | null = null
  protected playerStaggerRemaining = 0
  protected parryStartedAt = Number.NEGATIVE_INFINITY
  protected parrySuccessRemaining = 0
  protected wardMesh: THREE.Mesh | null = null
  protected wardRemainingSeconds = 0
  protected wardAbsorption = 0
  protected sigilSequence = 0
  protected readonly activeSigils = new Map<string, {
    profileId: string
    position: THREE.Vector3
    visual: THREE.Group
    remainingSeconds: number
    triggeredObjectIds: Set<string>
  }>()
  protected pendingCast: {
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
    const lockedId = this.context.logic.getVariable('alvo_veilborne_id')
    if (this.context.logic.getVariable('alvo_travado') === true && typeof lockedId === 'string' && lockedId) {
      const locked = this.getHostilePackages().find(candidate => candidate.object.id === lockedId)
      if (locked) {
        const distance = Math.hypot(
          locked.object.mesh.position.x - playerPosition.x,
          locked.object.mesh.position.z - playerPosition.z,
        )
        if (distance <= maxRange) return { ...locked, distance }
        return null
      }
    }
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



  setPlayerDeathHandler(handler: (() => void) | null): void {
    this.onPlayerDeath = handler
  }

  setEnemyKilledHandler(handler: ((instance: BehaviorPackageInstance) => void) | null): void {
    this.onEnemyKilled = handler
  }

  admitManeuver(kind: 'dodge' | 'slide' | 'roll'): boolean {
    if (!this.context.isRuntimeActive() || !this.isEnabled()) return true
    if (this.playerStaggerRemaining > 0 || this.context.avatar.isActionLocked()) return false
    const player = this.getPlayerCombatant()
    if (!player.alive) return false
    const cost = kind === 'dodge' ? 22 : kind === 'roll' ? 30 : 24
    if (!spendVeilborneResource(player, 'stamina', cost)) return false
    this.syncPlayerCombatant(player)
    return true
  }

  setBlocking(active: boolean): void {
    if (!this.isEnabled() || !this.context.isRuntimeActive()) {
      if (this.context.logic.getVariable('bloqueando') !== undefined) this.context.logic.setVariable('bloqueando', false)
      return
    }
    if (active && (!this.getPlayerCombatant().alive || this.playerStaggerRemaining > 0 || this.context.avatar.isActionLocked())) return
    this.context.logic.setVariable('bloqueando', active)
    if (active) {
      this.context.logic.setVariable('aparo_sucesso', false)
      this.context.invalidate()
    }
  }

  beginParry(): void {
    if (!this.context.isRuntimeActive() || !this.isEnabled()) return
    const player = this.getPlayerCombatant()
    if (!player.alive || this.playerStaggerRemaining > 0 || this.context.avatar.isActionLocked()) return
    if (!spendVeilborneResource(player, 'stamina', 14)) return
    this.syncPlayerCombatant(player)
    this.parryStartedAt = performance.now() / 1000
    this.parrySuccessRemaining = 0
    this.context.logic.setVariable('aparo_sucesso', false)
    this.visualEffects.spawnEffect(
      this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.05, 0)),
      0xb0d9ff,
      0.35,
      0.2,
    )
    this.context.invalidate()
  }

  resetCombatInputs(): void {
    this.heavyChargeStartedAt = null
    this.pendingCast = null
    this.parryStartedAt = Number.NEGATIVE_INFINITY
    this.parrySuccessRemaining = 0
    const { logic } = this.context
    if (logic.getVariable('carregando_ataque') !== undefined) logic.setVariable('carregando_ataque', false)
    if (logic.getVariable('carga_ataque') !== undefined) logic.setVariable('carga_ataque', 0)
    if (logic.getVariable('bloqueando') !== undefined) logic.setVariable('bloqueando', false)
    if (logic.getVariable('aparo_sucesso') !== undefined) logic.setVariable('aparo_sucesso', false)
  }

  cycleSigil(): void {
    if (!this.isEnabled()) return
    this.ensurePlayerVariables()
    const current = Math.round(this.readNumber('sigilo_selecionado', 1))
    const next = current >= 4 || current < 1 ? 1 : current + 1
    const selected = this.readString('sigilo_' + next, 'ward')
    this.context.logic.setVariable('sigilo_selecionado', next)
    this.context.logic.setVariable('sigilo_ativo', selected)
    this.visualEffects.spawnEffect(
      this.context.avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
      0x9b80ff,
      0.22,
      0.18,
    )
    this.context.invalidate()
  }

  activateSigil(): void {
    const player = this.getPlayerCombatant()
    if (!player.alive) return
    const sigilId = this.readString('sigilo_ativo', 'ward')
    const sigil = VEILBORNE_RUNTIME_SIGILS[sigilId] ?? VEILBORNE_RUNTIME_SIGILS.ward!
    const cooldownKey = 'sigil:' + sigil.id
    if ((this.cooldowns.get(cooldownKey) ?? 0) > 0) return

    const target = sigil.effect === 'mark' ? this.findTarget(sigil.radius) : null
    if (sigil.effect === 'mark' && !target) return
    if (!spendVeilborneResource(player, 'ether', sigil.etherCost)) return

    this.cooldowns.set(cooldownKey, sigil.cooldownSeconds)
    this.syncPlayerCombatant(player)

    if (sigil.effect === 'ward') {
      this.clearWard()
      this.wardRemainingSeconds = sigil.durationSeconds
      this.wardAbsorption = 35
      this.context.logic.setVariable('ward_remaining', this.wardRemainingSeconds)
      this.context.logic.setVariable('ward_absorption', this.wardAbsorption)
      this.wardMesh = createVeilborneWardMesh(this.context.avatar.mesh.position, sigil.visualColor)
      this.context.world.scene.add(this.wardMesh)
      this.context.invalidate()
      return
    }

    if (sigil.effect === 'mark' && target) {
      const state = this.getTargetCombatant(target.instance)
      applyVeilborneStatus(state, {
        id: 'marked',
        potency: sigil.statusPotency ?? 1.2,
        remainingSeconds: sigil.durationSeconds,
        stacks: 1,
      })
      this.syncTarget(target.instance, state)
      const point = this.getWorldPoint(target.object.id)
      if (point) this.visualEffects.spawnEffect(point, sigil.visualColor, 0.75, 0.52)
      this.context.invalidate()
      return
    }

    const forward = new THREE.Vector3(
      Math.sin(this.context.avatar.mesh.rotation.y), 0, Math.cos(this.context.avatar.mesh.rotation.y),
    ).normalize()
    const position = this.context.avatar.mesh.position.clone().addScaledVector(forward, 2.15)
    const groundY = this.context.world.terrain.heightAt(position.x, position.z)
    position.y = (Number.isFinite(groundY) ? groundY : this.context.avatar.mesh.position.y) + 0.06
    const visual = createVeilborneSigilVisual(sigil, position)
    const instanceId = 'veilborne-sigil-' + (++this.sigilSequence).toString(36)
    this.activeSigils.set(instanceId, {
      profileId: sigil.id,
      position: position.clone(),
      visual,
      remainingSeconds: sigil.durationSeconds,
      triggeredObjectIds: new Set<string>(),
    })
    this.context.world.scene.add(visual)
    this.context.invalidate()
  }

  protected updateActiveSigils(dt: number): void {
    for (const [instanceId, active] of this.activeSigils) {
      const sigil = VEILBORNE_RUNTIME_SIGILS[active.profileId]
      if (!sigil) {
        this.removeActiveSigil(instanceId, active.visual)
        continue
      }
      active.remainingSeconds -= dt
      const pulse = 0.2 + 0.11 * (0.5 + 0.5 * Math.sin((sigil.durationSeconds - active.remainingSeconds) * 5))
      active.visual.traverse(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) child.material.opacity = pulse
        else if (child instanceof THREE.LineLoop && child.material instanceof THREE.LineBasicMaterial) child.material.opacity = Math.min(1, pulse + 0.4)
      })

      const inside = this.getHostilePackages().filter(candidate =>
        Math.hypot(candidate.object.mesh.position.x - active.position.x, candidate.object.mesh.position.z - active.position.z) <= sigil.radius,
      )
      const entrants = inside.filter(candidate => !active.triggeredObjectIds.has(candidate.object.id))
      for (const candidate of entrants) active.triggeredObjectIds.add(candidate.object.id)

      if (entrants.length > 0 && sigil.trigger === 'enemy_enter') {
        if (sigil.effect === 'blast') {
          this.visualEffects.spawnEffect(
            active.position.clone().add(new THREE.Vector3(0, 0.6, 0)),
            sigil.visualColor,
            Math.max(0.7, sigil.radius * 0.8),
            0.5,
          )
          for (const candidate of inside) {
            this.applyDamageToTarget(candidate.instance, sigil.damage ?? 42, sigil.damageType ?? 'arcane', sigil.postureDamage ?? 28)
            const point = this.getWorldPoint(candidate.object.id)
            if (point) this.visualEffects.spawnEffect(point, sigil.visualColor, 0.35, 0.3)
          }
          this.removeActiveSigil(instanceId, active.visual)
          continue
        }

        if (sigil.effect === 'slow' || sigil.effect === 'silence') {
          for (const candidate of entrants) {
            const target = this.getTargetCombatant(candidate.instance)
            applyVeilborneStatus(target, {
              id: sigil.effect === 'slow' ? 'slow' : 'silence',
              potency: sigil.statusPotency ?? 1,
              remainingSeconds: Math.min(3, sigil.durationSeconds),
              stacks: 1,
            })
            this.syncTarget(candidate.instance, target)
            const point = this.getWorldPoint(candidate.object.id)
            if (point) this.visualEffects.spawnEffect(point, sigil.visualColor, 0.28, 0.25)
          }
        }
      }
      if (active.remainingSeconds <= 0) this.removeActiveSigil(instanceId, active.visual)
    }
  }

  protected removeActiveSigil(id: string, visual: THREE.Group): void {
    this.activeSigils.delete(id)
    this.context.world.scene.remove(visual)
    disposeVeilborneVisual(visual)
  }

  protected clearActiveSigils(): void {
    for (const [id, active] of this.activeSigils) this.removeActiveSigil(id, active.visual)
    this.activeSigils.clear()
  }

  protected updateWard(dt: number): void {
    if (!this.wardMesh) return
    this.wardRemainingSeconds = Math.max(0, this.wardRemainingSeconds - dt)
    this.context.logic.setVariable('ward_remaining', this.wardRemainingSeconds)
    this.wardMesh.position.copy(this.context.avatar.mesh.position).add(new THREE.Vector3(0, 0.9, 0))
    const material = this.wardMesh.material
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(this.wardRemainingSeconds * 4))
    }
    if (this.wardRemainingSeconds <= 0 || this.wardAbsorption <= 0) this.clearWard()
  }

  protected clearWard(): void {
    if (this.wardMesh) {
      this.context.world.scene.remove(this.wardMesh)
      this.wardMesh.geometry.dispose()
      const material = this.wardMesh.material
      if (Array.isArray(material)) material.forEach(item => item.dispose())
      else material.dispose()
      this.wardMesh = null
    }
    this.wardRemainingSeconds = 0
    this.wardAbsorption = 0
    if (this.context.logic.getVariable('ward_remaining') !== undefined) this.context.logic.setVariable('ward_remaining', 0)
    if (this.context.logic.getVariable('ward_absorption') !== undefined) this.context.logic.setVariable('ward_absorption', 0)
  }

  protected handleDefeatedTarget(instance: BehaviorPackageInstance): void {
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
    this.onEnemyKilled?.(instance)
    this.targetStates.delete(instance.ownerObjectId)
    this.context.logic.triggerPackageEvent(instance.ownerObjectId, PACKAGE_ID, 'enemy_killed')
    this.context.invalidate()
  }

  protected awardKillReward(instance: BehaviorPackageInstance): void {
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

  protected readTargetPosture(instance: BehaviorPackageInstance): number {
    const value = instance.variables.postura
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  protected readTargetPostureMax(instance: BehaviorPackageInstance): number {
    const value = instance.variables.postura_max
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 100
  }

  getWorldPoint(objectId: string): THREE.Vector3 | null {
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
      if (wasAlive && !target.alive) this.handleDefeatedTarget(instance)
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
    this.playerStaggerRemaining = 0
    this.parryStartedAt = Number.NEGATIVE_INFINITY
    this.parrySuccessRemaining = 0
    if (this.context.logic.getVariable('jogador_atordoado') !== undefined) this.context.logic.setVariable('jogador_atordoado', false)
    this.clearActiveSigils()
    this.clearWard()
  }
}
