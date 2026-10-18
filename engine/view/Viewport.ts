import * as THREE from 'three'

export type PerformancePreset = 'quality' | 'balanced' | 'economy'

export interface ViewportRenderStats {
  fps: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  cpuRenderMs: number
  cpuUpdateMs: number
}

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
  /** null follows the active profile's render scale. */
  private resolutionScaleOverride: number | null = null
  /** null follows the active profile's frame rate. */
  private fpsLimitOverride: number | null = null
  /** Resolution adaptation is vendor-agnostic: it uses measured render FPS. */
  private dynamicResolutionEnabled = false
  private dynamicResolutionTargetFps = 45
  private dynamicResolutionMinScale = 0.5
  private dynamicResolutionMultiplier = 1
  private lastDynamicResolutionAdjustmentAt = 0
  private nextRenderAt = 0
  private dirty = true
  private hasRenderedCamera = false
  private readonly lastCameraPosition = new THREE.Vector3()
  private readonly lastCameraQuaternion = new THREE.Quaternion()
  private lastCameraZoom = 1
  private fpsWindowStart = 0
  private fpsFrameCount = 0
  private fpsListener: ((fps: number) => void) | null = null
  private renderStatsListener: ((stats: ViewportRenderStats) => void) | null = null
  private renderTimeAccumulated = 0
  private updateTimeAccumulated = 0
  private updateTimeSamples = 0
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

  /** Independent resolution scale and FPS cap; null follows the active profile. */
  setRenderOptions(options: {
    resolutionScale?: number | null
    fpsLimit?: number | null
    dynamicResolution?: boolean
    dynamicResolutionTargetFps?: number
    dynamicResolutionMinScale?: number
  }): void {
    let changed = false
    if (options.resolutionScale !== undefined) {
      const next = options.resolutionScale === null
        ? null
        : Number.isFinite(options.resolutionScale)
          ? Math.max(0.5, Math.min(1.25, options.resolutionScale))
          : this.resolutionScaleOverride
      if (next !== this.resolutionScaleOverride) {
        this.resolutionScaleOverride = next
        changed = true
      }
    }
    if (options.fpsLimit !== undefined) {
      const next = options.fpsLimit === null
        ? null
        : Number.isFinite(options.fpsLimit)
          ? Math.round(Math.max(15, Math.min(240, options.fpsLimit)))
          : this.fpsLimitOverride
      if (next !== this.fpsLimitOverride) {
        this.fpsLimitOverride = next
        changed = true
      }
    }
    if (options.dynamicResolution !== undefined && options.dynamicResolution !== this.dynamicResolutionEnabled) {
      this.dynamicResolutionEnabled = options.dynamicResolution
      this.dynamicResolutionMultiplier = 1
      this.lastDynamicResolutionAdjustmentAt = 0
      changed = true
    }
    if (options.dynamicResolutionTargetFps !== undefined && Number.isFinite(options.dynamicResolutionTargetFps)) {
      const target = Math.round(Math.max(24, Math.min(120, options.dynamicResolutionTargetFps)))
      if (target !== this.dynamicResolutionTargetFps) {
        this.dynamicResolutionTargetFps = target
        changed = true
      }
    }
    if (options.dynamicResolutionMinScale !== undefined && Number.isFinite(options.dynamicResolutionMinScale)) {
      const minScale = Math.max(0.5, Math.min(0.9, options.dynamicResolutionMinScale))
      if (minScale !== this.dynamicResolutionMinScale) {
        this.dynamicResolutionMinScale = minScale
        changed = true
      }
    }
    if (!changed) return
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
    const baseScale = this.resolutionScaleOverride ?? RESOLUTION_SCALE[this.performancePreset]
    const minMultiplier = Math.min(1, this.dynamicResolutionMinScale / Math.max(0.01, baseScale))
    const resolutionScale = this.dynamicResolutionEnabled
      ? Math.max(this.dynamicResolutionMinScale, baseScale * Math.max(minMultiplier, this.dynamicResolutionMultiplier))
      : baseScale
    const ratio = Math.min(deviceRatio * resolutionScale, maxRatio)
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

  /** Ajusta a escala em pequenos passos para se aproximar da meta de FPS. */
  private updateDynamicResolution(fps: number, now: number): void {
    if (!this.dynamicResolutionEnabled || !Number.isFinite(fps)) return
    // Evita oscilações: só reavalia a escala uma vez por segundo.
    if (this.lastDynamicResolutionAdjustmentAt !== 0 && now - this.lastDynamicResolutionAdjustmentAt < 1000) return
    const baseScale = this.resolutionScaleOverride ?? RESOLUTION_SCALE[this.performancePreset]
    const minMultiplier = Math.min(1, this.dynamicResolutionMinScale / Math.max(0.01, baseScale))
    let nextMultiplier = this.dynamicResolutionMultiplier
    if (fps < this.dynamicResolutionTargetFps - 4) {
      nextMultiplier = Math.max(minMultiplier, this.dynamicResolutionMultiplier - 0.05)
    } else if (fps > this.dynamicResolutionTargetFps + 8) {
      nextMultiplier = Math.min(1, this.dynamicResolutionMultiplier + 0.025)
    }
    if (Math.abs(nextMultiplier - this.dynamicResolutionMultiplier) < 0.001) return
    this.dynamicResolutionMultiplier = nextMultiplier
    this.lastDynamicResolutionAdjustmentAt = now
    this.applyPixelRatio()
    this.resize()
  }

  /**
   * Compila previamente os programas gráficos que a cena carregada vai usar.
   * Isso não converte o mundo em uma imagem: câmera, animações e objetos seguem
   * sendo renderizados normalmente, mas shaders podem deixar de compilar no
   * primeiro quadro em que aparecem.
   */
  async precompile(scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    try {
      await this.renderer.compileAsync(scene, camera)
    } catch (error) {
      // Falha na preparação não impede que o projeto abra: o renderer compilará
      // os materiais sob demanda no fluxo normal.
      console.warn('[Viewport] Pré-compilação de shaders não concluída.', error)
    }
    this.invalidate()
  }

  /** Registra o custo CPU do motor por callback, fora da chamada WebGL render(). */
  recordUpdateDuration(durationMs: number): void {
    if (document.visibilityState === 'hidden' || !Number.isFinite(durationMs) || durationMs < 0) return
    this.updateTimeAccumulated += durationMs
    this.updateTimeSamples += 1
  }

  /** Recebe FPS efetivamente renderizados, não apenas callbacks de requestAnimationFrame. */
  setFpsListener(listener: ((fps: number) => void) | null): void {
    this.fpsListener = listener
    this.fpsFrameCount = 0
    this.fpsWindowStart = 0
  }

  /** Recebe métricas nativas do WebGL para comparar mudanças reais de carga gráfica. */
  setRenderStatsListener(listener: ((stats: ViewportRenderStats) => void) | null): void {
    this.renderStatsListener = listener
    this.fpsFrameCount = 0
    this.fpsWindowStart = 0
    this.renderTimeAccumulated = 0
    this.updateTimeAccumulated = 0
    this.updateTimeSamples = 0
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

    const interval = this.fpsLimitOverride === null
      ? FRAME_INTERVAL_MS[this.performancePreset]
      : 1000 / this.fpsLimitOverride
    if (this.nextRenderAt !== 0 && now + 0.25 < this.nextRenderAt) return false

    const renderStartedAt = performance.now()
    this.renderer.render(scene, camera)
    const renderDuration = performance.now() - renderStartedAt
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

    if (this.fpsListener || this.renderStatsListener) {
      if (this.fpsWindowStart === 0) {
        this.fpsWindowStart = now
      } else {
        this.fpsFrameCount += 1
      }
      this.renderTimeAccumulated += renderDuration
      const elapsed = now - this.fpsWindowStart
      if (elapsed >= 500) {
        const fps = Math.round((this.fpsFrameCount * 1000) / elapsed)
        this.fpsListener?.(fps)
        this.renderStatsListener?.({
          fps,
          drawCalls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          geometries: this.renderer.info.memory.geometries,
          textures: this.renderer.info.memory.textures,
          cpuRenderMs: this.renderTimeAccumulated / Math.max(1, this.fpsFrameCount),
          cpuUpdateMs: this.updateTimeAccumulated / Math.max(1, this.updateTimeSamples),
        })
        this.updateDynamicResolution(fps, now)
        this.fpsFrameCount = 0
        this.fpsWindowStart = now
        this.renderTimeAccumulated = 0
        this.updateTimeAccumulated = 0
        this.updateTimeSamples = 0
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
    this.renderStatsListener = null
    this.renderer.dispose()
  }
}
