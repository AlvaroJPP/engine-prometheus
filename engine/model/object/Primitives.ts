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
  locked?: boolean
  wireframeVisible?: boolean
  groupId?: string | null
  mass?: number
}

export function createPrimitive(type: ObjectType, init: PrimitiveInit = {}): GameObject {
  const def = PRIMITIVE_DEFS[type]
  const id = init.id ?? newId(type)
  const [w, h, d] = def.size
  const geometry = new THREE.BoxGeometry(w, h, d)
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: init.color ?? def.color, roughness: 0.6 }),
  )

  // Mostra a topologia poligonal sobre a superfície sólida, como uma malha de modelagem 3D.
  // WireframeGeometry expõe as arestas dos triângulos que formam as faces do objeto.
  const polygonGeometry = new THREE.WireframeGeometry(geometry)
  const polygonMaterial = new THREE.LineBasicMaterial({
    color: 0x252832,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  })
  const polygons = new THREE.LineSegments(polygonGeometry, polygonMaterial)
  polygons.name = 'polygon-wireframe'
  polygons.userData.editorOverlay = true
  polygons.renderOrder = 1
  polygons.visible = init.wireframeVisible ?? true
  mesh.add(polygons)

  const [px, py, pz] = init.position ?? [0, h / 2, 0]
  mesh.position.set(px, py, pz)
  const [rx, ry, rz] = init.rotation ?? [0, 0, 0]
  mesh.rotation.set(rx, ry, rz)
  const [sx, sy, sz] = init.scale ?? [1, 1, 1]
  mesh.scale.set(sx, sy, sz)
  mesh.visible = init.visible ?? true
  mesh.userData.id = id
  mesh.userData.locked = init.locked ?? false
  mesh.userData.groupId = init.groupId ?? null
  mesh.userData.wireframeVisible = init.wireframeVisible ?? true
  mesh.userData.mass = Number.isFinite(init.mass) ? Math.max(0, init.mass as number) : 1
  const name = init.name ?? `${def.label} ${id.split('_')[1] ?? ''}`.trim()
  return { id, name, type, mesh }
}
