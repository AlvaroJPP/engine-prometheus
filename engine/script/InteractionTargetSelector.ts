export interface InteractionPoint3 {
  readonly x: number
  readonly y: number
  readonly z: number
}
export interface InteractionTarget {
  readonly id: string
  readonly position: InteractionPoint3
  readonly enabled?: boolean
  readonly priority?: number
}
export interface InteractionSelection<T extends InteractionTarget> {
  readonly target: T
  readonly distance: number
}
export interface InteractionSelectionOptions<T extends InteractionTarget> {
  readonly maxDistance: number
  readonly lineOfSight?: (origin: InteractionPoint3, target: T) => boolean
  readonly canInteract?: (target: T) => boolean
}

/** Deterministically selects the best enabled target within range and optional line of sight. */
export class InteractionTargetSelector<T extends InteractionTarget = InteractionTarget> {
  select(
    origin: InteractionPoint3,
    targets: readonly T[],
    options: InteractionSelectionOptions<T>,
  ): InteractionSelection<T> | null {
    if (!this.validPoint(origin) || !Number.isFinite(options.maxDistance) || options.maxDistance < 0) return null
    const candidates: InteractionSelection<T>[] = []
    for (const target of targets) {
      if (!target || typeof target.id !== 'string' || !target.id.trim() || target.enabled === false) continue
      if (!this.validPoint(target.position) || (options.canInteract && !options.canInteract(target))) continue
      if (options.lineOfSight && !options.lineOfSight(origin, target)) continue
      const distance = Math.hypot(
        target.position.x - origin.x,
        target.position.y - origin.y,
        target.position.z - origin.z,
      )
      if (!Number.isFinite(distance) || distance > options.maxDistance) continue
      candidates.push({ target, distance })
    }
    candidates.sort((a, b) =>
      (b.target.priority ?? 0) - (a.target.priority ?? 0)
      || a.distance - b.distance
      || a.target.id.localeCompare(b.target.id),
    )
    return candidates[0] ?? null
  }

  private validPoint(point: InteractionPoint3): boolean {
    return !!point && [point.x, point.y, point.z].every(Number.isFinite)
  }
}
