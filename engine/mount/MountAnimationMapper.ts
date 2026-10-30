import * as THREE from 'three'
import { AnimationController, createAnimationActionMap, inferAnimationRole, ANIMATION_ROLE_FALLBACKS } from '../world/AnimationController.ts'
import type { AnimationRole } from '../script/packages.ts'
import type { MountAnimationMapping, MountAnimationRole, MountConfig } from './MountPoint.ts'

/**
 * Mapeia roles de animação genéricos para clipes específicos do modelo
 * Permite que qualquer modelo funcione com o sistema de montaria sem
 * exigir convenções de nomenclatura específicas
 */
export class MountAnimationMapper {
  private mountController: AnimationController | null = null
  private playerController: AnimationController | null = null
  private mapping: MountAnimationMapping
  private mountModelRoot: THREE.Object3D | null = null

  constructor(mapping: MountAnimationMapping = createDefaultAnimationMapping()) {
    this.mapping = mapping
  }

  /**
   * Inicializa os controladores de animação para a montaria e o jogador
   */
  initialize(mountRoot: THREE.Object3D, playerRoot: THREE.Object3D): void {
    this.mountModelRoot = mountRoot

    // Inicializa controlador da montaria
    const mountMixer = mountRoot.userData.importAnimationMixer as THREE.AnimationMixer | undefined
    if (mountMixer) {
      const mountClips = Array.from(mountRoot.userData.importAnimationClips?.values() ?? []) as THREE.AnimationClip[]
      const mountActions = this.createActionMapForModel(mountClips, this.mapping.mountClipNames)
      this.mountController = new AnimationController(mountMixer, mountActions, {
        genericFallback: this.mapping.useGenericFallback,
      })
    }

    // Inicializa controlador do jogador
    const playerMixer = playerRoot.userData.importAnimationMixer as THREE.AnimationMixer | undefined
    if (playerMixer) {
      const playerClips = Array.from(playerRoot.userData.importAnimationClips?.values() ?? []) as THREE.AnimationClip[]
      const playerActions = this.createActionMapForModel(playerClips, this.mapping.playerClipNames)
      this.playerController = new AnimationController(playerMixer, playerActions, {
        genericFallback: this.mapping.useGenericFallback,
      })
    }
  }

  /**
   * Cria mapa de ações para um modelo usando mapeamento explícito + inferência
   */
  private createActionMapForModel(
    clips: readonly THREE.AnimationClip[],
    explicitMapping: Partial<Record<MountAnimationRole, string>>
  ): Map<string, THREE.AnimationAction> {
    const mixer = this.mountModelRoot?.userData.importAnimationMixer as THREE.AnimationMixer
    if (!mixer) return new Map()

    // Primeiro, cria mapa por inferência de nome
    const inferredMap = createAnimationActionMap(mixer, clips, undefined, {
      genericFallback: this.mapping.useGenericFallback,
    })

    // Depois, aplica mapeamento explícito (override)
    const explicitRoles: Record<string, string> = {}
    for (const [role, clipName] of Object.entries(explicitMapping)) {
      // Encontra o índice do clipe pelo nome
      const clipIndex = clips.findIndex(c => c.name === clipName)
      if (clipIndex >= 0) {
        explicitRoles[String(clipIndex)] = role
      }
    }

    // Recria mapa com roles explícitos
    if (Object.keys(explicitRoles).length > 0) {
      return createAnimationActionMap(mixer, clips, explicitRoles as Record<string, AnimationRole>, {
        genericFallback: this.mapping.useGenericFallback,
      })
    }

    return inferredMap
  }

  /**
   * Toca animação de transição de montagem (one-shot)
   */
  playMountTransition(isPlayer: boolean, restart = true): boolean {
    const role = isPlayer
      ? this.mapping.player_transition_mount ?? 'player_transition_mount'
      : this.mapping.mount_transition_mount ?? 'mount_transition_mount'
    const controller = isPlayer ? this.playerController : this.mountController
    if (!controller) return false

    const mappedRole = this.resolveRole(role as MountAnimationRole, controller)
    if (!mappedRole) return false

    return controller.playOneShot(mappedRole, restart, false)
  }

  /**
   * Toca animação de transição de desmontagem (one-shot)
   */
  playDismountTransition(isPlayer: boolean, restart = true): boolean {
    const role = isPlayer
      ? this.mapping.player_transition_dismount ?? 'player_transition_dismount'
      : this.mapping.mount_transition_dismount ?? 'mount_transition_dismount'
    const controller = isPlayer ? this.playerController : this.mountController
    if (!controller) return false

    const mappedRole = this.resolveRole(role as MountAnimationRole, controller)
    if (!mappedRole) return false

    return controller.playOneShot(mappedRole, restart, false)
  }

