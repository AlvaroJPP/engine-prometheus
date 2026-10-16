import * as THREE from 'three'
import { CENTER, MeshBVH, acceleratedRaycast } from 'three-mesh-bvh'
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker'
import type { GameObject } from '../model/object/GameObject'

// A oclusão usa raycasts contra a geometria real; intervalos maiores evitam
// que uma órbita rápida monopolize a CPU com dezenas de avaliações por segundo.
const MIN_RECHECK_INTERVAL_MS = 220
const CAMERA_MOVE_THRESHOLD_SQ = 0.12 * 0.12
const CAMERA_ROTATION_DOT_THRESHOLD = 0.00008
const ENTER_OCCLUSION_MARGIN = 0.65
const STAY_OCCLUSION_MARGIN = 0.12
const SELF_OCCLUSION_MARGIN = 0.12
const MIN_TARGET_DISTANCE = 0.2
const MIN_BVH_TRIANGLES = 700
const BVH_TARGET_LEAF_SIZE = 12

type GeometryWithBoundsTree = THREE.BufferGeometry & { boundsTree?: MeshBVH }

const OCCLUSION_ANCHORS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  [0.5, 0, 0.5], [0.5, 1, 0.5],
  [0.5, 0.5, 0], [0.5, 0.5, 1],
  [0, 0.5, 0.5], [1, 0.5, 0.5],
  [0.5, 0.5, 0.5],
] as const

interface PreparedMesh {
  mesh: THREE.Mesh
  bounds: THREE.Box3
  opaque: boolean
}

interface PreparedRoot {
  root: THREE.Object3D
  bounds: THREE.Box3
  meshes: PreparedMesh[]
  importedModel: boolean
  animated: boolean
}

/**
 * Oclusão conservadora de submalhas de modelos importados.
 *
 * O sistema só oculta uma submalha estática quando todos os pontos de amostra
 * sobre sua geometria são bloqueados por malhas opacas de outros objetos ou por
 * regiões independentes geradas pelo particionador dentro do mesmo modelo.
 * Superfícies parcialmente visíveis permanecem intactas.
 */
export class ModelOcclusionSystem {
  private dirty = true
  private rootsDirty = true
  private cachedPreparedRoots: PreparedRoot[] | null = null
  private lastEvaluationAt = 0
  private readonly lastCameraPosition = new THREE.Vector3()
  private readonly lastCameraQuaternion = new THREE.Quaternion()
  private readonly cameraQuaternion = new THREE.Quaternion()
  private readonly lastProjectionMatrix = new THREE.Matrix4()
  private readonly viewProjectionMatrix = new THREE.Matrix4()
  private readonly frustum = new THREE.Frustum()
  private hasLastCamera = false
  private hasLastProjection = false
  // three-mesh-bvh usa firstHitOnly para terminar cada raio assim que encontra
  // a interseção mais próxima, em vez de coletar todos os triângulos atingidos.
  private readonly raycaster = Object.assign(new THREE.Raycaster(), { firstHitOnly: true })
  private readonly cameraPosition = new THREE.Vector3()
  private readonly rayDirection = new THREE.Vector3()
  private readonly targetPoint = new THREE.Vector3()
  private readonly boundsHit = new THREE.Vector3()
  private readonly localSamples = new WeakMap<THREE.BufferGeometry, THREE.Vector3[]>()
  /** Meshas removidas visualmente pelo sistema e seu estado antes da oclusão. */
  private readonly culledMeshes = new Map<THREE.Mesh, boolean>()
  private readonly rootsBeingPrepared = new WeakSet<THREE.Object3D>()
  private readonly rootsPrepared = new WeakSet<THREE.Object3D>()
  private readonly geometryBuilds = new WeakMap<THREE.BufferGeometry, Promise<boolean>>()
  private preparationQueue: Promise<void> = Promise.resolve()
  private bvhWorker: GenerateMeshBVHWorker | null = null
  private disposed = false

  invalidate(): void {
    this.dirty = true
    this.rootsDirty = true
  }

