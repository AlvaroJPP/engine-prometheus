import type { CollisionSystem } from '../world/CollisionSystem'
import type { HumanoidAvatar } from '../world/HumanoidAvatar'
import type { World } from '../world/World'
import type { RuleEngine } from '../script/RuleEngine'

/** Recursos estáveis do núcleo disponibilizados a módulos de jogo. */
export interface GameModuleContext {
  readonly world: World
  readonly logic: RuleEngine
  readonly avatar: HumanoidAvatar
  readonly collisions: CollisionSystem
  isRuntimeActive(): boolean
  invalidate(): void
}

/** Contrato de extensão para jogos construídos sobre o Engine Prometheus. */
export interface EngineGameModule {
  /** Identificador único do módulo, por exemplo "meu-jogo". */
  readonly id: string
  /** Executado uma vez quando o módulo é associado a uma instância da engine. */
  onAttach?(context: GameModuleContext): void
  /** Executado quando o usuário inicia o modo de jogo. */
  onRuntimeStart?(context: GameModuleContext): void
  /** Processa uma tecla pressionada; true indica que o módulo consumiu a ação. */
  onKeyDown?(event: KeyboardEvent, context: GameModuleContext): boolean | void
  /** Processa a liberação de uma tecla. */
  onKeyUp?(event: KeyboardEvent, context: GameModuleContext): void
  /** Limpa estados de entrada quando a janela perde o foco. */
  onInputBlur?(context: GameModuleContext): void
  /** Atualização por frame, somente enquanto o modo de jogo está ativo. */
  update?(dt: number, context: GameModuleContext): void
  /** Executado ao voltar do modo de jogo para o editor. */
  onRuntimeStop?(context: GameModuleContext): void
  /** Libera recursos e listeners pertencentes ao módulo. */
  onDispose?(context: GameModuleContext): void
}
