import * as THREE from 'three'
import type { HumanoidAvatar } from './HumanoidAvatar'
import type { World } from './World'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import horseModelUrl from '../../low_poly_horse.glb?url'
import horseRiderModelUrl from '../../low_poly_horse_rider.glb?url'

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
  private mountProgress = 0
  private mountStart = new THREE.Vector3()
  private readonly proceduralBones: Array<{ node: THREE.Bone; name: string; rotation: THREE.Euler }> = []
  private readonly proceduralNodes: Array<{ node: THREE.Object3D; name: string; rotation: THREE.Euler; position: THREE.Vector3 }> = []
  private importedModel: THREE.Object3D | null = null
  private componentModelPivot: THREE.Group | null = null
  private riderModel: THREE.Object3D | null = null
  private riderMixer: THREE.AnimationMixer | null = null
  private horseMixer: THREE.AnimationMixer | null = null
  private readonly horseAnimationActions = new Map<'idle' | 'walk' | 'run' | 'turn-left' | 'turn-right', THREE.AnimationAction>()
  private readonly riderAnimationActions = new Map<'idle' | 'walk' | 'run', THREE.AnimationAction>()
  private activeHorseAnimation: 'idle' | 'walk' | 'run' | 'turn-left' | 'turn-right' | '' = ''
  private activeRiderAnimation: 'idle' | 'walk' | 'run' | '' = ''
  private readonly mountRaycaster = new THREE.Raycaster()
  private readonly mountDown = new THREE.Vector3(0, -1, 0)
  private readonly mountSeatLocal = new THREE.Vector3(0, 0, -0.07)
  private readonly mountLeftLocal = new THREE.Vector3(-0.39, 0, -0.07)
  private readonly mountRightLocal = new THREE.Vector3(0.39, 0, -0.07)
  private parkedComponent: THREE.Mesh | null = null
  private editorComponent: THREE.Mesh | null = null
  private parkedComponentHeight = HORSE_HEIGHT
  private readonly mountColliderSize = new THREE.Vector3(0.95, 1.35, 1.6)
  private readonly mountColliderOffset = new THREE.Vector3()

  constructor(world: World, avatar: HumanoidAvatar, cameraTarget: THREE.Vector3, getCameraYaw: () => number) {
    this.world = world
    this.avatar = avatar
    this.avatar.setExternalCollider(this.mesh)
    // Colisor físico independente da geometria visual importada do cavalo.
    // A origem do grupo fica no chão; por isso o centro do colisor sobe 0,8 m.
    this.mesh.userData.colliderType = 'box'
    this.mesh.userData.colliderSize = [0.95, 1.35, 1.6]
    this.mesh.userData.colliderOffset = [0, 0.8, 0]
    this.cameraTarget = cameraTarget
    this.getCameraYaw = getCameraYaw
    this.buildModel()
    this.loadCommittedHorseModel()
    this.loadHorseRiderModel()
    this.mesh.name = 'LowPolyHorse'
    this.mesh.visible = false
    this.world.scene.add(this.mesh)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  /** Vincula a representação do editor ao mesmo cavalo animado usado no runtime. */
  setEditorComponent(component: THREE.Mesh | null): void {
    if (this.componentModelPivot && this.componentModelPivot.parent) {
      this.componentModelPivot.parent.remove(this.componentModelPivot)
      this.componentModelPivot = null
    }
    this.editorComponent = component
    this.parkedComponent = component
    if (!component) {
      if (this.importedModel && this.importedModel.parent !== this.mesh) this.mesh.add(this.importedModel)
      if (!this.enabled) this.mesh.visible = false
      this.syncMountedVisuals()
      return
    }
    component.userData.nativeComponentType = 'horse'
    component.userData.nativeHorseComponent = true
    component.userData.componentId = 'builtin-horse-low-poly'
    const configuredHeight = Number(component.userData.importedModelHeight)
    const componentHeight = Number.isFinite(configuredHeight) && configuredHeight > 0
      ? configuredHeight : HORSE_HEIGHT
    component.userData.importedModelHeight = componentHeight
    this.parkedComponentHeight = componentHeight
    const configuredSize = component.userData.colliderSize
    this.mesh.userData.colliderSize = Array.isArray(configuredSize) && configuredSize.length === 3
      ? [...configuredSize]
      : [0.95, 1.35, 1.6]
    const configuredOffset = component.userData.colliderOffset
    this.mesh.userData.colliderOffset = Array.isArray(configuredOffset) && configuredOffset.length === 3
      ? [configuredOffset[0], configuredOffset[1] + componentHeight / 2, configuredOffset[2]]
      : [0, componentHeight / 2, 0]
    this.mesh.visible = true
    this.syncTransformFromComponent()
    this.loadEmbeddedHorseModel(component)
  }

  /**
   * Prefere o asset incorporado no próprio componente. O GLB bundled só é usado
   * como fallback para projetos antigos que ainda não guardam os bytes do modelo.
   */
  private loadEmbeddedHorseModel(component: THREE.Mesh): void {
    const encoded = component.userData.importedModelData
    if (typeof encoded !== 'string' || encoded.length === 0) return
    try {
      const binary = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer
      new GLTFLoader().parse(binary, '', (gltf) => {
        if (this.editorComponent !== component || !this.mesh.parent) {
          this.disposeLoadedModel(gltf.scene)
          return
        }
        const model = gltf.scene
        model.name = 'ComponentHorseGLB'
        model.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(model)
        const size = bounds.getSize(new THREE.Vector3())
        const targetHeight = Number(component.userData.importedModelHeight) > 0
          ? Number(component.userData.importedModelHeight) : HORSE_HEIGHT
        if (!bounds.isEmpty() && size.y > 0.0001) {
          model.scale.multiplyScalar(targetHeight / size.y)
          model.updateMatrixWorld(true)
          const normalized = new THREE.Box3().setFromObject(model)
          const center = normalized.getCenter(new THREE.Vector3())
          model.position.x -= center.x
          model.position.y -= normalized.min.y
          model.position.z -= center.z
        }
        const previous = this.importedModel
        if (previous) {
          previous.parent?.remove(previous)
          this.disposeLoadedModel(previous)
        }
        // O modelo editável passa a ser filho da raiz selecionável do mundo.
        // O pivô compensa a origem central do componente: o GLB normalizado
        // começa no chão, enquanto a raiz editável fica no centro do colisor.
        const pivot = new THREE.Group()
        pivot.name = 'HorseComponentVisual'
        pivot.position.y = -targetHeight / 2
        component.add(pivot)
        pivot.add(model)
        this.componentModelPivot = pivot
        // O HorseMount conserva apenas o conjunto de montaria/fallback. A malha
        // editável é a que o editor e o projeto realmente possuem.
        for (const child of [...this.mesh.children]) {
          if (child === this.riderModel) continue
          this.mesh.remove(child)
          this.disposeLoadedModel(child)
        }
        this.legs.length = 0
        this.tailRoot = null
        this.importedModel = model
        this.horseMixer?.stopAllAction()
        this.horseMixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null
        this.horseAnimationActions.clear()
        this.activeHorseAnimation = ''
        for (const clip of gltf.animations) {
          const name = clip.name.toLowerCase().replace(/[\s._-]+/g, '')
          const key = /turnleft|leftturn|pivotleft|rotateleft/.test(name) ? 'turn-left'
            : /turnright|rightturn|pivotright|rotateright/.test(name) ? 'turn-right'
              : /gallop|canter|run|sprint/.test(name) ? 'run'
                : /walk|trot|locomotion|move/.test(name) ? 'walk'
                  : /idle|stand|rest|breath|neutral/.test(name) ? 'idle' : null
          if (key && this.horseMixer && !this.horseAnimationActions.has(key)) {
            this.horseAnimationActions.set(key, this.horseMixer.clipAction(clip))
          }
        }
        if (!this.horseAnimationActions.size && gltf.animations[0] && this.horseMixer) {
          this.horseAnimationActions.set('idle', this.horseMixer.clipAction(gltf.animations[0]))
        }
        model.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true
            node.receiveShadow = true
          }
        })
        this.playHorseAnimation('idle')
        this.mesh.updateMatrixWorld(true)
        this.syncMountedVisuals()
      }, (error) => {
        console.error('[HorseMount] Não foi possível carregar o GLB incorporado ao componente.', error)
      })
    } catch (error) {
      console.error('[HorseMount] Dados GLB incorporados inválidos; mantendo o modelo de fallback.', error)
    }
  }

  private disposeLoadedModel(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.geometry.dispose()
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((material) => material.dispose())
    })
  }

  private syncTransformFromComponent(): void {
    const component = this.editorComponent
    if (!component) return
    this.mesh.position.set(
      component.position.x,
      component.position.y - this.parkedComponentHeight / 2,
      component.position.z,
    )
    this.mesh.rotation.set(component.rotation.x, component.rotation.y, component.rotation.z)
    this.mesh.scale.copy(component.scale)
    this.mesh.updateMatrixWorld(true)
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
    // Usa o novo cavalo GLB do projeto; o modelo procedural permanece como fallback.
    new GLTFLoader().load(
      horseModelUrl,
      (gltf) => {
          // Se o componente já fornece o seu próprio GLB, nunca substitua esse
          // asset pelo arquivo bundled quando a requisição antiga terminar.
          if (typeof this.editorComponent?.userData.importedModelData === 'string'
            && this.editorComponent.userData.importedModelData.length > 0) {
            this.disposeLoadedModel(gltf.scene)
            return
          }
          const model = gltf.scene;
          if (!this.mesh.parent) {
            this.disposeLoadedModel(gltf.scene)
            return
          }
          model.name = 'CommittedHorseGLB'
          // Normaliza o tamanho com escala uniforme: mantém as proporções do FBX
          // e limita a altura total do cavalo a aproximadamente 2,05 unidades do mundo.
          // Centraliza a base para que os cascos assentem no terreno e o colisor
          // acompanhe corretamente o centro do cavalo.
          model.updateMatrixWorld(true)
          const originalBounds = new THREE.Box3().setFromObject(model)
          const originalSize = originalBounds.getSize(new THREE.Vector3())
          if (originalSize.y > 0.0001) {
            model.scale.multiplyScalar(HORSE_HEIGHT / originalSize.y)
            model.updateMatrixWorld(true)
            const normalizedBounds = new THREE.Box3().setFromObject(model)
            const center = normalizedBounds.getCenter(new THREE.Vector3())
            model.position.x -= center.x
            model.position.y -= normalizedBounds.min.y
            model.position.z -= center.z
            model.updateMatrixWorld(true)
          }

          for (const child of [...this.mesh.children]) {
            if (child === model || child === this.riderModel) continue
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
          model.visible = !this.mounted
          const horseMixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null
          this.horseMixer = horseMixer
          this.horseAnimationActions.clear()
          this.activeHorseAnimation = ''
          for (const clip of gltf.animations) {
            const name = clip.name.toLowerCase().replace(/[\\s._-]+/g, '')
            const key = /turnleft|leftturn|pivotleft|rotateleft/.test(name) ? 'turn-left'
              : /turnright|rightturn|pivotright|rotateright/.test(name) ? 'turn-right'
                : /gallop|canter|run|sprint/.test(name) ? 'run'
                  : /walk|trot|locomotion|move/.test(name) ? 'walk'
                    : /idle|stand|rest|breath|neutral/.test(name) ? 'idle' : null
            if (key && !this.horseAnimationActions.has(key)) {
              if (horseMixer) this.horseAnimationActions.set(key, horseMixer.clipAction(clip))
            }
          }
          if (!this.horseAnimationActions.size && gltf.animations[0] && horseMixer) {
            this.horseAnimationActions.set('idle', horseMixer.clipAction(gltf.animations[0]))
          }
          console.info(`[HorseMount] low_poly_horse.glb: ${gltf.animations.length} animação(ões).`, gltf.animations.map((clip, index) => ({ index, name: clip.name || `(sem nome ${index + 1})`, duration: Number(clip.duration.toFixed(2)), tracks: clip.tracks.length })))
          this.playHorseAnimation('idle')
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
          console.info('[HorseMount] Novo cavalo GLB carregado.')
          this.syncMountedVisuals()
      },
      undefined,
      (error) => console.error('[HorseMount] Não foi possível carregar low_poly_horse.glb; usando o cavalo procedural integrado.', error),
    )
  }

  private playHorseAnimation(state: 'idle' | 'walk' | 'run' | 'turn-left' | 'turn-right'): void {
    if (this.activeHorseAnimation === state) return
    const next = this.horseAnimationActions.get(state)
      ?? (state === 'run' ? this.horseAnimationActions.get('walk') : undefined)
      ?? (state === 'turn-left' || state === 'turn-right' ? this.horseAnimationActions.get('walk') : undefined)
      ?? this.horseAnimationActions.get('idle')
      ?? this.horseAnimationActions.values().next().value
    if (!next) return
    next.setLoop(THREE.LoopRepeat, Infinity)
    next.reset().fadeIn(0.18).play()
    for (const action of this.horseAnimationActions.values()) {
      if (action !== next) action.fadeOut(0.18)
    }
    this.activeHorseAnimation = state
  }

  private playRiderAnimation(state: 'idle' | 'walk' | 'run'): void {
    if (this.activeRiderAnimation === state) return
    const next = this.riderAnimationActions.get(state)
      ?? (state === 'run' ? this.riderAnimationActions.get('walk') : undefined)
      ?? this.riderAnimationActions.get('idle')
      ?? this.riderAnimationActions.values().next().value
    if (!next) return
    next.setLoop(THREE.LoopRepeat, Infinity)
    next.reset().fadeIn(0.18).play()
    for (const action of this.riderAnimationActions.values()) {
      if (action !== next) action.fadeOut(0.18)
    }
    this.activeRiderAnimation = state
  }

  private loadHorseRiderModel(): void {
    // O GLB combinado é a representação visual quando o jogador está montado.
    new GLTFLoader().load(
      horseRiderModelUrl,
      (gltf) => {
        if (!this.mesh.parent) {
          this.disposeLoadedModel(gltf.scene)
          return
        }
        const model = gltf.scene
        model.name = 'HorseWithRiderGLB'
        model.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(model)
        const size = bounds.getSize(new THREE.Vector3())
        // Mantém o cavaleiro em escala humana aproximada e apoia o conjunto no chão.
        // A altura total inclui o jogador, por isso é maior que a do cavalo isolado.
        if (size.y > 0.0001) {
          model.scale.multiplyScalar(2.95 / size.y)
          model.updateMatrixWorld(true)
          const normalized = new THREE.Box3().setFromObject(model)
          const center = normalized.getCenter(new THREE.Vector3())
          model.position.x -= center.x
          model.position.y -= normalized.min.y
          model.position.z -= center.z
        }
        model.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true
            node.receiveShadow = true
          }
        })
        this.riderModel = model
        this.mesh.add(model)
        this.riderMixer = new THREE.AnimationMixer(model)
        this.riderAnimationActions.clear()
        this.activeRiderAnimation = ''
        for (const clip of gltf.animations) {
          const name = clip.name.toLowerCase().replace(/[\\s._-]+/g, '')
          const key = /gallop|canter|run|sprint/.test(name) ? 'run'
            : /walk|trot|locomotion|move/.test(name) ? 'walk'
              : /idle|stand|rest|breath|neutral/.test(name) ? 'idle' : null
          if (key && !this.riderAnimationActions.has(key)) {
            this.riderAnimationActions.set(key, this.riderMixer.clipAction(clip))
          }
        }
        if (!this.riderAnimationActions.size && gltf.animations[0]) {
          this.riderAnimationActions.set('idle', this.riderMixer.clipAction(gltf.animations[0]))
        }
        console.info(`[HorseMount] low_poly_horse_rider.glb: ${gltf.animations.length} animação(ões).`, gltf.animations.map((clip, index) => ({ index, name: clip.name || `(sem nome ${index + 1})`, duration: Number(clip.duration.toFixed(2)), tracks: clip.tracks.length })))
        this.playRiderAnimation('idle')
        this.syncMountedVisuals()
        console.info('[HorseMount] Modelo combinado de cavalo e cavaleiro carregado.')
      },
      undefined,
      (error) => console.error('[HorseMount] Não foi possível carregar low_poly_horse_rider.glb; durante a montaria será usado o avatar separado.', error),
    )
  }

  private syncMountedVisuals(): void {
    // Usa o GLB combinado quando disponível. Enquanto ele carrega (ou se falhar),
    // mantém o cavalo isolado visível e usa o avatar separado como cavaleiro.
    for (const child of this.mesh.children) {
      child.visible = this.mounted && this.riderModel
        ? child === this.riderModel
        : child !== this.riderModel
    }
    // O GLB anexado à raiz editável é a representação em repouso; ao montar,
    // esconde-o para não sobrepor o GLB combinado com cavaleiro.
    if (this.componentModelPivot) this.componentModelPivot.visible = !this.mounted
    if (this.riderModel && this.mounted) this.avatar.mesh.visible = false
    else if (this.mounted) this.avatar.mesh.visible = true
  }

  private disposeLoadedModel(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.geometry.dispose()
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((material) => material.dispose())
    })
  }

  private updateProceduralAnimation(_dt: number, moving: boolean): void {
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

  /**
   * Colisão poligonal do cavalo: usa os triângulos visíveis dos objetos,
   * igual ao avatar, com vários pontos distribuídos pelo volume corporal.
   */
  private collidesAt(x: number, z: number): boolean {
    const groundY = this.world.terrain.heightAt(x, z)
    const yaw = this.mesh.rotation.y
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    // Reaproveita as dimensões configuradas no inspetor do componente montável.
    const halfLength = Math.max(0.55, this.mountColliderSize.z * 0.38)
    const halfWidth = Math.max(0.28, this.mountColliderSize.x * 0.34)
    const lowY = Math.max(0.38, this.mountColliderSize.y * 0.32)
    const midY = Math.max(lowY + 0.12, this.mountColliderSize.y * 0.62)
    const highY = Math.max(midY + 0.08, Math.min(1.65, this.mountColliderSize.y * 0.82))
    const frontBackRadius = Math.max(0.3, Math.min(0.48, this.mountColliderSize.x * 0.43))
    const sideRadius = Math.max(0.28, Math.min(0.46, this.mountColliderSize.z * 0.22))
    const samples = [
      { offset: forward.clone().multiplyScalar(halfLength), y: lowY, radius: frontBackRadius },
      { offset: forward.clone().multiplyScalar(halfLength * 0.55), y: midY, radius: frontBackRadius },
      { offset: new THREE.Vector3(), y: highY, radius: frontBackRadius },
      { offset: forward.clone().multiplyScalar(-halfLength * 0.55), y: midY, radius: frontBackRadius },
      { offset: forward.clone().multiplyScalar(-halfLength), y: lowY, radius: frontBackRadius },
      { offset: right.clone().multiplyScalar(halfWidth), y: midY * 0.82, radius: sideRadius },
      { offset: right.clone().multiplyScalar(-halfWidth), y: midY * 0.82, radius: sideRadius },
    ]
    const triangle = new THREE.Triangle()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const closest = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const worldSamples = samples.map((sample) => ({
      center: new THREE.Vector3(x + sample.offset.x, groundY + sample.y, z + sample.offset.z)
        .add(new THREE.Vector3(this.mountColliderOffset.x, this.mountColliderOffset.y, this.mountColliderOffset.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)),
      radiusSq: sample.radius * sample.radius,
    }))

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
        let candidate = false
        for (const sample of worldSamples) {
          const r = Math.sqrt(sample.radiusSq)
          if (
            sample.center.x + r >= bounds.min.x && sample.center.x - r <= bounds.max.x &&
            sample.center.y + r >= bounds.min.y && sample.center.y - r <= bounds.max.y &&
            sample.center.z + r >= bounds.min.z && sample.center.z - r <= bounds.max.z
          ) {
            candidate = true
            break
          }
        }
        if (!candidate) continue

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
          // Faces de piso não bloqueiam a locomoção horizontal; faces laterais e
          // inferiores continuam sólidas, como no colisor do personagem.
          if (normal.y >= 0.45) continue
          for (const sample of worldSamples) {
            triangle.closestPointToPoint(sample.center, closest)
            if (sample.center.distanceToSquared(closest) < sample.radiusSq) return true
          }
        }
      }
    }
    return false
  }

  setRuntimeMode(enabled: boolean, playerPosition?: THREE.Vector3): void {
    this.enabled = enabled
    this.pressed.clear()
    if (!enabled) {
      this.dismount(false)
      this.parkedComponent = this.editorComponent
      this.mesh.visible = !!this.editorComponent
      if (this.editorComponent) this.syncTransformFromComponent()
      return
    }

    // Se o Cavalo Low Poly da biblioteca estiver colocado no mundo, use sua
    // posição e seus parâmetros de colisão como ponto de partida da montaria.
    // O componente permanece no mundo como raiz editável; o cavalo visual nativo
    // acompanha sua transformação e a raiz acompanha a posição durante a montaria.
    const placedHorse = this.world.list()
      .filter(object => object.mesh.visible && (
        object.mesh.userData.nativeComponentType === 'horse' ||
        object.mesh.userData.nativeHorseComponent === true ||
        object.mesh.userData.componentId === 'builtin-horse-low-poly' ||
        object.name.trim().toLowerCase() === 'cavalo low poly'
      ))
      .sort((a, b) => {
        if (!playerPosition) return 0
        return a.mesh.position.distanceToSquared(playerPosition) - b.mesh.position.distanceToSquared(playerPosition)
      })[0]

    this.parkedComponent = placedHorse?.mesh ?? this.editorComponent
    this.editorComponent = this.parkedComponent
    if (this.parkedComponent) {
      const component = this.parkedComponent
      this.parkedComponentHeight = Number(component.userData.importedModelHeight) > 0
        ? Number(component.userData.importedModelHeight) : HORSE_HEIGHT
      const colliderSize = component.userData.colliderSize
      if (Array.isArray(colliderSize) && colliderSize.length === 3 && colliderSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
        this.mountColliderSize.set(
          Math.max(0.1, colliderSize[0] * Math.abs(component.scale.x)),
          Math.max(0.1, colliderSize[1] * Math.abs(component.scale.y)),
          Math.max(0.1, colliderSize[2] * Math.abs(component.scale.z)),
        )
      }
      const colliderOffset = component.userData.colliderOffset
      if (Array.isArray(colliderOffset) && colliderOffset.length === 3 && colliderOffset.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
        this.mountColliderOffset.set(
          colliderOffset[0] * component.scale.x,
          colliderOffset[1] * component.scale.y,
          colliderOffset[2] * component.scale.z,
        )
      } else {
        this.mountColliderOffset.set(0, 0, 0)
      }
      this.mesh.position.set(
        component.position.x,
        this.world.terrain.heightAt(component.position.x, component.position.z),
        component.position.z,
      )
      this.mesh.rotation.set(0, component.rotation.y, 0)
      component.visible = true
      this.mesh.scale.copy(component.scale)
    } else if (playerPosition) {
      this.mountColliderSize.set(0.95, 1.35, 1.6)
      this.mountColliderOffset.set(0, 0, 0)
      const yaw = this.getCameraYaw()
      const x = THREE.MathUtils.clamp(playerPosition.x + Math.cos(yaw) * 3, -47, 47)
      const z = THREE.MathUtils.clamp(playerPosition.z - Math.sin(yaw) * 3, -47, 47)
      this.mesh.position.set(x, this.world.terrain.heightAt(x, z), z)
      this.mesh.rotation.y = yaw + Math.PI
    }
    this.mesh.visible = true
  }

  update(dt: number): void {
    if (!this.mesh.visible) return
    const step = Math.min(Math.max(dt, 0), 0.05)
    if (!this.enabled) {
      this.syncTransformFromComponent()
      this.animationTime += step
      if (this.horseMixer) {
        this.playHorseAnimation('idle')
        this.horseMixer.update(step)
      } else {
        this.updateProceduralAnimation(step, false)
      }
      return
    }
    const forward = Number(this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) - Number(this.pressed.has('KeyS') || this.pressed.has('ArrowDown'))
    const side = Number(this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) - Number(this.pressed.has('KeyA') || this.pressed.has('ArrowLeft'))
    const moving = this.mounted && (forward !== 0 || side !== 0)
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
    if (this.parkedComponent) {
      this.parkedComponent.position.set(
        this.mesh.position.x,
        groundY + this.parkedComponentHeight * Math.abs(this.mesh.scale.y) / 2,
        this.mesh.position.z,
      )
      this.parkedComponent.rotation.y = this.mesh.rotation.y
      this.parkedComponent.scale.copy(this.mesh.scale)
      this.parkedComponent.updateMatrixWorld(true)
    }
    this.animationTime += step * (this.galloping ? 15 : 8)
    if (this.horseMixer) {
      const turningLeft = this.pressed.has('KeyA') || this.pressed.has('ArrowLeft')
      const turningRight = this.pressed.has('KeyD') || this.pressed.has('ArrowRight')
      const horseState = moving
        ? (this.galloping ? 'run' : 'walk')
        : turningLeft && !turningRight ? 'turn-left'
          : turningRight && !turningLeft ? 'turn-right' : 'idle'
      this.playHorseAnimation(horseState)
      this.horseMixer.update(step)
    } else {
      this.updateProceduralAnimation(step, moving)
    }
    if (this.riderMixer) {
      this.playRiderAnimation(this.galloping ? 'run' : moving ? 'walk' : 'idle')
      this.riderMixer.update(step)
    }
    this.legs.forEach((leg, index) => {
      const phase = index === 0 || index === 3 ? 0 : Math.PI
      leg.rotation.x = Math.sin(this.animationTime + phase) * (moving ? (this.galloping ? 0.78 : 0.38) : 0.025)
    })
    this.mesh.position.y += moving ? Math.abs(Math.sin(this.animationTime * 2)) * (this.galloping ? 0.09 : 0.035) : 0
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, side * -0.055, 5, step)
    this.mesh.rotation.x = THREE.MathUtils.damp(this.mesh.rotation.x, moving ? Math.sin(this.animationTime * 2) * (this.galloping ? 0.035 : 0.015) : 0, 5, step)
    if (this.tailRoot) this.tailRoot.rotation.x = Math.sin(this.animationTime * 0.7) * (moving ? 0.22 : 0.08)

    if (this.mounted) {
      // A origem do avatar fica nos pés; posicionamos o quadril sobre a sela,
      // com o tronco erguido e as pernas inclinadas para os flancos do cavalo.
      // Usa os próprios triângulos do cavalo para descobrir a altura do assento
      // e onde cada perna encontra o flanco, em vez de assumir uma altura fixa.
      const surface = this.sampleMountSurfaces()
      const seatHeight = surface.seatY
      const riderOffset = new THREE.Vector3(0, seatHeight - 0.96, -0.07)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y)
      const target = new THREE.Vector3(
        this.mesh.position.x + riderOffset.x,
        groundY + riderOffset.y,
        this.mesh.position.z + riderOffset.z,
      )
      this.mountProgress = THREE.MathUtils.damp(this.mountProgress, 1, 5.5, step)
      const easedProgress = this.mountProgress * this.mountProgress * (3 - 2 * this.mountProgress)
      const gait = moving ? Math.sin(this.animationTime * (this.galloping ? 2.0 : 1.35)) : Math.sin(this.animationTime * 0.6) * 0.12
      this.avatar.setMountedPose(
        easedProgress,
        gait,
        surface.seatY - surface.leftY,
        surface.seatY - surface.rightY,
      )
      this.avatar.mesh.position.lerpVectors(this.mountStart, target, easedProgress)
      // O corpo acompanha o movimento do cavalo com um balanço pequeno e contínuo.
      this.avatar.mesh.position.y += Math.sin(Math.PI * easedProgress) * 0.48
      this.avatar.mesh.position.y += easedProgress * gait * (this.galloping ? 0.045 : 0.018)
      this.avatar.mesh.rotation.y = this.mesh.rotation.y
      this.cameraTarget.set(this.mesh.position.x, groundY + seatHeight + 0.75, this.mesh.position.z)
    }
  }

  /**
   * Amostra o topo e os dois flancos do cavalo por raycast contra os polígonos
   * renderizados. O fallback usa os mesmos raycasts sobre a malha procedural.
   */
  private sampleMountSurfaces(): { seatY: number; leftY: number; rightY: number } {
    this.mesh.updateWorldMatrix(true, true)
    this.editorComponent?.updateWorldMatrix(true, true)
    const bounds = new THREE.Box3().setFromObject(this.importedModel ?? this.mesh)
    const top = bounds.max.y + 1.5
    const sample = (localX: number): number | null => {
      const local = new THREE.Vector3(localX, 0, -0.07)
      const worldXZ = this.mesh.localToWorld(local.clone())
      // O raio é vertical no mundo; manter Y em coordenada mundial evita que
      // a rotação do cavalo incline a origem do teste junto com o corpo.
      const origin = new THREE.Vector3(worldXZ.x, top, worldXZ.z)
      this.mountRaycaster.set(origin, this.mountDown)
      this.mountRaycaster.far = Math.max(3, bounds.max.y - bounds.min.y + 3)
      const hits = this.mountRaycaster.intersectObject(this.importedModel ?? this.mesh, true)
      const hit = hits.find((entry) => entry.object.visible && entry.object.userData.editorOverlay !== true)
      return hit ? this.mesh.worldToLocal(hit.point.clone()).y : null
    }
    const seat = sample(0) ?? HORSE_HEIGHT * 0.78
    const left = sample(-0.39) ?? seat - 0.3
    const right = sample(0.39) ?? seat - 0.3
    // O topo pode atingir dorso/garupa acima da sela. Limita a altura a uma faixa
    // plausível relativa ao tamanho do modelo, sem modificar a malha do cavalo.
    const minSeat = (bounds.min.y - this.mesh.position.y) + (bounds.max.y - bounds.min.y) * 0.48
    const maxSeat = (bounds.min.y - this.mesh.position.y) + (bounds.max.y - bounds.min.y) * 0.86
    const seatY = THREE.MathUtils.clamp(seat, minSeat, maxSeat)
    return {
      seatY,
      leftY: THREE.MathUtils.clamp(left, seatY - 0.75, seatY - 0.08),
      rightY: THREE.MathUtils.clamp(right, seatY - 0.75, seatY - 0.08),
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.repeat) return
    if (this.mounted && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      this.pressed.add(event.code)
      if (event.code.startsWith('Arrow')) event.preventDefault()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => { this.pressed.delete(event.code) }
  private onBlur = (): void => { this.pressed.clear() }

  /** Executado por uma ação do Visual Script; requer modo Run e proximidade segura. */
  get isMounted(): boolean { return this.mounted }

  executeNodeAction(action: 'mount' | 'dismount' | 'toggle', objectId?: string): void {
    if (!this.enabled) return
    const target = objectId ? this.world.get(objectId)?.mesh : undefined
    const isHorseTarget = objectId
      ? !!target && (
        target.userData.nativeComponentType === 'horse' ||
        target.userData.nativeHorseComponent === true ||
        target.userData.componentId === 'builtin-horse-low-poly'
      )
      : true
    if (!isHorseTarget) return

    // Uma tecla pode disparar regras de vários objetos. Apenas o cavalo atualmente
    // montado pode desmontar o jogador; eventos de outros cavalos não o alternam.
    if (action === 'dismount' || (action === 'toggle' && this.mounted)) {
      if (this.mounted && (!target || target === this.editorComponent)) this.dismount(true)
      return
    }
    if (this.mounted) return

    const targetPosition = target?.position ?? this.mesh.position
    if (this.avatar.mesh.position.distanceTo(targetPosition) >= 3.4) return
    if (target && target !== this.editorComponent) {
      this.editorComponent = target as THREE.Mesh
      this.parkedComponent = target as THREE.Mesh
      this.parkedComponentHeight = Number(target.userData.importedModelHeight) > 0
        ? Number(target.userData.importedModelHeight)
        : HORSE_HEIGHT
      this.syncTransformFromComponent()
    }
    if (this.mesh.visible) this.mount()
  }

  private mount(): void {
    this.mounted = true
    this.mountProgress = 0
    this.mountStart.copy(this.avatar.mesh.position)
    this.avatar.setEnabled(false)
    this.avatar.mesh.visible = true
    this.avatar.setMountedPose(0)
    this.syncMountedVisuals()
    this.cameraTarget.set(this.mesh.position.x, this.mesh.position.y + HORSE_HEIGHT + 0.25, this.mesh.position.z)
    this.pressed.clear()
  }

  private dismount(restorePlayer: boolean): void {
    if (!this.mounted) return
    this.mounted = false
    this.pressed.clear()

    // Encerra a pose de montaria imediatamente. Se mountProgress continuar
    // diminuindo no update(), a pose sentada será reaplicada por vários frames
    // depois de o avatar já ter sido reativado, deixando o jogador rígido.
    this.mountProgress = 0
    this.avatar.setMountedPose(0)
    this.syncMountedVisuals()

    if (restorePlayer) {
      // O ponto fixo ao lado do cavalo podia deixar o jogador parcialmente dentro
      // da malha real (principalmente quando o cavalo era girado ou redimensionado).
      // Procura uma posição livre ao redor do modelo, respeitando colisões do mundo.
      this.mesh.updateWorldMatrix(true, true)
      const horseBounds = new THREE.Box3().setFromObject(this.importedModel ?? this.mesh)
      const horseSize = horseBounds.getSize(new THREE.Vector3())
      const clearance = Math.max(1.55, Math.max(horseSize.x, horseSize.z) * 0.5 + 0.55)
      const directions = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(1, 0, 1).normalize(),
        new THREE.Vector3(-1, 0, 1).normalize(),
        new THREE.Vector3(1, 0, -1).normalize(),
        new THREE.Vector3(-1, 0, -1).normalize(),
      ]
      let exit: THREE.Vector3 | null = null
      for (const extra of [0, 0.65, 1.3]) {
        for (const direction of directions) {
          const x = THREE.MathUtils.clamp(this.mesh.position.x + direction.x * (clearance + extra), -48, 48)
          const z = THREE.MathUtils.clamp(this.mesh.position.z + direction.z * (clearance + extra), -48, 48)
          if (this.avatar.canOccupyPosition(x, z)) {
            exit = new THREE.Vector3(x, this.world.terrain.heightAt(x, z), z)
            break
          }
        }
        if (exit) break
      }
      // Em um espaço totalmente cercado, ainda afasta o jogador do cavalo.
      if (!exit) {
        const fallback = directions[0]!.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y)
        const x = THREE.MathUtils.clamp(this.mesh.position.x + fallback.x * (clearance + 1.3), -48, 48)
        const z = THREE.MathUtils.clamp(this.mesh.position.z + fallback.z * (clearance + 1.3), -48, 48)
        exit = new THREE.Vector3(x, this.world.terrain.heightAt(x, z), z)
      }
      this.avatar.mesh.position.copy(exit)
      this.avatar.mesh.visible = true
      this.avatar.setEnabled(true)
      this.avatar.resetVerticalState()
      this.cameraTarget.set(exit.x, exit.y + 0.9, exit.z)
    } else {
      this.avatar.setEnabled(false)
    }
  }

  isMounted(): boolean { return this.mounted }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)

    this.horseMixer?.stopAllAction()
    this.riderMixer?.stopAllAction()
    this.horseMixer = null
    this.riderMixer = null
    this.horseAnimationActions.clear()
    this.riderAnimationActions.clear()

    // O GLB em repouso vive na raiz editável, fora de this.mesh. Retire-o
    // explicitamente para não deixar uma malha órfã na cena ao trocar de mundo.
    this.componentModelPivot?.parent?.remove(this.componentModelPivot)
    this.componentModelPivot = null
    if (this.importedModel && this.importedModel.parent && this.importedModel.parent !== this.mesh) {
      this.importedModel.parent.remove(this.importedModel)
      this.disposeLoadedModel(this.importedModel)
    }
    this.importedModel = null

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
