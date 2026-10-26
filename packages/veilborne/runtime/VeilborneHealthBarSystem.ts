import * as THREE from 'three'
import type { World } from '../../../engine/world/World'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'

interface HealthBarEntry {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  vitality: number
  maximum: number
}

type HealthBarTarget = {
  instance: BehaviorPackageInstance
  object: NonNullable<ReturnType<World['get']>>
}

/** Cria, atualiza e libera as barras de vida das entidades hostis do VEILBORNE. */
export class VeilborneHealthBarSystem {
  private readonly entries = new Map<string, HealthBarEntry>()
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  update(hostiles: readonly HealthBarTarget[]): void {
    const activeIds = new Set<string>()
    for (const { instance, object } of hostiles) {
      activeIds.add(object.id)
      const vitality = Math.max(0, Number(instance.variables.vida ?? 100))
      const maximum = Math.max(1, Number(instance.variables.vida_max ?? 100))
      let entry = this.entries.get(object.id)
      if (!entry) {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 48
        const context = canvas.getContext('2d')
        if (!context) continue
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        })
        const sprite = new THREE.Sprite(material)
        sprite.scale.set(1.15, 0.22, 1)
        sprite.renderOrder = 25
        this.scene.add(sprite)
        entry = {
          sprite,
          canvas,
          context,
          texture,
          vitality: Number.NaN,
          maximum: Number.NaN,
        }
        this.entries.set(object.id, entry)
      }

      const worldPosition = object.mesh.getWorldPosition(new THREE.Vector3())
      entry.sprite.position.set(worldPosition.x, worldPosition.y + 2.15, worldPosition.z)
      entry.sprite.visible = object.mesh.visible
      if (entry.vitality !== vitality || entry.maximum !== maximum) {
        const { context, canvas } = entry
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = 'rgba(12, 8, 14, 0.88)'
        context.fillRect(5, 5, 246, 38)
        context.strokeStyle = 'rgba(231, 207, 215, 0.8)'
        context.lineWidth = 3
        context.strokeRect(5, 5, 246, 38)
        context.fillStyle = '#45212d'
        context.fillRect(12, 12, 232, 24)
        context.fillStyle = vitality / maximum <= 0.25 ? '#ff4c55' : '#c9344e'
        context.fillRect(12, 12, 232 * Math.min(1, vitality / maximum), 24)
        context.fillStyle = '#fff4f5'
        context.font = 'bold 17px Arial'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.shadowColor = '#10070b'
        context.shadowBlur = 4
        context.fillText(`${Math.ceil(vitality)} / ${Math.ceil(maximum)}`, 128, 24)
        context.shadowBlur = 0
        entry.texture.needsUpdate = true
        entry.vitality = vitality
        entry.maximum = maximum
      }
    }

    for (const [id, entry] of this.entries) {
      if (activeIds.has(id)) continue
      this.disposeEntry(entry)
      this.entries.delete(id)
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry)
    this.entries.clear()
  }

  private disposeEntry(entry: HealthBarEntry): void {
    this.scene.remove(entry.sprite)
    entry.texture.dispose()
    entry.sprite.material.dispose()
  }
}
