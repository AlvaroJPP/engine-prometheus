import * as THREE from 'three'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { VeilborneInventorySystem } from './VeilborneInventorySystem'
import { VEILBORNE_RUNTIME_ITEMS } from './VeilborneCombat'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'

type WorldObject = NonNullable<ReturnType<World['get']>>

interface VeilborneLootDependencies {
  world: World
  logic: RuleEngine
  avatar: THREE.Object3D
  inventory: VeilborneInventorySystem
  isEnabled(): boolean
  isRuntimeModeActive(): boolean
  notifyBehaviorPackageChanged(ownerObjectId: string): void
  removeObject(id: string): void
  spawnEffect(position: THREE.Vector3, color: number, scale: number, durationSeconds?: number): void
  clearNotice(): void
  invalidate(): void
}

/** Controla drops, coleta e restauração dos itens de loot no editor/runtime. */
export class VeilborneLootSystem {
  private readonly d: VeilborneLootDependencies
  private readonly spawnedIds = new Set<string>()
  private readonly collectedVisibility = new Map<string, boolean>()

  constructor(dependencies: VeilborneLootDependencies) {
    this.d = dependencies
  }

  registerSpawnedLoot(id: string): void {
    this.spawnedIds.add(id)
  }

  forgetSpawnedLoot(id: string): void {
    this.spawnedIds.delete(id)
  }

  pickup(): boolean {
    const d = this.d
    if (!d.isEnabled() || !d.isRuntimeModeActive()) return false
    const position = d.avatar.position
    const candidates = d.logic.listPackages()
      .filter(instance => instance.enabled && instance.packageId === 'veilborne_rpg'
        && instance.variables.entity_role === 'loot' && instance.variables.loot_collected !== true)
      .map(instance => ({ instance, object: d.world.get(instance.ownerObjectId) }))
      .filter((entry): entry is { instance: BehaviorPackageInstance; object: WorldObject } =>
        !!entry.object && d.world.isObjectVisible(entry.object),
      )
      .map(entry => ({
        ...entry,
        distance: Math.hypot(entry.object.mesh.position.x - position.x, entry.object.mesh.position.z - position.z),
        verticalDistance: Math.abs(entry.object.mesh.position.y - position.y),
      }))
      .filter(entry => entry.distance <= 2.4 && entry.verticalDistance <= 3)
      .sort((a, b) => a.distance - b.distance)
    const pickup = candidates[0]
    if (!pickup) return false
    const itemId = pickup.instance.variables.loot_item_id
    const quantity = pickup.instance.variables.loot_quantity
    if (typeof itemId !== 'string' || !d.inventory.grant(itemId, typeof quantity === 'number' ? quantity : 1)) return false

    if (this.spawnedIds.has(pickup.object.id)) {
      this.spawnedIds.delete(pickup.object.id)
      d.removeObject(pickup.object.id)
    } else {
      this.collectedVisibility.set(pickup.object.id, pickup.object.mesh.visible !== false)
      d.logic.setPackageVariable(pickup.instance.id, 'loot_collected', true)
      d.world.update(pickup.object.id, { visible: false })
      d.notifyBehaviorPackageChanged(pickup.object.id)
    }
    d.spawnEffect(position.clone().add(new THREE.Vector3(0, 0.8, 0)), VEILBORNE_RUNTIME_ITEMS[itemId]!.visualColor, 0.38, 0.28)
    d.invalidate()
    return true
  }

