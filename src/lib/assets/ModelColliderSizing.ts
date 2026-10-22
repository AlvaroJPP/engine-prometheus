export type ImportColliderType = 'box' | 'sphere' | 'capsule' | 'mesh' | 'none'
export type ImportColliderSize = [number, number, number]

/** Aplica a escala final e os limites mínimos ao tamanho do colisor de importação. */
export function calculateImportColliderSize(
  dimensions: readonly [number, number, number],
  scale: number,
  type: ImportColliderType,
): ImportColliderSize {
  const scaledSize = dimensions.map(value => Math.max(0.05, value * scale)) as ImportColliderSize
  if (type !== 'sphere') return scaledSize
  const diameter = Math.max(0.05, Math.min(...scaledSize))
  return [diameter, diameter, diameter]
}

export type ImportColliderOffset = [number, number, number]
export type ImportColliderVectorField = 'colliderSize' | 'colliderOffset'

/** Normaliza tamanho/offset ao trocar o formato do colisor no importador. */
export function normalizeImportColliderForType(
  type: ImportColliderType,
  size: readonly [number, number, number],
  offset: readonly [number, number, number],
): { size: ImportColliderSize; offset: ImportColliderOffset } {
  const nextSize: ImportColliderSize = [...size]
  const nextOffset: ImportColliderOffset = [...offset]

  if (type === 'mesh') {
    nextOffset.splice(0, 3, 0, 0, 0)
  } else if (type === 'sphere') {
    const diameter = Math.max(0.05, Math.min(...nextSize))
    nextSize.splice(0, 3, diameter, diameter, diameter)
  }

  return { size: nextSize, offset: nextOffset }
}

/**
 * Atualiza um eixo do tamanho/offset com os mesmos limites do formulário.
 * Colisores esféricos mantêm os três eixos iguais; valores não finitos são ignorados.
 */
export function updateImportColliderVector(
  current: readonly [number, number, number],
  field: ImportColliderVectorField,
  axis: 0 | 1 | 2,
  value: number,
  type: ImportColliderType,
): ImportColliderSize | ImportColliderOffset | null {
  if (!Number.isFinite(value)) return null

  const vector: ImportColliderSize | ImportColliderOffset = [...current]
  const safeValue = field === 'colliderSize'
    ? Math.max(0.05, Math.min(100, value))
    : Math.max(-100, Math.min(100, value))
  vector[axis] = safeValue

  if (field === 'colliderSize' && type === 'sphere') {
    vector.splice(0, 3, safeValue, safeValue, safeValue)
  }
  return vector
}
