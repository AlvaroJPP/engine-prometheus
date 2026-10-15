import * as THREE from 'three'
import type { World } from '../world/World'
import type { HumanoidAvatar } from '../world/HumanoidAvatar'

type MountAction = 'mount' | 'dismount' | 'toggle'

/**
 * Runtime genérico das ações de montaria disparadas pelo Visual Script.
 * Não cria nem carrega modelos: movimenta somente o objeto dono da regra salva.
 */
export class ScriptMountRuntime {
  private enabled = false
  private mountedObjectId: string | null = null
  private readonly pressed = new Set<string>()

  constructor(
    private readonly world: World,
    private readonly avatar: HumanoidAvatar,
    private readonly cameraTarget: THREE.Vector3,
    private readonly getCameraYaw: () => number,
  ) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  get isMounted(): boolean { return this.mountedObjectId !== null }

  setRuntimeMode(enabled: boolean, _playerPosition?: THREE.Vector3): void {
    this.enabled = enabled
    this.pressed.clear()
    if (!enabled && this.mountedObjectId) this.dismount(false)
  }

  executeAction(action: MountAction, objectId?: string): void {
    if (!this.enabled || !objectId) return
    if (action === 'dismount') {
      if (this.mountedObjectId === objectId) this.dismount(true)
      return
    }
    if (action === 'toggle' && this.mountedObjectId === objectId) {
      this.dismount(true)
      return
    }
    if (this.mountedObjectId) return
    const object = this.world.get(objectId)
    if (!object || !object.mesh.visible) return

    const target = object.mesh
    const distance = Math.hypot(
      this.avatar.mesh.position.x - target.position.x,
      this.avatar.mesh.position.z - target.position.z,
    )
    if (distance >= 3.4) return

    this.mountedObjectId = objectId
    this.pressed.clear()
    this.avatar.setMountedPose(1)
    this.avatar.setEnabled(false)
    this.followMount(target)
  }

  update(dt: number): void {
    if (!this.enabled || !this.mountedObjectId) return
    const object = this.world.get(this.mountedObjectId)
    if (!object || !object.mesh.visible) {
      this.dismount(true)
      return
    }

    const step = Math.min(Math.max(dt, 0), 0.05)
    const forward = Number(this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) -
      Number(this.pressed.has('KeyS') || this.pressed.has('ArrowDown'))
    const side = Number(this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) -
      Number(this.pressed.has('KeyA') || this.pressed.has('ArrowLeft'))
    if (forward || side) {
      const yaw = this.getCameraYaw()
      const direction = new THREE.Vector3(
        side * Math.cos(yaw) - forward * Math.sin(yaw),
        0,
        -side * Math.sin(yaw) - forward * Math.cos(yaw),
      ).normalize()
      const speed = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight') ? 8.5 : 3.8
      const mesh = object.mesh
      const x = THREE.MathUtils.clamp(mesh.position.x + direction.x * speed * step, -48, 48)
      const z = THREE.MathUtils.clamp(mesh.position.z + direction.z * speed * step, -48, 48)
      mesh.position.x = x
      mesh.position.z = z
      mesh.position.y = this.world.terrain.heightAt(x, z) + this.getObjectHeight(mesh) / 2
      mesh.rotation.y = Math.atan2(direction.x, direction.z)
      this.world.notifyChanged(object.id)
    }
    this.followMount(object.mesh)
  }

  private getObjectHeight(mesh: THREE.Object3D): number {
    const height = Number(mesh.userData.importedModelHeight)
    if (Number.isFinite(height) && height > 0) return height
    mesh.updateWorldMatrix(true, true)
    const bounds = new THREE.Box3().setFromObject(mesh)
    return bounds.isEmpty() ? 2 : Math.max(0.5, bounds.getSize(new THREE.Vector3()).y)
  }

  private followMount(mesh: THREE.Object3D): void {
    const height = this.getObjectHeight(mesh)
    this.avatar.mesh.position.set(mesh.position.x, mesh.position.y + height * 0.22, mesh.position.z)
    this.avatar.mesh.rotation.y = mesh.rotation.y
    this.avatar.setMountedPose(1)
    this.cameraTarget.set(mesh.position.x, mesh.position.y + height * 0.95, mesh.position.z)
  }

  private dismount(restorePlayer: boolean): void {
    const object = this.mountedObjectId ? this.world.get(this.mountedObjectId) : undefined
    this.mountedObjectId = null
    this.pressed.clear()
    this.avatar.setMountedPose(0)
    if (restorePlayer && object) {
      const mesh = object.mesh
      const height = this.getObjectHeight(mesh)
      const yaw = mesh.rotation.y
      const candidates = [
        new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
        new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)),
        new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
        new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)),
      ]
      const distance = Math.max(1.6, height * 0.75)
      let position: THREE.Vector3 | null = null
      for (const direction of candidates) {
        const x = THREE.MathUtils.clamp(mesh.position.x + direction.x * distance, -48, 48)
        const z = THREE.MathUtils.clamp(mesh.position.z + direction.z * distance, -48, 48)
        if (this.avatar.canOccupyPosition(x, z)) {
          position = new THREE.Vector3(x, this.world.terrain.heightAt(x, z), z)
          break
        }
      }
      position ??= new THREE.Vector3(mesh.position.x + distance, this.world.terrain.heightAt(mesh.position.x + distance, mesh.position.z), mesh.position.z)
      this.avatar.mesh.position.copy(position)
      this.avatar.mesh.visible = true
      this.avatar.setEnabled(this.enabled)
      this.avatar.resetVerticalState()
      this.cameraTarget.set(position.x, position.y + 0.9, position.z)
    } else {
      this.avatar.setEnabled(false)
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || !this.mountedObjectId || event.repeat) return
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      this.pressed.add(event.code)
      if (event.code.startsWith('Arrow')) event.preventDefault()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => { this.pressed.delete(event.code) }
  private onBlur = (): void => { this.pressed.clear() }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.pressed.clear()
  }
}
