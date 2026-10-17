export type PackageScalar = boolean | number | string
export type PackageJsonValue =
  | PackageScalar
  | null
  | PackageJsonValue[]
  | { [key: string]: PackageJsonValue }

export type MountMovementState = 'idle' | 'walk' | 'run' | 'walk_diagonal_left' | 'walk_diagonal_right' | 'run_diagonal_left' | 'run_diagonal_right'
export type AnimationRole = 'ignore' | 'idle' | 'walk' | 'run' | 'walk_diagonal_left' | 'walk_diagonal_right' | 'run_diagonal_left' | 'run_diagonal_right' | 'run_stop' | 'jump' | 'mount' | 'dismount'

/** Ações extras que podem ser acionadas pelo mapa de controles e conectadas ao Visual Script. */
export type ModelControlActionId =
  | 'crouch'
  | 'primary_action'
  | 'secondary_action'
  | 'dodge'
  | 'ability_1'
  | 'ability_2'
  | 'use_item'
  | 'inventory'
  | 'map'
  | 'pause'
  | 'camera_toggle'

/** Teclas do teclado associadas aos comandos de controle de um modelo. */
export interface ModelControlBindings {
  forward: string
  backward: string
  left: string
  right: string
  run: string
  jump: string
  interact: string
  crouch: string
  primaryAction: string
  secondaryAction: string
  dodge: string
  ability1: string
  ability2: string
  useItem: string
  inventory: string
  map: string
  pause: string
  cameraToggle: string
}

export const DEFAULT_MODEL_CONTROL_BINDINGS: ModelControlBindings = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
  crouch: 'ControlLeft',
  primaryAction: 'KeyF',
  secondaryAction: 'KeyQ',
  dodge: 'KeyC',
  ability1: 'Digit1',
  ability2: 'Digit2',
  useItem: 'KeyG',
  inventory: 'KeyI',
  map: 'KeyM',
  pause: 'Escape',
  cameraToggle: 'KeyV',
}

/** Liga o nome da ação de gameplay ao campo configurável do mapa do modelo. */
export const MODEL_CONTROL_ACTIONS: Array<{
  id: ModelControlActionId
  binding: keyof ModelControlBindings
  label: string
  description: string
}> = [
  { id: 'crouch', binding: 'crouch', label: 'Agachar', description: 'Dispara o evento Agachar no Visual Script.' },
  { id: 'primary_action', binding: 'primaryAction', label: 'Ação primária / ataque', description: 'Ação principal do personagem ou da montaria.' },
  { id: 'secondary_action', binding: 'secondaryAction', label: 'Ação secundária / defesa', description: 'Ataque alternativo, defesa ou mira.' },
  { id: 'dodge', binding: 'dodge', label: 'Esquiva', description: 'Executa uma regra de esquiva ou rolamento.' },
  { id: 'ability_1', binding: 'ability1', label: 'Habilidade 1', description: 'Ativa uma habilidade configurada no Visual Script.' },
  { id: 'ability_2', binding: 'ability2', label: 'Habilidade 2', description: 'Ativa uma segunda habilidade.' },
  { id: 'use_item', binding: 'useItem', label: 'Usar item', description: 'Executa uma ação de uso de item.' },
  { id: 'inventory', binding: 'inventory', label: 'Inventário', description: 'Abre ou fecha o inventário por meio de regras.' },
  { id: 'map', binding: 'map', label: 'Mapa', description: 'Aciona a ação de mapa.' },
  { id: 'pause', binding: 'pause', label: 'Pausa / menu', description: 'Aciona uma regra de pausa ou menu.' },
  { id: 'camera_toggle', binding: 'cameraToggle', label: 'Alternar câmera', description: 'Aciona uma regra para alternar câmeras.' },
]

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
]

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
    crouch: readKey('crouch'),
    primaryAction: readKey('primaryAction'),
    secondaryAction: readKey('secondaryAction'),
    dodge: readKey('dodge'),
    ability1: readKey('ability1'),
    ability2: readKey('ability2'),
    useItem: readKey('useItem'),
    inventory: readKey('inventory'),
    map: readKey('map'),
    pause: readKey('pause'),
    cameraToggle: readKey('cameraToggle'),
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
