import { PRIMITIVE_DEFS, isObjectType } from '../model/object/defs'
import { TERRAIN_VERTS } from '../world/worldGeneration/Heightfield'
import { FORMAT_VERSION } from './format'
import type {
  CameraData,
  CameraPreset,
  ProjectFile,
  SceneFile,
  SceneObjectData,
  TerrainData,
  Vec3,
} from './format'
import type { AnimationRole, ModelControlBindings } from '../script/packages'

export class ProjectFormatError extends Error {}

const DEFAULT_CAMERA: CameraData = { preset: 'free', yaw: 0.8, pitch: 0.5, distance: 30, target: [0, 1, 0] }

function fail(message: string): never {
  throw new ProjectFormatError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

const VALID_ANIMATION_ROLES = new Set<AnimationRole>([
  'ignore', 'idle', 'walk', 'run',
  'walk_diagonal_left', 'walk_diagonal_right',
  'run_diagonal_left', 'run_diagonal_right',
  'run_stop', 'jump', 'mount', 'dismount',
])

function parseAnimationRoleMap(value: unknown): Record<string, AnimationRole> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, AnimationRole> = {}
  for (const [key, role] of Object.entries(value)) {
    if (!/^\d+$/.test(key) || typeof role !== 'string' || !VALID_ANIMATION_ROLES.has(role as AnimationRole)) continue
    result[key] = role as AnimationRole
  }
  return Object.keys(result).length ? result : undefined
}

function parseControlBindings(value: unknown): Partial<ModelControlBindings> | undefined {
  if (!isRecord(value)) return undefined
  const result: Partial<ModelControlBindings> = {}
  const keys: (keyof ModelControlBindings)[] = ['forward', 'backward', 'left', 'right', 'run', 'jump', 'interact']
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(candidate)) result[key] = candidate
  }
  return Object.keys(result).length ? result : undefined
}

function parseJson(text: string, label: string): Record<string, unknown> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    fail(`${label} não é um JSON válido.`)
  }
  if (!isRecord(raw)) fail(`${label} deve conter um objeto JSON.`)
  return raw
}

function checkVersion(obj: Record<string, unknown>, label: string): number {
  const v = obj.formatVersion
  if (typeof v !== 'number') fail(`${label} não informa formatVersion.`)
  if (v > FORMAT_VERSION) {
    fail(`${label} usa o formato v${v}, mais novo que este app (v${FORMAT_VERSION}). Atualize o app.`)
  }
  if (v < 1) fail(`${label} tem formatVersion inválido (${v}).`)
  return v
}

function reqString(obj: Record<string, unknown>, key: string, label: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim() === '') fail(`${label}: o campo "${key}" é obrigatório.`)
  return v
}

function vec3(v: unknown, fallback: Vec3 | null, label: string): Vec3 {
  if (v === undefined && fallback) return fallback
  if (!Array.isArray(v) || v.length !== 3) fail(`${label}: vetor inválido.`)
  const [a, b, c] = v
  if (!isNum(a) || !isNum(b) || !isNum(c)) fail(`${label}: vetor com valores inválidos.`)
  return [a, b, c]
}

export function isValidScenePath(path: string): boolean {
  return /^scenes\/[A-Za-z0-9._-]+\.scene\.json$/.test(path) && !path.includes('..')
}

export function parseProject(text: string): ProjectFile {
  const obj = parseJson(text, 'project.json')
  const version = checkVersion(obj, 'project.json')

  const scenes = obj.scenes
  if (!Array.isArray(scenes) || scenes.length === 0) fail('project.json não lista nenhuma cena.')
  const scenePaths: string[] = []
  for (const s of scenes) {
    if (typeof s !== 'string' || !isValidScenePath(s)) fail(`Caminho de cena inválido: ${String(s)}`)
    scenePaths.push(s)
  }

  const settings = isRecord(obj.settings) ? obj.settings : {}
  const mp = isRecord(settings.multiplayer) ? settings.multiplayer : {}
  const editor = isRecord(settings.editor) ? settings.editor : {}
  const brushStrength = isNum(editor.brushStrength) ? Math.min(3, Math.max(0.2, editor.brushStrength)) : 1.5
  const brushRadius = isNum(editor.brushRadius) ? Math.min(12, Math.max(1, editor.brushRadius)) : 4

  return {
    formatVersion: version,
    id: reqString(obj, 'id', 'project.json'),
    name: reqString(obj, 'name', 'project.json'),
    template: typeof obj.template === 'string' ? obj.template : 'empty-world',
    engineVersion: typeof obj.engineVersion === 'string' ? obj.engineVersion : '0.0.0',
    settings: {
      cameraMode: 'orbit',
      multiplayer: {
        enabled: mp.enabled === true,
        maxPlayers: typeof mp.maxPlayers === 'number' && Number.isFinite(mp.maxPlayers) ? Math.max(1, Math.min(64, Math.floor(mp.maxPlayers))) : 4,
      },
      editor: {
        gridVisible: editor.gridVisible !== false,
        brushStrength,
        brushRadius,
      },
    },
    modules: Array.isArray(obj.modules)
      ? obj.modules.filter((m): m is { id: string; version: string } => isRecord(m) && typeof m.id === 'string' && typeof m.version === 'string')
      : [],
    scenes: scenePaths,
  }
}

