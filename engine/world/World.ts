import * as THREE from 'three'
import { EventBus } from './events/EventBus'
import type { EngineEvents } from './events/types'
import type { GameObject, ObjectInfo, ObjectPatch } from '../model/object/GameObject'
import { PRIMITIVE_DEFS } from '../model/object/defs'
import { applyFaceTextures, applyTexturePreset, createPrimitive } from '../model/object/Primitives'
import type { TexturePreset } from '../model/object/Primitives'
import { TERRAIN_ID, TerrainMesh } from './map/TerrainMesh'
import { DEFAULT_SEED } from './worldGeneration/Heightfield'
import { clamp } from '../lib/math'
import { reserveId } from '../lib/id'
import type { ObjectType, TerrainData } from '../project/format'
import { getEntity as toEntity } from '../model/entity/Entity'
import type { Entity } from '../model/entity/Entity'

export interface TerrainInfo {
  visible: boolean
  seed: number
  edits: number
}

const BACKGROUND = 0x12151c
const TERRAIN_FOG_CORNERS = [
  { x: -50, z: -50 },
  { x: -50, z: 50 },
  { x: 50, z: -50 },
  { x: 50, z: 50 },
] as const

export class World {
  readonly scene = new THREE.Scene()
  readonly events = new EventBus<EngineEvents>()
  readonly terrain = new TerrainMesh(DEFAULT_SEED)
  private grid = new THREE.GridHelper(100, 100, 0x4a5060, 0x2a2f3a)
  private objects = new Map<string, GameObject>()
  private readonly worldFog = new THREE.Fog(BACKGROUND, 42, 68)
  private worldFogEnabled = true
  private fogDistanceScale = 1
  private readonly fogNightColor = new THREE.Color(0x080d22)
  private readonly fogDawnColor = new THREE.Color(0xe58b67)
  private readonly fogDayColor = new THREE.Color(0x87b9e8)
  private readonly horizonColor = new THREE.Color()
  private readonly fogCorner = new THREE.Vector3()
  private renderDistance: number | null = 72
  private renderDistanceDirty = true
  private readonly dirtyRenderDistanceObjectIds = new Set<string>()
  private hasRenderDistanceCameraPosition = false
  private readonly lastRenderDistanceCameraPosition = new THREE.Vector3()
  private readonly renderDistanceCameraPosition = new THREE.Vector3()
  private readonly renderDistanceCenter = new THREE.Vector3()
  private readonly renderDistanceScale = new THREE.Vector3()
  private grassOcclusionRootsCache: THREE.Object3D[] | null = null
  private selectedId: string | null = null
  private gridVisible = true
  private skyBackgroundTexture: THREE.Texture | null = null
  private skyTextureDataUrl = ''
  private timeOfDay = 12
  private cycleEnabled = false
  private cycleSpeed = 0.1
  private hemisphereLight!: THREE.HemisphereLight
  private sunLight!: THREE.DirectionalLight
  private fillLight!: THREE.DirectionalLight
  private proceduralSky!: THREE.Group
  private stars!: THREE.Points
  private sunVisual!: THREE.Mesh
  private moonVisual!: THREE.Mesh

