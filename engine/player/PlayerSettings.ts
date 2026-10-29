export interface PlayerSettings {
  /** Velocidade de caminhada em unidades do mundo por segundo. */
  walkSpeed: number
  /** Multiplicador aplicado enquanto o jogador corre. */
  runMultiplier: number
  /** Impulso vertical inicial do salto. */
  jumpSpeed: number
  /** Aceleração gravitacional aplicada ao jogador a pé. */
  gravity: number
  /** Raio base do colisor, normalizado para um personagem de 1,8 unidade de altura. */
  colliderRadius: number
}

export const DEFAULT_PLAYER_SETTINGS: Readonly<PlayerSettings> = Object.freeze({
  walkSpeed: 4.2,
  runMultiplier: 1.7,
  jumpSpeed: 6.2,
  gravity: 18,
  colliderRadius: 0.32,
})

function bounded(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

/** Normaliza parâmetros do jogador para proteger projetos antigos ou editados externamente. */
export function sanitizePlayerSettings(value?: Partial<PlayerSettings> | null): PlayerSettings {
  return {
    walkSpeed: bounded(value?.walkSpeed, DEFAULT_PLAYER_SETTINGS.walkSpeed, 0.5, 15),
    runMultiplier: bounded(value?.runMultiplier, DEFAULT_PLAYER_SETTINGS.runMultiplier, 1, 3),
    jumpSpeed: bounded(value?.jumpSpeed, DEFAULT_PLAYER_SETTINGS.jumpSpeed, 0, 14),
    gravity: bounded(value?.gravity, DEFAULT_PLAYER_SETTINGS.gravity, 2, 40),
    colliderRadius: bounded(value?.colliderRadius, DEFAULT_PLAYER_SETTINGS.colliderRadius, 0.1, 0.8),
  }
}
