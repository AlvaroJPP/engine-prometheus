<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ControlMapProfile, PlayerSettings } from '@engine'

type PlayerWorkspaceTab = 'overview' | 'appearance' | 'movement' | 'collision' | 'camera' | 'controls'
type PlayerSettingKey = keyof PlayerSettings

const props = defineProps<{
  projectName: string
  dirty: boolean
  executionMode: 'edit' | 'running'
  playerModelName: string
  playerModelCustom: boolean
  playerModelHeight: number
  playerSettings: PlayerSettings
  activeControlMap: ControlMapProfile
  firstPersonMode: boolean
  cameraLabel: string
}>()

const emit = defineEmits<{
  close: []
  'open-model-import': []
  'reset-player-model': []
  'set-player-model-height': [value: number]
  'update-player-settings': [value: Partial<PlayerSettings>]
  'open-controls': []
  'toggle-first-person': []
  'cycle-camera': []
  'save-project': []
}>()

const activeTab = ref<PlayerWorkspaceTab>('overview')
const modelHeightDraft = ref(props.playerModelHeight)
const canEdit = computed(() => props.executionMode === 'edit')
const actualColliderRadius = computed(() =>
  Math.max(0.01, props.playerSettings.colliderRadius * (props.playerModelHeight / 1.8)),
)
const actualColliderDiameter = computed(() => actualColliderRadius.value * 2)
const estimatedRunSpeed = computed(() => props.playerSettings.walkSpeed * props.playerSettings.runMultiplier)
const tabs: Array<{ id: PlayerWorkspaceTab; title: string; description: string; icon: string }> = [
  { id: 'overview', title: 'Visão geral', description: 'Resumo do jogador', icon: '◫' },
  { id: 'appearance', title: 'Aparência', description: 'Modelo e escala', icon: '♟' },
  { id: 'movement', title: 'Movimento', description: 'Velocidade e salto', icon: '↗' },
  { id: 'collision', title: 'Colisão', description: 'Corpo físico', icon: '⬡' },
  { id: 'camera', title: 'Câmera', description: 'Perspectiva do jogador', icon: '◎' },
  { id: 'controls', title: 'Controles', description: 'Teclas e ações', icon: '⌘' },
]
const controlSummary: Array<{ key: keyof ControlMapProfile['bindings']; label: string }> = [
  { key: 'forward', label: 'Frente' },
  { key: 'backward', label: 'Trás' },
  { key: 'left', label: 'Esquerda' },
  { key: 'right', label: 'Direita' },
  { key: 'run', label: 'Correr' },
  { key: 'jump', label: 'Pular' },
  { key: 'interact', label: 'Interagir' },
]

watch(() => props.playerModelHeight, value => { modelHeightDraft.value = value })

