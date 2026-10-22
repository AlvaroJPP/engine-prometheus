<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { deleteHudImage, readHudImage, storeHudImage } from '@/lib/hud/HudImageStorage'

const props = defineProps<{
  playerName: string
  cameraMode: string
  fps: number
  controlMapName: string
  firstPerson: boolean
  settingsOpen: boolean
  editorPreview: boolean
  worldFullscreen: boolean
  bindings: Record<string, string>
  gameVariables: Record<string, boolean | number | string>
}>()

const emit = defineEmits<{
  (event: 'toggle-camera'): void
  (event: 'exit-runtime'): void
  (event: 'settings-open-change', value: boolean): void
  (event: 'set-global-variable', name: string, value: string | number | boolean): void
}>()

type HudImageLayer = {
  id: string
  name: string
  x: number
  y: number
  width: number
  opacity: number
  visible: boolean
  fitScreen: boolean
}
type HudImageDrag = {
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
  viewportWidth: number
  viewportHeight: number
  imageWidthPercent: number
  imageHeightPercent: number
}
type HudCropRect = {
  id: string
  x: number
  y: number
  width: number
  height: number
}
type HudCropDrag = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}
type HudAlphaBounds = {
  x: number
  y: number
  width: number
  height: number
}
type HudSettings = {
  showPlayer: boolean
  showSession: boolean
  showControls: boolean
  showActions: boolean
  showCrosshair: boolean
  showQuickSlots: boolean
  scale: number
  dock: 'left' | 'right'
  quickSlots: string[]
  images: HudImageLayer[]
  vitalityVariable: string
  vitalityMaxVariable: string
  vitalityMaxValue: number
  etherVariable: string
  etherMaxVariable: string
  etherMaxValue: number
}

const STORAGE_KEY = 'engine-prometheus.player-hud.v1'
const alquimiaLibraryUrl = `${import.meta.env.BASE_URL}alquimia-escarlate-ui.html`
const defaults: HudSettings = {
  showPlayer: true,
  showSession: true,
  showControls: true,
  showActions: true,
  showCrosshair: true,
  showQuickSlots: false,
  scale: 1,
  dock: 'left',
  quickSlots: ['Habilidade 1', 'Habilidade 2', 'Item 1', 'Item 2'],
  images: [],
  vitalityVariable: 'vida',
  vitalityMaxVariable: '',
  vitalityMaxValue: 100,
  etherVariable: 'eter',
  etherMaxVariable: '',
  etherMaxValue: 100,
}
const settings = reactive<HudSettings>({ ...defaults, quickSlots: [...defaults.quickSlots], images: [] })
const showControls = ref(true)
const hudImageUrls = ref<Record<string, string>>({})
const hudImageInput = ref<HTMLInputElement | null>(null)
const hudImageError = ref('')
const activeHudImageId = ref<string | null>(null)
const hudImageDrag = ref<HudImageDrag | null>(null)
const hudSheetInput = ref<HTMLInputElement | null>(null)
const hudSheetPreview = ref<HTMLImageElement | null>(null)
const hudSheetFile = ref<File | null>(null)
const hudSheetPreviewUrl = ref('')
const hudSheetSize = ref({ width: 0, height: 0 })
const hudCropRects = ref<HudCropRect[]>([])
const hudCropDrag = ref<HudCropDrag | null>(null)
const hudCropRows = ref(1)
const hudCropColumns = ref(1)
const trimHudTransparentBorders = ref(true)
const skipHudTransparentCrops = ref(true)
const hudColorKeyEnabled = ref(false)
const hudColorKeyColor = ref('#ffffff')
const hudColorKeyTolerance = ref(24)
const hudAlphaThreshold = ref(8)
const hudCropBusy = ref(false)
const hudImageNotice = ref('')
const visibleHudImages = computed(() => settings.images.filter(layer => layer.visible && hudImageUrls.value[layer.id]))
const draftHudCrop = computed<HudCropRect | null>(() => {
  const drag = hudCropDrag.value
  if (!drag) return null
  return {
    id: 'draft-crop',
    x: Math.min(drag.startX, drag.currentX),
    y: Math.min(drag.startY, drag.currentY),
    width: Math.abs(drag.currentX - drag.startX),
    height: Math.abs(drag.currentY - drag.startY),
  }
})
const showSettings = computed({
  get: () => props.settingsOpen,
  set: (value: boolean) => emit('settings-open-change', value),
})
const fpsLabel = computed(() => props.fps > 0 ? Math.round(props.fps) : '--')
const hudStyle = computed(() => ({ '--hud-scale': String(settings.scale) }))
const bottomClasses = computed(() => ({ 'dock-right': settings.dock === 'right' }))
const numericGameVariableNames = computed(() => Object.entries(props.gameVariables)
  .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
  .map(([name]) => name)
  .sort((a, b) => a.localeCompare(b)))
const alquimiaStatusLayer = computed(() => settings.images.find(layer =>
  layer.id === 'hud-alquimia-statusbar' && layer.visible && !layer.fitScreen && Boolean(hudImageUrls.value[layer.id]),
))
function readHudStat(valueVariable: string, maxVariable: string, fallbackMax: number) {
  const raw = props.gameVariables[valueVariable.trim()]
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : null
  const rawMax = maxVariable.trim() ? props.gameVariables[maxVariable.trim()] : undefined
  const maximum = typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
    ? rawMax
    : boundedHudNumber(fallbackMax, 100, 1, 1_000_000)
  return {
    value,
    maximum,
    percent: value === null ? 0 : Math.min(100, Math.max(0, value / maximum * 100)),
    label: value === null ? '—' : Math.round(value) + ' / ' + Math.round(maximum),
  }
}
const vitalityStat = computed(() => readHudStat(settings.vitalityVariable, settings.vitalityMaxVariable, settings.vitalityMaxValue))
const etherStat = computed(() => readHudStat(settings.etherVariable, settings.etherMaxVariable, settings.etherMaxValue))

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

function boundedHudNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

onMounted(async () => {
  window.addEventListener('keydown', onVeilborneInventoryKeydown)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<HudSettings>
      const images = Array.isArray(saved.images)
        ? saved.images
            .filter((layer): layer is HudImageLayer => Boolean(layer && typeof layer.id === 'string' && typeof layer.name === 'string'))
            .map((layer) => {
              const width = boundedHudNumber(layer.width, 24, 1, 100)
              return {
                id: layer.id,
                name: layer.name.slice(0, 120),
                x: boundedHudNumber(layer.x, 5, 0, 100 - width),
                y: boundedHudNumber(layer.y, 45, 0, 100),
                width,
                opacity: boundedHudNumber(layer.opacity, 100, 10, 100),
                visible: layer.visible !== false,
                fitScreen: layer.fitScreen === true,
              }
            })
        : []
      Object.assign(settings, {
        ...defaults,
        ...saved,
        scale: boundedHudNumber(saved.scale, defaults.scale, 0.75, 1.25),
        dock: saved.dock === 'right' ? 'right' : 'left',
        quickSlots: Array.isArray(saved.quickSlots)
          ? defaults.quickSlots.map((fallback, index) => String(saved.quickSlots?.[index] ?? fallback).slice(0, 22))
          : [...defaults.quickSlots],
        images,
      })
    }
  } catch {
    Object.assign(settings, defaults, { quickSlots: [...defaults.quickSlots], images: [] })
  }

  for (const layer of settings.images) {
    try {
      const blob = await readHudImage(layer.id)
      if (blob) hudImageUrls.value[layer.id] = URL.createObjectURL(blob)
    } catch {
      // An inaccessible image stays in the list so the user can remove/reimport it.
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onVeilborneInventoryKeydown)
  finishHudImageDrag()
  cancelHudCropDrag()
  finishLoadoutDrag()
  Object.values(hudImageUrls.value).forEach(url => URL.revokeObjectURL(url))
  if (hudSheetPreviewUrl.value) URL.revokeObjectURL(hudSheetPreviewUrl.value)
})

