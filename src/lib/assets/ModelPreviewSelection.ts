import * as THREE from 'three'

/** Retorna verdadeiro quando object é o próprio ancestor ou um descendente dele. */
export function isWithinModelPreviewTree(
  object: THREE.Object3D,
  ancestor: THREE.Object3D,
): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

/**
 * Mantém visíveis a raiz, a parte escolhida, seus descendentes e os ancestrais
 * necessários para que ela continue renderizável; oculta os ramos não relacionados.
 */
export function setModelPreviewSoloVisibility(
  root: THREE.Object3D,
  selected: THREE.Object3D,
): void {
  root.traverse(node => {
    node.visible = node === root
      || isWithinModelPreviewTree(node, selected)
      || isWithinModelPreviewTree(selected, node)
  })
}

/** Restaura a visibilidade de todos os nós, conforme o comportamento do importador. */
export function restoreModelPreviewVisibility(root: THREE.Object3D): void {
  root.traverse(node => { node.visible = true })
}
