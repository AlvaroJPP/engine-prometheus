/**
 * Instrumentação do canvas separada do ciclo de renderização.
 *
 * Este módulo não altera layout nem decide quando renderizar. Ele registra
 * dimensões, contagem de quadros, falhas de contexto e erros para que o painel
 * de diagnóstico possa distinguir um canvas sem tamanho de um WebGL sem quadros.
 */
export class ViewportDiagnostics {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onContextRestored: () => void,
  ) {
    this.canvas.dataset.engineWebglReady = 'initializing'
    this.canvas.dataset.engineContextLost = 'false'
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored)
  }

  markWebglReady(): void {
    this.canvas.dataset.engineWebglReady = 'true'
    delete this.canvas.dataset.engineWebglError
  }

  markWebglInitializationError(error: unknown): void {
    this.canvas.dataset.engineWebglReady = 'false'
    this.canvas.dataset.engineWebglError = this.describeError(error)
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

  markRenderCompleted(): void {
    this.canvas.dataset.engineLastRenderAt = String(Date.now())
    this.canvas.dataset.engineLastRenderSize = `${this.canvas.width}x${this.canvas.height}`
    this.canvas.dataset.engineRenderCount = String(Number(this.canvas.dataset.engineRenderCount || 0) + 1)
    delete this.canvas.dataset.engineLastRenderError
    delete this.canvas.dataset.engineLastRenderErrorAt
  }

  markRenderError(error: unknown): void {
    this.canvas.dataset.engineLastRenderError = this.describeError(error)
    this.canvas.dataset.engineLastRenderErrorAt = String(Date.now())
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
