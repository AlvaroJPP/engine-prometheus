<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import { loadAssetFile } from '@/lib/assets/AssetImporter'
import { DEFAULT_CONTROL_MAPS, DEFAULT_MODEL_CONTROL_BINDINGS } from '@engine'
import type { AnimationRole, ControlMapBindings, ModelControlBindings } from '@engine'
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { applyRigPose, autoRigModel, captureRigPose } from '@/lib/animation/Rigging'
import type { AutoRigPreset } from '@/lib/animation/Rigging'

const props = defineProps<{ open: boolean; controlMap?: Partial<ControlMapBindings>; initialAsset?: { name: string; bytes: ArrayBuffer; animationRoles?: Record<string, AnimationRole>; controlBindings?: Partial<ModelControlBindings> } | null }>()
const emit = defineEmits<{
  close: []
  import: [payload: { name: string; model: THREE.Object3D; height: number }]
  'use-player': [payload: { name: string; bytes: ArrayBuffer; animationRoles: Record<string, AnimationRole> }]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const fileName = ref('')
const error = ref('')
const loading = ref(false)
const modelHeight = ref(2)
const originalHeight = ref(0)
const dimensions = ref<[number, number, number]>([0, 0, 0])
const model = shallowRef<THREE.Object3D | null>(null)
const previewParts = shallowRef<Array<{ id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }>>([])
const selectedPartId = ref('')
const soloPartId = ref('')
const partSearch = ref('')
const componentName = ref('')

type ModelDiagnostic = {
  id: string
  name: string
  type: string
  depth: number
  meshInfo: string
  materials: string
}
type GltfMetadata = {
  images: Array<{ index: number; name: string; mimeType: string; uri: string; bufferView: number | null }>
  textures: Array<{ index: number; name: string; source: number | null }>
  materials: Array<{ index: number; name: string; baseColorTexture: number | null; normalTexture: number | null; occlusionTexture: number | null; emissiveTexture: number | null; baseColorFactor: number[] | null }>
  animations: Array<{ index: number; name: string; channels: number }>
}
const modelDiagnostics = shallowRef<ModelDiagnostic[]>([])
const diagnosticSummary = ref({ nodes: 0, meshes: 0, skinned: 0, materials: 0, textures: 0, clips: 0 })
const previewAnimationIndex = ref(0)
const previewPlaying = ref(true)
const animationClipRevision = ref(0)
const animationRoles = ref<Record<string, AnimationRole>>({})
const previewAnimations = computed(() => {
  const revision = animationClipRevision.value
  void revision
  return (model.value?.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
})
type SetupTab = 'model' | 'controls' | 'animations' | 'rigging' | 'technical'
type ControlBindingAction = keyof ModelControlBindings
const activeSetupTab = ref<SetupTab>('model')
const controlBindings = ref<ModelControlBindings>({ ...DEFAULT_MODEL_CONTROL_BINDINGS })
const listeningForBinding = ref<ControlBindingAction | null>(null)
const setupTabs: Array<{ id: SetupTab; label: string; description: string }> = [
  { id: 'model', label: 'Modelo', description: 'Nome, escala e colisão' },
  { id: 'controls', label: 'Controles', description: 'Teclas e comandos' },
  { id: 'animations', label: 'Animações', description: 'Mapear e testar clipes' },
  { id: 'rigging', label: 'Rig & keyframes', description: 'Criar rig e animar ossos' },
  { id: 'technical', label: 'Avançado', description: 'Diagnóstico e texturas' },
]
const controlBindingFields: Array<{ key: ControlBindingAction; label: string; description: string }> = [
  { key: 'forward', label: 'Mover para frente', description: 'Deslocamento para frente' },
  { key: 'backward', label: 'Mover para trás', description: 'Deslocamento para trás' },
  { key: 'left', label: 'Mover para esquerda', description: 'Deslocamento lateral esquerdo' },
  { key: 'right', label: 'Mover para direita', description: 'Deslocamento lateral direito' },
  { key: 'run', label: 'Correr', description: 'Mantida pressionada durante o movimento' },
  { key: 'jump', label: 'Pular', description: 'Salto do personagem ou montaria' },
  { key: 'interact', label: 'Interagir / montar', description: 'Montar e desmontar quando o pacote Montaria estiver instalado' },
]
const animationRoleBaseOptions: Array<{ value: AnimationRole; label: string }> = [
  { value: 'ignore', label: 'Não usar' },
  { value: 'idle', label: 'Parado / repouso' },
  { value: 'walk', label: 'Andar para frente' },
  { value: 'walk_slow', label: 'Andar devagar (alternância de caminhada)' },
  { value: 'walk_backward', label: 'Andar para trás' },
  { value: 'walk_left', label: 'Deslocar para esquerda' },
  { value: 'walk_right', label: 'Deslocar para direita' },
  { value: 'walk_diagonal_left', label: 'Andar na diagonal esquerda' },
  { value: 'walk_diagonal_right', label: 'Andar na diagonal direita' },
  { value: 'run', label: 'Correr para frente' },
  { value: 'run_backward', label: 'Correr para trás' },
  { value: 'run_left', label: 'Correr para esquerda' },
  { value: 'run_right', label: 'Correr para direita' },
  { value: 'run_diagonal_left', label: 'Correr na diagonal esquerda' },
  { value: 'run_diagonal_right', label: 'Correr na diagonal direita' },
  { value: 'run_stop', label: 'Parar após correr' },
  { value: 'jump', label: 'Pular' },
  { value: 'crouch', label: 'Agachar parado' },
  { value: 'crouch_walk', label: 'Mover agachado' },
  { value: 'prone', label: 'Deitado / rastejar parado' },
  { value: 'prone_crawl', label: 'Rastejar em movimento' },
  { value: 'dodge', label: 'Esquiva' },
  { value: 'slide', label: 'Deslizar' },
  { value: 'roll', label: 'Rolamento evasivo' },
  { value: 'interact', label: 'Interagir' },
  { value: 'primary_action', label: 'Ação principal / ataque' },
  { value: 'secondary_action', label: 'Ação secundária / defesa' },
  { value: 'inventory', label: 'Abrir inventário' },
  { value: 'use_item', label: 'Usar item' },
  { value: 'reload', label: 'Recarregar' },
  { value: 'ability_1', label: 'Habilidade 1' },
  { value: 'ability_2', label: 'Habilidade 2' },
  { value: 'ability_3', label: 'Habilidade 3' },
  { value: 'ability_4', label: 'Habilidade 4' },
  { value: 'emote', label: 'Emote / gesto' },
  { value: 'mount', label: 'Montar / subir' },
  { value: 'dismount', label: 'Desmontar / descer' },
]
const animationRoleControlBindingKeys: Partial<Record<AnimationRole, keyof ControlMapBindings>> = {
  walk: 'forward',
  walk_slow: 'walkToggle',
  walk_backward: 'backward',
  walk_left: 'left',
  walk_right: 'right',
  walk_diagonal_left: 'left',
  walk_diagonal_right: 'right',
  run: 'run',
  run_backward: 'backward',
  run_left: 'left',
  run_right: 'right',
  run_diagonal_left: 'left',
  run_diagonal_right: 'right',
  run_stop: 'run',
  jump: 'jump',
  crouch: 'crouchToggle',
  crouch_walk: 'crouchToggle',
  prone: 'proneToggle',
  prone_crawl: 'proneToggle',
  dodge: 'dodge',
  slide: 'slide',
  roll: 'roll',
  interact: 'interact',
  mount: 'interact',
  dismount: 'interact',
  primary_action: 'primaryAction',
  secondary_action: 'secondaryAction',
  inventory: 'inventory',
  use_item: 'useItem',
  reload: 'reload',
  ability_1: 'ability1',
  ability_2: 'ability2',
  ability_3: 'ability3',
  ability_4: 'ability4',
  emote: 'emote',
}
const activeControlMapBindings = computed(() => props.controlMap ?? DEFAULT_CONTROL_MAPS[0]!.bindings)
const animationRoleOptions = computed(() => animationRoleBaseOptions.map(option => {
  const bindingKey = animationRoleControlBindingKeys[option.value]
  if (!bindingKey) return option
  const keyCode = activeControlMapBindings.value[bindingKey] ?? DEFAULT_CONTROL_MAPS[0]!.bindings[bindingKey]
  return { ...option, label: `${option.label} · ${formatControlKey(keyCode)}` }
}))
type RigPose = ReturnType<typeof captureRigPose>
type RigKeyframe = { time: number; pose: RigPose }
const rigPreset = ref<AutoRigPreset>('humanoid')
const rigBones = shallowRef<THREE.Bone[]>([])
const rigRestPose = shallowRef<RigPose>({})
const selectedRigBoneName = ref('')
const rigKeyframes = ref<RigKeyframe[]>([])
const rigFrameTime = ref(0)
const rigDuration = ref(1)
const rigClipName = ref('Animacao personalizada')
const rigClipRole = ref<AnimationRole>('mount')
const rigMessage = ref('')
const boneRotationDraft = ref({ x: 0, y: 0, z: 0 })
const selectedRigBone = computed(() => rigBones.value.find(bone => bone.name === selectedRigBoneName.value) ?? null)
const rigPresetOptions: Array<{ value: AutoRigPreset; label: string }> = [
  { value: 'humanoid', label: 'Humanoide / personagem' },
  { value: 'quadruped', label: 'Quadrúpede / cavalo' },
  { value: 'chain', label: 'Corrente genérica / objeto' },
]
watch(selectedRigBone, bone => {
  if (!bone) return
  boneRotationDraft.value = {
    x: THREE.MathUtils.radToDeg(bone.rotation.x),
    y: THREE.MathUtils.radToDeg(bone.rotation.y),
    z: THREE.MathUtils.radToDeg(bone.rotation.z),
  }
})
const filteredPreviewParts = computed(() => {
  const query = partSearch.value.trim().toLocaleLowerCase('pt-BR')
  if (!query) return previewParts.value
  return previewParts.value.filter(part => part.name.toLocaleLowerCase('pt-BR').includes(query))
})
const previewComponentDimensions = computed(() => {
  if (!model.value) return { x: 0, y: 0, z: 0 }
  const selectedPart = selectedPartId.value ? findPreviewPart(selectedPartId.value) : undefined
  if (selectedPart) {
    const bounds = new THREE.Box3().setFromObject(selectedPart.object)
    if (!bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3())
      const scale = modelHeight.value / Math.max(size.y, 0.05)
      return { x: size.x * scale, y: modelHeight.value, z: size.z * scale }
    }
  }
  const scale = originalHeight.value > 0 ? modelHeight.value / originalHeight.value : 1
  return {
    x: dimensions.value[0] * scale,
    y: modelHeight.value,
    z: dimensions.value[2] * scale,
  }
})

function guessedAnimationRole(name: string): AnimationRole {
  const normalized = name.toLowerCase().replace(/[\s._-]+/g, '')
  if (/dismount|unmount|getoff|dismounting/.test(normalized)) return 'dismount'
  if (/mounting|mount|gettingon|riding/.test(normalized)) return 'mount'
  if (/jump|leap|hop|saut|salto|pular/.test(normalized)) return 'jump'
  if (/stoprun|runstop|stoprunning|runningstop|braking|brake|deceleration/.test(normalized)) return 'run_stop'
  if (/crouch|squat|agachar/.test(normalized)) return 'crouch'
  if (/prone|crawl|rastejar/.test(normalized)) return 'prone_crawl'
  if (/dodge|evade|esquiva/.test(normalized)) return 'dodge'
  if (/slide|sliding|deslizar/.test(normalized)) return 'slide'
  if (/roll|rolling|somersault|rolamento/.test(normalized)) return 'roll'
  if (/reload|reloading/.test(normalized)) return 'reload'
  if (/inventory|inventario/.test(normalized)) return 'inventory'
  if (/useitem|consume|drinking|eating|usaritem/.test(normalized)) return 'use_item'
  if (/ability1|skill1|spell1/.test(normalized)) return 'ability_1'
  if (/ability2|skill2|spell2/.test(normalized)) return 'ability_2'
  if (/ability3|skill3|spell3/.test(normalized)) return 'ability_3'
  if (/ability4|skill4|spell4/.test(normalized)) return 'ability_4'
  if (/secondaryaction|secondaryattack|block|parry|defend/.test(normalized)) return 'secondary_action'
  if (/primaryaction|attack|strike|punch|slash|shoot|melee/.test(normalized)) return 'primary_action'
  if (/interact|interaction|useobject/.test(normalized)) return 'interact'
  if (/emote|gesture|dance|wave/.test(normalized)) return 'emote'
  const isRun = /gallop|canter|sprint|running|run/.test(normalized)
  const left = /left|esquerda|izquierda/.test(normalized)
  const right = /right|direita|derecha/.test(normalized)
  const backward = /backward|backwards|reverse|walkback|moveback|backward|tras|atr.s/.test(normalized)
  const movementClip = /walk|trot|locomotion|move|run|sprint|gallop|canter|strafe|sidestep|sideways/.test(normalized)
  const lateral = /diagonal|diag|strafe|sidestep|sideways/.test(normalized) ||
    (movementClip && (left || right) && !/turn|pivot|rotate/.test(normalized))
  if (movementClip && backward) return isRun ? 'run_backward' : 'walk_backward'
  if (lateral && left) return isRun ? 'run_diagonal_left' : 'walk_diagonal_left'
  if (lateral && right) return isRun ? 'run_diagonal_right' : 'walk_diagonal_right'
  if (isRun) return 'run'
  if (/walk|trot|locomotion|move/.test(normalized)) return 'walk'
  if (/idle|stand|rest|breath|neutral/.test(normalized)) return 'idle'
  return 'ignore'
}
function setAnimationRole(index: number, role: AnimationRole) {
  if (!previewAnimations.value[index]) return
  animationRoles.value = { ...animationRoles.value, [String(index)]: role }
  if (model.value) model.value.userData.importAnimationRoles = { ...animationRoles.value }
}

let rigHelper: THREE.SkeletonHelper | null = null

function removeRigHelper() {
  if (!rigHelper) return
  scene?.remove(rigHelper)
  rigHelper.geometry.dispose()
  const material = rigHelper.material
  if (Array.isArray(material)) material.forEach(item => item.dispose())
  else material.dispose()
  rigHelper = null
}

function refreshRigHelper() {
  if (!model.value || !scene || rigBones.value.length === 0) return
  removeRigHelper()
  rigHelper = new THREE.SkeletonHelper(model.value)
  rigHelper.name = 'ModelWorkspaceRigHelper'
  rigHelper.renderOrder = 999
  rigHelper.frustumCulled = false
  scene.add(rigHelper)
  rigHelper.update()
}

function createRig() {
  const root = model.value
  if (!root || props.initialAsset || loading.value) return
  error.value = ''
  try {
    previewMixer?.stopAllAction()
    const result = autoRigModel(root, rigPreset.value)
    rigBones.value = result.bones
    selectedRigBoneName.value = result.bones[0]?.name ?? ''
    rigRestPose.value = captureRigPose(result.bones)
    rigKeyframes.value = []
    rigFrameTime.value = 0
    rigDuration.value = 1
    rigMessage.value = result.message
    root.userData.importRigPreset = result.preset
    refreshRigHelper()
    refreshPreviewParts()
    refreshModelDiagnostics()
  } catch (cause) {
    rigMessage.value = ''
    error.value = cause instanceof Error ? cause.message : 'Não foi possível criar o rig.'
  }
}

function applySelectedBoneRotation() {
  const bone = selectedRigBone.value
  if (!bone) return
  previewMixer?.stopAllAction()
  bone.rotation.set(
    THREE.MathUtils.degToRad(boneRotationDraft.value.x),
    THREE.MathUtils.degToRad(boneRotationDraft.value.y),
    THREE.MathUtils.degToRad(boneRotationDraft.value.z),
    bone.rotation.order,
  )
  bone.updateMatrixWorld(true)
  rigHelper?.updateMatrixWorld(true)
}

function resetRigPose() {
  if (!rigBones.value.length) return
  previewMixer?.stopAllAction()
  applyRigPose(rigBones.value, rigRestPose.value)
  if (selectedRigBone.value) {
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.x),
      y: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.y),
      z: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.z),
    }
  }
  rigHelper?.updateMatrixWorld(true)
}

