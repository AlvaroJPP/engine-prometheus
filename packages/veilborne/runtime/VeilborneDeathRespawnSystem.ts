import * as THREE from 'three'
import type { HumanoidAvatar } from '../../../engine/world/HumanoidAvatar'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { VeilborneCombatant } from './VeilborneCombat'

export interface VeilborneDeathRespawnDependencies {
  world: World
  logic: RuleEngine
  avatar: HumanoidAvatar
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
}

/** Encapsula a lógica de morte, perda de Ecos e retorno ao santuário. */
export class VeilborneDeathRespawnSystem {
  private readonly deps: VeilborneDeathRespawnDependencies

  constructor(deps: VeilborneDeathRespawnDependencies) {
    this.deps = deps
  }

  handlePlayerDeath(): void {
    const d = this.deps
    const deathPosition = d.avatar.mesh.position.clone()
    d.resetCombatInputs()
    d.setRespawnRemaining(2.2)
    d.logic.triggerGlobalEvent('veilborne:player_died', {
      avatarX: deathPosition.x,
      avatarY: deathPosition.y,
      avatarZ: deathPosition.z,
    })
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
    const fallback = d.getDefaultSpawnPosition() ?? d.avatar.mesh.position.clone()
    d.logic.triggerGlobalEvent('veilborne:respawn_requested', {
      defaultSpawnX: fallback.x,
      defaultSpawnY: fallback.y,
      defaultSpawnZ: fallback.z,
    })
    const spawnPosition = new THREE.Vector3(
      d.readNumber('respawn_x', fallback.x),
      d.readNumber('respawn_y', fallback.y),
      d.readNumber('respawn_z', fallback.z),
    )

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
    d.setRespawnRemaining(0)
    d.avatar.setActionLock(0)
    d.clearTargetLock()
    d.spawnEffect(spawnPosition.clone().add(new THREE.Vector3(0, 1, 0)), 0xe9bf75, 0.95, 0.65)
    d.invalidate()
  }
}
