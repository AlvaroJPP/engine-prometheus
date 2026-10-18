import * as THREE from 'three'

/** Duração comum de blend para ações e locomoção do avatar e dos modelos importados. */
export interface AnimationBlendOptions {
  duration?: number
  /** Mantém a fase do ciclo ao passar entre duas animações repetitivas de locomoção. */
  synchronizePhase?: boolean
  /** Reinicia o clipe de destino; deve ser true para disparos de ações/one-shots. */
  restart?: boolean
}

const LOCOMOTION_ROLES = new Set([
  'walk', 'walk_slow', 'walk_backward', 'walk_left', 'walk_right',
  'walk_diagonal_left', 'walk_diagonal_right', 'walk_backward_diagonal_left', 'walk_backward_diagonal_right',
  'run', 'run_backward',
  'run_left', 'run_right', 'run_diagonal_left', 'run_diagonal_right',
  'run_backward_diagonal_left', 'run_backward_diagonal_right',
  'crouch_walk', 'prone_crawl',
])

export function isLocomotionAnimation(role?: string): boolean {
  return Boolean(role && LOCOMOTION_ROLES.has(role))
}

/**
 * Blend contextual em vez de usar um único fade rígido para todas as situações.
 * Mudanças entre ciclos sincronizam os pés; entradas/saídas de idle têm mais
 * tempo para a pose do corpo assentar; ações rápidas continuam responsivas.
 */
export function getAnimationBlendDuration(
  fromRole?: string,
  toRole?: string,
  oneShot = false,
): number {
  if (oneShot) return 0.16
  if (fromRole === toRole) return 0.12
  if (isLocomotionAnimation(fromRole) && isLocomotionAnimation(toRole)) return 0.22
  if (fromRole === 'idle' || toRole === 'idle') return 0.3
  if (fromRole === 'jump' || toRole === 'jump') return 0.2
  if (fromRole === 'crouch' || toRole === 'crouch' || fromRole === 'prone' || toRole === 'prone') return 0.26
  return 0.24
}

/**
 * Troca ações por fade cruzado, preservando a continuidade de fase para
 * locomoções. A função limpa fades antigos para que reversões rápidas
 * (andar → correr → andar) não deixem clipes presos em pesos parciais.
 */
export function blendAnimationActions(
  allActions: Iterable<THREE.AnimationAction>,
  current: THREE.AnimationAction | undefined,
  next: THREE.AnimationAction,
  options: AnimationBlendOptions = {},
): void {
  const duration = THREE.MathUtils.clamp(options.duration ?? 0.24, 0, 1.5)
  const restart = options.restart ?? true
  const actions = new Set(allActions)

  if (current === next && next.isRunning() && !restart) return

  next.stopFading()
  next.stopWarping()

  if (restart || !next.isRunning()) {
    let phase = 0
    const sourceDuration = current?.getClip().duration ?? 0
    const targetDuration = next.getClip().duration
    if (
      options.synchronizePhase &&
      current &&
      current !== next &&
      current.isRunning() &&
      sourceDuration > 1e-5 &&
      targetDuration > 1e-5
    ) {
      phase = ((current.time % sourceDuration) + sourceDuration) % sourceDuration / sourceDuration
    }

    next.reset()
    if (phase > 0) next.time = phase * targetDuration
  }

  next.enabled = true
  next.setEffectiveWeight(1)
  next.play()

  if (duration <= 1e-4) next.setEffectiveWeight(1)
  else next.fadeIn(duration)

  for (const action of actions) {
    // A LoopOnce com clampWhenFinished fica pausada na última pose: não está
    // "running", mas segue agendada no mixer e precisa fazer fade-out também.
    if (action === next || !action.isScheduled()) continue
    action.stopFading()
    if (duration <= 1e-4) action.stop()
    else action.fadeOut(duration)
  }
}
