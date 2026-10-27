import { ResourcePool } from './ResourcePool.ts'
import type { ResourceChange } from './ResourcePool.ts'

export interface ResourcePoolDefinition {
  readonly current: number
  readonly maximum: number
  readonly minimum?: number
}
export interface RegisteredResourceChange {
  readonly ownerId: string
  readonly resourceId: string
  readonly change: ResourceChange
}
interface RegisteredPool {
  readonly pool: ResourcePool
  readonly unsubscribe: () => void
}

/** Names and lifecycle-manages resource pools for arbitrary entities or systems. */
export class ResourcePoolRegistry {
  private readonly owners = new Map<string, Map<string, RegisteredPool>>()
  private readonly listeners = new Set<(event: RegisteredResourceChange) => void>()

  create(ownerId: string, resourceId: string, definition: ResourcePoolDefinition): ResourcePool {
    const owner = ownerId.trim()
    const id = resourceId.trim()
    if (!owner || !id) throw new Error('Resource pools require owner and resource identifiers.')
    const resources = this.owners.get(owner) ?? new Map<string, RegisteredPool>()
    if (resources.has(id)) throw new Error(`Resource "${id}" already exists for owner "${owner}".`)
    const pool = new ResourcePool(definition)
    const unsubscribe = pool.subscribe(change => {
      const event = { ownerId: owner, resourceId: id, change }
      for (const listener of [...this.listeners]) listener(event)
    })
    resources.set(id, { pool, unsubscribe })
    this.owners.set(owner, resources)
    return pool
  }

  get(ownerId: string, resourceId: string): ResourcePool | undefined {
    return this.owners.get(ownerId.trim())?.get(resourceId.trim())?.pool
  }

  remove(ownerId: string, resourceId: string): boolean {
    const owner = ownerId.trim()
    const id = resourceId.trim()
    const resources = this.owners.get(owner)
    const registered = resources?.get(id)
    if (!registered || !resources) return false
    registered.unsubscribe()
    resources.delete(id)
    if (resources.size === 0) this.owners.delete(owner)
    return true
  }

  removeOwner(ownerId: string): number {
    const owner = ownerId.trim()
    const resources = this.owners.get(owner)
    if (!resources) return 0
    for (const registered of resources.values()) registered.unsubscribe()
    const count = resources.size
    this.owners.delete(owner)
    return count
  }

  list(ownerId: string): Array<{ resourceId: string; pool: ResourcePool }> {
    return [...(this.owners.get(ownerId.trim()) ?? new Map())]
      .map(([resourceId, registered]) => ({ resourceId, pool: registered.pool }))
  }

  onChange(listener: (event: RegisteredResourceChange) => void): () => void {
    this.listeners.add(listener)
    let active = true
    return () => { if (active) { active = false; this.listeners.delete(listener) } }
  }

  clear(): void {
    for (const resources of this.owners.values()) {
      for (const registered of resources.values()) registered.unsubscribe()
    }
    this.owners.clear()
    this.listeners.clear()
  }

  get ownerCount(): number { return this.owners.size }
}
