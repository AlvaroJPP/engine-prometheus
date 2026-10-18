<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

type StarterRole = 'player' | 'enemy' | 'loot' | 'object'
type StarterAsset = {
  id: string
  name: string
  description: string
  category: 'characters' | 'enemies' | 'items'
  kind: 'remote' | 'procedural'
  role: StarterRole
  height: number
  sourceUrl?: string
  sourceName?: string
  itemId?: string
  aiProfile?: string
  badge: string
  credit: string
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  'load-model': [asset: {
    name: string
    bytes: ArrayBuffer
    role: StarterRole
    height: number
    itemId?: string
    aiProfile?: string
    sourceName?: string
  }]
}>()

const assets: StarterAsset[] = [
  {
    id: 'robot-expressive-player',
    name: 'Autômato Expressivo',
    description: 'Personagem de teste com vários clipes, incluindo Idle, Walking, Running, Jump, Death, Punch e Wave.',
    category: 'characters',
    kind: 'remote',
    role: 'player',
    height: 1.8,
    sourceUrl: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive.glb',
    sourceName: 'RobotExpressive — Three.js / Tomás Laulhé, modificado por Don McCurdy (CC0 1.0)',
    badge: 'PLAYER · ANIMADO',
    credit: 'Tomás Laulhé; modificações de Don McCurdy · CC0 1.0',
  },
  {
    id: 'robot-expressive-enemy',
    name: 'Autômato Hostil',
    description: 'A mesma malha animada, já preparada como inimigo hostil do VEILBORNE com IA de perseguição corpo a corpo.',
    category: 'enemies',
    kind: 'remote',
    role: 'enemy',
    height: 1.8,
    sourceUrl: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive.glb',
    sourceName: 'RobotExpressive — Three.js / Tomás Laulhé, modificado por Don McCurdy (CC0 1.0)',
    aiProfile: 'melee',
    badge: 'INIMIGO · MELEE',
    credit: 'Tomás Laulhé; modificações de Don McCurdy · CC0 1.0',
  },
  {
    id: 'fox-enemy',
    name: 'Raposa Errante',
    description: 'Criatura animada com clipes Survey, Walk e Run. O pacote de comportamento é configurado como inimigo.',
    category: 'enemies',
    kind: 'remote',
    role: 'enemy',
    height: 0.9,
    sourceUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb',
    sourceName: 'Fox — Khronos glTF Sample Assets; modelo de PixelMannen, rig/animação de tomkranis',
    aiProfile: 'flanker',
    badge: 'INIMIGO · FLANQUEADOR',
    credit: 'Modelo: PixelMannen (CC0); rig/animação: tomkranis (CC BY 4.0). Consulte os créditos.',
  },
  {
    id: 'vitality-vial',
    name: 'Frasco de Vitalidade',
    description: 'Coletável preparado para conceder um Frasco de Vitalidade ao pressionar E perto dele.',
    category: 'items',
    kind: 'procedural',
    role: 'loot',
    height: 0.58,
    itemId: 'lesser_vitality_vial',
    badge: 'COLETÁVEL · VIDA',
    credit: 'Modelo procedural criado pelo Engine Prometheus.',
  },
  {
    id: 'ether-vial',
    name: 'Frasco de Éter',
    description: 'Coletável VEILBORNE: adiciona um Frasco de Éter ao inventário.',
    category: 'items',
    kind: 'procedural',
    role: 'loot',
    height: 0.58,
    itemId: 'ether_vial',
    badge: 'COLETÁVEL · ÉTER',
    credit: 'Modelo procedural criado pelo Engine Prometheus.',
  },
  {
    id: 'echo-fragment',
    name: 'Fragmento de Ecos',
    description: 'Cristal de Ecos coletável. Integra-se ao inventário; para recuperar Ecos perdidos, use o cristal criado ao morrer.',
    category: 'items',
    kind: 'procedural',
    role: 'loot',
    height: 0.44,
    itemId: 'echo_fragment',
    badge: 'COLETÁVEL · ECOS',
    credit: 'Modelo procedural criado pelo Engine Prometheus.',
  },
  {
    id: 'ember-bomb',
    name: 'Bomba de Brasa',
    description: 'Coletável que adiciona uma Bomba de Brasa ao inventário VEILBORNE.',
    category: 'items',
    kind: 'procedural',
    role: 'loot',
    height: 0.48,
    itemId: 'ember_bomb',
    badge: 'COLETÁVEL · FOGO',
    credit: 'Modelo procedural criado pelo Engine Prometheus.',
  },
  {
    id: 'vigor-vial',
    name: 'Tônico de Vigor',
    description: 'Coletável que adiciona um Tônico de Vigor ao inventário VEILBORNE.',
    category: 'items',
    kind: 'procedural',
    role: 'loot',
    height: 0.58,
    itemId: 'vigor_vial',
    badge: 'COLETÁVEL · VIGOR',
    credit: 'Modelo procedural criado pelo Engine Prometheus.',
  },
  {
    id: 'veil-sword',
    name: 'Lâmina do Véu',
    description: 'Espada estilizada para decoração ou protótipo visual. Para equipar armas, use o Arsenal do Véu.',
    category: 'items',
    kind: 'procedural',
    role: 'object',
    height: 1.12,
    badge: 'OBJETO · ARMA',
    credit: 'Modelo procedural criado pelo Engine Prometheus; não é um item equipável do inventário.',
  },
  {
    id: 'soul-chest',
    name: 'Baú de Relíquias',
    description: 'Baú decorativo para construir encontros, esconderijos e áreas de saque.',
    category: 'items',
    kind: 'procedural',
    role: 'object',
    height: 0.72,
    badge: 'OBJETO · DECORAÇÃO',
    credit: 'Modelo procedural criado pelo Engine Prometheus.',
  },
]

