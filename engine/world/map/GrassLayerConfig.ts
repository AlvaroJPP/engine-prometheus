import * as THREE from 'three'
import grassModelUrl from '../../../grass_pack_lowpoly_game-ready.glb?url'

export const WORLD_HALF = 50
export const TERRAIN_SAMPLE = 0.5
// Os chunks mantêm apenas os dados espaciais. A renderização usa malhas globais
// agrupadas por anéis concêntricos de distância da câmera.
export const CHUNK_SIZE = 10
export const CHUNKS_PER_AXIS = (WORLD_HALF * 2) / CHUNK_SIZE
export const GRASS_NEAR_DISTANCE = 18
export const GRASS_MIDDLE_DISTANCE = 42
export const GRASS_VIEW_DISTANCE = 72
export const GRASS_MIDDLE_STRIDE = 2
export const GRASS_FAR_STRIDE = 4

export type GrassPerformancePreset = 'quality' | 'balanced' | 'economy'

export interface GrassRenderOptions {
  visible?: boolean
  useDetailedModel?: boolean
  densityPercent?: number
  renderDistanceMode?: 'global' | 'all' | 'custom'
  renderDistance?: number
  nearDetailDistance?: number | null
  middleDetailDistance?: number | null
  occlusionEnabled?: boolean
  occlusionIntervalMs?: number
  wallOcclusionQuality?: 'fast' | 'precise'
  windPercent?: number
}

/**
 * Menos grama distante costuma reduzir muito mais triângulos do que reduzir a
 * resolução da tela. Modos leves reduzem o alcance efetivo, a área em alta densidade
 * e a amostragem dos anéis distantes sem alterar os dados de grama pintada.
 */
export const GRASS_PERFORMANCE_PRESETS: Record<GrassPerformancePreset, {
  nearDistance: number
  middleDistance: number
  viewDistance: number
  viewScale: number
  nearStride: number
  middleStride: number
  farStride: number
}> = {
  quality: {
    nearDistance: GRASS_NEAR_DISTANCE,
    middleDistance: GRASS_MIDDLE_DISTANCE,
    viewDistance: GRASS_VIEW_DISTANCE,
    viewScale: 1,
    nearStride: 1,
    middleStride: GRASS_MIDDLE_STRIDE,
    farStride: GRASS_FAR_STRIDE,
  },
  balanced: {
    nearDistance: 15,
    middleDistance: 32,
    viewDistance: GRASS_VIEW_DISTANCE,
    viewScale: 0.82,
    nearStride: 1,
    middleStride: 3,
    farStride: 6,
  },
  economy: {
    nearDistance: 10,
    middleDistance: 20,
    viewDistance: GRASS_VIEW_DISTANCE,
    viewScale: 0.55,
    nearStride: 1,
    middleStride: 4,
    farStride: 8,
  },
}
// A geometria da grama é agrupada por anéis globais. Evite reconstruí-los
// a cada movimento curto da câmera: um rebuild percorre todos os tufos ativos.
export const GRASS_RING_REBUILD_DISTANCE = 3
export const GRASS_REBUILD_COALESCE_MS = 85
export const MIN_GRASS_RING_REBUILD_INTERVAL_MS = 280
// Os raycasts de oclusão são mais caros que a simples redistribuição dos anéis.
// A posição do jogador/câmera pode mudar várias vezes antes de recalcular a oclusão.
export const GRASS_OCCLUSION_RECHECK_INTERVAL_MS = 400
export const PAINTED_GRASS_SPACING = 0.17
// Buckets maiores evitam criar um Map e um array para quase cada tufo em mapas densos.
export const PAINTED_GRASS_BUCKET_SIZE = 1
export const PAINTED_GRASS_PER_AREA = 12
export const PAINTED_GRASS_MODEL_HEIGHT = 0.55
// A oclusão é conservadora: uma área só some quando todas as amostras
// estão bloqueadas pelo mesmo objeto. Áreas parcialmente cobertas são subdivididas.
export const GRASS_OCCLUSION_ENTER_MARGIN = 1.25
export const GRASS_OCCLUSION_STAY_MARGIN = 0.35
export const GRASS_OCCLUSION_SUBDIVISIONS = 4
export const GRASS_OCCLUSION_CELL_SIZE = CHUNK_SIZE / GRASS_OCCLUSION_SUBDIVISIONS
export const GRASS_OCCLUSION_CELLS_PER_AXIS = Math.ceil((WORLD_HALF * 2) / GRASS_OCCLUSION_CELL_SIZE)
export const GRASS_OCCLUSION_SAMPLE_OFFSETS = [0.15, 0.5, 0.85] as const
export const GRASS_OCCLUSION_SAMPLE_HEIGHTS = [0.08, 0.62] as const
export const GRASS_OCCLUSION_COARSE_SAMPLE_POINTS = [
  { x: 0.15, z: 0.15 },
  { x: 0.85, z: 0.15 },
  { x: 0.5, z: 0.5 },
  { x: 0.15, z: 0.85 },
  { x: 0.85, z: 0.85 },
] as const
export const GRASS_OCCLUSION_EDGE_SAMPLE_POINTS = [
  { x: 0.5, z: 0.15 },
  { x: 0.85, z: 0.5 },
  { x: 0.5, z: 0.85 },
  { x: 0.15, z: 0.5 },
] as const
export const GRASS_OCCLUSION_FINE_SAMPLE_POINTS = GRASS_OCCLUSION_SAMPLE_OFFSETS.flatMap((x) =>
  GRASS_OCCLUSION_SAMPLE_OFFSETS.map((z) => ({ x, z })),
)
export const GRASS_MODEL_URL = grassModelUrl

export type PaintedGrassTuft = [x: number, z: number, scale: number, color: number]

export interface GrassInstance {
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

export interface GrassModelPart {
  variantIndex: number
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
}

export interface GrassChunk {
  column: number
  row: number
  procedural: GrassInstance[]
  painted: PaintedGrassTuft[]
}

export interface GrassOcclusionMesh {
  mesh: THREE.Mesh
  bounds: THREE.Box3
}

export interface GrassOcclusionRoot {
  root: THREE.Object3D
  bounds: THREE.Box3
  meshes: GrassOcclusionMesh[]
}

export interface GrassOcclusionData {
  roots: GrassOcclusionRoot[]
  ownerByMesh: Map<THREE.Mesh, THREE.Object3D>
}

export type GrassBandName = 'near' | 'middle' | 'far'

export interface GrassRenderBand {
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

