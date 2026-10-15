import * as THREE from 'three'
import type { HumanoidAvatar } from './HumanoidAvatar'
import type { World } from './World'
import horseModelUrl from '../../Horse_LP.fbx?url'

const WALK_SPEED = 3.8
const GALLOP_SPEED = 8.5
const HORSE_HEIGHT = 2.05

/** Cavalo low-poly procedural, com pernas articuladas e animação leve sem assets externos. */
export class HorseMount {
  readonly mesh = new THREE.Group()
  private readonly legs: THREE.Group[] = []
  private tailRoot: THREE.Group | null = null
  private readonly world: World
  private readonly avatar: HumanoidAvatar
  private readonly cameraTarget: THREE.Vector3
  private readonly getCameraYaw: () => number
  private readonly pressed = new Set<string>()
  private enabled = false
  private mounted = false
  private animationTime = 0
  private galloping = false
  private readonly proceduralBones: Array<{ node: THREE.Bone; name: string; rotation: THREE.Euler }> = []
  private readonly proceduralNodes: Array<{ node: THREE.Object3D; name: string; rotation: THREE.Euler; position: THREE.Vector3 }> = []
  private importedModel: THREE.Object3D | null = null

  constructor(world: World, avatar: HumanoidAvatar, cameraTarget: THREE.Vector3, getCameraYaw: () => number) {
    this.world = world
    this.avatar = avatar
    this.cameraTarget = cameraTarget
    this.getCameraYaw = getCameraYaw
    this.buildModel()
    this.loadCommittedHorseModel()
    this.mesh.name = 'LowPolyHorse'
    this.mesh.visible = false
    this.world.scene.add(this.mesh)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  private buildModel(): void {
    const coat = new THREE.MeshStandardMaterial({ color: 0x92572f, roughness: 0.94, flatShading: true })
    const coatLight = new THREE.MeshStandardMaterial({ color: 0xb87945, roughness: 0.94, flatShading: true })
    const coatShade = new THREE.MeshStandardMaterial({ color: 0x714126, roughness: 1, flatShading: true })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 1, flatShading: true })
    const mane = new THREE.MeshStandardMaterial({ color: 0x302019, roughness: 1, flatShading: true })
    const maneLight = new THREE.MeshStandardMaterial({ color: 0x493024, roughness: 1, flatShading: true })
    const saddle = new THREE.MeshStandardMaterial({ color: 0x542f20, roughness: 0.92, flatShading: true })
    const leather = new THREE.MeshStandardMaterial({ color: 0x30241c, roughness: 0.9, flatShading: true })
    const brass = new THREE.MeshStandardMaterial({ color: 0xb28a49, metalness: 0.25, roughness: 0.7, flatShading: true })
    const cream = new THREE.MeshStandardMaterial({ color: 0xe0d0b2, roughness: 1, flatShading: true })
    const eye = new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.5, flatShading: true })
    const glint = new THREE.MeshStandardMaterial({ color: 0xf2e7d3, roughness: 0.4 })

    const part = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      parent: THREE.Object3D = this.mesh,
      scale?: [number, number, number],
    ) => {
      const item = new THREE.Mesh(geometry, material)
      item.name = name
      item.position.set(...position)
      if (scale) item.scale.set(...scale)
      item.castShadow = true
      item.receiveShadow = true
      parent.add(item)
      return item
    }
    const ellipsoid = (name: string, position: [number, number, number], scale: [number, number, number], material: THREE.Material, parent: THREE.Object3D = this.mesh) =>
      part(name, new THREE.SphereGeometry(1, 8, 6), material, position, parent, scale)
    const link = (name: string, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material, parent: THREE.Object3D = this.mesh, segments = 6) => {
      const direction = new THREE.Vector3().subVectors(to, from)
      const item = part(name, new THREE.CylinderGeometry(radius * 0.78, radius, direction.length(), segments, 1), material, [
        (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2,
      ], parent)
      item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
      return item
    }

    // Silhueta mais equina: tórax profundo, garupa musculosa e cintura estreita.
    ellipsoid('barrel-body', [0, 1.34, -0.02], [0.53, 0.57, 0.98], coat)
    ellipsoid('deep-chest', [0, 1.31, 0.58], [0.49, 0.62, 0.52], coatLight)
    ellipsoid('muscular-rump', [0, 1.38, -0.65], [0.53, 0.57, 0.48], coat)
    ellipsoid('shoulder-left', [-0.34, 1.39, 0.48], [0.2, 0.46, 0.37], coatLight)
    ellipsoid('shoulder-right', [0.34, 1.39, 0.48], [0.2, 0.46, 0.37], coat)
    ellipsoid('haunch-left', [-0.34, 1.36, -0.65], [0.23, 0.43, 0.39], coatLight)
    ellipsoid('haunch-right', [0.34, 1.36, -0.65], [0.23, 0.43, 0.39], coat)

    // Pescoço inclinado, com garganta e transição suave para a cabeça.
    const neck = ellipsoid('arched-neck', [0, 1.83, 0.65], [0.34, 0.68, 0.34], coatLight)
    neck.rotation.x = -0.43
    const throat = ellipsoid('throat', [0, 1.76, 0.88], [0.22, 0.42, 0.22], coat)
    throat.rotation.x = -0.38
    const head = ellipsoid('head', [0, 2.22, 1.12], [0.235, 0.38, 0.31], coatLight)
    head.rotation.x = -0.24
    const cheekL = ellipsoid('cheek-left', [-0.17, 2.13, 1.12], [0.105, 0.18, 0.17], coat)
    cheekL.rotation.x = -0.2
    const cheekR = ellipsoid('cheek-right', [0.17, 2.13, 1.12], [0.105, 0.18, 0.17], coat)
    cheekR.rotation.x = -0.2
    const muzzle = ellipsoid('soft-muzzle', [0, 2.02, 1.38], [0.19, 0.145, 0.22], cream)
    muzzle.rotation.x = -0.15
    ellipsoid('nose-bridge', [0, 2.13, 1.31], [0.13, 0.2, 0.2], coatLight)

    for (const side of [-1, 1]) {
      const x = side * 0.205
      ellipsoid(`eye-socket-${side}`, [x, 2.28, 1.18], [0.055, 0.085, 0.075], coatShade)
      ellipsoid(`eye-${side}`, [side * 0.235, 2.285, 1.19], [0.031, 0.052, 0.045], eye)
      ellipsoid(`eye-glint-${side}`, [side * 0.255, 2.305, 1.215], [0.012, 0.018, 0.014], glint)
      ellipsoid(`nostril-${side}`, [side * 0.135, 2.04, 1.555], [0.028, 0.022, 0.018], dark)
      const ear = part(`ear-${side}`, new THREE.ConeGeometry(0.075, 0.29, 5), coat, [side * 0.12, 2.51, 1.02])
      ear.rotation.z = side * -0.12
      const innerEar = part(`inner-ear-${side}`, new THREE.ConeGeometry(0.036, 0.18, 5), coatShade, [side * 0.12, 2.515, 1.045])
      innerEar.rotation.z = side * -0.12
    }

    // Crina em mechas facetadas, não apenas um cone grande.
    const maneBase = ellipsoid('mane-base', [0, 2.14, 0.76], [0.15, 0.13, 0.52], mane)
    maneBase.rotation.x = -0.46
    for (let i = 0; i < 7; i += 1) {
      const z = 1.08 - i * 0.13
      const tuft = part(`mane-tuft-${i}`, new THREE.ConeGeometry(0.105, 0.27, 5), i % 2 ? mane : maneLight, [0, 2.29 - i * 0.055, z])
      tuft.rotation.x = -0.28
      tuft.rotation.z = i % 2 ? 0.12 : -0.12
    }
    const forelock = part('forelock', new THREE.ConeGeometry(0.12, 0.29, 5), mane, [0, 2.43, 1.2])
    forelock.rotation.x = -0.42

    // Cauda segmentada para poder balançar durante a locomoção.
    const tailRoot = new THREE.Group()
    tailRoot.name = 'tail-root'
    tailRoot.position.set(0, 1.55, -1.02)
    this.mesh.add(tailRoot)
    link('tail-upper', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.22, -0.2), 0.09, coatShade, tailRoot, 5)
    link('tail-hair', new THREE.Vector3(0, -0.18, -0.17), new THREE.Vector3(0, -0.65, -0.35), 0.105, mane, tailRoot, 5)
    for (let i = 0; i < 3; i += 1) {
      const strand = part(`tail-strand-${i}`, new THREE.ConeGeometry(0.045, 0.34, 4), i === 1 ? maneLight : mane, [(i - 1) * 0.065, -0.52, -0.34], tailRoot)
      strand.rotation.x = -Math.PI / 2.7
    }
    this.tailRoot = tailRoot

    // Sela com assento, abas, estribos, fivelas e rédeas.
    ellipsoid('saddle-blanket', [0, 1.82, -0.04], [0.43, 0.12, 0.58], saddle)
    ellipsoid('saddle-seat', [0, 1.94, -0.07], [0.31, 0.1, 0.42], leather)
    for (const side of [-1, 1]) {
      const flap = part(`saddle-flap-${side}`, new THREE.BoxGeometry(0.075, 0.37, 0.48), saddle, [side * 0.39, 1.66, 0.02])
      flap.rotation.z = side * -0.08
      part(`stirrup-leather-${side}`, new THREE.BoxGeometry(0.045, 0.42, 0.045), leather, [side * 0.43, 1.48, 0.03])
      part(`stirrup-${side}`, new THREE.TorusGeometry(0.105, 0.025, 4, 6), brass, [side * 0.43, 1.27, 0.08]).rotation.x = Math.PI / 2
      ellipsoid(`saddle-rivet-${side}`, [side * 0.43, 1.78, 0.18], [0.035, 0.035, 0.035], brass)
    }
    // Cabeçada e rédeas acompanhando os dois lados do focinho.
    const brow = link('browband', new THREE.Vector3(-0.18, 2.31, 1.22), new THREE.Vector3(0.18, 2.31, 1.22), 0.025, leather)
    const noseBand = link('noseband', new THREE.Vector3(-0.16, 2.06, 1.48), new THREE.Vector3(0.16, 2.06, 1.48), 0.025, leather)
    for (const side of [-1, 1]) {
      link(`bridle-cheek-${side}`, new THREE.Vector3(side * 0.19, 2.29, 1.2), new THREE.Vector3(side * 0.16, 2.06, 1.47), 0.022, leather)
      link(`rein-${side}`, new THREE.Vector3(side * 0.18, 2.08, 1.44), new THREE.Vector3(side * 0.35, 1.88, 0.35), 0.018, leather)
    }
    void brow
    void noseBand

    // Quatro pernas com joelhos e boletos marcados; os pivôs principais são animados.
    const legPositions: Array<[number, number, number]> = [
      [-0.32, 1.02, 0.65], [0.32, 1.02, 0.65],
      [-0.32, 1.02, -0.68], [0.32, 1.02, -0.68],
    ]
    for (let i = 0; i < legPositions.length; i += 1) {
      const [x, y, z] = legPositions[i]!
      const pivot = new THREE.Group()
      pivot.name = `leg-pivot-${i}`
      pivot.position.set(x, y, z)
      this.mesh.add(pivot)
      const hind = i >= 2
      const upperLength = hind ? 0.43 : 0.42
      const kneeY = -upperLength
      const knee = new THREE.Group()
      knee.name = `knee-pivot-${i}`
      knee.position.set(0, kneeY, 0)
      pivot.add(knee)
      link(`upper-leg-${i}`, new THREE.Vector3(0, 0.04, 0), new THREE.Vector3(0, kneeY, 0), hind ? 0.14 : 0.105, hind ? coat : coatLight, pivot, 6)
      ellipsoid(`knee-${i}`, [0, 0, 0], [0.105, 0.12, 0.11], coat, knee)
      link(`lower-leg-${i}`, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.43, 0.015), 0.062, coatLight, knee, 5)
      ellipsoid(`fetlock-${i}`, [0, -0.4, 0.015], [0.075, 0.09, 0.08], coat, knee)
      const hoof = part(`hoof-${i}`, new THREE.BoxGeometry(0.18, 0.14, 0.23), dark, [0, -0.49, 0.055], knee)
      hoof.rotation.x = -0.06
      this.legs.push(pivot)
    }
  }


  /** Carrega o modelo visual; todas as animações são calculadas proceduralmente. */
  private loadCommittedHorseModel(): void {
    // O modelo procedural integrado continua como fallback se o FBX falhar.
    import('three/addons/loaders/FBXLoader.js').then(({ FBXLoader }) => {
      new FBXLoader().load(
        horseModelUrl,
        (model) => {
          if (!this.mesh.parent) return
          model.name = 'CommittedHorseLPFBX'
          model.updateMatrixWorld(true)
          const initialBounds = new THREE.Box3().setFromObject(model)
          const size = initialBounds.getSize(new THREE.Vector3())
          if (size.y <= 0 || !Number.isFinite(size.y)) return

          model.scale.multiplyScalar(2.55 / size.y)
          model.updateMatrixWorld(true)
          const bounds = new THREE.Box3().setFromObject(model)
          const center = bounds.getCenter(new THREE.Vector3())
          model.position.x -= center.x
          model.position.z -= center.z
          model.position.y -= bounds.min.y
          model.updateMatrixWorld(true)

          for (const child of [...this.mesh.children]) {
            if (child === model) continue
            this.mesh.remove(child)
            child.traverse((node) => {
              if (!(node instanceof THREE.Mesh)) return
              node.geometry.dispose()
              const materials = Array.isArray(node.material) ? node.material : [node.material]
              materials.forEach((material) => material.dispose())
            })
          }
          this.legs.length = 0
          this.tailRoot = null
          this.mesh.add(model)
          this.importedModel = model
          this.proceduralBones.length = 0
          this.proceduralNodes.length = 0

          model.traverse((node) => {
            const name = node.name.toLowerCase()
            if (node instanceof THREE.Bone) {
              this.proceduralBones.push({ node, name, rotation: node.rotation.clone() })
            }
            if (/(tail|mane|neck|head|leg|thigh|shin|hoof|foot|fetlock|knee)/i.test(name)) {
              this.proceduralNodes.push({
                node,
                name,
                rotation: node.rotation.clone(),
                position: node.position.clone(),
              })
            }
            if (node instanceof THREE.Mesh) {
              node.castShadow = true
              node.receiveShadow = true
            }
          })

          // Se o arquivo não tiver esqueleto, mantém a malha estática em vez de
          // aplicar rotações arbitrárias às peças e deformar o modelo.
          console.info('[HorseMount] Modelo carregado; animação procedural ativada.')
        },
        undefined,
        (error) => console.error('[HorseMount] Não foi possível carregar Horse_LP.fbx; usando o cavalo procedural integrado.', error),
      )
    }).catch((error) => console.error('[HorseMount] Falha ao inicializar o carregador FBX.', error))
  }

  private updateProceduralAnimation(dt: number, moving: boolean): void {
    const frequency = this.galloping ? 15 : 8
    const amplitude = moving ? (this.galloping ? 0.72 : 0.38) : 0.025
    const phase = this.animationTime
    const legPattern = /(front|fore|hind|back|leg|thigh|shin|hoof|foot|fetlock|knee)/i
    const leftPattern = /(left|_l\\b|\\.l\\b|\\bl_)/i
    const rightPattern = /(right|_r\\b|\\.r\\b|\\br_)/i

    for (let i = 0; i < this.proceduralBones.length; i += 1) {
      const item = this.proceduralBones[i]!
      const name = item.name
      item.node.rotation.copy(item.rotation)
      if (legPattern.test(name)) {
        const sidePhase = leftPattern.test(name) ? 0 : rightPattern.test(name) ? Math.PI : (i % 2) * Math.PI
        const hindPhase = /(hind|back)/i.test(name) ? Math.PI : 0
        item.node.rotation.x = item.rotation.x + Math.sin(phase + sidePhase + hindPhase) * amplitude
        if (/(shin|hoof|foot|fetlock)/i.test(name)) {
          item.node.rotation.x += Math.max(0, Math.sin(phase + sidePhase + hindPhase)) * (this.galloping ? 0.42 : 0.18)
        }
      } else if (/tail/i.test(name)) {
        item.node.rotation.z = item.rotation.z + Math.sin(phase * 0.45) * (moving ? 0.2 : 0.08)
      } else if (/head|neck/i.test(name)) {
        item.node.rotation.x = item.rotation.x + Math.sin(phase * 0.5) * (moving ? 0.035 : 0.06)
      }
    }

    // Em modelos sem ossos animáveis, não giramos submalhas inteiras: isso evita
    // que pernas sem pivô se desprendam do corpo. O balanço geral continua ativo.
    if (!this.proceduralBones.length && this.tailRoot) {
      this.tailRoot.rotation.x = Math.sin(phase * 0.7) * (moving ? 0.22 : 0.08)
    }
  }

  /** Bloqueia o deslocamento do cavalo ao tocar os colisores do cenário. */
  private collidesAt(x: number, z: number): boolean {
    const yaw = this.mesh.rotation.y
    const halfX = Math.abs(Math.cos(yaw)) * 0.5 + Math.abs(Math.sin(yaw)) * 1.05
    const halfZ = Math.abs(Math.sin(yaw)) * 0.5 + Math.abs(Math.cos(yaw)) * 1.05
    const minY = this.world.terrain.heightAt(x, z) + 0.08
    const maxY = minY + 1.85

    for (const object of this.world.list()) {
      const obstacle = object.mesh
      if (!obstacle.visible || obstacle.userData.colliderType === 'none') continue
      obstacle.updateWorldMatrix(true, false)
      if (!obstacle.geometry.boundingBox) obstacle.geometry.computeBoundingBox()
      const local = obstacle.geometry.boundingBox
      if (!local) continue
      const bounds = local.clone().applyMatrix4(obstacle.matrixWorld)
      if (maxY <= bounds.min.y + 0.02 || minY >= bounds.max.y - 0.02) continue
      if (x + halfX <= bounds.min.x || x - halfX >= bounds.max.x) continue
      if (z + halfZ <= bounds.min.z || z - halfZ >= bounds.max.z) continue
      return true
    }
    return false
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
    this.mesh.rotation.y = this.getCameraYaw() + Math.PI
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
      const oldX = this.mesh.position.x
      const oldZ = this.mesh.position.z
      const nextX = THREE.MathUtils.clamp(oldX + direction.x * speed * step, -48, 48)
      const nextZ = THREE.MathUtils.clamp(oldZ + direction.z * speed * step, -48, 48)
      this.mesh.rotation.y = Math.atan2(direction.x, direction.z)

      // Resolve os eixos separadamente para permitir deslizar ao longo das paredes.
      if (!this.collidesAt(nextX, oldZ)) this.mesh.position.x = nextX
      if (!this.collidesAt(this.mesh.position.x, nextZ)) this.mesh.position.z = nextZ
    }

    const groundY = this.world.terrain.heightAt(this.mesh.position.x, this.mesh.position.z)
    this.mesh.position.y = groundY
    this.animationTime += step * (this.galloping ? 15 : 8)
    this.updateProceduralAnimation(step, moving)
    this.legs.forEach((leg, index) => {
      const phase = index === 0 || index === 3 ? 0 : Math.PI
      leg.rotation.x = Math.sin(this.animationTime + phase) * (moving ? (this.galloping ? 0.78 : 0.38) : 0.025)
    })
    this.mesh.position.y += moving ? Math.abs(Math.sin(this.animationTime * 2)) * (this.galloping ? 0.09 : 0.035) : 0
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, side * -0.055, 5, step)
    this.mesh.rotation.x = THREE.MathUtils.damp(this.mesh.rotation.x, moving ? Math.sin(this.animationTime * 2) * (this.galloping ? 0.035 : 0.015) : 0, 5, step)
    if (this.tailRoot) this.tailRoot.rotation.x = Math.sin(this.animationTime * 0.7) * (moving ? 0.22 : 0.08)

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
