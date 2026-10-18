import * as THREE from 'three'
import { ONE_SHOT_ANIMATION_ROLES } from '../script/packages'
import type { AnimationRole } from '../script/packages'
const LOCOMOTION_ROLES = new Set<string>([
  'walk', 'walk_slow', 'walk_backward', 'walk_left', 'walk_right',
  'walk_diagonal_left', 'walk_diagonal_right', 'walk_backward_diagonal_left', 'walk_backward_diagonal_right',
  'run', 'run_backward', 'run_left', 'run_right', 'run_diagonal_left', 'run_diagonal_right',
  'run_backward_diagonal_left', 'run_backward_diagonal_right', 'crouch_walk', 'prone_crawl',
])

function isLocomotionAnimation(role?: string): boolean {
  return Boolean(role && LOCOMOTION_ROLES.has(role))
}

export type AnimationActionCollection =
  | ReadonlyMap<string, THREE.AnimationAction>
  | Partial<Record<string, THREE.AnimationAction>>

export interface AnimationControllerOptions {
  /** Papéis que podem usar um único clipe reserva quando o modelo não tem o papel solicitado. */
  genericFallback?: boolean
  /** Resposta da transição de pesos: valores altos aproximam o destino mais depressa. */
  blendResponse?: number
  /** Velocidade global opcional, multiplicada pela escala sincronizada dos ciclos. */
  playbackRate?: number
  /** Estado inicial. Não começa a tocar antes de setState/playOneShot ser chamado. */
  initialRole?: string
}

export interface AnimationActionSetOptions {
  /** Para objetos decorativos, permite usar uma animação genérica quando o autor não mapeou papéis. */
  genericFallback?: boolean
}

export const ANIMATION_ROLE_FALLBACKS: Partial<Record<AnimationRole, AnimationRole[]>> = {
  run: ['walk'],
  walk_slow: ['walk'],
  walk_backward: ['walk'],
  walk_left: ['walk_diagonal_left', 'walk'],
  walk_right: ['walk_diagonal_right', 'walk'],
  walk_diagonal_left: ['walk_left', 'walk'],
  walk_diagonal_right: ['walk_right', 'walk'],
  walk_backward_diagonal_left: ['walk_backward', 'walk_left', 'walk'],
  walk_backward_diagonal_right: ['walk_backward', 'walk_right', 'walk'],
  run_backward: ['run', 'walk_backward', 'walk'],
  run_left: ['run_diagonal_left', 'run', 'walk_left', 'walk'],
  run_right: ['run_diagonal_right', 'run', 'walk_right', 'walk'],
  run_diagonal_left: ['run_left', 'run', 'walk_diagonal_left', 'walk'],
  run_diagonal_right: ['run_right', 'run', 'walk_diagonal_right', 'walk'],
  run_backward_diagonal_left: ['run_backward', 'run_left', 'run', 'walk_backward', 'walk'],
  run_backward_diagonal_right: ['run_backward', 'run_right', 'run', 'walk_backward', 'walk'],
  crouch: ['idle'],
  crouch_walk: ['crouch', 'walk'],
  prone: ['idle'],
  prone_crawl: ['prone', 'walk'],
}

/**
 * A única função de classificação usada pelo importador, o avatar e os objetos
 * animados. Reconhece nomes com espaços, underscores, idiomas comuns e tags direcionais.
 */
