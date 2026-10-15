<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  import: [payload: { name: string; model: THREE.Object3D; height: number }]
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
const previewParts = shallowRef<Array<{ id: string; name: string; object: THREE.Mesh }>>([])

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
const textureRepairSelections = ref<Record<string, string>>({})
const textureRepairBusy = ref(false)
const textureRepairMessage = ref('')
const gltfMetadata = computed(() => model.value?.userData.importGltfMetadata as GltfMetadata | undefined)
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
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach((material) => {
      // Texturas podem ser compartilhadas entre materiais; dispose do material
      // libera seus recursos sem alterar os dados do modelo importado na cena.
      material.dispose()
    })
  })
}

function refreshPreviewParts() {
  if (!model.value) {
    previewParts.value = []
    return
  }
  const parts: Array<{ id: string; name: string; object: THREE.Mesh }> = []
  let index = 0
  model.value.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    index += 1
    parts.push({
      id: child.uuid,
      name: child.name.trim() || `Parte ${index}`,
      object: child,
    })
  })
  previewParts.value = parts
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

function deletePreviewPart(part: { id: string; name: string; object: THREE.Mesh }) {
  if (!model.value || !part.object.parent) return
  // Apenas desanexa a malha da hierarquia. Não destrua geometria, materiais,
  // morph targets ou clips: o mixer continua ligado à raiz e às partes restantes.
  part.object.removeFromParent()
  model.value.updateMatrixWorld(true)
  refreshPreviewParts()
  refreshModelDiagnostics()
  if (model.value) fitCamera(model.value)
}

function clearLoadedModel() {
  previewParts.value = []
  previewMixer?.stopAllAction()
  previewMixer = null
  if (model.value) {
    scene?.remove(model.value)
    const recoveredTextures = model.value.userData.importRecoveredTextures as THREE.Texture[] | undefined
    recoveredTextures?.forEach(texture => texture.dispose())
    disposeModel(model.value)
  }
  model.value = null
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
    previewMixer?.update(Math.min(previewClock.getDelta(), 0.1))
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
          images: (gltf.parser.json.images ?? []).map((image, index) => ({
            index,
            name: image.name ?? '',
            mimeType: image.mimeType ?? '',
            uri: image.uri ?? '',
            bufferView: image.bufferView ?? null,
          })),
          textures: (gltf.parser.json.textures ?? []).map((texture, index) => ({
            index,
            name: texture.name ?? '',
            source: texture.source ?? null,
          })),
          materials: (gltf.parser.json.materials ?? []).map((material, index) => ({
            index,
            name: material.name ?? '',
            baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
            normalTexture: material.normalTexture?.index ?? null,
            occlusionTexture: material.occlusionTexture?.index ?? null,
            emissiveTexture: material.emissiveTexture?.index ?? null,
            baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
          })),
          animations: (gltf.parser.json.animations ?? []).map((clip, index) => ({
            index,
            name: clip.name ?? '',
            channels: clip.channels?.length ?? 0,
          })),
        }
        resolve(gltf.scene)
      }, reject)
    })
  }
  if (ext === 'obj') return new OBJLoader().parse(new TextDecoder().decode(buffer))
  if (ext === 'stl') {
    const geometry = new STLLoader().parse(buffer)
    geometry.computeVertexNormals()
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb7c0ce, metalness: 0.12, roughness: 0.68 }))
  }
  if (ext === 'fbx') return new FBXLoader().parse(buffer, '')
  throw new Error('Formato não suportado. Escolha GLB, glTF, OBJ, STL ou FBX.')
}