  /**
   * Pré-processa as malhas opacas e estáticas de um modelo importado.
   *
   * A árvore BVH acelera o teste de raios por triângulo em modelos densos. A
   * geometria é clonada antes de ser enviada ao Web Worker para que o modelo
   * continue renderizável durante o cálculo. A preparação é serializada para
   * não abrir um worker por malha ou competir com outros modelos carregados.
   */
  prepareRoot(root: THREE.Object3D, animated: boolean): Promise<void> {
    if (this.disposed || animated || this.rootsPrepared.has(root)) return Promise.resolve()
    if (this.rootsBeingPrepared.has(root)) return this.preparationQueue

    this.rootsBeingPrepared.add(root)
    const task = this.preparationQueue.then(async () => {
      try {
        if (this.disposed || root.parent === null) return
        root.updateWorldMatrix(true, true)

        // Uma malha única com dezenas de milhares de triângulos não pode ter
        // partes ocluídas separadamente. Divida apenas modelos grandes e estáticos
        // em até oito regiões espaciais, mantendo as superfícies pequenas intactas.
        await this.partitionLargeMeshes(root)
        if (this.disposed || root.parent === null) return
        root.updateWorldMatrix(true, true)

        const blockerMeshes = new Set<THREE.Mesh>()
        const geometries = new Set<THREE.BufferGeometry>()
        root.traverse((node) => {
          if (!(node instanceof THREE.Mesh) || node instanceof THREE.SkinnedMesh) return
          if (this.isEditorOverlay(node) || node.name === 'collider-debug-wireframe') return
          if (!this.isEffectivelyVisible(node, root) || !this.isOpaqueBlocker(node.material)) return
          if (node.geometry.morphAttributes.position?.length) return

          const geometry = node.geometry
          const position = geometry.getAttribute('position')
          if (!position || position.isInterleavedBufferAttribute) return
          if (geometry.index?.isInterleavedBufferAttribute) return
          if (geometry.drawRange.count !== Infinity) return
          const triangleCount = Math.floor((geometry.index?.count ?? position.count) / 3)
          if (triangleCount < MIN_BVH_TRIANGLES) return

          blockerMeshes.add(node)
          geometries.add(geometry)
        })

        for (const geometry of geometries) {
          if (this.disposed || root.parent === null) break
          await this.buildBoundsTreeIfNeeded(geometry)
          // Ceder entre malhas mantém a interface responsiva enquanto um GLB
          // com vários objetos densos é preparado.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }

        for (const mesh of blockerMeshes) {
          if ((mesh.geometry as GeometryWithBoundsTree).boundsTree) {
            // A função acelerada mantém o mesmo contrato da interseção Three.js;
            // malhas sem BVH continuam usando o raycast tradicional.
            mesh.raycast = acceleratedRaycast
          }
        }

        if (!this.disposed && root.parent !== null) this.rootsPrepared.add(root)
        this.invalidate()
      } finally {
        this.rootsBeingPrepared.delete(root)
      }
    })

    this.preparationQueue = task.catch((error: unknown) => {
      console.warn('[ModelOcclusion] Falha ao preparar o modelo para oclusão.', error)
    })
    return this.preparationQueue
  }

  private async partitionLargeMeshes(root: THREE.Object3D): Promise<void> {
    const candidates: THREE.Mesh[] = []
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || node instanceof THREE.SkinnedMesh) return
      if (node.children.length > 0 || this.isEditorOverlay(node) || !this.isOpaqueBlocker(node.material)) return
      const geometry = node.geometry
      if (Object.values(geometry.morphAttributes).some((attributes) => attributes.length > 0)) return
      if (geometry.drawRange.count !== Infinity) return
      const position = geometry.getAttribute('position')
      if (!position || position.isInterleavedBufferAttribute) return
      if (Object.values(geometry.attributes).some((attribute) =>
        (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true
      )) return

      const elementCount = geometry.index?.count ?? position.count
      const triangleCount = Math.floor(elementCount / 3)
      if (triangleCount < MIN_TRIANGLES_FOR_PARTITION) return
      if (elementCount % 3 !== 0) return
      if (Array.isArray(node.material) && geometry.groups.length === 0) return
      if (geometry.groups.some(group => group.start % 3 !== 0 || group.count % 3 !== 0)) return
      candidates.push(node)
    })

    for (const mesh of candidates) {
      if (this.disposed || root.parent === null) return
      try {
        const replacement = await this.createOcclusionPartitions(mesh)
        if (replacement) this.replaceMeshWithPartitions(mesh, replacement)
      } catch (error) {
        // Particionar é uma otimização, nunca um requisito para abrir o modelo.
        console.warn('[ModelOcclusion] Não foi possível dividir uma malha densa; mantendo a original.', error)
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    }
  }

  private async createOcclusionPartitions(mesh: THREE.Mesh): Promise<THREE.Group | null> {
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    if (!position || position.count === 0) return null
    const elementCount = geometry.index?.count ?? position.count
    const totalTriangles = Math.floor(elementCount / 3)
    const bounds = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox)
    if (!bounds || bounds.isEmpty()) return null

