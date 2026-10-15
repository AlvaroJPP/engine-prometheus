import * as THREE from 'three'
import type { GameObject } from '../model/object/GameObject'
import type { World } from './World'

export interface CollisionPair {
  a: string
  b: string
}

interface ConvexShape {
  vertices: THREE.Vector3[]
  faceNormals: THREE.Vector3[]
  edges: THREE.Vector3[]
  center: THREE.Vector3
}

interface Contact {
  normal: THREE.Vector3
  depth: number
}

const CONTACT_TOLERANCE = 1e-7
const MAX_RESOLUTION_PASSES = 12
const AXIS_EPSILON_SQ = 1e-10
const EDGE_KEY_SCALE = 100000

/** Calcula colisão pela malha-raiz (proxy), sem percorrer todos os triângulos dos filhos GLB/FBX. */
function getRootBounds(mesh: THREE.Mesh): THREE.Box3 {
  mesh.updateWorldMatrix(true, false)
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  return (mesh.geometry.boundingBox?.clone() ?? new THREE.Box3()).applyMatrix4(mesh.matrixWorld)
}

/**
 * Narrow phase SAT (Separating Axis Theorem) sobre os vértices, faces e arestas
 * reais da geometria transformada. Funciona para malhas convexas fechadas,
 * incluindo os cubos e plataformas gerados pelo editor; não usa AABB como teste final.
 *
 * A massa determina a distribuição da correção de penetração. Massa 0 ou um objeto
 * bloqueado equivale a corpo estático. Este sistema é de colisão/resolução posicional,
 * não um solver completo de velocidade, atrito ou gravidade.
 */
export class CollisionSystem {
  private readonly world: World
  private activePairs = new Map<string, CollisionPair>()

  constructor(world: World) {
    this.world = world
  }

  update(): void {
    const objects = this.world.list().filter(object => object.mesh.visible)
    // Modelos importados têm uma caixa proxy para seleção e terreno. Não os inclua
    // no SAT de pares: modelos externos podem ser grandes e não são colisores convexos.
    this.keepObjectsAboveTerrain(objects)
    const collidableObjects = objects.filter(object => object.mesh.userData.importedModel !== true)
    const previousPairs = this.activePairs
    const currentPairs = new Map<string, CollisionPair>()

    for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
      let resolvedAny = false
      for (let i = 0; i < collidableObjects.length; i += 1) {
        const a = collidableObjects[i]
        if (!a) continue
        for (let j = i + 1; j < collidableObjects.length; j += 1) {
          const shapeA = this.buildShape(a)
          if (!shapeA) break
          const boundsA = new THREE.Box3().setFromPoints(shapeA.vertices)
          const b = collidableObjects[j]
          if (!b) continue
          const shapeB = this.buildShape(b)
          if (!shapeB) continue
          const boundsB = new THREE.Box3().setFromPoints(shapeB.vertices)
          if (!boundsA.intersectsBox(boundsB)) continue

          const contact = this.intersectConvex(shapeA, shapeB)
          if (!contact) continue
          currentPairs.set(this.pairKey(a.id, b.id), { a: a.id, b: b.id })

          const inverseA = this.inverseMass(a)
          const inverseB = this.inverseMass(b)
          const totalInverseMass = inverseA + inverseB
          if (totalInverseMass <= 0) continue

          // Corrige somente a penetração real: adicionar um epsilon à profundidade
          // empurrava os corpos para longe e criava frestas visíveis entre superfícies.
          const correction = contact.normal.clone().multiplyScalar(contact.depth)
          if (inverseA > 0) {
            a.mesh.position.addScaledVector(correction, -inverseA / totalInverseMass)
            a.mesh.updateMatrixWorld(true)
            this.world.notifyChanged(a.id)
          }
          if (inverseB > 0) {
            b.mesh.position.addScaledVector(correction, inverseB / totalInverseMass)
            b.mesh.updateMatrixWorld(true)
            this.world.notifyChanged(b.id)
          }
          resolvedAny = true
        }
      }
      if (!resolvedAny) break
    }

    // Calcula os pares ativos com as posições já corrigidas.
    currentPairs.clear()
    for (let i = 0; i < collidableObjects.length; i += 1) {
      const a = collidableObjects[i]
      if (!a) continue
      const shapeA = this.buildShape(a)
      if (!shapeA) continue
      const boundsA = new THREE.Box3().setFromPoints(shapeA.vertices)
      for (let j = i + 1; j < collidableObjects.length; j += 1) {
        const b = collidableObjects[j]
        if (!b) continue
        const shapeB = this.buildShape(b)
        if (!shapeB) continue
        if (!boundsA.intersectsBox(new THREE.Box3().setFromPoints(shapeB.vertices))) continue
        if (this.intersectConvex(shapeA, shapeB)) {
          currentPairs.set(this.pairKey(a.id, b.id), { a: a.id, b: b.id })
        }
      }
    }

