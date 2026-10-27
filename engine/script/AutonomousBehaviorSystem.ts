import * as THREE from 'three'
import type { World } from '../world/World'
import type { BehaviorPackageInstance, PackageScalar } from './packages'

export const AUTONOMOUS_BEHAVIOR_PACKAGE_ID = 'autonomous_agent'

export type AutonomousBehaviorMode =
  | 'idle'
  | 'wander'
  | 'patrol'
  | 'follow_player'
  | 'flee_player'
  | 'follow_object'
  | 'move_to_point'
  | 'look_at_player'

export interface AutonomousBehaviorTransition {
  instanceId: string
  ownerObjectId: string
  state: string
  events: string[]
}

interface Position3 {
  x: number
  y: number
  z: number
}

interface AgentRuntimeState {
  anchor: Position3
  destination: Position3 | null
  waitRemaining: number
  patrolDirection: 1 | -1
  randomSeed: number
  signature: string
  reached: boolean
  avoidanceSide: -1 | 0 | 1
}

type AutonomousWorld = Pick<World, 'get' | 'update' | 'terrain' | 'isObjectVisible'> & Partial<Pick<World, 'getGroundHeightAt'>>
type AutonomousObject = NonNullable<ReturnType<World['get']>>
type MovementSafetyCheck = (objectId: string, target: Position3) => boolean

const TRACKING_MODES = new Set<AutonomousBehaviorMode>([
  'follow_player',
  'flee_player',
  'follow_object',
  'look_at_player',
])

const MOVING_STATES = new Set([
  'wandering',
  'patrolling',
  'following',
  'fleeing',
  'moving_to_point',
])

const isMode = (value: PackageScalar | undefined): value is AutonomousBehaviorMode =>
  value === 'idle'
  || value === 'wander'
  || value === 'patrol'
  || value === 'follow_player'
  || value === 'flee_player'
  || value === 'follow_object'
  || value === 'move_to_point'
  || value === 'look_at_player'

const finiteNumber = (value: PackageScalar | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const planarDistance = (a: Position3, b: Position3): number =>
  Math.hypot(b.x - a.x, b.z - a.z)

const clampWorldCoordinate = (value: number): number => clamp(value, -49, 49)

function seedFrom(value: string): number {
  let seed = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index)
    seed = Math.imul(seed, 16777619)
  }
  return seed >>> 0 || 1
}

/**
 * Runtime autônomo genérico para GameObjects e entidades.
 * A navegação usa direção direta no plano XZ; ainda não usa navmesh/pathfinding.
 */
export class AutonomousBehaviorSystem {
  private readonly runtime = new Map<string, AgentRuntimeState>()

  hasRuntimeState(): boolean {
    return this.runtime.size > 0
  }

