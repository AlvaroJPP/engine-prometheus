import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import grassModelUrl from '../../../grass_pack_lowpoly_game-ready.glb?url'
import type { Heightfield } from '../worldGeneration/Heightfield'

const GRASS_COUNT = 7200
const WORLD_HALF = 50
const TERRAIN_SAMPLE = 0.5
// Os chunks mantêm apenas os dados espaciais. A renderização usa malhas globais
// agrupadas por anéis concêntricos de distância da câmera.
const CHUNK_SIZE = 10
const CHUNKS_PER_AXIS = (WORLD_HALF * 2) / CHUNK_SIZE
const GRASS_NEAR_DISTANCE = 18
const GRASS_MIDDLE_DISTANCE = 42
const GRASS_VIEW_DISTANCE = 72
const GRASS_MIDDLE_STRIDE = 2
const GRASS_FAR_STRIDE = 4
const GRASS_RING_REBUILD_DISTANCE = 1.5
const GRASS_REBUILD_COALESCE_MS = 45
const PAINTED_GRASS_SPACING = 0.17
// Buckets maiores evitam criar um Map e um array para quase cada tufo em mapas densos.
const PAINTED_GRASS_BUCKET_SIZE = 1
const PAINTED_GRASS_PER_AREA = 12
const PAINTED_GRASS_MODEL_HEIGHT = 0.55
// A oclusão é conservadora: uma área só some quando todas as amostras
// estão bloqueadas pelo mesmo objeto. Áreas parcialmente cobertas são subdivididas.
const GRASS_OCCLUSION_ENTER_MARGIN = 1.25
const GRASS_OCCLUSION_STAY_MARGIN = 0.35
const GRASS_OCCLUSION_SUBDIVISIONS = 4
const GRASS_OCCLUSION_CELL_SIZE = CHUNK_SIZE / GRASS_OCCLUSION_SUBDIVISIONS
const GRASS_OCCLUSION_CELLS_PER_AXIS = Math.ceil((WORLD_HALF * 2) / GRASS_OCCLUSION_CELL_SIZE)
const GRASS_OCCLUSION_SAMPLE_OFFSETS = [0.15, 0.5, 0.85] as const
const GRASS_OCCLUSION_SAMPLE_HEIGHTS = [0.08, 0.62] as const
const GRASS_OCCLUSION_COARSE_SAMPLE_POINTS = [
  { x: 0.15, z: 0.15 },
  { x: 0.85, z: 0.15 },
  { x: 0.5, z: 0.5 },
  { x: 0.15, z: 0.85 },
  { x: 0.85, z: 0.85 },
] as const
const GRASS_OCCLUSION_FINE_SAMPLE_POINTS = GRASS_OCCLUSION_SAMPLE_OFFSETS.flatMap((x) =>
  GRASS_OCCLUSION_SAMPLE_OFFSETS.map((z) => ({ x, z })),
)
const GRASS_MODEL_URL = grassModelUrl

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
  procedural: GrassInstance[]
  painted: PaintedGrassTuft[]
}

interface GrassOcclusionMesh {
  mesh: THREE.Mesh
  bounds: THREE.Box3
}

interface GrassOcclusionRoot {
  root: THREE.Object3D
  bounds: THREE.Box3
  meshes: GrassOcclusionMesh[]
}

interface GrassOcclusionData {
  roots: GrassOcclusionRoot[]
  ownerByMesh: Map<THREE.Mesh, THREE.Object3D>
}

type GrassBandName = 'near' | 'middle' | 'far'

interface GrassRenderBand {
  name: GrassBandName
  maxDistance: number
  stride: number
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  mesh: THREE.InstancedMesh
  capacity: number
  modelMeshes: Array<THREE.InstancedMesh | undefined>
  modelCapacities: number[]
  /** Buffer de reserva reutilizável para o próximo rebuild (reduz churn de GPU). */
  spareMesh: THREE.InstancedMesh | null
  spareCapacity: number
  spareModelMeshes: Array<THREE.InstancedMesh | undefined>
  spareModelCapacities: number[]
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
 * A renderização é feita em três malhas globais por distância radial da câmera.
 * Os chunks servem somente para organizar os dados; não determinam culling ou LOD.
 * A ferramenta Pintar grama e os dados salvos continuam compatíveis.
 */
export class GrassLayer {
  readonly mesh = new THREE.Group()
  /** Notifica o mundo quando uma reconstrução assíncrona troca os buffers visíveis. */
  onRenderChanged: (() => void) | null = null
  private readonly field: Heightfield
  private readonly geometry = createGrassGeometry(false)
  private readonly lowDetailGeometry = createGrassGeometry(true)
  private readonly texture = createGrassTexture()
  private readonly modelFallbackTexture = this.createModelFallbackTexture()
  private readonly highMaterial: THREE.MeshStandardMaterial
  private readonly lowMaterial: THREE.MeshStandardMaterial
  private readonly chunks: GrassChunk[] = []
  private readonly renderBands: GrassRenderBand[]
  private readonly modelParts: GrassModelPart[] = []
  private readonly modelMaterials = new Set<THREE.Material>()
  private readonly modelTextures = new Set<THREE.Texture>()
  private readonly paintedBuckets = new Map<string, PaintedGrassTuft[]>()
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly white = new THREE.Color(0xffffff)
  private disposed = false
  private readonly painted: PaintedGrassTuft[] = []
  // Evita consultar o heightfield de cada tufo sempre que os anéis se movem.
  private paintedModelCache = new WeakMap<PaintedGrassTuft, GrassInstance>()
  private paintedFallbackCache = new WeakMap<PaintedGrassTuft, GrassInstance>()
  private lastRingCenter: THREE.Vector3 | null = null
  private renderDirty = true
  private loadingPainted = false
  private renderRebuildInProgress = false
  private pendingRingCenter: THREE.Vector3 | null = null
  private renderRebuildRevision = 0
  private lastOcclusionCameraPosition: THREE.Vector3 | null = null
  private lastOcclusionRebuildCameraPosition: THREE.Vector3 | null = null
  private lastOcclusionRoots: readonly THREE.Object3D[] = []
  private cachedOcclusionRoots: readonly THREE.Object3D[] | null = null
  private cachedOcclusionData: GrassOcclusionData | null = null
  private occlusionDataDirty = true
  private readonly occludedChunks = new Map<GrassChunk, THREE.Object3D>()
  /** Oclusão fina para zonas parcialmente cobertas de um chunk de 10x10. */
  private readonly occludedCells = new Map<number, THREE.Object3D>()
  private readonly occlusionRaycaster = new THREE.Raycaster()
  private readonly occlusionBoundsHit = new THREE.Vector3()
  private readonly occlusionDirection = new THREE.Vector3()
  private readonly occlusionTarget = new THREE.Vector3()
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

    this.renderBands = [
      this.createRenderBand('near', GRASS_NEAR_DISTANCE, 1, this.geometry, this.highMaterial),
      this.createRenderBand('middle', GRASS_MIDDLE_DISTANCE, GRASS_MIDDLE_STRIDE, this.lowDetailGeometry, this.lowMaterial),
      this.createRenderBand('far', GRASS_VIEW_DISTANCE, GRASS_FAR_STRIDE, this.lowDetailGeometry, this.lowMaterial),
    ]
    for (const band of this.renderBands) this.mesh.add(band.mesh)

