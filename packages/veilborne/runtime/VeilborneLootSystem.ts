import * as THREE from 'three'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'

interface VeilborneLootDependencies {
  world: World
  logic: RuleEngine
  notifyBehaviorPackageChanged(ownerObjectId: string): void
  removeObject(id: string): void
  clearNotice(): void
  invalidate(): void
}

/** Controla drops, coleta e restauração dos itens de loot no editor/runtime. */
export class VeilborneLootSystem {
  private readonly d: VeilborneLootDependencies

  constructor(dependencies: VeilborneLootDependencies) {
    this.d = dependencies
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
      const excludedIds = new Set(lootOwnerIds)
      excludedIds.add(object.id)
      const groundY = d.world.getSurfaceHeightAt(
        object.mesh.position.x,
        object.mesh.position.z,
        ceilingY,
        excludedIds,
      )
      const targetY = groundY + bottomOffset + 0.12
      if (!Number.isFinite(targetY) || Math.abs(object.mesh.position.y - targetY) < 0.05) continue
      d.world.update(object.id, { y: targetY })
      changed = true
    }

    if (changed) d.invalidate()
  }

  resetForEditor(): void {
    const d = this.d
    // Drops created by package scripts exist only during Run and are discarded on return to Edit.
    for (const instance of d.logic.listPackages()) {
      if (instance.packageId !== 'veilborne_rpg' || instance.variables.loot_spawned !== true) continue
      const id = instance.ownerObjectId
      if (d.world.get(id)) d.removeObject(id)
    }

    // Temporary visibility is restored by the generic RuleEngine runtime.
    // The package-specific adapter only resets the collectable flag for authored loot.
    for (const instance of d.logic.listPackages()) {
      if (instance.packageId !== 'veilborne_rpg' || instance.variables.entity_role !== 'loot'
        || instance.variables.loot_collected !== true) continue
      d.logic.setPackageVariable(instance.id, 'loot_collected', false)
      d.notifyBehaviorPackageChanged(instance.ownerObjectId)
    }
    if (d.logic.getVariable('item_use_request') !== undefined) d.logic.setVariable('item_use_request', '')
    d.clearNotice()
  }
}
