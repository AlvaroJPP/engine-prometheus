import type { EngineGameModule, GameModuleContext } from './GameModule'

type RegisteredModule = {
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
  private disposed = false

  register(module: EngineGameModule): () => void {
    if (this.disposed) throw new Error('Não é possível registrar módulos após liberar o registro.')
    const id = module.id.trim()
    if (!id) throw new Error('O módulo de jogo precisa de um identificador não vazio.')
    if (this.modules.has(id)) throw new Error(`Já existe um módulo de jogo registrado com o identificador "${id}".`)
    const record: RegisteredModule = { module, attached: false, active: false, faulted: false }
    this.modules.set(id, record)
    if (this.context) this.attachOne(record)
    return () => this.unregister(id, module)
  }

  attach(context: GameModuleContext): void {
    if (this.disposed) throw new Error('Não é possível associar um registro de módulos já liberado.')
    if (this.context) throw new Error('O registro de módulos já está associado a uma instância da engine.')
    this.context = context
    for (const record of this.modules.values()) this.attachOne(record)
  }

  start(): void {
    if (this.disposed || !this.context || this.runtimeActive) return
    this.runtimeActive = true
    for (const record of this.modules.values()) {
      if (!record.attached || record.faulted) continue
      if (this.invoke(record, 'iniciar runtime', () => record.module.onRuntimeStart?.(this.context!))) {
        record.active = true
      }
    }
  }

  update(dt: number): void {
    if (this.disposed || !this.context || !this.runtimeActive) return
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0
    for (const record of this.modules.values()) {
      if (!record.active || record.faulted || !record.module.update) continue
      this.invoke(record, 'atualizar', () => record.module.update!(safeDt, this.context!))
    }
  }

  stop(): void {
    if (!this.runtimeActive) return
    for (const record of [...this.modules.values()].reverse()) {
      if (!record.active) continue
      this.invoke(record, 'encerrar runtime', () => record.module.onRuntimeStop?.(this.context!))
      record.active = false
    }
    this.runtimeActive = false
  }

  unregister(id: string, expectedModule?: EngineGameModule): void {
    const record = this.modules.get(id)
    if (!record || (expectedModule && record.module !== expectedModule)) return
    if (record.active && this.context) {
      this.invoke(record, 'encerrar runtime', () => record.module.onRuntimeStop?.(this.context!))
      record.active = false
    }
    if (record.attached && this.context) {
      this.invoke(record, 'liberar', () => record.module.onDispose?.(this.context!))
      record.attached = false
    }
    this.modules.delete(id)
  }

  dispose(): void {
    if (this.disposed) return
    this.stop()
    for (const record of [...this.modules.values()].reverse()) {
      if (record.attached && this.context) {
        this.invoke(record, 'liberar', () => record.module.onDispose?.(this.context!))
      }
      record.attached = false
    }
    this.modules.clear()
    this.context = null
    this.disposed = true
  }

  private attachOne(record: RegisteredModule): void {
    if (record.attached || record.faulted || !this.context) return
    if (this.invoke(record, 'associar', () => record.module.onAttach?.(this.context!))) {
      record.attached = true
    }
  }

  private invoke(record: RegisteredModule, phase: string, callback: () => void): boolean {
    try {
      callback()
      return true
    } catch (error) {
      record.faulted = true
      record.active = false
      console.error(`[GameModuleRegistry] O módulo "${record.module.id}" falhou ao ${phase}.`, error)
      return false
    }
  }
}