async function showLoadedModel(loaded: THREE.Object3D, displayName: string) {
  clearLoadedModel()
  loaded.name = displayName.replace(/\.[^.]+$/, '') || 'Modelo importado'
  const height = centerAndMeasure(loaded)
  const initialScale = 2 / height
  loaded.scale.setScalar(initialScale)
  const center = new THREE.Vector3().fromArray(loaded.userData.importCenter as [number, number, number])
  loaded.position.set(-center.x * initialScale, -center.y * initialScale, -center.z * initialScale)
  loaded.updateMatrixWorld(true)
  modelHeight.value = 2
  model.value = loaded
  refreshPreviewParts()
  refreshModelDiagnostics()
  const clips = loaded.userData.importAnimations as THREE.AnimationClip[] | undefined
  if (clips?.length) {
    previewMixer = new THREE.AnimationMixer(loaded)
    for (const clip of clips) previewMixer.clipAction(clip).play()
    previewClock.start()
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  initPreview()
  if (!scene) throw new Error('Não foi possível iniciar a pré-visualização 3D.')
  scene.add(loaded)
  fitCamera(loaded)
}

async function parseGlbBytes(bytes: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader()
  return await new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(bytes, '', (gltf) => {
      gltf.scene.userData.importAnimations = gltf.animations ?? []
      gltf.scene.userData.importGltfMetadata = {
        images: (gltf.parser.json.images ?? []).map((image, index) => ({
          index, name: image.name ?? '', mimeType: image.mimeType ?? '', uri: image.uri ?? '', bufferView: image.bufferView ?? null,
        })),
        textures: (gltf.parser.json.textures ?? []).map((texture, index) => ({
          index, name: texture.name ?? '', source: texture.source ?? null,
        })),
        materials: (gltf.parser.json.materials ?? []).map((material, index) => ({
          index, name: material.name ?? '',
          baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
          normalTexture: material.normalTexture?.index ?? null,
          occlusionTexture: material.occlusionTexture?.index ?? null,
          emissiveTexture: material.emissiveTexture?.index ?? null,
          baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
        })),
        animations: (gltf.parser.json.animations ?? []).map((clip, index) => ({
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
          images: (gltf.parser.json.images ?? []).map((image, index) => ({
            index, name: image.name ?? '', mimeType: image.mimeType ?? '', uri: image.uri ?? '', bufferView: image.bufferView ?? null,
          })),
          textures: (gltf.parser.json.textures ?? []).map((texture, index) => ({
            index, name: texture.name ?? '', source: texture.source ?? null,
          })),
          materials: (gltf.parser.json.materials ?? []).map((material, index) => ({
            index, name: material.name ?? '',
            baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
            normalTexture: material.normalTexture?.index ?? null,
            occlusionTexture: material.occlusionTexture?.index ?? null,
            emissiveTexture: material.emissiveTexture?.index ?? null,
            baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
          })),
          animations: (gltf.parser.json.animations ?? []).map((clip, index) => ({
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
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    initPreview()
  } else {
    disposePreview()
    error.value = ''
  }
})

watch(modelHeight, (height) => {
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
})

function confirmImport() {
  if (!model.value || !fileName.value) return
  const imported = model.value
  // A animação da prévia não deve continuar ativa depois que o motor assumir o modelo.
  previewMixer?.stopAllAction()
  previewMixer = null
  // Remove do preview sem destruir a geometria: ela será usada pelo mundo.
  scene?.remove(imported)
  model.value = null
  emit('import', { name: imported.name || 'Modelo importado', model: imported, height: modelHeight.value })
  emit('close')
}

onBeforeUnmount(disposePreview)
</script>

<template>
  <div v-if="open" class="model-import-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="model-import-dialog" role="dialog" aria-modal="true" aria-labelledby="model-import-title">
      <header class="model-import-header">
        <div><span class="model-import-kicker">ASSET WORKSHOP</span><h2 id="model-import-title">Importar modelo 3D</h2><p>Visualize, ajuste o tamanho e adicione à cena.</p></div>
        <button class="model-import-close" aria-label="Fechar" @click="emit('close')">×</button>
      </header>
      <div class="model-import-body">
        <div class="model-import-preview">
          <canvas ref="canvas" />
          <div v-if="!model && !loading" class="model-import-empty">
            <span class="upload-glyph">⇧</span><strong>Pré-visualização do modelo</strong><small>Selecione um arquivo para visualizar em 3D</small>
            <button class="model-import-primary" @click="fileInput?.click()">Escolher modelo</button>
          </div>
          <div v-if="loading" class="model-import-loading">Carregando modelo…</div>
          <div class="preview-badge">PREVIEW · 3D</div>
          <div v-if="model" class="preview-dimensions">X {{ dimensions[0].toFixed(2) }} · Y {{ modelHeight.toFixed(2) }} · Z {{ dimensions[2].toFixed(2) }} u</div>
        </div>
        <aside class="model-import-settings">
          <div class="model-import-section-title">ARQUIVO</div>
          <button class="model-file-picker model-blend-zip-picker" :disabled="loading" @click="importBlendZip"><span class="file-icon">▣</span><span><strong>Importar ZIP com glTF</strong><small>.gltf + .bin + texturas</small></span><b>＋</b></button>
          <p class="model-import-note">Não precisa do Blender. O ZIP deve conter um arquivo .gltf e os arquivos .bin/texturas referenciados por ele.</p>
          <button class="model-file-picker" @click="fileInput?.click()"><span class="file-icon">▧</span><span><strong>{{ fileName || 'Selecionar arquivo' }}</strong><small>GLB · glTF · OBJ · STL · FBX</small></span><b>＋</b></button>
          <input ref="fileInput" class="model-file-input" type="file" accept=".glb,.gltf,.obj,.stl,.fbx" @change="chooseFile" />
          <p class="model-import-note">glTF com texturas externas pode exigir que os arquivos relacionados estejam acessíveis junto ao modelo.</p>
          <div class="model-import-divider"></div>
          <div class="model-import-section-title">DIMENSÕES DA PRÉVIA</div>
          <label class="model-height-label"><span>Altura final</span><strong>{{ modelHeight.toFixed(2) }} u</strong></label>
          <input v-model.number="modelHeight" class="model-height-slider" type="range" min="0.1" max="10" step="0.1" :disabled="!model" />
          <div class="model-height-presets"><button v-for="size in [0.5, 1, 1.8, 2, 3, 5]" :key="size" :class="{ active: Math.abs(modelHeight - size) < 0.05 }" :disabled="!model" @click="modelHeight = size">{{ size }} u</button></div>
          <div class="model-import-dimensions"><div><small>LARGURA X</small><strong>{{ dimensions[0] ? (dimensions[0] * modelHeight / 2).toFixed(2) : '—' }}</strong></div><div><small>ALTURA Y</small><strong>{{ model ? modelHeight.toFixed(2) : '—' }}</strong></div><div><small>PROF. Z</small><strong>{{ dimensions[2] ? (dimensions[2] * modelHeight / 2).toFixed(2) : '—' }}</strong></div></div>
          <div class="model-import-divider"></div>
          <div class="model-import-section-title">PARTES DO MODELO · {{ previewParts.length }}</div>
          <div v-if="previewParts.length" class="model-preview-parts">
            <div v-for="(part, index) in previewParts" :key="part.id" class="model-preview-part">
              <span class="model-preview-part-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="model-preview-part-name" :title="part.name">{{ part.name }}</span>
              <button class="model-preview-part-delete" :aria-label="`Apagar ${part.name} da prévia`" title="Apagar esta parte" @click="deletePreviewPart(part)">×</button>
            </div>
          </div>
          <p v-else class="model-preview-parts-empty">Carregue um modelo para listar as malhas. Apagar uma parte não desativa a animação das demais.</p>

          <div class="model-import-divider"></div>
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
          <p v-if="error" class="model-import-error">{{ error }}</p>
          <div class="model-import-tip">Dica: arraste sobre a prévia para orbitar e use a roda do mouse para aproximar.</div>
        </aside>
      </div>
      <footer class="model-import-footer"><span>{{ model ? 'Modelo pronto para importar' : 'Nenhum modelo carregado' }}</span><div><button class="model-import-secondary" @click="emit('close')">Cancelar</button><button class="model-import-primary" :disabled="!model || loading" @click="confirmImport">Importar para a cena</button></div></footer>
    </section>
  </div>
</template>

<style>
.model-import-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:22px;background:#080a0edb;backdrop-filter:blur(5px)}
.model-import-dialog{display:flex;flex-direction:column;width:min(1000px,96vw);max-height:min(760px,94vh);overflow:hidden;border:1px solid #414651;border-radius:9px;background:#191c22;color:#e7e9ef;box-shadow:0 24px 90px #000a;font-family:Inter,system-ui,sans-serif}
.model-import-header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #30343c}
.model-import-kicker{font-size:9px;letter-spacing:.16em;font-weight:800;color:#d49b62}.model-import-header h2{margin:5px 0 3px;font-size:20px;font-weight:650}.model-import-header p{margin:0;color:#929aa8;font-size:11px}
.model-import-close{width:32px;height:32px;border:1px solid #393e48;border-radius:5px;background:#252932;color:#bfc4ce;font-size:23px;cursor:pointer}
.model-import-body{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(260px,.8fr);gap:0;min-height:0;overflow:auto}
.model-import-preview{position:relative;min-height:390px;background:#20232a;border-right:1px solid #30343c;overflow:hidden}.model-import-preview canvas{display:block;width:100%;height:100%;min-height:390px;outline:0}.model-import-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;background:#20232ad9;pointer-events:none}.model-import-empty button{pointer-events:auto}.upload-glyph{display:grid;place-items:center;width:48px;height:48px;border:1px solid #515866;border-radius:10px;color:#d8a16a;font-size:30px}.model-import-empty strong{font-size:13px}.model-import-empty small{color:#9ca4b2;font-size:11px}.preview-badge{position:absolute;top:12px;left:12px;padding:6px 8px;border:1px solid #424853;border-radius:4px;background:#191c22d9;color:#c7ccd6;font-size:9px;letter-spacing:.1em}.preview-dimensions{position:absolute;bottom:12px;left:12px;padding:7px 9px;border:1px solid #424853;border-radius:4px;background:#191c22df;color:#e5e8ee;font:10px ui-monospace,monospace}.model-import-loading{position:absolute;inset:0;display:grid;place-items:center;background:#17191fdb;color:#f0c18f;font-size:13px}
.model-import-settings{padding:20px 18px;min-width:0}.model-import-section-title{margin-bottom:11px;color:#929aa8;font-size:9px;font-weight:800;letter-spacing:.13em}.model-file-picker{display:flex;align-items:center;gap:10px;width:100%;padding:11px;border:1px solid #414752;border-radius:5px;background:#252932;color:#e6e8ee;text-align:left;cursor:pointer}.file-icon{display:grid;place-items:center;width:31px;height:34px;border-radius:4px;background:#343943;color:#e4b17b;font-size:20px}.model-blend-zip-picker{margin-bottom:8px}.model-blend-zip-picker:disabled{opacity:.5;cursor:wait}.model-file-picker span:nth-child(2){display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}.model-file-picker strong{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.model-file-picker small{color:#9da5b2;font-size:9px}.model-file-picker>b{font-size:18px;color:#e4b17b}.model-file-input{display:none}.model-import-note{font-size:10px;line-height:1.6;color:#848d9b}.model-preview-parts{display:flex;flex-direction:column;gap:5px;max-height:190px;overflow:auto}.model-preview-part{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 7px;border:1px solid #343943;border-radius:4px;background:#20232a}.model-preview-part-index{color:#8d96a5;font:9px ui-monospace,monospace}.model-preview-part-name{flex:1;min-width:0;overflow:hidden;color:#dce0e8;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.model-preview-part-delete{width:23px;height:23px;flex:none;border:1px solid #63403c;border-radius:4px;background:#382725;color:#ffb4a9;font-size:17px;line-height:1;cursor:pointer}.model-preview-part-delete:hover{background:#63342e}.model-preview-parts-empty{color:#858e9d;font-size:10px;line-height:1.6}.model-import-divider{height:1px;margin:18px 0;border-top:1px solid #30343c}.model-diagnostics{margin-top:12px;border:1px solid #343943;border-radius:4px;background:#20232a;padding:9px}.model-diagnostics summary{cursor:pointer;color:#c6cbd4;font-size:9px;font-weight:800;letter-spacing:.08em}.model-diagnostics-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:10px}.model-diagnostics-summary span{display:flex;justify-content:space-between;gap:4px;padding:5px;background:#292d35;border-radius:3px;color:#9da5b2;font-size:9px}.model-diagnostics-summary b{color:#f1bd85}.model-diagnostics-hint{color:#929aa8;font-size:9px;line-height:1.5}.model-diagnostics-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto}.model-texture-repair p{margin:7px 0;color:#929aa8;font-size:9px;line-height:1.5}.model-texture-repair-item{display:grid;grid-template-columns:1fr;gap:5px;margin-top:8px;padding:7px;border:1px solid #343943;border-radius:4px;background:#20232a}.model-texture-repair-item label{color:#dce0e8;font-size:9px}.model-texture-repair-item select{width:100%;padding:7px;border:1px solid #414752;border-radius:4px;background:#191c22;color:#e7e9ef;font-size:10px}.model-texture-repair-item button{padding:7px;border:1px solid #a66e3d;border-radius:4px;background:#3d3025;color:#ffd2a3;font-size:10px;cursor:pointer}.model-texture-repair-item button:disabled{opacity:.45;cursor:wait}.model-texture-repair-message{display:block;margin-top:8px;color:#d9b58f;font-size:9px;line-height:1.5}.model-diagnostic-row{padding:6px;border:1px solid #343943;border-radius:3px;background:#191c22}.model-diagnostic-title{display:flex;gap:6px;min-width:0;align-items:center}.model-diagnostic-title b{flex:none;color:#d49b62;font-size:8px}.model-diagnostic-title span{overflow:hidden;color:#dce0e8;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.model-diagnostic-row small{display:block;margin-top:4px;color:#929aa8;font-size:8px;line-height:1.45;overflow-wrap:anywhere}.model-height-label{display:flex;align-items:center;justify-content:space-between;color:#c6cbd4;font-size:11px}.model-height-label strong{color:#f1bd85;font:600 12px ui-monospace,monospace}.model-height-slider{width:100%;margin:15px 0;accent-color:#cf8b4d}.model-height-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.model-height-presets button{padding:7px 3px;border:1px solid #3d424c;border-radius:4px;background:#252932;color:#bfc5d0;font-size:10px;cursor:pointer}.model-height-presets button.active{border-color:#a66e3d;background:#3d3025;color:#ffd2a3}.model-height-presets button:disabled{opacity:.4;cursor:default}.model-import-dimensions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:17px}.model-import-dimensions>div{display:flex;flex-direction:column;gap:5px;padding:9px 6px;border:1px solid #343943;border-radius:4px;background:#20232a}.model-import-dimensions small{font-size:8px;color:#8992a0;letter-spacing:.05em}.model-import-dimensions strong{font:600 12px ui-monospace,monospace;color:#e5e8ee}.model-import-error{padding:9px;border:1px solid #743d3a;border-radius:4px;background:#3a2526;color:#ffb6ae;font-size:10px;line-height:1.5}.model-import-tip{margin-top:17px;color:#858e9d;font-size:10px;line-height:1.6}.model-import-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-top:1px solid #30343c;color:#969eac;font-size:10px}.model-import-footer>div{display:flex;gap:8px}.model-import-primary,.model-import-secondary{padding:9px 12px;border-radius:4px;font-size:11px;font-weight:650;cursor:pointer}.model-import-primary{border:1px solid #d19a64;background:#d19a64;color:#211911}.model-import-primary:disabled{opacity:.4;cursor:not-allowed}.model-import-secondary{border:1px solid #424752;background:#252932;color:#d1d5dd}
@media(max-width:720px){.model-import-backdrop{padding:8px}.model-import-dialog{max-height:96vh}.model-import-body{grid-template-columns:1fr}.model-import-preview{min-height:270px;border-right:0;border-bottom:1px solid #30343c}.model-import-preview canvas{min-height:270px}.model-import-settings{padding:15px}.model-import-footer{align-items:flex-start;flex-direction:column}.model-import-footer>div{width:100%;justify-content:flex-end}}
</style>
