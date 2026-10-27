import * as THREE from 'three'
import type { GameModuleContext } from '../../../engine/runtime/GameModule'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import {
  applyVeilborneDamage,
  createVeilborneCombatant,
  tickVeilborneStatuses,
  type VeilborneCombatant,
  type VeilborneDamageType,
} from './VeilborneCombat'
import { VEILBORNE_DEFAULT_SPELL_SLOTS } from './VeilborneCombat'

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
  private playerState: VeilborneCombatant | null = null
  private readonly targetStates = new Map<string, VeilborneCombatant>()
  private readonly statusTickTimers = new Map<string, number>()

  constructor(context: GameModuleContext) {
    this.context = context
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
      this.syncTarget(instance, target, false)
    }
    for (const id of this.targetStates.keys()) {
      if (!activeIds.has(id)) this.targetStates.delete(id)
    }
  }

  resetRuntimeState(): void {
    this.playerState = null
    this.targetStates.clear()
    this.statusTickTimers.clear()
  }
}
