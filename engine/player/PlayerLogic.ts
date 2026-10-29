/** Identificador de escopo reservado para variáveis e scripts do jogador controlado. */
export const PLAYER_LOGIC_SCOPE_ID = '__engine_player__'

/** Eventos genéricos que o runtime pode emitir para scripts vinculados ao jogador. */
export const PLAYER_RUNTIME_EVENTS = [
  { id: 'started', label: 'Ao iniciar o jogo', description: 'Disparado uma vez ao entrar no modo Jogar.', requiresKey: false, requiresEventName: false },
  { id: 'interact', label: 'Ao interagir', description: 'Disparado quando a tecla ou o botão de interação configurado é acionado.', requiresKey: false },
  { id: 'jump', label: 'Ao pular', description: 'Disparado quando o personagem inicia um salto válido.', requiresKey: false },
  { id: 'key_pressed', label: 'Ao pressionar uma tecla', description: 'Disparado quando a tecla configurada é pressionada durante o jogo.', requiresKey: true, requiresEventName: false },
  { id: 'key_released', label: 'Ao soltar uma tecla', description: 'Disparado quando a tecla configurada é solta durante o jogo.', requiresKey: true, requiresEventName: false },
  { id: 'custom_event', label: 'Evento personalizado', description: 'Disparado quando um botão de HUD ou outro sistema emite o mesmo identificador.', requiresKey: false, requiresEventName: true },
] as const

export type PlayerRuntimeEventId = typeof PLAYER_RUNTIME_EVENTS[number]['id']

const PLAYER_CUSTOM_EVENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,99}$/

/** Validates stored player event identifiers, including names emitted by HUD buttons. */
export function isValidPlayerScriptEventName(eventId: string): boolean {
  return PLAYER_RUNTIME_EVENTS.some(event => event.id === eventId && event.id !== 'custom_event')
    || (eventId !== 'custom_event' && PLAYER_CUSTOM_EVENT_PATTERN.test(eventId))
}
