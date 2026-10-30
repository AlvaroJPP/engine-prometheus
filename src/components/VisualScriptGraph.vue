<script setup lang="ts">
import { computed } from 'vue'
import type { LogicRule, ObjectInfo } from '@engine'
const props = defineProps<{ context: Record<string, any> }>()
const ctx = props.context

// Safe accessors for refs that may not unwrap properly through the reactive proxy
const objects = computed(() => (ctx.objects?.value ?? ctx.objects ?? []) as ObjectInfo[])
const logicRules = computed(() => (ctx.logicRules?.value ?? ctx.logicRules ?? []) as LogicRule[])
const logicVariables = computed(() => (ctx.logicVariables?.value ?? ctx.logicVariables ?? {}) as Record<string, boolean | number | string>)
const globalConditionVariables = computed(() => (ctx.globalConditionVariables?.value ?? ctx.globalConditionVariables ?? {}) as Record<string, boolean | number | string>)
const graphGlobalRules = computed(() => (ctx.graphGlobalRules?.value ?? ctx.graphGlobalRules ?? []) as LogicRule[])
const graphVisibleRules = computed(() => (ctx.graphVisibleRules?.value ?? ctx.graphVisibleRules ?? []) as LogicRule[])
const graphObjectGroups = computed(() => (ctx.graphObjectGroups?.value ?? ctx.graphObjectGroups ?? []) as Array<{ object: ObjectInfo; rules: LogicRule[]; top: number; height: number }>)
const graphNodes = computed(() => (ctx.graphNodes?.value ?? ctx.graphNodes ?? []) as Array<{ rule: LogicRule; part: string; x: number; y: number }>)
const graphEdges = computed(() => (ctx.graphEdges?.value ?? ctx.graphEdges ?? []) as Array<{ id: string; kind: string; d: string }>)
const graphGlobalGroupHeight = computed(() => (ctx.graphGlobalGroupHeight?.value ?? ctx.graphGlobalGroupHeight ?? 0) as number)
const graphObjectFilter = computed(() => (ctx.graphObjectFilter?.value ?? ctx.graphObjectFilter ?? 'all') as 'all' | 'selected')
const graphObjectSearch = computed(() => (ctx.graphObjectSearch?.value ?? ctx.graphObjectSearch ?? '') as string)
const graphSelection = computed(() => (ctx.graphSelection?.value ?? ctx.graphSelection ?? null))
const graphPan = computed(() => (ctx.graphPan?.value ?? ctx.graphPan ?? { x: 0, y: 0 }))
const graphZoom = computed(() => (ctx.graphZoom?.value ?? ctx.graphZoom ?? 1))
const graphOpen = computed(() => (ctx.graphOpen?.value ?? ctx.graphOpen ?? false))
const selectedId = computed(() => (ctx.selectedId?.value ?? ctx.selectedId ?? null) as string | null)
const dragCanvas = computed(() => (ctx.dragCanvas?.value ?? ctx.dragCanvas ?? null))
const selectedGraphRule = computed(() => (ctx.selectedGraphRule?.value ?? ctx.selectedGraphRule ?? null) as LogicRule | null)
const selectedGraphRulePackages = computed(() => (ctx.selectedGraphRulePackages?.value ?? ctx.selectedGraphRulePackages ?? []) as Array<{ id: string; packageId: string; ownerObjectId: string }>)
const selectedGraphRuleActionVariables = computed(() => (ctx.selectedGraphRuleActionVariables?.value ?? ctx.selectedGraphRuleActionVariables ?? []) as Array<{ name: string; label: string }>)

function setExternalRef(name: string, element: unknown): void {
  const externalRef = ctx[name]
  if (externalRef && typeof externalRef === 'object' && 'value' in externalRef) externalRef.value = element
}

function createGlobalEvent(): void {
  const created = ctx.addGlobalLogicEvent?.()
  const ruleId = created && typeof created.ruleId === 'string' ? created.ruleId : ''
  if (!ruleId) return
  ctx.graphObjectFilter = 'all'
  ctx.graphSelection = { ruleId, part: 'trigger' }
  ctx.resetGraphView()
}
</script>