  update(input: {
    dt: number
    runtimeEnabled: boolean
    world: AutonomousWorld
    packages: BehaviorPackageInstance[]
    playerPosition: Position3
    canMoveTo?: MovementSafetyCheck
  }): AutonomousBehaviorTransition[] {
    const transitions: AutonomousBehaviorTransition[] = []
    const agents = input.packages.filter(instance => instance.packageId === AUTONOMOUS_BEHAVIOR_PACKAGE_ID)
    const presentInstanceIds = new Set(agents.map(instance => instance.id))

    if (!input.runtimeEnabled) {
      for (const instance of agents) {
        this.pushTransition(transitions, instance, 'idle', [], false)
      }
      this.runtime.clear()
      return transitions
    }

    const dt = clamp(Number.isFinite(input.dt) ? input.dt : 0, 0, 0.1)
    for (const instance of agents) {
      const object = input.world.get(instance.ownerObjectId)
      if (!object) {
        this.runtime.delete(instance.id)
        continue
      }

      if (!instance.enabled || !input.world.isObjectVisible(object)) {
        this.runtime.delete(instance.id)
        this.pushTransition(transitions, instance, 'idle', [], false)
        this.setIdleAnimationFallback(object, 'idle')
        continue
      }

      const variables = instance.variables
      const rawMode = variables.mode
      const mode: AutonomousBehaviorMode = isMode(rawMode) ? rawMode : 'wander'
      const speed = clamp(finiteNumber(variables.move_speed, 2.5), 0, 20)
      const perceptionRange = clamp(finiteNumber(variables.perception_range, 15), 0.5, 100)
      const stoppingDistance = clamp(finiteNumber(variables.stopping_distance, 1.4), 0.1, 20)
      const wanderRadius = clamp(finiteNumber(variables.wander_radius, 5), 0.5, 40)
      const patrolRadius = clamp(finiteNumber(variables.patrol_radius, 4), 0.5, 40)
      const idleDuration = clamp(finiteNumber(variables.idle_duration, 1.2), 0, 30)
      const targetObjectId = typeof variables.target_object_id === 'string' ? variables.target_object_id.trim() : ''
      const destinationX = finiteNumber(variables.destination_x, 0)
      const destinationY = finiteNumber(variables.destination_y, 0)
      const destinationZ = finiteNumber(variables.destination_z, 0)
      const signature = [
        mode, targetObjectId, destinationX, destinationY, destinationZ,
        wanderRadius, patrolRadius,
      ].join('|')

      let runtime = this.runtime.get(instance.id)
      if (!runtime || runtime.signature !== signature) {
        runtime = {
          anchor: {
            x: object.mesh.position.x,
            y: object.mesh.position.y,
            z: object.mesh.position.z,
          },
          destination: null,
          waitRemaining: 0,
          patrolDirection: 1,
          randomSeed: seedFrom(instance.id + ':' + instance.ownerObjectId),
          signature,
          reached: false,
          avoidanceSide: 0,
        }
        this.runtime.set(instance.id, runtime)
      }

      let nextState = 'idle'
      const position = object.mesh.position
      const currentPosition = { x: position.x, y: position.y, z: position.z }

      switch (mode) {
        case 'idle':
          runtime.destination = null
          runtime.reached = false
          nextState = 'idle'
          break

        case 'wander': {
          if (runtime.waitRemaining > 0) {
            runtime.waitRemaining = Math.max(0, runtime.waitRemaining - dt)
            nextState = 'waiting'
            break
          }
          if (!runtime.destination) runtime.destination = this.randomWanderDestination(runtime, wanderRadius)
          if (speed <= 0) {
            nextState = 'waiting'
            break
          }
          const result = this.moveTowards(input.world, object, runtime.destination, speed, 0.3, dt, runtime, input.canMoveTo)
          if (result.reached) {
            runtime.destination = null
            runtime.waitRemaining = idleDuration
            nextState = 'waiting'
          } else {
            nextState = result.moving ? 'wandering' : 'waiting'
          }
          break
        }

        case 'patrol': {
          if (runtime.waitRemaining > 0) {
            runtime.waitRemaining = Math.max(0, runtime.waitRemaining - dt)
            nextState = 'waiting'
            break
          }
          if (!runtime.destination) {
            runtime.destination = {
              x: clampWorldCoordinate(runtime.anchor.x + runtime.patrolDirection * patrolRadius),
              y: runtime.anchor.y,
              z: runtime.anchor.z,
            }
          }
          if (speed <= 0) {
            nextState = 'waiting'
            break
          }
          const result = this.moveTowards(input.world, object, runtime.destination, speed, 0.3, dt, runtime, input.canMoveTo)
          if (result.reached) {
            runtime.destination = null
            runtime.patrolDirection = runtime.patrolDirection === 1 ? -1 : 1
            runtime.waitRemaining = idleDuration
            nextState = 'waiting'
          } else {
            nextState = result.moving ? 'patrolling' : 'waiting'
          }
          break
        }

        case 'follow_player': {
          const distance = planarDistance(currentPosition, input.playerPosition)
          if (distance > perceptionRange) {
            nextState = 'idle'
          } else if (distance <= stoppingDistance) {
            this.faceTowards(input.world, object, input.playerPosition)
            nextState = 'watching'
          } else if (speed <= 0) {
            nextState = 'waiting'
          } else {
            const result = this.moveTowards(input.world, object, input.playerPosition, speed, stoppingDistance, dt, runtime, input.canMoveTo)
            nextState = result.moving ? 'following' : 'watching'
          }
          break
        }

        case 'flee_player': {
          const distance = planarDistance(currentPosition, input.playerPosition)
          if (distance > perceptionRange) {
            nextState = 'idle'
          } else if (speed <= 0) {
            nextState = 'waiting'
          } else {
            nextState = this.moveAway(input.world, object, input.playerPosition, speed, dt, runtime, input.canMoveTo)
              ? 'fleeing'
              : 'waiting'
          }
          break
        }

        case 'follow_object': {
          const target = targetObjectId && targetObjectId !== object.id
            ? input.world.get(targetObjectId)
            : undefined
          if (!target || !input.world.isObjectVisible(target)) {
            nextState = 'idle'
            break
          }
          const targetPosition = target.mesh.position
          const distance = planarDistance(currentPosition, targetPosition)
          if (distance > perceptionRange) {
            nextState = 'idle'
          } else if (distance <= stoppingDistance) {
            this.faceTowards(input.world, object, targetPosition)
            nextState = 'watching'
          } else if (speed <= 0) {
            nextState = 'waiting'
          } else {
            const result = this.moveTowards(input.world, object, targetPosition, speed, stoppingDistance, dt, runtime, input.canMoveTo)
            nextState = result.moving ? 'following' : 'watching'
          }
          break
        }

        case 'move_to_point': {
          if (runtime.reached) {
            nextState = 'reached'
            break
          }
          const target = { x: destinationX, y: destinationY, z: destinationZ }
          if (planarDistance(currentPosition, target) <= stoppingDistance) {
            runtime.reached = true
            nextState = 'reached'
          } else if (speed <= 0) {
            nextState = 'waiting'
          } else {
            const result = this.moveTowards(input.world, object, target, speed, stoppingDistance, dt, runtime, input.canMoveTo)
            if (result.reached) {
              runtime.reached = true
              nextState = 'reached'
            } else {
              nextState = result.moving ? 'moving_to_point' : 'waiting'
            }
          }
          break
        }

        case 'look_at_player': {
          if (planarDistance(currentPosition, input.playerPosition) <= perceptionRange) {
            this.faceTowards(input.world, object, input.playerPosition)
            nextState = 'watching'
          } else {
            nextState = 'idle'
          }
          break
        }
      }

      this.pushTransition(transitions, instance, nextState, this.eventsForTransition(mode, instance.variables.state, nextState))
    }

    for (const instanceId of this.runtime.keys()) {
      if (!presentInstanceIds.has(instanceId)) this.runtime.delete(instanceId)
    }
    return transitions
  }

