<script setup lang="ts">
import { computed, ref } from 'vue'
import { ENGINE_VERSION, TERRAIN_ID } from '@engine'
import type { ToolMode, TransformMode, LogicRule } from '@engine'
import { CAMERA_LABELS, useEditor } from '@/composables/useEditor'
import RuntimeHUD from '@/components/RuntimeHUD.vue'

const canvas = ref<HTMLCanvasElement | null>(null)
const activeRailItem = ref<'scene' | 'scripts'>('scene')
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
  toggleLogicVariable, addLogicRule, toggleLogicRule, deleteLogicRule, updateLogicRule,
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
  // Workspace persistence
  graphOpen,
  inspectorMode,
  leftPanelWidth,
  rightPanelWidth,
  // Runtime mode
  runtimeMode,
  isPlayMode,
  isEditMode,
  enterPlayMode,
  exitPlayMode,
  togglePlayMode,
  // Runtime HUD
  hudEntityCount,
  hudMountStatus,
  hudMountName,
  fps,
} = useEditor(canvas)

const graphSelection = ref<{ ruleId: string; part: 'trigger' | 'condition' | 'action' } | null>(null)
const dragNode = ref<{ ruleId: string; part: 'trigger' | 'condition' | 'action'; dx: number; dy: number } | null>(null)
const graphViewport = ref<HTMLElement | null>(null)
const connectionSource = ref<{ ruleId: string; part: 'trigger' | 'condition' | 'action' } | null>(null)
const graphNodes = computed(() => logicRules.value.flatMap((rule, index) => {
  const layout = rule.graphLayout ?? { trigger: { x: 70, y: 70 + index * 230 }, condition: { x: 340, y: 70 + index * 230 }, action: { x: 610, y: 70 + index * 230 } }
  return (['trigger', 'condition', 'action'] as const).map(part => ({ rule, part, x: layout[part].x, y: layout[part].y }))
}))
const graphEdges = computed(() => logicRules.value.flatMap(rule => {
  const layout = rule.graphLayout ?? { trigger: { x: 70, y: 70 }, condition: { x: 340, y: 70 }, action: { x: 610, y: 70 } }
  const connections = rule.graphConnections ?? [{ from: 'trigger' as const, to: 'condition' as const }, { from: 'condition' as const, to: 'action' as const }]
  return connections.map((connection, index) => ({
    id: `${rule.id}-${connection.from}-${connection.to}-${index}`,
    x1: layout[connection.from].x + 220, y1: layout[connection.from].y + 60,
    x2: layout[connection.to].x, y2: layout[connection.to].y + 60,
  }))
}))
const selectedGraphRule = computed(() => logicRules.value.find(rule => rule.id === graphSelection.value?.ruleId) ?? null)
function selectGraphPort(ruleId: string, part: 'trigger' | 'condition' | 'action', side: 'in' | 'out') {
  graphSelection.value = { ruleId, part }
  if (side === 'out') {
    connectionSource.value = { ruleId, part }
    return
  }
  if (!connectionSource.value) return
  const source = connectionSource.value
  connectionSource.value = null
  if (source.ruleId !== ruleId) { window.alert('Por enquanto, conecte nós do mesmo fluxo.'); return }
  if (source.part === part) { window.alert('Escolha um nó diferente para receber a conexão.'); return }
  const rule = logicRules.value.find(r => r.id === ruleId)
  if (!rule) return
  const connections = [...(rule.graphConnections ?? [{ from: 'trigger' as const, to: 'condition' as const }, { from: 'condition' as const, to: 'action' as const }])]
  if (connections.some(c => c.from === source.part && c.to === part)) return
  updateLogicRule({ ...rule, graphConnections: [...connections, { from: source.part, to: part }] })
}
function removeGraphConnection(from: 'trigger' | 'condition' | 'action', to: 'trigger' | 'condition' | 'action') {
  const rule = selectedGraphRule.value
  if (!rule) return
  const current = rule.graphConnections ?? [{ from: 'trigger' as const, to: 'condition' as const }, { from: 'condition' as const, to: 'action' as const }]
  updateLogicRule({ ...rule, graphConnections: current.filter(c => !(c.from === from && c.to === to)) })
}
function resetGraphConnections() {
  const rule = selectedGraphRule.value
  if (!rule) return
  updateLogicRule({ ...rule, graphConnections: [{ from: 'trigger', to: 'condition' }, { from: 'condition', to: 'action' }] })
}
function startNodeDrag(event: PointerEvent, ruleId: string, part: 'trigger' | 'condition' | 'action') {
  if ((event.target as HTMLElement).closest('.node-port')) return
  const node = graphNodes.value.find(n => n.rule.id === ruleId && n.part === part)
  if (!node) return
  graphSelection.value = { ruleId, part }; dragNode.value = { ruleId, part, dx: event.clientX - node.x, dy: event.clientY - node.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveNode(event: PointerEvent) {
  if (!dragNode.value || !graphViewport.value) return
  const bounds = graphViewport.value.getBoundingClientRect()
  const { ruleId, part, dx, dy } = dragNode.value
  const rule = logicRules.value.find(r => r.id === ruleId); if (!rule) return
  const current = rule.graphLayout ?? { trigger: { x: 70, y: 70 }, condition: { x: 340, y: 70 }, action: { x: 610, y: 70 } }
  const next = { ...current, [part]: { x: Math.max(8, event.clientX - bounds.left + graphViewport.value.scrollLeft - dx), y: Math.max(8, event.clientY - bounds.top + graphViewport.value.scrollTop - dy) } }
  updateLogicRule({ ...rule, graphLayout: next })
}
function endNodeDrag() { dragNode.value = null }
function nodeTitle(rule: LogicRule, part: 'trigger' | 'condition' | 'action') {
  if (part === 'trigger') return rule.trigger.type === 'object_clicked' ? 'Quando clicar no objeto' : 'Ao entrar na área'
  if (part === 'condition') return rule.conditions.length ? `Condição: ${rule.conditions.map(c => `${c.name} = ${String(c.value)}`).join(', ')}` : 'Sem condição'
  const action = rule.actions[0]; if (!action) return 'Sem ação'
  if (action.type === 'rotate') return `Girar ${action.degrees}°`
  if (action.type === 'move') return `Mover para X ${action.x ?? 0}`
  if (action.type === 'set_visible') return action.visible ? 'Mostrar objeto' : 'Ocultar objeto'
  if (action.type === 'set_variable') return `Definir ${action.name} = ${String(action.value)}`
  if (action.type === 'set_package_variable') return `Definir pacote ${action.packageId}.${action.name} = ${String(action.value)}`
  if (action.type === 'script') return `Script: ${action.code.slice(0, 30)}...`
  if (action.type === 'javascript') return `JS: ${action.code.slice(0, 30)}...`
  return 'Ação desconhecida'
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
const cameraLabel = computed(() => CAMERA_LABELS[cameraPreset.value])
const hint = 'Arraste para orbitar · Botão direito move · Roda para zoom · W mover · E rotacionar · R escalar'
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <svg class="brand-emblem" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path d="M20 3.5h8l1.2 4.1c1.2.3 2.3.8 3.4 1.4l3.8-2 5.6 5.6-2 3.8c.6 1.1 1.1 2.2 1.4 3.4l4.1 1.2v8l-4.1 1.2c-.3 1.2-.8 2.3-1.4 3.4l2 3.8-5.6 5.6-3.8-2c-1.1.6-2.2 1.1-3.4 1.4L28 45h-8l-1.2-4.1c-1.2-.3-2.3-.8-3.4-1.4l-3.8 2L6 35.9l2-3.8c-.6-1.1-1.1-2.2-1.4-3.4L2.5 27.5v-8l4.1-1.2c.3-1.2.8-2.3 1.4-3.4l-2-3.8 5.6-5.6 3.8 2c1.1-.6 2.2-1.1 3.4-1.4L20 3.5Z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>
          <circle cx="24" cy="23.5" r="12.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M24.2 12.5c.9 4.2 5.3 6.1 5.7 10.8.4 4.1-2.1 7.5-5.9 8.2-3.8-.6-6-3.4-5.8-6.9.2-3.3 2.8-5.2 3.8-7.9.7-1.7 1-3 2.2-4.2Z" stroke="#f0522a" stroke-width="2.2" stroke-linejoin="round"/>
        </svg>
        <div class="brand-copy">
          <div class="title">PROMETEU</div>
          <div class="subtitle">ENGINE <small>v0.1.0</small></div>
        </div>
      </div>

      <div class="project">
        <input v-model="projectName" class="pname" spellcheck="false" @input="markDirty" />
        <i class="dot" :class="dirty ? 'warn' : 'ok'" :title="dirty ? 'Alterações não salvas' : 'Tudo salvo'" />
      </div>
      <div class="mode-actions">
        <button type="button" :class="{ active: isEditMode }" @click="exitPlayMode">✎ Editar</button>
        <button type="button" :class="{ active: isPlayMode }" @click="enterPlayMode">▶ Jogar</button>
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
      <span class="vsep" />
      <!-- Play/Stop/Edit Mode Toggle -->
      <div class="toolbar-group runtime-controls">
        <button
          v-if="isEditMode"
          class="tool play-btn"
          @click="enterPlayMode"
          title="Iniciar modo jogo (Play)"
          aria-label="Iniciar modo jogo"
        >
          <span class="tool-ico" aria-hidden="true">▶</span><span class="tool-label">Play</span>
        </button>
        <button
          v-if="isPlayMode"
          class="tool stop-btn"
          @click="exitPlayMode"
          title="Parar modo jogo (Stop)"
          aria-label="Parar modo jogo"
        >
          <span class="tool-ico" aria-hidden="true">■</span><span class="tool-label">Stop</span>
        </button>
        <button
          v-if="isPlayMode"
          class="tool edit-btn"
          @click="exitPlayMode"
          title="Voltar à edição (Edit)"
          aria-label="Voltar à edição"
        >
          <span class="tool-ico" aria-hidden="true">⚙</span><span class="tool-label">Edit</span>
        </button>
      </div>
    </nav>

    <div class="main">
      <aside class="editor-side-rail" aria-label="Navegação principal">
        <nav class="editor-side-rail-main">
          <button class="editor-rail-item" :class="{ active: activeRailItem === 'scene' }" type="button" @click="activeRailItem = 'scene'; inspectorMode = 'environment'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg><span>Cena</span>
          </button>
          <button class="editor-rail-item" type="button" disabled title="Workspace de interface disponível na edição completa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 8h16"/></svg><span>Interface</span>
          </button>
          <button class="editor-rail-item" type="button" disabled title="Configuração avançada de jogador disponível na edição completa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="7.5" r="3.2"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"/></svg><span>Jogador</span>
          </button>
          <button class="editor-rail-item" :class="{ active: activeRailItem === 'scripts' }" type="button" @click="activeRailItem = 'scripts'; graphOpen = !graphOpen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6.5 7.5l4 8M17.5 7.5l-4 8"/></svg><span>Scripts</span>
          </button>
          <button class="editor-rail-item" type="button" disabled title="Mapeamento avançado de controles disponível na edição completa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h4M9 8v4M15.5 10h.01M18 13h.01"/></svg><span>Controles</span>
          </button>
        </nav>
        <div class="editor-side-rail-footer"><span class="editor-rail-item rail-settings" title="Configurações de visualização">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.3 1-1.5 2.6-1.6-.6a7.6 7.6 0 0 1-1.6.9l-.3 1.7h-3l-.3-1.7a7.6 7.6 0 0 1-1.6-.9l-1.6.6-1.5-2.6 1.3-1a7.5 7.5 0 0 1 0-1.8l-1.3-1 1.5-2.6 1.6.6a7.6 7.6 0 0 1 1.6-.9l.3-1.7h3l.3 1.7a7.6 7.6 0 0 1 1.6.9l1.6-.6 1.5 2.6-1.3 1a7.5 7.5 0 0 1 0 1.8Z"/></svg><span>Configurações</span>
        </span></div>
      </aside>
      <!-- Hierarquia -->
      <aside class="panel left" :style="{ width: leftPanelWidth + 'px' }">
        <div class="panel-head hierarchy-head">
          <nav class="library-tabs" aria-label="Painel lateral">
            <button class="active" type="button">Hierarquia</button>
            <button type="button" disabled>Componentes (0)</button>
          </nav>
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
        <div class="viewport-actions-bar">
          <div class="viewport-actions-left">
            <button class="viewport-primary" type="button" @click="addPrimitive('cube')"><span>＋</span> Adicionar</button>
            <button class="viewport-secondary" type="button" @click="addPrimitive('platform')">▱ Plataforma</button>
          </div>
          <div class="viewport-actions-right">
            <button class="viewport-secondary" type="button" @click="cycleCamera">◉ {{ cameraLabel }}</button>
            <button class="viewport-secondary" type="button" :class="{ active: gridVisible }" @click="toggleGrid">▦ Malha</button>
            <button class="viewport-secondary" type="button" @click="graphOpen = !graphOpen">⌘ Visual Script</button>
            <button v-if="isEditMode" class="viewport-play" type="button" @click="enterPlayMode">▶ Jogar</button>
            <button v-else class="viewport-play" type="button" @click="exitPlayMode">■ Parar</button>
          </div>
        </div>
        <nav class="viewport-tool-rail" aria-label="Ferramentas da cena">
          <button type="button" :class="{ active: tool === 'select' }" title="Selecionar (Q)" @click="setTool('select')">↖</button>
          <button type="button" :class="{ active: tool === 'build' }" title="Construir (B)" @click="setTool('build')">◇</button>
          <button type="button" :class="{ active: tool === 'terrain' }" title="Editar terreno (T)" @click="setTool('terrain')">⌁</button>
          <span></span>
          <button type="button" :class="{ active: transform === 'move' }" title="Mover (W)" @click="setTransform('move')">✣</button>
          <button type="button" :class="{ active: transform === 'rotate' }" title="Rotacionar (E)" @click="setTransform('rotate')">⟳</button>
          <button type="button" :class="{ active: transform === 'scale' }" title="Escalar (R)" @click="setTransform('scale')">⤢</button>
        </nav>
        <canvas ref="canvas" class="canvas" :class="'tool-' + tool" />
        <!-- Runtime HUD -->
        <RuntimeHUD
          :isPlayMode="isPlayMode"
          :fps="fps"
          :entityCount="hudEntityCount"
          :mountStatus="hudMountStatus"
          :mountName="hudMountName"
        />
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
      <aside class="panel right" :style="{ width: rightPanelWidth + 'px' }">
        <nav class="inspector-workspace-tabs" aria-label="Propriedades do projeto">
          <button class="active" type="button">Cena</button>
          <button type="button" disabled>Jogador</button>
          <button type="button" disabled>Céu</button>
        </nav>
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
            <label class="field">Variável has_key
              <select :value="String(logicVariables.has_key === true)" @change="toggleLogicVariable('has_key')">
                <option value="false">false</option><option value="true">true</option>
              </select>
            </label>
            <label class="field">Gatilho
              <select v-model="ruleTrigger"><option value="object_clicked">Clicar no objeto selecionado</option><option value="enter_area">Objeto entrar na área (centro 0,1,0)</option></select>
            </label>
            <label class="field">Ação
              <select v-model="ruleAction"><option value="rotate">Girar +45°</option><option value="move">Mover para X=2</option><option value="set_visible">Ocultar objeto</option><option value="set_variable">Definir has_key = true</option></select>
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

          <section>
            <h4>Objeto selecionado</h4>
            <template v-if="selected">
              <label class="field">Nome
                <input :value="selected.name" spellcheck="false" @change="onRename" />
              </label>
              <div class="grid3">
                <label class="field">X
                  <input class="mono" :value="selected.x.toFixed(2)" @change="onNumber('x', $event)" />
                </label>
                <label class="field">Y
                  <input class="mono" :value="selected.y.toFixed(2)" @change="onNumber('y', $event)" />
                </label>
                <label class="field">Z
                  <input class="mono" :value="selected.z.toFixed(2)" @change="onNumber('z', $event)" />
                </label>
              </div>
              <div class="grid2">
                <label class="field">Rotação Y (°)
                  <input class="mono" :value="selected.rotationY.toFixed(0)" @change="onNumber('rotationY', $event)" />
                </label>
                <label class="field">Escala
                  <input class="mono" :value="selected.scale.toFixed(2)" @change="onNumber('scale', $event)" />
                </label>
              </div>
              <label class="field">Cor
                <input type="color" class="color" :value="colorHex(selected.color)" @input="onColor" />
              </label>
              <button class="danger" @click="removeSelected">Excluir (Del)</button>
            </template>
            <p v-else-if="selectedId === TERRAIN_ID" class="muted">
              Terreno editável · semente <span class="mono">{{ terrain.seed }}</span> ·
              <span class="mono">{{ terrain.edits }}</span> pontos editados.
            </p>
            <p v-else class="muted">
              Selecione um objeto na hierarquia ou no mundo para ver e editar suas transformações.
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
        <aside class="graph-library"><div class="eyebrow">BIBLIOTECA</div><h3>Nós disponíveis</h3><p>Os nós representam o evento, a condição e a ação de cada regra.</p><div class="node-legend trigger">● Evento</div><div class="node-legend condition">◆ Condição</div><div class="node-legend action">▶ Ação</div><div class="graph-tip">Para conectar: clique na saída (círculo à direita) de um nó e depois na entrada (círculo à esquerda) do outro. Arraste os nós para organizar o grafo.</div><div v-if="connectionSource" class="connection-status">Selecione a entrada de destino… <button class="ghost" @click="connectionSource = null">Cancelar</button></div></aside>
        <div ref="graphViewport" class="graph-canvas" @pointermove="moveNode" @pointerup="endNodeDrag" @pointercancel="endNodeDrag">
          <div v-if="!logicRules.length" class="graph-empty"><div class="empty-icon">⌘</div><h2>Nenhum fluxo criado</h2><p>Feche esta janela e adicione uma regra no painel direito, em “Motor de regras”.</p><button class="ghost" @click="graphOpen = false">Voltar ao editor</button></div>
          <svg class="graph-wires" width="1800" height="1200" aria-hidden="true"><path v-for="edge in graphEdges" :key="edge.id" :d="`M ${edge.x1} ${edge.y1} C ${edge.x1 + 65} ${edge.y1}, ${edge.x2 - 65} ${edge.y2}, ${edge.x2} ${edge.y2}`" /></svg>
          <article v-for="node in graphNodes" :key="node.rule.id + node.part" class="graph-node" :class="[node.part, { chosen: graphSelection?.ruleId === node.rule.id && graphSelection?.part === node.part }]" :style="{ left: `${node.x}px`, top: `${node.y}px` }" @pointerdown="startNodeDrag($event, node.rule.id, node.part)" @click.stop="graphSelection = { ruleId: node.rule.id, part: node.part }"><div class="node-head"><span>{{ node.part === 'trigger' ? 'EVENTO' : node.part === 'condition' ? 'CONDIÇÃO' : 'AÇÃO' }}</span><span>{{ node.rule.enabled ? '●' : '○' }}</span></div><div class="node-title">{{ nodeTitle(node.rule, node.part) }}</div><div class="node-foot"><button class="node-port" title="Conectar entrada" aria-label="Conectar entrada" @pointerdown.stop @click.stop="selectGraphPort(node.rule.id, node.part, 'in')"></button>{{ node.rule.name }}<button class="node-port out" title="Iniciar conexão" aria-label="Iniciar conexão" @pointerdown.stop @click.stop="selectGraphPort(node.rule.id, node.part, 'out')"></button></div></article>
        </div>
        <aside class="graph-inspector"><div class="eyebrow">INSPETOR DO NÓ</div><template v-if="selectedGraphRule && graphSelection"><h3>{{ graphSelection.part === 'trigger' ? 'Evento' : graphSelection.part === 'condition' ? 'Condição' : 'Ação' }}</h3><label class="field">Nome do fluxo<input :value="selectedGraphRule.name" @change="updateLogicRule({ ...selectedGraphRule, name: ($event.target as HTMLInputElement).value })" /></label><label class="checkline"><input type="checkbox" :checked="selectedGraphRule.enabled" @change="toggleLogicRule(selectedGraphRule)" /> Fluxo habilitado</label><p class="muted">{{ nodeTitle(selectedGraphRule, graphSelection.part) }}</p><div class="inspector-actions"><button class="ghost" @click="resetGraphConnections">Restaurar conexões padrão</button><button class="ghost" @click="removeGraphConnection('trigger','condition')">Remover Evento → Condição</button><button class="ghost" @click="removeGraphConnection('condition','action')">Remover Condição → Ação</button></div><p class="graph-tip">As conexões são salvas no arquivo do projeto. A execução atual continua seguindo a ordem interna da regra: evento → condições → ações.</p><button class="danger" @click="deleteLogicRule(selectedGraphRule.id); graphSelection = null">Excluir fluxo</button></template><p v-else class="muted">Selecione um nó para ver suas propriedades.</p><div class="graph-rule-count">{{ logicRules.length }} fluxo(s) · {{ graphNodes.length }} nós</div></aside>
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
.topbar { display: flex; align-items: center; gap: 10px; padding: 12px 18px; background: var(--panel); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 12px; flex: none; }
.logo { width: 34px; height: 34px; border-radius: 8px; background: #4a2128; color: #f0897a; border: 1px solid #6b2f38; display: grid; place-items: center; font-weight: 800; }
.title { font-weight: 700; letter-spacing: 0.12em; font-size: 14px; white-space: nowrap; }
.subtitle { font-size: 10px; letter-spacing: 0.14em; color: var(--muted); margin-top: 2px; white-space: nowrap; }
.project { display: flex; align-items: center; gap: 8px; margin-left: 18px; }
.pname { width: 190px; background: transparent; border: 1px solid transparent; }
.pname:hover, .pname:focus { border-color: var(--line); background: var(--bg); }
.filebtns { display: flex; gap: 6px; flex: none; }
.filebtns .ghost { white-space: nowrap; }
.cam { display: inline-flex; align-items: center; gap: 10px; background: #3a1f24; border: 1px solid #6b2f38; color: #f3b3a8; padding: 10px 16px; border-radius: 10px; font-weight: 600; white-space: nowrap; flex: none; }
.cam:hover { background: #46262c; }
.cam-ring { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #f0897a; box-shadow: inset 0 0 0 2px #3a1f24, inset 0 0 0 6px #f0897a; }

/* barra de ferramentas */
.toolbar { display: flex; align-items: center; gap: 2px; padding: 0 10px; background: var(--panel); border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: thin; scrollbar-color: #2c3340 transparent; }
.tool { display: inline-flex; align-items: center; gap: 8px; padding: 12px 16px; border: 0; border-radius: 0; background: transparent; color: var(--text); white-space: nowrap; }
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
.vsep { width: 1px; height: 24px; background: var(--line); margin: 0 8px; flex: none; }

/* Runtime controls (Play/Stop/Edit) */
.toolbar-group.runtime-controls {
  display: flex;
  gap: 4px;
}

.tool.play-btn {
  background: linear-gradient(135deg, #4a7c4a, #3d6b3d);
  border: 1px solid #5bd08a;
  color: #fff;
}
.tool.play-btn:hover {
  background: linear-gradient(135deg, #5bd08a, #4a7c4a);
  box-shadow: 0 0 12px rgba(91, 208, 138, 0.4);
}

.tool.stop-btn {
  background: linear-gradient(135deg, #c5533f, #a4443a);
  border: 1px solid #e0566f;
  color: #fff;
}
.tool.stop-btn:hover {
  background: linear-gradient(135deg, #e0566f, #c5533f);
  box-shadow: 0 0 12px rgba(224, 86, 111, 0.4);
}

.tool.edit-btn {
  background: linear-gradient(135deg, #3a5a8c, #2d4a7a);
  border: 1px solid #6fb7f0;
  color: #fff;
}
.tool.edit-btn:hover {
  background: linear-gradient(135deg, #6fb7f0, #3a5a8c);
  box-shadow: 0 0 12px rgba(111, 183, 240, 0.4);
}

/* layout central */
.main { flex: 1; display: flex; min-height: 0; }
.panel { display: flex; flex-direction: column; background: var(--panel); min-height: 0; }
.panel.left { min-width: 150px; max-width: 500px; border-right: 1px solid var(--line); flex: none; }
.panel.right { min-width: 200px; max-width: 600px; border-left: 1px solid var(--line); flex: none; }
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
  .panel.left { max-width: 190px; }
  .panel.right { max-width: 250px; }
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
.graph-node { position:absolute; width:220px; min-height:120px; border:1px solid #3b4352; background:#1c222d; border-radius:8px; box-shadow:0 10px 24px #0004; cursor:grab; user-select:none; z-index:1; } .graph-node:active { cursor:grabbing; } .graph-node.chosen { outline:2px solid #d36a55; outline-offset:2px; } .graph-node.trigger { border-top:3px solid #d8a34a; } .graph-node.condition { border-top:3px solid #6c9de6; } .graph-node.action { border-top:3px solid #65bf91; } .node-head { display:flex; justify-content:space-between; padding:10px 12px 8px; font-size:9px; letter-spacing:.13em; color:#aab4c5; border-bottom:1px solid #303746; } .node-title { padding:13px 12px; min-height:44px; font-size:12px; line-height:1.5; } .node-foot { position:relative; display:flex; align-items:center; justify-content:center; padding:7px; border-top:1px solid #303746; color:#7f899c; font-size:10px; } .node-port { position:absolute; left:-7px; top:50%; width:13px; height:13px; border-radius:50%; background:#8a96ad; border:2px solid #1c222d; padding:0; cursor:crosshair; z-index:3; } .node-port:hover { background:#d36a55; transform:scale(1.15); } .node-port.out { left:auto; right:-7px; } .connection-status { margin-top:16px; padding:10px; background:#252d3a; border-radius:6px; font-size:11px; line-height:1.5; } .inspector-actions { display:flex; flex-direction:column; gap:7px; margin:14px 0; } .inspector-actions button { text-align:left; font-size:11px; } .graph-empty { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; width:min(360px,90%); } .graph-empty h2 { font-size:18px; } .graph-empty p { color:#8e98aa; font-size:12px; line-height:1.6; } .empty-icon { font-size:32px; color:#d36a55; } .graph-rule-count { border-top:1px solid #2a303d; margin-top:24px; padding-top:12px; font-size:11px; color:#8e98aa; }
@media(max-width:800px) { .graph-body { grid-template-columns:150px minmax(0,1fr); } .graph-inspector { display:none; } .graph-subtitle { display:none; } }


/* Layout visual alinhado à referência Prometeu enviada pelo usuário. */
:root{--bg:#101114;--panel:#16171b;--panel-2:#1d1e22;--line:#2a2c32;--text:#ececef;--muted:#a0a1a8;--accent:#f0522a;--accent-dark:#382017;--rail-width:88px;--left-width:288px;--right-width:342px}
html,body,#app{width:100%;height:100%;margin:0;overflow:hidden}body{background:var(--bg);font-family:Inter,'Segoe UI',system-ui,sans-serif;font-size:13px;color:var(--text)}
.app{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--bg);color:var(--text)}
.topbar{z-index:60;display:flex;align-items:center;flex:0 0 64px;height:64px;min-height:64px;gap:12px;padding:0 18px;border-bottom:1px solid var(--line);background:#111215;color:var(--text)}
.brand{display:flex;align-items:center;gap:12px;flex:none;min-width:220px}.brand-emblem{width:44px;height:44px;flex:none;color:#e9e9eb}.brand-copy{display:flex;flex-direction:column;gap:3px;line-height:1}.brand-copy .title{font-size:15px;font-weight:650;letter-spacing:.27em;color:#f2f2f4}.brand-copy .subtitle{font-size:9px;font-weight:750;letter-spacing:.48em;color:var(--accent)}.brand-copy small{margin-left:5px;color:#92939a;font:600 9px/1 'IBM Plex Mono',monospace;letter-spacing:.04em}
.project{margin-left:4px;padding-left:14px;border-left:1px solid var(--line);min-width:0}.pname{width:150px;max-width:16vw;color:#dedee2;font-size:12px}.pname:hover,.pname:focus{border-color:#3a3b42;background:#1b1c20}.filebtns{display:flex;align-items:center;gap:7px;flex:none}.filebtns .ghost{min-height:38px;padding:0 13px;border:1px solid #303137;border-radius:9px;background:#1b1c20;color:#e9e9ec;font-size:12px}.filebtns .ghost:hover{border-color:#56575d;background:#25262b}.mode-actions{display:flex;align-items:center;gap:8px;margin-left:auto;margin-right:auto}.mode-actions button{height:40px;min-width:118px;padding:0 17px;border:1px solid #303137;border-radius:10px;background:#1b1c20;color:#e8e8eb;font-weight:600}.mode-actions button.active{border-color:var(--accent);background:var(--accent);color:#111}.cam{height:38px;padding:0 14px;border:1px solid #65311f;border-radius:9px;background:#2e1c17;color:#ff8863;font-size:12px}
.main{display:flex;flex:1 1 auto;min-height:0;overflow:hidden;background:var(--bg)}
.editor-side-rail{display:flex;flex:0 0 var(--rail-width);flex-direction:column;align-items:stretch;width:var(--rail-width);min-width:var(--rail-width);height:100%;padding:14px 9px 10px;border-right:1px solid var(--line);background:#111215}.editor-side-rail-main,.editor-side-rail-footer{display:flex;flex-direction:column;gap:8px}.editor-side-rail-footer{margin-top:auto}.editor-rail-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;width:100%;min-height:70px;padding:8px 2px;border:1px solid transparent;border-radius:11px;background:transparent;color:#a4a5ac;font:500 11px/1.2 Inter,'Segoe UI',sans-serif}.editor-rail-item svg{width:24px;height:24px;flex:none}.editor-rail-item.active{border-color:#522719;background:#321b14;color:var(--accent);font-weight:650}.editor-rail-item:disabled{opacity:.7;cursor:not-allowed}.rail-settings{cursor:default}
.panel{min-height:0;background:var(--panel);color:var(--text)}.panel.left{display:flex;flex:0 0 var(--left-width);flex-direction:column;width:var(--left-width)!important;min-width:var(--left-width);border-right:1px solid var(--line)}.hierarchy-head{position:relative;display:flex;flex:0 0 52px;align-items:stretch;justify-content:stretch;min-height:52px;padding:0 8px;border-bottom:1px solid var(--line);background:#141518}.hierarchy-head .badge{position:absolute;right:10px;top:50%;transform:translateY(-50%)}.library-tabs{display:grid;grid-template-columns:1fr 1fr;width:100%;height:52px}.library-tabs button{min-width:0;padding:0 10px;border:0;border-bottom:2px solid transparent;background:transparent;color:#a5a6ad;font-size:13px}.library-tabs button.active{border-bottom-color:var(--accent);color:#f1f1f3}.library-tabs button:disabled{opacity:1;color:#9a9ba2}.panel.left .tree{flex:1;overflow:auto;padding:10px 10px}.panel.left .row{min-height:35px;padding:5px 10px;border-radius:7px;color:#d6d6da;font-size:13px}.panel.left .row.root{background:#2c1b16;color:#f3eeee}.panel.left .row.active{background:#332018;box-shadow:inset 3px 0 var(--accent);color:#fff}.panel.left .row.child{padding-left:26px}.panel.left .panel-foot{height:52px;border-top:1px solid var(--line);background:#151619;color:#9ea0a8}
.panel.right{display:flex;flex:0 0 var(--right-width);flex-direction:column;width:var(--right-width)!important;min-width:var(--right-width);border-left:1px solid var(--line);background:#16171b}.inspector-workspace-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));flex:0 0 52px;height:52px;border-bottom:1px solid var(--line);background:#141518}.inspector-workspace-tabs button{min-width:0;height:52px;padding:0 8px;border:0;border-bottom:2px solid transparent;background:transparent;color:#a5a6ad;font:500 13px Inter,'Segoe UI',sans-serif}.inspector-workspace-tabs button.active{border-bottom-color:var(--accent);color:#f3f3f5;font-weight:650}.inspector-workspace-tabs button:disabled{opacity:1;color:#9a9ba2}.panel.right .panel-head{padding:14px 16px;border-bottom:1px solid var(--line);background:#16171b}.panel.right .panel-head .h{font-size:15px;color:#f1f1f3}.panel.right .panel-head .eyebrow{display:none}.panel.right .scroll{flex:1;min-height:0;overflow:auto}.panel.right .scroll section{padding:15px 17px;border-bottom:1px solid var(--line)}.panel.right .scroll h4{color:#eeeef0;font-size:14px}.panel.right .scroll .muted{color:#a1a2aa;line-height:1.5}.panel.right .scroll dt{color:#aaabb2}.panel.right .scroll dd{color:#e7e7e9}.panel.right .scroll input:not([type=checkbox]):not([type=range]),.panel.right .scroll select,.panel.right .scroll textarea{min-height:38px;padding:0 10px;border:1px solid #303137;border-radius:9px;background:#1d1e22;color:#ededf0;font:12px Inter,'Segoe UI',sans-serif}.panel.right .scroll input:focus,.panel.right .scroll select:focus,.panel.right .scroll textarea:focus{border-color:var(--accent);outline:1px solid var(--accent)}.panel.right .scroll input[type=range],.panel.right .scroll input[type=checkbox]{accent-color:var(--accent)}.panel.right .scroll button{border-radius:8px}.panel.right .scroll .ghost{border-color:#34353b;background:#1d1e22;color:#e5e5e8}.panel.right .panel-foot{height:35px;padding:0 16px;border-top:1px solid var(--line);background:#141518;color:#9ea0a8}
/* Barra superior da viewport: fica apenas sobre a área central, sem invadir os painéis. */
.toolbar{display:none!important}.viewport{position:relative;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden;background:#171f32}.canvas{position:absolute!important;top:56px!important;right:0!important;bottom:34px!important;left:0!important;width:100%!important;height:calc(100% - 90px)!important;outline:none}.viewport-actions-bar{position:absolute;z-index:20;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:12px;height:56px;padding:0 14px 0 16px;border-bottom:1px solid #2c3038;background:#141518}.viewport-actions-left,.viewport-actions-right{display:flex;align-items:center;gap:8px;min-width:0}.viewport-actions-bar button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 13px;border:1px solid #303137;border-radius:10px;background:#1b1c20;color:#e9e9ec;font-size:12px;white-space:nowrap}.viewport-actions-bar .viewport-primary{border-color:var(--accent);background:var(--accent);color:#111;font-weight:700}.viewport-primary span{font-size:19px;line-height:1}.viewport-actions-bar button.active{border-color:#6e3827;background:#2e1d17;color:#ff845a}.viewport-actions-bar .viewport-play{border-color:#65311f;background:#2e1c17;color:#ff8863}.viewport-tool-rail{position:absolute;z-index:20;top:72px;left:16px;display:flex;flex-direction:column;align-items:stretch;gap:5px;width:58px;padding:5px;border:1px solid #303137;border-radius:12px;background:rgba(17,18,21,.96);box-shadow:0 8px 24px #0006}.viewport-tool-rail button{display:grid;place-items:center;width:46px;height:46px;padding:0;border:1px solid transparent;border-radius:9px;background:transparent;color:#d7d7db;font-size:21px}.viewport-tool-rail button.active{border-color:#873d26;background:#351e16;color:#ff7048}.viewport-tool-rail button:hover{background:#27282d;color:#fff}.viewport-tool-rail span{height:1px;margin:3px 1px;background:#303137}
.chips{top:66px!important;left:88px!important}.axes{left:16px!important;bottom:48px!important}.axis{border-color:#303137!important;border-radius:8px!important;background:#111215e8!important}.statusbar{position:fixed!important;z-index:80;left:0;right:0;bottom:0;display:flex;align-items:center;height:34px;min-height:34px;padding:0 10px;border-top:1px solid var(--line);background:#111215f5;color:#c0c1c7}.statusbar .seg{height:33px;padding:0 10px;border-right:1px solid #24262b;font-size:11px}.statusbar .seg.grow-text{border-right:0}
.panel.left .panel-head .eyebrow,.panel.left .panel-head .h{display:none}.badge{color:#c6c7cd}.dot.ok{background:#35d06b}.dot.warn{background:var(--accent)}
@media(max-width:1180px){:root{--rail-width:76px;--left-width:248px;--right-width:300px}.brand{min-width:170px}.project{display:none}.mode-actions button{min-width:100px}.viewport-actions-bar button{padding-inline:9px;font-size:11px}}
@media(max-width:900px){:root{--rail-width:64px;--left-width:210px;--right-width:270px}.editor-side-rail{padding-inline:6px}.editor-rail-item{min-height:58px;font-size:9px}.editor-rail-item svg{width:21px;height:21px}.brand-copy{display:none}.mode-actions button{min-width:80px}.viewport-actions-right button:nth-child(3){display:none}}
@media(max-width:760px){:root{--rail-width:56px;--left-width:clamp(138px,26vw,178px);--right-width:clamp(142px,26vw,180px)}.topbar{gap:6px;padding:0 8px}.brand{min-width:44px}.project{display:none}.filebtns .hide-narrow{display:none}.mode-actions{gap:4px}.mode-actions button{min-width:60px;height:34px;padding:0 7px;font-size:10px}.cam{max-width:92px;overflow:hidden;padding:0 6px;font-size:10px}.editor-side-rail{padding:8px 4px}.editor-rail-item{min-height:48px;font-size:0}.editor-rail-item svg{width:22px;height:22px}.viewport-actions-bar{padding-inline:7px}.viewport-actions-right{gap:4px}.viewport-actions-bar button{min-height:34px;padding:0 7px;font-size:10px}.viewport-actions-right button:nth-child(3){display:none}.viewport-tool-rail{left:7px;top:64px;width:46px;padding:4px}.viewport-tool-rail button{width:36px;height:38px;font-size:18px}.panel.left .row,.panel.left .row .name{font-size:10px}.panel.right .scroll{font-size:10px}.inspector-workspace-tabs button{font-size:10px}}

/* Keep the viewport action groups clear on compact desktop widths. */
@media(max-width:1450px){
  .viewport-actions-bar{gap:6px;padding-inline:8px}
  .viewport-actions-left,.viewport-actions-right{gap:5px}
  .viewport-actions-right button:nth-child(1),
  .viewport-actions-right button:nth-child(3){display:none}
  .viewport-actions-bar button{padding-inline:9px}
}
</style>
