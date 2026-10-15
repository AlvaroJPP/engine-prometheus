import * as THREE from 'three'
import type { HumanoidAvatar } from './HumanoidAvatar'
import type { World } from './World'

const WALK_SPEED = 3.8
const GALLOP_SPEED = 8.5
const HORSE_HEIGHT = 2.05

/** Cavalo low-poly procedural, com pernas articuladas e animação leve sem assets externos. */
export class HorseMount {
  readonly mesh = new THREE.Group()
  private readonly legs: THREE.Group[] = []
  private readonly world: World
  private readonly avatar: HumanoidAvatar
  private readonly cameraTarget: THREE.Vector3
  private readonly getCameraYaw: () => number
  private readonly pressed = new Set<string>()
  private enabled = false
  private mounted = false
  private animationTime = 0
  private galloping = false

  constructor(world: World, avatar: HumanoidAvatar, cameraTarget: THREE.Vector3, getCameraYaw: () => number) {
    this.world = world
    this.avatar = avatar
    this.cameraTarget = cameraTarget
    this.getCameraYaw = getCameraYaw
    this.buildModel()
    this.mesh.name = 'LowPolyHorse'
    this.mesh.visible = false
    this.world.scene.add(this.mesh)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  private buildModel(): void {
    const coat = new THREE.MeshStandardMaterial({ color: 0x87502e, roughness: 1, flatShading: true })
    const coatLight = new THREE.MeshStandardMaterial({ color: 0xa96c3b, roughness: 1, flatShading: true })
    const dark = new THREE.MeshStandardMaterial({ color: 0x35251d, roughness: 1, flatShading: true })
    const mane = new THREE.MeshStandardMaterial({ color: 0x2c211d, roughness: 1, flatShading: true })
    const saddle = new THREE.MeshStandardMaterial({ color: 0x4c2b20, roughness: 1, flatShading: true })
    const cream = new THREE.MeshStandardMaterial({ color: 0xd8c6a2, roughness: 1, flatShading: true })

    const part = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], parent: THREE.Object3D = this.mesh, scale?: [number, number, number]) => {
      const item = new THREE.Mesh(geometry, material)
      item.name = name
      item.position.set(...position)
      if (scale) item.scale.set(...scale)
      item.castShadow = true
      item.receiveShadow = true
      parent.add(item)
      return item
    }

    // O cavalo aponta para +Z; geometria de baixa contagem de polígonos.
    part('body', new THREE.IcosahedronGeometry(0.62, 1), coat, [0, 1.28, 0], this.mesh, [0.78, 0.88, 1.45])
    part('chest', new THREE.IcosahedronGeometry(0.48, 1), coatLight, [0, 1.34, 0.58], this.mesh, [0.88, 1.05, 0.78])
    part('rump', new THREE.IcosahedronGeometry(0.48, 1), coat, [0, 1.34, -0.62], this.mesh, [0.95, 0.98, 0.78])
    part('neck', new THREE.CylinderGeometry(0.25, 0.38, 0.95, 7, 1), coatLight, [0, 1.82, 0.72], this.mesh, [0.88, 1, 0.88]).rotation.x = -0.36
    part('head', new THREE.IcosahedronGeometry(0.3, 1), coatLight, [0, 2.18, 1.12], this.mesh, [0.72, 0.78, 1.12])
    part('muzzle', new THREE.IcosahedronGeometry(0.19, 0), cream, [0, 2.05, 1.38], this.mesh, [0.78, 0.62, 0.85])
    part('left-ear', new THREE.ConeGeometry(0.09, 0.3, 5), dark, [-0.13, 2.45, 1.02], this.mesh, [0.8, 1, 0.8])
    part('right-ear', new THREE.ConeGeometry(0.09, 0.3, 5), dark, [0.13, 2.45, 1.02], this.mesh, [0.8, 1, 0.8])
    part('mane', new THREE.ConeGeometry(0.2, 0.8, 5), mane, [0, 2.15, 0.72], this.mesh, [1, 1, 1.3]).rotation.x = Math.PI / 2
    part('forelock', new THREE.ConeGeometry(0.15, 0.34, 5), mane, [0, 2.36, 1.1], this.mesh, [1, 1, 0.8])
    const tail = part('tail', new THREE.ConeGeometry(0.17, 0.8, 5), mane, [0, 1.48, -1.08])
    tail.rotation.x = -Math.PI / 2.6
    part('saddle-pad', new THREE.BoxGeometry(0.68, 0.13, 0.76), dark, [0, 1.91, -0.08])
    part('saddle', new THREE.BoxGeometry(0.58, 0.12, 0.62), saddle, [0, 2.02, -0.08])
    part('left-stirrup', new THREE.BoxGeometry(0.08, 0.42, 0.08), dark, [-0.4, 1.67, -0.08])
    part('right-stirrup', new THREE.BoxGeometry(0.08, 0.42, 0.08), dark, [0.4, 1.67, -0.08])

