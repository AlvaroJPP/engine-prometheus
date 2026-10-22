import type { ModelControlBindings, PackageJsonValue } from '@engine'

export type ImportPackageVector = [number, number, number]
export type ImportPackageVectorAxis = 0 | 1 | 2

const DEFAULT_IMPORT_PACKAGE_VECTOR: ImportPackageVector = [0, 0.55, 0]
const NON_SCALAR_CONFIG_KEYS = new Set(['interactionKey', 'seatOffset', 'controlBindings', 'modelStates'])

/** Indicates which package settings can be represented by a generic scalar input. */
export function isSimplePackageConfigValue(key: string, value: PackageJsonValue): boolean {
  return !NON_SCALAR_CONFIG_KEYS.has(key)
    && (typeof value === 'string' || typeof value === 'number')
}

/** Converts camelCase package setting names to readable labels. */
export function formatPackageConfigLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())
}

/**
 * Parses an input according to the existing package config value type.
 * Invalid or empty numeric input returns null; string inputs preserve whitespace.
 */
export function parseImportPackageConfigScalar(
  input: string,
  fallback: PackageJsonValue,
): string | number | null {
  if (typeof fallback !== 'number') return input
  const raw = input.trim()
  const parsed = Number(raw.replace(',', '.'))
  return raw === '' || !Number.isFinite(parsed) ? null : parsed
}

/** Reads one axis from a package vector, falling back for missing or invalid values. */
export function readImportPackageVectorAxis(
  value: PackageJsonValue,
  axis: ImportPackageVectorAxis,
  fallback: number,
): number {
  if (!Array.isArray(value)) return fallback
  const parsed = Number(value[axis])
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Creates a vector with one updated axis. Values are clamped to [-10, 10].
 * Returns null when the input is not a finite number.
 */
export function updateImportPackageVector(
  value: PackageJsonValue,
  axis: ImportPackageVectorAxis,
  input: string,
): ImportPackageVector | null {
  const raw = input.trim()
  const parsed = Number(raw.replace(',', '.'))
  if (!Number.isFinite(parsed)) return null

  const vector: ImportPackageVector = Array.isArray(value) && value.length === 3
    ? [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
    : [...DEFAULT_IMPORT_PACKAGE_VECTOR]
  vector[axis] = Math.max(-10, Math.min(10, parsed))
  return vector
}

/** Resolves a configured control key, falling back for absent or empty values. */
export function resolveImportPackageControlBinding(
  value: PackageJsonValue,
  key: keyof ModelControlBindings,
  fallback: string,
): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = (value as Record<string, PackageJsonValue>)[key]
    if (typeof item === 'string' && item) return item
  }
  return fallback
}
