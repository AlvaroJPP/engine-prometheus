import * as THREE from 'three'
import type { Heightfield } from '../worldGeneration/Heightfield'

const GRASS_COUNT = 7200
const WORLD_HALF = 50
const TERRAIN_SAMPLE = 0.5

/** Grama procedural instanciada: variedade visual sem criar milhares de objetos separados. */
export class GrassLayer {
  readonly mesh: THREE.InstancedMesh
  private readonly field: Heightfield
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()

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
    this.mesh = new THREE.InstancedMesh(geometry, material, GRASS_COUNT)
    this.mesh.name = 'ProceduralGrass'
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    // O terreno é limitado e a malha cobre toda a área; evita recalcular bounds a cada quadro.
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
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
