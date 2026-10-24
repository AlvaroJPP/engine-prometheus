import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'

const transientImportMetadataKeys = [
  'importAnimations',
  'importGltfMetadata',
  'importRecoveredTextures',
  'importRecoveredColorTextures',
  'importCenter',
  'importOwnedObjectUrl',
  'importAnimationRoles',
  'importControlBindings',
  'importRigPreset',
  'importRigGenerated',
  'importRigBoneNames',
  'importSourceGlbBytes',
  'importNeedsReexport',
] as const

/**
 * Produz os bytes GLB para usar um modelo como jogador.
 * Quando o ativo já vem salvo em GLB, preserva os bytes originais;
 * caso contrário, exporta um clone esquelético sem metadados internos do importador.
 */
export async function createPlayerModelBytes(
  root: THREE.Object3D,
  originalBytes?: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (originalBytes) return originalBytes.slice(0)

  const exportRoot = cloneSkinnedModel(root)
  exportRoot.userData = { ...exportRoot.userData }
  for (const key of transientImportMetadataKeys) {
    delete exportRoot.userData[key]
  }
  exportRoot.updateMatrixWorld(true)

  const clips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
  const exported = await new GLTFExporter().parseAsync(exportRoot, {
    binary: true,
    animations: clips,
  })
  if (!(exported instanceof ArrayBuffer)) {
    throw new Error('O exportador não gerou um arquivo GLB válido.')
  }

  return exported
}
