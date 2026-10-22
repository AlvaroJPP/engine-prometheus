import * as THREE from 'three'

export interface StaticColliderPreviewGeometry {
  geometry: THREE.BufferGeometry
  sampled: boolean
}

/**
 * Constrói apenas o contorno de uma amostra da malha para a prévia do editor.
 * A colisão efetiva continua usando a geometria completa do sistema de colisão.
 */
export function createStaticColliderPreviewGeometry(
  source: THREE.BufferGeometry,
  maxTriangles = 60_000,
): StaticColliderPreviewGeometry {
  const position = source.getAttribute('position')
  const index = source.getIndex()
  const triangleCount = Math.floor((index ? index.count : position?.count ?? 0) / 3)
  const safeMaxTriangles = Number.isFinite(maxTriangles) ? Math.max(1, Math.floor(maxTriangles)) : 60_000
  const stride = Math.max(1, Math.ceil(triangleCount / safeMaxTriangles))
  const output = new Float32Array(Math.ceil(triangleCount / stride) * 18)
  let cursor = 0

  const writeVertex = (vertexIndex: number) => {
    output[cursor++] = position.getX(vertexIndex)
    output[cursor++] = position.getY(vertexIndex)
    output[cursor++] = position.getZ(vertexIndex)
  }

  for (let triangle = 0; triangle < triangleCount; triangle += stride) {
    const a = index ? index.getX(triangle * 3) : triangle * 3
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
    const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
    writeVertex(a)
    writeVertex(b)
    writeVertex(b)
    writeVertex(c)
    writeVertex(c)
    writeVertex(a)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(cursor === output.length ? output : output.slice(0, cursor), 3),
  )
  return { geometry, sampled: stride > 1 }
}
