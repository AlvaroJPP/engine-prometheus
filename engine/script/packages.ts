export type PackageScalar = boolean | number | string
export type PackageJsonValue =
  | PackageScalar
  | null
  | PackageJsonValue[]
  | { [key: string]: PackageJsonValue }

export type AnimationRole = 'ignore' | 'idle' | 'walk' | 'run' | 'mount' | 'dismount'

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
}

export const BEHAVIOR_PACKAGE_DEFINITIONS: BehaviorPackageDefinition[] = [
  {
    id: 'mount',
    version: '1.0.0',
    name: 'Montaria',
    description: 'Permite montar em um objeto próximo, controlá-lo com WASD e alternar as animações de parado, andar e correr.',
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
        description: 'Parado, andando ou correndo; pode ser usado como condição em regras deste pacote.',
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
      { id: 'movement_changed', label: 'Movimento alterado', description: 'Parado, andando ou correndo.' },
    ],
    conditions: [
      { id: 'in_range', label: 'Jogador ao alcance', description: 'Verifica a distância horizontal até o jogador.' },
      { id: 'not_mounted', label: 'Ainda não montado', description: 'Impede iniciar uma segunda montaria.' },
      { id: 'has_animation', label: 'Animação disponível', description: 'Confere se o modelo tem o clipe atribuído à função.' },
    ],
    actions: [
      { id: 'mount', label: 'Montar', description: 'Vincula o jogador à montaria e transfere os controles.' },
      { id: 'dismount', label: 'Desmontar', description: 'Devolve o controle e posiciona o jogador ao lado do objeto.' },
      { id: 'play_animation', label: 'Reproduzir animação', description: 'Executa o clipe atribuído a parado, andar, correr, montar ou desmontar.' },
      { id: 'set_variable', label: 'Definir variável', description: 'Altera uma variável deste pacote.' },
    ],
    defaultConfig: {
      interactionKey: 'KeyE',
      seatOffset: [0, 0.55, 0],
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
  const interactionKey = instance.config.interactionKey
  return {
    interactionKey: typeof interactionKey === 'string' && interactionKey.trim() ? interactionKey : 'KeyE',
    seatOffset: validSeatOffset,
    speed: getNumber('speed', 4.2, 0.2, 20),
    runMultiplier: getNumber('runMultiplier', 1.7, 1, 3),
    interactionRadius: getNumber('interactionRadius', 2.5, 0.5, 10),
  }
}
