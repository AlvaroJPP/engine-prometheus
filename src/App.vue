<script setup lang="ts">
import { computed, ref } from 'vue'
import { ENGINE_VERSION, TERRAIN_ID } from '@engine'
import type { ToolMode, TransformMode } from '@engine'
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
  toggleLogicVariable, addLogicRule, toggleLogicRule, deleteLogicRule,
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
