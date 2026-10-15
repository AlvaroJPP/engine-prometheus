import * as THREE from 'three'

export class Viewport {
  readonly renderer: THREE.WebGLRenderer
  private canvas: HTMLCanvasElement
  private observer: ResizeObserver
  private onResize: (aspect: number) => void
  private frame = 0
  private performanceMode = false

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

  /** Reduz a resolução interna do viewport sem alterar o tamanho visual do canvas. */
  setPerformanceMode(enabled: boolean): void {
    if (this.performanceMode === enabled) return
    this.performanceMode = enabled
    this.applyPixelRatio()
    this.resize()
  }

  private applyPixelRatio(): void {
    const deviceRatio = window.devicePixelRatio || 1
    this.renderer.setPixelRatio(Math.min(deviceRatio, this.performanceMode ? 1 : 2))
  }

  private resize(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.onResize(w / h)
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
    this.renderer.dispose()
  }
}
