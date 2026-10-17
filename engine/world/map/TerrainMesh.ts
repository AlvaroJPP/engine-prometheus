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
  private disposed = false
  // Raycast direto na grade de alturas: não depende do BVH assíncrono.
  private raycastRay = new THREE.Ray()
  private raycastInverseMatrix = new THREE.Matrix4()
  private raycastA = new THREE.Vector3()
  private raycastB = new THREE.Vector3()
  private raycastC = new THREE.Vector3()
  private raycastD = new THREE.Vector3()
  private raycastLocalHit = new THREE.Vector3()
  private raycastWorldHit = new THREE.Vector3()

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

  /**
   * Interseção rápida com o heightfield usando travessia de grade (DDA).
   * Testa somente as células atravessadas pelo raio, em vez de todos os 20 mil
   * triângulos durante a inicialização do BVH ou enquanto o terreno é esculpido.
   */
  intersectRay(raycaster: THREE.Raycaster): THREE.Intersection | undefined {
    if (this.disposed || !this.mesh.visible || !raycaster.layers.test(this.mesh.layers)) return undefined

    this.mesh.updateWorldMatrix(true, false)
    this.raycastInverseMatrix.copy(this.mesh.matrixWorld).invert()
    this.raycastRay.copy(raycaster.ray).applyMatrix4(this.raycastInverseMatrix)

    const origin = this.raycastRay.origin
    const direction = this.raycastRay.direction
    const half = TERRAIN_SIZE / 2
    let tEnter = Math.max(0, raycaster.near)
    let tExit = raycaster.far

    // Recorta o raio contra o volume conhecido do terreno.
    const clipAxis = (o: number, d: number, min: number, max: number): boolean => {
      if (Math.abs(d) < 1e-12) return o >= min && o <= max
      let t1 = (min - o) / d
      let t2 = (max - o) / d
      if (t1 > t2) [t1, t2] = [t2, t1]
      tEnter = Math.max(tEnter, t1)
      tExit = Math.min(tExit, t2)
      return tEnter <= tExit
    }

    if (
      !clipAxis(origin.x, direction.x, -half, half)
      || !clipAxis(origin.y, direction.y, -16, 34)
      || !clipAxis(origin.z, direction.z, -half, half)
    ) return undefined

    const stepSize = TERRAIN_SIZE / TERRAIN_SEGMENTS
    const startX = origin.x + direction.x * tEnter
    const startZ = origin.z + direction.z * tEnter
    const gridX = THREE.MathUtils.clamp((startX + half) / stepSize, 0, TERRAIN_SEGMENTS)
    const gridZ = THREE.MathUtils.clamp((startZ + half) / stepSize, 0, TERRAIN_SEGMENTS)
    let cellX = Math.min(TERRAIN_SEGMENTS - 1, Math.max(0, Math.floor(gridX)))
    let cellZ = Math.min(TERRAIN_SEGMENTS - 1, Math.max(0, Math.floor(gridZ)))

    // Se o raio começa exatamente numa linha e segue para trás, entre na célula correta.
    if (direction.x < 0 && Math.abs(gridX - Math.round(gridX)) < 1e-7) {
      cellX = Math.max(0, Math.round(gridX) - 1)
    }
    if (direction.z < 0 && Math.abs(gridZ - Math.round(gridZ)) < 1e-7) {
      cellZ = Math.max(0, Math.round(gridZ) - 1)
    }

    const stepX = direction.x > 1e-12 ? 1 : direction.x < -1e-12 ? -1 : 0
    const stepZ = direction.z > 1e-12 ? 1 : direction.z < -1e-12 ? -1 : 0
    const deltaTX = stepX === 0 ? Infinity : stepSize / Math.abs(direction.x)
    const deltaTZ = stepZ === 0 ? Infinity : stepSize / Math.abs(direction.z)
    const nextBoundaryX = (): number => Heightfield.worldX(stepX > 0 ? cellX + 1 : cellX)
    const nextBoundaryZ = (): number => Heightfield.worldX(stepZ > 0 ? cellZ + 1 : cellZ)
    let tMaxX = stepX === 0 ? Infinity : (nextBoundaryX() - origin.x) / direction.x
    let tMaxZ = stepZ === 0 ? Infinity : (nextBoundaryZ() - origin.z) / direction.z
    // Corrige pequenas diferenças numéricas quando a origem cai na própria borda.
    if (tMaxX < tEnter) tMaxX = tEnter
    if (tMaxZ < tEnter) tMaxZ = tEnter

    const makeHit = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, faceIndex: number, cellExit: number): THREE.Intersection | undefined => {
      const point = this.raycastRay.intersectTriangle(a, b, c, true, this.raycastLocalHit)
      if (!point) return undefined

      const hitT = (point.x - origin.x) * direction.x
        + (point.y - origin.y) * direction.y
        + (point.z - origin.z) * direction.z
      if (hitT < tEnter - 1e-6 || hitT > cellExit + 1e-6 || hitT > tExit + 1e-6) return undefined

      this.raycastWorldHit.copy(point).applyMatrix4(this.mesh.matrixWorld)
      const distance = raycaster.ray.origin.distanceTo(this.raycastWorldHit)
      if (distance < raycaster.near || distance > raycaster.far) return undefined
      return {
        distance,
        point: this.raycastWorldHit.clone(),
        object: this.mesh,
        face: null,
        faceIndex,
      }
    }

    const n = TERRAIN_VERTS_PER_SIDE
    while (
      cellX >= 0 && cellX < TERRAIN_SEGMENTS
      && cellZ >= 0 && cellZ < TERRAIN_SEGMENTS
      && tEnter <= tExit + 1e-7
    ) {
      const x0 = Heightfield.worldX(cellX)
      const x1 = Heightfield.worldX(cellX + 1)
      const z0 = Heightfield.worldX(cellZ)
      const z1 = Heightfield.worldX(cellZ + 1)
      this.raycastA.set(x0, this.field.height(cellX, cellZ), z0)
      this.raycastB.set(x1, this.field.height(cellX + 1, cellZ), z0)
      this.raycastC.set(x0, this.field.height(cellX, cellZ + 1), z1)
      this.raycastD.set(x1, this.field.height(cellX + 1, cellZ + 1), z1)

      const cellExit = Math.min(tMaxX, tMaxZ, tExit)
      const cellIndex = cellZ * TERRAIN_SEGMENTS + cellX
      const firstHit = makeHit(this.raycastA, this.raycastC, this.raycastB, cellIndex * 2, cellExit)
      if (firstHit) return firstHit
      const secondHit = makeHit(this.raycastB, this.raycastC, this.raycastD, cellIndex * 2 + 1, cellExit)
      if (secondHit) return secondHit

      if (!Number.isFinite(cellExit) || cellExit >= tExit) break
      if (tMaxX <= tMaxZ) {
        // Em empate, atravessa um eixo por vez para não pular células no canto.
        cellX += stepX
        tEnter = tMaxX
        tMaxX += deltaTX
      } else {
        cellZ += stepZ
        tEnter = tMaxZ
        tMaxZ += deltaTZ
      }
    }

    return undefined
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
    this.posAttr.clearUpdateRanges()
    this.colAttr.clearUpdateRanges()
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    this.colAttr.setUsage(THREE.DynamicDrawUsage)
    this.posAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
    this.geometry.computeVertexNormals()
    const normals = this.geometry.getAttribute('normal') as THREE.BufferAttribute
    normals.clearUpdateRanges()
    normals.setUsage(THREE.DynamicDrawUsage)
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

    const addVertexNormal = (vertex: number, nx: number, ny: number, nz: number): void => {
      const vx = vertex % n
      const vz = Math.floor(vertex / n)
      if (vx < minX || vx > maxX || vz < minZ || vz > maxZ) return
      const offset = vertex * 3
      normals[offset] += nx
      normals[offset + 1] += ny
      normals[offset + 2] += nz
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

      addVertexNormal(a, nx, ny, nz)
      addVertexNormal(b, nx, ny, nz)
      addVertexNormal(c, nx, ny, nz)
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

    const rowWidth = bounds.maxX - bounds.minX + 1
    const normalRowWidth = maxX - minX + 1
    for (let iz = bounds.minZ; iz <= bounds.maxZ; iz += 1) {
      this.posAttr.addUpdateRange((iz * n + bounds.minX) * 3, rowWidth * 3)
      this.colAttr.addUpdateRange((iz * n + bounds.minX) * 3, rowWidth * 3)
    }
    for (let iz = minZ; iz <= maxZ; iz += 1) {
      normalAttr.addUpdateRange((iz * n + minX) * 3, normalRowWidth * 3)
    }

    // O raycast do pincel usa diretamente o heightfield durante o traço.
    // A árvore espacial será atualizada uma única vez ao finalizar a pincelada.
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
    this.disposed = true
    this.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.grass.dispose()
  }
}
