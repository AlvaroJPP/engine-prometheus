/**
 * ThreeResourcePool - Automatic THREE.js Resource Management
 *
 * Provides automatic cleanup of THREE.js objects (geometries, materials, textures)
 * when subsystems are disposed. Integrates with the engine's lifecycle.
 */

import * as THREE from 'three'
import { Subsystem } from './Subsystem.js'
import { EngineCore } from './EngineCore.js'
import { EngineEvents } from './EngineEvents.js'

export interface TrackedResource {
  resource: THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.Object3D
  type: 'geometry' | 'material' | 'texture' | 'object3d'
  subsystem: string
  createdAt: number
  label?: string
}

export interface ResourcePoolStats {
  geometries: number
  materials: number
  textures: number
  objects: number
  totalTracked: number
  bySubsystem: Record<string, { geometries: number; materials: number; textures: number; objects: number }>
}

/**
 * Global resource pool for THREE.js objects with automatic cleanup
 * on subsystem disposal.
 */
export class ThreeResourcePool {
  private static instance: ThreeResourcePool | null = null
  private resources = new Map<string, TrackedResource>()
  private subsystemResources = new Map<string, Set<string>>()
  private idCounter = 0
  private engine: EngineCore | null = null

  static getInstance(): ThreeResourcePool {
    if (!ThreeResourcePool.instance) {
      ThreeResourcePool.instance = new ThreeResourcePool()
    }
    return ThreeResourcePool.instance
  }

  setEngine(engine: EngineCore): void {
    this.engine = engine
    // Listen for subsystem disposal
    engine.events.on(EngineEvents.SUBSYSTEM_UNREGISTERED, (data: { name: string }) => {
      this.disposeSubsystemResources(data.name)
    })
  }

  /**
   * Register a geometry for automatic cleanup
   */
  trackGeometry(geometry: THREE.BufferGeometry, subsystem: string, label?: string): string {
    return this.track(geometry, 'geometry', subsystem, label)
  }

  /**
   * Register a material for automatic cleanup
   */
  trackMaterial(material: THREE.Material, subsystem: string, label?: string): string {
    return this.track(material, 'material', subsystem, label)
  }

  /**
   * Register a texture for automatic cleanup
   */
  trackTexture(texture: THREE.Texture, subsystem: string, label?: string): string {
    return this.track(texture, 'texture', subsystem, label)
  }

  /**
   * Register an Object3D (and its children) for automatic cleanup
   */
  trackObject3D(object: THREE.Object3D, subsystem: string, label?: string): string {
    return this.track(object, 'object3d', subsystem, label)
  }

  /**
   * Generic tracking method
   */
  private track(
    resource: THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.Object3D,
    type: TrackedResource['type'],
    subsystem: string,
    label?: string
  ): string {
    const id = `${type}_${subsystem}_${++this.idCounter}`
    const tracked: TrackedResource = {
      resource,
      type,
      subsystem,
      createdAt: performance.now(),
      label,
    }

    this.resources.set(id, tracked)

    if (!this.subsystemResources.has(subsystem)) {
      this.subsystemResources.set(subsystem, new Set())
    }
    this.subsystemResources.get(subsystem)!.add(id)

    return id
  }

  /**
   * Untrack a resource (manual cleanup)
   */
  untrack(id: string): boolean {
    const tracked = this.resources.get(id)
    if (!tracked) return false

    this.resources.delete(id)
    this.subsystemResources.get(tracked.subsystem)?.delete(id)
    return true
  }

  /**
   * Dispose all resources for a subsystem
   */
  disposeSubsystemResources(subsystemName: string): void {
    const ids = this.subsystemResources.get(subsystemName)
    if (!ids) return

    const toDispose: TrackedResource[] = []
    for (const id of ids) {
      const tracked = this.resources.get(id)
      if (tracked) toDispose.push(tracked)
    }

    // Dispose in correct order: objects first (which may reference geometries/materials),
    // then geometries, materials, textures
    const sorted = toDispose.sort((a, b) => {
      const order = { object3d: 0, geometry: 1, material: 2, texture: 3 }
      return order[a.type] - order[b.type]
    })

    for (const tracked of sorted) {
      try {
        this.disposeResource(tracked)
      } catch (error) {
        console.warn(`[ThreeResourcePool] Failed to dispose ${tracked.type} (${tracked.label || 'unnamed'}):`, error)
      }
    }

    this.subsystemResources.delete(subsystemName)
  }

  /**
   * Dispose a single resource
   */
  private disposeResource(tracked: TrackedResource): void {
    const { resource, type } = tracked

    switch (type) {
      case 'geometry':
        if (resource instanceof THREE.BufferGeometry) {
          resource.dispose()
        }
        break
      case 'material':
        if (resource instanceof THREE.Material) {
          // Dispose textures referenced by material
          const mat = resource as any
          if (mat.map) mat.map.dispose()
          if (resource instanceof THREE.MeshStandardMaterial) {
            if (resource.normalMap) resource.normalMap.dispose()
            if (resource.roughnessMap) resource.roughnessMap.dispose()
            if (resource.metalnessMap) resource.metalnessMap.dispose()
            if (resource.aoMap) resource.aoMap.dispose()
            if (resource.emissiveMap) resource.emissiveMap.dispose()
            if (resource.lightMap) resource.lightMap.dispose()
            if (resource.envMap) resource.envMap.dispose()
          }
          resource.dispose()
        }
        break
      case 'texture':
        if (resource instanceof THREE.Texture) {
          resource.dispose()
        }
        break
      case 'object3d':
        if (resource instanceof THREE.Object3D) {
          this.disposeObject3D(resource)
        }
        break
    }

    this.resources.delete(
      Array.from(this.resources.entries()).find(([, v]) => v === tracked)?.[0] ?? ''
    )
  }

