<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export type TextureFace = 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back'
export interface FaceTextureData {
  imageDataUrl: string
  pixelWidth: number
  pixelHeight: number
}
type FaceMap = Partial<Record<TextureFace, FaceTextureData>>
const props = defineProps<{ modelValue: FaceMap }>()
const emit = defineEmits<{ (event: 'update-face-texture', face: TextureFace, value: FaceTextureData | null): void }>()
const faces: Array<{ id: TextureFace; label: string; x: number; y: number }> = [
  { id: 'back', label: 'TRÁS', x: 1, y: 0 },
  { id: 'top', label: 'TOPO', x: 1, y: 1 },
  { id: 'front', label: 'FRENTE', x: 1, y: 2 },
  { id: 'bottom', label: 'BASE', x: 1, y: 3 },
  { id: 'left', label: 'ESQ.', x: 0, y: 2 },
  { id: 'right', label: 'DIR.', x: 2, y: 2 },
]
const activeFace = ref<TextureFace>('front')
const selected = computed(() => props.modelValue[activeFace.value] ?? null)
const fileInput = ref<HTMLInputElement | null>(null)
const imagePreview = ref('')
const pixelWidth = ref(128)
const pixelHeight = ref(128)
const faceLabel = computed(() => faces.find(face => face.id === activeFace.value)?.label ?? activeFace.value)
watch(selected, value => {
  imagePreview.value = value?.imageDataUrl ?? ''
  pixelWidth.value = value?.pixelWidth ?? 128
  pixelHeight.value = value?.pixelHeight ?? 128
}, { immediate: true })
function chooseImage() { fileInput.value?.click() }
function loadImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) return
  if (file.size > 8 * 1024 * 1024) {
    window.alert('Escolha uma imagem de até 8 MB.')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result !== 'string') return
    const dataUrl = reader.result
    const image = new Image()
    image.onload = () => {
      imagePreview.value = dataUrl
      // A resolução inicial segue as dimensões reais do arquivo, sem forçar 128×128.
      pixelWidth.value = Math.max(8, Math.min(10000, image.naturalWidth || 128))
      pixelHeight.value = Math.max(8, Math.min(10000, image.naturalHeight || 128))
      applyImage()
    }
    image.onerror = () => {
      imagePreview.value = dataUrl
      pixelWidth.value = 128
      pixelHeight.value = 128
      applyImage()
    }
    image.src = dataUrl
  }
  reader.readAsDataURL(file)
  ;(event.target as HTMLInputElement).value = ''
}
function applyImage() {
  if (!imagePreview.value) return
  emit('update-face-texture', activeFace.value, {
    imageDataUrl: imagePreview.value,
    pixelWidth: Math.max(8, Math.min(10000, Math.round(pixelWidth.value))),
    pixelHeight: Math.max(8, Math.min(10000, Math.round(pixelHeight.value))),
  })
}
function removeImage() {
  imagePreview.value = ''
  emit('update-face-texture', activeFace.value, null)
}
</script>