    const legGeometry = new THREE.CylinderGeometry(0.085, 0.065, 0.66, 5, 1)
    const hoofGeometry = new THREE.BoxGeometry(0.19, 0.15, 0.24)
    const legPositions: Array<[number, number, number]> = [
      [-0.31, 0.94, 0.64], [0.31, 0.94, 0.64],
      [-0.31, 0.94, -0.66], [0.31, 0.94, -0.66],
    ]
    for (let i = 0; i < legPositions.length; i += 1) {
      const [x, y, z] = legPositions[i]!
      const pivot = new THREE.Group()
      pivot.name = `leg-pivot-${i}`
      pivot.position.set(x, y, z)
      this.mesh.add(pivot)
      part(`leg-${i}`, legGeometry, coat, [0, -0.3, 0], pivot)
      part(`hoof-${i}`, hoofGeometry, dark, [0, -0.64, 0.035], pivot)
      this.legs.push(pivot)
    }
  }

  setRuntimeMode(enabled: boolean, playerPosition?: THREE.Vector3): void {
    this.enabled = enabled
    this.pressed.clear()
    if (!enabled) {
      this.dismount(false)
      this.mesh.visible = false
      return
    }
    this.mesh.visible = true
    if (playerPosition) {
      const yaw = this.getCameraYaw()
      this.mesh.position.set(
        THREE.MathUtils.clamp(playerPosition.x + Math.cos(yaw) * 3, -47, 47),
        this.world.terrain.heightAt(playerPosition.x + Math.cos(yaw) * 3, playerPosition.z - Math.sin(yaw) * 3),
        THREE.MathUtils.clamp(playerPosition.z - Math.sin(yaw) * 3, -47, 47),
      )
    }
    this.mesh.rotation.y = this.getCameraYaw()
  }

  update(dt: number): void {
    if (!this.enabled || !this.mesh.visible) return
    const step = Math.min(Math.max(dt, 0), 0.05)
    const forward = Number(this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) - Number(this.pressed.has('KeyS') || this.pressed.has('ArrowDown'))
    const side = Number(this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) - Number(this.pressed.has('KeyA') || this.pressed.has('ArrowLeft'))
    const moving = forward !== 0 || side !== 0
    this.galloping = moving && (this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'))
    const speed = this.galloping ? GALLOP_SPEED : WALK_SPEED

    if (this.mounted && moving) {
      const yaw = this.getCameraYaw()
      const direction = new THREE.Vector3(
        side * Math.cos(yaw) - forward * Math.sin(yaw),
        0,
        -side * Math.sin(yaw) - forward * Math.cos(yaw),
      ).normalize()
      this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x + direction.x * speed * step, -48, 48)
      this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z + direction.z * speed * step, -48, 48)
      this.mesh.rotation.y = Math.atan2(direction.x, direction.z)
    }

    const groundY = this.world.terrain.heightAt(this.mesh.position.x, this.mesh.position.z)
    this.mesh.position.y = groundY
    this.animationTime += step * (this.galloping ? 15 : 8)
    const swing = moving ? Math.sin(this.animationTime) * (this.galloping ? 0.78 : 0.38) : Math.sin(this.animationTime * 0.5) * 0.025
    this.legs.forEach((leg, index) => {
      const phase = index === 0 || index === 3 ? 0 : Math.PI
      leg.rotation.x = Math.sin(this.animationTime + phase) * (moving ? (this.galloping ? 0.78 : 0.38) : 0.025)
    })
    this.mesh.position.y += moving ? Math.abs(Math.sin(this.animationTime * 2)) * (this.galloping ? 0.09 : 0.035) : 0
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, side * -0.055, 5, step)
    this.mesh.rotation.x = THREE.MathUtils.damp(this.mesh.rotation.x, moving ? Math.sin(this.animationTime * 2) * (this.galloping ? 0.035 : 0.015) : 0, 5, step)

    if (this.mounted) {
      const riderOffset = new THREE.Vector3(0, HORSE_HEIGHT - 0.35, -0.13).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y)
      this.avatar.mesh.position.set(
        this.mesh.position.x + riderOffset.x,
        groundY + riderOffset.y,
        this.mesh.position.z + riderOffset.z,
      )
      this.avatar.mesh.rotation.y = this.mesh.rotation.y
      this.cameraTarget.set(this.mesh.position.x, groundY + 2.3, this.mesh.position.z)
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.repeat) return
    if (event.code === 'KeyE') {
      event.preventDefault()
      if (this.mounted) this.dismount(true)
      else if (this.mesh.visible && this.avatar.mesh.position.distanceTo(this.mesh.position) < 3.4) this.mount()
      return
    }
    if (this.mounted && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      this.pressed.add(event.code)
      if (event.code.startsWith('Arrow')) event.preventDefault()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => { this.pressed.delete(event.code) }
  private onBlur = (): void => { this.pressed.clear() }

  private mount(): void {
    this.mounted = true
    this.avatar.setEnabled(false)
    this.avatar.mesh.visible = true
    this.avatar.mesh.position.set(this.mesh.position.x, this.mesh.position.y + HORSE_HEIGHT - 0.35, this.mesh.position.z)
    this.cameraTarget.set(this.mesh.position.x, this.mesh.position.y + 2.3, this.mesh.position.z)
    this.pressed.clear()
  }

  private dismount(restorePlayer: boolean): void {
    if (!this.mounted) return
    this.mounted = false
    this.pressed.clear()
    if (restorePlayer) {
      const side = new THREE.Vector3(1.25, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y)
      const x = THREE.MathUtils.clamp(this.mesh.position.x + side.x, -48, 48)
      const z = THREE.MathUtils.clamp(this.mesh.position.z + side.z, -48, 48)
      this.avatar.mesh.position.set(x, this.world.terrain.heightAt(x, z), z)
      this.avatar.mesh.visible = true
      this.avatar.setEnabled(true)
      this.avatar.resetVerticalState()
      this.cameraTarget.set(x, this.avatar.mesh.position.y + 0.9, z)
    } else {
      this.avatar.setEnabled(false)
    }
  }

  isMounted(): boolean { return this.mounted }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.world.scene.remove(this.mesh)
    this.mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) material.forEach(item => item.dispose())
      else material.dispose()
    })
  }
}
