import type { LogicRule } from './types'
import * as THREE from 'three'
// Novo sistema de montaria genérico
import type { MountConfig, MountPoint, MountControlBindings } from '../mount'
import { createMountAnimationMapping } from '../mount'

export type PackageScalar = boolean | number | string
export type PackageJsonValue =
  | PackageScalar
  | null
  | PackageJsonValue[]
  | { [key: string]: PackageJsonValue }

export type MountMovementState = 'idle' | 'walk' | 'run' | 'walk_diagonal_left' | 'walk_diagonal_right' | 'run_diagonal_left' | 'run_diagonal_right'
export type AnimationRole =
  | 'ignore'
  | 'idle'
  | 'walk'
  | 'walk_slow'
  | 'walk_backward'
  | 'walk_left'
  | 'walk_right'
  | 'walk_diagonal_left'
  | 'walk_diagonal_right'
  | 'walk_backward_diagonal_left'
  | 'walk_backward_diagonal_right'
  | 'run'
  | 'run_backward'
  | 'run_left'
  | 'run_right'
  | 'run_diagonal_left'
  | 'run_diagonal_right'
  | 'run_backward_diagonal_left'
  | 'run_backward_diagonal_right'
  | 'run_stop'
  | 'jump'
  | 'crouch'
  | 'crouch_walk'
  | 'prone'
  | 'prone_crawl'
  | 'dodge'
  | 'slide'
  | 'roll'
  | 'interact'
  | 'primary_action'
  | 'secondary_action'
  | 'inventory'
  | 'use_item'
  | 'reload'
  | 'ability_1'
  | 'ability_2'
  | 'ability_3'
  | 'ability_4'
  | 'emote'
  | 'mount'
  | 'dismount'
  | 'death'

/** Ações reproduzidas uma vez e depois devolvidas ao estado de repouso/movimento. */
export const ONE_SHOT_ANIMATION_ROLES: ReadonlySet<AnimationRole> = new Set([
  'run_stop', 'jump', 'dodge', 'slide', 'roll', 'interact',
  'primary_action', 'secondary_action', 'inventory', 'use_item', 'reload',
  'ability_1', 'ability_2', 'ability_3', 'ability_4', 'emote',
  'mount', 'dismount', 'death',
])

/** Teclas do teclado associadas aos comandos de controle de um modelo. */
export interface ModelControlBindings {
  forward: string
  backward: string
  left: string
  right: string
  run: string
  jump: string
  interact: string
}

export const DEFAULT_MODEL_CONTROL_BINDINGS: ModelControlBindings = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
}

/** Regra visual declarativa: controla a visibilidade de um nó do GLB a partir de uma variável. */
export interface MountModelStateRule {
  id: string
  nodePath: string
  variable: string
  operator: 'equals' | 'not_equals'
  value: PackageScalar
  visibleWhenMatched: boolean
}

export interface BehaviorPackageVariableDefinition {
  name: string
  label: string
  type: 'boolean' | 'number' | 'string'
  defaultValue: PackageScalar
  description: string
  /** Opções para apresentar um seletor no inspetor em vez de um campo de texto. */
  options?: Array<{ value: PackageScalar; label: string }>
  min?: number
  max?: number
  step?: number
  readOnly?: boolean
}

export interface BehaviorPackageSlotDefinition {
  id: string
  label: string
  description: string
}

export type BehaviorPackageScriptDefinition = Pick<
  LogicRule,
  'id' | 'name' | 'enabled' | 'trigger' | 'conditions' | 'actions'
>

export interface BehaviorPackageDefinition {
  id: string
  version: string
  name: string
  description: string
  variables: BehaviorPackageVariableDefinition[]
  triggers: BehaviorPackageSlotDefinition[]
  conditions: BehaviorPackageSlotDefinition[]
  actions: BehaviorPackageSlotDefinition[]
  defaultConfig: Record<string, PackageJsonValue>
  /** Regras prontas que são instaladas como nós do Visual Script ao anexar o pacote. */
  scripts?: BehaviorPackageScriptDefinition[]
  /** Shared rules installed once per package type rather than once per scene object. */
  globalScripts?: BehaviorPackageScriptDefinition[]
}

export interface BehaviorPackageInstance {
  id: string
  packageId: string
  ownerObjectId: string
  enabled: boolean
  variables: Record<string, PackageScalar>
  config: Record<string, PackageJsonValue>
}

/** Configuração de ponto de montagem (assento) para o pacote Montaria */
export interface MountPointConfig {
  id: string
  label: string
  localOffset: [number, number, number]
  localRotation?: [number, number, number]
  boneName?: string
  capacityTags: string[]
  priority: number
  stateVariable?: string
  playerUsable: boolean
  requiresInteraction: boolean
  cameraOffset?: [number, number, number]
}