function recordRigKeyframe() {
  if (!rigBones.value.length || !model.value) return
  if (!Number.isFinite(rigFrameTime.value) || rigFrameTime.value < 0) {
    rigMessage.value = 'O tempo do quadro precisa ser zero ou positivo.'
    return
  }
  previewMixer?.stopAllAction()
  const time = Number(rigFrameTime.value.toFixed(3))
  const pose = captureRigPose(rigBones.value)
  const existing = rigKeyframes.value.findIndex(frame => Math.abs(frame.time - time) < 0.001)
  const frame = { time, pose }
  if (existing >= 0) {
    rigKeyframes.value = rigKeyframes.value.map((item, index) => index === existing ? frame : item)
  } else {
    rigKeyframes.value = [...rigKeyframes.value, frame].sort((a, b) => a.time - b.time)
  }
  rigDuration.value = Math.max(rigDuration.value, time, 0.1)
  rigMessage.value = `Pose gravada em ${time.toFixed(2)} s (${rigBones.value.length} ossos).`
}

function applyRigFrame(frame: RigKeyframe) {
  rigFrameTime.value = frame.time
  applyRigPose(rigBones.value, frame.pose)
  if (selectedRigBone.value) {
    boneRotationDraft.value = {
      x: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.x),
      y: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.y),
      z: THREE.MathUtils.radToDeg(selectedRigBone.value.rotation.z),
    }
  }
  rigHelper?.updateMatrixWorld(true)
  rigMessage.value = `Pose de ${frame.time.toFixed(2)} s aplicada para edição.`
}

function clearRigKeyframesForNewClip() {
  rigKeyframes.value = []
  rigFrameTime.value = 0
  rigClipName.value = `Animacao ${previewAnimations.value.length + 1}`
  rigMessage.value = 'Linha do tempo limpa. Grave a pose inicial em 0 s e as próximas poses nos tempos desejados.'
}

function createRigAnimation() {
  const root = model.value
  if (!root || !rigBones.value.length || props.initialAsset) return
  const frames = [...rigKeyframes.value].sort((a, b) => a.time - b.time)
  if (frames.length < 2 || frames[0]!.time === frames[frames.length - 1]!.time) {
    rigMessage.value = 'Grave pelo menos duas poses em tempos diferentes (por exemplo, 0 s e 1 s).'
    return
  }
  const name = rigClipName.value.trim()
  if (!name) {
    rigMessage.value = 'Digite um nome para a animação.'
    return
  }
  const clipFrames = frames[0]!.time > 0 ? [{ ...frames[0]!, time: 0 }, ...frames] : frames
  const duration = Math.max(0.1, rigDuration.value, clipFrames[clipFrames.length - 1]!.time)
  const times = clipFrames.map(frame => frame.time)
  const tracks: THREE.KeyframeTrack[] = []

  for (const bone of rigBones.value) {
    const positions: number[] = []
    const quaternions: number[] = []
    const scales: number[] = []
    for (const frame of clipFrames) {
      const transform = frame.pose[bone.name]
      if (!transform) continue
      positions.push(...transform.position)
      quaternions.push(...transform.quaternion)
      scales.push(...transform.scale)
    }
    if (positions.length !== times.length * 3 || quaternions.length !== times.length * 4 || scales.length !== times.length * 3) continue
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, positions))
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, quaternions))
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, scales))
  }
  if (!tracks.length) {
    rigMessage.value = 'Não existem trilhas válidas para exportar. Confira o rig e grave as poses novamente.'
    return
  }

  const clip = new THREE.AnimationClip(name, duration, tracks)
  const clips = [...previewAnimations.value, clip]
  const newIndex = clips.length - 1
  const nextRoles = { ...animationRoles.value, [String(newIndex)]: rigClipRole.value }
  root.userData.importAnimations = clips
  root.userData.importAnimationRoles = nextRoles
  animationRoles.value = nextRoles
  animationClipRevision.value += 1
  previewAnimationIndex.value = newIndex
  refreshModelDiagnostics()
  selectPreviewAnimation(newIndex)
  rigMessage.value = `Animação "${name}" criada com ${tracks.length / 3} trilhas e associada ao papel "${animationRoleBaseOptions.find(option => option.value === rigClipRole.value)?.label ?? rigClipRole.value}". Ela será exportada junto com o modelo.`
}

function setRigTime(value: number) {
  rigFrameTime.value = Math.max(0, Number.isFinite(value) ? value : 0)
}

function normalizeControlBindings(value: unknown): ModelControlBindings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ModelControlBindings>
    : {}
  const read = (key: ControlBindingAction): string => {
    const candidate = raw[key]
    return typeof candidate === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(candidate)
      ? candidate
      : DEFAULT_MODEL_CONTROL_BINDINGS[key]
  }
  return {
    forward: read('forward'),
    backward: read('backward'),
    left: read('left'),
    right: read('right'),
    run: read('run'),
    jump: read('jump'),
    interact: read('interact'),
  }
}

function formatControlKey(code: string): string {
  const names: Record<string, string> = {
    Space: 'Espaço',
    ShiftLeft: 'Shift esquerdo',
    ShiftRight: 'Shift direito',
    ControlLeft: 'Ctrl esquerdo',
    ControlRight: 'Ctrl direito',
    AltLeft: 'Alt esquerdo',
    AltRight: 'Alt direito',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    CapsLock: 'Caps Lock',
  }
  if (names[code]) return names[code]!
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6)
  return code
}

function startControlBindingCapture(action: ControlBindingAction) {
  if (!model.value || props.initialAsset) return
  listeningForBinding.value = action
  error.value = ''
}

function captureControlBindingKey(event: KeyboardEvent) {
  const action = listeningForBinding.value
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (event.code === 'Escape') {
    listeningForBinding.value = null
    return
  }
  if (!event.code || /^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(event.code)) return
  const next = { ...controlBindings.value, [action]: event.code }
  controlBindings.value = next
  if (model.value) model.value.userData.importControlBindings = { ...next }
  listeningForBinding.value = null
}

function resetControlBindings() {
  if (!model.value || props.initialAsset) return
  controlBindings.value = { ...DEFAULT_MODEL_CONTROL_BINDINGS }
  model.value.userData.importControlBindings = { ...controlBindings.value }
}

const textureRepairSelections = ref<Record<string, string>>({})
const textureRepairBusy = ref(false)
const textureRepairMessage = ref('')
const gltfMetadata = computed(() => model.value?.userData.importGltfMetadata as GltfMetadata | undefined)
const colliderType = ref<'box' | 'sphere' | 'capsule' | 'none'>('box')
const colliderSize = ref<[number, number, number]>([1, 1, 1])
const colliderOffset = ref<[number, number, number]>([0, 0, 0])
let colliderPreview: THREE.LineSegments | null = null

function updateColliderPreview() {
  if (!scene || !model.value) return
  if (colliderPreview) {
    scene.remove(colliderPreview)
    colliderPreview.geometry.dispose()
    ;(colliderPreview.material as THREE.Material).dispose()
    colliderPreview = null
  }
  if (!model.value || colliderType.value === 'none') return
  const [width, height, depth] = colliderSize.value.map(value => Math.max(0.05, value))
  let geometry: THREE.BufferGeometry
  if (colliderType.value === 'sphere') {
    geometry = new THREE.IcosahedronGeometry(Math.max(width, height, depth) / 2, 2)
  } else if (colliderType.value === 'capsule') {
    const radius = Math.max(0.025, Math.min(width, depth) / 4)
    geometry = new THREE.CapsuleGeometry(radius, Math.max(0, height - radius * 2), 4, 8)
    geometry.scale(width / Math.max(radius * 2, 0.05), 1, depth / Math.max(radius * 2, 0.05))
  } else {
    geometry = new THREE.BoxGeometry(width, height, depth)
  }
  geometry.translate(...colliderOffset.value)
  colliderPreview = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x65e6a0, depthTest: false, transparent: true, opacity: 0.98 }),
  )
  colliderPreview.name = 'import-collider-preview'
  colliderPreview.renderOrder = 1000
  const selectedPart = selectedPartId.value ? findPreviewPart(selectedPartId.value) : undefined
  if (selectedPart) {
    const partBounds = new THREE.Box3().setFromObject(selectedPart.object)
    if (!partBounds.isEmpty()) colliderPreview.position.copy(partBounds.getCenter(new THREE.Vector3()))
  }
  scene.add(colliderPreview)
  geometry.dispose()
}

function changeColliderType(value: 'box' | 'sphere' | 'capsule' | 'none') {
  colliderType.value = value
  if (value === 'sphere') {
    const diameter = Math.max(0.05, Math.min(...colliderSize.value))
    colliderSize.value = [diameter, diameter, diameter]
  }
  updateColliderPreview()
}

function setColliderVector(field: 'colliderSize' | 'colliderOffset', axis: 0 | 1 | 2, value: number) {
  if (!Number.isFinite(value)) return
  const vector: [number, number, number] = [...(field === 'colliderSize' ? colliderSize.value : colliderOffset.value)]
  const safeValue = field === 'colliderSize' ? Math.max(0.05, Math.min(100, value)) : Math.max(-100, Math.min(100, value))
  vector[axis] = safeValue
  if (field === 'colliderSize') {
    if (colliderType.value === 'sphere') vector.splice(0, 3, safeValue, safeValue, safeValue)
    colliderSize.value = vector
  } else colliderOffset.value = vector
  updateColliderPreview()
}

const recoverableColorImages = computed(() => (gltfMetadata.value?.images ?? []).filter(image => image.uri.startsWith('data:image/')))
const materialsMissingColorTexture = computed(() => (gltfMetadata.value?.materials ?? []).filter(material => material.baseColorTexture === null))

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let frame = 0
let resizeObserver: ResizeObserver | null = null
let currentObjectUrl = ''
let previewMixer: THREE.AnimationMixer | null = null
const previewClock = new THREE.Clock()

function disposeModel(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      geometries.add(child.geometry)
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
      childMaterials.forEach(material => {
        materials.add(material)
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value)
        }
      })
    }
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => texture.dispose())
}

