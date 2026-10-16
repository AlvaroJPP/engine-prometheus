import * as THREE from 'three'
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

export type ModelLodPreset = 'quality' | 'balanced' | 'economy'

type GeometryVariants = {
  medium: THREE.BufferGeometry
  low: THREE.BufferGeometry
}

type MeshLodEntry = {
  mesh: THREE.Mesh
  original: THREE.BufferGeometry
  medium: THREE.BufferGeometry
  low: THREE.BufferGeometry
  originalSphere: THREE.Sphere
  originalTriangles: number
  level: 0 | 1 | 2
}

type RootLodState = {
  root: THREE.Object3D
  entries: MeshLodEntry[]
}

const MIN_TRIANGLES_FOR_LOD = 12_000
const MIN_SIMPLIFIER_VERTICES = 5_000

const PRESET_DISTANCES: Record<ModelLodPreset, { medium: number; low: number; radiusScale: number }> = {
  quality: { medium: 24, low: 48, radiusScale: 28 },
  balanced: { medium: 18, low: 36, radiusScale: 22 },
  economy: { medium: 12, low: 24, radiusScale: 16 },
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const indexCount = geometry.index?.count
  if (indexCount !== undefined) return Math.floor(indexCount / 3)
  return Math.floor((geometry.getAttribute('position')?.count ?? 0) / 3)
}

function hasMorphTargets(geometry: THREE.BufferGeometry): boolean {
  return Object.values(geometry.morphAttributes).some((attributes) => attributes.length > 0)
}

/**
 * Gera malhas simplificadas para modelos estáticos pesados e troca a geometria
 * conforme a distância da câmera. A hierarquia e os materiais GLTF originais
 * ficam intactos, e modelos rigados/morphados não são alterados.
 */