/**
 * @deprecated Use MountConfig from engine/mount instead.
 * Mantido para compatibilidade com pacotes legados.
 */
export interface MountPackageSettings {
  interactionKey: string
  seatOffset: [number, number, number]
  speed: number
  runMultiplier: number
  sprintMultiplier: number
  jumpImpulse: number
  gravity: number
  maxSlopeAngle: number
  maxStepHeight: number
  turnSpeed: number
  cameraSmoothing: number
  canJump: boolean
  canSprint: boolean
  canAttack: boolean
  useCharacterController: boolean
  interactionRadius: number
  modelStates: MountModelStateRule[]
  controlBindings: ModelControlBindings
  mountPoints: MountPointConfig[]
  animationMapping?: MountAnimationMapping
}

/**
 * @deprecated Use MountAnimationMapping from engine/mount instead.
 */
export interface MountAnimationMapping {
  mountClipNames: Record<string, string>
  playerClipNames: Record<string, string>
  mountTransitionRole: string
  dismountTransitionRole: string
  useGenericFallback: boolean
}

/**
 * Converte configuração legada (MountPackageSettings) para o novo formato (MountConfig).
 * Usado para migrar pacotes "Montaria" existentes.
 */
export function migrateLegacyMountSettings(legacy: MountPackageSettings): MountConfig {
  const mountPoints: MountPoint[] = legacy.mountPoints.map((mp, index) => ({
    id: mp.id,
    label: mp.label,
    localOffset: new THREE.Vector3(...mp.localOffset),
    localRotation: mp.localRotation ? new THREE.Euler(...mp.localRotation) : undefined,
    boneName: mp.boneName,
    capacityTags: mp.stateVariable ? [mp.stateVariable.replace('_occupied', '')] : ['passenger'],
    priority: 100 - index * 10,
    stateVariable: mp.stateVariable,
    playerUsable: mp.playerUsable,
    requiresInteraction: mp.requiresInteraction,
  }))

  const animationMapping = legacy.animationMapping
    ? createMountAnimationMapping({
        mount: legacy.animationMapping.mountClipNames,
        player: legacy.animationMapping.playerClipNames,
      })
    : undefined

  const controlBindings: MountControlBindings = {
    forward: legacy.controlBindings.forward,
    backward: legacy.controlBindings.backward,
    left: legacy.controlBindings.left,
    right: legacy.controlBindings.right,
    run: legacy.controlBindings.run,
    jump: legacy.controlBindings.jump,
    interact: legacy.controlBindings.interact,
    action1: 'KeyQ',
    action2: 'KeyR',
    action3: 'KeyF',
    action4: 'KeyC',
  }

  return {
    mountPoints,
    defaultSeatOffset: new THREE.Vector3(...legacy.seatOffset),
    mountable: true,
    interactionRadius: legacy.interactionRadius,
    interactionKey: legacy.interactionKey,
    controlBindings,
    animationMapping,
  }
}

