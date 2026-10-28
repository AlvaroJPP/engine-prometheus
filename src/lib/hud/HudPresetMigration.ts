export const ALQUIMIA_HUD_MIGRATION_KEY = 'engine-prometheus.player-hud.migration.remove-default-alquimia.v1'

export interface HudPresetLayerIdentity {
  id: string
  name: string
}

const LEGACY_ALQUIMIA_HUD_LAYER_IDS = new Set([
  'hud-alquimia-nameplate',
  'hud-alquimia-sigil',
  'hud-alquimia-statusbar',
])

/**
 * Remove a cópia legada do tema Alquimia Escarlate que ficou salva como HUD
 * padrão em versões anteriores. O usuário ainda pode aplicar o tema de novo.
 */
export function removeLegacyDefaultAlquimiaHudLayers<T extends HudPresetLayerIdentity>(
  layers: readonly T[],
): { layers: T[]; removedIds: string[] } {
  const removedIds = new Set(
    layers
      .filter(layer =>
        LEGACY_ALQUIMIA_HUD_LAYER_IDS.has(layer.id)
        || layer.name.trim().startsWith('Alquimia Escarlate ·'),
      )
      .map(layer => layer.id),
  )

  return {
    layers: layers.filter(layer => !removedIds.has(layer.id)),
    removedIds: [...removedIds],
  }
}
