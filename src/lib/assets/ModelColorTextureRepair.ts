import * as THREE from 'three'

/**
 * Reaplica a textura base-color somente em materiais sem mapa ou com mapa
 * previamente atribuído por este reparador. Mapas originais válidos nunca são
 * sobrescritos; mapas normal, roughness e emissive permanecem intactos.
 */
export function applyRecoveredBaseColorTexture(
  root: THREE.Object3D,
  materialName: string,
  materialIndex: number,
  imageIndex: number,
  texture: THREE.Texture,
): void {
  const recoveredTextures = (root.userData.importRecoveredTextures as THREE.Texture[] | undefined) ?? []
  let assigned = 0

  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) {
      if (material.name !== materialName || !('map' in material)) continue
      const standard = material as THREE.MeshStandardMaterial
      if (standard.map && !recoveredTextures.includes(standard.map)) continue
      standard.map = texture
      standard.needsUpdate = true
      assigned += 1
    }
  })

  if (!assigned) {
    texture.dispose()
    throw new Error(`Não encontrei malhas usando o material "${materialName || `Material ${materialIndex}`}" sem mapa de cor.`)
  }

  const applied = (root.userData.importRecoveredColorTextures as Record<string, number> | undefined) ?? {}
  applied[String(materialIndex)] = imageIndex
  root.userData.importRecoveredColorTextures = applied
  root.userData.importNeedsReexport = true
  recoveredTextures.push(texture)
  root.userData.importRecoveredTextures = recoveredTextures
}