    // O limite de oito regiões evita multiplicar excessivamente os draw calls.
    const desiredParts = Math.min(8, Math.max(2, Math.ceil(totalTriangles / 6000)))
    const targetParts = 2 ** Math.floor(Math.log2(desiredParts))
    const size = bounds.getSize(new THREE.Vector3())
    const divisions = [1, 1, 1]
    let partCount = 1
    while (partCount < targetParts) {
      let axis = 0
      let largestCellExtent = size.x / divisions[0]!
      for (let candidateAxis = 1; candidateAxis < 3; candidateAxis += 1) {
        const extent = (candidateAxis === 1 ? size.y : size.z) / divisions[candidateAxis]!
        if (extent > largestCellExtent) {
          largestCellExtent = extent
          axis = candidateAxis
        }
      }
      divisions[axis] = divisions[axis]! * 2
      partCount *= 2
    }

    const materialGroups = Array.isArray(mesh.material)
      ? geometry.groups.map(group => ({ start: group.start, count: group.count, materialIndex: group.materialIndex }))
      : [{ start: 0, count: elementCount, materialIndex: 0 }]
    if (materialGroups.length === 0) return null

    // Cada célula mantém triângulos agrupados por material. A partição só muda
    // a organização espacial; não descarta polígonos nem modifica UVs/normais.
    const buckets = new Map<number, Map<number, number[]>>()
    const getVertexIndex = (element: number): number => geometry.index ? geometry.index.getX(element) : element
    const cellCoordinate = (value: number, min: number, extent: number, count: number): number => {
      if (count <= 1 || extent <= 1e-8) return 0
      return THREE.MathUtils.clamp(Math.floor(((value - min) / extent) * count), 0, count - 1)
    }

    let processedTriangles = 0
    const first = new THREE.Vector3()
    const second = new THREE.Vector3()
    const third = new THREE.Vector3()
    for (const group of materialGroups) {
      const end = Math.min(elementCount, group.start + group.count)
      for (let offset = group.start; offset + 2 < end; offset += 3) {
        const sourceA = getVertexIndex(offset)
        const sourceB = getVertexIndex(offset + 1)
        const sourceC = getVertexIndex(offset + 2)
        first.fromBufferAttribute(position, sourceA)
        second.fromBufferAttribute(position, sourceB)
        third.fromBufferAttribute(position, sourceC)
        const centerX = (first.x + second.x + third.x) / 3
        const centerY = (first.y + second.y + third.y) / 3
        const centerZ = (first.z + second.z + third.z) / 3
        const column = cellCoordinate(centerX, bounds.min.x, size.x, divisions[0]!)
        const row = cellCoordinate(centerY, bounds.min.y, size.y, divisions[1]!)
        const depth = cellCoordinate(centerZ, bounds.min.z, size.z, divisions[2]!)
        const key = (depth * divisions[1]! + row) * divisions[0]! + column
        let materials = buckets.get(key)
        if (!materials) {
          materials = new Map<number, number[]>()
          buckets.set(key, materials)
        }
        let indices = materials.get(group.materialIndex)
        if (!indices) {
          indices = []
          materials.set(group.materialIndex, indices)
        }
        indices.push(sourceA, sourceB, sourceC)

        processedTriangles += 1
        // Cede a interface durante a varredura de modelos com muitos triângulos.
        if (processedTriangles % 6000 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
          if (this.disposed || mesh.parent === null) return null
        }
      }
    }

    if (buckets.size < 2) return null
    const partitionGroup = new THREE.Group()
    partitionGroup.name = mesh.name
    partitionGroup.position.copy(mesh.position)
    partitionGroup.quaternion.copy(mesh.quaternion)
    partitionGroup.scale.copy(mesh.scale)
    partitionGroup.matrix.copy(mesh.matrix)
    partitionGroup.matrixAutoUpdate = mesh.matrixAutoUpdate
    partitionGroup.matrixWorldAutoUpdate = mesh.matrixWorldAutoUpdate
    partitionGroup.visible = mesh.visible
    partitionGroup.renderOrder = mesh.renderOrder
    partitionGroup.frustumCulled = mesh.frustumCulled
    partitionGroup.layers.mask = mesh.layers.mask
    partitionGroup.userData = { ...mesh.userData, occlusionPartitioned: true }

