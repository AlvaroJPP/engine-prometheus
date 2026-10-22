import * as THREE from 'three'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'

/**
 * Clona um modelo para uma prévia isolada de retargeting.
 * Geometrias e materiais recebem cópias próprias; texturas permanecem compartilhadas.
 */
export function cloneRetargetPreviewObject(source: THREE.Object3D): THREE.Object3D {
  const clone = cloneSkinnedModel(source)
  clone.updateMatrixWorld(true)
  clone.traverse(node => {
    // A prévia de peças permite ocultar/isolá-las durante a inspeção do modelo.
    // A cena de animação sempre apresenta o personagem completo.
    node.visible = true
    if (node instanceof THREE.Mesh) {
      // Evita que uma submalha deformada pela animação desapareça por bounds
      // de repouso desatualizados, principalmente nas pernas e na pelve.
      node.frustumCulled = false
      node.geometry = node.geometry.clone()
      node.material = Array.isArray(node.material)
        ? node.material.map(material => {
            const clonedMaterial = material.clone()
            clonedMaterial.visible = true
            return clonedMaterial
          })
        : node.material.clone()
      if (!Array.isArray(node.material)) node.material.visible = true
      if (node instanceof THREE.SkinnedMesh) node.skeleton.update()
    }
  })
  clone.updateMatrixWorld(true)
  return clone
}

/**
 * Libera geometria e materiais da cópia de prévia sem descartar texturas
 * compartilhadas com o modelo de origem.
 */
export function disposeRetargetPreviewObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points) {
      geometries.add(node.geometry)
      const list = Array.isArray(node.material) ? node.material : [node.material]
      list.forEach(material => materials.add(material))
    }
  })
  geometries.forEach(geometry => geometry.dispose())
  // Os materiais são clones; as texturas são referências compartilhadas e não
  // devem ser descartadas enquanto o modelo principal estiver aberto.
  materials.forEach(material => material.dispose())
}
