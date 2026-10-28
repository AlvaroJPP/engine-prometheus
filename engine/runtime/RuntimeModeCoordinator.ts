import * as THREE from 'three'
import type { EditorState } from '../EditorState'
import type { PointerController } from '../input/PointerController'
import type { RuleEngine } from '../script/RuleEngine'
import { removeTransientScriptObjects } from '../script/TransientScriptObjectCleanup'
import type { GameModuleRegistry } from './GameModuleRegistry'
import type { OrbitCamera } from '../view/OrbitCamera'
import type { Viewport } from '../view/Viewport'
import type { HumanoidAvatar } from '../world/HumanoidAvatar'
import type { World } from '../world/World'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'

type CameraState = ReturnType<OrbitCamera['getState']>

export interface RuntimeModeDependencies {
  avatar: HumanoidAvatar
  orbit: OrbitCamera
  input: Pick<PointerController, 'setRuntimeMode'>
  world: World
  logic: RuleEngine
  gameModules: Pick<GameModuleRegistry, 'start' | 'stop'>
  transformControls: TransformControls
  state: Pick<EditorState, 'tool'>
  viewport: Pick<Viewport, 'invalidate'>
  pressedMouseBindings: Map<string, string>
  isRuntimeModeActive: () => boolean
  setRuntimeModeActive: (active: boolean) => void
  getCameraStateBeforeRun: () => CameraState | null
  setCameraStateBeforeRun: (state: CameraState | null) => void
  getActiveMountPackageId: () => string | null
  dismountActiveMount: () => void
  emitTool: () => void
}

/** Switches between editor and gameplay runtime modes without owning game-specific rules. */
export function configureRuntimeMode(enabled: boolean, dependencies: RuntimeModeDependencies): void {
  const {
    avatar, orbit, input, world, logic, gameModules, transformControls, state, viewport, pressedMouseBindings,
  } = dependencies
  if (enabled) {
    if (dependencies.getCameraStateBeforeRun()) return
    dependencies.setRuntimeModeActive(true)
    dependencies.setCameraStateBeforeRun(orbit.getState())
    orbit.setFirstPersonMode(false)
    avatar.setFirstPersonMode(false)
    const spawn = world.list().find(object =>
      object.name === 'Plataforma de Spawn' || object.mesh.userData.playerSpawn === true,
    )
    if (spawn) {
      spawn.mesh.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(spawn.mesh)
      avatar.mesh.position.set(spawn.mesh.position.x, bounds.max.y + 0.03, spawn.mesh.position.z)
      avatar.resetVerticalState()
    } else {
      avatar.reset()
    }
    avatar.mesh.visible = true
    avatar.setEnabled(true)
    orbit.target.set(avatar.mesh.position.x, avatar.mesh.position.y + 0.9, avatar.mesh.position.z)
    orbit.distance = 10
    input.setRuntimeMode(true)
    gameModules.start()
    transformControls.detach()
    transformControls.enabled = false
    viewport.invalidate()
    return
  }

  gameModules.stop()
  logic.restoreRuntimeWorldChanges()
  for (const objectId of removeTransientScriptObjects(world)) {
    logic.removeObjectVariables(objectId)
  }
  dependencies.setRuntimeModeActive(false)
  for (const code of pressedMouseBindings.values()) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }))
  }
  pressedMouseBindings.clear()
  input.setRuntimeMode(false)
  if (avatar.isMounted() || dependencies.getActiveMountPackageId()) dependencies.dismountActiveMount()
  avatar.setEnabled(false)
  avatar.mesh.visible = false
  avatar.setFirstPersonMode(false)
  const cameraState = dependencies.getCameraStateBeforeRun()
  if (cameraState) {
    orbit.restore(cameraState)
    dependencies.setCameraStateBeforeRun(null)
  }
  transformControls.enabled = true
  const selectedId = world.getSelectedId()
  const selected = selectedId ? world.get(selectedId) : undefined
  if (state.tool === 'select' && selected && selected.mesh.userData.locked !== true) {
    transformControls.attach(selected.mesh)
  } else {
    transformControls.detach()
  }
  dependencies.emitTool()
}
