import type { ObjectType, Vec3 } from '../../project/format'

export interface PrimitiveDef {
  label: string
  /** largura, altura, profundidade */
  size: Vec3
  color: number
}

export const PRIMITIVE_DEFS: Record<ObjectType, PrimitiveDef> = {
  cube: { label: 'Cubo', size: [1, 1, 1], color: 0xd9573c },
  platform: { label: 'Plataforma', size: [4, 0.4, 4], color: 0xc94f6a },
}

export function isObjectType(v: unknown): v is ObjectType {
  return v === 'cube' || v === 'platform'
}
