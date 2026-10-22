import type { PackageJsonValue } from '@engine'

/**
 * Clona valores JSON de configurações sem usar structuredClone, que rejeita
 * objetos Proxy reativos do Vue.
 */
export function clonePackageJsonValue(value: PackageJsonValue): PackageJsonValue {
  if (Array.isArray(value)) return value.map(clonePackageJsonValue)
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, PackageJsonValue> = {}
    for (const [key, nested] of Object.entries(value)) {
      copy[key] = clonePackageJsonValue(nested)
    }
    return copy
  }
  return value
}

export function clonePackageJsonRecord(
  record: Record<string, PackageJsonValue>,
): Record<string, PackageJsonValue> {
  return clonePackageJsonValue(record) as Record<string, PackageJsonValue>
}
