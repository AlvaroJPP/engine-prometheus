import * as THREE from 'three'

export type PerformancePreset = 'quality' | 'balanced' | 'economy'

const FRAME_INTERVAL_MS: Record<PerformancePreset, number> = {
  quality: 1000 / 60,
  balanced: 1000 / 45,
  economy: 1000 / 30,
}

const RESOLUTION_SCALE: Record<PerformancePreset, number> = {
  quality: 1,
  balanced: 0.85,
  economy: 0.75,
}

export class Viewport {
  readonly renderer: THREE.WebGLRenderer
  private canvas: HTMLCanvasElement
  private observer: ResizeObserver
  private onResize: (aspect: number) => void
  private frame = 0
  private performancePreset: PerformancePreset = 'quality'
  private nextRenderAt = 0
  private dirty = true
  private hasRenderedCamera = false
  private readonly lastCameraPosition = new THREE.Vector3()
  private readonly lastCameraQuaternion = new THREE.Quaternion()
  private lastCameraZoom = 1
  private fpsWindowStart = 0
  private fpsFrameCount = 0
  private fpsListener: ((fps: number) => void) | null = null
  private readonly invalidateFromInput = () => this.invalidate()

  constructor(canvas: HTMLCanvasElement, onResize: (aspect: number) => void) {
    this.canvas = canvas
    this.onResize = onResize
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    // Alinhe a saída do viewport com o espaço de cor sRGB esperado por glTF.
    // Sem isso, materiais/texturas podem parecer diferentes da prévia de importação.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.toneMappingExposure = 1
    this.applyPixelRatio()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas)

    // Interações visuais, como o hover do gizmo, precisam acordar o viewport.
    for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick']) {
      this.canvas.addEventListener(eventName, this.invalidateFromInput, { passive: true })
    }
    window.addEventListener('keydown', this.invalidateFromInput)
    window.addEventListener('keyup', this.invalidateFromInput)
    document.addEventListener('visibilitychange', this.invalidateFromInput)
    this.resize()
  }

  /** Solicita um novo quadro quando o conteúdo da cena é alterado. */
  invalidate(): void {
    this.dirty = true
  }

  /** Define o orçamento de renderização sem reduzir a frequência da simulação. */
  setPerformancePreset(preset: PerformancePreset): void {
    if (this.performancePreset === preset) return
    this.performancePreset = preset
    this.nextRenderAt = 0
    this.applyPixelRatio()
    this.resize()
    this.invalidate()
  }

  /** Compatibilidade com chamadas antigas do modo desempenho. */
  setPerformanceMode(enabled: boolean): void {
    this.setPerformancePreset(enabled ? 'economy' : 'quality')
  }

  private applyPixelRatio(): void {
    const deviceRatio = window.devicePixelRatio || 1
    const maxRatio = this.performancePreset === 'quality' ? 2 : this.performancePreset === 'balanced' ? 1.7 : 1.5
    const ratio = Math.min(deviceRatio * RESOLUTION_SCALE[this.performancePreset], maxRatio)
    this.renderer.setPixelRatio(ratio)
  }

  private resize(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.onResize(w / h)
    this.invalidate()
  }

  /** Recebe FPS efetivamente renderizados, não apenas callbacks de requestAnimationFrame. */
  setFpsListener(listener: ((fps: number) => void) | null): void {
    this.fpsListener = listener
    this.fpsFrameCount = 0
    this.fpsWindowStart = 0
  }

  /** Renderiza dentro do limite do preset e dorme enquanto uma cena estática não muda. */
  render(scene: THREE.Scene, camera: THREE.Camera, now = performance.now(), force = false): boolean {
    if (document.visibilityState === 'hidden') return false

    const cameraZoom = camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera
      ? camera.zoom
      : 1
    const cameraChanged = !this.hasRenderedCamera
      || this.lastCameraPosition.distanceToSquared(camera.position) > 1e-8
      || 1 - Math.abs(this.lastCameraQuaternion.dot(camera.quaternion)) > 1e-8
      || Math.abs(this.lastCameraZoom - cameraZoom) > 1e-8

    if (cameraChanged) this.dirty = true
    if (!force && !this.dirty) return false

    const interval = FRAME_INTERVAL_MS[this.performancePreset]
    if (this.nextRenderAt !== 0 && now + 0.25 < this.nextRenderAt) return false

    this.renderer.render(scene, camera)
    this.dirty = false
    this.hasRenderedCamera = true
    this.lastCameraPosition.copy(camera.position)
    this.lastCameraQuaternion.copy(camera.quaternion)
    this.lastCameraZoom = cameraZoom

    // Acumula o prazo-alvo em vez de comparar apenas com o último quadro.
    // Isso permite, por exemplo, alternar 16,7/33,3 ms para aproximar 45 FPS
    // em telas de 60 Hz, sem cair acidentalmente para 30 FPS.
    if (this.nextRenderAt === 0) {
      this.nextRenderAt = now + interval
    } else {
      this.nextRenderAt += interval
      if (this.nextRenderAt <= now) {
        const missedIntervals = Math.floor((now - this.nextRenderAt) / interval) + 1
        this.nextRenderAt += missedIntervals * interval
      }
    }

    if (this.fpsListener) {
      if (this.fpsWindowStart === 0) this.fpsWindowStart = now
      this.fpsFrameCount += 1
      const elapsed = now - this.fpsWindowStart
      if (elapsed >= 500) {
        this.fpsListener(Math.round((this.fpsFrameCount * 1000) / elapsed))
        this.fpsFrameCount = 0
        this.fpsWindowStart = now
      }
    }
    return true
  }

  /** Atualiza a simulação em cada RAF; a renderização é limitada separadamente. */
  start(frame: (dt: number) => void): void {
    let last = performance.now()
    const loop = (now: number) => {
      // Agenda o próximo quadro antes de executar o motor. Uma exceção isolada
      // não deve encerrar permanentemente a renderização do editor.
      this.frame = requestAnimationFrame(loop)
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      try {
        frame(dt)
      } catch (error) {
        console.error('[Viewport] Erro durante a atualização do quadro:', error)
      }
    }
    this.frame = requestAnimationFrame(loop)
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick']) {
      this.canvas.removeEventListener(eventName, this.invalidateFromInput)
    }
    window.removeEventListener('keydown', this.invalidateFromInput)
    window.removeEventListener('keyup', this.invalidateFromInput)
    document.removeEventListener('visibilitychange', this.invalidateFromInput)
    this.fpsListener = null
    this.renderer.dispose()
  }
}
