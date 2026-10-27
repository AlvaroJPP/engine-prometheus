/**
 * Instrumentação do canvas separada do ciclo de renderização.
 *
 * Este módulo não altera layout nem decide quando renderizar. Ele registra
 * dimensões, contagem de quadros, falhas de contexto e erros para que o painel
 * de diagnóstico possa distinguir um canvas sem tamanho de um WebGL sem quadros.
 */
export class ViewportDiagnostics {
  private readonly canvas: HTMLCanvasElement
  private readonly onContextRestored: () => void

  constructor(canvas: HTMLCanvasElement, onContextRestored: () => void) {
    this.canvas = canvas
    this.onContextRestored = onContextRestored
    this.canvas.dataset.engineWebglReady = 'initializing'
    this.canvas.dataset.engineContextLost = 'false'
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored)
  }

  markWebglReady(): void {
    this.canvas.dataset.engineWebglReady = 'true'
    delete this.canvas.dataset.engineWebglError
    window.dispatchEvent(new CustomEvent('engine-prometheus:webgl-ready'))
  }

  markWebglInitializationError(error: unknown): void {
    const message = this.describeError(error)
    this.canvas.dataset.engineWebglReady = 'false'
    this.canvas.dataset.engineWebglError = message
    window.dispatchEvent(new CustomEvent('engine-prometheus:webgl-init-error', {
      detail: { message },
    }))
  }

  markResizeBlocked(width: number, height: number): void {
    this.canvas.dataset.engineResizeBlocked = `zero-size:${width}x${height}`
    this.canvas.dataset.engineLastResizeAttemptAt = String(Date.now())
  }

  markResized(width: number, height: number): void {
    this.canvas.dataset.engineResizeBlocked = ''
    this.canvas.dataset.engineClientSize = `${width}x${height}`
    this.canvas.dataset.engineBufferSize = `${this.canvas.width}x${this.canvas.height}`
    this.canvas.dataset.engineLastResizeAt = String(Date.now())
  }

  markRenderCompleted(stats: { calls: number; triangles: number; points: number; lines: number }): void {
    this.canvas.dataset.engineLastRenderAt = String(Date.now())
    this.canvas.dataset.engineLastRenderSize = `${this.canvas.width}x${this.canvas.height}`
    this.canvas.dataset.engineRenderCount = String(Number(this.canvas.dataset.engineRenderCount || 0) + 1)
    this.canvas.dataset.engineDrawCalls = String(stats.calls)
    this.canvas.dataset.engineTriangles = String(stats.triangles)
    this.canvas.dataset.enginePoints = String(stats.points)
    this.canvas.dataset.engineLines = String(stats.lines)
    delete this.canvas.dataset.engineLastRenderError
    delete this.canvas.dataset.engineLastRenderErrorAt
    window.dispatchEvent(new CustomEvent('engine-prometheus:first-render', {
      detail: {
        drawCalls: stats.calls,
        triangles: stats.triangles,
        points: stats.points,
        lines: stats.lines,
        canvasClientSize: `${this.canvas.clientWidth}x${this.canvas.clientHeight}`,
        canvasBufferSize: `${this.canvas.width}x${this.canvas.height}`,
      },
    }))
  }

  markRenderError(error: unknown): void {
    const message = this.describeError(error)
    this.canvas.dataset.engineLastRenderError = message
    this.canvas.dataset.engineLastRenderErrorAt = String(Date.now())
    window.dispatchEvent(new CustomEvent('engine-prometheus:render-error', {
      detail: { message },
    }))
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)
  }

  private readonly handleContextLost = (): void => {
    this.canvas.dataset.engineContextLost = 'true'
    this.canvas.dataset.engineContextLostAt = String(Date.now())
  }

  private readonly handleContextRestored = (): void => {
    this.canvas.dataset.engineContextLost = 'false'
    this.canvas.dataset.engineContextRestoredAt = String(Date.now())
    this.onContextRestored()
  }

  private describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.slice(0, 500) || 'erro sem mensagem'
  }
}
