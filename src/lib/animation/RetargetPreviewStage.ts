import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { disposeRetargetPreviewObject } from './RetargetPreviewObjects'

export type RetargetPreviewStage = {
  key: 'source' | 'target'
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  resizeObserver: ResizeObserver
  frame: number
  clock: THREE.Clock
  root: THREE.Object3D | null
  mixer: THREE.AnimationMixer | null
  /** Última posição mundial para manter o personagem dentro do enquadramento durante root motion. */
  lastRootWorldPosition: THREE.Vector3 | null
}

/**
 * Cria um palco Three.js isolado para pré-visualizar a animação de origem
 * ou a animação já transferida ao rig de destino.
 */
export function createRetargetPreviewStage(
  canvasElement: HTMLCanvasElement,
  key: RetargetPreviewStage['key'],
  isPlaying: () => boolean,
): RetargetPreviewStage {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#20232a')
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
  const renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, alpha: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(Math.max(1, canvasElement.clientWidth), Math.max(1, canvasElement.clientHeight), false)

  scene.add(new THREE.HemisphereLight(0xe4edff, 0x55515a, 2))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(4, 8, 6)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0x9dbaff, 0.75)
  fillLight.position.set(-5, 3, -4)
  scene.add(fillLight)

  const controls = new OrbitControls(camera, canvasElement)
  controls.enableDamping = true
  controls.enablePan = true
  const stage: RetargetPreviewStage = {
    key,
    renderer,
    scene,
    camera,
    controls,
    resizeObserver: new ResizeObserver(() => {
      const width = Math.max(1, canvasElement.clientWidth)
      const height = Math.max(1, canvasElement.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }),
    frame: 0,
    clock: new THREE.Clock(),
    root: null,
    mixer: null,
    lastRootWorldPosition: null,
  }
  stage.resizeObserver.observe(canvasElement)

  const renderFrame = () => {
    stage.frame = requestAnimationFrame(renderFrame)
    stage.controls.update()
    const delta = Math.min(stage.clock.getDelta(), 0.1)
    const playing = isPlaying()
    if (playing) stage.mixer?.update(delta)
    // Root motion pode mover todo o clone para fora da câmera fixa. Na prévia
    // do destino, deslocamos câmera e alvo pelo mesmo delta, sem alterar a
    // trajetória do modelo salvo nem mexer na visualização do clipe de origem.
    if (stage.key === 'target' && stage.root && stage.mixer && playing) {
      const currentRootWorldPosition = stage.root.getWorldPosition(new THREE.Vector3())
      if (stage.lastRootWorldPosition) {
        const followDelta = currentRootWorldPosition.clone().sub(stage.lastRootWorldPosition)
        stage.camera.position.add(followDelta)
        stage.controls.target.add(followDelta)
      }
      stage.lastRootWorldPosition = currentRootWorldPosition
    }
    stage.renderer.render(stage.scene, stage.camera)
  }
  stage.clock.start()
  renderFrame()
  return stage
}

export function fitRetargetPreviewCamera(stage: RetargetPreviewStage, object: THREE.Object3D): void {
  object.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) return
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const span = Math.max(size.x, size.y, size.z, 0.1)
  stage.controls.target.copy(center)
  stage.camera.position.set(center.x + span * 1.7, center.y + span * 1.1, center.z + span * 2.1)
  stage.camera.near = Math.max(0.01, span / 1000)
  stage.camera.far = Math.max(100, span * 100)
  stage.camera.updateProjectionMatrix()
  stage.controls.update()
}

/** Replace the displayed clone without taking ownership of shared source textures. */
export function setRetargetPreviewStageObject(
  stage: RetargetPreviewStage,
  root: THREE.Object3D | null,
  clip: THREE.AnimationClip | null = null,
  onClipStarted?: () => void,
): void {
  if (stage.mixer) {
    stage.mixer.stopAllAction()
    if (stage.root) stage.mixer.uncacheRoot(stage.root)
  }
  stage.mixer = null
  if (stage.root) {
    stage.scene.remove(stage.root)
    disposeRetargetPreviewObject(stage.root)
  }
  stage.root = root
  stage.lastRootWorldPosition = null
  if (!root) return
  stage.scene.add(root)
  root.updateWorldMatrix(true, true)
  stage.lastRootWorldPosition = root.getWorldPosition(new THREE.Vector3())
  fitRetargetPreviewCamera(stage, root)
  if (clip) {
    stage.mixer = new THREE.AnimationMixer(root)
    stage.mixer.clipAction(clip).reset().play()
    stage.clock.start()
    onClipStarted?.()
  }
}

export function disposeRetargetPreviewStage(stage: RetargetPreviewStage | null): void {
  if (!stage) return
  cancelAnimationFrame(stage.frame)
  stage.resizeObserver.disconnect()
  stage.controls.dispose()
  stage.mixer?.stopAllAction()
  if (stage.root) {
    stage.scene.remove(stage.root)
    disposeRetargetPreviewObject(stage.root)
  }
  stage.scene.clear()
  stage.renderer.dispose()
}
