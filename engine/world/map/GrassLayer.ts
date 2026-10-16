import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
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
const PAINTED_GRASS_SPACING = 0.17
const PAINTED_GRASS_PER_AREA = 12
const PAINTED_GRASS_MODEL_HEIGHT = 0.55
const GRASS_MODEL_URL = new URL('../../../grass_pack_lowpoly_game-ready.glb', import.meta.url).href

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

interface GrassModelPart {
  variantIndex: number
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
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
  modelNearMeshes: THREE.InstancedMesh[]
  modelFarMeshes: THREE.InstancedMesh[]
  modelCapacity: number
}

/** Gera um tufo de folhas em malha compartilhada. A versão distante usa bem menos polígonos. */
function createGrassGeometry(lowDetail: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const levels = lowDetail ? [0, 0.62, 1] : [0, 0.24, 0.5, 0.76, 1]
  // Lâminas mais finas e afiladas. A silhueta vem da geometria, não de folhas grossas.
  const widths = lowDetail ? [0.105, 0.048, 0.0015] : [0.105, 0.082, 0.056, 0.028, 0.0015]
  const bladeCount = lowDetail ? 3 : 7
  const baseColor = new THREE.Color(0x76964a)
  const midColor = new THREE.Color(0x91ae57)
  const tipColor = new THREE.Color(0xb8c975)

  for (let blade = 0; blade < bladeCount; blade += 1) {
    // Ângulo áureo: evita que as folhas formem uma estrela perfeitamente regular.
    const angle = blade * 2.399963229728653 + (blade % 2) * 0.13
    const dirX = Math.cos(angle)
    const dirZ = Math.sin(angle)
    const sideX = -dirZ
    const sideZ = dirX
    const length = lowDetail ? 0.46 + (blade % 3) * 0.065 : 0.47 + (blade % 4) * 0.075
    const lean = 0.055 + (blade % 3) * 0.035
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

      const shade = baseColor.clone()
        .lerp(midColor, Math.min(1, t * 1.45))
        .lerp(tipColor, Math.max(0, (t - 0.62) * 1.65))
      const bladeTone = blade % 3 === 0 ? 0.82 : blade % 3 === 1 ? 0.94 : 1.04
      colors.push(shade.r * bladeTone * 0.94, shade.g * bladeTone * 0.94, shade.b * bladeTone * 0.94)
      colors.push(shade.r * bladeTone * 1.02, shade.g * bladeTone * 1.02, shade.b * bladeTone * 1.02)

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
    gradient.addColorStop(0, 'rgba(255,255,255,0.68)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0.68)')
    context.fillStyle = gradient
    // Recorte comprido e orgânico: base estreita, centro cheio e ponta fina.
    context.beginPath()
    context.moveTo(16, 1)
    context.quadraticCurveTo(8, 20, 10, 48)
    context.bezierCurveTo(11, 80, 13, 111, 16, 127)
    context.bezierCurveTo(22, 101, 25, 72, 22, 43)
    context.quadraticCurveTo(22, 19, 16, 1)
    context.fill()
    // Nervura discreta, sem os riscos brancos fortes do visual anterior.
    context.strokeStyle = 'rgba(222,239,186,0.2)'
    context.lineWidth = 0.65
    context.beginPath()
    context.moveTo(16, 12)
    context.quadraticCurveTo(14, 62, 16, 117)
    context.stroke()
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
  private readonly modelParts: GrassModelPart[] = []
  private readonly modelMaterials = new Set<THREE.Material>()
  private readonly modelTextures = new Set<THREE.Texture>()
  private readonly paintedBuckets = new Map<string, PaintedGrassTuft[]>()
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly white = new THREE.Color(0xffffff)
  private disposed = false
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
    this.loadGrassModel()
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

  private installWindShader(material: THREE.Material): void {
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


  /**
   * Carrega o pacote GLB como variantes instanciadas. A pintura continua usando
   * os mesmos dados [x, z, escala, cor], então projetos antigos seguem abrindo.
   */
  private loadGrassModel(): void {
    const loader = new GLTFLoader()
    loader.load(
      GRASS_MODEL_URL,
      (gltf) => {
        if (this.disposed) return
        try {
          const parts = this.buildGrassModelParts(gltf.scene)
          if (parts.length === 0) throw new Error('O GLB não contém malhas de grama utilizáveis.')
          this.modelParts.push(...parts)
          for (const chunk of this.chunks) this.rebuildChunk(chunk)
          const variants = new Set(parts.map((part) => part.variantIndex)).size
          console.info('[GrassLayer] Modelos de grama carregados:', {
            variants,
            meshParts: parts.length,
          })
        } catch (error) {
          console.warn('[GrassLayer] Não foi possível preparar o modelo GLB; usando o tufo procedural como alternativa.', error)
        }
      },
      undefined,
      (error) => {
        console.warn('[GrassLayer] Falha ao carregar o GLB de grama; usando o tufo procedural como alternativa.', error)
      },
    )
  }

  private subtreeHasMesh(root: THREE.Object3D): boolean {
    let found = false
    root.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry.getAttribute('position')) found = true
    })
    return found
  }

  /** Separa variantes exportadas no mesmo GLB, sem tratar cada folha como um tufo. */
  private grassModelCandidates(scene: THREE.Object3D): THREE.Object3D[] {
    const roots = scene.children.filter((child) => this.subtreeHasMesh(child))
    if (roots.length === 0) return this.subtreeHasMesh(scene) ? [scene] : []
    if (roots.length > 1) return roots

    const only = roots[0]!
    const nested = only.children.filter((child) => this.subtreeHasMesh(child))
    const containerName = /(root|scene|pack|collection|grass)/i.test(only.name)
    if (nested.length > 1 && containerName) return nested
    return [only]
  }

  private cloneGrassMaterial(source: THREE.Material): THREE.Material {
    const material = source.clone()
    material.side = THREE.DoubleSide
    this.installWindShader(material)
    this.modelMaterials.add(material)
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) this.modelTextures.add(value)
    }
    return material
  }

  private buildGrassModelParts(scene: THREE.Object3D): GrassModelPart[] {
    scene.updateMatrixWorld(true)
    const parts: GrassModelPart[] = []
    let variantIndex = 0

    for (const candidate of this.grassModelCandidates(scene)) {
      const bounds = new THREE.Box3().setFromObject(candidate)
      if (bounds.isEmpty()) continue
      const size = bounds.getSize(new THREE.Vector3())
      // Ignora planos de chão/preview que não são tufos de grama.
      if (!Number.isFinite(size.y) || size.y < 0.025) continue

      const factor = PAINTED_GRASS_MODEL_HEIGHT / size.y
      const centerX = (bounds.min.x + bounds.max.x) * 0.5
      const centerZ = (bounds.min.z + bounds.max.z) * 0.5
      const normalize = new THREE.Matrix4().makeScale(factor, factor, factor)
      normalize.setPosition(-centerX * factor, -bounds.min.y * factor, -centerZ * factor)
      let addedVariant = false

      candidate.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !node.geometry.getAttribute('position')) return
        const geometry = node.geometry.clone()
        // Congela a hierarquia GLB na geometria para que instâncias mantenham a pose correta.
        geometry.applyMatrix4(node.matrixWorld)
        geometry.applyMatrix4(normalize)
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()

        const material = Array.isArray(node.material)
          ? node.material.map((item) => this.cloneGrassMaterial(item))
          : this.cloneGrassMaterial(node.material)
        parts.push({ variantIndex, geometry, material })
        addedVariant = true
      })

      if (addedVariant) variantIndex += 1
    }

    return parts
  }

  private createModelInstancedMesh(
    part: GrassModelPart,
    capacity: number,
    lowDetail: boolean,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      Math.max(1, lowDetail ? Math.ceil(capacity / LOD_STRIDE) : capacity),
    )
    mesh.count = 0
    mesh.name = lowDetail ? 'PaintedGrassModelLOD' : 'PaintedGrassModel'
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.onBeforeRender = () => {
      this.windUniforms.uGrassTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001
    }
    return mesh
  }

  private clearPaintedModelMeshes(chunk: GrassChunk): void {
    for (const mesh of chunk.modelNearMeshes) mesh.removeFromParent()
    for (const mesh of chunk.modelFarMeshes) mesh.removeFromParent()
    chunk.modelNearMeshes.length = 0
    chunk.modelFarMeshes.length = 0
    chunk.modelCapacity = 0
  }

  private ensurePaintedModelCapacity(chunk: GrassChunk, required: number): void {
    if (this.modelParts.length === 0 || required <= 0) {
      this.clearPaintedModelMeshes(chunk)
      return
    }
    if (
      chunk.modelCapacity >= required &&
      chunk.modelNearMeshes.length === this.modelParts.length &&
      chunk.modelFarMeshes.length === this.modelParts.length
    ) return

    this.clearPaintedModelMeshes(chunk)
    let capacity = 32
    while (capacity < required) capacity *= 2
    chunk.modelCapacity = capacity
    for (const part of this.modelParts) {
      const near = this.createModelInstancedMesh(part, capacity, false)
      const far = this.createModelInstancedMesh(part, capacity, true)
      chunk.modelNearMeshes.push(near)
      chunk.modelFarMeshes.push(far)
      this.mesh.add(near, far)
    }
  }

  private paintedHash(tuft: PaintedGrassTuft): number {
    const [x, z, , color] = tuft
    return (
      Math.imul(Math.round((x + WORLD_HALF) * 10000), 73856093) ^
      Math.imul(Math.round((z + WORLD_HALF) * 10000), 19349663) ^
      Math.floor(color)
    ) >>> 0
  }

  private randomForPainted(tuft: PaintedGrassTuft): () => number {
    let state = this.paintedHash(tuft) || 0x6d2b79f5
    return (): number => {
      state = (state + 0x6d2b79f5) >>> 0
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
  }

  private paintedVariant(tuft: PaintedGrassTuft): number {
    let variantCount = 0
    for (const part of this.modelParts) variantCount = Math.max(variantCount, part.variantIndex + 1)
    return variantCount > 1 ? this.paintedHash(tuft) % variantCount : 0
  }

  private paintedModelInstance(tuft: PaintedGrassTuft): GrassInstance {
    const [x, z, scale, sourceColor] = tuft
    const random = this.randomForPainted(tuft)
    const slopeX = this.field.sample(x + TERRAIN_SAMPLE, z) - this.field.sample(x - TERRAIN_SAMPLE, z)
    const slopeZ = this.field.sample(x, z + TERRAIN_SAMPLE) - this.field.sample(x, z - TERRAIN_SAMPLE)
    // O modelo mantém as texturas originais; a cor salva só dá uma leve variação verde.
    this.color.setHex(sourceColor).lerp(this.white, 0.72)
    return {
      x,
      y: this.field.sample(x, z) + 0.004,
      z,
      width: scale,
      height: scale,
      rotationX: THREE.MathUtils.clamp(-slopeZ * 0.13, -0.24, 0.24),
      rotationY: random() * Math.PI * 2,
      rotationZ: THREE.MathUtils.clamp(slopeX * 0.13, -0.24, 0.24),
      color: this.color.getHex(),
    }
  }

  private rebuildPaintedModelMeshes(chunk: GrassChunk): void {
    if (this.modelParts.length === 0 || chunk.painted.length === 0) {
      this.clearPaintedModelMeshes(chunk)
      return
    }

    this.ensurePaintedModelCapacity(chunk, chunk.painted.length)
    const records = chunk.painted.map((tuft) => ({
      variant: this.paintedVariant(tuft),
      instance: this.paintedModelInstance(tuft),
    }))

    for (let partIndex = 0; partIndex < this.modelParts.length; partIndex += 1) {
      const part = this.modelParts[partIndex]!
      const near = chunk.modelNearMeshes[partIndex]!
      const far = chunk.modelFarMeshes[partIndex]!
      let nearIndex = 0
      let farIndex = 0

      for (let i = 0; i < records.length; i += 1) {
        const record = records[i]!
        if (record.variant !== part.variantIndex) continue
        this.writeInstance(near, nearIndex++, record.instance)
        if (i % LOD_STRIDE === 0) this.writeInstance(far, farIndex++, record.instance)
      }

      near.count = nearIndex
      far.count = farIndex
      near.instanceMatrix.needsUpdate = true
      far.instanceMatrix.needsUpdate = true
      if (near.instanceColor) near.instanceColor.needsUpdate = true
      if (far.instanceColor) far.instanceColor.needsUpdate = true
      near.computeBoundingSphere()
      far.computeBoundingSphere()
      near.visible = false
      far.visible = false
    }
  }

  private paintCellKey(x: number, z: number): string {
    return `${Math.floor(x / PAINTED_GRASS_SPACING)},${Math.floor(z / PAINTED_GRASS_SPACING)}`
  }

  private registerPaintedBucket(tuft: PaintedGrassTuft): void {
    const key = this.paintCellKey(tuft[0], tuft[1])
    const bucket = this.paintedBuckets.get(key)
    if (bucket) bucket.push(tuft)
    else this.paintedBuckets.set(key, [tuft])
  }

  private rebuildPaintedBuckets(): void {
    this.paintedBuckets.clear()
    for (const tuft of this.painted) this.registerPaintedBucket(tuft)
  }

  private canPaintAt(x: number, z: number): boolean {
    const cellX = Math.floor(x / PAINTED_GRASS_SPACING)
    const cellZ = Math.floor(z / PAINTED_GRASS_SPACING)
    const spacingSquared = PAINTED_GRASS_SPACING * PAINTED_GRASS_SPACING
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const bucket = this.paintedBuckets.get(`${cellX + dx},${cellZ + dz}`)
        if (!bucket) continue
        for (const tuft of bucket) {
          if ((tuft[0] - x) ** 2 + (tuft[1] - z) ** 2 < spacingSquared) return false
        }
      }
    }
    return true
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
      modelNearMeshes: [],
      modelFarMeshes: [],
      modelCapacity: 0,
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
      width: 0.55 * scale,
      height: (0.3 + random() * 0.17) * scale,
      rotationX: 0,
      rotationY: random() * Math.PI * 2,
      rotationZ: 0,
      color,
    }
  }

  private rebuildChunk(chunk: GrassChunk): void {
    // A malha gerada continua para a vegetação procedural e serve de fallback
    // caso o GLB esteja indisponível. Com o modelo carregado, a pintura usa meshes próprios.
    const useModelPaint = this.modelParts.length > 0
    const total = chunk.procedural.length + (useModelPaint ? 0 : chunk.painted.length)
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
    if (!useModelPaint) {
      for (const tuft of chunk.painted) write(this.paintedInstance(tuft))
    }

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
    this.rebuildPaintedModelMeshes(chunk)
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
    const palettes = [
      [0.16, 0.34, 0.065],
      [0.21, 0.42, 0.075],
      [0.29, 0.48, 0.105],
      [0.11, 0.27, 0.045],
      [0.35, 0.45, 0.12],
      [0.18, 0.38, 0.075],
      [0.26, 0.37, 0.08],
    ] as const

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
      // Altura final aproximada de 0.25–0.45 unidades; o tuft deixa de parecer um arbusto.
      const bladeHeight = 0.36 + random() * 0.28
      const width = 0.52 + random() * 0.28
      const palette = palettes[Math.floor(random() * palettes.length)] ?? palettes[0]
      const variation = 0.82 + random() * 0.32
      this.color.setRGB(palette[0] * variation, palette[1] * variation, palette[2] * variation)

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
    if (available <= 0 || !Number.isFinite(radius) || radius <= 0) return 0

    const area = Math.PI * radius * radius
    const safeDensity = Number.isFinite(density) ? Math.max(0.1, density) : 1
    const requested = Math.min(
      available,
      Math.max(1, Math.round(area * PAINTED_GRASS_PER_AREA * safeDensity)),
    )
    const palette = [0x8db66a, 0x9bc17a, 0x7fa55b, 0xa7c987, 0x72964e, 0xb1c98a]
    const touched = new Set<GrassChunk>()
    let added = 0
    // A grade espacial evita acumular milhares de cópias no mesmo ponto quando
    // o pincel fica parado; pontos novos preenchem os espaços vazios ao redor.
    const maxAttempts = Math.min(6000, requested * 6)

    for (let attempt = 0; attempt < maxAttempts && added < requested; attempt += 1) {
      if (this.painted.length >= PAINTED_CAPACITY) break
      const angle = this.random() * Math.PI * 2
      const distance = Math.sqrt(this.random()) * radius
      const px = THREE.MathUtils.clamp(x + Math.cos(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const pz = THREE.MathUtils.clamp(z + Math.sin(angle) * distance, -WORLD_HALF, WORLD_HALF)
      if (!this.canPaintAt(px, pz)) continue

      const scale = 0.78 + this.random() * 0.38
      const color = palette[Math.floor(this.random() * palette.length)] ?? 0x8db66a
      const tuft: PaintedGrassTuft = [px, pz, scale, color]
      this.painted.push(tuft)
      this.registerPaintedBucket(tuft)
      const chunk = this.chunkFor(px, pz)
      chunk.painted.push(tuft)
      touched.add(chunk)
      added += 1
    }

    for (const chunk of touched) this.rebuildChunk(chunk)
    return added
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
    this.rebuildPaintedBuckets()

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
    this.paintedBuckets.clear()
    for (const chunk of this.chunks) chunk.painted.length = 0

    for (const tuft of tufts.slice(0, PAINTED_CAPACITY)) {
      if (tuft.length !== 4 || !tuft.every(Number.isFinite)) continue
      const sanitized: PaintedGrassTuft = [
        THREE.MathUtils.clamp(tuft[0], -WORLD_HALF, WORLD_HALF),
        THREE.MathUtils.clamp(tuft[1], -WORLD_HALF, WORLD_HALF),
        THREE.MathUtils.clamp(tuft[2], 0.2, 1.5),
        Math.max(0, Math.min(0xffffff, Math.floor(tuft[3]))),
      ]
      this.painted.push(sanitized)
      this.registerPaintedBucket(sanitized)
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
      for (const mesh of chunk.modelNearMeshes) {
        mesh.visible = inRange && nearestDistance <= GRASS_LOD_DISTANCE && mesh.count > 0
      }
      for (const mesh of chunk.modelFarMeshes) {
        mesh.visible = inRange && nearestDistance > GRASS_LOD_DISTANCE && mesh.count > 0
      }
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
    this.disposed = true
    for (const chunk of this.chunks) {
      chunk.nearMesh.removeFromParent()
      chunk.farMesh.removeFromParent()
      this.clearPaintedModelMeshes(chunk)
    }
    for (const part of this.modelParts) part.geometry.dispose()
    for (const material of this.modelMaterials) material.dispose()
    for (const texture of this.modelTextures) texture.dispose()
    this.modelParts.length = 0
    this.modelMaterials.clear()
    this.modelTextures.clear()
    this.paintedBuckets.clear()
    this.geometry.dispose()
    this.lowDetailGeometry.dispose()
    this.texture.dispose()
    this.highMaterial.dispose()
    this.lowMaterial.dispose()
    this.mesh.clear()
  }
}