function createAlquimiaSvg(name: string): Blob {
  const art: Record<string, string> = {
    nameplate: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 150"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#10172a" stop-opacity=".96"/><stop offset="1" stop-color="#28192e" stop-opacity=".94"/></linearGradient><linearGradient id="copper"><stop stop-color="#75452f"/><stop offset=".5" stop-color="#e5b17b"/><stop offset="1" stop-color="#75452f"/></linearGradient></defs><path d="M18 14H565L602 48V105L565 136H18L7 119V31Z" fill="url(#bg)" stroke="url(#copper)" stroke-width="3"/><path d="M26 24H557L590 53V100L557 126H26L18 114V36Z" fill="none" stroke="#bd8c65" stroke-opacity=".58"/><path d="M36 42H115M36 49H82M505 112H574" stroke="#c9976d" stroke-width="2"/><path d="M42 75l13-13 13 13-13 13z" fill="none" stroke="#d8a77c" stroke-width="2"/><circle cx="55" cy="75" r="4" fill="#d8a77c"/><text x="83" y="73" fill="#f1d6b1" font-family="Georgia,serif" font-size="26" letter-spacing="3">ALQUIMISTA</text><text x="84" y="98" fill="#bba9bd" font-family="Georgia,serif" font-size="13" letter-spacing="2">CÍRCULO ESCARLATE</text><path d="M535 40l9 10-9 10-9-10zM556 40l9 10-9 10-9-10z" fill="none" stroke="#d8a77c"/></svg>',
    sigil: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs><radialGradient id="glow"><stop stop-color="#b76c58" stop-opacity=".19"/><stop offset="1" stop-color="#12192b" stop-opacity="0"/></radialGradient></defs><circle cx="120" cy="120" r="115" fill="url(#glow)"/><g fill="none" stroke="#c78c65" stroke-width="2" stroke-opacity=".92"><circle cx="120" cy="120" r="91"/><circle cx="120" cy="120" r="78" stroke-dasharray="3 7"/><path d="M120 22L205 169H35Z M120 218L35 71H205Z"/><path d="M120 48L145 95L192 120L145 145L120 192L95 145L48 120L95 95Z" stroke-opacity=".65"/><path d="M120 72L168 120L120 168L72 120Z"/></g><circle cx="120" cy="120" r="8" fill="#d99b71"/><g fill="#e9c29a"><circle cx="120" cy="22" r="3"/><circle cx="205" cy="169" r="3"/><circle cx="35" cy="169" r="3"/><circle cx="120" cy="218" r="3"/></g></svg>',
    statusbar: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 118"><defs><linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#1a1d31" stop-opacity=".97"/><stop offset="1" stop-color="#101522" stop-opacity=".96"/></linearGradient><linearGradient id="copper"><stop stop-color="#69402e"/><stop offset=".5" stop-color="#d9a476"/><stop offset="1" stop-color="#69402e"/></linearGradient></defs><path d="M15 9H735L751 25V92L735 108H15L7 98V20Z" fill="url(#panel)" stroke="url(#copper)" stroke-width="2.5"/><path d="M28 19H724L738 31V85L724 98H28L20 88V28Z" fill="none" stroke="#b77c58" stroke-opacity=".52"/><g fill="none" stroke="#c58c67" stroke-width="2"><path d="M42 34l10 10-10 10-10-10zM718 34l10 10-10 10-10-10z"/><path d="M74 34H330M74 42H280M430 76H686M490 84H686" stroke-opacity=".55"/></g><text x="76" y="70" fill="#e8c8a5" font-family="Georgia,serif" font-size="17" letter-spacing="2">VITALIDADE</text><rect x="238" y="54" width="178" height="17" rx="3" fill="#090e18" stroke="#95684e"/><rect x="242" y="58" width="130" height="9" rx="2" fill="#a83e4c"/><text x="444" y="70" fill="#e8c8a5" font-family="Georgia,serif" font-size="17" letter-spacing="2">ÉTER</text><rect x="505" y="54" width="178" height="17" rx="3" fill="#090e18" stroke="#95684e"/><rect x="509" y="58" width="115" height="9" rx="2" fill="#547eb4"/></svg>'
  }
  return new Blob([art[name] ?? art.nameplate], { type: 'image/svg+xml' })
}

async function applyAlquimiaHudPreset(): Promise<void> {
  hudImageError.value = ''
  hudImageNotice.value = ''
  const presets = [
    { key: 'nameplate', id: 'hud-alquimia-nameplate', name: 'Alquimia Escarlate · Placa do jogador', x: 2, y: 2, width: 33 },
    { key: 'sigil', id: 'hud-alquimia-sigil', name: 'Alquimia Escarlate · Sigilo mágico', x: 78, y: 3, width: 18 },
    { key: 'statusbar', id: 'hud-alquimia-statusbar', name: 'Alquimia Escarlate · Barras decorativas', x: 27, y: 85, width: 46 },
  ]
  const added: HudImageLayer[] = []
  const urls = { ...hudImageUrls.value }
  const createdUrls: string[] = []
  try {
    for (const preset of presets) {
      const blob = createAlquimiaSvg(preset.key)
      await storeHudImage(preset.id, blob)
      const url = URL.createObjectURL(blob)
      urls[preset.id] = url
      createdUrls.push(url)
      added.push({
        id: preset.id,
        name: preset.name,
        x: preset.x,
        y: preset.y,
        width: preset.width,
        opacity: 100,
        visible: true,
        fitScreen: false,
      })
    }

    // Remove previous copies of the theme only after all new artwork was stored.
    const oldThemeLayers = settings.images.filter(layer =>
      layer.name.startsWith('Alquimia Escarlate ·') && !presets.some(preset => preset.id === layer.id),
    )
    for (const layer of oldThemeLayers) {
      const oldUrl = urls[layer.id]
      if (oldUrl) URL.revokeObjectURL(oldUrl)
      delete urls[layer.id]
      try { await deleteHudImage(layer.id) } catch { /* remove a camada mesmo se o blob antigo já não existir */ }
    }

    // Stable IDs make applying the preset repeatable instead of stacking duplicates.
    const presetIds = new Set(presets.map(preset => preset.id))
    settings.images = settings.images.filter(layer => !presetIds.has(layer.id) && !layer.name.startsWith('Alquimia Escarlate ·'))
    settings.images.push(...added)
    hudImageUrls.value = urls
    activeHudImageId.value = null
    persistHudSettings()
    hudImageNotice.value = 'Tema Alquimia Escarlate aplicado. As três peças foram atualizadas sem duplicar camadas anteriores; você pode mover, redimensionar, ocultar e ajustar a opacidade.'
  } catch (error) {
    for (const url of createdUrls) URL.revokeObjectURL(url)
    for (const preset of presets) {
      try { await deleteHudImage(preset.id) } catch { /* preserva o erro principal */ }
    }
    // Restore the previous URL map; current layer metadata remains unchanged on failure.
    hudImageError.value = error instanceof Error ? error.message : 'Não foi possível aplicar o tema Alquimia Escarlate.'
  }
}

