import type { Mesh } from 'three'
import type { FaceTextureMap, ObjectType, TextureFace } from '../../project/format'

export interface GameObject {
  id: string
  name: string
  type: ObjectType
  mesh: Mesh
}

/** Visão simples de um objeto para a interface (sem dependência do Three.js). */
export interface ObjectInfo {
  id: string
  name: string
  type: ObjectType
  /** Indica que o objeto visual vem de um modelo 3D importado. */
  importedModel?: boolean
  x: number
  y: number
  z: number
  /** graus */
  rotationX: number
  rotationY: number
  rotationZ: number
  scale: number
  scaleX: number
  scaleY: number
  scaleZ: number
  visible: boolean
  locked: boolean
  wireframeVisible: boolean
  groupId: string | null
  color: number
  texturePreset: 'none' | 'grass' | 'stone' | 'brick' | 'wood' | 'sand' | 'metal'
  textureRepeat: number
  faceTextures: FaceTextureMap
  mass: number
  colliderType: 'auto' | 'box' | 'sphere' | 'capsule' | 'mesh' | 'none'
  colliderSize: [number, number, number]
  colliderOffset: [number, number, number]
}

export interface ObjectPatch {
  x?: number
  y?: number
  z?: number
  /** graus */
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  scale?: number
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  color?: number
  texturePreset?: 'none' | 'grass' | 'stone' | 'brick' | 'wood' | 'sand' | 'metal'
  textureRepeat?: number
  faceTexture?: { face: TextureFace; value: import('../../project/format').FaceTextureData | null }
  faceTextures?: FaceTextureMap
  visible?: boolean
  locked?: boolean
  wireframeVisible?: boolean
  groupId?: string | null
  mass?: number
  colliderType?: 'auto' | 'box' | 'sphere' | 'capsule' | 'mesh' | 'none
  colliderSize?: [number, number, number]
  colliderOffset?: [number, number, number]
}
