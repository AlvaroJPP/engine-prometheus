/**
 * Memory Profiling Utilities
 *
 * Provides heap snapshot, allocation tracking, and memory leak detection
 * for THREE.js objects and engine subsystems.
 */

export interface MemorySnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  // THREE.js specific
  geometries: number
  materials: number
  textures: number
  renderCalls: number
  triangles: number
  // Custom
  subsystemMemory: Map<string, number>
}

export interface AllocationTracker {
  id: string
  type: 'geometry' | 'material' | 'texture' | 'mesh' | 'object3d' | 'other'
  size: number
  timestamp: number
  stack?: string
}

export interface DisposableTracker {
  resource: unknown
  type: string
  disposed: boolean
  disposeTime?: number
  createdAt: number
  stack?: string
}

/**
 * Global memory profiler for tracking allocations and leaks
 */
export class MemoryProfiler {
  private static instance: MemoryProfiler | null = null
  private snapshots: MemorySnapshot[] = []
  private allocations: AllocationTracker[] = []
  private disposables: Map<object, DisposableTracker> = new Map()
  private tracking = false
  private maxSnapshots = 100
  private maxAllocations = 10000
  private renderer: THREE.WebGLRenderer | null = null

  static getInstance(): MemoryProfiler {
    if (!MemoryProfiler.instance) {
      MemoryProfiler.instance = new MemoryProfiler()
    }
    return MemoryProfiler.instance
  }

  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer
  }

  startTracking(): void {
    this.tracking = true
    this.snapshots = []
    this.allocations = []
    this.disposables.clear()
  }

  stopTracking(): void {
    this.tracking = false
  }

  /**
   * Take a memory snapshot
   */
  takeSnapshot(label?: string): MemorySnapshot {
    if (!this.tracking) return this.createSnapshot()

    const mem = (performance as any).memory
    const heapUsed = mem?.usedJSHeapSize ?? 0
    const heapTotal = mem?.totalJSHeapSize ?? 0
    const external = (performance as any).memory?.externalMemory ?? 0

    const rendererInfo = this.renderer?.info
    const geometries = rendererInfo?.memory?.geometries ?? 0
    const textures = rendererInfo?.memory?.textures ?? 0
    // THREE.WebGLRenderer.info.memory doesn't expose materials count
    const materials = 0
    const renderCalls = rendererInfo?.render?.calls ?? 0
    const triangles = rendererInfo?.render?.triangles ?? 0

    const snapshot: MemorySnapshot = {
      timestamp: performance.now(),
      heapUsed,
      heapTotal,
      external,
      arrayBuffers: 0, // Not directly available
      geometries,
      materials,
      textures,
      renderCalls,
      triangles,
      subsystemMemory: new Map(),
    }

    this.snapshots.push(snapshot)
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift()
    }

    return snapshot
  }

  private createSnapshot(): MemorySnapshot {
    const mem = (performance as any).memory
    const rendererInfo = this.renderer?.info

    return {
      timestamp: performance.now(),
      heapUsed: mem?.usedJSHeapSize ?? 0,
      heapTotal: mem?.totalJSHeapSize ?? 0,
      external: (performance as any).memory?.externalMemory ?? 0,
      arrayBuffers: 0,
      geometries: rendererInfo?.memory?.geometries ?? 0,
      // THREE.WebGLRenderer.info.memory doesn't expose materials count
      materials: 0,
      textures: rendererInfo?.memory?.textures ?? 0,
      renderCalls: rendererInfo?.render?.calls ?? 0,
      triangles: rendererInfo?.render?.triangles ?? 0,
      subsystemMemory: new Map(),
    }
  }

  /**
   * Track a THREE.js object allocation
   */
  trackAllocation(
    type: AllocationTracker['type'],
    size: number,
    object?: object
  ): void {
    if (!this.tracking) return

    const tracker: AllocationTracker = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type,
      size,
      timestamp: performance.now(),
      stack: new Error().stack,
    }

    this.allocations.push(tracker)
    if (this.allocations.length > this.maxAllocations) {
      this.allocations.shift()
    }

    // Also track disposable for leak detection
    if (object) {
      this.trackDisposable(object, type)
    }
  }

  /**
   * Track a disposable resource for leak detection
   */
  trackDisposable(resource: object, type: string): void {
    if (this.disposables.has(resource)) return

    this.disposables.set(resource, {
      resource,
      type,
      disposed: false,
      createdAt: performance.now(),
      stack: new Error().stack,
    })
  }

  /**
   * Mark a resource as disposed
   */
  markDisposed(resource: object): void {
    const tracker = this.disposables.get(resource)
    if (tracker) {
      tracker.disposed = true
      tracker.disposeTime = performance.now()
      // Do not retain disposed Three.js objects: keeping them here prevents GC.
      this.disposables.delete(resource)
    }
  }

  /**
   * Get all undisposed resources (potential leaks)
   */
  getUndisposedResources(): DisposableTracker[] {
    const leaks: DisposableTracker[] = []
    for (const tracker of this.disposables.values()) {
      if (!tracker.disposed) {
        leaks.push(tracker)
      }
    }
    return leaks
  }

  /**
   * Get memory delta between two snapshots
   */
  getMemoryDelta(fromIndex: number, toIndex: number): Partial<MemorySnapshot> | null {
    if (fromIndex < 0 || toIndex >= this.snapshots.length || fromIndex >= toIndex) {
      return null
    }

    const from = this.snapshots[fromIndex]
    const to = this.snapshots[toIndex]

    return {
      heapUsed: to.heapUsed - from.heapUsed,
      heapTotal: to.heapTotal - from.heapTotal,
      external: to.external - from.external,
      geometries: to.geometries - from.geometries,
      materials: to.materials - from.materials,
      textures: to.textures - from.textures,
      renderCalls: to.renderCalls - from.renderCalls,
      triangles: to.triangles - from.triangles,
    }
  }

  /**
   * Get allocation statistics
   */
  getAllocationStats(): {
    total: number
    byType: Record<string, { count: number; totalSize: number }>
    recentLeaks: DisposableTracker[]
  } {
    const byType: Record<string, { count: number; totalSize: number }> = {}

    for (const alloc of this.allocations) {
      if (!byType[alloc.type]) {
        byType[alloc.type] = { count: 0, totalSize: 0 }
      }
      byType[alloc.type].count++
      byType[alloc.type].totalSize += alloc.size
    }

    return {
      total: this.allocations.length,
      byType,
      recentLeaks: this.getUndisposedResources().slice(-10),
    }
  }

  /**
   * Generate a memory report
   */
  generateReport(): string {
    const latest = this.snapshots[this.snapshots.length - 1] || this.createSnapshot()
    const stats = this.getAllocationStats()
    const leaks = this.getUndisposedResources()

    let report = '=== Memory Profile Report ===\n'
    report += `Timestamp: ${new Date().toISOString()}\n`
    report += `Heap Used: ${(latest.heapUsed / 1024 / 1024).toFixed(2)} MB\n`
    report += `Heap Total: ${(latest.heapTotal / 1024 / 1024).toFixed(2)} MB\n`
    report += `External: ${(latest.external / 1024 / 1024).toFixed(2)} MB\n`
    report += `THREE Geometries: ${latest.geometries}\n`
    report += `THREE Materials: ${latest.materials}\n`
    report += `THREE Textures: ${latest.textures}\n`
    report += `Render Calls: ${latest.renderCalls}\n`
    report += `Triangles: ${latest.triangles.toLocaleString()}\n`
    report += `\nAllocation Stats:\n`
    report += `  Total Tracked: ${stats.total}\n`

    for (const [type, data] of Object.entries(stats.byType)) {
      report += `  ${type}: ${data.count} allocations, ${(data.totalSize / 1024).toFixed(2)} KB\n`
    }

    report += `\nPotential Leaks (undisposed): ${leaks.length}\n`
    for (const leak of leaks.slice(0, 10)) {
      report += `  [${leak.type}] Created: ${leak.createdAt.toFixed(0)}ms ago\n`
    }

    return report
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.snapshots = []
    this.allocations = []
    this.disposables.clear()
  }

  /**
   * Export snapshots for external analysis
   */
  exportSnapshots(): MemorySnapshot[] {
    return [...this.snapshots]
  }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).__MEMORY_PROFILER__ = MemoryProfiler.getInstance()
}

// Import THREE for type references
import * as THREE from 'three'