async function removeAlquimiaHudPreset(): Promise<void> {
  const themeLayers = settings.images.filter(layer => layer.name.startsWith('Alquimia Escarlate ·'))
  if (!themeLayers.length) {
    hudImageNotice.value = 'O tema Alquimia Escarlate não está aplicado.'
    hudImageError.value = ''
    return
  }
  for (const layer of themeLayers) await removeHudImage(layer.id)
  hudImageError.value = ''
  hudImageNotice.value = 'Tema Alquimia Escarlate removido. As outras imagens personalizadas foram mantidas.'
}

function chooseHudImage(): void {
  hudImageError.value = ''
  hudImageInput.value?.click()
}

async function importHudImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  hudImageError.value = ''
  if (!file) return

  const supportedTypes = ['image/png', 'image/jpeg', 'image/webp']
  if (!supportedTypes.includes(file.type)) {
    hudImageError.value = 'Use uma imagem PNG, JPG ou WebP.'
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    hudImageError.value = 'A imagem deve ter até 10 MB.'
    return
  }

  const id = 'hud-image-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  try {
    await storeHudImage(id, file)
    hudImageUrls.value = { ...hudImageUrls.value, [id]: URL.createObjectURL(file) }
    settings.images.push({
      id,
      name: file.name.slice(0, 120),
      x: 5,
      y: 45,
      width: 24,
      opacity: 100,
      visible: true,
      fitScreen: false,
    })
    activeHudImageId.value = id
  } catch (error) {
    hudImageError.value = error instanceof Error ? error.message : 'Não foi possível importar a imagem.'
  }
}

function chooseHudSheet(): void {
  hudImageError.value = ''
  hudImageNotice.value = ''
  hudSheetInput.value?.click()
}

async function importHudSheet(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  hudImageError.value = ''
  hudImageNotice.value = ''
  if (!file) return

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    hudImageError.value = 'Use uma imagem PNG, JPG ou WebP para recortar.'
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    hudImageError.value = 'A imagem para recorte deve ter até 10 MB.'
    return
  }

  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Não foi possível abrir essa imagem.'))
      image.src = url
    })
    cancelHudCropDrag()
    if (hudSheetPreviewUrl.value) URL.revokeObjectURL(hudSheetPreviewUrl.value)
    hudSheetFile.value = file
    hudSheetPreviewUrl.value = url
    hudSheetSize.value = { width: image.naturalWidth, height: image.naturalHeight }
    hudCropRects.value = []
    hudCropRows.value = 1
    hudCropColumns.value = 1
  } catch (error) {
    URL.revokeObjectURL(url)
    hudImageError.value = error instanceof Error ? error.message : 'Não foi possível abrir essa imagem.'
  }
}

function closeHudSheetEditor(): void {
  cancelHudCropDrag()
  if (hudSheetPreviewUrl.value) URL.revokeObjectURL(hudSheetPreviewUrl.value)
  hudSheetPreviewUrl.value = ''
  hudSheetFile.value = null
  hudSheetSize.value = { width: 0, height: 0 }
  hudCropRects.value = []
  hudImageNotice.value = ''
}

function hudCropStyle(crop: HudCropRect): Record<string, string> {
  const width = Math.max(1, hudSheetSize.value.width)
  const height = Math.max(1, hudSheetSize.value.height)
  return {
    left: (crop.x / width * 100) + '%',
    top: (crop.y / height * 100) + '%',
    width: (crop.width / width * 100) + '%',
    height: (crop.height / height * 100) + '%',
  }
}

function hudCropPoint(event: PointerEvent): { x: number; y: number } | null {
  const image = hudSheetPreview.value
  const naturalWidth = hudSheetSize.value.width
  const naturalHeight = hudSheetSize.value.height
  if (!image || !naturalWidth || !naturalHeight) return null
  const rect = image.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: Math.max(0, Math.min(naturalWidth, ((event.clientX - rect.left) / rect.width) * naturalWidth)),
    y: Math.max(0, Math.min(naturalHeight, ((event.clientY - rect.top) / rect.height) * naturalHeight)),
  }
}

function beginHudCropSelection(event: PointerEvent): void {
  if (!hudSheetFile.value || hudCropBusy.value || event.button !== 0) return
  const point = hudCropPoint(event)
  if (!point) return
  event.preventDefault()
  event.stopPropagation()
  hudCropDrag.value = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y }
  window.addEventListener('pointermove', moveHudCropSelection)
  window.addEventListener('pointerup', finishHudCropDrag)
  window.addEventListener('pointercancel', finishHudCropDrag)
}

function moveHudCropSelection(event: PointerEvent): void {
  if (!hudCropDrag.value) return
  const point = hudCropPoint(event)
  if (!point) return
  hudCropDrag.value.currentX = point.x
  hudCropDrag.value.currentY = point.y
}

function cancelHudCropDrag(): void {
  hudCropDrag.value = null
  window.removeEventListener('pointermove', moveHudCropSelection)
  window.removeEventListener('pointerup', finishHudCropDrag)
  window.removeEventListener('pointercancel', finishHudCropDrag)
}

function finishHudCropDrag(): void {
  const drag = hudCropDrag.value
  cancelHudCropDrag()
  if (!drag) return
  const crop: HudCropRect = {
    id: 'hud-crop-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    x: Math.min(drag.startX, drag.currentX),
    y: Math.min(drag.startY, drag.currentY),
    width: Math.abs(drag.currentX - drag.startX),
    height: Math.abs(drag.currentY - drag.startY),
  }
  if (crop.width < 4 || crop.height < 4) return
  crop.x = Math.max(0, Math.min(hudSheetSize.value.width, crop.x))
  crop.y = Math.max(0, Math.min(hudSheetSize.value.height, crop.y))
  crop.width = Math.min(crop.width, hudSheetSize.value.width - crop.x)
  crop.height = Math.min(crop.height, hudSheetSize.value.height - crop.y)
  if (crop.width >= 4 && crop.height >= 4) hudCropRects.value.push(crop)
}

