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
}

export interface BehaviorPackageInstance {
  id: string
  packageId: string
  ownerObjectId: string
  enabled: boolean
  variables: Record<string, PackageScalar>
  config: Record<string, PackageJsonValue>
}

export interface MountPackageSettings {
  interactionKey: string
  seatOffset: [number, number, number]
  speed: number
  runMultiplier: number
  interactionRadius: number
  modelStates: MountModelStateRule[]
  controlBindings: ModelControlBindings
}

export const BEHAVIOR_PACKAGE_DEFINITIONS: BehaviorPackageDefinition[] = [
  {
    id: 'mount',
    version: '1.0.0',
    name: 'Montaria',
    description: 'Permite montar em um objeto próximo, controlar seus movimentos e mapear animações, transições e estados visuais do modelo.',
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
        description: 'Parado, andando, correndo ou deslocando-se na diagonal; pode ser usado como condição em regras deste pacote.',
        readOnly: true,
      },
      {
        name: 'speed',
        label: 'Velocidade base',
        type: 'number',
        defaultValue: 4.2,
        description: 'Velocidade de deslocamento enquanto caminha.',
        min: 0.2,
        max: 20,
        step: 0.1,
      },
      {
        name: 'runMultiplier',
        label: 'Multiplicador de corrida',
        type: 'number',
        defaultValue: 1.7,
        description: 'Multiplica a velocidade quando o jogador segura Shift.',
        min: 1,
        max: 3,
        step: 0.1,
      },
      {
        name: 'interactionRadius',
        label: 'Distância para montar',
        type: 'number',
        defaultValue: 2.5,
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
      { id: 'movement_changed', label: 'Movimento alterado', description: 'Parado, andando, correndo e movimentos diagonais.' },
    ],
    conditions: [
      { id: 'in_range', label: 'Jogador ao alcance', description: 'Verifica a distância horizontal até o jogador.' },
      { id: 'not_mounted', label: 'Ainda não montado', description: 'Impede iniciar uma segunda montaria.' },
      { id: 'has_animation', label: 'Animação disponível', description: 'Confere se o modelo tem o clipe atribuído à função.' },
    ],
    actions: [
      { id: 'mount', label: 'Montar', description: 'Vincula o jogador à montaria e transfere os controles.' },
      { id: 'dismount', label: 'Desmontar', description: 'Devolve o controle e posiciona o jogador ao lado do objeto.' },
      { id: 'play_animation', label: 'Reproduzir animação', description: 'Executa o clipe atribuído a cada movimento, diagonal e transição.' },
      { id: 'set_variable', label: 'Definir variável', description: 'Altera uma variável deste pacote.' },
    ],
    defaultConfig: {
      interactionKey: 'KeyE',
      controlBindings: { ...DEFAULT_MODEL_CONTROL_BINDINGS },
      seatOffset: [0, 0.55, 0],
      modelStates: [],
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
]

/** Registra um pacote externo sem adicionar suas regras ao núcleo da engine. */
export function registerBehaviorPackageDefinition(definition: BehaviorPackageDefinition): () => void {
  const id = definition.id.trim()
  if (!id) throw new Error('A definição do pacote precisa de um identificador não vazio.')
  const existing = BEHAVIOR_PACKAGE_DEFINITIONS.find(item => item.id === id)
  if (existing) {
    if (existing === definition) return () => undefined
    throw new Error(`Já existe uma definição de pacote com o identificador "${id}".`)
  }
  BEHAVIOR_PACKAGE_DEFINITIONS.push(definition)
  return () => {
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

export function getMountPackageSettings(instance: BehaviorPackageInstance): MountPackageSettings {
  const seatOffset = instance.config.seatOffset
  const validSeatOffset: [number, number, number] = Array.isArray(seatOffset) && seatOffset.length === 3 &&
    seatOffset.every(value => typeof value === 'number' && Number.isFinite(value))
      ? [seatOffset[0] as number, seatOffset[1] as number, seatOffset[2] as number]
      : [0, 0.55, 0]
  const getNumber = (name: string, fallback: number, min: number, max: number): number => {
    const value = instance.variables[name]
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback
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
    speed: getNumber('speed', 4.2, 0.2, 20),
    runMultiplier: getNumber('runMultiplier', 1.7, 1, 3),
    interactionRadius: getNumber('interactionRadius', 2.5, 0.5, 10),
    modelStates: readMountModelStates(instance.config.modelStates),
  }
}
