import type { EngineGameModule, GameModuleContext } from './GameModule'

type RegisteredModule = {
  id: string
  module: EngineGameModule
  attached: boolean
  active: boolean
  faulted: boolean
}

/** Gerencia o ciclo de vida dos módulos de jogo sem acoplar o núcleo a um jogo específico. */
export class GameModuleRegistry {
  private readonly modules = new Map<string, RegisteredModule>()
  private context: GameModuleContext | null = null
  private runtimeActive = false
  private stopping = false
  private disposed = false

  register(module: EngineGameModule): () => void {
    if (this.disposed) throw new Error('Não é possível registrar módulos após liberar o registro.')
    const id = module.id.trim()
    if (!id) throw new Error('O módulo de jogo precisa de um identificador não vazio.')
    if (this.modules.has(id)) throw new Error(`Já existe um módulo de jogo registrado com o identificador "${id}".`)
    const record: RegisteredModule = { id, module, attached: false, active: false, faulted: false }
    this.modules.set(id, record)
    if (this.context) {
      this.attachOne(record)
      // Registros dinâmicos feitos durante o jogo entram no ciclo atual sem esperar outra execução.
      if (
        this.runtimeActive &&
        this.modules.get(id) === record &&
        record.attached &&
        !record.faulted
      ) {
        const started = this.invoke(record, 'iniciar runtime', () => module.onRuntimeStart?.(this.context!))
        // O callback pode remover o próprio módulo ou encerrar o runtime.
        // Só marque como ativo se ele ainda estiver registrado e o runtime continuar aberto.
        if (!started || this.modules.get(id) !== record) return () => this.unregister(id, module)
        if (this.runtimeActive && !this.disposed) {
          record.active = true
        } else if (!this.disposed) {
          // stop() executado dentro de onRuntimeStart não consegue ver este
          // registro como ativo ainda; finalize a inicialização parcial aqui.
          this.invoke(record, 'encerrar runtime', () => module.onRuntimeStop?.(this.context!))
        }
      }
    }
    return () => this.unregister(id, module)
  }

  attach(context: GameModuleContext): void {
    if (this.disposed) throw new Error('Não é possível associar um registro de módulos já liberado.')
    if (this.context) throw new Error('O registro de módulos já está associado a uma instância da engine.')
    this.context = context
    for (const record of this.modules.values()) this.attachOne(record)
  }

  start(): void {
    if (this.disposed || this.stopping || !this.context || this.runtimeActive) return
    this.runtimeActive = true
    // Um callback pode registrar outros módulos. Use um snapshot para que
    // módulos anexados dinamicamente sejam iniciados uma única vez por register().
    for (const record of [...this.modules.values()]) {
      if (!this.runtimeActive || this.disposed) break
      if (this.modules.get(record.id) !== record || !record.attached || record.faulted) continue
      const started = this.invoke(record, 'iniciar runtime', () => record.module.onRuntimeStart?.(this.context!))
      if (!started || this.modules.get(record.id) !== record) continue
      if (this.runtimeActive && !this.disposed) {
        record.active = true
      } else if (!this.disposed) {
        // onRuntimeStart pode pedir stop() de forma reentrante. Como o módulo
        // ainda não estava marcado ativo, stop() não o viu; finalize-o aqui.
        this.invoke(record, 'encerrar runtime', () => record.module.onRuntimeStop?.(this.context!))
      }
    }
  }

  dispatchKeyDown(event: KeyboardEvent): boolean {
    if (this.disposed || !this.context || !this.runtimeActive) return false
    let handled = false
    for (const record of [...this.modules.values()]) {
      if (!this.runtimeActive || this.disposed) break
      if (this.modules.get(record.id) !== record || !record.active || record.faulted || !record.module.onKeyDown) continue
      try {
        handled = record.module.onKeyDown(event, this.context) === true || handled
      } catch (error) {
        this.fail(record, 'processar keydown', error)
      }
    }
    return handled
  }

