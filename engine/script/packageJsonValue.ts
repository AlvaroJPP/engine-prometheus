import type { PackageJsonValue } from './packages'

/** Validates JSON-compatible package values and caps recursion depth for untrusted input. */
export function isPackageJsonValue(value: unknown, depth = 0): value is PackageJsonValue {
  if (depth > 16) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => isPackageJsonValue(item, depth + 1))
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(item => isPackageJsonValue(item, depth + 1))
  }
  return false
}
