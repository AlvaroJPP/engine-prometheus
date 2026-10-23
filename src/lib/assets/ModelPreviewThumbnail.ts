import * as THREE from 'three'

/**
 * Captures the current model preview as a square WebP thumbnail.
 * Temporary collider/rig helpers are hidden only while rendering the capture.
 */
export function captureModelPreviewThumbnail(
  source: HTMLCanvasElement | null,
  renderer: THREE.WebGLRenderer | null,
  scene: THREE.Scene | null,
  camera: THREE.Camera | null,
  helpers: Array<THREE.Object3D | null>,
): string | undefined {
  if (!source || !renderer || !scene || !camera || source.width < 1 || source.height < 1) return undefined

  const visibleHelpers = helpers.filter((item): item is THREE.Object3D => item !== null)
  const previousVisibility = visibleHelpers.map(item => item.visible)
  try {
    visibleHelpers.forEach(item => { item.visible = false })
    renderer.render(scene, camera)

    const size = 160
    const thumbnail = document.createElement('canvas')
    thumbnail.width = size
    thumbnail.height = size
    const context = thumbnail.getContext('2d')
    if (!context) return undefined
    context.fillStyle = '#20232a'
    context.fillRect(0, 0, size, size)

    const padding = 8
    const scale = Math.min((size - padding * 2) / source.width, (size - padding * 2) / source.height)
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    context.drawImage(source, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height)
    return thumbnail.toDataURL('image/webp', 0.82)
  } catch (cause) {
    console.warn('[ModelImportDialog] Não foi possível gerar a miniatura do modelo.', cause)
    return undefined
  } finally {
    visibleHelpers.forEach((item, index) => { item.visible = previousVisibility[index] ?? true })
    renderer.render(scene, camera)
  }
}
