import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { World } from './World'

const PLAYER_ID = 'player'
const WALK_SPEED = 4.2
const RUN_MULTIPLIER = 1.7
const JUMP_SPEED = 6.2
const GRAVITY = 18
const PLAYER_RADIUS = 0.32
const PLAYER_HEIGHT = 1.8

/** Bounds do colisor físico, independentes da malha visual importada. */
function getColliderBounds(mesh: THREE.Mesh): THREE.Box3 | null {
  const type = mesh.userData.colliderType
  if (type === 'none') return null

  mesh.updateWorldMatrix(true, false)
  const configuredSize = mesh.userData.colliderSize
  const hasManualSize = Array.isArray(configuredSize) &&
    configuredSize.length === 3 &&
    configuredSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
  const offsetData = mesh.userData.colliderOffset
  const offset = Array.isArray(offsetData) && offsetData.length === 3
    ? offsetData.map((value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0) as [number, number, number]
    : [0, 0, 0] as [number, number, number]

  // Em modelos importados, a raiz é apenas uma caixa proxy invisível. O modo automático
  // deve usar os limites das malhas visuais filhas, senão o jogador colide com uma caixa
  // que não corresponde ao modelo que aparece na tela.
  if ((type === undefined || type === 'auto') && !hasManualSize && offset.every(value => Math.abs(value) < 1e-9)) {
    if (mesh.userData.importedModel === true) {
      mesh.updateWorldMatrix(true, true)
      const visualBounds = new THREE.Box3()
      const childBounds = new THREE.Box3()
      mesh.traverse((child) => {
        if (child === mesh || !(child instanceof THREE.Mesh) || !child.visible) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        child.updateWorldMatrix(true, false)
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
        if (!child.geometry.boundingBox) return
        childBounds.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld)
        visualBounds.union(childBounds)
      })
      if (!visualBounds.isEmpty()) return visualBounds
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    return (mesh.geometry.boundingBox?.clone() ?? new THREE.Box3()).applyMatrix4(mesh.matrixWorld)
  }

  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const sourceSize = mesh.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1)
  const size = hasManualSize
    ? new THREE.Vector3(
      Math.max(0.05, configuredSize[0]),
      Math.max(0.05, configuredSize[1]),
      Math.max(0.05, configuredSize[2]),
    )
    : sourceSize

  // O sistema de colisão do mundo também trata os colisores simplificados como
  // geometria local deslocada; este AABB é usado pelo player para movimento e pouso.
  if (type === 'sphere') {
    const radius = Math.max(size.x, size.y, size.z) * 0.5
    size.setScalar(radius * 2)
  } else if (type === 'capsule') {
    const radius = Math.max(0.025, Math.min(size.x, size.z) * 0.25)
    size.set(Math.max(size.x, radius * 2), Math.max(size.y, radius * 2), Math.max(size.z, radius * 2))
  }

  const localBounds = new THREE.Box3(
    new THREE.Vector3(-size.x / 2 + offset[0], -size.y / 2 + offset[1], -size.z / 2 + offset[2]),
    new THREE.Vector3(size.x / 2 + offset[0], size.y / 2 + offset[1], size.z / 2 + offset[2]),
  )
  return localBounds.applyMatrix4(mesh.matrixWorld)
}

/** Avatar humanoide controlável por teclado, com gravidade e colisões com terreno/objetos. */
export class HumanoidAvatar {
  readonly mesh = new THREE.Group()
  private readonly visualRoot = new THREE.Group()
  private disposed = false
  private mixer: THREE.AnimationMixer | null = null
  private animationActions = new Map<string, THREE.AnimationAction>()
  private activeAnimation = ''
  private animationTime = 0
  private animatedBones: Array<{ node: THREE.Object3D; name: string; baseX: number; baseZ: number }> = []
  private proceduralLimbs: { leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; leftShoe: THREE.Mesh; rightShoe: THREE.Mesh; torso: THREE.Mesh } | null = null
  private readonly world: World
  private readonly cameraTarget: THREE.Vector3
  private readonly getCameraYaw: () => number
  private readonly pressed = new Set<string>()
  private readonly activeCollisions = new Map<string, { a: string; b: string }>()
  private verticalVelocity = 0
  private grounded = true
  private enabled = true
  private firstPersonMode = false
  private readonly firstPersonHiddenBones = new Map<THREE.Bone, THREE.Vector3>()
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // O movimento do avatar funciona tanto em primeira quanto em terceira pessoa.
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
    this.visualRoot.name = 'Avatar visual'
    this.mesh.add(this.visualRoot)

