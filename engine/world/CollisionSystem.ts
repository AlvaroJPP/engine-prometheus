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

interface CachedCollisionShape {
  rootGeometry: THREE.BufferGeometry
  matrixWorld: number[]
  configSignature: string
  shape: ConvexShape | null
  bounds: THREE.Box3
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
  private readonly importedTriangleGeometries = new Map<string, { geometry: THREE.BufferGeometry; signature: string }>()
  private readonly shapeCache = new Map<string, CachedCollisionShape>()
  private readonly eventOffs: Array<() => void> = []

  constructor(world: World) {
    this.world = world
    this.eventOffs.push(
      world.events.on('objectChanged', ({ id }) => this.invalidateObject(id)),
      world.events.on('objectRemoved', ({ id }) => this.releaseObject(id)),
      world.events.on('worldReset', () => this.clear()),
    )
  }

  /** Invalida a forma mundial quando o objeto muda de transform ou colisor. */
  invalidateObject(id: string): void {
    this.shapeCache.delete(id)
  }

  private releaseObject(id: string): void {
    this.invalidateObject(id)
    const collider = this.colliderGeometries.get(id)
    collider?.geometry.dispose()
    this.colliderGeometries.delete(id)
    const triangles = this.importedTriangleGeometries.get(id)
    triangles?.geometry.dispose()
    this.importedTriangleGeometries.delete(id)
    // World.dispose já liberou a geometria/material do helper ligado à raiz.
    this.debugHelpers.delete(id)
  }

  /** Libera os listeners e os caches quando o motor é encerrado de verdade. */
  dispose(): void {
    this.clear()
    for (const off of this.eventOffs) off()
    this.eventOffs.length = 0
  }

