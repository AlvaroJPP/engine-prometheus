<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  bindings: Record<string, string>
  gameVariables: Record<string, boolean | number | string>
  editorPreview?: boolean
}>()
const emit = defineEmits<{
  (event: 'set-global-variable', name: string, value: string | number | boolean): void
}>()

const veilborneLoadoutOpen = ref(false)
const loadoutPanelPosition = ref<{ x: number; y: number } | null>(null)
let loadoutDragOffset: { x: number; y: number } | null = null
let loadoutDragRoot: HTMLElement | null = null
const loadoutPanelStyle = computed(() => loadoutPanelPosition.value
  ? { left: `${loadoutPanelPosition.value.x}px`, top: `${loadoutPanelPosition.value.y}px`, right: 'auto' }
  : {})
const veilborneActive = computed(() => typeof props.gameVariables.arma_equipada === 'string')
const veilborneWeaponOptions = [
  { id: 'starter_arcane_sword', label: 'Lâmina do Véu' },
  { id: 'starter_rune_staff', label: 'Cajado das Cinzas' },
  { id: 'hunters_dagger', label: 'Adaga do Caçador' },
  { id: 'oathbreaker_greatsword', label: 'Espadão Quebrajuramentos' },
]
const veilborneSpellOptions = [
  { id: 'arcane_bolt', label: 'Dardo do Véu' },
  { id: 'cinder_burst', label: 'Explosão de Brasa' },
  { id: 'frost_chain', label: 'Corrente Glacial' },
  { id: 'blood_siphon', label: 'Dreno Rubro' },
  { id: 'blink_step', label: 'Passo Entre Véus' },
  { id: 'storm_lance', label: 'Lança da Tempestade' },
]
const veilborneSigilOptions = [
  { id: 'ward', label: 'Selo Guardião' },
  { id: 'blast', label: 'Selo de Ruptura' },
  { id: 'hunter_mark', label: 'Marca do Caçador' },
  { id: 'slow_field', label: 'Círculo de Lentidão' },
  { id: 'silence_seal', label: 'Selo do Silêncio' },
]
const veilborneItemOptions = [
  { id: 'lesser_vitality_vial', label: 'Frasco de Vitalidade', description: 'Recupera 45 de vida.' },
  { id: 'ether_vial', label: 'Frasco de Éter', description: 'Recupera 40 de éter.' },
  { id: 'vigor_vial', label: 'Tônico de Vigor', description: 'Recupera 45 de vigor.' },
  { id: 'ember_bomb', label: 'Bomba de Brasa', description: '30 de dano de chama em área.' },
  { id: 'echo_fragment', label: 'Fragmento de Ecos', description: 'Concede 25 Ecos.' },
]
const veilborneInventory = computed(() => {
  const raw = props.gameVariables.inventario_json
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const item = entry as Record<string, unknown>
      if (typeof item.id !== 'string' || !Object.prototype.hasOwnProperty.call(item, 'quantity')) return []
      const definition = veilborneItemOptions.find(option => option.id === item.id)
      if (!definition || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) return []
      return [{ ...definition, quantity: Math.floor(item.quantity) }]
    })
  } catch {
    return []
  }
})
type VeilborneArchetypeId = 'veil_duelist' | 'rune_scholar' | 'blood_adept' | 'oathbreaker'
const veilborneArchetypes: Array<{
  id: VeilborneArchetypeId
  label: string
  description: string
  attributes: Record<string, number>
  weapon: string
  spells: string[]
  sigils: string[]
}> = [
  {
    id: 'veil_duelist', label: 'Duelista do Véu', description: 'Combate ágil com espada e magia arcana.',
    attributes: { forca: 12, destreza: 15, intelecto: 9, vontade: 10, resistencia: 12 },
    weapon: 'starter_arcane_sword',
    spells: ['arcane_bolt', 'blink_step', 'frost_chain', 'blood_siphon'],
    sigils: ['ward', 'hunter_mark', 'blast', 'slow_field'],
  },
  {
    id: 'rune_scholar', label: 'Erudito Rúnico', description: 'Conjurador de alto poder mágico e grande éter.',
    attributes: { forca: 7, destreza: 10, intelecto: 16, vontade: 14, resistencia: 9 },
    weapon: 'starter_rune_staff',
    spells: ['arcane_bolt', 'cinder_burst', 'frost_chain', 'storm_lance'],
    sigils: ['ward', 'blast', 'slow_field', 'silence_seal'],
  },
  {
    id: 'blood_adept', label: 'Adepto Rubro', description: 'Dreno vital, sangue e mobilidade sobrenatural.',
    attributes: { forca: 10, destreza: 11, intelecto: 12, vontade: 16, resistencia: 11 },
    weapon: 'hunters_dagger',
    spells: ['blood_siphon', 'blink_step', 'arcane_bolt', 'frost_chain'],
    sigils: ['hunter_mark', 'silence_seal', 'ward', 'blast'],
  },
  {
    id: 'oathbreaker', label: 'Quebrajuramentos', description: 'Arma pesada, resistência e dano de postura.',
    attributes: { forca: 17, destreza: 9, intelecto: 8, vontade: 10, resistencia: 15 },
    weapon: 'oathbreaker_greatsword',
    spells: ['storm_lance', 'arcane_bolt', 'cinder_burst', 'blink_step'],
    sigils: ['ward', 'blast', 'hunter_mark', 'slow_field'],
  },
]
const selectedVeilborneArchetype = ref<string>('custom')
watch(() => props.gameVariables.arquetipo, value => {
  if (typeof value === 'string') selectedVeilborneArchetype.value = value
})
const veilborneAttributes = computed(() => [
  { key: 'forca', label: 'Força' },
  { key: 'destreza', label: 'Destreza' },
  { key: 'intelecto', label: 'Intelecto' },
  { key: 'vontade', label: 'Vontade' },
  { key: 'resistencia', label: 'Resistência' },
].map(item => ({
  ...item,
  value: typeof props.gameVariables[item.key] === 'number' ? props.gameVariables[item.key] as number : 0,
})))
const veilborneProgression = computed(() => {
  const number = (name: string, fallback: number): number => {
    const value = props.gameVariables[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }
  const level = Math.max(1, Math.floor(number('nivel', 1)))
  const experience = Math.max(0, number('experiencia', 0))
  const threshold = Math.max(1, number('experiencia_proximo_nivel', 100))
  return {
    level,
    experience,
    threshold,
    points: Math.max(0, Math.floor(number('pontos_atributo', 0))),
    echoes: Math.max(0, Math.floor(number('ecos', 0))),
    percent: Math.max(0, Math.min(100, experience / threshold * 100)),
  }
})

function setLoadoutValue(name: string, value: string | number | boolean): void {
  emit('set-global-variable', name, value)
}

function startLoadoutDrag(event: PointerEvent): void {
  if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return
  const header = event.currentTarget as HTMLElement
  const panel = header.closest('.veilborne-loadout-panel') as HTMLElement | null
  const root = header.closest('.player-hud') as HTMLElement | null
  if (!panel || !root) return
  const rect = panel.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  loadoutDragRoot = root
  // Usa coordenadas da própria HUD, nunca as dimensões da janela inteira.
  loadoutPanelPosition.value = { x: rect.left - rootRect.left, y: rect.top - rootRect.top }
  loadoutDragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  window.addEventListener('pointermove', moveLoadoutPanel)
  window.addEventListener('pointerup', finishLoadoutDrag)
  window.addEventListener('pointercancel', finishLoadoutDrag)
  event.preventDefault()
}

function moveLoadoutPanel(event: PointerEvent): void {
  const root = loadoutDragRoot
  if (!loadoutDragOffset || !root) return
  const panel = root.querySelector<HTMLElement>('.veilborne-loadout-panel')
  if (!panel) return
  const rootRect = root.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const width = Math.min(panelRect.width, root.clientWidth)
  const height = Math.min(panelRect.height, root.clientHeight)
  const maxX = Math.max(0, root.clientWidth - width)
  const maxY = Math.max(0, root.clientHeight - height)
  loadoutPanelPosition.value = {
    x: Math.max(0, Math.min(maxX, event.clientX - rootRect.left - loadoutDragOffset.x)),
    y: Math.max(0, Math.min(maxY, event.clientY - rootRect.top - loadoutDragOffset.y)),
  }
}

function finishLoadoutDrag(): void {
  loadoutDragOffset = null
  loadoutDragRoot = null
  window.removeEventListener('pointermove', moveLoadoutPanel)
  window.removeEventListener('pointerup', finishLoadoutDrag)
  window.removeEventListener('pointercancel', finishLoadoutDrag)
}

function onVeilborneArchetypeChange(value: string): void {
  selectedVeilborneArchetype.value = value
  if (value !== 'custom') applyVeilborneArchetype()
}

function setVeilborneSigilSlot(slot: number, value: string): void {
  setLoadoutValue('sigilo_' + slot, value)
  if (Number(props.gameVariables.sigilo_selecionado ?? 1) === slot) {
    setLoadoutValue('sigilo_ativo', value)
  }
}

function applyVeilborneArchetype(): void {
  const archetype = veilborneArchetypes.find(item => item.id === selectedVeilborneArchetype.value)
  if (!archetype) return
  setLoadoutValue('arquetipo', archetype.id)
  for (const [name, value] of Object.entries(archetype.attributes)) setLoadoutValue(name, value)
  setLoadoutValue('arma_equipada', archetype.weapon)
  archetype.spells.forEach((spell, index) => setLoadoutValue('magia_' + (index + 1), spell))
  archetype.sigils.forEach((sigil, index) => setLoadoutValue('sigilo_' + (index + 1), sigil))
  setLoadoutValue('sigilo_selecionado', 1)
  setLoadoutValue('sigilo_ativo', archetype.sigils[0] ?? 'ward')
}

function spendVeilborneAttributePoint(name: string): void {
  const attribute = veilborneAttributes.value.find(item => item.key === name)
  const points = veilborneProgression.value.points
  if (!attribute || points < 1 || attribute.value >= 999) return
  setLoadoutValue(name, Math.min(999, Math.floor(attribute.value) + 1))
  setLoadoutValue('pontos_atributo', Math.max(0, points - 1))
}

function onVeilborneInventoryKeydown(event: KeyboardEvent): void {
  if (!veilborneActive.value || event.code !== props.bindings.inventory) return
  const target = event.target
  if (target instanceof HTMLElement && (
    target.isContentEditable ||
    target.matches('input, textarea, select')
  )) return
  event.preventDefault()
  veilborneLoadoutOpen.value = !veilborneLoadoutOpen.value
}

function keyLabel(code?: string): string {
  if (!code) return '—'
  const aliases: Record<string, string> = {
    Space: 'ESPAÇO', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT',
    ControlLeft: 'CTRL', ControlRight: 'CTRL', AltLeft: 'ALT', AltRight: 'ALT',
    Tab: 'TAB', CapsLock: 'CAPS', ArrowUp: '↑', ArrowDown: '↓',
    ArrowLeft: '←', ArrowRight: '→', Escape: 'ESC',
  }
  if (aliases[code]) return aliases[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6)
  return code.replace(/Left|Right/g, '').toUpperCase()
}

onMounted(() => window.addEventListener('keydown', onVeilborneInventoryKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onVeilborneInventoryKeydown)
  finishLoadoutDrag()
})
</script>

