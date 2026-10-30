import * as THREE from 'three'

/**
 * Contexto necessário para o sistema de montaria operar
 */
export type MountSystemContext = {
  /** Mundo do jogo */
  world: import('../world/World.ts').World
  /** Mundo de física (Rapier) */
  physicsWorld: import('../physics/PhysicsWorld.ts').PhysicsWorld
  /** Raiz visual do jogador (mesh com animações) */
  playerVisualRoot: THREE.Mesh
  /** Mesh de colisão do jogador */
  playerCollisionMesh: THREE.Mesh
  /** Obtém yaw da câmera */
  getCameraYaw: () => number
  /** Obtém raio do jogador */
  getPlayerRadius: () => number
  /** Obtém altura do jogador em pé */
  getStandingPlayerHeight: () => number
  /** Obtém escala do corpo */
  getBodyScale: () => number
  /** Verifica colisão com objetos */
  collidesWithObjects: (mesh: THREE.Mesh) => boolean
  /** Atualiza target da câmera */
  updateCameraTarget: (position: THREE.Vector3) => void
  /** Dispara evento de script */
  emitScriptEvent: (eventName: string, data: Record<string, unknown>) => void
  /** Obtém variável de script */
  getScriptVariable: (name: string, objectId?: string) => unknown
  /** Define variável de script */
  setScriptVariable: (name: string, value: unknown, objectId?: string) => void
}

/**
 * Entrada de controle para montaria
 */
export type MountInput = {
  forward: number
  backward: number
  left: number
  right: number
  run: boolean
  sprint: boolean
  jump: boolean
  action1: boolean
  action2: boolean
  action3: boolean
  action4: boolean
  interact: boolean
}

/**
 * MountPoint - Configuração universal de ponto de montagem (assento)
 *
 * Permite definir múltiplos assentos em qualquer GameObject com:
 * - Nome identificador único
 * - Offset local (posição relativa ao pivot do objeto)
 * - Rotação local do jogador ao montar
 * - Bone opcional para animação esquelética (sincroniza com esqueleto)
 * - Tags de capacidade (ex: 'driver', 'passenger', 'gunner')
 * - Prioridade para seleção automática
 * - Variável de estado para Visual Script (ex: 'seat_0_occupied')
 */
export interface MountPoint {
  /** Identificador único do ponto de montagem */
  id: string
  /** Nome amigável para UI/Editor */
  label: string
  /** Offset local do assento em relação ao pivot do objeto */
  localOffset: THREE.Vector3
  /** Rotação local do avatar ao montar (Euler angles em radianos) */
  localRotation?: THREE.Euler
  /** Nome do bone do esqueleto para anexação animada (opcional) */
  boneName?: string
  /** Tags de capacidade/função deste assento */
  capacityTags: string[]
  /** Prioridade para seleção automática (maior = preferido) */
  priority: number
  /** Variável de estado para Visual Script (ex: 'seat_driver_occupied') */
  stateVariable?: string
  /** Se este assento pode ser usado pelo jogador (true) ou apenas por IA/NPCs */
  playerUsable: boolean
  /** Se requer interação explícita ou pode montar automaticamente */
  requiresInteraction: boolean
  /** Offset adicional da câmera quando neste assento */
  cameraOffset?: THREE.Vector3
}

/**
 * Configuração padrão para um MountPoint
 */
export const DEFAULT_MOUNT_POINT: Omit<MountPoint, 'id' | 'label' | 'localOffset'> = {
  localRotation: new THREE.Euler(0, 0, 0),
  boneName: undefined,
  capacityTags: ['passenger'],
  priority: 0,
  stateVariable: undefined,
  playerUsable: true,
  requiresInteraction: true,
  cameraOffset: undefined,
}

/**
 * Cria um MountPoint com valores padrão
 */
export function createMountPoint(
  id: string,
  label: string,
  localOffset: THREE.Vector3,
  overrides: Partial<Omit<MountPoint, 'id' | 'label' | 'localOffset'>> = {}
): MountPoint {
  return {
    id,
    label,
    localOffset: localOffset.clone(),
    ...DEFAULT_MOUNT_POINT,
    ...overrides,
  }
}

/**
 * Cria configuração padrão de montagem para novo objeto
 */
export function createDefaultMountConfig(): MountConfig {
  return {
    mountPoints: [
      createMountPoint('seat_0', 'Assento do Motorista', new THREE.Vector3(0, 0.55, 0), {
        capacityTags: ['driver'],
        priority: 100,
        stateVariable: 'seat_driver_occupied',
      }),
    ],
    defaultSeatOffset: new THREE.Vector3(0, 0.55, 0),
    mountable: true,
    interactionRadius: 2.5,
    interactionKey: 'KeyE',
    controlBindings: {
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
    },
  }
}

/**
 * Cria mapeamento de animação para montaria a partir de configuração simplificada
 * Converte o formato legado (mountClipNames, playerClipNames) para o novo formato (MountAnimationMapping)
 */
