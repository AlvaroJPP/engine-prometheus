import type { ReusableAnimationAsset } from '@/lib/animation/AnimationRetargeting'

const RETARGET_ANIMATION_LIBRARY_KEY = 'engine-prometheus.reusable-animations.v1'

function isReusableAnimationAsset(value: unknown): value is ReusableAnimationAsset {
  if (!value || typeof value !== 'object') return false
  const item = value as ReusableAnimationAsset
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.sourceName === 'string'
    && Boolean(item.clipJson && typeof item.clipJson === 'object')
    && Array.isArray(item.sourceNodeNames)
    && Boolean(item.sourcePose && typeof item.sourcePose === 'object')
}

/** Carrega apenas registros compatíveis com o formato atual da biblioteca local. */
export function loadRetargetAnimationLibrary(): ReusableAnimationAsset[] {
  try {
    const raw = window.localStorage.getItem(RETARGET_ANIMATION_LIBRARY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isReusableAnimationAsset) : []
  } catch (cause) {
    console.warn('[AnimationRetargeting] Não foi possível ler a biblioteca local.', cause)
    return []
  }
}

/** Persiste a biblioteca e deixa a decisão de feedback visual para a interface. */
export function persistRetargetAnimationLibrary(assets: ReusableAnimationAsset[]): boolean {
  try {
    window.localStorage.setItem(RETARGET_ANIMATION_LIBRARY_KEY, JSON.stringify(assets))
    return true
  } catch (cause) {
    console.warn('[AnimationRetargeting] Não foi possível salvar a biblioteca local.', cause)
    return false
  }
}
