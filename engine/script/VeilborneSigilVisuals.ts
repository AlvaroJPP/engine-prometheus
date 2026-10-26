import * as THREE from 'three'
import type { VeilborneRuntimeSigil } from './VeilborneCombat'

/** Cria a representação visual de um sigilo colocado no cenário. */
export function createVeilborneSigilVisual(
  sigil: VeilborneRuntimeSigil,
  position: THREE.Vector3,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'VEILBORNE_SIGIL_' + sigil.id
  group.position.copy(position)
  const radius = Math.max(0.65, sigil.radius)
  const material = new THREE.MeshBasicMaterial({
    color: sigil.visualColor,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const outerRing = new THREE.Mesh(new THREE.RingGeometry(radius * 0.9, radius, 48), material)
  outerRing.rotation.x = -Math.PI / 2
  outerRing.renderOrder = 15
  group.add(outerRing)

  const innerRing = new THREE.Mesh(new THREE.RingGeometry(radius * 0.42, radius * 0.46, 32), material)
  innerRing.rotation.x = -Math.PI / 2
  innerRing.renderOrder = 15
  group.add(innerRing)

  const sides = sigil.shape === 'triangle' ? 3 : sigil.shape === 'square' ? 4 : sigil.shape === 'hexagon' ? 6 : 12
  const points: THREE.Vector3[] = []
  const markerRadius = Math.max(0.3, radius * 0.32)
  for (let index = 0; index < sides; index += 1) {
    const angle = Math.PI * 2 * index / sides + Math.PI / 2
    points.push(new THREE.Vector3(Math.cos(angle) * markerRadius, 0.02, Math.sin(angle) * markerRadius))
  }
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: sigil.visualColor, transparent: true, opacity: 0.85 }),
  )
  outline.renderOrder = 16
  group.add(outline)
  return group
}

/** Cria a esfera visual da proteção (ward) em torno do jogador. */
export function createVeilborneWardMesh(
  playerPosition: THREE.Vector3,
  color: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 16, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      wireframe: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  mesh.position.copy(playerPosition).add(new THREE.Vector3(0, 0.9, 0))
  mesh.renderOrder = 18
  return mesh
}

/** Libera geometrias e materiais criados para um visual de sigilo. */
export function disposeVeilborneVisual(visual: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  visual.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
      geometries.add(child.geometry)
      if (Array.isArray(child.material)) child.material.forEach(material => materials.add(material))
      else materials.add(child.material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}