<template>
  <div class="veilborne-game-overlay" data-no-game-attack :class="{ 'editor-preview': editorPreview }">
    <div
      v-if="veilborneActive && typeof gameVariables.loot_notice === 'string' && gameVariables.loot_notice"
      class="veilborne-loot-toast"
      role="status"
      aria-live="polite"
    >{{ gameVariables.loot_notice }}</div>

    <button
      v-if="veilborneActive"
      type="button"
      class="veilborne-loadout-trigger"
      :class="{ active: veilborneLoadoutOpen }"
      :aria-expanded="veilborneLoadoutOpen"
      @click="veilborneLoadoutOpen = !veilborneLoadoutOpen"
      title="Abrir arsenal, feitiços e sigilos VEILBORNE"
    >
      <span class="veilborne-trigger-mark">V</span>
      <span><small>VEILBORNE</small><strong>Arsenal</strong></span>
      <kbd>{{ keyLabel(bindings.inventory) }}</kbd>
    </button>

    <aside
      v-if="veilborneActive && veilborneLoadoutOpen"
      class="veilborne-loadout-panel"
      @wheel.stop
      :style="loadoutPanelStyle"
      role="dialog"
      aria-label="Arsenal VEILBORNE"
    >
      <header class="veilborne-loadout-heading" @pointerdown="startLoadoutDrag" title="Arraste para mover o Arsenal">
        <div>
          <span class="hud-eyebrow">VEILBORNE · EQUIPAMENTO</span>
          <strong>Arsenal do Véu</strong>
        </div>
        <button type="button" class="veilborne-loadout-close" aria-label="Fechar arsenal" @click="veilborneLoadoutOpen = false">×</button>
      </header>

      <div class="veilborne-loadout-resources">
        <div><small>VIDA</small><strong>{{ Math.round(Number(gameVariables.vida ?? 0)) }} / {{ Math.round(Number(gameVariables.vida_max ?? 100)) }}</strong></div>
        <div><small>ÉTER</small><strong>{{ Math.round(Number(gameVariables.eter ?? 0)) }} / {{ Math.round(Number(gameVariables.eter_max ?? 100)) }}</strong></div>
        <div><small>VIGOR</small><strong>{{ Math.round(Number(gameVariables.vigor ?? 0)) }} / {{ Math.round(Number(gameVariables.vigor_max ?? 100)) }}</strong></div>
      </div>

      <div class="veilborne-progression-card">
        <div class="veilborne-progression-top">
          <strong>NÍVEL {{ veilborneProgression.level }}</strong>
          <span>{{ Math.round(veilborneProgression.experience) }} / {{ Math.round(veilborneProgression.threshold) }} XP</span>
        </div>
        <div class="veilborne-xp-track" role="progressbar" :aria-valuenow="veilborneProgression.experience" :aria-valuemin="0" :aria-valuemax="veilborneProgression.threshold" aria-label="Experiência para o próximo nível">
          <div :style="{ width: veilborneProgression.percent + '%' }" />
        </div>
        <div class="veilborne-progression-bottom">
          <span>ECOS <strong>{{ veilborneProgression.echoes }}</strong></span>
          <span>PONTOS DE ATRIBUTO <strong>{{ veilborneProgression.points }}</strong></span>
        </div>
      </div>

      <div class="veilborne-loadout-section">
        <div class="veilborne-loadout-section-heading"><span>INVENTÁRIO</span><small>{{ veilborneInventory.reduce((sum, item) => sum + item.quantity, 0) }} itens</small></div>
        <div v-if="veilborneInventory.length" class="veilborne-inventory-list">
          <div v-for="item in veilborneInventory" :key="item.id" class="veilborne-inventory-item">
            <div class="veilborne-inventory-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </div>
            <span class="veilborne-inventory-quantity">×{{ item.quantity }}</span>
            <button type="button" class="veilborne-item-use" :aria-label="'Usar ' + item.label" @click="setLoadoutValue('item_use_request', item.id)">Usar</button>
          </div>
        </div>
        <p v-else class="veilborne-inventory-empty">Inventário vazio. Interaja com um item brilhante no mundo para coletá-lo.</p>
      </div>

      <div class="veilborne-archetype-block">
        <label class="veilborne-loadout-field">
          <span>Arquétipo</span>
          <select :value="selectedVeilborneArchetype" @change="onVeilborneArchetypeChange(($event.target as HTMLSelectElement).value)">
            <option value="custom">Personalizado / atual</option>
            <option v-for="item in veilborneArchetypes" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
        <p v-if="veilborneArchetypes.find(item => item.id === selectedVeilborneArchetype)" class="veilborne-archetype-description">
          {{ veilborneArchetypes.find(item => item.id === selectedVeilborneArchetype)?.description }}
        </p>
        <button type="button" class="veilborne-archetype-apply" :disabled="selectedVeilborneArchetype === 'custom'" @click="applyVeilborneArchetype">Aplicar perfil</button>
      </div>

      <label class="veilborne-loadout-field">
        <span>Arma equipada</span>
        <select :value="String(gameVariables.arma_equipada ?? 'starter_arcane_sword')" @change="setLoadoutValue('arma_equipada', ($event.target as HTMLSelectElement).value)">
          <option v-for="item in veilborneWeaponOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>

      <div class="veilborne-loadout-section">
        <div class="veilborne-loadout-section-heading"><span>FEITIÇOS PREPARADOS</span><small>Teclas 1–4</small></div>
        <label v-for="slot in [1, 2, 3, 4]" :key="'spell-' + slot" class="veilborne-loadout-field">
          <span>Espaço {{ slot }}</span>
          <select :value="String(gameVariables['magia_' + slot] ?? veilborneSpellOptions[slot - 1]!.id)" @change="setLoadoutValue('magia_' + slot, ($event.target as HTMLSelectElement).value)">
            <option v-for="item in veilborneSpellOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
      </div>

      <div class="veilborne-loadout-section">
        <div class="veilborne-loadout-section-heading"><span>SIGILOS PREPARADOS</span><small>{{ keyLabel(bindings.reload) }} troca o ativo</small></div>
        <label v-for="slot in [1, 2, 3, 4]" :key="'sigil-' + slot" class="veilborne-loadout-field">
          <span>Espaço {{ slot }}{{ Number(gameVariables.sigilo_selecionado ?? 1) === slot ? ' · ATIVO' : '' }}</span>
          <select :value="String(gameVariables['sigilo_' + slot] ?? veilborneSigilOptions[(slot - 1) % veilborneSigilOptions.length]!.id)" @change="setVeilborneSigilSlot(slot, ($event.target as HTMLSelectElement).value)">
            <option v-for="item in veilborneSigilOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
      </div>

      <div class="veilborne-loadout-stats">
        <div class="veilborne-loadout-section-heading"><span>ATRIBUTOS</span><small>+1 por ponto</small></div>
        <div v-for="attribute in veilborneAttributes" :key="attribute.key">
          <small>{{ attribute.label }}</small>
          <span class="veilborne-stat-value">
            <strong>{{ Math.round(attribute.value) }}</strong>
            <button type="button" class="veilborne-stat-add" :disabled="veilborneProgression.points < 1 || attribute.value >= 999" :aria-label="'Aumentar ' + attribute.label" :title="veilborneProgression.points + ' ponto(s) de atributo disponível(eis)'" @click="spendVeilborneAttributePoint(attribute.key)">+</button>
          </span>
        </div>
      </div>
      <p class="veilborne-loadout-note">As seleções alteram as variáveis globais da sessão. O inventário de itens coletados funciona durante a sessão; a persistência entre sessões ainda será implementada.</p>
    </aside>

  </div>
</template>

<style scoped src="./VeilborneHUD.css"></style>
