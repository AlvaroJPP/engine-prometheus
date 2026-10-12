import * as THREE from 'three'
import { newId } from '../../lib/id'
import type { ObjectType, Vec3 } from '../../project/format'
import { PRIMITIVE_DEFS } from './defs'
import type { GameObject } from './GameObject'

export interface PrimitiveInit {
  id?: string
  name?: string
  color?: number
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  visible?: boolean
}

export function createPrimitive(type: ObjectType, init: PrimitiveInit = {}): GameObject {
  const def = PRIMITIVE_DEFS[type]
  const id = init.id ?? newId(type)
  const [w, h, d] = def.size
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: init.color ?? def.color, roughness: 0.6 }),
  )
  const [px, py, pz] = init.position ?? [0, h / 2, 0]
  mesh.position.set(px, py, pz)
  const [rx, ry, rz] = init.rotation ?? [0, 0, 0]
  mesh.rotation.set(rx, ry, rz)
  const [sx, sy, sz] = init.scale ?? [1, 1, 1]
  mesh.scale.set(sx, sy, sz)
  mesh.visible = init.visible ?? true
  mesh.userData.id = id
  const name = init.name ?? `${def.label} ${id.split('_')[1] ?? ''}`.trim()
  return { id, name, type, mesh }
}
