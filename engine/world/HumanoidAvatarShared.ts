import * as THREE from 'three'
import { ANIMATION_ROLE_FALLBACKS } from './AnimationController.ts'
import { getStaticMeshCollisionData } from './StaticMeshCollider.ts'
import type { AnimationRole } from '../script/packages.ts'

export type { AnimationRole }

export const PLAYER_ID = 'player'
export const WALK_SPEED = 4.2
export const RUN_MULTIPLIER = 1.7
export const JUMP_SPEED = 6.2
export const GRAVITY = 18
export const PLAYER_RADIUS = 0.32
export const PLAYER_HEIGHT = 1.8
// Considera rampas e degraus com inclinação acentuada caminháveis, mas continua
// tratando faces quase verticais como paredes.
export const WALKABLE_SURFACE_NORMAL_Y = 0.24
// Degraus/guia de cidade podem ultrapassar o limite antigo de 0,52 u.
// A parede continua bloqueando; este limite só se aplica se houver piso caminhável acima.
export const MAX_WALK_STEP_UP = 0.68
export const STEP_UP_SPEED = 4.8
export const MAX_WALK_OFF_DROP = 1.1
export const LEDGE_EDGE_TOP_TOLERANCE = 0.045
export const PLAYER_SUPPORT_PROBE_FACTORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  // Interior probes stabilize broad floors; outer probes catch narrow step lips.
  [0.48, 0], [-0.48, 0], [0, 0.48], [0, -0.48],
  [0.82, 0], [-0.82, 0], [0, 0.82], [0, -0.82],
  [0.96, 0], [-0.96, 0], [0, 0.96], [0, -0.96],
  [0.58, 0.58], [0.58, -0.58], [-0.58, 0.58], [-0.58, -0.58],
  [0.68, 0.68], [0.68, -0.68], [-0.68, 0.68], [-0.68, -0.68],
  // Anel intermediário entre as sondas cardinais e diagonais: melhora o contato
  // com degraus estreitos, quinas chanfradas e superfícies low-poly irregulares.
  // O raio permanece dentro da pegada física para não detectar piso longe do corpo.
  [0.831, 0.344], [0.344, 0.831], [-0.344, 0.831], [-0.831, 0.344],
  [-0.831, -0.344], [-0.344, -0.831], [0.344, -0.831], [0.831, -0.344],
]
export const DODGE_SPEED = 10
export const DODGE_DURATION = 0.22
export const SLIDE_SPEED = 7.8
export const SLIDE_DURATION = 0.48
export const ROLL_SPEED = 6.8
export const ROLL_DURATION = 0.36
export const MANEUVER_COOLDOWN = 0.32
export const ROLL_COOLDOWN = 0.52
// Exact triangle traversal is too expensive for dense animated GLBs during mounting.
// Imported models over this threshold use their already-configured physical bounds.
export const MAX_EXACT_MOUNT_COLLISION_TRIANGLES = 6000

export const CIRCULAR_LOCOMOTION_SECTORS: ReadonlyArray<{
  walk: AnimationRole
  run: AnimationRole
}> = [
  { walk: 'walk', run: 'run' },
  { walk: 'walk_diagonal_right', run: 'run_diagonal_right' },
  { walk: 'walk_right', run: 'run_right' },
  { walk: 'walk_backward_diagonal_right', run: 'run_backward_diagonal_right' },
  { walk: 'walk_backward', run: 'run_backward' },
  { walk: 'walk_backward_diagonal_left', run: 'run_backward_diagonal_left' },
  { walk: 'walk_left', run: 'run_left' },
  { walk: 'walk_diagonal_left', run: 'run_diagonal_left' },
]

export const CIRCULAR_LOCOMOTION_ROLE_SET = new Set<AnimationRole>(
  CIRCULAR_LOCOMOTION_SECTORS.flatMap(sector => [sector.walk, sector.run]),
)

