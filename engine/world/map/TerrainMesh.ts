import * as THREE from 'three'
import {
  Heightfield,
  TERRAIN_SEGMENTS,
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

  /** Recalcula posições, cores e normais a partir do mapa de alturas. */
  refresh(): void {
    const n = TERRAIN_VERTS_PER_SIDE
    for (let iy = 0; iy < n; iy += 1) {
      for (let ix = 0; ix < n; ix += 1) {
        const i = iy * n + ix
        const h = this.field.height(ix, iy)
        this.positions[i * 3] = Heightfield.worldX(ix)
        this.positions[i * 3 + 1] = h
        this.positions[i * 3 + 2] = Heightfield.worldX(iy)
        const [r, g, b] = colorForHeight(h)
        this.colors[i * 3] = r
        this.colors[i * 3 + 1] = g
        this.colors[i * 3 + 2] = b
      }
    }
    this.posAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
    this.geometry.computeVertexNormals()
    this.geometry.computeBoundingSphere()
    this.geometry.computeBoundingBox()
    this.grass.refresh()
  }

  load(seed: number, edits: ReadonlyArray<readonly [number, number]>, paintedGrass: ReadonlyArray<PaintedGrassTuft> = []): void {
    this.field.reset(seed, edits)
    this.refresh()
    this.grass.loadPainted(paintedGrass)
  }

  brush(x: number, z: number, radius: number, amount: number): void {
    if (this.field.brush(x, z, radius, amount)) this.refresh()
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