export function inferAnimationRole(name: string): AnimationRole | 'ignore' {
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s._|:-]+/g, '')

  if (!normalized) return 'ignore'
  if (/dismount|unmount|getoff|dismounting|desmontar|desmontando/.test(normalized)) return 'dismount'
  if (/mounting|mount|saddling|geton|riding|montar|montando|cavalgar|cavalgando/.test(normalized)) return 'mount'
  if (/stoprun|runstop|stoprunning|runningstop|braking|brake|deceleration/.test(normalized)) return 'run_stop'
  if (/jump|leap|hop|fall|saut|salto|pular|pulo/.test(normalized)) return 'jump'
  if (/dodge|evade|sidestepdodge|esquiva/.test(normalized)) return 'dodge'
  if (/slide|sliding|deslizar|escorregar/.test(normalized)) return 'slide'
  if (/roll|rolling|somersault|rolamento|rolar/.test(normalized)) return 'roll'
  if (/reload|recarregar|recarga/.test(normalized)) return 'reload'
  if (/inventory|inventario/.test(normalized)) return 'inventory'
  if (/useitem|consume|drinking|eating|usaritem|usarobjeto/.test(normalized)) return 'use_item'
  if (/ability1|skill1|spell1/.test(normalized)) return 'ability_1'
  if (/ability2|skill2|spell2/.test(normalized)) return 'ability_2'
  if (/ability3|skill3|spell3/.test(normalized)) return 'ability_3'
  if (/ability4|skill4|spell4/.test(normalized)) return 'ability_4'
  if (/secondaryaction|secondaryattack|block|parry|defend|defesa|bloquear/.test(normalized)) return 'secondary_action'
  if (/primaryaction|primaryattack|attack|strike|punch|slash|shoot|melee|atacar|ataque/.test(normalized)) return 'primary_action'
  if (/interact|interaction|useobject|interagir|interacao/.test(normalized)) return 'interact'
  if (/emote|gesture|dance|wave|danca|gesto/.test(normalized)) return 'emote'

  // Classifique postura antes de procurar "walk": nomes como "Crouch Walk"
  // devem continuar sendo caminhada agachada, não um ciclo de caminhada em pé.
  if (/crouchwalk|squatwalk|crouchedwalk|agachadocaminhando/.test(normalized)) return 'crouch_walk'
  if (/crouch|squat|kneel|agachar|agachado/.test(normalized)) return 'crouch'
  if (/pronecrawl|crawl|crawling|rastejar|rastejando/.test(normalized)) return 'prone_crawl'
  if (/prone|lying|lie|deitado/.test(normalized)) return 'prone'
  if (/walkslow|slowwalk|walktired/.test(normalized)) return 'walk_slow'

  const isRun = /gallop|canter|sprint|running|run|jog|dash/.test(normalized)
  const isWalk = /walk|locomotion|move|stride|trot|step|strafe|sidestep|sideways/.test(normalized)
  const isMovement = isRun || isWalk
  const isBackward = /backward|backwards|reverse|walkback|moveback|backward|backleft|backright|backwarddiagonal|tras|atras/.test(normalized)
  const isLeft = /left|izquierda|esquerda|strafeleft|sideleft/.test(normalized)
  const isRight = /right|derecha|direita|straferight|sideright/.test(normalized)
  const explicitlyDiagonal = /diagonal|diag|backleft|backright|backwardleft|backwardright/.test(normalized)

  if (isMovement) {
    const family = isRun ? 'run' : 'walk'
    if (isBackward && isLeft) return (isRun ? 'run_backward_diagonal_left' : 'walk_backward_diagonal_left')
    if (isBackward && isRight) return (isRun ? 'run_backward_diagonal_right' : 'walk_backward_diagonal_right')
    if (isBackward) return isRun ? 'run_backward' : 'walk_backward'
    if (isLeft && (explicitlyDiagonal || /diagonal|diag/.test(normalized))) {
      return isRun ? 'run_diagonal_left' : 'walk_diagonal_left'
    }
    if (isRight && (explicitlyDiagonal || /diagonal|diag/.test(normalized))) {
      return isRun ? 'run_diagonal_right' : 'walk_diagonal_right'
    }
    if (isLeft) return isRun ? 'run_left' : 'walk_left'
    if (isRight) return isRun ? 'run_right' : 'walk_right'
    return family
  }

  if (/idle|stand|rest|breath|neutral|stationary|wait|parado|descanso|respirar/.test(normalized)) return 'idle'
  return 'ignore'
}

/** Cria exatamente uma ação por papel; clipes ignorados nunca entram no mixer. */
export function createAnimationActionMap(
  mixer: THREE.AnimationMixer,
  clips: readonly THREE.AnimationClip[],
  explicitRoles?: Record<string, AnimationRole>,
  options: AnimationActionSetOptions = {},
): Map<string, THREE.AnimationAction> {
  const actions = new Map<string, THREE.AnimationAction>()
  clips.forEach((clip, index) => {
    const explicitRole = explicitRoles?.[String(index)]
    const role = explicitRole ?? inferAnimationRole(clip.name)
    if (!role || role === 'ignore' || actions.has(role)) return
    actions.set(role, mixer.clipAction(clip))
  })

  // Um clipe sem convenção de nome ainda pode ser usado por objetos decorativos,
  // mas nunca será escolhido como corrida ou caminhada de um avatar controlável.
  if (options.genericFallback && !explicitRoles && actions.size === 0 && clips.length > 0) {
    actions.set('__fallback__', mixer.clipAction(clips[0]!))
  }
  return actions
}

