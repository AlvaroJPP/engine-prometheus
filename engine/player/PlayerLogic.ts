/** Identificador de escopo reservado para variáveis e scripts do jogador controlado. */
export const PLAYER_LOGIC_SCOPE_ID = '__engine_player__'

/** Eventos genéricos que o runtime pode emitir para scripts vinculados ao jogador. */
export const PLAYER_RUNTIME_EVENTS = [
  { id: 'started', label: 'Ao iniciar o jogo', description: 'Disparado uma vez ao entrar no modo Jogar.' },
  { id: 'interact', label: 'Ao interagir', description: 'Disparado quando a tecla de interação configurada é pressionada.' },
  { id: 'jump', label: 'Ao pular', description: 'Disparado quando o personagem inicia um salto válido.' },
] as const

export type PlayerRuntimeEventId = typeof PLAYER_RUNTIME_EVENTS[number]['id']
