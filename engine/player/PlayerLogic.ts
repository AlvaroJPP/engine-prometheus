/** Identificador de escopo reservado para variáveis e scripts do jogador controlado. */
export const PLAYER_LOGIC_SCOPE_ID = '__engine_player__'

/** Eventos genéricos que o runtime pode emitir para scripts vinculados ao jogador. */
export const PLAYER_RUNTIME_EVENTS = [
  { id: 'started', label: 'Ao iniciar o jogo', description: 'Disparado uma vez ao entrar no modo Jogar.', requiresKey: false },
  { id: 'interact', label: 'Ao interagir', description: 'Disparado quando a tecla ou o botão de interação configurado é acionado.', requiresKey: false },
  { id: 'jump', label: 'Ao pular', description: 'Disparado quando o personagem inicia um salto válido.', requiresKey: false },
  { id: 'key_pressed', label: 'Ao pressionar uma tecla', description: 'Disparado quando a tecla configurada é pressionada durante o jogo.', requiresKey: true },
  { id: 'key_released', label: 'Ao soltar uma tecla', description: 'Disparado quando a tecla configurada é solta durante o jogo.', requiresKey: true },
] as const

export type PlayerRuntimeEventId = typeof PLAYER_RUNTIME_EVENTS[number]['id']