function keyLabel(code: string | undefined): string {
  if (!code) return '—'
  const labels: Record<string, string> = {
    MouseLeft: 'Mouse Esq.',
    MouseRight: 'Mouse Dir.',
    MouseMiddle: 'Mouse Meio',
    Space: 'Espaço',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  }
  if (labels[code]) return labels[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return code
}

function updateSetting(key: PlayerSettingKey, value: number): void {
  if (!canEdit.value || !Number.isFinite(value)) return
  emit('update-player-settings', { [key]: value } as Partial<PlayerSettings>)
}

function applyPreset(preset: 'default' | 'action' | 'heavy'): void {
  if (!canEdit.value) return
  const presets: Record<typeof preset, PlayerSettings> = {
    default: { walkSpeed: 4.2, runMultiplier: 1.7, jumpSpeed: 6.2, gravity: 18, colliderRadius: 0.32 },
    action: { walkSpeed: 5.8, runMultiplier: 2.1, jumpSpeed: 7.8, gravity: 18, colliderRadius: 0.3 },
    heavy: { walkSpeed: 3.2, runMultiplier: 1.4, jumpSpeed: 4.8, gravity: 24, colliderRadius: 0.42 },
  }
  emit('update-player-settings', presets[preset])
}

function commitModelHeight(): void {
  if (!canEdit.value || !props.playerModelCustom) return
  const next = Number(modelHeightDraft.value)
  if (!Number.isFinite(next)) {
    modelHeightDraft.value = props.playerModelHeight
    return
  }
  const clamped = Math.min(10000, Math.max(0.1, next))
  modelHeightDraft.value = clamped
  if (Math.abs(clamped - props.playerModelHeight) > 0.001) emit('set-player-model-height', clamped)
}
</script>

<template>
  <div class="player-workspace-overlay" role="presentation" @click.self="emit('close')">
    <section class="player-workspace" role="dialog" aria-modal="true" aria-labelledby="player-workspace-title">
      <header class="player-workspace-header">
        <div class="player-workspace-brand">
          <div class="player-workspace-mark" aria-hidden="true">P</div>
          <div>
            <div class="player-workspace-eyebrow">ENGINE PROMETHEUS · PLAYER WORKSPACE</div>
            <h1 id="player-workspace-title">Configurar jogador</h1>
            <p>Aparência, movimento, colisor, câmera e controles em um único lugar.</p>
          </div>
        </div>
        <button class="player-workspace-close" type="button" aria-label="Fechar Workspace do Player" title="Fechar Workspace do Player" @click="emit('close')">×</button>
      </header>

      <div class="player-workspace-summary">
        <div class="player-summary-model">
          <div class="player-summary-avatar" aria-hidden="true">
            <svg viewBox="0 0 40 48" fill="none"><circle cx="20" cy="8" r="6" /><path d="M12 17Q20 13 28 17L31 31H26L27 44H21L20 32L19 44H13L14 31H9L12 17Z" /></svg>
          </div>
          <div class="player-summary-copy">
            <span>JOGADOR ATUAL</span>
            <strong>{{ playerModelName }}</strong>
            <small>{{ playerModelCustom ? `Modelo personalizado · ${playerModelHeight.toFixed(2)} u` : 'Modelo padrão · 1,80 u' }}</small>
          </div>
        </div>
        <div class="player-summary-chip">
          <span>PERFIL</span>
          <strong>{{ activeControlMap.name }}</strong>
        </div>
        <div class="player-summary-chip">
          <span>CÂMERA</span>
          <strong>{{ firstPersonMode ? 'Primeira pessoa' : cameraLabel }}</strong>
        </div>
        <div class="player-summary-chip">
          <span>ESTADO</span>
          <strong :class="{ 'player-workspace-warning': !canEdit }">{{ canEdit ? 'Pronto para configurar' : 'Execução ativa' }}</strong>
        </div>
      </div>

      <div class="player-workspace-body">
        <nav class="player-workspace-nav" aria-label="Seções de configuração do jogador">
          <div class="player-nav-label">CONFIGURAÇÃO</div>
          <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" :aria-current="activeTab === tab.id ? 'page' : undefined" @click="activeTab = tab.id">
            <span class="player-nav-icon" aria-hidden="true">{{ tab.icon }}</span>
            <span class="player-nav-copy"><strong>{{ tab.title }}</strong><small>{{ tab.description }}</small></span>
            <span v-if="activeTab === tab.id" class="player-nav-active" aria-hidden="true"></span>
          </button>
          <div class="player-nav-note">
            <span class="player-nav-note-dot"></span>
            <span>As configurações físicas são aplicadas ao personagem controlado em Jogar.</span>
          </div>
        </nav>

        <main class="player-workspace-content">
          <section v-if="activeTab === 'overview'" class="player-page">
            <div class="player-page-heading">
              <div><div class="player-section-eyebrow">RESUMO</div><h2>Seu personagem</h2><p>Configurações atuais que serão usadas durante a execução do jogo.</p></div>
            </div>
            <div class="player-overview-grid">
              <article class="player-card player-card-model">
                <div class="player-card-head"><span>APARÊNCIA</span><span class="player-card-icon">♟</span></div>
                <strong class="player-card-value">{{ playerModelCustom ? 'Modelo personalizado' : 'Personagem padrão' }}</strong>
                <p>{{ playerModelName }}</p>
                <div class="player-card-meta"><span>Altura</span><strong>{{ playerModelHeight.toFixed(2) }} unidades</strong></div>
                <button class="player-primary-button" :disabled="!canEdit" @click="activeTab = 'appearance'">Configurar aparência <span>→</span></button>
              </article>
              <article class="player-card">
                <div class="player-card-head"><span>MOVIMENTO</span><span class="player-card-icon">↗</span></div>
                <div class="player-stat-pair"><div><span>Caminhada</span><strong>{{ playerSettings.walkSpeed.toFixed(1) }} <small>u/s</small></strong></div><div><span>Corrida</span><strong>{{ estimatedRunSpeed.toFixed(1) }} <small>u/s</small></strong></div></div>
                <p>Salto {{ playerSettings.jumpSpeed.toFixed(1) }} · Gravidade {{ playerSettings.gravity.toFixed(1) }}</p>
                <button class="player-secondary-button" :disabled="!canEdit" @click="activeTab = 'movement'">Configurar movimento <span>→</span></button>
              </article>
              <article class="player-card">
                <div class="player-card-head"><span>COLISÃO</span><span class="player-card-icon">⬡</span></div>
                <strong class="player-card-value">Cápsula do jogador</strong>
                <p>Altura acompanha o modelo; raio ajustável independente da aparência.</p>
                <div class="player-card-meta"><span>Raio estimado</span><strong>{{ actualColliderRadius.toFixed(2) }} u</strong></div>
                <button class="player-secondary-button" :disabled="!canEdit" @click="activeTab = 'collision'">Configurar colisor <span>→</span></button>
              </article>
              <article class="player-card">
                <div class="player-card-head"><span>CONTROLES</span><span class="player-card-icon">⌘</span></div>
                <strong class="player-card-value">{{ activeControlMap.name }}</strong>
                <p>Movimento, salto, corrida, interação e ações de gameplay.</p>
                <button class="player-secondary-button" @click="emit('open-controls')">Editar mapa de controles <span>→</span></button>
              </article>
            </div>
            <div class="player-inline-banner">
              <div class="player-inline-symbol">i</div>
              <div><strong>Alterações do jogador fazem parte do projeto</strong><p>Salve o projeto para manter modelo, altura, movimento e colisor. Os mapas de teclas continuam salvos nas preferências deste computador.</p></div>
            </div>
          </section>

          <section v-else-if="activeTab === 'appearance'" class="player-page">
            <div class="player-page-heading"><div><div class="player-section-eyebrow">VISUAL DO PERSONAGEM</div><h2>Aparência e escala</h2><p>Defina qual modelo será controlado e o tamanho final no mundo 3D.</p></div></div>
            <div class="player-model-panel">
              <div class="player-model-preview" aria-hidden="true">
                <svg viewBox="0 0 96 132" fill="none"><circle cx="48" cy="24" r="15" /><path d="M29 47Q48 37 67 47L75 82H64L67 122H52L48 88L44 122H29L32 82H21L29 47Z" /></svg>
                <span>{{ playerModelCustom ? 'GLB' : 'DEFAULT' }}</span>
              </div>
              <div class="player-model-details">
                <div class="player-section-eyebrow">MODELO ATIVO</div>
                <h3>{{ playerModelName }}</h3>
                <p>{{ playerModelCustom ? 'Modelo GLB personalizado, armazenado junto do projeto.' : 'Personagem padrão da Engine. Importe um GLB para personalizar a aparência.' }}</p>
                <div class="player-model-actions">
                  <button class="player-primary-button" :disabled="!canEdit" @click="emit('open-model-import')">＋ Importar / escolher modelo</button>
                  <button v-if="playerModelCustom" class="player-secondary-button" :disabled="!canEdit" @click="emit('reset-player-model')">Restaurar personagem padrão</button>
                </div>
                <small class="player-field-help">No Importador 3D, ajuste a altura final e clique em “Usar como jogador”. Aceita GLB de até 30 MB.</small>
              </div>
            </div>
            <div class="player-settings-card">
              <div class="player-setting-heading"><div><h3>Altura final</h3><p>A escala visual e o corpo físico acompanham este valor.</p></div><strong>{{ playerModelHeight.toFixed(2) }} <small>un.</small></strong></div>
              <div class="player-height-controls">
                <input class="player-range" type="range" min="0.5" max="4" step="0.05" :value="modelHeightDraft" :disabled="!canEdit || !playerModelCustom" aria-label="Altura do modelo do jogador" @input="modelHeightDraft = Number(($event.target as HTMLInputElement).value)" @change="commitModelHeight" />
                <label class="player-number-field"><span>Altura (unidades)</span><input v-model.number="modelHeightDraft" type="number" min="0.1" max="10000" step="0.05" :disabled="!canEdit || !playerModelCustom" @change="commitModelHeight" /></label>
              </div>
              <div class="player-presets"><button v-for="height in [1, 1.5, 1.8, 2, 2.5, 3]" :key="height" type="button" :class="{ active: Math.abs(modelHeightDraft - height) < 0.025 }" :disabled="!canEdit || !playerModelCustom" @click="modelHeightDraft = height; commitModelHeight()">{{ height.toFixed(1) }} u</button></div>
              <p v-if="!playerModelCustom" class="player-field-help">A altura do personagem padrão é fixa. Importe um modelo personalizado para ajustar a escala.</p>
            </div>
          </section>

          <section v-else-if="activeTab === 'movement'" class="player-page">
            <div class="player-page-heading"><div><div class="player-section-eyebrow">LOCOMOÇÃO</div><h2>Movimento e salto</h2><p>Ajuste os parâmetros usados pela simulação física do jogador.</p></div></div>
            <div class="player-preset-row">
              <div><strong>Perfis rápidos</strong><small>Use um ponto de partida e depois personalize os valores.</small></div>
              <div class="player-preset-buttons"><button type="button" :disabled="!canEdit" @click="applyPreset('default')">Padrão</button><button type="button" :disabled="!canEdit" @click="applyPreset('action')">Ação</button><button type="button" :disabled="!canEdit" @click="applyPreset('heavy')">Pesado</button></div>
            </div>
            <div class="player-settings-list">
              <div class="player-setting-row">
                <div class="player-setting-copy"><strong>Velocidade de caminhada</strong><p>Deslocamento básico do personagem.</p><small>Limites: 0,5–15 unidades por segundo.</small></div>
                <div class="player-setting-inputs"><input class="player-range" type="range" min="0.5" max="15" step="0.1" :value="playerSettings.walkSpeed" :disabled="!canEdit" @input="updateSetting('walkSpeed', Number(($event.target as HTMLInputElement).value))" /><label class="player-number-field"><span>u/s</span><input type="number" min="0.5" max="15" step="0.1" :value="playerSettings.walkSpeed" :disabled="!canEdit" @change="updateSetting('walkSpeed', Number(($event.target as HTMLInputElement).value))" /></label></div>
              </div>
              <div class="player-setting-row">
                <div class="player-setting-copy"><strong>Multiplicador de corrida</strong><p>Define quantas vezes a corrida é mais rápida que a caminhada.</p><small>Velocidade atual da corrida: {{ estimatedRunSpeed.toFixed(1) }} u/s.</small></div>
                <div class="player-setting-inputs"><input class="player-range" type="range" min="1" max="3" step="0.05" :value="playerSettings.runMultiplier" :disabled="!canEdit" @input="updateSetting('runMultiplier', Number(($event.target as HTMLInputElement).value))" /><label class="player-number-field"><span>×</span><input type="number" min="1" max="3" step="0.05" :value="playerSettings.runMultiplier" :disabled="!canEdit" @change="updateSetting('runMultiplier', Number(($event.target as HTMLInputElement).value))" /></label></div>
              </div>
              <div class="player-setting-row">
                <div class="player-setting-copy"><strong>Impulso do salto</strong><p>Controla a força inicial do pulo. Use 0 para desativar o impulso de salto.</p><small>Limites: 0–14 unidades.</small></div>
                <div class="player-setting-inputs"><input class="player-range" type="range" min="0" max="14" step="0.1" :value="playerSettings.jumpSpeed" :disabled="!canEdit" @input="updateSetting('jumpSpeed', Number(($event.target as HTMLInputElement).value))" /><label class="player-number-field"><span>força</span><input type="number" min="0" max="14" step="0.1" :value="playerSettings.jumpSpeed" :disabled="!canEdit" @change="updateSetting('jumpSpeed', Number(($event.target as HTMLInputElement).value))" /></label></div>
              </div>
              <div class="player-setting-row">
                <div class="player-setting-copy"><strong>Gravidade</strong><p>Aceleração que puxa o jogador de volta ao chão.</p><small>Valores maiores produzem quedas mais rápidas.</small></div>
                <div class="player-setting-inputs"><input class="player-range" type="range" min="2" max="40" step="0.5" :value="playerSettings.gravity" :disabled="!canEdit" @input="updateSetting('gravity', Number(($event.target as HTMLInputElement).value))" /><label class="player-number-field"><span>u/s²</span><input type="number" min="2" max="40" step="0.5" :value="playerSettings.gravity" :disabled="!canEdit" @change="updateSetting('gravity', Number(($event.target as HTMLInputElement).value))" /></label></div>
              </div>
            </div>
            <p class="player-field-help">As alterações são aplicadas imediatamente. O movimento de montarias permanece configurado pelo pacote Montaria do objeto montável.</p>
          </section>

          <section v-else-if="activeTab === 'collision'" class="player-page">
            <div class="player-page-heading"><div><div class="player-section-eyebrow">FÍSICA DO PERSONAGEM</div><h2>Colisor do jogador</h2><p>Configure o contato físico com o terreno e os objetos sólidos.</p></div></div>
            <div class="player-collider-layout">
              <div class="player-capsule-card">
                <div class="player-capsule-art" aria-hidden="true"><div class="player-capsule-top"></div><div class="player-capsule-middle"></div><div class="player-capsule-bottom"></div></div>
                <strong>Colisor em cápsula</strong><p>Formato vertical recomendado para personagens controláveis.</p>
                <div class="player-capsule-dim"><span>Altura</span><strong>{{ playerModelHeight.toFixed(2) }} u</strong></div>
                <div class="player-capsule-dim"><span>Raio calculado</span><strong>{{ actualColliderRadius.toFixed(2) }} u</strong></div>
                <div class="player-capsule-dim"><span>Diâmetro</span><strong>{{ actualColliderDiameter.toFixed(2) }} u</strong></div>
              </div>
              <div class="player-settings-card player-collider-settings">
                <div class="player-setting-heading"><div><h3>Raio base</h3><p>O raio é escalado proporcionalmente à altura do modelo.</p></div><strong>{{ playerSettings.colliderRadius.toFixed(2) }} <small>u</small></strong></div>
                <input class="player-range" type="range" min="0.1" max="0.8" step="0.01" :value="playerSettings.colliderRadius" :disabled="!canEdit" aria-label="Raio base do colisor" @input="updateSetting('colliderRadius', Number(($event.target as HTMLInputElement).value))" />
                <label class="player-number-field"><span>Raio base (unidades a 1,8 u de altura)</span><input type="number" min="0.1" max="0.8" step="0.01" :value="playerSettings.colliderRadius" :disabled="!canEdit" @change="updateSetting('colliderRadius', Number(($event.target as HTMLInputElement).value))" /></label>
                <div class="player-collider-hint"><strong>O que muda?</strong><p>Aumentar o raio evita que o jogador passe por frestas estreitas; diminuir permite passar por espaços menores. O terreno continua usando as mesmas regras de apoio, degraus e rampas.</p></div>
              </div>
            </div>
          </section>

          <section v-else-if="activeTab === 'camera'" class="player-page">
            <div class="player-page-heading"><div><div class="player-section-eyebrow">VISÃO DO JOGO</div><h2>Câmera</h2><p>Defina como o jogador vê o mundo durante a execução.</p></div></div>
            <div class="player-camera-grid">
              <button class="player-camera-card" :class="{ active: firstPersonMode }" type="button" :disabled="!canEdit" @click="emit('toggle-first-person')"><span class="player-camera-glyph" aria-hidden="true">◎</span><strong>Primeira pessoa</strong><small>Visão a partir do personagem, com captura do mouse durante o jogo.</small><b>{{ firstPersonMode ? 'ATIVA' : 'ATIVAR' }}</b></button>
              <button class="player-camera-card" :class="{ active: !firstPersonMode }" type="button" :disabled="!canEdit" @click="emit('cycle-camera')"><span class="player-camera-glyph" aria-hidden="true">◉</span><strong>{{ firstPersonMode ? 'Câmera externa' : cameraLabel }}</strong><small>Alterna os enquadramentos externos disponíveis no editor.</small><b>ALTERNAR CÂMERA</b></button>
            </div>
            <div class="player-inline-banner"><div class="player-inline-symbol">i</div><div><strong>Mapeamento de câmera</strong><p>Os atalhos para alternar câmera e primeira pessoa podem ser ajustados na seção Controles.</p></div></div>
          </section>

          <section v-else class="player-page">
            <div class="player-page-heading"><div><div class="player-section-eyebrow">ENTRADA DO JOGADOR</div><h2>Mapas de controles</h2><p>Veja o perfil ativo e configure todas as teclas, botões do mouse e ações.</p></div></div>
            <div class="player-controls-profile">
              <div><div class="player-section-eyebrow">PERFIL ATIVO</div><h3>{{ activeControlMap.name }}</h3><p>Os mapas de controle são aplicados imediatamente e salvos nas preferências deste computador.</p></div>
              <button class="player-primary-button" @click="emit('open-controls')">Abrir editor de controles <span>→</span></button>
            </div>
            <div class="player-binding-grid">
              <div v-for="binding in controlSummary" :key="binding.key" class="player-binding-card"><span>{{ binding.label }}</span><kbd>{{ keyLabel(activeControlMap.bindings[binding.key]) }}</kbd></div>
            </div>
            <div class="player-inline-banner"><div class="player-inline-symbol">i</div><div><strong>Controles específicos de gameplay</strong><p>Ações como inventário, usar item e habilidades também podem disparar eventos globais e fluxos do Workspace de UI.</p></div></div>
          </section>
        </main>
      </div>

      <footer class="player-workspace-footer">
        <div class="player-footer-status"><span :class="{ dirty }" class="player-status-dot"></span><span>{{ dirty ? 'Alterações não salvas no projeto' : 'Projeto sincronizado' }}</span><small v-if="!canEdit">Pare o jogo para editar as configurações.</small></div>
        <div class="player-footer-actions"><button class="player-secondary-button" type="button" @click="emit('close')">Fechar</button><button class="player-primary-button" type="button" :disabled="!dirty || !canEdit" @click="emit('save-project')">Salvar projeto</button></div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.player-workspace-overlay{position:fixed;inset:0;z-index:940;display:grid;place-items:center;padding:18px;background:rgba(5,7,10,.78);backdrop-filter:blur(4px)}
.player-workspace{display:flex;flex-direction:column;width:min(1080px,calc(100vw - 36px));height:min(760px,calc(100dvh - 36px));min-height:380px;overflow:hidden;border:1px solid #39352d;border-radius:10px;background:#12120f;color:#f3efe6;box-shadow:0 24px 80px #0009}
.player-workspace-header{display:flex;align-items:center;justify-content:space-between;gap:20px;flex:none;padding:17px 22px;border-bottom:1px solid #302c25;background:#181713}
.player-workspace-brand{display:flex;align-items:center;gap:14px;min-width:0}
.player-workspace-mark{display:grid;place-items:center;flex:none;width:42px;height:42px;border:1px solid #78472e;border-radius:8px;background:#2d2119;color:#f5a524;font-size:20px;font-weight:800}
.player-workspace-eyebrow,.player-section-eyebrow,.player-nav-label{color:#b77a4d;font:700 9px/1.35 'IBM Plex Mono',monospace;letter-spacing:.12em}
.player-workspace-header h1{margin:4px 0 3px;font-size:20px;line-height:1.2;font-weight:700}
.player-workspace-header p{margin:0;color:#a7a094;font-size:11px;line-height:1.45}
.player-workspace-close{display:grid;place-items:center;flex:none;width:33px;height:33px;border:1px solid #3d3931;border-radius:6px;background:#201e19;color:#d4cabb;font-size:23px;cursor:pointer}
.player-workspace-close:hover{border-color:#bd7546;color:#fff}
.player-workspace-summary{display:grid;grid-template-columns:minmax(0,1.55fr) repeat(3,minmax(0,1fr));gap:9px;flex:none;padding:10px 18px;border-bottom:1px solid #302c25;background:#151410}
.player-summary-model,.player-summary-chip{display:flex;align-items:center;gap:10px;min-width:0;padding:8px 10px;border:1px solid #302d26;border-radius:6px;background:#1c1a15}
.player-summary-avatar{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:6px;background:#2c241a;color:#e7a05e}
.player-summary-avatar svg{width:26px;height:31px;fill:currentColor}
.player-summary-copy,.player-summary-chip{min-width:0}
.player-summary-copy>span,.player-summary-chip>span{display:block;color:#8f887b;font:700 8px/1.3 'IBM Plex Mono',monospace;letter-spacing:.09em}
.player-summary-copy strong,.player-summary-chip strong{display:block;overflow:hidden;margin-top:4px;color:#f1ede4;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.player-summary-copy small{display:block;margin-top:3px;color:#a8a092;font-size:9px}
.player-summary-chip{display:block;padding:10px}
.player-summary-chip strong{font-size:10px}
.player-workspace-warning{color:#f5a524!important}
.player-workspace-body{display:flex;flex:1;min-height:0}
.player-workspace-nav{display:flex;flex:none;width:194px;flex-direction:column;gap:4px;padding:15px 10px;border-right:1px solid #302c25;background:#171611}
.player-nav-label{padding:0 9px 9px;color:#8f887b}
.player-workspace-nav>button{position:relative;display:flex;align-items:center;gap:10px;min-width:0;min-height:49px;padding:7px 9px;border:1px solid transparent;border-radius:6px;background:transparent;color:#aaa294;text-align:left;cursor:pointer}
.player-workspace-nav>button:hover{background:#201e18;color:#f1ede4}
.player-workspace-nav>button.active{border-color:#55402e;background:#2b2118;color:#f5a524}
.player-nav-icon{display:grid;place-items:center;flex:none;width:25px;height:25px;border:1px solid #3b352b;border-radius:5px;color:#d49a5b;font-size:16px}
.player-workspace-nav>button.active .player-nav-icon{border-color:#754b2d;background:#3b291b}
.player-nav-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:4px}
.player-nav-copy strong{font-size:10px;font-weight:650}
.player-nav-copy small{color:#8d867a;font-size:9px}
.player-nav-active{position:absolute;top:9px;bottom:9px;left:-1px;width:2px;border-radius:2px;background:#f5a524}
.player-nav-note{display:flex;align-items:flex-start;gap:7px;margin-top:auto;padding:12px 8px;border-top:1px solid #302c25;color:#8f887b;font-size:9px;line-height:1.5}
.player-nav-note-dot{flex:none;width:6px;height:6px;margin-top:4px;border-radius:50%;background:#78b879}
.player-workspace-content{flex:1;min-width:0;min-height:0;overflow:auto;padding:22px;background:#11110e}
.player-page{display:flex;flex-direction:column;gap:17px;max-width:780px;margin:0 auto}
.player-page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.player-page-heading h2{margin:5px 0 5px;color:#f3efe6;font-size:21px;line-height:1.2}
.player-page-heading p{margin:0;color:#9f988b;font-size:11px;line-height:1.6}
.player-overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.player-card,.player-settings-card{min-width:0;padding:15px;border:1px solid #302d26;border-radius:8px;background:#191813}
.player-card-head{display:flex;align-items:center;justify-content:space-between;color:#a69d8e;font:700 8px/1.4 'IBM Plex Mono',monospace;letter-spacing:.11em}
.player-card-icon{display:grid;place-items:center;width:27px;height:27px;border:1px solid #3f372a;border-radius:6px;background:#262016;color:#e3a060;font-size:16px}
.player-card-value{display:block;overflow:hidden;margin-top:14px;color:#f3efe6;font-size:14px;text-overflow:ellipsis;white-space:nowrap}
.player-card>p{min-height:31px;margin:6px 0 12px;color:#a49c8e;font-size:10px;line-height:1.55;overflow-wrap:anywhere}
.player-card-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0;color:#9e9689;font-size:10px}
.player-card-meta strong{color:#e4d9c9;font-size:10px}
.player-stat-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px}
.player-stat-pair>div{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid #2f2b23;border-radius:6px;background:#15140f}
.player-stat-pair span{color:#9e9689;font-size:9px}
.player-stat-pair strong{font-size:16px;color:#f3efe6}
.player-stat-pair strong small{font-size:9px;color:#a49c8e;font-weight:500}
.player-primary-button,.player-secondary-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:34px;padding:0 12px;border:1px solid #60432b;border-radius:5px;background:#332318;color:#f3dcc7;font-size:10px;font-weight:650;cursor:pointer;transition:background .12s,border-color .12s}
.player-primary-button:hover:not(:disabled){border-color:#b16d37;background:#462b19}
.player-secondary-button{border-color:#3b362d;background:#201e18;color:#d0c8ba}
.player-secondary-button:hover:not(:disabled){border-color:#755337;background:#29241b;color:#fff}
.player-primary-button>span,.player-secondary-button>span{font-size:15px}
.player-primary-button:disabled,.player-secondary-button:disabled{opacity:.42;cursor:not-allowed}
.player-card>.player-primary-button,.player-card>.player-secondary-button{width:100%;margin-top:4px}
.player-inline-banner{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #3a3226;border-radius:7px;background:#211c14}
.player-inline-symbol{display:grid;place-items:center;flex:none;width:22px;height:22px;border:1px solid #765735;border-radius:50%;color:#e8ad68;font:bold 12px serif}
.player-inline-banner strong{color:#ead7bd;font-size:10px}
.player-inline-banner p{margin:5px 0 0;color:#a69d8e;font-size:10px;line-height:1.6}
.player-model-panel{display:flex;align-items:stretch;gap:18px;padding:17px;border:1px solid #302d26;border-radius:8px;background:#191813}
.player-model-preview{display:flex;position:relative;align-items:center;justify-content:center;flex:none;width:132px;min-height:174px;border:1px solid #393024;border-radius:7px;background:radial-gradient(ellipse at 50% 65%,#382a1c 0%,#211b13 62%,#17150f 100%);color:#e4a15c}
.player-model-preview svg{width:78px;height:112px;fill:currentColor}
.player-model-preview>span{position:absolute;right:8px;bottom:8px;padding:3px 5px;border:1px solid #4d3a25;border-radius:3px;background:#221b12;color:#bba07a;font:8px 'IBM Plex Mono',monospace}
.player-model-details{display:flex;min-width:0;flex:1;flex-direction:column;align-items:flex-start;gap:8px}
.player-model-details h3{max-width:100%;margin:0;color:#f3efe6;font-size:15px;overflow-wrap:anywhere}
.player-model-details p{margin:0;color:#a49c8e;font-size:10px;line-height:1.6}
.player-model-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:3px}
.player-field-help{margin:2px 0 0;color:#8f887b;font-size:9px;line-height:1.6}
.player-setting-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}
.player-setting-heading h3{margin:0;color:#eee7da;font-size:12px}
.player-setting-heading p{margin:5px 0 0;color:#9f988b;font-size:10px;line-height:1.5}
.player-setting-heading>strong{flex:none;color:#f5a524;font:600 16px 'IBM Plex Mono',monospace;white-space:nowrap}
.player-setting-heading>strong small{font-size:9px;color:#a69d8e}
.player-height-controls{display:grid;grid-template-columns:minmax(0,1fr) 160px;align-items:center;gap:16px}
.player-range{display:block;width:100%;min-width:0;margin:6px 0;accent-color:#f5a524}
.player-number-field{display:flex;min-width:0;flex-direction:column;gap:6px;color:#a49c8e;font-size:9px}
.player-number-field>input{box-sizing:border-box;width:100%;min-width:0;min-height:33px;padding:0 9px;border:1px solid #3b352a;border-radius:5px;background:#10100d;color:#f3efe6;font:11px 'IBM Plex Mono',monospace}
.player-number-field>input:focus{outline:1px solid #986338;border-color:#a16d3d}
.player-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.player-presets button,.player-preset-buttons button{min-height:28px;padding:0 9px;border:1px solid #39342a;border-radius:4px;background:#211f18;color:#aaa294;font-size:9px;cursor:pointer}
.player-presets button.active,.player-preset-buttons button:hover{border-color:#795333;background:#2c2116;color:#f4c084}
.player-presets button:disabled,.player-preset-buttons button:disabled{opacity:.42;cursor:not-allowed}
.player-preset-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #302d26;border-radius:7px;background:#191813}
.player-preset-row>div:first-child{display:flex;min-width:0;flex-direction:column;gap:5px}
.player-preset-row strong{color:#e9e0d2;font-size:10px}
.player-preset-row small{color:#958d80;font-size:9px;line-height:1.4}
.player-preset-buttons{display:flex;flex:none;gap:5px}
.player-settings-list{display:flex;flex-direction:column;border:1px solid #302d26;border-radius:8px;background:#191813}
.player-setting-row{display:grid;grid-template-columns:minmax(170px,.85fr) minmax(0,1.15fr);align-items:center;gap:18px;padding:15px;border-bottom:1px solid #302d26}
.player-setting-row:last-child{border-bottom:0}
.player-setting-copy strong{color:#eee7da;font-size:11px}
.player-setting-copy p{margin:5px 0;color:#a49c8e;font-size:10px;line-height:1.5}
.player-setting-copy small{color:#827b70;font-size:9px}
.player-setting-inputs{display:grid;grid-template-columns:minmax(0,1fr) 105px;align-items:center;gap:14px}
.player-collider-layout{display:grid;grid-template-columns:minmax(180px,.75fr) minmax(0,1.25fr);gap:12px}
.player-capsule-card{display:flex;align-items:center;flex-direction:column;padding:17px;border:1px solid #302d26;border-radius:8px;background:#191813;text-align:center}
.player-capsule-art{display:flex;align-items:center;flex-direction:column;margin:8px 0 16px}
.player-capsule-top,.player-capsule-bottom{width:60px;height:31px;border:1px solid #b88045;background:#46311d}
.player-capsule-top{border-radius:50% 50% 0 0;border-bottom:0}
.player-capsule-middle{width:60px;height:66px;border-left:1px solid #b88045;border-right:1px solid #b88045;background:linear-gradient(90deg,#49331e,#2a2115 55%,#49331e)}
.player-capsule-bottom{border-radius:0 0 50% 50%;border-top:0}
.player-capsule-card>strong{color:#efe5d6;font-size:11px}
.player-capsule-card>p{margin:7px 0 12px;color:#9f988b;font-size:10px;line-height:1.5}
.player-capsule-dim{display:flex;justify-content:space-between;width:100%;gap:8px;padding:8px 0;border-top:1px solid #302d26;color:#9f988b;font-size:9px;text-align:left}
.player-capsule-dim strong{color:#e5d5bf;font:10px 'IBM Plex Mono',monospace}
.player-collider-settings{align-self:stretch}
.player-collider-hint{margin-top:18px;padding:11px;border:1px solid #363025;border-radius:6px;background:#201b14}
.player-collider-hint strong{color:#edd5b6;font-size:10px}
.player-collider-hint p{margin:5px 0 0;color:#a69d8e;font-size:10px;line-height:1.6}
.player-camera-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.player-camera-card{display:flex;align-items:flex-start;flex-direction:column;gap:10px;min-height:180px;padding:18px;border:1px solid #302d26;border-radius:8px;background:#191813;color:#f3efe6;text-align:left;cursor:pointer}
.player-camera-card:hover:not(:disabled),.player-camera-card.active{border-color:#775032;background:#241d15}
.player-camera-card:disabled{opacity:.45;cursor:not-allowed}
.player-camera-glyph{display:grid;place-items:center;width:42px;height:42px;border:1px solid #4a3a27;border-radius:8px;background:#2b2117;color:#e4a05a;font-size:25px}
.player-camera-card strong{font-size:12px}
.player-camera-card small{color:#a49c8e;font-size:10px;line-height:1.6}
.player-camera-card b{margin-top:auto;color:#d99554;font:700 8px 'IBM Plex Mono',monospace;letter-spacing:.09em}
.player-controls-profile{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:17px;border:1px solid #302d26;border-radius:8px;background:#191813}
.player-controls-profile h3{margin:6px 0;color:#f3efe6;font-size:15px}
.player-controls-profile p{max-width:360px;margin:0;color:#a49c8e;font-size:10px;line-height:1.5}
.player-binding-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.player-binding-card{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #302d26;border-radius:6px;background:#191813;color:#bcb3a4;font-size:10px}
.player-binding-card kbd{display:inline-flex;align-items:center;justify-content:center;min-width:42px;min-height:26px;padding:0 7px;border:1px solid #4b4234;border-bottom-width:2px;border-radius:4px;background:#242017;color:#f3d1a3;font:10px 'IBM Plex Mono',monospace}
.player-workspace-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;flex:none;padding:11px 18px;border-top:1px solid #302c25;background:#171611}
.player-footer-status{display:flex;align-items:center;gap:8px;min-width:0;color:#a69d8e;font-size:10px}
.player-status-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#82b77a}
.player-status-dot.dirty{background:#e4a15c}
.player-footer-status small{color:#927e64;font-size:9px}
.player-footer-actions{display:flex;gap:7px;flex:none}
@media(max-width:860px){.player-workspace-summary{grid-template-columns:minmax(0,1fr) repeat(2,minmax(0,1fr))}.player-summary-chip:last-child{display:none}.player-workspace-nav{width:170px}.player-workspace-content{padding:16px}.player-setting-row{grid-template-columns:minmax(0,1fr)}}
@media(max-width:620px){.player-workspace-overlay{padding:6px}.player-workspace{width:calc(100vw - 12px);height:calc(100dvh - 12px);min-height:0}.player-workspace-header{padding:12px}.player-workspace-mark{width:34px;height:34px}.player-workspace-header h1{font-size:16px}.player-workspace-header p{display:none}.player-workspace-summary{grid-template-columns:minmax(0,1fr) minmax(0,1fr);padding:7px}.player-summary-model{grid-column:1/-1}.player-workspace-body{min-height:0}.player-workspace-nav{width:58px;padding:10px 5px}.player-nav-label,.player-nav-copy,.player-nav-note,.player-nav-active{display:none}.player-workspace-nav>button{justify-content:center;min-height:42px;padding:5px}.player-nav-icon{width:32px;height:32px}.player-workspace-content{padding:12px}.player-overview-grid,.player-camera-grid,.player-collider-layout{grid-template-columns:minmax(0,1fr)}.player-model-panel{flex-direction:column}.player-model-preview{width:100%;min-height:120px}.player-model-preview svg{height:90px}.player-height-controls{grid-template-columns:minmax(0,1fr)}.player-controls-profile{align-items:flex-start;flex-direction:column}.player-workspace-footer{align-items:flex-start;flex-direction:column}.player-footer-actions{width:100%;justify-content:flex-end}.player-preset-row{align-items:flex-start;flex-direction:column}.player-preset-buttons{width:100%;flex-wrap:wrap}.player-binding-grid{grid-template-columns:minmax(0,1fr)}.player-setting-inputs{grid-template-columns:minmax(0,1fr) 90px}.player-nav-icon{font-size:20px}}
</style>