export class ModelLodSystem {
  private readonly modifier = new SimplifyModifier()
  private readonly roots = new Map<string, RootLodState>()
  private readonly temporaryCenter = new THREE.Vector3()
  private readonly temporaryScale = new THREE.Vector3()
  private readonly lastCameraPosition = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0)
  private preset: ModelLodPreset = 'quality'
  private dirty = true
  private disposed = false

  constructor(private readonly onChanged: () => void) {}

  setPreset(preset: ModelLodPreset): void {
    if (this.preset === preset) return
    this.preset = preset
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  /** Prepara LOD para meshes estáticas com pelo menos 12 mil triângulos. */
  async prepare(rootId: string, root: THREE.Object3D, animated: boolean): Promise<void> {
    if (this.disposed || animated || root.parent === null || this.roots.has(rootId)) return
    if (root.userData.wireframeVisible === true) return

    const candidates: Array<{ mesh: THREE.Mesh; geometry: THREE.BufferGeometry; triangles: number }> = []
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || node instanceof THREE.SkinnedMesh) return
      if (node.userData.editorOverlay === true || node.name === 'collider-debug-wireframe') return
      if (Array.isArray(node.material) || node.geometry.groups.length > 0) return
      if (node.geometry.drawRange.count !== Infinity) return
      if (node.geometry.getAttribute('skinIndex') || node.geometry.getAttribute('skinWeight')) return
      if (hasMorphTargets(node.geometry)) return

      const material = node.material
      if (material.transparent || material.opacity < 0.98 || material.alphaTest > 0.01) return

      const triangles = triangleCount(node.geometry)
      const positions = node.geometry.getAttribute('position')
      if (!positions || triangles < MIN_TRIANGLES_FOR_LOD || positions.count < MIN_SIMPLIFIER_VERTICES) return
      candidates.push({ mesh: node, geometry: node.geometry, triangles })
    })
    if (candidates.length === 0) return

    const variantsByGeometry = new Map<THREE.BufferGeometry, Promise<GeometryVariants | null>>()
    const entries: MeshLodEntry[] = []

    for (const candidate of candidates) {
      if (this.disposed || root.parent === null) break

      let variantsPromise = variantsByGeometry.get(candidate.geometry)
      if (!variantsPromise) {
        variantsPromise = this.createVariants(candidate.geometry)
        variantsByGeometry.set(candidate.geometry, variantsPromise)
      }

      try {
        const variants = await variantsPromise
        if (!variants || this.disposed || root.parent === null) continue
        if (candidate.geometry.boundingSphere === null) candidate.geometry.computeBoundingSphere()
        const originalSphere = candidate.geometry.boundingSphere?.clone() ?? new THREE.Sphere()
        entries.push({
          mesh: candidate.mesh,
          original: candidate.geometry,
          medium: variants.medium,
          low: variants.low,
          originalSphere,
          originalTriangles: candidate.triangles,
          level: 0,
        })
      } catch (error) {
        console.warn('[ModelLod] Não foi possível simplificar uma malha; mantendo o original.', error)
      }

      // Permite à interface continuar respondendo entre malhas grandes.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    }

    if (this.disposed || root.parent === null) {
      this.disposeEntryGeometries(entries)
      return
    }

    if (entries.length === 0) return
    this.roots.set(rootId, { root, entries })
    this.dirty = true
    this.onChanged()

    const originalTriangles = entries.reduce((total, entry) => total + entry.originalTriangles, 0)
    const lowTriangles = entries.reduce((total, entry) => total + triangleCount(entry.low), 0)
    console.info('[ModelLod] LOD preparado:', {
      model: root.name || rootId,
      meshes: entries.length,
      trianglesOriginal: originalTriangles,
      trianglesLow: lowTriangles,
    })
  }

  private async createVariants(original: THREE.BufferGeometry): Promise<GeometryVariants | null> {
    let working = original
    let isTemporary = false
    let medium: THREE.BufferGeometry | null = null
    let low: THREE.BufferGeometry | null = null

    try {
      // SimplifyModifier espera índices; soldamos vértices da geometria não indexada
      // antes de calcular a contagem a remover, para não colapsar tudo em um triângulo.
      if (!working.index) {
        working = mergeVertices(working)
        isTemporary = true
      }

      const positions = working.getAttribute('position')
      if (!working.index || !positions || positions.count < MIN_SIMPLIFIER_VERTICES) return null

      // Remover 50% e 80% dos vértices produz versões com aproximadamente
      // metade e um quinto dos triângulos, respectivamente.
      medium = await this.modifier.modify(working, Math.floor(positions.count * 0.50))
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      low = await this.modifier.modify(working, Math.floor(positions.count * 0.80))

      const originalBox = original.boundingBox ?? (original.computeBoundingBox(), original.boundingBox)
      const originalSphere = original.boundingSphere ?? (original.computeBoundingSphere(), original.boundingSphere)
      for (const simplified of [medium, low]) {
        simplified.computeBoundingBox()
        simplified.computeBoundingSphere()
        // Preservar limites originais evita popping no culling perto da borda da tela.
        if (originalBox) simplified.boundingBox = originalBox.clone()
        if (originalSphere) simplified.boundingSphere = originalSphere.clone()
      }

      const originalTriangles = triangleCount(original)
      if (
        triangleCount(medium) >= originalTriangles * 0.95
        || triangleCount(low) >= originalTriangles * 0.80
        || triangleCount(low) < 12
      ) {
        medium.dispose()
        low.dispose()
        return null
      }

      return { medium, low }
    } catch (error) {
      medium?.dispose()
      low?.dispose()
      throw error
    } finally {
      if (isTemporary) working.dispose()
    }
  }

  /** Atualiza apenas quando a câmera, o preset ou os transforms mudaram. */
  update(cameraPosition: THREE.Vector3): void {
    if (!this.dirty && this.lastCameraPosition.distanceToSquared(cameraPosition) < 0.04) return
    this.dirty = false
    this.lastCameraPosition.copy(cameraPosition)

    let changed = false
    const distances = PRESET_DISTANCES[this.preset]
    for (const { root, entries } of this.roots.values()) {
      if (!root.parent) continue
      const wireframeVisible = root.userData.wireframeVisible === true

      for (const entry of entries) {
        const desiredLevel = wireframeVisible ? 0 : this.levelForDistance(entry, cameraPosition, distances)
        if (desiredLevel === entry.level) continue
        entry.level = desiredLevel
        entry.mesh.geometry = desiredLevel === 0
          ? entry.original
          : desiredLevel === 1
            ? entry.medium
            : entry.low
        changed = true
      }
    }

    if (changed) this.onChanged()
  }

  private levelForDistance(
    entry: MeshLodEntry,
    cameraPosition: THREE.Vector3,
    distances: { medium: number; low: number; radiusScale: number },
  ): 0 | 1 | 2 {
    entry.mesh.updateWorldMatrix(true, false)
    this.temporaryCenter.copy(entry.originalSphere.center).applyMatrix4(entry.mesh.matrixWorld)
    entry.mesh.getWorldScale(this.temporaryScale)
    const worldRadius = Math.max(0.1, entry.originalSphere.radius * this.temporaryScale.maxComponent())
    const mediumDistance = Math.max(distances.medium, worldRadius * distances.radiusScale)
    const lowDistance = Math.max(distances.low, worldRadius * distances.radiusScale * 2)
    const distanceSquared = this.temporaryCenter.distanceToSquared(cameraPosition)

    // Histerese impede que os níveis alternem repetidamente junto ao limite.
    if (entry.level === 0) {
      return distanceSquared > (mediumDistance * 1.05) ** 2 ? 1 : 0
    }
    if (entry.level === 1) {
      if (distanceSquared > (lowDistance * 1.05) ** 2) return 2
      if (distanceSquared < (mediumDistance * 0.90) ** 2) return 0
      return 1
    }
    return distanceSquared < (lowDistance * 0.90) ** 2 ? 1 : 2
  }

  /** Restaura a geometria original antes de construir wireframe sobre o modelo. */
  forceOriginal(rootId: string): void {
    const state = this.roots.get(rootId)
    if (!state) return
    let changed = false
    for (const entry of state.entries) {
      if (entry.level === 0) continue
      entry.level = 0
      entry.mesh.geometry = entry.original
      changed = true
    }
    if (changed) {
      this.dirty = true
      this.onChanged()
    }
  }

  remove(rootId: string): void {
    const state = this.roots.get(rootId)
    if (!state) return
    this.roots.delete(rootId)
    this.disposeEntryGeometries(state.entries)
    this.dirty = true
  }

  clear(): void {
    for (const state of this.roots.values()) this.disposeEntryGeometries(state.entries)
    this.roots.clear()
    this.dirty = true
  }

  dispose(): void {
    this.disposed = true
    this.clear()
  }

  private disposeEntryGeometries(entries: readonly MeshLodEntry[]): void {
    const unique = new Set<THREE.BufferGeometry>()
    for (const entry of entries) {
      if (entry.medium !== entry.original) unique.add(entry.medium)
      if (entry.low !== entry.original) unique.add(entry.low)
      if (entry.mesh.geometry === entry.medium || entry.mesh.geometry === entry.low) {
        entry.mesh.geometry = entry.original
      }
    }
    for (const geometry of unique) geometry.dispose()
  }
}
