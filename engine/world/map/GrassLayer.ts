import * as THREE from 'three'
import type { Heightfield } from '../worldGeneration/Heightfield'

const GRASS_COUNT = 7200
const PAINTED_CAPACITY = 16000
const WORLD_HALF = 50
const TERRAIN_SAMPLE = 0.5
const CHUNK_SIZE = 20
const CHUNKS_PER_AXIS = (WORLD_HALF * 2) / CHUNK_SIZE
const GRASS_LOD_DISTANCE = 32
const GRASS_VIEW_DISTANCE = 72
const LOD_STRIDE = 3

export type PaintedGrassTuft = [x: number, z: number, scale: number, color: number]

interface GrassInstance {
  x: number
  y: number
  z: number
  width: number
  height: number
  rotationX: number
  rotationY: number
  rotationZ: number
  color: number
}

interface GrassChunk {
  column: number
  row: number
  centerX: number
  centerZ: number
  procedural: GrassInstance[]
  painted: PaintedGrassTuft[]
  capacity: number
  nearMesh: THREE.InstancedMesh
  farMesh: THREE.InstancedMesh
}

/** Gera um tufo de folhas em malha compartilhada. A versão distante usa bem menos polígonos. */
function createGrassGeometry(lowDetail: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const levels = lowDetail ? [0, 0.62, 1] : [0, 0.28, 0.58, 0.82, 1]
  const widths = lowDetail ? [0.17, 0.08, 0.006] : [0.17, 0.135, 0.09, 0.045, 0.006]
  const bladeCount = lowDetail ? 3 : 5
  const baseColor = new THREE.Color(0x84b857)
  const tipColor = new THREE.Color(0xe5ef95)

  for (let blade = 0; blade < bladeCount; blade += 1) {
    const angle = (blade / bladeCount) * Math.PI * 2 + (blade % 2) * 0.18
    const dirX = Math.cos(angle)
    const dirZ = Math.sin(angle)
    const sideX = -dirZ
    const sideZ = dirX
    const length = 0.68 + (blade % 3) * 0.12
    const lean = 0.12 + (blade % 2) * 0.08
    const base = positions.length / 3

    for (let level = 0; level < levels.length; level += 1) {
      const t = levels[level]!
      const bend = lean * t * t
      const centerX = dirX * bend
      const centerZ = dirZ * bend
      const halfWidth = widths[level]! * (0.82 + (blade % 3) * 0.09)
      const y = t * length
      positions.push(
        centerX - sideX * halfWidth, y, centerZ - sideZ * halfWidth,
        centerX + sideX * halfWidth, y, centerZ + sideZ * halfWidth,
      )
      uvs.push(0, t, 1, t)

      const shade = baseColor.clone().lerp(tipColor, t * 0.78)
      colors.push(shade.r * 0.92, shade.g * 0.92, shade.b * 0.92)
      colors.push(shade.r * 1.04, shade.g * 1.04, shade.b * 1.04)

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
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Textura de folha local e leve; não depende de assets externos ou conexão. */
function createGrassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    const gradient = context.createLinearGradient(0, 0, 32, 0)
    gradient.addColorStop(0, 'rgba(255,255,255,0.72)')
    gradient.addColorStop(0.48, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0.68)')
    context.fillStyle = gradient
    context.beginPath()
    context.moveTo(16, 0)
    context.bezierCurveTo(5, 28, 1, 72, 16, 128)
    context.bezierCurveTo(31, 72, 27, 28, 16, 0)
    context.fill()
    context.strokeStyle = 'rgba(225,245,174,0.48)'
    context.lineWidth = 1.2
    context.beginPath()
    context.moveTo(16, 8)
    context.quadraticCurveTo(14, 60, 16, 120)
    context.stroke()
    context.strokeStyle = 'rgba(255,255,255,0.32)'
    context.lineWidth = 1
    for (let vein = 0; vein < 5; vein += 1) {
      const y = 24 + vein * 18
      context.beginPath()
      context.moveTo(15, y)
      context.lineTo(7 + (vein % 2) * 3, y + 9)
      context.moveTo(17, y + 3)
      context.lineTo(24 - (vein % 2) * 3, y + 10)
      context.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

/**
 * Grama procedural e pintada em setores. Cada setor tem culling próprio e
 * alterna entre tufo detalhado e LOD simplificado conforme a distância da câmera.
 * A ferramenta Pintar grama e os dados salvos em projetos anteriores continuam compatíveis.
 */
export class GrassLayer {
  readonly mesh = new THREE.Group()
  private readonly field: Heightfield
  private readonly geometry = createGrassGeometry(false)
  private readonly lowDetailGeometry = createGrassGeometry(true)
  private readonly texture = createGrassTexture()
  private readonly highMaterial: THREE.MeshStandardMaterial
  private readonly lowMaterial: THREE.MeshStandardMaterial
  private readonly chunks: GrassChunk[] = []
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly painted: PaintedGrassTuft[] = []
  private readonly windUniforms = {
    uGrassTime: { value: 0 },
    uGrassWindStrength: { value: 0.11 },
    uGrassPlayerPosition: { value: new THREE.Vector3(100000, 0, 100000) },
    uGrassInteractionRadius: { value: 1.8 },
  }
  private randomState = 0x12345678

  constructor(field: Heightfield) {
    this.field = field
    this.mesh.name = 'GrassLayer'

    this.highMaterial = this.createMaterial()
    this.lowMaterial = this.createMaterial()
    this.installWindShader(this.highMaterial)
    this.installWindShader(this.lowMaterial)

    for (let row = 0; row < CHUNKS_PER_AXIS; row += 1) {
      for (let column = 0; column < CHUNKS_PER_AXIS; column += 1) {
        const chunk = this.createChunk(column, row)
        this.chunks.push(chunk)
        this.mesh.add(chunk.nearMesh, chunk.farMesh)
      }
    }
    this.refresh()
  }

  private createMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.texture,
      vertexColors: true,
      alphaTest: 0.12,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    })
  }

  private installWindShader(material: THREE.MeshStandardMaterial): void {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.windUniforms)
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uGrassTime;',
          'uniform float uGrassWindStrength;',
          'uniform vec3 uGrassPlayerPosition;',
          'uniform float uGrassInteractionRadius;',
        ].join('\n'),
      )
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  float grassWorldX = instanceMatrix[3].x;',
          '  float grassWorldZ = instanceMatrix[3].z;',
          '#else',
          '  float grassWorldX = 0.0;',
          '  float grassWorldZ = 0.0;',
          '#endif',
          '  float grassTip = clamp(position.y / 0.92, 0.0, 1.0);',
          '  float grassBend = pow(grassTip, 1.7);',
          '  float grassWave = sin(uGrassTime * 1.15 + grassWorldX * 0.31 + grassWorldZ * 0.23)',
          '                  + 0.42 * sin(uGrassTime * 1.9 + grassWorldX * 0.13 - grassWorldZ * 0.37);',
          '  transformed.x += grassWave * uGrassWindStrength * grassBend;',
          '  transformed.z += sin(uGrassTime * 0.83 + grassWorldZ * 0.27 + grassWorldX * 0.19) * uGrassWindStrength * 0.45 * grassBend;',
          '  vec2 grassFromPlayer = vec2(grassWorldX - uGrassPlayerPosition.x, grassWorldZ - uGrassPlayerPosition.z);',
          '  float grassPlayerDistance = length(grassFromPlayer);',
          '  float grassPlayerInfluence = 1.0 - smoothstep(0.15, uGrassInteractionRadius, grassPlayerDistance);',
          '  vec2 grassPushWorld = normalize(grassFromPlayer + vec2(0.0001));',
          '#ifdef USE_INSTANCING',
          '  vec3 grassLocalAxisX = normalize(instanceMatrix[0].xyz);',
          '  vec3 grassLocalAxisZ = normalize(instanceMatrix[2].xyz);',
          '  vec3 grassPushDirection = vec3(grassPushWorld.x, 0.0, grassPushWorld.y);',
          '  float grassPushX = dot(grassPushDirection, grassLocalAxisX);',
          '  float grassPushZ = dot(grassPushDirection, grassLocalAxisZ);',
          '#else',
          '  float grassPushX = grassPushWorld.x;',
          '  float grassPushZ = grassPushWorld.y;',
          '#endif',
          '  transformed.x += grassPushX * grassPlayerInfluence * 0.62 * grassBend;',
          '  transformed.z += grassPushZ * grassPlayerInfluence * 0.62 * grassBend;',
          '  transformed.y -= grassPlayerInfluence * 0.16 * grassBend;',
        ].join('\n'),
      )
    }
    material.customProgramCacheKey = () => 'engine-prometheus-grass-wind-lod-v1'
  }

  private createChunk(column: number, row: number): GrassChunk {
    const capacity = 64
    const nearMesh = this.createInstancedMesh(this.geometry, this.highMaterial, capacity)
    const farMesh = this.createInstancedMesh(
      this.lowDetailGeometry,
      this.lowMaterial,
      Math.ceil(capacity / LOD_STRIDE),
    )
    return {
      column,
      row,
      centerX: -WORLD_HALF + (column + 0.5) * CHUNK_SIZE,
      centerZ: -WORLD_HALF + (row + 0.5) * CHUNK_SIZE,
      procedural: [],
      painted: [],
      capacity,
      nearMesh,
      farMesh,
    }
  }

  private createInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.count = 0
    mesh.name = 'GrassChunk'
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.onBeforeRender = () => {
      this.windUniforms.uGrassTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001
    }
    return mesh
  }

  private chunkFor(x: number, z: number): GrassChunk {
    const column = THREE.MathUtils.clamp(Math.floor((x + WORLD_HALF) / CHUNK_SIZE), 0, CHUNKS_PER_AXIS - 1)
    const row = THREE.MathUtils.clamp(Math.floor((z + WORLD_HALF) / CHUNK_SIZE), 0, CHUNKS_PER_AXIS - 1)
    return this.chunks[row * CHUNKS_PER_AXIS + column]!
  }

  private ensureCapacity(chunk: GrassChunk, required: number): void {
    if (required <= chunk.capacity) return
    let capacity = chunk.capacity
    while (capacity < required) capacity = Math.max(64, capacity * 2)

    chunk.nearMesh.removeFromParent()
    chunk.farMesh.removeFromParent()
    chunk.capacity = capacity
    chunk.nearMesh = this.createInstancedMesh(this.geometry, this.highMaterial, capacity)
    chunk.farMesh = this.createInstancedMesh(
      this.lowDetailGeometry,
      this.lowMaterial,
      Math.ceil(capacity / LOD_STRIDE),
    )
    this.mesh.add(chunk.nearMesh, chunk.farMesh)
  }

  private writeInstance(mesh: THREE.InstancedMesh, index: number, instance: GrassInstance): void {
    this.dummy.position.set(instance.x, instance.y, instance.z)
    this.dummy.rotation.set(instance.rotationX, instance.rotationY, instance.rotationZ)
    this.dummy.scale.set(instance.width, instance.height, instance.width)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(index, this.dummy.matrix)
    this.color.setHex(instance.color)
    mesh.setColorAt(index, this.color)
  }

  private paintedInstance(tuft: PaintedGrassTuft): GrassInstance {
    const [x, z, scale, color] = tuft
    // A pose de cada tufo pintado fica determinística para não mudar ao trocar de LOD.
    let state = (
      Math.imul(Math.round((x + WORLD_HALF) * 10000), 73856093) ^
      Math.imul(Math.round((z + WORLD_HALF) * 10000), 19349663) ^
      Math.floor(color)
    ) >>> 0
    if (state === 0) state = 0x6d2b79f5
    const random = (): number => {
      state = (state + 0x6d2b79f5) >>> 0
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
    return {
      x,
      y: this.field.sample(x, z) + 0.008,
      z,
      width: 0.82 * scale,
      height: (0.48 + random() * 0.68) * scale,
      rotationX: 0,
      rotationY: random() * Math.PI * 2,
      rotationZ: 0,
      color,
    }
  }

  private rebuildChunk(chunk: GrassChunk): void {
    const total = chunk.procedural.length + chunk.painted.length
    this.ensureCapacity(chunk, Math.max(1, total))
    let index = 0
    let lowIndex = 0

    const write = (instance: GrassInstance): void => {
      this.writeInstance(chunk.nearMesh, index, instance)
      if (index % LOD_STRIDE === 0) {
        this.writeInstance(chunk.farMesh, lowIndex, instance)
        lowIndex += 1
      }
      index += 1
    }

    for (const instance of chunk.procedural) write(instance)
    for (const tuft of chunk.painted) write(this.paintedInstance(tuft))

    chunk.nearMesh.count = total
    chunk.farMesh.count = lowIndex
    chunk.nearMesh.instanceMatrix.needsUpdate = true
    chunk.farMesh.instanceMatrix.needsUpdate = true
    if (chunk.nearMesh.instanceColor) chunk.nearMesh.instanceColor.needsUpdate = true
    if (chunk.farMesh.instanceColor) chunk.farMesh.instanceColor.needsUpdate = true
    chunk.nearMesh.computeBoundingSphere()
    chunk.farMesh.computeBoundingSphere()
    chunk.nearMesh.visible = false
    chunk.farMesh.visible = false
  }

  /** Regenera as manchas de grama procedural respeitando a nova altura do terreno. */
  refresh(): void {
    for (const chunk of this.chunks) chunk.procedural.length = 0

    let state = (this.field.seed >>> 0) || 0x6d2b79f5
    const random = (): number => {
      state += 0x6d2b79f5
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
    const palettes = [0x31591b, 0x3e7021, 0x4b7b27, 0x294c16, 0x608a30, 0x78983a]

    // As manchas quebram a regularidade de uma malha uniforme; os instantes continuam instanciados.
    const clusters = Array.from({ length: 420 }, () => ({
      x: (random() * 2 - 1) * WORLD_HALF,
      z: (random() * 2 - 1) * WORLD_HALF,
      spread: 1.5 + random() * 3.8,
    }))

    for (let i = 0; i < GRASS_COUNT; i += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)]!
      const offsetX = (random() + random() + random() - 1.5) * cluster.spread
      const offsetZ = (random() + random() + random() - 1.5) * cluster.spread
      const x = THREE.MathUtils.clamp(cluster.x + offsetX, -WORLD_HALF, WORLD_HALF)
      const z = THREE.MathUtils.clamp(cluster.z + offsetZ, -WORLD_HALF, WORLD_HALF)
      const height = this.field.sample(x, z)
      const slopeX = this.field.sample(x + TERRAIN_SAMPLE, z) - this.field.sample(x - TERRAIN_SAMPLE, z)
      const slopeZ = this.field.sample(x, z + TERRAIN_SAMPLE) - this.field.sample(x, z - TERRAIN_SAMPLE)
      const bladeHeight = 0.48 + random() * 0.68
      const width = 0.62 + random() * 0.56
      const palette = palettes[Math.floor(random() * palettes.length)]!
      const variation = 0.82 + random() * 0.32
      this.color.setHex(palette)
      this.color.multiplyScalar(variation)

      const instance: GrassInstance = {
        x,
        y: height + 0.008,
        z,
        width,
        height: bladeHeight,
        rotationX: THREE.MathUtils.clamp(-slopeZ * 0.13, -0.24, 0.24),
        rotationY: random() * Math.PI * 2,
        rotationZ: THREE.MathUtils.clamp(slopeX * 0.13, -0.24, 0.24),
        color: this.color.getHex(),
      }
      this.chunkFor(x, z).procedural.push(instance)
    }

    for (const chunk of this.chunks) this.rebuildChunk(chunk)
  }

  /** Pinta tufos no pincel atual. Retorna quantos foram adicionados. */
  paint(x: number, z: number, radius: number, density = 1): number {
    const available = PAINTED_CAPACITY - this.painted.length
    if (available <= 0) return 0
    const area = Math.PI * radius * radius
    const amount = Math.min(available, Math.max(1, Math.round(area * 0.22 * Math.max(0.1, density))))
    const palette = [0x31591b, 0x3e7021, 0x4b7b27, 0x294c16, 0x608a30, 0x78983a]
    const touched = new Set<GrassChunk>()

    for (let i = 0; i < amount; i += 1) {
      const angle = this.random() * Math.PI * 2
      const distance = Math.sqrt(this.random()) * radius
      const px = THREE.MathUtils.clamp(x + Math.cos(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const pz = THREE.MathUtils.clamp(z + Math.sin(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const scale = 0.7 + this.random() * 0.85
      const color = palette[Math.floor(this.random() * palette.length)] ?? 0x3e7021
      const tuft: PaintedGrassTuft = [px, pz, scale, color]
      this.painted.push(tuft)
      const chunk = this.chunkFor(px, pz)
      chunk.painted.push(tuft)
      touched.add(chunk)
    }

    for (const chunk of touched) this.rebuildChunk(chunk)
    return amount
  }

  /** Remove tufos pintados dentro do raio sem afetar a grama procedural. */
  erase(x: number, z: number, radius: number): number {
    const radiusSquared = radius * radius
    const removedTufts = new Set<PaintedGrassTuft>()
    for (const tuft of this.painted) {
      if ((tuft[0] - x) ** 2 + (tuft[1] - z) ** 2 <= radiusSquared) {
        removedTufts.add(tuft)
      }
    }
    if (removedTufts.size === 0) return 0

    const survivors = this.painted.filter(tuft => !removedTufts.has(tuft))
    this.painted.length = 0
    for (const tuft of survivors) this.painted.push(tuft)

    for (const chunk of this.chunks) {
      if (!chunk.painted.some(tuft => removedTufts.has(tuft))) continue
      chunk.painted = chunk.painted.filter(tuft => !removedTufts.has(tuft))
      this.rebuildChunk(chunk)
    }
    return removedTufts.size
  }

  exportPainted(): PaintedGrassTuft[] {
    return this.painted.map(tuft => [...tuft] as PaintedGrassTuft)
  }

  loadPainted(tufts: ReadonlyArray<PaintedGrassTuft> = []): void {
    this.painted.length = 0
    for (const chunk of this.chunks) chunk.painted.length = 0

    for (const tuft of tufts.slice(0, PAINTED_CAPACITY)) {
      if (tuft.length !== 4 || !tuft.every(Number.isFinite)) continue
      const sanitized: PaintedGrassTuft = [
        THREE.MathUtils.clamp(tuft[0], -WORLD_HALF, WORLD_HALF),
        THREE.MathUtils.clamp(tuft[1], -WORLD_HALF, WORLD_HALF),
        THREE.MathUtils.clamp(tuft[2], 0.2, 2),
        Math.max(0, Math.min(0xffffff, Math.floor(tuft[3]))),
      ]
      this.painted.push(sanitized)
      this.chunkFor(sanitized[0], sanitized[1]).painted.push(sanitized)
    }
    for (const chunk of this.chunks) this.rebuildChunk(chunk)
  }

  /** Atualiza culling por distância/LOD e a interação da grama com o jogador durante a execução. */
  updateVisibility(cameraPosition: THREE.Vector3, playerPosition: THREE.Vector3 | null = null): void {
    if (playerPosition) this.windUniforms.uGrassPlayerPosition.value.copy(playerPosition)
    else this.windUniforms.uGrassPlayerPosition.value.set(100000, 0, 100000)

    for (const chunk of this.chunks) {
      const centerDistance = Math.hypot(chunk.centerX - cameraPosition.x, chunk.centerZ - cameraPosition.z)
      const nearestDistance = Math.max(0, centerDistance - CHUNK_SIZE * Math.SQRT1_2)
      const inRange = nearestDistance <= GRASS_VIEW_DISTANCE
      chunk.nearMesh.visible = inRange && nearestDistance <= GRASS_LOD_DISTANCE && chunk.nearMesh.count > 0
      chunk.farMesh.visible = inRange && nearestDistance > GRASS_LOD_DISTANCE && chunk.farMesh.count > 0
    }
  }

  private random(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0
    let value = this.randomState
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      chunk.nearMesh.removeFromParent()
      chunk.farMesh.removeFromParent()
    }
    this.geometry.dispose()
    this.lowDetailGeometry.dispose()
    this.texture.dispose()
    this.highMaterial.dispose()
    this.lowMaterial.dispose()
    this.mesh.clear()
  }
}
