<script setup lang="ts">
import { reactive } from 'vue'
import FaceTextureEditor from '@/components/FaceTextureEditor.vue'
import type { BehaviorPackageSlotDefinition } from '@engine'
const props = defineProps<{ context: Record<string, any> }>()
const context = props.context
const ctx = reactive(context)

function setExternalRef(name: string, element: unknown): void {
  const externalRef = context[name]
  if (externalRef && typeof externalRef === 'object' && 'value' in externalRef) {
    externalRef.value = element
  }
}

function autonomousTargetObjects(ownerObjectId: string): Array<{ id: string; name: string }> {
  const objects = ctx.objects as Array<{ id: string; name: string }>
  return objects.filter((object: { id: string; name: string }) => object.id !== ownerObjectId)
}
</script>

<template>
<aside class="panel right" :class="{ 'has-selection': ctx.inspectorMode === 'object', 'terrain-selection': ctx.inspectorMode === 'terrain', 'no-selection': ctx.inspectorMode === 'environment' }">
        <div class="inspector-heading">
          <div class="inspector-heading-top">
            <span class="eyebrow">PROPRIEDADES</span>
            <span class="inspector-context">{{ ctx.inspectorMode === 'object' ? 'OBJETO' : ctx.inspectorMode === 'terrain' ? 'TERRENO' : 'CENA' }}</span>
          </div>
          <div class="inspector-title-row">
            <span class="inspector-object-icon" :class="{ selected: ctx.inspectorMode === 'object', terrain: ctx.inspectorMode === 'terrain' }">{{ ctx.inspectorMode === 'object' ? '◇' : ctx.inspectorMode === 'terrain' ? '▤' : '⌂' }}</span>
            <div class="inspector-title-copy">
              <div class="h">{{ ctx.selected ? ctx.selected.name : ctx.inspectorMode === 'terrain' ? 'Terreno editável' : 'Mundo principal' }}</div>
              <div class="inspector-description">{{ ctx.selected ? (ctx.selected.type === 'cube' ? 'Cubo · GameObject' : 'Plataforma · GameObject') : ctx.inspectorMode === 'terrain' ? 'Superfície procedural' : 'Nenhum objeto selecionado' }}</div>
            </div>
            <span v-if="ctx.selected" class="selection-indicator" title="Objeto selecionado"></span>
          </div>
          <div v-if="ctx.inspectorMode === 'environment'" class="selection-empty-hint">Selecione um item na hierarquia ou diretamente no viewport para editar suas propriedades.</div>
        </div>
        <nav v-if="ctx.inspectorMode === 'object'" class="inspector-tabs" aria-label="Modos de propriedades">
          <button :class="{ active: ctx.inspectorTab === 'transform' }" title="Tamanho e posicionamento" @click="ctx.inspectorTab = 'transform'"><span>↔</span><small>Transform</small></button>
          <button :class="{ active: ctx.inspectorTab === 'color' }" title="Cor e material" @click="ctx.inspectorTab = 'color'"><span>◉</span><small>Cor</small></button>
          <button :class="{ active: ctx.inspectorTab === 'variables' }" title="Identidade e variáveis" @click="ctx.inspectorTab = 'variables'"><span>{ }</span><small>Variáveis</small></button>
          <button :class="{ active: ctx.inspectorTab === 'nodes' }" title="Nós e eventos do objeto" @click="ctx.inspectorTab = 'nodes'"><span>⌘</span><small>Nós</small></button>
          <button :class="{ active: ctx.inspectorTab === 'packages' }" title="Pacotes de comportamento" @click="ctx.inspectorTab = 'packages'"><span>▣</span><small>Pacotes</small></button>
        </nav>

        <div class="scroll">
          <section v-if="ctx.inspectorMode === 'environment'">
            <h4>Ambiente</h4>
            <dl>
              <dt>Dimensão</dt><dd class="mono">3D · X/Y/Z</dd>
              <dt>Terreno</dt><dd class="mono">100 × 100 unidades</dd>
              <dt>Relevo</dt><dd class="mono">Procedural + editável</dd>
            </dl>
            <div class="environment-editor">
              <h4>Modelo do jogador</h4>
              <p class="muted">Substitua o visual do personagem controlado em Run. A importação direta usa 1,8 unidade; para escolher outro tamanho, abra Importar 3D, ajuste “Altura final” e clique em “Usar como jogador”. A colisão e as dimensões físicas acompanham a altura escolhida.</p>
              <input :ref="element => setExternalRef('playerModelFileInput', element)" type="file" accept=".glb,model/gltf-binary" hidden @change="ctx.onPlayerModelSelected" />
              <button class="primary environment-button" title="Substitui o visual do jogador. A física acompanha a altura configurada no Importador 3D; os controles permanecem iguais." @click="ctx.playerModelFileInput?.click()">{{ ctx.playerModelCustom ? 'Trocar modelo do jogador' : 'Importar modelo do jogador' }}</button>
              <div class="environment-file">
                <span>♟ {{ ctx.playerModelName }}</span>
                <button v-if="ctx.playerModelCustom" class="ghost" title="Remove o modelo personalizado e volta ao personagem padrão." @click="ctx.resetPlayerModel">Restaurar padrão</button>
              </div>
              <p class="component-note">Aceita arquivos GLB de até 30 MB. <span v-if="ctx.playerModelCustom">Altura atual: <strong>{{ ctx.playerModelHeight.toFixed(2) }} u</strong>. </span>Modelos com animações embutidas podem usar clipes nomeados idle, walk, run e jump; modelos estáticos serão exibidos sem animação de movimento.</p>
              <h4>Céu</h4>
              <p class="muted">Use uma imagem panorâmica ou uma textura de céu para envolver a cena.</p>
              <input :ref="element => setExternalRef('skyFileInput', element)" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden @change="ctx.onSkyTextureSelected" />
              <button class="primary environment-button" title="Carrega uma imagem para usar como textura do céu da cena." @click="ctx.skyFileInput?.click()">{{ ctx.skyTextureDataUrl ? 'Trocar textura do céu' : 'Importar textura do céu' }}</button>
              <div v-if="ctx.skyTextureDataUrl" class="environment-file"><span>▧ {{ ctx.skyTextureName || 'Textura carregada' }}</span><button class="ghost" title="Remove a textura personalizada do céu." @click="ctx.clearSkyTexture">Remover</button></div>
              <h4>Dia e noite</h4>
              <div class="day-night-time-heading">
                <label for="day-night-time-slider">Horário</label>
                <output class="day-night-time-value mono" for="day-night-time-slider">{{ ctx.timeOfDayLabel }}</output>
              </div>
              <input
                id="day-night-time-slider"
                class="environment-range day-night-time-slider"
                type="range"
                min="0"
                max="24"
                step="0.05"
                :value="ctx.timeOfDay"
                :style="{ '--time-progress': `${(ctx.timeOfDay / 24) * 100}%` }"
                :aria-valuetext="ctx.timeOfDayLabel"
                aria-label="Horário do dia" title="Define a hora atual de 00:00 a 24:00 e atualiza a iluminação da cena."
                @input="ctx.setTimeOfDay(Number(($event.target as HTMLInputElement).value))"
                @keydown="ctx.handleTimeOfDayKeydown"
              />
              <div class="day-night-color-band" aria-hidden="true"></div>
              <div class="day-night-time-ticks" aria-hidden="true">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </div>
              <label class="checkline"><input type="checkbox" :checked="ctx.dayNightCycleEnabled" title="Ativa a passagem automática do tempo durante a execução ou visualização da cena." @change="ctx.setDayNightCycleEnabled(($event.target as HTMLInputElement).checked)" /> Ciclo automático de dia/noite</label>
              <div class="day-night-speed-control" :class="{ 'is-disabled': !ctx.dayNightCycleEnabled }">
                <div class="slider-row"><span>Velocidade do ciclo</span><b class="mono">{{ ctx.dayNightCycleSpeed.toFixed(2) }} h/s</b></div>
                <input class="environment-range" type="range" min="0.01" max="4" step="0.01" :value="ctx.dayNightCycleSpeed" :disabled="!ctx.dayNightCycleEnabled" aria-label="Velocidade do ciclo dia/noite" title="Ajusta quantas horas do mundo passam por segundo." @input="ctx.setDayNightCycleSpeed(Number(($event.target as HTMLInputElement).value))" />
              </div>
              <p class="component-note">O céu, o horário e o ciclo são salvos com o projeto.</p>
            </div>
          </section>

          <section v-if="ctx.inspectorMode === 'terrain' || ctx.tool === 'grass'">
            <h4>Ferramentas do terreno</h4>
            <p class="muted">
              Selecione Editar terreno e clique no chão para elevar. Segure Shift e clique para rebaixar.
            </p>
            <div class="slider-row"><span>Força do pincel</span><b class="mono">{{ ctx.brushStrength.toFixed(2) }}</b></div>
            <input v-model.number="ctx.brushStrength" type="range" min="0.2" max="3" step="0.05" title="Controla quanto o terreno sobe ou desce a cada passada do pincel." />
            <div class="slider-row"><span>Raio do pincel</span><b class="mono">{{ ctx.brushRadius.toFixed(1) }}</b></div>
            <input v-model.number="ctx.brushRadius" type="range" min="1" max="12" step="0.5" title="Define a área afetada por cada passada do pincel de terreno." />
            <div class="btn-row">
              <button class="ghost" title="Gera um novo relevo procedural e descarta as alterações de altura atuais." @click="ctx.regenerateTerrain">Novo relevo</button>
              <button class="ghost" title="Apaga as alterações manuais de altura e restaura o terreno de sua semente atual." @click="ctx.clearTerrain">Limpar edições</button>
            </div>
            <div class="grass-paint-panel">
              <h4>Grama</h4>
              <p class="muted">Escolha Pintar grama na barra superior e arraste sobre o terreno. Segure Shift para apagar os tufos que você pintou.</p>
              <div class="slider-row"><span>Tamanho do pincel</span><b class="mono">{{ ctx.brushRadius.toFixed(1) }}</b></div>
              <input v-model.number="ctx.brushRadius" type="range" min="0.5" max="12" step="0.5" title="Define o raio da área em que os tufos de grama são pintados ou apagados." />
              <div class="slider-row"><span>Densidade</span><b class="mono">{{ ctx.brushStrength.toFixed(2) }}</b></div>
              <input v-model.number="ctx.brushStrength" type="range" min="0.2" max="3" step="0.1" title="Controla a densidade de grama adicionada a cada passada do pincel." />
              <p class="component-note">A grama pintada é salva junto com o projeto. Configure a distância de renderização pelo menu Render na barra superior.</p>
            </div>
          </section>

          <section v-if="ctx.inspectorMode === 'object' && ctx.selected">
            <h4>{{ ctx.inspectorTab === 'variables' ? 'Identidade e variáveis' : ctx.inspectorTab === 'packages' ? 'Pacotes de comportamento' : 'Eventos e regras' }}</h4>
            <p v-if="ctx.inspectorTab === 'variables'" class="muted">Dados e valores pertencentes exclusivamente a este objeto.</p>
            <p v-else-if="ctx.inspectorTab === 'nodes'" class="muted">Eventos associados a este objeto. A lista mostra apenas regras vinculadas a ele.</p>
            <p v-else-if="ctx.inspectorTab === 'packages'" class="muted">Instale comportamentos reutilizáveis que acrescentam variáveis, gatilhos, condições e ações ao objeto.</p>
            <template v-if="ctx.inspectorTab === 'variables'">
            <div class="object-meta">
              <div><span>ID</span><code>{{ ctx.selected.id }}</code><button class="meta-copy" title="Copiar ID" @click="ctx.copyObjectId(ctx.selected.id)">⧉</button></div>
              <div><span>TIPO</span><strong>{{ ctx.selected.type === 'cube' ? 'Cube / GameObject' : 'Platform / GameObject' }}</strong></div>
            </div>
            <div class="component-caption">VARIÁVEIS DO OBJETO · VALORES INDEPENDENTES</div>
            <div class="variable-table-head" aria-hidden="true">
              <span>ID</span><span>TIPO</span><span>VALOR</span><span></span>
            </div>
            <div v-for="(value, name) in ctx.logicVariables" :key="'obj-' + name" class="variable-row object-variable-row">
              <code class="variable-id" :title="String(name)">{{ name }}</code>
              <span class="variable-type">{{ typeof value }}</span>
              <input class="variable-value" :aria-label="'Valor de ' + String(name)" :value="String(value)" @change="ctx.setLogicVariableValue(String(name), ($event.target as HTMLInputElement).value, 'object')" />
              <button class="variable-delete" :aria-label="'Excluir variável do objeto ' + String(name)" title="Excluir variável deste objeto" @click="ctx.deleteLogicVariable(String(name), 'object')">×</button>
            </div>
            <p v-if="!Object.keys(ctx.logicVariables).length" class="muted">Nenhuma variável própria neste objeto.</p>
            <div class="component-caption">VARIÁVEIS GLOBAIS REUTILIZÁVEIS</div>
            <p class="muted">Adicione uma cópia ao objeto para que cada objeto mantenha seu próprio valor.</p>
            <div class="variable-table-head global-variable-head" aria-hidden="true">
              <span>ID</span><span>TIPO</span><span>VALOR</span><span></span><span></span>
            </div>
            <div v-for="(value, name) in ctx.globalLogicVariables" :key="'global-' + name" class="variable-row global-variable-row">
              <code class="variable-id" :title="String(name)">{{ name }}</code>
              <span class="variable-type">{{ typeof value }}</span>
              <input class="variable-value" :aria-label="'Valor global de ' + String(name)" :value="String(value)" @change="ctx.setLogicVariableValue(String(name), ($event.target as HTMLInputElement).value, 'global')" />
              <button class="ghost variable-copy" title="Copiar para este objeto" :disabled="Object.prototype.hasOwnProperty.call(ctx.logicVariables, name)" @click="ctx.useGlobalVariableOnObject(String(name))">＋</button>
              <button class="variable-delete" :aria-label="'Excluir variável global ' + String(name)" title="Excluir variável global" @click="ctx.deleteLogicVariable(String(name), 'global')">×</button>
            </div>
            <div class="variable-create">
              <input v-model="ctx.newVariableName" placeholder="nome_da_variavel" spellcheck="false" />
              <select :value="ctx.newVariableType" aria-label="Tipo da nova variável" @change="ctx.onNewVariableTypeChange(($event.target as HTMLSelectElement).value as 'string' | 'number' | 'boolean')">
                <option value="string">String · texto</option>
                <option value="number">Number · número</option>
                <option value="boolean">Boolean · verdadeiro/falso</option>
              </select>
              <label v-if="ctx.newVariableType === 'boolean'" class="field variable-initial-value">Valor inicial
                <select v-model="ctx.newVariableValue">
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </label>
              <label v-else class="field variable-initial-value">Valor inicial
                <input v-model="ctx.newVariableValue" :type="ctx.newVariableType === 'number' ? 'number' : 'text'" :placeholder="ctx.newVariableType === 'number' ? '0' : 'Texto inicial'" />
              </label>
              <button class="ghost" @click="ctx.submitVariable('object')">+ Variável do objeto</button>
              <button class="ghost" @click="ctx.submitVariable('global')">+ Variável global</button>
            </div>
            </template>
            <template v-if="ctx.inspectorTab === 'nodes'">
            <label class="field">Gatilho
              <select v-model="ctx.ruleTrigger"><option value="object_clicked">Clicar no objeto selecionado</option><option value="enter_area">Objeto entrar na área (centro 0,1,0)</option><option value="key_pressed">Tecla pressionada</option><option value="package_event">Evento de pacote</option></select>
            </label>
            <template v-if="ctx.ruleTrigger === 'package_event'">
              <label class="field">Pacote instalado
                <select :value="ctx.rulePackageId" @change="ctx.onRulePackageChange(($event.target as HTMLSelectElement).value)">
                  <option v-for="entry in ctx.selectedObjectPackages" :key="entry.id" :value="entry.packageId">{{ ctx.getBehaviorPackageDefinition(entry.packageId)?.name ?? entry.packageId }}</option>
                </select>
              </label>
              <label class="field">Gatilho do pacote
                <select v-model="ctx.rulePackageEventId">
                  <option v-for="trigger in ctx.selectedRulePackageDefinition?.triggers ?? []" :key="trigger.id" :value="trigger.id">{{ trigger.label }}</option>
                </select>
              </label>
              <p v-if="!ctx.selectedObjectPackages.length" class="component-note">Instale primeiro um pacote na aba Pacotes deste objeto. O gatilho ficará disponível aqui.</p>
              <p v-else class="component-note">{{ ctx.selectedRulePackageDefinition?.triggers.find((trigger: BehaviorPackageSlotDefinition) => trigger.id === ctx.rulePackageEventId)?.description ?? '' }}</p>
            </template>
            <label class="field">Ação
              <select v-model="ctx.ruleAction"><option value="rotate">Girar +45°</option><option value="move">Mover para X=2</option><option value="set_visible">Ocultar objeto</option><option value="set_variable">Definir variável global/do objeto</option><option value="set_package_variable">Definir variável de pacote</option><option value="javascript">JavaScript livre (colar código)</option><option value="script">Script Prometheus</option></select>
            </label>
            <template v-if="ctx.ruleAction === 'set_package_variable'">
              <label class="field">Pacote alvo
                <select :value="ctx.rulePackageId" @change="ctx.onRulePackageChange(($event.target as HTMLSelectElement).value)">
                  <option v-for="entry in ctx.selectedObjectPackages" :key="entry.id" :value="entry.packageId">{{ ctx.getBehaviorPackageDefinition(entry.packageId)?.name ?? entry.packageId }}</option>
                </select>
              </label>
              <label class="field">Variável do pacote
                <select v-model="ctx.rulePackageVariableName">
                  <option v-for="variable in ctx.selectedWritablePackageVariables" :key="variable.name" :value="variable.name">{{ variable.label }} ({{ variable.name }})</option>
                </select>
              </label>
              <label class="field">Novo valor
                <input v-model="ctx.rulePackageVariableValue" placeholder="true, false, 4.2 ou texto" />
              </label>
              <p v-if="!ctx.selectedObjectPackages.length" class="component-note">Instale primeiro um pacote neste objeto.</p>
            </template>
            <label class="checkline"><input v-model="ctx.ruleConditionEnabled" type="checkbox" /> Exigir condição baseada em variável</label>
            <template v-if="ctx.ruleConditionEnabled">
              <label class="field">Variável
                <select v-model="ctx.conditionVariable">
                  <option v-for="(value, name) in (ctx.ruleTrigger === 'package_event' ? ctx.selectedRulePackageVariables : ctx.logicVariables)" :key="name" :value="String(name)">{{ name }} ({{ String(value) }})</option>
                </select>
              </label>
              <label class="field">Comparação
                <select v-model="ctx.conditionOperator">
                  <option value="equals">É igual a</option>
                  <option value="not_equals">É diferente de</option>
                  <option value="greater_than">É maior que</option>
                  <option value="less_than">É menor que</option>
                </select>
              </label>
              <label class="field">Valor esperado
                <input v-model="ctx.conditionValue" placeholder="true, false, 10 ou texto" />
              </label>
              <p class="muted">A ação só será executada se a variável escolhida atender à comparação.</p>
            </template>
            <template v-if="ctx.ruleAction === 'javascript'">
              <label class="field">Código JavaScript
                <textarea v-model="ctx.sidebarScriptDraft" class="script-editor" spellcheck="false" rows="8" placeholder="// Cole seu código JavaScript aqui"></textarea>
              </label>
              <p class="muted">O código será salvo na ação da nova regra e executado quando o gatilho e as condições forem satisfeitos.</p>
            </template>
            <label class="field">Nome do evento
              <input v-model="ctx.newEventName" placeholder="Ex.: Clique para abrir porta" spellcheck="false" />
            </label>
            <button class="ghost full" @click="ctx.addLogicRule(ctx.ruleAction === 'javascript' ? ctx.sidebarScriptDraft : undefined, ctx.ruleConditionEnabled ? { type: 'variable', name: ctx.conditionVariable, operator: ctx.conditionOperator, value: ctx.ruleValueFromInput(ctx.conditionValue) } : undefined, ctx.newEventName); ctx.newEventName = ''">+ Adicionar evento ao objeto selecionado</button>
            <div v-if="ctx.selectedObjectRules.length" class="rule-list">
              <div v-for="(rule, index) in ctx.selectedObjectRules" :key="rule.id" class="rule-item">
                <div class="rule-order" :title="'Prioridade ' + (Number(index) + 1)">
                  <button class="ghost" :disabled="index === 0" title="Subir na hierarquia (maior prioridade)" @click="ctx.moveLogicRule(rule.id, -1)">↑</button>
                  <button class="ghost" :disabled="index === ctx.logicRules.length - 1" title="Descer na hierarquia (menor prioridade)" @click="ctx.moveLogicRule(rule.id, 1)">↓</button>
                  <span class="muted">{{ Number(index) + 1 }}</span>
                </div>
                <label class="checkline"><input type="checkbox" :checked="rule.enabled" @change="ctx.toggleLogicRule(rule)" /><span>{{ rule.name }} · {{ rule.trigger.type === 'object_clicked' ? 'Clique' : rule.trigger.type === 'key_pressed' ? `Tecla ${rule.trigger.key}` : rule.trigger.type === 'package_event' ? `Pacote: ${rule.trigger.eventId}` : 'Entrada na área' }}</span></label>
                <button class="ghost" title="Editar evento" @click="ctx.graphSelection = { ruleId: rule.id, part: 'trigger' }; ctx.graphOpen = true">Editar</button>
                <button class="rule-delete" title="Excluir regra" @click="ctx.deleteLogicRule(rule.id)">×</button>
              </div>
            </div>
            <p v-else class="muted">Este objeto ainda não tem nós ou eventos associados.</p>
            <button class="ghost full public-library-toggle" @click="ctx.publicLibraryOpen = !ctx.publicLibraryOpen">{{ ctx.publicLibraryOpen ? 'Fechar biblioteca pública' : '＋ Importar evento da biblioteca pública' }}</button>
            <div v-if="ctx.publicLibraryOpen" class="public-library-list">
              <p class="muted">Importar cria uma cópia independente vinculada a este objeto.</p>
              <div v-for="rule in ctx.publicLogicRules" :key="'public-' + rule.id" class="public-library-item">
                <span>{{ rule.name }}</span>
                <button class="ghost" @click="ctx.importPublicRule(rule)">Importar</button>
              </div>
              <p v-if="!ctx.publicLogicRules.length" class="muted">Nenhum evento público disponível para importar.</p>
            </div>

            </template>
          </section>

          <section class="object-components">
            <h4>{{ ctx.selected ? (ctx.inspectorTab === 'transform' ? 'Transformação' : ctx.inspectorTab === 'color' ? 'Aparência e material' : ctx.inspectorTab === 'nodes' ? 'Nós do objeto' : 'Dados do objeto') : ctx.selectedId === ctx.TERRAIN_ID ? 'Terreno editável' : 'Cena' }}</h4>
            <template v-if="ctx.selected">
              <template v-if="ctx.inspectorTab === 'transform'">
              <label class="field">Nome do objeto
                <input :value="ctx.selected.name" spellcheck="false" @change="ctx.onRename" />
              </label>

              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon transform-icon">↔</span><strong>Transform</strong><span class="component-menu">⋮</span></div>
                <div class="unity-component-body">
                  <div class="transform-property-row">
                    <span class="transform-property-label">Posição</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x" title="Posição horizontal no eixo X."><span>X</span><input class="mono" type="number" step="0.1" :value="ctx.selected.x.toFixed(2)" @change="ctx.onNumber('x', $event)" /></label>
                      <label class="axis-value axis-y" title="Altura do objeto no eixo Y."><span>Y</span><input class="mono" type="number" step="0.1" :value="ctx.selected.y.toFixed(2)" @change="ctx.onNumber('y', $event)" /></label>
                      <label class="axis-value axis-z" title="Posição de profundidade no eixo Z."><span>Z</span><input class="mono" type="number" step="0.1" :value="ctx.selected.z.toFixed(2)" @change="ctx.onNumber('z', $event)" /></label>
                    </div>
                  </div>
                  <div class="transform-property-row">
                    <span class="transform-property-label">Rotação</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x" title="Rotação em graus ao redor do eixo X."><span>X</span><input class="mono" type="number" step="1" :value="ctx.selected.rotationX.toFixed(0)" @change="ctx.onNumber('rotationX', $event)" /></label>
                      <label class="axis-value axis-y" title="Rotação em graus ao redor do eixo Y."><span>Y</span><input class="mono" type="number" step="1" :value="ctx.selected.rotationY.toFixed(0)" @change="ctx.onNumber('rotationY', $event)" /></label>
                      <label class="axis-value axis-z" title="Rotação em graus ao redor do eixo Z."><span>Z</span><input class="mono" type="number" step="1" :value="ctx.selected.rotationZ.toFixed(0)" @change="ctx.onNumber('rotationZ', $event)" /></label>
                    </div>
                  </div>
                  <div class="transform-property-row">
                    <span class="transform-property-label">Escala</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x" title="Escala do objeto no eixo X."><span>X</span><input class="mono" type="number" min="0.1" :max="ctx.selected.importedModel ? 10000 : 20" step="0.1" :value="ctx.selected.scaleX.toFixed(2)" @change="ctx.onNumber('scaleX', $event)" /></label>
                      <label class="axis-value axis-y" title="Escala do objeto no eixo Y."><span>Y</span><input class="mono" type="number" min="0.1" :max="ctx.selected.importedModel ? 10000 : 20" step="0.1" :value="ctx.selected.scaleY.toFixed(2)" @change="ctx.onNumber('scaleY', $event)" /></label>
                      <label class="axis-value axis-z" title="Escala do objeto no eixo Z."><span>Z</span><input class="mono" type="number" min="0.1" :max="ctx.selected.importedModel ? 10000 : 20" step="0.1" :value="ctx.selected.scaleZ.toFixed(2)" @change="ctx.onNumber('scaleZ', $event)" /></label>
                    </div>
                  </div>
                  <div class="component-caption">FÍSICA</div>
                  <label class="field">Massa (kg)
                    <input class="mono" type="number" min="0" max="1000000" step="0.1" :value="ctx.selected.mass.toFixed(2)" @change="ctx.onNumber('mass', $event)" />
                  </label>
                  <p class="component-note">Massa 0 = corpo estático. A massa distribui a correção de penetração durante colisões.</p>
                  <div class="collider-type-row">
                    <label class="field">Tipo de colisor
                      <select :value="ctx.selected.colliderType" @change="ctx.onColliderChange(ctx.selected.id, $event)">
                        <option value="auto">Automático (malha)</option>
                        <option v-if="ctx.selected.importedModel" value="mesh">Malha estática (cidade / terreno · BVH)</option>
                        <option value="box">Caixa (Box)</option>
                        <option value="sphere">Esfera (Sphere)</option>
                        <option value="capsule">Cápsula (Capsule)</option>
                        <option value="none">Sem colisão</option>
                      </select>
                    </label>
                    <button class="ghost collider-visibility-button" :class="{ active: ctx.colliderDebugVisible }" title="Mostra ou esconde a forma física usada para colisões no mundo." @click="ctx.toggleColliderDebug">{{ ctx.colliderDebugVisible ? 'Ocultar' : 'Ver no mundo' }}</button>
                  </div>
                  <p class="component-note">Malha estática usa os triângulos reais e um BVH espacial, ideal para cidades e terrenos não animados. Preserva ruas e espaços vazios entre prédios. Caixa, esfera e cápsula usam formas simplificadas.</p>
