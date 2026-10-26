import { BEHAVIOR_PACKAGE_DEFINITIONS } from '@engine'
import type { ModelControlBindings } from '@engine'
import { clonePackageJsonRecord } from '../PackageJson'
import { mergeImportBehaviorPackageDraft } from './ImportBehaviorPackageDrafts'
import type { ImportBehaviorPackageDraft } from './ImportBehaviorPackageDrafts'

export type StarterCatalogAssetRole = 'player' | 'enemy' | 'loot' | 'object'

export type StarterCatalogBehaviorPresetInput = {
  role: StarterCatalogAssetRole
  aiProfile?: string
  itemId?: string
}

export type StarterCatalogBehaviorPreset = {
  packageIds: string[]
  packageSettings: Record<string, ImportBehaviorPackageDraft>
}

/**
 * Creates the default Veilborne RPG package settings for catalog enemies and loot.
 * Ordinary player/object catalog assets start without an automatically selected package.
 */
export function prepareStarterCatalogBehaviorPreset(
  asset: StarterCatalogBehaviorPresetInput,
  controlBindings: ModelControlBindings,
): StarterCatalogBehaviorPreset {
  if (asset.role !== 'enemy' && asset.role !== 'loot') {
    return { packageIds: [], packageSettings: {} }
  }

  const packageId = 'veilborne_rpg'
  const definition = BEHAVIOR_PACKAGE_DEFINITIONS.find(item => item.id === packageId)
  // O catálogo do editor continua funcional mesmo quando o pacote VEILBORNE
  // não foi carregado pelo host. Um pacote ausente não deve ser instalado por ID.
  if (!definition) return { packageIds: [], packageSettings: {} }
  const draft = mergeImportBehaviorPackageDraft(definition, controlBindings)

  draft.variables.entity_role = asset.role === 'enemy' ? 'combatant' : 'loot'
  draft.variables.faction = asset.role === 'enemy' ? 'hostile' : 'neutral'
  draft.variables.ai_enabled = asset.role === 'enemy'
  draft.variables.ai_custom_stats = false
  if (asset.role === 'enemy') {
    draft.variables.ai_profile = asset.aiProfile ?? 'melee'
  } else {
    draft.variables.loot_item_id = asset.itemId ?? 'lesser_vitality_vial'
    draft.variables.loot_quantity = 1
  }

  return {
    packageIds: [packageId],
    packageSettings: {
      [packageId]: {
        variables: { ...draft.variables },
        config: clonePackageJsonRecord(draft.config),
      },
    },
  }
}
