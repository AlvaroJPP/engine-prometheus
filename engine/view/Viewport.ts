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
  private lastRenderAt = 0
  private fpsWindowStart = 0
  private fpsFrameCount = 0
  private fpsListener: ((fps: number) => void) | null = null

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
    this.resize()
  }

  /** Define o orçamento de renderização sem reduzir a frequência da simulação. */
  setPerformancePreset(preset: PerformancePreset): void {
    if (this.performancePreset === preset) return
    this.performancePreset = preset
    this.lastRenderAt = 0
    this.applyPixelRatio()
    this.resize()
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
  }

  /** Recebe FPS efetivamente renderizados, não apenas callbacks de requestAnimationFrame. */
  setFpsListener(listener: ((fps: number) => void) | null): void {
    this.fpsListener = listener
    this.fpsFrameCount = 0
    this.fpsWindowStart = 0
  }

  /** Renderiza dentro do limite do preset. A simulação continua atualizando em cada RAF. */
  render(scene: THREE.Scene, camera: THREE.Camera, now = performance.now()): boolean {
    if (document.visibilityState === 'hidden') return false

    const interval = FRAME_INTERVAL_MS[this.performancePreset]
    if (this.lastRenderAt !== 0 && now - this.lastRenderAt < interval) return false

    this.lastRenderAt = now
    this.renderer.render(scene, camera)

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

  /** Chama frame(dt) a cada quadro; dt em segundos. */
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
    this.fpsListener = null
    this.renderer.dispose()
  }
}
