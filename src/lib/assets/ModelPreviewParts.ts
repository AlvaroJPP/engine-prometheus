import * as THREE from 'three'

export type ModelPreviewPart = {
  id: string
  name: string
  object: THREE.Object3D
  depth: number
  meshCount: number
}

/**
 * Cria a hierarquia de partes selecionáveis para a prévia do importador.
 * As contagens são agregadas de baixo para cima em uma única passagem reversa.
 */
export function collectModelPreviewParts(root: THREE.Object3D): ModelPreviewPart[] {
  const nodes: Array<{ node: THREE.Object3D; depth: number }> = []
  const collect = (node: THREE.Object3D, depth: number) => {
    nodes.push({ node, depth })
    for (const child of node.children) collect(child, depth + 1)
  }
  collect(root, -1)

  const meshCounts = new Map<THREE.Object3D, number>()
  for (const entry of nodes) {
    meshCounts.set(entry.node, entry.node instanceof THREE.Mesh ? 1 : 0)
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const entry = nodes[index]!
    const parent = entry.node.parent
    if (parent) {
      meshCounts.set(parent, (meshCounts.get(parent) ?? 0) + (meshCounts.get(entry.node) ?? 0))
    }
  }

  const parts: ModelPreviewPart[] = []
  let unnamedIndex = 0
  for (const { node, depth } of nodes) {
    if (node === root) continue
    const meshCount = meshCounts.get(node) ?? 0
    if (!meshCount) continue
    unnamedIndex += 1
    parts.push({
      id: node.uuid,
      name: node.name.trim() || (node instanceof THREE.Mesh ? `Malha ${unnamedIndex}` : `Grupo ${unnamedIndex}`),
      object: node,
      depth,
      meshCount,
    })
  }
  return parts
}
