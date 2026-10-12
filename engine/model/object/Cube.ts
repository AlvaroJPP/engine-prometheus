import * as THREE from 'three'
import { newId } from '../../lib/id'
import type { GameObject } from './GameObject'

export interface CubeInit {
  id?: string
  name?: string
  color?: number
  position?: [number, number, number]
}

export function createCube(x = 0, z = 0, init: CubeInit = {}): GameObject {
  const id = init.id ?? newId('cube')
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: init.color ?? 0x7c5cff }),
  )
  const [px, py, pz] = init.position ?? [x, 0.5, z]
  mesh.position.set(px, py, pz)
  mesh.userData.id = id
  const name = init.name ?? `Cubo ${id.split('_')[1] ?? ''}`.trim()
  return { id, name, type: 'cube', mesh }
}
