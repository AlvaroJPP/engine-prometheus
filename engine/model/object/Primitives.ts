import * as THREE from 'three'
import { newId } from '../../lib/id'
import type { FaceTextureData, FaceTextureMap, ObjectType, TextureFace, Vec3 } from '../../project/format'
import { PRIMITIVE_DEFS } from './defs'
import type { GameObject } from './GameObject'

export type TexturePreset = 'none' | 'grass' | 'stone' | 'brick' | 'wood' | 'sand' | 'metal'

export interface PrimitiveInit {
  id?: string
  name?: string
  color?: number
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  visible?: boolean
  locked?: boolean
  wireframeVisible?: boolean
  groupId?: string | null
  mass?: number
  colliderType?: 'auto' | 'box' | 'sphere' | 'capsule' | 'none'
  colliderSize?: Vec3
  colliderOffset?: Vec3
  texturePreset?: TexturePreset
  textureRepeat?: number
  faceTextures?: FaceTextureMap
}

const TEXTURE_COLORS: Record<Exclude<TexturePreset, 'none'>, [string, string, string]> = {
  grass: ['#426b32', '#6f9846', '#304f28'],
  stone: ['#777a7d', '#a1a3a4', '#55585c'],
  brick: ['#9a4c35', '#c77b58', '#6f352b'],
  wood: ['#80502d', '#b27a45', '#59351f'],
  sand: ['#bba16d', '#dfc58d', '#9c8154'],
  metal: ['#59636c', '#9aa4ad', '#343b42'],
}

