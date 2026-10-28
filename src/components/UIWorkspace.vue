<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createUIScreen,
  createUIElement,
  createUIScreenId,
  createUIScreenFromPreset,
  UI_SCREEN_PRESETS,
  alignUIElement,
  duplicateUIElement,
  getClampedUIElementPosition,
  reorderUIElement,
  type UIElementDefinition,
  type UIElementKind,
  type UIScreenPresetId,
} from '@engine'
import { uiWorkspaceState } from '@/lib/ui/uiWorkspaceState'

defineProps<{ projectName?: string }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const selectedElementId = ref('')
const previewMode = ref(false)
const showGrid = ref(true)
const snapToGrid = ref(true)
const statusMessage = ref('As alterações são incluídas ao salvar o projeto.')
const canvasStage = ref<HTMLElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const imageTargetId = ref('')
const dragState = ref<{ id: string; startX: number; startY: number; originX: number; originY: number; width: number; height: number } | null>(null)

const activeScreen = computed(() =>
  uiWorkspaceState.screens.find(screen => screen.id === uiWorkspaceState.activeScreenId) ?? null,
)
const selectedElement = computed(() =>
  activeScreen.value?.elements.find(element => element.id === selectedElementId.value) ?? null,
)
const activeElementIndex = computed(() =>
  activeScreen.value?.elements.findIndex(element => element.id === selectedElementId.value) ?? -1,
)

watch(() => uiWorkspaceState.activeScreenId, () => {
  selectedElementId.value = ''
})

function createScreen(): void {
  const screen = createUIScreen(`Tela ${uiWorkspaceState.screens.length + 1}`)
  uiWorkspaceState.screens.push(screen)
  uiWorkspaceState.activeScreenId = screen.id
  selectedElementId.value = ''
  statusMessage.value = 'Tela criada. Configure os elementos e marque “Ativa no jogo” quando quiser exibi-la.'
}

function addPreset(presetId: UIScreenPresetId): void {
  const screen = createUIScreenFromPreset(presetId)
  uiWorkspaceState.screens.push(screen)
  uiWorkspaceState.activeScreenId = screen.id
  selectedElementId.value = ''
  previewMode.value = false
  statusMessage.value = 'Modelo "' + screen.name + '" adicionado. Revise os elementos e ative a tela no jogo quando estiver pronta.'
}

function duplicateScreen(): void {
  const source = activeScreen.value
  if (!source) return
  const screen = JSON.parse(JSON.stringify(source)) as typeof source
  screen.id = createUIScreenId('screen')
  screen.name = (source.name + ' - cópia').slice(0, 80)
  for (const element of screen.elements) element.id = createUIScreenId('element')
  uiWorkspaceState.screens.push(screen)
  uiWorkspaceState.activeScreenId = screen.id
  statusMessage.value = 'Cópia da tela criada.'
}

function deleteScreen(): void {
  const screen = activeScreen.value
  if (!screen) return
  const index = uiWorkspaceState.screens.findIndex(item => item.id === screen.id)
  uiWorkspaceState.screens.splice(index, 1)
  uiWorkspaceState.activeScreenId = uiWorkspaceState.screens[Math.max(0, index - 1)]?.id ?? uiWorkspaceState.screens[0]?.id ?? ''
  selectedElementId.value = ''
  statusMessage.value = 'Tela removida. Salve o projeto para registrar a alteração.'
}

function addElement(kind: UIElementKind): void {
  const screen = activeScreen.value
  if (!screen) {
    createScreen()
  }
  const target = activeScreen.value
  if (!target) return
  const element = createUIElement(kind, target.elements.length)
  target.elements.push(element)
  selectedElementId.value = element.id
  previewMode.value = false
  statusMessage.value = `${element.name} adicionado à tela.`
}

function selectElement(id: string): void {
  if (previewMode.value) return
  selectedElementId.value = id
}

function duplicateElement(): void {
  const source = selectedElement.value
  const screen = activeScreen.value
  if (!source || !screen) return
  const copy = duplicateUIElement(source, screen.elements.length)
  screen.elements.push(copy)
  selectedElementId.value = copy.id
  statusMessage.value = 'Elemento "' + source.name + '" duplicado.'
}

