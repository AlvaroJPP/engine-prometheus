import type { AnimationRole, ControlMapBindings } from '@engine'

/** Papéis de animação disponíveis no importador de modelos. */
export const ANIMATION_ROLE_BASE_OPTIONS: Array<{ value: AnimationRole; label: string }> = [
  { value: 'ignore', label: 'Não usar' },
  { value: 'idle', label: 'Parado / repouso' },
  { value: 'walk', label: 'Andar para frente' },
  { value: 'walk_slow', label: 'Andar devagar (alternância de caminhada)' },
  { value: 'walk_backward', label: 'Andar para trás' },
  { value: 'walk_left', label: 'Deslocar para esquerda' },
  { value: 'walk_right', label: 'Deslocar para direita' },
  { value: 'walk_diagonal_left', label: 'Andar na diagonal esquerda' },
  { value: 'walk_diagonal_right', label: 'Andar na diagonal direita' },
  { value: 'walk_backward_diagonal_left', label: 'Andar para trás e esquerda' },
  { value: 'walk_backward_diagonal_right', label: 'Andar para trás e direita' },
  { value: 'run', label: 'Correr para frente' },
  { value: 'run_backward', label: 'Correr para trás' },
  { value: 'run_left', label: 'Correr para esquerda' },
  { value: 'run_right', label: 'Correr para direita' },
  { value: 'run_diagonal_left', label: 'Correr na diagonal esquerda' },
  { value: 'run_diagonal_right', label: 'Correr na diagonal direita' },
  { value: 'run_backward_diagonal_left', label: 'Correr para trás e esquerda' },
  { value: 'run_backward_diagonal_right', label: 'Correr para trás e direita' },
  { value: 'run_stop', label: 'Parar após correr' },
  { value: 'jump', label: 'Pular' },
  { value: 'crouch', label: 'Agachar parado' },
  { value: 'crouch_walk', label: 'Mover agachado' },
  { value: 'prone', label: 'Deitado / rastejar parado' },
  { value: 'prone_crawl', label: 'Rastejar em movimento' },
  { value: 'dodge', label: 'Esquiva' },
  { value: 'slide', label: 'Deslizar' },
  { value: 'roll', label: 'Rolamento evasivo' },
  { value: 'interact', label: 'Interagir' },
  { value: 'primary_action', label: 'Ação principal / ataque' },
  { value: 'secondary_action', label: 'Ação secundária / defesa' },
  { value: 'inventory', label: 'Abrir inventário' },
  { value: 'use_item', label: 'Usar item' },
  { value: 'reload', label: 'Recarregar' },
  { value: 'ability_1', label: 'Habilidade 1' },
  { value: 'ability_2', label: 'Habilidade 2' },
  { value: 'ability_3', label: 'Habilidade 3' },
  { value: 'ability_4', label: 'Habilidade 4' },
  { value: 'emote', label: 'Emote / gesto' },
  { value: 'mount', label: 'Montar / subir' },
  { value: 'dismount', label: 'Desmontar / descer' },
]
export const ANIMATION_ROLE_CONTROL_BINDING_KEYS: Partial<Record<AnimationRole, keyof ControlMapBindings>> = {
  walk: 'forward',
  walk_slow: 'walkToggle',
  walk_backward: 'backward',
  walk_left: 'left',
  walk_right: 'right',
  walk_diagonal_left: 'left',
  walk_diagonal_right: 'right',
  walk_backward_diagonal_left: 'left',
  walk_backward_diagonal_right: 'right',
  run: 'run',
  run_backward: 'backward',
  run_left: 'left',
  run_right: 'right',
  run_diagonal_left: 'left',
  run_diagonal_right: 'right',
  run_backward_diagonal_left: 'left',
  run_backward_diagonal_right: 'right',
  run_stop: 'run',
  jump: 'jump',
  crouch: 'crouchToggle',
  crouch_walk: 'crouchToggle',
  prone: 'proneToggle',
  prone_crawl: 'proneToggle',
  dodge: 'dodge',
  slide: 'slide',
  roll: 'roll',
  interact: 'interact',
  mount: 'interact',
  dismount: 'interact',
  primary_action: 'primaryAction',
  secondary_action: 'secondaryAction',
  inventory: 'inventory',
  use_item: 'useItem',
  reload: 'reload',
  ability_1: 'ability1',
  ability_2: 'ability2',
  ability_3: 'ability3',
  ability_4: 'ability4',
  emote: 'emote',
}

const DIAGONAL_MOVEMENT_ROLES: ReadonlySet<AnimationRole> = new Set([
  'walk_diagonal_left',
  'walk_diagonal_right',
  'run_diagonal_left',
  'run_diagonal_right',
])
const GENERIC_ROLES_FOR_DIAGONAL_CLIPS: ReadonlySet<AnimationRole> = new Set([
  'ignore',
  'walk',
  'run',
])

/**
 * Resolve persisted roles for freshly imported animation clips.
 * Invalid saved values fall back to inference. Older generic classifications
 * are re-inferred for diagonal clips, while explicit specific roles are retained.
 */
export function resolveImportedAnimationRoles(
  clips: readonly { name: string }[],
  savedRoles: Readonly<Record<string, AnimationRole>> | undefined,
  inferRole: (clipName: string) => AnimationRole,
): Record<string, AnimationRole> {
  const recognizedRoles = new Set(ANIMATION_ROLE_BASE_OPTIONS.map(option => option.value))
  const roles: Record<string, AnimationRole> = {}

  clips.forEach((clip, index) => {
    const savedRole = savedRoles?.[String(index)]
    const guessedRole = inferRole(clip.name)
    const guessedIsDiagonal = DIAGONAL_MOVEMENT_ROLES.has(guessedRole)
    const canReuseSavedRole = savedRole
      && recognizedRoles.has(savedRole)
      && !(guessedIsDiagonal && GENERIC_ROLES_FOR_DIAGONAL_CLIPS.has(savedRole))

    roles[String(index)] = canReuseSavedRole ? savedRole : guessedRole
  })

  return roles
}
