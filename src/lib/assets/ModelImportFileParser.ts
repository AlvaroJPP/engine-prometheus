import * as THREE from 'three'
import { loadAssetFile } from './AssetImporter'
import { parseGltfModel } from './GltfModelParser'

/**
 * Lê um arquivo escolhido no diálogo de importação.
 * GLB/glTF passa pelo parser com metadados; os outros formatos seguem
 * pelo importador compartilhado. O chamador recebe as URLs Blob criadas
 * para controlar seu ciclo de vida junto ao modelo carregado.
 */
export async function parseModelImportFile(
  file: File,
  onObjectUrlCreated: (url: string) => void,
): Promise<THREE.Object3D> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'glb' && extension !== 'gltf') {
    return await loadAssetFile(file)
  }

  const buffer = await file.arrayBuffer()
  const url = URL.createObjectURL(file)
  onObjectUrlCreated(url)
  const loaded = await parseGltfModel(buffer, url.substring(0, url.lastIndexOf('/') + 1))
  if (extension === 'glb') loaded.userData.importSourceGlbBytes = buffer.slice(0)
  return loaded
}