  private eventsForTransition(
    mode: AutonomousBehaviorMode,
    previousValue: PackageScalar | undefined,
    nextState: string,
  ): string[] {
    const previousState = typeof previousValue === 'string' ? previousValue : 'idle'
    if (previousState === nextState) return []
    if (nextState === 'reached') return ['destination_reached']
    if (nextState === 'idle' && previousState !== 'idle') {
      return TRACKING_MODES.has(mode) ? ['target_lost'] : ['behavior_stopped']
    }
    if (nextState !== 'idle' && previousState === 'idle') {
      return TRACKING_MODES.has(mode)
        ? ['behavior_started', 'target_detected']
        : ['behavior_started']
    }
    return []
  }

  private pushTransition(
    transitions: AutonomousBehaviorTransition[],
    instance: BehaviorPackageInstance,
    nextState: string,
    events: string[],
    allowEvents = true,
  ): void {
    const previousState = typeof instance.variables.state === 'string' ? instance.variables.state : 'idle'
    if (previousState === nextState) return
    transitions.push({
      instanceId: instance.id,
      ownerObjectId: instance.ownerObjectId,
      state: nextState,
      events: allowEvents ? events : [],
    })
  }

  private randomWanderDestination(runtime: AgentRuntimeState, radius: number): Position3 {
    runtime.randomSeed = (Math.imul(runtime.randomSeed, 1664525) + 1013904223) >>> 0
    const angle = (runtime.randomSeed / 4294967296) * Math.PI * 2
    runtime.randomSeed = (Math.imul(runtime.randomSeed, 1664525) + 1013904223) >>> 0
    const distance = Math.sqrt(runtime.randomSeed / 4294967296) * radius
    return {
      x: clampWorldCoordinate(runtime.anchor.x + Math.cos(angle) * distance),
      y: runtime.anchor.y,
      z: clampWorldCoordinate(runtime.anchor.z + Math.sin(angle) * distance),
    }
  }

