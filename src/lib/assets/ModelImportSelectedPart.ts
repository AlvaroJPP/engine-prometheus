import * as THREE from 'three'
import type { ModelPreviewPart } from './ModelPreviewParts'

export type PreparedModelImportSelectedPart = {
  model: THREE.Object3D
  height: number
}

/**
 * Extrai uma parte da hierarquia como componente independente.
 * Preserva sua transformação relativa ao modelo raiz, centraliza a geometria,
 * ajusta a altura final e mantém os metadados de animação do arquivo de origem.
 */
export function prepareModelImportSelectedPart(
  root: THREE.Object3D,
  part: ModelPreviewPart,
  targetHeight: number,
): PreparedModelImportSelectedPart {
  root.updateMatrixWorld(true)
  const relativeMatrix = new THREE.Matrix4()
    .copy(root.matrixWorld)
    .invert()
    .multiply(part.object.matrixWorld)

  const imported = part.object.clone(true)
  imported.matrix.copy(relativeMatrix)
  imported.matrix.decompose(imported.position, imported.quaternion, imported.scale)
  imported.matrixAutoUpdate = true
  imported.name = part.name

  const bounds = new THREE.Box3().setFromObject(imported)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) {
    throw new Error('Não foi possível calcular o tamanho da parte selecionada.')
  }

  imported.position.sub(center)
  const scale = targetHeight / size.y
  imported.scale.multiplyScalar(scale)
  imported.position.multiplyScalar(scale)
  imported.userData.importAnimations = root.userData.importAnimations ?? []
  imported.userData.importGltfMetadata = root.userData.importGltfMetadata

  return { model: imported, height: targetHeight }
}
