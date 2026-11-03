<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from './UiIcon.vue'
import type {
  FaceTextureData,
  ObjectInfo,
  PlayerSettings,
  SceneFolderData,
  TextureFace,
} from '@engine'

type Tab = 'scene' | 'player' | 'sky' | 'render'
type ObjField = 'x' | 'y' | 'z' | 'rotationX' | 'rotationY' | 'rotationZ' | 'scaleX' | 'scaleY' | 'scaleZ' | 'mass'
type PlayerField = keyof PlayerSettings
type RenderStats = {
  fps: number
  continuousRendering: boolean
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  cpuRenderMs: number
  cpuUpdateMs: number
}

const props = defineProps<{
  activeTab: Tab
  projectName: string
  selectedObject: ObjectInfo | null
  folders: SceneFolderData[]
  terrain: { visible: boolean; seed: number; edits: number }
  brushStrength: number
  brushRadius: number
  gridVisible: boolean
  polygonLinesVisible: boolean
  colliderDebugVisible: boolean
  playerModelName: string
  playerModelCustom: boolean
  playerModelHeight: number
  playerSettings: PlayerSettings
  timeOfDay: number
  dayNightCycleEnabled: boolean
  dayNightCycleSpeed: number
  renderFogEnabled: boolean
  renderFogDistanceScale: number
  performanceMode: 'quality' | 'balanced' | 'economy' | 'auto'
  renderFpsLimit: number
  renderDistance: number
  renderAll: boolean
  renderResolutionScale: number
  renderDynamicResolution: boolean
  renderDynamicResolutionTargetFps: number
  renderDynamicResolutionMinScale: number
  grassVisible: boolean
  grassUseDetailedModel: boolean
  grassDensityPercent: number
  grassRenderDistanceMode: 'global' | 'all' | 'custom'
  grassRenderDistance: number
  grassNearDetailDistance: number
  grassMiddleDetailDistance: number
  grassOcclusionEnabled: boolean
  grassOcclusionIntervalMs: number
  wallOcclusionQuality: 'fast' | 'precise'
  grassWindPercent: number
  renderStats: RenderStats
  hasSkyTexture: boolean
}>()

const emit = defineEmits<{
  (event: 'update:activeTab', tab: Tab): void
  (event: 'rename-object', value: string): void
  (event: 'object-number', field: ObjField, value: number): void
  (event: 'remove-object'): void
  (event: 'toggle-object-visibility'): void
  (event: 'toggle-object-lock', id: string): void
  (event: 'toggle-object-wireframe', id: string): void
  (event: 'object-folder', id: string, folderId: string | null): void
  (event: 'object-color', eventValue: Event): void
  (event: 'object-texture', eventValue: Event): void
  (event: 'texture-repeat', eventValue: Event): void
  (event: 'face-texture', face: TextureFace, value: FaceTextureData | null): void
  (event: 'collider-type', id: string, eventValue: Event): void
  (event: 'collider-vector', id: string, field: 'colliderSize' | 'colliderOffset', axis: 0 | 1 | 2, eventValue: Event): void
  (event: 'toggle-collider-debug'): void
  (event: 'toggle-terrain'): void
  (event: 'regenerate-terrain'): void
  (event: 'clear-terrain'): void
  (event: 'brush-strength', value: number): void
  (event: 'brush-radius', value: number): void
  (event: 'toggle-grid'): void
  (event: 'toggle-polygon-lines'): void
  (event: 'player-setting', field: PlayerField, value: number): void
  (event: 'player-model-file', file: File): void
  (event: 'player-model-height', value: number): void
  (event: 'reset-player-model'): void
  (event: 'time-of-day', value: number): void
  (event: 'toggle-cycle'): void
  (event: 'cycle-speed', value: number): void
  (event: 'fog', enabled: boolean): void
  (event: 'fog-distance', value: number): void
  (event: 'sky-file', file: File): void
  (event: 'clear-sky'): void
  (event: 'performance', value: 'quality' | 'balanced' | 'economy' | 'auto'): void
  (event: 'fps-limit', value: number): void
  (event: 'render-distance', value: number): void
  (event: 'render-all', enabled: boolean): void
  (event: 'render-resolution', value: number): void
  (event: 'dynamic-resolution', enabled: boolean): void
  (event: 'dynamic-target-fps', value: number): void
  (event: 'dynamic-min-scale', value: number): void
  (event: 'grass-visible', enabled: boolean): void
  (event: 'grass-detailed', enabled: boolean): void
  (event: 'grass-density', value: number): void
  (event: 'grass-distance', value: string): void
  (event: 'grass-detail-distance', band: 'near' | 'middle', value: number): void
  (event: 'grass-occlusion', enabled: boolean): void
  (event: 'grass-occlusion-interval', value: number): void
  (event: 'wall-occlusion-quality', value: 'fast' | 'precise'): void
  (event: 'grass-wind', value: number): void
}>()