export function getCircularDirectionalWeights(
  actions: ReadonlyMap<string, THREE.AnimationAction>,
  forwardInput: number,
  sideInput: number,
  cameraYaw: number,
  facingYaw: number,
  running: boolean,
): Map<AnimationRole, number> {
  const result = new Map<AnimationRole, number>()
  if (Math.hypot(forwardInput, sideInput) < 1e-5) return result

  const worldX = sideInput * Math.cos(cameraYaw) - forwardInput * Math.sin(cameraYaw)
  const worldZ = -sideInput * Math.sin(cameraYaw) - forwardInput * Math.cos(cameraYaw)
  const localX = worldX * Math.cos(facingYaw) - worldZ * Math.sin(facingYaw)
  const localZ = worldX * Math.sin(facingYaw) + worldZ * Math.cos(facingYaw)
  let angle = Math.atan2(localX, localZ)
  if (angle < 0) angle += Math.PI * 2

  const sectorPosition = angle / (Math.PI / 4)
  const sectorIndex = Math.floor(sectorPosition) % CIRCULAR_LOCOMOTION_SECTORS.length
  const nextIndex = (sectorIndex + 1) % CIRCULAR_LOCOMOTION_SECTORS.length
  const fraction = sectorPosition - Math.floor(sectorPosition)
  const familyRole = running ? 'run' : 'walk'

  const resolveRole = (requested: AnimationRole, requestedIndex: number): AnimationRole | null => {
    const candidates: AnimationRole[] = [
      requested,
      ...((ANIMATION_ROLE_FALLBACKS[requested] ?? []).filter(role => role !== 'idle') as AnimationRole[]),
      familyRole as AnimationRole,
      (running ? 'walk' : 'run') as AnimationRole,
    ]
    const preferred = candidates.find(role =>
      CIRCULAR_LOCOMOTION_ROLE_SET.has(role) && actions.has(role),
    )
    if (preferred) return preferred

    // Se nem o fallback específico existir, procura o clipe mais próximo no
    // círculo. Primeiro mantém a família walk/run e só depois usa a outra família.
    const findNearest = (useRunFamily: boolean): AnimationRole | null => {
      const ordered = CIRCULAR_LOCOMOTION_SECTORS.map((_, index) => {
        const clockwise = (index - requestedIndex + CIRCULAR_LOCOMOTION_SECTORS.length) % CIRCULAR_LOCOMOTION_SECTORS.length
        const counterClockwise = (requestedIndex - index + CIRCULAR_LOCOMOTION_SECTORS.length) % CIRCULAR_LOCOMOTION_SECTORS.length
        return { index, distance: Math.min(clockwise, counterClockwise) }
      }).sort((a, b) => a.distance - b.distance)
      for (const item of ordered) {
        const candidate = useRunFamily
          ? CIRCULAR_LOCOMOTION_SECTORS[item.index]!.run
          : CIRCULAR_LOCOMOTION_SECTORS[item.index]!.walk
        if (actions.has(candidate)) return candidate
      }
      return null
    }
    return findNearest(running) ?? findNearest(!running)
  }

  const addWeight = (index: number, weight: number): void => {
    if (weight <= 1e-5) return
    const sector = CIRCULAR_LOCOMOTION_SECTORS[index]!
    const requested = running ? sector.run : sector.walk
    const actual = resolveRole(requested, index)
    if (!actual) return
    result.set(actual, (result.get(actual) ?? 0) + weight)
  }

  addWeight(sectorIndex, 1 - fraction)
  addWeight(nextIndex, fraction)

  const total = [...result.values()].reduce((sum, weight) => sum + weight, 0)
  if (total > 1e-5 && Math.abs(total - 1) > 1e-5) {
    for (const [role, weight] of result) result.set(role, weight / total)
  }
  return result
}

/**
 * Reproduz mais de um clipe simultaneamente com pesos contínuos, mantendo a fase
 * dos passos alinhada e sincronizando a escala temporal. Os clipes ausentes usam
 * fallbacks próximos, sem exigir que todo modelo possua as oito direções.
 */
export function smoothTurnYaw(currentYaw: number, targetYaw: number, dt: number, response: number): number {
  const difference = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw))
  return currentYaw + difference * (1 - Math.exp(-Math.max(0, dt) * response))
}

export type PlayerPosture = 'standing' | 'crouching' | 'prone'
export type PlayerManeuver = 'dodge' | 'slide' | 'roll' | null

