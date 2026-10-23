import * as THREE from 'three'
import type { GltfMetadata } from './GltfMetadata.ts'
import { applyRecoveredBaseColorTexture } from './ModelColorTextureRepair.ts'

/**
 * Valida a seleção do usuário, carrega a imagem incorporada e aplica-a ao
 * material escolhido sem substituir mapas de cor originais válidos.
 */
export async function recoverModelBaseColorTexture(
  root: THREE.Object3D,
  metadata: GltfMetadata | undefined,
  materialIndex: number,
  imageIndex: number,
): Promise<void> {
  const materialInfo = metadata?.materials.find(item => item.index === materialIndex)
  const imageInfo = metadata?.images.find(image => image.index === imageIndex)
  if (!materialInfo || !imageInfo?.uri.startsWith('data:image/')) {
    throw new Error('Selecione uma imagem incorporada válida para este material.')
  }

  const texture = await new THREE.TextureLoader().loadAsync(imageInfo.uri)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.needsUpdate = true
  applyRecoveredBaseColorTexture(root, materialInfo.name, materialIndex, imageIndex, texture)
}
