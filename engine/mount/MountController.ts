import * as THREE from 'three'
import { MountSystem } from './MountSystem.ts'
import { PhysicsWorld } from '../physics/PhysicsWorld.ts'
import type { World } from '../world/World.ts'
import type { MountPoint, MountConfig, MountState, MountResult, DismountResult, MountBehaviorConfig, MountControlBindings, MountSystemContext, MountInput } from './MountPoint.ts'

/**
 * Controlador de alto nível para montaria
 * Integra com o sistema de input, avatar e script
 */
export class MountController {
  private mountSystem: MountSystem
  private context: MountSystemContext
  private inputMap: Map<string, boolean> = new Map()
  private readonly actionKeyMap: Map<keyof MountInput, keyof MountInput> = new Map([
    ['forward', 'forward'],
    ['backward', 'backward'],
    ['left', 'left'],
    ['right', 'right'],
    ['run', 'run'],
    ['sprint', 'sprint'],
    ['jump', 'jump'],
    ['action1', 'action1'],
    ['action2', 'action2'],
    ['action3', 'action3'],
    ['action4', 'action4'],
    ['interact', 'interact'],
  ])

  constructor(context: MountSystemContext) {
    this.context = context
    this.mountSystem = new MountSystem(context)
  }

  /**
   * Inicializa o controlador
   */
  async initialize(): Promise<void> {
    await this.mountSystem.initialize()
  }

  /**
   * Processa evento de tecla pressionada
   */
  onKeyDown(key: string): void {
    this.inputMap.set(key, true)
    this.updateInputBuffer()
  }

  /**
   * Processa evento de tecla liberada
   */
  onKeyUp(key: string): void {
    this.inputMap.set(key, false)
    this.updateInputBuffer()
  }

  /**
   * Processa evento de mouse/button
   */
  onMouseButton(button: number, pressed: boolean): void {
    // Mapeia botões do mouse para ações
    const keyMap: Record<number, keyof MountInput> = {
      0: 'action1',  // Left click
      1: 'action2',  // Middle click
      2: 'action3',  // Right click
    }
    const action = keyMap[button]
    if (action) {
      this.inputMap.set(action, pressed)
      this.updateInputBuffer()
    }
  }

  /**
   * Atualiza buffer de input do MountSystem
   */
  private updateInputBuffer(): void {
    const bindings = this.getCurrentBindings()
    const input: Partial<MountInput> = {}

    for (const [action, inputKey] of this.actionKeyMap) {
      const boundKey = bindings[action as keyof MountControlBindings]
      if (boundKey && this.inputMap.get(boundKey)) {
        (input as Record<string, unknown>)[inputKey] = true
      }
    }

    this.mountSystem.setInput(input)
  }

  /**
   * Obtém control bindings atuais (do objeto montado ou padrão)
   */
  private getCurrentBindings(): MountControlBindings {
    const state = this.mountSystem.getState()
    if (state.isMounted && state.mountedObjectId) {
      // Em implementação real, buscaria do objeto montado
      return this.getDefaultBindings()
    }
    return this.getDefaultBindings()
  }

  /**
   * Tenta montar no objeto mais próximo
   */
  async tryMount(nearbyObjects: THREE.Mesh[]): Promise<MountResult> {
    if (this.mountSystem.isMounted()) return { success: false, mountPointId: null, error: 'ALREADY_MOUNTED' }

    // Encontra objeto montável mais próximo
    let closest: THREE.Mesh | null = null
    let closestDist = Infinity

    for (const obj of nearbyObjects) {
      const config = this.getMountConfig(obj)
      if (!config || !config.mountable) continue

      const dist = this.context.playerCollisionMesh.position.distanceTo(obj.position)
      if (dist < config.interactionRadius && dist < closestDist) {
        closestDist = dist
        closest = obj
      }
    }

    if (!closest) return { success: false, mountPointId: null, error: 'NOT_MOUNTABLE' }

    return this.mountSystem.mount(closest)
  }

  /**
   * Monta em objeto específico
   */
  async mount(targetObject: THREE.Mesh, mountPointId?: string): Promise<MountResult> {
    return this.mountSystem.mount(targetObject, mountPointId)
  }