  private resolveGroundHeight(world: AutonomousWorld, object: AutonomousObject, x: number, z: number): number {
    const bounds = new THREE.Box3().setFromObject(object.mesh)
    const bottomOffset = bounds.isEmpty() ? 0 : object.mesh.position.y - bounds.min.y
    const currentGroundY = object.mesh.position.y - bottomOffset
    const maxStepUp = currentGroundY + 0.6

    if (world.getGroundHeightAt) return world.getGroundHeightAt(x, z, maxStepUp)
    return world.terrain.mesh.visible ? world.terrain.heightAt(x, z) : 0
  }

  private moveTowards(
    world: AutonomousWorld,
    object: AutonomousObject,
    target: Position3,
    speed: number,
    stoppingDistance: number,
    dt: number,
    runtime: AgentRuntimeState,
    canMoveTo?: MovementSafetyCheck,
  ): { moving: boolean; reached: boolean } {
    const position = object.mesh.position
    const dx = target.x - position.x
    const dz = target.z - position.z
    const distance = Math.hypot(dx, dz)
    if (distance <= stoppingDistance) return { moving: false, reached: true }
    const step = Math.min(speed * dt, Math.max(0, distance - stoppingDistance))
    if (step <= 1e-6) return { moving: false, reached: false }

    const x = clampWorldCoordinate(position.x + (dx / distance) * step)
    const z = clampWorldCoordinate(position.z + (dz / distance) * step)
    const rotationY = Math.atan2(dx, dz) * 180 / Math.PI
    const bounds = new THREE.Box3().setFromObject(object.mesh)
    const bottomOffset = bounds.isEmpty() ? 0 : position.y - bounds.min.y
    const y = this.resolveGroundHeight(world, object, x, z) + bottomOffset
    const moving = this.applyMovement(
      world,
      object,
      { x, y, z },
      rotationY,
      runtime,
      canMoveTo,
    )

    const after = object.mesh.position
    return {
      moving,
      reached: planarDistance({ x: after.x, y: after.y, z: after.z }, target) <= stoppingDistance + 1e-4,
    }
  }

  private moveAway(
    world: AutonomousWorld,
    object: AutonomousObject,
    target: Position3,
    speed: number,
    dt: number,
    runtime: AgentRuntimeState,
    canMoveTo?: MovementSafetyCheck,
  ): boolean {
    const position = object.mesh.position
    let dx = position.x - target.x
    let dz = position.z - target.z
    let distance = Math.hypot(dx, dz)
    if (distance < 1e-3) {
      runtime.randomSeed = (Math.imul(runtime.randomSeed, 1664525) + 1013904223) >>> 0
      const angle = (runtime.randomSeed / 4294967296) * Math.PI * 2
      dx = Math.cos(angle)
      dz = Math.sin(angle)
      distance = 1
    }
    const x = clampWorldCoordinate(position.x + (dx / distance) * speed * dt)
    const z = clampWorldCoordinate(position.z + (dz / distance) * speed * dt)
    const rotationY = Math.atan2(dx, dz) * 180 / Math.PI
    const bounds = new THREE.Box3().setFromObject(object.mesh)
    const bottomOffset = bounds.isEmpty() ? 0 : position.y - bounds.min.y
    const y = this.resolveGroundHeight(world, object, x, z) + bottomOffset

    return this.applyMovement(
      world,
      object,
      { x, y, z },
      rotationY,
      runtime,
      canMoveTo,
    )
  }

