export const FORMAT_VERSION = 2
export const ENGINE_VERSION = '0.1.0'
export const MAIN_SCENE_PATH = 'scenes/main.scene.json'

export type ObjectType = 'cube' | 'platform'
export type CameraPreset = 'free' | 'isometric' | 'top'
export type Vec3 = [number, number, number]

export type TextureFace = 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back'
export interface FaceTextureData { imageDataUrl: string; pixelWidth: number; pixelHeight: number }
export type FaceTextureMap = Partial<Record<TextureFace, FaceTextureData>>

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
  texturePreset?: 'none' | 'grass' | 'stone' | 'brick' | 'wood' | 'sand' | 'metal'
  textureRepeat?: number
  faceTextures?: FaceTextureMap
  locked?: boolean
  wireframeVisible?: boolean
  groupId?: string | null
  mass?: number
  colliderType?: 'auto' | 'box' | 'sphere' | 'capsule' | 'none'
  colliderSize?: Vec3
  colliderOffset?: Vec3
  /** ID do componente de biblioteca que originou o modelo, quando aplicável. */
  componentId?: string
  /** Tipo semântico genérico do elemento colocado na cena. */
  sceneKind?: 'object' | 'entity'
  /** GLB incorporado ao projeto para reconstruir modelos importados. */
  importedModelData?: string
  importedModelHeight?: number
}

export interface TerrainData {
  /** 0 = terreno plano (usado ao migrar projetos v1). */
  seed: number
  visible: boolean
  /** Edições esparsas: [índice do vértice, deslocamento de altura]. */
  edits: Array<[number, number]>
  /** Tufts painted by the user: [x, z, scale, color]. Optional for old projects. */
  paintedGrass?: Array<[number, number, number, number]>
}

export interface CameraData {
  preset: CameraPreset
  yaw: number
  pitch: number
  distance: number
  target: Vec3
}

export interface EnvironmentData {
  skyTextureDataUrl?: string
  timeOfDay: number
  cycleEnabled: boolean
  cycleSpeed: number
}

export interface SceneFile {
  formatVersion: number
  id: string
  name: string
  camera: CameraData
  terrain: TerrainData
  environment?: EnvironmentData
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
    editor: {
      gridVisible: boolean
      brushStrength: number
      brushRadius: number
    }
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
