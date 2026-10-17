import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Object3D } from 'three'
import { Engine, TERRAIN_ID, DEFAULT_CONTROL_MAPS } from '@engine'
import type {
  CameraPreset,
  ObjectInfo,
  ObjectPatch,
  ObjectType,
  TerrainInfo,
  ToolMode,
  TransformMode,
  LogicRule,
  BehaviorPackageInstance,
  TextureFace,
  FaceTextureData,
  ControlMapBindings,
} from '@engine'
import {
  chooseFolder,
  confirmDiscard,
  confirmOverwrite,
  loadProjectFrom,
  projectExistsIn,
  saveProjectTo,
} from '@/project/projectService'

type PerformancePreset = 'quality' | 'balanced' | 'economy' | 'auto'
type AppliedPerformancePreset = Exclude<PerformancePreset, 'auto'>
type RenderStats = {
  fps: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  cpuRenderMs: number
  cpuUpdateMs: number
}

export const CAMERA_LABELS: Record<CameraPreset, string> = {
  free: 'Câmera livre',
  isometric: 'Isométrica',
  top: 'Vista de topo',
}

export type NumField = 'x' | 'y' | 'z' | 'rotationX' | 'rotationY' | 'rotationZ' | 'scale' | 'scaleX' | 'scaleY' | 'scaleZ' | 'mass'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Toda a lógica do editor para a interface: estado reativo + ações que chamam o engine. */
export function useEditor(canvas: Ref<HTMLCanvasElement | null>) {
  const projectName = ref('Novo Mundo')
  const projectDir = ref<string | null>(null)
  const dirty = ref(false)
  const status = ref('')
  const fps = ref(0)
  const renderStats = ref<RenderStats>({
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    cpuRenderMs: 0,
    cpuUpdateMs: 0,
  })
  const ioProgress = ref<{ active: boolean; kind: 'save' | 'load'; message: string; percent: number }>({ active: false, kind: 'save', message: '', percent: 0 })
  const objects = ref<ObjectInfo[]>([])
  const selectedModelNodes = ref<Array<{ path: string; name: string; meshCount: number }>>([])
  const terrain = ref<TerrainInfo>({ visible: true, seed: 0, edits: 0 })
  const selectedId = ref<string | null>(null)
  const groupSelection = ref<string[]>([])
  const tool = ref<ToolMode>('select')
  const transform = ref<TransformMode>('move')
  const cameraPreset = ref<CameraPreset>('free')
  const brushStrength = ref(1.5)
  const brushRadius = ref(4)
  const gridVisible = ref(true)
  const polygonLinesVisible = ref(false)
  const performanceMode = ref<PerformancePreset>('quality')
  const renderDistance = ref(72)
  const renderAll = ref(false)
  const playerModelName = ref('Modelo padrão (Dummy)')
  const playerModelCustom = ref(false)
  const skyTextureDataUrl = ref('')
  const timeOfDay = ref(12)
  const dayNightCycleEnabled = ref(false)
  const dayNightCycleSpeed = ref(0.1)
  const colliderDebugVisible = ref(false)
  const logicRules = ref<LogicRule[]>([])
  const behaviorPackages = ref<BehaviorPackageInstance[]>([])
  const logicVariables = ref<Record<string, boolean | number | string>>({})
  const globalLogicVariables = ref<Record<string, boolean | number | string>>({ has_key: false })
  const ruleTrigger = ref<'object_clicked' | 'enter_area' | 'key_pressed' | 'package_event'>('object_clicked')
  const rulePackageId = ref('mount')
  const rulePackageEventId = ref('mounted')
  const rulePackageVariableName = ref('mounted')
  const rulePackageVariableValue = ref('false')
  const ruleAction = ref<'move' | 'rotate' | 'set_visible' | 'set_variable' | 'set_package_variable' | 'script' | 'javascript'>('rotate')
  // Regras novas executam por padrão; o usuário pode ativar uma condição no inspetor.
  const ruleConditionEnabled = ref(false)

  let engine: Engine | null = null
  let playerControlBindings: ControlMapBindings = { ...DEFAULT_CONTROL_MAPS[0]!.bindings }
  let appliedPerformancePreset: AppliedPerformancePreset = 'quality'
  let autoPerformanceHealthySamples = 0
  let runtimeMode = false
  let statusTimer = 0
  let environmentSyncTimer = 0
  const offs: Array<() => void> = []
  let clipboardObject: ObjectInfo | null = null
  let clipboardImportedModel: Object3D | null = null
  let applyingHistory = false
  type ObjectHistoryEntry = { id: string; before: ObjectInfo; after: ObjectInfo; kind?: 'paste' | 'create' }
  const undoStack: ObjectHistoryEntry[] = []
  const redoStack: ObjectHistoryEntry[] = []
  const HISTORY_LIMIT = 100

  function sameObjectState(a: ObjectInfo, b: ObjectInfo): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  function rememberObjectChange(before: ObjectInfo, after: ObjectInfo) {
    if (applyingHistory || sameObjectState(before, after)) return
    undoStack.push({ id: after.id, before: { ...before }, after: { ...after } })
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    redoStack.length = 0
  }

  function applyObjectState(id: string, state: ObjectInfo) {
    if (!engine) return
    applyingHistory = true
    try {
      engine.updateObject(id, {
        x: state.x, y: state.y, z: state.z,
        rotationX: state.rotationX, rotationY: state.rotationY, rotationZ: state.rotationZ,
        scaleX: state.scaleX, scaleY: state.scaleY, scaleZ: state.scaleZ,
        color: state.color, texturePreset: state.texturePreset, textureRepeat: state.textureRepeat, faceTextures: state.faceTextures, visible: state.visible, locked: state.locked,
        wireframeVisible: state.wireframeVisible, groupId: state.groupId, mass: state.mass,
        colliderType: state.colliderType, colliderSize: [...state.colliderSize], colliderOffset: [...state.colliderOffset],
      })
      engine.renameObject(id, state.name)
      refresh()
      dirty.value = true
    } finally {
      applyingHistory = false
    }
  }

  function undo() {
    const entry = undoStack.pop()
    if (!entry) { say('Não há alterações de objeto para desfazer.'); return }
    if (entry.kind === 'paste' || entry.kind === 'create') {
      if (!engine || !objects.value.some(object => object.id === entry.id)) { undoStack.push(entry); say('O objeto não está mais na cena.'); return }
      applyingHistory = true
      try {
        engine.removeObject(entry.id)
        refresh()
        dirty.value = true
      } finally {
        applyingHistory = false
      }
      redoStack.push(entry)
      say(entry.kind === 'paste' ? 'Colagem desfeita.' : 'Construção desfeita.')
      return
    }
    const current = objects.value.find(object => object.id === entry.id)
    if (!current) { undoStack.push(entry); say('Não é possível desfazer: o objeto não está mais na cena.'); return }
    redoStack.push({ ...entry, after: { ...current } })
    applyObjectState(entry.id, entry.before)
    say('Última alteração do objeto desfeita.')
  }

  function redo() {
    const entry = redoStack.pop()
    if (!entry) { say('Não há alterações para refazer.'); return }
    if (entry.kind === 'paste' || entry.kind === 'create') {
      if (!engine) { redoStack.push(entry); return }
      // Modelos importados precisam conservar a geometria original para refazer.
      if (engine.world.get(entry.id)?.mesh.userData.importedModel === true) {
        redoStack.push(entry)
        say('Não é possível refazer este modelo importado ainda.')
        return
      }
      const existingIds = new Set(engine.listObjects().map(object => object.id))
      engine.addPrimitive(entry.after.type)
      const created = engine.listObjects().find(object => !existingIds.has(object.id))
      if (!created) { redoStack.push(entry); say('Não foi possível refazer a construção.'); return }
      applyingHistory = true
      try {
        engine.updateObject(created.id, {
          x: entry.after.x, y: entry.after.y, z: entry.after.z,
          rotationX: entry.after.rotationX, rotationY: entry.after.rotationY, rotationZ: entry.after.rotationZ,
          scaleX: entry.after.scaleX, scaleY: entry.after.scaleY, scaleZ: entry.after.scaleZ,
          color: entry.after.color, texturePreset: entry.after.texturePreset, textureRepeat: entry.after.textureRepeat, faceTextures: entry.after.faceTextures, visible: entry.after.visible, locked: false,
          wireframeVisible: entry.after.wireframeVisible, groupId: null, mass: entry.after.mass,
          colliderType: entry.after.colliderType, colliderSize: [...entry.after.colliderSize], colliderOffset: [...entry.after.colliderOffset],
        })
        engine.renameObject(created.id, entry.after.name)
        engine.select(created.id)
        refresh()
        dirty.value = true
      } finally {
        applyingHistory = false
      }
      undoStack.push({ ...entry, id: created.id, after: { ...entry.after, id: created.id } })
      say(entry.kind === 'paste' ? 'Colagem refeita.' : 'Construção refeita.')
      return
    }
    if (!objects.value.some(object => object.id === entry.id)) { redoStack.push(entry); say('Não é possível refazer: o objeto não está mais na cena.'); return }
    undoStack.push({ ...entry, before: { ...(objects.value.find(object => object.id === entry.id) ?? entry.before) } })
    applyObjectState(entry.id, entry.after)
    say('Alteração refeita.')
  }

  function copySelectedObject() {
    const object = objects.value.find(item => item.id === selectedId.value)
    if (!object || object.id === TERRAIN_ID) { say('Selecione um objeto para copiar.'); return }
    const sourceObject = engine?.world.get(object.id)
    if (sourceObject?.mesh.userData.importedModel === true) {
      const visualModel = sourceObject.mesh.children[0]
      if (!visualModel) {
        say('Não foi possível localizar a malha visual deste modelo.')
        return
      }
      clipboardImportedModel = visualModel.clone(true)
      clipboardImportedModel.userData = {
        ...visualModel.userData,
        importPart: true,
        importAnimations: sourceObject.mesh.userData.importAnimationMixer
          ? (visualModel.userData.importAnimations ?? [])
          : (visualModel.userData.importAnimations ?? []),
      }
    } else {
      clipboardImportedModel = null
    }
    clipboardObject = JSON.parse(JSON.stringify(object)) as ObjectInfo
    say(`Objeto "${object.name}" copiado.`)
  }

  function pasteObject() {
    if (!engine || !clipboardObject) { say('Copie um objeto antes de colar.'); return }
    const source = clipboardObject
    const existingIds = new Set(engine.listObjects().map(object => object.id))
    const isImportedModel = clipboardImportedModel !== null
    if (isImportedModel && clipboardImportedModel) {
      const model = clipboardImportedModel.clone(true)
      model.userData = { ...clipboardImportedModel.userData, importPart: true }
      const height = Number(source.type === 'cube' ? engine.world.get(source.id)?.mesh.userData.importedModelHeight : undefined)
      const fallbackHeight = Math.max(0.05, source.scaleY)
      engine.addImportedModel(
        source.name.endsWith(' - cópia') ? source.name : `${source.name} - cópia`,
        model,
        Number.isFinite(height) && height > 0 ? height : fallbackHeight,
      )
    } else {
      engine.addPrimitive(source.type)
    }
    const created = engine.listObjects().find(object => !existingIds.has(object.id))
    if (!created) { say('Não foi possível colar o objeto.'); return }
    const pastedState: ObjectInfo = {
      ...source,
      id: created.id,
      name: source.name.endsWith(' - cópia') ? source.name : `${source.name} - cópia`,
      x: source.x + 1,
      z: source.z + 1,
    }
    applyingHistory = true
    try {
      engine.updateObject(created.id, {
        x: pastedState.x, y: pastedState.y, z: pastedState.z,
        rotationX: pastedState.rotationX, rotationY: pastedState.rotationY, rotationZ: pastedState.rotationZ,
        scaleX: pastedState.scaleX, scaleY: pastedState.scaleY, scaleZ: pastedState.scaleZ,
        color: pastedState.color, texturePreset: pastedState.texturePreset, textureRepeat: pastedState.textureRepeat, faceTextures: pastedState.faceTextures, visible: pastedState.visible, locked: false,
        wireframeVisible: pastedState.wireframeVisible, groupId: null, mass: pastedState.mass,
        colliderType: pastedState.colliderType, colliderSize: [...pastedState.colliderSize], colliderOffset: [...pastedState.colliderOffset],
      })
      engine.renameObject(created.id, pastedState.name)
      engine.select(created.id)
      refresh()
      dirty.value = true
    } finally {
      applyingHistory = false
    }
    undoStack.push({ id: created.id, before: { ...pastedState }, after: { ...pastedState }, kind: 'paste' })
    // Colagem é uma ação própria: Ctrl+Z remove a cópia recém-criada.
    say(`"${pastedState.name}" colado. Use Ctrl+Z para desfazer.`)
  }

  function say(message: string) {
    status.value = message
    window.clearTimeout(statusTimer)
    window.clearInterval(environmentSyncTimer)
    statusTimer = window.setTimeout(() => {
      status.value = ''
    }, 7000)
  }

  const PERFORMANCE_SETTINGS_KEY = 'engine-prometheus.performance-preset'

  function loadPerformanceSettings() {
    try {
      const saved = window.localStorage.getItem(PERFORMANCE_SETTINGS_KEY)
      if (saved === 'quality' || saved === 'balanced' || saved === 'economy' || saved === 'auto') {
        performanceMode.value = saved
      }
    } catch (error) {
      console.warn('[EditorSettings] Não foi possível carregar o modo de desempenho.', error)
    }
  }

  function persistPerformanceSettings() {
    try {
      window.localStorage.setItem(PERFORMANCE_SETTINGS_KEY, performanceMode.value)
    } catch (error) {
      console.warn('[EditorSettings] Não foi possível salvar o modo de desempenho.', error)
    }
  }

  function updateAutoPerformancePreset(stats: RenderStats) {
    if (performanceMode.value !== 'auto' || !engine) return

    const current = appliedPerformancePreset
    let next = current
    if (stats.fps <= 18 || stats.triangles >= 4_000_000) {
      next = 'economy'
      autoPerformanceHealthySamples = 0
    } else if (current === 'quality') {
      if (stats.fps < 38 || stats.triangles >= 2_800_000) next = 'balanced'
      autoPerformanceHealthySamples = 0
    } else if (current === 'balanced') {
      if (stats.fps < 23 || stats.triangles >= 4_000_000) {
        next = 'economy'
        autoPerformanceHealthySamples = 0
      } else if (stats.fps >= 52 && stats.triangles < 1_500_000) {
        autoPerformanceHealthySamples += 1
        if (autoPerformanceHealthySamples >= 4) next = 'quality'
      } else {
        autoPerformanceHealthySamples = 0
      }
    } else if (stats.fps >= 48 && stats.triangles < 2_000_000) {
      // Só recupera qualidade depois de várias janelas saudáveis para evitar oscilações.
      autoPerformanceHealthySamples += 1
      if (autoPerformanceHealthySamples >= 4) next = 'balanced'
    } else {
      autoPerformanceHealthySamples = 0
    }

    if (next === current) return
    appliedPerformancePreset = next
    autoPerformanceHealthySamples = 0
    engine.setPerformancePreset(next)
    const labels: Record<AppliedPerformancePreset, string> = {
      quality: 'qualidade',
      balanced: 'equilibrado',
      economy: 'econômico',
    }
    say(`Modo automático ajustou a renderização para ${labels[next]} (${stats.fps} FPS, ${(stats.triangles / 1000).toFixed(0)} mil triângulos).`)
  }

  const RENDER_SETTINGS_KEY = 'engine-prometheus.render-settings'
  const LEGACY_GRASS_RENDER_SETTINGS_KEY = 'engine-prometheus.grass-render-settings'

  function persistRenderSettings() {
    try {
      window.localStorage.setItem(RENDER_SETTINGS_KEY, JSON.stringify({
        distance: renderDistance.value,
        renderAll: renderAll.value,
      }))
    } catch (error) {
      console.warn('[EditorSettings] Não foi possível salvar as configurações de renderização.', error)
    }
  }

  function setRenderDistance(value: number) {
    if (!Number.isFinite(value)) return
    renderDistance.value = Math.round(Math.max(10, Math.min(5000, value)))
    if (!renderAll.value) engine?.setRenderDistance(renderDistance.value)
    persistRenderSettings()
  }

  function setRenderAll(enabled: boolean) {
    renderAll.value = enabled
    engine?.setRenderDistance(enabled ? null : renderDistance.value)
    persistRenderSettings()
  }

  function loadRenderSettings() {
    try {
      const raw = window.localStorage.getItem(RENDER_SETTINGS_KEY) ?? window.localStorage.getItem(LEGACY_GRASS_RENDER_SETTINGS_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return
      const settings = parsed as { distance?: unknown; renderAll?: unknown }
      if (typeof settings.distance === 'number' && Number.isFinite(settings.distance)) {
        renderDistance.value = Math.round(Math.max(10, Math.min(5000, settings.distance)))
      }
      if (typeof settings.renderAll === 'boolean') renderAll.value = settings.renderAll
      // Migra as preferências antigas, salvas como renderização somente da grama.
      if (
        window.localStorage.getItem(RENDER_SETTINGS_KEY) === null
        && window.localStorage.getItem(LEGACY_GRASS_RENDER_SETTINGS_KEY) !== null
      ) persistRenderSettings()
    } catch (error) {
      console.warn('[EditorSettings] Configuração de renderização inválida; usando padrão.', error)
    }
  }

  // IDs de regras são únicos no projeto, inclusive ao importar ou criar eventos
  // rapidamente. UUID evita colisões entre eventos com o mesmo nome.
  function createUniqueRuleId(prefix = 'rule'): string {
    const existing = new Set(engine?.listRules().map(rule => rule.id) ?? [])
    let id = ''
    do {
      const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
      id = `${prefix}-${uuid}`
    } while (existing.has(id))
    return id
  }

  function refresh() {
    if (!engine) return
    objects.value = engine.listObjects()
    selectedModelNodes.value = selectedId.value ? engine.listImportedModelNodes(selectedId.value) : []
    terrain.value = engine.terrainInfo()
    gridVisible.value = engine.isGridVisible()
    const environment = engine.world.getEnvironment()
    skyTextureDataUrl.value = environment.skyTextureDataUrl
    timeOfDay.value = environment.timeOfDay
    dayNightCycleEnabled.value = environment.cycleEnabled
    dayNightCycleSpeed.value = environment.cycleSpeed
    logicRules.value = engine.listRules()
    behaviorPackages.value = engine.listBehaviorPackages()
    logicVariables.value = engine.logicVariables(selectedId.value)
    globalLogicVariables.value = engine.logicVariables()
  }

  // A seleção pode mudar por clique na cena ou pela hierarquia. Sincronize
  // explicitamente o inspetor lateral com o objeto atualmente selecionado.
  watch(selectedId, (id) => {
    if (!engine) return
    selectedModelNodes.value = id ? engine.listImportedModelNodes(id) : []
    logicRules.value = engine.listRules()
    behaviorPackages.value = engine.listBehaviorPackages()
    logicVariables.value = engine.logicVariables(id)
    globalLogicVariables.value = engine.logicVariables()
  }, { flush: 'sync' })

  let colliderInputActive = false

  function markDirty() {
    dirty.value = true
    if (!colliderInputActive) {
      const previous = objects.value
      const next = engine?.listObjects() ?? []
      for (const after of next) {
        const before = previous.find(object => object.id === after.id)
        if (before) {
          rememberObjectChange(before, after)
        } else if (!applyingHistory && engine?.world.get(after.id)?.mesh.userData.importedModel !== true) {
          // Uma nova primitiva é uma ação de histórico: Ctrl+Z deve removê-la.
          undoStack.push({ id: after.id, before: { ...after }, after: { ...after }, kind: 'create' })
          if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
          redoStack.length = 0
        }
      }
      refresh()
    }
  }

  let applyingProjectSettings = false
  watch([brushStrength, brushRadius], () => {
    engine?.setBrush({ strength: brushStrength.value, radius: brushRadius.value })
    if (engine && !applyingProjectSettings) dirty.value = true
  }, { flush: 'sync' })

  onMounted(() => {
    if (!canvas.value) return
    loadPerformanceSettings()
    const e = new Engine(canvas.value)
    engine = e
    e.setControlBindings(playerControlBindings)
    appliedPerformancePreset = performanceMode.value === 'auto' ? 'economy' : performanceMode.value
    e.setPerformancePreset(appliedPerformancePreset)
    e.setRenderStatsListener((value) => {
      fps.value = value.fps
      renderStats.value = value
      updateAutoPerformancePreset(value)
    })
    loadRenderSettings()
    e.setRenderDistance(renderAll.value ? null : renderDistance.value)
    offs.push(
      e.events.on('objectAdded', markDirty),
      e.events.on('objectRemoved', markDirty),
      e.events.on('objectRenamed', markDirty),
      e.events.on('objectChanged', markDirty),
      e.events.on('behaviorPackageChanged', () => { behaviorPackages.value = e.listBehaviorPackages() }),
      e.events.on('objectClicked', ({ id }) => e.logic.triggerObjectClicked(id)),
      e.events.on('terrainChanged', markDirty),
      e.events.on('worldReset', refresh),
      e.events.on('selectionChanged', (ev) => {
        selectedId.value = ev.id
        logicVariables.value = e.logicVariables(ev.id)
        globalLogicVariables.value = e.logicVariables()
      }),
      e.events.on('toolChanged', (ev) => {
        tool.value = ev.tool
        transform.value = ev.transform
      }),
      e.events.on('cameraChanged', (ev) => {
        cameraPreset.value = ev.preset
      }),
    )
    window.addEventListener('keydown', onKey)
    environmentSyncTimer = window.setInterval(() => {
      if (!engine || !dayNightCycleEnabled.value) return
      timeOfDay.value = engine.world.getEnvironment().timeOfDay
    }, 250)
    refresh()
  })

  onBeforeUnmount(() => {
    offs.forEach((off) => off())
    window.removeEventListener('keydown', onKey)
    window.clearTimeout(statusTimer)
    engine?.setFpsListener(null)
    engine?.setRenderStatsListener(null)
    engine?.dispose()
    engine = null
    fps.value = 0
  })

  // ---- ferramentas ----
  function setTool(t: ToolMode) {
    engine?.setTool(t)
  }

  function setTransform(m: TransformMode) {
    engine?.setTransform(m)
  }

  function setSkyTexture(dataUrl: string) {
    if (!engine) return
    engine.world.setEnvironment({ skyTextureDataUrl: dataUrl })
    skyTextureDataUrl.value = dataUrl
    dirty.value = true
    say(dataUrl ? 'Textura do céu aplicada. Salve o projeto para persistir.' : 'Textura do céu removida.')
  }

  function setTimeOfDay(value: number) {
    if (!engine || !Number.isFinite(value)) return
    timeOfDay.value = Math.max(0, Math.min(24, value))
    engine.world.setEnvironment({ timeOfDay: timeOfDay.value })
    dirty.value = true
  }

  function setDayNightCycleEnabled(value: boolean) {
    if (!engine) return
    dayNightCycleEnabled.value = value
    engine.world.setEnvironment({ cycleEnabled: value })
    dirty.value = true
  }

  function setDayNightCycleSpeed(value: number) {
    if (!engine || !Number.isFinite(value)) return
    dayNightCycleSpeed.value = Math.max(0.01, Math.min(4, value))
    engine.world.setEnvironment({ cycleSpeed: dayNightCycleSpeed.value })
    dirty.value = true
  }

  function addPrimitive(type: ObjectType) {
    engine?.addPrimitive(type)
  }

  function addSpawnPlatform() {
    if (!engine) return
    engine.addSpawnPlatform()
    dirty.value = true
    refresh()
    say('Plataforma de Spawn criada. O jogador começará sobre ela ao pressionar Run.')
  }

  function setBuildComponentPlacement(name: string, model: Object3D, height: number) {
    engine?.setBuildComponentPlacement(name, model, height)
    say(`Componente "${name}" selecionado. Clique em Construir e depois no mundo para posicioná-lo.`)
  }

  function addImportedModel(name: string, model: import('three').Object3D, height: number) {
    if (!engine) return
    try {
      engine.addImportedModel(name, model, height)
      dirty.value = true
      refresh()
      say(`Modelo "${name}" importado para a cena.`)
    } catch (e) {
      say(`Não foi possível importar o modelo: ${errMsg(e)}`)
    }
  }

  /** Cria um exemplo pronto: o cubo fica azul no primeiro clique e marca click=true. */
  function addClickableCubeExample() {
    if (!engine) return
    engine.addPrimitive('cube')
    const created = engine.listObjects().at(-1)
    if (!created) { say('Não foi possível criar o cubo.'); return }
    engine.renameObject(created.id, 'Cubo clicável')
    engine.setLogicVariable('click', false, created.id)
    const rule: LogicRule = {
      id: createUniqueRuleId('click-blue'),
      name: 'Cubo: ficar azul ao clicar',
      enabled: true,
      trigger: { type: 'object_clicked', objectId: created.id },
      conditions: [],
      actions: [{
        type: 'javascript',
        code: "if (api.get('click') === false) { api.setColor('{ID_OBJECT}', '#0000FF'); api.set('click', true) }",
      }],
    }
    engine.upsertRule(rule)
    engine.select(created.id)
    refresh()
    dirty.value = true
    say('Cubo clicável criado. click = false; clique no cubo para deixá-lo azul e definir click = true.')
  }

  function cycleCamera() {
    engine?.cycleCameraPreset()
  }

  async function setPlayerModelFile(file: File): Promise<void> {
    const eng = engine
    if (!eng) return
    if (runtimeMode) {
      say('Pare a execução antes de alterar o modelo do jogador.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.glb')) {
      say('Escolha um modelo no formato binário .glb. Arquivos .gltf com dependências externas não são aceitos nesta importação.')
      return
    }
    if (file.size > 30 * 1024 * 1024) {
      say('O modelo do jogador deve ter no máximo 30 MB.')
      return
    }

    try {
      say(`Carregando modelo do jogador: ${file.name}…`)
      const bytes = await file.arrayBuffer()
      await eng.setPlayerModel(bytes, file.name)
      playerModelName.value = eng.getPlayerModelName()
      playerModelCustom.value = eng.hasCustomPlayerModel()
      dirty.value = true
      say(`Modelo do jogador alterado para "${playerModelName.value}". Salve o projeto para manter essa configuração.`)
    } catch (error) {
      say(`Não foi possível trocar o modelo do jogador: ${errMsg(error)}`)
    }
  }

  async function setPlayerModelAsset(
    bytes: ArrayBuffer,
    name: string,
    animationRoles?: Record<string, import('@engine').AnimationRole>,
  ): Promise<void> {
    const eng = engine
    if (!eng) return
    if (runtimeMode) {
      say('Pare a execução antes de alterar o modelo do jogador.')
      return
    }
    const baseName = name.trim().replace(/\.[^.]+$/, '') || 'Jogador'
    const cleanName = `${baseName}.glb`
    try {
      say(`Aplicando ativo do Model Workspace ao jogador: ${cleanName}…`)
      await eng.setPlayerModel(bytes, cleanName, animationRoles)
      playerModelName.value = eng.getPlayerModelName()
      playerModelCustom.value = eng.hasCustomPlayerModel()
      dirty.value = true
      say(`Modelo do jogador configurado a partir do Model Workspace: "${playerModelName.value}". Salve o projeto para preservar a configuração.`)
    } catch (error) {
      say(`Não foi possível usar este ativo como modelo do jogador: ${errMsg(error)}`)
    }
  }

  async function resetPlayerModel(): Promise<void> {
    const eng = engine
    if (!eng) return
    try {
      await eng.resetPlayerModel()
      playerModelName.value = eng.getPlayerModelName()
      playerModelCustom.value = eng.hasCustomPlayerModel()
      dirty.value = true
      say('Modelo padrão do jogador restaurado. Salve o projeto para manter a alteração.')
    } catch (error) {
      say(`Não foi possível restaurar o modelo padrão do jogador: ${errMsg(error)}`)
    }
  }

  function setControlBindings(bindings: ControlMapBindings) {
    playerControlBindings = { ...bindings }
    engine?.setControlBindings(playerControlBindings)
  }

  function setFirstPersonMode(enabled: boolean) {
    engine?.setFirstPersonMode(enabled)
    say(enabled ? 'Modo primeira pessoa ativado. Clique na cena para capturar o mouse; use o mapa de controles ativo para se movimentar.' : 'Modo primeira pessoa desativado.')
  }

  function setRuntimeMode(enabled: boolean) {
    runtimeMode = enabled
    engine?.setRuntimeMode(enabled)
  }

  // ---- hierarquia / inspetor ----
  function selectItem(id: string, additive = false) {
    if (additive && objects.value.some(object => object.id === id)) {
      groupSelection.value = groupSelection.value.includes(id)
        ? groupSelection.value.filter(item => item !== id)
        : [...groupSelection.value, id]
      engine?.select(id)
      return
    }
    groupSelection.value = objects.value.some(object => object.id === id) ? [id] : []
    engine?.select(id)
  }

  function groupSelectedObjects() {
    if (!engine || groupSelection.value.length < 2) {
      say('Selecione pelo menos dois objetos com Ctrl + clique na hierarquia.')
      return
    }
    engine.groupObjects(groupSelection.value)
    dirty.value = true
    refresh()
    say(`${groupSelection.value.length} objetos agrupados. Transformar um deles move o grupo.`)
  }

  function ungroupSelectedObjects() {
    if (!engine || groupSelection.value.length === 0) return
    engine.ungroupObjects(groupSelection.value)
    dirty.value = true
    refresh()
    say('Objetos removidos dos grupos.')
  }

  function toggleVisible(id: string) {
    const obj = objects.value.find((o) => o.id === id)
    if (engine && obj) engine.updateObject(id, { visible: !obj.visible })
  }

  function toggleObjectLock(id: string) {
    const obj = objects.value.find((o) => o.id === id)
    if (!engine || !obj) return
    engine.toggleObjectLock(id)
    dirty.value = true
    refresh()
    say(obj.locked ? 'Objeto desbloqueado para transformação.' : 'Posição do objeto bloqueada.')
  }

  function toggleObjectWireframe(id: string) {
    const obj = objects.value.find((o) => o.id === id)
    if (!engine || !obj) return
    engine.toggleObjectWireframe(id)
    dirty.value = true
    refresh()
    say(obj.wireframeVisible ? 'Linhas dos polígonos ocultadas.' : 'Linhas dos polígonos exibidas.')
  }

  function toggleTerrain() {
    engine?.setTerrainVisible(!terrain.value.visible)
  }

  function togglePerformanceMode() {
    if (!engine) return
    const presets: PerformancePreset[] = ['quality', 'balanced', 'economy', 'auto']
    const currentIndex = presets.indexOf(performanceMode.value)
    performanceMode.value = presets[(currentIndex + 1) % presets.length] ?? 'quality'
    autoPerformanceHealthySamples = 0

    if (performanceMode.value === 'auto') {
      appliedPerformancePreset = 'economy'
      engine.setPerformancePreset('economy')
    } else {
      appliedPerformancePreset = performanceMode.value
      engine.setPerformancePreset(appliedPerformancePreset)
    }
    persistPerformanceSettings()

    const messages: Record<PerformancePreset, string> = {
      quality: 'Modo qualidade: alvo de 60 FPS, grama densa e resolução padrão.',
      balanced: 'Modo equilibrado: alvo de 45 FPS, grama menos densa e alcance menor, com resolução em 85%.',
      economy: 'Modo econômico: alvo de 30 FPS, alcance e densidade da grama reduzidos, com resolução em 75%.',
      auto: 'Modo automático: começa no econômico e ajusta a qualidade conforme FPS e triângulos.',
    }
    say(messages[performanceMode.value])
  }

  function toggleGrid() {
    if (!engine) return
    gridVisible.value = !gridVisible.value
    engine.setGridVisible(gridVisible.value)
    markDirty()
    say(gridVisible.value ? 'Malha ativada' : 'Malha desativada')
  }

  function togglePolygonLines() {
    if (!engine) return
    polygonLinesVisible.value = !polygonLinesVisible.value
    for (const object of objects.value) {
      engine.updateObject(object.id, { wireframeVisible: polygonLinesVisible.value })
    }
    dirty.value = true
    refresh()
    say(polygonLinesVisible.value ? 'Linhas dos polígonos exibidas.' : 'Linhas dos polígonos ocultadas.')
  }

  function removeSelected() {
    const id = selectedId.value
    if (engine && id && id !== TERRAIN_ID) engine.removeObject(id)
  }

  function onRename(ev: Event) {
    const id = selectedId.value
    if (engine && id) engine.renameObject(id, (ev.target as HTMLInputElement).value)
  }

  function onNumber(field: NumField, ev: Event) {
    const id = selectedId.value
    if (!engine || !id || id === TERRAIN_ID) return
    const v = Number((ev.target as HTMLInputElement).value.replace(',', '.'))
    if (!Number.isFinite(v)) {
      refresh()
      return
    }
    const patch: ObjectPatch = {}
    patch[field] = v
    engine.updateObject(id, patch)
  }

  function onColliderChange(id: string, ev: Event) {
    const value = (ev.target as HTMLSelectElement).value
    if (!engine || !objects.value.some(object => object.id === id)) return
    if (value !== 'auto' && value !== 'box' && value !== 'sphere' && value !== 'capsule' && value !== 'none') return
    engine.updateObject(id, { colliderType: value })
    dirty.value = true
    refresh()
    const labels = { auto: 'automático', box: 'caixa', sphere: 'esfera', capsule: 'cápsula', none: 'desativado' }
    say(`Colisor alterado para ${labels[value]}.`)
  }

  function onColliderVectorChange(id: string, field: 'colliderSize' | 'colliderOffset', axis: 0 | 1 | 2, ev: Event) {
    if (!engine) return
    const input = ev.target as HTMLInputElement
    colliderInputActive = true
    const raw = input.value.trim().replace(',', '.')
    const value = Number(raw)
    if (raw !== '' && Number.isFinite(value)) {
      const object = engine.listObjects().find(item => item.id === id)
      if (object) {
        const vector: [number, number, number] = [...object[field]]
        vector[axis] = field === 'colliderSize' ? Math.max(0.05, Math.min(100, value)) : Math.max(-100, Math.min(100, value))
        engine.updateObject(id, { [field]: vector })
        dirty.value = true
      }
    }
    if (ev.type === 'change') {
      colliderInputActive = false
      refresh()
    }
  }

  function toggleColliderDebug() {
    if (!engine) return
    colliderDebugVisible.value = !colliderDebugVisible.value
    engine.setColliderDebugVisible(colliderDebugVisible.value)
    say(colliderDebugVisible.value ? 'Visualização dos colisores ativada.' : 'Visualização dos colisores ocultada.')
  }

  function onColor(ev: Event) {
    const id = selectedId.value
    if (!engine || !id || id === TERRAIN_ID) return
    const hex = (ev.target as HTMLInputElement).value.replace('#', '')
    const n = parseInt(hex, 16)
    if (Number.isFinite(n)) engine.updateObject(id, { color: n })
  }

  function onTexture(ev: Event) {
    const id = selectedId.value
    const value = (ev.target as HTMLSelectElement).value
    const allowed = ['none', 'grass', 'stone', 'brick', 'wood', 'sand', 'metal']
    if (!engine || !id || id === TERRAIN_ID || !allowed.includes(value)) return
    engine.updateObject(id, { texturePreset: value as ObjectPatch['texturePreset'] })
    dirty.value = true
    refresh()
    const labels: Record<string, string> = { none: 'Sem textura', grass: 'Grama', stone: 'Pedra', brick: 'Tijolo', wood: 'Madeira', sand: 'Areia', metal: 'Metal' }
    say(`Textura aplicada: ${labels[value] ?? value}.`)
  }

  function onFaceTexture(face: TextureFace, value: FaceTextureData | null) {
    const id = selectedId.value
    if (!engine || !id || id === TERRAIN_ID) return
    engine.updateObject(id, { faceTexture: { face, value } })
    dirty.value = true
    refresh()
    say(value ? `Imagem aplicada à face ${face}.` : `Textura removida da face ${face}.`)
  }

  function onTextureRepeat(ev: Event) {
    const id = selectedId.value
    const repeat = Number((ev.target as HTMLInputElement).value)
    if (!engine || !id || id === TERRAIN_ID || !Number.isFinite(repeat)) return
    engine.updateObject(id, { textureRepeat: Math.min(8, Math.max(1, repeat)) })
    dirty.value = true
    refresh()
    say(`Repetição da textura: ${Math.min(8, Math.max(1, repeat))}×.`)
  }

  function colorHex(n: number): string {
    return `#${n.toString(16).padStart(6, '0')}`
  }

  function regenerateTerrain() {
    engine?.regenerateTerrain()
    say('Novo relevo gerado.')
  }

  function clearTerrain() {
    engine?.clearTerrainEdits()
    say('Edições do terreno removidas.')
  }

  // ---- motor de regras ----
  function createLogicVariable(name: string, rawValue: string, scope: 'global' | 'object' = 'object', requestedType: 'string' | 'number' | 'boolean' = 'boolean') {
    if (!engine) return
    const objectId = scope === 'object' && selectedId.value && selectedId.value !== TERRAIN_ID ? selectedId.value : null
    if (scope === 'object' && !objectId) { say('Selecione um objeto para criar uma variável própria.'); return }

    // Aceita tanto os campos separados (nome: click, valor: false)
    // quanto uma atribuição digitada inteira no campo de nome (click = false).
    const assignment = name.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    const key = (assignment?.[1] ?? name).trim()
    const parsedRawValue = assignment ? assignment[2] : rawValue

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      say('Use nome = valor (ex.: click = false) ou informe o nome sem espaços.')
      return
    }
    const currentVariables = scope === 'global' ? globalLogicVariables.value : logicVariables.value
    if (Object.prototype.hasOwnProperty.call(currentVariables, key)) {
      say('Já existe uma variável com esse nome.')
      return
    }

    const normalizedValue = parsedRawValue.trim()
    let value: boolean | number | string
    if (requestedType === 'boolean') {
      if (normalizedValue !== 'true' && normalizedValue !== 'false') {
        say('Para uma variável boolean, selecione true ou false.')
        return
      }
      value = normalizedValue === 'true'
    } else if (requestedType === 'number') {
      if (normalizedValue === '' || !Number.isFinite(Number(normalizedValue))) {
        say('Informe um número válido para a variável.')
        return
      }
      value = Number(normalizedValue)
    } else {
      value = parsedRawValue
    }

    engine.setLogicVariable(key, value, objectId)
    logicVariables.value = engine.logicVariables(selectedId.value)
    globalLogicVariables.value = engine.logicVariables()
    dirty.value = true
    say(`Variável ${scope === 'global' ? 'global ' : ''}"${key}" criada com valor ${String(value)}.`)
  }

  function deleteLogicVariable(name: string, scope: 'global' | 'object' = 'object') {
    const objectId = scope === 'object' && selectedId.value && selectedId.value !== TERRAIN_ID ? selectedId.value : null
    if (!engine || (scope === 'object' && !objectId)) return
    const removed = engine.removeLogicVariable(name, objectId)
    if (!removed) return
    logicVariables.value = engine.logicVariables(selectedId.value)
    globalLogicVariables.value = engine.logicVariables()
    dirty.value = true
    say(`Variável "${name}" removida ${scope === 'global' ? 'das variáveis globais' : 'deste objeto'}.`)
  }

  function setLogicVariableValue(name: string, rawValue: string, scope: 'global' | 'object' = 'object') {
    const objectId = scope === 'object' && selectedId.value && selectedId.value !== TERRAIN_ID ? selectedId.value : null
    const source = scope === 'global' ? globalLogicVariables.value : logicVariables.value
    if (!engine || (scope === 'object' && !objectId) || !Object.prototype.hasOwnProperty.call(source, name)) return
    let value: boolean | number | string = rawValue
    if (rawValue === 'true') value = true
    else if (rawValue === 'false') value = false
    else if (rawValue.trim() !== '' && Number.isFinite(Number(rawValue))) value = Number(rawValue)
    engine.setLogicVariable(name, value, objectId)
    logicVariables.value = engine.logicVariables(selectedId.value)
    globalLogicVariables.value = engine.logicVariables()
    dirty.value = true
  }

  function toggleLogicVariable(name: string, scope: 'global' | 'object' = 'object') {
    const objectId = scope === 'object' && selectedId.value && selectedId.value !== TERRAIN_ID ? selectedId.value : null
    const source = scope === 'global' ? globalLogicVariables.value : logicVariables.value
    if (!engine || (scope === 'object' && !objectId)) return
    engine.setLogicVariable(name, source[name] === true ? false : true, objectId)
    logicVariables.value = engine.logicVariables(selectedId.value)
    globalLogicVariables.value = engine.logicVariables()
    dirty.value = true
  }

  function useGlobalVariableOnObject(name: string) {
    const objectId = selectedId.value && selectedId.value !== TERRAIN_ID ? selectedId.value : null
    if (!engine || !objectId || !Object.prototype.hasOwnProperty.call(globalLogicVariables.value, name)) return
    if (Object.prototype.hasOwnProperty.call(logicVariables.value, name)) {
      say(`O objeto já possui sua própria variável "${name}".`)
      return
    }
    engine.setLogicVariable(name, globalLogicVariables.value[name]!, objectId)
    logicVariables.value = engine.logicVariables(objectId)
    dirty.value = true
    say(`Variável "${name}" adicionada ao objeto como cópia independente.`)
  }

  function addLogicRule(scriptCode?: string, condition?: LogicRule['conditions'][number], eventName?: string) {
    if (!engine) return
    const target = selectedId.value && selectedId.value !== TERRAIN_ID ? selectedId.value : objects.value[0]?.id
    if (!target) { say('Crie ou selecione um objeto antes de adicionar uma regra.'); return }
    const id = createUniqueRuleId()
    if (ruleTrigger.value === 'package_event' || ruleAction.value === 'set_package_variable') {
      const installed = engine.listBehaviorPackages(target).some(instance => instance.packageId === rulePackageId.value && instance.enabled)
      if (!installed) {
        say('Instale e habilite o pacote escolhido neste objeto antes de usar seus gatilhos ou variáveis.')
        return
      }
    }
    const trigger: LogicRule['trigger'] = ruleTrigger.value === 'object_clicked'
      ? { type: 'object_clicked', objectId: target }
      : ruleTrigger.value === 'key_pressed'
        ? { type: 'key_pressed', key: 'KeyE' }
        : ruleTrigger.value === 'package_event'
          ? { type: 'package_event', objectId: target, packageId: rulePackageId.value, eventId: rulePackageEventId.value }
          : { type: 'enter_area', center: [0, 1, 0], radius: 2 }
    const action: LogicRule['actions'][number] = ruleAction.value === 'rotate'
      ? { type: 'rotate', objectId: target, degrees: 45 }
      : ruleAction.value === 'move'
        ? { type: 'move', objectId: target, x: 2 }
        : ruleAction.value === 'set_visible'
          ? { type: 'set_visible', objectId: target, visible: false }
          : ruleAction.value === 'set_package_variable'
            ? {
              type: 'set_package_variable',
              objectId: target,
              packageId: rulePackageId.value,
              name: rulePackageVariableName.value.trim() || 'mounted',
              value: rulePackageVariableValue.value.trim() === 'true'
                ? true
                : rulePackageVariableValue.value.trim() === 'false'
                  ? false
                  : rulePackageVariableValue.value.trim() !== '' && Number.isFinite(Number(rulePackageVariableValue.value.trim()))
                    ? Number(rulePackageVariableValue.value.trim())
                    : rulePackageVariableValue.value,
            }
            : ruleAction.value === 'javascript'
            ? { type: 'javascript', code: scriptCode?.trim() || "// Cole seu JavaScript aqui\napi.set('has_key', true)" }
            : ruleAction.value === 'script'
              ? { type: 'script', code: 'set has_key = true' }
              : { type: 'set_variable', name: 'has_key', value: true }
    const rule: LogicRule = { ownerObjectId: target, id, name: eventName?.trim() || `Evento ${logicRules.value.length + 1}`, enabled: true, trigger, conditions: ruleConditionEnabled.value ? [condition ?? { type: 'variable', name: 'has_key', operator: 'equals', value: true }] : [], actions: [action] }
    engine.upsertRule(rule)
    refresh()
    dirty.value = true
  }

  function toggleLogicRule(rule: LogicRule) {
    engine?.upsertRule({ ...rule, enabled: !rule.enabled })
    refresh(); dirty.value = true
  }

  function deleteLogicRule(id: string) {
    engine?.removeRule(id)
    refresh(); dirty.value = true
  }

  function moveLogicRule(id: string, direction: -1 | 1) {
    engine?.moveRule(id, direction)
    refresh(); dirty.value = true
  }

  function updateLogicRule(rule: LogicRule) {
    engine?.upsertRule(rule)
    refresh(); dirty.value = true
  }

  function installBehaviorPackage(packageId: string): string | null {
    const ownerObjectId = selectedId.value
    if (!engine || !ownerObjectId || ownerObjectId === TERRAIN_ID) {
      say('Selecione um objeto da cena antes de instalar um pacote.')
      return null
    }
    try {
      const instance = engine.installBehaviorPackage(ownerObjectId, packageId)
      refresh()
      dirty.value = true
      say(`Pacote "${packageId}" instalado em "${objects.value.find(object => object.id === ownerObjectId)?.name ?? 'objeto'}".`)
      return instance.id
    } catch (error) {
      say(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  function updateBehaviorPackage(
    id: string,
    patch: Partial<Pick<BehaviorPackageInstance, 'enabled' | 'variables' | 'config'>>,
  ) {
    if (!engine) return
    engine.updateBehaviorPackage(id, patch)
    behaviorPackages.value = engine.listBehaviorPackages()
    dirty.value = true
  }

  function removeBehaviorPackage(id: string) {
    if (!engine) return
    engine.removeBehaviorPackage(id)
    refresh()
    dirty.value = true
    say('Pacote de comportamento removido.')
  }

  /** Importa uma cópia independente de um evento público para o objeto selecionado. */
  function importLogicRule(sourceRule: LogicRule) {
    if (!engine || !selectedId.value || selectedId.value === TERRAIN_ID) {
      say('Selecione o objeto que receberá o evento importado.')
      return
    }
    if (sourceRule.trigger.type !== 'object_clicked') {
      say('Por enquanto, só é possível importar eventos de clique em objetos.')
      return
    }
    // logicRules vem de um estado reativo do Vue: sourceRule pode ser um Proxy,
    // e structuredClone(proxy) lança DataCloneError em navegadores. Converta a regra
    // para dados JSON simples antes de copiá-la para o motor.
    const source = JSON.parse(JSON.stringify(sourceRule)) as LogicRule
    const targetId = selectedId.value
    const sourceId = source.trigger.type === 'object_clicked' ? source.trigger.objectId : ''
    if (!sourceId) {
      say('O evento selecionado não possui um objeto de origem válido.')
      return
    }

    // Copia apenas valores iniciais que ainda não existem no destino; depois cada
    // objeto altera suas próprias variáveis sem afetar o objeto de origem.
    const sourceVariables = engine.logicVariables(sourceId)
    const targetVariables = engine.logicVariables(targetId)
    for (const [name, value] of Object.entries(sourceVariables)) {
      if (!Object.prototype.hasOwnProperty.call(targetVariables, name)) {
        engine.setLogicVariable(name, value, targetId)
      }
    }
    const imported: LogicRule = {
      ...source,
      ownerObjectId: targetId,
      id: createUniqueRuleId(),
      name: source.name,
      enabled: true,
      trigger: { type: 'object_clicked', objectId: targetId },
      conditions: source.conditions.map(condition => ({ ...condition })),
      actions: source.actions.map(action => {
        if ('objectId' in action && action.objectId === sourceId) {
          return { ...action, objectId: targetId }
        }
        return { ...action }
      }),
      graphLayout: undefined,
      lastInside: false,
    }
    engine.upsertRule(imported)
    refresh()
    dirty.value = true
    say(`Evento "${source.name}" importado para este objeto como uma cópia independente.`)
    return imported.id
  }

  // ---- projeto ----
  async function newProject() {
    const eng = engine
    if (!eng || !(await confirmDiscard(dirty.value))) return
    applyingProjectSettings = true
    try {
      eng.newProject()
      playerModelName.value = eng.getPlayerModelName()
      playerModelCustom.value = eng.hasCustomPlayerModel()
      // worldReset é emitido antes de o motor limpar as regras; atualize a interface
      // depois que o estado inteiro do projeto novo já estiver redefinido.
      refresh()
      brushStrength.value = 1.5
      brushRadius.value = 4
      gridVisible.value = true
      skyTextureDataUrl.value = ''
      timeOfDay.value = 12
      dayNightCycleEnabled.value = false
      dayNightCycleSpeed.value = 0.1
    } finally {
      applyingProjectSettings = false
    }
    projectName.value = eng.projectName
    projectDir.value = null
    dirty.value = false
    say('Novo projeto criado.')
  }

  async function openProject() {
    const eng = engine
    if (!eng || !(await confirmDiscard(dirty.value))) return
    try {
      const dir = await chooseFolder('Abrir projeto: escolha a pasta do projeto')
      if (!dir) return
      ioProgress.value = { active: true, kind: 'load', message: 'Preparando o carregamento…', percent: 0 }
      const bundle = await loadProjectFrom(dir, (message, percent) => {
        ioProgress.value = { active: true, kind: 'load', message, percent }
        status.value = message
      })
      ioProgress.value = { active: true, kind: 'load', message: 'Construindo o mundo 3D…', percent: 25 }
      applyingProjectSettings = true
      try {
        await eng.loadProject(bundle, (message, percent) => {
          ioProgress.value = { active: true, kind: 'load', message, percent }
          status.value = message
        })
        playerModelName.value = eng.getPlayerModelName()
        playerModelCustom.value = eng.hasCustomPlayerModel()
        // Projetos antigos podem ter salvo wireframe ligado por padrão.
        // A visualização das linhas começa desligada, mas pode ser reativada na toolbar.
        polygonLinesVisible.value = false
        for (const object of eng.listObjects()) {
          eng.updateObject(object.id, { wireframeVisible: false })
        }
        refresh()
        brushStrength.value = bundle.project.settings.editor.brushStrength
        brushRadius.value = bundle.project.settings.editor.brushRadius
        gridVisible.value = bundle.project.settings.editor.gridVisible
        const environment = eng.world.getEnvironment()
        skyTextureDataUrl.value = environment.skyTextureDataUrl
        timeOfDay.value = environment.timeOfDay
        dayNightCycleEnabled.value = environment.cycleEnabled
        dayNightCycleSpeed.value = environment.cycleSpeed
      } finally {
        applyingProjectSettings = false
      }
      projectName.value = eng.projectName
      projectDir.value = dir
      dirty.value = false
      say(`Projeto aberto: ${dir}`)
    } catch (e) {
      say(`Erro ao abrir: ${errMsg(e)}`)
    } finally {
      ioProgress.value = { ...ioProgress.value, active: false }
    }
  }

  async function saveProject(asNew = false) {
    const eng = engine
    if (!eng) return
    try {
      let dir = projectDir.value
      if (!dir || asNew) {
        const picked = await chooseFolder('Salvar: escolha (ou crie) a pasta do projeto')
        if (!picked) return
        if (picked !== projectDir.value && (await projectExistsIn(picked))) {
          if (!(await confirmOverwrite(picked))) return
        }
        dir = picked
      }
      ioProgress.value = { active: true, kind: 'save', message: 'Preparando os recursos para salvar…', percent: 0 }
      eng.setProjectName(projectName.value)
      await saveProjectTo(dir, eng.exportProject(), (message, percent) => {
        ioProgress.value = { active: true, kind: 'save', message, percent }
        status.value = message
      })
      projectDir.value = dir
      dirty.value = false
      say(`Salvo em ${dir}`)
    } catch (e) {
      say(`Erro ao salvar: ${errMsg(e)}`)
    } finally {
      ioProgress.value = { ...ioProgress.value, active: false }
    }
  }

  // ---- atalhos ----
  function onKey(ev: KeyboardEvent) {
    // Em Run, nenhum atalho do editor pode alterar ou salvar a cena.
    if (runtimeMode) return
    const mod = ev.ctrlKey || ev.metaKey
    const key = ev.key.toLowerCase()
    if (mod && key === 's') {
      ev.preventDefault()
      void saveProject(ev.shiftKey)
      return
    }
    const tag = (ev.target as HTMLElement | null)?.tagName
    const editingText = tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target as HTMLElement | null)?.isContentEditable
    if (mod && !editingText && key === 'c') {
      ev.preventDefault()
      copySelectedObject()
      return
    }
    if (mod && !editingText && key === 'v') {
      ev.preventDefault()
      pasteObject()
      return
    }
    if (mod && !editingText && key === 'z') {
      ev.preventDefault()
      if (ev.shiftKey) redo()
      else undo()
      return
    }
    if (mod && !editingText && key === 'y') {
      ev.preventDefault()
      redo()
      return
    }
    if (editingText || mod || ev.altKey) return
    switch (ev.key.toLowerCase()) {
      case 'q':
        setTool('select')
        break
      case 'b':
        setTool('build')
        break
      case 't':
        setTool('terrain')
        break
      case 'w':
        setTransform('move')
        break
      case 'e':
        setTransform('rotate')
        break
      case 'r':
        setTransform('scale')
        break
      case 'delete':
        removeSelected()
        break
    }
  }

  return {
    projectName,
    dirty,
    status,
    fps,
    renderStats,
    ioProgress,
    objects,
    selectedModelNodes,
    terrain,
    selectedId,
    groupSelection,
    tool,
    transform,
    cameraPreset,
    brushStrength,
    brushRadius,
    gridVisible,
    polygonLinesVisible,
    performanceMode,
    renderDistance,
    renderAll,
    playerModelName,
    playerModelCustom,
    setPlayerModelFile,
    setPlayerModelAsset,
    resetPlayerModel,
    logicRules, behaviorPackages, logicVariables, globalLogicVariables, useGlobalVariableOnObject, ruleTrigger, rulePackageId, rulePackageEventId, rulePackageVariableName, rulePackageVariableValue, ruleAction, ruleConditionEnabled,
    installBehaviorPackage, updateBehaviorPackage, removeBehaviorPackage,
    toggleLogicVariable, createLogicVariable, setLogicVariableValue, deleteLogicVariable, addLogicRule, toggleLogicRule, deleteLogicRule, moveLogicRule, updateLogicRule, importLogicRule,
    markDirty,
    setTool,
    setTransform,
    addPrimitive,
    skyTextureDataUrl, timeOfDay, dayNightCycleEnabled, dayNightCycleSpeed,
    setSkyTexture, setTimeOfDay, setDayNightCycleEnabled, setDayNightCycleSpeed,
    addSpawnPlatform,
    addImportedModel,
    setBuildComponentPlacement,
    addClickableCubeExample,
    cycleCamera,
    setControlBindings,
    setFirstPersonMode,
    setRuntimeMode,
    selectItem,
    groupSelectedObjects,
    ungroupSelectedObjects,
    toggleVisible,
    toggleObjectLock,
    toggleObjectWireframe,
    toggleTerrain,
    toggleGrid,
    togglePerformanceMode,
    setRenderDistance,
    setRenderAll,
    togglePolygonLines,
    removeSelected,
    onRename,
    onNumber,
    onColliderChange,
    onColliderVectorChange,
    colliderDebugVisible,
    toggleColliderDebug,
    onColor,
    onTexture,
    onTextureRepeat,
    onFaceTexture,
    colorHex,
    regenerateTerrain,
    clearTerrain,
    newProject,
    openProject,
    saveProject,
  }
}
