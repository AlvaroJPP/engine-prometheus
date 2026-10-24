import * as THREE from 'three'
import { loadAssetFile } from './AssetImporter'
import { parseGltfModel } from './GltfModelParser'
import type { ZipImportContext } from './ZipModelImport'

/** Carrega o arquivo principal de um ZIP usando o gerenciador de recursos do pacote. */
export async function loadZipPrimaryModel(
  file: File,
  context: ZipImportContext,
): Promise<THREE.Object3D> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'glb') {
    return parseGltfModel(await file.arrayBuffer(), '', context.manager)
  }
  if (extension === 'gltf') {
    return parseGltfModel(await file.text(), '', context.manager)
  }
  return loadAssetFile(file, context)
}
