import type {
  BehaviorTreeHandlers,
  BehaviorTreeParameters,
  BehaviorTreeStatus,
} from './BehaviorTree.ts'

type ConditionHandler<TContext> = (parameters: BehaviorTreeParameters, context: TContext) => boolean
type ActionHandler<TContext> = (parameters: BehaviorTreeParameters, context: TContext) => BehaviorTreeStatus

/** Composes independently registered behavior-tree nodes without editing the core runtime. */
export class BehaviorTreeHandlerRegistry<TContext> {
  private readonly conditions = new Map<string, ConditionHandler<TContext>>()
  private readonly actions = new Map<string, ActionHandler<TContext>>()

  registerCondition(
    name: string,
    handler: ConditionHandler<TContext>,
    replace = false,
  ): () => void {
    const key = this.validateName(name)
    if (this.conditions.has(key) && !replace) throw new Error(`Condition handler already registered: "${key}".`)
    this.conditions.set(key, handler)
    return () => { if (this.conditions.get(key) === handler) this.conditions.delete(key) }
  }

  registerAction(
    name: string,
    handler: ActionHandler<TContext>,
    replace = false,
  ): () => void {
    const key = this.validateName(name)
    if (this.actions.has(key) && !replace) throw new Error(`Action handler already registered: "${key}".`)
    this.actions.set(key, handler)
    return () => { if (this.actions.get(key) === handler) this.actions.delete(key) }
  }

  registerNamespace(
    namespace: string,
    handlers: {
      readonly conditions?: Readonly<Record<string, ConditionHandler<TContext>>>
      readonly actions?: Readonly<Record<string, ActionHandler<TContext>>>
    },
  ): () => void {
    const prefix = this.validateName(namespace)
    const disposers: Array<() => void> = []
    try {
      for (const [name, handler] of Object.entries(handlers.conditions ?? {})) {
        disposers.push(this.registerCondition(`${prefix}:${name}`, handler))
      }
      for (const [name, handler] of Object.entries(handlers.actions ?? {})) {
        disposers.push(this.registerAction(`${prefix}:${name}`, handler))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  createHandlers(fallback: BehaviorTreeHandlers<TContext> = {}): BehaviorTreeHandlers<TContext> {
    return {
      condition: (name, parameters, context) =>
        this.conditions.get(name)?.(parameters, context)
        ?? fallback.condition?.(name, parameters, context)
        ?? false,
      action: (name, parameters, context) => {
        const result = this.actions.get(name)?.(parameters, context)
          ?? fallback.action?.(name, parameters, context)
          ?? 'failure'
        return result === 'success' || result === 'running' || result === 'failure' ? result : 'failure'
      },
    }
  }

  hasCondition(name: string): boolean { return this.conditions.has(name.trim()) }
  hasAction(name: string): boolean { return this.actions.has(name.trim()) }
  clear(): void { this.conditions.clear(); this.actions.clear() }
  get conditionCount(): number { return this.conditions.size }
  get actionCount(): number { return this.actions.size }

  private validateName(name: string): string {
    const key = name.trim()
    if (!key) throw new Error('Behavior-tree handler name must not be empty.')
    return key
  }
}