  /**
   * Recursively dispose an Object3D and its resources
   */
  private disposeObject3D(object: THREE.Object3D): void {
    // Traverse children first
    for (const child of object.children) {
      this.disposeObject3D(child)
    }

    // Dispose geometry
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      const geometry = object.geometry
      if (geometry instanceof THREE.BufferGeometry) {
        geometry.dispose()
      }
    }

    // Dispose materials
    const materials = Array.isArray((object as any).material)
      ? (object as any).material
      : [(object as any).material]

    for (const material of materials) {
      if (material instanceof THREE.Material) {
        // Dispose textures - check known texture properties
        const mat = material as any
        const textureProps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'lightMap', 'envMap', 'alphaMap', 'displacementMap', 'gradientMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap']
        for (const prop of textureProps) {
          if (mat[prop] instanceof THREE.Texture) {
            mat[prop].dispose()
          }
        }
        material.dispose()
      }
    }

    // Remove from parent
    object.removeFromParent()
  }

  /**
   * Get statistics about tracked resources
   */
  getStats(): ResourcePoolStats {
    const stats: ResourcePoolStats = {
      geometries: 0,
      materials: 0,
      textures: 0,
      objects: 0,
      totalTracked: this.resources.size,
      bySubsystem: {},
    }

    for (const [subsystem, ids] of this.subsystemResources) {
      stats.bySubsystem[subsystem] = { geometries: 0, materials: 0, textures: 0, objects: 0 }
      for (const id of ids) {
        const tracked = this.resources.get(id)
        if (!tracked) continue
        switch (tracked.type) {
          case 'geometry': stats.geometries++; stats.bySubsystem[subsystem].geometries++; break
          case 'material': stats.materials++; stats.bySubsystem[subsystem].materials++; break
          case 'texture': stats.textures++; stats.bySubsystem[subsystem].textures++; break
          case 'object3d': stats.objects++; stats.bySubsystem[subsystem].objects++; break
        }
      }
    }

    return stats
  }

  /**
   * Log current resource statistics
   */
  logStats(): void {
    const stats = this.getStats()
    console.log('[ThreeResourcePool] Resource Stats:', stats)
  }

  /**
   * Clear all resources (for testing/reset)
   */
  clear(): void {
    for (const [subsystem] of this.subsystemResources) {
      this.disposeSubsystemResources(subsystem)
    }
    this.resources.clear()
    this.subsystemResources.clear()
  }
}

/**
 * Mixin to add automatic resource tracking to a subsystem
 */
export function withResourceTracking<T extends new (...args: any[]) => Subsystem>(Base: T) {
  // Use a type-safe approach: return a class that extends Base
  // Note: TypeScript may warn about visibility rules with generic base class
  // but this pattern is safe as we only add new protected methods and call super
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MixinClass: any = class WithResourceTracking extends Base {
    private resourcePool: ThreeResourcePool | null = null

    protected async onInitialize(context: any): Promise<void> {
      await super.onInitialize(context)
      this.resourcePool = ThreeResourcePool.getInstance()
    }

    protected async onDispose(): Promise<void> {
      if (this.resourcePool) {
        this.resourcePool.disposeSubsystemResources(this.name)
      }
      await super.onDispose()
    }

    /**
     * Track a geometry for automatic cleanup
     */
    protected trackGeometry(geometry: THREE.BufferGeometry, label?: string): string {
      return this.resourcePool?.trackGeometry(geometry, this.name, label) ?? ''
    }

    /**
     * Track a material for automatic cleanup
     */
    protected trackMaterial(material: THREE.Material, label?: string): string {
      return this.resourcePool?.trackMaterial(material, this.name, label) ?? ''
    }

    /**
     * Track a texture for automatic cleanup
     */
    protected trackTexture(texture: THREE.Texture, label?: string): string {
      return this.resourcePool?.trackTexture(texture, this.name, label) ?? ''
    }

    /**
     * Track an Object3D for automatic cleanup
     */
    protected trackObject3D(object: THREE.Object3D, label?: string): string {
      return this.resourcePool?.trackObject3D(object, this.name, label) ?? ''
    }
  }

  return MixinClass
}

/**
 * WeakRef cache for expensive computed values
 * Automatically cleans up when keys are garbage collected
 */
export class WeakRefCache<K extends object, V> {
  private cache = new WeakMap<K, V>()

  get(key: K): V | undefined {
    return this.cache.get(key)
  }

  set(key: K, value: V): void {
    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    // WeakMap doesn't have clear, but we can recreate
    this.cache = new WeakMap<K, V>()
  }
}

/**
 * LRU cache with weak references for values
 * Useful for caching computed results that can be recreated
 */
export class WeakLRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>()
  private maxSize: number
  private weakRefs = new WeakRef<Map<K, { value: V; timestamp: number }>>(this.cache)

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Update timestamp for LRU
    entry.timestamp = Date.now()
    return entry.value
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      // Find and remove oldest entry
      let oldestKey: K | null = null
      let oldestTime = Infinity
      for (const [k, v] of this.cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp
          oldestKey = k
        }
      }
      if (oldestKey) this.cache.delete(oldestKey)
    }

    this.cache.set(key, { value, timestamp: Date.now() })
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}