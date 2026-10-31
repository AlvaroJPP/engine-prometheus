import * as THREE from 'three'
import type { GameObject } from '../../model/object/GameObject'

export function isPlatformSeamPiece(object: GameObject): boolean {
  if (object.type === 'platform') return true

  const mesh = object.mesh
  if (object.type !== 'cube' || mesh.userData.importedModel === true) return false
  const inclined = Math.abs(mesh.rotation.x) > 0.02 || Math.abs(mesh.rotation.z) > 0.02
  if (!inclined) return false

  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const localSize = mesh.geometry.boundingBox?.getSize(new THREE.Vector3())
  if (!localSize) return false

  // Cubos de tamanho comum continuam sendo obstáculos. Um cubo só conta como
  // segmento de rampa quando foi alongado horizontalmente para formar o piso.
  const horizontalLength = Math.max(
    localSize.x * Math.abs(mesh.scale.x),
    localSize.z * Math.abs(mesh.scale.z),
  )
  return horizontalLength >= 1.5
}

export function isPlatformPair(a: GameObject, b: GameObject): boolean {
  return isPlatformSeamPiece(a) && isPlatformSeamPiece(b)
}
