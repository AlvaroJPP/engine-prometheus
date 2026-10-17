import * as THREE from 'three'
import {
  Heightfield,
  TERRAIN_SEGMENTS,
  TERRAIN_SIZE,
  TERRAIN_VERTS,
  TERRAIN_VERTS_PER_SIDE,
} from '../worldGeneration/Heightfield'
import { colorForHeight } from '../worldGeneration/terrainColors'
import { GrassLayer } from './GrassLayer'
import type { PaintedGrassTuft } from './GrassLayer'

export const TERRAIN_ID = 'terrain'

export class TerrainMesh {
  readonly field: Heightfield
  readonly mesh: THREE.Mesh
  readonly grass: GrassLayer
  private geometry = new THREE.BufferGeometry()
  private positions = new Float32Array(TERRAIN_VERTS * 3)
  private colors = new Float32Array(TERRAIN_VERTS * 3)
  private posAttr: THREE.BufferAttribute
  private colAttr: THREE.BufferAttribute

  constructor(seed: number) {
    this.field = new Heightfield(seed)
    this.posAttr = new THREE.BufferAttribute(this.positions, 3)
    this.colAttr = new THREE.BufferAttribute(this.colors, 3)
    this.geometry.setAttribute('position', this.posAttr)
    this.geometry.setAttribute('color', this.colAttr)

    const n = TERRAIN_VERTS_PER_SIDE
    const index: number[] = []
    for (let iy = 0; iy < TERRAIN_SEGMENTS; iy += 1) {
      for (let ix = 0; ix < TERRAIN_SEGMENTS; ix += 1) {
        const a = iy * n + ix
        const b = a + 1
        const c = a + n
        const d = c + 1
        index.push(a, c, b, b, c, d)
      }
    }
    this.geometry.setIndex(index)

    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    )
    this.mesh.userData.id = TERRAIN_ID
    this.grass = new GrassLayer(this.field)
    this.refresh()
  }

  /** Recalcula a malha inteira apenas ao criar ou carregar um terreno. */
  refresh(): void {
    const n = TERRAIN_VERTS_PER_SIDE
    for (let iy = 0; iy < n; iy += 1) {
      const z = Heightfield.worldX(iy)
      for (let ix = 0; ix < n; ix += 1) {
        const i = iy * n + ix
        const x = Heightfield.worldX(ix)
        const h = this.field.height(ix, iy)
        this.positions[i * 3] = x
        this.positions[i * 3 + 1] = h
        this.positions[i * 3 + 2] = z
        const [r, g, b] = colorForHeight(h, x, z)
        this.colors[i * 3] = r
        this.colors[i * 3 + 1] = g
        this.colors[i * 3 + 2] = b
      }
    }
    this.posAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
    this.geometry.computeVertexNormals()
    this.setConservativeBounds()
    this.grass.refresh()
  }

  /**
   * Os limites do relevo são conhecidos porque as edições têm limites máximos.
   * Mantê-los estáveis evita recalcular caixa e esfera por completo a cada pincelada.
   */
  private setConservativeBounds(): void {
    const half = TERRAIN_SIZE / 2
    this.geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-half, -16, -half),
      new THREE.Vector3(half, 34, half),
    )
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 9, 0), 75)
  }

  /**
   * Atualiza só o retângulo alterado e as normais dos vértices adjacentes.
   * Evita varrer os 10 mil vértices e os 20 mil triângulos a cada frame de arrasto.
   */
  private refreshRegion(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const n = TERRAIN_VERTS_PER_SIDE
    for (let iz = bounds.minZ; iz <= bounds.maxZ; iz += 1) {
      const z = Heightfield.worldX(iz)
      for (let ix = bounds.minX; ix <= bounds.maxX; ix += 1) {
        const index = iz * n + ix
        const x = Heightfield.worldX(ix)
        const h = this.field.height(ix, iz)
        const positionOffset = index * 3
        this.positions[positionOffset + 1] = h
        const [r, g, b] = colorForHeight(h, x, z)
        this.colors[positionOffset] = r
        this.colors[positionOffset + 1] = g
        this.colors[positionOffset + 2] = b
      }
    }

    const normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute
    const normals = normalAttr.array as Float32Array
    const minX = Math.max(0, bounds.minX - 1)
    const maxX = Math.min(TERRAIN_SEGMENTS, bounds.maxX + 1)
    const minZ = Math.max(0, bounds.minZ - 1)
    const maxZ = Math.min(TERRAIN_SEGMENTS, bounds.maxZ + 1)

    for (let iz = minZ; iz <= maxZ; iz += 1) {
      for (let ix = minX; ix <= maxX; ix += 1) {
        const offset = (iz * n + ix) * 3
        normals[offset] = 0
        normals[offset + 1] = 0
        normals[offset + 2] = 0
      }
    }

    const addTriangle = (a: number, b: number, c: number): void => {
      const ao = a * 3
      const bo = b * 3
      const co = c * 3
      const abx = this.positions[bo] - this.positions[ao]
      const aby = this.positions[bo + 1] - this.positions[ao + 1]
      const abz = this.positions[bo + 2] - this.positions[ao + 2]
      const acx = this.positions[co] - this.positions[ao]
      const acy = this.positions[co + 1] - this.positions[ao + 1]
      const acz = this.positions[co + 2] - this.positions[ao + 2]
      const nx = aby * acz - abz * acy
      const ny = abz * acx - abx * acz
      const nz = abx * acy - aby * acx

      for (const vertex of [a, b, c]) {
        const vx = vertex % n
        const vz = Math.floor(vertex / n)
        if (vx < minX || vx > maxX || vz < minZ || vz > maxZ) continue
        const offset = vertex * 3
        normals[offset] += nx
        normals[offset + 1] += ny
        normals[offset + 2] += nz
      }
    }

    const cellMinX = Math.max(0, minX - 1)
    const cellMaxX = Math.min(TERRAIN_SEGMENTS - 1, maxX)
    const cellMinZ = Math.max(0, minZ - 1)
    const cellMaxZ = Math.min(TERRAIN_SEGMENTS - 1, maxZ)
    for (let iz = cellMinZ; iz <= cellMaxZ; iz += 1) {
      const row = iz * n
      for (let ix = cellMinX; ix <= cellMaxX; ix += 1) {
        const a = row + ix
        const b = a + 1
        const c = a + n
        const d = c + 1
        addTriangle(a, c, b)
        addTriangle(b, c, d)
      }
    }

    for (let iz = minZ; iz <= maxZ; iz += 1) {
      for (let ix = minX; ix <= maxX; ix += 1) {
        const offset = (iz * n + ix) * 3
        const nx = normals[offset]
        const ny = normals[offset + 1]
        const nz = normals[offset + 2]
        const length = Math.hypot(nx, ny, nz) || 1
        normals[offset] = nx / length
        normals[offset + 1] = ny / length
        normals[offset + 2] = nz / length
      }
    }

    this.posAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
    normalAttr.needsUpdate = true
  }

  load(seed: number, edits: ReadonlyArray<readonly [number, number]>, paintedGrass: ReadonlyArray<PaintedGrassTuft> = []): void {
    this.field.reset(seed, edits)
    this.refresh()
    this.grass.loadPainted(paintedGrass)
  }

  /** Abre projetos densos por lotes para que a UI continue atualizando o progresso. */
  async loadAsync(
    seed: number,
    edits: ReadonlyArray<readonly [number, number]>,
    paintedGrass: ReadonlyArray<PaintedGrassTuft> = [],
    onGrassProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    this.field.reset(seed, edits)
    this.refresh()
    await this.grass.loadPaintedAsync(paintedGrass, onGrassProgress)
  }

  brush(x: number, z: number, radius: number, amount: number): void {
    const bounds = this.field.brushWithBounds(x, z, radius, amount)
    if (bounds) this.refreshRegion(bounds)
  }

  /** Reposiciona a grama pintada uma vez ao terminar o traço do pincel. */
  finishBrush(): void {
    this.grass.refresh()
  }

  heightAt(x: number, z: number): number {
    return this.field.sample(x, z)
  }

  dispose(): void {
    this.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.grass.dispose()
  }
}
