import * as THREE from 'three'
import type { Heightfield } from '../worldGeneration/Heightfield'

const GRASS_COUNT = 4800
const WORLD_HALF = 50

/** Grama procedural leve: uma única malha instanciada para manter poucos draw calls. */
export class GrassLayer {
  readonly mesh: THREE.InstancedMesh
  private readonly field: Heightfield
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()

  constructor(field: Heightfield) {
    this.field = field

    // Duas lâminas triangulares cruzadas por instância dão volume sem usar modelos externos.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0, 0, 0.5, 0, 0, 0, 1, 0,
      0, 0, -0.5, 0, 0, 0.5, 0, 1, 0,
    ], 3))
    geometry.setIndex([0, 1, 2, 3, 4, 5])
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
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }

  /** Reposiciona a grama para acompanhar o relevo editado, com aleatoriedade determinística. */
  refresh(): void {
    let state = (this.field.seed >>> 0) || 0x6d2b79f5
    const random = () => {
      state += 0x6d2b79f5
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }

    for (let i = 0; i < GRASS_COUNT; i += 1) {
      const x = (random() * 2 - 1) * WORLD_HALF
      const z = (random() * 2 - 1) * WORLD_HALF
      const height = this.field.sample(x, z)
      const bladeHeight = 0.18 + random() * 0.34

      this.dummy.position.set(x, height + 0.012, z)
      this.dummy.rotation.set(0, random() * Math.PI, 0)
      this.dummy.scale.set(0.035 + random() * 0.045, bladeHeight, 0.035 + random() * 0.045)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)

      const shade = random()
      this.color.setRGB(
        0.12 + shade * 0.10,
        0.34 + shade * 0.30,
        0.055 + shade * 0.075,
      )
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