  /**
   * Define estado de movimento da montaria
   */
  setMountMovementState(state: MountAnimationRole, blend = true): boolean {
    if (!this.mountController) return false

    const mappedRole = this.resolveRole(state, this.mountController)
    if (!mappedRole) return false

    if (blend) {
      this.mountController.setState(mappedRole)
    } else {
      this.mountController.playOneShot(mappedRole, true)
    }
    return true
  }

  /**
   * Define pesos direcionais para blend de movimento da montaria
   */
  setMountBlendWeights(
    weights: ReadonlyMap<string, number>,
    cycleSpeedFactor = 1,
    preferredRole = ''
  ): string | null {
    if (!this.mountController) return null

    // Converte MountAnimationRole para AnimationRole para o controlador
    const convertedWeights = new Map<string, number>()
    for (const [role, weight] of weights) {
      convertedWeights.set(this.mapMountRoleToAnimationRole(role as MountAnimationRole), weight)
    }

    return this.mountController.setBlendWeights(convertedWeights, cycleSpeedFactor, preferredRole)
  }

  /**
   * Define estado de movimento do jogador montado
   */
  setPlayerMountState(state: MountAnimationRole): boolean {
    if (!this.playerController) return false

    const mappedRole = this.resolveRole(state, this.playerController)
    if (!mappedRole) return false

    this.playerController.setState(mappedRole)
    return true
  }

  /**
   * Toca one-shot no jogador montado
   */
  playPlayerOneShot(role: MountAnimationRole, restart = true, holdAtEnd = false): boolean {
    if (!this.playerController) return false

    const mappedRole = this.resolveRole(role, this.playerController)
    if (!mappedRole) return false

    return this.playerController.playOneShot(mappedRole, restart, holdAtEnd)
  }

  /**
   * Atualiza ambos controladores
   */
  update(deltaSeconds: number): boolean {
    let playing = false
    if (this.mountController) {
      playing = this.mountController.update(deltaSeconds) || playing
    }
    if (this.playerController) {
      playing = this.playerController.update(deltaSeconds) || playing
    }
    return playing
  }

  /**
   * Resolve um role de montaria para um role real disponível no controlador
   */
  private resolveRole(requestedRole: MountAnimationRole, controller: AnimationController): string | null {
    // Tenta role direto
    if (controller.hasRole(requestedRole)) return requestedRole

    // Tenta fallbacks específicos de montaria
    const fallbacks = MOUNT_ANIMATION_ROLE_FALLBACKS[requestedRole] ?? []
    for (const fallback of fallbacks) {
      if (controller.hasRole(fallback)) return fallback
    }

    // Tenta mapear para role de animação base e usar fallbacks padrão
    const baseRole = this.mapMountRoleToAnimationRole(requestedRole)
    if (controller.hasRole(baseRole)) return baseRole

    for (const fallback of ANIMATION_ROLE_FALLBACKS[baseRole as AnimationRole] ?? []) {
      if (controller.hasRole(fallback)) return fallback
    }

    // Fallback genérico
    if (this.mapping.useGenericFallback && controller.hasRole('__fallback__')) {
      return '__fallback__'
    }

    return null
  }

  /**
   * Mapeia MountAnimationRole para AnimationRole base
   */
  private mapMountRoleToAnimationRole(role: MountAnimationRole): AnimationRole {
    const mapping: Partial<Record<MountAnimationRole, AnimationRole>> = {
      // Mount roles
      mount_idle: 'idle',
      mount_walk: 'walk',
      mount_run: 'run',
      mount_sprint: 'run',
      mount_turn_left: 'walk_left',
      mount_turn_right: 'walk_right',
      mount_jump_start: 'jump',
      mount_jump_air: 'jump',
      mount_jump_land: 'jump',
      mount_dash: 'dodge',
      mount_attack: 'primary_action',
      mount_special: 'ability_1',
      mount_emote: 'emote',
      mount_death: 'death',
      // Player mounted roles
      player_mount_idle: 'idle',
      player_mount_walk: 'walk',
      player_mount_run: 'run',
      player_mount_turn_left: 'walk_left',
      player_mount_turn_right: 'walk_right',
      player_mount_jump: 'jump',
      player_mount_action: 'primary_action',
      // Transitions
      mount_transition_mount: 'mount',
      mount_transition_dismount: 'dismount',
      player_transition_mount: 'mount',
      player_transition_dismount: 'dismount',
    }

    return mapping[role] ?? 'idle'
  }