<template>
  <div class="face-texture-editor">
    <div class="face-editor-title">
      <div><strong>Textura por face</strong><small>Selecione um lado do bloco desmontado</small></div>
      <span>6 FACES</span>
    </div>
    <div class="unfolded-net" aria-label="Prévia desmontada das seis faces do cubo">
      <button
        v-for="face in faces"
        :key="face.id"
        class="net-face"
        :class="['face-' + face.id, { active: activeFace === face.id, textured: !!modelValue[face.id] }]"
        :style="{ gridColumn: face.x + 1, gridRow: face.y + 1 }"
        :title="'Editar face ' + face.label"
        @click="activeFace = face.id"
      >
        <img v-if="modelValue[face.id]?.imageDataUrl" :src="modelValue[face.id]?.imageDataUrl" alt="" />
        <span v-else class="face-placeholder">＋</span>
        <small>{{ face.label }}</small>
        <i v-if="activeFace === face.id" class="face-selected-mark">✓</i>
      </button>
    </div>
    <div class="active-face-heading"><span>FACE SELECIONADA</span><strong>{{ faceLabel }}</strong></div>
    <input ref="fileInput" class="hidden-file" type="file" accept="image/*" @change="loadImage" />
    <div v-if="imagePreview" class="face-image-preview">
      <img :src="imagePreview" alt="Prévia da imagem de textura" />
      <div><strong>Imagem carregada</strong><small>Será aplicada somente nesta face.</small></div>
    </div>
    <button class="face-import-button" @click="chooseImage">▧ {{ imagePreview ? 'Trocar imagem' : 'Importar imagem' }}</button>
    <div class="pixel-size-grid">
      <label>Pixels X <input v-model.number="pixelWidth" type="number" min="8" max="10000" step="8" @change="applyImage" /></label>
      <label>Pixels Y <input v-model.number="pixelHeight" type="number" min="8" max="10000" step="8" @change="applyImage" /></label>
    </div>
    <p class="face-texture-help">Por padrão, usa a resolução original da imagem. Você pode ajustar manualmente entre 8 e 10000 px.</p>
    <button v-if="selected" class="face-remove-button" @click="removeImage">Remover textura desta face</button>
  </div>
</template>

<style scoped>
.face-texture-editor{display:flex;flex-direction:column;gap:10px;margin:14px 0;padding:12px;background:#171a21;border:1px solid #303541;border-radius:7px;color:#e5e7eb}
.face-editor-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.face-editor-title strong,.face-editor-title small{display:block}.face-editor-title strong{font-size:12px}.face-editor-title small{font-size:10px;color:#929aaa;margin-top:3px}.face-editor-title>span{font-size:9px;color:#9ca3af;letter-spacing:1px}
.unfolded-net{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(4,58px);gap:4px;padding:8px;background:#101217;border:1px solid #292e38;border-radius:5px}
.net-face{position:relative;min-width:0;overflow:hidden;border:1px solid #454b59;border-radius:3px;background:#272d38;color:#d6dae2;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center}.net-face img{position:absolute;width:100%;height:100%;object-fit:fill;inset:0}.net-face small{position:absolute;left:3px;right:3px;bottom:3px;padding:2px 0;background:#111827c9;font-size:8px;letter-spacing:.4px;z-index:1}.net-face .face-placeholder{font-size:19px;color:#6b7280}.net-face.active{border:2px solid #8caeff;box-shadow:inset 0 0 0 1px #8caeff}.net-face.textured{background:#3b4555}.face-selected-mark{position:absolute;right:3px;top:2px;z-index:2;font-size:10px;font-style:normal;color:#fff;background:#466fca;border-radius:50%;width:14px;height:14px;line-height:14px}
.active-face-heading{display:flex;align-items:center;justify-content:space-between}.active-face-heading span{font-size:9px;color:#929aaa;letter-spacing:.8px}.active-face-heading strong{font-size:11px;color:#b8ccff}.hidden-file{display:none}.face-image-preview{display:flex;align-items:center;gap:9px;min-width:0}.face-image-preview img{width:42px;height:42px;object-fit:cover;border:1px solid #424958;border-radius:4px}.face-image-preview strong,.face-image-preview small{display:block}.face-image-preview strong{font-size:11px}.face-image-preview small{font-size:10px;color:#9ca3af;margin-top:3px}
.face-import-button,.face-remove-button{width:100%;padding:8px;border-radius:4px;border:1px solid #4b5567;background:#293345;color:#e5e7eb;cursor:pointer;font-size:11px}.face-import-button:hover{background:#35435a}.pixel-size-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pixel-size-grid label{font-size:10px;color:#aeb5c3;display:flex;flex-direction:column;gap:4px}.pixel-size-grid input{width:100%;box-sizing:border-box;background:#101319;color:#e5e7eb;border:1px solid #3b4250;border-radius:3px;padding:6px;font:11px monospace}.face-texture-help{font-size:10px;line-height:1.45;color:#929aaa;margin:0}.face-remove-button{background:transparent;color:#f0a3a3;border-color:#70454a}
</style>