const category = ref<'all' | 'characters' | 'enemies' | 'items'>('all')
const busyId = ref('')
const message = ref('')
const error = ref('')
const visibleAssets = computed(() => category.value === 'all' ? assets : assets.filter(asset => asset.category === category.value))

watch(() => props.open, open => {
  if (open) {
    message.value = ''
    error.value = ''
  }
})

function mat(color: number, metalness = 0, roughness = 0.5, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: emissive === 0x000000 ? 0 : 0.65 })
}

function addMesh(root: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, name: string, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.rotation.set(rotation[0], rotation[1], rotation[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  root.add(mesh)
  return mesh
}

function potionModel(color: number) {
  const root = new THREE.Group()
  root.name = 'VeilbornePotion'
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd5deeb, transparent: true, opacity: 0.48, roughness: 0.16, metalness: 0, transmission: 0.12, thickness: 0.15 })
  const liquid = mat(color, 0.08, 0.25, color)
  const cork = mat(0x69452c, 0, 0.82)
  const gold = mat(0xc8a65c, 0.72, 0.32)
  const profile = [
    new THREE.Vector2(0, 0.05), new THREE.Vector2(0.15, 0.05), new THREE.Vector2(0.2, 0.1),
    new THREE.Vector2(0.21, 0.22), new THREE.Vector2(0.16, 0.33), new THREE.Vector2(0.09, 0.39),
    new THREE.Vector2(0.075, 0.47), new THREE.Vector2(0.09, 0.5), new THREE.Vector2(0.085, 0.54),
    new THREE.Vector2(0.065, 0.56), new THREE.Vector2(0, 0.56),
  ]
  addMesh(root, new THREE.LatheGeometry(profile, 16), glass, 'GlassBottle', [0, 0, 0])
  addMesh(root, new THREE.CylinderGeometry(0.155, 0.185, 0.19, 16), liquid, 'PotionLiquid', [0, 0.16, 0])
  addMesh(root, new THREE.CylinderGeometry(0.092, 0.09, 0.025, 16), gold, 'NeckRing', [0, 0.49, 0])
  addMesh(root, new THREE.CylinderGeometry(0.058, 0.065, 0.07, 10), cork, 'Cork', [0, 0.535, 0])
  const rune = addMesh(root, new THREE.TorusGeometry(0.09, 0.012, 5, 16), gold, 'BottleRune', [0, 0.24, 0], [Math.PI / 2, 0, 0])
  rune.scale.set(1, 0.72, 1)
  return root
}

