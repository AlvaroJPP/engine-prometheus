export type BehaviorTreeStatus = 'success' | 'failure' | 'running'

export type BehaviorTreeParameters = Readonly<Record<string, unknown>>

interface BehaviorTreeNodeBase {
  readonly id: string
}

export interface BehaviorTreeSequenceNode extends BehaviorTreeNodeBase {
  readonly type: 'sequence'
  readonly children: readonly BehaviorTreeNode[]
}

export interface BehaviorTreeSelectorNode extends BehaviorTreeNodeBase {
  readonly type: 'selector'
  readonly children: readonly BehaviorTreeNode[]
}

export interface BehaviorTreeParallelNode extends BehaviorTreeNodeBase {
  readonly type: 'parallel'
  readonly children: readonly BehaviorTreeNode[]
  /** Número mínimo de filhos bem-sucedidos; por padrão, todos. */
  readonly successThreshold?: number
  /** Número mínimo de filhos com falha; por padrão, um. */
  readonly failureThreshold?: number
}

export interface BehaviorTreeConditionNode extends BehaviorTreeNodeBase {
  readonly type: 'condition'
  readonly condition: string
  readonly parameters?: BehaviorTreeParameters
}

export interface BehaviorTreeActionNode extends BehaviorTreeNodeBase {
  readonly type: 'action'
  readonly action: string
  readonly parameters?: BehaviorTreeParameters
}

export interface BehaviorTreeWaitNode extends BehaviorTreeNodeBase {
  readonly type: 'wait'
  readonly durationSeconds: number
}

export type BehaviorTreeNode =
  | BehaviorTreeSequenceNode
  | BehaviorTreeSelectorNode
  | BehaviorTreeParallelNode
  | BehaviorTreeConditionNode
  | BehaviorTreeActionNode
  | BehaviorTreeWaitNode

export interface BehaviorTreeHandlers<TContext> {
  /** Condições desconhecidas falham com segurança. */
  condition?(name: string, parameters: BehaviorTreeParameters, context: TContext): boolean
  /** Ações desconhecidas falham com segurança. Ações podem retornar running. */
  action?(name: string, parameters: BehaviorTreeParameters, context: TContext): BehaviorTreeStatus
}

const MAX_TREE_DEPTH = 128
const MAX_TREE_NODES = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nodeChildren(value: unknown): unknown[] | null {
  if (!isRecord(value)) return null
  return Array.isArray(value.children) ? value.children : null
}

/** Valida dados de árvore antes de executá-los, incluindo IDs repetidos e ciclos. */
export function validateBehaviorTree(tree: BehaviorTreeNode): void {
  const seenIds = new Set<string>()
  const visiting = new Set<object>()
  let visitedCount = 0

  const visit = (candidate: unknown, path: string, depth: number): void => {
    if (!isRecord(candidate)) throw new Error(`Nó inválido em ${path}: era esperado um objeto.`)
    if (depth > MAX_TREE_DEPTH) throw new Error(`A árvore excede a profundidade máxima de ${MAX_TREE_DEPTH}.`)
    if (visiting.has(candidate)) throw new Error(`Ciclo detectado na árvore em ${path}.`)

    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    if (!id) throw new Error(`Nó sem identificador válido em ${path}.`)
    if (seenIds.has(id)) throw new Error(`Identificador de nó duplicado: "${id}".`)
    seenIds.add(id)

    visitedCount += 1
    if (visitedCount > MAX_TREE_NODES) throw new Error(`A árvore excede o limite de ${MAX_TREE_NODES} nós.`)

    const type = candidate.type
    if (type === 'sequence' || type === 'selector' || type === 'parallel') {
      const children = nodeChildren(candidate)
      if (!children) throw new Error(`O nó "${id}" precisa de uma lista de filhos.`)
      if (type === 'parallel') {
        if (children.length === 0) throw new Error(`O nó paralelo "${id}" precisa de pelo menos um filho.`)
        const successThreshold = candidate.successThreshold ?? children.length
        const failureThreshold = candidate.failureThreshold ?? 1
        if (!Number.isInteger(successThreshold) || (successThreshold as number) < 1 || (successThreshold as number) > children.length) {
          throw new Error(`Limite de sucesso inválido no nó paralelo "${id}".`)
        }
        if (!Number.isInteger(failureThreshold) || (failureThreshold as number) < 1 || (failureThreshold as number) > children.length) {
          throw new Error(`Limite de falha inválido no nó paralelo "${id}".`)
        }
      }

      visiting.add(candidate)
      children.forEach((child, index) => visit(child, `${path}.children[${index}]`, depth + 1))
      visiting.delete(candidate)
      return
    }

    if (type === 'condition') {
      if (typeof candidate.condition !== 'string' || !candidate.condition.trim()) {
        throw new Error(`O nó de condição "${id}" precisa de um nome.`)
      }
      return
    }
    if (type === 'action') {
      if (typeof candidate.action !== 'string' || !candidate.action.trim()) {
        throw new Error(`O nó de ação "${id}" precisa de um nome.`)
      }
      return
    }
    if (type === 'wait') {
      if (typeof candidate.durationSeconds !== 'number' || !Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds < 0) {
        throw new Error(`Duração inválida no nó de espera "${id}".`)
      }
      return
    }
    throw new Error(`Tipo de nó desconhecido em "${id}": "${String(type)}".`)
  }

  visit(tree, 'root', 0)
}