<template>
<div v-if="graphOpen" class="graph-overlay">
      <header class="graph-top"><div class="graph-title-group"><strong>VISUAL SCRIPT</strong><span class="graph-subtitle">Diagrama por objeto · Evento → Condição → Ação</span><label class="graph-object-filter">Mostrar <select v-model="graphObjectFilter" @change="ctx.resetGraphView"><option value="all">Todos os objetos</option><option value="selected">Objeto selecionado</option></select></label></div><div class="graph-actions"><button class="ghost" @click="ctx.addLogicRule()">+ Criar fluxo</button><button class="ghost" title="Criar fluxo global acionado por HUD e outros sistemas" @click="createGlobalEvent">＋ Evento global</button><button class="primary" @click="ctx.saveProject(false)">Salvar projeto</button><button class="ghost" @click="ctx.graphOpen = false">Voltar ao mundo ✕</button></div></header>
      <div class="graph-body">
        <aside class="graph-library property-source">
          <div class="graph-object-heading">
            <div><div class="eyebrow">HIERARQUIA DA CENA</div><h3>Objetos</h3></div>
            <span class="graph-object-total">{{ objects.length }}</span>
          </div>
          <label class="graph-object-search">
            <span aria-hidden="true">⌕</span>
            <input v-model="graphObjectSearch" type="search" placeholder="Buscar objeto..." aria-label="Buscar objeto na cena" />
            <button v-if="graphObjectSearch" type="button" title="Limpar busca" @click="ctx.graphObjectSearch = ''">×</button>
          </label>
          <div class="graph-object-picker">
            <div class="graph-object-section-label"><span>NA CENA</span><span>{{ objects.filter((object: ObjectInfo) => object.name.toLowerCase().includes(graphObjectSearch.trim().toLowerCase())).length }} itens</span></div>
            <button v-for="object in objects.filter((object: ObjectInfo) => object.name.toLowerCase().includes(graphObjectSearch.trim().toLowerCase()))" :key="object.id" class="graph-object-picker-row" :class="{ active: selectedId === object.id }" :title="object.name" @click="ctx.selectItem(object.id)">
              <span class="object-picker-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 21 7.4 12 12 3 7.4 12 2.8Z"/><path d="M3 7.4v9.2l9 4.6 9-4.6V7.4M12 12v9.2"/></svg></span>
              <span class="object-picker-copy"><span class="object-picker-name">{{ object.name }}</span><span class="object-picker-type">{{ object.type === 'cube' ? 'Cubo · GameObject' : 'Plataforma · GameObject' }}</span></span>
              <span class="object-picker-count" :title="logicRules.filter((rule: LogicRule) => ctx.ownerOfRule(rule) === object.id).length + ' eventos'"><span class="object-count-dot"></span>{{ logicRules.filter((rule: LogicRule) => ctx.ownerOfRule(rule) === object.id).length }}</span>
            </button>
            <div v-if="!objects.length" class="graph-object-empty"><span>◇</span><strong>Nenhum objeto criado</strong><small>Adicione um objeto à cena para começar.</small></div>
            <div v-else-if="!objects.some((object: ObjectInfo) => object.name.toLowerCase().includes(graphObjectSearch.trim().toLowerCase()))" class="graph-object-empty"><strong>Nenhum resultado</strong><small>Tente buscar por outro nome.</small></div>
          </div>
          <div class="graph-tip"><strong>Dica</strong><span>Selecione um objeto para focar sua edição. Todos os fluxos continuam visíveis no modo global.</span></div>
        </aside>
        <div :ref="element => setExternalRef('graphViewport', element)" class="graph-canvas" :class="['cursor-visual-script', { 'is-panning': dragCanvas }]" @pointerdown="ctx.startGraphPan" @pointermove="ctx.moveNode" @pointerup="ctx.endNodeDrag" @pointercancel="ctx.endNodeDrag" @wheel.prevent="ctx.onGraphWheel">
          <div class="graph-zoom-controls" @pointerdown.stop>
            <button title="Aproximar" aria-label="Aproximar" @click="ctx.zoomGraph(0.15)">＋</button>
            <span>{{ Math.round(graphZoom * 100) }}%</span>
            <button title="Afastar" aria-label="Afastar" @click="ctx.zoomGraph(-0.15)">−</button>
            <button title="Restaurar visualização inicial" aria-label="Restaurar visualização inicial" @click="ctx.resetGraphView">⌂</button>
          </div>
          <div :ref="element => setExternalRef('graphStage', element)" class="graph-stage" :style="{ transform: `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphZoom})` }">
            <div v-if="!graphVisibleRules.length" class="graph-empty"><div class="empty-icon">⌘</div><h2>Nenhum fluxo criado</h2><p v-if="graphObjectFilter === 'selected' && ctx.selected">Este objeto ainda não tem eventos associados. Crie uma regra ou escolha “Todos os objetos”.</p><p v-else>Adicione uma regra no painel direito, em “Motor de regras”.</p><button class="ghost" @click="ctx.graphOpen = false">Voltar ao editor</button></div>
            <svg class="graph-wires" width="1800" height="6000" aria-hidden="true"><path v-for="edge in graphEdges" :key="edge.id" :class="edge.kind" :d="edge.d" /></svg>
            <template v-if="graphObjectFilter === 'all'">
              <section
                v-if="graphGlobalRules.length"
                class="graph-object-group graph-global-group"
                :style="{ left: '12px', top: '35px', height: graphGlobalGroupHeight + 'px' }"
              >
                <header class="graph-object-group-head">
                  <span class="object-group-icon">⌘</span>
                  <strong>Eventos globais · HUD / interface</strong>
                  <span class="object-group-count">{{ graphGlobalRules.length }} evento(s)</span>
                </header>
                <article class="graph-node trigger-list" :style="{ left: '18px', top: '43px' }">
                  <div class="node-head"><span>EVENTOS GLOBAIS</span><span>{{ graphGlobalRules.length }}</span></div>
                  <button
                    v-for="rule in graphGlobalRules"
                    :key="rule.id"
                    class="event-list-row"
                    :class="{ chosen: graphSelection?.ruleId === rule.id && graphSelection?.part === 'trigger', disabled: !rule.enabled }"
                    @pointerdown.stop
                    @click.stop="ctx.graphSelection = { ruleId: rule.id, part: 'trigger' }"
                  >
                    <span class="event-row-icon">↗</span>
                    <span class="event-row-copy"><strong>{{ ctx.nodeTitle(rule, 'trigger') }}</strong><small>{{ rule.name }}</small></span>
                    <span class="event-row-port" :data-port-key="`event:${rule.id}`"></span>
                  </button>
                </article>
              </section>
              <section v-for="group in graphObjectGroups" :key="group.object.id" class="graph-object-group" :style="{ left: '12px', top: `${group.top}px`, height: `${group.height}px` }">
                <header class="graph-object-group-head">
                  <span class="object-group-icon">◇</span>
                  <strong>{{ group.object.name }}</strong>
                  <span class="object-group-count">{{ group.rules.length }} evento(s)</span>
                </header>
                <article class="graph-node trigger-list" :style="{ left: '18px', top: '43px' }">
                  <div class="node-head"><span>EVENTOS / GATILHOS</span><span>{{ group.rules.length }}</span></div>
                  <button v-for="rule in group.rules" :key="rule.id" class="event-list-row" :class="{ chosen: graphSelection?.ruleId === rule.id && graphSelection?.part === 'trigger', disabled: !rule.enabled }" @pointerdown.stop @click.stop="ctx.graphSelection = { ruleId: rule.id, part: 'trigger' }">
                    <span class="event-row-icon">↖</span><span class="event-row-copy"><strong>{{ ctx.nodeTitle(rule, 'trigger') }}</strong><small>{{ rule.name }}</small></span><span class="event-row-port" :data-port-key="`event:${rule.id}`"></span>
                  </button>
                  <div v-if="!group.rules.length" class="event-list-empty">Nenhum evento neste objeto</div>
                </article>
              </section>
            </template>
            <article v-else class="graph-node trigger-list" :style="{ left: '30px', top: '50px' }">
              <div class="node-head"><span>EVENTOS / GATILHOS</span><span>{{ graphVisibleRules.length }}</span></div>
              <button v-for="rule in graphVisibleRules" :key="rule.id" class="event-list-row" :class="{ chosen: graphSelection?.ruleId === rule.id && graphSelection?.part === 'trigger', disabled: !rule.enabled }" @pointerdown.stop @click.stop="ctx.graphSelection = { ruleId: rule.id, part: 'trigger' }">
                <span class="event-row-icon">↖</span><span class="event-row-copy"><strong>{{ ctx.nodeTitle(rule, 'trigger') }}</strong><small>{{ rule.name }}</small></span><span class="event-row-port" :data-port-key="`event:${rule.id}`"></span>
              </button>
              <div v-if="!ctx.graphVisibleRules.length" class="event-list-empty">Nenhum evento criado</div>
            </article>
            <article v-for="node in graphNodes" :key="node.rule.id + node.part" class="graph-node" :class="[node.part, { chosen: graphSelection?.ruleId === node.rule.id && graphSelection?.part === node.part }]" :style="{ left: `${node.x}px`, top: `${node.y}px` }" @pointerdown.stop="ctx.startNodeDrag($event, node.rule.id, node.part)" @click.stop="ctx.graphSelection = { ruleId: node.rule.id, part: node.part }"><div class="node-head"><span>{{ node.part === 'condition' ? 'CONDIÇÃO' : 'AÇÃO' }}</span><span>{{ node.rule.enabled ? '●' : '○' }}</span></div><div class="node-title">{{ ctx.nodeTitle(node.rule, node.part) }}</div><div class="node-foot"><span class="node-port" :data-port-key="`${node.part}-in:${node.rule.id}`"></span>{{ node.rule.name }}<span class="node-port out" :data-port-key="`${node.part}-out:${node.rule.id}`"></span></div></article>
          </div>
        </div>
        <aside class="graph-inspector">
          <div class="eyebrow">INSPECTOR</div>
          <template v-if="selectedGraphRule && graphSelection">
            <h3>{{ graphSelection.part === 'trigger' ? 'Evento' : graphSelection.part === 'condition' ? 'Condição' : 'Ação' }}</h3>
            <label class="field">Nome do fluxo
              <input :value="selectedGraphRule.name" spellcheck="false" @change="ctx.updateLogicRule({ ...selectedGraphRule, name: ($event.target as HTMLInputElement).value })" />
            </label>
            <label class="checkline"><input type="checkbox" :checked="selectedGraphRule.enabled" @change="ctx.toggleLogicRule(selectedGraphRule)" /> Fluxo habilitado</label>
            <template v-if="graphSelection.part === 'trigger'">
              <label class="field">Tipo de evento
                <select :value="selectedGraphRule.trigger.type" @change="ctx.setSelectedTriggerType(($event.target as HTMLSelectElement).value as 'object_clicked' | 'enter_area' | 'key_pressed' | 'package_event' | 'global_event')">
                  <option value="object_clicked">Ao clicar no objeto</option>
                  <option value="enter_area">Ao entrar em uma área</option>
                  <option value="key_pressed">Ao pressionar uma tecla</option>
                  <option value="package_event">Evento de pacote</option>
                  <option value="global_event">Evento global · HUD / interface</option>
                </select>
              </label>
              <template v-if="selectedGraphRule.trigger.type === 'key_pressed'">
                <label class="field">Tecla (código)
                  <input :value="selectedGraphRule.trigger.key" @change="ctx.patchSelectedTrigger({ key: ($event.target as HTMLInputElement).value })" placeholder="KeyE" />
                </label>
              </template>
              <template v-if="selectedGraphRule.trigger.type === 'global_event'">
                <label class="field">Identificador do evento global
                  <input :value="selectedGraphRule.trigger.eventId" maxlength="100" @change="ctx.patchSelectedTrigger({ eventId: ($event.target as HTMLInputElement).value.trim() })" placeholder="hud.inventory.open" />
                </label>
                <p class="component-note">Use o mesmo identificador configurado em um botão do Workspace de UI. Clicar no botão executa este fluxo.</p>
              </template>
              <template v-if="selectedGraphRule.trigger.type === 'object_clicked'">
                <label class="field">Objeto-alvo
                  <select :value="selectedGraphRule.trigger.objectId" @change="ctx.patchSelectedTrigger({ objectId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="obj in objects" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                  </select>
                </label>
              </template>
              <template v-if="selectedGraphRule.trigger.type === 'package_event'">
                <label class="field">Pacote
                  <select :value="selectedGraphRule.trigger.packageId" @change="ctx.changeGraphRulePackage(($event.target as HTMLSelectElement).value)">
                    <option v-for="instance in selectedGraphRulePackages" :key="instance.id" :value="instance.packageId">{{ ctx.getBehaviorPackageDefinition(instance.packageId)?.name ?? instance.packageId }}</option>
                  </select>
                </label>
                <label class="field">Gatilho do pacote
                  <select :value="selectedGraphRule.trigger.eventId" @change="ctx.patchSelectedTrigger({ eventId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="trigger in ctx.getBehaviorPackageDefinition(selectedGraphRule.trigger.packageId)?.triggers ?? []" :key="trigger.id" :value="trigger.id">{{ trigger.label }}</option>
                  </select>
                </label>
                <p v-if="!selectedGraphRulePackages.length" class="component-note">Instale um pacote neste objeto antes de usar este gatilho.</p>
              </template>
              <template v-if="selectedGraphRule.trigger.type === 'enter_area'">
                <div class="component-caption">CENTRO DA ÁREA</div>
                <div class="grid3">
                  <label class="field">X<input type="number" :value="selectedGraphRule.trigger.center[0]" @change="ctx.patchSelectedTrigger({ center: [Number(($event.target as HTMLInputElement).value), selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[1] : 1, selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[2] : 0] })" /></label>
                  <label class="field">Y<input type="number" :value="selectedGraphRule.trigger.center[1]" @change="ctx.patchSelectedTrigger({ center: [selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[0] : 0, Number(($event.target as HTMLInputElement).value), selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[2] : 0] })" /></label>
                  <label class="field">Z<input type="number" :value="selectedGraphRule.trigger.center[2]" @change="ctx.patchSelectedTrigger({ center: [selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[0] : 0, selectedGraphRule.trigger.type === 'enter_area' ? selectedGraphRule.trigger.center[1] : 1, Number(($event.target as HTMLInputElement).value)] })" /></label>
                </div>
                <label class="field">Raio da área
                  <input type="number" min="0.1" step="0.1" :value="selectedGraphRule.trigger.radius" @change="ctx.patchSelectedTrigger({ radius: Math.max(0.1, Number(($event.target as HTMLInputElement).value)) })" />
                </label>
              </template>
            </template>
            <template v-else-if="graphSelection.part === 'condition'">
              <label class="checkline"><input type="checkbox" :checked="selectedGraphRule.conditions.length > 0" @change="ctx.updateLogicRule({ ...selectedGraphRule, conditions: ($event.target as HTMLInputElement).checked ? [{ type: 'variable', name: 'has_key', operator: 'equals', value: true }] : [] })" /> Exigir condição</label>
              <template v-if="selectedGraphRule.conditions.length">
                <label class="field">Variável exigida
                  <select :value="selectedGraphRule.conditions[0]?.name ?? ''" @change="ctx.patchSelectedCondition({ name: ($event.target as HTMLSelectElement).value })">
                    <option value="" disabled>Selecione uma variável</option>
                    <option v-for="(value, name) in logicVariables" :key="'local-' + name" :value="name">{{ name }} · objeto = {{ String(value) }}</option>
                    <option v-for="(value, name) in globalConditionVariables" :key="'global-' + name" :value="name">{{ name }} · global = {{ String(value) }}</option>
                  </select>
                </label>
                <label class="field">Comparação
                  <select :value="selectedGraphRule.conditions[0]?.operator ?? 'equals'" @change="ctx.patchSelectedCondition({ operator: ($event.target as HTMLSelectElement).value })">
                    <option value="equals">É igual a</option><option value="not_equals">É diferente de</option><option value="greater_than">Maior que</option><option value="less_than">Menor que</option>
                  </select>
                </label>
                <label class="field">Valor
                  <input :value="String(selectedGraphRule.conditions[0]?.value ?? true)" @change="ctx.patchSelectedCondition({ value: ctx.ruleValueFromInput(($event.target as HTMLInputElement).value) })" />
                </label>
                <p class="muted">Use true/false para booleanos ou um número para comparações numéricas.</p>
              </template>
              <p v-else class="muted">Sem condição: o evento executa sempre que for disparado.</p>
            </template>
            <template v-else>
              <label class="field">Tipo de ação
                <select :value="selectedGraphRule.actions[0]?.type ?? 'rotate'" @change="ctx.setSelectedActionType(($event.target as HTMLSelectElement).value as 'move' | 'rotate' | 'set_visible' | 'set_variable' | 'set_package_variable' | 'script' | 'javascript')">
                  <option value="move">Mover elemento</option><option value="rotate">Rotacionar elemento</option><option value="set_visible">Visibilidade</option><option value="set_variable">Definir variável</option><option value="set_package_variable">Definir variável de pacote</option><option value="script">Script Prometheus (comandos)</option><option value="javascript">JavaScript livre</option>
                </select>
              </label>
              <template v-if="selectedGraphRule.actions[0] && 'objectId' in selectedGraphRule.actions[0]">
                <label class="field">Objeto afetado
                  <select :value="selectedGraphRule.actions[0].objectId" @change="ctx.patchSelectedAction({ objectId: ($event.target as HTMLSelectElement).value })">
                    <option v-for="obj in objects" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                  </select>
                </label>
              </template>
              <div v-if="selectedGraphRule.actions[0]?.type === 'move'" class="component-box">
                <div class="component-caption">POSIÇÃO DE DESTINO</div>
                <div class="grid3">
                  <label class="field">X<input type="number" step="0.1" :value="selectedGraphRule.actions[0].x ?? 0" @change="ctx.patchSelectedAction({ x: Number(($event.target as HTMLInputElement).value) })" /></label>
                  <label class="field">Y<input type="number" step="0.1" :value="selectedGraphRule.actions[0].y ?? 0" @change="ctx.patchSelectedAction({ y: Number(($event.target as HTMLInputElement).value) })" /></label>
                  <label class="field">Z<input type="number" step="0.1" :value="selectedGraphRule.actions[0].z ?? 0" @change="ctx.patchSelectedAction({ z: Number(($event.target as HTMLInputElement).value) })" /></label>
                </div>
              </div>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'set_package_variable'">
                <label class="field">Pacote alvo
                  <select :value="selectedGraphRule.actions[0].packageId" @change="ctx.changeGraphRuleActionPackage(($event.target as HTMLSelectElement).value)">
                    <option v-for="instance in selectedGraphRulePackages" :key="instance.id" :value="instance.packageId">{{ ctx.getBehaviorPackageDefinition(instance.packageId)?.name ?? instance.packageId }}</option>
                  </select>
                </label>
                <label class="field">Variável do pacote
                  <select :value="selectedGraphRule.actions[0].name" @change="ctx.patchSelectedAction({ name: ($event.target as HTMLSelectElement).value })">
                    <option v-for="variable in selectedGraphRuleActionVariables" :key="variable.name" :value="variable.name">{{ variable.label }} ({{ variable.name }})</option>
                  </select>
                </label>
                <label class="field">Novo valor
                  <input :value="String(selectedGraphRule.actions[0].value)" @change="ctx.patchSelectedAction({ value: ctx.ruleValueFromInput(($event.target as HTMLInputElement).value) })" />
                </label>
              </template>
              <label v-else-if="selectedGraphRule.actions[0]?.type === 'rotate'" class="field">Ângulo (graus)
                <input type="number" step="1" :value="selectedGraphRule.actions[0].degrees" @change="ctx.patchSelectedAction({ degrees: Number(($event.target as HTMLInputElement).value) })" />
              </label>
              <label v-else-if="selectedGraphRule.actions[0]?.type === 'set_visible'" class="field">Visibilidade
                <select :value="String(selectedGraphRule.actions[0].visible)" @change="ctx.patchSelectedAction({ visible: ($event.target as HTMLSelectElement).value === 'true' })"><option value="true">Mostrar</option><option value="false">Ocultar</option></select>
              </label>
              <template v-else-if="selectedGraphRule.actions[0]?.type === 'javascript'">
                <p class="muted">JavaScript executado depois do gatilho e de todas as condições. API: <code>api</code>, <code>vars</code>, <code>world</code> e <code>console</code>.</p>
                <label class="field">Código JavaScript
                  <textarea class="script-editor" spellcheck="false" rows="12" :value="ctx.scriptDraft" @input="ctx.onScriptDraftInput"></textarea>
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
                  <textarea class="script-editor" spellcheck="false" rows="9" :value="selectedGraphRule.actions[0].code" @input="ctx.patchSelectedAction({ code: ($event.target as HTMLTextAreaElement).value })"></textarea>
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
                <label class="field">Escopo da variável
                  <select :value="selectedGraphRule.actions[0].scope ?? 'object'" @change="ctx.patchSelectedAction({ scope: ($event.target as HTMLSelectElement).value as 'global' | 'object' })"><option value="object">Somente objeto do evento</option><option value="global">Global (compartilhada)</option></select>
                </label>
                <label class="field">Nome da variável<input :value="selectedGraphRule.actions[0].name" @change="ctx.patchSelectedAction({ name: ($event.target as HTMLInputElement).value })" /></label>
                <label class="field">Valor<input :value="String(selectedGraphRule.actions[0].value)" @change="ctx.patchSelectedAction({ value: ctx.ruleValueFromInput(($event.target as HTMLInputElement).value) })" /></label>
                <p class="muted">Use global quando quiser alterar um único valor compartilhado. Use objeto para alterar apenas o valor deste objeto.</p>
              </template>
            </template>
            <button class="danger" @click="ctx.deleteLogicRule(selectedGraphRule.id); ctx.graphSelection = null">Excluir fluxo</button>
          </template>
          <p v-else class="muted">Selecione um nó no gráfico para editar suas propriedades.</p>
          <div class="graph-rule-count">{{ logicRules.length }} fluxo(s) · {{ graphNodes.length }} nós</div>
        </aside>
      </div>
    </div>
</template>
