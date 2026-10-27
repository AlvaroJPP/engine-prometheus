import * as THREE from 'three'
import { uuid } from '../../../engine/lib/id'
import type { ObjectType } from '../../../engine/project/format'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { VeilborneCombatant } from './VeilborneCombat'

interface VeilborneProgressionDependencies {
  world: World
  logic: RuleEngine
  avatar: THREE.Object3D
  isEnabled(): boolean
  isRuntimeModeActive(): boolean
  readNumber(name: string, fallback: number): number
  getPlayer(): VeilborneCombatant
  syncPlayer(player: VeilborneCombatant): void
  installBehaviorPackage(ownerObjectId: string, packageId: string): BehaviorPackageInstance
  notifyBehaviorPackageChanged(ownerObjectId: string): void
  triggerBehaviorPackageEvent(ownerObjectId: string, packageId: string, eventId: string): boolean
  removeObject(id: string): void
  registerSpawnedLoot(id: string): void
  forgetSpawnedLoot(id: string): void
  spawnEffect(position: THREE.Vector3, color: number, scale: number, durationSeconds?: number): void
  showNotice(message: string, durationSeconds: number): void
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

    if (cacheId) d.forgetSpawnedLoot(cacheId)
    this.cacheObjectId = null
    const effectPosition = previousPosition ?? position
    d.spawnEffect(effectPosition.clone().add(new THREE.Vector3(0, 0.9, 0)), 0xe9bf75, 0.62, 0.4)
    d.invalidate()
    return true
  }

  spawnEchoCache(amount: number, position: THREE.Vector3): void {
    const d = this.dependencies
    const value = Math.max(0, Math.floor(amount))
    if (value <= 0) return
    if (!this.cacheObjectId) this.syncEchoCacheReference()
    if (this.cacheObjectId && d.world.get(this.cacheObjectId)) return

    const material = new THREE.MeshStandardMaterial({
      color: 0xe9bf75,
      emissive: 0x9e682b,
      emissiveIntensity: 1.1,
      metalness: 0.35,
      roughness: 0.2,
    })
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), material)
    mesh.name = 'VEILBORNE_ECHO_CACHE'
    mesh.castShadow = true
    mesh.position.copy(position)
    mesh.position.y += 0.4
    const id = 'veilborne-echo-cache-' + uuid()
    const object = d.world.add({
      id,
      name: 'Ecos perdidos',
      type: 'sphere' as ObjectType,
      mesh,
    })
    d.registerSpawnedLoot(object.id)
    this.cacheObjectId = object.id
    const installed = d.installBehaviorPackage(object.id, 'veilborne_rpg')
    d.logic.setPackageVariable(installed.id, 'entity_role', 'echo_cache')
    d.logic.setPackageVariable(installed.id, 'faction', 'neutral')
    d.logic.setPackageVariable(installed.id, 'echoes_amount', value)
    d.logic.setPackageVariable(installed.id, 'ai_enabled', false)
    d.logic.setPackageVariable(installed.id, 'drop_item_id', '')
    d.notifyBehaviorPackageChanged(object.id)
  }

  removeEchoCache(): void {
    const d = this.dependencies
    if (!this.cacheObjectId) this.syncEchoCacheReference()
    const id = this.cacheObjectId
    if (!id) return
    d.forgetSpawnedLoot(id)
    if (d.world.get(id)) d.removeObject(id)
    this.cacheObjectId = null
  }

  clearEchoCacheReference(): void {
    this.cacheObjectId = null
  }
}
