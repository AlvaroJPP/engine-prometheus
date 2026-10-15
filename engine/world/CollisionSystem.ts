import * as THREE from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
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
const CCD_MIN_STEPS = 4
const CCD_MAX_STEPS = 64
const CCD_FRACTION = 0.35

type ColliderType = 'auto' | 'box' | 'sphere' | 'capsule' | 'none'

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
  private readonly previousPositions = new Map<string, THREE.Vector3>()
  private readonly colliderGeometries = new Map<string, { geometry: THREE.BufferGeometry; signature: string }>()
  private debugVisible = false
  private readonly debugHelpers = new Map<string, THREE.LineSegments>()

  constructor(world: World) {
    this.world = world
  }

  update(): void {
    const objects = this.world.list().filter(object => object.mesh.visible)
    // Modelos importados usam a caixa proxy por padrão; quando necessário, o usuário
    // pode escolher um colisor simplificado no inspetor para maior estabilidade.
    this.keepObjectsAboveTerrain(objects)
    const collidableObjects = objects.filter(object => this.colliderType(object) !== 'none')
    const previousPairs = this.activePairs
    const currentPairs = new Map<string, CollisionPair>()

    // CCD (continuous collision detection): detecta movimentos que atravessariam
    // um obstáculo entre dois frames. Faz varredura adaptativa e busca binária
    // para deixar o objeto no último ponto seguro, antes da resolução SAT normal.
    this.resolveContinuousCollisions(collidableObjects)

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
    this.syncDebugHelpers(this.world.list())
    for (const object of collidableObjects) {
      this.previousPositions.set(object.id, object.mesh.position.clone())
    }
    const activeIds = new Set(collidableObjects.map(object => object.id))
    for (const id of this.previousPositions.keys()) {
      if (!activeIds.has(id)) this.previousPositions.delete(id)
    }
  }

  /**
   * Define o colisor por objeto via mesh.userData.colliderType:
   * 'auto' (padrão), 'box', 'sphere', 'capsule' ou 'none'.
   * Para box/sphere/capsule, dimensões e escala vêm da geometria local original.
   */
  private colliderType(object: GameObject): ColliderType {
    const value = object.mesh.userData.colliderType
    if (value === 'box' || value === 'sphere' || value === 'capsule' || value === 'none') return value
    return 'auto'
  }

  private getColliderGeometry(object: GameObject): THREE.BufferGeometry | null {
    const type = this.colliderType(object)
    if (type === 'none') return null
    const sourceGeometry = object.mesh.geometry
    if (!sourceGeometry.boundingBox) sourceGeometry.computeBoundingBox()
    const bounds = sourceGeometry.boundingBox
    const sourceSize = bounds ? bounds.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1)
    const configuredSize = object.mesh.userData.colliderSize
    const manualSize = Array.isArray(configuredSize) && configuredSize.length === 3 && configuredSize.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
      ? new THREE.Vector3(Math.max(0.05, configuredSize[0]), Math.max(0.05, configuredSize[1]), Math.max(0.05, configuredSize[2]))
      : null
    const offsetData = object.mesh.userData.colliderOffset
    const offset = Array.isArray(offsetData) && offsetData.length === 3
      ? offsetData.map((n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n : 0) as [number, number, number]
      : [0, 0, 0] as [number, number, number]
    if (type === 'auto' && !manualSize && offset.every(value => Math.abs(value) < 1e-9)) {
      // Modelos importados têm uma caixa invisível na raiz para seleção e transformação.
      // Usar sourceGeometry aqui transforma todo modelo num paralelepípedo e ignora sua malha real.
      // Como o resolvedor SAT exige formas convexas, geramos um casco convexo das malhas visuais
      // em coordenadas locais da raiz, em vez de usar a caixa proxy.
      if (object.mesh.userData.importedModel === true) {
        object.mesh.updateWorldMatrix(true, true)
        const inverseRoot = object.mesh.matrixWorld.clone().invert()
        const points: THREE.Vector3[] = []
        const signatureParts: string[] = []
        let totalVertices = 0
        object.mesh.traverse((child) => {
          if (child === object.mesh || !(child instanceof THREE.Mesh) || child.visible === false) return
          const position = child.geometry.getAttribute('position')
          if (!position || position.count < 3) return
          totalVertices += position.count
          signatureParts.push(`${child.uuid}:${child.geometry.uuid}:${child.matrix.elements.map(value => value.toFixed(4)).join(',')}`)
        })
        const signature = `auto-hull:${signatureParts.join('|')}`
        const cached = this.colliderGeometries.get(object.id)
        if (cached?.signature === signature) return cached.geometry
        if (cached) {
          cached.geometry.dispose()
          this.colliderGeometries.delete(object.id)
        }

        // Limita o custo do casco para modelos muito densos sem mudar a malha visual.
        const stride = Math.max(1, Math.ceil(totalVertices / 2500))
        let vertexIndex = 0
        object.mesh.traverse((child) => {
          if (child === object.mesh || !(child instanceof THREE.Mesh) || child.visible === false) return
          const position = child.geometry.getAttribute('position')
          if (!position || position.count < 3) return
          const toRoot = inverseRoot.clone().multiply(child.matrixWorld)
          for (let i = 0; i < position.count; i += 1, vertexIndex += 1) {
            if (vertexIndex % stride !== 0 && i !== 0 && i !== position.count - 1) continue
            points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toRoot))
          }
        })
        if (points.length >= 4) {
          try {
            const hull = new ConvexGeometry(points)
            if (hull.getAttribute('position').count >= 4) {
              this.colliderGeometries.set(object.id, { geometry: hull, signature })
              return hull
            }
            hull.dispose()
          } catch (error) {
            console.warn('[CollisionSystem] Não foi possível gerar o casco automático do modelo; usando a caixa proxy.', error)
          }
        }
      }
      return sourceGeometry
    }
    const size = manualSize ?? sourceSize
    const width = Math.max(size.x, 0.05)
    const height = Math.max(size.y, 0.05)
    const depth = Math.max(size.z, 0.05)
    const effectiveType = type === 'auto' ? 'box' : type
    const signature = `${effectiveType}:${width.toFixed(5)},${height.toFixed(5)},${depth.toFixed(5)}:${offset.join(',')}`
    const cached = this.colliderGeometries.get(object.id)
    if (cached?.signature === signature) return cached.geometry
    if (cached) cached.geometry.dispose()
    let geometry: THREE.BufferGeometry
    if (effectiveType === 'box') {
      geometry = new THREE.BoxGeometry(width, height, depth)
    } else if (effectiveType === 'sphere') {
      geometry = new THREE.IcosahedronGeometry(Math.max(width, height, depth) * 0.5, 2)
    } else {
      const radius = Math.max(0.025, Math.min(width, depth) * 0.25)
      geometry = new THREE.CapsuleGeometry(radius, Math.max(0, height - radius * 2), 4, 8)
      geometry.scale(width / Math.max(radius * 2, 0.05), 1, depth / Math.max(radius * 2, 0.05))
    }
    geometry.translate(offset[0], offset[1], offset[2])
    this.colliderGeometries.set(object.id, { geometry, signature })
    return geometry
  }

  /** Liga/desliga a representação wireframe dos colisores no viewport. */
  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible
    for (const helper of this.debugHelpers.values()) helper.visible = visible
    if (visible) this.syncDebugHelpers(this.world.list())
  }

  isDebugVisible(): boolean { return this.debugVisible }

  private syncDebugHelpers(objects: GameObject[]): void {
    if (!this.debugVisible) return
    const active = new Set(objects.map(object => object.id))
    for (const object of objects) {
      const geometry = this.getColliderGeometry(object)
      let helper = this.debugHelpers.get(object.id)
      if (!geometry) {
        if (helper) helper.visible = false
        continue
      }
      const configuredSize = object.mesh.userData.colliderSize
      const offset = object.mesh.userData.colliderOffset
      const signature = `${this.colliderType(object)}:${JSON.stringify(configuredSize ?? null)}:${JSON.stringify(offset ?? [0, 0, 0])}:${geometry.uuid}`
      if (!helper || helper.userData.signature !== signature) {
        if (helper) {
          object.mesh.remove(helper)
          helper.geometry.dispose()
          ;(helper.material as THREE.Material).dispose()
        }
        const edges = new THREE.EdgesGeometry(geometry)
        helper = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x45e6a4, transparent: true, opacity: 0.95, depthTest: false }))
        helper.name = 'collider-debug-wireframe'
        helper.userData.editorOverlay = true
        helper.userData.signature = signature
        helper.renderOrder = 20
        helper.visible = this.debugVisible && object.mesh.visible
        object.mesh.add(helper)
        this.debugHelpers.set(object.id, helper)
      }
      helper.visible = this.debugVisible && object.mesh.visible && this.colliderType(object) !== 'none'
    }
    for (const [id, helper] of this.debugHelpers) {
      if (active.has(id)) continue
      helper.removeFromParent()
      helper.geometry.dispose()
      ;(helper.material as THREE.Material).dispose()
      this.debugHelpers.delete(id)
    }
  }

  private resolveContinuousCollisions(objects: GameObject[]): void {
    for (const moving of objects) {
      if (this.inverseMass(moving) <= 0) continue
      const previous = this.previousPositions.get(moving.id)
      if (!previous) continue
      const target = moving.mesh.position.clone()
      const distance = previous.distanceTo(target)
      if (distance < 1e-5) continue

      for (const obstacle of objects) {
        if (obstacle.id === moving.id) continue
        // O CCD trata cada par contra a pose atual do outro corpo; a resolução
        // iterativa SAT posterior trata os contatos entre múltiplos corpos.
        const obstacleShape = this.buildShape(obstacle)
        if (!obstacleShape) continue
        const obstacleBounds = new THREE.Box3().setFromPoints(obstacleShape.vertices)
        const movingShape = this.buildShape(moving)
        if (!movingShape) continue
        const movingBounds = new THREE.Box3().setFromPoints(movingShape.vertices)
        const expanded = obstacleBounds.clone().expandByVector(
          movingBounds.getSize(new THREE.Vector3()).multiplyScalar(0.5),
        )
        if (!expanded.containsPoint(previous) && !expanded.containsPoint(target)) {
          const swept = new THREE.Box3().setFromPoints([previous, target])
          if (!swept.intersectsBox(expanded)) continue
        }

        const size = movingBounds.getSize(new THREE.Vector3())
        const smallestExtent = Math.max(0.05, Math.min(size.x || Infinity, size.y || Infinity, size.z || Infinity))
        const steps = THREE.MathUtils.clamp(Math.ceil(distance / (smallestExtent * CCD_FRACTION)), CCD_MIN_STEPS, CCD_MAX_STEPS)
        let firstHit = -1
        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps
          moving.mesh.position.copy(previous).lerp(target, t)
          moving.mesh.updateMatrixWorld(true)
          const candidate = this.buildShape(moving)
          if (!candidate) break
          const candidateBounds = new THREE.Box3().setFromPoints(candidate.vertices)
          if (candidateBounds.intersectsBox(obstacleBounds) && this.intersectConvex(candidate, obstacleShape)) {
            firstHit = t
            break
          }
        }

        if (firstHit >= 0) {
          let low = Math.max(0, firstHit - 1 / steps)
          let high = firstHit
          for (let iteration = 0; iteration < 10; iteration += 1) {
            const mid = (low + high) * 0.5
            moving.mesh.position.copy(previous).lerp(target, mid)
            moving.mesh.updateMatrixWorld(true)
            const candidate = this.buildShape(moving)
            const hit = candidate && this.intersectConvex(candidate, obstacleShape)
            if (hit) high = mid
            else low = mid
          }
          // Recuar uma fração mínima do intervalo evita reintroduzir penetração
          // por arredondamento; não é um afastamento físico entre os objetos.
          const safeT = Math.max(0, low - 1e-5)
          moving.mesh.position.copy(previous).lerp(target, safeT)
          moving.mesh.updateMatrixWorld(true)
          this.world.notifyChanged(moving.id)
          break
        }
        moving.mesh.position.copy(target)
        moving.mesh.updateMatrixWorld(true)
      }
    }
  }

  private inverseMass(object: GameObject): number {
    if (object.mesh.userData.locked === true) return 0
    const mass = object.mesh.userData.mass
    if (typeof mass !== 'number' || !Number.isFinite(mass)) return 1
    return mass <= 0 ? 0 : 1 / Math.max(0.0001, mass)
  }

  private buildShape(object: GameObject): ConvexShape | null {
    const mesh = object.mesh
    const geometry = this.getColliderGeometry(object)
    if (!geometry) return null
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
    this.previousPositions.clear()
    for (const entry of this.colliderGeometries.values()) entry.geometry.dispose()
    for (const helper of this.debugHelpers.values()) {
      helper.removeFromParent()
      helper.geometry.dispose()
      ;(helper.material as THREE.Material).dispose()
    }
    this.debugHelpers.clear()
    this.colliderGeometries.clear()
  }

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`
  }
}
