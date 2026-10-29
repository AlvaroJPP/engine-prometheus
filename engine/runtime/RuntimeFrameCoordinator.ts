import { getAnimationControllerFromObject } from '../world/AnimationController'
import { getMountPackageSettings } from '../script/packages'
import type { BehaviorPackageInstance } from '../script/packages'
import type { PointerController } from '../input/PointerController'
import type { World } from '../world/World'
import type { CollisionSystem } from '../world/CollisionSystem'
import type { HumanoidAvatar } from '../world/HumanoidAvatar'
import type { RuleEngine } from '../script/RuleEngine'
import type { OrbitCamera } from '../view/OrbitCamera'
import type { Viewport } from '../view/Viewport'
import type { ModelOcclusionSystem } from '../world/ModelOcclusionSystem'
import type { ModelLodSystem } from '../world/ModelLodSystem'

export interface RuntimeFrameDependencies {
  input: Pick<PointerController, 'update'>
  world: World
  collisions: Pick<CollisionSystem, 'update'>
  avatar: HumanoidAvatar
  logic: RuleEngine
  orbit: OrbitCamera
  modelOcclusion: ModelOcclusionSystem
  modelLod: Pick<ModelLodSystem, 'update'>
  viewport: Viewport
  gameModules: { update: (dt: number) => void }
  isRuntimeModeActive: () => boolean
  getActiveMountPackageId: () => string | null
  getLastMountMovementState: () => string | null
  setLastMountMovementState: (state: string | null) => void
  updateAutonomousBehaviors: (dt: number) => void
  updateBehaviorTrees: (dt: number) => void
  notifyBehaviorPackageChanged: (ownerObjectId: string) => void
  triggerBehaviorPackageEvent: (ownerObjectId: string, packageId: string, eventId: string) => boolean
  triggerPlayerEvent: (eventId: string, payload?: Record<string, boolean | number | string>) => boolean
  applyMountModelStates: (instance: BehaviorPackageInstance) => void
}

/** Builds the per-frame simulation pipeline, isolated from Engine's editor API. */
export function createRuntimeFrameUpdateHandler(
  dependencies: RuntimeFrameDependencies,
): (dt: number) => void {
  let lastFrameUpdateError = ''
  let lastFrameUpdateErrorAt = 0
  return (dt: number) => {
    const {
      input, world, collisions, avatar, logic, orbit, modelOcclusion, modelLod, viewport, gameModules,
    } = dependencies
    const frameStartedAt = performance.now()
    let hasRunningModelAnimation = false
    let updateFailed = false
    try {
      input.update(dt)
      // Advance each imported animation mixer once before physics so rendering and collisions stay synchronized.
      for (const object of world.list()) {
        const root = object.mesh
        if (!root.userData.importAnimationController && !root.userData.importAnimationMixer) continue
        const controller = getAnimationControllerFromObject(root)
        if (!controller) continue
        controller.update(dt)
        root.userData.importAnimationState = controller.currentState
        hasRunningModelAnimation ||= controller.isPlaying

        const previousPoseVersion = root.userData.colliderPoseVersion
        root.userData.colliderPoseVersion =
          (typeof previousPoseVersion === 'number' ? previousPoseVersion : 0) + 1
      }
      collisions.update(dependencies.isRuntimeModeActive())
      const activeMountPackageId = dependencies.getActiveMountPackageId()
      if (activeMountPackageId) {
        const currentMount = logic.listPackages().find(instance => instance.id === activeMountPackageId)
        if (currentMount?.enabled) avatar.updateMountSettings(getMountPackageSettings(currentMount))
      }
      avatar.update(dt)
      if (avatar.consumeJumpStarted()) {
        dependencies.triggerPlayerEvent('jump', {
          x: avatar.mesh.position.x,
          y: avatar.mesh.position.y,
          z: avatar.mesh.position.z,
        })
      }
      dependencies.updateAutonomousBehaviors(dt)
      dependencies.updateBehaviorTrees(dt)
      gameModules.update(dt)
      const mountedObjectId = avatar.getMountedObjectId()
      const mountedMovementState = avatar.getMountedMovementState()
      const movementPackageId = dependencies.getActiveMountPackageId()
      if (mountedObjectId && mountedMovementState && movementPackageId) {
        const mountInstance = logic.listPackages().find(instance => instance.id === movementPackageId)
        if (mountInstance && mountInstance.variables.movementState !== mountedMovementState) {
          logic.setPackageVariable(mountInstance.id, 'movementState', mountedMovementState)
          dependencies.notifyBehaviorPackageChanged(mountInstance.ownerObjectId)
          const previousMovementState = dependencies.getLastMountMovementState()
          if (previousMovementState !== null && previousMovementState !== mountedMovementState) {
            dependencies.triggerBehaviorPackageEvent(mountedObjectId, mountInstance.packageId, 'movement_changed')
          }
        }
        dependencies.setLastMountMovementState(mountedMovementState)
      } else {
        dependencies.setLastMountMovementState(null)
      }
      world.updateEnvironment(dt)
      logic.update(dependencies.isRuntimeModeActive() ? dt : 0)
      for (const instance of logic.listPackages()) {
        if (instance.packageId === 'mount') dependencies.applyMountModelStates(instance)
      }
      orbit.update()
      if (world.updateRenderDistance(orbit.camera.position)) {
        // A distance change can reveal hidden submeshes or hide occluders; refresh visibility caches.
        modelOcclusion.invalidate()
      }
      world.updateFogForCamera(orbit.camera.position)
      modelLod.update(orbit.camera.position)
      if (modelOcclusion.update(orbit.camera, world.list(), performance.now())) {
        viewport.invalidate()
      }
      world.terrain.grass.updateVisibility(
        orbit.camera.position,
        avatar.mesh.visible ? avatar.mesh.position : null,
        world.grassOcclusionRoots(),
      )
    } catch (error) {
      updateFailed = true
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      const now = performance.now()
      if (message !== lastFrameUpdateError || now - lastFrameUpdateErrorAt >= 5000) {
        console.error('[Engine] Falha ao atualizar a simulação; mantendo a renderização ativa.', error)
        lastFrameUpdateError = message
        lastFrameUpdateErrorAt = now
      }
    }
    const environment = world.getEnvironment()
    const continuousRendering = avatar.mesh.visible || environment.cycleEnabled || hasRunningModelAnimation || updateFailed
    viewport.recordUpdateDuration(performance.now() - frameStartedAt)
    viewport.render(world.scene, orbit.camera, performance.now(), continuousRendering)
  }
}
