import * as THREE from 'three'

export type ModelSpatialDimensions = [number, number, number]
export type ModelSpatialCenter = [number, number, number]

export interface ModelSpatialMeasurement {
  dimensions: ModelSpatialDimensions
  height: number
  center: ModelSpatialCenter
}

/**
 * Mede limites e centro global da hierarquia importada antes da normalização.
 * O centro retornado é aplicado somente depois da escala para evitar offsets
 * gigantes em assets cujas coordenadas de origem são muito grandes.
 */
export function measureModelImportSpatialData(root: THREE.Object3D): ModelSpatialMeasurement {
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  if (bounds.isEmpty()) throw new Error('O arquivo não contém uma malha 3D visível.')

  const size = bounds.getSize(new THREE.Vector3())
  if (![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x, size.y, size.z) <= 0) {
    throw new Error('Não foi possível calcular o tamanho deste modelo.')
  }

  const center = bounds.getCenter(new THREE.Vector3())
  return {
    dimensions: [size.x, size.y, size.z],
    height: size.y,
    center: center.toArray() as ModelSpatialCenter,
  }
}
