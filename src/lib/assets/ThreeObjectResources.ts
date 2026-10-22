import * as THREE from 'three'

export type ThreeResourceDisposalMode = 'renderables' | 'meshes' | 'nodes-with-resources'

function shouldDisposeNode(node: THREE.Object3D, mode: ThreeResourceDisposalMode): boolean {
  if (mode === 'meshes') return node instanceof THREE.Mesh
  if (mode === 'renderables') {
    return node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points
  }
  const candidate = node as THREE.Object3D & { geometry?: unknown; material?: unknown }
  return (candidate.geometry instanceof THREE.BufferGeometry) || 'material' in candidate
}

/**
 * Disposes geometries, materials and textures referenced by a Three.js object tree.
 * Sets prevent disposing the same shared resource more than once.
 *
 * Modes preserve the previous ownership rules used in the project:
 * - renderables: Mesh, Line and Points (model import previews)
 * - meshes: only Mesh nodes (component library source models)
 * - nodes-with-resources: nodes with a BufferGeometry or material property (thumbnail scenes)
 */
export function disposeThreeObjectResources(
  root: THREE.Object3D,
  mode: ThreeResourceDisposalMode = 'renderables',
): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  root.traverse(node => {
    if (!shouldDisposeNode(node, mode)) return
    const candidate = node as THREE.Object3D & {
      geometry?: unknown
      material?: unknown
    }

    if (candidate.geometry instanceof THREE.BufferGeometry) {
      geometries.add(candidate.geometry)
    }
    if (!('material' in candidate)) return

    const assigned = candidate.material
    for (const material of Array.isArray(assigned) ? assigned : [assigned]) {
      if (!(material instanceof THREE.Material)) continue
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
    }
  })

  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => texture.dispose())
}
