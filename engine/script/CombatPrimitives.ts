/**
 * Primitivas de combate independentes de jogo.
 *
 * Este módulo não conoce nomes de recursos, facções, armas ou regras de um jogo.
 * Sistemas específicos descrevem seus dados e delegam os cálculos a estas funções.
 */

export type NumericMap = Readonly<Record<string, number>>
export type ScalingMap = Readonly<Record<string, number | undefined>>

export interface ResourceTransferResult {
  value: number
  changed: number
  accepted: boolean
}

export interface TimedEffectState {
  id: string
  remainingSeconds: number
  potency: number
  stacks: number
}

/** Limita números não finitos usando um fallback explícito. */
export function clampFinite(
  value: number,
  minimum: number,
  maximum: number,
  fallback = minimum,
): number {
  const safe = Number.isFinite(value) ? value : fallback
  return Math.max(minimum, Math.min(maximum, safe))
}

/** Soma escala por atributo e aplica multiplicadores ordenados, retornando magnitude inteira. */
export function calculateScaledMagnitude<A extends object, S extends object>(
  base: number,
  attributes: A,
  scaling: S,
  multipliers: readonly number[] = [],
): number {
  const attributeValues = attributes as Record<string, number>
  const scalingValues = scaling as Record<string, number | undefined>
  let magnitude = Math.max(0, Number.isFinite(base) ? base : 0)
  for (const [attribute, coefficient] of Object.entries(scalingValues)) {
    const score = attributeValues[attribute] ?? 0
    magnitude += Math.max(0, Number.isFinite(score) ? score : 0)
      * Math.max(0, Number.isFinite(coefficient) ? coefficient! : 0)
  }
  for (const multiplier of multipliers) {
    magnitude *= Math.max(0, Number.isFinite(multiplier) ? multiplier : 1)
  }
  return Math.max(0, Math.round(magnitude))
}

/** Calcula o dano depois de resistência percentual e multiplicador crítico. */
export function resolveResistedMagnitude(
  amount: number,
  resistancePercent: number,
  criticalMultiplier = 1,
): number {
  const raw = Math.max(0, Number.isFinite(amount) ? amount : 0)
  const resistance = clampFinite(resistancePercent, -100, 95, 0)
  const critical = Math.max(1, Number.isFinite(criticalMultiplier) ? criticalMultiplier : 1)
  return Math.max(0, Math.round(raw * (1 - resistance / 100) * critical))
}

/** Consome um recurso sem permitir valores negativos ou custos não finitos. */
export function spendResource(
  current: number,
  maximum: number,
  amount: number,
): ResourceTransferResult {
  const limit = Math.max(0, Number.isFinite(maximum) ? maximum : 0)
  const before = clampFinite(current, 0, limit)
  const cost = Math.max(0, Number.isFinite(amount) ? amount : 0)
  if (before < cost) return { value: before, changed: 0, accepted: false }
  const value = clampFinite(before - cost, 0, limit)
  return { value, changed: value - before, accepted: true }
}

/** Restaura um recurso até seu limite e informa quanto realmente foi restaurado. */
export function restoreResource(
  current: number,
  maximum: number,
  amount: number,
): ResourceTransferResult {
  const limit = Math.max(0, Number.isFinite(maximum) ? maximum : 0)
  const before = clampFinite(current, 0, limit)
  const restored = Math.max(0, Number.isFinite(amount) ? amount : 0)
  const value = clampFinite(before + restored, 0, limit)
  return { value, changed: value - before, accepted: value > before }
}

/** Reaplica um efeito temporário: duração e potência máximas, stacks acumulados. */
export function mergeTimedEffect<T extends TimedEffectState>(
  effects: readonly T[],
  incoming: T,
): T[] {
  if (incoming.remainingSeconds <= 0) return [...effects]
  const index = effects.findIndex(effect => effect.id === incoming.id)
  if (index < 0) {
    return [...effects, {
      ...incoming,
      potency: Math.max(0, incoming.potency),
      stacks: clampFinite(Math.round(incoming.stacks), 1, 99, 1),
    }]
  }
  return effects.map((effect, effectIndex) => {
    if (effectIndex !== index) return effect
    return {
      ...effect,
      remainingSeconds: Math.max(effect.remainingSeconds, incoming.remainingSeconds),
      potency: Math.max(effect.potency, incoming.potency, 0),
      stacks: clampFinite(
        effect.stacks + Math.max(1, incoming.stacks),
        1,
        99,
        1,
      ),
    }
  })
}

/** Avança o tempo de vida de efeitos e retorna somente os ainda ativos. */
export function tickTimedEffects<T extends TimedEffectState>(
  effects: readonly T[],
  deltaSeconds: number,
): T[] {
  const delta = clampFinite(deltaSeconds, 0, 1, 0)
  return effects
    .map(effect => ({
      ...effect,
      remainingSeconds: Math.max(0, effect.remainingSeconds - delta),
    }))
    .filter(effect => effect.remainingSeconds > 0)
}

/** Verifica se um instante pertence à janela inclusiva [início, início + duração]. */
export function isWithinTimeWindow(
  eventTime: number,
  windowStart: number,
  windowDuration: number,
): boolean {
  if (![eventTime, windowStart, windowDuration].every(Number.isFinite) || windowDuration < 0) {
    return false
  }
  return eventTime >= windowStart && eventTime <= windowStart + windowDuration
}

/** Calcula um custo com desconto percentual limitado entre 0% e 100%. */
export function applyPercentageDiscount(amount: number, discountFraction: number): number {
  const base = Math.max(0, Number.isFinite(amount) ? amount : 0)
  const discount = clampFinite(discountFraction, 0, 1, 0)
  return Math.max(0, Math.ceil(base * (1 - discount)))
}