function generateHudGridCrops(): void {
  const width = hudSheetSize.value.width
  const height = hudSheetSize.value.height
  if (!width || !height) {
    hudImageError.value = 'Importe uma imagem antes de gerar a grade.'
    return
  }
  const rows = Math.max(1, Math.min(32, Math.floor(Number(hudCropRows.value) || 1)))
  const columns = Math.max(1, Math.min(32, Math.floor(Number(hudCropColumns.value) || 1)))
  if (rows * columns > 256) {
    hudImageError.value = 'A grade pode gerar no máximo 256 recortes.'
    return
  }
  hudCropRows.value = rows
  hudCropColumns.value = columns
  hudCropRects.value = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      hudCropRects.value.push({
        id: 'hud-grid-' + row + '-' + column,
        x: column * width / columns,
        y: row * height / rows,
        width: width / columns,
        height: height / rows,
      })
    }
  }
  hudImageError.value = ''
  hudImageNotice.value = ''
}

function detectHudTransparentParts(): void {
  const source = hudSheetPreview.value
  const sheetWidth = hudSheetSize.value.width
  const sheetHeight = hudSheetSize.value.height
  if (!source || !sheetWidth || !sheetHeight) {
    hudImageError.value = 'Importe uma imagem antes de detectar as partes.'
    return
  }

  // Detect on a bounded thumbnail so large source images do not require a full-resolution flood fill.
  const sampleScale = Math.min(1, 256 / Math.max(sheetWidth, sheetHeight))
  const sampleWidth = Math.max(1, Math.round(sheetWidth * sampleScale))
  const sampleHeight = Math.max(1, Math.round(sheetHeight * sampleScale))
  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    hudImageError.value = 'Não foi possível analisar a transparência da imagem.'
    return
  }
  context.drawImage(source, 0, 0, sampleWidth, sampleHeight)
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data
  const keyHex = hudColorKeyColor.value.match(/^#([0-9a-f]{6})$/i)?.[1]
  const key = keyHex
    ? [parseInt(keyHex.slice(0, 2), 16), parseInt(keyHex.slice(2, 4), 16), parseInt(keyHex.slice(4, 6), 16)]
    : null
  const tolerance = Math.max(0, Math.min(255, Math.floor(Number(hudColorKeyTolerance.value) || 0)))
  const alphaThreshold = Math.max(0, Math.min(255, Math.floor(Number(hudAlphaThreshold.value) || 0)))
  const pixelCount = sampleWidth * sampleHeight
  const visited = new Uint8Array(pixelCount)

  const isVisiblePixel = (index: number): boolean => {
    const offset = index * 4
    if (pixels[offset + 3] <= alphaThreshold) return false
    if (!hudColorKeyEnabled.value || !key) return true
    return !(
      Math.abs(pixels[offset] - key[0]) <= tolerance &&
      Math.abs(pixels[offset + 1] - key[1]) <= tolerance &&
      Math.abs(pixels[offset + 2] - key[2]) <= tolerance
    )
  }

  const components: Array<{ x: number; y: number; width: number; height: number; area: number }> = []
  const queue = new Int32Array(pixelCount)
  for (let start = 0; start < pixelCount; start++) {
    if (visited[start] || !isVisiblePixel(start)) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1
    let minX = sampleWidth
    let minY = sampleHeight
    let maxX = -1
    let maxY = -1
    while (head < tail) {
      const index = queue[head++]
      const x = index % sampleWidth
      const y = Math.floor(index / sampleWidth)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= sampleHeight) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= sampleWidth) continue
          const neighbor = ny * sampleWidth + nx
          if (visited[neighbor] || !isVisiblePixel(neighbor)) continue
          visited[neighbor] = 1
          queue[tail++] = neighbor
        }
      }
    }
    const componentWidth = maxX - minX + 1
    const componentHeight = maxY - minY + 1
    // Ignore tiny alpha specks caused by compression or stray pixels.
    if (tail < 3 || componentWidth < 2 || componentHeight < 2) continue
    // Include one thumbnail pixel around the detected shape so soft alpha edges
    // are not clipped; optional trimming can remove that padding after cropping.
    const paddedMinX = Math.max(0, minX - 1)
    const paddedMinY = Math.max(0, minY - 1)
    const paddedMaxX = Math.min(sampleWidth - 1, maxX + 1)
    const paddedMaxY = Math.min(sampleHeight - 1, maxY + 1)
    components.push({
      x: paddedMinX / sampleWidth * sheetWidth,
      y: paddedMinY / sampleHeight * sheetHeight,
      width: (paddedMaxX - paddedMinX + 1) / sampleWidth * sheetWidth,
      height: (paddedMaxY - paddedMinY + 1) / sampleHeight * sheetHeight,
      area: tail,
    })
  }

  const detected = components
    .sort((a, b) => b.area - a.area)
    .slice(0, 256)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((component, index): HudCropRect => ({
      id: 'hud-auto-' + index + '-' + Math.random().toString(36).slice(2, 7),
      x: component.x,
      y: component.y,
      width: component.width,
      height: component.height,
    }))

  if (!detected.length) {
    hudImageError.value = 'Nenhuma parte detectada. Se o fundo não for transparente, marque “Tornar uma cor específica transparente” e tente novamente.'
    hudImageNotice.value = ''
    return
  }

  hudCropRects.value = detected
  hudImageError.value = ''
  hudImageNotice.value = 'Detectadas ' + detected.length + ' parte(s). Revise os retângulos antes de criar as camadas.'
}

function clearHudCropRects(): void {
  hudCropRects.value = []
}

function removeHudCropRect(id: string): void {
  hudCropRects.value = hudCropRects.value.filter(crop => crop.id !== id)
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('O navegador não conseguiu gerar o recorte PNG.'))
    }, 'image/png')
  })
}

function findHudAlphaBounds(canvas: HTMLCanvasElement): HudAlphaBounds | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Não foi possível processar a transparência da imagem.')
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  let minX = canvas.width
  let minY = canvas.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const alpha = data[(y * canvas.width + x) * 4 + 3]
      if (alpha > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function applyHudColorKey(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Não foi possível processar a cor transparente.')
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const target = hudColorKeyColor.value.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!target) return
  const red = parseInt(target.slice(0, 2), 16)
  const green = parseInt(target.slice(2, 4), 16)
  const blue = parseInt(target.slice(4, 6), 16)
  const tolerance = Math.max(0, Math.min(255, Math.floor(Number(hudColorKeyTolerance.value) || 0)))
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (
      Math.abs(pixels.data[i] - red) <= tolerance &&
      Math.abs(pixels.data[i + 1] - green) <= tolerance &&
      Math.abs(pixels.data[i + 2] - blue) <= tolerance
    ) pixels.data[i + 3] = 0
  }
  context.putImageData(pixels, 0, 0)
}

