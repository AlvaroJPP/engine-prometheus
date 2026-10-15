import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Object3D } from 'three'
import { Engine, TERRAIN_ID } from '@engine'
import type {
  CameraPreset,
  ObjectInfo,
  ObjectPatch,
  ObjectType,
  TerrainInfo,
  ToolMode,
  TransformMode,
  LogicRule,
} from '@engine'
import {
  chooseFolder,
  confirmDiscard,
  confirmOverwrite,
  loadProjectFrom,
  projectExistsIn,
  saveProjectTo,
} from '@/project/projectService'

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
  const objects = ref<ObjectInfo[]>([])
  const terrain = ref<TerrainInfo>({ visible: true, seed: 0, edits: 0 })
  const selectedId = ref<string | null>(null)
  const groupSelection = ref<string[]>([])
  const tool = ref<ToolMode>('select')
  const transform = ref<TransformMode>('move')
  const cameraPreset = ref<CameraPreset>('free')
  const brushStrength = ref(1.5)
  const brushRadius = ref(4)
  const gridVisible = ref(true)
  const colliderDebugVisible = ref(false)
  const logicRules = ref<LogicRule[]>([])
  const logicVariables = ref<Record<string, boolean | number | string>>({})
  const globalLogicVariables = ref<Record<string, boolean | number | string>>({ has_key: false })
  const ruleTrigger = ref<'object_clicked' | 'enter_area'>('object_clicked')
  const ruleAction = ref<'move' | 'rotate' | 'set_visible' | 'set_variable' | 'script' | 'javascript'>('rotate')
  // Regras novas executam por padrão; o usuário pode ativar uma condição no inspetor.
  const ruleConditionEnabled = ref(false)

  let engine: Engine | null = null
  let runtimeMode = false
  let statusTimer = 0
  const offs: Array<() => void> = []
  let clipboardObject: ObjectInfo | null = null
  let applyingHistory = false
  type ObjectHistoryEntry = { id: string; before: ObjectInfo; after: ObjectInfo; kind?: 'paste' }
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
        color: state.color, visible: state.visible, locked: state.locked,
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
    if (entry.kind === 'paste') {
      if (!engine || !objects.value.some(object => object.id === entry.id)) { undoStack.push(entry); say('A cópia não está mais na cena.'); return }
      applyingHistory = true
      try {
        engine.removeObject(entry.id)
        refresh()
        dirty.value = true
      } finally {
        applyingHistory = false
      }
      redoStack.push(entry)
      say('Colagem desfeita.')
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
    if (entry.kind === 'paste') {
      if (!engine) { redoStack.push(entry); return }
      const existingIds = new Set(engine.listObjects().map(object => object.id))
      engine.addPrimitive(entry.after.type)
      const created = engine.listObjects().find(object => !existingIds.has(object.id))
      if (!created) { redoStack.push(entry); say('Não foi possível refazer a colagem.'); return }
      applyingHistory = true
      try {
        engine.updateObject(created.id, {
          x: entry.after.x, y: entry.after.y, z: entry.after.z,
          rotationX: entry.after.rotationX, rotationY: entry.after.rotationY, rotationZ: entry.after.rotationZ,
          scaleX: entry.after.scaleX, scaleY: entry.after.scaleY, scaleZ: entry.after.scaleZ,
          color: entry.after.color, visible: entry.after.visible, locked: false,
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
      undoStack.push({ ...entry, id: created.id })
      say('Colagem refeita.')
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
    if (engine?.world.get(object.id)?.mesh.userData.importedModel === true) {
      say('A cópia de modelos 3D importados ainda não está disponível; esta ação funciona com objetos básicos.')
      return
    }
    clipboardObject = JSON.parse(JSON.stringify(object)) as ObjectInfo
    say(`Objeto "${object.name}" copiado.`)
  }

  function pasteObject() {
    if (!engine || !clipboardObject) { say('Copie um objeto antes de colar.'); return }
    const source = clipboardObject
    const existingIds = new Set(engine.listObjects().map(object => object.id))
    engine.addPrimitive(source.type)
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
        color: pastedState.color, visible: pastedState.visible, locked: false,
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
    statusTimer = window.setTimeout(() => {
      status.value = ''
    }, 7000)
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
    terrain.value = engine.terrainInfo()
    gridVisible.value = engine.isGridVisible()
    logicRules.value = engine.listRules()
    logicVariables.value = engine.logicVariables(selectedId.value)
    globalLogicVariables.value = engine.logicVariables()
  }

  // A seleção pode mudar por clique na cena ou pela hierarquia. Sincronize
  // explicitamente o inspetor lateral com o objeto atualmente selecionado.
  watch(selectedId, (id) => {
    if (!engine) return
    logicRules.value = engine.listRules()
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
        if (before) rememberObjectChange(before, after)
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
    const e = new Engine(canvas.value)
    engine = e
    offs.push(
      e.events.on('objectAdded', markDirty),
      e.events.on('objectRemoved', markDirty),
      e.events.on('objectRenamed', markDirty),
      e.events.on('objectChanged', markDirty),
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
    refresh()
  })

  onBeforeUnmount(() => {
    offs.forEach((off) => off())
    window.removeEventListener('keydown', onKey)
    window.clearTimeout(statusTimer)
    engine?.dispose()
    engine = null
  })

  // ---- ferramentas ----
  function setTool(t: ToolMode) {
    engine?.setTool(t)
  }

  function setTransform(m: TransformMode) {
    engine?.setTransform(m)
  }

  function addPrimitive(type: ObjectType) {
    engine?.addPrimitive(type)
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

  function setFirstPersonMode(enabled: boolean) {
    engine?.setFirstPersonMode(enabled)
    say(enabled ? 'Modo primeira pessoa ativado. Clique na cena para capturar o mouse; WASD move, Shift corre, Espaço pula e Esc libera o mouse.' : 'Modo primeira pessoa desativado.')
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

  function toggleGrid() {
    if (!engine) return
    gridVisible.value = !gridVisible.value
    engine.setGridVisible(gridVisible.value)
    markDirty()
    say(gridVisible.value ? 'Malha ativada' : 'Malha desativada')
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
    const trigger: LogicRule['trigger'] = ruleTrigger.value === 'object_clicked'
      ? { type: 'object_clicked', objectId: target }
      : { type: 'enter_area', center: [0, 1, 0], radius: 2 }
    const action: LogicRule['actions'][number] = ruleAction.value === 'rotate'
      ? { type: 'rotate', objectId: target, degrees: 45 }
      : ruleAction.value === 'move'
        ? { type: 'move', objectId: target, x: 2 }
        : ruleAction.value === 'set_visible'
          ? { type: 'set_visible', objectId: target, visible: false }
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
      // worldReset é emitido antes de o motor limpar as regras; atualize a interface
      // depois que o estado inteiro do projeto novo já estiver redefinido.
      refresh()
      brushStrength.value = 1.5
      brushRadius.value = 4
      gridVisible.value = true
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
      const bundle = await loadProjectFrom(dir)
      applyingProjectSettings = true
      try {
        await eng.loadProject(bundle)
        // loadProject substitui a cena antes de carregar logic/events.json.
        // O evento worldReset atualiza a interface cedo demais; sincronize novamente
        // agora que regras, variáveis e scripts já foram carregados.
        refresh()
        brushStrength.value = bundle.project.settings.editor.brushStrength
        brushRadius.value = bundle.project.settings.editor.brushRadius
        gridVisible.value = bundle.project.settings.editor.gridVisible
      } finally {
        applyingProjectSettings = false
      }
      projectName.value = eng.projectName
      projectDir.value = dir
      dirty.value = false
      say(`Projeto aberto: ${dir}`)
    } catch (e) {
      say(`Erro ao abrir: ${errMsg(e)}`)
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
      eng.setProjectName(projectName.value)
      await saveProjectTo(dir, eng.exportProject())
      projectDir.value = dir
      dirty.value = false
      say(`Salvo em ${dir}`)
    } catch (e) {
      say(`Erro ao salvar: ${errMsg(e)}`)
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
    objects,
    terrain,
    selectedId,
    groupSelection,
    tool,
    transform,
    cameraPreset,
    brushStrength,
    brushRadius,
    gridVisible,
    logicRules, logicVariables, globalLogicVariables, useGlobalVariableOnObject, ruleTrigger, ruleAction, ruleConditionEnabled,
    toggleLogicVariable, createLogicVariable, setLogicVariableValue, deleteLogicVariable, addLogicRule, toggleLogicRule, deleteLogicRule, moveLogicRule, updateLogicRule, importLogicRule,
    markDirty,
    setTool,
    setTransform,
    addPrimitive,
    addImportedModel,
    setBuildComponentPlacement,
    addClickableCubeExample,
    cycleCamera,
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
    removeSelected,
    onRename,
    onNumber,
    onColliderChange,
    onColliderVectorChange,
    colliderDebugVisible,
    toggleColliderDebug,
    onColor,
    colorHex,
    regenerateTerrain,
    clearTerrain,
    newProject,
    openProject,
    saveProject,
  }
}
