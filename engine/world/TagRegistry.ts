/** Índice de tags many-to-many para objetos, entidades ou recursos genéricos. */
export class TagRegistry<TId extends string = string> {
  private readonly tagsById = new Map<TId, Set<string>>()
  private readonly idsByTag = new Map<string, Set<TId>>()

  add(id: TId, tag: string): boolean {
    const key = tag.trim()
    if (!id || !key) return false
    let tags = this.tagsById.get(id)
    if (!tags) this.tagsById.set(id, tags = new Set())
    if (tags.has(key)) return false
    tags.add(key)
    let ids = this.idsByTag.get(key)
    if (!ids) this.idsByTag.set(key, ids = new Set())
    ids.add(id)
    return true
  }

  remove(id: TId, tag: string): boolean {
    const key = tag.trim()
    const tags = this.tagsById.get(id)
    if (!tags?.delete(key)) return false
    if (tags.size === 0) this.tagsById.delete(id)
    const ids = this.idsByTag.get(key)
    ids?.delete(id)
    if (ids?.size === 0) this.idsByTag.delete(key)
    return true
  }

  removeId(id: TId): boolean {
    const tags = this.tagsById.get(id)
    if (!tags) return false
    for (const tag of tags) {
      const ids = this.idsByTag.get(tag)
      ids?.delete(id)
      if (ids?.size === 0) this.idsByTag.delete(tag)
    }
    this.tagsById.delete(id)
    return true
  }

  has(id: TId, tag: string): boolean { return this.tagsById.get(id)?.has(tag.trim()) ?? false }
  getTags(id: TId): string[] { return [...(this.tagsById.get(id) ?? [])] }
  query(tag: string): TId[] { return [...(this.idsByTag.get(tag.trim()) ?? [])] }

  queryAll(tags: readonly string[]): TId[] {
    if (tags.length === 0) return []
    const sets = tags.map(tag => this.idsByTag.get(tag.trim()))
    if (sets.some(set => !set || set.size === 0)) return []
    const smallest = sets.reduce((a, b) => a!.size <= b!.size ? a : b)!
    return [...smallest].filter(id => sets.every(set => set!.has(id)))
  }

  clear(): void { this.tagsById.clear(); this.idsByTag.clear() }
  get size(): number { return this.tagsById.size }
}