<div v-if="ctx.selected.colliderType !== 'mesh'" class="transform-property-row collider-vector-row">
                    <span class="transform-property-label">Tamanho</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x"><span>X</span><input class="mono" type="number" min="0.05" step="0.1" :value="ctx.selected.colliderSize[0].toFixed(2)" @input="ctx.onColliderVectorChange(ctx.selected.id, 'colliderSize', 0, $event)" @change="ctx.onColliderVectorChange(ctx.selected.id, 'colliderSize', 0, $event)" /></label>
                      <label class="axis-value axis-y"><span>Y</span><input class="mono" type="number" min="0.05" step="0.1" :value="ctx.selected.colliderSize[1].toFixed(2)" @input="ctx.onColliderVectorChange(ctx.selected.id, 'colliderSize', 1, $event)" @change="ctx.onColliderVectorChange(ctx.selected.id, 'colliderSize', 1, $event)" /></label>
                      <label class="axis-value axis-z"><span>Z</span><input class="mono" type="number" min="0.05" step="0.1" :value="ctx.selected.colliderSize[2].toFixed(2)" @input="ctx.onColliderVectorChange(ctx.selected.id, 'colliderSize', 2, $event)" @change="ctx.onColliderVectorChange(ctx.selected.id, 'colliderSize', 2, $event)" /></label>
                    </div>
                  </div>
                  <div v-if="ctx.selected.colliderType !== 'mesh'" class="transform-property-row collider-vector-row">
                    <span class="transform-property-label">Deslocar</span>
                    <div class="transform-axis-grid">
                      <label class="axis-value axis-x"><span>X</span><input class="mono" type="number" step="0.1" :value="ctx.selected.colliderOffset[0].toFixed(2)" @input="ctx.onColliderVectorChange(ctx.selected.id, 'colliderOffset', 0, $event)" @change="ctx.onColliderVectorChange(ctx.selected.id, 'colliderOffset', 0, $event)" /></label>
                      <label class="axis-value axis-y"><span>Y</span><input class="mono" type="number" step="0.1" :value="ctx.selected.colliderOffset[1].toFixed(2)" @input="ctx.onColliderVectorChange(ctx.selected.id, 'colliderOffset', 1, $event)" @change="ctx.onColliderVectorChange(ctx.selected.id, 'colliderOffset', 1, $event)" /></label>
                      <label class="axis-value axis-z"><span>Z</span><input class="mono" type="number" step="0.1" :value="ctx.selected.colliderOffset[2].toFixed(2)" @input="ctx.onColliderVectorChange(ctx.selected.id, 'colliderOffset', 2, $event)" @change="ctx.onColliderVectorChange(ctx.selected.id, 'colliderOffset', 2, $event)" /></label>
                    </div>
                  </div>
                  <p class="component-note">Ajustar dimensões ativa um colisor personalizado em caixa quando o tipo está em Automático. O deslocamento reposiciona a forma sem mover a malha visual.</p>
                  <p class="component-note">Transformação sincronizada com o gizmo 3D do viewport.</p>
                </div>
              </div>

              </template>
              <template v-if="ctx.inspectorTab === 'color'">
              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon renderer-icon">◈</span><strong>Mesh Renderer</strong><span class="component-menu">⋮</span></div>
                <div class="unity-component-body">
                  <label class="checkline component-enabled"><input type="checkbox" :checked="ctx.selected.visible" @change="ctx.toggleVisible(ctx.selected.id)" /> Renderer habilitado</label>
                  <label class="field">Material · cor base
                    <input type="color" class="color" :value="ctx.colorHex(ctx.selected.color)" @input="ctx.onColor" />
                  </label>
                  <label class="field">Material · textura
                    <select :value="ctx.selected.texturePreset" @change="ctx.onTexture">
                      <option value="none">Sem textura</option>
                      <option value="grass">Grama</option>
                      <option value="stone">Pedra</option>
                      <option value="brick">Tijolo</option>
                      <option value="wood">Madeira</option>
                      <option value="sand">Areia</option>
                      <option value="metal">Metal</option>
                    </select>
                  </label>
                  <label class="field">Repetição da textura · {{ ctx.selected.textureRepeat }}×
                    <input type="range" min="1" max="8" step="1" :value="ctx.selected.textureRepeat" :disabled="ctx.selected.texturePreset === 'none'" @change="ctx.onTextureRepeat" />
                  </label>
                  <FaceTextureEditor :model-value="ctx.selected.faceTextures ?? {}" @update-face-texture="ctx.onFaceTexture" />
                  <p class="component-note">Texturas procedurais aplicadas ao cubo ou à plataforma e salvas junto com o projeto.</p>
                  <div class="component-readonly"><span>Mesh</span><strong>{{ ctx.selected.type === 'cube' ? 'Cube Mesh' : 'Platform Mesh' }}</strong></div>
                  <div class="component-readonly"><span>Shader</span><strong>Standard / PBR</strong></div>
                </div>
              </div>

              </template>
              <template v-if="ctx.inspectorTab === 'nodes'">
              <div class="unity-component">
                <div class="unity-component-head"><span class="component-icon script-icon">⌘</span><strong>Event Script</strong><span class="component-count">{{ ctx.selectedObjectRules.length }}</span></div>
                <div class="unity-component-body">
                  <p class="muted">Eventos que usam este objeto como alvo ou ação.</p>
                  <div v-if="ctx.selectedObjectRules.length" class="attached-rules">
                    <button v-for="rule in ctx.selectedObjectRules" :key="rule.id" class="attached-rule" @click="ctx.openObjectRule(rule)">
                      <span class="attached-rule-status" :class="{ disabled: !rule.enabled }"></span>
                      <span>{{ rule.name }}</span><span class="rule-open">›</span>
                    </button>
                  </div>
                  <p v-else class="component-note">Nenhum evento associado a este objeto.</p>
                  <button class="ghost full add-component-btn" @click="ctx.addLogicRule(); ctx.graphOpen = true">+ Adicionar evento</button>
                </div>
              </div>


              </template>
              <template v-if="ctx.inspectorTab === 'packages'">
                <div class="unity-component">
                  <div class="unity-component-head"><span class="component-icon script-icon">▣</span><strong>Comportamentos instalados</strong><span class="component-count">{{ ctx.selectedObjectPackages.length }}</span></div>
                  <div class="unity-component-body">
                    <div v-if="!ctx.installedPackageDefinitions.length" class="package-empty">
                      <strong>Nenhum pacote instalado</strong>
                      <p class="muted">Os pacotes adicionam comportamentos sem exigir regras manuais específicas para cada objeto.</p>
                    </div>
                    <article v-for="entry in ctx.installedPackageDefinitions" :key="entry.instance.id" class="behavior-package-card">
                      <div class="behavior-package-header">
                        <div><strong>{{ entry.definition.name }}</strong><p class="muted">{{ entry.definition.description }}</p></div>
                        <button class="variable-delete" :aria-label="'Remover pacote ' + entry.definition.name" title="Remover pacote" @click="ctx.removeBehaviorPackage(entry.instance.id)">×</button>
                      </div>
                      <label class="checkline"><input type="checkbox" :checked="entry.instance.enabled" @change="ctx.updateBehaviorPackage(entry.instance.id, { enabled: ($event.target as HTMLInputElement).checked })" /> Pacote habilitado</label>

                      <div class="component-caption">VARIÁVEIS</div>
                      <div v-for="variable in entry.definition.variables" :key="variable.name" class="package-variable">
                        <label v-if="entry.instance.packageId === 'autonomous_agent' && variable.name === 'target_object_id'" class="field">{{ variable.label }}
                          <select :value="String(entry.instance.variables[variable.name] ?? '')" :disabled="variable.readOnly === true" @change="ctx.onPackageVariableChange(entry.instance, variable, $event)">
                            <option value="">Selecione um objeto-alvo…</option>
                            <option v-for="obj in autonomousTargetObjects(entry.instance.ownerObjectId)" :key="obj.id" :value="obj.id">{{ obj.name }}</option>
                          </select>
                        </label>
                        <label v-else-if="variable.options?.length" class="field">{{ variable.label }}
                          <select :value="String(entry.instance.variables[variable.name] ?? variable.defaultValue)" :disabled="variable.readOnly === true" @change="ctx.onPackageVariableChange(entry.instance, variable, $event)">
                            <option v-for="option in variable.options" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
                          </select>
                        </label>
                        <label v-else-if="variable.type === 'boolean'" class="checkline">
                          <input type="checkbox" :checked="entry.instance.variables[variable.name] === true" :disabled="variable.readOnly === true" @change="ctx.onPackageVariableChange(entry.instance, variable, $event)" />
                          {{ variable.label }}
                        </label>
                        <label v-else class="field">{{ variable.label }}
                          <input :type="variable.type === 'number' ? 'number' : 'text'" :value="String(entry.instance.variables[variable.name] ?? variable.defaultValue)" :min="variable.min" :max="variable.max" :step="variable.step" :disabled="variable.readOnly === true" @change="ctx.onPackageVariableChange(entry.instance, variable, $event)" />
                        </label>
                        <p class="component-note">{{ variable.description }}</p>
                      </div>

                      <template v-if="entry.instance.packageId === 'mount'">
                        <div class="component-caption">CONFIGURAÇÃO DA MONTARIA</div>
                        <label class="field">Tecla para montar / desmontar
                          <select :value="String(entry.instance.config.interactionKey ?? 'KeyE')" @change="ctx.onPackageConfigChange(entry.instance, 'interactionKey', ($event.target as HTMLSelectElement).value)">
                            <option value="KeyE">E</option><option value="KeyF">F</option><option value="KeyR">R</option><option value="KeyQ">Q</option><option value="KeyG">G</option>
                          </select>
                        </label>
                        <div class="component-caption">POSIÇÃO DO JOGADOR SOBRE A MONTARIA</div>
                        <div class="grid3">
                          <label class="field">Offset X<input type="number" step="0.05" :value="Array.isArray(entry.instance.config.seatOffset) ? Number(entry.instance.config.seatOffset[0]) : 0" @change="ctx.onPackageSeatOffsetChange(entry.instance, 0, $event)" /></label>
                          <label class="field">Offset Y<input type="number" step="0.05" :value="Array.isArray(entry.instance.config.seatOffset) ? Number(entry.instance.config.seatOffset[1]) : 0.55" @change="ctx.onPackageSeatOffsetChange(entry.instance, 1, $event)" /></label>
                          <label class="field">Offset Z<input type="number" step="0.05" :value="Array.isArray(entry.instance.config.seatOffset) ? Number(entry.instance.config.seatOffset[2]) : 0" @change="ctx.onPackageSeatOffsetChange(entry.instance, 2, $event)" /></label>
                        </div>

                        <div class="component-caption">ESTADOS VISUAIS DO MODELO</div>
                        <p class="component-note">Mostre ou oculte grupos/malhas do GLB conforme uma variável. Exemplo: a parte “Cavaleiro” fica visível apenas quando <code>mounted = true</code>. A malha não é removida do arquivo.</p>
                        <button class="ghost full add-component-btn" :disabled="ctx.selectedModelNodes.length === 0" @click="ctx.addMountModelState(entry.instance)">+ Adicionar estado visual</button>
                        <p v-if="ctx.selectedModelNodes.length === 0" class="component-note">Nenhum nó de modelo detectado neste objeto. Importe um modelo 3D que tenha a hierarquia de partes preservada.</p>
                        <div v-for="state in ctx.getMountModelStates(entry.instance)" :key="state.id" class="mount-model-state">
                          <label class="field">Parte / grupo do GLB
                            <select :value="state.nodePath" @change="ctx.updateMountModelState(entry.instance, state.id, { nodePath: ($event.target as HTMLSelectElement).value })">
                              <option v-for="node in ctx.selectedModelNodes" :key="node.path" :value="node.path">{{ node.name }} · {{ node.meshCount }} malha(s) — {{ node.path }}</option>
                            </select>
                          </label>
                          <label class="field">Variável da condição
                            <select :value="state.variable" @change="ctx.updateMountModelState(entry.instance, state.id, { variable: ($event.target as HTMLSelectElement).value })">
                              <option v-for="variable in ctx.mountStateVariableOptions(entry.instance)" :key="variable.name" :value="variable.name">{{ variable.name }} = {{ String(variable.value) }}</option>
                            </select>
                          </label>
                          <div class="grid3">
                            <label class="field">Comparação
                              <select :value="state.operator" @change="ctx.updateMountModelState(entry.instance, state.id, { operator: ($event.target as HTMLSelectElement).value as 'equals' | 'not_equals' })">
                                <option value="equals">Igual a</option>
                                <option value="not_equals">Diferente de</option>
                              </select>
                            </label>
                            <label class="field">Valor esperado
                              <input type="text" :value="String(state.value)" @change="ctx.onMountModelStateValueChange(entry.instance, state.id, $event)" />
                            </label>
                          </div>
                          <label class="checkline"><input type="checkbox" :checked="state.visibleWhenMatched" @change="ctx.updateMountModelState(entry.instance, state.id, { visibleWhenMatched: ($event.target as HTMLInputElement).checked })" /> Exibir quando a condição for verdadeira</label>
                          <button class="variable-delete" :aria-label="'Remover estado de ' + state.nodePath" title="Remover estado visual" @click="ctx.removeMountModelState(entry.instance, state.id)">Remover estado ×</button>
                        </div>
                      </template>

                      <div class="component-caption">GATILHOS</div>
                      <div class="package-slot-list"><div v-for="trigger in entry.definition.triggers" :key="trigger.id"><strong>{{ trigger.label }}</strong><small>{{ trigger.description }}</small></div></div>
                      <div class="component-caption">CONDIÇÕES</div>
                      <div class="package-slot-list"><div v-for="condition in entry.definition.conditions" :key="condition.id"><strong>{{ condition.label }}</strong><small>{{ condition.description }}</small></div></div>
                      <div class="component-caption">AÇÕES</div>
                      <div class="package-slot-list"><div v-for="action in entry.definition.actions" :key="action.id"><strong>{{ action.label }}</strong><small>{{ action.description }}</small></div></div>
                    </article>

                    <div class="component-caption">ADICIONAR PACOTE</div>
                    <button v-for="definition in ctx.availableBehaviorPackages" :key="definition.id" class="ghost full add-component-btn" @click="ctx.addBehaviorPackage(definition.id)">
                      + {{ definition.name }}
                      <span class="muted">{{ definition.description }}</span>
                    </button>
                    <p v-if="!ctx.availableBehaviorPackages.length" class="component-note">Todos os pacotes disponíveis já estão instalados neste objeto.</p>
                  </div>
                </div>
              </template>
              <button v-if="ctx.inspectorTab === 'transform' || ctx.inspectorTab === 'nodes'" class="danger" @click="ctx.removeSelected">Excluir GameObject (Del)</button>
            </template>
            <p v-else-if="ctx.selectedId === ctx.TERRAIN_ID" class="muted">
              Terreno editável · semente <span class="mono">{{ ctx.terrain.seed }}</span> ·
              <span class="mono">{{ ctx.terrain.edits }}</span> pontos editados.
            </p>
            <p v-else class="muted">
              Selecione um GameObject na hierarquia ou no mundo para editar seus componentes.
            </p>
          </section>
        </div>

        <div class="panel-foot">
          <span>ENGINE PROMETHEUS</span>
          <span class="mono">{{ ctx.ENGINE_VERSION }}</span>
        </div>
      </aside>
</template>