function echoModel() {
  const root = new THREE.Group()
  root.name = 'EchoFragment'
  addMesh(root, new THREE.IcosahedronGeometry(0.19, 1), mat(0x9b68fa, 0.28, 0.22, 0x5c1ac4), 'EchoCore', [0, 0.22, 0])
  addMesh(root, new THREE.OctahedronGeometry(0.27, 0), mat(0x6b38c9, 0.45, 0.22, 0x45117c), 'EchoShard', [0, 0.22, 0], [0.15, 0.3, 0.2])
  addMesh(root, new THREE.OctahedronGeometry(0.09, 0), mat(0xdccaff, 0.2, 0.2, 0x9773ff), 'EchoSpark', [0.2, 0.35, 0.03], [0.3, 0.5, 0.25])
  return root
}

function emberBombModel() {
  const root = new THREE.Group()
  root.name = 'EmberBomb'
  addMesh(root, new THREE.SphereGeometry(0.19, 12, 10), mat(0x45252a, 0.15, 0.62), 'BombBody', [0, 0.2, 0])
  addMesh(root, new THREE.TorusGeometry(0.19, 0.022, 6, 18), mat(0xc76a36, 0.35, 0.36, 0x6e1604), 'CopperBand', [0, 0.2, 0], [Math.PI / 2, 0, 0])
  addMesh(root, new THREE.CylinderGeometry(0.025, 0.03, 0.12, 8), mat(0x5d3b29), 'Fuse', [0, 0.39, 0.02], [0.2, 0, 0])
  addMesh(root, new THREE.SphereGeometry(0.045, 8, 6), mat(0xff8a32, 0, 0.25, 0xf04409), 'BurningFuse', [0, 0.46, 0.02])
  return root
}

function swordModel() {
  const root = new THREE.Group()
  root.name = 'VeilSword'
  const bladeShape = new THREE.Shape()
  bladeShape.moveTo(-0.065, 0)
  bladeShape.lineTo(0.065, 0)
  bladeShape.lineTo(0.052, 0.65)
  bladeShape.lineTo(0, 0.82)
  bladeShape.lineTo(-0.052, 0.65)
  bladeShape.closePath()
  const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.035, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.008, bevelThickness: 0.008 })
  addMesh(root, blade, mat(0xbcc7d6, 0.85, 0.24), 'Blade', [0, 0.14, -0.017])
  addMesh(root, new THREE.BoxGeometry(0.29, 0.045, 0.06), mat(0xd0a34c, 0.75, 0.3), 'Guard', [0, 0.13, 0])
  addMesh(root, new THREE.CylinderGeometry(0.037, 0.03, 0.24, 8), mat(0x312630, 0.12, 0.62), 'Grip', [0, 0.01, 0], [0, 0, 0])
  addMesh(root, new THREE.SphereGeometry(0.055, 10, 8), mat(0x9a4c83, 0.35, 0.3, 0x501c42), 'Pommel', [0, -0.12, 0])
  const rune = addMesh(root, new THREE.BoxGeometry(0.016, 0.42, 0.006), mat(0x8d63e8, 0.4, 0.25, 0x5a22c9), 'ArcaneRune', [0, 0.51, 0.022])
  rune.position.z = 0.025
  return root
}

function chestModel() {
  const root = new THREE.Group()
  root.name = 'RelicChest'
  const wood = mat(0x4f3023, 0.05, 0.82)
  const darkWood = mat(0x2f1d18, 0.05, 0.78)
  const gold = mat(0xcaa65a, 0.68, 0.32)
  const lock = mat(0xdfbd73, 0.7, 0.24)
  addMesh(root, new THREE.BoxGeometry(0.62, 0.34, 0.42), wood, 'ChestBody', [0, 0.2, 0])
  addMesh(root, new THREE.BoxGeometry(0.65, 0.065, 0.45), darkWood, 'ChestTop', [0, 0.395, 0])
  addMesh(root, new THREE.BoxGeometry(0.64, 0.025, 0.44), gold, 'ChestTopTrim', [0, 0.43, 0])
  addMesh(root, new THREE.BoxGeometry(0.07, 0.37, 0.44), gold, 'LeftTrim', [-0.27, 0.2, 0])
  addMesh(root, new THREE.BoxGeometry(0.07, 0.37, 0.44), gold, 'RightTrim', [0.27, 0.2, 0])
  addMesh(root, new THREE.BoxGeometry(0.12, 0.12, 0.055), lock, 'LockPlate', [0, 0.28, 0.23])
  addMesh(root, new THREE.TorusGeometry(0.034, 0.009, 6, 12), darkWood, 'LockHole', [0, 0.27, 0.265])
  return root
}