function createProceduralTexture(preset: Exclude<TexturePreset, 'none'>): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível gerar a textura.')
  const [base, light, dark] = TEXTURE_COLORS[preset]
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 128, 128)
  if (preset === 'brick') {
    for (let row = 0; row < 8; row++) {
      const y = row * 16
      const offset = row % 2 ? -8 : 0
      for (let x = offset; x < 128; x += 32) {
        ctx.fillStyle = (row + Math.floor((x - offset) / 32)) % 3 === 0 ? light : base
        ctx.fillRect(x + 1, y + 1, 30, 14)
        ctx.strokeStyle = dark
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, 30, 14)
      }
    }
  } else if (preset === 'wood') {
    for (let y = 0; y < 128; y += 16) {
      ctx.fillStyle = y % 32 === 0 ? light : base
      ctx.fillRect(0, y, 128, 14)
      ctx.strokeStyle = dark
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(0, y + 14); ctx.lineTo(128, y + 14); ctx.stroke()
      ctx.strokeStyle = light
      for (let x = 12; x < 128; x += 31) {
        ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x + 5, y + 11); ctx.stroke()
      }
    }
  } else if (preset === 'grass') {
    for (let i = 0; i < 520; i++) {
      const x = (i * 37) % 128, y = (i * 71) % 128
      ctx.strokeStyle = i % 3 === 0 ? light : dark
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ((i % 5) - 2), y - 3 - (i % 5)); ctx.stroke()
    }
  } else if (preset === 'stone' || preset === 'sand') {
    for (let i = 0; i < 180; i++) {
      const x = (i * 47) % 128, y = (i * 29) % 128
      ctx.fillStyle = i % 2 ? light : dark
      ctx.globalAlpha = 0.35
      ctx.beginPath(); ctx.arc(x, y, 1 + (i % 4), 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    if (preset === 'stone') {
      ctx.strokeStyle = dark; ctx.globalAlpha = 0.45
      ctx.strokeRect(2, 2, 61, 61); ctx.strokeRect(65, 2, 61, 61)
      ctx.strokeRect(2, 65, 61, 61); ctx.strokeRect(65, 65, 61, 61)
      ctx.globalAlpha = 1
    }
  } else {
    for (let y = 0; y < 128; y += 8) {
      ctx.fillStyle = y % 16 === 0 ? light : dark
      ctx.globalAlpha = 0.3
      ctx.fillRect(0, y, 128, 2)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = light
    ctx.strokeRect(4, 4, 120, 120)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2, 2)
  texture.anisotropy = 4
  return texture
}

/** Aplica ou remove uma textura procedural em todas as faces do cubo/plataforma. */
export function applyTexturePreset(mesh: THREE.Mesh, preset: TexturePreset, repeat = 2): void {
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .filter((material): material is THREE.MeshStandardMaterial => material instanceof THREE.MeshStandardMaterial)
  if (!materials.length) return
  const previous = mesh.userData.generatedTexture as THREE.Texture | undefined
  previous?.dispose()
  const faceTextures = mesh.userData.generatedFaceTextures as THREE.Texture[] | undefined
  faceTextures?.forEach(texture => texture.dispose())
  mesh.userData.generatedFaceTextures = []
  let texture: THREE.Texture | null = null
  if (preset !== 'none') {
    texture = createProceduralTexture(preset)
    texture.repeat.set(THREE.MathUtils.clamp(repeat, 1, 8), THREE.MathUtils.clamp(repeat, 1, 8))
    mesh.userData.generatedTexture = texture
  } else {
    mesh.userData.generatedTexture = undefined
  }
  for (const material of materials) {
    material.map = texture
    material.color.setHex(texture ? 0xffffff : (typeof mesh.userData.baseColor === 'number' ? mesh.userData.baseColor : 0xffffff))
    material.needsUpdate = true
  }
  mesh.userData.texturePreset = preset
  mesh.userData.textureRepeat = THREE.MathUtils.clamp(repeat, 1, 8)
  applyFaceTextures(mesh, (mesh.userData.faceTextures ?? {}) as FaceTextureMap)
}

/** Aplica imagens independentes por face. A resolução define o tamanho em pixels da imagem amostrada. */
export function applyFaceTextures(mesh: THREE.Mesh, faceMap: FaceTextureMap): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const faceOrder: TextureFace[] = ['right', 'left', 'top', 'bottom', 'front', 'back']
  const previous = mesh.userData.generatedFaceTextures as THREE.Texture[] | undefined
  previous?.forEach(texture => texture.dispose())
  mesh.userData.generatedFaceTextures = []
  mesh.userData.faceTextures = JSON.parse(JSON.stringify(faceMap)) as FaceTextureMap
  const version = (Number(mesh.userData.faceTextureVersion) || 0) + 1
  mesh.userData.faceTextureVersion = version
  const presetTexture = mesh.userData.generatedTexture as THREE.Texture | undefined
  faceOrder.forEach((face, index) => {
    const material = materials[index] as THREE.MeshStandardMaterial | undefined
    if (!material || !(material instanceof THREE.MeshStandardMaterial)) return
    const config = faceMap[face]
    if (!config?.imageDataUrl) {
      material.map = presetTexture ?? null
      material.color.setHex(presetTexture ? 0xffffff : (typeof mesh.userData.baseColor === 'number' ? mesh.userData.baseColor : 0xffffff))
      material.needsUpdate = true
      return
    }
    const loader = new THREE.TextureLoader()
    loader.load(config.imageDataUrl, (loaded) => {
      if (mesh.userData.faceTextureVersion !== version) {
        loaded.dispose()
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = THREE.MathUtils.clamp(Math.round(config.pixelWidth || 128), 8, 10000)
      canvas.height = THREE.MathUtils.clamp(Math.round(config.pixelHeight || 128), 8, 10000)
      const context = canvas.getContext('2d')
      if (!context) { loaded.dispose(); return }
      context.imageSmoothingEnabled = false
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height)
      loaded.dispose()
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      texture.needsUpdate = true
      const currentMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const current = currentMaterials[index] as THREE.MeshStandardMaterial | undefined
      if (!current || mesh.userData.faceTextureVersion !== version) { texture.dispose(); return }
      current.map = texture
      current.color.setHex(0xffffff)
      current.needsUpdate = true
      ;(mesh.userData.generatedFaceTextures as THREE.Texture[]).push(texture)
    })
  })
}

export function createPrimitive(type: ObjectType, init: PrimitiveInit = {}): GameObject {
  const def = PRIMITIVE_DEFS[type]
  const id = init.id ?? newId(type)
  const [w, h, d] = def.size
  const geometry = new THREE.BoxGeometry(w, h, d)
  const mesh = new THREE.Mesh(
    geometry,
    Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial({ color: init.color ?? def.color, roughness: 0.6 })),
  )

  // Mostra a topologia poligonal sobre a superfície sólida, como uma malha de modelagem 3D.
  // WireframeGeometry expõe as arestas dos triângulos que formam as faces do objeto.
  const polygonGeometry = new THREE.WireframeGeometry(geometry)
  const polygonMaterial = new THREE.LineBasicMaterial({
    color: 0x252832,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  })
  const polygons = new THREE.LineSegments(polygonGeometry, polygonMaterial)
  polygons.name = 'polygon-wireframe'
  polygons.userData.editorOverlay = true
  polygons.renderOrder = 1
  polygons.visible = init.wireframeVisible ?? true
  mesh.add(polygons)

  const [px, py, pz] = init.position ?? [0, h / 2, 0]
  mesh.position.set(px, py, pz)
  const [rx, ry, rz] = init.rotation ?? [0, 0, 0]
  mesh.rotation.set(rx, ry, rz)
  const [sx, sy, sz] = init.scale ?? [1, 1, 1]
  mesh.scale.set(sx, sy, sz)
  mesh.visible = init.visible ?? true
  mesh.userData.id = id
  mesh.userData.locked = init.locked ?? false
  mesh.userData.groupId = init.groupId ?? null
  mesh.userData.wireframeVisible = init.wireframeVisible ?? true
  mesh.userData.mass = Number.isFinite(init.mass) ? Math.max(0, init.mass as number) : 1
  mesh.userData.colliderType = init.colliderType ?? 'auto'
  mesh.userData.colliderSize = init.colliderSize?.map(v => Number.isFinite(v) ? Math.max(0.05, v) : 1) ?? null
  mesh.userData.colliderOffset = init.colliderOffset?.map(v => Number.isFinite(v) ? v : 0) ?? [0, 0, 0]
  mesh.userData.baseColor = init.color ?? def.color
  applyTexturePreset(mesh, init.texturePreset ?? 'none', init.textureRepeat ?? 2)
  if (init.faceTextures) applyFaceTextures(mesh, init.faceTextures)
  const name = init.name ?? `${def.label} ${id.split('_')[1] ?? ''}`.trim()
  return { id, name, type, mesh }
}