function refreshPreviewParts() {
  const root = model.value
  if (!root) {
    previewParts.value = []
    selectedPartId.value = ''
    soloPartId.value = ''
    return
  }

  // Conte os nós de baixo para cima: a quantidade de malhas de cada grupo é
  // calculada uma só vez, em vez de percorrer seus descendentes repetidamente.
  const nodes: Array<{ node: THREE.Object3D; depth: number }> = []
  const collect = (node: THREE.Object3D, depth: number) => {
    nodes.push({ node, depth })
    for (const child of node.children) collect(child, depth + 1)
  }
  collect(root, -1)

  const meshCounts = new Map<THREE.Object3D, number>()
  for (const entry of nodes) meshCounts.set(entry.node, entry.node instanceof THREE.Mesh ? 1 : 0)
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const entry = nodes[index]!
    const parent = entry.node.parent
    if (parent) {
      meshCounts.set(parent, (meshCounts.get(parent) ?? 0) + (meshCounts.get(entry.node) ?? 0))
    }
  }

  const parts: Array<{ id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }> = []
  let unnamedIndex = 0
  for (const { node, depth } of nodes) {
    if (node === root) continue
    const meshCount = meshCounts.get(node) ?? 0
    if (!meshCount) continue
    unnamedIndex += 1
    parts.push({
      id: node.uuid,
      name: node.name.trim() || (node instanceof THREE.Mesh ? `Malha ${unnamedIndex}` : `Grupo ${unnamedIndex}`),
      object: node,
      depth,
      meshCount,
    })
  }

  previewParts.value = parts
  if (!parts.some(part => part.id === selectedPartId.value)) selectedPartId.value = ''
  if (!parts.some(part => part.id === soloPartId.value)) soloPartId.value = ''
}

function findPreviewPart(id: string) {
  return previewParts.value.find(part => part.id === id)
}

function setColliderFromPreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  const bounds = new THREE.Box3().setFromObject(part.object)
  if (bounds.isEmpty()) return
  const size = bounds.getSize(new THREE.Vector3())
  // O componente será normalizado para a altura escolhida ao colocá-lo no
  // mundo, por isso o colisor também precisa usar essa escala final.
  const scale = modelHeight.value / Math.max(size.y, 0.05)
  const scaledSize: [number, number, number] = [
    Math.max(0.05, size.x * scale),
    Math.max(0.05, size.y * scale),
    Math.max(0.05, size.z * scale),
  ]
  if (colliderType.value === 'sphere') {
    const diameter = Math.max(0.05, Math.min(...scaledSize))
    colliderSize.value = [diameter, diameter, diameter]
  } else {
    colliderSize.value = scaledSize
  }
  colliderOffset.value = [0, 0, 0]
}

function selectPreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  if (soloPartId.value) restorePreviewVisibility()
  selectedPartId.value = part.id
  componentName.value = part.name
  setColliderFromPreviewPart(part)
  fitCamera(part.object)
  updateColliderPreview()
}

function togglePreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  if (soloPartId.value) restorePreviewVisibility()
  part.object.visible = !part.object.visible
}

function showOnlyPreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  const root = model.value
  if (!root) return
  if (soloPartId.value === part.id) {
    restorePreviewVisibility()
  } else {
    // Os ancestrais precisam permanecer visíveis: no Three.js, esconder um pai
    // também esconde todos os seus descendentes, mesmo que o filho esteja visible=true.
    root.traverse(node => {
      const isPart = node === part.object
      const isChild = isDescendantOf(node, part.object)
      const isParent = isDescendantOf(part.object, node)
      node.visible = node === root || isPart || isChild || isParent
    })
    soloPartId.value = part.id
    selectedPartId.value = part.id
    componentName.value = part.name
    setColliderFromPreviewPart(part)
    fitCamera(part.object)
    updateColliderPreview()
  }
}

function selectWholeModel() {
  const root = model.value
  if (!root) return
  restorePreviewVisibility()
  selectedPartId.value = ''
  componentName.value = root.name.trim() || fileName.value.replace(/\.[^.]+$/, '') || 'Modelo 3D'
  const scale = originalHeight.value > 0 ? modelHeight.value / originalHeight.value : 1
  const wholeModelSize: [number, number, number] = [
    Math.max(0.05, dimensions.value[0] * scale),
    Math.max(0.05, dimensions.value[1] * scale),
    Math.max(0.05, dimensions.value[2] * scale),
  ]
  if (colliderType.value === 'sphere') {
    const diameter = Math.max(0.05, Math.min(...wholeModelSize))
    colliderSize.value = [diameter, diameter, diameter]
  } else {
    colliderSize.value = wholeModelSize
  }
  colliderOffset.value = [0, 0, 0]
  fitCamera(root)
  updateColliderPreview()
}

function isDescendantOf(node: THREE.Object3D, ancestor: THREE.Object3D) {
  let current: THREE.Object3D | null = node
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function restorePreviewVisibility() {
  model.value?.traverse(node => { node.visible = true })
  soloPartId.value = ''
}

function deletePreviewPart(part: { id: string; name: string; object: THREE.Object3D; depth: number; meshCount: number }) {
  if (!model.value || !part.object.parent) return
  part.object.removeFromParent()
  model.value.updateMatrixWorld(true)
  refreshPreviewParts()
  refreshModelDiagnostics()
  if (model.value) fitCamera(model.value)
}


async function applyRecoveredColorTexture(materialIndex: number) {
  const root = model.value
  const metadata = gltfMetadata.value
  const materialInfo = metadata?.materials.find(item => item.index === materialIndex)
  const imageIndex = Number(textureRepairSelections.value[String(materialIndex)])
  const imageInfo = metadata?.images.find(image => image.index === imageIndex)
  if (!root || !materialInfo || !imageInfo?.uri.startsWith('data:image/')) {
    textureRepairMessage.value = 'Selecione uma imagem incorporada válida para este material.'
    return
  }
  textureRepairBusy.value = true
  textureRepairMessage.value = ''
  try {
    const texture = await new THREE.TextureLoader().loadAsync(imageInfo.uri)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.needsUpdate = true
    let assigned = 0
    const recoveredTextures = (root.userData.importRecoveredTextures as THREE.Texture[] | undefined) ?? []
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      for (const material of materials) {
        if (material.name !== materialInfo.name || !('map' in material)) continue
        const standard = material as THREE.MeshStandardMaterial
        // Só substitua mapas ausentes ou aplicados por esta ferramenta; nunca
        // sobrescreva uma textura original válida do arquivo.
        if (standard.map && !recoveredTextures.includes(standard.map)) continue
        standard.map = texture
        standard.needsUpdate = true
        assigned += 1
      }
    })
    if (!assigned) {
      texture.dispose()
      throw new Error(`Não encontrei malhas usando o material "${materialInfo.name || `Material ${materialIndex}`}" sem mapa de cor.`)
    }
    const applied = (root.userData.importRecoveredColorTextures as Record<string, number> | undefined) ?? {}
    applied[String(materialIndex)] = imageIndex
    root.userData.importRecoveredColorTextures = applied
    recoveredTextures.push(texture)
    root.userData.importRecoveredTextures = recoveredTextures
    textureRepairMessage.value = `Imagem ${imageIndex} aplicada ao material ${materialInfo.name || materialIndex}. O mapa normal e os demais mapas foram preservados.`
    refreshModelDiagnostics()
  } catch (e) {
    textureRepairMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    textureRepairBusy.value = false
  }
}

function refreshModelDiagnostics() {
  const root = model.value
  if (!root) {
    modelDiagnostics.value = []
    diagnosticSummary.value = { nodes: 0, meshes: 0, skinned: 0, materials: 0, textures: 0, clips: 0 }
    return
  }

  const rows: ModelDiagnostic[] = []
  const materialIds = new Set<string>()
  const textureIds = new Set<string>()
  let meshes = 0
  let skinned = 0
  root.traverse((node) => {
    const depth = (() => {
      let value = 0
      let parent = node.parent
      while (parent && parent !== root) { value += 1; parent = parent.parent }
      return value
    })()
    const isMesh = node instanceof THREE.Mesh
    const mesh = isMesh ? node as THREE.Mesh : null
    let meshInfo = ''
    let materialsText = ''
    if (mesh) {
      meshes += 1
      if (mesh instanceof THREE.SkinnedMesh) skinned += 1
      const geometry = mesh.geometry
      const position = geometry.getAttribute('position')
      meshInfo = `vértices: ${position?.count ?? 0}; grupos: ${geometry.groups.length}`
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materialsText = materials.map((material) => {
        materialIds.add(material.uuid)
        const maps = ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']
          .filter((key) => {
            const texture = (material as unknown as Record<string, unknown>)[key]
            if (texture instanceof THREE.Texture) textureIds.add(texture.uuid)
            return texture instanceof THREE.Texture
          })
        const mapInfo = maps.length ? `texturas: ${maps.join(', ')}` : 'sem mapas de textura reconhecidos'
        const color = 'color' in material && (material as THREE.Material & { color?: THREE.Color }).color
        return `${material.name || 'material sem nome'} [${material.type}; ${mapInfo}; cor: ${color ? '#' + color.getHexString() : 'n/a'}]`
      }).join(' | ')
    }
    rows.push({
      id: node.uuid,
      name: node.name || '(sem nome)',
      type: node.type,
      depth,
      meshInfo,
      materials: materialsText,
    })
  })
  const clips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
  modelDiagnostics.value = rows
  diagnosticSummary.value = {
    nodes: rows.length,
    meshes,
    skinned,
    materials: materialIds.size,
    textures: textureIds.size,
    clips: clips.length,
  }
}



function clearLoadedModel() {
  activeSetupTab.value = 'model'
  listeningForBinding.value = null
  controlBindings.value = { ...DEFAULT_MODEL_CONTROL_BINDINGS }
  previewParts.value = []
  selectedPartId.value = ''
  soloPartId.value = ''
  partSearch.value = ''
  componentName.value = ''
  previewMixer?.stopAllAction()
  previewMixer = null
  previewAnimationIndex.value = 0
  previewPlaying.value = true
  animationRoles.value = {}
  removeRigHelper()
  rigBones.value = []
  rigRestPose.value = {}
  selectedRigBoneName.value = ''
  rigKeyframes.value = []
  rigFrameTime.value = 0
  rigDuration.value = 1
  rigMessage.value = ''
  animationClipRevision.value = 0
  if (model.value) {
    scene?.remove(model.value)
    const recoveredTextures = model.value.userData.importRecoveredTextures as THREE.Texture[] | undefined
    recoveredTextures?.forEach(texture => texture.dispose())
    const ownedUrls: string[] = []
    model.value.traverse(node => {
      const url = node.userData.importOwnedObjectUrl
      if (typeof url === 'string') ownedUrls.push(url)
    })
    ownedUrls.forEach(url => URL.revokeObjectURL(url))
    disposeModel(model.value)
  }
  model.value = null
  if (colliderPreview) { scene?.remove(colliderPreview); colliderPreview.geometry.dispose(); (colliderPreview.material as THREE.Material).dispose(); colliderPreview = null }
  textureRepairSelections.value = {}
  textureRepairMessage.value = ''
  refreshModelDiagnostics()
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
  currentObjectUrl = ''
}

function disposePreview() {
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  resizeObserver = null
  controls?.dispose()
  controls = null
  clearLoadedModel()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
}

function fitCamera(object: THREE.Object3D) {
  if (!scene || !camera || !controls) return
  const bounds = new THREE.Box3().setFromObject(object)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  controls.target.copy(center)
  const span = Math.max(size.x, size.y, size.z, 0.1)
  camera.position.set(center.x + span * 1.7, center.y + span * 1.15, center.z + span * 2.1)
  camera.near = Math.max(0.01, span / 1000)
  camera.far = Math.max(100, span * 100)
  camera.updateProjectionMatrix()
  controls.update()
}