function createProceduralModel(asset: StarterAsset): THREE.Group {
  switch (asset.id) {
    case 'vitality-vial': return potionModel(0xba243b)
    case 'ether-vial': return potionModel(0x3389db)
    case 'vigor-vial': return potionModel(0x3eaa68)
    case 'echo-fragment': return echoModel()
    case 'ember-bomb': return emberBombModel()
    case 'veil-sword': return swordModel()
    case 'soul-chest': return chestModel()
    default: throw new Error('Este item não tem um modelo procedural definido.')
  }
}

async function exportProceduralModel(asset: StarterAsset): Promise<ArrayBuffer> {
  const root = createProceduralModel(asset)
  root.updateMatrixWorld(true)
  const result = await new GLTFExporter().parseAsync(root, { binary: true })
  if (!(result instanceof ArrayBuffer) || result.byteLength < 20) {
    throw new Error('O exportador não gerou um GLB válido para este item.')
  }
  return result
}

async function loadAsset(asset: StarterAsset) {
  if (busyId.value) return
  busyId.value = asset.id
  error.value = ''
  message.value = ''
  try {
    let bytes: ArrayBuffer
    if (asset.kind === 'remote') {
      if (!asset.sourceUrl) throw new Error('Este modelo não tem uma URL configurada.')
      const response = await fetch(asset.sourceUrl, { mode: 'cors', cache: 'force-cache' })
      if (!response.ok) throw new Error('O servidor de modelos respondeu HTTP ' + response.status + '. Verifique a conexão ou use o link oficial do pacote.')
      bytes = await response.arrayBuffer()
      if (bytes.byteLength < 20 || new TextDecoder().decode(bytes.slice(0, 4)) !== 'glTF') {
        throw new Error('O servidor não retornou um arquivo GLB válido.')
      }
      if (bytes.byteLength > 30 * 1024 * 1024) throw new Error('O modelo ultrapassa o limite de 30 MB.')
    } else {
      bytes = await exportProceduralModel(asset)
    }

    emit('load-model', {
      name: asset.name,
      bytes,
      role: asset.role,
      height: asset.height,
      itemId: asset.itemId,
      aiProfile: asset.aiProfile,
      sourceName: asset.sourceName,
    })
    message.value = 'Modelo enviado ao Workspace. Configure a função e salve o componente para reutilizá-lo.'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Não foi possível carregar este modelo.'
  } finally {
    busyId.value = ''
  }
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div v-if="open" class="starter-catalog-backdrop" role="presentation" @click.self="emit('close')">
    <section class="starter-catalog" role="dialog" aria-modal="true" aria-labelledby="starter-catalog-title">
      <header class="starter-catalog-header">
        <div>
          <div class="starter-catalog-kicker">ENGINE PROMETHEUS / VEILBORNE</div>
          <h2 id="starter-catalog-title">Catálogo de modelos iniciais</h2>
          <p>Carregue personagens animados e itens prontos para salvar na biblioteca.</p>
        </div>
        <button type="button" class="starter-close" aria-label="Fechar catálogo" @click="emit('close')">×</button>
      </header>

      <nav class="starter-catalog-tabs" aria-label="Filtrar modelos">
        <button type="button" :class="{ active: category === 'all' }" @click="category = 'all'">Todos</button>
        <button type="button" :class="{ active: category === 'characters' }" @click="category = 'characters'">Jogador</button>
        <button type="button" :class="{ active: category === 'enemies' }" @click="category = 'enemies'">Inimigos</button>
        <button type="button" :class="{ active: category === 'items' }" @click="category = 'items'">Itens e objetos</button>
      </nav>

      <div class="starter-catalog-content">
        <div v-if="message" class="starter-message" role="status">{{ message }}</div>
        <div v-if="error" class="starter-error" role="alert">{{ error }}</div>

        <div class="starter-asset-grid">
          <article v-for="asset in visibleAssets" :key="asset.id" class="starter-asset-card">
            <div class="starter-art" :class="'art-' + asset.category">
              <span v-if="asset.category === 'characters'" class="starter-art-glyph">♙</span>
              <span v-else-if="asset.category === 'enemies'" class="starter-art-glyph">☠</span>
              <span v-else class="starter-art-glyph">{{ asset.id.includes('vial') ? '⚗' : asset.id === 'echo-fragment' ? '✧' : asset.id === 'veil-sword' ? '⚔' : asset.id === 'soul-chest' ? '▣' : '✹' }}</span>
            </div>
            <div class="starter-asset-content">
              <div class="starter-asset-badge">{{ asset.badge }}</div>
              <h3>{{ asset.name }}</h3>
              <p>{{ asset.description }}</p>
              <div class="starter-asset-credit">{{ asset.credit }}</div>
              <button type="button" class="starter-load-button" :disabled="!!busyId" @click="loadAsset(asset)">
                {{ busyId === asset.id ? 'Carregando…' : asset.kind === 'remote' ? 'Baixar e abrir no Workspace' : 'Gerar e abrir no Workspace' }}
              </button>
            </div>
          </article>
        </div>

        <section class="starter-pack-section">
          <div>
            <div class="starter-catalog-kicker">PACOTES DE FANTASIA</div>
            <h3>Mais personagens, monstros e itens</h3>
            <p>Os pacotes oficiais são downloads separados. Depois de baixar, volte ao Workspace e use <strong>Importar pacote ZIP</strong>.</p>
          </div>
          <div class="starter-pack-links">
            <button type="button" @click="openExternal('https://quaternius.com/packs/rpgcharacters.html')">
              RPG Character Pack <span>6 personagens rigados e animados · CC0</span>
            </button>
            <button type="button" @click="openExternal('https://quaternius.itch.io/bestiary-dungeon-monsters-kit')">
              Bestiary — Dungeon Monsters <span>7 monstros de fantasia; requer importar/retarget animações</span>
            </button>
            <button type="button" @click="openExternal('https://quaternius.itch.io/universal-animation-library-2')">
              Universal Animation Library 2 <span>Mais de 120 animações reutilizáveis · CC0</span>
            </button>
            <button type="button" @click="openExternal('https://quaternius.com/packs/fantasypropsmegakit.html')">
              Fantasy Props MegaKit <span>Mais de 200 armas, poções, baús e props · CC0</span>
            </button>
          </div>
        </section>
        <p class="starter-footnote">Os modelos online precisam de conexão com a internet na primeira carga. O Fox usa rig/animação sob CC BY 4.0; mantenha os créditos em distribuições. Os itens gerados aqui são protótipos 3D leves, criados localmente.</p>
      </div>
      <footer class="starter-catalog-footer">
        <span>Depois de carregar: use “Usar como jogador” ou “Salvar componente”. Inimigos e coletáveis recebem o pacote VEILBORNE automaticamente.</span>
        <button type="button" class="starter-done" @click="emit('close')">Concluir</button>
      </footer>
    </section>
  </div>
</template>

<style>
.starter-catalog-backdrop{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:18px;background:#090b0ff0;color:#e5e7eb;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.starter-catalog{display:flex;flex-direction:column;width:min(1120px,97vw);max-height:94vh;overflow:hidden;border:1px solid #343944;border-radius:8px;background:#15181e;box-shadow:0 28px 90px #000a}
.starter-catalog-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:21px 24px 16px;border-bottom:1px solid #2c313b;background:#191c22}
.starter-catalog-kicker{font-size:9px;letter-spacing:.15em;color:#c79a68;font-weight:800}
.starter-catalog-header h2{font-size:20px;font-weight:700;margin:7px 0 4px;color:#f1f2f5}
.starter-catalog-header p,.starter-pack-section p{font-size:12px;color:#a3aab6;margin:0;line-height:1.5}
.starter-close{border:1px solid #353b45;background:#21252d;color:#bfc6d1;border-radius:4px;font-size:22px;width:32px;height:32px;cursor:pointer}
.starter-catalog-tabs{display:flex;gap:5px;padding:9px 20px;border-bottom:1px solid #2b3039;background:#171a20}
.starter-catalog-tabs button{padding:7px 12px;border:1px solid #343a45;background:#20242c;color:#aeb6c3;font-size:11px;border-radius:4px;cursor:pointer}
.starter-catalog-tabs button.active{border-color:#a77951;background:#3b2c22;color:#ffe0c0}
.starter-catalog-content{overflow:auto;padding:16px 20px 20px}
.starter-message,.starter-error{padding:9px 11px;margin-bottom:12px;border-radius:4px;font-size:11px;line-height:1.5}
.starter-message{color:#c9e4d4;background:#1c3027;border:1px solid #31513f}
.starter-error{color:#ffbdb7;background:#382124;border:1px solid #6b373d}
.starter-asset-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.starter-asset-card{display:flex;min-height:178px;overflow:hidden;border:1px solid #303641;border-radius:5px;background:#1a1e25}
.starter-art{display:grid;place-items:center;flex:none;width:110px;min-height:100%;background:radial-gradient(ellipse at center,#393044 0,#22212b 55%,#171a20 100%);border-right:1px solid #333743}
.starter-art-enemies{background:radial-gradient(ellipse at center,#3e2c30 0,#292126 57%,#171a20 100%)}
.starter-art-items{background:radial-gradient(ellipse at center,#31364a 0,#222530 57%,#171a20 100%)}
.starter-art-glyph{font-size:47px;color:#c4a2f8;text-shadow:0 0 24px #7f4fba8a}
.art-enemies .starter-art-glyph{color:#e09a91}
.art-items .starter-art-glyph{color:#e2bc78}
.starter-asset-content{display:flex;flex-direction:column;align-items:flex-start;padding:12px 13px;min-width:0;flex:1}
.starter-asset-badge{font-size:8px;letter-spacing:.09em;font-weight:800;color:#c7a075}
.starter-asset-content h3{font-size:13px;margin:5px 0;color:#e9ebef}
.starter-asset-content p{font-size:10px;line-height:1.5;color:#a4acb9;margin:0 0 8px}
.starter-asset-credit{font-size:9px;line-height:1.45;color:#788392;margin-top:auto;padding-bottom:9px}
.starter-load-button{width:100%;text-align:center;border:1px solid #6d4b35;background:#382a22;color:#f1d5b5;border-radius:4px;padding:8px 10px;font-size:10px;font-weight:700;cursor:pointer}
.starter-load-button:hover:not(:disabled){background:#4a3427}
.starter-load-button:disabled{opacity:.48;cursor:wait}
.starter-pack-section{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(0,1.4fr);gap:18px;margin-top:18px;padding:16px;border:1px solid #303641;border-radius:5px;background:#181b22}
.starter-pack-section h3{margin:6px 0;font-size:14px;color:#e6e8ed}
.starter-pack-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.starter-pack-links button{display:flex;flex-direction:column;gap:5px;text-align:left;padding:10px 11px;border:1px solid #353b46;border-radius:4px;background:#22262e;color:#e3e6ed;font-size:10px;font-weight:700;cursor:pointer}
.starter-pack-links button:hover{border-color:#94704e;background:#2b2826}
.starter-pack-links span{font-size:9px;font-weight:400;line-height:1.4;color:#9ba4b2}
.starter-footnote{font-size:9px;line-height:1.5;color:#778291;margin:13px 0 0}
.starter-catalog-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-top:1px solid #2b3039;background:#191c22}
.starter-catalog-footer span{font-size:10px;line-height:1.45;color:#939cab}
.starter-done{flex:none;border:1px solid #6d4b35;background:#382a22;color:#f1d5b5;padding:8px 14px;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer}
@media(max-width:750px){.starter-asset-grid{grid-template-columns:1fr}.starter-pack-section{grid-template-columns:1fr}.starter-pack-links{grid-template-columns:1fr}.starter-art{width:85px}.starter-catalog-header{padding:15px}.starter-catalog-content{padding:12px}.starter-catalog-footer{align-items:flex-start}.starter-catalog-footer span{max-width:70%}}
</style>
