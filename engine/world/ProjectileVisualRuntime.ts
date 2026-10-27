import * as THREE from 'three'

interface ActiveProjectile {
  remainingSeconds: number
  durationSeconds: number
  start: THREE.Vector3
  end: THREE.Vector3
  mesh: THREE.Group
  trail: THREE.Line
}

/** Reusable visual-only projectile renderer for any game module. */
export class ProjectileVisualRuntime {
  private readonly scene: THREE.Scene
  private readonly invalidate: () => void
  private readonly active = new Map<THREE.Group, ActiveProjectile>()

  constructor(scene: THREE.Scene, invalidate: () => void = () => {}) {
    this.scene = scene
    this.invalidate = invalidate
  }

  get activeCount(): number {
    return this.active.size
  }

  spawn(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    durationSeconds: number,
    options: { coreRadius?: number; haloRadius?: number; trailOpacity?: number } = {},
  ): void {
    const coreRadius = this.positive(options.coreRadius, 0.13)
    const haloRadius = Math.max(coreRadius, this.positive(options.haloRadius, 0.24))
    const trailOpacity = THREE.MathUtils.clamp(
      Number.isFinite(options.trailOpacity) ? options.trailOpacity! : 0.9,
      0,
      1,
    )
    const mesh = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(coreRadius, 12, 10),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(haloRadius, 10, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    mesh.add(halo, core)
    mesh.position.copy(start)
    mesh.renderOrder = 24
    this.scene.add(mesh)

    const trailGeometry = new THREE.BufferGeometry()
    const positions = new Float32Array(6)
    positions.set([start.x, start.y, start.z, start.x, start.y, start.z])
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const trailMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: trailOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const trail = new THREE.Line(trailGeometry, trailMaterial)
    trail.frustumCulled = false
    trail.renderOrder = 23
    this.scene.add(trail)

    const duration = Number.isFinite(durationSeconds) ? Math.max(0.05, durationSeconds) : 0.05
    this.active.set(mesh, {
      remainingSeconds: duration,
      durationSeconds: duration,
      start: start.clone(),
      end: end.clone(),
      mesh,
      trail,
    })
    this.invalidate()
  }

  update(deltaSeconds: number): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    if (delta === 0) return

    for (const [key, projectile] of this.active) {
      projectile.remainingSeconds -= delta
      const progress = THREE.MathUtils.clamp(
        1 - projectile.remainingSeconds / projectile.durationSeconds,
        0,
        1,
      )
      projectile.mesh.position.lerpVectors(projectile.start, projectile.end, progress)
      const positions = projectile.trail.geometry.getAttribute('position') as THREE.BufferAttribute
      positions.setXYZ(0, projectile.start.x, projectile.start.y, projectile.start.z)
      positions.setXYZ(
        1,
        projectile.mesh.position.x,
        projectile.mesh.position.y,
        projectile.mesh.position.z,
      )
      positions.needsUpdate = true

      const trailMaterial = projectile.trail.material
      if (!Array.isArray(trailMaterial)) trailMaterial.opacity = 0.9 * (1 - progress * 0.2)
      projectile.mesh.rotation.y += delta * 12
      projectile.mesh.scale.setScalar(0.9 + Math.sin(progress * Math.PI) * 0.3)
      if (projectile.remainingSeconds <= 0) this.remove(projectile)
      if (key !== projectile.mesh) this.active.delete(key)
    }
  }

  clear(): void {
    for (const projectile of this.active.values()) this.dispose(projectile)
    this.active.clear()
  }

  private remove(projectile: ActiveProjectile): void {
    this.dispose(projectile)
    this.active.delete(projectile.mesh)
  }

  private dispose(projectile: ActiveProjectile): void {
    this.scene.remove(projectile.mesh)
    projectile.mesh.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(material => material.dispose())
    })
    this.scene.remove(projectile.trail)
    projectile.trail.geometry.dispose()
    const materials = Array.isArray(projectile.trail.material)
      ? projectile.trail.material
      : [projectile.trail.material]
    materials.forEach(material => material.dispose())
  }

  private positive(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  }
}