  /**
   * Desmonta
   */
  async dismount(): Promise<DismountResult> {
    return this.mountSystem.dismount()
  }

  /**
   * Atualiza o sistema (chamado a cada frame)
   */
  update(deltaTime: number): void {
    this.mountSystem.update(deltaTime)
  }

  /**
   * Solicita pulo
   */
  requestJump(): void {
    this.mountSystem.requestJump()
  }

  /**
   * Verifica se está montado
   */
  isMounted(): boolean {
    return this.mountSystem.isMounted()
  }

  /**
   * Obtém estado atual
   */
  getState(): MountState {
    return this.mountSystem.getState()
  }

  /**
   * Obtém ID do objeto montado
   */
  getMountedObjectId(): string | null {
    return this.mountSystem.getMountedObjectId()
  }

  /**
   * Obtém ID do ponto de montagem
   */
  getMountPointId(): string | null {
    return this.mountSystem.getMountPointId()
  }

  /**
   * Obtém configuração de comportamento
   */
  getBehaviorConfig(): MountBehaviorConfig {
    return this.mountSystem.getBehaviorConfig()
  }

  /**
   * Define configuração de comportamento
   */
  setBehaviorConfig(config: Partial<MountBehaviorConfig>): void {
    this.mountSystem.setBehaviorConfig(config)
  }

  /**
   * Obtém mapeador de animações
   */
  getAnimationMapper() {
    return this.mountSystem.getAnimationMapper()
  }

  /**
   * Define control bindings personalizados
   */
  setControlBindings(_bindings: Partial<MountControlBindings>): void {
    // Em implementação real, salvaria no objeto montado
  }

  /**
   * Obtém configuração de montagem do objeto
   */
  getMountConfig(object: THREE.Mesh): MountConfig | null {
    const userData = object.userData
    if (userData.mountConfig) return userData.mountConfig as MountConfig

    // Compatibilidade legada
    if (userData.mountPackageSettings) {
      const legacy = userData.mountPackageSettings
      return {
        mountPoints: [
          createMountPointFromLegacy('seat_0', 'Assento', legacy)
        ],
        defaultSeatOffset: new THREE.Vector3(...legacy.seatOffset),
        mountable: true,
        interactionRadius: legacy.interactionRadius,
        interactionKey: legacy.interactionKey,
        controlBindings: legacy.controlBindings,
      }
    }

    return null
  }

  /**
   * Configurações padrão de controle
   */
  private getDefaultBindings(): MountControlBindings {
    return {
      forward: 'KeyW',
      backward: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'ShiftLeft',
      jump: 'Space',
      interact: 'KeyE',
      action1: 'KeyQ',
      action2: 'KeyR',
      action3: 'KeyF',
      action4: 'KeyC',
    }
  }

  /**
   * Limpa recursos
   */
  dispose(): void {
    this.mountSystem.dispose()
    this.inputMap.clear()
  }
}

/**
 * Cria MountPoint a partir de configuração legada
 */
function createMountPointFromLegacy(id: string, label: string, legacy: Record<string, unknown>): MountPoint {
  const seatOffset = legacy.seatOffset as [number, number, number] ?? [0, 0.55, 0]
  return {
    id,
    label,
    localOffset: new THREE.Vector3(...seatOffset),
    capacityTags: ['passenger'],
    priority: 10,
    playerUsable: true,
    requiresInteraction: true,
  }
}

/**
 * Factory para criar MountController integrado com Engine
 */
export type EngineMountControllerContext = {
  world: World
  physicsWorld: PhysicsWorld
  playerVisualRoot: THREE.Mesh
  playerCollisionMesh: THREE.Mesh
  getCameraYaw: () => number
  getPlayerRadius: () => number
  getStandingPlayerHeight: () => number
  getBodyScale: () => number
  collidesWithObjects: (mesh: THREE.Mesh) => boolean
  updateCameraTarget: (position: THREE.Vector3) => void
  emitScriptEvent: (eventName: string, data: Record<string, unknown>) => void
  getScriptVariable: (name: string, objectId?: string) => unknown
  setScriptVariable: (name: string, value: unknown, objectId?: string) => void
}

