import * as THREE from 'three'
import type { World } from '../../../engine/world/World'
import type { RuleEngine } from '../../../engine/script/RuleEngine'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'

type HostileCandidate = {
  instance: BehaviorPackageInstance
  object: NonNullable<ReturnType<World['get']>>
}

type TargetCandidate = HostileCandidate & { distance: number }

interface VeilborneTargetLockDependencies {
  scene: THREE.Scene
  avatar: THREE.Object3D
  logic: RuleEngine
  findTarget(maxRange: number): TargetCandidate | null
  getHostiles(): HostileCandidate[]
  getWorldPoint(objectId: string): THREE.Vector3 | null
  isPlayerAlive(): boolean
  spawnEffect(position: THREE.Vector3, color: number, radius: number, durationSeconds: number): void
  invalidate(): void
}

/** Gerencia a seleção do alvo VEILBORNE e o marcador visual de travamento. */
export class VeilborneTargetLockController {
  private readonly scene: THREE.Scene
  private readonly avatar: THREE.Object3D
  private readonly logic: RuleEngine
  private readonly findTarget: (maxRange: number) => TargetCandidate | null
  private readonly getHostiles: () => HostileCandidate[]
  private readonly getWorldPoint: (objectId: string) => THREE.Vector3 | null
  private readonly isPlayerAlive: () => boolean
  private readonly spawnEffect: VeilborneTargetLockDependencies['spawnEffect']
  private readonly invalidate: () => void
  private lockedTargetId: string | null = null
  private marker: THREE.Mesh | null = null

  constructor(dependencies: VeilborneTargetLockDependencies) {
    this.scene = dependencies.scene
    this.avatar = dependencies.avatar
    this.logic = dependencies.logic
    this.findTarget = dependencies.findTarget
    this.getHostiles = dependencies.getHostiles
    this.getWorldPoint = dependencies.getWorldPoint
    this.isPlayerAlive = dependencies.isPlayerAlive
    this.spawnEffect = dependencies.spawnEffect
    this.invalidate = dependencies.invalidate
  }

  get targetId(): string | null {
    return this.lockedTargetId
  }

  toggle(): void {
    if (this.lockedTargetId) {
      this.clear()
      this.invalidate()
      return
    }

    const target = this.findTarget(30)
    if (!target) {
      this.logic.setVariable('alvo_travado', false)
      this.logic.setVariable('alvo_veilborne_id', '')
      return
    }

    this.lockedTargetId = target.object.id
    this.logic.setVariable('alvo_travado', true)
    this.logic.setVariable('alvo_veilborne_id', target.object.id)

    const material = new THREE.MeshBasicMaterial({
      color: 0xff526e,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.marker = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.035, 7, 36), material)
    this.marker.rotation.x = Math.PI / 2
    this.marker.renderOrder = 24
    this.scene.add(this.marker)

    const point = this.getWorldPoint(target.object.id)
    if (point) this.spawnEffect(point, 0xff526e, 0.58, 0.35)
    this.update(this.isPlayerAlive())
    this.invalidate()
  }

  update(playerAlive: boolean): void {
    if (!this.lockedTargetId) return
    if (!playerAlive) {
      this.clear()
      return
    }

    const target = this.getHostiles().find(candidate => candidate.object.id === this.lockedTargetId)
    if (!target) {
      this.clear()
      return
    }

    const deltaX = target.object.mesh.position.x - this.avatar.position.x
    const deltaZ = target.object.mesh.position.z - this.avatar.position.z
    const distance = Math.hypot(deltaX, deltaZ)
    if (distance > 45) {
      this.clear()
      return
    }

    if (distance > 0.001) {
      this.avatar.rotation.y = Math.atan2(deltaX, deltaZ)
      this.avatar.updateMatrixWorld(true)
    }

    if (this.marker) {
      const point = this.getWorldPoint(target.object.id)
      if (point) {
        this.marker.position.copy(point)
        this.marker.position.y = target.object.mesh.position.y + 1.05
      }
    }
  }

  clear(): void {
    this.lockedTargetId = null
    if (this.marker) {
      this.scene.remove(this.marker)
      this.marker.geometry.dispose()
      const material = this.marker.material
      if (Array.isArray(material)) material.forEach(item => item.dispose())
      else material.dispose()
      this.marker = null
    }
    if (this.logic.getVariable('alvo_travado') !== undefined) this.logic.setVariable('alvo_travado', false)
    if (this.logic.getVariable('alvo_veilborne_id') !== undefined) this.logic.setVariable('alvo_veilborne_id', '')
  }
}
