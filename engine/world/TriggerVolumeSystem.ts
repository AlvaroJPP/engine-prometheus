export interface TriggerPoint3 {
  readonly x: number
  readonly y: number
  readonly z: number
}
export interface TriggerSubject {
  readonly id: string
  readonly position: TriggerPoint3
  readonly tags?: readonly string[]
}
export interface TriggerVolume {
  readonly id: string
  readonly shape: 'sphere' | 'box'
  readonly center: TriggerPoint3
  readonly radius?: number
  /** Half-size on each axis for box volumes. */
  readonly halfExtents?: TriggerPoint3
  readonly enabled?: boolean
  readonly requiredTags?: readonly string[]
  readonly accepts?: (subject: TriggerSubject) => boolean
}
export interface TriggerEvent {
  readonly type: 'enter' | 'stay' | 'exit'
  readonly triggerId: string
  readonly subjectId: string
}

/** Tracks enter/stay/exit transitions for generic point-like subjects and volumes. */
export class TriggerVolumeSystem {
  private readonly volumes = new Map<string, TriggerVolume>()
  private readonly occupants = new Map<string, Set<string>>()

  setVolume(volume: TriggerVolume): void {
    if (!volume.id.trim()) throw new Error('Trigger volume requires an id.')
    this.validateVolume(volume)
    this.volumes.set(volume.id, volume)
    if (!this.occupants.has(volume.id)) this.occupants.set(volume.id, new Set())
  }

  removeVolume(id: string): TriggerEvent[] {
    const previous = this.occupants.get(id) ?? new Set()
    this.volumes.delete(id)
    this.occupants.delete(id)
    return [...previous].sort().map(subjectId => ({ type: 'exit', triggerId: id, subjectId }))
  }

  clear(): void { this.volumes.clear(); this.occupants.clear() }

  update(subjects: readonly TriggerSubject[]): TriggerEvent[] {
    const validSubjects = new Map(subjects.filter(subject =>
      !!subject && typeof subject.id === 'string' && !!subject.id.trim() && this.validPoint(subject.position),
    ).map(subject => [subject.id, subject]))
    const events: TriggerEvent[] = []
    for (const [triggerId, volume] of this.volumes) {
      const previous = this.occupants.get(triggerId) ?? new Set<string>()
      const current = new Set<string>()
      if (volume.enabled !== false) {
        for (const subject of validSubjects.values()) {
          if (!this.matchesTags(volume.requiredTags ?? [], subject.tags ?? [])) continue
          if (volume.accepts && !volume.accepts(subject)) continue
          if (!this.contains(volume, subject.position)) continue
          current.add(subject.id)
          events.push({ type: previous.has(subject.id) ? 'stay' : 'enter', triggerId, subjectId: subject.id })
        }
      }
      for (const subjectId of previous) {
        if (!current.has(subjectId)) events.push({ type: 'exit', triggerId, subjectId })
      }
      this.occupants.set(triggerId, current)
    }
    const rank = { enter: 0, stay: 1, exit: 2 } as const
    return events.sort((a, b) => a.triggerId.localeCompare(b.triggerId)
      || a.subjectId.localeCompare(b.subjectId) || rank[a.type] - rank[b.type])
  }

  getOccupants(triggerId: string): string[] {
    return [...(this.occupants.get(triggerId) ?? [])].sort()
  }

  private contains(volume: TriggerVolume, point: TriggerPoint3): boolean {
    const dx = point.x - volume.center.x
    const dy = point.y - volume.center.y
    const dz = point.z - volume.center.z
    if (volume.shape === 'sphere') return dx * dx + dy * dy + dz * dz <= volume.radius! * volume.radius!
    const half = volume.halfExtents!
    return Math.abs(dx) <= half.x && Math.abs(dy) <= half.y && Math.abs(dz) <= half.z
  }

  private matchesTags(required: readonly string[], actual: readonly string[]): boolean {
    const available = new Set(actual)
    return required.every(tag => available.has(tag))
  }

  private validPoint(point: TriggerPoint3): boolean {
    return !!point && [point.x, point.y, point.z].every(Number.isFinite)
  }

  private validateVolume(volume: TriggerVolume): void {
    if (!this.validPoint(volume.center)) throw new Error('Trigger volume center must be finite.')
    if (volume.shape === 'sphere') {
      if (!Number.isFinite(volume.radius) || volume.radius! < 0) throw new Error('Sphere trigger radius must be non-negative.')
      return
    }
    const half = volume.halfExtents
    if (!half || !this.validPoint(half) || half.x < 0 || half.y < 0 || half.z < 0) {
      throw new Error('Box trigger halfExtents must be finite and non-negative.')
    }
  }
}