  update(simulateContacts = true): void {
    const objects = this.world.list().filter(object => object.mesh.visible)
    if (!simulateContacts) {
      // O editor precisa manter os objetos apoiados no terreno, mas não precisa
      // executar CCD/SAT O(n²) em todos os objetos estáticos a cada frame.
      for (const [key, pair] of this.activePairs) {
        this.world.events.emit('collisionEnded', pair)
        this.activePairs.delete(key)
      }
      this.previousPositions.clear()
      this.keepObjectsAboveTerrain(objects.filter(object => object.mesh.userData.mountCollisionManaged !== true))
      this.syncDebugHelpers(this.world.list())
      return
    }
    // Modelos importados usam a caixa proxy por padrão; quando necessário, o usuário
    // pode escolher um colisor simplificado no inspetor para maior estabilidade.
    // A montaria já resolve seu piso e movimento no HumanoidAvatar; não a reposicione
    // com a gravidade/ajuste genérico do mundo durante a navegação em rampas.
    this.keepObjectsAboveTerrain(objects.filter(object => object.mesh.userData.mountCollisionManaged !== true))
    const collidableObjects = objects.filter(object => this.colliderType(object) !== 'none')
    const previousPairs = this.activePairs
    const currentPairs = new Map<string, CollisionPair>()

    // CCD (continuous collision detection): só faz teste detalhado nos obstáculos
    // que passam pela broad phase espacial; formas e AABBs são cacheados entre pares.
    this.resolveContinuousCollisions(collidableObjects)

    for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
      let resolvedAny = false
      const candidatePairs = this.buildBroadphasePairs(collidableObjects)
      for (const [a, b] of candidatePairs) {
        const shapeA = this.buildShape(a)
        const shapeB = this.buildShape(b)
        if (!shapeA || !shapeB) continue
        const boundsA = this.getShapeBounds(a, shapeA)
        const boundsB = this.getShapeBounds(b, shapeB)
        if (!boundsA.intersectsBox(boundsB)) continue

        const contact = this.intersectObjects(a, b, shapeA, shapeB)
        if (!contact) continue

        // Plataformas formam o cenário; os contatos são reconhecidos, mas as
        // peças não se empurram mutuamente e não abrem frestas nas emendas.
        if (this.isPlatformPair(a, b)) continue
        if (a.mesh.userData.mountCollisionManaged === true || b.mesh.userData.mountCollisionManaged === true) continue

        const inverseA = this.inverseMass(a)
        const inverseB = this.inverseMass(b)
        const totalInverseMass = inverseA + inverseB
        if (totalInverseMass <= 0) continue

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
      if (!resolvedAny) break
    }

    // A broad phase encontra os pares ainda em contato na pose já corrigida.
    for (const [a, b] of this.buildBroadphasePairs(collidableObjects)) {
      const shapeA = this.buildShape(a)
      const shapeB = this.buildShape(b)
      if (!shapeA || !shapeB) continue
      if (!this.getShapeBounds(a, shapeA).intersectsBox(this.getShapeBounds(b, shapeB))) continue
      if (this.intersectObjects(a, b, shapeA, shapeB)) {
        currentPairs.set(this.pairKey(a.id, b.id), { a: a.id, b: b.id })
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
    if (type === 'auto' && (object.mesh.userData.importedModel === true || (!manualSize && offset.every(value => Math.abs(value) < 1e-9))) ) {
      // A raiz do modelo importado é uma caixa proxy invisível para seleção e transformação.
      // Mantemos um casco convexo reduzido para broadphase e pares modelo-modelo; quando
      // um modelo automático encontra um corpo convexo, a decisão final usa os triângulos reais.
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
        const signature = `auto-hull:${offset.join(',')}:${signatureParts.join('|')}`
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
            points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toRoot).add(new THREE.Vector3(offset[0], offset[1], offset[2])))
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

  /**
   * Constrói a malha triangular real do modelo importado em coordenadas locais
   * da raiz. É usada tanto pela colisão malha-convexo quanto pelo wireframe.
   * Aplica morph targets e ossos para manter a malha alinhada à pose renderizada.
   */
  private getImportedTriangleGeometry(object: GameObject): THREE.BufferGeometry | null {
    if (this.colliderType(object) !== 'auto' || object.mesh.userData.importedModel !== true) {
      return this.getColliderGeometry(object)
    }

    const root = object.mesh
    root.updateWorldMatrix(true, true)
    const inverseRoot = root.matrixWorld.clone().invert()
    const offsetData = root.userData.colliderOffset
    const offset = Array.isArray(offsetData) && offsetData.length === 3
      ? offsetData.map((value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0) as [number, number, number]
      : [0, 0, 0] as [number, number, number]
    const poseVersion = typeof root.userData.colliderPoseVersion === 'number'
      ? root.userData.colliderPoseVersion
      : 0
    const entries: Array<{
      mesh: THREE.Mesh
      position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
      index: THREE.BufferAttribute | null
      toRoot: THREE.Matrix4
    }> = []
    const signatureParts: string[] = []

    root.traverse((child) => {
      if (
        child === root ||
        !(child instanceof THREE.Mesh) ||
        !child.visible ||
        child.userData.editorOverlay === true ||
        child.name === 'collider-debug-wireframe'
      ) return
      const position = child.geometry.getAttribute('position')
      if (!position || position.count < 3) return
      child.updateWorldMatrix(true, false)
      const toRoot = inverseRoot.clone().multiply(child.matrixWorld)
      const roundedMatrix = toRoot.elements.map(value => value.toFixed(4)).join(',')
      signatureParts.push(`${child.uuid}:${child.geometry.uuid}:${roundedMatrix}`)
      entries.push({ mesh: child, position, index: child.geometry.getIndex(), toRoot })
    })

    const signature = `triangle-mesh:${poseVersion}:${offset.join(',')}:${signatureParts.join('|')}`
    const cached = this.importedTriangleGeometries.get(object.id)
    if (cached?.signature === signature) return cached.geometry
    if (cached) {
      cached.geometry.dispose()
      this.importedTriangleGeometries.delete(object.id)
    }

    let vertexCount = 0
    let indexCount = 0
    for (const entry of entries) {
      vertexCount += entry.position.count
      indexCount += entry.index ? entry.index.count : entry.position.count
    }
    if (vertexCount === 0 || indexCount < 3) return null

    const positions = new Float32Array(vertexCount * 3)
    const indices = new Uint32Array(indexCount)
    const offsetVector = new THREE.Vector3(offset[0], offset[1], offset[2])
    const vertex = new THREE.Vector3()
    let vertexOffset = 0
    let indexOffset = 0

    for (const entry of entries) {
      if (entry.mesh instanceof THREE.SkinnedMesh) entry.mesh.skeleton.update()
      for (let i = 0; i < entry.position.count; i += 1) {
        entry.mesh.getVertexPosition(i, vertex)
        vertex.applyMatrix4(entry.toRoot).add(offsetVector)
        const destination = (vertexOffset + i) * 3
        positions[destination] = vertex.x
        positions[destination + 1] = vertex.y
        positions[destination + 2] = vertex.z
      }

      if (entry.index) {
        for (let i = 0; i < entry.index.count; i += 1) {
          indices[indexOffset++] = vertexOffset + entry.index.getX(i)
        }
      } else {
        for (let i = 0; i < entry.position.count; i += 1) {
          indices[indexOffset++] = vertexOffset + i
        }
      }
      vertexOffset += entry.position.count
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    this.importedTriangleGeometries.set(object.id, { geometry, signature })
    return geometry
  }

  /**
   * Identifica uma peça de piso/rampa para tratar sua emenda com outras peças
   * de cenário como uma junção, não como dois corpos que se empurram.
   *
   * Rampas no editor também podem ser feitas esticando e inclinando um cubo.
   * Esse caso precisa do mesmo tratamento de uma plataforma inclinada; caso
   * contrário, a subida pode funcionar e a descida bater na borda física.
   */
  private isPlatformSeamPiece(object: GameObject): boolean {
    if (object.type === 'platform') return true

    const mesh = object.mesh
    if (object.type !== 'cube' || mesh.userData.importedModel === true) return false
    const inclined = Math.abs(mesh.rotation.x) > 0.02 || Math.abs(mesh.rotation.z) > 0.02
    if (!inclined) return false

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const localSize = mesh.geometry.boundingBox?.getSize(new THREE.Vector3())
    if (!localSize) return false

    // Cubos de tamanho comum continuam sendo obstáculos. Um cubo só conta como
    // segmento de rampa quando foi alongado horizontalmente para formar o piso.
    const horizontalLength = Math.max(
      localSize.x * Math.abs(mesh.scale.x),
      localSize.z * Math.abs(mesh.scale.z),
    )
    return horizontalLength >= 1.5
  }

  private isPlatformPair(a: GameObject, b: GameObject): boolean {
    return this.isPlatformSeamPiece(a) && this.isPlatformSeamPiece(b)
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
      const geometry = this.getImportedTriangleGeometry(object)
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
        const edges = new THREE.WireframeGeometry(geometry)
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
      const cachedGeometry = this.importedTriangleGeometries.get(id)
      cachedGeometry?.geometry.dispose()
      this.importedTriangleGeometries.delete(id)
      const cachedCollider = this.colliderGeometries.get(id)
      cachedCollider?.geometry.dispose()
      this.colliderGeometries.delete(id)
    }
  }

  private resolveContinuousCollisions(objects: GameObject[]): void {
    for (const moving of objects) {
      if (moving.mesh.userData.mountCollisionManaged === true || this.inverseMass(moving) <= 0) continue
      const previous = this.previousPositions.get(moving.id)
      if (!previous) continue
      const target = moving.mesh.position.clone()
      const distance = previous.distanceTo(target)
      if (distance < 1e-5) continue

      for (const obstacle of objects) {
        if (obstacle.id === moving.id) continue
        // Plataformas formam o cenário. Deixá-las colidir com CCD entre si
        // impede sobreposição controlada e pode criar uma fresta na junção.
        if (this.isPlatformPair(moving, obstacle)) continue
        // O CCD trata cada par contra a pose atual do outro corpo; a resolução
        // iterativa SAT posterior trata os contatos entre múltiplos corpos.
        const obstacleShape = this.buildShape(obstacle)
        if (!obstacleShape) continue
        const obstacleBounds = this.getShapeBounds(obstacle, obstacleShape)
        const movingShape = this.buildShape(moving)
        if (!movingShape) continue
        const movingBounds = this.getShapeBounds(moving, movingShape)
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
          const candidateBounds = this.getShapeBounds(moving, candidate)
          if (candidateBounds.intersectsBox(obstacleBounds) && this.intersectObjects(moving, obstacle, candidate, obstacleShape)) {
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
            const hit = candidate && this.intersectObjects(moving, obstacle, candidate, obstacleShape)
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

  private colliderConfigSignature(object: GameObject): string {
    const mesh = object.mesh
    return [
      this.colliderType(object),
      JSON.stringify(mesh.userData.colliderSize ?? null),
      JSON.stringify(mesh.userData.colliderOffset ?? [0, 0, 0]),
    ].join('|')
  }

  private matrixMatches(cached: readonly number[], current: readonly number[]): boolean {
    if (cached.length !== current.length) return false
    for (let i = 0; i < current.length; i += 1) {
      if (Math.abs(cached[i]! - current[i]!) > 1e-8) return false
    }
    return true
  }

  private buildShape(object: GameObject): ConvexShape | null {
    const mesh = object.mesh
    mesh.updateWorldMatrix(true, false)
    const configSignature = this.colliderConfigSignature(object)
    const cached = this.shapeCache.get(object.id)
    if (
      cached
      && cached.rootGeometry === mesh.geometry
      && cached.configSignature === configSignature
      && this.matrixMatches(cached.matrixWorld, mesh.matrixWorld.elements)
    ) {
      return cached.shape
    }

    const geometry = this.getColliderGeometry(object)
    const shape = this.buildShapeFromGeometry(object, geometry)
    const bounds = shape ? this.getShapeBoundsUncached(object, shape) : new THREE.Box3()
    this.shapeCache.set(object.id, {
      rootGeometry: mesh.geometry,
      matrixWorld: [...mesh.matrixWorld.elements],
      configSignature,
      shape,
      bounds,
    })
    return shape
  }

  private buildBroadphasePairs(objects: readonly GameObject[]): Array<[GameObject, GameObject]> {
    const entries: Array<{ object: GameObject; bounds: THREE.Box3 }> = []
    for (const object of objects) {
      const shape = this.buildShape(object)
      if (!shape) continue
      entries.push({ object, bounds: this.getShapeBounds(object, shape) })
    }

    // Sweep-and-prune: em cenas espalhadas, evita testar cada objeto contra todos
    // os outros. Os contatos novos após correções são incluídos na próxima passada.
    entries.sort((left, right) => left.bounds.min.x - right.bounds.min.x)
    const pairs: Array<[GameObject, GameObject]> = []
    for (let i = 0; i < entries.length; i += 1) {
      const left = entries[i]!
      for (let j = i + 1; j < entries.length; j += 1) {
        const right = entries[j]!
        if (right.bounds.min.x > left.bounds.max.x + CONTACT_TOLERANCE) break
        if (left.bounds.intersectsBox(right.bounds)) pairs.push([left.object, right.object])
      }
    }
    return pairs
  }

  private buildShapeFromGeometry(object: GameObject, geometry: THREE.BufferGeometry | null): ConvexShape | null {
    const mesh = object.mesh
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

  private getShapeBounds(object: GameObject, shape: ConvexShape): THREE.Box3 {
    const cached = this.shapeCache.get(object.id)
    if (cached?.shape === shape) return cached.bounds
    return this.getShapeBoundsUncached(object, shape)
  }

  private getShapeBoundsUncached(object: GameObject, shape: ConvexShape): THREE.Box3 {
    if (this.isAutomaticImportedMesh(object)) {
      // O casco aproximado pode não conter uma ponta/orelha que ficou fora da
      // amostragem. Use a caixa proxy do modelo como broad phase conservadora;
      // a decisão final continua sendo feita pelos triângulos reais.
      const bounds = getRootBounds(object.mesh)
      const offsetData = object.mesh.userData.colliderOffset
      if (Array.isArray(offsetData) && offsetData.length === 3) {
        const origin = new THREE.Vector3().applyMatrix4(object.mesh.matrixWorld)
        const displaced = new THREE.Vector3(
          typeof offsetData[0] === 'number' ? offsetData[0] : 0,
          typeof offsetData[1] === 'number' ? offsetData[1] : 0,
          typeof offsetData[2] === 'number' ? offsetData[2] : 0,
        ).applyMatrix4(object.mesh.matrixWorld).sub(origin)
        bounds.translate(displaced)
      }
      return bounds.expandByScalar(0.35)
    }
    return new THREE.Box3().setFromPoints(shape.vertices)
  }

  private isAutomaticImportedMesh(object: GameObject): boolean {
    return object.mesh.userData.importedModel === true && this.colliderType(object) === 'auto'
  }

  /**
   * Modelos automáticos são malhas côncavas; o SAT de um casco único preencheria
   * espaços vazios (por exemplo, entre as pernas). Para pares malha-convexo,
   * testa os triângulos reais e calcula a menor correção pela face em contato.
   */
  private intersectObjects(
    aObject: GameObject,
    bObject: GameObject,
    a: ConvexShape,
    b: ConvexShape,
  ): Contact | null {
    const aIsMesh = this.isAutomaticImportedMesh(aObject)
    const bIsMesh = this.isAutomaticImportedMesh(bObject)

    if (aIsMesh && !bIsMesh) {
      return this.intersectTriangleMeshWithConvex(aObject, b)
        ?? (this.getImportedTriangleGeometry(aObject) ? null : this.intersectConvex(a, b))
    }
    if (bIsMesh && !aIsMesh) {
      const contact = this.intersectTriangleMeshWithConvex(bObject, a)
      if (contact) contact.normal.negate()
      return contact ?? (this.getImportedTriangleGeometry(bObject) ? null : this.intersectConvex(a, b))
    }

    // Quando dois modelos côncavos se encontram, preserva o SAT dos cascos
    // como fallback; a consulta exata cobre o caso comum malha-convexo.
    return this.intersectConvex(a, b)
  }

  private intersectTriangleMeshWithConvex(object: GameObject, shape: ConvexShape): Contact | null {
    const geometry = this.getImportedTriangleGeometry(object)
    if (!geometry) return null
    const position = geometry.getAttribute('position')
    if (!position || position.count < 3) return null

    const root = object.mesh
    root.updateWorldMatrix(true, false)
    const index = geometry.getIndex()
    const triangleCount = Math.floor((index ? index.count : position.count) / 3)
    const shapeBounds = new THREE.Box3().setFromPoints(shape.vertices)
    const pointA = new THREE.Vector3()
    const pointB = new THREE.Vector3()
    const pointC = new THREE.Vector3()
    const triangleNormal = new THREE.Vector3()
    const edgeAB = new THREE.Vector3()
    const edgeBC = new THREE.Vector3()
    const edgeCA = new THREE.Vector3()
    const axis = new THREE.Vector3()
    const triangleCenter = new THREE.Vector3()
    const triangleBounds = new THREE.Box3()
    const trianglePoints: THREE.Vector3[] = [pointA, pointB, pointC]
    let bestContact: Contact | null = null

    const projectTriangle = (direction: THREE.Vector3): { min: number; max: number } => {
      const first = pointA.dot(direction)
      const second = pointB.dot(direction)
      const third = pointC.dot(direction)
      return {
        min: Math.min(first, second, third),
        max: Math.max(first, second, third),
      }
    }

    const overlapsOnAxis = (direction: THREE.Vector3): boolean => {
      if (direction.lengthSq() <= AXIS_EPSILON_SQ) return true
      direction.normalize()
      // O eixo normal do triângulo é tratado separadamente com a profundidade
      // do plano. Repeti-lo aqui sempre produziria projeção triangular de largura
      // zero e rejeitaria contatos válidos com faces alinhadas.
      if (Math.abs(direction.dot(triangleNormal)) >= 0.9999) return true
      const triangleProjection = projectTriangle(direction)
      const shapeProjection = this.project(shape.vertices, direction)
      const overlap = Math.min(triangleProjection.max, shapeProjection.max) -
        Math.max(triangleProjection.min, shapeProjection.min)
      return overlap > CONTACT_TOLERANCE
    }

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const ia = index ? index.getX(triangleIndex * 3) : triangleIndex * 3
      const ib = index ? index.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1
      const ic = index ? index.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2
      pointA.fromBufferAttribute(position, ia).applyMatrix4(root.matrixWorld)
      pointB.fromBufferAttribute(position, ib).applyMatrix4(root.matrixWorld)
      pointC.fromBufferAttribute(position, ic).applyMatrix4(root.matrixWorld)

      triangleBounds.setFromPoints(trianglePoints)
      if (!triangleBounds.intersectsBox(shapeBounds)) continue

      triangleNormal.copy(pointB).sub(pointA).cross(edgeCA.copy(pointC).sub(pointA))
      if (triangleNormal.lengthSq() <= AXIS_EPSILON_SQ) continue
      triangleNormal.normalize()

      // O plano do triângulo precisa atravessar o volume convexo; apenas tocar
      // sua fronteira não deve empurrar os objetos para longe.
      const plane = pointA.dot(triangleNormal)
      const shapePlane = this.project(shape.vertices, triangleNormal)
      if (plane <= shapePlane.min + CONTACT_TOLERANCE ||
          plane >= shapePlane.max - CONTACT_TOLERANCE) continue
      const depth = Math.min(plane - shapePlane.min, shapePlane.max - plane)
      if (bestContact && depth >= bestContact.depth) continue

      edgeAB.copy(pointB).sub(pointA)
      edgeBC.copy(pointC).sub(pointB)
      edgeCA.copy(pointA).sub(pointC)
      let separated = false

      // Eixos das faces do corpo convexo.
      for (const faceNormal of shape.faceNormals) {
        axis.copy(faceNormal)
        if (!overlapsOnAxis(axis)) { separated = true; break }
      }
      if (separated) continue

      // Eixos formados pelo produto vetorial das arestas dos dois corpos.
      const triangleEdges = [edgeAB, edgeBC, edgeCA]
      for (const triangleEdge of triangleEdges) {
        for (const shapeEdge of shape.edges) {
          axis.copy(triangleEdge).cross(shapeEdge)
          if (!overlapsOnAxis(axis)) { separated = true; break }
        }
        if (separated) break
      }
      if (separated) continue

      triangleCenter.copy(pointA).add(pointB).add(pointC).multiplyScalar(1 / 3)
      const normal = triangleNormal.clone()
      if (shape.center.clone().sub(triangleCenter).dot(normal) < 0) normal.negate()
      bestContact = { normal, depth }
    }

    return bestContact
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
    this.shapeCache.clear()
    for (const entry of this.colliderGeometries.values()) entry.geometry.dispose()
    for (const helper of this.debugHelpers.values()) {
      helper.removeFromParent()
      helper.geometry.dispose()
      ;(helper.material as THREE.Material).dispose()
    }
    this.debugHelpers.clear()
    for (const entry of this.importedTriangleGeometries.values()) entry.geometry.dispose()
    this.importedTriangleGeometries.clear()
    this.colliderGeometries.clear()
  }

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`
  }
}