export function createMountAnimationMapping(config: {
  mount: Record<string, string>
  player: Record<string, string>
  useGenericFallback?: boolean
  mountTransitionRole?: string
  dismountTransitionRole?: string
}): MountAnimationMapping {
  const mountRoles: MountAnimationRole[] = [
    'mount_idle', 'mount_walk', 'mount_run', 'mount_sprint',
    'mount_turn_left', 'mount_turn_right',
    'mount_jump_start', 'mount_jump_air', 'mount_jump_land',
    'mount_dash', 'mount_attack', 'mount_special',
    'mount_emote', 'mount_death',
    'mount_transition_mount', 'mount_transition_dismount',
  ]

  const playerRoles: MountAnimationRole[] = [
    'player_mount_idle', 'player_mount_walk', 'player_mount_run',
    'player_mount_turn_left', 'player_mount_turn_right',
    'player_mount_jump', 'player_mount_action',
    'player_transition_mount', 'player_transition_dismount',
  ]

  const mountClipNames: Partial<Record<MountAnimationRole, string>> = {}
  const playerClipNames: Partial<Record<MountAnimationRole, string>> = {}

  // Mapear clipes da montaria
  for (const role of mountRoles) {
    const simpleKey = role.replace('mount_', '')
    if (config.mount[simpleKey] || config.mount[role]) {
      mountClipNames[role] = config.mount[simpleKey] || config.mount[role]
    }
  }

  // Mapear clipes do jogador
  for (const role of playerRoles) {
    const simpleKey = role.replace('player_mount_', '')
    if (config.player[simpleKey] || config.player[role] || config.player['player_' + simpleKey]) {
      playerClipNames[role] = config.player[simpleKey] || config.player[role] || config.player['player_' + simpleKey]
    }
  }

  return {
    mountClipNames,
    playerClipNames,
    mount_transition_mount: (config.mountTransitionRole as MountAnimationRole) || 'mount_transition_mount',
    player_transition_mount: (config.mountTransitionRole as MountAnimationRole) || 'player_transition_mount',
    mount_transition_dismount: (config.dismountTransitionRole as MountAnimationRole) || 'mount_transition_dismount',
    player_transition_dismount: (config.dismountTransitionRole as MountAnimationRole) || 'player_transition_dismount',
    useGenericFallback: config.useGenericFallback ?? true,
  }
}

/**
 * Configuração de montagem para um GameObject
 * Armazenada no userData do objeto como 'mountConfig'
 */
export interface MountConfig {
  /** Lista de pontos de montagem disponíveis */
  mountPoints: MountPoint[]
  /** Offset padrão do assento (compatibilidade legada) */
  defaultSeatOffset: THREE.Vector3
  /** Se o objeto pode ser montado */
  mountable: boolean
  /** Raio de interação para montar */
  interactionRadius: number
  /** Tecla de interação padrão */
  interactionKey: string
  /** Mapeamento de controles para este veículo/montaria */
  controlBindings: MountControlBindings
  /** Configurações de animação específicas desta montaria */
  animationMapping?: MountAnimationMapping
}

/**
 * Mapeamento de controles para montaria
 */
export interface MountControlBindings {
  forward: string
  backward: string
  left: string
  right: string
  run: string
  jump: string
  interact: string
  // Controles adicionais para veículos
  action1?: string
  action2?: string
  action3?: string
  action4?: string
  // Controles de câmera
  cameraYaw?: string
  cameraPitch?: string
  cameraZoom?: string
}

export const DEFAULT_MOUNT_CONTROL_BINDINGS: MountControlBindings = {
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
  cameraYaw: 'MouseX',
  cameraPitch: 'MouseY',
  cameraZoom: 'Wheel',
}

/**
 * Mapeamento de animações genérico para montaria
 * Permite que qualquer modelo use animações padronizadas via roles
 */
export interface MountAnimationMapping {
  /** Mapeamento de role -> nome do clipe no modelo da montaria */
  mountClipNames: Partial<Record<MountAnimationRole, string>>
  /** Mapeamento de role -> nome do clipe no modelo do jogador */
  playerClipNames: Partial<Record<MountAnimationRole, string>>
  /** Role de transição de montagem (one-shot) - montaria */
  mount_transition_mount: MountAnimationRole
  /** Role de transição de montagem (one-shot) - jogador */
  player_transition_mount: MountAnimationRole
  /** Role de transição de desmontagem (one-shot) - montaria */
  mount_transition_dismount: MountAnimationRole
  /** Role de transição de desmontagem (one-shot) - jogador */
  player_transition_dismount: MountAnimationRole
  /** Se deve usar fallback genérico quando role não existe */
  useGenericFallback: boolean

  /** @deprecated Use mount_transition_mount */
  mountTransitionRole?: MountAnimationRole
  /** @deprecated Use dismount_transition_mount */
  dismountTransitionRole?: MountAnimationRole
}

/**
 * Papéis de animação específicos para montaria
 * Estende os roles base com roles específicos de veículos/montarias
 */