const faces: Array<{ key: TextureFace; label: string }> = [
  { key: 'top', label: 'Superior' },
  { key: 'bottom', label: 'Inferior' },
  { key: 'front', label: 'Frente' },
  { key: 'back', label: 'Trás' },
  { key: 'left', label: 'Esquerda' },
  { key: 'right', label: 'Direita' },
]

type FolderOption = { id: string; label: string; depth: number }
const folderOptions = computed<FolderOption[]>(() => {
  const result: FolderOption[] = []
  const append = (parentId: string | null, depth: number) => {
    const children = props.folders
      .filter(folder => folder.parentId === parentId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    for (const folder of children) {
      result.push({ id: folder.id, label: folder.name, depth })
      append(folder.id, depth + 1)
    }
  }
  append(null, 0)
  return result
})

function setObjectNumber(field: ObjField, eventValue: Event) {
  emit('object-number', field, Number((eventValue.target as HTMLInputElement).value))
}

function setPlayerNumber(field: PlayerField, eventValue: Event) {
  emit('player-setting', field, Number((eventValue.target as HTMLInputElement).value))
}

function onSkyFile(eventValue: Event) {
  const input = eventValue.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('sky-file', file)
}

function onPlayerModelFile(eventValue: Event) {
  const input = eventValue.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('player-model-file', file)
}

function onFaceTextureFile(face: TextureFace, eventValue: Event) {
  const input = eventValue.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !file.type.startsWith('image/')) return

  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result !== 'string') return
    const image = new Image()
    image.onload = () => emit('face-texture', face, {
      imageDataUrl: reader.result as string,
      pixelWidth: image.naturalWidth,
      pixelHeight: image.naturalHeight,
    })
    image.onerror = () => console.warn('[Inspector] Não foi possível ler as dimensões desta textura.')
    image.src = reader.result
  }
  reader.onerror = () => console.warn('[Inspector] Não foi possível ler este arquivo de textura.')
  reader.readAsDataURL(file)
}

function textureForFace(face: TextureFace) {
  return props.selectedObject?.faceTextures?.[face] ?? null
}

