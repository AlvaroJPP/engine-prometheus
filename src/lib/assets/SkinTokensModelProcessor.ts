import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { invoke } from '@tauri-apps/api/core'
import { decodeBase64ArrayBuffer, encodeArrayBufferBase64 } from '@engine/lib/BinaryEncoding'
import { prepareSkinTokensExportRoot } from '@/lib/assets/SkinTokensExportPreparation'

export type SkinTokensModelOperation = 'rig' | 'skin'
export type SkinTokensModelClass = 'humanoid' | 'quadruped' | 'custom'

export async function processSkinTokensModel(
  root: THREE.Object3D,
  options: {
    executablePath: string
    operation: SkinTokensModelOperation
    modelClass: SkinTokensModelClass
    sourceClips: THREE.AnimationClip[]
    parseGlbBytes: (bytes: ArrayBuffer) => Promise<THREE.Object3D>
  },
): Promise<THREE.Object3D> {
  let inputGlb: ArrayBuffer
  const originalGlb = root.userData.importSourceGlbBytes

  if (originalGlb instanceof ArrayBuffer && root.userData.importNeedsReexport !== true) {
    // Preserve extensões, texturas compactadas e metadados do GLB original.
    inputGlb = originalGlb.slice(0)
  } else {
    const exportRoot = prepareSkinTokensExportRoot(root)
    const exporter = new GLTFExporter()
    const exported = await exporter.parseAsync(exportRoot, {
      binary: true,
      animations: options.sourceClips,
    })
    if (!(exported instanceof ArrayBuffer)) {
      throw new Error('Não foi possível exportar o modelo para GLB.')
    }
    inputGlb = exported
  }

  if (inputGlb.byteLength > 300 * 1024 * 1024) {
    throw new Error('O GLB excede o limite de 300 MB para processamento local.')
  }

  const outputBase64 = await invoke<string>('run_skintokens_glb', {
    executablePath: options.executablePath,
    glbBase64: encodeArrayBufferBase64(inputGlb),
    operation: options.operation,
    modelClass: options.modelClass,
  })

  return options.parseGlbBytes(decodeBase64ArrayBuffer(outputBase64))
}
