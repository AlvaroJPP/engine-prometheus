import * as THREE from 'three'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import { getStaticMeshCollisionData } from '@engine/world/StaticMeshCollider'
import type { ModelControlBindings } from '@engine'
import { clonePackageJsonRecord } from '../PackageJson'
import type { ImportBehaviorPackageDraft } from './ImportBehaviorPackageDrafts'
import type { ModelPreviewPart } from './ModelPreviewParts'

export type ModelImportBatchItem = {
  partId: string
  name: string
  model: THREE.Object3D
  height: number
}

export type ModelImportBatchPreparationOptions = {
  root: THREE.Object3D
  parts: ModelPreviewPart[]
  scaleFactor: number
  colliderType: 'box' | 'sphere' | 'capsule' | 'mesh' | 'none'
  controlBindings: ModelControlBindings
  behaviorPackageIds: string[]
  ensureBehaviorPackageDraft: (packageId: string) => ImportBehaviorPackageDraft
}

/**
 * Prepara clones independentes das partes selecionadas para salvamento em lote.
 * Preserva transformações relativas ao modelo raiz e configura os metadados
 * de colisão, controles e pacotes para cada componente resultante.
 */
export function prepareModelImportBatchItems(
  options: ModelImportBatchPreparationOptions,
): ModelImportBatchItem[] {
  const {
    root,
    parts,
    scaleFactor,
    colliderType,
    controlBindings,
    behaviorPackageIds,
    ensureBehaviorPackageDraft,
  } = options
  const entries: ModelImportBatchItem[] = []

  root.updateMatrixWorld(true)

  for (const part of parts) {
    const relativeMatrix = new THREE.Matrix4()
      .copy(root.matrixWorld)
      .invert()
      .multiply(part.object.matrixWorld)
    const imported = cloneSkinnedModel(part.object)
    imported.matrix.copy(relativeMatrix)
    imported.matrix.decompose(imported.position, imported.quaternion, imported.scale)
    imported.matrixAutoUpdate = true
    imported.name = part.name
    imported.traverse(node => { node.visible = true })
    imported.updateMatrixWorld(true)

    const bounds = new THREE.Box3().setFromObject(imported)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) {
      throw new Error(`Não foi possível calcular as dimensões de "${part.name}".`)
    }

    imported.position.sub(center)
    imported.scale.multiplyScalar(scaleFactor)
    imported.position.multiplyScalar(scaleFactor)
    imported.updateMatrixWorld(true)

    const scaledSize: [number, number, number] = [
      Math.max(0.05, size.x * scaleFactor),
      Math.max(0.05, size.y * scaleFactor),
      Math.max(0.05, size.z * scaleFactor),
    ]
    let partColliderSize = scaledSize
    if (colliderType === 'sphere') {
      const diameter = Math.max(0.05, Math.min(...scaledSize))
      partColliderSize = [diameter, diameter, diameter]
    }

    if (colliderType === 'mesh') {
      const partCollisionData = getStaticMeshCollisionData(imported)
      if (!partCollisionData) {
        throw new Error(`A parte "${part.name}" não pode usar malha estática. Ela precisa conter geometria estática e ficar abaixo de 5 milhões de triângulos.`)
      }
    }

    imported.userData.importColliderType = colliderType
    imported.userData.importColliderSize = partColliderSize
    // Cada parte é centralizada durante a extração, então seu colisor também
    // começa no centro local próprio, sem herdar o offset do modelo-cidade.
    imported.userData.importColliderOffset = [0, 0, 0]
    imported.userData.importAnimations = []
    imported.userData.importAnimationRoles = {}
    imported.userData.importControlBindings = { ...controlBindings }
    imported.userData.importBehaviorPackageIds = [...behaviorPackageIds]

    const behaviorPackageSettings: Record<string, ImportBehaviorPackageDraft> = {}
    for (const packageId of behaviorPackageIds) {
      const draft = ensureBehaviorPackageDraft(packageId)
      behaviorPackageSettings[packageId] = {
        variables: { ...draft.variables },
        config: clonePackageJsonRecord(draft.config),
      }
    }
    imported.userData.importBehaviorPackageSettings = behaviorPackageSettings
    imported.userData.sceneKind = 'object'
    imported.userData.componentLogic = []

    entries.push({
      partId: part.id,
      name: part.name,
      model: imported,
      height: Math.max(0.05, scaledSize[1]),
    })
  }

  return entries
}