    const sortedCells = [...buckets.keys()].sort((a, b) => a - b)
    let chunkIndex = 0
    for (const cellKey of sortedCells) {
      const byMaterial = buckets.get(cellKey)!
      const materialIndices = [...byMaterial.keys()].sort((a, b) => a - b)
      const vertexRemap = new Map<number, number>()
      const usedVertexIndices: number[] = []
      const newIndices: number[] = []
      const groupRanges: Array<{ start: number; count: number; materialIndex: number }> = []

      for (const materialIndex of materialIndices) {
        const sourceIndices = byMaterial.get(materialIndex)!
        const groupStart = newIndices.length
        for (const sourceVertex of sourceIndices) {
          let localVertex = vertexRemap.get(sourceVertex)
          if (localVertex === undefined) {
            localVertex = usedVertexIndices.length
            usedVertexIndices.push(sourceVertex)
            vertexRemap.set(sourceVertex, localVertex)
          }
          newIndices.push(localVertex)
        }
        const groupCount = newIndices.length - groupStart
        if (groupCount > 0) groupRanges.push({ start: groupStart, count: groupCount, materialIndex })
      }
      if (newIndices.length === 0) continue

      const chunkGeometry = new THREE.BufferGeometry()
      chunkGeometry.name = geometry.name ? `${geometry.name}_occlusion_${chunkIndex}` : `${mesh.name}_occlusion_${chunkIndex}`
      chunkGeometry.userData = { ...geometry.userData }

      for (const [attributeName, rawAttribute] of Object.entries(geometry.attributes)) {
        const sourceAttribute = rawAttribute as THREE.BufferAttribute
        const ArrayConstructor = sourceAttribute.array.constructor as {
          new(length: number): typeof sourceAttribute.array
        }
        const compactArray = new ArrayConstructor(usedVertexIndices.length * sourceAttribute.itemSize)
        for (let localVertex = 0; localVertex < usedVertexIndices.length; localVertex += 1) {
          const sourceVertex = usedVertexIndices[localVertex]!
          const sourceOffset = sourceVertex * sourceAttribute.itemSize
          const targetOffset = localVertex * sourceAttribute.itemSize
          for (let component = 0; component < sourceAttribute.itemSize; component += 1) {
            compactArray[targetOffset + component] = sourceAttribute.array[sourceOffset + component]!
          }
        }
        const AttributeConstructor = sourceAttribute.constructor as new (
          array: typeof sourceAttribute.array,
          itemSize: number,
          normalized?: boolean,
        ) => THREE.BufferAttribute
        const chunkAttribute = new AttributeConstructor(compactArray, sourceAttribute.itemSize, sourceAttribute.normalized)
        chunkAttribute.name = sourceAttribute.name
        chunkAttribute.setUsage(sourceAttribute.usage)
        chunkAttribute.gpuType = sourceAttribute.gpuType
        chunkGeometry.setAttribute(attributeName, chunkAttribute)
      }

      chunkGeometry.setIndex(newIndices)
      if (Array.isArray(mesh.material)) {
        for (const group of groupRanges) {
          chunkGeometry.addGroup(group.start, group.count, group.materialIndex)
        }
      }
      chunkGeometry.computeBoundingBox()
      chunkGeometry.computeBoundingSphere()

      const chunkMesh = new THREE.Mesh(chunkGeometry, mesh.material)
      chunkMesh.name = `__occlusion_chunk_${chunkIndex}`
      chunkMesh.userData.occlusionGeneratedChunk = true
      chunkMesh.castShadow = mesh.castShadow
      chunkMesh.receiveShadow = mesh.receiveShadow
      chunkMesh.renderOrder = mesh.renderOrder
      chunkMesh.frustumCulled = mesh.frustumCulled
      chunkMesh.layers.mask = mesh.layers.mask
      partitionGroup.add(chunkMesh)
      chunkIndex += 1
    }

    if (partitionGroup.children.length < 2) {
      for (const child of partitionGroup.children) {
        const chunkMesh = child as THREE.Mesh
        chunkMesh.geometry.dispose()
      }
      return null
    }

