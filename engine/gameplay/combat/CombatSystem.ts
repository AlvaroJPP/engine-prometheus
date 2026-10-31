import * as THREE from 'three'
import { EngineEventBus } from '../../core/EngineEventBus'
import { World } from '../../world/World'

export interface CombatConfig {
  defaultDamage: number
  hitCooldown: number
  knockbackForce: number
}

export interface CombatEntity {
  id: string
  health: number
  maxHealth: number
  team: string
}

export interface DamageResult {
  damageDealt: number
  killed: boolean
}

export class CombatSystem {
  private config: CombatConfig
  private eventBus: EngineEventBus
  private world: World
  private entityStats: Map<string, { health: number; maxHealth: number; team: string }> = new Map()

  constructor(config: CombatConfig, eventBus: EngineEventBus, world: World) {
    this.config = config
    this.eventBus = eventBus
    this.world = world
  }

  registerEntity(id: string, stats: { health: number; maxHealth: number; team: string }): void {
    this.entityStats.set(id, stats)
  }

  unregisterEntity(id: string): void {
    this.entityStats.delete(id)
  }

  applyDamage(attackerId: string, targetId: string, damage: number, knockback?: THREE.Vector3): DamageResult {
    const target = this.entityStats.get(targetId)
    if (!target) return { damageDealt: 0, killed: false }

    // Check team to prevent friendly fire (if implemented)
    const attacker = this.entityStats.get(attackerId)
    if (attacker && attacker.team === target.team) {
       // Optionally handle friendly fire rules
    }

    target.health -= damage
    const killed = target.health <= 0
    if (killed) {
        this.eventBus.emit('entityDied', { id: targetId })
    }

    return { damageDealt: damage, killed }
  }

  update(deltaTime: number): void {
    // Combat updates like cooldowns or regeneration
  }
}