function moveSelectedLayer(direction: 'front' | 'back'): void {
  const screen = activeScreen.value
  if (!screen || !selectedElementId.value) return
  const reordered = reorderUIElement(screen.elements, selectedElementId.value, direction === 'front' ? 1 : -1)
  if (reordered === screen.elements) return
  screen.elements.splice(0, screen.elements.length, ...reordered)
  statusMessage.value = direction === 'front' ? 'Elemento trazido para frente.' : 'Elemento enviado para trás.'
}

function alignSelected(axis: 'horizontal' | 'vertical'): void {
  const element = selectedElement.value
  if (!element) return
  Object.assign(element, alignUIElement(element, axis))
  statusMessage.value = axis === 'horizontal' ? 'Elemento centralizado horizontalmente.' : 'Elemento centralizado verticalmente.'
}

function moveSelectedBy(dx: number, dy: number): void {
  const element = selectedElement.value
  if (!element) return
  Object.assign(element, getClampedUIElementPosition(element, element.x + dx, element.y + dy, snapToGrid.value, 2.5))
}

function handleKeyboardShortcut(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )) return

  const key = event.key.toLowerCase()
  if ((event.ctrlKey || event.metaKey) && key === 'd') {
    if (!previewMode.value && selectedElement.value) {
      event.preventDefault()
      duplicateElement()
    }
    return
  }
  if (event.key === 'Escape') {
    if (previewMode.value) previewMode.value = false
    else selectedElementId.value = ''
    return
  }
  if (previewMode.value) return

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedElement.value) {
      event.preventDefault()
      removeElement()
    }
    return
  }

  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const direction = directions[event.key]
  if (!direction || !selectedElement.value) return
  event.preventDefault()
  const step = event.shiftKey ? 5 : snapToGrid.value ? 2.5 : 1
  moveSelectedBy(direction[0] * step, direction[1] * step)
}

function removeElement(id = selectedElementId.value): void {
  const screen = activeScreen.value
  if (!screen || !id) return
  const index = screen.elements.findIndex(element => element.id === id)
  if (index < 0) return
  screen.elements.splice(index, 1)
  if (selectedElementId.value === id) selectedElementId.value = ''
  statusMessage.value = 'Elemento removido.'
}

function elementStyle(element: UIElementDefinition): Record<string, string> {
  return {
    left: `${element.x}%`,
    top: `${element.y}%`,
    width: `${element.width}%`,
    height: `${element.height}%`,
    color: element.color,
    backgroundColor: element.kind === 'text' || element.kind === 'image' && element.imageDataUrl
      ? (element.kind === 'text' ? 'transparent' : element.background)
      : element.background,
    fontSize: `${(element.fontSize / 1280 * 100).toFixed(3)}cqw`,
    fontWeight: String(element.fontWeight),
    textAlign: element.textAlign,
    justifyContent: element.textAlign === 'left' ? 'flex-start' : element.textAlign === 'right' ? 'flex-end' : 'center',
    opacity: String(element.opacity),
    borderRadius: `${element.borderRadius}px`,
  }
}

function beginElementDrag(event: PointerEvent, element: UIElementDefinition): void {
  if (previewMode.value || event.button !== 0 || !activeScreen.value) return
  const stage = canvasStage.value
  if (!stage) return
  const bounds = stage.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  event.preventDefault()
  event.stopPropagation()
  selectedElementId.value = element.id
  dragState.value = {
    id: element.id,
    startX: event.clientX,
    startY: event.clientY,
    originX: element.x,
    originY: element.y,
    width: bounds.width,
    height: bounds.height,
  }
  window.addEventListener('pointermove', moveElement)
  window.addEventListener('pointerup', finishElementDrag)
  window.addEventListener('pointercancel', finishElementDrag)
}

function moveElement(event: PointerEvent): void {
  const drag = dragState.value
  const element = activeScreen.value?.elements.find(item => item.id === drag?.id)
  if (!drag || !element) return
  const x = drag.originX + (event.clientX - drag.startX) / drag.width * 100
  const y = drag.originY + (event.clientY - drag.startY) / drag.height * 100
  Object.assign(element, getClampedUIElementPosition(element, x, y, snapToGrid.value, 2.5))
}

function finishElementDrag(): void {
  dragState.value = null
  window.removeEventListener('pointermove', moveElement)
  window.removeEventListener('pointerup', finishElementDrag)
  window.removeEventListener('pointercancel', finishElementDrag)
}

function chooseImage(): void {
  if (!selectedElement.value || selectedElement.value.kind !== 'image') return
  imageTargetId.value = selectedElement.value.id
  imageInput.value?.click()
}