/**
 * Cria MountController a partir do contexto do Engine
 */
export function createMountController(context: EngineMountControllerContext): MountController {
  return new MountController(context)
}

/**
 * Registra ações de montaria no sistema de script (Visual Script)
 */
export function registerMountScriptActions(registerAction: (name: string, handler: (_params: Record<string, unknown>, _context: unknown) => boolean) => void): void {
  // Ação: Montar
  registerAction('mount', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller) return false
    // const objectId = params.objectId as string
    // const mountPointId = params.mountPointId as string | undefined
    // if (!objectId) return false
    return false
  })

  // Ação: Desmontar
  registerAction('dismount', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller || !controller.isMounted()) return false
    // controller.dismount()
    return false
  })

  // Ação: Definir ponto de montagem
  registerAction('set_mount_point', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller) return false
    // const mountPointId = params.mountPointId as string
    return false
  })

  // Ação: Tocar animação na montaria
  registerAction('play_mount_animation', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller || !controller.isMounted()) return false
    // const role = params.role as string
    // const mapper = controller.getAnimationMapper()
    // if (!mapper) return false
    return false
  })

  // Ação: Definir variável de montaria
  registerAction('set_mount_variable', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller || !controller.isMounted()) return false
    // const objectId = controller.getMountedObjectId()
    // if (!objectId) return false
    // const name = params.name as string
    // const value = params.value
    // context.setScriptVariable(name, value, objectId)
    return false
  })
}

/**
 * Registra condições de montaria no sistema de script
 */
export function registerMountScriptConditions(registerCondition: (name: string, handler: (_params: Record<string, unknown>, _context: unknown) => boolean) => void): void {
  // Condição: Está montado
  registerCondition('is_mounted', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // return controller?.isMounted() ?? false
    return false
  })

  // Condição: Montado em objeto específico
  registerCondition('mounted_on', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller) return false
    // const objectId = params.objectId as string
    // return controller.getMountedObjectId() === objectId
    return false
  })

  // Condição: Em ponto de montagem específico
  registerCondition('in_mount_point', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller) return false
    // const mountPointId = params.mountPointId as string
    // return controller.getMountPointId() === mountPointId
    return false
  })

  // Condição: Estado de movimento da montaria
  registerCondition('mount_movement_state', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller) return false
    // const state = params.state as string
    // return controller.getState().movementState === state
    return false
  })

  // Condição: Montaria no ar
  registerCondition('mount_airborne', (_params, _context) => {
    // const controller = (context as { mountController?: MountController }).mountController
    // if (!controller) return false
    // return controller.getState().airborne
    return false
  })

  // Condição: Assento ocupado
  registerCondition('mount_point_occupied', (_params, _context) => {
    // Verificaria variável de estado do assento
    return false
  })
}

/**
 * Registra triggers de montaria no sistema de script
 */
export function registerMountScriptTriggers(registerTrigger: (name: string, handler: (_params: Record<string, unknown>, _context: unknown) => void) => void): void {
  // Trigger: OnMount
  registerTrigger('OnMount', (_params, _context) => {
    // Disparado automaticamente pelo MountSystem
  })

  // Trigger: OnDismount
  registerTrigger('OnDismount', (_params, _context) => {
    // Disparado automaticamente pelo MountSystem
  })

  // Trigger: OnMountJump
  registerTrigger('OnMountJump', (_params, _context) => {
    // Disparado quando montaria pula
  })

  // Trigger: OnMountLand
  registerTrigger('OnMountLand', (_params, _context) => {
    // Disparado quando montaria pousa
  })

  // Trigger: OnMountPointChange
  registerTrigger('OnMountPointChange', (_params, _context) => {
    // Disparado quando jogador troca de assento
  })

  // Trigger: OnMountMovementStateChange
  registerTrigger('OnMountMovementStateChange', (_params, _context) => {
    // Disparado quando estado de movimento muda
  })
}