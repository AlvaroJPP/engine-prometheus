export type StatusStackPolicy = 'refresh' | 'replace' | 'stack'
export type StatusEffectScalar = string | number | boolean
export interface StatusEffectOptions {
  readonly stackPolicy?: StatusStackPolicy
  readonly maxStacks?: number
  readonly tickIntervalSeconds?: number
  readonly metadata?: Readonly<Record<string, StatusEffectScalar>>
}
export interface ActiveStatusEffect {
  readonly ownerId: string
  readonly effectId: string
  readonly remainingSeconds: number
  readonly stacks: number
  readonly tickIntervalSeconds: number | null
  readonly timeUntilTickSeconds: number | null
  readonly metadata: Readonly<Record<string, StatusEffectScalar>>
}
export interface StatusEffectEvent {
  readonly type: 'applied' | 'refreshed' | 'stacked' | 'tick' | 'expired' | 'removed'
  readonly ownerId: string
  readonly effectId: string
  readonly stacks: number
  readonly remainingSeconds: number
  readonly tickIndex?: number
}
interface MutableStatusEffect {
  ownerId: string
  effectId: string
  remainingSeconds: number
  stacks: number
  stackPolicy: StatusStackPolicy
  maxStacks: number
  tickIntervalSeconds: number | null
  timeUntilTickSeconds: number | null
  metadata: Record<string, StatusEffectScalar>
}

/** Deterministic timed effects with refresh/replace/stack policies and periodic tick events. */
export class StatusEffectRuntime {
  private readonly owners = new Map<string, Map<string, MutableStatusEffect>>()
  private readonly maxCatchUpTicks: number

  constructor(maxCatchUpTicks = 8) {
    if (!Number.isInteger(maxCatchUpTicks) || maxCatchUpTicks < 1 || maxCatchUpTicks > 1000) {
      throw new Error('maxCatchUpTicks must be an integer between 1 and 1000.')
    }
    this.maxCatchUpTicks = maxCatchUpTicks
  }