export const BEHAVIOR_PACKAGE_DEFINITIONS: BehaviorPackageDefinition[] = [
  {
    id: 'mount',
    version: '2.0.0',
    name: 'Montaria',
    description: 'Sistema genérico de montaria/veículos com múltiplos assentos, animações mapeadas, controles configuráveis e integração completa com Visual Script.',
    variables: [
      {
        name: 'mounted',
        label: 'Montado',
        type: 'boolean',
        defaultValue: false,
        description: 'Estado de execução: indica se o jogador está montado nesta instância.',
        readOnly: true,
      },
      {
        name: 'movementState',
        label: 'Estado do movimento',
        type: 'string',
        defaultValue: 'idle',
        description: 'Parado, andando, correndo, sprintando ou deslocando-se na diagonal; pode ser usado como condição em regras deste pacote.',
        readOnly: true,
      },
      {
        name: 'currentMountPoint',
        label: 'Assento atual',
        type: 'string',
        defaultValue: '',
        description: 'ID do ponto de montagem (assento) atualmente ocupado.',
        readOnly: true,
      },
      {
        name: 'airborne',
        label: 'No ar',
        type: 'boolean',
        defaultValue: false,
        description: 'Se a montaria está no ar (pulando/caindo).',
        readOnly: true,
      },
      // behaviorConfig - configurações de física/movimento
      {
        name: 'speed',
        label: 'Velocidade base (caminhada)',
        type: 'number',
        defaultValue: 5.0,
        description: 'Velocidade de deslocamento enquanto caminha.',
        min: 0.2,
        max: 20,
        step: 0.1,
      },
      {
        name: 'runMultiplier',
        label: 'Multiplicador de corrida',
        type: 'number',
        defaultValue: 1.8,
        description: 'Multiplica a velocidade base quando o jogador segura a tecla de corrida.',
        min: 1,
        max: 3,
        step: 0.1,
      },
      {
        name: 'sprintMultiplier',
        label: 'Multiplicador de sprint',
        type: 'number',
        defaultValue: 2.5,
        description: 'Multiplica a velocidade base quando o jogador segura a tecla de sprint.',
        min: 1,
        max: 5,
        step: 0.1,
      },
      {
        name: 'jumpImpulse',
        label: 'Impulso de pulo',
        type: 'number',
        defaultValue: 8.0,
        description: 'Força vertical aplicada ao pular.',
        min: 0,
        max: 50,
        step: 0.5,
      },
      {
        name: 'gravity',
        label: 'Gravidade',
        type: 'number',
        defaultValue: 20.0,
        description: 'Aceleração gravitacional aplicada à montaria.',
        min: 0,
        max: 50,
        step: 0.5,
      },
      {
        name: 'maxSlopeAngle',
        label: 'Inclinação máxima (rad)',
        type: 'number',
        defaultValue: 1.047,
        description: 'Ângulo máximo de rampa caminhável em radianos (padrão: 60°).',
        min: 0,
        max: 1.57,
        step: 0.05,
      },
      {
        name: 'maxStepHeight',
        label: 'Altura máxima de degrau',
        type: 'number',
        defaultValue: 0.5,
        description: 'Altura máxima de obstáculo que a montaria pode subir automaticamente.',
        min: 0,
        max: 2,
        step: 0.05,
      },
      {
        name: 'turnSpeed',
        label: 'Velocidade de virada',
        type: 'number',
        defaultValue: 3.0,
        description: 'Velocidade de rotação da montaria (rad/s).',
        min: 0.5,
        max: 20,
        step: 0.1,
      },
      {
        name: 'cameraSmoothing',
        label: 'Suavização da câmera',
        type: 'number',
        defaultValue: 0.1,
        description: 'Fator de interpolação da câmera (0-1).',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        name: 'canJump',
        label: 'Pode pular',
        type: 'boolean',
        defaultValue: true,
        description: 'Se a montaria pode pular.',
      },
      {
        name: 'canSprint',
        label: 'Pode sprintar',
        type: 'boolean',
        defaultValue: true,
        description: 'Se a montaria pode sprintar.',
      },
      {
        name: 'useCharacterController',
        label: 'Usar Character Controller (Rapier)',
        type: 'boolean',
        defaultValue: true,
        description: 'Se usa controlador de personagem físico (Rapier) em vez de movimento cinemático simples.',
      },
      {
        name: 'interactionRadius',
        label: 'Distância para montar',
        type: 'number',
        defaultValue: 3.0,
        description: 'Distância horizontal máxima para permitir a interação.',
        min: 0.5,
        max: 10,
        step: 0.1,
      },
    ],
    triggers: [
      { id: 'interact', label: 'Interagir', description: 'Pressionar a tecla configurada próximo ao objeto.' },
      { id: 'mounted', label: 'Montou', description: 'Disparado quando o jogador começa a montar.' },
      { id: 'dismounted', label: 'Desmontou', description: 'Disparado quando o jogador sai da montaria.' },
      { id: 'movement_changed', label: 'Movimento alterado', description: 'Parado, andando, correndo, sprintando e movimentos diagonais.' },
      { id: 'mount_point_changed', label: 'Assento alterado', description: 'Disparado quando o jogador troca de assento.' },
      { id: 'jump', label: 'Pulo', description: 'Disparado quando a montaria pula.' },
      { id: 'land', label: 'Pouso', description: 'Disparado quando a montaria pousa após pulo/queda.' },
    ],
    conditions: [
      { id: 'in_range', label: 'Jogador ao alcance', description: 'Verifica a distância horizontal até o jogador.' },
      { id: 'not_mounted', label: 'Ainda não montado', description: 'Impede iniciar uma segunda montaria.' },
      { id: 'has_animation', label: 'Animação disponível', description: 'Confere se o modelo tem o clipe atribuído à função.' },
      { id: 'is_mounted', label: 'Está montado', description: 'Verifica se o jogador está atualmente montado neste objeto.' },
      { id: 'mount_point_occupied', label: 'Assento ocupado', description: 'Verifica se um assento específico está ocupado.' },
      { id: 'mount_movement_state', label: 'Estado de movimento da montaria', description: 'Compara o estado de movimento atual com um valor esperado.' },
      { id: 'mount_airborne', label: 'Montaria no ar', description: 'Verifica se a montaria está no ar.' },
      { id: 'has_mount_point', label: 'Tem ponto de montagem', description: 'Verifica se existe um ponto de montagem com a tag de capacidade especificada.' },
    ],
    actions: [
      { id: 'mount', label: 'Montar', description: 'Vincula o jogador à montaria e transfere os controles.' },
      { id: 'dismount', label: 'Desmontar', description: 'Devolve o controle e posiciona o jogador ao lado do objeto.' },
      { id: 'mount_at_point', label: 'Montar em assento específico', description: 'Monta o jogador em um assento específico pelo ID.' },
      { id: 'switch_mount_point', label: 'Trocar de assento', description: 'Move o jogador para outro assento na mesma montaria.' },
      { id: 'play_animation', label: 'Reproduzir animação', description: 'Executa o clipe atribuído a cada movimento, diagonal e transição.' },
      { id: 'set_variable', label: 'Definir variável', description: 'Altera uma variável deste pacote.' },
      { id: 'jump', label: 'Pular', description: 'Faz a montaria pular.' },
    ],
    defaultConfig: {
      interactionKey: 'KeyE',
      interactionRadius: 3.0,
      controlBindings: { ...DEFAULT_MODEL_CONTROL_BINDINGS },
      // behaviorConfig (novo formato)
      speed: 5.0,
      runMultiplier: 1.8,
      sprintMultiplier: 2.5,
      jumpImpulse: 8.0,
      gravity: 20.0,
      maxSlopeAngle: 1.047, // 60°
      maxStepHeight: 0.5,
      turnSpeed: 3.0,
      cameraSmoothing: 0.1,
      canJump: true,
      canSprint: true,
      useCharacterController: true,
      // seatOffset (legado, para compatibilidade)
      seatOffset: [0, 1.2, 0],
      modelStates: [],
      mountPoints: [
        {
          id: 'driver',
          label: 'Motorista',
          localOffset: [0, 1.2, 0],
          localRotation: [0, 0, 0],
          boneName: '',
          capacityTags: ['driver'],
          priority: 100,
          stateVariable: 'seat_driver_occupied',
          playerUsable: true,
          requiresInteraction: true,
          cameraOffset: [0, 1.8, 3.5],
        },
        {
          id: 'passenger',
          label: 'Passageiro',
          localOffset: [0.5, 1.2, -0.5],
          localRotation: [0, 0, 0],
          boneName: '',
          capacityTags: ['passenger'],
          priority: 50,
          stateVariable: 'seat_passenger_occupied',
          playerUsable: true,
          requiresInteraction: true,
          cameraOffset: [0, 1.8, 3.5],
        },
      ],
      animationMapping: {
        mount: {
          idle: 'idle',
          walk: 'walk',
          run: 'run',
          sprint: 'sprint',
          jump: 'jump',
          turnLeft: 'turn_left',
          turnRight: 'turn_right',
          jumpStart: 'jump_start',
          jumpAir: 'jump_air',
          jumpLand: 'jump_land',
          dash: 'dash',
          attack: 'attack',
          special: 'special',
          emote: 'emote',
          death: 'death',
          transitionMount: 'mount',
          transitionDismount: 'dismount',
        },
        player: {
          idle: 'sit_idle',
          walk: 'sit_walk',
          run: 'sit_run',
          sprint: 'sit_sprint',
          jump: 'sit_jump',
          turnLeft: 'sit_turn_left',
          turnRight: 'sit_turn_right',
          action: 'sit_action',
          transitionMount: 'mount',
          transitionDismount: 'dismount',
        },
        useGenericFallback: true,
      },
    },
  },
  {
    id: 'autonomous_agent',
    version: '1.0.0',
    name: 'Comportamento autônomo',
    description: 'Faz qualquer GameObject ou entidade executar comportamentos autônomos configuráveis durante Run.',
    variables: [
      {
        name: 'mode',
        label: 'Comportamento',
        type: 'string',
        defaultValue: 'wander',
        description: 'Escolhe a rotina autônoma executada pelo objeto.',
        options: [
          { value: 'idle', label: 'Parado' },
          { value: 'wander', label: 'Vagar pela área' },
          { value: 'patrol', label: 'Patrulhar em linha' },
          { value: 'follow_player', label: 'Seguir jogador' },
          { value: 'flee_player', label: 'Fugir do jogador' },
          { value: 'follow_object', label: 'Seguir outro objeto' },
          { value: 'move_to_point', label: 'Ir até coordenadas' },
          { value: 'look_at_player', label: 'Observar jogador' },
        ],
      },
      { name: 'move_speed', label: 'Velocidade', type: 'number', defaultValue: 2.5, description: 'Velocidade de movimento em unidades por segundo.', min: 0, max: 20, step: 0.1 },
      { name: 'perception_range', label: 'Alcance de percepção', type: 'number', defaultValue: 15, description: 'Distância máxima para detectar o jogador ou objeto-alvo.', min: 0.5, max: 100, step: 0.5 },
      { name: 'stopping_distance', label: 'Distância de parada', type: 'number', defaultValue: 1.4, description: 'Distância mínima mantida de um alvo ou destino.', min: 0.1, max: 20, step: 0.1 },
      { name: 'wander_radius', label: 'Raio de exploração', type: 'number', defaultValue: 5, description: 'Raio máximo em torno do ponto inicial usado pelo modo Vagar.', min: 0.5, max: 40, step: 0.5 },
      { name: 'patrol_radius', label: 'Raio de patrulha', type: 'number', defaultValue: 4, description: 'Distância de cada extremidade da patrulha em relação ao ponto inicial.', min: 0.5, max: 40, step: 0.5 },
      { name: 'idle_duration', label: 'Pausa entre movimentos (s)', type: 'number', defaultValue: 1.2, description: 'Tempo de espera ao chegar ao destino em modos Vagar e Patrulhar.', min: 0, max: 30, step: 0.1 },
      { name: 'target_object_id', label: 'Objeto-alvo', type: 'string', defaultValue: '', description: 'No modo Seguir outro objeto, selecione o GameObject usado como alvo.' },
      { name: 'destination_x', label: 'Destino X', type: 'number', defaultValue: 0, description: 'Coordenada X usada pelo modo Ir até coordenadas.', min: -49, max: 49, step: 0.1 },
      { name: 'destination_y', label: 'Destino Y', type: 'number', defaultValue: 0, description: 'Coordenada Y usada pelo modo Ir até coordenadas.', min: -50, max: 100, step: 0.1 },
      { name: 'destination_z', label: 'Destino Z', type: 'number', defaultValue: 0, description: 'Coordenada Z usada pelo modo Ir até coordenadas.', min: -49, max: 49, step: 0.1 },
      { name: 'state', label: 'Estado atual', type: 'string', defaultValue: 'idle', description: 'Estado calculado pelo motor durante Run; pode disparar eventos de comportamento.', readOnly: true },
    ],
    triggers: [
      { id: 'behavior_started', label: 'Comportamento iniciado', description: 'Disparado quando a rotina autônoma começa a agir.' },
      { id: 'behavior_stopped', label: 'Comportamento parado', description: 'Disparado quando uma rotina não direcionada deixa de agir.' },
      { id: 'target_detected', label: 'Alvo detectado', description: 'Disparado quando o jogador ou objeto-alvo entra na área de percepção.' },
      { id: 'target_lost', label: 'Alvo perdido', description: 'Disparado quando um alvo seguido deixa de estar ao alcance.' },
      { id: 'destination_reached', label: 'Destino alcançado', description: 'Disparado quando o objeto alcança as coordenadas configuradas.' },
    ],
    conditions: [
      { id: 'target_in_range', label: 'Alvo no alcance', description: 'Use as variáveis de percepção e estado em condições do Visual Script.' },
      { id: 'destination_reached', label: 'Destino alcançado', description: 'Consulte a variável de estado para executar ações após uma chegada.' },
    ],
    actions: [
      { id: 'change_mode', label: 'Alterar comportamento', description: 'Use uma regra do Visual Script para modificar a variável Comportamento.' },
      { id: 'set_variable', label: 'Definir variável', description: 'Altere parâmetros do pacote para modificar a rotina em execução.' },
    ],
    defaultConfig: {},
  },
  {
    id: 'combatant',
    version: '1.0.0',
    name: 'Combatente',
    description: 'Estado genérico de combate para personagens, criaturas e objetos destrutíveis; suas ações podem ser ligadas a qualquer Visual Script.',
    variables: [
      { name: 'health', label: 'Vida atual', type: 'number', defaultValue: 100, description: 'Recurso primário consumido ao receber dano.', min: 0, max: 999999999, step: 1 },
      { name: 'max_health', label: 'Vida máxima', type: 'number', defaultValue: 100, description: 'Limite máximo do recurso primário.', min: 1, max: 999999999, step: 1 },
      { name: 'alive', label: 'Vivo', type: 'boolean', defaultValue: true, description: 'Estado de vida sincronizado pelas ações de combate.', readOnly: true },
      { name: 'stamina', label: 'Vigor atual', type: 'number', defaultValue: 100, description: 'Recurso configurável para esquivas, ataques ou habilidades.', min: 0, max: 999999999, step: 1 },
      { name: 'max_stamina', label: 'Vigor máximo', type: 'number', defaultValue: 100, description: 'Limite máximo do recurso de vigor.', min: 1, max: 999999999, step: 1 },
      { name: 'posture', label: 'Postura', type: 'number', defaultValue: 0, description: 'Acúmulo opcional de postura.', min: 0, max: 999999999, step: 1 },
      { name: 'max_posture', label: 'Postura máxima', type: 'number', defaultValue: 100, description: 'Limite para quebra de postura.', min: 1, max: 999999999, step: 1 },
      { name: 'strength', label: 'Força', type: 'number', defaultValue: 10, description: 'Atributo numérico genérico usado por scripts.', min: 0, max: 999999, step: 1 },
      { name: 'dexterity', label: 'Destreza', type: 'number', defaultValue: 10, description: 'Atributo numérico genérico usado por scripts.', min: 0, max: 999999, step: 1 },
      { name: 'intellect', label: 'Intelecto', type: 'number', defaultValue: 10, description: 'Atributo numérico genérico usado por scripts.', min: 0, max: 999999, step: 1 },
      { name: 'will', label: 'Vontade', type: 'number', defaultValue: 10, description: 'Atributo numérico genérico usado por scripts.', min: 0, max: 999999, step: 1 },
      { name: 'resistance', label: 'Resistência padrão (%)', type: 'number', defaultValue: 0, description: 'Resistência fallback quando um tipo de dano não tem entrada própria.', min: -100, max: 95, step: 1 },
      { name: 'faction', label: 'Facção', type: 'string', defaultValue: 'neutral', description: 'Rótulo livre para regras de seleção de alvo.', options: [
        { value: 'neutral', label: 'Neutra' },
        { value: 'player', label: 'Jogador' },
        { value: 'hostile', label: 'Hostil' },
        { value: 'friendly', label: 'Aliada' },
      ] },
      { name: 'last_damage', label: 'Último dano recebido', type: 'number', defaultValue: 0, description: 'Resultado da última aplicação de dano.', readOnly: true },
      { name: 'last_damage_type', label: 'Tipo de dano recebido', type: 'string', defaultValue: '', description: 'Identificador livre do tipo de dano.', readOnly: true },
    ],
    triggers: [
      { id: 'damaged', label: 'Recebeu dano', description: 'Disparado por scripts genéricos quando o recurso primário diminui.' },
      { id: 'health_changed', label: 'Vida alterada', description: 'Disparado após alterar vida ou restaurá-la.' },
      { id: 'posture_broken', label: 'Postura quebrada', description: 'Disparado quando a postura alcança seu limite configurado.' },
      { id: 'defeated', label: 'Derrotado', description: 'Disparado quando a vida chega a zero.' },
      { id: 'revived', label: 'Reanimado', description: 'Disparado quando a vida volta a ficar acima de zero.' },
      { id: 'status_applied', label: 'Efeito aplicado', description: 'Disparado quando um efeito temporizado é adicionado.' },
      { id: 'status_expired', label: 'Efeito expirou', description: 'Disparado quando um efeito temporizado termina.' },
    ],
    conditions: [
      { id: 'alive', label: 'Está vivo', description: 'Teste a variável alive.' },
      { id: 'health_below', label: 'Vida abaixo do limite', description: 'Compare health com um limite numérico.' },
      { id: 'has_stamina', label: 'Tem recurso suficiente', description: 'Compare stamina com o custo da ação.' },
      { id: 'posture_broken', label: 'Postura no limite', description: 'Compare posture com max_posture.' },
      { id: 'faction', label: 'Facção corresponde', description: 'Compare faction com um rótulo configurado no projeto.' },
    ],
    actions: [
      { id: 'damage', label: 'Aplicar dano', description: 'Ajuste o recurso e acione eventos de dano, postura e derrota.' },
      { id: 'restore_resource', label: 'Restaurar recurso', description: 'Restaure vida, vigor ou outra variável numérica até um limite.' },
      { id: 'spend_resource', label: 'Consumir recurso', description: 'Consuma vigor, éter ou qualquer variável numérica configurada.' },
      { id: 'apply_status', label: 'Aplicar efeito temporizado', description: 'Adicione um estado com duração, potência e acúmulos.' },
      { id: 'revive', label: 'Reanimar', description: 'Restaure um ator derrotado e dispare o evento de retorno.' },
    ],
    defaultConfig: { resistances: {}, statuses: [] },
  },
]

