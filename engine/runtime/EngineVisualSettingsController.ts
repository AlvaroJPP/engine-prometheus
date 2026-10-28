import type { GrassRenderOptions } from '../world/map/GrassLayer'
import type { World } from '../world/World'
import type { ModelLodSystem } from '../world/ModelLodSystem'
import type { Viewport, ViewportRenderStats } from '../view/Viewport'

export type RenderOptions = {
  resolutionScale?: number | null
  fpsLimit?: number | null
  dynamicResolution?: boolean
  dynamicResolutionTargetFps?: number
  dynamicResolutionMinScale?: number
}

/** Coordinates rendering, LOD, fog and vegetation settings behind a small generic API. */
export class EngineVisualSettingsController {
  private readonly viewport: Viewport
  private readonly world: World
  private readonly modelLod: ModelLodSystem

  constructor(viewport: Viewport, world: World, modelLod: ModelLodSystem) {
    this.viewport = viewport
    this.world = world
    this.modelLod = modelLod
  }

  setFpsListener(listener: ((fps: number) => void) | null): void {
    this.viewport.setFpsListener(listener)
  }

  setRenderStatsListener(listener: ((stats: ViewportRenderStats) => void) | null): void {
    this.viewport.setRenderStatsListener(listener)
  }

  setPerformancePreset(preset: 'quality' | 'balanced' | 'economy'): void {
    this.viewport.setPerformancePreset(preset)
    this.modelLod.setPreset(preset)
    this.world.terrain.grass.setPerformancePreset(preset)
    this.viewport.invalidate()
  }

  setRenderOptions(options: RenderOptions): void {
    this.viewport.setRenderOptions(options)
  }

  setGrassRenderOptions(options: GrassRenderOptions): void {
    this.world.terrain.grass.setRenderOptions(options)
    this.viewport.invalidate()
  }

  setFogEnabled(enabled: boolean): void {
    this.world.setFogEnabled(enabled)
    this.viewport.invalidate()
  }

  setFogDistanceScale(scale: number): void {
    this.world.setFogDistanceScale(scale)
    this.viewport.invalidate()
  }

  setPerformanceMode(enabled: boolean): void {
    const preset = enabled ? 'economy' : 'quality'
    this.viewport.setPerformanceMode(enabled)
    this.modelLod.setPreset(preset)
    this.world.terrain.grass.setPerformancePreset(preset)
    this.viewport.invalidate()
  }
}