export type MountAnimationRole =
  | 'mount_idle'
  | 'mount_walk'
  | 'mount_run'
  | 'mount_sprint'
  | 'mount_turn_left'
  | 'mount_turn_right'
  | 'mount_jump_start'
  | 'mount_jump_air'
  | 'mount_jump_land'
  | 'mount_dash'
  | 'mount_attack'
  | 'mount_special'
  | 'mount_emote'
  | 'mount_death'
  // Player roles while mounted
  | 'player_mount_idle'
  | 'player_mount_walk'
  | 'player_mount_run'
  | 'player_mount_turn_left'
  | 'player_mount_turn_right'
  | 'player_mount_jump'
  | 'player_mount_action'
  // Transition roles (one-shot)
  | 'mount_transition_mount'
  | 'mount_transition_dismount'
  | 'player_transition_mount'
  | 'player_transition_dismount'

/**
 * Estado de montagem do jogador
 */
export interface MountState {
  /** Se o jogador está montado */
  isMounted: boolean
  /** ID do objeto montado */
  mountedObjectId: string | null
  /** ID do ponto de montagem (assento) ocupado */
  mountPointId: string | null
  /** Estado do movimento da montaria */
  movementState: MountMovementState
  /** Se a montaria está no ar (pulando/caíndo) */
  airborne: boolean
  /** Velocidade vertical atual */
  verticalVelocity: number
  /** Tempo desde última sonda de suporte */
  supportProbeElapsed: number
  /** Última posição conhecida com suporte */
  lastSupportPosition: THREE.Vector3
  /** Se tem suporte válido no momento */
  hasSupport: boolean
}

/**
 * Estados de movimento da montaria
 */
export type MountMovementState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'walk_diagonal_left'
  | 'walk_diagonal_right'
  | 'run_diagonal_left'
  | 'run_diagonal_right'
  | 'turn_left'
  | 'turn_right'
  | 'jump'
  | 'dash'
  | 'attack'
  | 'special'

/**
 * Configuração de comportamento de montaria
 */
export interface MountBehaviorConfig {
  /** Velocidade base de caminhada */
  walkSpeed: number
  /** Multiplicador de corrida */
  runMultiplier: number
  /** Multiplicador de sprint */
  sprintMultiplier: number
  /** Impulso de pulo */
  jumpImpulse: number
  /** Gravidade aplicada à montaria */
  gravity: number
  /** Ângulo máximo de inclinação caminhável (radianos) */
  maxSlopeAngle: number
  /** Altura máxima de degrau (unidades) */
  maxStepHeight: number
  /** Velocidade de virada (rad/s) */
  turnSpeed: number
  /** Suavização da câmera */
  cameraSmoothing: number
  /** Se a montaria pode pular */
  canJump: boolean
  /** Se a montaria pode sprintar */
  canSprint: boolean
  /** Se a montaria pode atacar */
  canAttack: boolean
  /** Se usa física de personagem (Rapier) ou movimento cinemático simples */
  useCharacterController: boolean
}

export const DEFAULT_MOUNT_BEHAVIOR_CONFIG: MountBehaviorConfig = {
  walkSpeed: 4.2,
  runMultiplier: 1.7,
  sprintMultiplier: 2.5,
  jumpImpulse: 10.0,
  gravity: 18.0,
  maxSlopeAngle: Math.PI / 4,
  maxStepHeight: 0.5,
  turnSpeed: 5.5,
  cameraSmoothing: 0.2,
  canJump: true,
  canSprint: true,
  canAttack: false,
  useCharacterController: false,
}

/**
 * Resultado de uma tentativa de montagem
 */
export interface MountResult {
  success: boolean
  mountPointId: string | null
  error?: MountError
}

/**
 * Códigos de erro de montagem
 */
export type MountError =
  | 'ALREADY_MOUNTED'
  | 'NOT_MOUNTABLE'
  | 'NO_VALID_MOUNT_POINTS'
  | 'OUT_OF_RANGE'
  | 'MOUNT_POINT_OCCUPIED'
  | 'MOUNT_POINT_NOT_PLAYER_USABLE'
  | 'INTERACTION_REQUIRED'
  | 'ANIMATION_FAILED'
  | 'PHYSICS_FAILED'
  | 'UNKNOWN'

/**
 * Resultado de uma tentativa de desmontagem
 */
export interface DismountResult {
  success: boolean
  dismountPosition: THREE.Vector3 | null
  error?: DismountError
}

export type DismountError =
  | 'NOT_MOUNTED'
  | 'NO_VALID_DISMOUNT_POSITION'
  | 'BLOCKED_BY_COLLISION'
  | 'ANIMATION_FAILED'
  | 'UNKNOWN'

/**
 * Painel de propriedades do MountPoint para UI (re-exportado do MountEditorIntegration)
 */
export type MountPointPropertyPanel = {
  mountPoint: MountPoint | null
  onChange: (mountPoint: MountPoint, changes: Partial<MountPoint>) => void
  onDelete: (mountPoint: MountPoint) => void
  onDuplicate: (mountPoint: MountPoint) => void
}