/**
 * FrameBudget - Frame time budget tracking and adaptive quality management
 * Separates fixedUpdate (physics) from update (render) cleanly
 */

export interface FrameBudgetConfig {
  /** Target frame time in ms (e.g., 16.67 for 60fps) */
  targetFrameMs: number
  /** Maximum frame time before quality reduction */
  maxFrameMs: number
  /** Minimum frame time for quality increase */
  minFrameMs: number
  /** History window for averaging */
  historySize: number
  /** Cooldown between quality changes (ms) */
  qualityChangeCooldownMs: number
}

export const DEFAULT_FRAME_BUDGET_CONFIG: FrameBudgetConfig = {
  targetFrameMs: 16.67, // 60 FPS
  maxFrameMs: 33.33,    // 30 FPS
  minFrameMs: 12.5,     // 80 FPS
  historySize: 60,
  qualityChangeCooldownMs: 2000,
}

export type QualityLevel = 'ultra' | 'high' | 'medium' | 'low' | 'minimum'

export interface QualitySettings {
  /** Render resolution scale (0.5 - 1.5) */
  resolutionScale: number
  /** Shadow map resolution */
  shadowMapSize: number
  /** Enable post-processing */
  postProcessing: boolean
  /** Grass render distance multiplier */
  grassDistanceScale: number
  /** Model LOD bias */
  lodBias: number
  /** Particle count multiplier */
  particleScale: number
  /** Physics substeps */
  physicsSubsteps: number
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  ultra: {
    resolutionScale: 1.0,
    shadowMapSize: 2048,
    postProcessing: true,
    grassDistanceScale: 1.0,
    lodBias: 0,
    particleScale: 1.0,
    physicsSubsteps: 4,
  },
  high: {
    resolutionScale: 1.0,
    shadowMapSize: 1024,
    postProcessing: true,
    grassDistanceScale: 0.9,
    lodBias: 0.5,
    particleScale: 0.8,
    physicsSubsteps: 3,
  },
  medium: {
    resolutionScale: 0.85,
    shadowMapSize: 1024,
    postProcessing: false,
    grassDistanceScale: 0.75,
    lodBias: 1,
    particleScale: 0.6,
    physicsSubsteps: 2,
  },
  low: {
    resolutionScale: 0.7,
    shadowMapSize: 512,
    postProcessing: false,
    grassDistanceScale: 0.5,
    lodBias: 1.5,
    particleScale: 0.4,
    physicsSubsteps: 1,
  },
  minimum: {
    resolutionScale: 0.5,
    shadowMapSize: 256,
    postProcessing: false,
    grassDistanceScale: 0.3,
    lodBias: 2,
    particleScale: 0.2,
    physicsSubsteps: 1,
  },
}

export interface FrameTiming {
  totalMs: number
  updateMs: number
  renderMs: number
  fixedUpdateMs: number
  timestamp: number
}

/** Fixed timestep accumulator for physics */
export class FixedTimestepAccumulator {
  private accumulator = 0
  private readonly fixedTimestep: number
  private readonly maxSubsteps: number
  private readonly substeps: number

  constructor(fixedTimestep = 1 / 60, maxSubsteps = 10) {
    this.fixedTimestep = fixedTimestep
    this.maxSubsteps = maxSubsteps
    this.substeps = Math.floor(1 / fixedTimestep)
  }

  /** Add delta time and return number of fixed steps to run */
  add(deltaTime: number): number {
    this.accumulator += deltaTime
    const steps = Math.min(
      Math.floor(this.accumulator / this.fixedTimestep),
      this.maxSubsteps
    )
    this.accumulator -= steps * this.fixedTimestep
    // Prevent spiral of death
    if (this.accumulator > this.fixedTimestep * this.maxSubsteps) {
      this.accumulator = this.fixedTimestep * this.maxSubsteps
    }
    return steps
  }

  /** Get remaining accumulator time */
  getRemainder(): number {
    return this.accumulator
  }

  /** Get fixed timestep */
  getTimestep(): number {
    return this.fixedTimestep
  }

  /** Reset accumulator */
  reset(): void {
    this.accumulator = 0
  }
}

/** Frame budget tracker with adaptive quality */
export class FrameBudget {
  private readonly config: FrameBudgetConfig
  private readonly history: FrameTiming[] = []
  private currentQuality: QualityLevel = 'high'
  private lastQualityChange = 0
  private readonly listeners = new Set<(quality: QualityLevel, settings: QualitySettings) => void>()
  private readonly fixedTimestep: FixedTimestepAccumulator
  private updateStartTime = 0
  private renderStartTime = 0
  private frameStartTime = 0
  private lastFrameTime = 0

  constructor(config: Partial<FrameBudgetConfig> = {}) {
    this.config = { ...DEFAULT_FRAME_BUDGET_CONFIG, ...config }
    this.fixedTimestep = new FixedTimestepAccumulator(1 / 60, 10)
  }

  /** Start frame timing */
  frameStart(): void {
    this.frameStartTime = performance.now()
  }

  /** Mark update phase start */
  updateStart(): void {
    this.updateStartTime = performance.now()
  }

  /** Mark update phase end, render phase start */
  updateEnd(): void {
    this.renderStartTime = performance.now()
  }

  /** End frame and calculate timings */
  frameEnd(): FrameTiming {
    const now = performance.now()
    const totalMs = now - this.frameStartTime
    const updateMs = this.renderStartTime - this.updateStartTime
    const renderMs = now - this.renderStartTime
    const fixedUpdateMs = this.fixedTimestep.getTimestep() * 1000 // Approximate

    const timing: FrameTiming = {
      totalMs,
      updateMs,
      renderMs,
      fixedUpdateMs,
      timestamp: now,
    }

    this.history.push(timing)
    if (this.history.length > this.config.historySize) {
      this.history.shift()
    }

    this.lastFrameTime = now
    this.evaluateQuality()

    return timing
  }