  /**
   * Tenta o deslocamento solicitado; se houver bloqueio, desliza por um eixo
   * ou contorna o obstáculo por uma pequena tangente consistente.
   */
  private applyMovement(
    world: AutonomousWorld,
    object: AutonomousObject,
    desired: Position3,
    rotationY: number,
    runtime: AgentRuntimeState,
    canMoveTo?: MovementSafetyCheck,
  ): boolean {
    const current = object.mesh.position
    const origin = { x: current.x, y: current.y, z: current.z }
    const direct = {
      x: clampWorldCoordinate(desired.x),
      y: desired.y,
      z: clampWorldCoordinate(desired.z),
    }
    const movedDistance = (candidate: Position3): number =>
      Math.hypot(candidate.x - origin.x, candidate.z - origin.z)
    const makeCandidate = (x: number, z: number): Position3 => {
      const clampedX = clampWorldCoordinate(x)
      const clampedZ = clampWorldCoordinate(z)
      const bounds = new THREE.Box3().setFromObject(object.mesh)
      const bottomOffset = bounds.isEmpty() ? 0 : current.y - bounds.min.y
      return {
        x: clampedX,
        y: this.resolveGroundHeight(world, object, clampedX, clampedZ) + bottomOffset,
        z: clampedZ,
      }
    }
    const isSafe = (candidate: Position3): boolean =>
      !canMoveTo || canMoveTo(object.id, candidate)

    if (movedDistance(direct) <= 1e-6) return false
    if (isSafe(direct)) {
      runtime.avoidanceSide = 0
      world.update(object.id, { x: direct.x, y: direct.y, z: direct.z, rotationY })
      return true
    }

    const dx = direct.x - origin.x
    const dz = direct.z - origin.z
    const axisCandidates = [
      makeCandidate(direct.x, origin.z),
      makeCandidate(origin.x, direct.z),
    ].filter(candidate => movedDistance(candidate) > 1e-6 && isSafe(candidate))

    if (axisCandidates.length > 0) {
      const length = Math.hypot(dx, dz) || 1
      axisCandidates.sort((a, b) => {
        const progressA = ((a.x - origin.x) * dx + (a.z - origin.z) * dz) / length
        const progressB = ((b.x - origin.x) * dx + (b.z - origin.z) * dz) / length
        return progressB - progressA
      })
      const candidate = axisCandidates[0]!
      runtime.avoidanceSide = 0
      world.update(object.id, { x: candidate.x, y: candidate.y, z: candidate.z, rotationY })
      return true
    }

    const intendedDistance = Math.hypot(dx, dz)
    if (intendedDistance <= 1e-6) return false
    const lateralX = -dz / intendedDistance
    const lateralZ = dx / intendedDistance
    const preferredSide = runtime.avoidanceSide === 0 ? 1 : runtime.avoidanceSide
    for (const side of [preferredSide, preferredSide === 1 ? -1 : 1] as const) {
      const candidate = makeCandidate(
        origin.x + lateralX * intendedDistance * side,
        origin.z + lateralZ * intendedDistance * side,
      )
      if (movedDistance(candidate) <= 1e-6 || !isSafe(candidate)) continue
      runtime.avoidanceSide = side
      world.update(object.id, { x: candidate.x, y: candidate.y, z: candidate.z, rotationY })
      return true
    }

    return false
  }

  private faceTowards(world: AutonomousWorld, object: AutonomousObject, target: Position3): void {
    const dx = target.x - object.mesh.position.x
    const dz = target.z - object.mesh.position.z
    if (Math.hypot(dx, dz) < 1e-3) return
    const yaw = Math.atan2(dx, dz)
    const delta = Math.atan2(
      Math.sin(yaw - object.mesh.rotation.y),
      Math.cos(yaw - object.mesh.rotation.y),
    )
    if (Math.abs(delta) > 0.01) world.update(object.id, { rotationY: yaw * 180 / Math.PI })
  }

  private setIdleAnimationFallback(_object: AutonomousObject, _state: string): void {
    // O ciclo do Engine sincroniza as animações quando uma transição é emitida.
  }
}

export function isAutonomousMovingState(state: string): boolean {
  return MOVING_STATES.has(state)
}
