import * as THREE from 'three'
import type { Heightfield } from '../worldGeneration/Heightfield'

const GRASS_COUNT = 7200
const PAINTED_CAPACITY = 16000
export type PaintedGrassTuft = [x: number, z: number, scale: number, color: number]
const WORLD_HALF = 50
const TERRAIN_SAMPLE = 0.5

/** Grama instanciada com lâminas curvas, pontas finas e variação natural de cor. */
export class GrassLayer {
  readonly mesh: THREE.InstancedMesh
  private readonly field: Heightfield
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly painted: PaintedGrassTuft[] = []
  private randomState = 0x12345678

  constructor(field: Heightfield) {
    this.field = field

    // Cada tufo possui cinco folhas curvas, segmentadas e afiladas em direção à ponta.
    // A malha continua compartilhada por todas as instâncias para preservar o desempenho.
    const geometry = new THREE.BufferGeometry()
    const positions: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const levels = [0, 0.28, 0.58, 0.82, 1]
    const widths = [0.17, 0.135, 0.09, 0.045, 0.006]
    const baseColor = new THREE.Color()
    const tipColor = new THREE.Color()

    for (let blade = 0; blade < 5; blade += 1) {
      const angle = (blade / 5) * Math.PI * 2 + (blade % 2) * 0.18
      const dirX = Math.cos(angle)
      const dirZ = Math.sin(angle)
      const sideX = -dirZ
      const sideZ = dirX
      const length = 0.68 + (blade % 3) * 0.12
      const lean = 0.12 + (blade % 2) * 0.08
      const base = positions.length / 3

      baseColor.setRGB(0.52, 0.72, 0.34)
      tipColor.setRGB(0.9, 0.94, 0.58)

      for (let level = 0; level < levels.length; level += 1) {
        const t = levels[level]!
        const y = t * length
        const bend = lean * t * t
        const centerX = dirX * bend
        const centerZ = dirZ * bend
        const halfWidth = widths[level]! * (0.82 + (blade % 3) * 0.09)
        positions.push(
          centerX - sideX * halfWidth, y, centerZ - sideZ * halfWidth,
          centerX + sideX * halfWidth, y, centerZ + sideZ * halfWidth,
        )
        uvs.push(0, t, 1, t)

        const shade = baseColor.clone().lerp(tipColor, t * 0.78)
        for (let side = 0; side < 2; side += 1) {
          const variation = side === 0 ? 0.92 : 1.04
          colors.push(shade.r * variation, shade.g * variation, shade.b * variation)
        }

        if (level > 0) {
          const current = base + level * 2
          const previous = current - 2
          indices.push(previous, previous + 1, current, previous + 1, current + 1, current)
        }
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    // Textura procedural leve: transparência irregular nas bordas e nervura central.
    // É gerada localmente, sem baixar arquivos ou depender de conexão.
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const bladeGradient = ctx.createLinearGradient(0, 0, 32, 0)
      bladeGradient.addColorStop(0, 'rgba(255,255,255,0.72)')
      bladeGradient.addColorStop(0.48, 'rgba(255,255,255,1)')
      bladeGradient.addColorStop(1, 'rgba(255,255,255,0.68)')
      ctx.fillStyle = bladeGradient
      ctx.beginPath()
      ctx.moveTo(16, 0)
      ctx.bezierCurveTo(5, 28, 1, 72, 16, 128)
      ctx.bezierCurveTo(31, 72, 27, 28, 16, 0)
      ctx.fill()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(16, 8)
      ctx.quadraticCurveTo(14, 60, 16, 120)
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = 'rgba(255,255,255,0.32)'
      ctx.lineWidth = 1
      for (let vein = 0; vein < 5; vein += 1) {
        const y = 24 + vein * 18
        ctx.beginPath()
        ctx.moveTo(15, y)
        ctx.lineTo(7 + (vein % 2) * 3, y + 9)
        ctx.moveTo(17, y + 3)
        ctx.lineTo(24 - (vein % 2) * 3, y + 10)
        ctx.stroke()
      }
    }
    const bladeTexture = new THREE.CanvasTexture(canvas)
    bladeTexture.colorSpace = THREE.SRGBColorSpace
    bladeTexture.wrapS = THREE.ClampToEdgeWrapping
    bladeTexture.wrapT = THREE.ClampToEdgeWrapping
    bladeTexture.minFilter = THREE.LinearMipmapLinearFilter
    bladeTexture.magFilter = THREE.LinearFilter

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: bladeTexture,
      vertexColors: true,
      alphaTest: 0.12,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, GRASS_COUNT + PAINTED_CAPACITY)
    this.mesh.count = GRASS_COUNT
    this.mesh.name = 'ProceduralGrass'
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    // Vento calculado na GPU: as raízes ficam presas ao chão e as pontas balançam.
    const windUniforms = {
      uGrassTime: { value: 0 },
      uGrassWindStrength: { value: 0.11 },
    }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, windUniforms)
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
uniform float uGrassTime;
uniform float uGrassWindStrength;`,
      )
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  float grassWorldX = instanceMatrix[3].x;
  float grassWorldZ = instanceMatrix[3].z;
#else
  float grassWorldX = 0.0;
  float grassWorldZ = 0.0;
#endif
  float grassTip = clamp(position.y / 0.92, 0.0, 1.0);
  float grassBend = pow(grassTip, 1.7);
  float grassWave = sin(uGrassTime * 1.15 + grassWorldX * 0.31 + grassWorldZ * 0.23)
                  + 0.42 * sin(uGrassTime * 1.9 + grassWorldX * 0.13 - grassWorldZ * 0.37);
  transformed.x += grassWave * uGrassWindStrength * grassBend;`,
      )
    }
    // Atualiza o tempo sem percorrer as milhares de instâncias no JavaScript.
    this.mesh.onBeforeRender = () => {
      windUniforms.uGrassTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001
    }
  }

  /** Distribui tufos em manchas, com altura, escala, tonalidade e inclinação variadas. */
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
      [0.16, 0.34, 0.065],
      [0.21, 0.42, 0.075],
      [0.29, 0.48, 0.105],
      [0.11, 0.27, 0.045],
      [0.35, 0.45, 0.12],
      [0.18, 0.38, 0.075],
      [0.26, 0.37, 0.08],
    ] as const

    for (let i = 0; i < GRASS_COUNT; i += 1) {
      // Manchas suaves em vez de uma distribuição perfeitamente uniforme.
      const clusterX = (random() * 2 - 1) * WORLD_HALF
      const clusterZ = (random() * 2 - 1) * WORLD_HALF
      const x = THREE.MathUtils.clamp(clusterX + (random() - 0.5) * 3.6, -WORLD_HALF, WORLD_HALF)
      const z = THREE.MathUtils.clamp(clusterZ + (random() - 0.5) * 3.6, -WORLD_HALF, WORLD_HALF)
      const height = this.field.sample(x, z)
      const slopeX = this.field.sample(x + TERRAIN_SAMPLE, z) - this.field.sample(x - TERRAIN_SAMPLE, z)
      const slopeZ = this.field.sample(x, z + TERRAIN_SAMPLE) - this.field.sample(x, z - TERRAIN_SAMPLE)
      const bladeHeight = 0.48 + random() * 0.68
      const width = 0.62 + random() * 0.56

      this.dummy.position.set(x, height + 0.008, z)
      this.dummy.rotation.set(
        THREE.MathUtils.clamp(-slopeZ * 0.13, -0.24, 0.24),
        random() * Math.PI * 2,
        THREE.MathUtils.clamp(slopeX * 0.13, -0.24, 0.24),
      )
      this.dummy.scale.set(width, bladeHeight, width)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)

      const palette = palettes[Math.floor(random() * palettes.length)] ?? palettes[0]
      const variation = 0.82 + random() * 0.32
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
    const amount = Math.min(available, Math.max(1, Math.round(area * 0.22 * Math.max(0.1, density))))
    const palette = [0x31591b, 0x3e7021, 0x4b7b27, 0x294c16, 0x608a30, 0x78983a]
    for (let i = 0; i < amount; i += 1) {
      const angle = this.random() * Math.PI * 2
      const distance = Math.sqrt(this.random()) * radius
      const px = THREE.MathUtils.clamp(x + Math.cos(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const pz = THREE.MathUtils.clamp(z + Math.sin(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const scale = 0.7 + this.random() * 0.85
      const color = palette[Math.floor(this.random() * palette.length)] ?? 0x3e7021
      this.painted.push([px, pz, scale, color])
    }
    this.rebuildPainted()
    return amount
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
      this.dummy.position.set(x, this.field.sample(x, z) + 0.008, z)
      this.dummy.rotation.set(0, this.random() * Math.PI * 2, 0)
      this.dummy.scale.set(0.82 * scale, (0.48 + this.random() * 0.68) * scale, 0.82 * scale)
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
    if (Array.isArray(material)) {
      material.forEach((item) => {
        item.map?.dispose()
        item.dispose()
      })
    } else {
      material.map?.dispose()
      material.dispose()
    }
  }
}
