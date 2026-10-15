import type { Mesh } from 'three'
import type { ObjectType } from '../../project/format'

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
  mass: number
  colliderType: 'auto' | 'box' | 'sphere' | 'capsule' | 'none'
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
  visible?: boolean
  locked?: boolean
  wireframeVisible?: boolean
  groupId?: string | null
  mass?: number
  colliderType?: 'auto' | 'box' | 'sphere' | 'capsule' | 'none'
  colliderSize?: [number, number, number]
  colliderOffset?: [number, number, number]
}
