<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps<{
  playerName: string
  cameraMode: string
  fps: number
  controlMapName: string
  firstPerson: boolean
  settingsOpen: boolean
  worldFullscreen: boolean
  bindings: Record<string, string>
}>()

const emit = defineEmits<{
  (event: 'toggle-camera'): void
  (event: 'exit-runtime'): void
  (event: 'settings-open-change', value: boolean): void
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
}

const STORAGE_KEY = 'engine-prometheus.player-hud.v1'
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
}
const settings = reactive<HudSettings>({ ...defaults, quickSlots: [...defaults.quickSlots], images: [] })
const showControls = ref(true)
const hudImageUrls = ref<Record<string, string>>({})
const hudImageInput = ref<HTMLInputElement | null>(null)
const hudImageError = ref('')
const activeHudImageId = ref<string | null>(null)
const hudImageDrag = ref<HudImageDrag | null>(null)
const visibleHudImages = computed(() => settings.images.filter(layer => layer.visible && hudImageUrls.value[layer.id]))
const showSettings = computed({
  get: () => props.settingsOpen,
  set: (value: boolean) => emit('settings-open-change', value),
})
const fpsLabel = computed(() => props.fps > 0 ? Math.round(props.fps) : '--')
const hudStyle = computed(() => ({ '--hud-scale': String(settings.scale) }))
const bottomClasses = computed(() => ({ 'dock-right': settings.dock === 'right' }))

function openHudImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('O armazenamento de imagens não está disponível neste ambiente.'))
      return
    }
    const request = indexedDB.open('engine-prometheus-hud-images', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento de imagens.'))
  })
}

async function storeHudImage(id: string, blob: Blob): Promise<void> {
  const db = await openHudImageDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite')
      transaction.objectStore('images').put(blob, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar a imagem.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('O salvamento da imagem foi cancelado.'))
    })
  } finally {
    db.close()
  }
}

async function readHudImage(id: string): Promise<Blob | null> {
  const db = await openHudImageDatabase()
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction('images', 'readonly').objectStore('images').get(id)
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
      request.onerror = () => reject(request.error ?? new Error('Não foi possível carregar a imagem.'))
    })
  } finally {
    db.close()
  }
}

async function deleteHudImage(id: string): Promise<void> {
  const db = await openHudImageDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite')
      transaction.objectStore('images').delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível remover a imagem.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('A remoção da imagem foi cancelada.'))
    })
  } finally {
    db.close()
  }
}

function boundedHudNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