  dispatchKeyUp(event: KeyboardEvent): void {
    if (this.disposed || !this.context || !this.runtimeActive) return
    for (const record of [...this.modules.values()]) {
      if (!this.runtimeActive || this.disposed) break
      if (this.modules.get(record.id) !== record || !record.active || record.faulted || !record.module.onKeyUp) continue
      try {
        record.module.onKeyUp(event, this.context)
      } catch (error) {
        this.fail(record, 'processar keyup', error)
      }
    }
  }

  dispatchInputBlur(): void {
    if (this.disposed || !this.context || !this.runtimeActive) return
    for (const record of [...this.modules.values()]) {
      if (!this.runtimeActive || this.disposed) break
      if (this.modules.get(record.id) !== record || !record.active || record.faulted || !record.module.onInputBlur) continue
      try {
        record.module.onInputBlur(this.context)
      } catch (error) {
        this.fail(record, 'limpar estado de entrada', error)
      }
    }
  }

  update(dt: number): void {
    if (this.disposed || !this.context || !this.runtimeActive) return
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0
    for (const record of [...this.modules.values()]) {
      if (!this.runtimeActive || this.disposed) break
      if (this.modules.get(record.id) !== record || !record.active || record.faulted || !record.module.update) continue
      this.invoke(record, 'atualizar', () => record.module.update!(safeDt, this.context!))
    }
  }

  stop(): void {
    if (!this.runtimeActive || this.stopping) return
    // Capture o contexto e bloqueie transições reentrantes antes dos callbacks.
    // Um onRuntimeStop pode chamar dispose(), que limpa this.context.
    const context = this.context
    this.runtimeActive = false
    this.stopping = true
    try {
      for (const record of [...this.modules.values()].reverse()) {
        if (!record.active || this.modules.get(record.id) !== record) continue
        // Atualize o estado antes do callback para impedir stop reentrante duplicado.
        record.active = false
        if (context) this.invoke(record, 'encerrar runtime', () => record.module.onRuntimeStop?.(context))
      }
    } finally {
      this.stopping = false
    }
  }

  unregister(id: string, expectedModule?: EngineGameModule): void {
    const record = this.modules.get(id)
    if (!record || (expectedModule && record.module !== expectedModule)) return

    // Remova e atualize o estado antes dos callbacks: eles podem chamar unregister,
    // dispose ou registrar novamente um módulo com o mesmo identificador.
    this.modules.delete(id)
    const context = this.context
    const wasActive = record.active
    const wasAttached = record.attached
    record.active = false
    record.attached = false

    // Preserve the original context if onRuntimeStop triggers dispose() reentrantly.
    if (wasActive && context) {
      this.invoke(record, 'encerrar runtime', () => record.module.onRuntimeStop?.(context))
    }
    if (wasAttached && context) {
      this.invoke(record, 'liberar', () => record.module.onDispose?.(context))
    }
  }

  dispose(): void {
    if (this.disposed) return
    // Bloqueie novos registros antes de executar callbacks de encerramento.
    this.disposed = true
    this.stop()
    for (const record of [...this.modules.values()].reverse()) {
      this.unregister(record.id, record.module)
    }
    this.modules.clear()
    this.context = null
  }

  private attachOne(record: RegisteredModule): void {
    if (record.attached || record.faulted || !this.context) return

    // Marque a tentativa antes do callback: onAttach pode criar recursos e falhar
    // no meio. Nesse caso, unregister/dispose ainda deve chamar onDispose para
    // permitir que o módulo limpe os recursos parcialmente inicializados.
    record.attached = true
    this.invoke(record, 'associar', () => record.module.onAttach?.(this.context!))
  }

  private invoke(record: RegisteredModule, phase: string, callback: () => void): boolean {
    try {
      callback()
      return true
    } catch (error) {
      this.fail(record, phase, error)
      return false
    }
  }

  private fail(record: RegisteredModule, phase: string, error: unknown): void {
    record.faulted = true
    record.active = false
    console.error(`[GameModuleRegistry] O módulo "${record.module.id}" falhou ao ${phase}.`, error)
  }
}
