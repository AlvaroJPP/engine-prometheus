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

/** Ações reproduzidas uma vez e depois devolvidas ao estado de repouso/movimento. */
export const ONE_SHOT_ANIMATION_ROLES: ReadonlySet<AnimationRole> = new Set([
  'run_stop', 'jump', 'dodge', 'slide', 'roll', 'interact',
  'primary_action', 'secondary_action', 'inventory', 'use_item', 'reload',
  'ability_1', 'ability_2', 'ability_3', 'ability_4', 'emote',
  'mount', 'dismount',
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
    id: 'veilborne_rpg',
    version: '0.1.0',
    name: 'VEILBORNE — RPG Sombrio',
    description: 'Base modular de RPG medieval sombrio para magos guerreiros: atributos, armas, éter, vigor, postura, feitiços, sigilos, inimigos e progressão.',
    variables: [
      { name: 'level', label: 'Nível', type: 'number', defaultValue: 1, description: 'Nível atual do personagem.', min: 1, max: 999, step: 1 },
      { name: 'vida', label: 'Vida atual', type: 'number', defaultValue: 100, description: 'Pontos de vida atuais do personagem.', min: 0, max: 999999, step: 1 },
      { name: 'vida_max', label: 'Vida máxima', type: 'number', defaultValue: 100, description: 'Limite de vida antes de aplicar bônus de equipamento.', min: 1, max: 999999, step: 1 },
      { name: 'eter', label: 'Éter atual', type: 'number', defaultValue: 100, description: 'Recurso gasto para lançar feitiços e ativar sigilos.', min: 0, max: 999999, step: 1 },
      { name: 'eter_max', label: 'Éter máximo', type: 'number', defaultValue: 100, description: 'Capacidade máxima de éter.', min: 1, max: 999999, step: 1 },
      { name: 'vigor', label: 'Vigor atual', type: 'number', defaultValue: 100, description: 'Recurso para esquivas, bloqueios e ataques físicos.', min: 0, max: 999999, step: 1 },
      { name: 'vigor_max', label: 'Vigor máximo', type: 'number', defaultValue: 100, description: 'Capacidade máxima de vigor.', min: 1, max: 999999, step: 1 },
      { name: 'postura', label: 'Postura', type: 'number', defaultValue: 0, description: 'Dano de postura acumulado; ao atingir postura_max, o alvo pode ser atordoado.', min: 0, max: 999999, step: 1 },
      { name: 'postura_max', label: 'Postura para quebra', type: 'number', defaultValue: 100, description: 'Limite de postura para atordoamento.', min: 1, max: 999999, step: 1 },
      { name: 'forca', label: 'Força', type: 'number', defaultValue: 10, description: 'Escala o dano de armas pesadas e ataques físicos.', min: 1, max: 999, step: 1 },
      { name: 'destreza', label: 'Destreza', type: 'number', defaultValue: 10, description: 'Escala armas rápidas e pode melhorar a velocidade de ataque.', min: 1, max: 999, step: 1 },
      { name: 'intelecto', label: 'Intelecto', type: 'number', defaultValue: 10, description: 'Escala poder mágico e capacidade de éter.', min: 1, max: 999, step: 1 },
      { name: 'vontade', label: 'Vontade', type: 'number', defaultValue: 10, description: 'Escala sigilos e resistência a efeitos sobrenaturais.', min: 1, max: 999, step: 1 },
      { name: 'resistencia', label: 'Resistência', type: 'number', defaultValue: 10, description: 'Escala defesa física, vitalidade e resistência elemental.', min: 1, max: 999, step: 1 },
      { name: 'ecos', label: 'Ecos', type: 'number', defaultValue: 0, description: 'Recurso de progressão carregado pelo personagem.', min: 0, max: 999999999, step: 1 },
      { name: 'alvo_travado', label: 'Alvo travado', type: 'boolean', defaultValue: false, description: 'Indica se o sistema de combate está travado em um alvo.' },
      { name: 'morto', label: 'Morto', type: 'boolean', defaultValue: false, description: 'Estado de morte do personagem; o runtime deve definir e limpar este valor.' },
    ],
    triggers: [
      { id: 'combat_started', label: 'Combate iniciado', description: 'Um alvo hostil detectou o personagem ou recebeu o primeiro ataque.' },
      { id: 'quick_attack', label: 'Ataque rápido', description: 'O jogador solicita um ataque rápido com a arma equipada.' },
      { id: 'heavy_attack', label: 'Ataque pesado', description: 'O jogador solicita um ataque pesado ou carregado.' },
      { id: 'dodge', label: 'Esquiva', description: 'O jogador solicita uma esquiva usando vigor.' },
      { id: 'parry_success', label: 'Aparo perfeito', description: 'Um ataque inimigo foi aparado dentro da janela configurada.' },
      { id: 'spell_cast', label: 'Feitiço lançado', description: 'Um feitiço foi lançado e os custos foram validados.' },
      { id: 'sigil_triggered', label: 'Sigilo ativado', description: 'Um sigilo preparado detectou sua condição de ativação.' },
      { id: 'posture_broken', label: 'Postura quebrada', description: 'A postura de um combatente chegou ao limite.' },
      { id: 'enemy_killed', label: 'Inimigo derrotado', description: 'Um inimigo entrou no estado de morte.' },
      { id: 'player_died', label: 'Jogador morreu', description: 'A vida chegou a zero e o estado de morte foi ativado.' },
      { id: 'checkpoint_used', label: 'Santuário usado', description: 'O jogador ativou um santuário ou ponto de descanso.' },
    ],
    conditions: [
      { id: 'has_vitality', label: 'Possui vida', description: 'Verifica se a vida atual é maior que zero.' },
      { id: 'has_ether', label: 'Éter suficiente', description: 'Verifica se o personagem pode pagar o custo de magia.' },
      { id: 'has_stamina', label: 'Vigor suficiente', description: 'Verifica se o personagem pode executar a ação física.' },
      { id: 'target_in_range', label: 'Alvo no alcance', description: 'Verifica distância e alcance de ataque ou feitiço.' },
      { id: 'target_vulnerable', label: 'Alvo vulnerável', description: 'Verifica atordoamento, recuperação ou fase vulnerável do alvo.' },
      { id: 'sigil_ready', label: 'Sigilo preparado', description: 'Verifica se o sigilo está equipado e fora de recarga.' },
      { id: 'is_alive', label: 'Está vivo', description: 'Impede ações de combate enquanto o personagem está morto.' },
    ],
    actions: [
      { id: 'apply_damage', label: 'Aplicar dano', description: 'Aplica dano físico, mágico ou elemental com resistências.' },
      { id: 'restore_vitality', label: 'Restaurar vida', description: 'Recupera vida sem ultrapassar o limite máximo.' },
      { id: 'spend_ether', label: 'Gastar éter', description: 'Deduz o custo de um feitiço ou sigilo se houver recurso suficiente.' },
      { id: 'spend_stamina', label: 'Gastar vigor', description: 'Deduz o custo de ataque, esquiva ou bloqueio.' },
      { id: 'cast_spell', label: 'Lançar feitiço', description: 'Solicita o feitiço equipado com alvo, alcance, custo e recarga.' },
      { id: 'activate_sigil', label: 'Ativar sigilo', description: 'Cria ou dispara um sigilo preparado.' },
      { id: 'add_status_effect', label: 'Aplicar efeito de estado', description: 'Aplica queimadura, sangramento, geada, choque, maldição ou lentidão.' },
      { id: 'add_echoes', label: 'Adicionar Ecos', description: 'Adiciona recurso de progressão por vitória ou recompensa.' },
      { id: 'respawn_at_checkpoint', label: 'Renascer no santuário', description: 'Reposiciona o jogador no último ponto de descanso salvo.' },
    ],
    defaultConfig: {
      combat: {
        targetLock: true,
        quickAttack: true,
        heavyAttack: true,
        chargedAttack: true,
        dodgeInvulnerabilitySeconds: 0.22,
        dodgeVigorCost: 22,
        parryWindowSeconds: 0.2,
        postureBreakEnabled: true,
      },
      equippedWeapon: 'starter_arcane_sword',
      equippedCatalyst: 'starter_rune_staff',
      preparedSigils: ['ward', 'blast', 'hunter_mark', 'slow_field'],
      spellSlots: 4,
      sigilSlots: 4,
      deathRecovery: 'recover_echoes_at_death_location',
      saveProgression: true,
    },
  },
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