export class BehaviorTreeRuntime<TContext = unknown> {
  private tree: BehaviorTreeNode | null = null
  private readonly sequenceCursors = new Map<string, number>()
  private readonly waitRemaining = new Map<string, number>()
  private readonly parallelResults = new Map<string, Map<string, BehaviorTreeStatus>>()

  constructor(private readonly handlers: BehaviorTreeHandlers<TContext> = {}) {}

  setTree(tree: BehaviorTreeNode): void {
    validateBehaviorTree(tree)
    this.tree = tree
    this.reset()
  }

  /** Executa um tick determinístico e devolve o estado da raiz. */
  tick(context: TContext, deltaSeconds: number): BehaviorTreeStatus {
    if (!this.tree) throw new Error('Nenhuma árvore de comportamento foi configurada.')

    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    return this.tickNode(this.tree, context, dt)
  }

  /** Limpa temporizadores e cursores sem remover a definição da árvore. */
  reset(): void {
    this.sequenceCursors.clear()
    this.waitRemaining.clear()
    this.parallelResults.clear()
  }

  hasTree(): boolean {
    return this.tree !== null
  }

  private tickNode(node: BehaviorTreeNode, context: TContext, dt: number): BehaviorTreeStatus {
    switch (node.type) {
      case 'sequence':
        return this.tickSequence(node, context, dt)
      case 'selector':
        return this.tickSelector(node, context, dt)
      case 'parallel':
        return this.tickParallel(node, context, dt)
      case 'condition':
        return this.handlers.condition?.(node.condition, node.parameters ?? {}, context) === true
          ? 'success'
          : 'failure'
      case 'action': {
        const result = this.handlers.action?.(node.action, node.parameters ?? {}, context) ?? 'failure'
        return result === 'success' || result === 'running' || result === 'failure'
          ? result
          : 'failure'
      }
      case 'wait':
        return this.tickWait(node, dt)
    }
  }

  private tickSequence(
    node: BehaviorTreeSequenceNode,
    context: TContext,
    dt: number,
  ): BehaviorTreeStatus {
    const start = this.sequenceCursors.get(node.id) ?? 0
    for (let index = start; index < node.children.length; index += 1) {
      const status = this.tickNode(node.children[index]!, context, dt)
      if (status === 'running') {
        this.sequenceCursors.set(node.id, index)
        return 'running'
      }
      if (status === 'failure') {
        this.resetSubtree(node)
        return 'failure'
      }
    }
    this.resetSubtree(node)
    return 'success'
  }

  private tickSelector(
    node: BehaviorTreeSelectorNode,
    context: TContext,
    dt: number,
  ): BehaviorTreeStatus {
    const start = this.sequenceCursors.get(node.id) ?? 0
    for (let index = start; index < node.children.length; index += 1) {
      const status = this.tickNode(node.children[index]!, context, dt)
      if (status === 'running') {
        this.sequenceCursors.set(node.id, index)
        return 'running'
      }
      if (status === 'success') {
        this.resetSubtree(node)
        return 'success'
      }
    }
    this.resetSubtree(node)
    return 'failure'
  }

  private tickParallel(
    node: BehaviorTreeParallelNode,
    context: TContext,
    dt: number,
  ): BehaviorTreeStatus {
    let successes = 0
    let failures = 0
    let running = 0
    const successThreshold = node.successThreshold ?? node.children.length
    const failureThreshold = node.failureThreshold ?? 1
    const results = this.parallelResults.get(node.id) ?? new Map<string, BehaviorTreeStatus>()

    for (const child of node.children) {
      const previous = results.get(child.id)
      const status = previous && previous !== 'running'
        ? previous
        : this.tickNode(child, context, dt)
      results.set(child.id, status)
      if (status === 'success') successes += 1
      else if (status === 'failure') failures += 1
      else running += 1
    }
    this.parallelResults.set(node.id, results)

    if (successes >= successThreshold) {
      this.resetSubtree(node)
      return 'success'
    }
    if (failures >= failureThreshold) {
      this.resetSubtree(node)
      return 'failure'
    }
    if (running > 0) return 'running'

    this.resetSubtree(node)
    return 'failure'
  }

  private tickWait(node: BehaviorTreeWaitNode, dt: number): BehaviorTreeStatus {
    const remaining = this.waitRemaining.get(node.id) ?? node.durationSeconds
    const next = Math.max(0, remaining - dt)
    if (next > 0) {
      this.waitRemaining.set(node.id, next)
      return 'running'
    }
    this.waitRemaining.delete(node.id)
    return 'success'
  }

  private resetSubtree(node: BehaviorTreeNode): void {
    this.sequenceCursors.delete(node.id)
    this.waitRemaining.delete(node.id)
    this.parallelResults.delete(node.id)
    if ('children' in node) {
      for (const child of node.children) this.resetSubtree(child)
    }
  }
}
