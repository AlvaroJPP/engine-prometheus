import * as THREE from 'three'

/**
 * Ensures a non-skinned Mesh root can receive sibling rig bones without losing its transform.
 * STL/PLY loaders may return a Mesh directly, so wrap it in a Group when needed.
 */
export function prepareRigRootContainer(
  current: THREE.Object3D | null,
  fallbackHost: THREE.Object3D | null,
): THREE.Object3D | null {
  if (!current || !(current instanceof THREE.Mesh) || current instanceof THREE.SkinnedMesh) return current

  const host = current.parent ?? fallbackHost
  if (!host) return current

  const wrapper = new THREE.Group()
  wrapper.name = current.name || 'RigRoot'
  wrapper.userData = { ...current.userData }
  wrapper.position.copy(current.position)
  wrapper.quaternion.copy(current.quaternion)
  wrapper.scale.copy(current.scale)
  host.add(wrapper)
  wrapper.add(current)
  current.position.set(0, 0, 0)
  current.quaternion.identity()
  current.scale.set(1, 1, 1)
  current.updateMatrix()
  wrapper.updateWorldMatrix(true, true)

  return wrapper
}
