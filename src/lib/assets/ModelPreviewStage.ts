import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type ModelPreviewStage = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
}

/**
 * Cria a cena, a câmera orbital, as luzes e a grade da prévia de importação.
 * O componente continua responsável pelo loop de animação e pelo ciclo de vida.
 */
export function createModelPreviewStage(canvasElement: HTMLCanvasElement): ModelPreviewStage {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#20232a')
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasElement,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false)

  scene.add(new THREE.HemisphereLight(0xe4edff, 0x55515a, 2))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(4, 8, 6)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9dbaff, 0.8)
  fill.position.set(-5, 3, -4)
  scene.add(fill)
  const grid = new THREE.GridHelper(20, 20, 0x858b98, 0x454a55)
  grid.position.y = -0.002
  scene.add(grid)

  const controls = new OrbitControls(camera, canvasElement)
  controls.enableDamping = true

  return { scene, camera, renderer, controls }
}
