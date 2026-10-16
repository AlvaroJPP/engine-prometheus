import * as THREE from 'three'

/** Modelos pequenos ficam intactos; geometria grande é dividida apenas em assets estáticos. */
const MIN_TRIANGLES_TO_PARTITION = 8_000
// Acima disso, a divisão em tempo de importação alocaria memória demais;
// esses assets precisam de LOD/simplificação offline antes do import.
const MAX_TRIANGLES_TO_PARTITION = 200_000
const TARGET_TRIANGLES_PER_REGION = 1_500
const MAX_SUBDIVISIONS_PER_AXIS = 4

type AttributeLike = THREE.BufferAttribute | THREE.InterleavedBufferAttribute

interface TriangleBucket {
  byMaterial: Map<number, number[]>
}

/**
 * Divide malhas estáticas grandes em regiões espaciais. Não processa um teste de
 * oclusão por triângulo: cada região vira uma malha com seu próprio AABB e pode
 * ser ocultada inteira quando estiver atrás de uma superfície opaca.
 *
 * Geometria esquelética e morph targets são mantidos intactos para não quebrar
 * rigs, animações ou deformações por vértice.
 */
export function partitionLargeStaticMeshes(root: THREE.Object3D): number {
  const meshes: THREE.Mesh[] = []
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node)
  })

  let createdRegions = 0
  for (const mesh of meshes) {
    if (mesh.parent === null && mesh !== root) continue
    const geometry = mesh.geometry
    if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) continue
    if (Object.values(geometry.morphAttributes).some((attributes) => attributes.length > 0)) continue
    if (geometry.getAttribute('position') === undefined) continue
    if (geometry.drawRange.start !== 0) continue
    const position = geometry.getAttribute('position')
    const elementCount = geometry.index?.count ?? position.count
    if (geometry.drawRange.count !== Infinity && geometry.drawRange.count < elementCount) continue
    if (elementCount % 3 !== 0) continue

    const triangleCount = elementCount / 3
    if (triangleCount < MIN_TRIANGLES_TO_PARTITION || triangleCount > MAX_TRIANGLES_TO_PARTITION) continue
    if (Object.values(geometry.attributes).some((attribute) => attribute.itemSize > 4)) continue

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.length === 0 || materials.some((material) => !isOpaqueStaticMaterial(material))) continue

    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    if (!bounds || bounds.isEmpty()) continue

    const subdivisions = Math.max(
      2,
      Math.min(
        MAX_SUBDIVISIONS_PER_AXIS,
        Math.ceil(Math.cbrt(triangleCount / TARGET_TRIANGLES_PER_REGION)),
      ),
    )
    const size = bounds.getSize(new THREE.Vector3())
    const buckets = new Map<number, TriangleBucket>()
    const index = geometry.index
    const groupList = geometry.groups

    const materialIndexAt = (elementStart: number): number => {
      if (groupList.length === 0) return 0
      const group = groupList.find((candidate) =>
        elementStart >= candidate.start && elementStart + 3 <= candidate.start + candidate.count,
      )
      return group?.materialIndex ?? -1
    }
    const cellFor = (value: number, min: number, extent: number): number => {
      if (extent <= 1e-8) return 0
      return Math.max(0, Math.min(subdivisions - 1, Math.floor(((value - min) / extent) * subdivisions)))
    }

    for (let elementStart = 0; elementStart < elementCount; elementStart += 3) {
      const materialIndex = materialIndexAt(elementStart)
      if (materialIndex < 0 || materialIndex >= materials.length) continue

      const a = index ? index.getX(elementStart) : elementStart
      const b = index ? index.getX(elementStart + 1) : elementStart + 1
      const c = index ? index.getX(elementStart + 2) : elementStart + 2
      const ax = position.getX(a); const ay = position.getY(a); const az = position.getZ(a)
      const bx = position.getX(b); const by = position.getY(b); const bz = position.getZ(b)
      const cx = position.getX(c); const cy = position.getY(c); const cz = position.getZ(c)
      const centerX = (ax + bx + cx) / 3
      const centerY = (ay + by + cy) / 3
      const centerZ = (az + bz + cz) / 3
      const x = cellFor(centerX, bounds.min.x, size.x)
      const y = cellFor(centerY, bounds.min.y, size.y)
      const z = cellFor(centerZ, bounds.min.z, size.z)
      const key = (y * subdivisions + z) * subdivisions + x
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { byMaterial: new Map<number, number[]>() }
        buckets.set(key, bucket)
      }
      const vertices = bucket.byMaterial.get(materialIndex) ?? []
      vertices.push(a, b, c)
      bucket.byMaterial.set(materialIndex, vertices)
    }

    if (buckets.size < 2) continue

    const originalChildren = [...mesh.children]
    const clusterMeshes: THREE.Mesh[] = []
    let clusterIndex = 0
    for (const bucket of buckets.values()) {
      const orderedVertexIndices: number[] = []
      const groupData: Array<{ start: number; count: number; materialIndex: number }> = []
      const materialGroups = [...bucket.byMaterial.entries()].sort((left, right) => left[0] - right[0])
      for (const [materialIndex, vertexIndices] of materialGroups) {
        const start = orderedVertexIndices.length
        // Evita spread de arrays grandes (limite de argumentos do JavaScript).
        for (const vertexIndex of vertexIndices) orderedVertexIndices.push(vertexIndex)
        groupData.push({ start, count: vertexIndices.length, materialIndex })
      }
      if (orderedVertexIndices.length === 0) continue

      const regionGeometry = new THREE.BufferGeometry()
      for (const [attributeName, attributeValue] of Object.entries(geometry.attributes)) {
        const attribute = attributeValue as AttributeLike
        const itemSize = attribute.itemSize
        const data = new Float32Array(orderedVertexIndices.length * itemSize)
        for (let vertexOffset = 0; vertexOffset < orderedVertexIndices.length; vertexOffset += 1) {
          const sourceVertex = orderedVertexIndices[vertexOffset]!
          for (let component = 0; component < itemSize; component += 1) {
            data[vertexOffset * itemSize + component] = readAttributeComponent(attribute, sourceVertex, component)
          }
        }
        regionGeometry.setAttribute(attributeName, new THREE.Float32BufferAttribute(data, itemSize))
      }
      for (const group of groupData) {
        regionGeometry.addGroup(group.start, group.count, group.materialIndex)
      }
      regionGeometry.computeBoundingBox()
      regionGeometry.computeBoundingSphere()

      const regionMesh = new THREE.Mesh(regionGeometry, mesh.material)
      regionMesh.name = `${mesh.name || 'Malha'}::occlusion-${clusterIndex + 1}`
      regionMesh.userData = {
        ...mesh.userData,
        generatedOcclusionCluster: true,
        modelOcclusionCandidate: true,
        modelOcclusionBaseVisible: mesh.visible,
        occlusionSourceMeshName: mesh.name,
        occlusionClusterIndex: clusterIndex,
      }
      regionMesh.castShadow = mesh.castShadow
      regionMesh.receiveShadow = mesh.receiveShadow
      regionMesh.renderOrder = mesh.renderOrder
      regionMesh.layers.mask = mesh.layers.mask
      // Ao contrário da geometria original de certos GLBs, o AABB deste bloco
      // acabou de ser calculado sobre os vértices efetivamente desenhados.
      regionMesh.frustumCulled = true
      clusterMeshes.push(regionMesh)
      clusterIndex += 1
    }

    if (clusterMeshes.length < 2) {
      for (const cluster of clusterMeshes) cluster.geometry.dispose()
      continue
    }

    // Mantém o nó original como pai sem geometria. Assim os transforms e o nome
    // do GLTF continuam estáveis, e ocultar esse nó ainda oculta todos os blocos.
    mesh.geometry = new THREE.BufferGeometry()
    mesh.userData.occlusionPartitionContainer = true
    mesh.userData.modelOcclusionCandidate = false
    mesh.userData.modelOcclusionBaseVisible = mesh.visible
    for (const child of originalChildren) mesh.remove(child)
    for (const child of originalChildren) mesh.add(child)
    for (const cluster of clusterMeshes) mesh.add(cluster)
    createdRegions += clusterMeshes.length

    // A geometria fonte pode estar compartilhada com a prévia; não a descartamos aqui.
  }

  return createdRegions
}

export function isOpaqueStaticMaterial(material: THREE.Material): boolean {
  const extended = material as THREE.Material & {
    alphaTest?: number
    colorWrite?: boolean
  }
  return material.visible
    && !material.transparent
    && material.opacity >= 0.98
    && material.depthWrite
    && (extended.alphaTest ?? 0) <= 0
    && extended.colorWrite !== false
    && !(material instanceof THREE.ShaderMaterial)
    && !(material instanceof THREE.RawShaderMaterial)
}

function readAttributeComponent(attribute: AttributeLike, index: number, component: number): number {
  const dynamicAttribute = attribute as AttributeLike & {
    getComponent?: (index: number, component: number) => number
  }
  if (typeof dynamicAttribute.getComponent === 'function') {
    return dynamicAttribute.getComponent(index, component)
  }
  switch (component) {
    case 0: return attribute.getX(index)
    case 1: return attribute.getY(index)
    case 2: return attribute.getZ(index)
    case 3: return attribute.getW(index)
    default: return 0
  }
}
