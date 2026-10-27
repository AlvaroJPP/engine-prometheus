import type { BehaviorPackageInstance, PackageJsonValue } from './packages'
import {
  BehaviorTreeRuntime,
} from './BehaviorTree.ts'
import type {
  BehaviorTreeHandlers,
  BehaviorTreeNode,
  BehaviorTreeStatus,
} from './BehaviorTree'

export const BEHAVIOR_TREE_CONFIG_KEY = 'behaviorTree'
export const BEHAVIOR_TREE_STATUS_VARIABLE = 'behavior_tree_status'

export interface BehaviorTreePackageTransition {
  instanceId: string
  ownerObjectId: string
  previousStatus: BehaviorTreeStatus | 'none'
  status: BehaviorTreeStatus
}

interface RuntimeEntry<TContext> {
  runtime: BehaviorTreeRuntime<TContext>
  treeFingerprint: string
  lastStatus: BehaviorTreeStatus | 'none'
}

/**
 * Connects serialized behavior trees in generic behavior-package instances
 * to the engine runtime. Game-specific actions and conditions are injected
 * by the caller; this system knows nothing about any particular game.
 */
export class BehaviorTreePackageSystem<TContext = unknown> {
  private readonly runtimes = new Map<string, RuntimeEntry<TContext>>()

  update(input: {
    instances: readonly BehaviorPackageInstance[]
    context: TContext
    dt: number
    runtimeEnabled: boolean
    handlersFor: (
      instance: BehaviorPackageInstance,
      context: TContext,
    ) => BehaviorTreeHandlers<TContext>
  }): BehaviorTreePackageTransition[] {
    if (!input.runtimeEnabled) {
      this.reset()
      return []
    }

    const transitions: BehaviorTreePackageTransition[] = []
    const activeIds = new Set<string>()

    for (const instance of input.instances) {
      if (!instance.enabled) {
        this.releaseInstance(instance)
        continue
      }

      const rawTree = instance.config[BEHAVIOR_TREE_CONFIG_KEY]
      if (rawTree === undefined || rawTree === null) {
        this.releaseInstance(instance)
        continue
      }

      const fingerprint = this.fingerprint(rawTree)
      if (!fingerprint) {
        this.releaseInstance(instance)
        continue
      }

      activeIds.add(instance.id)
      let entry = this.runtimes.get(instance.id)
      if (!entry || entry.treeFingerprint !== fingerprint) {
        this.runtimes.delete(instance.id)
        const runtime = new BehaviorTreeRuntime<TContext>(input.handlersFor(instance, input.context))
        runtime.setTree(rawTree as unknown as BehaviorTreeNode)
        entry = { runtime, treeFingerprint: fingerprint, lastStatus: 'none' }
        this.runtimes.set(instance.id, entry)
      }

      const status = entry.runtime.tick(input.context, input.dt)
      instance.variables[BEHAVIOR_TREE_STATUS_VARIABLE] = status
      if (status !== entry.lastStatus) {
        transitions.push({
          instanceId: instance.id,
          ownerObjectId: instance.ownerObjectId,
          previousStatus: entry.lastStatus,
          status,
        })
        entry.lastStatus = status
      }
    }

    for (const id of this.runtimes.keys()) {
      if (!activeIds.has(id)) this.runtimes.delete(id)
    }

    return transitions
  }

  reset(): void {
    for (const entry of this.runtimes.values()) entry.runtime.reset()
    this.runtimes.clear()
  }

  hasRuntime(instanceId: string): boolean {
    return this.runtimes.has(instanceId)
  }

  private releaseInstance(instance: BehaviorPackageInstance): void {
    this.runtimes.delete(instance.id)
    delete instance.variables[BEHAVIOR_TREE_STATUS_VARIABLE]
  }

  private fingerprint(value: PackageJsonValue): string | null {
    try {
      return JSON.stringify(value) ?? null
    } catch {
      return null
    }
  }
}