    for (let row = 0; row < CHUNKS_PER_AXIS; row += 1) {
      for (let column = 0; column < CHUNKS_PER_AXIS; column += 1) {
        this.chunks.push(this.createChunk(column, row))
      }
    }
    this.refresh()
    this.loadGrassModel()
  }

  private createModelFallbackTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 128
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createLinearGradient(0, 128, 0, 0)
      gradient.addColorStop(0, '#456d27')
      gradient.addColorStop(0.42, '#6f963b')
      gradient.addColorStop(0.78, '#91b553')
      gradient.addColorStop(1, '#b6ca76')
      context.fillStyle = gradient
      context.fillRect(0, 0, canvas.width, canvas.height)

      // Fine blade veins create a subtle leaf texture when the GLB has no image map.
      for (let i = 0; i < 18; i += 1) {
        const x = 3 + (i * 17) % 58
        context.strokeStyle = i % 3 === 0 ? 'rgba(42,75,25,0.32)' : 'rgba(220,235,155,0.22)'
        context.lineWidth = i % 4 === 0 ? 1.25 : 0.65
        context.beginPath()
        context.moveTo(x, 128)
        context.quadraticCurveTo(x + (i % 2 === 0 ? 5 : -5), 64, x + (i % 3 - 1) * 2, 0)
        context.stroke()
      }
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    return texture
  }

  private ensureGrassUv(geometry: THREE.BufferGeometry): void {
    if (geometry.getAttribute('uv')) return
    const position = geometry.getAttribute('position')
    if (!position) return
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    if (!bounds) return
    const size = bounds.getSize(new THREE.Vector3())
    const horizontalByX = size.x >= size.z
    const horizontalMin = horizontalByX ? bounds.min.x : bounds.min.z
    const horizontalSize = Math.max(horizontalByX ? size.x : size.z, 0.0001)
    const verticalMin = bounds.min.y
    const verticalSize = Math.max(size.y, 0.0001)
    const uv = new Float32Array(position.count * 2)
    for (let i = 0; i < position.count; i += 1) {
      const horizontal = horizontalByX ? position.getX(i) : position.getZ(i)
      uv[i * 2] = (horizontal - horizontalMin) / horizontalSize
      uv[i * 2 + 1] = (position.getY(i) - verticalMin) / verticalSize
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  }

  private hasMeaningfulVertexColors(geometry: THREE.BufferGeometry): boolean {
    const attribute = geometry.getAttribute('color')
    if (!attribute || attribute.count === 0) return false
    const stride = Math.max(1, Math.floor(attribute.count / 96))
    let minLuma = Number.POSITIVE_INFINITY
    let maxLuma = Number.NEGATIVE_INFINITY
    let hasNaturalColor = false
    for (let i = 0; i < attribute.count; i += stride) {
      const r = attribute.getX(i)
      const g = attribute.getY(i)
      const b = attribute.getZ(i)
      const maximum = Math.max(r, g, b)
      const minimum = Math.min(r, g, b)
      const saturation = maximum <= 0.0001 ? 0 : (maximum - minimum) / maximum
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
      minLuma = Math.min(minLuma, luma)
      maxLuma = Math.max(maxLuma, luma)
      if (saturation > 0.15 && g >= r * 0.85 && g >= b * 0.72) hasNaturalColor = true
    }
    // Uniform white vertex colors are effectively "no color" for grass.
    return hasNaturalColor || (maxLuma < 0.82 && maxLuma - minLuma > 0.12)
  }

  private ensureGrassVertexColors(geometry: THREE.BufferGeometry): void {
    if (this.hasMeaningfulVertexColors(geometry)) return
    const position = geometry.getAttribute('position')
    if (!position) return
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    if (!bounds) return
    const height = Math.max(bounds.max.y - bounds.min.y, 0.0001)
    const base = new THREE.Color(0x446d25)
    const middle = new THREE.Color(0x78a342)
    const tip = new THREE.Color(0xb2c971)
    const colors = new Float32Array(position.count * 3)
    const shade = new THREE.Color()
    for (let i = 0; i < position.count; i += 1) {
      const t = THREE.MathUtils.clamp((position.getY(i) - bounds.min.y) / height, 0, 1)
      if (t < 0.72) shade.copy(base).lerp(middle, t / 0.72)
      else shade.copy(middle).lerp(tip, (t - 0.72) / 0.28)
      const subtleVariation = 0.94 + ((i * 17) % 11) * 0.012
      colors[i * 3] = shade.r * subtleVariation
      colors[i * 3 + 1] = shade.g * subtleVariation
      colors[i * 3 + 2] = shade.b * subtleVariation
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  private materialNeedsGrassFallback(
    material: THREE.Material,
    geometry: THREE.BufferGeometry,
  ): material is THREE.MeshStandardMaterial {
    if (!(material instanceof THREE.MeshStandardMaterial)) return false
    if (material.map || this.hasMeaningfulVertexColors(geometry)) return false
    const color = material.color
    const max = Math.max(color.r, color.g, color.b)
    const min = Math.min(color.r, color.g, color.b)
    const saturation = max <= 0 ? 0 : (max - min) / max
    // Only replace neutral/near-white untextured materials, not intentional colored materials.
    return saturation < 0.18
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
   * Usa o GLB original porque preserva a hierarquia, os materiais e a malha
   * Grass_main_fresh_Grass_Mat_0. O STL publicado é um export corrompido para
   * este uso e não deve ser usado como fonte da pintura.
   */
  private loadGrassModel(): void {
    const loader = new GLTFLoader()
    console.info('[GrassLayer] Carregando pacote GLB para pintura:', GRASS_MODEL_URL)
    loader.load(
      GRASS_MODEL_URL,
      (gltf) => {
        if (this.disposed) return
        try {
          const parts = this.buildGrassModelParts(gltf.scene)
          if (parts.length === 0) throw new Error('O GLB não contém a malha de grama esperada.')
          this.modelParts.push(...parts)
          this.requestRenderRebuild()
          console.info('[GrassLayer] Modelo GLB pronto para pintura:', {
            source: GRASS_MODEL_URL,
            targetMesh: 'Grass_main_fresh_Grass_Mat_0',
            meshParts: parts.length,
            variants: new Set(parts.map((part) => part.variantIndex)).size,
          })
        } catch (error) {
          console.error('[GrassLayer] O GLB foi carregado, mas não pôde ser convertido em tufos de grama.', error)
        }
      },
      undefined,
      (error) => {
        console.error('[GrassLayer] Não foi possível carregar o GLB da pintura de grama:', GRASS_MODEL_URL, error)
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

  private meshesUnder(root: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = []
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry.getAttribute('position')) meshes.push(node)
    })
    return meshes
  }

  private boundsForMeshes(meshes: THREE.Mesh[]): THREE.Box3 {
    const bounds = new THREE.Box3()
    for (const mesh of meshes) bounds.union(new THREE.Box3().setFromObject(mesh))
    return bounds
  }

  /**
   * O arquivo de pacote pode representar cada tufo como um grupo, ou cada folha
   * como um objeto separado. Detecta ambos os formatos e junta objetos próximos
   * espacialmente para que a ferramenta instancie tufos inteiros, não lâminas soltas.
   */
  private grassModelCandidates(scene: THREE.Object3D): THREE.Mesh[][] {
    // Prioriza a malha exata indicada na hierarquia original do modelo.
    // Usar a malha terminal evita instanciar a cena/coleção inteira como um único tufo.
    const namedGrassMeshes: THREE.Mesh[] = []
    scene.traverse((node) => {
      if (
        node instanceof THREE.Mesh &&
        node.name.trim().toLowerCase() === 'grass_main_fresh_grass_mat_0' &&
        node.geometry.getAttribute('position')
      ) namedGrassMeshes.push(node)
    })
    if (namedGrassMeshes.length > 0) {
      console.info('[GrassLayer] Malha original de grama selecionada:', {
        name: namedGrassMeshes[0]!.name,
        matches: namedGrassMeshes.length,
      })
      return namedGrassMeshes.map((mesh) => [mesh])
    }

    console.warn('[GrassLayer] Malha Grass_main_fresh_Grass_Mat_0 não encontrada; usando detecção genérica da hierarquia GLB.')
    const roots = scene.children.filter((child) => this.subtreeHasMesh(child))
    let units = roots.length > 0 ? roots : this.subtreeHasMesh(scene) ? [scene] : []
    if (units.length === 1) {
      const only = units[0]!
      const nested = only.children.filter((child) => this.subtreeHasMesh(child))
      const containerName = /(root|scene|pack|collection|grass|plant|foliage|sketchfab|asset|model)/i.test(only.name)
      // GLB exporters often wrap an entire pack under a single Scene/Root node.
      // Dive into that wrapper instead of turning the whole pack into one tiny tuft.
      if (nested.length > 1 && (containerName || nested.length >= 5)) units = nested
    }

    const unitMeshes = units.map((unit) => ({ unit, meshes: this.meshesUnder(unit) }))
      .filter((entry) => entry.meshes.length > 0)
    if (unitMeshes.length === 0) return []

    // Small packs can already have one node per complete tuft. For large flat
    // hierarchies, cluster nodes by X/Z position: nearby leaves form one tuft,
    // while separate demo models remain separate variants.
    if (unitMeshes.length < 4) return unitMeshes.map((entry) => entry.meshes)

    const entries = unitMeshes.map((entry) => {
      const bounds = this.boundsForMeshes(entry.meshes)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      return { ...entry, bounds, size, x: center.x, z: center.z }
    }).filter((entry) => entry.size.y > 0.025 && Number.isFinite(entry.size.y))
    if (entries.length < 4) return unitMeshes.map((entry) => entry.meshes)

    const heights = entries.map((entry) => entry.size.y).sort((a, b) => a - b)
    const medianHeight = heights[Math.floor(heights.length / 2)] ?? 1
    const linkDistance = THREE.MathUtils.clamp(medianHeight * 0.68, 0.08, 1.2)
    const cellKey = (x: number, z: number): string => `${Math.floor(x / linkDistance)},${Math.floor(z / linkDistance)}`
    const parent = entries.map((_, index) => index)
    const find = (index: number): number => {
      let current = index
      while (parent[current] !== current) {
        parent[current] = parent[parent[current]!]!
        current = parent[current]!
      }
      return current
    }
    const union = (a: number, b: number): void => {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parent[rootB] = rootA
    }
    const buckets = new Map<string, number[]>()
    const linkDistanceSquared = linkDistance * linkDistance

    entries.forEach((entry, index) => {
      const cellX = Math.floor(entry.x / linkDistance)
      const cellZ = Math.floor(entry.z / linkDistance)
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nearby = buckets.get(`${cellX + dx},${cellZ + dz}`)
          if (!nearby) continue
          for (const otherIndex of nearby) {
            const other = entries[otherIndex]!
            if ((other.x - entry.x) ** 2 + (other.z - entry.z) ** 2 <= linkDistanceSquared) {
              union(index, otherIndex)
            }
          }
        }
      }
      const key = cellKey(entry.x, entry.z)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(index)
      else buckets.set(key, [index])
    })

    const grouped = new Map<number, THREE.Mesh[]>()
    entries.forEach((entry, index) => {
      const root = find(index)
      const group = grouped.get(root)
      if (group) group.push(...entry.meshes)
      else grouped.set(root, [...entry.meshes])
    })
    const result = [...grouped.values()]
    console.info('[GrassLayer] Estrutura do pacote de grama detectada:', {
      sourceNodes: unitMeshes.length,
      tuftGroups: result.length,
      linkDistance,
      meshesPerTuft: result.map((group) => group.length),
    })
    return result
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

    for (const candidateMeshes of this.grassModelCandidates(scene)) {
      const bounds = this.boundsForMeshes(candidateMeshes)
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

      for (const node of candidateMeshes) {
        const geometry = node.geometry.clone()
        // Congela a hierarquia GLB na geometria para que instâncias mantenham a pose correta.
        geometry.applyMatrix4(node.matrixWorld)
        geometry.applyMatrix4(normalize)
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()

        const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material]
        const clonedMaterials = sourceMaterials.map((item) => this.cloneGrassMaterial(item))
        const hasFallbackMaterial = clonedMaterials.some((item) => this.materialNeedsGrassFallback(item, geometry))
        const meaningfulVertexColors = this.hasMeaningfulVertexColors(geometry)
        if (!meaningfulVertexColors) {
          // White/empty vertex-color channels should not wash out a textured material.
          for (const material of clonedMaterials) {
            if (material instanceof THREE.MeshStandardMaterial && material.map) material.vertexColors = false
          }
        }
        if (hasFallbackMaterial) {
          // Some low-poly packs ship neutral white materials without maps. Only those
          // get a generated leaf texture and vertical green variation; mapped assets
          // keep their original GLB materials and texture images untouched.
          this.ensureGrassUv(geometry)
          this.ensureGrassVertexColors(geometry)
          for (const material of clonedMaterials) {
            if (!this.materialNeedsGrassFallback(material, geometry)) continue
            material.map = this.modelFallbackTexture
            material.color.setHex(0xffffff)
            material.vertexColors = true
            this.modelTextures.add(this.modelFallbackTexture)
            material.needsUpdate = true
          }
        }
        const material = Array.isArray(node.material) ? clonedMaterials : clonedMaterials[0]!
        parts.push({ variantIndex, geometry, material })
        addedVariant = true
      }

      if (addedVariant) variantIndex += 1
    }

    return parts
  }

  private createRenderBand(
    name: GrassBandName,
    maxDistance: number,
    stride: number,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
  ): GrassRenderBand {
    const capacity = 64
    return {
      name,
      maxDistance,
      stride,
      geometry,
      material,
      mesh: this.createInstancedMesh(geometry, material, capacity, `GrassDistanceRing-${name}`),
      capacity,
      modelMeshes: [],
      modelCapacities: [],
      spareMesh: null,
      spareCapacity: 0,
      spareModelMeshes: [],
      spareModelCapacities: [],
    }
  }

  private createModelInstancedMesh(
    part: GrassModelPart,
    capacity: number,
    bandName: GrassBandName,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, capacity))
    mesh.count = 0
    mesh.name = `PaintedGrassModel-${bandName}`
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.onBeforeRender = () => {
      this.windUniforms.uGrassTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001
    }
    return mesh
  }

  private nextInstanceCapacity(required: number): number {
    let capacity = 64
    while (capacity < required) capacity *= 2
    return capacity
  }

  private acquireStagedBandMesh(
    band: GrassRenderBand,
    required: number,
  ): { mesh: THREE.InstancedMesh; capacity: number } {
    const pooled = band.spareMesh
    const pooledCapacity = band.spareCapacity
    band.spareMesh = null
    band.spareCapacity = 0

    if (pooled && pooledCapacity >= required) {
      pooled.count = 0
      pooled.visible = false
      return { mesh: pooled, capacity: pooledCapacity }
    }
    pooled?.dispose()

    const capacity = this.nextInstanceCapacity(required)
    const mesh = this.createInstancedMesh(
      band.geometry,
      band.material,
      capacity,
      `GrassDistanceRing-${band.name}`,
    )
    mesh.visible = false
    return { mesh, capacity }
  }

  private acquireStagedModelMesh(
    band: GrassRenderBand,
    partIndex: number,
    required: number,
  ): { mesh: THREE.InstancedMesh; capacity: number } {
    const pooled = band.spareModelMeshes[partIndex]
    const pooledCapacity = band.spareModelCapacities[partIndex] ?? 0
    band.spareModelMeshes[partIndex] = undefined
    band.spareModelCapacities[partIndex] = 0

    if (pooled && pooledCapacity >= required) {
      pooled.count = 0
      pooled.visible = false
      return { mesh: pooled, capacity: pooledCapacity }
    }
    pooled?.dispose()

    const part = this.modelParts[partIndex]
    if (!part) throw new Error(`A parte de grama ${partIndex} não está disponível.`)
    const capacity = this.nextInstanceCapacity(required)
    const mesh = this.createModelInstancedMesh(part, capacity, band.name)
    mesh.visible = false
    return { mesh, capacity }
  }

  private storeSpareBandMesh(
    band: GrassRenderBand,
    mesh: THREE.InstancedMesh,
    capacity: number,
  ): void {
    mesh.removeFromParent()
    mesh.visible = false
    mesh.count = 0
    if (band.spareMesh === mesh) {
      band.spareCapacity = Math.max(band.spareCapacity, capacity)
      return
    }
    if (!band.spareMesh || capacity > band.spareCapacity) {
      band.spareMesh?.dispose()
      band.spareMesh = mesh
      band.spareCapacity = capacity
    } else if (band.spareMesh !== mesh) {
      mesh.dispose()
    }
  }

  private storeSpareModelMesh(
    band: GrassRenderBand,
    partIndex: number,
    mesh: THREE.InstancedMesh,
    capacity: number,
  ): void {
    mesh.removeFromParent()
    mesh.visible = false
    mesh.count = 0
    const current = band.spareModelMeshes[partIndex]
    const currentCapacity = band.spareModelCapacities[partIndex] ?? 0
    if (current === mesh) {
      band.spareModelCapacities[partIndex] = Math.max(currentCapacity, capacity)
      return
    }
    if (!current || capacity > currentCapacity) {
      current?.dispose()
      band.spareModelMeshes[partIndex] = mesh
      band.spareModelCapacities[partIndex] = capacity
    } else if (current !== mesh) {
      mesh.dispose()
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
    const cached = this.paintedModelCache.get(tuft)
    if (cached) return cached

    const [x, z, scale] = tuft
    const random = this.randomForPainted(tuft)
    const slopeX = this.field.sample(x + TERRAIN_SAMPLE, z) - this.field.sample(x - TERRAIN_SAMPLE, z)
    const slopeZ = this.field.sample(x, z + TERRAIN_SAMPLE) - this.field.sample(x, z - TERRAIN_SAMPLE)
    // As cores salvas continuam disponíveis para projetos antigos, mas não se
    // aplicam ao modelo importado: materiais, mapas e tons do GLB são originais.
    const instance: GrassInstance = {
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
    this.paintedModelCache.set(tuft, instance)
    return instance
  }

  private paintCellKey(x: number, z: number): string {
    return `${Math.floor(x / PAINTED_GRASS_BUCKET_SIZE)},${Math.floor(z / PAINTED_GRASS_BUCKET_SIZE)}`
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
    const cellX = Math.floor(x / PAINTED_GRASS_BUCKET_SIZE)
    const cellZ = Math.floor(z / PAINTED_GRASS_BUCKET_SIZE)
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
    return { column, row, procedural: [], painted: [] }
  }

  private createInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
    capacity: number,
    name = 'GrassDistanceRing',
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity))
    mesh.count = 0
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
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

  private distanceBandIndex(x: number, z: number, center: THREE.Vector3): number {
    const distance = Math.hypot(x - center.x, z - center.z)
    for (let index = 0; index < this.renderBands.length; index += 1) {
      if (distance <= this.renderBands[index]!.maxDistance) return index
    }
    return -1
  }

  private spatialHash(x: number, z: number): number {
    return (
      Math.imul(Math.round((x + WORLD_HALF) * 10000), 73856093) ^
      Math.imul(Math.round((z + WORLD_HALF) * 10000), 19349663)
    ) >>> 0
  }

  /**
   * Reúne somente malhas opacas e estáticas como possíveis bloqueadores.
   * Materiais transparentes, alpha-tested, overlays e malhas esqueléticas são
   * excluídos para não esconder grama por causa de folhagem vazada ou animações.
   */
  private prepareOcclusionData(roots: readonly THREE.Object3D[]): GrassOcclusionData | null {
    if (roots.length === 0) return null
    const preparedRoots: GrassOcclusionRoot[] = []
    const ownerByMesh = new Map<THREE.Mesh, THREE.Object3D>()

    const isOpaqueMaterial = (material: THREE.Material): boolean => {
      const extended = material as THREE.Material & { alphaTest?: number; colorWrite?: boolean }
      return material.visible
        && !material.transparent
        && material.opacity >= 0.98
        && material.depthWrite
        && (extended.alphaTest ?? 0) <= 0
        && extended.colorWrite !== false
    }

    for (const root of roots) {
      if (!root.visible || root.userData.importAnimationMixer) continue
      root.updateWorldMatrix(true, true)
      const meshes: GrassOcclusionMesh[] = []
      const rootBounds = new THREE.Box3()

      const visit = (node: THREE.Object3D): void => {
        if (!node.visible) return
        if (
          node instanceof THREE.Mesh
          && !(node instanceof THREE.SkinnedMesh)
          && node.userData.editorOverlay !== true
          && node.geometry.getAttribute('position')
        ) {
          const materials = Array.isArray(node.material) ? node.material : [node.material]
          if (materials.length > 0 && materials.every(isOpaqueMaterial)) {
            if (!node.geometry.boundingBox) node.geometry.computeBoundingBox()
            const localBounds = node.geometry.boundingBox
            if (localBounds && !localBounds.isEmpty()) {
              const bounds = localBounds.clone().applyMatrix4(node.matrixWorld)
              if (!bounds.isEmpty()) {
                meshes.push({ mesh: node, bounds })
                rootBounds.union(bounds)
                ownerByMesh.set(node, root)
              }
            }
          }
        }
        for (const child of node.children) visit(child)
      }

      visit(root)
      if (meshes.length > 0 && !rootBounds.isEmpty()) {
        preparedRoots.push({ root, bounds: rootBounds, meshes })
      }
    }

    return preparedRoots.length > 0 ? { roots: preparedRoots, ownerByMesh } : null
  }

  private getOcclusionData(roots: readonly THREE.Object3D[]): GrassOcclusionData | null {
    if (!this.occlusionDataDirty && this.cachedOcclusionRoots === roots) {
      return this.cachedOcclusionData
    }
    this.cachedOcclusionData = this.prepareOcclusionData(roots)
    this.cachedOcclusionRoots = roots
    this.occlusionDataDirty = false
    return this.cachedOcclusionData
  }

  /** Retorna o objeto sólido mais próximo que bloqueia a linha até a ponta da grama. */
  private findOccluderForTarget(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    data: GrassOcclusionData,
    margin: number,
  ): THREE.Object3D | null {
    const direction = this.occlusionDirection.copy(target).sub(origin)
    const targetDistance = direction.length()
    const maxDistance = targetDistance - margin
    if (maxDistance <= 0.15) return null
    direction.multiplyScalar(1 / targetDistance)
    this.occlusionRaycaster.set(origin, direction)
    this.occlusionRaycaster.near = 0.05
    this.occlusionRaycaster.far = maxDistance

    const candidates: THREE.Mesh[] = []
    for (const source of data.roots) {
      // Não usar a caixa de um objeto que contém a própria câmera como bloqueador:
      // em interiores isso causaria o desaparecimento de toda a vegetação ao redor.
      if (source.bounds.containsPoint(origin)) continue
      const rootEntry = this.occlusionRaycaster.ray.intersectBox(source.bounds, this.occlusionBoundsHit)
      if (!rootEntry || rootEntry.distanceTo(origin) >= maxDistance) continue

      for (const candidate of source.meshes) {
        const meshEntry = this.occlusionRaycaster.ray.intersectBox(candidate.bounds, this.occlusionBoundsHit)
        if (meshEntry && meshEntry.distanceTo(origin) < maxDistance) candidates.push(candidate.mesh)
      }
    }
    if (candidates.length === 0) return null
    const nearestHit = this.occlusionRaycaster.intersectObjects(candidates, false)[0]
    if (!nearestHit) return null
    return data.ownerByMesh.get(nearestHit.object as THREE.Mesh) ?? null
  }

  private grassOcclusionCellKey(column: number, row: number): number {
    const safeColumn = THREE.MathUtils.clamp(column, 0, GRASS_OCCLUSION_CELLS_PER_AXIS - 1)
    const safeRow = THREE.MathUtils.clamp(row, 0, GRASS_OCCLUSION_CELLS_PER_AXIS - 1)
    return safeRow * GRASS_OCCLUSION_CELLS_PER_AXIS + safeColumn
  }

  private grassOcclusionCellKeyAt(x: number, z: number): number {
    const column = Math.floor((x + WORLD_HALF) / GRASS_OCCLUSION_CELL_SIZE)
    const row = Math.floor((z + WORLD_HALF) / GRASS_OCCLUSION_CELL_SIZE)
    return this.grassOcclusionCellKey(column, row)
  }

  private clearOcclusionCellsForChunk(chunk: GrassChunk): void {
    const baseColumn = chunk.column * GRASS_OCCLUSION_SUBDIVISIONS
    const baseRow = chunk.row * GRASS_OCCLUSION_SUBDIVISIONS
    for (let row = 0; row < GRASS_OCCLUSION_SUBDIVISIONS; row += 1) {
      for (let column = 0; column < GRASS_OCCLUSION_SUBDIVISIONS; column += 1) {
        this.occludedCells.delete(this.grassOcclusionCellKey(baseColumn + column, baseRow + row))
      }
    }
  }

  private isGrassCellOccluded(x: number, z: number): boolean {
    return this.occludedCells.has(this.grassOcclusionCellKeyAt(x, z))
  }

  private sampleOcclusionRegion(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    cameraPosition: THREE.Vector3,
    data: GrassOcclusionData,
    samplePoints: readonly { x: number; z: number }[],
    margin: number,
  ): { hits: number; fullyBlockedOwner: THREE.Object3D | null } {
    let hits = 0
    let firstOwner: THREE.Object3D | null = null
    let allHitsSameOwner = true
    const sampleCount = samplePoints.length * GRASS_OCCLUSION_SAMPLE_HEIGHTS.length

    for (const sample of samplePoints) {
      const x = minX + (maxX - minX) * sample.x
      const z = minZ + (maxZ - minZ) * sample.z
      const groundY = this.field.sample(x, z)

      for (const height of GRASS_OCCLUSION_SAMPLE_HEIGHTS) {
        this.occlusionTarget.set(x, groundY + height, z)
        const owner = this.findOccluderForTarget(cameraPosition, this.occlusionTarget, data, margin)
        if (!owner) {
          allHitsSameOwner = false
          continue
        }

        hits += 1
        if (!firstOwner) firstOwner = owner
        else if (owner !== firstOwner) allHitsSameOwner = false
      }
    }

    return {
      hits,
      fullyBlockedOwner: hits === sampleCount && allHitsSameOwner ? firstOwner : null,
    }
  }

  /**
   * Primeiro avalia o chunk completo com amostras distribuídas. Se ele estiver
   * totalmente atrás de um só bloqueador, confirma com uma grade mais densa.
   * Quando há cobertura parcial, subdivide em células de 2,5 x 2,5 para ocultar
   * só a parte realmente bloqueada, sem apagar a grama que contorna paredes.
   */
  private isChunkOccluded(
    chunk: GrassChunk,
    cameraPosition: THREE.Vector3,
    renderCenter: THREE.Vector3,
    data: GrassOcclusionData,
  ): boolean {
    const minX = -WORLD_HALF + chunk.column * CHUNK_SIZE
    const minZ = -WORLD_HALF + chunk.row * CHUNK_SIZE
    const maxX = minX + CHUNK_SIZE
    const maxZ = minZ + CHUNK_SIZE
    const cameraInsideChunk = cameraPosition.x >= minX - 1.5
      && cameraPosition.x <= maxX + 1.5
      && cameraPosition.z >= minZ - 1.5
      && cameraPosition.z <= maxZ + 1.5
    const centerInsideChunk = renderCenter.x >= minX
      && renderCenter.x <= maxX
      && renderCenter.z >= minZ
      && renderCenter.z <= maxZ

    if (cameraInsideChunk || centerInsideChunk) {
      this.occludedChunks.delete(chunk)
      this.clearOcclusionCellsForChunk(chunk)
      return false
    }

    const previousOwner = this.occludedChunks.get(chunk) ?? null
    const margin = previousOwner ? GRASS_OCCLUSION_STAY_MARGIN : GRASS_OCCLUSION_ENTER_MARGIN
    const coarse = this.sampleOcclusionRegion(
      minX,
      minZ,
      maxX,
      maxZ,
      cameraPosition,
      data,
      GRASS_OCCLUSION_COARSE_SAMPLE_POINTS,
      margin,
    )

    if (coarse.fullyBlockedOwner) {
      // A confirmação densa impede que uma parede estreita esconda um chunk
      // inteiro só porque alguns pontos espaçados por acaso ficaram bloqueados.
      const detailed = this.sampleOcclusionRegion(
        minX,
        minZ,
        maxX,
        maxZ,
        cameraPosition,
        data,
        GRASS_OCCLUSION_FINE_SAMPLE_POINTS,
        margin,
      )
      if (detailed.fullyBlockedOwner) {
        this.occludedChunks.set(chunk, detailed.fullyBlockedOwner)
        this.clearOcclusionCellsForChunk(chunk)
        return true
      }
    }

    this.occludedChunks.delete(chunk)
    if (coarse.hits === 0) {
      this.clearOcclusionCellsForChunk(chunk)
      return false
    }

    // Cobertura parcial: avalia cada célula independentemente. A margem menor
    // para células já ocultas reduz oscilações visuais junto às bordas.
    this.refineChunkOcclusion(chunk, minX, minZ, cameraPosition, data)
    return false
  }

  private refineChunkOcclusion(
    chunk: GrassChunk,
    chunkMinX: number,
    chunkMinZ: number,
    cameraPosition: THREE.Vector3,
    data: GrassOcclusionData,
  ): void {
    const baseColumn = chunk.column * GRASS_OCCLUSION_SUBDIVISIONS
    const baseRow = chunk.row * GRASS_OCCLUSION_SUBDIVISIONS

    for (let row = 0; row < GRASS_OCCLUSION_SUBDIVISIONS; row += 1) {
      for (let column = 0; column < GRASS_OCCLUSION_SUBDIVISIONS; column += 1) {
        const cellColumn = baseColumn + column
        const cellRow = baseRow + row
        const key = this.grassOcclusionCellKey(cellColumn, cellRow)
        const previousOwner = this.occludedCells.get(key) ?? null
        const margin = previousOwner ? GRASS_OCCLUSION_STAY_MARGIN : GRASS_OCCLUSION_ENTER_MARGIN
        const minX = chunkMinX + column * GRASS_OCCLUSION_CELL_SIZE
        const minZ = chunkMinZ + row * GRASS_OCCLUSION_CELL_SIZE
        const maxX = minX + GRASS_OCCLUSION_CELL_SIZE
        const maxZ = minZ + GRASS_OCCLUSION_CELL_SIZE
        const sample = this.sampleOcclusionRegion(
          minX,
          minZ,
          maxX,
          maxZ,
          cameraPosition,
          data,
          GRASS_OCCLUSION_FINE_SAMPLE_POINTS,
          margin,
        )

        if (sample.fullyBlockedOwner) this.occludedCells.set(key, sample.fullyBlockedOwner)
        else this.occludedCells.delete(key)
      }
    }
  }

  /** Invalida a seleção de chunks ocultos após mover/adicionar/remover objetos. */
  invalidateOcclusion(): void {
    this.occlusionDataDirty = true
    this.renderDirty = true
  }

  private shouldCancelRenderRebuild(revision: number): boolean {
    return this.disposed || this.loadingPainted || revision !== this.renderRebuildRevision
  }

  private async yieldToUi(): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }

  private queueDistanceRingRebuild(center: THREE.Vector3): void {
    if (this.disposed || this.loadingPainted) return
    this.renderDirty = false
    this.pendingRingCenter = center.clone()
    if (this.renderRebuildInProgress) return

    this.renderRebuildInProgress = true
    void this.processQueuedDistanceRingRebuilds()
  }

  private async processQueuedDistanceRingRebuilds(): Promise<void> {
    try {
      while (this.pendingRingCenter && !this.disposed && !this.loadingPainted) {
        // Aguarda um intervalo curto para condensar os movimentos rápidos em um único rebuild.
        await new Promise<void>((resolve) => window.setTimeout(resolve, GRASS_REBUILD_COALESCE_MS))
        if (this.disposed || this.loadingPainted) break
        const center = this.pendingRingCenter
        if (!center) continue
        this.pendingRingCenter = null
        await this.rebuildDistanceRings(center, this.renderRebuildRevision)
      }
    } catch (error) {
      this.renderDirty = true
      console.error('[GrassLayer] Não foi possível reconstruir os anéis de renderização da grama.', error)
    } finally {
      this.renderRebuildInProgress = false
      if (this.pendingRingCenter && !this.disposed && !this.loadingPainted) {
        this.renderRebuildInProgress = true
        void this.processQueuedDistanceRingRebuilds()
      }
    }
  }

  private async rebuildDistanceRings(center: THREE.Vector3, revision: number): Promise<void> {
    const cameraOrigin = this.lastOcclusionCameraPosition?.clone() ?? center.clone()
    const occlusionData = this.getOcclusionData(this.lastOcclusionRoots)
    if (!occlusionData) {
      this.occludedChunks.clear()
      this.occludedCells.clear()
    }
    const proceduralBuckets = this.renderBands.map(() => [] as GrassInstance[])
    const modelBuckets = this.renderBands.map(() =>
      this.modelParts.map(() => [] as GrassInstance[]),
    )
    let processed = 0
    let processedChunks = 0

    for (const chunk of this.chunks) {
      processedChunks += 1
      // Os testes de oclusão também cedem o controle à interface em lotes pequenos.
      if (occlusionData && processedChunks % 4 === 0) {
        await this.yieldToUi()
        if (this.shouldCancelRenderRebuild(revision)) return
      }
      if (occlusionData) {
        if (chunk.procedural.length === 0 && chunk.painted.length === 0) {
          this.occludedChunks.delete(chunk)
          this.clearOcclusionCellsForChunk(chunk)
          continue
        }
        if (this.isChunkOccluded(chunk, cameraOrigin, center, occlusionData)) {
          // Nenhum tufo desse chunk será incluído nas malhas GPU desta reconstrução.
          continue
        }
      }

      for (const instance of chunk.procedural) {
        processed += 1
        if (processed % 3200 === 0) {
          await this.yieldToUi()
          if (this.shouldCancelRenderRebuild(revision)) return
        }
        if (occlusionData && this.isGrassCellOccluded(instance.x, instance.z)) continue

        const bandIndex = this.distanceBandIndex(instance.x, instance.z, center)
        if (bandIndex >= 0) {
          const band = this.renderBands[bandIndex]!
          if (this.spatialHash(instance.x, instance.z) % band.stride === 0) {
            proceduralBuckets[bandIndex]!.push(instance)
          }
        }
      }

      for (const tuft of chunk.painted) {
        processed += 1
        if (processed % 3200 === 0) {
          await this.yieldToUi()
          if (this.shouldCancelRenderRebuild(revision)) return
        }
        if (occlusionData && this.isGrassCellOccluded(tuft[0], tuft[1])) continue

        const bandIndex = this.distanceBandIndex(tuft[0], tuft[1], center)
        if (bandIndex >= 0) {
          const band = this.renderBands[bandIndex]!
          if (this.paintedHash(tuft) % band.stride === 0) {
            if (this.modelParts.length > 0 && bandIndex < 2) {
              const variant = this.paintedVariant(tuft)
              const instance = this.paintedModelInstance(tuft)
              for (let partIndex = 0; partIndex < this.modelParts.length; partIndex += 1) {
                if (this.modelParts[partIndex]!.variantIndex === variant) {
                  modelBuckets[bandIndex]![partIndex]!.push(instance)
                }
              }
            } else {
              // O anel distante usa a malha procedural de baixo custo em vez do GLB completo.
              proceduralBuckets[bandIndex]!.push(this.paintedInstance(tuft))
            }
          }
        }
      }
    }

    if (this.shouldCancelRenderRebuild(revision)) return

    // Alterna dois conjuntos de buffers: o atual permanece visível enquanto o
    // conjunto de reserva é preenchido. Reutilizar os buffers reduz alocações na GPU.
    const stagedBands = this.renderBands.map((band, bandIndex) => {
      const procedural = proceduralBuckets[bandIndex]!
      const staged = this.acquireStagedBandMesh(band, procedural.length)
      const modelMeshes: Array<THREE.InstancedMesh | undefined> = []
      const modelCapacities: number[] = []
      if (bandIndex < 2) {
        for (let partIndex = 0; partIndex < this.modelParts.length; partIndex += 1) {
          const records = modelBuckets[bandIndex]![partIndex]!
          if (records.length === 0) {
            modelCapacities[partIndex] = 0
            continue
          }
          const model = this.acquireStagedModelMesh(band, partIndex, records.length)
          modelMeshes[partIndex] = model.mesh
          modelCapacities[partIndex] = model.capacity
        }
      }
      return { mesh: staged.mesh, capacity: staged.capacity, modelMeshes, modelCapacities }
    })

    const discardStagedBands = (): void => {
      for (let bandIndex = 0; bandIndex < stagedBands.length; bandIndex += 1) {
        const band = this.renderBands[bandIndex]!
        const staged = stagedBands[bandIndex]!
        this.storeSpareBandMesh(band, staged.mesh, staged.capacity)
        for (let partIndex = 0; partIndex < staged.modelMeshes.length; partIndex += 1) {
          const mesh = staged.modelMeshes[partIndex]
          if (mesh) this.storeSpareModelMesh(band, partIndex, mesh, staged.modelCapacities[partIndex] ?? 0)
        }
      }
    }

    let written = 0
    for (let bandIndex = 0; bandIndex < this.renderBands.length; bandIndex += 1) {
      const staged = stagedBands[bandIndex]!
      const procedural = proceduralBuckets[bandIndex]!
      for (let index = 0; index < procedural.length; index += 1) {
        this.writeInstance(staged.mesh, index, procedural[index]!)
        written += 1
        if (written % 6000 === 0) {
          await this.yieldToUi()
          if (this.shouldCancelRenderRebuild(revision)) {
            discardStagedBands()
            return
          }
        }
      }
      staged.mesh.count = procedural.length
      staged.mesh.instanceMatrix.needsUpdate = true
      if (staged.mesh.instanceColor) staged.mesh.instanceColor.needsUpdate = true
      staged.mesh.visible = procedural.length > 0

      // O pacote GLB é usado nos anéis próximos; longe dele, usamos geometria simples.
      if (bandIndex >= 2 || this.modelParts.length === 0) continue
      const byPart = modelBuckets[bandIndex]!
      for (let partIndex = 0; partIndex < this.modelParts.length; partIndex += 1) {
        const records = byPart[partIndex]!
        const mesh = staged.modelMeshes[partIndex]
        if (!mesh) continue
        for (let index = 0; index < records.length; index += 1) {
          this.writeModelInstance(mesh, index, records[index]!)
          written += 1
          if (written % 6000 === 0) {
            await this.yieldToUi()
            if (this.shouldCancelRenderRebuild(revision)) {
              discardStagedBands()
              return
            }
          }
        }
        mesh.count = records.length
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        mesh.visible = records.length > 0
      }
    }

    if (this.shouldCancelRenderRebuild(revision)) {
      discardStagedBands()
      return
    }

    // A substituição acontece sem ceder o controle ao renderer: ele nunca vê o vazio.
    // Os buffers antigos viram o conjunto de reserva para a próxima reconstrução.
    for (let bandIndex = 0; bandIndex < this.renderBands.length; bandIndex += 1) {
      const band = this.renderBands[bandIndex]!
      const staged = stagedBands[bandIndex]!

      this.storeSpareBandMesh(band, band.mesh, band.capacity)
      for (let partIndex = 0; partIndex < band.modelMeshes.length; partIndex += 1) {
        const oldModelMesh = band.modelMeshes[partIndex]
        if (oldModelMesh) {
          this.storeSpareModelMesh(band, partIndex, oldModelMesh, band.modelCapacities[partIndex] ?? 0)
        }
      }

      band.mesh = staged.mesh
      band.capacity = staged.capacity
      band.modelMeshes = staged.modelMeshes
      band.modelCapacities = staged.modelCapacities
      this.mesh.add(band.mesh)
      for (const modelMesh of band.modelMeshes) {
        if (modelMesh) this.mesh.add(modelMesh)
      }
    }
    this.renderDirty = false
    this.onRenderChanged?.()
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

  /** Não tinge os materiais do GLB: branco mantém as cores/texturas originais. */
  private writeModelInstance(mesh: THREE.InstancedMesh, index: number, instance: GrassInstance): void {
    this.dummy.position.set(instance.x, instance.y, instance.z)
    this.dummy.rotation.set(instance.rotationX, instance.rotationY, instance.rotationZ)
    this.dummy.scale.set(instance.width, instance.height, instance.width)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(index, this.dummy.matrix)
    mesh.setColorAt(index, this.white)
  }

  private paintedInstance(tuft: PaintedGrassTuft): GrassInstance {
    const cached = this.paintedFallbackCache.get(tuft)
    if (cached) return cached

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
    const instance: GrassInstance = {
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
    this.paintedFallbackCache.set(tuft, instance)
    return instance
  }

  private requestRenderRebuild(): void {
    this.renderDirty = true
    if (this.loadingPainted || !this.lastRingCenter || this.disposed) return
    // Se já houver uma reconstrução em andamento, ela manterá apenas o centro mais recente pendente.
    this.queueDistanceRingRebuild(this.lastRingCenter)
  }

  /** Regenera as manchas de grama procedural respeitando a nova altura do terreno. */
  refresh(): void {
    this.paintedModelCache = new WeakMap<PaintedGrassTuft, GrassInstance>()
    this.paintedFallbackCache = new WeakMap<PaintedGrassTuft, GrassInstance>()
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

    this.requestRenderRebuild()
  }

  /** Pinta tufos no pincel atual. Retorna quantos foram adicionados. */
  paint(x: number, z: number, radius: number, density = 1): number {
    if (!Number.isFinite(radius) || radius <= 0) return 0

    // Para pincéis maiores que o próprio mapa, limita-se apenas o raio efetivo
    // do cálculo (não a quantidade total de tufos permitida no mundo).
    const brushRadius = Math.min(radius, WORLD_HALF * 2)
    const area = Math.PI * brushRadius * brushRadius
    const safeDensity = Number.isFinite(density) ? Math.max(0.1, density) : 1
    // Sem limite global: cada chamada adiciona o que a área e o espaçamento permitirem.
    const requested = Math.max(1, Math.round(area * PAINTED_GRASS_PER_AREA * safeDensity))
    const palette = [0x8db66a, 0x9bc17a, 0x7fa55b, 0xa7c987, 0x72964e, 0xb1c98a]
    let added = 0
    const maxAttempts = requested * 8

    for (let attempt = 0; attempt < maxAttempts && added < requested; attempt += 1) {
      const angle = this.random() * Math.PI * 2
      const distance = Math.sqrt(this.random()) * brushRadius
      const px = THREE.MathUtils.clamp(x + Math.cos(angle) * distance, -WORLD_HALF, WORLD_HALF)
      const pz = THREE.MathUtils.clamp(z + Math.sin(angle) * distance, -WORLD_HALF, WORLD_HALF)
      if (!this.canPaintAt(px, pz)) continue

      const scale = 0.78 + this.random() * 0.38
      const color = palette[Math.floor(this.random() * palette.length)] ?? 0x8db66a
      const tuft: PaintedGrassTuft = [px, pz, scale, color]
      this.painted.push(tuft)
      this.registerPaintedBucket(tuft)
      this.chunkFor(px, pz).painted.push(tuft)
      added += 1
    }

    if (added > 0) this.requestRenderRebuild()
    return added
  }

  /** Remove tufos pintados dentro do raio sem afetar a grama procedural. */
  erase(x: number, z: number, radius: number): number {
    const radiusSquared = radius * radius
    const survivors = this.painted.filter((tuft) =>
      (tuft[0] - x) ** 2 + (tuft[1] - z) ** 2 > radiusSquared,
    )
    const removedCount = this.painted.length - survivors.length
    if (removedCount === 0) return 0

    this.painted.length = 0
    for (const tuft of survivors) this.painted.push(tuft)
    for (const chunk of this.chunks) chunk.painted.length = 0
    for (const tuft of this.painted) this.chunkFor(tuft[0], tuft[1]).painted.push(tuft)
    this.rebuildPaintedBuckets()
    this.requestRenderRebuild()
    return removedCount
  }

  exportPainted(): PaintedGrassTuft[] {
    return this.painted.map(tuft => [...tuft] as PaintedGrassTuft)
  }

  private beginPaintedLoad(): void {
    this.loadingPainted = true
    this.renderRebuildRevision += 1
    this.pendingRingCenter = null
    this.renderDirty = true
    this.painted.length = 0
    this.paintedBuckets.clear()
    this.paintedModelCache = new WeakMap<PaintedGrassTuft, GrassInstance>()
    this.paintedFallbackCache = new WeakMap<PaintedGrassTuft, GrassInstance>()
    for (const chunk of this.chunks) chunk.painted.length = 0
    for (const band of this.renderBands) {
      band.mesh.visible = false
      band.mesh.count = 0
      for (const mesh of band.modelMeshes) {
        if (!mesh) continue
        mesh.visible = false
        mesh.count = 0
      }
    }
  }

  private normalizePaintedTuft(tuft: PaintedGrassTuft): PaintedGrassTuft | null {
    if (tuft.length !== 4 || !tuft.every(Number.isFinite)) return null
    const x = THREE.MathUtils.clamp(tuft[0], -WORLD_HALF, WORLD_HALF)
    const z = THREE.MathUtils.clamp(tuft[1], -WORLD_HALF, WORLD_HALF)
    const scale = THREE.MathUtils.clamp(tuft[2], 0.2, 1.5)
    const color = Math.max(0, Math.min(0xffffff, Math.floor(tuft[3])))
    if (x === tuft[0] && z === tuft[1] && scale === tuft[2] && color === tuft[3]) return tuft
    return [x, z, scale, color]
  }

  private appendPaintedTuft(tuft: PaintedGrassTuft): void {
    this.painted.push(tuft)
    this.registerPaintedBucket(tuft)
    this.chunkFor(tuft[0], tuft[1]).painted.push(tuft)
  }

  loadPainted(tufts: ReadonlyArray<PaintedGrassTuft> = []): void {
    this.beginPaintedLoad()
    try {
      for (const source of tufts) {
        const tuft = this.normalizePaintedTuft(source)
        if (tuft) this.appendPaintedTuft(tuft)
      }
    } finally {
      this.loadingPainted = false
      this.requestRenderRebuild()
    }
  }

  /** Carrega projetos grandes por lotes para manter a interface responsiva. */
  async loadPaintedAsync(
    tufts: ReadonlyArray<PaintedGrassTuft> = [],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    this.beginPaintedLoad()
    const batchSize = 1600
    try {
      for (let offset = 0; offset < tufts.length; offset += batchSize) {
        const end = Math.min(offset + batchSize, tufts.length)
        for (let index = offset; index < end; index += 1) {
          const source = tufts[index]!
          const tuft = this.normalizePaintedTuft(source)
          if (tuft) this.appendPaintedTuft(tuft)
        }
        onProgress?.(end, tufts.length)
        if (end < tufts.length) await this.yieldToUi()
      }
    } finally {
      this.loadingPainted = false
      this.requestRenderRebuild()
    }
  }

  /**
   * Configura o raio máximo de renderização. null significa renderizar todo o mapa.
   * Os limites entre anéis são proporcionais ao alcance, mantendo o detalhe perto
   * e reduzindo a densidade/complexidade progressivamente mais longe.
   */
  setRenderDistance(distance: number | null): void {
    if (distance !== null && !Number.isFinite(distance)) return

    if (distance === null) {
      this.renderBands[0]!.maxDistance = GRASS_NEAR_DISTANCE
      this.renderBands[1]!.maxDistance = GRASS_MIDDLE_DISTANCE
      this.renderBands[2]!.maxDistance = Number.POSITIVE_INFINITY
    } else {
      const safeDistance = THREE.MathUtils.clamp(distance, 10, 5000)
      this.renderBands[0]!.maxDistance = safeDistance * (GRASS_NEAR_DISTANCE / GRASS_VIEW_DISTANCE)
      this.renderBands[1]!.maxDistance = safeDistance * (GRASS_MIDDLE_DISTANCE / GRASS_VIEW_DISTANCE)
      this.renderBands[2]!.maxDistance = safeDistance
    }

    // A atualização é aplicada no próximo frame, evitando reconstruções repetidas
    // enquanto o controle deslizante está sendo arrastado.
    this.renderDirty = true
  }

  /** A qualidade é decidida pela distância individual ao jogador (ou à câmera no editor). */
  updateVisibility(
    cameraPosition: THREE.Vector3,
    playerPosition: THREE.Vector3 | null = null,
    occluderRoots: readonly THREE.Object3D[] = [],
  ): void {
    if (playerPosition) this.windUniforms.uGrassPlayerPosition.value.copy(playerPosition)
    else this.windUniforms.uGrassPlayerPosition.value.set(100000, 0, 100000)

    if (this.loadingPainted) return

    const cameraMoved = !this.lastOcclusionRebuildCameraPosition
      || this.lastOcclusionRebuildCameraPosition.distanceToSquared(cameraPosition)
        >= GRASS_RING_REBUILD_DISTANCE * GRASS_RING_REBUILD_DISTANCE
    this.lastOcclusionCameraPosition = cameraPosition.clone()
    if (this.lastOcclusionRoots !== occluderRoots) {
      this.lastOcclusionRoots = occluderRoots
      this.occlusionDataDirty = true
      this.renderDirty = true
    }

    const renderCenter = playerPosition ?? cameraPosition
    const centerMoved = !this.lastRingCenter ||
      Math.hypot(
        renderCenter.x - this.lastRingCenter.x,
        renderCenter.z - this.lastRingCenter.z,
      ) >= GRASS_RING_REBUILD_DISTANCE

    if (centerMoved) this.lastRingCenter = renderCenter.clone()
    if (centerMoved || cameraMoved || this.renderDirty) {
      this.lastOcclusionRebuildCameraPosition = cameraPosition.clone()
      this.queueDistanceRingRebuild(this.lastRingCenter ?? renderCenter)
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
    this.renderRebuildRevision += 1
    this.pendingRingCenter = null
    this.occludedChunks.clear()
    this.cachedOcclusionRoots = null
    this.cachedOcclusionData = null
    this.lastOcclusionRoots = []
    this.lastOcclusionCameraPosition = null
    this.lastOcclusionRebuildCameraPosition = null
    for (const band of this.renderBands) {
      band.mesh.removeFromParent()
      band.mesh.dispose()
      for (const mesh of band.modelMeshes) {
        mesh?.removeFromParent()
        mesh?.dispose()
      }
      band.spareMesh?.removeFromParent()
      band.spareMesh?.dispose()
      for (const mesh of band.spareModelMeshes) {
        mesh?.removeFromParent()
        mesh?.dispose()
      }
      band.modelMeshes.length = 0
      band.modelCapacities.length = 0
      band.spareMesh = null
      band.spareCapacity = 0
      band.spareModelMeshes.length = 0
      band.spareModelCapacities.length = 0
    }
    for (const part of this.modelParts) part.geometry.dispose()
    for (const material of this.modelMaterials) material.dispose()
    const fallbackTextureWasTracked = this.modelTextures.has(this.modelFallbackTexture)
    for (const texture of this.modelTextures) texture.dispose()
    if (!fallbackTextureWasTracked) this.modelFallbackTexture.dispose()
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
