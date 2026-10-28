import * as THREE from 'three'

export interface ImportedModelGeometryStats {
  meshCount: number
  triangleCount: number
  generatedNormalCount: number
  enhancedTextureCount: number
  importedMeshes: THREE.Mesh[]
}

/** Normalizes imported meshes/materials and records geometry statistics for later collider decisions. */
export function prepareImportedModelGeometry(
  model: THREE.Object3D,
  name: string,
  preferredAnisotropy: number,
  originalSize: THREE.Vector3,
): ImportedModelGeometryStats {
  let meshCount = 0
  let triangleCount = 0
  let generatedNormalCount = 0
  let enhancedTextureCount = 0
  const importedMeshes: THREE.Mesh[] = []
  const clonedMaterials = new Map<THREE.Material, THREE.Material>()
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    importedMeshes.push(child)
    meshCount += 1
    child.visible = true
    child.castShadow = false
    child.receiveShadow = false
    child.frustumCulled = child.userData.generatedOcclusionCluster === true
    const geometries = child.geometry
    const position = geometries.getAttribute('position')
    const normal = geometries.getAttribute('normal')
    if (position && position.count >= 3 && (!normal || normal.count !== position.count)) {
      geometries.computeVertexNormals()
      generatedNormalCount += 1
    }
    if (!geometries.boundingSphere) geometries.computeBoundingSphere()
    if (!geometries.boundingBox) geometries.computeBoundingBox()
    if (position) triangleCount += geometries.index
      ? geometries.index.count / 3
      : position.count / 3
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
    const materials: THREE.Material[] = sourceMaterials.map((material) => {
      if (!(material instanceof THREE.Material)) return new THREE.MeshStandardMaterial()
      let clone = clonedMaterials.get(material)
      if (!clone) {
        clone = material.clone()
        clonedMaterials.set(material, clone)
      }
      return clone
    })
    child.material = Array.isArray(child.material) ? materials : (materials[0] ?? child.material)
    for (const material of materials) {
      material.visible = true
      const texturedMaterial = material as THREE.Material & {
        colorWrite?: boolean
        [key: string]: unknown
      }
      if ('colorWrite' in texturedMaterial) texturedMaterial.colorWrite = true
      for (const [slot, value] of Object.entries(texturedMaterial)) {
        if (!(value instanceof THREE.Texture)) continue
        if ((slot === 'map' || slot === 'emissiveMap') && value.colorSpace !== THREE.SRGBColorSpace) {
          value.colorSpace = THREE.SRGBColorSpace
          value.needsUpdate = true
        }
        if (preferredAnisotropy > value.anisotropy) {
          value.anisotropy = preferredAnisotropy
          value.needsUpdate = true
          enhancedTextureCount += 1
        }
      }
      material.needsUpdate = true
    }
  })
  if (meshCount === 0 || triangleCount === 0) {
    throw new Error('O arquivo foi carregado, mas não contém malhas trianguladas para renderizar.')
  }
  let ancestor: THREE.Object3D | null = model
  while (ancestor) {
    ancestor.visible = true
    ancestor = ancestor.parent
  }
  model.userData.importStats = { meshCount, triangleCount }
  console.info('[Engine] Modelo importado preparado:', {
    name,
    meshCount,
    triangleCount,
    generatedNormalCount,
    enhancedTextureCount,
    textureAnisotropy: preferredAnisotropy,
    bounds: originalSize.toArray(),
    visibleMeshes: importedMeshes.filter((mesh) => mesh.visible).length,
  })
  return { meshCount, triangleCount, generatedNormalCount, enhancedTextureCount, importedMeshes }
}