function parseCamera(v: unknown, label: string): CameraData {
  if (v === undefined) return DEFAULT_CAMERA
  if (!isRecord(v)) fail(`${label}: "camera" inválida.`)
  const preset = v.preset
  if (preset !== 'free' && preset !== 'isometric' && preset !== 'top') {
    // v1 usava "mode": "isometric"; qualquer valor desconhecido cai na câmera livre
    return DEFAULT_CAMERA
  }
  if (!isNum(v.yaw) || !isNum(v.pitch) || !isNum(v.distance)) fail(`${label}: câmera com valores inválidos.`)
  return {
    preset: preset as CameraPreset,
    yaw: v.yaw,
    pitch: v.pitch,
    distance: v.distance,
    target: vec3(v.target, [0, 1, 0], `${label} (camera.target)`),
  }
}

function parseTerrain(v: unknown, version: number, label: string): TerrainData {
  // Projetos v1 não tinham terreno: ficam planos (semente 0) para os objetos não "afundarem".
  if (v === undefined) return { seed: version < 2 ? 0 : 1337, visible: true, edits: [] }
  if (!isRecord(v)) fail(`${label}: "terrain" inválido.`)
  const seed = v.seed
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    fail(`${label}: semente do terreno inválida.`)
  }
  if (v.visible !== undefined && typeof v.visible !== 'boolean') fail(`${label}: "terrain.visible" inválido.`)
  const rawEdits = v.edits ?? []
  if (!Array.isArray(rawEdits) || rawEdits.length > TERRAIN_VERTS) fail(`${label}: edições do terreno inválidas.`)
  const edits: Array<[number, number]> = []
  for (const e of rawEdits) {
    if (!Array.isArray(e) || e.length !== 2) fail(`${label}: edição de terreno inválida.`)
    const [i, d] = e
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= TERRAIN_VERTS || !isNum(d)) {
      fail(`${label}: edição de terreno fora do limite.`)
    }
    edits.push([i, d])
  }
  const rawGrass = v.paintedGrass ?? []
  if (!Array.isArray(rawGrass)) fail(`${label}: dados de grama pintada inválidos.`)
  // A validação ocorre abaixo. Como o JSON já foi parseado, aproveitamos o
  // próprio array e evitamos outra lista com uma referência para cada tufo.
  const paintedGrass = rawGrass as Array<[number, number, number, number]>
  for (const tuft of rawGrass) {
    if (!Array.isArray(tuft) || tuft.length !== 4 || !tuft.every(isNum)) {
      fail(`${label}: tufo de grama inválido.`)
    }
    const [x, z, scale, color] = tuft
    if (x < -50 || x > 50 || z < -50 || z > 50 || scale < 0.2 || scale > 2 || !Number.isInteger(color) || color < 0 || color > 0xffffff) {
      fail(`${label}: tufo de grama fora dos limites.`)
    }
    // Cada tupla já fica no array original; não fazemos cópias por tufo.
  }
  return { seed, visible: v.visible !== false, edits, paintedGrass }
}

function parseFaceTextures(value: unknown, label: string, id: string): import('./format').FaceTextureMap {
  if (!isRecord(value)) return {}
  const faces: import('./format').TextureFace[] = ['right', 'left', 'top', 'bottom', 'front', 'back']
  const result: import('./format').FaceTextureMap = {}
  for (const face of faces) {
    const entry = value[face]
    if (entry === undefined || entry === null) continue
    if (!isRecord(entry) || typeof entry.imageDataUrl !== 'string' || !entry.imageDataUrl.startsWith('data:image/')) {
      fail(`${label}: textura da face ${face} inválida em "${id}".`)
    }
    if (entry.imageDataUrl.length > 28_000_000) fail(`${label}: imagem da face ${face} é grande demais em "${id}".`)
    const pixelWidth = isNum(entry.pixelWidth) ? Math.min(10000, Math.max(8, Math.round(entry.pixelWidth))) : 128
    const pixelHeight = isNum(entry.pixelHeight) ? Math.min(10000, Math.max(8, Math.round(entry.pixelHeight))) : 128
    result[face] = { imageDataUrl: entry.imageDataUrl, pixelWidth, pixelHeight }
  }
  return result
}

export function parseScene(text: string, label = 'cena'): SceneFile {
  return parseSceneObject(parseJson(text, label), label)
}

