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
  { key: 'interact', label: 'Interagir / montar / desmontar', group: 'Ações' },
  { key: 'primaryAction', label: 'Ação principal (gatilho de evento)', group: 'Ações' },
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
type ActionGroup = 'Movimento' | 'Postura e manobras' | 'Ações' | 'Câmera e jogo'
const activeGroup = ref<ActionGroup>('Movimento')
const groupedActions = computed(() => actions.filter(action => action.group === activeGroup.value))

watch(() => props.settings.activeProfileId, () => {
  nameDraft.value = activeProfile.value?.name ?? ''
  capturingAction.value = null
  message.value = ''
}, { immediate: true })

function selectGroup(group: string) {
  if (group === 'Movimento' || group === 'Postura e manobras' || group === 'Ações' || group === 'Câmera e jogo') {
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
  message.value = `Pressione a tecla desejada para “${actions.find(item => item.key === action)?.label ?? action}”. Esc cancela.`
}

function keyLabel(code: string): string {
  const labels: Record<string, string> = {
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

function onCaptureKey(event: KeyboardEvent) {
  if (!capturingAction.value || !props.open) return
  event.preventDefault()
  event.stopPropagation()
  if (event.code === 'Escape') {
    capturingAction.value = null
    message.value = 'Alteração de tecla cancelada.'
    return
  }
  if (['MetaLeft', 'MetaRight'].includes(event.code) || ((event.ctrlKey || event.altKey) && !['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(event.code))) {
    message.value = 'Escolha uma tecla individual. Combinações com Ctrl/Alt ainda não são suportadas.'
    return
  }

  const action = capturingAction.value
  const profile = activeProfile.value
  const conflict = actions.find(item => item.key !== action && profile.bindings[item.key] === event.code)
  if (conflict) {
    message.value = `Essa tecla já está atribuída a “${conflict.label}”. Escolha outra tecla.`
    return
  }

  publish({
    ...props.settings,
    profiles: props.settings.profiles.map(item =>
      item.id === profile.id
        ? { ...item, bindings: { ...item.bindings, [action]: event.code } }
        : item,
    ),
  })
  capturingAction.value = null
  message.value = `Tecla definida: ${keyLabel(event.code)}.`
}

onMounted(() => window.addEventListener('keydown', onCaptureKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onCaptureKey, true))
</script>

<template>
  <div v-if="open" class="controls-overlay" role="presentation" @click.self="close">
    <section class="controls-dialog" role="dialog" aria-modal="true" aria-labelledby="controls-title">
      <header class="controls-header">
        <div>
          <div class="eyebrow">PREFERÊNCIAS DE ENTRADA</div>
          <h2 id="controls-title">Mapas de controles</h2>
          <p>Escolha um perfil pronto ou monte seu próprio conjunto de teclas.</p>
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
        <button v-for="group in ['Movimento', 'Postura e manobras', 'Ações', 'Câmera e jogo']" :key="group" :class="{ active: activeGroup === group }" :title="`Mostra os vínculos de teclado de: ${group.toLocaleLowerCase('pt-BR')}.`" @click="selectGroup(group)">
          {{ group }}
        </button>
      </nav>

      <div class="bindings-list">
        <div v-for="action in groupedActions" :key="action.key" class="binding-row">
          <div class="binding-label">
            <strong>{{ action.label }}</strong>
            <small v-if="action.key === 'interact'">Também pode acionar pacotes de comportamento, como montarias.</small>
          </div>
          <button class="key-button" :class="{ capturing: capturingAction === action.key }" :title="capturingAction === action.key ? 'Pressione a nova tecla ou combinação para esta ação.' : 'Clique para trocar a tecla de: ' + action.label + '.'" @click="startCapture(action.key)">
            {{ capturingAction === action.key ? 'Pressione uma tecla…' : keyLabel(activeProfile.bindings[action.key]) }}
            <span>{{ capturingAction === action.key ? 'Esc cancela' : 'Alterar' }}</span>
          </button>
        </div>
      </div>

      <div class="controls-message" aria-live="polite">{{ message || 'As alterações são salvas automaticamente neste computador.' }}</div>

      <footer class="controls-footer">
        <span>Movimentos funcionam no jogo; ações marcadas como gatilho podem ativar regras key_pressed. Inventário e combate precisam de lógica/sistemas próprios.</span>
        <button class="secondary-button" title="Restaura os vínculos padrão do mapa atual." @click="restoreBindings">Restaurar teclas</button>
        <button class="primary-button" title="Fecha a janela de controles; as alterações já são aplicadas ao mapa." @click="close">Concluído</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.controls-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(6, 8, 12, 0.74);
}
.controls-dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: min(780px, calc(100vh - 36px));
  overflow: hidden;
  border: 1px solid #303744;
  border-radius: 9px;
  background: #151922;
  color: #e4e8ef;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.5);
}
.controls-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid #2b313d;
}
.eyebrow {
  color: #de947e;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.13em;
}
.controls-header h2 {
  margin: 7px 0 4px;
  font-size: 21px;
  font-weight: 650;
}
.controls-header p {
  margin: 0;
  color: #9aa3b2;
  font-size: 12px;
}
.icon-button {
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid #333b48;
  border-radius: 5px;
  background: #1d222c;
  color: #d6dbe4;
  font-size: 21px;
  cursor: pointer;
}
.profile-tools {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  padding: 16px 24px 12px;
}
.profile-select, .profile-name label {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  color: #a5adbb;
  font-size: 10px;
  font-weight: 700;
}
.profile-select select, .profile-name input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid #343c49;
  border-radius: 5px;
  outline: none;
  background: #10141b;
  color: #e5e9f0;
  font: inherit;
  font-size: 12px;
}
.profile-select select:focus, .profile-name input:focus {
  border-color: #bd705c;
}
.profile-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.primary-button, .secondary-button, .danger-button {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid #3a424f;
  border-radius: 5px;
  background: #202631;
  color: #d9dee7;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.primary-button {
  border-color: #9f5748;
  background: #8f4b3e;
  color: #fff2ed;
}
.danger-button {
  border-color: #684047;
  color: #ffb7b4;
}
.primary-button:hover, .secondary-button:hover, .danger-button:hover {
  filter: brightness(1.12);
}
.profile-name {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 0 24px 15px;
}
.control-tabs {
  display: flex;
  gap: 5px;
  padding: 0 24px;
  border-bottom: 1px solid #2b313d;
}
.control-tabs button {
  padding: 10px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #9aa3b2;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.control-tabs button.active {
  border-bottom-color: #d17b64;
  color: #f1c4b6;
}
.bindings-list {
  min-height: 150px;
  overflow: auto;
  padding: 6px 24px;
}
.binding-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 50px;
  border-bottom: 1px solid #262c36;
}
.binding-label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.binding-label strong {
  font-size: 11px;
  font-weight: 600;
}
.binding-label small {
  color: #8590a0;
  font-size: 10px;
  line-height: 1.4;
}
.key-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 140px;
  padding: 8px 10px;
  border: 1px solid #404957;
  border-radius: 5px;
  background: #202632;
  color: #f0f2f6;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.key-button span {
  color: #9ba5b5;
  font-size: 9px;
}
.key-button.capturing {
  border-color: #d17b64;
  background: #34231f;
  color: #ffd0c3;
}
.controls-message {
  min-height: 16px;
  padding: 8px 24px;
  color: #dda18e;
  font-size: 10px;
}
.controls-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px 16px;
  border-top: 1px solid #2b313d;
}
.controls-footer span {
  flex: 1;
  color: #8e98a7;
  font-size: 10px;
  line-height: 1.5;
}
@media (max-width: 600px) {
  .controls-overlay { padding: 8px; }
  .controls-header, .profile-tools, .profile-name, .bindings-list { padding-left: 14px; padding-right: 14px; }
  .profile-tools { align-items: stretch; flex-direction: column; }
  .controls-footer { align-items: stretch; flex-wrap: wrap; padding-left: 14px; padding-right: 14px; }
  .controls-footer span { flex-basis: 100%; }
  .control-tabs { padding: 0 14px; }
  .control-tabs button { padding: 10px 7px; }
  .key-button { min-width: 120px; }
}
</style>
