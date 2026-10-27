import * as THREE from 'three'
import type { HumanoidAvatar } from '../../../engine/world/HumanoidAvatar'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { VeilborneCombatant } from './VeilborneCombat'
import type { VeilborneProgressionSystem } from './VeilborneProgressionSystem'

export interface VeilborneDeathRespawnDependencies {
  world: World
  logic: RuleEngine
  avatar: HumanoidAvatar
  progression: VeilborneProgressionSystem
  readNumber: (name: string, fallback: number) => number
  syncPlayer: (player: VeilborneCombatant) => void
  setCameraTarget: (x: number, y: number, z: number) => void
  getDefaultSpawnPosition: () => THREE.Vector3 | null
  getRespawnRemaining: () => number
  setRespawnRemaining: (seconds: number) => void
  resetCombatInputs: () => void
  clearTargetLock: () => void
  spawnEffect: (position: THREE.Vector3, color: number, scale: number, durationSeconds: number) => void
  invalidate: () => void
  setLootNoticeDuration: (seconds: number) => void
}

/** Encapsula a lógica de morte, perda de Ecos e retorno ao santuário. */
export class VeilborneDeathRespawnSystem {
  constructor(private readonly deps: VeilborneDeathRespawnDependencies) {}

  handlePlayerDeath(): void {
    const d = this.deps
    d.resetCombatInputs()
    d.logic.setVariable('jogador_morreu', true)
    d.setRespawnRemaining(2.2)
    d.logic.setVariable('morte_contagem', d.getRespawnRemaining())

    const deathPosition = d.avatar.mesh.position.clone()
    d.logic.setVariable('ponto_de_morte_x', deathPosition.x)
    d.logic.setVariable('ponto_de_morte_y', deathPosition.y)
    d.logic.setVariable('ponto_de_morte_z', deathPosition.z)

    if (d.readNumber('ecos_perdidos', 0) > 0) {
      if (d.progression.echoCacheObjectId) d.progression.removeEchoCache()
      d.logic.setVariable('ecos_perdidos', 0)
    }
    const echoes = Math.max(0, Math.floor(d.readNumber('ecos', 0)))
    if (echoes > 0) {
      d.logic.setVariable('ecos', 0)
      d.logic.setVariable('ecos_perdidos', echoes)
      d.progression.spawnEchoCache(echoes, deathPosition)
      d.logic.setVariable('loot_notice', 'Você morreu. Os Ecos foram deixados no local.')
    } else {
      d.logic.setVariable('loot_notice', 'Você morreu. Retorno ao último santuário...')
    }
    d.setLootNoticeDuration(2.4)
    d.spawnEffect(deathPosition.add(new THREE.Vector3(0, 0.8, 0)), 0xb65269, 0.9, 0.6)
  }

  update(dt: number, player: VeilborneCombatant): void {
    const d = this.deps
    if (player.alive) {
      if (d.getRespawnRemaining() > 0) d.setRespawnRemaining(0)
      if (d.logic.getVariable('morte_contagem') !== undefined && d.logic.getVariable('morte_contagem') !== 0) {
        d.logic.setVariable('morte_contagem', 0)
      }
      return
    }
    if (d.getRespawnRemaining() <= 0) return
    d.setRespawnRemaining(Math.max(0, d.getRespawnRemaining() - Math.max(0, Math.min(dt, 0.1))))
    d.logic.setVariable('morte_contagem', d.getRespawnRemaining())
    if (d.getRespawnRemaining() > 0) return
    this.respawn(player)
  }

  private respawn(player: VeilborneCombatant): void {
    const d = this.deps
    const checkpointId = d.logic.getVariable('checkpoint_id')
    let spawnPosition: THREE.Vector3 | null = null
    if (typeof checkpointId === 'string' && checkpointId) {
      const checkpoint = d.world.get(checkpointId)
      if (checkpoint) {
        checkpoint.mesh.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(checkpoint.mesh)
        spawnPosition = new THREE.Vector3(
          checkpoint.mesh.position.x,
          Number.isFinite(bounds.max.y) ? bounds.max.y + 0.05 : checkpoint.mesh.position.y + 0.8,
          checkpoint.mesh.position.z,
        )
      } else {
        spawnPosition = new THREE.Vector3(
          d.readNumber('checkpoint_x', 0),
          d.readNumber('checkpoint_y', 1),
          d.readNumber('checkpoint_z', 0),
        )
      }
    } else {
      const defaultPosition = d.getDefaultSpawnPosition()
      if (defaultPosition) spawnPosition = defaultPosition.clone()
    }
    if (!spawnPosition) spawnPosition = d.avatar.mesh.position.clone()
    d.avatar.mesh.position.copy(spawnPosition)
    d.avatar.resetVerticalState()
    d.setCameraTarget(spawnPosition.x, spawnPosition.y + 0.9, spawnPosition.z)

    player.resources.vitality = player.resources.maxVitality
    player.resources.ether = player.resources.maxEther
    player.resources.stamina = player.resources.maxStamina
    player.resources.posture = 0
    player.alive = true
    player.statuses = []
    d.syncPlayer(player)
    d.logic.setVariable('morto', false)
    d.logic.setVariable('jogador_morreu', false)
    d.logic.setVariable('jogador_atordoado', false)
    d.logic.setVariable('morte_contagem', 0)
    d.setRespawnRemaining(0)
    d.avatar.setActionLock(0)
    d.clearTargetLock()
    d.logic.setVariable('loot_notice', 'Você retornou ao santuário.')
    d.setLootNoticeDuration(2.2)
    d.spawnEffect(spawnPosition.clone().add(new THREE.Vector3(0, 1, 0)), 0xe9bf75, 0.95, 0.65)
    d.invalidate()
  }
}
