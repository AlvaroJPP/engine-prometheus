<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_CONTROL_MAPS } from '@engine'
import type { ControlMapBindings, ControlMapProfile, ControlMapSettings } from '@engine'

const props = defineProps<{
  open: boolean
  settings: ControlMapSettings
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:settings': [value: ControlMapSettings]
}>()

type ActionKey = keyof ControlMapBindings

const actions: Array<{ key: ActionKey; label: string; group: ActionGroup }> = [
  { key: 'forward', label: 'Mover para frente', group: 'Movimento' },
  { key: 'backward', label: 'Mover para trás', group: 'Movimento' },
  { key: 'left', label: 'Mover para a esquerda', group: 'Movimento' },
  { key: 'right', label: 'Mover para a direita', group: 'Movimento' },
  { key: 'run', label: 'Correr enquanto segura', group: 'Movimento' },
  { key: 'sprintToggle', label: 'Ativar/desativar sprint', group: 'Movimento' },
  { key: 'walkToggle', label: 'Ativar/desativar caminhada lenta', group: 'Movimento' },
  { key: 'jump', label: 'Pular', group: 'Movimento' },
  { key: 'crouchToggle', label: 'Agachar / levantar', group: 'Postura e manobras' },
  { key: 'proneToggle', label: 'Deitar / rastejar', group: 'Postura e manobras' },
  { key: 'dodge', label: 'Esquiva rápida', group: 'Postura e manobras' },
  { key: 'slide', label: 'Deslizar', group: 'Postura e manobras' },
  { key: 'roll', label: 'Rolamento evasivo', group: 'Postura e manobras' },
  { key: 'block', label: 'Bloquear / defender', group: 'Combate' },
  { key: 'parry', label: 'Aparo no tempo certo', group: 'Combate' },
  { key: 'targetLock', label: 'Travar / destravar alvo', group: 'Combate' },
  { key: 'interact', label: 'Interagir / montar / desmontar', group: 'Ações' },
  { key: 'primaryAction', label: 'Ataque principal (clique esquerdo ou F)', group: 'Combate' },
  { key: 'secondaryAction', label: 'Ação secundária (gatilho de evento)', group: 'Ações' },
  { key: 'inventory', label: 'Inventário (gatilho de evento)', group: 'Ações' },
  { key: 'useItem', label: 'Usar item (gatilho de evento)', group: 'Ações' },
  { key: 'reload', label: 'Recarregar (gatilho de evento)', group: 'Ações' },
  { key: 'ability1', label: 'Habilidade 1 (gatilho de evento)', group: 'Ações' },
  { key: 'ability2', label: 'Habilidade 2 (gatilho de evento)', group: 'Ações' },
  { key: 'ability3', label: 'Habilidade 3 (gatilho de evento)', group: 'Ações' },
  { key: 'ability4', label: 'Habilidade 4 (gatilho de evento)', group: 'Ações' },
  { key: 'emote', label: 'Emote (gatilho de evento)', group: 'Ações' },
  { key: 'toggleFirstPerson', label: 'Alternar primeira pessoa', group: 'Câmera e jogo' },
  { key: 'cycleCamera', label: 'Alternar câmera', group: 'Câmera e jogo' },
  { key: 'exitRuntime', label: 'Voltar ao editor', group: 'Câmera e jogo' },
]

const activeProfile = computed(() =>
  props.settings.profiles.find(profile => profile.id === props.settings.activeProfileId)
  ?? props.settings.profiles[0]
  ?? DEFAULT_CONTROL_MAPS[0]!,
)
const nameDraft = ref('')
const capturingAction = ref<ActionKey | null>(null)
const message = ref('')
type ActionGroup = 'Movimento' | 'Postura e manobras' | 'Combate' | 'Ações' | 'Câmera e jogo'
const activeGroup = ref<ActionGroup>('Movimento')
const groupedActions = computed(() => actions.filter(action => action.group === activeGroup.value))

watch(() => props.settings.activeProfileId, () => {
  nameDraft.value = activeProfile.value?.name ?? ''
  capturingAction.value = null
  message.value = ''
}, { immediate: true })

function selectGroup(group: string) {
  if (group === 'Movimento' || group === 'Postura e manobras' || group === 'Combate' || group === 'Ações' || group === 'Câmera e jogo') {
    activeGroup.value = group
  }
}

function publish(next: ControlMapSettings) {
  emit('update:settings', next)
}

function close() {
  capturingAction.value = null
  emit('update:open', false)
}

function selectProfile(id: string) {
  if (!props.settings.profiles.some(profile => profile.id === id)) return
  publish({ ...props.settings, activeProfileId: id })
}

function uniqueId() {
  const base = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `custom-${base}`
}

