import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { extractGltfMetadata } from '@/lib/assets/GltfMetadata'

/**
 * Analisa GLB/glTF e guarda no root as animações e os metadados de origem
 * consumidos pelo editor, pelos diagnósticos e pelo retargeting.
 *
 * `resourcePath` mantém a resolução de recursos externos no fluxo de arquivos;
 * `manager` permite ao importador ZIP resolver texturas/buffers virtuais.
 */
export async function parseGltfModel(
  source: string | ArrayBuffer,
  resourcePath = '',
  manager?: THREE.LoadingManager,
): Promise<THREE.Object3D> {
  const loader = new GLTFLoader(manager ?? new THREE.LoadingManager())
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(source, resourcePath, gltf => {
      gltf.scene.userData.importAnimations = gltf.animations ?? []
      gltf.scene.userData.importGltfMetadata = extractGltfMetadata(gltf.parser.json)
      resolve(gltf.scene)
    }, reject)
  })
}