    partitionGroup.updateMatrix()
    return partitionGroup
  }

  private replaceMeshWithPartitions(mesh: THREE.Mesh, replacement: THREE.Group): void {
    const parent = mesh.parent
    if (!parent) return
    const originalIndex = parent.children.indexOf(mesh)
    parent.add(replacement)
    parent.remove(mesh)

    // Preserve a ordem dos irmãos no glTF, importante para transparências e
    // callbacks de renderização do projeto (as malhas particionadas são opacas).
    const replacementIndex = parent.children.indexOf(replacement)
    if (replacementIndex >= 0 && replacementIndex !== originalIndex) {
      parent.children.splice(replacementIndex, 1)
      parent.children.splice(Math.min(originalIndex, parent.children.length), 0, replacement)
    }
  }

  private buildBoundsTreeIfNeeded(geometry: THREE.BufferGeometry): Promise<boolean> {
    const typedGeometry = geometry as GeometryWithBoundsTree
    if (typedGeometry.boundsTree) return Promise.resolve(true)

    const currentBuild = this.geometryBuilds.get(geometry)
    if (currentBuild) return currentBuild

    const build = this.buildBoundsTree(geometry)
    this.geometryBuilds.set(geometry, build)
    return build
  }

  private async buildBoundsTree(geometry: THREE.BufferGeometry): Promise<boolean> {
    const typedGeometry = geometry as GeometryWithBoundsTree
    const workerGeometry = geometry.clone()

    try {
      this.bvhWorker ??= new GenerateMeshBVHWorker()
      const workerTree = await this.bvhWorker.generate(workerGeometry, {
        strategy: CENTER,
        targetLeafSize: BVH_TARGET_LEAF_SIZE,
        indirect: true,
      })

      if (this.disposed) return false

      // A árvore devolvida pelo worker aponta para o clone enviado. Serializar e
      // desserializar contra a geometria original permite manter os buffers de
      // renderização intactos e deixa apenas a estrutura espacial em cache.
      const serialized = MeshBVH.serialize(workerTree, { cloneBuffers: true })
      typedGeometry.boundsTree = MeshBVH.deserialize(serialized, geometry, { setIndex: false })
      return true
    } catch (error) {
      if (this.disposed) return false
      console.warn('[ModelOcclusion] BVH em worker indisponível; tentando preparação local.', error)
      try {
        typedGeometry.boundsTree = new MeshBVH(geometry, {
          strategy: CENTER,
          targetLeafSize: BVH_TARGET_LEAF_SIZE,
          indirect: true,
        })
        return true
      } catch (fallbackError) {
        console.warn('[ModelOcclusion] Não foi possível criar BVH; usando raycast padrão.', fallbackError)
        return false
      }
    } finally {
      workerGeometry.dispose()
    }
  }

  /**
   * Libera a visibilidade de um modelo antes de um sistema de comportamento
   * aplicar um estado explícito de mostrar/ocultar em algum de seus nós.
   */
  restoreObjectVisibility(root: THREE.Object3D): void {
    for (const [mesh, visibleBeforeCull] of this.culledMeshes) {
      let current: THREE.Object3D | null = mesh
      while (current && current !== root) current = current.parent
      if (current === root) {
        mesh.visible = visibleBeforeCull
        this.culledMeshes.delete(mesh)
      }
    }
    this.invalidate()
  }

  /**
   * Avalia submalhas dos modelos importados quando a câmera ou a cena mudam.
   * Retorna true somente se o conjunto final de submalhas ocultas foi alterado.
   */
  update(camera: THREE.Camera, objects: readonly GameObject[], now = performance.now()): boolean {
    camera.updateMatrixWorld(true)
    camera.getWorldPosition(this.cameraPosition)
    camera.getWorldQuaternion(this.cameraQuaternion)
    const cameraMoved = !this.hasLastCamera
      || this.lastCameraPosition.distanceToSquared(this.cameraPosition) >= CAMERA_MOVE_THRESHOLD_SQ
    // A visibilidade muda ao girar a câmera mesmo quando a posição não muda.
    const cameraRotated = !this.hasLastCamera
      || 1 - Math.abs(this.lastCameraQuaternion.dot(this.cameraQuaternion)) > CAMERA_ROTATION_DOT_THRESHOLD
    const projectionChanged = !this.hasLastProjection
      || !this.lastProjectionMatrix.equals(camera.projectionMatrix)

    if (!this.dirty && !cameraMoved && !cameraRotated && !projectionChanged) return false
    if (this.lastEvaluationAt > 0 && now - this.lastEvaluationAt < MIN_RECHECK_INTERVAL_MS) {
      // Limita o custo dos raycasts sem desativar a oclusão entre avaliações.
      // A versão anterior reexibia todas as malhas a cada movimento da câmera,
      // fazendo a oclusão durar apenas um quadro e quase nunca reduzindo triângulos.
      this.dirty = true
      return false
    }

    const previousCulled = new Set(this.culledMeshes.keys())
    this.restoreCulledMeshes()
    this.dirty = false
    this.lastEvaluationAt = now
    this.hasLastCamera = true
    this.hasLastProjection = true
    this.lastCameraPosition.copy(this.cameraPosition)
    this.lastCameraQuaternion.copy(this.cameraQuaternion)
    this.lastProjectionMatrix.copy(camera.projectionMatrix)
    this.viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewProjectionMatrix)

    if (this.rootsDirty || !this.cachedPreparedRoots) {
      this.cachedPreparedRoots = this.prepareRoots(objects)
      this.rootsDirty = false
    }
    const preparedRoots = this.cachedPreparedRoots
    const modelRoots = preparedRoots.filter(root =>
      root.importedModel
      && !root.animated
      && !this.rootsBeingPrepared.has(root.root)
      && root.root.userData.wireframeVisible !== true
      && !root.bounds.isEmpty()
    )
    // Um bloqueador completamente fora do frustum não pode cruzar o segmento
    // entre a câmera e um alvo que está dentro dele. Filtrá-lo aqui reduz o
    // conjunto de caixas e geometrias consultadas por cada raio.
    const occluderRoots = preparedRoots.filter(root =>
      !root.animated
      && !this.rootsBeingPrepared.has(root.root)
      && !root.bounds.isEmpty()
      && this.frustum.intersectsBox(root.bounds)
      && root.meshes.some(mesh => mesh.opaque)
    )

    // Calcule uma vez por avaliação quais alvos podem ser ocluídos. Antes, o
    // mesmo nó era percorrido repetidamente durante a detecção de candidatos e
    // de novo durante os raycasts, custo alto em modelos particionados.
    const eligibleTargetsByRoot = new Map<PreparedRoot, PreparedMesh[]>()
    for (const targetRoot of modelRoots) {
      const eligibleTargets = targetRoot.meshes.filter(target => this.isEligibleTarget(target, targetRoot.root))
      if (eligibleTargets.length > 0) eligibleTargetsByRoot.set(targetRoot, eligibleTargets)
    }
    if (eligibleTargetsByRoot.size === 0) return previousCulled.size > 0

    let hasPotentialOccluder = false
    for (const [targetRoot, eligibleTargets] of eligibleTargetsByRoot) {
      for (const sourceRoot of occluderRoots) {
        if (sourceRoot.root !== targetRoot.root) {
          hasPotentialOccluder = true
          break
        }
        if (eligibleTargets.some(target =>
          sourceRoot.meshes.some(candidate => candidate.opaque && candidate.mesh !== target.mesh),
        )) {
          hasPotentialOccluder = true
          break
        }
      }
      if (hasPotentialOccluder) break
    }
    if (!hasPotentialOccluder) return previousCulled.size > 0

    const pendingCulled = new Map<THREE.Mesh, boolean>()
    for (const [targetRoot, eligibleTargets] of eligibleTargetsByRoot) {
      for (const target of eligibleTargets) {
        // Nunca oculte o próprio volume que contém a câmera. Usar o AABB do
        // modelo inteiro era demasiado conservador em castelos/edifícios ocos:
        // a câmera ficava dentro do AABB global e desativava toda a oclusão.
        if (target.bounds.containsPoint(this.cameraPosition)) continue
        // Malhas fora do volume visível já são ignoradas pelo renderer; não
        // gaste raios de oclusão nelas durante esta avaliação.
        if (!this.frustum.intersectsBox(target.bounds)) continue
        const samples = this.samplesForGeometry(target.mesh.geometry)
        if (samples.length < 3) continue

        const margin = previousCulled.has(target.mesh)
          ? STAY_OCCLUSION_MARGIN
          : ENTER_OCCLUSION_MARGIN
        let fullyOccluded = true

        for (const sample of samples) {
          this.targetPoint.copy(sample).applyMatrix4(target.mesh.matrixWorld)
          if (!this.isPointOccluded(this.cameraPosition, this.targetPoint, target.mesh, targetRoot.root, occluderRoots, margin)) {
            fullyOccluded = false
            break
          }
        }

        if (fullyOccluded) pendingCulled.set(target.mesh, target.mesh.visible)
      }
    }

    // Aplique visibilidade somente depois de testar todos os alvos. Durante os
    // raycasts nenhuma malha que possa ser um bloqueador desaparece no meio do passe.
    for (const [mesh, visibleBeforeCull] of pendingCulled) {
      if (!mesh.visible) continue
      this.culledMeshes.set(mesh, visibleBeforeCull)
      mesh.visible = false
    }

    if (previousCulled.size !== this.culledMeshes.size) return true
    for (const mesh of previousCulled) {
      if (!this.culledMeshes.has(mesh)) return true
    }
    return false
  }

  /** Restaura visibilidade antes de cada nova avaliação para raycasts coerentes. */
  private restoreCulledMeshes(): void {
    for (const [mesh, visibleBeforeCull] of this.culledMeshes) {
      mesh.visible = visibleBeforeCull
    }
    this.culledMeshes.clear()
  }

  private prepareRoots(objects: readonly GameObject[]): PreparedRoot[] {
    const prepared: PreparedRoot[] = []

    for (const object of objects) {
      const root = object.mesh
      if (!root.visible) continue
      root.updateWorldMatrix(true, true)

      const importedModel = root.userData.importedModel === true
      // Animações/ossos deformam a pose da malha entre as avaliações; não usamos
      // esses modelos como alvo nem como bloqueador para evitar bounds incorretos.
      const animated = root.userData.importAnimationMixer !== undefined
        || root.userData.importAnimationActions !== undefined
      const bounds = new THREE.Box3()
      const meshes: PreparedMesh[] = []

      if (animated) {
        prepared.push({ root, bounds, meshes, importedModel, animated })
        continue
      }

      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return
        // A raiz importada é apenas uma caixa proxy invisível para seleção.
        if (importedModel && node === root) return
        if (this.isEditorOverlay(node) || node instanceof THREE.SkinnedMesh) return
        if (node.geometry.morphAttributes.position?.length) return
        if (!this.isEffectivelyVisible(node, root)) return

        const geometryBounds = node.geometry.boundingBox ?? (node.geometry.computeBoundingBox(), node.geometry.boundingBox)
        if (!geometryBounds || geometryBounds.isEmpty()) return

        const meshBounds = geometryBounds.clone().applyMatrix4(node.matrixWorld)
        if (meshBounds.isEmpty()) return
        const opaque = this.isOpaqueBlocker(node.material)
        meshes.push({ mesh: node, bounds: meshBounds, opaque })
        bounds.union(meshBounds)
      })

      prepared.push({ root, bounds, meshes, importedModel, animated })
    }

    return prepared
  }

  private isEffectivelyVisible(node: THREE.Object3D, root: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = node
    while (current) {
      if (!current.visible) return false
      if (current === root) return true
      current = current.parent
    }
    return false
  }

  private isEditorOverlay(node: THREE.Mesh): boolean {
    return node.userData.editorOverlay === true
      || node.name === 'collider-debug-wireframe'
      || node.name.startsWith('polygon-wireframe-')
      || node.name === 'polygon-wireframe'
  }

  private isOpaqueBlocker(material: THREE.Material | THREE.Material[]): boolean {
    const materials = Array.isArray(material) ? material : [material]
    return materials.length > 0 && materials.every((item) => {
      const candidate = item as THREE.Material & {
        opacity?: number
        depthWrite?: boolean
        colorWrite?: boolean
        wireframe?: boolean
        alphaMap?: THREE.Texture | null
        alphaTest?: number
        transmission?: number
      }
      return candidate.visible !== false
        && candidate.transparent !== true
        && (candidate.opacity ?? 1) >= 0.98
        && candidate.depthWrite !== false
        && candidate.depthTest !== false
        && candidate.colorWrite !== false
        && candidate.wireframe !== true
        && !candidate.alphaMap
        && (candidate.alphaTest ?? 0) <= 0
        && (candidate.transmission ?? 0) <= 0
    })
  }

  private isEligibleTarget(target: PreparedMesh, root: THREE.Object3D): boolean {
    if (!target.mesh.visible) return false
    if (this.isEditorOverlay(target.mesh) || target.mesh instanceof THREE.SkinnedMesh) return false

    // Nós controlados por estados de um pacote (ex.: montar/desmontar) mantêm
    // sua própria visibilidade. O culler não deve disputar essa decisão.
    let current: THREE.Object3D | null = target.mesh
    while (current) {
      if (typeof current.userData.mountModelStateBaseVisible === 'boolean') return false
      if (current === root) break
      current = current.parent
    }

    // Não ocultar um nó pai que também carregue descendentes controlados por
    // regras visuais, mesmo que o pai não seja o nó diretamente configurado.
    let hasManagedDescendant = false
    target.mesh.traverse((node) => {
      if (typeof node.userData.mountModelStateBaseVisible === 'boolean') hasManagedDescendant = true
    })
    return !hasManagedDescendant
  }

  /** Escolhe vértices reais próximos a pontos distribuídos no volume local. */
  private samplesForGeometry(geometry: THREE.BufferGeometry): THREE.Vector3[] {
    const cached = this.localSamples.get(geometry)
    if (cached) return cached

    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    const position = geometry.getAttribute('position')
    if (!bounds || bounds.isEmpty() || !position || position.count === 0) {
      this.localSamples.set(geometry, [])
      return []
    }

    const anchors = OCCLUSION_ANCHORS.map(([x, y, z]) => new THREE.Vector3(
      THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, x),
      THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, y),
      THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, z),
    ))
    const bestIndices = anchors.map(() => -1)
    const bestDistances = anchors.map(() => Number.POSITIVE_INFINITY)
    // Limita o trabalho de pré-processamento para geometrias muito densas.
    const stride = Math.max(1, Math.ceil(position.count / 4000))
    const vertex = new THREE.Vector3()

    for (let index = 0; index < position.count; index += stride) {
      vertex.fromBufferAttribute(position, index)
      for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
        const distance = vertex.distanceToSquared(anchors[anchorIndex]!)
        if (distance < bestDistances[anchorIndex]!) {
          bestDistances[anchorIndex] = distance
          bestIndices[anchorIndex] = index
        }
      }
    }

    const uniqueIndices = new Set(bestIndices.filter(index => index >= 0))
    const samples: THREE.Vector3[] = []
    for (const index of uniqueIndices) {
      const sample = new THREE.Vector3().fromBufferAttribute(position, index)
      if (samples.every(existing => existing.distanceToSquared(sample) > 1e-10)) {
        samples.push(sample)
      }
    }
    this.localSamples.set(geometry, samples)
    return samples
  }

  private isPointOccluded(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    targetMesh: THREE.Mesh,
    targetRoot: THREE.Object3D,
    roots: readonly PreparedRoot[],
    margin: number,
  ): boolean {
    this.rayDirection.copy(target).sub(origin)
    const distance = this.rayDirection.length()
    if (distance <= MIN_TARGET_DISTANCE) return false

    this.rayDirection.multiplyScalar(1 / distance)
    this.raycaster.set(origin, this.rayDirection)
    this.raycaster.near = 0.05
    // Self-occlusion can use a smaller margin because neighboring parts of one
    // model are commonly close together. External occluders keep the conservative
    // entry/stay margin used by the original system.
    this.raycaster.far = distance - Math.min(margin, SELF_OCCLUSION_MARGIN)

    const candidates: Array<{ mesh: THREE.Mesh; entryDistance: number; maxDistance: number }> = []
    // isPointOccluded só é chamado para alvos de modelos importados estáticos.
    // Permitir outros nós da mesma raiz habilita oclusão entre submalhas do GLB;
    // a própria malha-alvo continua excluída abaixo.
    const allowSelfOcclusion = targetRoot.userData.importedModel === true

    for (const source of roots) {
      const sameRoot = source.root === targetRoot
      if (source.animated || source.meshes.length === 0) continue
      // A oclusão entre nós da mesma raiz só vale para modelos importados estáticos;
      // cada malha-alvo permanece excluída para que ela nunca oculte a si própria.
      if (sameRoot && !allowSelfOcclusion) continue
      const maxDistance = distance - (sameRoot ? SELF_OCCLUSION_MARGIN : margin)
      if (maxDistance <= MIN_TARGET_DISTANCE) continue

      if (!sameRoot) {
        // Um objeto que contém a câmera não serve de bloqueador: isso evita que
        // a face traseira de uma parede esconda o mundo visto de dentro.
        if (source.bounds.containsPoint(origin)) continue
        const rootEntry = this.raycaster.ray.intersectBox(source.bounds, this.boundsHit)
        if (!rootEntry) continue
        const rootEntryDistance = rootEntry.distanceTo(origin)
        if (rootEntryDistance >= maxDistance) continue
      }

      for (const candidate of source.meshes) {
        if (candidate.mesh === targetMesh || !candidate.opaque) continue
        // O proxy raiz é transparente e não conta como bloqueador. Para oclusão
        // própria, use qualquer submalha opaca real (região gerada ou nó original).
        if (sameRoot && candidate.mesh === targetRoot) continue
        // Para autoculling, usar também o volume de cada malha (e não o AABB
        // global do castelo) impede que regiões atrás da câmera funcionem como
        // bloqueadores fantasmas.
        if (candidate.bounds.containsPoint(origin)) continue
        const meshEntry = this.raycaster.ray.intersectBox(candidate.bounds, this.boundsHit)
        if (!meshEntry) continue
        const entryDistance = meshEntry.distanceTo(origin)
        if (entryDistance < maxDistance) candidates.push({ mesh: candidate.mesh, entryDistance, maxDistance })
      }
    }

    if (candidates.length === 0) return false

    // Raycast nas caixas mais próximas primeiro. Depois de encontrar um bloqueio,
    // os candidatos cujos bounds começam atrás dele não precisam testar triângulos.
    candidates.sort((left, right) => left.entryDistance - right.entryDistance)
    let nearestHitDistance = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      if (candidate.entryDistance >= nearestHitDistance) break
      this.raycaster.far = candidate.maxDistance
      const hit = this.raycaster.intersectObject(candidate.mesh, false)[0]
      if (hit && hit.distance < candidate.maxDistance) nearestHitDistance = hit.distance
    }
    return Number.isFinite(nearestHitDistance)
  }

  dispose(): void {
    this.disposed = true
    this.restoreCulledMeshes()
    this.cachedPreparedRoots = null
    this.rootsDirty = true
    this.dirty = false
    this.hasLastCamera = false
    this.hasLastProjection = false
    // Se uma árvore estiver sendo calculada, deixe o job terminar antes de
    // encerrar o worker; isso evita uma Promise pendurada durante o teardown.
    void this.preparationQueue.finally(() => {
      this.bvhWorker?.dispose()
      this.bvhWorker = null
    })
  }
}
