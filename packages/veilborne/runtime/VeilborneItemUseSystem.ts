import * as THREE from 'three'
import type { GameObject } from '../../../engine/model/object/GameObject'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import {
  restoreVeilborneResource,
  VEILBORNE_RUNTIME_ITEMS,
} from './VeilborneCombat'
import type {
  VeilborneCombatant,
  VeilborneDamageType,
  VeilborneStatusId,
} from './VeilborneCombat'
import type { VeilborneInventorySystem } from './VeilborneInventorySystem'

type VeilborneHostile = {
  instance: BehaviorPackageInstance
  object: GameObject
}

type VeilborneTarget = {
  object: GameObject
} | null

interface VeilborneItemUseDependencies {
  logic: RuleEngine
  inventory: VeilborneInventorySystem
  isEnabled(): boolean
  isRuntimeModeActive(): boolean
  getPlayer(): VeilborneCombatant
  syncPlayer(player: VeilborneCombatant): void
  readEchoes(): number
  findTarget(maxRange: number): VeilborneTarget
  getHostiles(): VeilborneHostile[]
  getAvatarMesh(): THREE.Object3D
  spawnEffect(position: THREE.Vector3, color: number, scale: number, durationSeconds?: number): void
  applyHit(
    instance: BehaviorPackageInstance,
    amount: number,
    damageType: VeilborneDamageType,
    postureDamage: number,
    status?: { id: VeilborneStatusId; potency: number; durationSeconds: number },
  ): { damage: number; killed: boolean }
  showNotice(message: string, durationSeconds: number): void
  invalidate(): void
}

/** Processa pedidos de consumo de itens e aplica seus efeitos no runtime VEILBORNE. */
export class VeilborneItemUseSystem {
  private readonly dependencies: VeilborneItemUseDependencies

  constructor(dependencies: VeilborneItemUseDependencies) {
    this.dependencies = dependencies
  }

  processRequest(): void {
    const d = this.dependencies
    const request = d.logic.getVariable('item_use_request')
    if (typeof request !== 'string' || !request.trim()) return
    d.logic.setVariable('item_use_request', '')
    if (!d.isEnabled() || !d.isRuntimeModeActive()) return

    const item = VEILBORNE_RUNTIME_ITEMS[request]
    if (!item) return
    const inventory = d.inventory.read()
    const stack = inventory.find(entry => entry.id === request)
    if (!stack || stack.quantity <= 0) return
    const player = d.getPlayer()
    if (!player.alive) return

    let consumed = false
    if (item.effect === 'restore_vitality') {
      if (player.resources.vitality < player.resources.maxVitality) {
        consumed = restoreVeilborneResource(player, 'vitality', item.amount) > 0
        if (consumed) d.syncPlayer(player)
      }
    } else if (item.effect === 'restore_ether') {
      if (player.resources.ether < player.resources.maxEther) {
        consumed = restoreVeilborneResource(player, 'ether', item.amount) > 0
        if (consumed) d.syncPlayer(player)
      }
    } else if (item.effect === 'restore_stamina') {
      if (player.resources.stamina < player.resources.maxStamina) {
        consumed = restoreVeilborneResource(player, 'stamina', item.amount) > 0
        if (consumed) d.syncPlayer(player)
      }
    } else if (item.effect === 'add_echoes') {
      d.logic.setVariable('ecos', Math.max(0, d.readEchoes()) + item.amount)
      consumed = true
    } else if (item.effect === 'area_damage') {
      const avatar = d.getAvatarMesh()
      const target = d.findTarget(item.range ?? 8)
      const forward = new THREE.Vector3(Math.sin(avatar.rotation.y), 0, Math.cos(avatar.rotation.y)).normalize()
      const center = target
        ? target.object.mesh.position.clone()
        : avatar.position.clone().addScaledVector(forward, Math.min(item.range ?? 4, 3.5))
      center.y += 0.6
      d.spawnEffect(center, item.visualColor, item.radius ?? 2, 0.5)
      const radius = item.radius ?? 3
      const affected = d.getHostiles().filter(candidate =>
        Math.hypot(candidate.object.mesh.position.x - center.x, candidate.object.mesh.position.z - center.z) <= radius,
      )
      for (const candidate of affected) {
        d.applyHit(
          candidate.instance,
          item.amount,
          item.damageType ?? 'fire',
          item.postureDamage ?? 10,
          { id: 'burn', potency: 2, durationSeconds: 3 },
        )
      }
      consumed = true
    }

    if (!consumed) {
      d.showNotice('Não é possível usar este item agora.', 1.8)
      return
    }

    stack.quantity -= 1
    d.inventory.write(inventory.filter(entry => entry.quantity > 0))
    d.showNotice(`Usado: ${item.name}`, 2)
    d.spawnEffect(
      d.getAvatarMesh().position.clone().add(new THREE.Vector3(0, 0.9, 0)),
      item.visualColor,
      0.34,
      0.32,
    )
    d.invalidate()
  }
}
