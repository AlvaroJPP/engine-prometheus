import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * Enquadra um objeto na câmera orbital da prévia do importador.
 * Mantém o centro do objeto como alvo e ajusta o clipping para modelos pequenos ou grandes.
 */
export function fitModelPreviewCamera(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitControls | null,
): void {
  if (!camera || !controls) return
  const bounds = new THREE.Box3().setFromObject(object)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  controls.target.copy(center)
  const span = Math.max(size.x, size.y, size.z, 0.1)
  camera.position.set(center.x + span * 1.7, center.y + span * 1.15, center.z + span * 2.1)
  camera.near = Math.max(0.01, span / 1000)
  camera.far = Math.max(100, span * 100)
  camera.updateProjectionMatrix()
  controls.update()
}

/** Redimensiona o renderer e sincroniza a proporção da câmera com o canvas. */
export function resizeModelPreviewCamera(
  renderer: THREE.WebGLRenderer | null,
  camera: THREE.PerspectiveCamera | null,
  width: number,
  height: number,
): void {
  if (!renderer || !camera) return
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  renderer.setSize(safeWidth, safeHeight, false)
  camera.aspect = safeWidth / safeHeight
  camera.updateProjectionMatrix()
}
