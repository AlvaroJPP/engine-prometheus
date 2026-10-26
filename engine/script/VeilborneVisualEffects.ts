import * as THREE from 'three'

interface TimedVisual {
  remaining: number
  duration: number
}

interface TimedDamageNumber extends TimedVisual {
  rise: number
}

interface TimedProjectile extends TimedVisual {
  start: THREE.Vector3
  end: THREE.Vector3
}

/**
 * Gerencia efeitos visuais temporários do combate sem acoplar suas geometrias
 * e temporizadores ao controlador principal do Engine.
 */
export class VeilborneVisualEffects {
  private readonly effects = new Map<THREE.Mesh, TimedVisual>()
  private readonly damageNumbers = new Map<THREE.Sprite, TimedDamageNumber>()
  private readonly projectiles = new Map<THREE.Group, TimedProjectile>()
  private readonly scene: THREE.Scene
  private readonly invalidate: () => void

  constructor(scene: THREE.Scene, invalidate: () => void) {
    this.scene = scene
    this.invalidate = invalidate
  }

  spawnProjectile(start: THREE.Vector3, end: THREE.Vector3, color: number, duration: number): void {
    const projectile = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    projectile.add(halo, core)
    projectile.position.copy(start)
    projectile.renderOrder = 24
    this.scene.add(projectile)
    const safeDuration = Math.max(0.05, duration)
    this.projectiles.set(projectile, {
      remaining: safeDuration,
      duration: safeDuration,
      start: start.clone(),
      end: end.clone(),
    })
    this.invalidate()
  }

  spawnEffect(
    position: THREE.Vector3,
    color: number,
    scale: number,
    duration = 0.32,
    slash = false,
  ): void {
    const geometry = slash
      ? new THREE.TorusGeometry(Math.max(0.2, scale), 0.045, 5, 20, Math.PI * 1.35)
      : new THREE.SphereGeometry(Math.max(0.06, scale), 12, 10)
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const effect = new THREE.Mesh(geometry, material)
    effect.position.copy(position)
    effect.rotation.x = slash ? Math.PI / 2 : 0
    effect.renderOrder = 20
    this.scene.add(effect)
    this.effects.set(effect, { remaining: duration, duration })
  }

  spawnDamageNumber(position: THREE.Vector3, amount: number, killed = false): void {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const context = canvas.getContext('2d')
    if (!context) return
    context.font = `bold ${killed ? 58 : 52}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineWidth = 10
    context.strokeStyle = 'rgba(25, 5, 10, 0.9)'
    context.strokeText(String(Math.round(amount)), 128, 64)
    context.fillStyle = killed ? '#ffd58b' : '#ff596b'
    context.fillText(String(Math.round(amount)), 128, 64)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
    const sprite = new THREE.Sprite(material)
    sprite.position.copy(position).add(new THREE.Vector3(0, 0.5, 0))
    sprite.scale.set(killed ? 1.25 : 0.95, killed ? 0.62 : 0.48, 1)
    sprite.renderOrder = 30
    this.scene.add(sprite)
    this.damageNumbers.set(sprite, { remaining: 1.05, duration: 1.05, rise: 0.9 })
  }

  clear(): void {
    for (const [projectile] of this.projectiles) {
      this.scene.remove(projectile)
      this.disposeGroup(projectile)
    }
    this.projectiles.clear()

    for (const [sprite] of this.damageNumbers) {
      this.scene.remove(sprite)
      sprite.material.map?.dispose()
      sprite.material.dispose()
    }
    this.damageNumbers.clear()

    for (const [effect] of this.effects) {
      this.scene.remove(effect)
      effect.geometry.dispose()
      const material = effect.material
      if (Array.isArray(material)) material.forEach(item => item.dispose())
      else material.dispose()
    }
    this.effects.clear()
  }

  update(dt: number): void {
    const delta = Math.max(0, Number.isFinite(dt) ? dt : 0)

    for (const [projectile, state] of this.projectiles) {
      state.remaining -= delta
      const progress = THREE.MathUtils.clamp(1 - state.remaining / state.duration, 0, 1)
      projectile.position.lerpVectors(state.start, state.end, progress)
      projectile.rotation.y += delta * 12
      projectile.scale.setScalar(0.9 + Math.sin(progress * Math.PI) * 0.3)
      if (state.remaining <= 0) {
        this.scene.remove(projectile)
        this.disposeGroup(projectile)
        this.projectiles.delete(projectile)
      }
    }

    for (const [sprite, state] of this.damageNumbers) {
      state.remaining -= delta
      const progress = Math.min(1, Math.max(0, 1 - state.remaining / state.duration))
      sprite.position.y += delta * state.rise
      sprite.material.opacity = Math.max(0, 1 - progress * progress)
      if (state.remaining <= 0) {
        this.scene.remove(sprite)
        sprite.material.map?.dispose()
        sprite.material.dispose()
        this.damageNumbers.delete(sprite)
      }
    }

    for (const [effect, state] of this.effects) {
      state.remaining -= delta
      const progress = Math.min(1, Math.max(0, 1 - state.remaining / state.duration))
      const material = effect.material
      if (!Array.isArray(material) && material instanceof THREE.MeshBasicMaterial) {
        material.opacity = 0.82 * (1 - progress)
      }
      effect.scale.setScalar(1 + progress * 1.25)
      if (state.remaining <= 0) {
        this.scene.remove(effect)
        effect.geometry.dispose()
        if (Array.isArray(material)) material.forEach(item => item.dispose())
        else material.dispose()
        this.effects.delete(effect)
      }
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(material => material.dispose())
    })
  }
}