function createProfile() {
  const count = props.settings.profiles.filter(profile => !profile.builtIn).length + 1
  const profile: ControlMapProfile = {
    id: uniqueId(),
    name: `Meu mapa ${count}`,
    bindings: { ...activeProfile.value.bindings },
  }
  publish({
    profiles: [...props.settings.profiles, profile],
    activeProfileId: profile.id,
  })
  activeGroup.value = 'Movimento'
  message.value = 'Novo mapa criado a partir das teclas do perfil atual. Personalize-o abaixo.'
}

function duplicateProfile() {
  createProfile()
}

function saveName() {
  const name = nameDraft.value.trim().slice(0, 48)
  if (!name) {
    message.value = 'Digite um nome para o mapa.'
    return
  }
  const duplicate = props.settings.profiles.some(profile =>
    profile.id !== activeProfile.value.id && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  )
  if (duplicate) {
    message.value = 'Já existe um mapa com esse nome.'
    return
  }
  publish({
    ...props.settings,
    profiles: props.settings.profiles.map(profile =>
      profile.id === activeProfile.value.id ? { ...profile, name } : profile,
    ),
  })
  message.value = 'Nome salvo.'
}

function deleteProfile() {
  const profile = activeProfile.value
  if (profile.builtIn) return
  const profiles = props.settings.profiles.filter(item => item.id !== profile.id)
  const fallback = profiles.find(item => item.id === 'wasd') ?? profiles[0] ?? DEFAULT_CONTROL_MAPS[0]!
  publish({
    profiles: profiles.length ? profiles : DEFAULT_CONTROL_MAPS.map(item => ({ ...item, bindings: { ...item.bindings } })),
    activeProfileId: fallback.id,
  })
  message.value = 'Mapa personalizado excluído.'
}

function restoreBindings() {
  const profile = activeProfile.value
  const original = DEFAULT_CONTROL_MAPS.find(item => item.id === profile.id)
  const bindings = original?.bindings ?? DEFAULT_CONTROL_MAPS[0]!.bindings
  publish({
    ...props.settings,
    profiles: props.settings.profiles.map(item =>
      item.id === profile.id ? { ...item, bindings: { ...bindings } } : item,
    ),
  })
  capturingAction.value = null
  message.value = original ? 'Teclas originais deste perfil restauradas.' : 'Teclas restauradas para o padrão WASD.'
}

function startCapture(action: ActionKey) {
  capturingAction.value = action
  message.value = `Pressione uma tecla ou clique em um botão do mouse para “${actions.find(item => item.key === action)?.label ?? action}”. Esc cancela.`
}

function mouseButtonCode(button: number): string | null {
  const codes: Record<number, string> = {
    0: 'MouseLeft',
    1: 'MouseMiddle',
    2: 'MouseRight',
    3: 'MouseBack',
    4: 'MouseForward',
  }
  return codes[button] ?? null
}

function keyLabel(code: string): string {
  const labels: Record<string, string> = {
    MouseLeft: 'Mouse esquerdo',
    MouseRight: 'Mouse direito',
    MouseMiddle: 'Mouse do meio',
    MouseBack: 'Mouse voltar',
    MouseForward: 'Mouse avançar',
    Space: 'Espaço',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'Shift esquerdo',
    ShiftRight: 'Shift direito',
    ControlLeft: 'Ctrl esquerdo',
    ControlRight: 'Ctrl direito',
    AltLeft: 'Alt esquerdo',
    AltRight: 'Alt direito',
    Enter: 'Enter',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
  }
  if (labels[code]) return labels[code]
  if (code === 'CapsLock') return 'Caps Lock'
  if (code === 'F10') return 'F10'
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return code
}

function applyCapturedBinding(code: string): void {
  const action = capturingAction.value
  if (!action) return
  const profile = activeProfile.value
  const conflict = actions.find(item => item.key !== action && profile.bindings[item.key] === code)
  if (conflict) {
    message.value = `Esse controle já está atribuído a “${conflict.label}”. Escolha outro.`
    return
  }

  publish({
    ...props.settings,
    profiles: props.settings.profiles.map(item =>
      item.id === profile.id
        ? { ...item, bindings: { ...item.bindings, [action]: code } }
        : item,
    ),
  })
  capturingAction.value = null
  message.value = `Controle definido: ${keyLabel(code)}.`
}

