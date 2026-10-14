import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
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

export type NumField = 'x' | 'y' | 'z' | 'rotationX' | 'rotationY' | 'rotationZ' | 'scale' | 'scaleX' | 'scaleY' | 'scaleZ'

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
  const tool = ref<ToolMode>('select')
  const transform = ref<TransformMode>('move')
  const cameraPreset = ref<CameraPreset>('free')
  const brushStrength = ref(1.5)
  const brushRadius = ref(4)
  const gridVisible = ref(true)
  const logicRules = ref<LogicRule[]>([])
  const logicVariables = ref<Record<string, boolean | number | string>>({})
  const globalLogicVariables = ref<Record<string, boolean | number | string>>({ has_key: false })
  const ruleTrigger = ref<'object_clicked' | 'enter_area'>('object_clicked')
  const ruleAction = ref<'move' | 'rotate' | 'set_visible' | 'set_variable' | 'script' | 'javascript'>('rotate')
  // Regras novas executam por padrão; o usuário pode ativar uma condição no inspetor.
  const ruleConditionEnabled = ref(false)

  let engine: Engine | null = null
  let statusTimer = 0
  const offs: Array<() => void> = []

  function say(message: string) {
    status.value = message
    window.clearTimeout(statusTimer)
    statusTimer = window.setTimeout(() => {
      status.value = ''
    }, 7000)
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

  function markDirty() {
    dirty.value = true
    refresh()
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

  /** Cria um exemplo pronto: o cubo fica azul no primeiro clique e marca click=true. */
  function addClickableCubeExample() {
    if (!engine) return
    engine.addPrimitive('cube')
    const created = engine.listObjects().at(-1)
    if (!created) { say('Não foi possível criar o cubo.'); return }
    engine.renameObject(created.id, 'Cubo clicável')
    engine.setLogicVariable('click', false, created.id)
    const rule: LogicRule = {
      id: `click-blue-${Date.now().toString(36)}`,
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

  // ---- hierarquia / inspetor ----
  function selectItem(id: string) {
    engine?.select(id)
  }

  function toggleVisible(id: string) {
    const obj = objects.value.find((o) => o.id === id)
    if (engine && obj) engine.updateObject(id, { visible: !obj.visible })
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
  function createLogicVariable(name: string, rawValue: string, scope: 'global' | 'object' = 'object') {
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
    let value: boolean | number | string = normalizedValue
    if (normalizedValue === 'true') value = true
    else if (normalizedValue === 'false') value = false
    else if (normalizedValue !== '' && Number.isFinite(Number(normalizedValue))) value = Number(normalizedValue)

    engine.setLogicVariable(key, value, objectId)
    logicVariables.value = engine.logicVariables(selectedId.value)
    globalLogicVariables.value = engine.logicVariables()
    dirty.value = true
    say(`Variável ${scope === 'global' ? 'global ' : ''}"${key}" criada com valor ${String(value)}.`)
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

  function addLogicRule(scriptCode?: string, condition?: LogicRule['conditions'][number], eventName?: string) {
    if (!engine) return
    const target = selectedId.value && selectedId.value !== TERRAIN_ID ? selectedId.value : objects.value[0]?.id
    if (!target) { say('Crie ou selecione um objeto antes de adicionar uma regra.'); return }
    const id = `rule-${Date.now().toString(36)}`
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
    const rule: LogicRule = { id, name: eventName?.trim() || `Evento ${logicRules.value.length + 1}`, enabled: true, trigger, conditions: ruleConditionEnabled.value ? [condition ?? { type: 'variable', name: 'has_key', operator: 'equals', value: true }] : [], actions: [action] }
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

  function updateLogicRule(rule: LogicRule) {
    engine?.upsertRule(rule)
    refresh(); dirty.value = true
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
        eng.loadProject(bundle)
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
    const mod = ev.ctrlKey || ev.metaKey
    if (mod && ev.key.toLowerCase() === 's') {
      ev.preventDefault()
      void saveProject(ev.shiftKey)
      return
    }
    const tag = (ev.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || mod || ev.altKey) return
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
    tool,
    transform,
    cameraPreset,
    brushStrength,
    brushRadius,
    gridVisible,
    logicRules, logicVariables, globalLogicVariables, ruleTrigger, ruleAction, ruleConditionEnabled,
    toggleLogicVariable, createLogicVariable, setLogicVariableValue, addLogicRule, toggleLogicRule, deleteLogicRule, updateLogicRule,
    markDirty,
    setTool,
    setTransform,
    addPrimitive,
    addClickableCubeExample,
    cycleCamera,
    selectItem,
    toggleVisible,
    toggleTerrain,
    toggleGrid,
    removeSelected,
    onRename,
    onNumber,
    onColor,
    colorHex,
    regenerateTerrain,
    clearTerrain,
    newProject,
    openProject,
    saveProject,
  }
}
