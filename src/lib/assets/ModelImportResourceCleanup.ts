import * as THREE from 'three'
import { disposeThreeObjectResources } from './ThreeObjectResources.ts'
import { collectModelOwnedObjectUrls, revokeOwnedObjectUrls } from './ModelOwnedObjectUrls.ts'

export interface ModelImportResourceCleanupOptions {
  scene?: THREE.Scene | null
  releaseStaticCollider?: (root: THREE.Object3D) => void
  revokeObjectUrl?: (url: string) => void
}

/**
 * Libera os recursos específicos de um modelo importado sem misturar esse ciclo
 * de vida com o reset do estado reativo do diálogo.
 */
export function disposeImportedModelResources(
  root: THREE.Object3D,
  options: ModelImportResourceCleanupOptions = {},
): void {
  options.scene?.remove(root)
  options.releaseStaticCollider?.(root)

  const recoveredTextures = root.userData.importRecoveredTextures as THREE.Texture[] | undefined
  recoveredTextures?.forEach(texture => texture.dispose())

  revokeOwnedObjectUrls(collectModelOwnedObjectUrls(root), options.revokeObjectUrl)
  disposeThreeObjectResources(root, 'renderables')
}