  /**
   * Obtém o controlador da montaria
   */
  getMountController(): AnimationController | null {
    return this.mountController
  }

  /**
   * Obtém o controlador do jogador
   */
  getPlayerController(): AnimationController | null {
    return this.playerController
  }

  /**
   * Limpa referências
   */
  dispose(): void {
    this.mountController?.dispose()
    this.playerController?.dispose()
    this.mountController = null
    this.playerController = null
    this.mountModelRoot = null
  }
}

/**
 * Fallbacks específicos para roles de montaria
 */
const MOUNT_ANIMATION_ROLE_FALLBACKS: Partial<Record<MountAnimationRole, MountAnimationRole[]>> = {
  mount_sprint: ['mount_run', 'mount_walk', 'mount_idle'],
  mount_run: ['mount_walk', 'mount_idle'],
  mount_walk: ['mount_idle'],
  mount_turn_left: ['mount_walk', 'mount_idle'],
  mount_turn_right: ['mount_walk', 'mount_idle'],
  mount_jump_air: ['mount_jump_start', 'mount_idle'],
  mount_jump_land: ['mount_jump_air', 'mount_jump_start', 'mount_idle'],
  mount_dash: ['mount_run', 'mount_walk', 'mount_idle'],
  mount_attack: ['mount_idle'],
  mount_special: ['mount_idle'],
  mount_emote: ['mount_idle'],
  mount_death: ['mount_idle'],
  player_mount_run: ['player_mount_walk', 'player_mount_idle'],
  player_mount_walk: ['player_mount_idle'],
  player_mount_turn_left: ['player_mount_walk', 'player_mount_idle'],
  player_mount_turn_right: ['player_mount_walk', 'player_mount_idle'],
  player_mount_jump: ['player_mount_idle'],
  player_mount_action: ['player_mount_idle'],
}

/**
 * Cria mapeamento de animação padrão
 */
export function createDefaultAnimationMapping(): MountAnimationMapping {
  return {
    mountClipNames: {
      mount_idle: 'idle',
      mount_walk: 'walk',
      mount_run: 'run',
      mount_sprint: 'sprint',
      mount_turn_left: 'turn_left',
      mount_turn_right: 'turn_right',
      mount_jump_start: 'jump_start',
      mount_jump_air: 'jump_air',
      mount_jump_land: 'jump_land',
      mount_dash: 'dash',
      mount_attack: 'attack',
      mount_special: 'special',
      mount_emote: 'emote',
      mount_death: 'death',
    },
    playerClipNames: {
      player_mount_idle: 'mount_idle',
      player_mount_walk: 'mount_walk',
      player_mount_run: 'mount_run',
      player_mount_turn_left: 'mount_turn_left',
      player_mount_turn_right: 'mount_turn_right',
      player_mount_jump: 'mount_jump',
      player_mount_action: 'mount_action',
    },
    mount_transition_mount: 'mount_transition_mount',
    player_transition_mount: 'player_transition_mount',
    mount_transition_dismount: 'mount_transition_dismount',
    player_transition_dismount: 'player_transition_dismount',
    useGenericFallback: true,
  }
}

/**
 * Cria mapeamento de animação a partir de configuração de pacote
 */
export function createAnimationMappingFromConfig(config: MountConfig): MountAnimationMapping {
  const mapping = createDefaultAnimationMapping()

  if (config.animationMapping) {
    return {
      ...mapping,
      ...config.animationMapping,
      mountClipNames: { ...mapping.mountClipNames, ...config.animationMapping.mountClipNames },
      playerClipNames: { ...mapping.playerClipNames, ...config.animationMapping.playerClipNames },
    }
  }

  return mapping
}

/**
 * Utilitário para extrair clipes de animação de um modelo importado
 */
export function extractAnimationClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const clips: THREE.AnimationClip[] = []
  root.traverse((node) => {
    if (node.userData.importAnimationClips) {
      for (const clip of node.userData.importAnimationClips.values()) {
        clips.push(clip)
      }
    }
  })
  return clips
}

/**
 * Utilitário para detectar roles disponíveis em um modelo
 */
export function detectAvailableMountRoles(root: THREE.Object3D): Set<MountAnimationRole> {
  const clips = extractAnimationClips(root)
  const roles = new Set<MountAnimationRole>()

  for (const clip of clips) {
    const role = inferAnimationRole(clip.name)
    if (role && role !== 'ignore') {
      roles.add(role as MountAnimationRole)
    }
  }

  return roles
}