/**
 * Controlador único de playback para avatar, montaria e objetos animados.
 * Toda transição passa por um único conjunto de pesos, evitando ações concorrentes,
 * fades acumulados, reinícios de ciclo por frame e one-shots presos no último quadro.
 */
export class AnimationController {
  readonly mixer: THREE.AnimationMixer
  readonly actions: Map<string, THREE.AnimationAction>
  private readonly genericFallback: boolean
  private readonly blendResponse: number
  private readonly playbackRate: number
  private readonly weights = new Map<string, number>()
  private targets = new Map<string, number>()
  private queuedTargets: Map<string, number> | null = null
  private requestedRole = ''
  private activeRole = ''
  private oneShotRole: string | null = null
  private holdOneShotAtEndRole: string | null = null
  private targetCycleScale = 1
  private disposed = false

  constructor(
    mixer: THREE.AnimationMixer,
    sourceActions: AnimationActionCollection,
    options: AnimationControllerOptions = {},
  ) {
    this.mixer = mixer
    this.actions = sourceActions instanceof Map
      ? new Map(sourceActions)
      : new Map(Object.entries(sourceActions).filter((entry): entry is [string, THREE.AnimationAction] => Boolean(entry[1])))
    this.genericFallback = options.genericFallback === true && this.actions.has('__fallback__')
    this.blendResponse = THREE.MathUtils.clamp(options.blendResponse ?? 12, 2, 30)
    this.playbackRate = THREE.MathUtils.clamp(options.playbackRate ?? 1, 0.05, 4)
    if (options.initialRole) this.setState(options.initialRole)
  }

  get currentState(): string { return this.activeRole }
  get desiredState(): string { return this.requestedRole }
  get activeOneShotRole(): string | null { return this.oneShotRole }
  get isOneShotPlaying(): boolean { return this.oneShotRole !== null }
  get isPlaying(): boolean {
    for (const [role, action] of this.actions) {
      if ((this.weights.get(role) ?? 0) > 0.002 && action.isScheduled()) return true
    }
    return false
  }

  hasRole(role: string): boolean { return this.actions.has(role) }

  hasState(role: string): boolean {
    return this.resolveRole(role) !== null
  }

  private resolveRole(role: string): string | null {
    if (this.actions.has(role)) return role
    for (const fallback of ANIMATION_ROLE_FALLBACKS[role as AnimationRole] ?? []) {
      if (this.actions.has(fallback)) return fallback
    }
    if (this.genericFallback && this.actions.has('__fallback__')) return '__fallback__'
    return null
  }

  private normalizeWeights(source: ReadonlyMap<string, number>): Map<string, number> {
    const next = new Map<string, number>()
    for (const [requested, rawWeight] of source) {
      if (!Number.isFinite(rawWeight) || rawWeight <= 1e-5) continue
      const resolved = this.resolveRole(requested)
      if (!resolved) continue
      next.set(resolved, (next.get(resolved) ?? 0) + Math.max(0, rawWeight))
    }
    const total = [...next.values()].reduce((sum, weight) => sum + weight, 0)
    if (total > 1e-5) {
      for (const [role, weight] of next) next.set(role, weight / total)
    }
    return next
  }

