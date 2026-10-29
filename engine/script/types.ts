import type { BehaviorPackageInstance, PackageScalar } from './packages'

export type RuleTrigger =
  | { type: 'object_clicked'; objectId: string }
  | { type: 'enter_area'; center: [number, number, number]; radius: number }
  | { type: 'key_pressed'; key: string }
  | { type: 'global_event'; eventId: string }
  | { type: 'player_event'; eventId: string }
  | { type: 'package_event'; objectId: string; packageId: string; eventId: string }

export type RuleCondition = { type: 'variable'; name: string; operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than'; value: boolean | number | string }

export type RuleAction =
  | { type: 'move'; objectId: string; x?: number; y?: number; z?: number }
  | { type: 'rotate'; objectId: string; degrees: number }
  | { type: 'set_visible'; objectId: string; visible: boolean }
  | { type: 'set_variable'; name: string; value: boolean | number | string; objectId?: string; scope?: 'global' | 'object' }
  | { type: 'set_package_variable'; objectId: string; packageId: string; name: string; value: PackageScalar }
  | { type: 'script'; code: string }
  | { type: 'javascript'; code: string }

export interface LogicRule {
  /** Objeto proprietário deste evento; regras de objetos diferentes nunca são compartilhadas. */
  ownerObjectId?: string
  id: string
  name: string
  enabled: boolean
  trigger: RuleTrigger
  conditions: RuleCondition[]
  actions: RuleAction[]
  /** Identifica regras instanciadas automaticamente por um pacote de comportamento. */
  sourcePackageInstanceId?: string
  /** Identifies a global script installed from a reusable package definition. */
  sourcePackageDefinitionId?: string
  /** Interno: evita disparar continuamente enquanto permanece na área. */
  /** Posições persistidas dos nós no editor visual. */
  graphLayout?: { trigger: { x: number; y: number }; condition: { x: number; y: number }; action: { x: number; y: number } }
  lastInside?: boolean
}

export interface LogicEventsFile {
  formatVersion: 1
  variables: Record<string, boolean | number | string>
  /** Variáveis isoladas por GameObject, indexadas pelo ID do objeto. */
  objectVariables?: Record<string, Record<string, boolean | number | string>>
  events: LogicRule[]
  /** Instâncias de pacotes de comportamento vinculadas aos objetos da cena. */
  packages?: BehaviorPackageInstance[]
  /** IDs de scripts de pacote removidos deliberadamente pelo autor do projeto. */
  disabledPackageScripts?: string[]
}

export const EMPTY_LOGIC: LogicEventsFile = { formatVersion: 1, variables: {}, events: [], packages: [] }