onMounted(async () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<HudSettings>
      const images = Array.isArray(saved.images)
        ? saved.images
            .filter((layer): layer is HudImageLayer => Boolean(layer && typeof layer.id === 'string' && typeof layer.name === 'string'))
            .map((layer) => {
              const width = boundedHudNumber(layer.width, 24, 5, 80)
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
  finishHudImageDrag()
  Object.values(hudImageUrls.value).forEach(url => URL.revokeObjectURL(url))
})

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
  layer.width = boundedHudNumber(layer.width, 24, 5, 80)
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
  layer.x = boundedHudNumber(drag.originX + ((event.clientX - drag.startX) / drag.viewportWidth) * 100, drag.originX, 0, 100 - layer.width)
  layer.y = boundedHudNumber(drag.originY + ((event.clientY - drag.startY) / drag.viewportHeight) * 100, drag.originY, 0, 100)
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
  <section class="player-hud" :class="{ 'hud-world-fullscreen': worldFullscreen }" :style="hudStyle" aria-label="Interface do jogador">
    <div class="hud-topline" :class="{ 'topline-reverse': settings.dock === 'right' }">
      <div v-if="settings.showPlayer" class="hud-player-card">
        <div class="hud-avatar" aria-hidden="true"><span>P</span></div>
        <div class="hud-player-copy">
          <span class="hud-eyebrow">JOGADOR</span>
          <strong :title="playerName">{{ playerName || 'Player' }}</strong>
          <span class="hud-state"><i /> EM JOGO</span>
        </div>
      </div>

      <div v-if="settings.showSession" class="hud-session-card">
        <span class="hud-live-dot" />
        <span>RUN</span>
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
    >

    <div v-if="showSettings" class="hud-settings-panel" role="dialog" aria-label="Personalizar interface do jogador">
      <div class="settings-heading">
        <div><span class="hud-eyebrow">ENGINE PROMETHEUS</span><strong>Personalizar HUD</strong></div>
        <button type="button" class="settings-close" @click="showSettings = false" aria-label="Fechar">×</button>
      </div>
      <p class="settings-description">Escolha o que aparece durante o jogo. As preferências são salvas neste dispositivo.</p>
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
          <input v-for="(slot, index) in settings.quickSlots" :key="index" v-model="settings.quickSlots[index]" :aria-label="'Rótulo do atalho ' + (index + 1)" maxlength="22">
        </div>
        <small>Os espaços são personalizáveis; ainda não estão conectados a inventário ou habilidades do jogo.</small>
      </div>

      <div class="settings-field hud-images-field">
        <span>Imagens personalizadas do HUD</span>
        <input
          ref="hudImageInput"
          class="hud-image-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Selecionar imagem para o HUD"
          @change="importHudImage"
        >
        <button type="button" class="hud-image-import" @click="chooseHudImage">＋ Importar imagem PNG, JPG ou WebP</button>
        <small>Adicione molduras, ícones, barras decorativas ou uma imagem HUD transparente. As imagens são salvas neste dispositivo. Limite: 10 MB por imagem.</small>
        <p v-if="hudImageError" class="hud-image-error" role="alert">{{ hudImageError }}</p>
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
                <input v-model.number="layer.width" type="range" min="5" max="80" step="1" @input="clampHudImagePosition(layer)">
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
          <div class="hud-control-row"><kbd>{{ keyLabel(bindings.interact) }}</kbd><span>Interagir / montar</span></div>
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

<style scoped>
.player-hud {
  --hud-scale: 1;
  position:absolute; z-index:20; inset:0; display:flex; flex-direction:column; justify-content:space-between;
  padding:calc(clamp(12px, 2vw, 26px) * var(--hud-scale)); color:#f1f3f6; pointer-events:none;
  font-family:'IBM Plex Sans','Segoe UI',sans-serif; text-shadow:0 1px 2px #0008;
}
.hud-topline,.hud-bottomline { position:relative; z-index:24; display:flex; align-items:flex-start; justify-content:space-between; gap:calc(16px * var(--hud-scale)); }
.topline-reverse { flex-direction:row-reverse; }
.hud-player-card,.hud-session-card,.hud-controls,.hud-action-button,.hud-exit-button,.hud-settings-panel,.hud-quick-slots {
  border:1px solid #ffffff20; background:linear-gradient(135deg,#111820ef,#11151be8); box-shadow:0 8px 26px #0003; backdrop-filter:blur(12px);
}
.hud-player-card { display:flex; align-items:center; gap:calc(11px * var(--hud-scale)); min-width:0; max-width:min(360px,58vw); padding:calc(10px * var(--hud-scale)) calc(14px * var(--hud-scale)); border-radius:8px; }
.hud-avatar { display:grid; place-items:center; width:calc(38px * var(--hud-scale)); height:calc(38px * var(--hud-scale)); flex:none; border:1px solid #f5a52477; border-radius:7px; background:#f5a52418; color:#ffc45c; font-size:calc(17px * var(--hud-scale)); font-weight:700; }
.hud-player-copy { display:flex; flex-direction:column; min-width:0; gap:2px; }
.hud-eyebrow,.hud-player-copy strong,.hud-state,.hud-session-card,.hud-controls-toggle,.hud-control-row,.hud-action-button small,.hud-exit-button small { letter-spacing:.045em; }
.hud-eyebrow { color:#aab3c0; font-size:9px; font-weight:700; }
.hud-player-copy strong { overflow:hidden; max-width:100%; color:#f4f5f7; font-size:calc(13px * var(--hud-scale)); font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
.hud-state { display:flex; align-items:center; gap:5px; color:#b4c0cb; font-size:9px; }
.hud-state i,.hud-live-dot { width:6px; height:6px; flex:none; border-radius:50%; background:#72d69a; box-shadow:0 0 0 3px #72d69a1b; }
.hud-session-card { display:flex; align-items:center; gap:9px; min-height:39px; padding:0 12px; border-radius:7px; color:#dce2e9; font-size:10px; font-weight:700; }
.hud-session-divider { width:1px; height:15px; background:#ffffff24; }
.hud-camera { color:#aab5c3; font-weight:500; }
.hud-fps { color:#e5f7cf; font-family:'IBM Plex Mono',monospace; }
.hud-fps small { color:#9ba8b5; font-family:inherit; font-size:9px; }
.settings-close:hover { border-color:#f5a52488; background:#f5a52418; }
.hud-settings-panel { position:absolute; z-index:30; top:calc(104px * var(--hud-scale)); left:clamp(10px,2vw,26px); right:auto; width:min(350px,calc(100vw - 24px)); max-height:min(480px,calc(100dvh - 128px)); overflow:auto; overscroll-behavior:contain; padding:15px; border-radius:9px; pointer-events:auto; text-shadow:none; }
.settings-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.settings-heading>div { display:flex; flex-direction:column; gap:4px; }
.settings-heading strong { color:#f2f4f7; font-size:15px; }
.settings-close { width:28px; height:28px; border:1px solid #ffffff20; border-radius:5px; background:transparent; color:#dce2e9; font-size:21px; cursor:pointer; }
.settings-description { margin:9px 0 14px; color:#aab5c3; font-size:11px; line-height:1.5; }
.settings-toggles { display:grid; grid-template-columns:1fr 1fr; gap:10px 8px; }
.settings-toggles label { display:flex; align-items:center; gap:7px; color:#d3d9e1; font-size:11px; cursor:pointer; }
.settings-toggles input { accent-color:#f5b64c; }
.settings-field { display:grid; gap:8px; margin-top:15px; color:#d3d9e1; font-size:11px; }
.settings-field>label { display:flex; justify-content:space-between; gap:10px; }
.settings-field strong { color:#f5b64c; }
.settings-field input[type=range] { width:100%; accent-color:#f5b64c; }
.dock-options { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.dock-options button,.settings-footer button { border:1px solid #ffffff20; border-radius:5px; padding:8px; background:#ffffff08; color:#cbd3dc; font-size:10px; cursor:pointer; }
.dock-options button.active { border-color:#f5b64c88; background:#f5b64c18; color:#ffd17b; }
.slot-editor { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.slot-editor input { min-width:0; width:100%; border:1px solid #ffffff20; border-radius:4px; padding:7px; background:#0b1016; color:#e6eaf0; font-size:10px; }
.settings-field>small { color:#8996a6; line-height:1.4; }
.settings-footer { display:flex; justify-content:space-between; gap:8px; margin-top:16px; }
.settings-footer .settings-done { border-color:#f5b64c66; background:#f5b64c18; color:#ffd17b; }
.hud-crosshair { position:absolute; z-index:24; top:50%; left:50%; width:18px; height:18px; transform:translate(-50%,-50%); opacity:.9; }
.hud-crosshair span,.hud-crosshair i,.hud-crosshair b,.hud-crosshair em { position:absolute; display:block; width:4px; height:4px; border:1px solid #fff; border-radius:1px; }
.hud-crosshair span { top:0; left:7px; } .hud-crosshair i { bottom:0; left:7px; } .hud-crosshair b { top:7px; left:0; } .hud-crosshair em { top:7px; right:0; }
.hud-bottomline { align-items:flex-end; }
.hud-bottomline.dock-right { flex-direction:row-reverse; }
.hud-controls { width:min(280px,45vw); overflow:hidden; border-radius:8px; pointer-events:auto; }
.hud-controls-toggle { display:flex; align-items:center; width:100%; gap:9px; min-height:43px; padding:8px 11px; border:0; border-bottom:1px solid #ffffff12; border-radius:0; background:transparent; color:#e5e9ef; text-align:left; cursor:pointer; }
.hud-control-mark { display:grid; place-items:center; width:25px; height:25px; border:1px solid #ffffff20; border-radius:5px; color:#f5b64c; }
.hud-controls-toggle>span:nth-child(2) { display:flex; flex:1; flex-direction:column; gap:2px; font-size:10px; font-weight:700; }
.hud-controls-toggle small { overflow:hidden; color:#98a4b3; font-size:9px; font-weight:400; text-overflow:ellipsis; white-space:nowrap; }
.hud-controls-toggle>b { color:#aeb9c6; font-size:16px; font-weight:400; }
.hud-control-list { display:grid; gap:7px; padding:10px 11px 11px; }
.hud-control-row { display:flex; align-items:center; justify-content:space-between; gap:12px; color:#c0c9d4; font-size:10px; }
.hud-control-row kbd,.hud-action-button kbd,.hud-exit-button kbd,.quick-slot kbd { min-width:25px; padding:3px 5px; border:1px solid #ffffff24; border-bottom-color:#ffffff3b; border-radius:4px; background:#ffffff08; color:#f2f4f7; font:9px 'IBM Plex Mono',monospace; text-align:center; white-space:nowrap; }
.hud-key-cluster { display:flex; flex-wrap:wrap; gap:3px; }
.hud-key-cluster kbd { min-width:22px; }
.hud-actions { display:flex; flex-direction:column; gap:8px; width:min(235px,42vw); pointer-events:auto; }
.hud-action-button,.hud-exit-button { display:flex; align-items:center; gap:10px; min-height:53px; padding:8px 10px; border-radius:7px; color:#e6e8ec; text-align:left; cursor:pointer; }
.hud-action-button:hover { border-color:#f5a52488; background:#201d16ef; }
.hud-exit-button { border-color:#b96c554d; }
.hud-exit-button:hover { border-color:#df8a70; background:#241916f2; }
.hud-action-button>span:first-child,.hud-exit-button>span:first-child { display:grid; place-items:center; width:28px; height:28px; flex:none; border:1px solid #ffffff1d; border-radius:6px; color:#f5b64c; font-size:17px; }
.hud-exit-button>span:first-child { color:#e7a08a; }
.hud-action-button>span:nth-child(2),.hud-exit-button>span:nth-child(2) { display:flex; flex:1; flex-direction:column; gap:3px; min-width:0; }
.hud-action-button small,.hud-exit-button small { color:#9ba7b6; font-size:8px; font-weight:700; }
.hud-action-button strong,.hud-exit-button strong { font-size:10px; font-weight:600; white-space:nowrap; }
.hud-quick-slots { position:absolute; z-index:24; bottom:calc(20px * var(--hud-scale)); left:50%; display:flex; gap:7px; transform:translateX(-50%); padding:7px; border-radius:8px; pointer-events:none; }
.quick-slot { display:flex; align-items:center; gap:7px; min-width:94px; max-width:140px; padding:7px; border:1px solid #ffffff17; border-radius:5px; color:#dce2e9; font-size:10px; }
.quick-slot span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@media(max-width:620px) {
  .player-hud { padding:9px; }
  .hud-topline,.hud-bottomline { gap:7px; }
  .hud-player-card { gap:7px; padding:7px; }
  .hud-avatar { width:30px; height:30px; }
  .hud-player-copy strong { max-width:130px; font-size:11px; }
  .hud-session-card { gap:6px; padding:0 7px; font-size:9px; }
  .hud-controls { width:min(245px,58vw); }
  .hud-actions { width:min(205px,44vw); }
  .hud-action-button,.hud-exit-button { gap:6px; padding:7px; }
  .hud-action-button strong,.hud-exit-button strong { font-size:9px; }
  .hud-settings-panel { top:76px; left:9px; right:auto; width:min(350px,calc(100vw - 18px)); max-height:calc(100dvh - 110px); padding:11px; }
  .hud-quick-slots { max-width:calc(100% - 18px); gap:4px; padding:4px; }
  .quick-slot { min-width:0; gap:4px; padding:5px; font-size:9px; }
}
@media(max-height:520px) {
  .player-hud { padding:8px 12px; }
  .hud-controls-toggle { min-height:34px; }
  .hud-control-list { gap:4px; padding:6px 9px; }
  .hud-control-row { font-size:9px; }
  .hud-action-button,.hud-exit-button { min-height:42px; }
  .hud-settings-panel { top:72px; max-height:calc(100dvh - 150px); }
}

/* In fullscreen, keep the runtime/session card and its HUD-edit button out of
   the upper-right viewport toolbar's hit area. Stack it below the player card. */
.player-hud.hud-world-fullscreen .hud-topline {
  flex-direction: column;
  align-items: flex-start;
  gap: calc(10px * var(--hud-scale));
}
.player-hud.hud-world-fullscreen .hud-settings-panel {
  top: calc(158px * var(--hud-scale));
  left: clamp(10px, 2vw, 26px);
  right: auto;
  max-height: calc(100dvh - 182px);
}
@media(max-width:620px) {
  .player-hud.hud-world-fullscreen .hud-settings-panel {
    top: 108px;
    left: 9px;
    width: min(350px, calc(100vw - 18px));
    max-height: calc(100dvh - 130px);
  }
}
@media(max-height:520px) {
  .player-hud.hud-world-fullscreen .hud-topline { gap: 5px; }
  .player-hud.hud-world-fullscreen .hud-settings-panel {
    top: 112px;
    max-height: calc(100dvh - 132px);
  }
}


.hud-custom-image {
  position:absolute;
  z-index:22;
  display:block;
  height:auto;
  max-width:none;
  transform:none;
  pointer-events:none;
  user-select:none;
  -webkit-user-drag:none;
  touch-action:none;
}
.hud-custom-image.is-positioning {
  outline:1px dashed #e8572b;
  outline-offset:2px;
  cursor:move;
}
.hud-image-file-input { display:none; }
.hud-image-import,.hud-image-remove,.hud-image-actions button {
  border:1px solid #ffffff20;
  border-radius:5px;
  padding:7px 9px;
  background:#ffffff08;
  color:#e7ebf0;
  font-size:10px;
  cursor:pointer;
}
.hud-image-import { width:100%; border-color:#f5b64c55; color:#ffd17b; text-align:left; }
.hud-image-import:hover,.hud-image-actions button:hover { border-color:#f5b64c88; background:#f5b64c14; }
.hud-image-list { display:grid; gap:8px; margin-top:9px; }
.hud-image-item { display:grid; grid-template-columns:54px minmax(0,1fr) 28px; gap:8px; align-items:start; padding:9px; border:1px solid #ffffff14; border-radius:6px; background:#00000016; }
.hud-image-preview { display:block; width:54px; height:44px; object-fit:contain; border:1px solid #ffffff16; border-radius:4px; background:#0b1016; }
.hud-image-preview-missing { display:grid; place-items:center; color:#e7a08a; font-size:18px; }
.hud-image-item-meta { display:grid; min-width:0; gap:6px; }
.hud-image-item-meta>strong { overflow:hidden; color:#e5e9ef; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }
.hud-image-item-meta label { display:flex; align-items:center; gap:5px; color:#b8c2cf; font-size:10px; }
.hud-image-item-meta input { accent-color:#f5b64c; }
.hud-image-remove { width:28px; height:28px; padding:0; color:#e7a08a; font-size:18px; }
.hud-image-actions { grid-column:1 / -1; display:flex; gap:6px; }
.hud-image-actions button.active { border-color:#f5b64c88; background:#f5b64c18; color:#ffd17b; }
.hud-image-adjustments { grid-column:1 / -1; display:grid; grid-template-columns:1fr 1fr; gap:10px 8px; }
.hud-image-adjustments label { display:grid; gap:5px; min-width:0; color:#aeb9c6; font-size:9px; }
.hud-image-adjustments input[type=range] { width:100%; min-width:0; accent-color:#e8572b; }
.hud-image-error { margin:0; color:#ffaaa2; font-size:10px; line-height:1.4; }
.hud-image-position-note { padding:7px; border:1px solid #e8572b44; border-radius:5px; background:#e8572b12; color:#ffd17b !important; }

</style>
