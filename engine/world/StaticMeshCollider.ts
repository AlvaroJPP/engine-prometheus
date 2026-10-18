import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export interface StaticMeshCollisionData {
  /** Malha consolidada no espaço local da raiz, com grupos de triângulos espaciais. */
  geometry: THREE.BufferGeometry
  boundsTree: MeshBVH
  localBounds: THREE.Box3
  partCount: number
  triangleCount: number
}

type SourcePart = {
  mesh: THREE.Mesh
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  index: THREE.BufferAttribute | null
  toRoot: THREE.Matrix4
  indexCount: number
  signature: string
}

type CachedStaticMesh = StaticMeshCollisionData & { signature: string }

export interface StaticMeshRayHit {
  point: THREE.Vector3
  normal: THREE.Vector3
  distance: number
  faceIndex: number
}

const cache = new WeakMap<THREE.Object3D, CachedStaticMesh>()
const MAX_STATIC_COLLIDER_TRIANGLES = 1_500_000
const QUERY_EPSILON = 0.003

function matrixSignature(matrix: THREE.Matrix4): string {
  return matrix.elements.map(value => value.toFixed(5)).join(',')
}

/**
 * Compila as malhas estáticas filhas em uma única estrutura côncava.
 * Cada triângulo continua sendo uma superfície independente; o BVH só acelera
 * as consultas espaciais e nunca transforma a cidade em um casco convexo.
 *
 * Malhas esqueléticas e morph targets variam com animações e, portanto, não são
 * armazenadas nesta estrutura estática.
 */
export function getStaticMeshCollisionData(root: THREE.Object3D): StaticMeshCollisionData | null {
  root.updateWorldMatrix(true, true)
  const inverseRoot = root.matrixWorld.clone().invert()
  const parts: SourcePart[] = []
  const signatureParts: string[] = []
  let dynamicGeometry = false
  let totalVertices = 0
  let totalIndices = 0

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible) return
    if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
    // A raiz dos modelos colocados no mundo é apenas o proxy de edição.
    if (child === root && root.userData.importedModel === true) return
    if (child instanceof THREE.SkinnedMesh || (child.geometry.morphAttributes.position?.length ?? 0) > 0) {
      dynamicGeometry = true
      return
    }

    const position = child.geometry.getAttribute('position')
    if (!position || position.count < 3) return

    child.updateWorldMatrix(true, false)
    const toRoot = inverseRoot.clone().multiply(child.matrixWorld)
    const index = child.geometry.getIndex()
    const indexCount = index ? index.count : position.count
    const signature = [
      child.uuid,
      child.geometry.uuid,
      position.version,
      index?.version ?? -1,
      matrixSignature(toRoot),
      indexCount,
    ].join(':')
    signatureParts.push(signature)
    parts.push({ mesh: child, position, index, toRoot, indexCount, signature })
    totalVertices += position.count
    totalIndices += indexCount
  })

  if (dynamicGeometry || parts.length === 0 || totalIndices < 3) return null
  const triangleCount = Math.floor(totalIndices / 3)
  if (triangleCount > MAX_STATIC_COLLIDER_TRIANGLES) return null

  const signature = signatureParts.join('|')
  const previous = cache.get(root)
  if (previous?.signature === signature) return previous

  const positions = new Float32Array(totalVertices * 3)
  const indices = new Uint32Array(totalIndices)
  const vertex = new THREE.Vector3()
  let vertexOffset = 0
  let indexOffset = 0
  const partRanges: Array<{ name: string; firstIndex: number; indexCount: number }> = []

  for (const part of parts) {
    const firstIndex = indexOffset
    for (let index = 0; index < part.position.count; index += 1) {
      vertex.fromBufferAttribute(part.position, index).applyMatrix4(part.toRoot)
      const destination = (vertexOffset + index) * 3
      positions[destination] = vertex.x
      positions[destination + 1] = vertex.y
      positions[destination + 2] = vertex.z
    }

    if (part.index) {
      for (let index = 0; index < part.index.count; index += 1) {
        indices[indexOffset++] = vertexOffset + part.index.getX(index)
      }
    } else {
      for (let index = 0; index < part.position.count; index += 1) {
        indices[indexOffset++] = vertexOffset + index
      }
    }

    partRanges.push({
      name: part.mesh.name || part.mesh.uuid,
      firstIndex,
      indexCount: indexOffset - firstIndex,
    })
    vertexOffset += part.position.count
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  // Os intervalos são mantidos para diagnóstico e para futura edição de
  // colisores individuais por prédio/piso, sem criar objetos de cena extras.
  geometry.userData.staticMeshPartRanges = partRanges
  const boundsTree = new MeshBVH(geometry, { maxLeafSize: 12 })
  const compiled: CachedStaticMesh = {
    signature,
    geometry,
    boundsTree,
    localBounds: geometry.boundingBox?.clone() ?? new THREE.Box3(),
    partCount: parts.length,
    triangleCount,
  }

  previous?.geometry.dispose()
  cache.set(root, compiled)
  return compiled
}

/**
 * Consulta apenas os nós e triângulos do BVH que cruzam uma caixa em coordenadas
 * mundiais. O callback recebe o triângulo transformado para o mundo e retorna true
 * quando encontrou um contato válido.
 */
export function visitStaticMeshTriangles(
  root: THREE.Object3D,
  worldBounds: THREE.Box3,
  visit: (triangle: THREE.Triangle) => boolean,
): boolean {
  const data = getStaticMeshCollisionData(root)
  if (!data) return false

  root.updateWorldMatrix(true, true)
  const rootToWorld = root.matrixWorld
  const worldToRoot = rootToWorld.clone().invert()
  const localQueryBounds = worldBounds.clone().applyMatrix4(worldToRoot).expandByScalar(QUERY_EPSILON)
  const worldTriangle = new THREE.Triangle()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  return data.boundsTree.shapecast({
    intersectsBounds: bounds => bounds.intersectsBox(localQueryBounds),
    intersectsTriangle: (localTriangle) => {
      a.copy(localTriangle.a).applyMatrix4(rootToWorld)
      b.copy(localTriangle.b).applyMatrix4(rootToWorld)
      c.copy(localTriangle.c).applyMatrix4(rootToWorld)
      worldTriangle.set(a, b, c)
      if (!worldBounds.intersectsTriangle(worldTriangle)) return false
      return visit(worldTriangle)
    },
  })
}

/** Raio acelerado pela mesma estrutura BVH, retornando ponto/normal em coordenadas mundiais. */
export function raycastStaticMesh(
  root: THREE.Object3D,
  worldRay: THREE.Ray,
  near = 0,
  far = Number.POSITIVE_INFINITY,
): StaticMeshRayHit | null {
  const data = getStaticMeshCollisionData(root)
  if (!data) return null

  root.updateWorldMatrix(true, true)
  const worldToRoot = root.matrixWorld.clone().invert()
  const localRay = worldRay.clone().applyMatrix4(worldToRoot)
  const hit = data.boundsTree.raycastFirst(localRay, THREE.DoubleSide)
  if (!hit?.face) return null

  const point = hit.point.clone().applyMatrix4(root.matrixWorld)
  const distance = worldRay.origin.distanceTo(point)
  if (distance < near || distance > far) return null

  const normal = hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(root.matrixWorld))
    .normalize()
  return { point, normal, distance, faceIndex: hit.faceIndex ?? -1 }
}

/** Limpa o cache geométrico quando o modelo deixa de existir no mundo. */
export function releaseStaticMeshCollider(root: THREE.Object3D): void {
  const existing = cache.get(root)
  if (!existing) return
  existing.geometry.dispose()
  cache.delete(root)
}
