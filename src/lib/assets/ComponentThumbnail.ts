import * as THREE from 'three'
import { disposeThreeObjectResources } from '@/lib/assets/ThreeObjectResources'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const THUMBNAIL_SIZE = 160

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null

function ensureThumbnailRenderer(): boolean {
  if (renderer && scene && camera) return true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = THUMBNAIL_SIZE
    canvas.height = THUMBNAIL_SIZE
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(1)
    renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setClearColor(0x20232a, 1)

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#20232a')
    scene.add(new THREE.HemisphereLight(0xe4edff, 0x55515a, 2))
    const key = new THREE.DirectionalLight(0xffffff, 2)
    key.position.set(4, 8, 6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x9dbaff, 0.8)
    fill.position.set(-5, 3, -4)
    scene.add(fill)

    camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000)
    return true
  } catch (cause) {
    console.warn('[ComponentThumbnail] Não foi possível iniciar o renderizador de miniaturas.', cause)
    renderer?.dispose()
    renderer = null
    scene = null
    camera = null
    return false
  }
}

function disposeModelResources(root: THREE.Object3D) {
  disposeThreeObjectResources(root, 'nodes-with-resources')
}

/**
 * Gera uma miniatura para componentes antigos que foram salvos antes da
 * biblioteca passar a armazenar imagens de preview.
 */
export async function generateComponentThumbnail(bytes: ArrayBuffer): Promise<string | undefined> {
  if (!ensureThumbnailRenderer()) return undefined
  const activeRenderer = renderer
  const activeScene = scene
  const activeCamera = camera
  if (!activeRenderer || !activeScene || !activeCamera) return undefined

  let root: THREE.Object3D | null = null
  try {
    const loader = new GLTFLoader()
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      loader.parse(bytes.slice(0), '', result => resolve(result), reject)
    })
    root = gltf.scene
    root.updateMatrixWorld(true)

    const bounds = new THREE.Box3().setFromObject(root)
    if (bounds.isEmpty()) return undefined

    const center = bounds.getCenter(new THREE.Vector3())
    root.position.sub(center)
    root.updateMatrixWorld(true)

    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(0.05, sphere.radius)
    const fov = THREE.MathUtils.degToRad(activeCamera.fov)
    const distance = Math.max(0.5, radius / Math.sin(fov / 2) * 1.28)
    activeCamera.position.set(distance * 0.9, distance * 0.7, distance * 1.1)
    activeCamera.near = Math.max(0.01, distance / 1000)
    activeCamera.far = Math.max(100, distance * 20)
    activeCamera.lookAt(0, 0, 0)
    activeCamera.updateProjectionMatrix()

    activeScene.add(root)
    activeRenderer.render(activeScene, activeCamera)
    return activeRenderer.domElement.toDataURL('image/webp', 0.8)
  } catch (cause) {
    console.warn('[ComponentThumbnail] Não foi possível gerar a miniatura de um componente.', cause)
    return undefined
  } finally {
    if (root) {
      activeScene.remove(root)
      disposeModelResources(root)
    }
  }
}
