export interface SpatialPoint3 {
  readonly x: number
  readonly y: number
  readonly z: number
}
export interface SpatialItem3 extends SpatialPoint3 {
  readonly id: string
}
export interface SpatialQueryResult<T> {
  readonly item: T
  readonly distance: number
}
interface CellRecord<T> { item: T; cellKey: string }

const finitePoint = (point: SpatialPoint3): boolean =>
  [point.x, point.y, point.z].every(Number.isFinite)

/** Uniform-grid broad phase for proximity queries in arbitrary 3D worlds. */
export class SpatialHash3D<T extends SpatialItem3> {
  private readonly buckets = new Map<string, Map<string, T>>()
  private readonly records = new Map<string, CellRecord<T>>()
  private readonly cellSize: number
  private readonly maxQueryCells: number

  constructor(cellSize = 4, maxQueryCells = 25_000) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('SpatialHash3D cellSize must be positive.')
    if (!Number.isInteger(maxQueryCells) || maxQueryCells < 1) throw new Error('maxQueryCells must be a positive integer.')
    this.cellSize = cellSize
    this.maxQueryCells = maxQueryCells
  }

  get size(): number { return this.records.size }
  get(id: string): T | undefined { return this.records.get(id)?.item }

  upsert(item: T): boolean {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || !finitePoint(item)) return false
    const cellKey = this.cellKey(item)
    const previous = this.records.get(item.id)
    if (previous?.cellKey === cellKey) {
      this.buckets.get(cellKey)?.set(item.id, item)
      this.records.set(item.id, { item, cellKey })
      return true
    }
    if (previous) this.removeFromBucket(item.id, previous.cellKey)
    let bucket = this.buckets.get(cellKey)
    if (!bucket) this.buckets.set(cellKey, bucket = new Map())
    bucket.set(item.id, item)
    this.records.set(item.id, { item, cellKey })
    return true
  }

  remove(id: string): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.removeFromBucket(id, record.cellKey)
    this.records.delete(id)
    return true
  }

  queryRadius(center: SpatialPoint3, radius: number): SpatialQueryResult<T>[] {
    if (!finitePoint(center) || !Number.isFinite(radius) || radius < 0) return []
    const min = this.toCell({ x: center.x - radius, y: center.y - radius, z: center.z - radius })
    const max = this.toCell({ x: center.x + radius, y: center.y + radius, z: center.z + radius })
    const cellCount = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1)
    const candidates = new Map<string, T>()
    if (cellCount > this.maxQueryCells) {
      for (const [id, record] of this.records) candidates.set(id, record.item)
    } else {
      for (let x = min.x; x <= max.x; x += 1) {
        for (let y = min.y; y <= max.y; y += 1) {
          for (let z = min.z; z <= max.z; z += 1) {
            const bucket = this.buckets.get(`${x},${y},${z}`)
            if (bucket) for (const [id, item] of bucket) candidates.set(id, item)
          }
        }
      }
    }
    const radiusSquared = radius * radius
    return [...candidates.values()].flatMap(item => {
      const dx = item.x - center.x
      const dy = item.y - center.y
      const dz = item.z - center.z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (distanceSquared > radiusSquared) return []
      return [{ item, distance: Math.sqrt(distanceSquared) }]
    }).sort((a, b) => a.distance - b.distance || a.item.id.localeCompare(b.item.id))
  }

  queryNearest(center: SpatialPoint3, radius: number, predicate?: (item: T) => boolean): SpatialQueryResult<T> | null {
    return this.queryRadius(center, radius).find(result => predicate?.(result.item) ?? true) ?? null
  }

  clear(): void { this.buckets.clear(); this.records.clear() }

  private toCell(point: SpatialPoint3): { x: number; y: number; z: number } {
    return { x: Math.floor(point.x / this.cellSize), y: Math.floor(point.y / this.cellSize), z: Math.floor(point.z / this.cellSize) }
  }
  private cellKey(item: SpatialPoint3): string {
    const cell = this.toCell(item)
    return `${cell.x},${cell.y},${cell.z}`
  }
  private removeFromBucket(id: string, cellKey: string): void {
    const bucket = this.buckets.get(cellKey)
    bucket?.delete(id)
    if (bucket?.size === 0) this.buckets.delete(cellKey)
  }
}