function initPreview() {
  if (!canvas.value || renderer) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#20232a')
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(canvas.value.clientWidth, canvas.value.clientHeight, false)
  scene.add(new THREE.HemisphereLight(0xe4edff, 0x55515a, 2))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(4, 8, 6)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9dbaff, 0.8)
  fill.position.set(-5, 3, -4)
  scene.add(fill)
  const grid = new THREE.GridHelper(20, 20, 0x858b98, 0x454a55)
  grid.position.y = -0.002
  scene.add(grid)
  controls = new OrbitControls(camera, canvas.value)
  controls.enableDamping = true
  resizeObserver = new ResizeObserver(() => {
    if (!canvas.value || !renderer || !camera) return
    const w = Math.max(1, canvas.value.clientWidth)
    const h = Math.max(1, canvas.value.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(canvas.value)
  const animate = () => {
    frame = requestAnimationFrame(animate)
    controls?.update()
    if (previewPlaying.value) previewMixer?.update(Math.min(previewClock.getDelta(), 0.1))
    if (scene && camera && renderer) renderer.render(scene, camera)
  }
  animate()
  if (model.value) {
    scene.add(model.value)
    fitCamera(model.value)
  }
}

function centerAndMeasure(object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) throw new Error('O arquivo não contém uma malha 3D visível.')
  const size = bounds.getSize(new THREE.Vector3())
  if (![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x, size.y, size.z) <= 0) {
    throw new Error('Não foi possível calcular o tamanho deste modelo.')
  }
  dimensions.value = [size.x, size.y, size.z]
  originalHeight.value = size.y
  // Guarde o centro em coordenadas do modelo. A correção de posição precisa
  // ser aplicada depois da escala; alterar position antes da escala deixa o
  // deslocamento enorme em assets cujas coordenadas originais são muito grandes.
  const center = bounds.getCenter(new THREE.Vector3())
  object.userData.importCenter = center.toArray()
  return size.y
}

async function parseFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'glb' && ext !== 'gltf') {
    return await loadAssetFile(file)
  }
  const buffer = await file.arrayBuffer()
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader()
    const url = URL.createObjectURL(file)
    currentObjectUrl = url
    return await new Promise<THREE.Object3D>((resolve, reject) => {
      loader.parse(buffer, url.substring(0, url.lastIndexOf('/') + 1), gltf => {
        // GLTFLoader mantém as animações separadas da hierarquia da cena; guarde-as
        // no root para transferi-las junto com o modelo ao confirmar a importação.
        gltf.scene.userData.importAnimations = gltf.animations ?? []
        // Preserve metadata from the original glTF JSON so we can distinguish
        // an embedded image from a texture actually assigned to baseColorTexture.
        gltf.scene.userData.importGltfMetadata = {
          images: (gltf.parser.json.images ?? []).map((image: { name?: string; mimeType?: string; uri?: string; bufferView?: number }, index: number) => ({
            index,
            name: image.name ?? '',
            mimeType: image.mimeType ?? '',
            uri: image.uri ?? '',
            bufferView: image.bufferView ?? null,
          })),
          textures: (gltf.parser.json.textures ?? []).map((texture: { name?: string; source?: number }, index: number) => ({
            index,
            name: texture.name ?? '',
            source: texture.source ?? null,
          })),
          materials: (gltf.parser.json.materials ?? []).map((material: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index?: number }; baseColorFactor?: number[] }; normalTexture?: { index?: number }; occlusionTexture?: { index?: number }; emissiveTexture?: { index?: number } }, index: number) => ({
            index,
            name: material.name ?? '',
            baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
            normalTexture: material.normalTexture?.index ?? null,
            occlusionTexture: material.occlusionTexture?.index ?? null,
            emissiveTexture: material.emissiveTexture?.index ?? null,
            baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
          })),
          animations: (gltf.parser.json.animations ?? []).map((clip: { name?: string; channels?: unknown[] }, index: number) => ({
            index,
            name: clip.name ?? '',
            channels: clip.channels?.length ?? 0,
          })),
        }
        resolve(gltf.scene)
      }, reject)
    })
  }
  throw new Error('Não foi possível interpretar o arquivo GLB/glTF.')
}

async function showLoadedModel(loaded: THREE.Object3D, displayName: string) {
  clearLoadedModel()
  colliderType.value = 'box'
  colliderOffset.value = [0, 0, 0]
  loaded.name = displayName.replace(/\.[^.]+$/, '') || 'Modelo importado'
  componentName.value = loaded.name
  partSearch.value = ''
  const height = centerAndMeasure(loaded)
  const initialScale = 2 / height
  loaded.scale.setScalar(initialScale)
  const center = new THREE.Vector3().fromArray(loaded.userData.importCenter as [number, number, number])
  loaded.position.set(-center.x * initialScale, -center.y * initialScale, -center.z * initialScale)
  loaded.updateMatrixWorld(true)
  modelHeight.value = 2
  colliderSize.value = [Math.max(0.05, dimensions.value[0] * 2 / height), 2, Math.max(0.05, dimensions.value[2] * 2 / height)]
  controlBindings.value = normalizeControlBindings(loaded.userData.importControlBindings)
  loaded.userData.importControlBindings = { ...controlBindings.value }
  model.value = loaded
  refreshPreviewParts()
  refreshModelDiagnostics()
  const clips = loaded.userData.importAnimations as THREE.AnimationClip[] | undefined
  animationClipRevision.value += 1
  rigBones.value = []
  rigRestPose.value = {}
  selectedRigBoneName.value = ''
  rigKeyframes.value = []
  rigFrameTime.value = 0
  rigDuration.value = 1
  rigMessage.value = ''
  const savedRoles = loaded.userData.importAnimationRoles as Record<string, AnimationRole> | undefined
  const nextRoles: Record<string, AnimationRole> = {}
  ;(clips ?? []).forEach((clip, index) => {
    const savedRole = savedRoles?.[String(index)]
    const guessed = guessedAnimationRole(clip.name)
    const guessedIsDiagonal = ['walk_diagonal_left', 'walk_diagonal_right', 'run_diagonal_left', 'run_diagonal_right'].includes(guessed)
    const recognizedRoles: AnimationRole[] = animationRoleBaseOptions.map(option => option.value)
    // Atualiza classificações automáticas antigas que guardaram um papel genérico.
    nextRoles[String(index)] = savedRole && recognizedRoles.includes(savedRole) && !(guessedIsDiagonal && ['ignore', 'walk', 'run'].includes(savedRole))
      ? savedRole
      : guessed
  })
  animationRoles.value = nextRoles
  loaded.userData.importAnimationRoles = { ...nextRoles }
  previewAnimationIndex.value = 0
  previewPlaying.value = true
  if (clips?.length) {
    previewMixer = new THREE.AnimationMixer(loaded)
    previewMixer.clipAction(clips[0]!).reset().play()
    previewClock.start()
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  initPreview()
  if (!scene) throw new Error('Não foi possível iniciar a pré-visualização 3D.')
  scene.add(loaded)
  fitCamera(loaded)
  updateColliderPreview()
}

async function parseGlbBytes(bytes: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader()
  return await new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(bytes, '', (gltf) => {
      gltf.scene.userData.importAnimations = gltf.animations ?? []
      gltf.scene.userData.importGltfMetadata = {
        images: (gltf.parser.json.images ?? []).map((image: { name?: string; mimeType?: string; uri?: string; bufferView?: number }, index: number) => ({
          index, name: image.name ?? '', mimeType: image.mimeType ?? '', uri: image.uri ?? '', bufferView: image.bufferView ?? null,
        })),
        textures: (gltf.parser.json.textures ?? []).map((texture: { name?: string; source?: number }, index: number) => ({
          index, name: texture.name ?? '', source: texture.source ?? null,
        })),
        materials: (gltf.parser.json.materials ?? []).map((material: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index?: number }; baseColorFactor?: number[] }; normalTexture?: { index?: number }; occlusionTexture?: { index?: number }; emissiveTexture?: { index?: number } }, index: number) => ({
          index, name: material.name ?? '',
          baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
          normalTexture: material.normalTexture?.index ?? null,
          occlusionTexture: material.occlusionTexture?.index ?? null,
          emissiveTexture: material.emissiveTexture?.index ?? null,
          baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
        })),
        animations: (gltf.parser.json.animations ?? []).map((clip: { name?: string; channels?: unknown[] }, index: number) => ({
          index, name: clip.name ?? '', channels: clip.channels?.length ?? 0,
        })),
      }
      resolve(gltf.scene)
    }, reject)
  })
}

async function importBlendZip() {
  loading.value = true
  error.value = ''
  try {
    // O seletor nativo e o comando Rust só existem dentro do aplicativo Tauri.
    // Em `npm run dev` aberto no navegador, evite chamar invoke sem runtime nativo.
    if (!isTauri()) {
      error.value = 'A importação por ZIP requer o aplicativo desktop Tauri. Execute `npm run tauri dev` e abra o Engine Prometheus pela janela do aplicativo. Para testar pelo navegador, selecione diretamente um arquivo GLB.'
      return
    }
    const selected = await openNativeDialog({
      multiple: false,
      directory: false,
      title: 'Selecionar ZIP com modelo glTF e texturas',
      filters: [{ name: 'Arquivo ZIP', extensions: ['zip'] }],
    })
    if (!selected || Array.isArray(selected)) return
    fileName.value = selected.split(/[\\/]/).pop() || 'Modelo glTF.zip'
    const jsonText = await invoke<string>('load_gltf_zip', { zipPath: selected })
    const loader = new GLTFLoader()
    const loaded = await new Promise<THREE.Object3D>((resolve, reject) => {
      loader.parse(jsonText, '', (gltf) => {
        gltf.scene.userData.importAnimations = gltf.animations ?? []
        gltf.scene.userData.importGltfMetadata = {
          images: (gltf.parser.json.images ?? []).map((image: { name?: string; mimeType?: string; uri?: string; bufferView?: number }, index: number) => ({
            index, name: image.name ?? '', mimeType: image.mimeType ?? '', uri: image.uri ?? '', bufferView: image.bufferView ?? null,
          })),
          textures: (gltf.parser.json.textures ?? []).map((texture: { name?: string; source?: number }, index: number) => ({
            index, name: texture.name ?? '', source: texture.source ?? null,
          })),
          materials: (gltf.parser.json.materials ?? []).map((material: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index?: number }; baseColorFactor?: number[] }; normalTexture?: { index?: number }; occlusionTexture?: { index?: number }; emissiveTexture?: { index?: number } }, index: number) => ({
            index, name: material.name ?? '',
            baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
            normalTexture: material.normalTexture?.index ?? null,
            occlusionTexture: material.occlusionTexture?.index ?? null,
            emissiveTexture: material.emissiveTexture?.index ?? null,
            baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
          })),
          animations: (gltf.parser.json.animations ?? []).map((clip: { name?: string; channels?: unknown[] }, index: number) => ({
            index, name: clip.name ?? '', channels: clip.channels?.length ?? 0,
          })),
        }
        resolve(gltf.scene)
      }, reject)
    })
    await showLoadedModel(loaded, fileName.value.replace(/\\.zip$/i, '.gltf'))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e || 'Falha ao carregar glTF do ZIP.')
    fileName.value = ''
    clearLoadedModel()
  } finally {
    loading.value = false
  }
}
async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  loading.value = true
  error.value = ''
  fileName.value = file.name
  try {
    const loaded = await parseFile(file)
    await showLoadedModel(loaded, file.name)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Falha ao ler o modelo.'
    fileName.value = ''
    clearLoadedModel()
  } finally {
    loading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    window.addEventListener('keydown', captureControlBindingKey, true)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    initPreview()
    if (props.initialAsset) {
      loading.value = true
      try {
        const loaded = await parseGlbBytes(props.initialAsset.bytes.slice(0))
        loaded.userData.importAnimationRoles = props.initialAsset.animationRoles
        loaded.userData.importControlBindings = props.initialAsset.controlBindings
        fileName.value = props.initialAsset.name
        await showLoadedModel(loaded, props.initialAsset.name)
      } catch (e) {
        error.value = e instanceof Error ? e.message : 'Não foi possível abrir o componente para pré-visualização.'
      } finally { loading.value = false }
    }
  } else {
    window.removeEventListener('keydown', captureControlBindingKey, true)
    listeningForBinding.value = null
    disposePreview()
    error.value = ''
  }
})

function selectPreviewAnimation(index: number) {
  previewAnimationIndex.value = index
  if (!previewMixer || !model.value) return
  previewMixer.stopAllAction()
  const clip = previewAnimations.value[index]
  if (!clip) return
  previewMixer.clipAction(clip).reset().play()
  previewPlaying.value = true
  previewClock.start()
}

function togglePreviewAnimationPlayback() {
  if (!previewAnimations.value.length) return
  previewPlaying.value = !previewPlaying.value
  if (previewPlaying.value) previewClock.start()
}

watch(modelHeight, (height, previousHeight) => {
  if (!model.value || !Number.isFinite(height) || height <= 0 || originalHeight.value <= 0) return
  const targetScale = height / originalHeight.value
  model.value.scale.setScalar(targetScale)
  const centerData = model.value.userData.importCenter as [number, number, number] | undefined
  if (centerData && centerData.length === 3) {
    model.value.position.set(
      -centerData[0] * targetScale,
      -centerData[1] * targetScale,
      -centerData[2] * targetScale,
    )
  }
  model.value.updateMatrixWorld(true)
  fitCamera(model.value)
  const factor = height / Math.max(0.1, previousHeight)
  colliderSize.value = colliderSize.value.map(value => Math.max(0.05, value * factor)) as [number, number, number]
  updateColliderPreview()
})

async function useAsPlayerModel() {
  const root = model.value
  if (!root || loading.value) return
  loading.value = true
  error.value = ''
  try {
    let bytes: ArrayBuffer
    if (props.initialAsset) {
      // Prévia de componente salvo: reutiliza o GLB exato, sem reexportar o ativo.
      bytes = props.initialAsset.bytes.slice(0)
    } else {
      // Exporta o modelo inteiro com as animações e os papéis configurados no workspace.
      // SkeletonUtils mantém os bones ligados corretamente durante a exportação.
      const exportRoot = cloneSkinnedModel(root)
      exportRoot.userData = { ...exportRoot.userData }
      for (const key of [
        'importAnimations', 'importGltfMetadata', 'importRecoveredTextures',
        'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl',
        'importAnimationRoles', 'importControlBindings',
        'importRigPreset', 'importRigGenerated', 'importRigBoneNames',
      ]) {
        delete exportRoot.userData[key]
      }
      exportRoot.updateMatrixWorld(true)
      const exporter = new GLTFExporter()
      const clips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
      const exported = await exporter.parseAsync(exportRoot, { binary: true, animations: clips })
      if (!(exported instanceof ArrayBuffer)) throw new Error('O exportador não gerou um arquivo GLB válido.')
      bytes = exported
    }

    const name = props.initialAsset?.name || fileName.value || root.name || 'Jogador'
    emit('use-player', { name, bytes, animationRoles: { ...animationRoles.value } })
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error
      ? `Não foi possível usar este ativo como jogador: ${cause.message}`
      : 'Não foi possível exportar o modelo para o jogador.'
  } finally {
    loading.value = false
  }
}

