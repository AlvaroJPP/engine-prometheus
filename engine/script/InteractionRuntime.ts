import { CooldownScheduler } from '../runtime/CooldownScheduler.ts'
import { ResourcePool } from '../runtime/ResourcePool.ts'
import { InteractionTargetSelector } from './InteractionTargetSelector.ts'
import type { InteractionPoint3, InteractionTarget } from './InteractionTargetSelector.ts'

export interface InteractionResourceCost {
  readonly pool: ResourcePool
  readonly amount: number
}
export interface InteractionAttemptOptions<T extends InteractionTarget> {
  readonly origin: InteractionPoint3
  readonly targets: readonly T[]
  readonly maxDistance: number
  readonly cooldownKey: string
  readonly cooldownSeconds: number
  readonly costs?: readonly InteractionResourceCost[]
  readonly lineOfSight?: (origin: InteractionPoint3, target: T) => boolean
  readonly canInteract?: (target: T) => boolean
  /** Return false to reject the interaction and refund successfully paid costs. */
  readonly perform: (target: T, distance: number) => boolean
}
export type InteractionAttemptResult<T extends InteractionTarget> =
  | { readonly status: 'interacted'; readonly target: T; readonly distance: number }
  | { readonly status: 'cooldown'; readonly remainingSeconds: number }
  | { readonly status: 'no_target' }
  | { readonly status: 'insufficient_resource'; readonly resourceIndex: number }
  | { readonly status: 'rejected'; readonly target: T }
  | { readonly status: 'invalid_configuration' }

/** Transaction-like interaction flow combining target selection, costs and cooldowns. */
export class InteractionRuntime<T extends InteractionTarget = InteractionTarget> {
  private readonly selector = new InteractionTargetSelector<T>()
  readonly cooldowns = new CooldownScheduler()

  attempt(options: InteractionAttemptOptions<T>): InteractionAttemptResult<T> {
    const cooldownKey = options.cooldownKey.trim()
    if (
      !cooldownKey
      || !Number.isFinite(options.cooldownSeconds)
      || options.cooldownSeconds < 0
      || typeof options.perform !== 'function'
    ) return { status: 'invalid_configuration' }

    if (!this.cooldowns.isReady(cooldownKey)) {
      return { status: 'cooldown', remainingSeconds: this.cooldowns.getRemaining(cooldownKey) }
    }

    const selected = this.selector.select(options.origin, options.targets, {
      maxDistance: options.maxDistance,
      ...(options.lineOfSight ? { lineOfSight: options.lineOfSight } : {}),
      ...(options.canInteract ? { canInteract: options.canInteract } : {}),
    })
    if (!selected) return { status: 'no_target' }

    const costs = options.costs ?? []
    for (let index = 0; index < costs.length; index += 1) {
      const cost = costs[index]!
      if (!Number.isFinite(cost.amount) || cost.amount <= 0 || !cost.pool.canSpend(cost.amount)) {
        return { status: 'insufficient_resource', resourceIndex: index }
      }
    }

    const paid: InteractionResourceCost[] = []
    for (let index = 0; index < costs.length; index += 1) {
      const cost = costs[index]!
      if (!cost.pool.spend(cost.amount)) {
        for (const previous of paid) previous.pool.restore(previous.amount)
        return { status: 'insufficient_resource', resourceIndex: index }
      }
      paid.push(cost)
    }

    try {
      if (!options.perform(selected.target, selected.distance)) {
        for (const cost of paid) cost.pool.restore(cost.amount)
        return { status: 'rejected', target: selected.target }
      }
    } catch (error) {
      for (const cost of paid) cost.pool.restore(cost.amount)
      throw error
    }

    this.cooldowns.start(cooldownKey, options.cooldownSeconds)
    return { status: 'interacted', target: selected.target, distance: selected.distance }
  }

  update(deltaSeconds: number): void { this.cooldowns.update(deltaSeconds) }
  reset(): void { this.cooldowns.clear() }
}
