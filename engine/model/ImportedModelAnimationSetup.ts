import * as THREE from 'three'
import { AnimationController, createAnimationActionMap } from '../world/AnimationController'
import type { AnimationRole } from '../script/packages'

export interface ImportedModelAnimationSetup {
  explicitRoles: Record<string, AnimationRole> | undefined
  animationMixer: THREE.AnimationMixer | undefined
  animationController: AnimationController | undefined
  animationFallbackAction: THREE.AnimationAction | undefined
  animationActions: Partial<Record<AnimationRole, THREE.AnimationAction>>
}

/** Builds the shared animation controller for an imported model, without coupling it to Engine. */
export function setupImportedModelAnimations(
  model: THREE.Object3D,
  name: string,
): ImportedModelAnimationSetup {
  const animationClips = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
  const explicitRoles = model.userData.importAnimationRoles as Record<string, AnimationRole> | undefined
  let animationMixer: THREE.AnimationMixer | undefined
  let animationController: AnimationController | undefined
  let animationFallbackAction: THREE.AnimationAction | undefined
  let animationActions: Partial<Record<AnimationRole, THREE.AnimationAction>> = {}
  if (animationClips.length > 0) {
    animationMixer = new THREE.AnimationMixer(model)
    const actionMap = createAnimationActionMap(animationMixer, animationClips, explicitRoles, {
      genericFallback: !explicitRoles,
    })
    const startingRole = [
      'idle', 'walk', 'run',
      'walk_diagonal_left', 'walk_diagonal_right',
      'walk_left', 'walk_right',
      'walk_backward', 'run_backward',
      'walk_backward_diagonal_left', 'walk_backward_diagonal_right',
      'run_diagonal_left', 'run_diagonal_right',
      'run_left', 'run_right',
      'run_backward_diagonal_left', 'run_backward_diagonal_right',
      '__fallback__',
    ].find(role => actionMap.has(role))
    animationController = new AnimationController(animationMixer, actionMap, {
      genericFallback: actionMap.has('__fallback__'),
    })
    if (startingRole) animationController.setState(startingRole)
    animationActions = Object.fromEntries(actionMap) as Partial<Record<AnimationRole, THREE.AnimationAction>>
    animationFallbackAction = actionMap.get('__fallback__')
    console.info('[Engine] Animações do componente:', {
      name,
      initialClip: startingRole ? actionMap.get(startingRole)?.getClip().name : '(sem estado contínuo mapeado)',
      availableClips: animationClips.map((clip) => clip.name),
      mappedRoles: explicitRoles ?? 'automático por nome',
    })
  }
  return { explicitRoles, animationMixer, animationController, animationFallbackAction, animationActions }
}