    for (const [key, pair] of currentPairs) {
      if (!previousPairs.has(key)) this.world.events.emit('collisionStarted', pair)
    }
    for (const [key, pair] of previousPairs) {
      if (!currentPairs.has(key)) this.world.events.emit('collisionEnded', pair)
    }
    this.activePairs = currentPairs
    this.keepObjectsAboveTerrain(objects)
  }

  private inverseMass(object: GameObject): number {
    if (object.mesh.userData.locked === true) return 0
    const mass = object.mesh.userData.mass
    if (typeof mass !== 'number' || !Number.isFinite(mass)) return 1
    return mass <= 0 ? 0 : 1 / Math.max(0.0001, mass)
  }

  private buildShape(object: GameObject): ConvexShape | null {
    const mesh = object.mesh
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    if (!position || position.count < 3) return null

    mesh.updateWorldMatrix(true, false)
    const vertices: THREE.Vector3[] = []
    for (let i = 0; i < position.count; i += 1) {
      vertices.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    }

    const index = geometry.getIndex()
    const triangleCount = index ? index.count / 3 : position.count / 3
    const faceNormals: THREE.Vector3[] = []
    const edgeFaces = new Map<string, { direction: THREE.Vector3; normals: THREE.Vector3[] }>()

    const addEdge = (ia: number, ib: number, normal: THREE.Vector3) => {
      const va = vertices[ia]
      const vb = vertices[ib]
      if (!va || !vb) return
      const ka = this.vertexKey(va)
      const kb = this.vertexKey(vb)
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const existing = edgeFaces.get(key)
      if (existing) {
        existing.normals.push(normal)
      } else {
        edgeFaces.set(key, { direction: vb.clone().sub(va).normalize(), normals: [normal] })
      }
    }

    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ia = index ? index.getX(triangle * 3) : triangle * 3
      const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
      const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
      const a = vertices[ia]
      const b = vertices[ib]
      const c = vertices[ic]
      if (!a || !b || !c) continue
      const normal = b.clone().sub(a).cross(c.clone().sub(a))
      if (normal.lengthSq() <= AXIS_EPSILON_SQ) continue
      normal.normalize()
      faceNormals.push(normal)
      addEdge(ia, ib, normal)
      addEdge(ib, ic, normal)
      addEdge(ic, ia, normal)
    }

    // A diagonal that only splits one flat polygon is not a real polyhedron edge.
    const edges: THREE.Vector3[] = []
    for (const edge of edgeFaces.values()) {
      const hasNonCoplanarFaces = edge.normals.some((normal, i) =>
        edge.normals.some((other, j) => i !== j && Math.abs(normal.dot(other)) < 0.9999),
      )
      if (hasNonCoplanarFaces && edge.direction.lengthSq() > AXIS_EPSILON_SQ) {
        edges.push(edge.direction)
      }
    }

    const center = new THREE.Box3().setFromPoints(vertices).getCenter(new THREE.Vector3())
    return { vertices, faceNormals, edges, center }
  }

  private intersectConvex(a: ConvexShape, b: ConvexShape): Contact | null {
    let minimumOverlap = Number.POSITIVE_INFINITY
    let minimumAxis: THREE.Vector3 | null = null
    const axes: THREE.Vector3[] = [...a.faceNormals, ...b.faceNormals]

    for (const edgeA of a.edges) {
      for (const edgeB of b.edges) {
        const axis = edgeA.clone().cross(edgeB)
        if (axis.lengthSq() > AXIS_EPSILON_SQ) axes.push(axis.normalize())
      }
    }

    for (const rawAxis of axes) {
      if (rawAxis.lengthSq() <= AXIS_EPSILON_SQ) continue
      const axis = rawAxis.clone().normalize()
      const projectionA = this.project(a.vertices, axis)
      const projectionB = this.project(b.vertices, axis)
      const overlap = Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min)
      // Encostar não é penetrar. A tolerância serve apenas para ruído numérico,
      // sem introduzir uma margem física que afaste objetos que deveriam se tocar.
      if (overlap <= CONTACT_TOLERANCE) return null
      if (overlap < minimumOverlap) {
        minimumOverlap = overlap
        minimumAxis = axis
      }
    }

    if (!minimumAxis || !Number.isFinite(minimumOverlap)) return null
    if (b.center.clone().sub(a.center).dot(minimumAxis) < 0) minimumAxis.negate()
    return { normal: minimumAxis, depth: minimumOverlap }
  }

  private project(vertices: THREE.Vector3[], axis: THREE.Vector3): { min: number; max: number } {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const vertex of vertices) {
      const value = vertex.dot(axis)
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    return { min, max }
  }

  private vertexKey(vertex: THREE.Vector3): string {
    return `${Math.round(vertex.x * EDGE_KEY_SCALE)},${Math.round(vertex.y * EDGE_KEY_SCALE)},${Math.round(vertex.z * EDGE_KEY_SCALE)}`
  }

  /** O terreno impede que os objetos atravessem a superfície. */
  private keepObjectsAboveTerrain(objects: GameObject[]): void {
    for (const object of objects) {
      const bounds = getRootBounds(object.mesh)
      const groundY = this.world.terrain.heightAt(object.mesh.position.x, object.mesh.position.z)
      if (bounds.min.y < groundY) {
        object.mesh.position.y += groundY - bounds.min.y
        object.mesh.updateMatrixWorld(true)
        this.world.notifyChanged(object.id)
      }
    }
  }

  clear(): void {
    for (const pair of this.activePairs.values()) this.world.events.emit('collisionEnded', pair)
    this.activePairs.clear()
  }

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`
  }
}
