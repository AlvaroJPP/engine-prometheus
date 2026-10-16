import * as THREE from 'three'
import type { GameObject } from '../model/object/GameObject'

const MIN_RECHECK_INTERVAL_MS = 90
const CAMERA_MOVE_THRESHOLD_SQ = 0.05 * 0.05
const CAMERA_ROTATION_DOT_THRESHOLD = 0.00001
const ENTER_OCCLUSION_MARGIN = 0.65
const STAY_OCCLUSION_MARGIN = 0.12
const MIN_TARGET_DISTANCE = 0.2

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
 * sobre sua geometria são bloqueados por malhas opacas de outros objetos.
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
  private readonly raycaster = new THREE.Raycaster()
  private readonly cameraPosition = new THREE.Vector3()
  private readonly rayDirection = new THREE.Vector3()
  private readonly targetPoint = new THREE.Vector3()
  private readonly boundsHit = new THREE.Vector3()
  private readonly localSamples = new WeakMap<THREE.BufferGeometry, THREE.Vector3[]>()
  /** Meshas removidas visualmente pelo sistema e seu estado antes da oclusão. */
  private readonly culledMeshes = new Map<THREE.Mesh, boolean>()

  invalidate(): void {
    this.dirty = true
    this.rootsDirty = true
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
      && root.root.userData.wireframeVisible !== true
      && !root.bounds.isEmpty()
    )
    const occluderRoots = preparedRoots.filter(root =>
      !root.animated
      && !root.bounds.isEmpty()
      && root.meshes.some(mesh => mesh.opaque)
    )
    const opaqueMeshCount = occluderRoots.reduce(
      (total, sourceRoot) => total + sourceRoot.meshes.filter(candidate => candidate.opaque).length,
      0,
    )
    const hasEligibleTarget = modelRoots.some(targetRoot =>
      targetRoot.meshes.some(target => this.isEligibleTarget(target, targetRoot.root)),
    )
    // Basta haver ao menos duas malhas opacas e um alvo elegível: a busca
    // quadrática/cúbica anterior repetia uma varredura completa antes dos raios.
    if (opaqueMeshCount < 2 || !hasEligibleTarget) return previousCulled.size > 0

    const pendingCulled = new Map<THREE.Mesh, boolean>()
    for (const targetRoot of modelRoots) {
      // Não culle uma instância por submalha quando a câmera está dentro do volume
      // aproximado do próprio modelo; interiores devem continuar visíveis.
      if (targetRoot.bounds.containsPoint(this.cameraPosition)) continue

      for (const target of targetRoot.meshes) {
        if (!this.isEligibleTarget(target, targetRoot.root)) continue
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
    if (distance <= MIN_TARGET_DISTANCE + margin) return false

    const maxDistance = distance - margin
    this.rayDirection.multiplyScalar(1 / distance)
    this.raycaster.set(origin, this.rayDirection)
    this.raycaster.near = 0.05
    this.raycaster.far = maxDistance

    const candidates: Array<{ mesh: THREE.Mesh; entryDistance: number }> = []
    for (const source of roots) {
      if (source.root === targetRoot || source.animated || source.meshes.length === 0) continue
      // Não considerar como obstáculo a geometria que contém a câmera; em interiores
      // isso evita que a face traseira de uma parede esconda o mundo inteiro.
      if (source.bounds.containsPoint(origin)) continue
      const rootEntry = this.raycaster.ray.intersectBox(source.bounds, this.boundsHit)
      if (!rootEntry) continue
      const rootEntryDistance = rootEntry.distanceTo(origin)
      if (rootEntryDistance >= maxDistance) continue

      for (const candidate of source.meshes) {
        if (candidate.mesh === targetMesh || !candidate.opaque) continue
        const meshEntry = this.raycaster.ray.intersectBox(candidate.bounds, this.boundsHit)
        if (!meshEntry) continue
        const entryDistance = meshEntry.distanceTo(origin)
        if (entryDistance < maxDistance) candidates.push({ mesh: candidate.mesh, entryDistance })
      }
    }

    if (candidates.length === 0) return false

    // Raycast nas caixas mais próximas primeiro. Depois de encontrar um bloqueio,
    // os candidatos cujos bounds começam atrás dele não precisam testar triângulos.
    candidates.sort((left, right) => left.entryDistance - right.entryDistance)
    let nearestHitDistance = maxDistance
    for (const candidate of candidates) {
      if (candidate.entryDistance >= nearestHitDistance) break
      const hit = this.raycaster.intersectObject(candidate.mesh, false)[0]
      if (hit && hit.distance < nearestHitDistance) nearestHitDistance = hit.distance
    }
    return nearestHitDistance < maxDistance
  }

  dispose(): void {
    this.restoreCulledMeshes()
    this.cachedPreparedRoots = null
    this.rootsDirty = true
    this.dirty = false
    this.hasLastCamera = false
    this.hasLastProjection = false
  }
}