    const skin = new THREE.MeshStandardMaterial({ color: 0xd7a078, roughness: 0.85 })
    const shirt = new THREE.MeshStandardMaterial({ color: 0x2878c8, roughness: 0.8 })
    const pants = new THREE.MeshStandardMaterial({ color: 0x263e61, roughness: 0.9 })
    const shoes = new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.8 })
    const hair = new THREE.MeshStandardMaterial({ color: 0x39291f, roughness: 1 })
    const addPart = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale?: [number, number, number], parent: THREE.Object3D = this.visualRoot) => {
      const part = new THREE.Mesh(geometry, material)
      part.name = name
      part.position.set(...position)
      if (scale) part.scale.set(...scale)
      part.castShadow = true
      part.receiveShadow = true
      parent.add(part)
      return part
    }

    // Cabeça, cabelo e pescoço.
    addPart('head', new THREE.SphereGeometry(0.19, 16, 12), skin, [0, 1.57, 0])
    addPart('hair', new THREE.SphereGeometry(0.195, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, 1.65, -0.015])
    addPart('neck', new THREE.CylinderGeometry(0.065, 0.07, 0.12, 10), skin, [0, 1.34, 0])
    // Tronco e membros articulados: os pivôs permitem animar cada bloco proceduralmente.
    const torso = addPart('torso', new THREE.BoxGeometry(0.48, 0.58, 0.27), shirt, [0, 1.02, 0])
    const leftArm = new THREE.Group()
    leftArm.name = 'left-arm-pivot'
    leftArm.position.set(-0.27, 1.2, 0)
    this.visualRoot.add(leftArm)
    addPart('left-arm', new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), shirt, [-0.045, -0.17, 0], undefined, leftArm)
    addPart('left-hand', new THREE.SphereGeometry(0.07, 10, 8), skin, [-0.045, -0.39, 0], undefined, leftArm)
    const rightArm = new THREE.Group()
    rightArm.name = 'right-arm-pivot'
    rightArm.position.set(0.27, 1.2, 0)
    this.visualRoot.add(rightArm)
    addPart('right-arm', new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), shirt, [0.045, -0.17, 0], undefined, rightArm)
    addPart('right-hand', new THREE.SphereGeometry(0.07, 10, 8), skin, [0.045, -0.39, 0], undefined, rightArm)

    const leftLeg = new THREE.Group()
    leftLeg.name = 'left-leg-pivot'
    leftLeg.position.set(-0.13, 0.66, 0)
    this.visualRoot.add(leftLeg)
    addPart('left-leg', new THREE.CapsuleGeometry(0.095, 0.36, 4, 8), pants, [0, -0.19, 0], undefined, leftLeg)
    const leftShoe = addPart('left-shoe', new THREE.BoxGeometry(0.17, 0.1, 0.27), shoes, [0, -0.49, 0.045], undefined, leftLeg)
    const rightLeg = new THREE.Group()
    rightLeg.name = 'right-leg-pivot'
    rightLeg.position.set(0.13, 0.66, 0)
    this.visualRoot.add(rightLeg)
    addPart('right-leg', new THREE.CapsuleGeometry(0.095, 0.36, 4, 8), pants, [0, -0.19, 0], undefined, rightLeg)
    const rightShoe = addPart('right-shoe', new THREE.BoxGeometry(0.17, 0.1, 0.27), shoes, [0, -0.49, 0.045], undefined, rightLeg)
    this.proceduralLimbs = { leftArm, rightArm, leftLeg, rightLeg, leftShoe, rightShoe, torso }

    this.mesh.position.set(0, world.terrain.heightAt(0, 0), 0)
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) child.userData.avatarPart = true
    })
    this.world.scene.add(this.mesh)
    void this.loadSketchfabModel()
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
    const running = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight')
    const speed = WALK_SPEED * (running ? RUN_MULTIPLIER : 1)

    if (this.pressed.has('Space') && this.grounded) {
      this.verticalVelocity = JUMP_SPEED
      this.grounded = false
    }
    this.verticalVelocity -= GRAVITY * step
    const oldY = this.mesh.position.y
    const wasGrounded = this.grounded
    const nextY = oldY + this.verticalVelocity * step
    const terrainY = this.world.terrain.heightAt(this.mesh.position.x, this.mesh.position.z)

    // Movimento relativo à orientação horizontal da câmera.
    if (length > 0) {
      const direction = new THREE.Vector3(
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

    // Mantém contato com rampas descendentes: sem essa tolerância, a gravidade
    // deixa o avatar alguns frames no ar e alterna walk/jump rapidamente.
    const terrainDrop = oldY - newGroundY
    const canFollowSlopeDown = wasGrounded &&
      length > 0 &&
      this.verticalVelocity <= 0 &&
      terrainDrop >= -0.08 &&
      terrainDrop <= Math.max(0.32, speed * step * 1.5)

    if (nextY <= newGroundY || canFollowSlopeDown) {
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

    this.updateAvatarAnimation(step, length > 0, running)
    this.updateCollisionEvents()
    // A câmera acompanha o personagem, mantendo o ângulo e a distância atuais.
    if (this.firstPersonMode) {
      this.cameraTarget.x = this.mesh.position.x
      // Mantém a câmera na altura dos olhos relativa aos pés do avatar,
      // acompanhando pulos e mudanças de nível do terreno/plataformas.
      this.cameraTarget.y = this.mesh.position.y + 1
      this.cameraTarget.z = this.mesh.position.z
    } else {
      this.cameraTarget.x = THREE.MathUtils.lerp(this.cameraTarget.x, this.mesh.position.x, 0.12)
      this.cameraTarget.z = THREE.MathUtils.lerp(this.cameraTarget.z, this.mesh.position.z, 0.12)
    }
  }

  setFirstPersonMode(enabled: boolean): void {
    this.firstPersonMode = enabled
    this.visualRoot.visible = true
    const headPartPattern = /head|hair|face|neck|jaw|eye|teeth|tongue|cabe[cç]a|cabelo|rosto|pesco[cç]o|mand[ií]bula|olho|dente|l[ií]ngua/i
    this.visualRoot.traverse((child) => {
      const partName = child.name
      if (headPartPattern.test(partName)) {
        child.visible = !enabled
      }

      // Alguns GLBs juntam cabeça e corpo numa única malha skinned.
      // Nesses modelos, esconder só o objeto não basta: desativa também
      // os ossos da cabeça/pescoço, restaurando a escala ao sair do modo.
      if (child instanceof THREE.Bone && headPartPattern.test(partName)) {
        if (enabled) {
          if (!this.firstPersonHiddenBones.has(child)) {
            this.firstPersonHiddenBones.set(child, child.scale.clone())
          }
          child.scale.set(0, 0, 0)
        } else {
          const originalScale = this.firstPersonHiddenBones.get(child)
          if (originalScale) child.scale.copy(originalScale)
        }
      }
    })
    if (!enabled) this.firstPersonHiddenBones.clear()
    this.pressed.clear()
    if (enabled) {
      this.cameraTarget.x = this.mesh.position.x
      this.cameraTarget.z = this.mesh.position.z
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.pressed.clear()
  }

  resetVerticalState(): void {
    this.verticalVelocity = 0
    this.grounded = true
    this.pressed.clear()
    this.activeCollisions.clear()
    this.animationTime = 0
    this.playAnimation('idle')
  }

  reset(): void {
    this.mesh.position.set(0, this.world.terrain.heightAt(0, 0), 0)
    this.verticalVelocity = 0
    this.grounded = true
    this.pressed.clear()
    this.activeCollisions.clear()
    this.animationTime = 0
    this.playAnimation('idle')
  }

  dispose(): void {
    this.disposed = true
    this.mixer?.stopAllAction()
    this.animationActions.clear()
    this.animatedBones = []
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

  /** Carrega o GLB enviado no commit, mantendo o avatar procedural como fallback. */
  private async loadSketchfabModel(): Promise<void> {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}models/dummy.zip`)
      if (!response.ok) throw new Error(`Não foi possível carregar o modelo (HTTP ${response.status}).`)
      const archive = await response.arrayBuffer()
      const view = new DataView(archive)
      if (view.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50) {
        throw new Error('O arquivo do avatar não é um ZIP válido.')
      }
      const compression = view.getUint16(8, true)
      const compressedSize = view.getUint32(18, true)
      const nameLength = view.getUint16(26, true)
      const extraLength = view.getUint16(28, true)
      if (compression !== 0) throw new Error('O ZIP do avatar usa uma compressão não suportada.')
      const dataStart = 30 + nameLength + extraLength
      if (dataStart + compressedSize > view.byteLength) throw new Error('O GLB dentro do ZIP está incompleto.')
      const glb = archive.slice(dataStart, dataStart + compressedSize)

      const loader = new GLTFLoader()
      loader.parse(glb, '', (gltf) => {
        if (this.disposed) {
          this.disposeObject(gltf.scene)
          return
        }
        const bounds = new THREE.Box3().setFromObject(gltf.scene)
        const size = bounds.getSize(new THREE.Vector3())
        if (size.y <= 0) {
          this.disposeObject(gltf.scene)
          return
        }

        // Padroniza o personagem para 1,8 m e apoia os pés na origem local.
        gltf.scene.scale.setScalar(PLAYER_HEIGHT / size.y)
        gltf.scene.updateMatrixWorld(true)
        const normalizedBounds = new THREE.Box3().setFromObject(gltf.scene)
        const center = normalizedBounds.getCenter(new THREE.Vector3())
        gltf.scene.position.x -= center.x
        gltf.scene.position.y -= normalizedBounds.min.y
        gltf.scene.position.z -= center.z
        this.mixer = new THREE.AnimationMixer(gltf.scene)
        this.animationActions.clear()
        for (const clip of gltf.animations) {
          const key = this.classifyAnimation(clip.name)
          if (!this.animationActions.has(key)) this.animationActions.set(key, this.mixer.clipAction(clip))
        }
        this.animatedBones = []
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Bone || /arm|leg|thigh|calf|foot|hand|spine|hips|pelvis/i.test(child.name)) {
            this.animatedBones.push({ node: child, name: child.name.toLowerCase(), baseX: child.rotation.x, baseZ: child.rotation.z })
          }
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
            child.userData.avatarPart = true
          }
        })

        for (const child of [...this.visualRoot.children]) this.disposeObject(child)
        this.visualRoot.clear()
        this.proceduralLimbs = null
        this.visualRoot.add(gltf.scene)
        // O modelo GLB é carregado de forma assíncrona; reaplica o modo atual
        // para esconder a cabeça também quando o avatar termina de carregar.
        this.setFirstPersonMode(this.firstPersonMode)
        // O estado idle pode ter sido definido antes de o GLB terminar de carregar.
        // Força a ativação do primeiro clipe do modelo já carregado.
        this.activeAnimation = ''
        this.playAnimation('idle')
      }, (error) => {
        console.warn('[Engine Prometheus] Não foi possível carregar o avatar Dummy; mantendo o modelo de reserva.', error)
      })
    } catch (error) {
      console.warn('[Engine Prometheus] Falha ao carregar o avatar Dummy; mantendo o modelo de reserva.', error)
    }
  }

  private classifyAnimation(name: string): string {
    const normalized = name.toLowerCase()
    if (/jump|leap|fall/.test(normalized)) return 'jump'
    if (/run|sprint/.test(normalized)) return 'run'
    if (/walk|locomotion|move/.test(normalized)) return 'walk'
    if (/idle|stand|breath/.test(normalized)) return 'idle'
    return 'other'
  }

  private playAnimation(state: 'idle' | 'walk' | 'run' | 'jump'): void {
    if (!this.mixer) return
    if (this.activeAnimation === state) return

    const next = this.animationActions.get(state)
      ?? (state === 'run' ? this.animationActions.get('walk') : undefined)
      ?? this.animationActions.get('idle')

    // Evita reiniciar o mesmo clipe a cada troca de estado (por exemplo, run -> walk
    // quando ambos apontam para o mesmo clipe) e mistura as poses suavemente.
    const current = this.animationActions.get(this.activeAnimation)
    if (current && current === next) {
      this.activeAnimation = state
      return
    }

    if (next) {
      if (state === 'jump') {
        next.setLoop(THREE.LoopOnce, 1)
        next.clampWhenFinished = true
      } else {
        next.setLoop(THREE.LoopRepeat, Infinity)
        next.clampWhenFinished = false
      }
      next.reset().fadeIn(0.2).play()
    }
    for (const action of this.animationActions.values()) {
      if (action !== next && action.isRunning()) action.fadeOut(0.2)
    }
    this.activeAnimation = state
  }

  private updateAvatarAnimation(dt: number, moving: boolean, running: boolean): void {
    this.animationTime += dt * (running ? 12 : 8)
    const state = !this.grounded ? 'jump' : moving ? (running ? 'run' : 'walk') : 'idle'
    this.playAnimation(state)
    this.mixer?.update(dt)

    // Alguns clipes de corrida animam novamente os ossos da cabeça depois
    // que o modo primeira pessoa os esconde. Reaplica a máscara após o mixer
    // em todos os frames para impedir que a cabeça volte a aparecer ao correr.
    if (this.firstPersonMode && this.firstPersonHiddenBones.size > 0) {
      for (const bone of this.firstPersonHiddenBones.keys()) {
        bone.scale.set(0, 0, 0)
      }
    }

    // Usa animação procedural quando não existe um clipe adequado para o estado atual.
    // Isso evita deixar o avatar deslizando caso o GLB tenha apenas um clipe genérico.
    const hasStateClip = this.animationActions.has(state)
      || (state === 'run' && this.animationActions.has('walk'))
      || this.animationActions.has('idle')
    if (hasStateClip) return
    const movingNow = moving && this.grounded
    const amplitude = movingNow ? (running ? 0.75 : 0.42) : 0.035
    const swing = Math.sin(this.animationTime) * amplitude
    if (this.proceduralLimbs) {
      const limbs = this.proceduralLimbs
      limbs.leftLeg.rotation.x = swing
      limbs.rightLeg.rotation.x = -swing
      limbs.leftArm.rotation.x = -swing * 0.72
      limbs.rightArm.rotation.x = swing * 0.72

      // Inclina o corpo em relação à inclinação real do terreno, amostrando a altura
      // em quatro pontos próximos ao avatar; os pés recebem ajustes independentes.
      const x = this.mesh.position.x
      const z = this.mesh.position.z
      const sample = 0.28
      const centerY = this.world.terrain.heightAt(x, z)
      const slopeX = (this.world.terrain.heightAt(x + sample, z) - this.world.terrain.heightAt(x - sample, z)) / (sample * 2)
      const slopeZ = (this.world.terrain.heightAt(x, z + sample) - this.world.terrain.heightAt(x, z - sample)) / (sample * 2)
      const yaw = this.mesh.rotation.y
      const localSlopeX = slopeX * Math.cos(yaw) - slopeZ * Math.sin(yaw)
      const localSlopeZ = slopeX * Math.sin(yaw) + slopeZ * Math.cos(yaw)
      const targetTiltX = THREE.MathUtils.clamp(localSlopeZ, -0.45, 0.45)
      const targetTiltZ = THREE.MathUtils.clamp(-localSlopeX, -0.45, 0.45)
      this.visualRoot.rotation.x = THREE.MathUtils.damp(this.visualRoot.rotation.x, targetTiltX, 7, dt)
      this.visualRoot.rotation.z = THREE.MathUtils.damp(this.visualRoot.rotation.z, targetTiltZ, 7, dt)

      const leftGround = this.world.terrain.heightAt(x - Math.cos(yaw) * 0.13, z + Math.sin(yaw) * 0.13)
      const rightGround = this.world.terrain.heightAt(x + Math.cos(yaw) * 0.13, z - Math.sin(yaw) * 0.13)
      const footAdjustLeft = THREE.MathUtils.clamp(leftGround - centerY, -0.18, 0.18)
      const footAdjustRight = THREE.MathUtils.clamp(rightGround - centerY, -0.18, 0.18)
      limbs.leftShoe.position.y = -0.49 + footAdjustLeft
      limbs.rightShoe.position.y = -0.49 + footAdjustRight
      const bob = movingNow ? Math.abs(Math.sin(this.animationTime * 2)) * (running ? 0.055 : 0.028) : Math.sin(this.animationTime * 0.5) * 0.012
      this.visualRoot.position.y = bob
      limbs.torso.rotation.x = movingNow ? Math.sin(this.animationTime * 2) * 0.025 : 0
    }
    for (const bone of this.animatedBones) {
      if (/left.*(leg|thigh|calf)|thigh.*left|leg.*left/.test(bone.name)) bone.node.rotation.x = bone.baseX + swing
      else if (/right.*(leg|thigh|calf)|thigh.*right|leg.*right/.test(bone.name)) bone.node.rotation.x = bone.baseX - swing
      else if (/left.*(arm|hand)|arm.*left/.test(bone.name)) bone.node.rotation.x = bone.baseX - swing * 0.65
      else if (/right.*(arm|hand)|arm.*right/.test(bone.name)) bone.node.rotation.x = bone.baseX + swing * 0.65
      else if (/spine|hips|pelvis/.test(bone.name)) bone.node.rotation.z = bone.baseZ + (movingNow ? Math.sin(this.animationTime * 2) * 0.025 : 0)
    }
    if (!this.proceduralLimbs) {
      if (!movingNow && this.grounded) this.visualRoot.position.y = Math.sin(this.animationTime * 0.5) * 0.012
      else this.visualRoot.position.y = 0
    }
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
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

  /**
   * Colisão por contato com os triângulos reais das malhas, em coordenadas de mundo.
   * Faces superiores são piso/rampa; laterais e inferiores bloqueiam o jogador.
   * O AABB é usado somente para descartar malhas distantes rapidamente.
   */
  /**
   * Verifica contato com polígonos reais, limitando o custo por frame:
   * usa bounds para broad phase e testa somente triângulos próximos ao jogador.
   */
  private collidesWithObjects(): boolean {
    const playerBox = this.playerBox()
    const center = new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + PLAYER_HEIGHT * 0.5, this.mesh.position.z)
    const radiusSq = PLAYER_RADIUS * PLAYER_RADIUS
    const triangle = new THREE.Triangle()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const closest = new THREE.Vector3()
    const normal = new THREE.Vector3()

    for (const object of this.world.list()) {
      const root = object.mesh
      if (!root.visible || root.userData.colliderType === 'none') continue
      root.updateWorldMatrix(true, true)

      const meshes: THREE.Mesh[] = []
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.visible) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        if (root.userData.importedModel === true && child === root) return
        meshes.push(child)
      })

      for (const mesh of meshes) {
        const geometry = mesh.geometry
        const position = geometry.getAttribute('position')
        if (!position || position.count < 3) continue
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingBox) continue

        const bounds = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
        bounds.min.x -= PLAYER_RADIUS
        bounds.max.x += PLAYER_RADIUS
        bounds.min.y -= PLAYER_HEIGHT
        bounds.max.y += PLAYER_RADIUS
        bounds.min.z -= PLAYER_RADIUS
        bounds.max.z += PLAYER_RADIUS
        if (!playerBox.intersectsBox(bounds)) continue

        const index = geometry.getIndex()
        const triangleCount = Math.floor((index ? index.count : position.count) / 3)
        for (let i = 0; i < triangleCount; i++) {
          const ia = index ? index.getX(i * 3) : i * 3
          const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1
          const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2
          a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld)
          b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld)
          c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld)
          triangle.set(a, b, c)
          triangle.getNormal(normal).normalize()

          // Faces caminháveis não devem agir como paredes.
          if (normal.y >= 0.45) continue
          triangle.closestPointToPoint(center, closest)
          if (center.distanceToSquared(closest) < radiusSq) return true
        }
      }
    }
    return false
  }

  private findObjectLanding(oldY: number, nextY: number): number | null {
    const playerBox = this.playerBox()
    let landing: number | null = null

    // Detecta a superfície real de objetos inclinados (rampas) com um raio
    // vertical. Isso evita usar o AABB, cuja altura máxima não representa a rampa.
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    const slopeCandidates = this.world.list().filter((object) =>
      object.mesh.visible &&
      object.mesh.userData.colliderType !== 'none' &&
      (
        Math.abs(object.mesh.rotation.x) > 0.02 ||
        Math.abs(object.mesh.rotation.z) > 0.02 ||
        (object.mesh.userData.colliderType === 'auto' && object.mesh.userData.importedModel === true)
      ),
    )
    if (slopeCandidates.length > 0) {
      raycaster.ray.origin.set(this.mesh.position.x, Math.max(oldY, nextY) + PLAYER_HEIGHT + 2, this.mesh.position.z)
      const hits = raycaster.intersectObjects(slopeCandidates.map(object => object.mesh), true)
      for (const hit of hits) {
        if (!hit.face) continue
        const object = slopeCandidates.find(candidate => candidate.mesh === hit.object || candidate.mesh.getObjectById(hit.object.id))
        if (!object) continue
        // A raiz de um modelo importado é uma caixa proxy invisível. Nunca use sua
        // face superior como chão: o pouso automático deve vir da malha visual filha.
        if (object.mesh.userData.importedModel === true && hit.object === object.mesh) continue
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
        const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
        if (normal.y < 0.45) continue

        const surfaceY = hit.point.y
        const rise = surfaceY - oldY
        const canStepOntoSlope = this.grounded && rise >= -0.3 && rise <= 0.5
        const crossedSurface = nextY <= surfaceY && oldY >= surfaceY - 0.12
        if (!canStepOntoSlope && !crossedSurface) continue
        if (landing === null || surfaceY > landing) landing = surfaceY
        break
      }
    }

    // Objetos não inclinados continuam usando o colisor configurado.
    if (nextY > oldY) return landing
    for (const object of this.world.list()) {
      if (!object.mesh.visible) continue
      const rotatedRamp = Math.abs(object.mesh.rotation.x) > 0.02 || Math.abs(object.mesh.rotation.z) > 0.02
      if (rotatedRamp) continue
      const box = getColliderBounds(object.mesh)
      if (!box) continue
      const horizontalOverlap = playerBox.max.x > box.min.x && playerBox.min.x < box.max.x &&
        playerBox.max.z > box.min.z && playerBox.min.z < box.max.z
      if (!horizontalOverlap || oldY < box.max.y - 0.08 || nextY > box.max.y) continue
      if (landing === null || box.max.y > landing) landing = box.max.y
    }
    return landing
  }

  private hasVolumeOverlap(a: THREE.Box3, b: THREE.Box3): boolean {
    const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)
    const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)
    const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)
    return overlapX > 0.02 && overlapY > 0.02 && overlapZ > 0.02
  }

  private updateCollisionEvents(): void {
    const playerBox = this.playerBox()
    const next = new Map<string, { a: string; b: string }>()
    for (const object of this.world.list()) {
      if (!object.mesh.visible) continue
      const box = getColliderBounds(object.mesh)
      if (!box || !this.hasVolumeOverlap(playerBox, box)) continue
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