  private setTargetWeights(source: ReadonlyMap<string, number>, dominantRole = ''): boolean {
    const normalized = this.normalizeWeights(source)
    this.targets = normalized
    const dominant = dominantRole && normalized.has(dominantRole)
      ? dominantRole
      : [...normalized.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    this.activeRole = dominant === '__fallback__' ? '' : dominant
    return normalized.size > 0
  }

  setState(role: string, force = false): boolean {
    if (this.disposed) return false
    if (ONE_SHOT_ANIMATION_ROLES.has(role as AnimationRole)) {
      if (!force && this.oneShotRole === role && this.actions.get(role)?.isRunning()) return true
      // Não reinicie um clipe pontual a cada quadro se ele já terminou; um novo
      // estado intermediário (por exemplo, pouso em idle) libera um próximo disparo.
      if (!force && this.requestedRole === role && this.oneShotRole === null) return true
      // "force" reinicia a ação, mas continua usando o ciclo de vida one-shot do controlador.
      return this.playOneShot(role, force)
    }
    this.requestedRole = role
    const nextRole = this.resolveRole(role)
    const nextTargets = nextRole ? new Map([[nextRole, 1]]) : new Map<string, number>()
    if (this.oneShotRole && !force) {
      this.queuedTargets = nextTargets
      this.activeRole = role
      return nextTargets.size > 0
    }
    if (force && this.oneShotRole) this.cancelOneShot()
    if (nextRole && nextRole === this.activeRole && this.oneShotRole === null &&
        (this.targets.get(nextRole) ?? 0) > 0.98) return true
    this.queuedTargets = null
    this.targetCycleScale = 1
    return this.setTargetWeights(nextTargets, role)
  }

  /** Define pesos direcionais normalizados. Os pesos atuais convergem sem saltos. */
  setBlendWeights(
    requestedWeights: ReadonlyMap<string, number>,
    cycleSpeedFactor = 1,
    preferredRole = '',
  ): string | null {
    if (this.disposed) return null
    const normalized = this.normalizeWeights(requestedWeights)
    if (this.oneShotRole) {
      this.queuedTargets = normalized
      const dominant = [...normalized.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      this.requestedRole = dominant
      return dominant || null
    }
    this.queuedTargets = null
    this.targetCycleScale = THREE.MathUtils.clamp(
      Number.isFinite(cycleSpeedFactor) ? cycleSpeedFactor : 1,
      0.1,
      2.5,
    )
    const role = this.setTargetWeights(normalized, preferredRole)
    return role ? this.activeRole || null : null
  }

  playOneShot(role: string, restart = true, holdAtEnd = role === 'jump'): boolean {
    if (this.disposed) return false
    const nextRole = this.actions.has(role) ? role : null
    // Ações pontuais não devem cair silenciosamente para idle/walk quando o
    // modelo não contém o clipe solicitado.
    if (!nextRole) return false
    if (this.oneShotRole === nextRole) {
      const active = this.actions.get(nextRole)
      if (!restart && active?.isRunning()) return true
    }

    if (!this.oneShotRole) this.queuedTargets = new Map(this.targets)
    else {
      const previous = this.actions.get(this.oneShotRole)
      previous?.stopFading()
      previous?.stop()
      this.weights.set(this.oneShotRole, 0)
    }

    const action = this.actions.get(nextRole)!
    action.stopFading()
    action.stopWarping()
    action.reset()
    action.enabled = true
    action.paused = false
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.setEffectiveWeight(0)
    action.play()
    this.oneShotRole = nextRole
    this.requestedRole = role
    this.holdOneShotAtEndRole = holdAtEnd ? nextRole : null
    this.targetCycleScale = 1
    this.setTargetWeights(new Map([[nextRole, 1]]), role)
    return true
  }

  /** Interrompe explicitamente um one-shot e retoma o último estado solicitado. */
  cancelOneShot(role?: string): boolean {
    if (!this.oneShotRole || (role && role !== this.oneShotRole)) return false
    const completedRole = this.oneShotRole
    this.oneShotRole = null
    this.holdOneShotAtEndRole = null
    const action = this.actions.get(completedRole)
    if (action) {
      action.stopFading()
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.clampWhenFinished = false
    }
    const restored = this.queuedTargets ?? new Map<string, number>()
    this.queuedTargets = null
    this.setTargetWeights(restored, this.requestedRole)
    return true
  }

  stop(): void {
    this.oneShotRole = null
    this.holdOneShotAtEndRole = null
    this.queuedTargets = null
    this.requestedRole = ''
    this.activeRole = ''
    this.targets.clear()
    this.weights.clear()
    this.mixer.stopAllAction()
  }

  /** Avança os clipes e resolve a conclusão dos one-shots no mesmo lugar. */
  update(deltaSeconds: number): boolean {
    if (this.disposed) return false
    const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.1)
    let sourceRole = ''
    let sourcePhase = 0
    let sourceWeight = 0
    for (const [role, weight] of this.weights) {
      if (weight <= sourceWeight || !isLocomotionAnimation(role)) continue
      const action = this.actions.get(role)
      if (!action || !action.isScheduled() || action.getClip().duration <= 1e-5) continue
      sourceRole = role
      sourceWeight = weight
      sourcePhase = (((action.time % action.getClip().duration) + action.getClip().duration) % action.getClip().duration) / action.getClip().duration
    }

    for (const [role, action] of this.actions) {
      const target = this.targets.get(role) ?? 0
      let current = this.weights.get(role) ?? (action.isScheduled() ? action.getEffectiveWeight() : 0)
      const isOneShot = this.oneShotRole === role

      if (target > 1e-5 && !action.isScheduled()) {
        action.stopFading()
        action.stopWarping()
        action.reset()
        if (!isOneShot && isLocomotionAnimation(role) && sourceRole && sourceRole !== role) {
          action.time = sourcePhase * action.getClip().duration
        }
        action.enabled = true
        action.paused = false
        action.setLoop(isOneShot || ONE_SHOT_ANIMATION_ROLES.has(role as AnimationRole)
          ? THREE.LoopOnce
          : THREE.LoopRepeat, isOneShot || ONE_SHOT_ANIMATION_ROLES.has(role as AnimationRole) ? 1 : Infinity)
        action.clampWhenFinished = isOneShot || ONE_SHOT_ANIMATION_ROLES.has(role as AnimationRole)
        action.play()
      } else if (target > 1e-5 && isOneShot && action.paused) {
        // Um one-shot pausado no último quadro não deve ser reiniciado no retorno ao estado.
        action.paused = false
      }

      action.stopFading()
      action.stopWarping()
      const response = target > current ? this.blendResponse * 1.15 : this.blendResponse
      const alpha = dt <= 0 ? 1 : 1 - Math.exp(-dt * response)
      current = THREE.MathUtils.lerp(current, target, alpha)
      if (Math.abs(current - target) < 0.001) current = target
      this.weights.set(role, current)

      if (action.isScheduled()) {
        const duration = Math.max(0.01, action.getClip().duration)
        const cycleScale = isOneShot ? 1 : this.targetCycleScale
        action.timeScale = this.playbackRate * cycleScale
        if (!isOneShot && isLocomotionAnimation(role) && sourceRole && sourceRole !== role) {
          const sourceDuration = Math.max(0.01, this.actions.get(sourceRole)?.getClip().duration ?? duration)
          // Equal normalized phase speed: cycles of different duration must finish together.
          action.timeScale = this.playbackRate * cycleScale * duration / sourceDuration
        }
        action.setEffectiveWeight(current)
      }

      if (target <= 1e-5 && current < 0.001) {
        action.stop()
        this.weights.delete(role)
      }
    }

    this.mixer.update(dt)
    this.finishOneShotIfNeeded()
    return this.isPlaying
  }

  private finishOneShotIfNeeded(): void {
    const role = this.oneShotRole
    if (!role) return
    const action = this.actions.get(role)
    if (!action) {
      this.cancelOneShot()
      return
    }
    const duration = action.getClip().duration
    const finished = action.isScheduled() && action.paused && action.clampWhenFinished &&
      (duration <= 1e-5 || action.time >= duration - 1e-3)
    if (!finished) return

    // Mantém o último quadro enquanto o peso desce gradualmente para zero.
    // A próxima chamada de update já aplica os pesos do estado de retorno guardado.
    this.oneShotRole = null
    if (this.holdOneShotAtEndRole === role) {
      // O salto pode terminar antes de o personagem pousar. Mantém a pose final
      // sem reiniciar o salto a cada quadro; o próximo estado de gameplay libera a pose.
      this.holdOneShotAtEndRole = null
      this.queuedTargets = null
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      this.setTargetWeights(new Map([[role, 1]]), role)
      return
    }
    const returnTargets = this.queuedTargets ?? new Map<string, number>()
    this.queuedTargets = null
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    this.setTargetWeights(returnTargets, this.requestedRole)
  }

  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.disposed = true
  }
}

