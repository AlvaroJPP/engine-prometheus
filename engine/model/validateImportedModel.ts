import * as THREE from 'three'

const MAX_IMPORTED_TRIANGLES = 5_000_000

/** Rejects empty or excessively dense assets before expensive import preparation. */
export function validateImportedModel(model: THREE.Object3D): void {
  let preflightTriangles = 0
  let preflightMeshes = 0
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    preflightMeshes += 1
    const position = child.geometry.getAttribute('position')
    preflightTriangles += child.geometry.index
      ? child.geometry.index.count / 3
      : (position?.count ?? 0) / 3
  })
  if (preflightMeshes === 0 || preflightTriangles === 0) {
    throw new Error('O modelo não contém malhas trianguladas para inserir no mundo.')
  }
  if (preflightTriangles > MAX_IMPORTED_TRIANGLES) {
    throw new Error(`Este modelo contém ${Math.round(preflightTriangles).toLocaleString('pt-BR')} triângulos, acima do limite seguro de ${MAX_IMPORTED_TRIANGLES.toLocaleString('pt-BR')}. Reduza ou otimize o modelo antes de importá-lo.`)
  }
}
