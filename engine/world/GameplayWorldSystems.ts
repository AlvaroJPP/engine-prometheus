import { SpatialHash3D } from './SpatialHash3D.ts'
import type { SpatialItem3, SpatialPoint3, SpatialQueryResult } from './SpatialHash3D.ts'
import { TagRegistry } from './TagRegistry.ts'
import { TriggerVolumeSystem } from './TriggerVolumeSystem.ts'
import type { TriggerEvent, TriggerSubject, TriggerVolume } from './TriggerVolumeSystem.ts'

export interface GameplayQueryOptions<T> {
  readonly allTags?: readonly string[]
  readonly anyTags?: readonly string[]
  readonly excludedTags?: readonly string[]
  readonly predicate?: (item: T) => boolean
}

/** Unified owner for spatial lookups, entity tags, and trigger enter/stay/exit events. */
export class GameplayWorldSystems<T extends SpatialItem3 = SpatialItem3> {
  readonly triggers = new TriggerVolumeSystem()
  readonly tags = new TagRegistry<string>()
  private readonly spatial: SpatialHash3D<T>
  private readonly entities = new Map<string, T>()

  constructor(cellSize = 4, maxQueryCells = 25_000) {
    this.spatial = new SpatialHash3D<T>(cellSize, maxQueryCells)
  }

  get size(): number { return this.entities.size }
  get(id: string): T | undefined { return this.entities.get(id) }

  upsert(entity: T, tags?: readonly string[]): boolean {
    if (!this.spatial.upsert(entity)) return false
    this.entities.set(entity.id, entity)
    if (tags) this.setTags(entity.id, tags)
    return true
  }

  setTags(id: string, tags: readonly string[]): boolean {
    if (!this.entities.has(id)) return false
    this.tags.removeId(id)
    for (const tag of tags) this.tags.add(id, tag)
    return true
  }

  remove(id: string): boolean {
    const existed = this.entities.delete(id)
    this.spatial.remove(id)
    this.tags.removeId(id)
    return existed
  }

  queryRadius(
    center: SpatialPoint3,
    radius: number,
    options: GameplayQueryOptions<T> = {},
  ): SpatialQueryResult<T>[] {
    return this.spatial.queryRadius(center, radius).filter(({ item }) => {
      const itemTags = this.tags.getTags(item.id)
      if (!(options.allTags ?? []).every(tag => itemTags.includes(tag))) return false
      const any = options.anyTags ?? []
      if (any.length > 0 && !any.some(tag => itemTags.includes(tag))) return false
      if ((options.excludedTags ?? []).some(tag => itemTags.includes(tag))) return false
      return options.predicate?.(item) ?? true
    })
  }

  queryNearest(
    center: SpatialPoint3,
    radius: number,
    options: GameplayQueryOptions<T> = {},
  ): SpatialQueryResult<T> | null {
    return this.queryRadius(center, radius, options)[0] ?? null
  }

  setTrigger(volume: TriggerVolume): void { this.triggers.setVolume(volume) }
  removeTrigger(triggerId: string): TriggerEvent[] { return this.triggers.removeVolume(triggerId) }

  /** Evaluate all volumes against the latest indexed entities and return transitions in stable order. */
  updateTriggers(): TriggerEvent[] {
    const subjects: TriggerSubject[] = [...this.entities.values()].map(entity => ({
      id: entity.id,
      position: { x: entity.x, y: entity.y, z: entity.z },
      tags: this.tags.getTags(entity.id),
    }))
    return this.triggers.update(subjects)
  }

  clear(): void {
    this.entities.clear()
    this.spatial.clear()
    this.tags.clear()
    this.triggers.clear()
  }
}
