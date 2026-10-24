import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { resizeModelPreviewCamera } from './ModelPreviewCamera'

export type ModelPreviewRenderLoopOptions = {
  canvasElement: HTMLCanvasElement
  getCanvas: () => HTMLCanvasElement | null
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  getRenderer: () => THREE.WebGLRenderer | null
  getControls: () => OrbitControls | null
  clock: THREE.Clock
  isAnimationPlaying: () => boolean
  updateAnimation: (deltaSeconds: number) => void
}

/**
 * Inicia o loop de renderização da prévia e observa o tamanho do canvas.
 * Retorna uma função idempotente de encerramento para o componente gerenciar o ciclo de vida.
 */
export function startModelPreviewRenderLoop(options: ModelPreviewRenderLoopOptions): () => void {
  let frame = 0
  let active = true

  const resizeObserver = new ResizeObserver(() => {
    const canvas = options.getCanvas()
    const renderer = options.getRenderer()
    const camera = options.getCamera()
    if (!canvas || !renderer || !camera) return
    resizeModelPreviewCamera(renderer, camera, canvas.clientWidth, canvas.clientHeight)
  })
  resizeObserver.observe(options.canvasElement)

  const renderFrame = () => {
    if (!active) return
    frame = requestAnimationFrame(renderFrame)
    options.getControls()?.update()
    if (options.isAnimationPlaying()) {
      options.updateAnimation(Math.min(options.clock.getDelta(), 0.1))
    }
    const scene = options.getScene()
    const camera = options.getCamera()
    const renderer = options.getRenderer()
    if (scene && camera && renderer) renderer.render(scene, camera)
  }

  renderFrame()

  return () => {
    if (!active) return
    active = false
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
  }
}
