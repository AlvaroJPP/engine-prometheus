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
        maxPlayers: typeof mp.maxPlayers === 'number' ? mp.maxPlayers : 4,
      },
    },
    modules: [],
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
  return { seed, visible: v.visible !== false, edits }
}

export function parseScene(text: string, label = 'cena'): SceneFile {
  const obj = parseJson(text, label)
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
    })
  }

  return {
    formatVersion: FORMAT_VERSION, // já migrado para o formato atual
    id: reqString(obj, 'id', label),
    name: typeof obj.name === 'string' ? obj.name : 'Cena',
    camera: parseCamera(obj.camera, label),
    terrain: parseTerrain(obj.terrain, version, label),
    objects,
  }
}