interface PackageDefinitionRegistration {
  references: number
  removeWhenUnused: boolean
}

const packageDefinitionRegistrations = new WeakMap<BehaviorPackageDefinition, PackageDefinitionRegistration>()

/** Registra um pacote externo sem adicionar suas regras ao núcleo da engine. */
export function registerBehaviorPackageDefinition(definition: BehaviorPackageDefinition): () => void {
  const id = definition.id.trim()
  if (!id) throw new Error('A definição do pacote precisa de um identificador não vazio.')

  const existing = BEHAVIOR_PACKAGE_DEFINITIONS.find(item => item.id === id)
  if (existing && existing !== definition) {
    throw new Error(`Já existe uma definição de pacote com o identificador "${id}".`)
  }

  let registration = packageDefinitionRegistrations.get(definition)
  if (registration) {
    registration.references += 1
  } else {
    const wasAlreadyPresent = existing === definition
    registration = {
      references: 1,
      removeWhenUnused: !wasAlreadyPresent,
    }
    packageDefinitionRegistrations.set(definition, registration)
    if (!wasAlreadyPresent) BEHAVIOR_PACKAGE_DEFINITIONS.push(definition)
  }

  let released = false
  return () => {
    if (released) return
    released = true

    const current = packageDefinitionRegistrations.get(definition)
    if (!current) return
    current.references -= 1
    if (current.references > 0) return

    packageDefinitionRegistrations.delete(definition)
    if (!current.removeWhenUnused) return

    const index = BEHAVIOR_PACKAGE_DEFINITIONS.indexOf(definition)
    if (index >= 0) BEHAVIOR_PACKAGE_DEFINITIONS.splice(index, 1)
  }
}

