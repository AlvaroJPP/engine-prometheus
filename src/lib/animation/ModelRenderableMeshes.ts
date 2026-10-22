import * as THREE from 'three'

/** Restaura malhas importadas para uma avaliação de animação/renderização. */
export function restoreRenderableMeshes(root: THREE.Object3D): void {
  root.traverse(node => {
    node.visible = true
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) material.visible = true
    // Malhas esqueléticas não devem ser descartadas pelo frustum com bounds de repouso.
    if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false
  })
  root.updateMatrixWorld(true)
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.update()
  })
}