  constructor() {
    this.terrain.grass.onRenderChanged = () => this.events.emit('renderInvalidated', undefined)
    this.scene.background = new THREE.Color(BACKGROUND)
    this.scene.fog = this.worldFog
    this.updateGrassFogDistance(72)
    this.scene.add(this.terrain.mesh)
    this.scene.add(this.terrain.grass.mesh)
    this.grid.visible = true
    this.grid.position.y = 0.015
    this.grid.renderOrder = 2
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]
    for (const material of gridMaterials) {
      material.transparent = true
      material.opacity = 0.42
      material.depthWrite = false
      material.depthTest = false
    }
    this.scene.add(this.grid)
    // Iluminação um pouco mais próxima da prévia de importação, para manter
    // materiais PBR e cores de árvores/texturas legíveis no viewport principal.
    this.hemisphereLight = new THREE.HemisphereLight(0xe4edff, 0x55515a, 1.5)
    this.scene.add(this.hemisphereLight)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.0)
    this.sunLight.position.set(30, 50, 20)
    this.scene.add(this.sunLight)
    this.fillLight = new THREE.DirectionalLight(0x9dbaff, 0.55)
    this.fillLight.position.set(-30, 18, -24)
    this.scene.add(this.fillLight)
    // Céu procedural usado quando o projeto não possui uma imagem de céu.
    // Os elementos ficam longe do terreno e não dependem de arquivos externos.
    this.proceduralSky = new THREE.Group()
    this.proceduralSky.name = 'ProceduralSky'
    const starPositions: number[] = []
    let starSeed = 0x4a17c9
    const randomStar = () => {
      starSeed = (Math.imul(starSeed, 1664525) + 1013904223) >>> 0
      return starSeed / 4294967296
    }
    for (let i = 0; i < 900; i += 1) {
      const y = randomStar() * 2 - 1
      const angle = randomStar() * Math.PI * 2
      const horizontal = Math.sqrt(1 - y * y)
      const radius = 118 + randomStar() * 4
      starPositions.push(
        Math.cos(angle) * horizontal * radius,
        y * radius,
        Math.sin(angle) * horizontal * radius,
      )
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    const starMaterial = new THREE.PointsMaterial({
      color: 0xeaf2ff,
      size: 0.72,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
    })
    this.stars = new THREE.Points(starGeometry, starMaterial)
    this.stars.name = 'SkyStars'
    this.stars.renderOrder = 10
    this.proceduralSky.add(this.stars)

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0bd, fog: false, depthWrite: false })
    this.sunVisual = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 16), sunMaterial)
    this.sunVisual.name = 'SkySun'
    this.sunVisual.renderOrder = 11
    this.proceduralSky.add(this.sunVisual)

    const moonMaterial = new THREE.MeshBasicMaterial({ color: 0xdce7ff, fog: false, depthWrite: false })
    this.moonVisual = new THREE.Mesh(new THREE.SphereGeometry(2.35, 20, 16), moonMaterial)
    this.moonVisual.name = 'SkyMoon'
    this.moonVisual.renderOrder = 11
    this.proceduralSky.add(this.moonVisual)
    this.scene.add(this.proceduralSky)
    this.applyDayNight()
  }

  getEnvironment() {
    return { skyTextureDataUrl: this.skyTextureDataUrl, timeOfDay: this.timeOfDay, cycleEnabled: this.cycleEnabled, cycleSpeed: this.cycleSpeed }
  }

  setEnvironment(settings: { skyTextureDataUrl?: string; timeOfDay?: number; cycleEnabled?: boolean; cycleSpeed?: number }): void {
    if (settings.skyTextureDataUrl !== undefined && settings.skyTextureDataUrl !== this.skyTextureDataUrl) {
      this.skyTextureDataUrl = settings.skyTextureDataUrl
      // O fundo da cena é renderizado pelo próprio Three.js, sem depender de uma
      // esfera gigante que pode ficar atrás do fundo, do fog ou dos limites da câmera.
      if (this.skyBackgroundTexture) {
        this.skyBackgroundTexture.dispose()
        this.skyBackgroundTexture = null
      }
      if (this.skyTextureDataUrl) {
        const requestedDataUrl = this.skyTextureDataUrl
        new THREE.TextureLoader().load(requestedDataUrl, (texture) => {
          // Ignora respostas antigas se o usuário trocou/removeu a imagem durante o carregamento.
          if (this.skyTextureDataUrl !== requestedDataUrl) {
            texture.dispose()
            return
          }
          texture.colorSpace = THREE.SRGBColorSpace
          texture.mapping = THREE.EquirectangularReflectionMapping
          texture.needsUpdate = true
          this.skyBackgroundTexture = texture
          this.scene.background = texture
          this.proceduralSky.visible = false
          this.events.emit('renderInvalidated', undefined)
        }, undefined, (error) => {
          console.error('[World] Não foi possível carregar a textura do céu:', error)
          if (this.skyTextureDataUrl === requestedDataUrl) {
            this.skyTextureDataUrl = ''
            this.applyDayNight()
            this.events.emit('renderInvalidated', undefined)
          }
        })
      }
    }
    if (settings.timeOfDay !== undefined && Number.isFinite(settings.timeOfDay)) this.timeOfDay = Math.max(0, Math.min(24, settings.timeOfDay))
    if (settings.cycleEnabled !== undefined) this.cycleEnabled = settings.cycleEnabled
    if (settings.cycleSpeed !== undefined && Number.isFinite(settings.cycleSpeed)) this.cycleSpeed = Math.max(0.01, Math.min(4, settings.cycleSpeed))
    this.applyDayNight()
    this.events.emit('renderInvalidated', undefined)
  }

  updateEnvironment(dt: number): void {
    if (this.cycleEnabled && Number.isFinite(dt) && dt > 0) {
      this.timeOfDay = (this.timeOfDay + dt * this.cycleSpeed) % 24
      this.applyDayNight()
    }
  }

  private applyDayNight(): void {
    const angle = (this.timeOfDay / 24) * Math.PI * 2 - Math.PI / 2
    const daylight = Math.max(0, Math.sin(angle))
    this.sunLight.position.set(Math.cos(angle) * 60, Math.sin(angle) * 60, 20)
    this.sunLight.intensity = 0.04 + daylight * 2.2
    this.sunLight.color.setRGB(1, 0.72 + daylight * 0.25, 0.48 + daylight * 0.52)
    this.hemisphereLight.intensity = 0.18 + daylight * 1.35
    this.hemisphereLight.color.set(daylight > 0.1 ? 0xc8e4ff : 0x18294f)
    this.hemisphereLight.groundColor.set(daylight > 0.1 ? 0x625b4d : 0x090d20)
    this.fillLight.intensity = 0.08 + (1 - daylight) * 0.35

    // Sol e lua percorrem o céu em sentidos opostos conforme o horário.
    const skyRadius = 105
    this.sunVisual.position.set(Math.cos(angle) * skyRadius, Math.sin(angle) * skyRadius, -18)
    this.moonVisual.position.set(-Math.cos(angle) * skyRadius, -Math.sin(angle) * skyRadius, -18)
    this.proceduralSky.visible = !this.skyTextureDataUrl
    this.stars.visible = !this.skyTextureDataUrl && daylight < 0.28
    this.moonVisual.visible = !this.skyTextureDataUrl && daylight < 0.32
    this.sunVisual.visible = !this.skyTextureDataUrl && daylight > 0.02
    // Reaproveita as mesmas cores em cada frame do ciclo dia/noite.
    if (daylight < 0.18) {
      this.horizonColor.copy(this.fogNightColor).lerp(this.fogDawnColor, daylight / 0.18)
    } else {
      this.horizonColor.copy(this.fogDawnColor).lerp(this.fogDayColor, Math.min(1, (daylight - 0.18) / 0.82))
    }
    // A neblina usa a mesma cor do horizonte para disfarçar o limite da grama.
    // Com céu em imagem, usamos a paleta de horário como cor de mistura de materiais.
    this.worldFog.color.copy(this.horizonColor)
    if (!this.skyTextureDataUrl) this.scene.background = this.horizonColor
  }

  // ---- objetos ----
  /** Lista estável de raízes candidatas à oclusão da grama; cacheada entre frames. */
  grassOcclusionRoots(): readonly THREE.Object3D[] {
    if (!this.grassOcclusionRootsCache) {
      this.grassOcclusionRootsCache = [...this.objects.values()].map((object) => object.mesh)
    }
    return this.grassOcclusionRootsCache
  }

  private invalidateGrassOcclusionRoots(): void {
    this.grassOcclusionRootsCache = null
    this.terrain.grass.invalidateOcclusion()
  }

  add(obj: GameObject): GameObject {
    reserveId(obj.id)
    this.initializeObjectRenderVisibility(obj)
    this.scene.add(obj.mesh)
    this.objects.set(obj.id, obj)
    this.renderDistanceDirty = true
    this.invalidateGrassOcclusionRoots()
    this.events.emit('objectAdded', { id: obj.id })
    return obj
  }

  /** Cria um objeto apoiado em baseY (a altura do chão naquele ponto) e o seleciona. */
  place(type: ObjectType, x: number, baseY: number, z: number): GameObject {
    const half = PRIMITIVE_DEFS[type].size[1] / 2
    const obj = this.add(createPrimitive(type, { position: [x, baseY + half, z] }))
    this.select(obj.id)
    return obj
  }

  remove(id: string): void {
    const obj = this.objects.get(id)
    if (!obj) return
    if (this.selectedId === id) this.select(null)
    this.dispose(obj)
    this.objects.delete(id)
    this.dirtyRenderDistanceObjectIds.delete(id)
    this.invalidateGrassOcclusionRoots()
    this.events.emit('objectRemoved', { id })
  }

  rename(id: string, name: string): void {
    const obj = this.objects.get(id)
    const clean = name.trim()
    if (!obj || clean === '' || clean === obj.name) return
    obj.name = clean
    this.events.emit('objectRenamed', { id, name: clean })
  }

  update(id: string, patch: ObjectPatch): void {
    const obj = this.objects.get(id)
    if (!obj) return
    const m = obj.mesh
    const transformFields = patch.x !== undefined || patch.y !== undefined || patch.z !== undefined || patch.rotationX !== undefined || patch.rotationY !== undefined || patch.rotationZ !== undefined || patch.scale !== undefined || patch.scaleX !== undefined || patch.scaleY !== undefined || patch.scaleZ !== undefined
    if (m.userData.locked === true && transformFields) {
      const safePatch = { ...patch }
      delete safePatch.x; delete safePatch.y; delete safePatch.z
      delete safePatch.rotationX; delete safePatch.rotationY; delete safePatch.rotationZ
      delete safePatch.scale; delete safePatch.scaleX; delete safePatch.scaleY; delete safePatch.scaleZ
      patch = safePatch
    }
    const ok = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n)
    if (ok(patch.x)) m.position.x = clamp(patch.x, -50, 50)
    if (ok(patch.y)) m.position.y = clamp(patch.y, -50, 100)
    if (ok(patch.z)) m.position.z = clamp(patch.z, -50, 50)
    if (ok(patch.rotationX)) m.rotation.x = (patch.rotationX * Math.PI) / 180
    if (ok(patch.rotationY)) m.rotation.y = (patch.rotationY * Math.PI) / 180
    if (ok(patch.rotationZ)) m.rotation.z = (patch.rotationZ * Math.PI) / 180
    // Modelos importados (GLB/GLTF) podem precisar de escala muito maior
    // que primitivas criadas no editor. Mantenha o limite antigo nas primitivas
    // e permita escala de até 10.000 nos modelos importados.
    const maxScale = m.userData.importedModel === true ? 10000 : 20
    if (ok(patch.scale)) {
      const s = clamp(patch.scale, 0.1, maxScale)
      m.scale.set(s, s, s)
    }
    if (ok(patch.scaleX)) m.scale.x = clamp(patch.scaleX, 0.1, maxScale)
    if (ok(patch.scaleY)) m.scale.y = clamp(patch.scaleY, 0.1, maxScale)
    if (ok(patch.scaleZ)) m.scale.z = clamp(patch.scaleZ, 0.1, maxScale)
    if (ok(patch.color)) {
      m.userData.baseColor = patch.color
      if (m.userData.importedModel === true) {
        // A caixa proxy é invisível. A cor precisa ser aplicada às malhas reais
        // sem apagar a cor/textura original: branco restaura a aparência do GLB.
        m.userData.importedTint = patch.color
        const tint = new THREE.Color(patch.color)
        m.traverse((child) => {
          if (!(child instanceof THREE.Mesh) || child === m) return
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) {
            const colorMaterial = material as THREE.Material & { color?: THREE.Color }
            if (!colorMaterial.color) continue
            const saved = material.userData.importOriginalColor as number | undefined
            if (saved === undefined) material.userData.importOriginalColor = colorMaterial.color.getHex()
            // A cor escolhida no inspetor substitui o fator de cor do material.
            // Branco restaura o fator original do GLB; cores escuras/vermelhas não
            // são multiplicadas por uma cor-base anterior, o que poderia apagá-las.
            if (tint.getHex() === 0xffffff) {
              colorMaterial.color.setHex(material.userData.importOriginalColor as number)
            } else {
              colorMaterial.color.copy(tint)
            }
            material.needsUpdate = true
          }
        })
      } else {
        const materials = Array.isArray(m.material) ? m.material : [m.material]
        for (const material of materials) {
          const standard = material as THREE.MeshStandardMaterial
          standard.color?.setHex(patch.color)
        }
      }
    }
    if (patch.texturePreset !== undefined && ['none', 'grass', 'stone', 'brick', 'wood', 'sand', 'metal'].includes(patch.texturePreset)) {
      applyTexturePreset(m, patch.texturePreset as TexturePreset, typeof m.userData.textureRepeat === 'number' ? m.userData.textureRepeat : 2)
    }
    if (patch.textureRepeat !== undefined && Number.isFinite(patch.textureRepeat)) {
      const preset = m.userData.texturePreset as TexturePreset | undefined
      applyTexturePreset(m, preset ?? 'none', clamp(patch.textureRepeat, 1, 8))
    }
    if (patch.faceTextures !== undefined) applyFaceTextures(m, patch.faceTextures)
    if (patch.faceTexture !== undefined) {
      const current = { ...(m.userData.faceTextures as import('../project/format').FaceTextureMap | undefined) }
      if (patch.faceTexture.value) current[patch.faceTexture.face] = patch.faceTexture.value
      else delete current[patch.faceTexture.face]
      applyFaceTextures(m, current)
    }
    if (patch.visible !== undefined) {
      m.userData.renderDistanceBaseVisible = patch.visible
      m.visible = patch.visible && m.userData.renderDistanceCulled !== true
      this.dirtyRenderDistanceObjectIds.add(id)
    }
    if (transformFields) this.dirtyRenderDistanceObjectIds.add(id)
    if (patch.locked !== undefined) m.userData.locked = patch.locked
    const wireframeVisible = patch.wireframeVisible
    if (wireframeVisible !== undefined) {
      m.userData.wireframeVisible = wireframeVisible
      // Não gere WireframeGeometry ao desativar linhas, especialmente durante
      // a abertura do projeto. Criar e descartar linhas para cada GLB custa CPU
      // e memória mesmo quando o usuário não quer visualizar o wireframe.
      m.traverse((child) => {
        // Modelos importados usam a raiz Mesh apenas como proxy invisível para
        // seleção/transformação. Desenhar o wireframe dessa caixa cria linhas
        // retas ao redor do cavalo em vez de seguir a geometria real do GLB.
        if (
          !(child instanceof THREE.Mesh)
          || child.userData.editorOverlay === true
          || (child === m && m.userData.importedModel === true)
        ) return
        // WireframeGeometry congela os vértices na pose de bind. Em SkinnedMesh,
        // os vértices visuais são deformados pelos ossos na GPU, mas uma LineSegments
        // comum não recebe skinIndex/skinWeight; por isso as linhas ficam fora do cavalo.
        // A malha de linhas de um modelo rigado precisa usar a mesma geometria e skeleton.
        const overlayName = `polygon-wireframe-${child.uuid}`
        let overlay = child.getObjectByName('polygon-wireframe')
          ?? child.parent?.getObjectByName(overlayName)
        if (!overlay && wireframeVisible) {
          if (child instanceof THREE.SkinnedMesh && child.parent) {
            const makeWireframeMaterial = (source: THREE.Material): THREE.MeshBasicMaterial => {
              const material = new THREE.MeshBasicMaterial({
                color: 0x252832,
                wireframe: true,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1,
              })
              material.side = source.side
              return material
            }
            const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
            const wireframeMaterials = sourceMaterials.map(makeWireframeMaterial)
            const wireframe = new THREE.SkinnedMesh(
              child.geometry,
              Array.isArray(child.material) ? wireframeMaterials : wireframeMaterials[0]!,
            )
            wireframe.name = overlayName
            wireframe.position.copy(child.position)
            wireframe.quaternion.copy(child.quaternion)
            wireframe.scale.copy(child.scale)
            wireframe.bindMode = child.bindMode
            wireframe.bind(child.skeleton, child.bindMatrix)
            // Compartilha os pesos morph: qualquer animação facial/shape key
            // continua sincronizada com a malha original.
            wireframe.morphTargetDictionary = child.morphTargetDictionary
            wireframe.morphTargetInfluences = child.morphTargetInfluences
            wireframe.userData.editorOverlay = true
            wireframe.renderOrder = 2
            wireframe.frustumCulled = false
            child.parent.add(wireframe)
            overlay = wireframe
          } else {
            const edges = new THREE.WireframeGeometry(child.geometry)
            const material = new THREE.LineBasicMaterial({
              color: 0x252832,
              transparent: true,
              opacity: 0.85,
              depthWrite: false,
            })
            const lines = new THREE.LineSegments(edges, material)
            lines.name = 'polygon-wireframe'
            lines.userData.editorOverlay = true
            lines.renderOrder = 2
            child.add(lines)
            overlay = lines
          }
        }
        if (overlay) overlay.visible = wireframeVisible
      })
    }
    if (patch.groupId !== undefined) m.userData.groupId = patch.groupId
    if (patch.mass !== undefined && Number.isFinite(patch.mass)) m.userData.mass = Math.max(0, patch.mass)
    if (patch.colliderType !== undefined && ['auto', 'box', 'sphere', 'capsule', 'mesh', 'none'].includes(patch.colliderType)) m.userData.colliderType = patch.colliderType
    if (patch.colliderSize !== undefined && patch.colliderSize.length === 3 && patch.colliderSize.every(Number.isFinite)) m.userData.colliderSize = patch.colliderSize.map(value => clamp(value, 0.05, 100))
    if (patch.colliderOffset !== undefined && patch.colliderOffset.length === 3 && patch.colliderOffset.every(Number.isFinite)) m.userData.colliderOffset = patch.colliderOffset.map(value => clamp(value, -100, 100))
    const affectsOcclusion = transformFields
      || patch.visible !== undefined
      || patch.texturePreset !== undefined
      || patch.faceTextures !== undefined
      || patch.faceTexture !== undefined
    if (affectsOcclusion) this.terrain.grass.invalidateOcclusion()
    this.events.emit('objectChanged', { id })
  }

  /** Avisa a interface que um objeto foi alterado por arrasto no viewport. */
  notifyChanged(id: string): void {
    this.dirtyRenderDistanceObjectIds.add(id)
    this.terrain.grass.invalidateOcclusion()
    this.events.emit('objectChanged', { id })
  }

  /** Substitui todo o conteúdo do mundo (novo projeto ou projeto aberto). */
  replaceAll(objs: GameObject[], terrain: TerrainData): void {
    this.select(null)
    for (const o of this.objects.values()) this.dispose(o)
    this.objects.clear()
    for (const o of objs) {
      reserveId(o.id)
      this.initializeObjectRenderVisibility(o)
      this.scene.add(o.mesh)
      this.objects.set(o.id, o)
    }
    this.invalidateGrassOcclusionRoots()
    this.terrain.load(terrain.seed, terrain.edits, terrain.paintedGrass ?? [])
    this.applyTerrainVisible(terrain.visible)
    this.events.emit('worldReset', { count: objs.length })
  }

  /** Versão assíncrona para projetos com muitos tufos de grama pintada. */
  async replaceAllAsync(
    objs: GameObject[],
    terrain: TerrainData,
    onGrassProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    this.select(null)
    for (const o of this.objects.values()) this.dispose(o)
    this.objects.clear()
    for (const o of objs) {
      reserveId(o.id)
      this.initializeObjectRenderVisibility(o)
      this.scene.add(o.mesh)
      this.objects.set(o.id, o)
    }
    this.invalidateGrassOcclusionRoots()
    await this.terrain.loadAsync(terrain.seed, terrain.edits, terrain.paintedGrass ?? [], onGrassProgress)
    this.applyTerrainVisible(terrain.visible)
    this.events.emit('worldReset', { count: objs.length })
  }

  // ---- seleção ----
  select(id: string | null): void {
    const valid = id === TERRAIN_ID || (id !== null && this.objects.has(id))
    const next = valid ? id : null
    if (next === this.selectedId) return
    this.highlight(this.selectedId, false)
    this.selectedId = next
    this.highlight(next, true)
    this.events.emit('selectionChanged', { id: next })
  }

  getSelectedId(): string | null {
    return this.selectedId
  }

  // ---- consultas ----
  get(id: string): GameObject | undefined {
    return this.objects.get(id)
  }

  list(): GameObject[] {
    return [...this.objects.values()]
  }

  /** Retorna uma entidade pelo ID apenas quando o elemento foi declarado como entity. */
  getEntity(id: string): Entity | null {
    return toEntity(this.objects.get(id))
  }

  /** Lista entidades de primeira classe sem duplicar nem separar suas raízes visuais do World. */
  listEntities(): Entity[] {
    const entities: Entity[] = []
    for (const object of this.objects.values()) {
      const entity = toEntity(object)
      if (entity) entities.push(entity)
    }
    return entities
  }

  /** Atalho semântico para código de gameplay que precisa iterar entidades. */
  hasEntity(id: string): boolean {
    return this.getEntity(id) !== null
  }

  info(): ObjectInfo[] {
    return this.list().map((o) => {
      if (!o.mesh.geometry.boundingBox) o.mesh.geometry.computeBoundingBox()
      const baseColliderSize = o.mesh.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1)
      return ({
      id: o.id,
      name: o.name,
      type: o.type,
      importedModel: o.mesh.userData.importedModel === true,
      x: o.mesh.position.x,
      y: o.mesh.position.y,
      z: o.mesh.position.z,
      rotationX: (o.mesh.rotation.x * 180) / Math.PI,
      rotationY: (o.mesh.rotation.y * 180) / Math.PI,
      rotationZ: (o.mesh.rotation.z * 180) / Math.PI,
      scale: o.mesh.scale.x,
      scaleX: o.mesh.scale.x,
      scaleY: o.mesh.scale.y,
      scaleZ: o.mesh.scale.z,
      visible: this.isObjectVisible(o),
      locked: o.mesh.userData.locked === true,
      wireframeVisible: o.mesh.userData.wireframeVisible !== false,
      groupId: typeof o.mesh.userData.groupId === 'string' ? o.mesh.userData.groupId : null,
      mass: typeof o.mesh.userData.mass === 'number' && Number.isFinite(o.mesh.userData.mass) ? Math.max(0, o.mesh.userData.mass) : 1,
      colliderType: o.mesh.userData.colliderType === 'box' || o.mesh.userData.colliderType === 'sphere' || o.mesh.userData.colliderType === 'capsule' || o.mesh.userData.colliderType === 'mesh' || o.mesh.userData.colliderType === 'none' ? o.mesh.userData.colliderType : 'auto',
      colliderSize: Array.isArray(o.mesh.userData.colliderSize) && o.mesh.userData.colliderSize.length === 3 ? [...o.mesh.userData.colliderSize] as [number, number, number] : [baseColliderSize.x, baseColliderSize.y, baseColliderSize.z],
      colliderOffset: Array.isArray(o.mesh.userData.colliderOffset) && o.mesh.userData.colliderOffset.length === 3 ? [...o.mesh.userData.colliderOffset] as [number, number, number] : [0, 0, 0],
      texturePreset: o.mesh.userData.texturePreset === 'grass' || o.mesh.userData.texturePreset === 'stone' || o.mesh.userData.texturePreset === 'brick' || o.mesh.userData.texturePreset === 'wood' || o.mesh.userData.texturePreset === 'sand' || o.mesh.userData.texturePreset === 'metal' ? o.mesh.userData.texturePreset : 'none',
      color: o.mesh.userData.importedModel === true && typeof o.mesh.userData.importedTint === 'number' ? o.mesh.userData.importedTint : (typeof o.mesh.userData.baseColor === 'number' ? o.mesh.userData.baseColor : ((Array.isArray(o.mesh.material) ? o.mesh.material[0] : o.mesh.material) as THREE.MeshStandardMaterial).color.getHex()),
      textureRepeat: typeof o.mesh.userData.textureRepeat === 'number' ? o.mesh.userData.textureRepeat : 2,
      faceTextures: (o.mesh.userData.faceTextures ?? {}) as import('../project/format').FaceTextureMap,
    })})
  }

  /** Só os objetos visíveis podem ser clicados. */
  pickables(): THREE.Mesh[] {
    return this.list()
      .filter((o) => o.mesh.visible && o.mesh.userData.locked !== true)
      .map((o) => o.mesh)
  }

  // ---- renderização geral ----
  /** Configura a distância radial para modelos/objetos e para os anéis de grama. */
  setRenderDistance(distance: number | null): void {
    if (distance !== null && !Number.isFinite(distance)) return
    this.renderDistance = distance === null ? null : THREE.MathUtils.clamp(distance, 10, 5000)
    this.terrain.grass.setRenderDistance(this.renderDistance)
    this.renderDistanceDirty = true
    this.updateGrassFogDistance(this.renderDistance ?? 72)
    this.events.emit('renderInvalidated', undefined)
  }

  /**
   * Mantém a visibilidade lógica separada do culling por distância.
   * Assim objetos distantes deixam de ser desenhados, mas continuam colidindo,
   * participando de eventos e salvando sua visibilidade real no projeto.
   */
  isObjectVisible(object: GameObject): boolean {
    const mesh = object.mesh
    // Fora da distância, mesh.visible é apenas culling visual; a visibilidade
    // efetiva vem do estado anterior ao culling. Dentro do alcance, respeite
    // alterações diretas feitas por sistemas de comportamento.
    if (mesh.userData.renderDistanceCulled !== true) return mesh.visible
    const value = mesh.userData.renderDistanceBaseVisible
    return typeof value === 'boolean' ? value : mesh.visible
  }

  private initializeObjectRenderVisibility(object: GameObject): void {
    const mesh = object.mesh
    if (mesh.userData.renderDistanceCulled === true && typeof mesh.userData.renderDistanceBaseVisible === 'boolean') {
      mesh.visible = mesh.userData.renderDistanceBaseVisible
    } else {
      mesh.userData.renderDistanceBaseVisible = mesh.visible
    }
    mesh.userData.renderDistanceCulled = false
    this.renderDistanceDirty = true
  }

  private isOutsideRenderDistance(mesh: THREE.Mesh, wasCulled: boolean): boolean {
    if (this.renderDistance === null) return false

    mesh.updateWorldMatrix(true, false)
    const sphere = mesh.geometry.boundingSphere ?? (mesh.geometry.computeBoundingSphere(), mesh.geometry.boundingSphere)
    if (sphere) this.renderDistanceCenter.copy(sphere.center).applyMatrix4(mesh.matrixWorld)
    else this.renderDistanceCenter.setFromMatrixPosition(mesh.matrixWorld)
    mesh.getWorldScale(this.renderDistanceScale)
    const radius = (sphere?.radius ?? 0) * Math.max(
      Math.abs(this.renderDistanceScale.x),
      Math.abs(this.renderDistanceScale.y),
      Math.abs(this.renderDistanceScale.z),
    )
    // Histerese pequena reduz o piscar de objetos próximos ao limite.
    const margin = Math.min(3, Math.max(0.5, this.renderDistance * 0.025))
    const threshold = Math.max(0, this.renderDistance + radius + (wasCulled ? -margin : margin))
    return this.renderDistanceCenter.distanceToSquared(this.renderDistanceCameraPosition) > threshold * threshold
  }

  /** Atualiza o culling ao mudar a câmera; movimentos isolados só recalculam o objeto afetado. */
  updateRenderDistance(cameraPosition: THREE.Vector3): boolean {
    const cameraMoved = !this.hasRenderDistanceCameraPosition
      || this.lastRenderDistanceCameraPosition.distanceToSquared(cameraPosition) >= 0.25
    const updateAll = this.renderDistanceDirty || cameraMoved
    if (!updateAll && this.dirtyRenderDistanceObjectIds.size === 0) return false

    this.renderDistanceCameraPosition.copy(cameraPosition)
    if (updateAll) {
      this.lastRenderDistanceCameraPosition.copy(cameraPosition)
      this.hasRenderDistanceCameraPosition = true
      this.renderDistanceDirty = false
    }

    const objectsToUpdate: GameObject[] = updateAll
      ? [...this.objects.values()]
      : [...this.dirtyRenderDistanceObjectIds]
          .map((id) => this.objects.get(id))
          .filter((object): object is GameObject => object !== undefined)
    this.dirtyRenderDistanceObjectIds.clear()

    let changed = false
    for (const object of objectsToUpdate) {
      const mesh = object.mesh
      const wasCulled = mesh.userData.renderDistanceCulled === true

      // Só capturamos mesh.visible quando ele não está escondido pelo culling.
      // Isso preserva alterações reais de visibilidade feitas pelo usuário ou scripts.
      if (!wasCulled) mesh.userData.renderDistanceBaseVisible = mesh.visible

      const culled = this.isOutsideRenderDistance(mesh, wasCulled)
      const storedBaseVisible = mesh.userData.renderDistanceBaseVisible
      const baseVisible = typeof storedBaseVisible === 'boolean' ? storedBaseVisible : mesh.visible
      mesh.userData.renderDistanceCulled = culled
      const visible = baseVisible && !culled
      if (mesh.visible !== visible) {
        mesh.visible = visible
        changed = true
      }
    }

    if (changed) this.events.emit('renderInvalidated', undefined)
    return changed
  }

  /** Atualiza a neblina conforme o alcance efetivo e a distância até a borda do mapa. */
  updateFogForCamera(cameraPosition: THREE.Vector3): void {
    let farthestCorner = 0
    for (const corner of TERRAIN_FOG_CORNERS) {
      this.fogCorner.set(corner.x, this.terrain.heightAt(corner.x, corner.z), corner.z)
      farthestCorner = Math.max(farthestCorner, this.fogCorner.distanceTo(cameraPosition))
    }

    const configuredDistance = this.renderDistance === null
      ? farthestCorner
      : Math.min(this.renderDistance, farthestCorner)
    const presetDistance = this.terrain.grass.getEffectiveRenderDistance()
    const effectiveDistance = presetDistance === null
      ? configuredDistance
      : Math.min(configuredDistance, presetDistance, farthestCorner)
    this.updateGrassFogDistance(Math.max(10, effectiveDistance))
  }

  /** Alterna a neblina sem alterar o culling de objetos e vegetação. */
  setFogEnabled(enabled: boolean): void {
    if (this.worldFogEnabled === enabled) return
    this.worldFogEnabled = enabled
    this.scene.fog = enabled ? this.worldFog : null
    this.events.emit('renderInvalidated', undefined)
  }

  /** Ajusta independentemente o alcance da neblina (50% a 200%). */
  setFogDistanceScale(scale: number): void {
    if (!Number.isFinite(scale)) return
    const next = THREE.MathUtils.clamp(scale, 0.5, 2)
    if (this.fogDistanceScale === next) return
    this.fogDistanceScale = next
    this.updateGrassFogDistance(this.renderDistance ?? 72)
    this.events.emit('renderInvalidated', undefined)
  }

  private updateGrassFogDistance(distance: number): void {
    // A escala permite controlar a neblina independentemente do limite global.
    const fogDistance = Math.max(10, distance * this.fogDistanceScale)
    this.worldFog.near = fogDistance * 0.70
    this.worldFog.far = Math.max(this.worldFog.near + 1, fogDistance * 0.98)
  }

  terrainInfo(): TerrainInfo {
    return {
      visible: this.terrain.mesh.visible,
      seed: this.terrain.field.seed,
      edits: this.terrain.field.editCount(),
    }
  }

  terrainData(): TerrainData {
    return {
      seed: this.terrain.field.seed,
      visible: this.terrain.mesh.visible,
      edits: this.terrain.field.exportEdits(),
      paintedGrass: this.terrain.grass.exportPainted(),
    }
  }

  setTerrainVisible(visible: boolean): void {
    this.applyTerrainVisible(visible)
    this.notifyTerrain()
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible
    this.grid.visible = visible
    this.events.emit('renderInvalidated', undefined)
  }

  isGridVisible(): boolean {
    return this.gridVisible
  }

  regenerateTerrain(seed: number): void {
    this.terrain.load(seed, [])
    this.notifyTerrain()
  }

  clearTerrainEdits(): void {
    this.terrain.load(this.terrain.field.seed, [], this.terrain.grass.exportPainted())
    this.notifyTerrain()
  }

  notifyTerrain(): void {
    this.events.emit('terrainChanged', { edits: this.terrain.field.editCount() })
  }

  private applyTerrainVisible(visible: boolean): void {
    this.terrain.mesh.visible = visible
    this.terrain.grass.mesh.visible = visible
    // A malha é independente do terreno e pode permanecer visível como referência do editor.
    this.grid.visible = this.gridVisible
  }

  private highlight(id: string | null, on: boolean): void {
    if (id === null || id === TERRAIN_ID) return
    const obj = this.objects.get(id)
    if (!obj) return

    // Modelos importados usam uma MeshBasicMaterial invisível como proxy.
    // Esse material não possui emissive; também precisamos aceitar materiais em array.
    const materials = Array.isArray(obj.mesh.material) ? obj.mesh.material : [obj.mesh.material]
    for (const material of materials) {
      const emissive = (material as THREE.Material & { emissive?: THREE.Color }).emissive
      if (emissive) emissive.setHex(on ? 0x4a2a1a : 0x000000)
    }
  }

  private dispose(obj: GameObject): void {
    this.scene.remove(obj.mesh)

    // Um GLB pode compartilhar geometrias, materiais e texturas entre várias
    // malhas. Libere cada recurso uma única vez ao remover/substituir o objeto.
    const disposedGeometries = new Set<THREE.BufferGeometry>()
    const disposedMaterials = new Set<THREE.Material>()
    const disposedTextures = new Set<THREE.Texture>()

    const disposeTexture = (texture: THREE.Texture): void => {
      // Textures procedurais são compartilhadas entre objetos por preset/repetição.
      // Remover um objeto não pode invalidar a textura de todos os demais.
      if (texture.userData.sharedProceduralTexture === true || disposedTextures.has(texture)) return
      disposedTextures.add(texture)
      texture.dispose()
    }

    const disposeMaterial = (material: THREE.Material): void => {
      if (disposedMaterials.has(material)) return
      disposedMaterials.add(material)

      // Mapas de materiais importados não são liberados por material.dispose().
      // Inspeciona propriedades diretas para cobrir map, normalMap, roughnessMap,
      // emissiveMap, envMap e outros mapas suportados pelo Three.js.
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) disposeTexture(value)
      }
      material.dispose()
    }

    obj.mesh.traverse((child) => {
      if (child === obj.mesh) return
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return
      if (!disposedGeometries.has(child.geometry)) {
        disposedGeometries.add(child.geometry)
        child.geometry.dispose()
      }
      const material = child.material
      if (Array.isArray(material)) material.forEach(disposeMaterial)
      else disposeMaterial(material)
    })

    if (!disposedGeometries.has(obj.mesh.geometry)) {
      disposedGeometries.add(obj.mesh.geometry)
      obj.mesh.geometry.dispose()
    }
    const generatedTexture = obj.mesh.userData.generatedTexture as THREE.Texture | undefined
    if (generatedTexture) disposeTexture(generatedTexture)
    const generatedFaceTextures = obj.mesh.userData.generatedFaceTextures as THREE.Texture[] | undefined
    generatedFaceTextures?.forEach(disposeTexture)

    const material = obj.mesh.material
    if (Array.isArray(material)) material.forEach(disposeMaterial)
    else disposeMaterial(material)
  }
}
