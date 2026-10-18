import * as THREE from 'three'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'

export const SUPPORTED_ASSET_FORMATS = {
  models3D: ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3ds'],
  images2D: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
} as const

const IMAGE_EXTENSIONS = new Set<string>(SUPPORTED_ASSET_FORMATS.images2D)

export type AssetPackageFile = {
  path: string
  file: File
}

export type AssetImportPackageContext = {
  /** Caminho relativo original do modelo dentro do ZIP. */
  primaryPath: string
  /** Arquivos auxiliares do mesmo pacote, incluindo materiais e texturas. */
  files: AssetPackageFile[]
  /** LoadingManager configurado para resolver referências relativas a URLs Blob. */
  manager: THREE.LoadingManager
}

function packageDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const separator = normalized.lastIndexOf('/')
  return separator >= 0 ? normalized.slice(0, separator + 1) : ''
}

function normalizePackagePath(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/').toLocaleLowerCase()
}


function extensionOf(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

async function loadImageAsset(file: File): Promise<THREE.Object3D> {
  const url = URL.createObjectURL(file)
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url)
    URL.revokeObjectURL(url)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    const image = texture.image as HTMLImageElement | ImageBitmap
    const width = Number(image.width) || 1
    const height = Number(image.height) || 1
    const aspect = width / height
    const geometry = new THREE.PlaneGeometry(2 * aspect, 2)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const plane = new THREE.Mesh(geometry, material)
    plane.name = file.name.replace(/\.[^.]+$/, '') || 'Imagem 2D'
    plane.userData.importAssetKind = '2d-image'
    plane.userData.importOriginalDimensions = { width, height }
    return plane
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/**
 * Central parser for formats supported by Three.js. GLB/glTF stays in the
 * component parser because it also captures source metadata used by diagnostics.
 */
export async function loadAssetFile(file: File, packageContext?: AssetImportPackageContext): Promise<THREE.Object3D> {
  const ext = extensionOf(file.name)
  if (IMAGE_EXTENSIONS.has(ext)) {
    // SVGLoader builds actual vector shapes, which remain crisp when scaled.
    if (ext === 'svg') {
      const source = await file.text()
      const parsed = new SVGLoader().parse(source)
      const group = new THREE.Group()
      group.name = file.name.replace(/\.[^.]+$/, '') || 'Imagem vetorial'
      const paths = parsed.paths
      for (const path of paths) {
        const shapes = SVGLoader.createShapes(path)
        for (const shape of shapes) {
          const geometry = new THREE.ShapeGeometry(shape)
          const material = new THREE.MeshBasicMaterial({
            color: path.color ?? 0xffffff,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
          const mesh = new THREE.Mesh(geometry, material)
          mesh.scale.y = -1
          group.add(mesh)
        }
      }
      if (!group.children.length) {
        throw new Error('O SVG não contém formas vetoriais compatíveis para exibir.')
      }
      group.userData.importAssetKind = '2d-vector'
      group.userData.importAnimations = []
      return group
    }
    return loadImageAsset(file)
  }

  const buffer = await file.arrayBuffer()
  const manager = packageContext?.manager ?? new THREE.LoadingManager()
  const resourcePath = packageContext ? packageDirectory(packageContext.primaryPath) : ''
  let object: THREE.Object3D
  switch (ext) {
    case 'obj': {
      const source = new TextDecoder().decode(buffer)
      let materialCreator: ReturnType<MTLLoader['parse']> | undefined
      if (packageContext) {
        const materialReferences = [...source.matchAll(/^\s*mtllib\s+(.+?)\s*$/gim)]
          .map(match => match[1]?.trim())
          .filter((value): value is string => Boolean(value))
        for (const reference of materialReferences) {
          const expectedPath = normalizePackagePath(packageDirectory(packageContext.primaryPath) + reference)
          const referencePath = normalizePackagePath(reference)
          const referenceName = normalizePackagePath(reference.split(/[\\/]/).pop() ?? reference)
          const materialFile = packageContext.files.find(entry => {
            const entryPath = normalizePackagePath(entry.path)
            return entryPath === expectedPath || entryPath === referencePath ||
              entryPath === referenceName
          })
          if (!materialFile) continue
          const materialDirectory = packageDirectory(materialFile.path)
          materialCreator = new MTLLoader(manager).parse(
            await materialFile.file.text(),
            materialDirectory,
          )
          materialCreator.preload()
          break
        }
      }
      const loader = new OBJLoader(manager)
      if (materialCreator) loader.setMaterials(materialCreator)
      object = loader.parse(source)
      break
    }
    case 'stl': {
      const geometry = new STLLoader().parse(buffer)
      geometry.computeVertexNormals()
      object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0xb7c0ce, metalness: 0.05, roughness: 0.8,
      }))
      break
    }
    case 'fbx':
      object = new FBXLoader(manager).parse(buffer, resourcePath)
      break
    case 'ply': {
      const geometry = new PLYLoader().parse(buffer)
      geometry.computeVertexNormals()
      object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0xb7c0ce, vertexColors: Boolean(geometry.getAttribute('color')), roughness: 0.8,
      }))
      break
    }
    case 'dae': {
      const collada = new ColladaLoader(manager).parse(new TextDecoder().decode(buffer), resourcePath)
      if (!collada) throw new Error('Não foi possível interpretar o arquivo Collada (DAE).')
      object = collada.scene
      break
    }
    case '3ds': {
      const loader = new TDSLoader(manager)
      object = loader.parse(buffer, resourcePath)
      break
    }
    default:
      throw new Error(
        `Formato “.${ext || '?'}” não suportado. Formatos 3D: GLB, glTF, FBX, OBJ, STL, PLY, DAE e 3DS. Formatos 2D: PNG, JPG, JPEG, WebP e SVG.`,
      )
  }
  object.name ||= file.name.replace(/\.[^.]+$/, '') || 'Modelo importado'
  object.userData.importAssetKind ||= '3d-model'
  const nativeAnimations = (object as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations
  object.userData.importAnimations ||= nativeAnimations ?? []
  return object
}
