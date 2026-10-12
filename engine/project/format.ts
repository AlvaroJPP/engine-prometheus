export const FORMAT_VERSION = 2
export const ENGINE_VERSION = '0.1.0'
export const MAIN_SCENE_PATH = 'scenes/main.scene.json'

export type ObjectType = 'cube' | 'platform'
export type CameraPreset = 'free' | 'isometric' | 'top'
export type Vec3 = [number, number, number]

export interface SceneObjectData {
  id: string
  name: string
  type: ObjectType
  position: Vec3
  /** radianos (x, y, z) */
  rotation: Vec3
  scale: Vec3
  visible: boolean
  color: number
}

export interface TerrainData {
  /** 0 = terreno plano (usado ao migrar projetos v1). */
  seed: number
  visible: boolean
  /** Edições esparsas: [índice do vértice, deslocamento de altura]. */
  edits: Array<[number, number]>
}

export interface CameraData {
  preset: CameraPreset
  yaw: number
  pitch: number
  distance: number
  target: Vec3
}

export interface SceneFile {
  formatVersion: number
  id: string
  name: string
  camera: CameraData
  terrain: TerrainData
  objects: SceneObjectData[]
}

export interface ProjectFile {
  formatVersion: number
  id: string
  name: string
  template: string
  engineVersion: string
  settings: {
    cameraMode: 'orbit'
    multiplayer: { enabled: boolean; maxPlayers: number }
  }
  modules: Array<{ id: string; version: string }>
  scenes: string[]
}

/** Tudo o que compõe um projeto em memória: project.json + cenas. */
export interface ProjectBundle {
  project: ProjectFile
  scenes: Record<string, SceneFile>
  logic?: import('../script/types').LogicEventsFile
}
