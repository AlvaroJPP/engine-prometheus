import { DEFAULT_MODEL_CONTROL_BINDINGS, getMountPackageSettings } from '../script/packages'
import type { ControlMapBindings } from '../input/ControlMaps'
import type { World } from '../world/World'
import type { HumanoidAvatar } from '../world/HumanoidAvatar'
import type { RuleEngine } from '../script/RuleEngine'

export interface RuntimeKeyboardDependencies {
  isRuntimeActive: () => boolean
  playerControlBindings: ControlMapBindings
  avatar: HumanoidAvatar
  world: World
  logic: RuleEngine
  gameModules: { dispatchKeyDown: (event: KeyboardEvent) => boolean }
  getActiveMountPackageId: () => string | null
  setActiveMountPackageId: (id: string | null) => void
  getLastMountMovementState: () => string | null
  setLastMountMovementState: (state: string | null) => void
  notifyBehaviorPackageChanged: (ownerObjectId: string) => void
  triggerBehaviorPackageEvent: (ownerObjectId: string, packageId: string, eventId: string) => boolean
}

/** Handles runtime keyboard input, mount interactions and dispatch to generic game modules/scripts. */
export function handleRuntimeKeyDown(event: KeyboardEvent, dependencies: RuntimeKeyboardDependencies): void {
  const {
    playerControlBindings, avatar, world, logic, gameModules,
  } = dependencies
  if (!dependencies.isRuntimeActive() || event.repeat || event.metaKey) return

  const target = event.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
  const modifierKey = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(event.code)
  if ((event.ctrlKey || event.altKey) && !modifierKey) return

  const actionKeys = [
    playerControlBindings.primaryAction,
    playerControlBindings.secondaryAction,
    playerControlBindings.inventory,
    playerControlBindings.useItem,
    playerControlBindings.reload,
    playerControlBindings.ability1,
    playerControlBindings.ability2,
    playerControlBindings.ability3,
    playerControlBindings.ability4,
    playerControlBindings.emote,
  ]
  if (actionKeys.includes(event.code)) event.preventDefault()

  if (avatar.isMounted()) {
    const activeMountPackageId = dependencies.getActiveMountPackageId()
    const packageInstance = activeMountPackageId
      ? logic.listPackages().find(instance => instance.id === activeMountPackageId)
      : undefined
    const interactionKey = packageInstance ? getMountPackageSettings(packageInstance).interactionKey : 'KeyE'
    if (event.code === playerControlBindings.interact || (interactionKey !== DEFAULT_MODEL_CONTROL_BINDINGS.interact && event.code === interactionKey)) {
      const mountedObjectId = avatar.dismount()
      if (packageInstance) {
        logic.setPackageVariable(packageInstance.id, 'mounted', false)
        logic.setPackageVariable(packageInstance.id, 'movementState', 'idle')
        dependencies.notifyBehaviorPackageChanged(packageInstance.ownerObjectId)
        if (mountedObjectId) {
          dependencies.triggerBehaviorPackageEvent(mountedObjectId, packageInstance.packageId, 'dismounted')
        }
        logic.triggerKeyPressed(event.code)
      }
      dependencies.setActiveMountPackageId(null)
      dependencies.setLastMountMovementState(null)
      event.preventDefault()
      return
    }
  } else {
    const playerPosition = avatar.mesh.position
    const candidates = logic.listPackages()
      .filter(instance => instance.enabled && instance.packageId === 'mount')
      .map(instance => {
        const object = world.get(instance.ownerObjectId)
        const settings = getMountPackageSettings(instance)
        const distance = object
          ? Math.hypot(object.mesh.position.x - playerPosition.x, object.mesh.position.z - playerPosition.z)
          : Number.POSITIVE_INFINITY
        return { instance, object, settings, distance }
      })
      .filter(candidate =>
        candidate.object !== undefined && world.isObjectVisible(candidate.object) &&
        (event.code === playerControlBindings.interact || (candidate.settings.interactionKey !== DEFAULT_MODEL_CONTROL_BINDINGS.interact && event.code === candidate.settings.interactionKey)) &&
        candidate.distance <= candidate.settings.interactionRadius,
      )
      .sort((a, b) => a.distance - b.distance)

    for (const candidate of candidates) {
      if (!candidate.object) continue
      dependencies.triggerBehaviorPackageEvent(candidate.instance.ownerObjectId, candidate.instance.packageId, 'interact')
      const currentInstance = logic.listPackages().find(instance => instance.id === candidate.instance.id)
      if (!currentInstance?.enabled || !world.isObjectVisible(candidate.object)) continue
      const currentSettings = getMountPackageSettings(currentInstance)
      if (!avatar.mount(candidate.object.mesh, currentSettings)) continue
      dependencies.setActiveMountPackageId(currentInstance.id)
      const movementState = avatar.getMountedMovementState()
      dependencies.setLastMountMovementState(movementState)
      logic.setPackageVariable(currentInstance.id, 'mounted', true)
      logic.setPackageVariable(currentInstance.id, 'movementState', movementState ?? 'idle')
      dependencies.notifyBehaviorPackageChanged(currentInstance.ownerObjectId)
      dependencies.triggerBehaviorPackageEvent(currentInstance.ownerObjectId, currentInstance.packageId, 'mounted')
      logic.triggerKeyPressed(event.code)
      event.preventDefault()
      return
    }
  }

  const moduleHandled = gameModules.dispatchKeyDown(event)
  const executed = logic.triggerKeyPressed(event.code)
  if (executed || moduleHandled) event.preventDefault()
}
