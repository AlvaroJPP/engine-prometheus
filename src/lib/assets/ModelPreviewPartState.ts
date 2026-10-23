import * as THREE from 'three'
import { collectModelPreviewParts } from '@/lib/assets/ModelPreviewParts'
import type { ModelPreviewPart } from '@/lib/assets/ModelPreviewParts'

export type ModelPreviewPartState = {
  parts: ModelPreviewPart[]
  selectedPartId: string
  soloPartId: string
  batchSelectedPartIds: string[]
  batchSavedPartIds: string[]
}

/**
 * Reconstrói a lista de partes e reconcilia as seleções com a hierarquia atual.
 * IDs que deixaram de existir após reimportação ou remoção não permanecem no estado.
 */
export function reconcileModelPreviewPartState(
  root: THREE.Object3D | null,
  selectedPartId: string,
  soloPartId: string,
  batchSelectedPartIds: string[],
  batchSavedPartIds: string[],
): ModelPreviewPartState {
  if (!root) {
    return {
      parts: [],
      selectedPartId: '',
      soloPartId: '',
      batchSelectedPartIds: [],
      batchSavedPartIds: [],
    }
  }

  const parts = collectModelPreviewParts(root)
  const validIds = new Set(parts.map(part => part.id))
  return {
    parts,
    selectedPartId: validIds.has(selectedPartId) ? selectedPartId : '',
    soloPartId: validIds.has(soloPartId) ? soloPartId : '',
    batchSelectedPartIds: batchSelectedPartIds.filter(id => validIds.has(id)),
    batchSavedPartIds: batchSavedPartIds.filter(id => validIds.has(id)),
  }
}