function confirmImport() {
  if (!model.value || !fileName.value) return
  const root = model.value
  const chosenPart = selectedPartId.value ? findPreviewPart(selectedPartId.value) : undefined
  const chosenName = componentName.value.trim() || chosenPart?.name || root.name.trim() || 'Modelo 3D'
  let imported: THREE.Object3D
  let importedHeight = modelHeight.value

  if (chosenPart && chosenPart.object !== root) {
    // Clona somente o nó selecionado e preserva seu transform relativo à raiz.
    // Isso permite importar uma árvore/grupo sem carregar o restante da floresta.
    root.updateMatrixWorld(true)
    const relativeMatrix = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(chosenPart.object.matrixWorld)
    imported = chosenPart.object.clone(true)
    imported.matrix.copy(relativeMatrix)
    imported.matrix.decompose(imported.position, imported.quaternion, imported.scale)
    imported.matrixAutoUpdate = true
    imported.name = chosenPart.name
    const bounds = new THREE.Box3().setFromObject(imported)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) {
      error.value = 'Não foi possível calcular o tamanho da parte selecionada.'
      return
    }
    imported.position.sub(center)
    const scale = modelHeight.value / size.y
    imported.scale.multiplyScalar(scale)
    imported.position.multiplyScalar(scale)
    imported.userData.importAnimations = root.userData.importAnimations ?? []
    imported.userData.importGltfMetadata = root.userData.importGltfMetadata
    importedHeight = modelHeight.value
  } else {
    imported = root
  }

  imported.userData.importColliderType = colliderType.value
  imported.userData.importColliderSize = [...colliderSize.value]
  imported.userData.importColliderOffset = [...colliderOffset.value]
  imported.userData.importAnimationRoles = { ...animationRoles.value }
  imported.userData.importControlBindings = { ...controlBindings.value }

  // A animação da prévia não deve continuar ativa depois que o motor assumir o modelo.
  previewMixer?.stopAllAction()
  previewMixer = null
  scene?.remove(root)
  model.value = null
  emit('import', { name: chosenName, model: imported, height: importedHeight })
  emit('close')
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', captureControlBindingKey, true)
  disposePreview()
})
</script>