  apply(ownerId: string, effectId: string, durationSeconds: number, options: StatusEffectOptions = {}): StatusEffectEvent | null {
    const owner = ownerId.trim()
    const id = effectId.trim()
    if (!owner || !id || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
    const policy = options.stackPolicy ?? 'refresh'
    const maxStacks = options.maxStacks ?? 1
    const interval = options.tickIntervalSeconds
    if (!['refresh', 'replace', 'stack'].includes(policy)) return null
    if (!Number.isInteger(maxStacks) || maxStacks < 1 || maxStacks > 999) return null
    if (interval !== undefined && (!Number.isFinite(interval) || interval <= 0)) return null
    if (options.metadata && Object.values(options.metadata).some(value =>
      typeof value === 'number' ? !Number.isFinite(value) : !['string', 'boolean'].includes(typeof value),
    )) return null

    let effects = this.owners.get(owner)
    if (!effects) this.owners.set(owner, effects = new Map())
    const existing = effects.get(id)
    if (!existing || policy === 'replace') {
      const effect: MutableStatusEffect = {
        ownerId: owner, effectId: id, remainingSeconds: durationSeconds,
        stacks: 1, stackPolicy: policy, maxStacks,
        tickIntervalSeconds: interval ?? null,
        timeUntilTickSeconds: interval ?? null,
        metadata: { ...(options.metadata ?? {}) },
      }
      effects.set(id, effect)
      return this.toEvent(effect, 'applied')
    }

    existing.remainingSeconds = durationSeconds
    existing.tickIntervalSeconds = interval ?? existing.tickIntervalSeconds
    existing.timeUntilTickSeconds = existing.tickIntervalSeconds
    existing.stackPolicy = policy
    existing.maxStacks = maxStacks
    if (options.metadata) existing.metadata = { ...options.metadata }
    if (policy === 'stack') {
      existing.stacks = Math.min(maxStacks, existing.stacks + 1)
      return this.toEvent(existing, 'stacked')
    }
    return this.toEvent(existing, 'refreshed')
  }

  update(deltaSeconds: number): StatusEffectEvent[] {
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    if (dt === 0) return []
    const events: StatusEffectEvent[] = []
    for (const [ownerId, effects] of this.owners) {
      for (const [effectId, effect] of effects) {
        const activeDelta = Math.min(dt, effect.remainingSeconds)
        effect.remainingSeconds = Math.max(0, effect.remainingSeconds - dt)
        if (effect.tickIntervalSeconds !== null && effect.timeUntilTickSeconds !== null) {
          effect.timeUntilTickSeconds -= activeDelta
          let tickIndex = 0
          while (effect.timeUntilTickSeconds <= 1e-9 && tickIndex < this.maxCatchUpTicks) {
            events.push(this.toEvent(effect, 'tick', tickIndex + 1))
            effect.timeUntilTickSeconds += effect.tickIntervalSeconds
            tickIndex += 1
          }
          if (effect.timeUntilTickSeconds <= 0) {
            const skipped = Math.floor(-effect.timeUntilTickSeconds / effect.tickIntervalSeconds) + 1
            effect.timeUntilTickSeconds += skipped * effect.tickIntervalSeconds
          }
        }
        if (effect.remainingSeconds <= 0) {
          events.push(this.toEvent(effect, 'expired'))
          effects.delete(effectId)
        }
      }
      if (effects.size === 0) this.owners.delete(ownerId)
    }
    return events
  }

  remove(ownerId: string, effectId: string): StatusEffectEvent | null {
    const owner = ownerId.trim()
    const id = effectId.trim()
    const effects = this.owners.get(owner)
    const effect = effects?.get(id)
    if (!effects || !effect) return null
    effects.delete(id)
    if (effects.size === 0) this.owners.delete(owner)
    return this.toEvent(effect, 'removed')
  }

  removeOwner(ownerId: string): StatusEffectEvent[] {
    const owner = ownerId.trim()
    const effects = this.owners.get(owner)
    if (!effects) return []
    const events = [...effects.values()].map(effect => this.toEvent(effect, 'removed'))
    this.owners.delete(owner)
    return events
  }

  has(ownerId: string, effectId: string): boolean {
    return this.owners.get(ownerId.trim())?.has(effectId.trim()) ?? false
  }

  get(ownerId: string, effectId: string): ActiveStatusEffect | undefined {
    const effect = this.owners.get(ownerId.trim())?.get(effectId.trim())
    return effect ? this.toSnapshot(effect) : undefined
  }

  list(ownerId?: string): ActiveStatusEffect[] {
    const effects = ownerId === undefined
      ? [...this.owners.values()].flatMap(ownerEffects => [...ownerEffects.values()])
      : [...(this.owners.get(ownerId.trim())?.values() ?? [])]
    return effects.map(effect => this.toSnapshot(effect)).sort((a, b) =>
      a.ownerId.localeCompare(b.ownerId) || a.effectId.localeCompare(b.effectId),
    )
  }

  clear(): void { this.owners.clear() }

  private toSnapshot(effect: MutableStatusEffect): ActiveStatusEffect {
    return {
      ownerId: effect.ownerId, effectId: effect.effectId,
      remainingSeconds: effect.remainingSeconds, stacks: effect.stacks,
      tickIntervalSeconds: effect.tickIntervalSeconds,
      timeUntilTickSeconds: effect.timeUntilTickSeconds,
      metadata: { ...effect.metadata },
    }
  }

  private toEvent(effect: MutableStatusEffect, type: StatusEffectEvent['type'], tickIndex?: number): StatusEffectEvent {
    return {
      type, ownerId: effect.ownerId, effectId: effect.effectId,
      stacks: effect.stacks, remainingSeconds: effect.remainingSeconds,
      ...(tickIndex === undefined ? {} : { tickIndex }),
    }
  }
}
