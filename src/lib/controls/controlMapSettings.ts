import {
  createDefaultControlMapSettings,
  DEFAULT_CONTROL_MAPS,
} from '@engine'
import type {
  ControlMapBindings,
  ControlMapProfile,
  ControlMapSettings,
} from '@engine'

const STORAGE_KEY = 'engine-prometheus.control-maps.v1'
const BINDING_KEYS: (keyof ControlMapBindings)[] = [
  'forward',
  'backward',
  'left',
  'right',
  'run',
  'jump',
  'interact',
  'toggleFirstPerson',
  'cycleCamera',
  'exitRuntime',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBindings(value: unknown, fallback: ControlMapBindings): ControlMapBindings {
  const input = isRecord(value) ? value : {}
  const normalized = { ...fallback }
  for (const key of BINDING_KEYS) {
    const candidate = input[key]
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 40) {
      normalized[key] = candidate
    }
  }
  return normalized
}

function normalizeProfile(value: unknown, fallback?: ControlMapProfile): ControlMapProfile | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 48) : ''
  if (!id || id.length > 100 || !name) return null
  const bindings = normalizeBindings(value.bindings, fallback?.bindings ?? DEFAULT_CONTROL_MAPS[0]!.bindings)
  return {
    id,
    name,
    ...(fallback?.builtIn || value.builtIn === true ? { builtIn: true } : {}),
    bindings,
  }
}

/** Lê perfis do computador e mantém disponíveis todos os mapas incluídos no Engine. */
export function loadControlMapSettings(): ControlMapSettings {
  const defaults = createDefaultControlMapSettings()
  if (typeof window === 'undefined') return defaults

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !Array.isArray(parsed.profiles)) return defaults

    const savedProfiles = parsed.profiles
      .map(profile => {
        const fallback = isRecord(profile) && typeof profile.id === 'string'
          ? DEFAULT_CONTROL_MAPS.find(item => item.id === profile.id)
          : undefined
        return normalizeProfile(profile, fallback)
      })
      .filter((profile): profile is ControlMapProfile => profile !== null)
    const savedById = new Map(savedProfiles.map(profile => [profile.id, profile]))
    const builtInIds = new Set(DEFAULT_CONTROL_MAPS.map(profile => profile.id))
    const profiles = DEFAULT_CONTROL_MAPS.map(defaultProfile => {
      const saved = savedById.get(defaultProfile.id)
      return saved
        ? {
            ...defaultProfile,
            name: saved.name,
            bindings: normalizeBindings(saved.bindings, defaultProfile.bindings),
          }
        : { ...defaultProfile, bindings: { ...defaultProfile.bindings } }
    })

    const usedIds = new Set(profiles.map(profile => profile.id))
    for (const saved of savedProfiles) {
      if (builtInIds.has(saved.id) || saved.builtIn || usedIds.has(saved.id)) continue
      usedIds.add(saved.id)
      profiles.push(saved)
    }

    const requestedActiveId = typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : ''
    const activeProfileId = profiles.some(profile => profile.id === requestedActiveId)
      ? requestedActiveId
      : defaults.activeProfileId

    return { profiles, activeProfileId }
  } catch (error) {
    console.warn('[ControlMaps] Não foi possível carregar os mapas; usando os padrões.', error)
    return defaults
  }
}

export function saveControlMapSettings(settings: ControlMapSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.warn('[ControlMaps] Não foi possível salvar os mapas de controle.', error)
  }
}