  /**
   * Reposiciona o loot inicial quando o projeto carrega modelos importados.
   * O pivô do modelo é centralizado; usamos o limite visual e a superfície
   * mais alta sob o objeto para evitar que frascos e fragmentos sejam enterrados.
   */
  placeExistingLootOnGround(): void {
    const d = this.d
    const packages = d.logic.listPackages().filter(instance =>
      instance.enabled
      && instance.packageId === 'veilborne_rpg'
      && instance.variables.entity_role === 'loot'
      && instance.variables.loot_collected !== true,
    )
    const lootOwnerIds = new Set(packages.map(instance => instance.ownerObjectId))
    let changed = false

    for (const instance of packages) {
      const object = d.world.get(instance.ownerObjectId)
      if (!object) continue
      object.mesh.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(object.mesh)
      if (bounds.isEmpty()) continue
      const modelHeight = Math.max(0.1, bounds.max.y - bounds.min.y)
      const bottomOffset = object.mesh.position.y - bounds.min.y
      const ceilingY = object.mesh.position.y + Math.max(0.75, modelHeight)
      const groundY = this.findGroundHeight(
        object.mesh.position.x,
        object.mesh.position.z,
        ceilingY,
        lootOwnerIds,
        object.id,
      )
      const targetY = groundY + bottomOffset + 0.12
      if (!Number.isFinite(targetY) || Math.abs(object.mesh.position.y - targetY) < 0.05) continue
      d.world.update(object.id, { y: targetY })
      changed = true
    }

    if (changed) d.invalidate()
  }

  private findGroundHeight(
    x: number,
    z: number,
    ceilingY: number,
    excludedLootIds: Set<string>,
    excludedObjectId?: string,
  ): number {
    const terrainHeight = this.d.world.terrain.mesh.visible
      ? this.d.world.terrain.heightAt(x, z)
      : 0
    let groundY = Number.isFinite(terrainHeight) ? terrainHeight : 0

    for (const candidate of this.d.world.list()) {
      if (candidate.id === excludedObjectId || excludedLootIds.has(candidate.id)) continue
      if (candidate.mesh.visible === false || candidate.mesh.userData.colliderType === 'none') continue
      candidate.mesh.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(candidate.mesh)
      if (bounds.isEmpty() || bounds.max.y > ceilingY) continue
      if (
        x < bounds.min.x - 0.03 || x > bounds.max.x + 0.03
        || z < bounds.min.z - 0.03 || z > bounds.max.z + 0.03
      ) continue
      groundY = Math.max(groundY, bounds.max.y)
    }
    return groundY
  }

  resetForEditor(): void {
    const d = this.d
    for (const id of this.spawnedIds) if (d.world.get(id)) d.removeObject(id)
    this.spawnedIds.clear()

    // Drops created by package scripts exist only during Run and are discarded on return to Edit.
    for (const instance of d.logic.listPackages()) {
      if (instance.packageId !== 'veilborne_rpg' || instance.variables.loot_spawned !== true) continue
      const id = instance.ownerObjectId
      if (d.world.get(id)) d.removeObject(id)
    }

    for (const [id, wasVisible] of this.collectedVisibility) {
      if (!d.world.get(id)) continue
      d.world.update(id, { visible: wasVisible })
      const instance = d.logic.listPackages(id).find(item => item.packageId === 'veilborne_rpg')
      if (instance) d.logic.setPackageVariable(instance.id, 'loot_collected', false)
      d.notifyBehaviorPackageChanged(id)
    }
    this.collectedVisibility.clear()

    // Declarative pickup scripts record the original visibility in package data,
    // so editor reset can restore those objects without game-specific pickup code.
    for (const instance of d.logic.listPackages()) {
      if (instance.packageId !== 'veilborne_rpg' || instance.variables.entity_role !== 'loot'
        || instance.variables.loot_collected !== true) continue
      const id = instance.ownerObjectId
      if (!d.world.get(id)) continue
      const originalVisible = typeof instance.variables.loot_original_visible === 'boolean'
        ? instance.variables.loot_original_visible
        : true
      d.world.update(id, { visible: originalVisible })
      d.logic.setPackageVariable(instance.id, 'loot_collected', false)
      d.notifyBehaviorPackageChanged(id)
    }
    if (d.logic.getVariable('item_use_request') !== undefined) d.logic.setVariable('item_use_request', '')
    d.clearNotice()
  }
}