function importImage(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const id = imageTargetId.value
  input.value = ''
  if (!file || !id) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    statusMessage.value = 'Use uma imagem PNG, JPG ou WebP.'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    statusMessage.value = 'A imagem deve ter no máximo 5 MB.'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const element = activeScreen.value?.elements.find(item => item.id === id)
    if (!element || typeof reader.result !== 'string') return
    element.imageDataUrl = reader.result
    element.text = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imagem'
    statusMessage.value = `Imagem “${file.name}” adicionada. Salve o projeto para incluí-la no arquivo.`
  }
  reader.onerror = () => { statusMessage.value = 'Não foi possível ler esta imagem.' }
  reader.readAsDataURL(file)
}

function activatePreviewElement(element: UIElementDefinition): void {
  if (!previewMode.value || element.kind !== 'button') return
  if (element.action === 'navigate-screen') {
    const target = uiWorkspaceState.screens.find(screen => screen.id === element.targetScreenId)
    if (target) {
      uiWorkspaceState.activeScreenId = target.id
      statusMessage.value = `Prévia: abriu “${target.name}”.`
    } else {
      statusMessage.value = 'Escolha uma tela de destino nas propriedades do botão.'
    }
  } else if (element.action === 'set-variable') {
    statusMessage.value = `Prévia: o botão definiria “${element.variableName || 'variável'}” como “${element.variableValue}” durante o jogo.`
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyboardShortcut))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyboardShortcut)
  finishElementDrag()
})
</script>