<template>
  <div v-if="open" class="model-import-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="model-import-dialog" role="dialog" aria-modal="true" aria-labelledby="model-import-title">
      <header class="model-import-header">
        <div class="model-import-brand"><span class="model-import-brand-icon">P</span><div><span class="model-import-kicker">ENGINE PROMETHEUS / MODEL WORKSPACE</span><h2 id="model-import-title">Configurar modelo 3D</h2></div></div>
        <div class="model-import-header-status"><span class="model-import-status-dot" :class="{ ready: !!model, busy: loading }"></span>{{ loading ? 'Processando arquivo…' : model ? 'Prévia pronta' : 'Aguardando arquivo' }}</div>
        <button class="model-import-close" aria-label="Fechar" title="Fechar janela" @click="emit('close')">×</button>
      </header>

      <div class="model-import-toolbar">
        <div class="model-import-toolbar-group">
          <button class="model-toolbar-button model-toolbar-primary" :disabled="loading" @click="fileInput?.click()"><span>＋</span> Abrir arquivo</button>
          <button class="model-toolbar-button" :disabled="loading" @click="importBlendZip"><span>▤</span> Importar pacote ZIP</button>
          <input ref="fileInput" class="model-file-input" type="file" accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.dae,.3ds,.png,.jpg,.jpeg,.webp,.svg" @change="chooseFile" />
        </div>
        <div class="model-import-toolbar-file"><span class="toolbar-file-dot"></span><span>{{ fileName || 'Nenhum arquivo selecionado' }}</span></div>
      </div>

      <nav class="model-import-tabs" aria-label="Configuração do modelo">
        <button
          v-for="tab in setupTabs"
          :key="tab.id"
          type="button"
          class="model-import-tab"
          :class="{ active: activeSetupTab === tab.id }"
          :disabled="!model && tab.id !== 'model' && tab.id !== 'technical'"
          @click="activeSetupTab = tab.id"
        >
          <strong>{{ tab.label }}</strong><small>{{ tab.description }}</small>
        </button>
      </nav>

      <div class="model-import-workspace">
        <aside class="model-import-left-panel">
          <section class="model-panel-section">
            <div class="model-panel-heading"><span>01</span> ORIGEM DO ATIVO</div>
            <button class="model-file-dropzone" :disabled="loading" @click="fileInput?.click()">
              <span class="model-dropzone-icon">↥</span><strong>Selecionar arquivo</strong><small>Escolha um arquivo no seu computador</small>
              <span class="model-dropzone-formats">3D · GLB · GLTF · FBX · OBJ · STL · PLY · DAE · 3DS</span>
              <span class="model-dropzone-formats">2D · PNG · JPG · WEBP · SVG</span>
            </button>
            <p class="model-panel-hint">Para glTF com arquivos dependentes, use um ZIP contendo o .gltf, .bin e as texturas.</p>
          </section>
          <div class="model-panel-separator"></div>
          <section class="model-panel-section model-hierarchy-section">
            <div class="model-panel-heading"><span>02</span> HIERARQUIA <b>{{ previewParts.length }}</b></div>
            <p class="model-panel-hint">Escolha a casa, castelo ou grupo que deseja transformar em componente. Sem uma parte selecionada, o modelo inteiro será salvo.</p>
            <label class="model-part-search">FILTRAR HIERARQUIA
              <input v-model="partSearch" type="search" placeholder="Ex.: castelo, casa, taverna" :disabled="!previewParts.length" />
            </label>
            <div v-if="filteredPreviewParts.length" class="model-preview-parts">
              <div v-for="(part, index) in filteredPreviewParts" :key="part.id" class="model-preview-part" :class="{ 'is-selected': selectedPartId === part.id }" :style="{ paddingLeft: (5 + Math.min(part.depth, 5) * 8) + 'px' }">
                <button class="model-preview-part-select" :title="`Selecionar ${part.name}`" @click="selectPreviewPart(part)">
                  <span class="model-preview-part-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="model-tree-cube">◇</span>
                  <span class="model-preview-part-name" :title="part.name">{{ part.name }}</span>
                  <small>{{ part.meshCount }}</small>
                </button>
                <button class="model-preview-part-eye" :aria-label="`Mostrar ou ocultar ${part.name}`" :title="part.object.visible ? 'Ocultar parte' : 'Mostrar parte'" @click="togglePreviewPart(part)">{{ part.object.visible ? '◉' : '○' }}</button>
                <button class="model-preview-part-solo" :class="{ active: soloPartId === part.id }" :aria-label="`Visualizar somente ${part.name}`" title="Isolar parte" @click="showOnlyPreviewPart(part)">1×</button>
                <button class="model-preview-part-delete" :aria-label="`Remover ${part.name} da importação`" title="Remover parte" @click="deletePreviewPart(part)">×</button>
              </div>
              <button class="model-preview-show-all" @click="selectWholeModel">Selecionar modelo inteiro</button>
              <button class="model-preview-show-all" @click="restorePreviewVisibility">Mostrar todas as partes na prévia</button>
            </div>
            <div v-else-if="previewParts.length" class="model-hierarchy-empty"><span>⌕</span><p>Nenhuma parte encontrada</p><small>Tente outro nome ou apague o filtro.</small></div>
            <div v-else class="model-hierarchy-empty"><span>◇</span><p>Nenhuma malha carregada</p><small>A hierarquia aparecerá aqui após abrir um modelo.</small></div>
          </section>
        </aside>

        <main class="model-import-center-panel">
          <div class="model-viewport-topline"><span><i></i> VIEWPORT DE PRÉ-VISUALIZAÇÃO</span><span>PERSP · 3D</span></div>
          <div class="model-import-preview">
            <canvas ref="canvas" />
            <div v-if="!model && !loading" class="model-import-empty">
              <span class="upload-glyph">◇</span><strong>Seu ativo começa aqui</strong><small>Abra um modelo 3D ou uma imagem 2D para visualizar</small>
              <button class="model-import-primary" @click="fileInput?.click()">Abrir arquivo</button>
            </div>
            <div v-if="loading" class="model-import-loading"><span class="model-loading-spinner"></span><strong>Preparando pré-visualização</strong><small>Carregando geometria, materiais e texturas</small></div>
            <div class="preview-badge"><span class="model-live-dot"></span> LIVE PREVIEW</div>
            <div v-if="model && previewAnimations.length" class="preview-animation-controls">
              <label>ANIMAÇÃO
                <select :value="previewAnimationIndex" @change="selectPreviewAnimation(Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="(clip, index) in previewAnimations" :key="index" :value="index">{{ clip.name || ('Animação ' + (index + 1)) }} · {{ clip.duration.toFixed(2) }}s</option>
                </select>
              </label>
              <button @click="togglePreviewAnimationPlayback">{{ previewPlaying ? 'Ⅱ Pausar' : '▶ Reproduzir' }}</button>
            </div>
            <div v-else-if="model" class="preview-animation-empty">Este modelo não contém animações embutidas.</div>
            <div v-if="model" class="preview-dimensions">X {{ dimensions[0].toFixed(2) }} <b>·</b> Y {{ modelHeight.toFixed(2) }} <b>·</b> Z {{ dimensions[2].toFixed(2) }} <small>unidades</small></div>
            <div class="model-viewport-controls"><span>BOTÃO ESQUERDO · ORBITAR</span><span>SCROLL · ZOOM</span></div>
          </div>
          <div class="model-viewport-statusbar"><span><i></i> {{ model ? (model.name || 'Modelo carregado') : 'Viewport inativo' }}</span><span>{{ diagnosticSummary.meshes }} malhas <b>·</b> {{ diagnosticSummary.materials }} materiais <b>·</b> {{ diagnosticSummary.clips }} animações</span></div>
        </main>

        <aside class="model-import-right-panel">
          <section v-if="activeSetupTab === 'controls'" class="model-panel-section model-controls-section">
            <div class="model-panel-heading"><span>02</span> MAPA DE CONTROLES</div>
            <p class="model-panel-hint">Clique em uma tecla e pressione a nova combinação. Estas teclas são salvas junto ao modelo e serão usadas quando o componente receber o pacote de comportamento <strong>Montaria</strong>.</p>
            <div class="model-control-bindings">
              <div v-for="binding in controlBindingFields" :key="binding.key" class="model-control-row">
                <div class="model-control-copy">
                  <strong>{{ binding.label }}</strong>
                  <small>{{ binding.description }}</small>
                </div>
                <button
                  type="button"
                  class="model-control-key"
                  :class="{ listening: listeningForBinding === binding.key }"
                  :disabled="!model || !!props.initialAsset"
                  @click="startControlBindingCapture(binding.key)"
                >{{ listeningForBinding === binding.key ? 'Pressione…' : formatControlKey(controlBindings[binding.key]) }}</button>
              </div>
            </div>
            <p v-if="listeningForBinding" class="model-control-capture-tip">Aguardando tecla para “{{ controlBindingFields.find(item => item.key === listeningForBinding)?.label }}”. Pressione Esc para cancelar.</p>
            <p class="model-control-note">Padrão: W/A/S/D movimentam, Shift corre, Espaço pula e E interage. As setas continuam aceitas para movimento. A tecla de interação também é usada para desmontar.</p>
            <button type="button" class="model-control-reset" :disabled="!model || !!props.initialAsset" @click="resetControlBindings">Restaurar teclas padrão</button>
          </section>

          <section v-if="activeSetupTab === 'animations'" class="model-panel-section model-animation-section">
            <div class="model-panel-heading"><span>03</span> MAPEAMENTO DE ANIMAÇÕES <b>{{ previewAnimations.length }}</b></div>
            <p class="model-panel-hint">Associe cada clipe a uma função do motor. Selecione “Prévia” para testar o clipe no viewport antes de salvar.</p>
            <div v-if="previewAnimations.length" class="model-animation-mapping-list">
              <article v-for="(clip, index) in previewAnimations" :key="index" class="model-animation-map-row" :class="{ active: previewAnimationIndex === index }">
                <div class="model-animation-map-head">
                  <strong :title="clip.name || ('Animação ' + (index + 1))">{{ clip.name || ('Animação ' + (index + 1)) }}</strong>
                  <small>{{ clip.duration.toFixed(2) }} s</small>
                </div>
                <select
                  :value="animationRoles[String(index)] ?? 'ignore'"
                  :disabled="!!props.initialAsset"
                  :aria-label="'Função para ' + (clip.name || ('Animação ' + (index + 1)))"
                  @change="setAnimationRole(index, ($event.target as HTMLSelectElement).value as AnimationRole)"
                >
                  <option v-for="role in animationRoleOptions" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
                <button type="button" @click="selectPreviewAnimation(index)">▶ Prévia deste clipe</button>
              </article>
            </div>
            <div v-else class="model-setup-empty">
              <strong>Nenhuma animação encontrada</strong>
              <small>O arquivo precisa conter clipes de animação para configurar movimento automaticamente.</small>
            </div>
            <p class="model-control-note">As funções acompanham o mapa de controles ativo: movimento, caminhada lenta, postura, esquiva, rolamento, interação e ações de inventário/itens/habilidades. A tecla atual aparece ao lado do papel. Câmera e sair do jogo não acionam animações do personagem.</p>
          </section>

          <section v-if="activeSetupTab === 'rigging'" class="model-panel-section model-rigging-section">
            <div class="model-panel-heading"><span>04</span> RIGGING E ANIMAÇÃO POR OSSOS <b>{{ rigBones.length }}</b></div>
            <p class="model-panel-hint">Crie um esqueleto para modelos estáticos ou use os ossos de um modelo que já seja rigado. Depois ajuste a pose dos ossos e grave quadros-chave em tempos diferentes.</p>
            <label class="model-rigging-field">Modelo de rig
              <select v-model="rigPreset" :disabled="!model || !!props.initialAsset || loading">
                <option v-for="option in rigPresetOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <button type="button" class="model-rigging-primary" :disabled="!model || !!props.initialAsset || loading" @click="createRig">
              {{ rigBones.length ? 'Recriar / detectar rig' : 'Criar rig automático' }}
            </button>
            <p class="model-control-note">Quadrúpede pressupõe a cabeça voltada para +Z. O rig automático e os pesos de vértices são um ponto de partida: modelos complexos podem exigir ajustes ou um rig preparado externamente.</p>

            <template v-if="rigBones.length">
              <div class="model-rigging-summary">
                <span><small>OSSOS</small><strong>{{ rigBones.length }}</strong></span>
                <span><small>QUADROS</small><strong>{{ rigKeyframes.length }}</strong></span>
                <span><small>CLIPES</small><strong>{{ previewAnimations.length }}</strong></span>
              </div>

              <label class="model-rigging-field">Osso selecionado
                <select v-model="selectedRigBoneName">
                  <option v-for="bone in rigBones" :key="bone.uuid" :value="bone.name">{{ bone.name }}</option>
                </select>
              </label>
              <div v-if="selectedRigBone" class="model-rigging-rotation">
                <div class="model-rigging-subtitle">ROTAÇÃO LOCAL · GRAUS</div>
                <label>X<input v-model.number="boneRotationDraft.x" type="number" step="5" @change="applySelectedBoneRotation" /></label>
                <label>Y<input v-model.number="boneRotationDraft.y" type="number" step="5" @change="applySelectedBoneRotation" /></label>
                <label>Z<input v-model.number="boneRotationDraft.z" type="number" step="5" @change="applySelectedBoneRotation" /></label>
              </div>
              <button type="button" class="model-rigging-secondary" @click="resetRigPose">Restaurar pose inicial</button>
              <div class="model-rigging-separator"></div>

              <div class="model-rigging-subtitle">LINHA DO TEMPO</div>
              <label class="model-rigging-field">Tempo do quadro (segundos)
                <input :value="rigFrameTime" type="number" min="0" max="120" step="0.1" @change="setRigTime(Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label class="model-rigging-field">Duração do clipe (segundos)
                <input v-model.number="rigDuration" type="number" min="0.1" max="120" step="0.1" />
              </label>
              <button type="button" class="model-rigging-primary" @click="recordRigKeyframe">＋ Gravar pose neste tempo</button>
              <div v-if="rigKeyframes.length" class="model-rigging-frames">
                <button v-for="frame in rigKeyframes" :key="frame.time" type="button" @click="applyRigFrame(frame)" :class="{ active: Math.abs(rigFrameTime - frame.time) < 0.001 }">
                  <strong>{{ frame.time.toFixed(2) }} s</strong><span>Aplicar pose</span>
                </button>
              </div>
              <p class="model-control-note">Exemplo: grave uma pose em 0 s, gire os ossos, mude para 0,5 s e grave outra. O motor interpola entre as poses.</p>

              <div class="model-rigging-separator"></div>
              <div class="model-rigging-subtitle">SALVAR COMO NOVA ANIMAÇÃO</div>
              <label class="model-rigging-field">Nome
                <input v-model.trim="rigClipName" maxlength="80" placeholder="Ex.: Montar cavalo" />
              </label>
              <label class="model-rigging-field">Papel no jogo
                <select v-model="rigClipRole">
                  <option v-for="role in animationRoleBaseOptions.filter(option => option.value !== 'ignore')" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
              </label>
              <button type="button" class="model-rigging-primary" :disabled="rigKeyframes.length < 2 || !!props.initialAsset" @click="createRigAnimation">Criar clipe de animação</button>
              <button type="button" class="model-rigging-secondary" @click="clearRigKeyframesForNewClip">Nova animação / limpar quadros</button>
              <p class="model-control-note">Para sincronizar a montagem, crie um clipe com o papel “Montar / subir” no jogador e outro com o mesmo papel no cavalo. O pacote Montaria dispara os dois quando o jogador monta.</p>
              <p v-if="rigMessage" class="model-rigging-status">{{ rigMessage }}</p>
            </template>
            <div v-else class="model-setup-empty">
              <strong>Nenhum rig carregado</strong>
              <small>Escolha Humanoide, Quadrúpede ou Corrente genérica e crie o rig. Se o modelo já tiver um esqueleto glTF, a ferramenta detectará os ossos existentes.</small>
            </div>
          </section>

          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>04</span> NOME DO COMPONENTE</div>
            <label class="model-component-name-field">Nome na biblioteca
              <input v-model.trim="componentName" maxlength="80" placeholder="Ex.: Taverna medieval" :disabled="!model || !!props.initialAsset" />
            </label>
            <p class="model-panel-hint">Esse nome será usado na biblioteca e nas novas cópias colocadas no mundo.</p>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>05</span> TRANSFORMAÇÃO</div>
            <label class="model-height-label"><span>Altura final</span><strong>{{ modelHeight.toFixed(2) }} <small>u</small></strong></label>
            <input v-model.number="modelHeight" class="model-height-slider" type="range" min="0.1" max="10" step="0.1" :disabled="!model" />
            <div class="model-height-presets"><button v-for="size in [0.5, 1, 1.8, 2, 3, 5]" :key="size" :class="{ active: Math.abs(modelHeight - size) < 0.05 }" :disabled="!model" @click="modelHeight = size">{{ size }}u</button></div>
            <div class="model-import-dimensions">
              <div><small>LARGURA X</small><strong>{{ previewComponentDimensions.x ? previewComponentDimensions.x.toFixed(2) : '—' }}</strong></div>
              <div><small>ALTURA Y</small><strong>{{ model ? previewComponentDimensions.y.toFixed(2) : '—' }}</strong></div>
              <div><small>PROF. Z</small><strong>{{ previewComponentDimensions.z ? previewComponentDimensions.z.toFixed(2) : '—' }}</strong></div>
            </div>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section model-collider-section">
            <div class="model-panel-heading"><span>06</span> COLISOR FÍSICO</div>
            <p class="model-collider-help">Ajuste a área que bloqueia outros objetos. O modelo visual não será redimensionado. O contorno verde mostra a colisão antes de importar.</p>
            <label class="model-collider-field">Forma
              <select :value="colliderType" :disabled="!model" @change="changeColliderType(($event.target as HTMLSelectElement).value as 'box' | 'sphere' | 'capsule' | 'none')">
                <option value="box">Caixa</option>
                <option value="sphere">Esfera</option>
                <option value="capsule">Cápsula</option>
                <option value="none">Sem colisão</option>
              </select>
            </label>
            <div class="model-collider-subtitle">{{ colliderType === 'sphere' ? 'DIÂMETRO DA ESFERA (raio = metade)' : 'DIMENSÕES DO COLISOR' }}</div>
            <div class="model-collider-grid">
              <label>{{ colliderType === 'sphere' ? 'Diâmetro X' : 'Largura X' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[0]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 0, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>{{ colliderType === 'sphere' ? 'Diâmetro Y' : 'Altura Y' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[1]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 1, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>{{ colliderType === 'sphere' ? 'Diâmetro Z' : 'Prof. Z' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[2]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 2, Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
            <div class="model-collider-subtitle">DESLOCAMENTO RELATIVO AO CENTRO DO MODELO</div>
            <div class="model-collider-grid">
              <label>X<input type="number" step="0.1" :value="colliderOffset[0]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 0, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>Y<input type="number" step="0.1" :value="colliderOffset[1]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 1, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>Z<input type="number" step="0.1" :value="colliderOffset[2]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 2, Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
            <p class="model-collider-example">Exemplo: para uma esfera de raio 0,5, informe 1,0 nos três diâmetros. Em uma árvore, ajuste o deslocamento Y para posicionar a esfera no tronco.</p>
          </section>
          <div v-if="activeSetupTab === 'technical'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'technical'" class="model-panel-section">
            <div class="model-panel-heading"><span>01</span> INFORMAÇÕES DO ARQUIVO</div>
            <div class="model-asset-info-row"><span>Arquivo</span><strong :title="fileName">{{ fileName || '—' }}</strong></div>
            <div class="model-asset-info-row"><span>Tipo</span><strong>{{ fileName ? (fileName.split('.').pop() || '—').toUpperCase() : '—' }}</strong></div>
            <div class="model-asset-info-row"><span>Geometria</span><strong>{{ diagnosticSummary.meshes }} malhas</strong></div>
            <div class="model-asset-info-row"><span>Materiais</span><strong>{{ diagnosticSummary.materials }}</strong></div>
            <div class="model-asset-info-row"><span>Texturas</span><strong>{{ diagnosticSummary.textures }}</strong></div>
            <div class="model-asset-info-row"><span>Animações</span><strong>{{ diagnosticSummary.clips }}</strong></div>
          </section>
          <div v-if="activeSetupTab === 'technical'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'technical'" class="model-panel-section model-diagnostic-section">
            <div class="model-panel-heading"><span>02</span> DIAGNÓSTICO E TEXTURAS</div>
                      <details class="model-diagnostics">
            <summary>DIAGNÓSTICO TÉCNICO DO MODELO</summary>
            <div class="model-diagnostics-summary">
              <span>Nós <b>{{ diagnosticSummary.nodes }}</b></span>
              <span>Malhas <b>{{ diagnosticSummary.meshes }}</b></span>
              <span>Skinned <b>{{ diagnosticSummary.skinned }}</b></span>
              <span>Materiais <b>{{ diagnosticSummary.materials }}</b></span>
              <span>Texturas <b>{{ diagnosticSummary.textures }}</b></span>
              <span>Animações <b>{{ diagnosticSummary.clips }}</b></span>
            </div>
            <p class="model-diagnostics-hint">URI data: indica imagem incorporada no JSON; URI externa indica arquivo referenciado. Imagens presentes no ZIP só serão usadas como cor se algum material as referenciar em baseColorTexture.</p>
            <div v-if="model" class="model-diagnostics-list">
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>GLTF</b><span>Imagens e texturas declaradas no arquivo</span></div>
                <template v-for="image in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.images ?? [])" :key="'image-' + image.index">
                  <small>Imagem {{ image.index }}: {{ image.name || '(sem nome)' }} · {{ image.mimeType || (image.uri.startsWith('data:') ? (image.uri.slice(5, image.uri.indexOf(';')) || 'tipo não declarado') : 'tipo não declarado') }} · {{ image.uri.startsWith('data:') ? 'incorporada (data URI)' : image.uri ? 'URI externa' : image.bufferView !== null ? 'incorporada por bufferView' : 'origem não identificada' }}</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.images?.length)">Nenhuma imagem declarada no JSON glTF.</small>
              </div>
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>MAPAS</b><span>Associação original de texturas por material</span></div>
                <template v-for="material in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.materials ?? [])" :key="'material-' + material.index">
                  <small>{{ material.name || ('Material ' + material.index) }}: cor={{ material.baseColorTexture ?? (((model.userData.importRecoveredColorTextures as Record<string, number> | undefined)?.[String(material.index)] !== undefined) ? 'imagem recuperada ' + (model.userData.importRecoveredColorTextures as Record<string, number>)[String(material.index)] : 'nenhuma') }}, normal={{ material.normalTexture ?? 'nenhuma' }}, oclusão={{ material.occlusionTexture ?? 'nenhuma' }}, emissiva={{ material.emissiveTexture ?? 'nenhuma' }}{{ material.baseColorFactor ? ', fator=' + material.baseColorFactor.join('/') : '' }}</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.materials?.length)">Nenhum material declarado no JSON glTF.</small>
              </div>
              <div v-if="materialsMissingColorTexture.length && recoverableColorImages.length" class="model-diagnostic-row model-texture-repair">
                <div class="model-diagnostic-title"><b>RECUPERAÇÃO</b><span>Aplicar imagem como cor principal</span></div>
                <p>O glTF não associa imagens à cor principal de alguns materiais. Selecione uma imagem para testar no material; os mapas normais e de oclusão serão mantidos.</p>
                <div v-for="material in materialsMissingColorTexture" :key="'repair-' + material.index" class="model-texture-repair-item">
                  <label :for="'repair-image-' + material.index">{{ material.name || ('Material ' + material.index) }}</label>
                  <select :id="'repair-image-' + material.index" v-model="textureRepairSelections[String(material.index)]" :disabled="textureRepairBusy">
                    <option value="">Selecionar imagem…</option>
                    <option v-for="image in recoverableColorImages" :key="image.index" :value="String(image.index)">Imagem {{ image.index }} · {{ image.mimeType || 'imagem' }}</option>
                  </select>
                  <button type="button" :disabled="textureRepairBusy || !textureRepairSelections[String(material.index)]" @click="applyRecoveredColorTexture(material.index)">{{ textureRepairBusy ? 'Aplicando…' : 'Aplicar textura' }}</button>
                </div>
                <small v-if="textureRepairMessage" class="model-texture-repair-message">{{ textureRepairMessage }}</small>
              </div>
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>CLIPS</b><span>Clipes de animação originais</span></div>
                <template v-for="clip in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.animations ?? [])" :key="'clip-' + clip.index">
                  <small>{{ clip.name || ('Animação ' + clip.index) }} · {{ clip.channels }} canais</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.animations?.length)">Nenhuma animação declarada no JSON glTF.</small>
              </div>
            </div>
            <div v-if="modelDiagnostics.length" class="model-diagnostics-list">
              <div v-for="item in modelDiagnostics" :key="item.id" class="model-diagnostic-row">
                <div class="model-diagnostic-title" :style="{ paddingLeft: (item.depth * 10) + 'px' }">
                  <b>{{ item.type }}</b><span>{{ item.name }}</span>
                </div>
                <small v-if="item.meshInfo">{{ item.meshInfo }}</small>
                <small v-if="item.materials">{{ item.materials }}</small>
              </div>
            </div>
          </details>
          </section>
          <p v-if="error" class="model-import-error">{{ error }}</p>
          <p class="model-import-tip">{{ props.initialAsset ? 'Modo de pré-visualização: explore as abas, os clipes e os controles salvos. Nenhuma alteração será aplicada ao mundo.' : 'Configure o modelo, os controles e os clipes. A prévia não altera o mundo; salvar cria um componente reutilizável na biblioteca.' }}</p>
        </aside>
      </div>

      <footer class="model-import-footer">
        <div class="model-footer-state"><span class="model-import-status-dot" :class="{ ready: !!model, busy: loading }"></span><span>{{ props.initialAsset ? 'Pré-visualização do componente' : model ? 'Componente pronto para salvar' : loading ? 'Carregando ativo…' : 'Nenhum ativo selecionado' }}</span></div>
        <div class="model-footer-actions"><button class="model-import-secondary" @click="emit('close')">{{ props.initialAsset ? 'Fechar prévia' : 'Cancelar' }}</button><button v-if="model" class="model-import-secondary" :disabled="loading" @click="useAsPlayerModel">Usar como jogador</button><button v-if="!props.initialAsset" class="model-import-primary" :disabled="!model || loading || !componentName.trim()" @click="confirmImport"><span>＋</span> Salvar componente</button></div>
      </footer>
    </section>
  </div>
</template>

<style>
.model-import-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:18px;background:#090b0ff0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e5e7eb}
.model-import-dialog{display:flex;flex-direction:column;width:min(1500px,98vw);height:min(900px,96vh);min-height:540px;overflow:hidden;border:1px solid #343944;border-radius:8px;background:#17191e;box-shadow:0 30px 100px #000b}
.model-import-tabs{display:flex;gap:5px;padding:7px 12px;border-bottom:1px solid #30343c;background:#191c22;overflow-x:auto;flex:none}.model-import-tab{display:flex;flex-direction:column;gap:3px;min-width:112px;padding:7px 10px;border:1px solid #363c47;border-radius:4px;background:#20242b;color:#cbd1db;text-align:left;cursor:pointer}.model-import-tab strong{font-size:10px;font-weight:700}.model-import-tab small{color:#8d96a4;font-size:8px;white-space:nowrap}.model-import-tab.active{border-color:#9b704d;background:#3a2c22;color:#ffe0c3}.model-import-tab.active small{color:#c9a17c}.model-import-tab:disabled{opacity:.4;cursor:not-allowed}
.model-control-bindings{display:flex;flex-direction:column;gap:6px;margin-top:12px}.model-control-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px;border:1px solid #343943;border-radius:4px;background:#202329}.model-control-copy{display:flex;flex-direction:column;gap:4px;min-width:0}.model-control-copy strong{color:#e0e4eb;font-size:10px;font-weight:650}.model-control-copy small{color:#8f98a6;font-size:8px;line-height:1.4}.model-control-key{flex:none;min-width:76px;padding:8px;border:1px solid #6c543e;border-radius:4px;background:#33271e;color:#f5c79a;font:700 10px ui-monospace,monospace;cursor:pointer}.model-control-key.listening{border-color:#d19a64;background:#59412b;color:#fff0dd;animation:model-key-pulse 1s ease-in-out infinite alternate}.model-control-key:disabled{opacity:.5;cursor:not-allowed}.model-control-capture-tip{padding:8px;border:1px solid #805b3d;border-radius:4px;background:#30251e;color:#ffd9b5;font-size:9px;line-height:1.5}.model-control-note{margin:10px 0;color:#949dab;font-size:9px;line-height:1.6}.model-control-reset{width:100%;padding:8px;border:1px solid #424752;border-radius:4px;background:#252932;color:#d1d5dd;font-size:9px;cursor:pointer}.model-control-reset:disabled{opacity:.45;cursor:not-allowed}
.model-animation-mapping-list{display:flex;flex-direction:column;gap:7px;margin-top:12px}.model-animation-map-row{padding:8px;border:1px solid #343943;border-radius:4px;background:#202329}.model-animation-map-row.active{border-color:#9b704d;background:#2b251f}.model-animation-map-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px}.model-animation-map-head strong{overflow:hidden;color:#e0e4eb;font-size:10px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.model-animation-map-head small{flex:none;color:#999fac;font:9px ui-monospace,monospace}.model-animation-map-row select{width:100%;padding:7px;border:1px solid #414752;border-radius:4px;background:#191c22;color:#e7e9ef;font-size:9px}.model-animation-map-row select:disabled{opacity:.55}.model-animation-map-row button{width:100%;margin-top:6px;padding:7px;border:1px solid #414752;border-radius:4px;background:#292d35;color:#d4dae3;font-size:9px;cursor:pointer}.model-animation-map-row button:hover{border-color:#9b704d;background:#3a2c22}.model-setup-empty{display:flex;flex-direction:column;gap:6px;padding:20px 10px;border:1px dashed #414752;border-radius:4px;color:#a8b0bd;text-align:center}.model-setup-empty strong{font-size:10px}.model-setup-empty small{font-size:9px;line-height:1.5;color:#858f9e}@keyframes model-key-pulse{from{box-shadow:0 0 0 0 #d19a6430}to{box-shadow:0 0 0 3px #d19a6440}}

.model-import-header{display:flex;align-items:center;gap:20px;padding:13px 18px;border-bottom:1px solid #30343c;background:#1b1e24}
.model-import-brand{display:flex;align-items:center;gap:11px;min-width:0;flex:1}.model-import-brand-icon{display:grid;place-items:center;width:34px;height:34px;border:1px solid #805b3d;border-radius:5px;background:#30251e;color:#e0a36b;font-weight:800;font-size:19px}
.model-import-kicker{display:block;color:#bd8a60;font-size:9px;font-weight:750;letter-spacing:.15em}.model-import-header h2{margin:4px 0 0;font-size:17px;line-height:1.2;font-weight:650;letter-spacing:-.02em}
.model-import-header-status{display:flex;align-items:center;gap:8px;color:#9da4b0;font-size:10px}.model-import-status-dot,.toolbar-file-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#626a77}.model-import-status-dot.ready,.toolbar-file-dot{background:#80b89b}.model-import-status-dot.busy{background:#d5a46e;box-shadow:0 0 0 3px #d5a46e20}
.model-import-close{width:29px;height:29px;border:1px solid #3c414b;border-radius:4px;background:#252931;color:#aeb5c1;font-size:21px;cursor:pointer}.model-import-close:hover{background:#353a44;color:#fff}
.model-import-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:7px 14px;border-bottom:1px solid #30343c;background:#202329}.model-import-toolbar-group{display:flex;gap:7px}.model-toolbar-button{display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #414650;border-radius:4px;background:#292d35;color:#d5d9e1;font-size:10px;cursor:pointer}.model-toolbar-button span{color:#d4a171;font-size:14px}.model-toolbar-button:hover{background:#353a43}.model-toolbar-button:disabled{opacity:.45;cursor:wait}.model-toolbar-primary{border-color:#9b704d;background:#493526;color:#ffe0c3}.model-import-toolbar-file{display:flex;align-items:center;gap:8px;max-width:45%;overflow:hidden;color:#9fa7b4;font-size:10px}.model-import-toolbar-file span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.model-import-workspace{display:grid;grid-template-columns:245px minmax(300px,1fr) 275px;flex:1;min-height:0;overflow:hidden}
.model-import-left-panel{min-width:0;overflow:auto;background:#1b1e24;scrollbar-color:#414650 #1b1e24;scrollbar-width:thin}
.model-collider-section{display:flex;flex-direction:column;gap:9px}
.model-collider-help,.model-collider-example{margin:0;color:#9ca5b3;font-size:10px;line-height:1.5}
.model-collider-field{display:flex;flex-direction:column;gap:5px;color:#aeb6c4;font-size:10px}
.model-collider-field select,.model-collider-grid input{width:100%;min-width:0;box-sizing:border-box;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;padding:7px 6px;font:11px ui-monospace,monospace}
.model-collider-subtitle{color:#c69b75;font-size:9px;font-weight:750;letter-spacing:.08em;margin-top:3px}
.model-collider-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.model-collider-grid label{display:flex;flex-direction:column;gap:5px;color:#aeb6c4;font-size:9px;min-width:0}
.model-collider-grid input{padding:7px 4px}
.model-collider-grid input:disabled,.model-collider-field select:disabled{opacity:.45}
.model-import-right-panel{min-width:0;overflow:auto;background:#1b1e24;scrollbar-color:#414650 #1b1e24;scrollbar-width:thin}.model-import-left-panel{border-right:1px solid #30343c}.model-import-right-panel{border-left:1px solid #30343c}.model-panel-section{padding:15px 13px}.model-panel-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px;color:#c8cdd6;font-size:9px;font-weight:800;letter-spacing:.09em}.model-panel-heading>span{color:#bd8a60;font:10px ui-monospace,monospace}.model-panel-heading>b{display:grid;place-items:center;min-width:19px;height:17px;margin-left:auto;padding:0 5px;border-radius:3px;background:#30343d;color:#d8dce4;font-size:9px}.model-panel-separator{height:1px;background:#30343c}.model-panel-hint{margin:9px 0 0;color:#818a98;font-size:9px;line-height:1.65}
.model-file-input{display:none}.model-file-dropzone{display:flex;flex-direction:column;align-items:flex-start;gap:7px;width:100%;padding:13px 10px;border:1px dashed #4a505c;border-radius:5px;background:#20242b;color:#d9dde5;text-align:left;cursor:pointer}.model-file-dropzone:hover{border-color:#b98255;background:#29251f}.model-file-dropzone:disabled{opacity:.5;cursor:wait}.model-dropzone-icon{display:grid;place-items:center;width:28px;height:28px;border:1px solid #66503c;border-radius:4px;background:#33271e;color:#e1aa78;font-size:19px}.model-file-dropzone strong{font-size:10px}.model-file-dropzone small{color:#929aa7;font-size:9px}.model-dropzone-formats{color:#b7bdc8;font-size:8px;line-height:1.5}.model-hierarchy-section{padding-top:14px}.model-preview-parts{display:flex;flex-direction:column;gap:3px;max-height:none;overflow:visible}.model-preview-part{display:flex;align-items:center;gap:2px;min-width:0;padding:3px;border:1px solid transparent;border-radius:3px;background:transparent}.model-preview-part:hover{background:#252930}.model-preview-part.is-selected{border-color:#805b3d;background:#34291f}.model-preview-part-select{display:flex;align-items:center;gap:5px;flex:1;min-width:0;padding:4px 2px;border:0;background:transparent;color:#d5dae3;text-align:left;cursor:pointer}.model-preview-part-index{color:#727c8b;font:8px ui-monospace,monospace}.model-tree-cube{color:#d4a171;font-size:12px}.model-preview-part-name{flex:1;min-width:0;overflow:hidden;color:#cfd4de;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.model-preview-part-select small{flex:none;color:#8d96a5;font-size:8px}.model-preview-part-eye,.model-preview-part-solo{width:20px;height:21px;flex:none;border:1px solid #3b414b;border-radius:3px;background:#262a31;color:#b8c0cc;font-size:9px;cursor:pointer}.model-preview-part-solo.active{border-color:#ba8759;color:#f3c79f}.model-preview-part-delete{width:19px;height:21px;flex:none;border:1px solid transparent;border-radius:3px;background:transparent;color:#a77c78;font-size:15px;line-height:1;cursor:pointer}.model-preview-part-delete:hover{border-color:#6a3936;background:#3c2525;color:#ffb7ad}.model-preview-show-all{width:100%;margin-top:8px;padding:7px;border:1px solid #3c424d;border-radius:3px;background:#272b33;color:#c5cbd5;font-size:9px;cursor:pointer}.model-hierarchy-empty{display:flex;flex-direction:column;align-items:center;padding:24px 10px;text-align:center;color:#697382}.model-hierarchy-empty>span{font-size:25px;color:#4d5664}.model-hierarchy-empty p{margin:8px 0 4px;color:#aab1bd;font-size:10px}.model-hierarchy-empty small{font-size:9px;line-height:1.5}
.model-import-center-panel{display:flex;flex-direction:column;min-width:0;min-height:0;background:#13151a}.model-viewport-topline,.model-viewport-statusbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:31px;padding:0 12px;background:#1b1e24;color:#87909e;font:8px ui-monospace,monospace;letter-spacing:.07em}.model-viewport-topline{border-bottom:1px solid #2b3038}.model-viewport-topline span:first-child,.model-viewport-statusbar span:first-child{display:flex;align-items:center;gap:7px}.model-viewport-topline i,.model-viewport-statusbar i{width:5px;height:5px;border-radius:50%;background:#bd8a60}.model-viewport-statusbar{border-top:1px solid #2b3038;letter-spacing:0}.model-viewport-statusbar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-viewport-statusbar span:last-child{color:#8d96a4}.model-viewport-statusbar b{color:#555e6b}
.model-import-preview{position:relative;flex:1;min-height:280px;overflow:hidden;background-color:#171a20;background-image:radial-gradient(#343943 0.7px,transparent .7px);background-size:18px 18px}.model-import-preview canvas{display:block;width:100%;height:100%;min-height:280px;outline:0}.model-import-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:#171a20b8;pointer-events:none}.model-import-empty button{pointer-events:auto}.upload-glyph{display:grid;place-items:center;width:53px;height:53px;border:1px solid #555d6b;border-radius:9px;background:#22262e;color:#d7a06d;font-size:30px}.model-import-empty strong{font-size:14px;font-weight:600;color:#e1e4ea}.model-import-empty small{color:#929aa8;font-size:10px}.model-import-empty .model-import-primary{margin-top:4px}.preview-animation-controls{position:absolute;top:10px;right:10px;display:flex;align-items:flex-end;gap:6px;padding:7px;border:1px solid #414752;border-radius:4px;background:#1b1e24ed}.preview-animation-controls label{display:flex;flex-direction:column;gap:4px;color:#d4a171;font:8px ui-monospace,monospace;letter-spacing:.06em}.preview-animation-controls select{max-width:210px;padding:6px;border:1px solid #414752;border-radius:3px;background:#252932;color:#e0e4eb;font-size:9px}.preview-animation-controls button{padding:6px 8px;border:1px solid #9b704d;border-radius:3px;background:#493526;color:#ffe0c3;font-size:9px;cursor:pointer}.preview-animation-empty{position:absolute;top:10px;right:10px;padding:7px;border:1px solid #414752;border-radius:4px;background:#1b1e24ed;color:#aeb5c1;font-size:9px}.preview-badge{position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid #414752;border-radius:3px;background:#1b1e24e8;color:#c2c9d4;font:8px ui-monospace,monospace;letter-spacing:.1em;pointer-events:none}.model-live-dot{width:5px;height:5px;border-radius:50%;background:#82bd9c}.preview-dimensions{position:absolute;bottom:35px;left:12px;padding:7px 9px;border:1px solid #414752;border-radius:3px;background:#1b1e24ed;color:#e0e4eb;font:9px ui-monospace,monospace;pointer-events:none}.preview-dimensions b{color:#606a78}.preview-dimensions small{margin-left:4px;color:#8d96a4;font-size:8px}.model-viewport-controls{position:absolute;right:10px;bottom:10px;display:flex;gap:10px;color:#7e8795;font:7px ui-monospace,monospace;pointer-events:none}.model-import-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;background:#13151aeb;color:#e2e5ec;font-size:12px}.model-import-loading small{color:#8f98a6;font-size:9px}.model-loading-spinner{width:25px;height:25px;border:2px solid #414752;border-top-color:#d4a171;border-radius:50%;animation:model-import-spin .8s linear infinite}@keyframes model-import-spin{to{transform:rotate(360deg)}}
.model-rigging-field{display:flex;flex-direction:column;gap:5px;margin-top:9px;color:#aeb6c4;font-size:10px}.model-rigging-field input,.model-rigging-field select{width:100%;box-sizing:border-box;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;padding:8px;font:10px Inter,ui-sans-serif,system-ui,sans-serif}.model-rigging-primary,.model-rigging-secondary{width:100%;margin-top:8px;padding:8px;border:1px solid #9b704d;border-radius:4px;background:#493526;color:#ffe0c3;font-size:10px;font-weight:650;cursor:pointer}.model-rigging-secondary{border-color:#424752;background:#252932;color:#d1d5dd}.model-rigging-primary:disabled,.model-rigging-secondary:disabled{opacity:.45;cursor:not-allowed}.model-rigging-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:11px}.model-rigging-summary span{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid #343943;border-radius:4px;background:#202329}.model-rigging-summary small{color:#8f98a6;font-size:8px}.model-rigging-summary strong{color:#e2ad7c;font:600 14px ui-monospace,monospace}.model-rigging-rotation{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:10px}.model-rigging-subtitle{grid-column:1/-1;margin-top:8px;color:#c69b75;font-size:9px;font-weight:750;letter-spacing:.08em}.model-rigging-rotation label{display:flex;flex-direction:column;gap:4px;color:#aeb6c4;font-size:9px}.model-rigging-rotation input{min-width:0;width:100%;box-sizing:border-box;padding:7px 4px;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;font:10px ui-monospace,monospace}.model-rigging-frames{display:flex;flex-direction:column;gap:4px;margin-top:8px}.model-rigging-frames button{display:flex;justify-content:space-between;gap:8px;padding:7px;border:1px solid #343943;border-radius:4px;background:#202329;color:#d1d5dd;font-size:9px;cursor:pointer}.model-rigging-frames button.active{border-color:#9b704d;background:#34291f}.model-rigging-frames span{color:#999fac}.model-rigging-separator{height:1px;margin:13px 0;background:#30343c}.model-rigging-status{padding:8px;border:1px solid #4d4538;border-radius:4px;background:#28251f;color:#e2c7a9;font-size:9px;line-height:1.5;overflow-wrap:anywhere}
.model-import-right-panel .model-panel-section{padding:15px 13px}.model-height-label{display:flex;align-items:center;justify-content:space-between;color:#c4cad4;font-size:10px}.model-height-label strong{color:#e2ad7c;font:600 15px ui-monospace,monospace}.model-height-label strong small{font-size:9px;color:#9a8068}.model-height-slider{width:100%;margin:17px 0 13px;accent-color:#cb925e;cursor:pointer}.model-height-slider:disabled{opacity:.4}.model-height-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.model-height-presets button{padding:7px 2px;border:1px solid #3c424c;border-radius:3px;background:#252931;color:#b9c0cb;font-size:9px;cursor:pointer}.model-height-presets button.active{border-color:#9b704d;background:#3a2c22;color:#f2c79f}.model-height-presets button:disabled{opacity:.4;cursor:default}.model-import-dimensions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:15px}.model-import-dimensions>div{display:flex;flex-direction:column;gap:7px;padding:8px 5px;border:1px solid #343943;border-radius:3px;background:#202329;min-width:0}.model-import-dimensions small{font-size:7px;color:#8c95a3;letter-spacing:.04em}.model-import-dimensions strong{overflow:hidden;font:600 11px ui-monospace,monospace;color:#e0e4eb;text-overflow:ellipsis}.model-asset-info-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #2b3038;color:#8f98a6;font-size:9px}.model-asset-info-row:last-child{border-bottom:0}.model-asset-info-row strong{max-width:65%;overflow:hidden;color:#cbd1db;font-size:9px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.model-import-error{margin:10px;padding:9px;border:1px solid #743d3a;border-radius:4px;background:#3a2526;color:#ffb6ae;font-size:10px;line-height:1.5;overflow-wrap:anywhere}.model-import-tip{margin:0 13px 14px;color:#7f8997;font-size:9px;line-height:1.6}
.model-diagnostics{margin:0;border:1px solid #343943;border-radius:4px;background:#202329;padding:9px}.model-diagnostics summary{cursor:pointer;color:#c6cbd4;font-size:9px;font-weight:800;letter-spacing:.06em}.model-diagnostics-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:10px}.model-diagnostics-summary span{display:flex;justify-content:space-between;gap:4px;padding:5px;background:#292d35;border-radius:3px;color:#9da5b2;font-size:9px}.model-diagnostics-summary b{color:#f1bd85}.model-diagnostics-hint{color:#929aa8;font-size:9px;line-height:1.5}.model-diagnostics-list{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto}.model-texture-repair p{margin:7px 0;color:#929aa8;font-size:9px;line-height:1.5}.model-texture-repair-item{display:grid;grid-template-columns:1fr;gap:5px;margin-top:8px;padding:7px;border:1px solid #343943;border-radius:4px;background:#20232a}.model-texture-repair-item label{color:#dce0e8;font-size:9px}.model-texture-repair-item select{width:100%;padding:7px;border:1px solid #414752;border-radius:4px;background:#191c22;color:#e7e9ef;font-size:10px}.model-texture-repair-item button{padding:7px;border:1px solid #a66e3d;border-radius:4px;background:#3d3025;color:#ffd2a3;font-size:10px;cursor:pointer}.model-texture-repair-item button:disabled{opacity:.45;cursor:wait}.model-texture-repair-message{display:block;margin-top:8px;color:#d9b58f;font-size:9px;line-height:1.5}.model-diagnostic-row{padding:6px;border:1px solid #343943;border-radius:3px;background:#191c22}.model-diagnostic-title{display:flex;gap:6px;min-width:0;align-items:center}.model-diagnostic-title b{flex:none;color:#d49b62;font-size:8px}.model-diagnostic-title span{overflow:hidden;color:#dce0e8;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.model-diagnostic-row small{display:block;margin-top:4px;color:#929aa8;font-size:8px;line-height:1.45;overflow-wrap:anywhere}
.model-import-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:9px 16px;border-top:1px solid #343944;background:#1d2026;color:#969eac;font-size:10px}.model-footer-state{display:flex;align-items:center;gap:8px}.model-footer-actions{display:flex;gap:8px}.model-import-primary,.model-import-secondary{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 13px;border-radius:4px;font-size:10px;font-weight:650;cursor:pointer}.model-import-primary{border:1px solid #d19a64;background:#d19a64;color:#211911}.model-import-primary:hover:not(:disabled){background:#e0ad7d}.model-import-primary:disabled{opacity:.4;cursor:not-allowed}.model-import-secondary{border:1px solid #424752;background:#252932;color:#d1d5dd}.model-import-secondary:hover{background:#333842}
@media(max-width:1000px){.model-import-workspace{grid-template-columns:210px minmax(250px,1fr) 240px}.model-import-dialog{width:99vw}.model-panel-section{padding:12px 10px}.model-import-right-panel .model-panel-section{padding:12px 10px}}
@media(max-width:760px){.model-import-backdrop{padding:5px}.model-import-dialog{height:98vh;max-height:98vh;min-height:0;width:100%;border-radius:5px}.model-import-tabs{padding:6px;gap:4px}.model-import-tab{min-width:94px;padding:6px 8px}.model-import-header{padding:10px}.model-import-header-status{display:none}.model-import-toolbar{align-items:flex-start;flex-direction:column;padding:8px}.model-import-toolbar-file{max-width:100%;width:100%}.model-import-workspace{display:flex;flex-direction:column;overflow:auto}.model-import-center-panel{order:0;min-height:340px;flex:none}.model-import-preview{min-height:280px;flex:none}.model-import-preview canvas{height:280px;min-height:280px}.model-import-left-panel{order:1;overflow:visible;border-right:0;border-bottom:1px solid #30343c}.model-import-right-panel{order:2;overflow:visible;border-left:0}.model-hierarchy-section .model-preview-parts{max-height:230px;overflow:auto}.model-viewport-statusbar span:last-child{display:none}.model-import-footer{align-items:center;padding:8px;min-height:50px}.model-footer-state{font-size:9px}.model-footer-actions{gap:5px}.model-import-primary,.model-import-secondary{padding:8px;font-size:9px}}
@media(prefers-reduced-motion:reduce){.model-loading-spinner{animation:none}}
.model-part-search{display:flex;flex-direction:column;gap:5px;margin:10px 0;color:#9ca5b3;font-size:8px;font-weight:750;letter-spacing:.08em}.model-part-search input,.model-component-name-field input{box-sizing:border-box;width:100%;min-width:0;padding:8px 9px;border:1px solid #3a414d;border-radius:4px;background:#20242c;color:#e3e7ee;font:11px Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:0}.model-part-search input:focus,.model-component-name-field input:focus{outline:1px solid #b98255;border-color:#b98255}.model-preview-parts{max-height:360px!important;overflow:auto!important;padding-right:2px}.model-preview-show-all{margin-top:6px}
.model-component-name-field{display:flex;flex-direction:column;gap:6px;color:#aeb6c4;font-size:10px}
</style>
