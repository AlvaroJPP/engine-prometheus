import * as THREE from 'three'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { VeilborneInventorySystem } from './VeilborneInventorySystem'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'

type WorldObject = NonNullable<ReturnType<World['get']>>

interface VeilborneLootDependencies {
  world: World
  logic: RuleEngine
  avatar: THREE.Object3D
  inventory: VeilborneInventorySystem
  notifyBehaviorPackageChanged(ownerObjectId: string): void
  removeObject(id: string): void
  clearNotice(): void
  invalidate(): void
}

/** Controla drops, coleta e restauração dos itens de loot no editor/runtime. */
export class VeilborneLootSystem {
  private readonly d: VeilborneLootDependencies
  private readonly spawnedIds = new Set<string>()

  constructor(dependencies: VeilborneLootDependencies) {
    this.d = dependencies
  }

  registerSpawnedLoot(id: string): void {
    this.spawnedIds.add(id)
  }

  forgetSpawnedLoot(id: string): void {
    this.spawnedIds.delete(id)
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
