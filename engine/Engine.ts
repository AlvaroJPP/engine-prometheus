import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PointerController } from './input/PointerController'
import { createEditorState } from './EditorState'
import type { BrushSettings, EditorState, ToolMode, TransformMode } from './EditorState'
import { randomSeed, resetIds, uuid } from './lib/id'
import type { ObjectInfo, ObjectPatch } from './model/object/GameObject'
import { MAIN_SCENE_PATH } from './project/format'
import type { CameraPreset, ObjectType, ProjectBundle, SceneObjectData } from './project/format'
import { buildBundle, objectFromData } from './project/serialize'
import type { ProjectMeta } from './project/serialize'
import { ProjectFormatError } from './project/validate'
import { OrbitCamera } from './view/OrbitCamera'
import { Viewport } from './view/Viewport'
import { clamp, snap } from './lib/math'
import { World } from './world/World'
import { CollisionSystem } from './world/CollisionSystem'
import { HumanoidAvatar } from './world/HumanoidAvatar'
import { HorseMount } from './world/HorseMount'
import type { TerrainInfo } from './world/World'
import { RuleEngine } from './script/RuleEngine'
import type { LogicRule } from './script/types'

const PRESET_ORDER: CameraPreset[] = ['free', 'isometric', 'top']

export class Engine {
  readonly world = new World()
  readonly collisions = new CollisionSystem(this.world)
  readonly state: EditorState = createEditorState()
  readonly logic: RuleEngine = new RuleEngine(this.world)
  private orbit = new OrbitCamera()
  private viewport: Viewport
  private input: PointerController
  private transformControls: TransformControls
  private avatar: HumanoidAvatar
  private horseMount: HorseMount
  private meta: ProjectMeta = { id: uuid(), name: 'Novo Mundo' }
  private groupTransformSnapshot: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null = null
  private pendingBuildComponent: { name: string; model: THREE.Object3D; height: number } | null = null
  private cameraStateBeforeRun: ReturnType<OrbitCamera['getState']> | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.viewport = new Viewport(canvas, (aspect) => this.orbit.resize(aspect))
    this.avatar = new HumanoidAvatar(this.world, this.orbit.target, () => this.orbit.yaw)
    this.avatar.mesh.visible = false
    this.avatar.setEnabled(false)
    this.horseMount = new HorseMount(this.world, this.avatar, this.orbit.target, () => this.orbit.yaw)
    this.logic.setHorseActionHandler((action, objectId) => this.horseMount.executeNodeAction(action, objectId))
    window.addEventListener('keydown', this.onRuleKeyDown)
    // Gizmo 3D nativo do Three.js: eixos de mover, anéis de rotação e alças de escala.
    this.transformControls = new TransformControls(this.orbit.camera, canvas)
    this.world.scene.add(this.transformControls.getHelper())
    this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform)
    this.transformControls.setSpace('world')
    this.transformControls.addEventListener('objectChange', () => {
      const id = this.world.getSelectedId()
      const selected = id ? this.world.get(id) : undefined
      if (!id || !selected) return
      const mesh = selected.mesh
      const current = {
        position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
      }
      const previous = this.groupTransformSnapshot
      if (previous && typeof mesh.userData.groupId === 'string') {
        const groupId = mesh.userData.groupId as string
        const dx = current.position[0] - previous.position[0]
        const dy = current.position[1] - previous.position[1]
        const dz = current.position[2] - previous.position[2]
        const drx = current.rotation[0] - previous.rotation[0]
        const dry = current.rotation[1] - previous.rotation[1]
        const drz = current.rotation[2] - previous.rotation[2]
        const ratios = current.scale.map((v, i) => previous.scale[i] === 0 ? 1 : v / previous.scale[i]) as [number, number, number]
        const pivot = new THREE.Vector3(previous.position[0], previous.position[1], previous.position[2])
        const deltaRotation = new THREE.Euler(drx, dry, drz, mesh.rotation.order)
        const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(deltaRotation)
        for (const sibling of this.world.list()) {
          if (sibling.id === id || sibling.mesh.userData.groupId !== groupId || sibling.mesh.userData.locked === true) continue
          const other = sibling.mesh
          other.position.sub(pivot)
          other.position.set(other.position.x * ratios[0], other.position.y * ratios[1], other.position.z * ratios[2])
          other.position.applyMatrix4(rotationMatrix)
          other.position.add(pivot)
          other.position.x += dx; other.position.y += dy; other.position.z += dz
          other.rotation.x += drx; other.rotation.y += dry; other.rotation.z += drz
          other.scale.x *= ratios[0]; other.scale.y *= ratios[1]; other.scale.z *= ratios[2]
          this.world.notifyChanged(sibling.id)
        }
      }
      this.groupTransformSnapshot = current
      this.world.notifyChanged(id)
    })
    this.transformControls.addEventListener('dragging-changed', (event) => {
      // O PointerController consulta este estado para não competir com o gizmo.
      if (event.value) {
        this.state.tool = 'select'
        const id = this.world.getSelectedId()
        const mesh = id ? this.world.get(id)?.mesh : undefined
        this.groupTransformSnapshot = mesh ? { position: [mesh.position.x, mesh.position.y, mesh.position.z], rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] } : null
      } else this.groupTransformSnapshot = null
    })
    this.input = new PointerController(canvas, this.orbit, this.world, this.state, () => this.transformControls.dragging, (x, y, z) => this.placePendingBuildComponent(x, y, z))
    this.events.on('selectionChanged', ({ id }) => {
      const object = id ? this.world.get(id) : undefined
      if (object && object.mesh.userData.locked !== true) this.transformControls.attach(object.mesh)
      else this.transformControls.detach()
    })
    this.events.on('toolChanged', ({ transform, tool }) => {
      this.transformControls.setMode(transform === 'move' ? 'translate' : transform)
      this.transformControls.enabled = tool === 'select'
    })
    this.events.on('objectChanged', ({ id }) => {
      if (this.world.getSelectedId() === id) this.transformControls.getHelper().updateMatrixWorld()
    })
    this.viewport.start((dt) => {
      this.input.update(dt)
      this.collisions.update()
      // Os mixers pertencem à raiz de cada objeto importado; assim uma árvore
      // pode animar-se independentemente das outras e a remoção libera a raiz.
      for (const object of this.world.list()) {
        const mixer = object.mesh.userData.importAnimationMixer as THREE.AnimationMixer | undefined
        mixer?.update(dt)
      }
      this.horseMount.update(dt)
      this.avatar.update(dt)
      this.world.updateEnvironment(dt)
      this.logic.update()
      this.orbit.update()
      this.viewport.renderer.render(this.world.scene, this.orbit.camera)
    })
  }

  get events() {
    return this.world.events
  }

  /** Ativa renderização em menor resolução para aliviar a GPU em cenas pesadas. */
  setPerformanceMode(enabled: boolean): void {
    this.viewport.setPerformanceMode(enabled)
  }

  listRules(): LogicRule[] { return this.logic.list() }
  upsertRule(rule: LogicRule): void { this.logic.upsert(rule) }
  removeRule(id: string): void { this.logic.remove(id) }
  moveRule(id: string, direction: -1 | 1): void { this.logic.move(id, direction) }
  setLogicVariable(name: string, value: boolean | number | string, objectId?: string | null): void { this.logic.setVariable(name, value, objectId) }
  removeLogicVariable(name: string, objectId?: string | null): boolean { return this.logic.removeVariable(name, objectId) }
  logicVariables(objectId?: string | null): Record<string, boolean | number | string> { return this.logic.variables(objectId) }

  get projectName(): string {
    return this.meta.name
  }

  setProjectName(name: string): void {
    const clean = name.trim()
    if (clean !== '') this.meta.name = clean
  }

  // ---- ferramentas ----
  setTool(tool: ToolMode): void {
    const previousTool = this.state.tool
    this.state.tool = tool
    if (tool === 'grass') {
      this.transformControls.detach()
      this.transformControls.enabled = false
    } else {
      this.transformControls.enabled = true
      if (tool === 'select') {
        const id = this.world.getSelectedId()
        const selected = id ? this.world.get(id) : undefined
        if (selected && selected.mesh.userData.locked !== true) this.transformControls.attach(selected.mesh)
      } else if (previousTool === 'grass') {
        this.transformControls.detach()
      }
    }
    this.emitTool()
  }

  /** Escolher mover/rotacionar/escalar também ativa a ferramenta Selecionar. */
  setTransform(mode: TransformMode): void {
    this.state.transform = mode
    this.state.tool = 'select'
    this.transformControls.setMode(mode === 'move' ? 'translate' : mode)
    this.transformControls.enabled = true
    this.emitTool()
  }

  setBuildShape(type: ObjectType): void {
    this.state.buildShape = type
  }

  setBrush(brush: BrushSettings): void {
    this.state.brush.strength = clamp(brush.strength, 0.1, 5)
    this.state.brush.radius = clamp(brush.radius, 0.5, 20)
  }

  private emitTool(): void {
    this.events.emit('toolChanged', { tool: this.state.tool, transform: this.state.transform })
  }

  // ---- câmera ----
  get cameraPreset(): CameraPreset {
    return this.orbit.preset
  }

  /** Alterna entre o editor livre e a execução controlada pelo jogador. */
  setRuntimeMode(enabled: boolean): void {
    if (enabled) {
      if (this.cameraStateBeforeRun) return
      this.cameraStateBeforeRun = this.orbit.getState()
      this.orbit.setFirstPersonMode(false)
      this.avatar.setFirstPersonMode(false)
      // Se houver uma plataforma de spawn, posiciona os pés do jogador sobre ela.
      // O nome é persistido no projeto, então o ponto continua funcionando após reabrir.
      const spawn = this.world.list().find((object) =>
        object.name === 'Plataforma de Spawn' || object.mesh.userData.playerSpawn === true,
      )
      if (spawn) {
        spawn.mesh.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(spawn.mesh)
        this.avatar.mesh.position.set(spawn.mesh.position.x, bounds.max.y + 0.03, spawn.mesh.position.z)
        this.avatar.resetVerticalState()
      } else {
        this.avatar.reset()
      }
      this.avatar.mesh.visible = true
      this.avatar.setEnabled(true)
      this.horseMount.setRuntimeMode(true, this.avatar.mesh.position)
      this.orbit.target.set(this.avatar.mesh.position.x, this.avatar.mesh.position.y + 0.9, this.avatar.mesh.position.z)
      this.orbit.distance = 10
      this.input.setRuntimeMode(true)
      this.transformControls.detach()
      this.transformControls.enabled = false
      return
    }

    this.horseMount.setRuntimeMode(false)
    this.input.setRuntimeMode(false)
    this.avatar.setEnabled(false)
    this.avatar.mesh.visible = false
    this.avatar.setFirstPersonMode(false)
    if (this.cameraStateBeforeRun) {
      this.orbit.restore(this.cameraStateBeforeRun)
      this.cameraStateBeforeRun = null
    }
    this.transformControls.enabled = true
    const selectedId = this.world.getSelectedId()
    const selected = selectedId ? this.world.get(selectedId) : undefined
    if (this.state.tool === 'select' && selected && selected.mesh.userData.locked !== true) {
      this.transformControls.attach(selected.mesh)
    } else {
      this.transformControls.detach()
    }
    this.emitTool()
  }

  setFirstPersonMode(enabled: boolean): void {
    this.orbit.setFirstPersonMode(enabled)
    this.avatar.setFirstPersonMode(enabled)
    if (!enabled) this.orbit.update()
    this.events.emit('cameraChanged', { preset: this.orbit.preset })
  }

  cycleCameraPreset(): CameraPreset {
    const next = PRESET_ORDER[(PRESET_ORDER.indexOf(this.orbit.preset) + 1) % PRESET_ORDER.length] ?? 'free'
    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    this.orbit.setPreset(next)
    this.events.emit('cameraChanged', { preset: next })
    return next
  }

  // ---- objetos ----
  /** Cria um objeto no centro da visão, apoiado no terreno. */
  addPrimitive(type: ObjectType): void {
    this.state.buildShape = type
    const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48)
    const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48)
    this.world.place(type, x, this.world.terrain.heightAt(x, z), z)
  }

  /** Cria uma pequena plataforma persistente que define o ponto inicial do jogador. */
  addSpawnPlatform(): void {
    const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48)
    const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48)
    const groundY = this.world.terrain.heightAt(x, z)

    // Mantém apenas um ponto de spawn ativo por projeto.
    for (const object of this.world.list()) {
      if (object.name === 'Plataforma de Spawn' || object.mesh.userData.playerSpawn === true) {
        this.world.rename(object.id, 'Plataforma')
        object.mesh.userData.playerSpawn = false
      }
    }

    const spawn = this.world.place('platform', x, groundY, z)
    spawn.name = 'Plataforma de Spawn'
    spawn.mesh.name = 'Plataforma de Spawn'
    spawn.mesh.scale.set(0.5, 0.5, 0.5)
    spawn.mesh.position.y = groundY + 0.1
    spawn.mesh.userData.playerSpawn = true
    this.world.notifyChanged(spawn.id)
    this.world.select(spawn.id)
  }

  /** Clona e vincula ao objeto os nós embutidos no asset reutilizável. */
  private applyComponentLogic(objectId: string, templates: unknown): void {
    if (!Array.isArray(templates)) return
    for (const raw of templates) {
      if (!raw || typeof raw !== 'object') continue
      const template = JSON.parse(JSON.stringify(raw)) as LogicRule
      const remap = (value: string): string => value === '{ID_OBJECT}' ? objectId : value
      template.id = `${template.id || 'component-event'}-${objectId}`
      template.ownerObjectId = objectId
      if (template.trigger.type === 'object_clicked') {
        template.trigger.objectId = remap(template.trigger.objectId)
      }
      for (const action of template.actions) {
        if ('objectId' in action && typeof action.objectId === 'string') {
          action.objectId = remap(action.objectId)
        }
      }
      this.logic.upsert(template)
    }
  }

  /** Garante que o cavalo tenha regras completas e editáveis no Visual Script. */
  private ensureHorseLogic(objectId: string): void {
    // A habilitação do cavalo é global: continua disponível após salvar/reabrir
    // o projeto, mesmo que a versão anterior guardasse a variável no escopo do objeto.
    this.logic.removeVariable('horse_enabled', objectId)
    if (this.logic.getVariable('horse_enabled') === undefined) {
      this.logic.setVariable('horse_enabled', true)
    }

    const rules = this.logic.list()
    const existingMount = rules.find(rule =>
      rule.ownerObjectId === objectId &&
      rule.trigger.type === 'object_clicked' &&
      rule.trigger.objectId === objectId &&
      (/montar no cavalo/i.test(rule.name) || rule.actions.some(action =>
        action.type === 'horse_mount' || (action.type === 'javascript' && action.code.includes('api.mount')),
      )),
    )
    this.logic.upsert({
      ownerObjectId: objectId,
      id: existingMount?.id ?? `horse-mount-${objectId}`,
      name: existingMount?.name || 'Montar no cavalo',
      enabled: existingMount?.enabled ?? true,
      trigger: { type: 'object_clicked', objectId },
      conditions: [{ type: 'variable', name: 'horse_enabled', operator: 'equals', value: true }],
      actions: [{ type: 'javascript', code: 'api.mount()' }],
      graphLayout: existingMount?.graphLayout ?? {
        trigger: { x: 70, y: 70 },
        condition: { x: 350, y: 70 },
        action: { x: 630, y: 70 },
      },
    })

    const existingToggle = rules.find(rule =>
      rule.ownerObjectId === objectId &&
      rule.trigger.type === 'key_pressed' &&
      rule.trigger.key === 'KeyE' &&
      (/montar ou desmontar/i.test(rule.name) || rule.actions.some(action =>
        action.type === 'horse_toggle_mount' || (action.type === 'javascript' && action.code.includes('api.toggleMount')),
      )),
    )
    this.logic.upsert({
      ownerObjectId: objectId,
      id: existingToggle?.id ?? `horse-toggle-mount-${objectId}`,
      name: existingToggle?.name || 'Montar ou desmontar (E)',
      enabled: existingToggle?.enabled ?? true,
      trigger: { type: 'key_pressed', key: 'KeyE' },
      conditions: [{ type: 'variable', name: 'horse_enabled', operator: 'equals', value: true }],
      actions: [{ type: 'javascript', code: 'api.toggleMount()' }],
      graphLayout: existingToggle?.graphLayout ?? {
        trigger: { x: 70, y: 210 },
        condition: { x: 350, y: 210 },
        action: { x: 630, y: 210 },
      },
    })
  }

  private onRuleKeyDown = (event: KeyboardEvent): void => {
    if (!this.cameraStateBeforeRun || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
    // O grafo visual decide quais objetos reagem à tecla; o motor não fixa a tecla E.
    // A ação de montaria valida a proximidade do seu próprio componente.
    if (this.logic.triggerKeyPressed(event.code)) event.preventDefault()
  }

  /** Coloca o cavalo nativo do motor como componente editável, sem importar uma cópia visual do GLB. */
  private placeNativeHorseComponent(
    x: number,
    baseY: number,
    z: number,
    name: string,
    componentLogic?: unknown,
    componentMetadata?: {
      importedModelData?: unknown
      importedModelHeight?: unknown
      importColliderType?: unknown
      importColliderSize?: unknown
      importColliderOffset?: unknown
    },
  ): void {
    const height = 2.05
    const root = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, height, 2.8),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
      }),
    )
    root.name = name || 'Cavalo Low Poly'
    root.position.set(x, baseY + height / 2, z)
    root.userData.nativeComponentType = 'horse'
    root.userData.nativeHorseComponent = true
    root.userData.componentId = 'builtin-horse-low-poly'
    root.userData.importedModel = true
    root.userData.importedModelData = typeof componentMetadata?.importedModelData === 'string'
      ? componentMetadata.importedModelData
      : undefined
    root.userData.importedModelHeight = typeof componentMetadata?.importedModelHeight === 'number'
      && Number.isFinite(componentMetadata.importedModelHeight) && componentMetadata.importedModelHeight > 0
      ? componentMetadata.importedModelHeight : height
    root.userData.colliderType = componentMetadata?.importColliderType === 'sphere'
      || componentMetadata?.importColliderType === 'capsule'
      || componentMetadata?.importColliderType === 'none'
      ? componentMetadata.importColliderType : 'box'
    const savedColliderSize = componentMetadata?.importColliderSize
    root.userData.colliderSize = Array.isArray(savedColliderSize) && savedColliderSize.length === 3
      && savedColliderSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0)
      ? [...savedColliderSize] : [0.95, 1.35, 1.6]
    const savedColliderOffset = componentMetadata?.importColliderOffset
    root.userData.colliderOffset = Array.isArray(savedColliderOffset) && savedColliderOffset.length === 3
      && savedColliderOffset.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
      ? [...savedColliderOffset] : [0, 0.02, 0]
    root.userData.locked = false
    root.userData.wireframeVisible = false
    const id = `horse_component_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
    root.userData.id = id
    this.world.add({ id, name: root.name, type: 'cube', mesh: root })
    root.userData.componentLogic = Array.isArray(componentLogic) ? componentLogic : []
    this.applyComponentLogic(id, componentLogic)
    this.ensureHorseLogic(id)
    this.horseMount.setEditorComponent(root)
    this.world.select(id)
    this.state.tool = 'select'
    this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform)
    this.transformControls.attach(root)
    this.transformControls.enabled = true
    this.emitTool()
  }

  /** Seleciona um componente da biblioteca para ser colocado pela ferramenta Construir. */
  setBuildComponentPlacement(name: string, model: THREE.Object3D, height: number): void {
    model.userData.importPart = true
    this.pendingBuildComponent = { name, model, height }
  }

  private placePendingBuildComponent(x: number, baseY: number, z: number): boolean {
    const pending = this.pendingBuildComponent
    if (!pending) return false
    try {
      if (pending.model.userData.nativeHorseComponent === true) {
        this.placeNativeHorseComponent(
          x, baseY, z, pending.name,
          pending.model.userData.componentLogic,
          pending.model.userData,
        )
      } else {
        const existingIds = new Set(this.world.list().map(object => object.id))
        const model = pending.model.clone(true)
        model.userData = { ...pending.model.userData, importPart: true }
        this.addImportedModel(pending.name, model, pending.height)
        const created = this.world.list().find(object => !existingIds.has(object.id))
        if (!created) return false
        created.mesh.position.set(x, baseY + pending.height / 2, z)
        created.mesh.updateMatrixWorld(true)
        this.world.notifyChanged(created.id)
        this.applyComponentLogic(created.id, pending.model.userData.componentLogic)
      }
      // A ferramenta Construir permanece ativa para colocar várias cópias.
      this.state.tool = 'build'
      this.transformControls.detach()
      this.transformControls.enabled = false
      this.emitTool()
      return true
    } catch (error) {
      console.error('[Engine] Não foi possível construir o componente:', error)
      // O clique foi consumido pela ferramenta de componente; não crie um cubo de fallback.
      return true
    }
  }

  /** Adiciona um modelo externo como objeto transformável na cena. */
  addImportedModel(name: string, model: THREE.Object3D, targetHeight: number, restoreData?: SceneObjectData): void {
    // Evita congelamentos ao inserir assets acidentalmente gigantes no editor.
    // A contagem é feita antes da análise de agrupamento e antes de adicionar ao render loop.
    const MAX_IMPORTED_TRIANGLES = 1_500_000
    let preflightTriangles = 0
    let preflightMeshes = 0
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      preflightMeshes += 1
      const position = child.geometry.getAttribute('position')
      preflightTriangles += child.geometry.index
        ? child.geometry.index.count / 3
        : (position?.count ?? 0) / 3
    })
    if (preflightMeshes === 0 || preflightTriangles === 0) {
      throw new Error('O modelo não contém malhas trianguladas para inserir no mundo.')
    }
    if (preflightTriangles > MAX_IMPORTED_TRIANGLES) {
      throw new Error(`Este modelo contém ${Math.round(preflightTriangles).toLocaleString('pt-BR')} triângulos, acima do limite seguro de ${MAX_IMPORTED_TRIANGLES.toLocaleString('pt-BR')}. Reduza ou otimize o modelo antes de importá-lo.`)
    }

    // Alguns GLBs representam cada árvore como um grupo; outros exportam tronco,
    // copa e galhos como irmãos. Agrupamos irmãos pelo centro X/Z para separar
    // árvores sem transformar cada malha (tronco/folhas) em um objeto isolado.
    const importedAnimations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    // Modelos animados precisam manter a hierarquia original: separar malhas por
    // proximidade espacial quebra os caminhos dos tracks (por exemplo, MorphBake).
    // A divisão em componentes continua disponível para assets estáticos com várias cópias.
    if (model.userData.importPart !== true && importedAnimations.length === 0) {
      model.removeFromParent()
      model.updateMatrixWorld(true)

      type PartCluster = { center: THREE.Vector3; nodes: THREE.Object3D[]; span: number }
      const hasMesh = (node: THREE.Object3D): boolean => {
        let found = false
        node.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry.getAttribute('position')) found = true
        })
        return found
      }
      const boundsOf = (node: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(node)
      const clustersOf = (node: THREE.Object3D): PartCluster[] => {
        const candidates = node.children.filter(hasMesh)
        if (candidates.length < 2) return []
        const clusters: PartCluster[] = []
        for (const candidate of candidates) {
          const bounds = boundsOf(candidate)
          if (bounds.isEmpty()) continue
          const center = bounds.getCenter(new THREE.Vector3())
          const size = bounds.getSize(new THREE.Vector3())
          const span = Math.max(size.x, size.z, 0.001)
          // Componentes da mesma árvore tendem a compartilhar o centro X/Z.
          // A tolerância escala com o tamanho das próprias malhas.
          const existing = clusters.find((cluster) => {
            const distance = Math.hypot(center.x - cluster.center.x, center.z - cluster.center.z)
            const tolerance = Math.max(0.2, Math.min(span, cluster.span) * 0.28)
            return distance <= tolerance
          })
          if (existing) {
            existing.nodes.push(candidate)
            const count = existing.nodes.length
            existing.center.lerp(center, 1 / count)
            existing.span = Math.max(existing.span, span)
          } else {
            clusters.push({ center, nodes: [candidate], span })
          }
        }
        return clusters
      }

      let bestContainer: THREE.Object3D | null = null
      let bestClusters: PartCluster[] = []
      const findPartContainer = (node: THREE.Object3D): void => {
        const clusters = clustersOf(node)
        // Preferir o nível com mais exemplares separados, normalmente as três árvores.
        if (clusters.length >= 2 && clusters.length > bestClusters.length) {
          bestContainer = node
          bestClusters = clusters
        }
        for (const child of node.children) findPartContainer(child)
      }
      findPartContainer(model)

      if (bestContainer && bestClusters.length >= 2) {
        const animations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
        console.info('[Engine] Componentes espaciais do GLB:', {
          name,
          clusters: bestClusters.map((cluster, index) => ({
            name: cluster.nodes.map((part) => part.name).filter(Boolean).join(' + ') || `Árvore ${index + 1}`,
            meshes: cluster.nodes.reduce((total, part) => {
              let count = 0
              part.traverse((child) => { if (child instanceof THREE.Mesh) count += 1 })
              return total + count
            }, 0),
            center: cluster.center.toArray(),
          })),
          animationClips: animations.map((clip) => clip.name),
        })

        bestClusters.forEach((cluster, index) => {
          const group = new THREE.Group()
          const label = cluster.nodes.map((part) => part.name.trim()).filter(Boolean)[0] || `Árvore ${index + 1}`
          group.name = label
          // Converta cada irmão para coordenadas do mundo antes de reagrupá-lo.
          // Isso mantém as transformações do GLB e os nomes usados pelas animações.
          for (const part of cluster.nodes) {
            part.updateWorldMatrix(true, false)
            const worldMatrix = part.matrixWorld.clone()
            part.removeFromParent()
            worldMatrix.decompose(part.position, part.quaternion, part.scale)
            part.updateMatrix()
            group.add(part)
          }
          const bounds = boundsOf(group)
          const center = bounds.getCenter(new THREE.Vector3())
          group.position.set(-center.x, -center.y, -center.z)
          group.userData.importOffset = [center.x, center.z]
          group.userData.importAnimations = animations
          group.userData.importPart = true
          this.addImportedModel(`${name} — ${label}`, group, targetHeight)
        })
        return
      }
    }

    // O modelo vem do preview, cuja cena não deve continuar sendo dona dele.
    // Removê-lo antes de calcular os limites evita misturar transformações de pais externos.
    model.removeFromParent()
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    if (bounds.isEmpty()) throw new Error('O modelo importado não possui geometria visível.')

    const originalSize = bounds.getSize(new THREE.Vector3())
    if (!Number.isFinite(originalSize.y) || originalSize.y <= 0) {
      throw new Error('Não foi possível calcular a altura do modelo importado.')
    }

    // Modelos de terceiros podem conter dezenas de malhas e sombras caras.
    // Desativa sombras por malha importada e prepara limites de geometria para
    // evitar trabalho desnecessário durante renderização e seleção.
    let meshCount = 0
    let triangleCount = 0
    const importedMeshes: THREE.Mesh[] = []
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      importedMeshes.push(child)
      meshCount += 1
      // Não herdar estado de visibilidade de exporters/visualizadores externos.
      child.visible = true
      child.castShadow = false
      child.receiveShadow = false
      // Assets GLB podem trazer bounding spheres incorretas ou muito pequenas.
      // Desativar frustum culling evita que a malha desapareça após ser movida
      // do preview para a cena principal, sem afetar a caixa de seleção.
      child.frustumCulled = false
      const geometries = child.geometry
      if (!geometries.boundingSphere) geometries.computeBoundingSphere()
      if (!geometries.boundingBox) geometries.computeBoundingBox()
      const position = geometries.getAttribute('position')
      if (position) triangleCount += geometries.index
        ? geometries.index.count / 3
        : position.count / 3
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
      // Cada objeto importado recebe materiais próprios: alterar a cor de uma
      // árvore não deve modificar as outras árvores que compartilham materiais no GLB.
      const materials = sourceMaterials.map((material) => material.clone())
      child.material = Array.isArray(child.material) ? materials : (materials[0] ?? child.material)
      for (const material of materials) {
        // Preserve os valores PBR do glTF e garanta que mapas de cor sejam lidos
        // como sRGB, inclusive em arquivos exportados com metadados incompletos.
        material.visible = true
        const texturedMaterial = material as THREE.Material & {
          colorWrite?: boolean
          map?: THREE.Texture | null
          emissiveMap?: THREE.Texture | null
        }
        if (texturedMaterial.map) texturedMaterial.map.colorSpace = THREE.SRGBColorSpace
        if (texturedMaterial.emissiveMap) texturedMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace
        if ('colorWrite' in texturedMaterial) texturedMaterial.colorWrite = true
        material.needsUpdate = true
      }
    })
    if (meshCount === 0 || triangleCount === 0) {
      throw new Error('O arquivo foi carregado, mas não contém malhas trianguladas para renderizar.')
    }
    // Evita manter uma hierarquia invisível herdada do preview.
    // A visibilidade de qualquer ancestral controla todos os descendentes.
    let ancestor: THREE.Object3D | null = model
    while (ancestor) {
      ancestor.visible = true
      ancestor = ancestor.parent
    }
    // A seleção usa uma caixa simples; o modelo real não precisa ser testado
    // face por face pelo raycaster a cada clique.
    model.userData.importStats = { meshCount, triangleCount }
    console.info('[Engine] Modelo importado preparado:', {
      name,
      meshCount,
      triangleCount,
      bounds: originalSize.toArray(),
      visibleMeshes: importedMeshes.filter((mesh) => mesh.visible).length,
    })

    const height = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : originalSize.y
    // Preserva o nó raiz original do glTF: os clips podem referenciar seu nome
    // e seus transforms. A centralização fica num pivô externo e estável.
    const scaleFactor = height / originalSize.y
    model.scale.multiplyScalar(scaleFactor)
    model.updateMatrixWorld(true)
    const scaledBounds = new THREE.Box3().setFromObject(model)
    const visualCenter = scaledBounds.getCenter(new THREE.Vector3())
    const finalSize = scaledBounds.getSize(new THREE.Vector3())
    const visualPivot = new THREE.Group()
    visualPivot.name = 'ImportedVisualPivot'
    visualPivot.position.copy(visualCenter).negate()
    visualPivot.add(model)

    // Use os clips originais do GLTFLoader: filtrar os nomes dos tracks por
    // comparação textual removia animações válidas em alguns rigs/exportadores.
    // Só uma animação toca por vez para evitar que idle/walk/run briguem pelos ossos.
    const animationClips = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    const idleClip = animationClips.find((clip) => /idle|stand|rest|breath|neutral/i.test(clip.name))
      ?? animationClips[0]
    let animationMixer: THREE.AnimationMixer | undefined
    if (idleClip) {
      animationMixer = new THREE.AnimationMixer(model)
      animationMixer.clipAction(idleClip).setLoop(THREE.LoopRepeat, Infinity).play()
      console.info('[Engine] Animação inicial do componente:', {
        name,
        clip: idleClip.name || '(primeira animação do modelo)',
        availableClips: animationClips.map((clip) => clip.name),
      })
    }

    // A caixa invisível usa exatamente o mesmo centro e as mesmas dimensões
    // da malha centralizada; o gizmo e os cliques passam a acompanhar o cavalo.
    const proxyGeometry = new THREE.BoxGeometry(
      Math.max(finalSize.x, 0.05),
      Math.max(height, 0.05),
      Math.max(finalSize.z, 0.05),
    )
    const proxyMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
    })
    const root = new THREE.Mesh(proxyGeometry, proxyMaterial)
    root.name = name.trim() || 'Modelo importado'
    const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48)
    const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48)
    const importOffset = model.userData.importOffset as [number, number] | undefined
    root.position.set(
      restoreData?.position[0] ?? x + (importOffset?.[0] ?? 0) * scaleFactor,
      restoreData?.position[1] ?? this.world.terrain.heightAt(x, z) + height / 2,
      restoreData?.position[2] ?? z + (importOffset?.[1] ?? 0) * scaleFactor,
    )
    if (restoreData) {
      root.rotation.set(...restoreData.rotation)
      root.scale.set(...restoreData.scale)
      root.visible = restoreData.visible
    }
    if (animationMixer) root.userData.importAnimationMixer = animationMixer
    root.add(visualPivot)
    // Atualiza toda a hierarquia antes de entrar no loop de renderização.
    // Isso também garante bounds corretos para GLB com nós e transforms aninhados.
    root.updateMatrixWorld(true)
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.visible = true
        child.frustumCulled = false
      }
    })
    root.frustumCulled = false
    root.updateMatrixWorld(true)
    const renderedBounds = new THREE.Box3().setFromObject(model)
    console.info('[Engine] Modelo na cena:', {
      name: root.name,
      rootPosition: root.position.toArray(),
      modelPosition: model.position.toArray(),
      bounds: renderedBounds.isEmpty() ? 'empty' : {
        min: renderedBounds.min.toArray(),
        max: renderedBounds.max.toArray(),
      },
      meshesVisible: importedMeshes.filter(mesh => mesh.visible).length,
      meshCount: importedMeshes.length,
    })

    const id = `model_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
    root.userData.id = id
    root.userData.locked = false
    root.userData.groupId = null
    root.userData.wireframeVisible = false
    root.userData.mass = 1
    // O colisor é configurado no importador e fica independente da malha visual.
    root.userData.colliderType = model.userData.importColliderType === 'box' || model.userData.importColliderType === 'sphere' || model.userData.importColliderType === 'capsule' || model.userData.importColliderType === 'none'
      ? model.userData.importColliderType
      : 'box'
    const importedColliderSize = model.userData.importColliderSize
    if (Array.isArray(importedColliderSize) && importedColliderSize.length === 3 && importedColliderSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
      root.userData.colliderSize = importedColliderSize.map((value: number) => clamp(value, 0.05, 100))
    }
    const importedColliderOffset = model.userData.importColliderOffset
    if (Array.isArray(importedColliderOffset) && importedColliderOffset.length === 3 && importedColliderOffset.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
      root.userData.colliderOffset = importedColliderOffset.map((value: number) => clamp(value, -100, 100))
    }
    root.userData.importedModel = true
    root.userData.componentId = typeof model.userData.componentId === 'string' ? model.userData.componentId : undefined
    root.userData.componentLogic = Array.isArray(model.userData.componentLogic) ? model.userData.componentLogic : []
    root.userData.importedModelData = typeof model.userData.importedModelData === 'string' ? model.userData.importedModelData : restoreData?.importedModelData
    root.userData.importedModelHeight = height
    if (restoreData) {
      root.userData.locked = restoreData.locked ?? false
      root.userData.groupId = restoreData.groupId ?? null
      root.userData.wireframeVisible = restoreData.wireframeVisible ?? false
      root.userData.mass = restoreData.mass ?? 1
      if (restoreData.colliderType) root.userData.colliderType = restoreData.colliderType
      if (restoreData.colliderSize) root.userData.colliderSize = [...restoreData.colliderSize]
      if (restoreData.colliderOffset) root.userData.colliderOffset = [...restoreData.colliderOffset]
    }
    const finalId = restoreData?.id ?? id
    root.userData.id = finalId
    this.world.add({ id: finalId, name: root.name, type: 'cube', mesh: root })
    // Ao restaurar um projeto, o ID persistido é diferente do ID temporário.
    // Selecionar o temporário deixa a raiz sem seleção válida para o gizmo.
    this.world.select(finalId)
    this.state.tool = 'select'
    this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform)
    this.transformControls.attach(root)
    this.emitTool()
  }

  select(id: string | null): void {
    this.world.select(id)
  }

  selectedId(): string | null {
    return this.world.getSelectedId()
  }

  removeObject(id: string): void {
    const object = this.world.get(id)
    if (object?.mesh.userData.nativeComponentType === 'horse') this.horseMount.setEditorComponent(null)
    this.world.remove(id)
    this.logic.removeObjectVariables(id)
  }

  renameObject(id: string, name: string): void {
    this.world.rename(id, name)
  }

  updateObject(id: string, patch: ObjectPatch): void {
    this.world.update(id, patch)
    const object = this.world.get(id)
    if (id === this.world.getSelectedId() && object?.mesh.userData.locked === true) this.transformControls.detach()
    else if (id === this.world.getSelectedId() && object) this.transformControls.attach(object.mesh)
  }

  toggleObjectLock(id: string): void {
    const object = this.world.get(id)
    if (!object) return
    this.world.update(id, { locked: object.mesh.userData.locked !== true })
    if (id === this.world.getSelectedId()) {
      if (object.mesh.userData.locked === true) this.transformControls.detach()
      else this.transformControls.attach(object.mesh)
    }
  }

  groupObjects(ids: string[]): void {
    const unique = [...new Set(ids)].filter(id => this.world.get(id))
    if (unique.length < 2) return
    const groupId = uuid()
    for (const id of unique) this.world.update(id, { groupId })
  }

  ungroupObjects(ids: string[]): void {
    for (const id of ids) if (this.world.get(id)) this.world.update(id, { groupId: null })
  }

  toggleObjectWireframe(id: string): void {
    const object = this.world.get(id)
    if (!object) return
    this.world.update(id, { wireframeVisible: object.mesh.userData.wireframeVisible === false })
  }

  listObjects(): ObjectInfo[] {
    return this.world.info()
  }

  // ---- terreno ----
  terrainInfo(): TerrainInfo {
    return this.world.terrainInfo()
  }

  setTerrainVisible(visible: boolean): void {
    this.world.setTerrainVisible(visible)
  }

  setGridVisible(visible: boolean): void {
    this.world.setGridVisible(visible)
  }

  setColliderDebugVisible(visible: boolean): void {
    this.collisions.setDebugVisible(visible)
  }

  isColliderDebugVisible(): boolean {
    return this.collisions.isDebugVisible()
  }

  isGridVisible(): boolean {
    return this.world.isGridVisible()
  }

  regenerateTerrain(): void {
    this.world.regenerateTerrain(randomSeed())
  }

  clearTerrainEdits(): void {
    this.world.clearTerrainEdits()
  }

  // ---- projeto ----
  newProject(name = 'Novo Mundo'): void {
    resetIds()
    this.meta = { id: uuid(), name }
    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    this.orbit.setPreset('free')
    this.events.emit('cameraChanged', { preset: 'free' })
    this.world.replaceAll([], { seed: randomSeed(), visible: true, edits: [] })
    this.horseMount.setEditorComponent(null)
    this.world.setEnvironment({ skyTextureDataUrl: '', timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1 })
    this.avatar.reset()
    this.collisions.clear()
    this.world.setGridVisible(true)
    this.setBrush({ strength: 1.5, radius: 4 })
    this.logic.load()
  }

  exportProject(): ProjectBundle {
    const bundle = buildBundle(this.world.list(), this.world.terrainData(), this.orbit.getState(), this.meta, {
      gridVisible: this.world.isGridVisible(),
      brushStrength: this.state.brush.strength,
      brushRadius: this.state.brush.radius,
    })
    const scenePath = bundle.project.scenes[0] ?? MAIN_SCENE_PATH
    bundle.scenes[scenePath].environment = this.world.getEnvironment()
    bundle.logic = this.logic.exportData()
    return bundle
  }

  async loadProject(
    bundle: ProjectBundle,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    const report = (message: string, percent: number) => onProgress?.(message, Math.max(0, Math.min(100, percent)))
    const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

    this.orbit.setFirstPersonMode(false)
    this.avatar.setFirstPersonMode(false)
    const firstPath = bundle.project.scenes[0] ?? MAIN_SCENE_PATH
    const scene = bundle.scenes[firstPath]
    if (!scene) throw new ProjectFormatError('O projeto não tem nenhuma cena para carregar.')

    resetIds()
    this.meta = { id: bundle.project.id, name: bundle.project.name }
    this.orbit.restore(scene.camera)
    this.events.emit('cameraChanged', { preset: scene.camera.preset })

    report('Preparando o terreno e os objetos básicos…', 5)
    const regularObjects = scene.objects.filter(object => !object.importedModelData || object.nativeComponentType === 'horse')
    const restoredObjects: ReturnType<typeof objectFromData>[] = []
    // Construir objetos em lotes permite que a interface atualize o progresso
    // em projetos com muitas centenas ou milhares de objetos.
    for (let i = 0; i < regularObjects.length; i += 50) {
      const batch = regularObjects.slice(i, i + 50)
      for (const data of batch) restoredObjects.push(objectFromData(data))
      const percent = regularObjects.length
        ? 5 + Math.round((Math.min(i + batch.length, regularObjects.length) / regularObjects.length) * 20)
        : 25
      report(`Preparando objetos básicos… ${Math.min(i + batch.length, regularObjects.length)}/${regularObjects.length}`, percent)
      if (i + 50 < regularObjects.length) await yieldToUi()
    }
    this.horseMount.setEditorComponent(null)
    this.world.replaceAll(restoredObjects, scene.terrain)
    // Reconstrói o proxy editável do cavalo nativo e o conecta ao mesmo HorseMount
    // que executa animações, colisão e montaria. O GLB não é duplicado no projeto.
    const nativeHorseData = regularObjects.find(object => object.nativeComponentType === 'horse')
    if (nativeHorseData) {
      const nativeHorse = this.world.get(nativeHorseData.id)?.mesh
      if (nativeHorse) {
        nativeHorse.geometry.dispose()
        nativeHorse.geometry = new THREE.BoxGeometry(1.55, nativeHorseData.importedModelHeight ?? 2.05, 2.8)
        const materials = Array.isArray(nativeHorse.material) ? nativeHorse.material : [nativeHorse.material]
        materials.forEach(material => material.dispose())
        nativeHorse.material = new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, colorWrite: false, depthWrite: false, depthTest: false,
        })
        nativeHorse.userData.nativeComponentType = 'horse'
        nativeHorse.userData.nativeHorseComponent = true
        nativeHorse.userData.componentId = nativeHorseData.componentId ?? 'builtin-horse-low-poly'
        nativeHorse.userData.importedModel = true
        nativeHorse.userData.importedModelData = nativeHorseData.importedModelData
        nativeHorse.userData.importedModelHeight = nativeHorseData.importedModelHeight ?? 2.05
        nativeHorse.userData.colliderType = nativeHorseData.colliderType ?? 'box'
        nativeHorse.userData.colliderSize = nativeHorseData.colliderSize ?? [0.95, 1.35, 1.6]
        nativeHorse.userData.colliderOffset = nativeHorseData.colliderOffset ?? [0, 0.02, 0]
        this.horseMount.setEditorComponent(nativeHorse)
      }
    }
    this.world.setEnvironment(scene.environment ?? { timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1, skyTextureDataUrl: '' })
    report('Terreno pronto. Restaurando modelos 3D…', 28)

    const importedObjects = scene.objects.filter(object => !!object.importedModelData && object.nativeComponentType !== 'horse')
    const loader = new GLTFLoader()
    for (let i = 0; i < importedObjects.length; i += 1) {
      const data = importedObjects[i]!
      report(`Carregando modelo ${i + 1} de ${importedObjects.length}: ${data.name}…`, 30 + Math.round((i / Math.max(importedObjects.length, 1)) * 60))
      try {
        const binary = Uint8Array.from(atob(data.importedModelData!), char => char.charCodeAt(0)).buffer
        const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>((resolve, reject) => {
          loader.parse(binary, '', resolve, reject)
        })
        const model = gltf.scene
        // O nome visível fica no proxy; preservar o nome do nó glTF mantém os bindings de animação.
        model.userData.importPart = true
        model.userData.importAnimations = gltf.animations
        model.userData.componentId = data.componentId
        model.userData.importedModelData = data.importedModelData
        model.userData.importColliderType = data.colliderType ?? 'box'
        model.userData.importColliderSize = data.colliderSize ?? [1, 1, 1]
        model.userData.importColliderOffset = data.colliderOffset ?? [0, 0, 0]
        this.addImportedModel(data.name, model, data.importedModelHeight ?? 1, { ...data, importedModelData: data.importedModelData })
      } catch (error) {
        console.error('[Engine] Não foi possível restaurar o modelo importado:', data.name, error)
        throw new ProjectFormatError(`Não foi possível carregar o modelo "${data.name}" salvo no projeto.`)
      }
      // Dá ao navegador/Tauri a chance de pintar a barra e processar eventos
      // entre assets, em vez de bloquear a interface até terminar tudo.
      await yieldToUi()
    }

    report('Finalizando configurações do editor…', 93)
    const editorSettings = bundle.project.settings.editor
    this.world.setGridVisible(editorSettings.gridVisible)
    this.setBrush({ strength: editorSettings.brushStrength, radius: editorSettings.brushRadius })
    this.logic.load(bundle.logic)
    // Migra cavalos de projetos antigos para o fluxo visual embutido padrão.
    for (const object of this.world.list()) {
      if (object.mesh.userData.nativeComponentType === 'horse' || object.mesh.userData.nativeHorseComponent === true || object.mesh.userData.componentId === 'builtin-horse-low-poly') {
        this.ensureHorseLogic(object.id)
      }
    }
    report('Mundo carregado.', 100)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onRuleKeyDown)
    this.input.dispose()
    this.horseMount.dispose()
    this.avatar.dispose()
    this.collisions.clear()
    this.transformControls.dispose()
    this.viewport.dispose()
  }
}
