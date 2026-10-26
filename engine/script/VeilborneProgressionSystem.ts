import * as THREE from 'three'
import { uuid } from '../lib/id'
import type { ObjectType } from '../project/format'
import type { World } from '../world/World'
import type { RuleEngine } from './RuleEngine'
import type { BehaviorPackageInstance } from './packages'
import type { VeilborneCombatant } from './VeilborneCombat'

type WorldObject = NonNullable<ReturnType<World['get']>>

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

  activateCheckpoint(): boolean {
    const d = this.dependencies
    if (!d.isEnabled() || !d.isRuntimeModeActive()) return false
    const position = d.avatar.position
    const checkpoint = d.logic.listPackages()
      .filter(instance => instance.enabled && instance.packageId === 'veilborne_rpg'
        && instance.variables.entity_role === 'checkpoint')
      .map(instance => ({ instance, object: d.world.get(instance.ownerObjectId) }))
      .filter((entry): entry is { instance: BehaviorPackageInstance; object: WorldObject } =>
        !!entry.object && d.world.isObjectVisible(entry.object),
      )
      .map(entry => ({
        ...entry,
        distance: Math.hypot(
          entry.object.mesh.position.x - position.x,
          entry.object.mesh.position.z - position.z,
        ),
        verticalDistance: Math.abs(entry.object.mesh.position.y - position.y),
      }))
      .filter(entry => entry.distance <= 2.8 && entry.verticalDistance <= 3)
      .sort((a, b) => a.distance - b.distance)[0]
    if (!checkpoint) return false

    const bounds = new THREE.Box3().setFromObject(checkpoint.object.mesh)
    const spawnY = Number.isFinite(bounds.max.y) ? bounds.max.y + 0.05 : checkpoint.object.mesh.position.y + 0.8
    d.logic.setVariable('checkpoint_id', checkpoint.object.id)
    d.logic.setVariable('checkpoint_x', checkpoint.object.mesh.position.x)
    d.logic.setVariable('checkpoint_y', spawnY)
    d.logic.setVariable('checkpoint_z', checkpoint.object.mesh.position.z)
    for (const instance of d.logic.listPackages()) {
      if (instance.packageId !== 'veilborne_rpg' || instance.variables.entity_role !== 'checkpoint') continue
      const active = instance.ownerObjectId === checkpoint.object.id
      d.logic.setPackageVariable(instance.id, 'checkpoint_active', active)
      d.notifyBehaviorPackageChanged(instance.ownerObjectId)
    }

    if (checkpoint.instance.variables.checkpoint_restore_resources !== false) {
      d.logic.setVariable('vida', d.readNumber('vida_max', 100))
      d.logic.setVariable('eter', d.readNumber('eter_max', 100))
      d.logic.setVariable('vigor', d.readNumber('vigor_max', 100))
      d.logic.setVariable('postura', 0)
      d.logic.setVariable('morto', false)
      d.logic.setVariable('jogador_morreu', false)
      d.logic.setVariable('jogador_atordoado', false)
      const player = d.getPlayer()
      player.statuses = []
      player.alive = true
      d.syncPlayer(player)
    }
    const name = typeof checkpoint.instance.variables.checkpoint_name === 'string'
      ? checkpoint.instance.variables.checkpoint_name
      : 'Santuário'
    d.showNotice('Santuário ativado: ' + name, 2.4)
    d.triggerBehaviorPackageEvent(checkpoint.object.id, 'veilborne_rpg', 'checkpoint_used')
    d.spawnEffect(checkpoint.object.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xe9bf75, 0.7, 0.55)
    d.invalidate()
    return true
  }

  pickupEchoCache(): boolean {
    const d = this.dependencies
    if (!d.isEnabled() || !d.isRuntimeModeActive()) return false
    const position = d.avatar.position
    const cache = d.logic.listPackages()
      .filter(instance => instance.enabled && instance.packageId === 'veilborne_rpg'
        && instance.variables.entity_role === 'echo_cache')
      .map(instance => ({ instance, object: d.world.get(instance.ownerObjectId) }))
      .filter((entry): entry is { instance: BehaviorPackageInstance; object: WorldObject } =>
        !!entry.object && d.world.isObjectVisible(entry.object),
      )
      .map(entry => ({
        ...entry,
        distance: Math.hypot(
          entry.object.mesh.position.x - position.x,
          entry.object.mesh.position.z - position.z,
        ),
        verticalDistance: Math.abs(entry.object.mesh.position.y - position.y),
      }))
      .filter(entry => entry.distance <= 2.4 && entry.verticalDistance <= 3)
      .sort((a, b) => a.distance - b.distance)[0]
    if (!cache) return false

    const amount = cache.instance.variables.echoes_amount
    const recovered = typeof amount === 'number' && Number.isFinite(amount)
      ? Math.max(0, Math.floor(amount))
      : Math.max(0, Math.floor(d.readNumber('ecos_perdidos', 0)))
    if (recovered <= 0) return false

    d.logic.setVariable('ecos', Math.max(0, d.readNumber('ecos', 0)) + recovered)
    d.logic.setVariable('ecos_perdidos', 0)
    this.removeEchoCache()
    d.showNotice('Ecos recuperados: ' + recovered, 2.6)
    d.spawnEffect(position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0xe9bf75, 0.62, 0.4)
    d.invalidate()
    return true
  }

  spawnEchoCache(amount: number, position: THREE.Vector3): void {
    const d = this.dependencies
    const value = Math.max(0, Math.floor(amount))
    if (value <= 0) return
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