/** Bounds do colisor físico, independentes da malha visual importada. */
export function getColliderBounds(mesh: THREE.Mesh): THREE.Box3 | null {
  const type = mesh.userData.colliderType
  if (type === 'none') return null

  mesh.updateWorldMatrix(true, false)
  if (type === 'mesh') {
    const staticData = getStaticMeshCollisionData(mesh)
    if (staticData) return staticData.localBounds.clone().applyMatrix4(mesh.matrixWorld)
  }
  const configuredSize = mesh.userData.colliderSize
  const hasManualSize = Array.isArray(configuredSize) &&
    configuredSize.length === 3 &&
    configuredSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
  const offsetData = mesh.userData.colliderOffset
  const offset = Array.isArray(offsetData) && offsetData.length === 3
    ? offsetData.map((value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0) as [number, number, number]
    : [0, 0, 0] as [number, number, number]

  // Em modelos importados, a raiz é apenas uma caixa proxy invisível. O modo automático
  // usa limites das malhas visuais filhas, calculados uma vez no espaço local do modelo.
  // Recalcular Box3 para cada subpasso de movimento percorria toda a hierarquia do GLB
  // repetidamente e congelava a execução com montarias de muitos nós/malhas.
  if ((type === undefined || type === 'auto') && !hasManualSize && offset.every(value => Math.abs(value) < 1e-9)) {
    if (mesh.userData.importedModel === true) {
      type CachedAutoBounds = { min: [number, number, number]; max: [number, number, number] }
      const cached = mesh.userData.importedAutoColliderLocalBounds as CachedAutoBounds | undefined
      if (
        cached &&
        Array.isArray(cached.min) && cached.min.length === 3 &&
        Array.isArray(cached.max) && cached.max.length === 3
      ) {
        return new THREE.Box3(
          new THREE.Vector3(...cached.min),
          new THREE.Vector3(...cached.max),
        ).applyMatrix4(mesh.matrixWorld)
      }

      mesh.updateWorldMatrix(true, true)
      const visualBounds = new THREE.Box3()
      const childBounds = new THREE.Box3()
      const inverseRoot = mesh.matrixWorld.clone().invert()
      const relativeMatrix = new THREE.Matrix4()
      mesh.traverse((child) => {
        if (child === mesh || !(child instanceof THREE.Mesh) || !child.visible) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        child.updateWorldMatrix(true, false)
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
        if (!child.geometry.boundingBox) return
        relativeMatrix.multiplyMatrices(inverseRoot, child.matrixWorld)
        childBounds.copy(child.geometry.boundingBox).applyMatrix4(relativeMatrix)
        visualBounds.union(childBounds)
      })
      if (!visualBounds.isEmpty()) {
        mesh.userData.importedAutoColliderLocalBounds = {
          min: visualBounds.min.toArray() as [number, number, number],
          max: visualBounds.max.toArray() as [number, number, number],
        }
        return visualBounds.applyMatrix4(mesh.matrixWorld)
      }
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    return (mesh.geometry.boundingBox?.clone() ?? new THREE.Box3()).applyMatrix4(mesh.matrixWorld)
  }

  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const sourceSize = mesh.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1)
  const size = hasManualSize
    ? new THREE.Vector3(
      Math.max(0.05, configuredSize[0]),
      Math.max(0.05, configuredSize[1]),
      Math.max(0.05, configuredSize[2]),
    )
    : sourceSize

  // O sistema de colisão do mundo também trata os colisores simplificados como
  // geometria local deslocada; este AABB é usado pelo player para movimento e pouso.
  if (type === 'sphere') {
    const radius = Math.max(size.x, size.y, size.z) * 0.5
    size.setScalar(radius * 2)
  } else if (type === 'capsule') {
    const radius = Math.max(0.025, Math.min(size.x, size.z) * 0.25)
    size.set(Math.max(size.x, radius * 2), Math.max(size.y, radius * 2), Math.max(size.z, radius * 2))
  }

  const localBounds = new THREE.Box3(
    new THREE.Vector3(-size.x / 2 + offset[0], -size.y / 2 + offset[1], -size.z / 2 + offset[2]),
    new THREE.Vector3(size.x / 2 + offset[0], size.y / 2 + offset[1], size.z / 2 + offset[2]),
  )
  return localBounds.applyMatrix4(mesh.matrixWorld)
}

