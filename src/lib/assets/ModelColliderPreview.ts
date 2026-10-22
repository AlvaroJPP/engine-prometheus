import * as THREE from 'three'
import { getStaticMeshCollisionData } from '../../../engine/world/StaticMeshCollider.ts'
import { createStaticColliderPreviewGeometry } from './ColliderPreviewGeometry'

export type ModelColliderPreviewType = 'box' | 'sphere' | 'capsule' | 'mesh' | 'none'

export interface CreateModelColliderPreviewOptions {
  model: THREE.Object3D
  type: ModelColliderPreviewType
  size: readonly [number, number, number]
  offset: readonly [number, number, number]
  selectedPart?: THREE.Object3D
}

export interface ModelColliderPreviewResult {
  preview: THREE.LineSegments | null
  notice: string
}

function createWireframe(
  geometry: THREE.BufferGeometry,
  opacity: number,
): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geometry)
  geometry.dispose()
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x65e6a0, depthTest: false, transparent: true, opacity }),
  )
  line.name = 'import-collider-preview'
  line.renderOrder = 1000
  return line
}

/** Cria o contorno de prévia para os formatos de colisor do importador. */
export function createModelColliderPreview(
  options: CreateModelColliderPreviewOptions,
): ModelColliderPreviewResult {
  const { model, type, offset, selectedPart } = options
  if (type === 'none') return { preview: null, notice: '' }

  if (type === 'mesh') {
    const collisionData = getStaticMeshCollisionData(model)
    if (!collisionData) {
      return {
        preview: null,
        notice: 'Não foi possível preparar a malha estática. Confira se o modelo contém peças estáticas e se não ultrapassa 5 milhões de triângulos. Partes animadas não entram neste colisor.',
      }
    }
    const previewGeometry = createStaticColliderPreviewGeometry(collisionData.geometry)
    const notice = `Malha pronta: ${collisionData.partCount} partes estáticas · ${collisionData.triangleCount.toLocaleString('pt-BR')} triângulos${previewGeometry.sampled ? ' · contorno amostrado para manter a prévia fluida' : ''}.`
    model.updateWorldMatrix(true, true)
    const line = new THREE.LineSegments(
      previewGeometry.geometry,
      new THREE.LineBasicMaterial({ color: 0x65e6a0, depthTest: false, transparent: true, opacity: 0.72 }),
    )
    line.name = 'import-collider-preview'
    line.renderOrder = 1000
    line.matrixAutoUpdate = false
    line.matrix.copy(model.matrixWorld)
    line.matrixWorldNeedsUpdate = true
    return { preview: line, notice }
  }

  const [width, height, depth] = options.size.map(value => Math.max(0.05, value))
  let geometry: THREE.BufferGeometry
  if (type === 'sphere') {
    geometry = new THREE.IcosahedronGeometry(Math.max(width, height, depth) / 2, 2)
  } else if (type === 'capsule') {
    const radius = Math.max(0.025, Math.min(width, depth) / 4)
    geometry = new THREE.CapsuleGeometry(radius, Math.max(0, height - radius * 2), 4, 8)
    geometry.scale(width / Math.max(radius * 2, 0.05), 1, depth / Math.max(radius * 2, 0.05))
  } else {
    geometry = new THREE.BoxGeometry(width, height, depth)
  }
  geometry.translate(offset[0], offset[1], offset[2])
  const line = createWireframe(geometry, 0.98)

  if (selectedPart) {
    const partBounds = new THREE.Box3().setFromObject(selectedPart)
    if (!partBounds.isEmpty()) line.position.copy(partBounds.getCenter(new THREE.Vector3()))
  }

  return { preview: line, notice: '' }
}

/** Remove uma prévia do cenário e libera somente os recursos que ela possui. */
export function disposeModelColliderPreview(
  scene: THREE.Scene | null | undefined,
  preview: THREE.LineSegments | null,
): void {
  if (!preview) return
  scene?.remove(preview)
  preview.geometry.dispose()
  const material = preview.material
  if (Array.isArray(material)) material.forEach(item => item.dispose())
  else material.dispose()
}
