export type ModelImportCenter = readonly [number, number, number]
export type ModelImportPosition = [number, number, number]

export interface ModelImportTransform {
  height: number
  scale: number
  position: ModelImportPosition
}

/** Clamps edited model height and rounds it to the precision used by the UI. */
export function normalizeModelImportHeight(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const normalized = Math.max(0.1, Math.min(10000, value))
  return Math.round(normalized * 100) / 100
}

/**
 * Calculates the target scale and centered position for a previously measured model.
 * Invalid/non-positive target heights use the importer's default height of 2.
 */
export function calculateModelImportTransform(
  center: ModelImportCenter,
  sourceHeight: number,
  targetHeight: number,
): ModelImportTransform {
  const height = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : 2
  const scale = height / sourceHeight
  return {
    height,
    scale,
    position: [
      -center[0] * scale,
      -center[1] * scale,
      -center[2] * scale,
    ],
  }
}
