<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ENGINE_VERSION, TERRAIN_ID } from '@engine'
import type { ToolMode, TransformMode, LogicRule } from '@engine'
import { CAMERA_LABELS, useEditor } from '@/composables/useEditor'

const canvas = ref<HTMLCanvasElement | null>(null)
const rootOpen = ref(true)
const {
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
  logicRules, logicVariables, ruleTrigger, ruleAction, ruleConditionEnabled,
  toggleLogicVariable, createLogicVariable, setLogicVariableValue, addLogicRule, toggleLogicRule, deleteLogicRule, updateLogicRule,
  markDirty,
  setTool,
  setTransform,
  addPrimitive,
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
} = useEditor(canvas)

const newVariableName = ref('')
const newVariableValue = ref('false')
function submitVariable() {
  createLogicVariable(newVariableName.value, newVariableValue.value)
  newVariableName.value = ''
}

const graphOpen = ref(false)
const graphSelection = ref<{ ruleId: string; part: 'trigger' | 'condition' | 'action' } | null>(null)
const dragNode = ref<{ ruleId: string; part: 'trigger' | 'condition' | 'action'; dx: number; dy: number } | null>(null)
const graphViewport = ref<HTMLElement | null>(null)
const graphNodes = computed(() => logicRules.value.flatMap((rule, index) => {
  const layout = rule.graphLayout ?? { trigger: { x: 70, y: 70 + index * 230 }, condition: { x: 340, y: 70 + index * 230 }, action: { x: 610, y: 70 + index * 230 } }
  return (['trigger', 'condition', 'action'] as const).map(part => ({ rule, part, x: layout[part].x, y: layout[part].y }))
}))
const graphEdges = computed(() => logicRules.value.flatMap(rule => {
  const layout = rule.graphLayout ?? { trigger: { x: 70, y: 70 }, condition: { x: 340, y: 70 }, action: { x: 610, y: 70 } }
  return [{ id: rule.id + '-a', x1: layout.trigger.x + 220, y1: layout.trigger.y + 60, x2: layout.condition.x, y2: layout.condition.y + 60 }, { id: rule.id + '-b', x1: layout.condition.x + 220, y1: layout.condition.y + 60, x2: layout.action.x, y2: layout.action.y + 60 }]
}))
const selectedGraphRule = computed(() => logicRules.value.find(rule => rule.id === graphSelection.value?.ruleId) ?? null)