async function cropHudSheetParts(): Promise<void> {
  const source = hudSheetPreview.value
  const sheetWidth = hudSheetSize.value.width
  const sheetHeight = hudSheetSize.value.height
  if (!source || !sheetWidth || !sheetHeight) {
    hudImageError.value = 'Importe uma imagem para começar a recortar.'
    return
  }
  if (!hudCropRects.value.length) {
    hudImageError.value = 'Selecione uma ou mais áreas de recorte primeiro.'
    return
  }

  hudCropBusy.value = true
  hudImageError.value = ''
  hudImageNotice.value = ''
  let created = 0
  let skipped = 0
  try {
    for (let index = 0; index < hudCropRects.value.length; index++) {
      const crop = hudCropRects.value[index]
      const sx = Math.max(0, Math.floor(crop.x))
      const sy = Math.max(0, Math.floor(crop.y))
      const sw = Math.min(sheetWidth - sx, Math.max(1, Math.ceil(crop.width)))
      const sh = Math.min(sheetHeight - sy, Math.max(1, Math.ceil(crop.height)))
      if (sw <= 0 || sh <= 0) { skipped++; continue }

      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Não foi possível criar a área de recorte.')
      context.clearRect(0, 0, sw, sh)
      context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)

      if (hudColorKeyEnabled.value) applyHudColorKey(canvas)
      const alphaBounds = findHudAlphaBounds(canvas)
      if (!alphaBounds && skipHudTransparentCrops.value) {
        skipped++
        continue
      }

      let outputCanvas = canvas
      let trimX = 0
      let trimY = 0
      if (trimHudTransparentBorders.value && alphaBounds) {
        trimX = alphaBounds.x
        trimY = alphaBounds.y
        const trimmed = document.createElement('canvas')
        trimmed.width = alphaBounds.width
        trimmed.height = alphaBounds.height
        const trimmedContext = trimmed.getContext('2d')
        if (!trimmedContext) throw new Error('Não foi possível aparar as margens transparentes.')
        trimmedContext.drawImage(canvas, trimX, trimY, alphaBounds.width, alphaBounds.height, 0, 0, alphaBounds.width, alphaBounds.height)
        outputCanvas = trimmed
      }

      const blob = await canvasToPngBlob(outputCanvas)
      const id = 'hud-image-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      await storeHudImage(id, blob)
      hudImageUrls.value = { ...hudImageUrls.value, [id]: URL.createObjectURL(blob) }
      const widthPercent = boundedHudNumber(outputCanvas.width / sheetWidth * 100, 12, 1, 100)
      settings.images.push({
        id,
        name: (hudSheetFile.value?.name.replace(/\.[^.]+$/, '') || 'HUD') + ' · parte ' + String(index + 1).padStart(2, '0'),
        x: boundedHudNumber((sx + trimX) / sheetWidth * 100, 0, 0, Math.max(0, 100 - widthPercent)),
        y: boundedHudNumber((sy + trimY) / sheetHeight * 100, 0, 0, 100),
        width: widthPercent,
        opacity: 100,
        visible: true,
        fitScreen: false,
      })
      created++
    }

    if (created > 0) {
      activeHudImageId.value = null
      persistHudSettings()
      hudImageNotice.value = created + ' recorte(s) adicionado(s) ao HUD.' + (skipped ? ' ' + skipped + ' área(s) transparente(s) ignorada(s).' : '')
    } else {
      hudImageError.value = 'Nenhuma parte visível foi gerada. Confira as áreas e as opções de transparência.'
    }
  } catch (error) {
    hudImageError.value = error instanceof Error ? error.message : 'Não foi possível gerar as partes do HUD.'
  } finally {
    hudCropBusy.value = false
  }
}

function toggleHudImagePosition(layer: HudImageLayer): void {
  if (layer.fitScreen) {
    activeHudImageId.value = null
    return
  }
  activeHudImageId.value = activeHudImageId.value === layer.id ? null : layer.id
}

function toggleHudImageFit(layer: HudImageLayer): void {
  layer.fitScreen = !layer.fitScreen
  if (layer.fitScreen) {
    layer.x = 0
    layer.y = 0
    activeHudImageId.value = null
  }
}

function clampHudImagePosition(layer: HudImageLayer): void {
  layer.width = boundedHudNumber(layer.width, 24, 1, 100)
  layer.opacity = boundedHudNumber(layer.opacity, 100, 10, 100)
  layer.x = boundedHudNumber(layer.x, 5, 0, 100 - layer.width)
  layer.y = boundedHudNumber(layer.y, 45, 0, 100)
}

async function removeHudImage(id: string): Promise<void> {
  settings.images = settings.images.filter(layer => layer.id !== id)
  if (activeHudImageId.value === id) activeHudImageId.value = null
  const existingUrl = hudImageUrls.value[id]
  if (existingUrl) URL.revokeObjectURL(existingUrl)
  const nextUrls = { ...hudImageUrls.value }
  delete nextUrls[id]
  hudImageUrls.value = nextUrls
  try {
    await deleteHudImage(id)
  } catch {
    // The metadata removal is still applied even if the browser store is unavailable.
  }
}

function beginHudImageDrag(event: PointerEvent, layer: HudImageLayer): void {
  if (activeHudImageId.value !== layer.id || event.button !== 0) return
  const root = (event.currentTarget as HTMLElement).closest('.player-hud')
  if (!(root instanceof HTMLElement)) return
  const rect = root.getBoundingClientRect()
  const imageRect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (!rect.width || !rect.height) return

  event.preventDefault()
  event.stopPropagation()
  hudImageDrag.value = {
    id: layer.id,
    startX: event.clientX,
    startY: event.clientY,
    originX: layer.x,
    originY: layer.y,
    viewportWidth: rect.width,
    viewportHeight: rect.height,
    imageWidthPercent: imageRect.width / rect.width * 100,
    imageHeightPercent: imageRect.height / rect.height * 100,
  }
  window.addEventListener('pointermove', moveHudImage)
  window.addEventListener('pointerup', finishHudImageDrag)
  window.addEventListener('pointercancel', finishHudImageDrag)
}

function moveHudImage(event: PointerEvent): void {
  const drag = hudImageDrag.value
  if (!drag) return
  const layer = settings.images.find(item => item.id === drag.id)
  if (!layer) return
  // Mantém a camada inteira dentro da HUD, considerando seu tamanho renderizado.
  layer.x = boundedHudNumber(drag.originX + ((event.clientX - drag.startX) / drag.viewportWidth) * 100, drag.originX, 0, Math.max(0, 100 - drag.imageWidthPercent))
  layer.y = boundedHudNumber(drag.originY + ((event.clientY - drag.startY) / drag.viewportHeight) * 100, drag.originY, 0, Math.max(0, 100 - drag.imageHeightPercent))
}

function keepHudImageInside(event: Event, layer: HudImageLayer): void {
  if (layer.fitScreen) return
  const image = event.currentTarget as HTMLImageElement
  const root = image.closest('.player-hud')
  if (!(root instanceof HTMLElement)) return
  const rootRect = root.getBoundingClientRect()
  const imageRect = image.getBoundingClientRect()
  if (!rootRect.width || !rootRect.height || !imageRect.width || !imageRect.height) return

  // Também corrige as posições antigas salvas antes de existir o limite vertical.
  const maxX = Math.max(0, 100 - imageRect.width / rootRect.width * 100)
  const maxY = Math.max(0, 100 - imageRect.height / rootRect.height * 100)
  const nextX = boundedHudNumber(layer.x, 0, 0, maxX)
  const nextY = boundedHudNumber(layer.y, 0, 0, maxY)
  if (nextX === layer.x && nextY === layer.y) return
  layer.x = nextX
  layer.y = nextY
  persistHudSettings()
}