  /** Get fixed timestep accumulator */
  getFixedTimestep(): FixedTimestepAccumulator {
    return this.fixedTimestep
  }

  /** Add delta time to fixed timestep accumulator */
  accumulateFixedTimestep(deltaTime: number): number {
    return this.fixedTimestep.add(deltaTime)
  }

  /** Get current quality level */
  getQuality(): QualityLevel {
    return this.currentQuality
  }

  /** Get current quality settings */
  getQualitySettings(): QualitySettings {
    return QUALITY_PRESETS[this.currentQuality]
  }

  /** Set quality level manually */
  setQuality(level: QualityLevel): void {
    if (this.currentQuality !== level) {
      this.currentQuality = level
      this.lastQualityChange = performance.now()
      this.notifyListeners()
    }
  }

  /** Subscribe to quality changes */
  onQualityChange(listener: (quality: QualityLevel, settings: QualitySettings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Get average frame time over history */
  getAverageFrameMs(): number {
    if (this.history.length === 0) return this.config.targetFrameMs
    const sum = this.history.reduce((acc, t) => acc + t.totalMs, 0)
    return sum / this.history.length
  }

  /** Get average update time */
  getAverageUpdateMs(): number {
    if (this.history.length === 0) return 0
    const sum = this.history.reduce((acc, t) => acc + t.updateMs, 0)
    return sum / this.history.length
  }

  /** Get average render time */
  getAverageRenderMs(): number {
    if (this.history.length === 0) return 0
    const sum = this.history.reduce((acc, t) => acc + t.renderMs, 0)
    return sum / this.history.length
  }

  /** Get frame time history */
  getHistory(): readonly FrameTiming[] {
    return this.history
  }

  /** Check if we're over budget */
  isOverBudget(): boolean {
    return this.getAverageFrameMs() > this.config.maxFrameMs
  }

  /** Check if we have headroom for quality increase */
  hasHeadroom(): boolean {
    return this.getAverageFrameMs() < this.config.minFrameMs
  }

  /** Get budget status */
  getStatus(): { status: 'over' | 'under' | 'ok'; averageMs: number; targetMs: number } {
    const avg = this.getAverageFrameMs()
    if (avg > this.config.maxFrameMs) return { status: 'over', averageMs: avg, targetMs: this.config.targetFrameMs }
    if (avg < this.config.minFrameMs) return { status: 'under', averageMs: avg, targetMs: this.config.targetFrameMs }
    return { status: 'ok', averageMs: avg, targetMs: this.config.targetFrameMs }
  }

  /** Reset history */
  reset(): void {
    this.history.length = 0
    this.fixedTimestep.reset()
  }

  private evaluateQuality(): void {
    const now = performance.now()
    if (now - this.lastQualityChange < this.config.qualityChangeCooldownMs) return

    const status = this.getStatus()
    const levels: QualityLevel[] = ['ultra', 'high', 'medium', 'low', 'minimum']
    const currentIndex = levels.indexOf(this.currentQuality)

    if (status.status === 'over' && currentIndex < levels.length - 1) {
      // Reduce quality
      this.currentQuality = levels[currentIndex + 1]
      this.lastQualityChange = now
      this.notifyListeners()
    } else if (status.status === 'under' && currentIndex > 0) {
      // Increase quality
      this.currentQuality = levels[currentIndex - 1]
      this.lastQualityChange = now
      this.notifyListeners()
    }
  }

  private notifyListeners(): void {
    const settings = this.getQualitySettings()
    for (const listener of this.listeners) {
      try {
        listener(this.currentQuality, settings)
      } catch (error) {
        console.warn('[FrameBudget] Quality change listener error:', error)
      }
    }
  }
}

/** Global frame budget instance */
export const globalFrameBudget = new FrameBudget()

/** Integration helper for EngineCore fixedUpdate separation */
export function createFixedUpdateLoop(
  budget: FrameBudget,
  fixedUpdateFn: (dt: number) => void,
  updateFn: (dt: number) => void,
  renderFn: (dt: number) => void
): (deltaTime: number) => void {
  return (deltaTime: number) => {
    budget.frameStart()

    // Fixed timestep updates (physics)
    budget.updateStart()
    const steps = budget.accumulateFixedTimestep(deltaTime)
    const fixedDt = budget.getFixedTimestep().getTimestep()
    for (let i = 0; i < steps; i++) {
      fixedUpdateFn(fixedDt)
    }
    budget.updateEnd()

    // Variable timestep updates (game logic, animation)
    updateFn(deltaTime)

    // Render
    renderFn(deltaTime)

    budget.frameEnd()
  }
}

/** Adapter for EngineCore to use FrameBudget */
export function createFrameBudgetedUpdateHandler(
  budget: FrameBudget,
  originalUpdate: (dt: number, time: number) => Promise<void>
): (dt: number, time: number) => Promise<void> {
  return async (dt: number, time: number) => {
    budget.frameStart()
    budget.updateStart()

    // Run fixed timestep updates
    const steps = budget.accumulateFixedTimestep(dt)
    const fixedDt = budget.getFixedTimestep().getTimestep()
    // Note: EngineCore handles fixedUpdate internally, this is for reference

    budget.updateEnd()

    // Run variable timestep update
    await originalUpdate(dt, time)

    budget.frameEnd()
  }
}