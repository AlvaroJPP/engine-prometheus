import * as THREE from 'three'
import type { Heightfield } from '../worldGeneration/Heightfield'

const GRASS_COUNT = 7200
const PAINTED_CAPACITY = 16000
export type PaintedGrassTuft = [x: number, z: number, scale: number, color: number]
const WORLD_HALF = 50
const TERRAIN_SAMPLE = 0.5

/** Grama procedural instanciada: variedade visual sem criar milhares de objetos separados. */
export class GrassLayer {
  readonly mesh: THREE.InstancedMesh
  private readonly field: Heightfield
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly painted: PaintedGrassTuft[] = []
  private randomState = 0x12345678

  constructor(field: Heightfield) {
    this.field = field

    // Três planos de lâminas cruzados formam tufos visíveis de vários ângulos.
    const geometry = new THREE.BufferGeometry()
    const positions: number[] = []
    const indices: number[] = []
    for (let blade = 0; blade < 3; blade += 1) {
      const angle = (blade / 3) * Math.PI
      const dx = Math.cos(angle) * 0.5
      const dz = Math.sin(angle) * 0.5
      const base = positions.length / 3
      positions.push(
        -dx, 0, -dz,
        dx, 0, dz,
        dx * 0.12, 1, dz * 0.12,
      )
      indices.push(base, base + 1, base + 2)
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, GRASS_COUNT + PAINTED_CAPACITY)
    this.mesh.count = GRASS_COUNT
    this.mesh.name = 'ProceduralGrass'
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    // O terreno é limitado e a malha cobre toda a área; evita recalcular bounds a cada quadro.
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }

  /** Gera distribuição determinística, tufos variados e inclinação que acompanha o relevo. */
  refresh(): void {
    let state = (this.field.seed >>> 0) || 0x6d2b79f5
    const random = () => {
      state += 0x6d2b79f5
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }

    const palettes = [
      [0.16, 0.38, 0.07],
      [0.22, 0.46, 0.08],
      [0.27, 0.52, 0.11],
      [0.12, 0.31, 0.055],
      [0.34, 0.48, 0.12],
      [0.19, 0.42, 0.09],
    ] as const

    for (let i = 0; i < GRASS_COUNT; i += 1) {
      // Distribuição em manchas: áreas próximas tendem a ter densidade semelhante,
      // evitando o aspecto de pontos uniformemente espalhados.
      const clusterX = (random() * 2 - 1) * WORLD_HALF
      const clusterZ = (random() * 2 - 1) * WORLD_HALF
      const x = THREE.MathUtils.clamp(clusterX + (random() - 0.5) * 2.8, -WORLD_HALF, WORLD_HALF)
      const z = THREE.MathUtils.clamp(clusterZ + (random() - 0.5) * 2.8, -WORLD_HALF, WORLD_HALF)
      const height = this.field.sample(x, z)
      const slopeX = this.field.sample(x + TERRAIN_SAMPLE, z) - this.field.sample(x - TERRAIN_SAMPLE, z)
      const slopeZ = this.field.sample(x, z + TERRAIN_SAMPLE) - this.field.sample(x, z - TERRAIN_SAMPLE)
      const bladeHeight = 0.24 + random() * 0.48
      const width = 0.055 + random() * 0.055

      this.dummy.position.set(x, height + 0.012, z)
      this.dummy.rotation.set(
        THREE.MathUtils.clamp(-slopeZ * 0.18, -0.28, 0.28),
        random() * Math.PI * 2,
        THREE.MathUtils.clamp(slopeX * 0.18, -0.28, 0.28),
      )
      this.dummy.scale.set(width, bladeHeight, width)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)

      const palette = palettes[Math.floor(random() * palettes.length)] ?? palettes[0]
      const variation = 0.88 + random() * 0.24
      this.color.setRGB(palette[0] * variation, palette[1] * variation, palette[2] * variation)
      this.mesh.setColorAt(i, this.color)
    }

    this.rebuildPainted()
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.mesh.computeBoundingSphere()
  }

  /** Pinta tufos no pincel atual. Retorna quantos foram adicionados. */
  paint(x: number, z: number, radius: number, density = 1): number {
    const available = PAINTED_CAPACITY - this.painted.length
    if (available <= 0) return 0
    const area = Math.PI * radius * radius
    const amount = Math.min(available, Math.max(1, Math.round(area * 1.4 * Math.max(0.1, density))))
    let added = 0
    for (let i = 0; i < amount; i += 1) {
      const angle = this.random() * Math.PI * 2
      const distance = Math.sqrt(this.random()) * radius
      const px = THREE.MathUtils.clamp(x + Math.cos(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const pz = THREE.MathUtils.clamp(z + Math.sin(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const scale = 0.65 + this.random() * 0.9
      const palette = [0x386b1c, 0x477f22, 0x5c8e2b, 0x2f5c18, 0x70963a]
      const color = palette[Math.floor(this.random() * palette.length)] ?? 0x477f22
      this.painted.push([px, pz, scale, color])
      added += 1
    }
    this.rebuildPainted()
    return added
  }

  /** Remove tufos pintados dentro do raio sem afetar a grama procedural. */
  erase(x: number, z: number, radius: number): number {
    const radiusSquared = radius * radius
    const before = this.painted.length
    for (let i = this.painted.length - 1; i >= 0; i -= 1) {
      const tuft = this.painted[i]!
      if ((tuft[0] - x) ** 2 + (tuft[1] - z) ** 2 <= radiusSquared) this.painted.splice(i, 1)
    }
    const removed = before - this.painted.length
    if (removed) this.rebuildPainted()
    return removed
  }

  exportPainted(): PaintedGrassTuft[] {
    return this.painted.map((tuft) => [...tuft] as PaintedGrassTuft)
  }

  loadPainted(tufts: ReadonlyArray<PaintedGrassTuft> = []): void {
    this.painted.length = 0
    for (const tuft of tufts.slice(0, PAINTED_CAPACITY)) {
      if (tuft.length !== 4 || !tuft.every(Number.isFinite)) continue
      this.painted.push([
        THREE.MathUtils.clamp(tuft[0], -WORLD_HALF, WORLD_HALF),
        THREE.MathUtils.clamp(tuft[1], -WORLD_HALF, WORLD_HALF),
        THREE.MathUtils.clamp(tuft[2], 0.2, 2),
        Math.max(0, Math.min(0xffffff, Math.floor(tuft[3]))),
      ])
    }
    this.rebuildPainted()
  }

  private random(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0
    let value = this.randomState
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  private rebuildPainted(): void {
    this.mesh.count = GRASS_COUNT + this.painted.length
    for (let i = 0; i < this.painted.length; i += 1) {
      const [x, z, scale, color] = this.painted[i]!
      this.dummy.position.set(x, this.field.sample(x, z) + 0.012, z)
      this.dummy.rotation.set(0, this.random() * Math.PI * 2, 0)
      this.dummy.scale.set(0.08 * scale, (0.24 + this.random() * 0.48) * scale, 0.08 * scale)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(GRASS_COUNT + i, this.dummy.matrix)
      this.color.setHex(color)
      this.mesh.setColorAt(GRASS_COUNT + i, this.color)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.mesh.computeBoundingSphere()
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    const material = this.mesh.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  }
}