// Mantém o texto do editor separado da renderização do grafo. Atualizar a regra
// a cada tecla não deve recriar o valor do textarea nem descartar o rascunho.
const scriptDraft = ref('')
watch(
  () => {
    const rule = selectedGraphRule.value
    const action = rule?.actions[0]
    return { ruleId: rule?.id ?? '', type: action?.type ?? '', code: action && 'code' in action ? action.code : '' }
  },
  (current, previous) => {
    // Recarregar o rascunho somente quando a seleção muda. O código é atualizado
    // a cada tecla no motor; sincronizá-lo de volta aqui pode sobrescrever o texto
    // que ainda está sendo digitado durante o refresh reativo.
    if (!previous || current.ruleId !== previous.ruleId || current.type !== previous.type) {
      scriptDraft.value = current.code
    }
  },
  { immediate: true },
)
function onScriptDraftInput(event: Event) {
  const code = (event.target as HTMLTextAreaElement).value
  scriptDraft.value = code
  patchSelectedAction({ code })
}
function startNodeDrag(event: PointerEvent, ruleId: string, part: 'trigger' | 'condition' | 'action') {
  const node = graphNodes.value.find(n => n.rule.id === ruleId && n.part === part)
  if (!node) return
  graphSelection.value = { ruleId, part }; dragNode.value = { ruleId, part, dx: event.clientX - node.x, dy: event.clientY - node.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveNode(event: PointerEvent) {
  if (!dragNode.value || !graphViewport.value) return
  const bounds = graphViewport.value.getBoundingClientRect()
  const { ruleId, part, dx, dy } = dragNode.value
  const ruleIndex = logicRules.value.findIndex(r => r.id === ruleId)
  const rule = logicRules.value[ruleIndex]; if (!rule || ruleIndex < 0) return
  const rowY = 70 + ruleIndex * 230
  const current = rule.graphLayout ?? { trigger: { x: 70, y: rowY }, condition: { x: 340, y: rowY }, action: { x: 610, y: rowY } }
  const next = { ...current, [part]: { x: Math.max(8, event.clientX - bounds.left + graphViewport.value.scrollLeft - dx), y: Math.max(8, event.clientY - bounds.top + graphViewport.value.scrollTop - dy) } }
  updateLogicRule({ ...rule, graphLayout: next })
}
function endNodeDrag() { dragNode.value = null }
function nodeTitle(rule: LogicRule, part: 'trigger' | 'condition' | 'action') {
  if (part === 'trigger') return rule.trigger.type === 'object_clicked' ? 'Quando clicar no objeto' : 'Ao entrar na área'
  if (part === 'condition') return rule.conditions.length ? `Condição: ${rule.conditions.map(c => `${c.name} = ${String(c.value)}`).join(', ')}` : 'Sem condição'
  const action = rule.actions[0]; if (!action) return 'Sem ação'
  return action.type === 'rotate' ? `Girar ${action.degrees}°` : action.type === 'move' ? `Mover para X ${action.x ?? 0}` : action.type === 'set_visible' ? (action.visible ? 'Mostrar objeto' : 'Ocultar objeto') : action.type === 'set_variable' ? `Definir ${action.name} = ${String(action.value)}` : 'Executar script'
}

function patchSelectedAction(patch: Record<string, unknown>) {
  const rule = selectedGraphRule.value
  const action = rule?.actions[0]
  if (!rule || !action) return
  updateLogicRule({ ...rule, actions: [{ ...action, ...patch } as LogicRule['actions'][number], ...rule.actions.slice(1)] })
}
function patchSelectedTrigger(patch: Record<string, unknown>) {
  const rule = selectedGraphRule.value
  if (!rule) return
  updateLogicRule({ ...rule, trigger: { ...rule.trigger, ...patch } as LogicRule['trigger'] })
}
function patchSelectedCondition(patch: Record<string, unknown>) {
  const rule = selectedGraphRule.value
  if (!rule) return
  const current = rule.conditions[0] ?? { type: 'variable' as const, name: 'has_key', operator: 'equals' as const, value: true }
  updateLogicRule({ ...rule, conditions: [{ ...current, ...patch } as LogicRule['conditions'][number], ...rule.conditions.slice(1)] })
}
function setSelectedTriggerType(type: 'object_clicked' | 'enter_area') {
  const rule = selectedGraphRule.value
  if (!rule) return
  const trigger: LogicRule['trigger'] = type === 'object_clicked'
    ? { type, objectId: objects.value.find(o => o.id === (rule.trigger.type === 'object_clicked' ? rule.trigger.objectId : ''))?.id ?? objects.value[0]?.id ?? '' }
    : { type, center: rule.trigger.type === 'enter_area' ? [...rule.trigger.center] as [number, number, number] : [0, 1, 0], radius: rule.trigger.type === 'enter_area' ? rule.trigger.radius : 2 }
  updateLogicRule({ ...rule, trigger })
}
function setSelectedActionType(type: 'move' | 'rotate' | 'set_visible' | 'set_variable' | 'script' | 'javascript') {
  const rule = selectedGraphRule.value
  if (!rule) return
  const old = rule.actions[0]
  const target = old && 'objectId' in old ? old.objectId : selectedId.value ?? objects.value[0]?.id ?? ''
  const action: LogicRule['actions'][number] = type === 'move'
    ? { type, objectId: target, x: 2, y: 0, z: 0 }
    : type === 'rotate'
      ? { type, objectId: target, degrees: 45 }
      : type === 'set_visible'
        ? { type, objectId: target, visible: false }
        : type === 'set_variable' ? { type, name: 'has_key', value: true } : type === 'javascript' ? { type, code: "api.set('has_key', true)\napi.set('score', 0)\napi.add('score', 1)\n// api.move('{ID_OBJECT}', 2, 0, 1)" } : { type, code: 'set has_key = true\nset score = 0\nadd score 1' }
  updateLogicRule({ ...rule, actions: [action, ...rule.actions.slice(1)] })
}
function ruleValueFromInput(value: string): boolean | number | string {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

const TOOLS: Array<{ id: ToolMode; icon: string; label: string }> = [
  { id: 'select', icon: '↖', label: 'Selecionar' },
  { id: 'build', icon: '◇', label: 'Construir' },
  { id: 'terrain', icon: '~', label: 'Editar terreno' },
]

const TRANSFORMS: Array<{ id: TransformMode; icon: string; label: string }> = [
  { id: 'move', icon: '↔', label: 'Mover' },
  { id: 'rotate', icon: '↻', label: 'Rotacionar' },
  { id: 'scale', icon: '⤢', label: 'Escalar' },
]

const selected = computed(() => objects.value.find((o) => o.id === selectedId.value) ?? null)
const selectedObjectRules = computed(() => logicRules.value.filter(rule =>
  (rule.trigger.type === 'object_clicked' && rule.trigger.objectId === selectedId.value) ||
  rule.actions.some(action => 'objectId' in action && action.objectId === selectedId.value)
))
function openObjectRule(rule: LogicRule) {
  graphSelection.value = {
    ruleId: rule.id,
    part: rule.trigger.type === 'object_clicked' && rule.trigger.objectId === selectedId.value ? 'trigger' : 'action',
  }
  graphOpen.value = true
}
const cameraLabel = computed(() => CAMERA_LABELS[cameraPreset.value])
const hint = 'Arraste para orbitar · Botão direito move · Roda para zoom · W mover · E rotacionar · R escalar'
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="logo">P</div>
        <div>
          <div class="title">ENGINE PROMETHEUS</div>
          <div class="subtitle">WORLD EDITOR · PROTOTYPE</div>
        </div>
      </div>

      <div class="project">
        <input v-model="projectName" class="pname" spellcheck="false" @input="markDirty" />
        <i class="dot" :class="dirty ? 'warn' : 'ok'" :title="dirty ? 'Alterações não salvas' : 'Tudo salvo'" />
      </div>

      <div class="grow" />

      <div class="filebtns">
        <button class="ghost" @click="newProject">Novo</button>
        <button class="ghost" @click="openProject">Abrir</button>
        <button class="ghost" @click="saveProject(false)">Salvar</button>
        <button class="ghost hide-narrow" @click="saveProject(true)">Salvar como…</button>
      </div>

      <button class="cam" @click="cycleCamera"><i class="cam-ring" />{{ cameraLabel }}</button>
    </header>

    <nav class="toolbar">
      <button
        v-for="t in TOOLS"
        :key="t.id"
        class="tool"
        :class="{ active: tool === t.id }"
        @click="setTool(t.id)"
      >
        <span class="tool-ico">{{ t.icon }}</span>{{ t.label }}
      </button>
      <span class="vsep" />
      <button
        v-for="t in TRANSFORMS"
        :key="t.id"
        class="tool"
        :class="{ active: tool === 'select' && transform === t.id }"
        @click="setTransform(t.id)"
      >
        <span class="tool-ico">{{ t.icon }}</span>{{ t.label }}
      </button>
      <span class="vsep" />
      <button class="tool" :class="{ active: graphOpen }" @click="graphOpen = !graphOpen">⌘ Visual Script</button>
      <span class="vsep" />
      <button class="tool add" @click="addPrimitive('cube')">+ Cubo</button>
      <button class="tool add" @click="addPrimitive('platform')">+ Plataforma</button>
      <span class="vsep" />
      <button class="tool grid-toggle" :class="{ active: gridVisible }" @click="toggleGrid" title="Mostrar ou ocultar a malha">▦ Malha</button>
    </nav>

    <div class="main">
      <!-- Hierarquia -->
      <aside class="panel left">
        <div class="panel-head">
          <div>
            <div class="eyebrow">CENA ATUAL</div>
            <div class="h">Hierarquia</div>
          </div>
          <span class="badge">{{ objects.length + 1 }}</span>
        </div>

        <div class="tree">
          <div class="row root" @click="rootOpen = !rootOpen">
            <span class="chev" :class="{ open: rootOpen }">›</span>
            <span class="ico world" />
            <span class="name">Mundo principal</span>
          </div>
          <template v-if="rootOpen">
            <div
              class="row child terrain"
              :class="{ active: selectedId === TERRAIN_ID }"
              @click="selectItem(TERRAIN_ID)"
            >
              <span class="ico rect" />
              <span class="name">Terreno editável</span>
              <button class="eye" :class="{ off: !terrain.visible }" title="Mostrar/ocultar" @click.stop="toggleTerrain" />
            </div>
            <div
              v-for="o in objects"
              :key="o.id"
              class="row child"
              :class="{ active: o.id === selectedId, hidden: !o.visible }"
              @click="selectItem(o.id)"
            >
              <span class="ico" :class="o.type" />
              <span class="name">{{ o.name }}</span>
              <button class="eye" :class="{ off: !o.visible }" title="Mostrar/ocultar" @click.stop="toggleVisible(o.id)" />
            </div>
          </template>
        </div>

        <div class="panel-foot">
          <span>{{ objects.length }} objetos construídos</span>
          <span class="local"><i class="dot ok" /> LOCAL</span>
        </div>
      </aside>

      <!-- Viewport -->
      <main class="viewport">
        <canvas ref="canvas" class="canvas" :class="'tool-' + tool" />
        <div class="chips">
          <span class="chip grid-state">{{ gridVisible ? 'MALHA ATIVA' : 'MALHA OCULTA' }}</span>
          <span class="chip live"><i class="dot ok" /> MUNDO PRINCIPAL</span>
          <span class="chip">ÓRBITA LIVRE</span>
        </div>
        <div class="axes">
          <span class="axis"><b class="ax-x">X</b> largura</span>
          <span class="axis"><b class="ax-y">Y</b> altura</span>
          <span class="axis"><b class="ax-z">Z</b> profundidade</span>
        </div>
        <div class="statusbar">
          <span class="seg"><i class="dot ok" /> Motor 3D ativo</span>
          <span class="seg">Terreno procedural</span>
          <span class="seg grow-text">{{ status || hint }}</span>
        </div>
      </main>

      <!-- Inspetor -->
      <aside class="panel right">
        <div class="panel-head">
          <div>
            <div class="eyebrow">CONFIGURAÇÃO</div>
            <div class="h">Inspetor</div>
          </div>
        </div>

        <div class="scroll">
          <section>
            <h4>Ambiente</h4>
            <dl>
              <dt>Dimensão</dt>
              <dd class="mono">3D · X/Y/Z</dd>
              <dt>Terreno</dt>
              <dd class="mono">100 × 100 unidades</dd>
              <dt>Relevo</dt>
              <dd class="mono">Procedural + editável</dd>
            </dl>
          </section>

          <section>
            <h4>Ferramenta de terreno</h4>
            <p class="muted">
              Selecione Editar terreno e clique no chão para elevar. Segure Shift e clique para rebaixar.
            </p>
            <div class="slider-row"><span>Força do pincel</span><b class="mono">{{ brushStrength.toFixed(2) }}</b></div>
            <input v-model.number="brushStrength" type="range" min="0.2" max="3" step="0.05" />
            <div class="slider-row"><span>Raio do pincel</span><b class="mono">{{ brushRadius.toFixed(1) }}</b></div>
            <input v-model.number="brushRadius" type="range" min="1" max="12" step="0.5" />
            <div class="btn-row">
              <button class="ghost" @click="regenerateTerrain">Novo relevo</button>
              <button class="ghost" @click="clearTerrain">Limpar edições</button>
            </div>
          </section>

          <section>
            <h4>Motor de regras</h4>
            <p class="muted">Gatilhos, condições e ações são executados durante a edição e salvos em <span class="mono">logic/events.json</span>.</p>
            <div class="component-caption">VARIÁVEIS DO PROJETO</div>
            <div v-for="(value, name) in logicVariables" :key="name" class="variable-row">
              <label class="field">{{ name }}<input :value="String(value)" @change="setLogicVariableValue(String(name), ($event.target as HTMLInputElement).value)" /></label>
              <button class="ghost" title="Alternar variável booleana" :disabled="typeof value !== 'boolean'" @click="toggleLogicVariable(String(name))">↻</button>
            </div>
            <div class="variable-create">
              <input v-model="newVariableName" placeholder="nome_da_variavel" spellcheck="false" />
              <input v-model="newVariableValue" placeholder="valor inicial (false, 0, texto)" />
              <button class="ghost full" @click="submitVariable">+ Criar variável</button>
            </div>
            <label class="field">Gatilho
              <select v-model="ruleTrigger"><option value="object_clicked">Clicar no objeto selecionado</option><option value="enter_area">Objeto entrar na área (centro 0,1,0)</option></select>
            </label>
            <label class="field">Ação
              <select v-model="ruleAction"><option value="rotate">Girar +45°</option><option value="move">Mover para X=2</option><option value="set_visible">Ocultar objeto</option><option value="set_variable">Definir has_key = true</option><option value="javascript">JavaScript livre (colar código)</option><option value="script">Script Prometheus</option></select>
            </label>
            <label class="checkline"><input v-model="ruleConditionEnabled" type="checkbox" /> Exigir has_key = true</label>
            <button class="ghost full" @click="addLogicRule">+ Adicionar regra ao objeto selecionado</button>
            <div v-if="logicRules.length" class="rule-list">
              <div v-for="rule in logicRules" :key="rule.id" class="rule-item">
                <label class="checkline"><input type="checkbox" :checked="rule.enabled" @change="toggleLogicRule(rule)" /><span>{{ rule.name }} · {{ rule.trigger.type === 'object_clicked' ? 'Clique' : 'Entrada na área' }}</span></label>
                <button class="rule-delete" title="Excluir regra" @click="deleteLogicRule(rule.id)">×</button>
              </div>
            </div>
            <p v-else class="muted">Nenhuma regra criada.</p>
          </section>

          <section class="object-components">
            <h4>GameObject</h4>
            <template v-if="selected">
              <label class="field">Nome do objeto
                <input :value="selected.name" spellcheck="false" @change="onRename" />
              </label>

              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon transform-icon">↔</span><strong>Transform</strong><span class="component-menu">⋮</span></div>
                <div class="unity-component-body">
                  <div class="component-caption">POSITION</div>
                  <div class="grid3">
                    <label class="field">X<input class="mono" type="number" step="0.1" :value="selected.x.toFixed(2)" @change="onNumber('x', $event)" /></label>
                    <label class="field">Y<input class="mono" type="number" step="0.1" :value="selected.y.toFixed(2)" @change="onNumber('y', $event)" /></label>
                    <label class="field">Z<input class="mono" type="number" step="0.1" :value="selected.z.toFixed(2)" @change="onNumber('z', $event)" /></label>
                  </div>
                  <div class="component-caption">ROTATION</div>
                  <div class="grid3">
                    <label class="field">X<input class="mono" type="number" step="1" :value="selected.rotationX.toFixed(0)" @change="onNumber('rotationX', $event)" /></label>
                    <label class="field">Y<input class="mono" type="number" step="1" :value="selected.rotationY.toFixed(0)" @change="onNumber('rotationY', $event)" /></label>
                    <label class="field">Z<input class="mono" type="number" step="1" :value="selected.rotationZ.toFixed(0)" @change="onNumber('rotationZ', $event)" /></label>
                  </div>
                  <div class="component-caption">SCALE</div>
                  <div class="grid3">
                    <label class="field">X<input class="mono" type="number" min="0.1" step="0.1" :value="selected.scaleX.toFixed(2)" @change="onNumber('scaleX', $event)" /></label>
                    <label class="field">Y<input class="mono" type="number" min="0.1" step="0.1" :value="selected.scaleY.toFixed(2)" @change="onNumber('scaleY', $event)" /></label>
                    <label class="field">Z<input class="mono" type="number" min="0.1" step="0.1" :value="selected.scaleZ.toFixed(2)" @change="onNumber('scaleZ', $event)" /></label>
                  </div>
                  <p class="component-note">Transformação sincronizada com o gizmo 3D do viewport.</p>
                </div>
              </div>

              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon renderer-icon">◈</span><strong>Mesh Renderer</strong><span class="component-menu">⋮</span></div>
                <div class="unity-component-body">
                  <label class="checkline component-enabled"><input type="checkbox" :checked="selected.visible" @change="toggleVisible(selected.id)" /> Renderer habilitado</label>
                  <label class="field">Material · cor base
                    <input type="color" class="color" :value="colorHex(selected.color)" @input="onColor" />
                  </label>
                  <div class="component-readonly"><span>Mesh</span><strong>{{ selected.type === 'cube' ? 'Cube Mesh' : 'Platform Mesh' }}</strong></div>
                  <div class="component-readonly"><span>Shader</span><strong>Standard / PBR</strong></div>
                </div>
              </div>

              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon script-icon">⌘</span><strong>Event Script</strong><span class="component-count">{{ selectedObjectRules.length }}</span></div>
                <div class="unity-component-body">
                  <p class="muted">Eventos que usam este objeto como alvo ou ação.</p>
                  <div v-if="selectedObjectRules.length" class="attached-rules">
                    <button v-for="rule in selectedObjectRules" :key="rule.id" class="attached-rule" @click="openObjectRule(rule)">
                      <span class="attached-rule-status" :class="{ disabled: !rule.enabled }"></span>
                      <span>{{ rule.name }}</span><span class="rule-open">›</span>
                    </button>
                  </div>
                  <p v-else class="component-note">Nenhum evento associado a este objeto.</p>
                  <button class="ghost full add-component-btn" @click="addLogicRule(); graphOpen = true">+ Adicionar evento</button>
                </div>
              </div>

              <button class="danger" @click="removeSelected">Excluir GameObject (Del)</button>
            </template>
            <p v-else-if="selectedId === TERRAIN_ID" class="muted">
              Terreno editável · semente <span class="mono">{{ terrain.seed }}</span> ·
              <span class="mono">{{ terrain.edits }}</span> pontos editados.
            </p>
            <p v-else class="muted">
              Selecione um GameObject na hierarquia ou no mundo para editar seus componentes.
            </p>
          </section>
        </div>

        <div class="panel-foot">
          <span>ENGINE PROMETHEUS</span>
          <span class="mono">{{ ENGINE_VERSION }}</span>
        </div>
      </aside>
    </div>
    <div v-if="graphOpen" class="graph-overlay">
      <header class="graph-top"><div><strong>VISUAL SCRIPT</strong><span class="graph-subtitle">Lógica conectada · salva em logic/events.json</span></div><div class="graph-actions"><button class="ghost" @click="addLogicRule">+ Criar fluxo</button><button class="ghost" @click="graphOpen = false">Voltar ao mundo ✕</button></div></header>
      <div class="graph-body">
        <aside class="graph-library"><div class="eyebrow">BIBLIOTECA</div><h3>Nós disponíveis</h3><p>Crie um fluxo pelo painel Motor de regras e ele aparecerá aqui como nós conectados.</p><div class="node-legend trigger">● Evento</div><div class="node-legend condition">◆ Condição</div><div class="node-legend action">▶ Ação</div><div class="graph-tip">Arraste os nós para organizar o grafo. As posições são guardadas junto com as regras.</div></aside>
        <div ref="graphViewport" class="graph-canvas" @pointermove="moveNode" @pointerup="endNodeDrag" @pointercancel="endNodeDrag">
          <div v-if="!logicRules.length" class="graph-empty"><div class="empty-icon">⌘</div><h2>Nenhum fluxo criado</h2><p>Feche esta janela e adicione uma regra no painel direito, em “Motor de regras”.</p><button class="ghost" @click="graphOpen = false">Voltar ao editor</button></div>
          <svg class="graph-wires" width="1800" height="1200" aria-hidden="true"><path v-for="edge in graphEdges" :key="edge.id" :d="`M ${edge.x1} ${edge.y1} C ${edge.x1 + 65} ${edge.y1}, ${edge.x2 - 65} ${edge.y2}, ${edge.x2} ${edge.y2}`" /></svg>
          <article v-for="node in graphNodes" :key="node.rule.id + node.part" class="graph-node" :class="[node.part, { chosen: graphSelection?.ruleId === node.rule.id && graphSelection?.part === node.part }]" :style="{ left: `${node.x}px`, top: `${node.y}px` }" @pointerdown="startNodeDrag($event, node.rule.id, node.part)" @click.stop="graphSelection = { ruleId: node.rule.id, part: node.part }"><div class="node-head"><span>{{ node.part === 'trigger' ? 'EVENTO' : node.part === 'condition' ? 'CONDIÇÃO' : 'AÇÃO' }}</span><span>{{ node.rule.enabled ? '●' : '○' }}</span></div><div class="node-title">{{ nodeTitle(node.rule, node.part) }}</div><div class="node-foot"><span class="node-port"></span>{{ node.rule.name }}<span class="node-port out"></span></div></article>
        </div>
        <aside class="graph-inspector">
          <div class="eyebrow">INSPECTOR</div>
          <template v-if="selectedGraphRule && graphSelection">
            <h3>{{ graphSelection.part === 'trigger' ? 'Evento' : graphSelection.part === 'condition' ? 'Condição' : 'Ação' }}</h3>
            <label class="field">Nome do fluxo
              <input :value="selectedGraphRule.name" spellcheck="false" @change="updateLogicRule({ ...selectedGraphRule, name: ($event.target as HTMLInputElement).value })" />
            </label>
            <label class="checkline"><input type="checkbox" :checked="selectedGraphRule.enabled" @change="toggleLogicRule(selectedGraphRule)" /> Fluxo habilitado</label>
            <template v-if="graphSelection.part === 'trigger'">
              <label class="field">Tipo de evento
                <select :value="selectedGraphRule.trigger.type" @change="setSelectedTriggerType(($event.target as HTMLSelectElement).value as 'object_clicked' | 'enter_area')">
                  <option value="object_clicked">Ao clicar no objeto</option>
                  <option value="enter_area">Ao entrar em uma área</option>
                </select>
              </label>
              <template v-if="selectedGraphRule.trigger.type === 'object_clicked'">
                <label class="field">Objeto-alvo
                  <select :value="selectedGraphRule.trigger.objectId" @change="patchSelectedTrigger({ objectId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="obj in objects" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                  </select>
                </label>
              </template>
              <template v-else>
                <div class="component-caption">CENTRO DA ÁREA</div>
                <div class="grid3">
                  <label class="field">X<input type="number" :value="selectedGraphRule.trigger.center[0]" @change="patchSelectedTrigger({ center: [Number(($event.target as HTMLInputElement).value), selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[1] : 1, selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[2] : 0] })" /></label>
                  <label class="field">Y<input type="number" :value="selectedGraphRule.trigger.center[1]" @change="patchSelectedTrigger({ center: [selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[0] : 0, Number(($event.target as HTMLInputElement).value), selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[2] : 0] })" /></label>
                  <label class="field">Z<input type="number" :value="selectedGraphRule.trigger.center[2]" @change="patchSelectedTrigger({ center: [selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[0] : 0, selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[1] : 1, Number(($event.target as HTMLInputElement).value)] })" /></label>
                </div>
                <label class="field">Raio da área
                  <input type="number" min="0.1" step="0.1" :value="selectedGraphRule.trigger.radius" @change="patchSelectedTrigger({ radius: Math.max(0.1, Number(($event.target as HTMLInputElement).value)) })" />
                </label>
              </template>
            </template>
            <template v-else-if="graphSelection.part === 'condition'">
              <label class="checkline"><input type="checkbox" :checked="selectedGraphRule.conditions.length > 0" @change="updateLogicRule({ ...selectedGraphRule, conditions: ($event.target as HTMLInputElement).checked ? [{ type: 'variable', name: 'has_key', operator: 'equals', value: true }] : [] })" /> Exigir condição</label>
              <template v-if="selectedGraphRule.conditions.length">
                <label class="field">Variável exigida
                  <select :value="selectedGraphRule.conditions[0]?.name ?? ''" @change="patchSelectedCondition({ name: ($event.target as HTMLSelectElement).value })">
                    <option value="" disabled>Selecione uma variável</option>
                    <option v-for="(value, name) in logicVariables" :key="name" :value="name">{{ name }} = {{ String(value) }}</option>
                  </select>
                </label>
                <label class="field">Comparação
                  <select :value="selectedGraphRule.conditions[0]?.operator ?? 'equals'" @change="patchSelectedCondition({ operator: ($event.target as HTMLSelectElement).value })">
                    <option value="equals">É igual a</option><option value="not_equals">É diferente de</option><option value="greater_than">Maior que</option><option value="less_than">Menor que</option>
                  </select>
                </label>
                <label class="field">Valor
                  <input :value="String(selectedGraphRule.conditions[0]?.value ?? true)" @change="patchSelectedCondition({ value: ruleValueFromInput(($event.target as HTMLInputElement).value) })" />
                </label>
                <p class="muted">Use true/false para booleanos ou um número para comparações numéricas.</p>
              </template>
              <p v-else class="muted">Sem condição: o evento executa sempre que for disparado.</p>
            </template>
            <template v-else>
              <label class="field">Tipo de ação
                <select :value="selectedGraphRule.actions[0]?.type ?? 'rotate'" @change="setSelectedActionType(($event.target as HTMLSelectElement).value as 'move' | 'rotate' | 'set_visible' | 'set_variable' | 'script' | 'javascript')">
                  <option value="move">Mover objeto</option><option value="rotate">Rotacionar objeto</option><option value="set_visible">Visibilidade</option><option value="set_variable">Definir variável</option><option value="script">Script Prometheus (comandos)</option><option value="javascript">JavaScript livre</option>
                </select>
              </label>
              <template v-if="selectedGraphRule.actions[0] && 'objectId' in selectedGraphRule.actions[0]">
                <label class="field">Objeto afetado
                  <select :value="selectedGraphRule.actions[0].objectId" @change="patchSelectedAction({ objectId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="obj in objects" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                  </select>
                </label>
              </template>
              <div v-if="selectedGraphRule.actions[0]?.type === 'move'" class="component-box">
                <div class="component-caption">POSIÇÃO DE DESTINO</div>
                <div class="grid3">
                  <label class="field">X<input type="number" step="0.1" :value="selectedGraphRule.actions[0].x ?? 0" @change="patchSelectedAction({ x: Number(($event.target as HTMLInputElement).value) })" /></label>
                  <label class="field">Y<input type="number" step="0.1" :value="selectedGraphRule.actions[0].y ?? 0" @change="patchSelectedAction({ y: Number(($event.target as HTMLInputElement).value) })" /></label>
                  <label class="field">Z<input type="number" step="0.1" :value="selectedGraphRule.actions[0].z ?? 0" @change="patchSelectedAction({ z: Number(($event.target as HTMLInputElement).value) })" /></label>
                </div>
              </div>
              <label v-else-if="selectedGraphRule.actions[0]?.type === 'rotate'" class="field">Ângulo (graus)
                <input type="number" step="1" :value="selectedGraphRule.actions[0].degrees" @change="patchSelectedAction({ degrees: Number(($event.target as HTMLInputElement).value) })" />
              </label>
              <label v-else-if="selectedGraphRule.actions[0]?.type === 'set_visible'" class="field">Visibilidade
                <select :value="String(selectedGraphRule.actions[0].visible)" @change="patchSelectedAction({ visible: ($event.target as HTMLSelectElement).value === 'true' })"><option value="true">Mostrar</option><option value="false">Ocultar</option></select>
              </label>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'javascript'">
                <p class="muted">JavaScript executado depois do gatilho e de todas as condições. API: <code>api</code>, <code>vars</code>, <code>world</code> e <code>console</code>.</p>
                <label class="field">Código JavaScript
                  <textarea class="script-editor" spellcheck="false" rows="12" :value="scriptDraft" @input="onScriptDraftInput"></textarea>
                </label>
                <div class="component-box">
                  <div class="component-caption">EXEMPLOS</div>
                  <p class="muted mono">api.set('score', 10)</p>
                  <p class="muted mono">api.add('score', 1)</p>
                  <p class="muted mono">api.toggle('has_key')</p>
                  <p class="muted mono">api.move('{ID_OBJECT}', 2, 0, 1)</p>
                  <p class="muted mono">api.rotate('{ID_OBJECT}', 45)</p>
                  <p class="muted mono">api.setVisible('{ID_OBJECT}', false)</p>
                  <p class="muted mono">api.setColor('{ID_OBJECT}', '#0000FF')</p>
                  <p class="muted">Também pode ler e alterar variáveis com vars.nome ou vars['nome']. Execute apenas scripts confiáveis: JavaScript roda com as permissões do app.</p>
                </div>
              </template>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'script'">
                <p class="muted">Script Prometheus (comandos seguros, uma instrução por linha). Não é JavaScript livre.</p>
                <label class="field">Código do evento
                  <textarea class="script-editor" spellcheck="false" rows="9" :value="selectedGraphRule.actions[0].code" @input="patchSelectedAction({ code: ($event.target as HTMLTextAreaElement).value })"></textarea>
                </label>
                <div class="component-box">
                  <div class="component-caption">COMANDOS DISPONÍVEIS</div>
                  <p class="muted mono">set nome = valor</p>
                  <p class="muted mono">add pontuacao 1</p>
                  <p class="muted mono">toggle tem_chave</p>
                  <p class="muted mono">rotate {ID_OBJECT} 45</p>
                  <p class="muted mono">move {ID_OBJECT} 2 0 1</p>
                  <p class="muted mono">visible {ID_OBJECT} false</p>
                  <p class="muted">Valores: true, false, números ou textos entre aspas. Use # para comentários.</p>
                </div>
              </template>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'set_variable'">
                <label class="field">Nome da variável<input :value="selectedGraphRule.actions[0].name" @change="patchSelectedAction({ name: ($event.target as HTMLInputElement).value })" /></label>
                <label class="field">Valor<input :value="String(selectedGraphRule.actions[0].value)" @change="patchSelectedAction({ value: ruleValueFromInput(($event.target as HTMLInputElement).value) })" /></label>
              </template>
            </template>
            <button class="danger" @click="deleteLogicRule(selectedGraphRule.id); graphSelection = null">Excluir fluxo</button>
          </template>
          <p v-else class="muted">Selecione um nó no gráfico para editar suas propriedades.</p>
          <div class="graph-rule-count">{{ logicRules.length }} fluxo(s) · {{ graphNodes.length }} nós</div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --bg: #12151c;
  --panel: #161a22;
  --panel-2: #1a1f29;
  --line: #242a35;
  --text: #d6dae3;
  --muted: #8a93a6;
  --accent: #c5533f;
  --accent-dark: #a4443a;
  --green: #5bd08a;
  --warn: #e0b04a;
}

.app { display: flex; flex-direction: column; height: 100%; background: var(--bg); color: var(--text); }
.grow { flex: 1; }
.mono { font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace; }

/* topo */
.topbar { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 3px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 8px; flex: none; }
.logo { width: 25px; height: 25px; border-radius: 5px; background: #4a2128; color: #f0897a; border: 1px solid #6b2f38; display: grid; place-items: center; font-weight: 800; font-size: 12px; }
.title { font-weight: 700; letter-spacing: 0.1em; font-size: 11px; white-space: nowrap; }
.subtitle { font-size: 8px; letter-spacing: 0.12em; color: var(--muted); margin-top: 1px; white-space: nowrap; }
.project { display: flex; align-items: center; gap: 6px; margin-left: 10px; }
.pname { width: 170px; padding: 4px 7px; background: transparent; border: 1px solid transparent; }
.pname:hover, .pname:focus { border-color: var(--line); background: var(--bg); }
.filebtns { display: flex; gap: 6px; flex: none; }
.filebtns .ghost { white-space: nowrap; }
.cam { display: inline-flex; align-items: center; gap: 6px; background: #3a1f24; border: 1px solid #6b2f38; color: #f3b3a8; padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; white-space: nowrap; flex: none; }
.cam:hover { background: #46262c; }
.cam-ring { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #f0897a; box-shadow: inset 0 0 0 2px #3a1f24, inset 0 0 0 6px #f0897a; }

/* barra de ferramentas */
.toolbar { display: flex; align-items: center; gap: 2px; padding: 0 10px; background: var(--panel); border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: thin; scrollbar-color: #2c3340 transparent; }
.tool { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 0; border-radius: 0; background: transparent; color: var(--text); white-space: nowrap; }
.tool:hover { background: #1d222c; }
.tool.active { background: var(--accent-dark); color: #fff; }
.tool-ico { opacity: 0.85; }
.full { width: 100%; }
.checkline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin: 10px 0; }
.checkline input { accent-color: var(--accent); }
.rule-list { margin-top: 10px; }
.rule-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--line); padding: 8px 0; }
.rule-item .checkline { flex: 1; margin: 0; }
.rule-delete { background: transparent; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; }
.tool.add { padding-left: 18px; padding-right: 18px; }
.vsep { width: 1px; height: 18px; background: var(--line); margin: 0 6px; flex: none; }

/* layout central */
.main { flex: 1; display: flex; min-height: 0; }
.panel { display: flex; flex-direction: column; background: var(--panel); min-height: 0; }
.panel.left { width: 210px; border-right: 1px solid var(--line); flex: none; }
.panel.right { width: 270px; border-left: 1px solid var(--line); flex: none; }
.panel-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.eyebrow { font-size: 10px; letter-spacing: 0.16em; color: var(--muted); }
.h { font-weight: 700; font-size: 16px; margin-top: 3px; }
.badge { background: #232a35; border-radius: 6px; padding: 4px 9px; font-weight: 700; }
.panel-foot { display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; border-top: 1px solid var(--line); font-size: 10.5px; color: var(--muted); letter-spacing: 0.02em; margin-top: auto; white-space: nowrap; gap: 8px; }
.local { display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.08em; }

.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.ok { background: var(--green); }
.dot.warn { background: var(--warn); }

/* hierarquia */
.tree { flex: 1; overflow-y: auto; }
.row { display: flex; align-items: center; gap: 10px; padding: 11px 16px; cursor: pointer; border-bottom: 1px solid var(--line); }
.row:hover { background: #1c212b; }
.row.root { font-weight: 700; background: var(--panel-2); }
.row.child { padding-left: 22px; }
.row.child .name { flex: 1; }
.row.active { background: #1f2b2a; box-shadow: inset 2px 0 0 var(--green); }
.row.terrain .name { color: #a8dca0; }
.row.hidden .name { opacity: 0.45; }
.chev { display: inline-block; width: 10px; color: var(--muted); transition: transform 0.15s; }
.chev.open { transform: rotate(90deg); }
.ico { display: inline-block; width: 12px; height: 12px; flex: none; }
.ico.world { background: #6d7ea8; border-radius: 3px; }
.ico.rect { border: 2px solid #a8dca0; border-radius: 2px; height: 9px; }
.ico.cube { border: 2px solid #f0897a; transform: rotate(45deg) scale(0.8); border-radius: 2px; }
.ico.platform { background: #e0566f; transform: skewX(-20deg); height: 10px; }
.eye { width: 10px; height: 10px; padding: 0; border-radius: 50%; border: 2px solid #7f8aa3; background: #7f8aa3; box-shadow: inset 0 0 0 2px var(--panel); }
.eye.off { background: transparent; box-shadow: none; opacity: 0.5; }

/* viewport */
.viewport { position: relative; flex: 1; min-width: 0; background: var(--bg); }
.canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
.canvas.tool-terrain { cursor: crosshair; }
.canvas.tool-build { cursor: copy; }
.chips { position: absolute; top: 16px; left: 16px; display: flex; gap: 8px; pointer-events: none; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--line); background: rgba(22, 26, 34, 0.85); border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; white-space: nowrap; }
.chip.live { color: #e6e9f0; }
.axes { position: absolute; left: 14px; bottom: 44px; display: flex; gap: 8px; pointer-events: none; }
.axis { padding: 6px 10px; border: 1px solid var(--line); background: rgba(22, 26, 34, 0.9); border-radius: 6px; font-size: 12px; }
.axis b { margin-right: 4px; }
.ax-x { color: #f0705f; } .ax-y { color: #8fd68a; } .ax-z { color: #6fb7f0; }
.statusbar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; background: rgba(14, 17, 23, 0.92); border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
.seg { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; white-space: nowrap; }
.seg.grow-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; display: block; }

/* inspetor */
.scroll { flex: 1; overflow-y: auto; }
.scroll section { padding: 16px 18px; border-bottom: 1px solid var(--line); }
.scroll h4 { margin: 0 0 12px; font-size: 14px; font-weight: 700; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 9px 12px; margin: 0; font-size: 12px; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; font-weight: 700; }
.muted { color: var(--muted); font-size: 12px; line-height: 1.6; margin: 0 0 12px; }
.slider-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin: 10px 0 6px; }
.slider-row b { color: var(--text); }
input[type='range'] { width: 100%; accent-color: var(--accent); }
.btn-row { display: flex; gap: 8px; margin-top: 14px; }
.btn-row .ghost { flex: 1; padding: 7px 6px; white-space: nowrap; font-size: 11.5px; }
.field { display: block; font-size: 11px; color: var(--muted); margin-bottom: 10px; }
.field input { display: block; width: 100%; margin-top: 5px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
input.color { padding: 2px; height: 32px; cursor: pointer; }

/* controles */
button { font: inherit; cursor: pointer; }
.ghost { background: #1d222c; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 12px; font-size: 12px; }
.ghost:hover { background: #252b37; }
.danger { width: 100%; margin-top: 4px; background: transparent; color: #f3a79b; border: 1px solid #6b2f38; border-radius: 8px; padding: 8px; }
.danger:hover { background: #2b1a1e; }
input { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; box-sizing: border-box; }
input:focus { outline: none; border-color: var(--accent); }

/* telas estreitas */
@media (max-width: 1100px) {
  .hide-narrow { display: none; }
}
@media (max-width: 1000px) {
  .pname { display: none; }
  .project { margin-left: 4px; }
  .panel.left { width: 190px; }
  .panel.right { width: 250px; }
  .tool { padding: 12px 10px; gap: 6px; }
  .full { width: 100%; }
.checkline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin: 10px 0; }
.checkline input { accent-color: var(--accent); }
.rule-list { margin-top: 10px; }
.rule-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--line); padding: 8px 0; }
.rule-item .checkline { flex: 1; margin: 0; }
.rule-delete { background: transparent; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; }
.tool.add { padding-left: 12px; padding-right: 12px; }
  .vsep { margin: 0 4px; }
  .panel-head { padding: 14px 14px; }
  .panel-foot { padding: 10px 12px; }
  .local { letter-spacing: 0.04em; }
  .row { padding-left: 12px; padding-right: 12px; }
  .row.child { padding-left: 18px; }
}
@media (max-width: 860px) {
  .tool { padding: 12px 7px; }
  .full { width: 100%; }
.checkline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin: 10px 0; }
.checkline input { accent-color: var(--accent); }
.rule-list { margin-top: 10px; }
.rule-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--line); padding: 8px 0; }
.rule-item .checkline { flex: 1; margin: 0; }
.rule-delete { background: transparent; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; }
.tool.add { padding-left: 9px; padding-right: 9px; }
}
</style>

<style>
.graph-overlay { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: #10131a; color: #e1e5ed; }
.graph-top { height: 58px; flex: none; display:flex; align-items:center; justify-content:space-between; padding:0 18px; border-bottom:1px solid #2a303d; background:#171b24; }
.graph-top strong { letter-spacing:.12em; font-size:13px; } .graph-subtitle { margin-left:16px; color:#8e98aa; font-size:12px; } .graph-actions { display:flex; gap:8px; }
.graph-body { display:grid; grid-template-columns:210px minmax(0,1fr) 245px; min-height:0; flex:1; }
.graph-library,.graph-inspector { padding:18px 14px; background:#171b24; overflow:auto; } .graph-library { border-right:1px solid #2a303d; } .graph-inspector { border-left:1px solid #2a303d; } .graph-library h3,.graph-inspector h3 { font-size:14px; margin:10px 0 14px; } .graph-library p { font-size:12px; line-height:1.6; color:#8993a6; }
.node-legend { padding:10px 12px; margin:8px 0; border-radius:6px; background:#202632; font-size:12px; border-left:3px solid; } .node-legend.trigger { border-color:#d8a34a; } .node-legend.condition { border-color:#6c9de6; } .node-legend.action { border-color:#65bf91; } .graph-tip { margin-top:26px; padding-top:14px; border-top:1px solid #2a303d; font-size:11px; line-height:1.6; color:#7f899c; }
.graph-canvas { position:relative; overflow:auto; min-width:0; background-color:#11151d; background-image:radial-gradient(#343b49 1px,transparent 1px); background-size:22px 22px; touch-action:none; } .graph-wires { position:absolute; inset:0; width:1800px; height:1200px; pointer-events:none; overflow:visible; } .graph-wires path { fill:none; stroke:#8a96ad; stroke-width:2.5; }
.graph-node { position:absolute; width:220px; min-height:120px; border:1px solid #3b4352; background:#1c222d; border-radius:8px; box-shadow:0 10px 24px #0004; cursor:grab; user-select:none; z-index:1; } .graph-node:active { cursor:grabbing; } .graph-node.chosen { outline:2px solid #d36a55; outline-offset:2px; } .graph-node.trigger { border-top:3px solid #d8a34a; } .graph-node.condition { border-top:3px solid #6c9de6; } .graph-node.action { border-top:3px solid #65bf91; } .node-head { display:flex; justify-content:space-between; padding:10px 12px 8px; font-size:9px; letter-spacing:.13em; color:#aab4c5; border-bottom:1px solid #303746; } .node-title { padding:13px 12px; min-height:44px; font-size:12px; line-height:1.5; } .node-foot { position:relative; display:flex; align-items:center; justify-content:center; padding:7px; border-top:1px solid #303746; color:#7f899c; font-size:10px; } .node-port { position:absolute; left:-5px; top:50%; width:9px; height:9px; border-radius:50%; background:#8a96ad; border:2px solid #1c222d; } .node-port.out { left:auto; right:-5px; } .graph-empty { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; width:min(360px,90%); } .graph-empty h2 { font-size:18px; } .graph-empty p { color:#8e98aa; font-size:12px; line-height:1.6; } .empty-icon { font-size:32px; color:#d36a55; } .graph-rule-count { border-top:1px solid #2a303d; margin-top:24px; padding-top:12px; font-size:11px; color:#8e98aa; }
@media(max-width:800px) { .graph-body { grid-template-columns:150px minmax(0,1fr); } .graph-inspector { display:none; } .graph-subtitle { display:none; } }
</style>


<style>
/* Tema visual inspirado no Blender: painéis grafite, controles compactos e seleção laranja. */
:root {
  --bg: #282828;
  --panel: #303030;
  --panel-2: #383838;
  --line: #202020;
  --text: #dedede;
  --muted: #a0a0a0;
  --accent: #e98524;
  --accent-dark: #b96313;
  --green: #83b879;
  --warn: #e4b65c;
}

.app { background: #282828; color: #dedede; }
.topbar {
  min-height: 32px;
  height: 32px;
  gap: 7px;
  padding: 2px 7px;
  background: #252525;
  border-bottom: 1px solid #171717;
}
.brand { gap: 7px; }
.logo {
  width: 23px;
  height: 23px;
  border-radius: 4px;
  background: #e98524;
  color: #252525;
  border: 1px solid #f5a34d;
}
.title { font-size: 10px; letter-spacing: .07em; }
.subtitle { display: none; }
.project { margin-left: 8px; }
.pname { font-size: 11px; padding: 3px 6px; border-radius: 3px; }
.filebtns { gap: 2px; }
.filebtns .ghost,
.ghost {
  padding: 4px 8px;
  border-radius: 3px;
  border-color: #202020;
  background: #3a3a3a;
  color: #dedede;
  font-size: 11px;
}
.filebtns .ghost:hover,
.ghost:hover { background: #4a4a4a; }
.cam {
  padding: 4px 8px;
  border-radius: 3px;
  background: #3b332a;
  border-color: #59442d;
  color: #f2bd83;
}
.cam:hover { background: #4b3c2d; }

.toolbar {
  min-height: 32px;
  height: 32px;
  gap: 1px;
  padding: 0 5px;
  background: #333;
  border-bottom: 1px solid #1d1d1d;
}
.tool {
  height: 29px;
  padding: 0 9px;
  gap: 5px;
  border-radius: 3px;
  color: #d2d2d2;
  font-size: 11px;
}
.tool:hover { background: #484848; }
.tool.active {
  background: #51402f;
  box-shadow: inset 0 -2px 0 #e98524;
  color: #fff;
}
.tool.add { padding-left: 9px; padding-right: 9px; }
.tool-ico { color: #c7c7c7; }
.vsep { height: 19px; margin: 0 4px; background: #505050; }

.main { background: #282828; }
.panel { background: #303030; }
.panel.left { width: 225px; border-right: 1px solid #1c1c1c; }
.panel.right { width: 285px; border-left: 1px solid #1c1c1c; }
.panel-head {
  padding: 9px 11px;
  background: #383838;
  border-bottom: 1px solid #222;
}
.eyebrow { font-size: 9px; letter-spacing: .1em; color: #a4a4a4; }
.h { font-size: 13px; margin-top: 2px; }
.badge { padding: 3px 7px; border-radius: 3px; background: #252525; }
.panel-foot {
  padding: 6px 9px;
  background: #292929;
  border-top: 1px solid #202020;
  font-size: 10px;
}
.tree { background: #303030; }
.row {
  gap: 8px;
  padding: 6px 10px;
  min-height: 27px;
  border-bottom: 0;
  font-size: 11px;
}
.row.root { background: #383838; }
.row.child { padding-left: 23px; }
.row:hover { background: #454545; }
.row.active {
  background: #51402f;
  box-shadow: inset 2px 0 0 #e98524;
}
.row.terrain .name { color: #b9d5a7; }
.chev { width: 8px; }

.viewport { background: #242424; }
.chips { top: 9px; left: 9px; gap: 4px; }
.chip {
  padding: 4px 7px;
  border-radius: 3px;
  border-color: #3b3b3b;
  background: rgba(38, 38, 38, .9);
  font-size: 9px;
  letter-spacing: .05em;
}
.axes { left: 9px; bottom: 35px; gap: 4px; }
.axis {
  padding: 4px 7px;
  border-radius: 3px;
  background: rgba(38, 38, 38, .92);
  font-size: 10px;
}
.statusbar { background: #292929; border-top-color: #1c1c1c; font-size: 10px; }
.seg { padding: 5px 9px; }

.scroll section { padding: 11px 12px; border-bottom-color: #242424; }
.scroll h4 { margin-bottom: 9px; font-size: 12px; }
dl { gap: 7px 10px; font-size: 11px; }
.muted { font-size: 11px; }
.field { font-size: 10px; }
.field input,
input,
select {
  border-radius: 3px;
  border-color: #202020;
  background: #252525;
  color: #dedede;
  padding: 5px 7px;
  font-size: 11px;
}
input:focus, select:focus { border-color: #e98524; }
input[type='range'] { accent-color: #e98524; }
.checkline { font-size: 11px; }
.danger {
  border-radius: 3px;
  border-color: #704137;
  color: #f0a18b;
  padding: 6px;
}
.danger:hover { background: #412d29; }
.eye { border-color: #aaa; background: #aaa; }
.eye.off { background: transparent; }

@media (max-width: 1000px) {
  .tool { height: 29px; padding: 0 7px; }
  .panel.left { width: 195px; }
  .panel.right { width: 260px; }
}
@media (max-width: 860px) {
  .tool { height: 29px; padding: 0 6px; }
}
</style>

<style>
/* Workspace de lógica inspirado no Unity: hierarquia de nós, inspector por componente e controles editáveis. */
.graph-overlay { background:#202020; color:#e6e6e6; }
.graph-top { height:38px; padding:0 10px; background:#303030; border-bottom:1px solid #171717; }
.graph-top strong { font-size:11px; letter-spacing:.08em; }
.graph-subtitle { font-size:10px; margin-left:10px; }
.graph-body { grid-template-columns:190px minmax(0,1fr) 285px; }
.graph-library,.graph-inspector { padding:12px 10px; background:#303030; }
.graph-library { border-right:1px solid #191919; }
.graph-inspector { border-left:1px solid #191919; }
.graph-library h3,.graph-inspector h3 { margin:8px 0 12px; font-size:13px; }
.graph-canvas { background-color:#252525; background-image:linear-gradient(#303030 1px,transparent 1px),linear-gradient(90deg,#303030 1px,transparent 1px); background-size:20px 20px; }
.graph-wires path { stroke:#a4a4a4; stroke-width:2; }
.graph-node { width:232px; min-height:122px; border-radius:4px; background:#383838; border-color:#1d1d1d; box-shadow:0 3px 8px #0005; }
.graph-node.chosen { outline:2px solid #e98524; outline-offset:0; }
.graph-node.trigger { border-top:3px solid #b98b48; }
.graph-node.condition { border-top:3px solid #6b9ecb; }
.graph-node.action { border-top:3px solid #70a878; }
.node-head { padding:8px 10px 7px; background:#303030; border-bottom-color:#242424; font-size:9px; }
.node-title { padding:12px 10px; min-height:40px; font-size:11px; }
.node-foot { background:#303030; border-top-color:#242424; }
.graph-inspector .field { margin:10px 0; font-size:10px; }
.graph-inspector .field input,.graph-inspector .field select { margin-top:4px; width:100%; }
.graph-inspector .grid3 { gap:5px; }
.graph-inspector .component-caption { margin:10px 0 7px; color:#aaa; font-size:9px; font-weight:700; letter-spacing:.09em; }
.graph-inspector .component-box { border:1px solid #202020; background:#292929; padding:8px; margin:8px 0 12px; }
.graph-inspector .checkline { margin:10px 0; color:#d0d0d0; }
.variable-row { display:flex; align-items:center; gap:6px; }
.variable-row .field { flex:1; min-width:0; }
.variable-row input { width:100%; }
.variable-create { display:grid; grid-template-columns:1fr 1fr; gap:5px; margin:10px 0 14px; }
.variable-create .full { grid-column:1 / -1; }
.script-editor { display:block; width:100%; min-height:150px; resize:vertical; padding:8px; background:#202020; color:#d9e7d1; border:1px solid #181818; border-radius:3px; font:11px/1.5 'Cascadia Mono',Consolas,monospace; white-space:pre; }
.graph-inspector .ghost,.graph-inspector .danger { border-radius:3px; }
.graph-rule-count { border-top-color:#1d1d1d; }
@media(max-width:900px) { .graph-body { grid-template-columns:145px minmax(0,1fr); } .graph-inspector { display:none; } }
</style>

<style>
/* Inspetor de componentes inspirado no Inspector do Unity. */
.object-components > h4 { margin-bottom:12px; }
.unity-component { margin:10px 0; border:1px solid #1d1d1d; border-radius:3px; overflow:hidden; background:#292929; }
.unity-component-head { min-height:31px; display:flex; align-items:center; gap:8px; padding:0 8px; background:#383838; border-bottom:1px solid #202020; font-size:11px; }
.unity-component-head strong { font-size:11px; font-weight:600; flex:1; color:#e2e2e2; }
.component-icon { width:18px; height:18px; display:grid; place-items:center; border-radius:3px; font-size:13px; background:#242424; color:#e98524; }
.renderer-icon { color:#85b4d9; }
.script-icon { color:#83bb8b; }
.component-menu { color:#aaa; font-size:17px; line-height:1; }
.component-count { min-width:18px; text-align:center; padding:2px 5px; border-radius:8px; background:#242424; color:#bdbdbd; font-size:10px; }
.unity-component-body { padding:9px 8px 8px; }
.unity-component-body .field { margin-bottom:8px; }
.unity-component-body .grid3 { gap:5px; }
.unity-component-body .field input { padding:5px 4px; min-width:0; }
.component-caption { margin:3px 0 6px; color:#999; font-size:9px; font-weight:700; letter-spacing:.08em; }
.component-note { margin:5px 0 2px; color:#999; font-size:10px; line-height:1.5; }
.component-enabled { color:#ddd; padding-bottom:8px; border-bottom:1px solid #202020; }
.component-readonly { display:flex; justify-content:space-between; gap:8px; padding:6px 0 0; font-size:10px; color:#999; }
.component-readonly strong { color:#cfcfcf; font-weight:500; text-align:right; }
.attached-rules { display:flex; flex-direction:column; gap:4px; margin:8px 0; }
.attached-rule { display:flex; align-items:center; gap:7px; width:100%; padding:7px; text-align:left; border:1px solid #202020; border-radius:3px; background:#333; color:#ddd; font-size:10px; }
.attached-rule:hover { background:#414141; border-color:#555; }
.attached-rule > span:nth-child(2) { flex:1; }
.attached-rule-status { width:7px; height:7px; border-radius:50%; background:#83bb8b; }
.attached-rule-status.disabled { background:#666; }
.rule-open { color:#aaa; font-size:16px; }
.add-component-btn { margin-top:8px; }
.object-components .danger { margin-top:8px; }
@media(max-width:1000px) { .unity-component-body .field input { font-size:10px; } }
</style>