/** Obtém o controlador runtime de um objeto importado ou migra um objeto legado. */
export function getAnimationControllerFromObject(root: THREE.Object3D): AnimationController | null {
  const existing = root.userData.importAnimationController
  if (existing instanceof AnimationController) return existing

  const mixer = root.userData.importAnimationMixer as THREE.AnimationMixer | undefined
  if (!mixer) return null
  const source = root.userData.importAnimationActions as Partial<Record<string, THREE.AnimationAction>> | undefined
  const actions = new Map<string, THREE.AnimationAction>(
    Object.entries(source ?? {}).filter((entry): entry is [string, THREE.AnimationAction] => Boolean(entry[1])),
  )
  const legacyFallback = root.userData.importAnimationFallbackAction as THREE.AnimationAction | undefined
  if (legacyFallback && ![...actions.values()].includes(legacyFallback)) actions.set('__fallback__', legacyFallback)

  const controller = new AnimationController(mixer, actions, {
    genericFallback: actions.has('__fallback__'),
  })
  const previousState = root.userData.importAnimationState
  if (typeof previousState === 'string' && previousState && controller.hasState(previousState)) {
    controller.setState(previousState)
  } else {
    const initialRole = ['idle', 'walk', 'run', 'walk_diagonal_left', 'walk_diagonal_right', '__fallback__']
      .find(role => controller.hasRole(role))
    if (initialRole) controller.setState(initialRole)
  }
  root.userData.importAnimationController = controller
  return controller
}

