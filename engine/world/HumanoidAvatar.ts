import * as THREE from 'three'
import type { World } from './World'

const PLAYER_ID = 'player'
const WALK_SPEED = 4.2
const RUN_MULTIPLIER = 1.7
const JUMP_SPEED = 6.2
const GRAVITY = 18
const PLAYER_RADIUS = 0.32
const PLAYER_HEIGHT = 1.8

/** Avatar humanoide controlável por teclado, com gravidade e colisões com terreno/objetos. */
export class HumanoidAvatar {
  readonly mesh = new THREE.Group()
  private readonly world: World
  private readonly cameraTarget: THREE.Vector3
  private readonly getCameraYaw: () => number
  private readonly pressed = new Set<string>()
  private readonly activeCollisions = new Map<string, { a: string; b: string }>()
  private verticalVelocity = 0
  private grounded = true
  private enabled = true
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      if (event.code === 'Space') event.preventDefault()
      this.pressed.add(event.code)
    }
  }
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code)
  }
  private readonly onBlur = (): void => this.pressed.clear()

  constructor(world: World, cameraTarget: THREE.Vector3, getCameraYaw: () => number) {
    this.world = world
    this.cameraTarget = cameraTarget
    this.getCameraYaw = getCameraYaw
    this.mesh.name = 'Humanoid Avatar'
    this.mesh.userData.id = PLAYER_ID

    const skin = new THREE.MeshStandardMaterial({ color: 0xd7a078, roughness: 0.85 })
    const shirt = new THREE.MeshStandardMaterial({ color: 0x2878c8, roughness: 0.8 })
    const pants = new THREE.MeshStandardMaterial({ color: 0x263e61, roughness: 0.9 })
    const shoes = new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.8 })
    const hair = new THREE.MeshStandardMaterial({ color: 0x39291f, roughness: 1 })
    const addPart = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale?: [number, number, number]) => {
      const part = new THREE.Mesh(geometry, material)
      part.name = name
      part.position.set(...position)
      if (scale) part.scale.set(...scale)
      part.castShadow = true
      part.receiveShadow = true
      this.mesh.add(part)
      return part
    }

    // Cabeça, cabelo e pescoço.
    addPart('head', new THREE.SphereGeometry(0.19, 16, 12), skin, [0, 1.57, 0])
    addPart('hair', new THREE.SphereGeometry(0.195, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, 1.65, -0.015])
    addPart('neck', new THREE.CylinderGeometry(0.065, 0.07, 0.12, 10), skin, [0, 1.34, 0])
    // Tronco e braços.
    addPart('torso', new THREE.BoxGeometry(0.48, 0.58, 0.27), shirt, [0, 1.02, 0])
    addPart('left-arm', new THREE.CapsuleGeometry(0.075, 0.38, 4, 8), shirt, [-0.32, 1.02, 0], [1, 1, 1])
    addPart('right-arm', new THREE.CapsuleGeometry(0.075, 0.38, 4, 8), shirt, [0.32, 1.02, 0])
    addPart('left-hand', new THREE.SphereGeometry(0.07, 10, 8), skin, [-0.33, 0.77, 0])
    addPart('right-hand', new THREE.SphereGeometry(0.07, 10, 8), skin, [0.33, 0.77, 0])
    // Pernas e pés.
    addPart('left-leg', new THREE.CapsuleGeometry(0.095, 0.48, 4, 8), pants, [-0.13, 0.43, 0])
    addPart('right-leg', new THREE.CapsuleGeometry(0.095, 0.48, 4, 8), pants, [0.13, 0.43, 0])
    addPart('left-shoe', new THREE.BoxGeometry(0.17, 0.1, 0.27), shoes, [-0.13, 0.08, 0.045])
    addPart('right-shoe', new THREE.BoxGeometry(0.17, 0.1, 0.27), shoes, [0.13, 0.08, 0.045])

    this.mesh.position.set(0, world.terrain.heightAt(0, 0), 0)
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) child.userData.avatarPart = true
    })
    this.world.scene.add(this.mesh)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  update(dt: number): void {
    if (!this.enabled) return
    const step = Math.min(dt, 0.05)
    const forwardInput = Number(this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) - Number(this.pressed.has('KeyS') || this.pressed.has('ArrowDown'))
    const sideInput = Number(this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) - Number(this.pressed.has('KeyA') || this.pressed.has('ArrowLeft'))
    const length = Math.hypot(forwardInput, sideInput)
    const speed = WALK_SPEED * (this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight') ? RUN_MULTIPLIER : 1)

    if (this.pressed.has('Space') && this.grounded) {
      this.verticalVelocity = JUMP_SPEED
      this.grounded = false
    }
    this.verticalVelocity -= GRAVITY * step
    const oldY = this.mesh.position.y
    const nextY = oldY + this.verticalVelocity * step
    const terrainY = this.world.terrain.heightAt(this.mesh.position.x, this.mesh.position.z)

    // Movimento relativo à orientação horizontal da câmera.
    if (length > 0) {
      const direction = new THREE.Vector3(
        0,
        0,
        0,
      )
      // O vetor acima é corrigido para usar diretamente o ângulo real da câmera abaixo.
      direction.set(
        sideInput * Math.cos(this.getCameraYaw()) - forwardInput * Math.sin(this.getCameraYaw()),
        0,
        -sideInput * Math.sin(this.getCameraYaw()) - forwardInput * Math.cos(this.getCameraYaw()),
      )
      direction.normalize().multiplyScalar(speed * step)
      const oldX = this.mesh.position.x
      const oldZ = this.mesh.position.z
      this.mesh.position.x = THREE.MathUtils.clamp(oldX + direction.x, -49, 49)
      if (this.collidesWithObjects()) this.mesh.position.x = oldX
      this.mesh.position.z = THREE.MathUtils.clamp(oldZ + direction.z, -49, 49)
      if (this.collidesWithObjects()) this.mesh.position.z = oldZ
      this.mesh.rotation.y = Math.atan2(direction.x, direction.z)
    }

    const newGroundY = this.world.terrain.heightAt(this.mesh.position.x, this.mesh.position.z)
    this.mesh.position.y = nextY
    this.mesh.updateMatrixWorld(true)
    const landing = this.findObjectLanding(oldY, nextY)
    if (nextY <= newGroundY) {
      this.mesh.position.y = newGroundY
      this.verticalVelocity = 0
      this.grounded = true
    } else if (landing !== null && this.verticalVelocity <= 0) {
      this.mesh.position.y = landing
      this.verticalVelocity = 0
      this.grounded = true
    } else {
      this.grounded = false
    }

    this.updateCollisionEvents()
    // A câmera acompanha o personagem, mantendo o ângulo e a distância atuais.
    this.cameraTarget.x = THREE.MathUtils.lerp(this.cameraTarget.x, this.mesh.position.x, 0.12)
    this.cameraTarget.z = THREE.MathUtils.lerp(this.cameraTarget.z, this.mesh.position.z, 0.12)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.pressed.clear()
  }

  reset(): void {
    this.mesh.position.set(0, this.world.terrain.heightAt(0, 0), 0)
    this.verticalVelocity = 0
    this.grounded = true
    this.pressed.clear()
    this.activeCollisions.clear()
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.world.scene.remove(this.mesh)
    this.mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
    })
  }

  private playerBox(): THREE.Box3 {
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + PLAYER_HEIGHT / 2, this.mesh.position.z),
      new THREE.Vector3(PLAYER_RADIUS * 2, PLAYER_HEIGHT, PLAYER_RADIUS * 2),
    )
  }

  private collidesWithObjects(): boolean {
    const playerBox = this.playerBox()
    return this.world.list().some((object) => {
      if (!object.mesh.visible) return false
      const objectBox = new THREE.Box3().setFromObject(object.mesh)
      return playerBox.intersectsBox(objectBox)
    })
  }

  private findObjectLanding(oldY: number, nextY: number): number | null {
    if (nextY > oldY) return null
    const playerBox = this.playerBox()
    let landing: number | null = null
    for (const object of this.world.list()) {
      if (!object.mesh.visible) continue
      const box = new THREE.Box3().setFromObject(object.mesh)
      const horizontalOverlap = playerBox.max.x > box.min.x && playerBox.min.x < box.max.x &&
        playerBox.max.z > box.min.z && playerBox.min.z < box.max.z
      if (!horizontalOverlap || oldY < box.max.y - 0.08 || nextY > box.max.y) continue
      if (landing === null || box.max.y > landing) landing = box.max.y
    }
    return landing
  }

  private updateCollisionEvents(): void {
    const playerBox = this.playerBox()
    const next = new Map<string, { a: string; b: string }>()
    for (const object of this.world.list()) {
      if (!object.mesh.visible) continue
      const box = new THREE.Box3().setFromObject(object.mesh)
      if (!playerBox.intersectsBox(box)) continue
      const key = object.id
      next.set(key, { a: PLAYER_ID, b: object.id })
    }
    for (const [id, pair] of next) {
      if (!this.activeCollisions.has(id)) this.world.events.emit('collisionStarted', pair)
    }
    for (const [id, pair] of this.activeCollisions) {
      if (!next.has(id)) this.world.events.emit('collisionEnded', pair)
    }
    this.activeCollisions.clear()
    for (const [id, pair] of next) this.activeCollisions.set(id, pair)
  }
}
