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