<template>
  <section class="ui-workspace" aria-label="Workspace de interface do jogo">
    <header class="ui-workspace-header">
      <div class="ui-workspace-brand">
        <span class="ui-workspace-icon">UI</span>
        <div><strong>Workspace de UI</strong><small>{{ projectName || 'Projeto atual' }} · Menus, HUDs e telas 2D</small></div>
      </div>
      <div class="ui-workspace-header-actions">
        <span class="ui-save-hint"><i /> {{ statusMessage }}</span>
        <button type="button" class="ui-header-button" @click="previewMode = !previewMode">{{ previewMode ? 'Voltar a editar' : 'Prévia' }}</button>
        <button type="button" class="ui-close-button" aria-label="Fechar Workspace de UI" title="Voltar ao editor 3D" @click="emit('close')">×</button>
      </div>
    </header>

    <div class="ui-workspace-body">
      <aside class="ui-left-panel">
        <div class="ui-panel-heading"><span>TELAS</span><button type="button" title="Criar tela" aria-label="Criar tela" @click="createScreen">＋</button></div>
        <button
          v-for="screen in uiWorkspaceState.screens"
          :key="screen.id"
          type="button"
          class="ui-screen-row"
          :class="{ active: screen.id === uiWorkspaceState.activeScreenId }"
          @click="uiWorkspaceState.activeScreenId = screen.id"
        >
          <span class="ui-screen-row-icon">▱</span>
          <span class="ui-screen-row-label"><strong>{{ screen.name }}</strong><small>{{ screen.width }} × {{ screen.height }}</small></span>
          <span v-if="screen.enabledInGame" class="ui-live-dot" title="Ativa durante o jogo" />
        </button>
        <button type="button" class="ui-add-screen" @click="createScreen">＋ Nova tela</button>
        <section class="ui-template-section" aria-label="Modelos de interface">
          <div class="ui-panel-heading"><span>MODELOS PRONTOS</span></div>
          <button
            v-for="preset in UI_SCREEN_PRESETS"
            :key="preset.id"
            type="button"
            class="ui-template-button"
            @click="addPreset(preset.id)"
          >
            <strong>{{ preset.name }}</strong>
            <small>{{ preset.description }}</small>
          </button>
        </section>
        <div class="ui-left-footer">
          <strong>Como funciona</strong>
          <p>Crie várias telas e conecte botões para navegar entre elas. As telas são gravadas no projeto em <code>ui/screens.json</code>.</p>
        </div>
      </aside>

      <main class="ui-center-panel">
        <div v-if="activeScreen" class="ui-canvas-toolbar">
          <div class="ui-canvas-title"><strong>{{ activeScreen.name }}</strong><small>{{ activeScreen.width }} × {{ activeScreen.height }} · 16:9</small></div>
          <div class="ui-widget-actions" aria-label="Adicionar elemento">
            <button type="button" :disabled="previewMode" @click="addElement('text')">T Texto</button>
            <button type="button" :disabled="previewMode" @click="addElement('button')">▣ Botão</button>
            <button type="button" :disabled="previewMode" @click="addElement('panel')">▤ Painel</button>
            <button type="button" :disabled="previewMode" @click="addElement('image')">▧ Imagem</button>
            <button type="button" :disabled="previewMode" @click="addElement('progress')">▰ Barra</button>
          </div>
          <div class="ui-canvas-options">
            <label title="Mostrar ou ocultar a grade visual"><input v-model="showGrid" type="checkbox" :disabled="previewMode" /> Grade</label>
            <label title="Alinhar os elementos à grade de 2,5% durante o arraste"><input v-model="snapToGrid" type="checkbox" :disabled="previewMode" /> Encaixar</label>
          </div>
        </div>
        <div v-if="selectedElement && !previewMode" class="ui-selection-toolbar" aria-label="Ações do elemento selecionado">
          <span>{{ selectedElement.name }}</span>
          <button type="button" title="Duplicar (Ctrl+D)" @click="duplicateElement">Duplicar</button>
          <button type="button" title="Trazer uma camada para frente" :disabled="activeElementIndex >= (activeScreen?.elements.length ?? 0) - 1" @click="moveSelectedLayer('front')">↑ Frente</button>
          <button type="button" title="Enviar uma camada para trás" :disabled="activeElementIndex <= 0" @click="moveSelectedLayer('back')">↓ Atrás</button>
          <button type="button" title="Centralizar horizontalmente" @click="alignSelected('horizontal')">↔ Centro X</button>
          <button type="button" title="Centralizar verticalmente" @click="alignSelected('vertical')">↕ Centro Y</button>
        </div>

        <div v-if="activeScreen" class="ui-canvas-area">
          <div class="ui-screen-stage-wrap">
            <div
              ref="canvasStage"
              class="ui-screen-stage"
              :class="{ 'is-previewing': previewMode, 'grid-visible': showGrid }"
              :style="{ backgroundColor: activeScreen.background }"
            >
              <div class="ui-stage-grid" aria-hidden="true" />
              <div
                v-for="element in activeScreen.elements"
                :key="element.id"
                class="ui-design-element"
                :class="['kind-' + element.kind, { selected: !previewMode && selectedElementId === element.id, hidden: element.kind === 'panel' && !element.text }]"
                :style="elementStyle(element)"
                @pointerdown="beginElementDrag($event, element)"
                @click.stop="previewMode ? activatePreviewElement(element) : selectElement(element.id)"
              >
                <template v-if="element.kind === 'panel'">
                  <span v-if="element.text" class="ui-element-label">{{ element.text }}</span>
                </template>
                <template v-else-if="element.kind === 'image'">
                  <img v-if="element.imageDataUrl" :src="element.imageDataUrl" :alt="element.name" :style="{ objectFit: element.imageFit }" />
                  <span v-else class="ui-image-placeholder">▧<small>Importar imagem</small></span>
                </template>
                <template v-else-if="element.kind === 'progress'">
                  <span class="ui-progress-fill" :style="{ width: '68%', backgroundColor: element.color }" />
                  <span class="ui-progress-caption">{{ element.text || element.variableName }}</span>
                </template>
                <template v-else-if="element.kind === 'button'">
                  <button type="button" tabindex="-1" class="ui-preview-button" :style="{ color: element.color, backgroundColor: element.background, borderRadius: element.borderRadius + 'px', fontSize: 'inherit', fontWeight: element.fontWeight, textAlign: element.textAlign }">{{ element.text || 'Botão' }}</button>
                </template>
                <template v-else><span class="ui-element-label">{{ element.text }}</span></template>
                <span v-if="!previewMode && selectedElementId === element.id" class="ui-selection-box"><i /><i /><i /><i /></span>
              </div>
              <div v-if="!activeScreen.elements.length" class="ui-empty-canvas">
                <span>＋</span><strong>Sua tela começa aqui</strong><small>Adicione textos, botões, painéis, imagens ou barras no topo.</small>
              </div>
              <div class="ui-screen-dimensions">{{ activeScreen.width }} × {{ activeScreen.height }}</div>
            </div>
          </div>
          <p class="ui-canvas-tip">{{ previewMode ? 'Prévia interativa: botões podem navegar para outra tela.' : 'Arraste para posicionar. Setas movem, Shift+setas movem mais, Ctrl+D duplica e Delete remove. Encaixar adere à grade.' }}</p>
        </div>

        <div v-else class="ui-empty-workspace">
          <div class="ui-empty-workspace-icon">UI</div>
          <h2>Crie sua primeira interface</h2>
          <p>Monte menus principais, telas de pausa, diálogos, HUDs e barras de estado por meio de elementos visuais.</p>
          <button type="button" @click="createScreen">＋ Criar primeira tela</button>
        </div>
      </main>

      <aside class="ui-right-panel">
        <section class="ui-inspector-section">
          <div class="ui-panel-heading"><span>PROPRIEDADES DA TELA</span></div>
          <template v-if="activeScreen">
            <label class="ui-field">Nome
              <input v-model="activeScreen.name" maxlength="80" />
            </label>
            <label class="ui-field">Tipo de tela
              <select v-model="activeScreen.displayMode">
                <option value="screen">Tela navegável · menu, pausa ou diálogo</option>
                <option value="overlay">Overlay persistente · HUD</option>
              </select>
            </label>
            <label class="ui-field">Cor de fundo
              <span class="ui-color-field"><input v-model="activeScreen.background" type="color" /><input v-model="activeScreen.background" maxlength="7" /></span>
            </label>
            <label class="ui-check-field"><input v-model="activeScreen.enabledInGame" type="checkbox" /><span><strong>Ativa no jogo</strong><small>Inclui esta tela na interface durante o modo Jogar.</small></span></label>
            <div class="ui-inspector-actions">
              <button type="button" @click="duplicateScreen">Duplicar tela</button>
              <button type="button" class="danger" @click="deleteScreen">Excluir</button>
            </div>
          </template>
          <p v-else class="ui-inspector-empty">Crie uma tela para editar suas propriedades.</p>
        </section>

        <section class="ui-inspector-section ui-hierarchy-section">
          <div class="ui-panel-heading"><span>HIERARQUIA</span><span class="ui-count">{{ activeScreen?.elements.length ?? 0 }}</span></div>
          <button
            v-for="element in activeScreen?.elements ?? []"
            :key="element.id"
            type="button"
            class="ui-element-row"
            :class="{ active: selectedElementId === element.id && !previewMode }"
            @click="selectElement(element.id)"
          >
            <span class="ui-element-kind">{{ element.kind === 'text' ? 'T' : element.kind === 'button' ? '▣' : element.kind === 'panel' ? '▤' : element.kind === 'image' ? '▧' : '▰' }}</span>
            <span>{{ element.name }}</span>
            <span class="ui-element-position">{{ Math.round(element.x) }}%, {{ Math.round(element.y) }}%</span>
          </button>
          <p v-if="activeScreen && !activeScreen.elements.length" class="ui-inspector-empty">Nenhum elemento nesta tela.</p>
        </section>

        <section class="ui-inspector-section ui-element-properties">
          <div class="ui-panel-heading"><span>ELEMENTO SELECIONADO</span><button v-if="selectedElement && !previewMode" type="button" class="ui-delete-element" title="Remover elemento" @click="removeElement()">×</button></div>
          <template v-if="selectedElement && !previewMode">
            <label class="ui-field">Nome interno
              <input v-model="selectedElement.name" maxlength="80" />
            </label>
            <label v-if="selectedElement.kind !== 'image'" class="ui-field">Texto / rótulo
              <input v-model="selectedElement.text" maxlength="240" />
            </label>
            <div class="ui-two-fields">
              <label class="ui-field">X · %
                <input v-model.number="selectedElement.x" type="number" min="0" max="99" step="1" />
              </label>
              <label class="ui-field">Y · %
                <input v-model.number="selectedElement.y" type="number" min="0" max="99" step="1" />
              </label>
            </div>
            <div class="ui-two-fields">
              <label class="ui-field">Largura · %
                <input v-model.number="selectedElement.width" type="number" min="1" max="100" step="1" />
              </label>
              <label class="ui-field">Altura · %
                <input v-model.number="selectedElement.height" type="number" min="1" max="100" step="1" />
              </label>
            </div>
            <div v-if="selectedElement.kind !== 'image'" class="ui-two-fields">
              <label class="ui-field">Tamanho da fonte
                <input v-model.number="selectedElement.fontSize" type="number" min="8" max="96" step="1" />
              </label>
              <label class="ui-field">Raio da borda
                <input v-model.number="selectedElement.borderRadius" type="number" min="0" max="48" step="1" />
              </label>
            </div>
            <div v-if="selectedElement.kind !== 'image'" class="ui-two-fields">
              <label class="ui-field">Alinhamento do texto
                <select v-model="selectedElement.textAlign">
                  <option value="left">À esquerda</option>
                  <option value="center">Centralizado</option>
                  <option value="right">À direita</option>
                </select>
              </label>
              <label class="ui-field">Peso da fonte
                <select v-model.number="selectedElement.fontWeight">
                  <option :value="400">Normal · 400</option>
                  <option :value="500">Médio · 500</option>
                  <option :value="600">Seminegrito · 600</option>
                  <option :value="700">Negrito · 700</option>
                  <option :value="800">Extra negrito · 800</option>
                </select>
              </label>
            </div>
            <label class="ui-field">Opacidade · {{ Math.round(selectedElement.opacity * 100) }}%
              <input v-model.number="selectedElement.opacity" type="range" min="0" max="1" step="0.05" />
            </label>
            <label v-if="selectedElement.kind !== 'image'" class="ui-field">Cor do texto / preenchimento
              <span class="ui-color-field"><input v-model="selectedElement.color" type="color" /><input v-model="selectedElement.color" maxlength="9" /></span>
            </label>
            <label v-if="selectedElement.kind !== 'text'" class="ui-field">Cor de fundo
              <span class="ui-color-field"><input v-model="selectedElement.background" type="color" /><input v-model="selectedElement.background" maxlength="9" /></span>
            </label>
            <template v-if="selectedElement.kind === 'image'">
              <label class="ui-field">Ajuste da imagem
                <select v-model="selectedElement.imageFit">
                  <option value="contain">Conter · sem cortes</option>
                  <option value="cover">Cobrir · preencher com corte</option>
                  <option value="fill">Esticar · preencher tudo</option>
                </select>
              </label>
              <button type="button" class="ui-image-picker" @click="chooseImage">{{ selectedElement.imageDataUrl ? 'Trocar imagem' : '＋ Importar imagem' }}</button>
              <small class="ui-field-help">PNG, JPG ou WebP. Limite de 5 MB por arquivo.</small>
            </template>
            <template v-if="selectedElement.kind === 'progress'">
              <label class="ui-field">Variável global
                <input v-model="selectedElement.variableName" list="ui-global-variable-list" maxlength="80" placeholder="vida" />
              </label>
              <datalist id="ui-global-variable-list"><option value="vida" /><option value="mana" /><option value="stamina" /></datalist>
              <label class="ui-field">Valor máximo
                <input v-model.number="selectedElement.variableMax" type="number" min="1" max="1000000" />
              </label>
            </template>
            <template v-if="selectedElement.kind === 'button'">
              <label class="ui-field">Ao clicar
                <select v-model="selectedElement.action">
                  <option value="none">Nenhuma ação</option>
                  <option value="navigate-screen">Abrir outra tela</option>
                  <option value="set-variable">Definir variável global</option>
                </select>
              </label>
              <label v-if="selectedElement.action === 'navigate-screen'" class="ui-field">Tela de destino
                <select v-model="selectedElement.targetScreenId">
                  <option value="">Selecione uma tela</option>
                  <option v-for="screen in uiWorkspaceState.screens" :key="screen.id" :value="screen.id">{{ screen.name }}</option>
                </select>
              </label>
              <template v-if="selectedElement.action === 'set-variable'">
                <label class="ui-field">Nome da variável
                  <input v-model="selectedElement.variableName" maxlength="80" placeholder="menu_confirmado" />
                </label>
                <label class="ui-field">Valor
                  <input v-model="selectedElement.variableValue" maxlength="100" placeholder="true" />
                </label>
              </template>
            </template>
          </template>
          <p v-else class="ui-inspector-empty">{{ previewMode ? 'Saia da prévia para editar os elementos.' : 'Selecione um elemento na tela ou na hierarquia.' }}</p>
        </section>
      </aside>
    </div>
    <input ref="imageInput" class="ui-hidden-input" type="file" accept="image/png,image/jpeg,image/webp" @change="importImage" />
  </section>
</template>

<style scoped src="./UIWorkspace.css"></style>