/** Valida uma cena já parseada sem serializar e parsear novamente JSON grande. */
export function parseSceneObject(value: unknown, label = 'cena'): SceneFile {
  if (!isRecord(value)) fail(`${label} deve conter um objeto JSON.`)
  const obj = value
  const version = checkVersion(obj, label)
  if (!Array.isArray(obj.objects)) fail(`${label}: "objects" deve ser uma lista.`)

  const seen = new Set<string>()
  const objects: SceneObjectData[] = []
  for (const item of obj.objects) {
    if (!isRecord(item)) fail(`${label}: objeto inválido na lista.`)
    const id = reqString(item, 'id', label)
    if (seen.has(id)) fail(`${label}: id repetido "${id}".`)
    seen.add(id)

    const type = item.type
    if (!isObjectType(type)) fail(`${label}: tipo de objeto desconhecido "${String(type)}" (${id}).`)

    const scale = vec3(item.scale, [1, 1, 1], `${label} (${id}.scale)`)
    if (scale.some((s) => s <= 0)) fail(`${label}: escala inválida em "${id}".`)

    const color = item.color === undefined ? PRIMITIVE_DEFS[type].color : item.color
    if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color > 0xffffff) {
      fail(`${label}: cor inválida em "${id}".`)
    }
    if (item.visible !== undefined && typeof item.visible !== 'boolean') {
      fail(`${label}: "visible" inválido em "${id}".`)
    }

    objects.push({
      id,
      name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name : id,
      type,
      position: vec3(item.position, null, `${label} (${id}.position)`),
      rotation: vec3(item.rotation, [0, 0, 0], `${label} (${id}.rotation)`),
      scale,
      visible: item.visible !== false,
      color,
      texturePreset: item.texturePreset === 'grass' || item.texturePreset === 'stone' || item.texturePreset === 'brick' || item.texturePreset === 'wood' || item.texturePreset === 'sand' || item.texturePreset === 'metal' ? item.texturePreset : 'none',
      textureRepeat: isNum(item.textureRepeat) ? Math.min(8, Math.max(1, item.textureRepeat)) : 2,
      faceTextures: parseFaceTextures(item.faceTextures, label, id),
      locked: item.locked === true,
      wireframeVisible: item.wireframeVisible !== false,
      groupId: typeof item.groupId === 'string' && item.groupId.trim() !== '' ? item.groupId : null,
      mass: isNum(item.mass) ? Math.max(0, Math.min(1000000, item.mass)) : 1,
      colliderType: item.colliderType === 'box' || item.colliderType === 'sphere' || item.colliderType === 'capsule' || item.colliderType === 'none' || item.colliderType === 'auto' ? item.colliderType : undefined,
      colliderSize: item.colliderSize === undefined ? undefined : vec3(item.colliderSize, null, `${label} (${id}.colliderSize)`),
      colliderOffset: item.colliderOffset === undefined ? undefined : vec3(item.colliderOffset, null, `${label} (${id}.colliderOffset)`),
      sceneKind: item.sceneKind === 'entity' ? 'entity' : 'object',
      componentId: typeof item.componentId === 'string' && item.componentId.trim() !== '' ? item.componentId : undefined,
      importedModelData: typeof item.importedModelData === 'string' && item.importedModelData.length > 0 ? item.importedModelData : undefined,
      importedModelHeight: isNum(item.importedModelHeight) && item.importedModelHeight > 0 ? item.importedModelHeight : undefined,
      importAnimationRoles: parseAnimationRoleMap(item.importAnimationRoles),
      importControlBindings: parseControlBindings(item.importControlBindings),
    })
  }

  const environment = isRecord(obj.environment) ? obj.environment : undefined
  let playerModel: SceneFile['playerModel'] = undefined
  if (obj.playerModel !== undefined) {
    if (!isRecord(obj.playerModel)) fail(`${label}: modelo do jogador inválido.`)
    const name = obj.playerModel.name
    const glbData = obj.playerModel.glbData
    if (typeof name !== 'string' || name.trim() === '') fail(`${label}: nome do modelo do jogador inválido.`)
    if (typeof glbData !== 'string' || glbData.length === 0 || glbData.length > 42_000_000 || glbData.startsWith('asset://')) {
      fail(`${label}: dados do modelo do jogador inválidos ou grandes demais (limite aproximado de 30 MB por GLB).`)
    }
    const animationRoles = parseAnimationRoleMap(obj.playerModel.animationRoles)
    playerModel = {
      name: name.trim(),
      glbData,
      ...(animationRoles ? { animationRoles } : {}),
    }
  }

  return {
    formatVersion: FORMAT_VERSION, // já migrado para o formato atual
    id: reqString(obj, 'id', label),
    name: typeof obj.name === 'string' ? obj.name : 'Cena',
    camera: parseCamera(obj.camera, label),
    terrain: parseTerrain(obj.terrain, version, label),
    environment: environment ? {
      ...(typeof environment.skyTextureDataUrl === 'string' ? { skyTextureDataUrl: environment.skyTextureDataUrl } : {}),
      timeOfDay: isNum(environment.timeOfDay) ? Math.min(24, Math.max(0, environment.timeOfDay)) : 12,
      cycleEnabled: environment.cycleEnabled === true,
      cycleSpeed: isNum(environment.cycleSpeed) ? Math.min(4, Math.max(0.01, environment.cycleSpeed)) : 0.1,
    } : undefined,
    playerModel,
    objects,
  }
}
