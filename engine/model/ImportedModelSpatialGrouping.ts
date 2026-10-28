import * as THREE from 'three'

export interface SpatialModelPart {
  label: string
  model: THREE.Group
}

/**
 * Separates static sibling meshes into spatially distinct parts (for example,
 * several trees exported as one GLB). Animated models and entities are filtered
 * by the caller so their node hierarchy remains intact.
 */
export function splitStaticModelIntoSpatialParts(
  name: string,
  model: THREE.Object3D,
): SpatialModelPart[] | null {
  model.removeFromParent()
  model.updateMatrixWorld(true)

  type PartCluster = { center: THREE.Vector3; nodes: THREE.Object3D[]; span: number }
  const hasMesh = (node: THREE.Object3D): boolean => {
    let found = false
    node.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry.getAttribute('position')) found = true
    })
    return found
  }
  const boundsOf = (node: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(node)
  const clustersOf = (node: THREE.Object3D): PartCluster[] => {
    const candidates = node.children.filter(hasMesh)
    if (candidates.length < 2) return []
    const clusters: PartCluster[] = []
    for (const candidate of candidates) {
      const bounds = boundsOf(candidate)
      if (bounds.isEmpty()) continue
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const span = Math.max(size.x, size.z, 0.001)
      const existing = clusters.find((cluster) => {
        const distance = Math.hypot(center.x - cluster.center.x, center.z - cluster.center.z)
        const tolerance = Math.max(0.2, Math.min(span, cluster.span) * 0.28)
        return distance <= tolerance
      })
      if (existing) {
        existing.nodes.push(candidate)
        const count = existing.nodes.length
        existing.center.lerp(center, 1 / count)
        existing.span = Math.max(existing.span, span)
      } else {
        clusters.push({ center, nodes: [candidate], span })
      }
    }
    return clusters
  }

  let bestContainer: THREE.Object3D | null = null
  let bestClusters: PartCluster[] = []
  const findPartContainer = (node: THREE.Object3D): void => {
    const clusters = clustersOf(node)
    if (clusters.length >= 2 && clusters.length > bestClusters.length) {
      bestContainer = node
      bestClusters = clusters
    }
    for (const child of node.children) findPartContainer(child)
  }
  findPartContainer(model)

  if (!bestContainer || bestClusters.length < 2) return null

  const animations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
  console.info('[Engine] Componentes espaciais do GLB:', {
    name,
    clusters: bestClusters.map((cluster, index) => ({
      name: cluster.nodes.map((part) => part.name).filter(Boolean).join(' + ') || `Árvore ${index + 1}`,
      meshes: cluster.nodes.reduce((total, part) => {
        let count = 0
        part.traverse((child) => { if (child instanceof THREE.Mesh) count += 1 })
        return total + count
      }, 0),
      center: cluster.center.toArray(),
    })),
    animationClips: animations.map((clip) => clip.name),
  })

  const parts: SpatialModelPart[] = []
  bestClusters.forEach((cluster, index) => {
    const group = new THREE.Group()
    const label = cluster.nodes.map((part) => part.name.trim()).filter(Boolean)[0] || `Árvore ${index + 1}`
    group.name = label
    for (const part of cluster.nodes) {
      part.updateWorldMatrix(true, false)
      const worldMatrix = part.matrixWorld.clone()
      part.removeFromParent()
      worldMatrix.decompose(part.position, part.quaternion, part.scale)
      part.updateMatrix()
      group.add(part)
    }
    const bounds = boundsOf(group)
    const center = bounds.getCenter(new THREE.Vector3())
    group.position.set(-center.x, -center.y, -center.z)
    group.userData.importOffset = [center.x, center.z]
    group.userData.importAnimations = animations
    group.userData.importPart = true
    parts.push({ label, model: group })
  })
  return parts
}
