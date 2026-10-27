export type StateTransitionGuard<TContext> = (context: TContext) => boolean
export interface StateDefinition<TContext> {
  readonly onEnter?: (context: TContext, previous: string | null) => void
  readonly onUpdate?: (context: TContext, deltaSeconds: number) => void
  readonly onExit?: (context: TContext, next: string) => void
}
export interface StateTransition<TContext> {
  readonly from: string | '*'
  readonly to: string
  readonly guard?: StateTransitionGuard<TContext>
}

/** Máquina de estados finitos genérica para gameplay, ferramentas e módulos. */
export class FiniteStateMachine<TContext> {
  private readonly states = new Map<string, StateDefinition<TContext>>()
  private readonly transitions: StateTransition<TContext>[] = []
  private current: string | null = null

  get currentState(): string | null { return this.current }

  addState(id: string, definition: StateDefinition<TContext> = {}): this {
    const key = id.trim()
    if (!key) throw new Error('O estado precisa de um identificador.')
    if (this.states.has(key)) throw new Error(`Estado duplicado: "${key}".`)
    this.states.set(key, definition)
    return this
  }

  addTransition(transition: StateTransition<TContext>): this {
    const from = transition.from === '*' ? '*' : transition.from.trim()
    const to = transition.to.trim()
    if (!to || !this.states.has(to)) throw new Error(`Estado de destino inexistente: "${to}".`)
    if (from !== '*' && !this.states.has(from)) throw new Error(`Estado de origem inexistente: "${from}".`)
    this.transitions.push({ ...transition, from, to })
    return this
  }

  start(initialState: string, context: TContext): void {
    if (this.current !== null) throw new Error('A máquina de estados já foi iniciada.')
    const next = initialState.trim()
    const definition = this.states.get(next)
    if (!definition) throw new Error(`Estado inicial inexistente: "${next}".`)
    this.current = next
    definition.onEnter?.(context, null)
  }

  transitionTo(next: string, context: TContext): boolean {
    const target = next.trim()
    const definition = this.states.get(target)
    if (!definition || this.current === null || target === this.current) return false
    const allowed = this.transitions.some(rule =>
      (rule.from === '*' || rule.from === this.current)
      && rule.to === target
      && (rule.guard?.(context) ?? true),
    )
    if (!allowed) return false
    const previous = this.current
    this.states.get(previous)?.onExit?.(context, target)
    this.current = target
    definition.onEnter?.(context, previous)
    return true
  }

  update(context: TContext, deltaSeconds: number): void {
    if (this.current === null) return
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    this.states.get(this.current)?.onUpdate?.(context, dt)
  }

  tryTransitions(context: TContext): boolean {
    if (this.current === null) return false
    for (const rule of this.transitions) {
      if (rule.from !== '*' && rule.from !== this.current) continue
      if (!(rule.guard?.(context) ?? true)) continue
      return this.transitionTo(rule.to, context)
    }
    return false
  }

  stop(context: TContext): void {
    if (this.current === null) return
    const previous = this.current
    this.states.get(previous)?.onExit?.(context, '')
    this.current = null
  }

  hasState(id: string): boolean { return this.states.has(id.trim()) }
}