function finishHudImageDrag(): void {
  const hadActiveDrag = hudImageDrag.value !== null
  hudImageDrag.value = null
  window.removeEventListener('pointermove', moveHudImage)
  window.removeEventListener('pointerup', finishHudImageDrag)
  window.removeEventListener('pointercancel', finishHudImageDrag)
  if (hadActiveDrag) persistHudSettings()
}

function persistHudSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // HUD preferences remain usable for this session if storage is unavailable.
  }
}

watch(settings, () => {
  // Dragging updates coordinates many times per second; save when the drag ends.
  if (hudImageDrag.value) return
  persistHudSettings()
}, { deep: true, flush: 'sync' })

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

function resetSettings() {
  const savedImages = settings.images.map(layer => ({ ...layer }))
  Object.assign(settings, defaults, { quickSlots: [...defaults.quickSlots], images: savedImages })
  activeHudImageId.value = null
  showControls.value = true
}
</script>

<template>
  <section class="player-hud" :class="{ 'hud-world-fullscreen': worldFullscreen, 'editor-preview': editorPreview, 'is-positioning-hud-image': activeHudImageId !== null }" :style="hudStyle" :aria-label="editorPreview ? 'Prévia da interface do jogador' : 'Interface do jogador'">
    <div class="hud-topline" :class="{ 'topline-reverse': settings.dock === 'right' }">
      <div v-if="settings.showPlayer" class="hud-player-card">
        <div class="hud-avatar" aria-hidden="true"><span>P</span></div>
        <div class="hud-player-copy">
          <span class="hud-eyebrow">JOGADOR</span>
          <strong :title="playerName">{{ playerName || 'Player' }}</strong>
          <span class="hud-state"><i /> {{ editorPreview ? 'PRÉVIA' : 'EM JOGO' }}</span>
        </div>
      </div>

      <div v-if="settings.showSession" class="hud-session-card">
        <span class="hud-live-dot" />
        <span>{{ editorPreview ? 'PRÉVIA' : 'RUN' }}</span>
        <span class="hud-session-divider" />
        <span class="hud-camera">{{ cameraMode }}</span>
        <span class="hud-session-divider" />
        <span class="hud-fps">{{ fpsLabel }} <small>FPS</small></span>
      </div>
    </div>

    <img
      v-for="layer in visibleHudImages"
      :key="layer.id"
      class="hud-custom-image"
      :class="{ 'is-positioning': activeHudImageId === layer.id }"
      :src="hudImageUrls[layer.id]"
      :alt="activeHudImageId === layer.id ? 'Arraste para posicionar: ' + layer.name : ''"
      :aria-hidden="activeHudImageId !== layer.id"
      :style="layer.fitScreen
        ? { left: '0%', top: '0%', width: '100%', height: '100%', objectFit: 'contain', opacity: layer.opacity / 100 }
        : { left: layer.x + '%', top: layer.y + '%', width: layer.width + '%', opacity: layer.opacity / 100 }"
      draggable="false"
      @pointerdown="beginHudImageDrag($event, layer)"
      @load="keepHudImageInside($event, layer)"
    >

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
      <p class="veilborne-loadout-note">As seleções alteram as variáveis globais da sessão. O inventário de itens coletáveis e a persistência entre sessões ainda serão implementados.</p>
    </aside>

    <div
      v-if="alquimiaStatusLayer"
      class="hud-alquimia-live-bars"
      :style="{
        left: alquimiaStatusLayer.x + '%',
        top: alquimiaStatusLayer.y + '%',
        width: alquimiaStatusLayer.width + '%',
        opacity: alquimiaStatusLayer.opacity / 100,
      }"
      aria-label="Barras do jogador conectadas às variáveis globais"
    >
      <div class="hud-live-track hud-live-vitality" :title="'Vitalidade: ' + vitalityStat.label" role="progressbar" :aria-valuenow="vitalityStat.value ?? 0" :aria-valuemin="0" :aria-valuemax="vitalityStat.maximum" :aria-label="'Vitalidade ' + vitalityStat.label">
        <div class="hud-live-fill" :style="{ width: vitalityStat.percent + '%' }" />
        <span>{{ vitalityStat.label }}</span>
      </div>
      <div class="hud-live-track hud-live-ether" :title="'Éter: ' + etherStat.label" role="progressbar" :aria-valuenow="etherStat.value ?? 0" :aria-valuemin="0" :aria-valuemax="etherStat.maximum" :aria-label="'Éter ' + etherStat.label">
        <div class="hud-live-fill" :style="{ width: etherStat.percent + '%' }" />
        <span>{{ etherStat.label }}</span>
      </div>
    </div>

    <div v-if="showSettings" class="hud-settings-panel" role="dialog" aria-label="Personalizar interface do jogador" @wheel.stop>
      <div class="settings-heading">
        <div><span class="hud-eyebrow">ENGINE PROMETHEUS</span><strong>Personalizar HUD</strong></div>
        <button type="button" class="settings-close" @click="showSettings = false" aria-label="Fechar">×</button>
      </div>
      <p class="settings-description">{{ editorPreview ? 'Prévia no modo de edição. Ajuste os elementos e confira o resultado antes de executar a cena.' : 'Escolha o que aparece durante o jogo. As preferências são salvas neste dispositivo.' }}</p>
      <div class="settings-toggles">
        <label><input v-model="settings.showPlayer" type="checkbox"> Cartão do jogador</label>
        <label><input v-model="settings.showSession" type="checkbox"> Câmera e FPS</label>
        <label><input v-model="settings.showControls" type="checkbox"> Painel de controles</label>
        <label><input v-model="settings.showActions" type="checkbox"> Botões de sessão</label>
        <label><input v-model="settings.showCrosshair" type="checkbox"> Mira na primeira pessoa</label>
        <label><input v-model="settings.showQuickSlots" type="checkbox"> Barra de atalhos personalizada</label>
      </div>
      <div class="settings-field">
        <label for="hud-scale">Escala da interface <strong>{{ Math.round(settings.scale * 100) }}%</strong></label>
        <input id="hud-scale" v-model.number="settings.scale" type="range" min="0.75" max="1.25" step="0.05">
      </div>
      <div class="settings-field">
        <span>Posição dos painéis inferiores</span>
        <div class="dock-options">
          <button type="button" :class="{ active: settings.dock === 'left' }" @click="settings.dock = 'left'">Controles à esquerda</button>
          <button type="button" :class="{ active: settings.dock === 'right' }" @click="settings.dock = 'right'">Controles à direita</button>
        </div>
      </div>
      <div v-if="settings.showQuickSlots" class="settings-field">
        <span>Rótulos dos atalhos (visuais)</span>
        <div class="slot-editor">
          <input v-for="(_slot, index) in settings.quickSlots" :key="index" v-model="settings.quickSlots[index]" :aria-label="'Rótulo do atalho ' + (index + 1)" maxlength="22">
        </div>
        <small>Os espaços são personalizáveis; ainda não estão conectados a inventário ou habilidades do jogo.</small>
      </div>

      <div class="settings-field hud-runtime-bars-settings">
        <span>Barras conectadas ao Visual Script</span>
        <p class="hud-runtime-help">As barras leem variáveis globais numéricas durante o modo Run. Crie/atualize essas variáveis nos eventos do Visual Script; se a variável não existir ou não for numérica, o HUD mostrará “—”, sem inventar um valor.</p>
        <datalist id="hud-game-variable-suggestions">
          <option v-for="name in numericGameVariableNames" :key="name" :value="name" />
        </datalist>
        <label>Vitalidade · variável atual
          <input v-model.trim="settings.vitalityVariable" list="hud-game-variable-suggestions" maxlength="80" placeholder="vida">
        </label>
        <label>Vitalidade · variável de máximo (opcional)
          <input v-model.trim="settings.vitalityMaxVariable" list="hud-game-variable-suggestions" maxlength="80" placeholder="deixe vazio para usar o máximo padrão">
        </label>
        <label>Vitalidade · máximo padrão
          <input v-model.number="settings.vitalityMaxValue" type="number" min="1" max="1000000" step="1">
        </label>
        <div class="hud-runtime-separator" />
        <label>Éter · variável atual
          <input v-model.trim="settings.etherVariable" list="hud-game-variable-suggestions" maxlength="80" placeholder="eter">
        </label>
        <label>Éter · variável de máximo (opcional)
          <input v-model.trim="settings.etherMaxVariable" list="hud-game-variable-suggestions" maxlength="80" placeholder="deixe vazio para usar o máximo padrão">
        </label>
        <label>Éter · máximo padrão
          <input v-model.number="settings.etherMaxValue" type="number" min="1" max="1000000" step="1">
        </label>
        <small v-if="numericGameVariableNames.length">Variáveis numéricas encontradas: {{ numericGameVariableNames.join(', ') }}</small>
        <small v-else>Nenhuma variável global numérica foi encontrada ainda. Você pode configurar os nomes agora e criá-las no Visual Script.</small>
      </div>

      <div class="settings-field hud-images-field">
        <span>Imagens personalizadas do HUD</span>
        <button type="button" class="hud-alquimia-apply" @click="applyAlquimiaHudPreset">
          <span aria-hidden="true">✦</span>
          <span><strong>Aplicar tema Alquimia Escarlate</strong><small>Adiciona ou atualiza as 3 peças sem criar duplicatas</small></span>
          <span aria-hidden="true">＋</span>
        </button>
        <button type="button" class="hud-alquimia-remove" @click="removeAlquimiaHudPreset">
          <span aria-hidden="true">×</span>
          <span><strong>Remover tema Alquimia Escarlate</strong><small>Remove apenas as peças do tema e preserva suas outras imagens</small></span>
        </button>
        <a class="hud-alquimia-library" :href="alquimiaLibraryUrl" target="_blank" rel="noreferrer">
          <span aria-hidden="true">✦</span>
          <span><strong>Biblioteca ALQUIMIA ESCARLATE</strong><small>Ver molduras, sigilos, botões e HUD de fantasia</small></span>
          <span aria-hidden="true">↗</span>
        </a>
        <input
          ref="hudImageInput"
          class="hud-image-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Selecionar imagem para o HUD"
          @change="importHudImage"
        >
        <button type="button" class="hud-image-import" @click="chooseHudImage">＋ Importar imagem PNG, JPG ou WebP</button>
        <small>Adicione uma imagem já pronta como uma camada do HUD. Limite: 10 MB por arquivo.</small>
        <input
          ref="hudSheetInput"
          class="hud-image-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Selecionar imagem para recortar em partes"
          @change="importHudSheet"
        >
        <button type="button" class="hud-image-import hud-image-slice-trigger" @click="chooseHudSheet">▧ Recortar uma imagem em partes</button>
        <small>Use um PNG único com várias molduras, ícones e áreas transparentes. Arraste para criar recortes ou divida em uma grade; cada parte vira uma camada independente.</small>
        <p v-if="hudImageError" class="hud-image-error" role="alert">{{ hudImageError }}</p>
        <p v-if="hudImageNotice" class="hud-image-notice" role="status">{{ hudImageNotice }}</p>

        <div v-if="hudSheetPreviewUrl" class="hud-sprite-editor">
          <div class="hud-sprite-editor-heading">
            <div>
              <strong>Editor de recortes</strong>
              <small>{{ hudSheetFile?.name }} · {{ hudSheetSize.width }} × {{ hudSheetSize.height }} px</small>
            </div>
            <button type="button" class="hud-image-remove" aria-label="Fechar editor de recortes" title="Fechar editor" @click="closeHudSheetEditor">×</button>
          </div>
          <p class="hud-sprite-instructions">Arraste diretamente sobre a imagem para marcar cada parte. As áreas transparentes originais do PNG e os vazios dentro de cada recorte são preservados.</p>
          <div class="hud-sprite-stage-scroll">
            <div class="hud-sprite-stage">
              <img
                ref="hudSheetPreview"
                class="hud-sprite-source"
                :src="hudSheetPreviewUrl"
                alt="Imagem de origem para recortar"
                draggable="false"
                @pointerdown="beginHudCropSelection"
              >
              <div
                v-for="(crop, index) in hudCropRects"
                :key="crop.id"
                class="hud-crop-box"
                :style="hudCropStyle(crop)"
                aria-hidden="true"
              ><span>{{ index + 1 }}</span></div>
              <div
                v-if="draftHudCrop"
                class="hud-crop-box hud-crop-box-draft"
                :style="hudCropStyle(draftHudCrop)"
                aria-hidden="true"
              />
            </div>
          </div>

          <div class="hud-grid-tools">
            <label>Linhas
              <input v-model.number="hudCropRows" type="number" min="1" max="32">
            </label>
            <label>Colunas
              <input v-model.number="hudCropColumns" type="number" min="1" max="32">
            </label>
            <button type="button" @click="generateHudGridCrops">Dividir em grade</button>
            <button type="button" @click="detectHudTransparentParts">Detectar partes pela transparência</button>
            <button type="button" :disabled="!hudCropRects.length" @click="clearHudCropRects">Limpar recortes</button>
          </div>
          <div v-if="hudCropRects.length" class="hud-crop-count">{{ hudCropRects.length }} recorte(s) selecionado(s)</div>
          <div v-if="hudCropRects.length" class="hud-crop-list">
            <div v-for="(crop, index) in hudCropRects" :key="crop.id" class="hud-crop-row">
              <span><strong>Parte {{ index + 1 }}</strong><small>{{ Math.round(crop.width) }} × {{ Math.round(crop.height) }} px · X {{ Math.round(crop.x) }}, Y {{ Math.round(crop.y) }}</small></span>
              <button type="button" class="hud-image-remove" :aria-label="'Remover recorte ' + (index + 1)" @click="removeHudCropRect(crop.id)">×</button>
            </div>
          </div>

          <div class="hud-transparency-options">
            <label><input v-model="trimHudTransparentBorders" type="checkbox"> Aparar margens transparentes ao redor de cada parte</label>
            <small>Remove apenas as bordas externas vazias de cada recorte. As áreas transparentes internas continuam transparentes.</small>
            <label><input v-model="skipHudTransparentCrops" type="checkbox"> Ignorar partes completamente transparentes</label>
            <label>Limiar alfa para detectar partes · {{ hudAlphaThreshold }}
              <input v-model.number="hudAlphaThreshold" type="range" min="0" max="255" step="1">
            </label>
            <label><input v-model="hudColorKeyEnabled" type="checkbox"> Tornar uma cor específica transparente</label>
            <div class="hud-color-key-controls" :class="{ disabled: !hudColorKeyEnabled }">
              <label>Cor
                <input v-model="hudColorKeyColor" type="color" :disabled="!hudColorKeyEnabled">
              </label>
              <label>Tolerância · {{ hudColorKeyTolerance }}
                <input v-model.number="hudColorKeyTolerance" type="range" min="0" max="96" step="1" :disabled="!hudColorKeyEnabled">
              </label>
            </div>
            <small>A tolerância define quanto cores parecidas com a escolhida também serão apagadas. Use com cuidado para não remover partes do desenho que tenham a mesma cor.</small>
          </div>
          <button class="hud-image-create-slices" type="button" :disabled="hudCropBusy || !hudCropRects.length" @click="cropHudSheetParts">
            {{ hudCropBusy ? 'Criando recortes…' : 'Criar ' + hudCropRects.length + ' parte(s) no HUD' }}
          </button>
        </div>
        <div v-if="settings.images.length" class="hud-image-list">
          <div v-for="layer in settings.images" :key="layer.id" class="hud-image-item">
            <img v-if="hudImageUrls[layer.id]" class="hud-image-preview" :src="hudImageUrls[layer.id]" alt="">
            <div v-else class="hud-image-preview hud-image-preview-missing">?</div>
            <div class="hud-image-item-meta">
              <strong :title="layer.name">{{ layer.name }}</strong>
              <label><input v-model="layer.visible" type="checkbox"> Mostrar</label>
            </div>
            <button type="button" class="hud-image-remove" :aria-label="'Remover imagem ' + layer.name" title="Remover imagem" @click="removeHudImage(layer.id)">×</button>
            <div class="hud-image-actions">
              <button type="button" :class="{ active: activeHudImageId === layer.id }" :disabled="layer.fitScreen" @click="toggleHudImagePosition(layer)">
                {{ activeHudImageId === layer.id ? 'Concluir posição' : 'Posicionar na tela' }}
              </button>
              <button type="button" :class="{ active: layer.fitScreen }" @click="toggleHudImageFit(layer)">
                {{ layer.fitScreen ? 'Encaixada na tela' : 'Ajustar à tela' }}
              </button>
            </div>
            <div class="hud-image-adjustments">
              <label v-if="!layer.fitScreen">Largura · {{ Math.round(layer.width) }}%
                <input v-model.number="layer.width" type="range" min="1" max="100" step="1" @input="clampHudImagePosition(layer)">
              </label>
              <label>Opacidade · {{ Math.round(layer.opacity) }}%
                <input v-model.number="layer.opacity" type="range" min="10" max="100" step="5" @input="clampHudImagePosition(layer)">
              </label>
              <label v-if="!layer.fitScreen">Horizontal · {{ Math.round(layer.x) }}%
                <input v-model.number="layer.x" type="range" min="0" :max="Math.max(0, 100 - layer.width)" step="1" @input="clampHudImagePosition(layer)">
              </label>
              <label v-if="!layer.fitScreen">Vertical · {{ Math.round(layer.y) }}%
                <input v-model.number="layer.y" type="range" min="0" max="100" step="1" @input="clampHudImagePosition(layer)">
              </label>
            </div>
          </div>
        </div>
        <small v-else>Nenhuma imagem adicionada ainda.</small>
        <small v-if="activeHudImageId && settings.images.some(layer => layer.id === activeHudImageId)" class="hud-image-position-note">Modo de posicionamento ativo: arraste a imagem diretamente na tela ou ajuste X/Y aqui. Clique em “Concluir posição” ao terminar.</small>
      </div>
      <div class="settings-footer">
        <button type="button" @click="resetSettings">Restaurar padrão</button>
        <button type="button" class="settings-done" @click="showSettings = false">Concluir</button>
      </div>
    </div>

    <div v-if="firstPerson && settings.showCrosshair" class="hud-crosshair" aria-hidden="true">
      <span /><i /><b /><em />
    </div>

    <div v-if="settings.showQuickSlots" class="hud-quick-slots" aria-label="Atalhos personalizados">
      <div v-for="(slot, index) in settings.quickSlots" :key="index" class="quick-slot">
        <kbd>{{ index + 1 }}</kbd><span>{{ slot || 'Atalho vazio' }}</span>
      </div>
    </div>

    <div class="hud-bottomline" :class="bottomClasses">
      <div v-if="settings.showControls" class="hud-controls" :class="{ collapsed: !showControls }">
        <button class="hud-controls-toggle" type="button" @click="showControls = !showControls" :aria-expanded="showControls">
          <span class="hud-control-mark">⌘</span>
          <span>CONTROLES <small>{{ controlMapName }}</small></span>
          <b>{{ showControls ? '−' : '+' }}</b>
        </button>
        <div v-if="showControls" class="hud-control-list">
          <div class="hud-control-row">
            <span class="hud-key-cluster"><kbd>{{ keyLabel(bindings.forward) }}</kbd><kbd>{{ keyLabel(bindings.left) }}</kbd><kbd>{{ keyLabel(bindings.backward) }}</kbd><kbd>{{ keyLabel(bindings.right) }}</kbd></span>
            <span>Movimentar</span>
          </div>
          <div class="hud-control-row"><kbd>{{ keyLabel(bindings.jump) }}</kbd><span>Pular</span></div>
          <div class="hud-control-row"><kbd>{{ keyLabel(bindings.run) }}</kbd><span>Correr</span></div>
          <div class="hud-control-row"><kbd>{{ keyLabel(bindings.interact) }}</kbd><span>Interagir / coletar / montar</span></div>
          <div class="hud-control-row"><kbd>{{ keyLabel(bindings.toggleFirstPerson) }}</kbd><span>Alternar 1ª pessoa</span></div>
        </div>
      </div>

      <div v-if="settings.showActions" class="hud-actions">
        <button class="hud-action-button" type="button" @click="emit('toggle-camera')" title="Alternar modo de câmera">
          <span aria-hidden="true">◉</span>
          <span><small>CÂMERA</small><strong>Alternar visão</strong></span>
          <kbd>{{ keyLabel(bindings.cycleCamera) }}</kbd>
        </button>
        <button class="hud-exit-button" type="button" @click="emit('exit-runtime')" title="Parar a execução e voltar ao editor">
          <span aria-hidden="true">Ⅱ</span>
          <span><small>SESSÃO</small><strong>Voltar ao editor</strong></span>
          <kbd>{{ keyLabel(bindings.exitRuntime) }}</kbd>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped src="./PlayerHUD.css"></style>