export function getBehaviorPackageDefinition(packageId: string): BehaviorPackageDefinition | undefined {
  return BEHAVIOR_PACKAGE_DEFINITIONS.find(definition => definition.id === packageId)
}

export function createBehaviorPackageInstance(packageId: string, ownerObjectId: string): BehaviorPackageInstance {
  const definition = getBehaviorPackageDefinition(packageId)
  if (!definition) throw new Error(`Pacote de comportamento desconhecido: "${packageId}".`)
  const variables: Record<string, PackageScalar> = {}
  for (const variable of definition.variables) variables[variable.name] = variable.defaultValue
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `pkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return {
    id,
    packageId,
    ownerObjectId,
    enabled: true,
    variables,
    config: JSON.parse(JSON.stringify(definition.defaultConfig)) as Record<string, PackageJsonValue>,
  }
}

function readMountModelStates(value: PackageJsonValue | undefined): MountModelStateRule[] {
  if (!Array.isArray(value)) return []
  const result: MountModelStateRule[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const rule = item as Record<string, PackageJsonValue>
    const scalar = rule.value
    if (typeof rule.id !== 'string' || typeof rule.nodePath !== 'string' || !rule.nodePath.trim() ||
        typeof rule.variable !== 'string' || !rule.variable.trim() ||
        (typeof scalar !== 'boolean' && typeof scalar !== 'number' && typeof scalar !== 'string')) continue
    result.push({
      id: rule.id,
      nodePath: rule.nodePath,
      variable: rule.variable,
      operator: rule.operator === 'not_equals' ? 'not_equals' : 'equals',
      value: scalar,
      visibleWhenMatched: rule.visibleWhenMatched !== false,
    })
  }
  return result
}

function readMountPoints(value: PackageJsonValue | undefined): MountPointConfig[] {
  if (!Array.isArray(value)) return []
  const result: MountPointConfig[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const mp = item as Record<string, PackageJsonValue>
    if (typeof mp.id !== 'string' || typeof mp.label !== 'string' ||
        !Array.isArray(mp.localOffset) || mp.localOffset.length !== 3) continue
    result.push({
      id: mp.id,
      label: mp.label,
      localOffset: [mp.localOffset[0] as number, mp.localOffset[1] as number, mp.localOffset[2] as number],
      localRotation: Array.isArray(mp.localRotation) && mp.localRotation.length === 3
        ? [mp.localRotation[0] as number, mp.localRotation[1] as number, mp.localRotation[2] as number]
        : undefined,
      boneName: typeof mp.boneName === 'string' ? mp.boneName : undefined,
      capacityTags: Array.isArray(mp.capacityTags) ? mp.capacityTags.map(t => t as string) : ['passenger'],
      priority: typeof mp.priority === 'number' ? mp.priority : 0,
      stateVariable: typeof mp.stateVariable === 'string' ? mp.stateVariable : undefined,
      playerUsable: mp.playerUsable !== false,
      requiresInteraction: mp.requiresInteraction !== false,
      cameraOffset: Array.isArray(mp.cameraOffset) && mp.cameraOffset.length === 3
        ? [mp.cameraOffset[0] as number, mp.cameraOffset[1] as number, mp.cameraOffset[2] as number]
        : undefined,
    })
  }
  return result
}

function readAnimationMapping(value: PackageJsonValue | undefined): MountAnimationMapping | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const am = value as Record<string, PackageJsonValue>
  return {
    mountClipNames: (am.mountClipNames as Record<string, string>) ?? {},
    playerClipNames: (am.playerClipNames as Record<string, string>) ?? {},
    mountTransitionRole: typeof am.mountTransitionRole === 'string' ? am.mountTransitionRole : 'mount_transition_mount',
    dismountTransitionRole: typeof am.dismountTransitionRole === 'string' ? am.dismountTransitionRole : 'mount_transition_dismount',
    useGenericFallback: am.useGenericFallback !== false,
  }
}

export function getMountPackageSettings(instance: BehaviorPackageInstance): MountPackageSettings {
  const seatOffset = instance.config.seatOffset
  const validSeatOffset: [number, number, number] = Array.isArray(seatOffset) && seatOffset.length === 3 &&
    seatOffset.every(value => typeof value === 'number' && Number.isFinite(value))
      ? [seatOffset[0] as number, seatOffset[1] as number, seatOffset[2] as number]
      : [0, 1.2, 0]
  const getNumber = (name: string, fallback: number, min: number, max: number): number => {
    const value = instance.variables[name]
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback
  }
  const getBoolean = (name: string, fallback: boolean): boolean => {
    const value = instance.variables[name]
    return typeof value === 'boolean' ? value : fallback
  }
  const rawBindings = instance.config.controlBindings
  const bindingsRecord = rawBindings && typeof rawBindings === 'object' && !Array.isArray(rawBindings)
    ? rawBindings as Record<string, PackageJsonValue>
    : {}
  const readKey = (name: keyof ModelControlBindings): string => {
    const value = bindingsRecord[name]
    return typeof value === 'string' && value.trim()
      ? value
      : DEFAULT_MODEL_CONTROL_BINDINGS[name]
  }
  const mappedInteractionKey = readKey('interact')
  const legacyInteractionKey = instance.config.interactionKey
  // Configs criadas antes da tela de controles só possuem interactionKey.
  // Se o mapa novo ainda usa o padrão, respeite a opção legada.
  const interactionKey = mappedInteractionKey !== DEFAULT_MODEL_CONTROL_BINDINGS.interact
    ? mappedInteractionKey
    : typeof legacyInteractionKey === 'string' && legacyInteractionKey.trim()
      ? legacyInteractionKey
      : mappedInteractionKey
  const controlBindings: ModelControlBindings = {
    forward: readKey('forward'),
    backward: readKey('backward'),
    left: readKey('left'),
    right: readKey('right'),
    run: readKey('run'),
    jump: readKey('jump'),
    interact: interactionKey,
  }
  return {
    interactionKey,
    controlBindings,
    seatOffset: validSeatOffset,
    speed: getNumber('speed', 5.0, 0.2, 20),
    runMultiplier: getNumber('runMultiplier', 1.8, 1, 3),
    sprintMultiplier: getNumber('sprintMultiplier', 2.5, 1, 5),
    jumpImpulse: getNumber('jumpImpulse', 8.0, 0, 50),
    gravity: getNumber('gravity', 20.0, 0, 50),
    maxSlopeAngle: getNumber('maxSlopeAngle', Math.PI / 3, 0, Math.PI / 2),
    maxStepHeight: getNumber('maxStepHeight', 0.5, 0, 2),
    turnSpeed: getNumber('turnSpeed', 3.0, 0.5, 20),
    cameraSmoothing: getNumber('cameraSmoothing', 0.1, 0, 1),
    canJump: getBoolean('canJump', true),
    canSprint: getBoolean('canSprint', true),
    canAttack: false, // Legacy, not in new system
    useCharacterController: getBoolean('useCharacterController', true),
    interactionRadius: getNumber('interactionRadius', 3.0, 0.5, 10),
    modelStates: readMountModelStates(instance.config.modelStates),
    mountPoints: readMountPoints(instance.config.mountPoints),
    animationMapping: readAnimationMapping(instance.config.animationMapping),
  }
}

/**
 * Obtém a configuração de montaria no novo formato (MountConfig) a partir da instância do pacote.
 * Usa a função de migração para converter configurações legadas.
 */
export function getMountConfig(instance: BehaviorPackageInstance): MountConfig {
  const legacySettings = getMountPackageSettings(instance)
  return migrateLegacyMountSettings(legacySettings)
}
