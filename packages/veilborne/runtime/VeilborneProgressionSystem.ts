import * as THREE from 'three'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { VeilborneCombatant } from './VeilborneCombat'

interface VeilborneProgressionDependencies {
  world: World
  logic: RuleEngine
  avatar: THREE.Object3D
  isEnabled(): boolean
  isRuntimeModeActive(): boolean
  getPlayer(): VeilborneCombatant
  syncPlayer(player: VeilborneCombatant): void
  spawnEffect(position: THREE.Vector3, color: number, scale: number, durationSeconds?: number): void
  invalidate(): void
}

/** Gerencia santuários e recuperação de Ecos deixados pelo jogador. */
export class VeilborneProgressionSystem {
  private readonly dependencies: VeilborneProgressionDependencies
  private cacheObjectId: string | null = null

  constructor(dependencies: VeilborneProgressionDependencies) {
    this.dependencies = dependencies
  }

  get echoCacheObjectId(): string | null {
    return this.cacheObjectId
  }

  /** Reconstrói a referência de um cache que já veio salvo no projeto. */
  syncEchoCacheReference(): string | null {
    const d = this.dependencies
    const savedCache = d.logic.listPackages().find(instance =>
      instance.enabled &&
      instance.packageId === 'veilborne_rpg' &&
      instance.variables.entity_role === 'echo_cache' &&
      d.world.get(instance.ownerObjectId) !== undefined,
    )
    this.cacheObjectId = savedCache?.ownerObjectId ?? null
    return this.cacheObjectId
  }

  activateCheckpoint(): boolean {
    const d = this.dependencies
    if (!d.isEnabled() || !d.isRuntimeModeActive()) return false

    const position = d.avatar.position
    const handled = d.logic.triggerNearestPackageEvent(
      { x: position.x, y: position.y, z: position.z },
      {
        eventId: 'interact',
        packageId: 'veilborne_rpg',
        radius: 2.8,
        verticalTolerance: 3,
        variableEquals: { entity_role: 'checkpoint' },
      },
    )
    if (!handled) return false

    // The package Visual Script owns checkpoint data and resource restoration.
    // This adapter only clears transient combatant state that lives in memory.
    if (d.logic.getVariable('checkpoint_restore_completed') === true) {
      const player = d.getPlayer()
      player.statuses = []
      player.alive = true
      d.syncPlayer(player)
      d.logic.setVariable('checkpoint_restore_completed', false)
    }

    const checkpointId = d.logic.getVariable('checkpoint_id')
    if (typeof checkpointId === 'string') {
      const checkpoint = d.world.get(checkpointId)
      if (checkpoint) {
        d.spawnEffect(
          checkpoint.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0)),
          0xe9bf75,
          0.7,
          0.55,
        )
      }
    }
    d.invalidate()
    return true
  }

  pickupEchoCache(): boolean {
    const d = this.dependencies
    if (!d.isEnabled() || !d.isRuntimeModeActive()) return false

    this.syncEchoCacheReference()
    const cacheId = this.cacheObjectId
    const previousPosition = cacheId ? d.world.get(cacheId)?.mesh.position.clone() : null
    const position = d.avatar.position.clone()
    const handled = d.logic.triggerNearestPackageEvent(
      { x: position.x, y: position.y, z: position.z },
      {
        eventId: 'interact',
        packageId: 'veilborne_rpg',
        radius: 2.4,
        verticalTolerance: 3,
        variableEquals: { entity_role: 'echo_cache' },
      },
    )
    if (!handled) return false

    this.cacheObjectId = null
    const effectPosition = previousPosition ?? position
    d.spawnEffect(effectPosition.clone().add(new THREE.Vector3(0, 0.9, 0)), 0xe9bf75, 0.62, 0.4)
    d.invalidate()
    return true
  }

  clearEchoCacheReference(): void {
    this.cacheObjectId = null
  }
}