function onCaptureKey(event: KeyboardEvent) {
  if (!capturingAction.value || !props.open) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  if (event.code === 'Escape') {
    capturingAction.value = null
    message.value = 'Alteração de controle cancelada.'
    return
  }
  if (['MetaLeft', 'MetaRight'].includes(event.code) || ((event.ctrlKey || event.altKey) && !['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(event.code))) {
    message.value = 'Escolha uma tecla individual. Combinações com Ctrl/Alt ainda não são suportadas.'
    return
  }
  applyCapturedBinding(event.code)
}

function onCapturePointerDown(event: PointerEvent): void {
  if (!capturingAction.value || !props.open || event.pointerType !== 'mouse') return
  const code = mouseButtonCode(event.button)
  if (!code) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  applyCapturedBinding(code)
}

onMounted(() => {
  window.addEventListener('keydown', onCaptureKey, true)
  window.addEventListener('pointerdown', onCapturePointerDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCaptureKey, true)
  window.removeEventListener('pointerdown', onCapturePointerDown, true)
})
</script>

<template>
  <div v-if="open" class="controls-overlay" role="presentation" @click.self="close">
    <section class="controls-dialog" role="dialog" aria-modal="true" aria-labelledby="controls-title">
      <header class="controls-header">
        <div>
          <div class="eyebrow">PREFERÊNCIAS DE ENTRADA</div>
          <h2 id="controls-title">Mapas de controles</h2>
          <p>Escolha um perfil pronto ou monte seu próprio conjunto de controles, incluindo botões do mouse.</p>
        </div>
        <button class="icon-button" aria-label="Fechar mapas de controles" @click="close">×</button>
      </header>

      <div class="profile-tools">
        <label class="profile-select">
          <span>Perfil ativo</span>
          <select :value="activeProfile.id" title="Escolhe qual mapa de controles será usado durante o jogo." @change="selectProfile(($event.target as HTMLSelectElement).value)">
            <option v-for="profile in settings.profiles" :key="profile.id" :value="profile.id">
              {{ profile.name }}{{ profile.builtIn ? ' · integrado' : ' · personalizado' }}
            </option>
          </select>
        </label>
        <div class="profile-buttons">
          <button class="primary-button" title="Cria um mapa de controles personalizado com vínculos editáveis." @click="createProfile">＋ Criar mapa</button>
          <button class="secondary-button" title="Cria uma cópia independente do mapa selecionado." @click="duplicateProfile">Duplicar</button>
          <button v-if="!activeProfile.builtIn" class="danger-button" title="Exclui o mapa personalizado selecionado." @click="deleteProfile">Excluir</button>
        </div>
      </div>

      <div class="profile-name">
        <label>
          <span>Nome do mapa</span>
          <input v-model="nameDraft" maxlength="48" placeholder="Ex.: Controles do meu jogo" title="Digite o nome do mapa e pressione Enter ou use Salvar nome." @keydown.enter.prevent="saveName" />
        </label>
        <button class="secondary-button" title="Salva o nome novo do mapa de controles." @click="saveName">Salvar nome</button>
      </div>

      <nav class="control-tabs" aria-label="Categorias de comandos">
        <button v-for="group in ['Movimento', 'Postura e manobras', 'Combate', 'Ações', 'Câmera e jogo']" :key="group" :class="{ active: activeGroup === group }" :title="`Mostra os vínculos de teclado de: ${group.toLocaleLowerCase('pt-BR')}.`" @click="selectGroup(group)">
          {{ group }}
        </button>
      </nav>

      <div class="bindings-list">
        <div v-for="action in groupedActions" :key="action.key" class="binding-row">
          <div class="binding-label">
            <strong>{{ action.label }}</strong>
            <small v-if="action.key === 'interact'">Também pode acionar pacotes de comportamento, como montarias.</small>
          </div>
          <button class="key-button" :class="{ capturing: capturingAction === action.key }" :title="capturingAction === action.key ? 'Pressione uma tecla ou clique em um botão do mouse para esta ação.' : 'Clique para trocar o controle de: ' + action.label + '.'" @click="startCapture(action.key)">
            {{ capturingAction === action.key ? 'Aguardando tecla ou mouse…' : keyLabel(activeProfile.bindings[action.key]) }}
            <span>{{ capturingAction === action.key ? 'Esc cancela' : 'Alterar' }}</span>
          </button>
        </div>
      </div>

      <div class="controls-message" aria-live="polite">{{ message || 'As alterações são salvas automaticamente neste computador.' }}</div>

      <footer class="controls-footer">
        <span>Teclas e botões do mouse podem ser atribuídos a movimento e ações. Movimentos usam o controle enquanto estiver pressionado; as ações também podem disparar regras key_pressed.</span>
        <button class="secondary-button" title="Restaura os vínculos padrão do mapa atual." @click="restoreBindings">Restaurar teclas</button>
        <button class="primary-button" title="Fecha a janela de controles; as alterações já são aplicadas ao mapa." @click="close">Concluído</button>
      </footer>
    </section>
  </div>
</template>

<style scoped src="./ControlMapsDialog.css"></style>