function formatTime(value: number) {
  const safe = Math.max(0, Math.min(24, value))
  const hour = Math.floor(safe) % 24
  const minute = Math.round((safe % 1) * 60) % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatNumber(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '0'
}
</script>

<template>
  <aside class="inspector-panel" data-testid="editor-inspector">
    <div class="inspector-tabs" role="tablist" aria-label="Inspetor">
      <button type="button" role="tab" :aria-selected="activeTab === 'scene'" :class="{ active: activeTab === 'scene' }" @click="emit('update:activeTab', 'scene')">Cena</button>
      <button type="button" role="tab" :aria-selected="activeTab === 'player'" :class="{ active: activeTab === 'player' }" @click="emit('update:activeTab', 'player')">Jogador</button>
      <button type="button" role="tab" :aria-selected="activeTab === 'sky'" :class="{ active: activeTab === 'sky' }" @click="emit('update:activeTab', 'sky')">Ambiente</button>
      <button type="button" role="tab" :aria-selected="activeTab === 'render'" :class="{ active: activeTab === 'render' }" @click="emit('update:activeTab', 'render')">Render</button>
    </div>

    <div v-if="activeTab === 'scene'" class="inspector-scroll">
      <div class="inspector-summary">
        <div class="summary-icon"><UiIcon :name="selectedObject ? (selectedObject.importedModel ? 'box' : 'square') : 'house'" :size="23" /></div>
        <div class="summary-copy">
          <strong>{{ selectedObject?.name ?? projectName ?? 'Mundo principal' }}</strong>
          <small>{{ selectedObject ? (selectedObject.importedModel ? 'Modelo 3D selecionado' : 'Objeto selecionado') : 'Configurações da cena' }}</small>
        </div>
        <button v-if="selectedObject" type="button" class="summary-delete" aria-label="Excluir objeto selecionado" title="Excluir objeto" @click="emit('remove-object')">
          <UiIcon name="trash" :size="15" />
        </button>
      </div>

      <template v-if="selectedObject">
        <details class="inspector-group" open>
          <summary class="inspector-group-heading"><UiIcon name="square" :size="14" /> Objeto</summary>
          <label class="inspector-field full-field">
            <span>Nome</span>
            <input :value="selectedObject.name" maxlength="80" data-testid="inspector-object-name" @change="emit('rename-object', ($event.target as HTMLInputElement).value)" />
          </label>
          <div class="inspector-toggle-row">
            <span>Visível na cena</span>
            <button type="button" class="switch" :class="{ on: selectedObject.visible }" role="switch" :aria-checked="selectedObject.visible" aria-label="Visibilidade do objeto" @click="emit('toggle-object-visibility')"><i /></button>
          </div>
          <div class="inspector-toggle-row">
            <span>Bloquear transformação</span>
            <button type="button" class="switch" :class="{ on: selectedObject.locked }" role="switch" :aria-checked="selectedObject.locked" aria-label="Bloquear transformação" @click="emit('toggle-object-lock', selectedObject.id)"><i /></button>
          </div>
          <div class="inspector-toggle-row">
            <span>Wireframe do objeto</span>
            <button type="button" class="switch" :class="{ on: selectedObject.wireframeVisible }" role="switch" :aria-checked="selectedObject.wireframeVisible" aria-label="Wireframe do objeto" @click="emit('toggle-object-wireframe', selectedObject.id)"><i /></button>
          </div>
          <label class="inspector-property">
            <span>Pasta da hierarquia</span>
            <select :value="selectedObject.folderId ?? ''" data-testid="inspector-object-folder" @change="emit('object-folder', selectedObject.id, ($event.target as HTMLSelectElement).value || null)">
              <option value="">Raiz da cena</option>
              <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">{{ '　'.repeat(folder.depth) }}{{ folder.label }}</option>
            </select>
          </label>
        </details>

        <details class="inspector-group" open>
          <summary class="inspector-group-heading"><UiIcon name="move" :size="14" /> Transformação</summary>
          <div class="inspector-vector-block">
            <span class="inspector-vector-title">Posição</span>
            <div class="inspector-axis-grid">
              <label><b class="axis-x">X</b><input type="number" step=".1" :value="selectedObject.x" @change="setObjectNumber('x', $event)" /></label>
              <label><b class="axis-y">Y</b><input type="number" step=".1" :value="selectedObject.y" @change="setObjectNumber('y', $event)" /></label>
              <label><b class="axis-z">Z</b><input type="number" step=".1" :value="selectedObject.z" @change="setObjectNumber('z', $event)" /></label>
            </div>
          </div>
          <div class="inspector-vector-block">
            <span class="inspector-vector-title">Rotação (graus)</span>
            <div class="inspector-axis-grid">
              <label><b class="axis-x">X</b><input type="number" step="1" :value="selectedObject.rotationX" @change="setObjectNumber('rotationX', $event)" /></label>
              <label><b class="axis-y">Y</b><input type="number" step="1" :value="selectedObject.rotationY" @change="setObjectNumber('rotationY', $event)" /></label>
              <label><b class="axis-z">Z</b><input type="number" step="1" :value="selectedObject.rotationZ" @change="setObjectNumber('rotationZ', $event)" /></label>
            </div>
          </div>
          <div class="inspector-vector-block">
            <span class="inspector-vector-title">Escala</span>
            <div class="inspector-axis-grid">
              <label><b class="axis-x">X</b><input type="number" min=".01" step=".1" :value="selectedObject.scaleX" @change="setObjectNumber('scaleX', $event)" /></label>
              <label><b class="axis-y">Y</b><input type="number" min=".01" step=".1" :value="selectedObject.scaleY" @change="setObjectNumber('scaleY', $event)" /></label>
              <label><b class="axis-z">Z</b><input type="number" min=".01" step=".1" :value="selectedObject.scaleZ" @change="setObjectNumber('scaleZ', $event)" /></label>
            </div>
          </div>
        </details>

        <details class="inspector-group" open>
          <summary class="inspector-group-heading"><UiIcon name="diamond" :size="14" /> Aparência e material</summary>
          <label class="inspector-property inspector-color-property">
            <span>Cor base</span>
            <input type="color" :value="`#${selectedObject.color.toString(16).padStart(6, '0').slice(-6)}`" aria-label="Cor base do objeto" data-testid="inspector-object-color" @change="emit('object-color', $event)" />
          </label>
          <label class="inspector-property">
            <span>Material</span>
            <select :value="selectedObject.texturePreset" data-testid="inspector-texture-preset" @change="emit('object-texture', $event)">
              <option value="none">Cor sólida</option>
              <option value="grass">Grama</option>
              <option value="stone">Pedra</option>
              <option value="brick">Tijolo</option>
              <option value="wood">Madeira</option>
              <option value="sand">Areia</option>
              <option value="metal">Metal</option>
            </select>
          </label>
          <label class="range-row">
            <span>Repetição da textura</span>
            <div class="range-value-control">
              <input type="range" min="1" max="8" step="1" :value="selectedObject.textureRepeat" @change="emit('texture-repeat', $event)" />
              <output>{{ selectedObject.textureRepeat }}×</output>
            </div>
          </label>

          <details v-if="!selectedObject.importedModel" class="inspector-subgroup">
            <summary>Texturas por face</summary>
            <div v-for="face in faces" :key="face.key" class="face-texture-row">
              <span>{{ face.label }}</span>
              <small v-if="textureForFace(face.key)">{{ textureForFace(face.key)?.pixelWidth }}×{{ textureForFace(face.key)?.pixelHeight }}</small>
              <label class="face-texture-upload" :aria-label="'Selecionar textura para face ' + face.label">
                <UiIcon name="image" :size="13" />
                <input type="file" accept="image/*" @change="onFaceTextureFile(face.key, $event)" />
              </label>
              <button v-if="textureForFace(face.key)" type="button" class="face-texture-clear" :aria-label="'Remover textura da face ' + face.label" @click="emit('face-texture', face.key, null)">
                <UiIcon name="x" :size="13" />
              </button>
            </div>
          </details>
          <p v-if="selectedObject.importedModel" class="inspector-note">O modelo importado mantém os materiais e as texturas do arquivo GLB. A cor base atua como tonalização do modelo.</p>
        </details>

        <details class="inspector-group">
          <summary class="inspector-group-heading"><UiIcon name="box" :size="14" /> Física e colisor</summary>
          <label class="inspector-property">
            <span>Massa</span>
            <input type="number" min="0" max="10000" step=".1" :value="selectedObject.mass" @change="setObjectNumber('mass', $event)" />
          </label>
          <label class="inspector-property">
            <span>Tipo de colisor</span>
            <select :value="selectedObject.colliderType" data-testid="inspector-collider-type" @change="emit('collider-type', selectedObject.id, $event)">
              <option value="auto">Automático</option>
              <option value="box">Caixa</option>
              <option value="sphere">Esfera</option>
              <option value="capsule">Cápsula</option>
              <option value="mesh">Malha estática</option>
              <option value="none">Desativado</option>
            </select>
          </label>
          <template v-if="selectedObject.colliderType !== 'none'">
            <div class="inspector-vector-block">
              <span class="inspector-vector-title">Dimensões do colisor</span>
              <div class="inspector-axis-grid">
                <label><b class="axis-x">X</b><input type="number" min=".05" max="100" step=".05" :value="selectedObject.colliderSize[0]" @change="emit('collider-vector', selectedObject.id, 'colliderSize', 0, $event)" /></label>
                <label><b class="axis-y">Y</b><input type="number" min=".05" max="100" step=".05" :value="selectedObject.colliderSize[1]" @change="emit('collider-vector', selectedObject.id, 'colliderSize', 1, $event)" /></label>
                <label><b class="axis-z">Z</b><input type="number" min=".05" max="100" step=".05" :value="selectedObject.colliderSize[2]" @change="emit('collider-vector', selectedObject.id, 'colliderSize', 2, $event)" /></label>
              </div>
            </div>
            <div class="inspector-vector-block">
              <span class="inspector-vector-title">Deslocamento do colisor</span>
              <div class="inspector-axis-grid">
                <label><b class="axis-x">X</b><input type="number" step=".05" :value="selectedObject.colliderOffset[0]" @change="emit('collider-vector', selectedObject.id, 'colliderOffset', 0, $event)" /></label>
                <label><b class="axis-y">Y</b><input type="number" step=".05" :value="selectedObject.colliderOffset[1]" @change="emit('collider-vector', selectedObject.id, 'colliderOffset', 1, $event)" /></label>
                <label><b class="axis-z">Z</b><input type="number" step=".05" :value="selectedObject.colliderOffset[2]" @change="emit('collider-vector', selectedObject.id, 'colliderOffset', 2, $event)" /></label>
              </div>
            </div>
          </template>
          <div class="inspector-toggle-row">
            <span>Visualizar colisores</span>
            <button type="button" class="switch" :class="{ on: colliderDebugVisible }" role="switch" :aria-checked="colliderDebugVisible" aria-label="Visualizar colisores" @click="emit('toggle-collider-debug')"><i /></button>
          </div>
        </details>
      </template>
      <div v-else class="inspector-empty">
        <UiIcon name="mouse-pointer" :size="22" />
        <strong>Nenhum objeto selecionado</strong>
        <span>Selecione um item na viewport ou na hierarquia para editar suas propriedades.</span>
      </div>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="layers" :size="14" /> Terreno e cena</summary>
        <div class="inspector-toggle-row">
          <span>Terreno visível</span>
          <button type="button" class="switch" :class="{ on: terrain.visible }" role="switch" :aria-checked="terrain.visible" aria-label="Terreno visível" @click="emit('toggle-terrain')"><i /></button>
        </div>
        <div class="terrain-meta"><span>Seed {{ terrain.seed }}</span><span>{{ terrain.edits }} edições</span></div>
        <label class="range-row">
          <span>Força do pincel</span>
          <div class="range-value-control"><input type="range" min=".1" max="5" step=".1" :value="brushStrength" @change="emit('brush-strength', Number(($event.target as HTMLInputElement).value))" /><output>{{ formatNumber(brushStrength, 1) }}</output></div>
        </label>
        <label class="range-row">
          <span>Raio do pincel</span>
          <div class="range-value-control"><input type="range" min=".5" max="20" step=".5" :value="brushRadius" @change="emit('brush-radius', Number(($event.target as HTMLInputElement).value))" /><output>{{ formatNumber(brushRadius, 1) }} u</output></div>
        </label>
        <div class="compact-actions">
          <button type="button" @click="emit('regenerate-terrain')">Regenerar terreno</button>
          <button type="button" @click="emit('clear-terrain')">Limpar edições</button>
        </div>
      </details>
    </div>

    <div v-else-if="activeTab === 'player'" class="inspector-scroll">
      <div class="inspector-summary">
        <div class="summary-icon player-summary-icon"><UiIcon name="player" :size="24" /></div>
        <div class="summary-copy"><strong>Jogador</strong><small>{{ playerModelCustom ? 'Modelo personalizado' : 'Modelo padrão' }}</small></div>
      </div>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="player" :size="14" /> Modelo do jogador</summary>
        <div class="model-name-card">
          <span><UiIcon name="box" :size="20" /></span>
          <div><strong>{{ playerModelName }}</strong><small>{{ playerModelHeight.toFixed(2) }} unidades de altura</small></div>
        </div>
        <label class="file-chip player-model-upload">
          <UiIcon name="upload" :size="14" /> Importar modelo GLB
          <input type="file" accept=".glb,model/gltf-binary" @change="onPlayerModelFile" />
        </label>
        <p class="inspector-note">Apenas GLB binário, até 30 MB. O arquivo fica incorporado ao projeto quando salvo.</p>
        <template v-if="playerModelCustom">
          <label class="range-row">
            <span>Altura do modelo</span>
            <div class="range-value-control">
              <input type="range" min=".1" max="10" step=".05" :value="playerModelHeight" @change="emit('player-model-height', Number(($event.target as HTMLInputElement).value))" />
              <output>{{ playerModelHeight.toFixed(2) }} u</output>
            </div>
          </label>
          <button type="button" class="inspector-secondary-action" @click="emit('reset-player-model')">Restaurar modelo padrão</button>
        </template>
      </details>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="move" :size="14" /> Movimento</summary>
        <label class="inspector-property"><span>Velocidade de caminhada</span><input type="number" min=".5" max="15" step=".1" :value="playerSettings.walkSpeed" @change="setPlayerNumber('walkSpeed', $event)" /></label>
        <label class="inspector-property"><span>Multiplicador de corrida</span><input type="number" min="1" max="3" step=".1" :value="playerSettings.runMultiplier" @change="setPlayerNumber('runMultiplier', $event)" /></label>
        <label class="inspector-property"><span>Força do salto</span><input type="number" min="0" max="14" step=".1" :value="playerSettings.jumpSpeed" @change="setPlayerNumber('jumpSpeed', $event)" /></label>
        <label class="inspector-property"><span>Gravidade</span><input type="number" min="2" max="40" step=".5" :value="playerSettings.gravity" @change="setPlayerNumber('gravity', $event)" /></label>
      </details>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="box" :size="14" /> Colisor do jogador</summary>
        <label class="inspector-property"><span>Raio</span><input type="number" min=".1" max=".8" step=".01" :value="playerSettings.colliderRadius" @change="setPlayerNumber('colliderRadius', $event)" /></label>
        <p class="inspector-note">O raio é normalizado para o personagem com 1,8 unidade de altura.</p>
      </details>
    </div>

    <div v-else-if="activeTab === 'sky'" class="inspector-scroll">
      <div class="inspector-summary">
        <div class="summary-icon sky-summary-icon"><UiIcon name="sun" :size="24" /></div>
        <div class="summary-copy"><strong>Ambiente</strong><small>Céu, iluminação e atmosfera</small></div>
      </div>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="sun" :size="14" /> Horário e ciclo dia/noite</summary>
        <div class="time-readout">{{ formatTime(timeOfDay) }}</div>
        <label class="range-row">
          <span>Horário do mundo</span>
          <input type="range" min="0" max="24" step=".25" :value="timeOfDay" @input="emit('time-of-day', Number(($event.target as HTMLInputElement).value))" />
        </label>
        <div class="inspector-toggle-row">
          <span>Ciclo automático</span>
          <button type="button" class="switch" :class="{ on: dayNightCycleEnabled }" role="switch" :aria-checked="dayNightCycleEnabled" aria-label="Ciclo automático dia e noite" @click="emit('toggle-cycle')"><i /></button>
        </div>
        <label v-if="dayNightCycleEnabled" class="range-row">
          <span>Velocidade do ciclo</span>
          <div class="range-value-control"><input type="range" min=".01" max="4" step=".01" :value="dayNightCycleSpeed" @input="emit('cycle-speed', Number(($event.target as HTMLInputElement).value))" /><output>{{ formatNumber(dayNightCycleSpeed, 2) }}×</output></div>
        </label>
      </details>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="image" :size="14" /> Céu personalizado</summary>
        <label class="sky-upload-area">
          <span><UiIcon name="image" :size="22" /></span>
          <strong>{{ hasSkyTexture ? 'Substituir imagem do céu' : 'Importar imagem de céu' }}</strong>
          <small>PNG, JPG ou WebP</small>
          <input type="file" accept="image/*" @change="onSkyFile" />
        </label>
        <button v-if="hasSkyTexture" type="button" class="inspector-secondary-action" @click="emit('clear-sky')">Remover imagem personalizada</button>
      </details>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="cloud" :size="14" /> Névoa atmosférica</summary>
        <div class="inspector-toggle-row">
          <span>Névoa ativada</span>
          <button type="button" class="switch" :class="{ on: renderFogEnabled }" role="switch" :aria-checked="renderFogEnabled" aria-label="Névoa atmosférica" @click="emit('fog', !renderFogEnabled)"><i /></button>
        </div>
        <label class="range-row">
          <span>Distância</span>
          <div class="range-value-control"><input type="range" min=".5" max="2" step=".05" :value="renderFogDistanceScale" :disabled="!renderFogEnabled" @input="emit('fog-distance', Number(($event.target as HTMLInputElement).value))" /><output>{{ formatNumber(renderFogDistanceScale, 2) }}×</output></div>
        </label>
      </details>
    </div>

    <div v-else class="inspector-scroll">
      <div class="inspector-summary">
        <div class="summary-icon"><UiIcon name="settings" :size="23" /></div>
        <div class="summary-copy"><strong>Renderização</strong><small>Desempenho e densidade visual</small></div>
      </div>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="gauge" :size="14" /> Qualidade geral</summary>
        <label class="inspector-property">
          <span>Perfil gráfico</span>
          <select :value="performanceMode" @change="emit('performance', ($event.target as HTMLSelectElement).value as 'quality' | 'balanced' | 'economy' | 'auto')">
            <option value="quality">Alta qualidade</option>
            <option value="balanced">Equilibrado</option>
            <option value="economy">Econômico</option>
            <option value="auto">Automático</option>
          </select>
        </label>
        <label class="inspector-property">
          <span>Limite de FPS</span>
          <select :value="renderFpsLimit" @change="emit('fps-limit', Number(($event.target as HTMLSelectElement).value))">
            <option value="0">Sem limite</option><option value="30">30 FPS</option><option value="45">45 FPS</option><option value="60">60 FPS</option><option value="90">90 FPS</option><option value="120">120 FPS</option>
          </select>
        </label>
        <label class="inspector-property">
          <span>Escala de resolução</span>
          <select :value="renderResolutionScale" @change="emit('render-resolution', Number(($event.target as HTMLSelectElement).value))">
            <option value="0">Seguir perfil</option><option value=".5">50%</option><option value=".65">65%</option><option value=".75">75%</option><option value=".85">85%</option><option value="1">100%</option><option value="1.1">110%</option><option value="1.25">125%</option>
          </select>
        </label>
      </details>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="activity" :size="14" /> Resolução dinâmica</summary>
        <div class="inspector-toggle-row">
          <span>Ajustar resolução por FPS</span>
          <button type="button" class="switch" :class="{ on: renderDynamicResolution }" role="switch" :aria-checked="renderDynamicResolution" aria-label="Resolução dinâmica" @click="emit('dynamic-resolution', !renderDynamicResolution)"><i /></button>
        </div>
        <template v-if="renderDynamicResolution">
          <label class="inspector-property">
            <span>FPS desejado</span>
            <select :value="renderDynamicResolutionTargetFps" @change="emit('dynamic-target-fps', Number(($event.target as HTMLSelectElement).value))">
              <option value="30">30 FPS</option><option value="45">45 FPS</option><option value="60">60 FPS</option><option value="90">90 FPS</option>
            </select>
          </label>
          <label class="range-row">
            <span>Resolução mínima</span>
            <div class="range-value-control"><input type="range" min=".5" max=".9" step=".05" :value="renderDynamicResolutionMinScale" @change="emit('dynamic-min-scale', Number(($event.target as HTMLInputElement).value))" /><output>{{ Math.round(renderDynamicResolutionMinScale * 100) }}%</output></div>
          </label>
        </template>
      </details>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="scan" :size="14" /> Distância e visualização</summary>
        <div class="inspector-property"><span>Distância atual</span><span class="readonly-value">{{ renderAll ? 'Sem limite' : renderDistance + ' u' }}</span></div>
        <label class="range-row">
          <span>Alcance de renderização</span>
          <div class="range-value-control"><input type="range" min="10" max="5000" step="10" :value="renderDistance" :disabled="renderAll" @change="emit('render-distance', Number(($event.target as HTMLInputElement).value))" /><output>{{ renderDistance }} u</output></div>
        </label>
        <div class="inspector-toggle-row"><span>Renderizar tudo</span><button type="button" class="switch" :class="{ on: renderAll }" role="switch" :aria-checked="renderAll" aria-label="Renderizar tudo" @click="emit('render-all', !renderAll)"><i /></button></div>
        <div class="inspector-toggle-row"><span>Grade da cena</span><button type="button" class="switch" :class="{ on: gridVisible }" role="switch" :aria-checked="gridVisible" aria-label="Grade da cena" @click="emit('toggle-grid')"><i /></button></div>
        <div class="inspector-toggle-row"><span>Linhas de polígonos</span><button type="button" class="switch" :class="{ on: polygonLinesVisible }" role="switch" :aria-checked="polygonLinesVisible" aria-label="Linhas de polígonos" @click="emit('toggle-polygon-lines')"><i /></button></div>
      </details>

      <details class="inspector-group" open>
        <summary class="inspector-group-heading"><UiIcon name="floresta" :size="14" /> Grama e vegetação</summary>
        <div class="inspector-toggle-row"><span>Grama visível</span><button type="button" class="switch" :class="{ on: grassVisible }" role="switch" :aria-checked="grassVisible" aria-label="Grama visível" @click="emit('grass-visible', !grassVisible)"><i /></button></div>
        <div class="inspector-toggle-row"><span>Modelo detalhado</span><button type="button" class="switch" :class="{ on: grassUseDetailedModel }" role="switch" :aria-checked="grassUseDetailedModel" aria-label="Modelo detalhado de grama" @click="emit('grass-detailed', !grassUseDetailedModel)"><i /></button></div>
        <label class="inspector-property">
          <span>Densidade</span>
          <select :value="grassDensityPercent" @change="emit('grass-density', Number(($event.target as HTMLSelectElement).value))">
            <option value="25">25%</option><option value="40">40%</option><option value="60">60%</option><option value="80">80%</option><option value="100">100%</option>
          </select>
        </label>
        <label class="inspector-property">
          <span>Alcance da grama</span>
          <select :value="grassRenderDistanceMode === 'custom' ? String(grassRenderDistance) : grassRenderDistanceMode" @change="emit('grass-distance', ($event.target as HTMLSelectElement).value)">
            <option value="global">Seguir distância global</option>
            <option value="all">Sem limite próprio</option>
            <option v-if="grassRenderDistanceMode === 'custom'" :value="String(grassRenderDistance)">Personalizado ({{ grassRenderDistance }} u)</option>
            <option value="50">50 unidades</option><option value="72">72 unidades</option><option value="100">100 unidades</option><option value="150">150 unidades</option><option value="250">250 unidades</option><option value="500">500 unidades</option>
          </select>
        </label>
        <label class="range-row">
          <span>Detalhe próximo</span>
          <div class="range-value-control"><input type="range" min="0" max="40" step="5" :value="grassNearDetailDistance" @change="emit('grass-detail-distance', 'near', Number(($event.target as HTMLInputElement).value))" /><output>{{ grassNearDetailDistance === 0 ? 'Auto' : grassNearDetailDistance + ' u' }}</output></div>
        </label>
        <label class="range-row">
          <span>Detalhe médio</span>
          <div class="range-value-control"><input type="range" min="0" max="80" step="10" :value="grassMiddleDetailDistance" @change="emit('grass-detail-distance', 'middle', Number(($event.target as HTMLInputElement).value))" /><output>{{ grassMiddleDetailDistance === 0 ? 'Auto' : grassMiddleDetailDistance + ' u' }}</output></div>
        </label>
        <label class="inspector-property">
          <span>Movimento do vento</span>
          <select :value="grassWindPercent" @change="emit('grass-wind', Number(($event.target as HTMLSelectElement).value))">
            <option value="0">Desligado</option><option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option>
          </select>
        </label>
      </details>

      <details class="inspector-group">
        <summary class="inspector-group-heading"><UiIcon name="shield-check" :size="14" /> Oclusão da grama</summary>
        <div class="inspector-toggle-row"><span>Ocultar atrás de objetos</span><button type="button" class="switch" :class="{ on: grassOcclusionEnabled }" role="switch" :aria-checked="grassOcclusionEnabled" aria-label="Oclusão da grama" @click="emit('grass-occlusion', !grassOcclusionEnabled)"><i /></button></div>
        <label class="inspector-property">
          <span>Qualidade das paredes</span>
          <select :value="wallOcclusionQuality" @change="emit('wall-occlusion-quality', ($event.target as HTMLSelectElement).value as 'fast' | 'precise')">
            <option value="fast">Rápida</option><option value="precise">Precisa</option>
          </select>
        </label>
        <label class="inspector-property">
          <span>Intervalo de verificação</span>
          <select :value="grassOcclusionIntervalMs" @change="emit('grass-occlusion-interval', Number(($event.target as HTMLSelectElement).value))">
            <option value="250">250 ms</option><option value="400">400 ms</option><option value="800">800 ms</option><option value="1200">1200 ms</option>
          </select>
        </label>
      </details>

      <details class="inspector-group">
        <summary class="inspector-group-heading"><UiIcon name="activity" :size="14" /> Diagnóstico do renderizador</summary>
        <div class="inspector-stat-grid">
          <div><small>FPS</small><strong>{{ renderStats.continuousRendering ? Math.round(renderStats.fps) : '—' }}</strong></div>
          <div><small>Draw calls</small><strong>{{ renderStats.drawCalls }}</strong></div>
          <div><small>Triângulos</small><strong>{{ renderStats.triangles.toLocaleString('pt-BR') }}</strong></div>
          <div><small>Geometrias</small><strong>{{ renderStats.geometries }}</strong></div>
          <div><small>Texturas</small><strong>{{ renderStats.textures }}</strong></div>
          <div><small>Render CPU</small><strong>{{ formatNumber(renderStats.cpuRenderMs, 1) }} ms</strong></div>
        </div>
      </details>
    </div>
  </aside>
</template>
