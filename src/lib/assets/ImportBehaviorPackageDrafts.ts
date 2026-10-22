import type {
  BehaviorPackageDefinition,
  ModelControlBindings,
  PackageJsonValue,
  PackageScalar,
} from '@engine'
import { clonePackageJsonRecord } from '../PackageJson.ts'

export type ImportBehaviorPackageDraft = {
  variables: Record<string, PackageScalar>
  config: Record<string, PackageJsonValue>
}

/** Clona rascunhos armazenados sem compartilhar configurações aninhadas. */
export function cloneImportBehaviorPackageSettings(
  settings: Record<string, ImportBehaviorPackageDraft>,
): Record<string, ImportBehaviorPackageDraft> {
  return Object.fromEntries(Object.entries(settings).map(([id, draft]) => [id, {
    variables: { ...draft.variables },
    config: clonePackageJsonRecord(draft.config),
  }]))
}

/** Cria a configuração inicial de um pacote e sincroniza as teclas da montaria. */
export function createImportBehaviorPackageDraft(
  definition: BehaviorPackageDefinition,
  controlBindings: ModelControlBindings,
): ImportBehaviorPackageDraft {
  const variables = Object.fromEntries(
    definition.variables.map(variable => [variable.name, variable.defaultValue]),
  ) as Record<string, PackageScalar>
  const config = clonePackageJsonRecord(definition.defaultConfig)

  if (definition.id === 'mount') {
    const defaults = config.controlBindings && typeof config.controlBindings === 'object' && !Array.isArray(config.controlBindings)
      ? config.controlBindings as Record<string, PackageJsonValue>
      : {}
    config.controlBindings = { ...defaults, ...controlBindings } as Record<string, PackageJsonValue>
    config.interactionKey = controlBindings.interact
  }

  return { variables, config }
}

/** Combina padrões atuais e alterações anteriores, preservando controles personalizados da montaria. */
export function mergeImportBehaviorPackageDraft(
  definition: BehaviorPackageDefinition,
  controlBindings: ModelControlBindings,
  existing?: ImportBehaviorPackageDraft,
): ImportBehaviorPackageDraft {
  const defaults = createImportBehaviorPackageDraft(definition, controlBindings)
  const draft: ImportBehaviorPackageDraft = existing
    ? {
        variables: { ...defaults.variables, ...existing.variables },
        config: { ...defaults.config, ...existing.config },
      }
    : defaults

  const currentControls = existing?.config.controlBindings
  if (definition.id === 'mount' && currentControls && typeof currentControls === 'object' && !Array.isArray(currentControls)) {
    draft.config.controlBindings = {
      ...((defaults.config.controlBindings && typeof defaults.config.controlBindings === 'object' && !Array.isArray(defaults.config.controlBindings))
        ? defaults.config.controlBindings as Record<string, PackageJsonValue>
        : {}),
      ...(currentControls as Record<string, PackageJsonValue>),
    }
  }

  return draft
}
