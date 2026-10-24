import { computed } from 'vue'
import * as THREE from 'three'
import { analyzeModelDiagnostics } from './ModelDiagnostics'
import type { ModelDiagnostic, ModelDiagnosticSummary } from './ModelDiagnostics'
import type { GltfMetadata } from './GltfMetadata'
import { recoverModelBaseColorTexture } from './ModelColorTextureRecovery'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type ModelImportDiagnosticsContext = {
  model: ReadonlyValue<THREE.Object3D | null>
  textureRepairSelections: ReadonlyValue<Record<string, string>>
  textureRepairBusy: WritableValue<boolean>
  textureRepairMessage: WritableValue<string>
  modelDiagnostics: WritableValue<ModelDiagnostic[]>
  diagnosticSummary: WritableValue<ModelDiagnosticSummary>
}

export function createModelImportDiagnosticsController(context: ModelImportDiagnosticsContext) {
  const {
    model,
    textureRepairSelections,
    textureRepairBusy,
    textureRepairMessage,
    modelDiagnostics,
    diagnosticSummary,
  } = context

  const gltfMetadata = computed(() => model.value?.userData.importGltfMetadata as GltfMetadata | undefined)
  const recoverableColorImages = computed(() => (gltfMetadata.value?.images ?? []).filter(image => image.uri.startsWith('data:image/')))
  const materialsMissingColorTexture = computed(() => (gltfMetadata.value?.materials ?? []).filter(material => material.baseColorTexture === null))

  async function applyRecoveredColorTexture(materialIndex: number) {
    const root = model.value
    if (!root) return
    const imageIndex = Number(textureRepairSelections.value[String(materialIndex)])
    textureRepairBusy.value = true
    textureRepairMessage.value = ''
    try {
      await recoverModelBaseColorTexture(root, gltfMetadata.value, materialIndex, imageIndex)
      const materialName = gltfMetadata.value?.materials.find(item => item.index === materialIndex)?.name
      textureRepairMessage.value = `Imagem ${imageIndex} aplicada ao material ${materialName || materialIndex}. O mapa normal e os demais mapas foram preservados.`
      refreshModelDiagnostics()
    } catch (e) {
      textureRepairMessage.value = e instanceof Error ? e.message : String(e)
    } finally {
      textureRepairBusy.value = false
    }
  }

  function refreshModelDiagnostics() {
    const root = model.value
    if (!root) {
      modelDiagnostics.value = []
      diagnosticSummary.value = { nodes: 0, meshes: 0, skinned: 0, materials: 0, textures: 0, clips: 0 }
      return
    }

    const result = analyzeModelDiagnostics(root)
    modelDiagnostics.value = result.rows
    diagnosticSummary.value = result.summary
  }

  return {
    recoverableColorImages,
    materialsMissingColorTexture,
    applyRecoveredColorTexture,
    refreshModelDiagnostics,
  }
}
