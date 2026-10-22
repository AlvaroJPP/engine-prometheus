import * as THREE from 'three'
import type { ModelPreviewPart } from './ModelPreviewParts.ts'

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

/**
 * Atualiza os grupos escolhidos para exportação em lote. Um grupo selecionado
 * representa seus descendentes, por isso pais/filhos não podem coexistir.
 * IDs que já não existem na hierarquia são removidos durante uma nova seleção.
 */
export function toggleModelPreviewBatchSelection(
  selectedIds: readonly string[],
  parts: readonly ModelPreviewPart[],
  part: ModelPreviewPart,
  checked: boolean,
): string[] {
  if (!checked) return selectedIds.filter(id => id !== part.id)

  const partsById = new Map(parts.map(item => [item.id, item]))
  const next = selectedIds.filter(id => {
    const selected = partsById.get(id)
    if (!selected) return false
    return selected.id !== part.id
      && !isWithinModelPreviewTree(selected.object, part.object)
      && !isWithinModelPreviewTree(part.object, selected.object)
  })
  next.push(part.id)
  return next
}
