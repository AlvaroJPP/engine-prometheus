import * as THREE from 'three'
import type { World } from './World'

export interface CollisionPair {
  a: string
  b: string
}

const EPSILON = 0.001
const MAX_RESOLUTION_PASSES = 3

/**
 * Colisões AABB para os objetos do mundo.
 * Os objetos sobrepostos são separados pelo menor eixo de penetração.
 * O sistema também emite eventos de início e fim de colisão.
 */
export class CollisionSystem {
  private readonly world: World
  private activePairs = new Map<string, CollisionPair>()

  constructor(world: World) {
    this.world = world
  }

  update(): void {
    const objects = this.world.list().filter((object) => object.mesh.visible)
    const previousPairs = this.activePairs
    const currentPairs = new Map<string, CollisionPair>()

    // Resolve sobreposições em algumas passagens para lidar com grupos de objetos.
    for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
      let resolvedAny = false
      for (let i = 0; i < objects.length; i += 1) {
        const a = objects[i]
        if (!a) continue
        const boxA = new THREE.Box3().setFromObject(a.mesh)
        for (let j = i + 1; j < objects.length; j += 1) {
          const b = objects[j]
          if (!b) continue
          const boxB = new THREE.Box3().setFromObject(b.mesh)
          if (!boxA.intersectsBox(boxB)) continue

          const overlapX = Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x)
          const overlapY = Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y)
          const overlapZ = Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z)
          if (overlapX <= EPSILON || overlapY <= EPSILON || overlapZ <= EPSILON) continue

          const key = this.pairKey(a.id, b.id)
          currentPairs.set(key, { a: a.id, b: b.id })

          // Separa o segundo objeto no eixo de menor penetração.
          const centerA = boxA.getCenter(new THREE.Vector3())
          const centerB = boxB.getCenter(new THREE.Vector3())
          if (overlapX <= overlapY && overlapX <= overlapZ) {
            b.mesh.position.x += (centerB.x >= centerA.x ? 1 : -1) * (overlapX + EPSILON)
          } else if (overlapY <= overlapZ) {
            b.mesh.position.y += (centerB.y >= centerA.y ? 1 : -1) * (overlapY + EPSILON)
          } else {
            b.mesh.position.z += (centerB.z >= centerA.z ? 1 : -1) * (overlapZ + EPSILON)
          }
          b.mesh.updateMatrixWorld(true)
          this.world.notifyChanged(b.id)
          resolvedAny = true
        }
      }
      if (!resolvedAny) break
    }

    // Recalcula os pares após a resolução para não manter colisões já corrigidas.
    currentPairs.clear()
    for (let i = 0; i < objects.length; i += 1) {
      const a = objects[i]
      if (!a) continue
      const boxA = new THREE.Box3().setFromObject(a.mesh)
      for (let j = i + 1; j < objects.length; j += 1) {
        const b = objects[j]
        if (!b) continue
        const boxB = new THREE.Box3().setFromObject(b.mesh)
        if (!boxA.intersectsBox(boxB)) continue
        const overlapX = Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x)
        const overlapY = Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y)
        const overlapZ = Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z)
        if (overlapX <= EPSILON || overlapY <= EPSILON || overlapZ <= EPSILON) continue
        const key = this.pairKey(a.id, b.id)
        currentPairs.set(key, { a: a.id, b: b.id })
      }
    }

    for (const [key, pair] of currentPairs) {
      if (!previousPairs.has(key)) this.world.events.emit('collisionStarted', pair)
    }
    for (const [key, pair] of previousPairs) {
      if (!currentPairs.has(key)) this.world.events.emit('collisionEnded', pair)
    }
    this.activePairs = currentPairs
  }

  clear(): void {
    for (const pair of this.activePairs.values()) this.world.events.emit('collisionEnded', pair)
    this.activePairs.clear()
  }

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`
  }
}
