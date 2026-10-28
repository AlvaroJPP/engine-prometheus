import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { SceneObjectData } from './format'
import { ProjectFormatError } from './validate'

export interface ImportedProjectModelRestorationDependencies {
  report: (message: string, percent: number) => void
  yieldToUi: () => Promise<void>
  addImportedModel: (
    name: string,
    model: import('three').Object3D,
    height: number,
    restoreData: SceneObjectData,
  ) => void
}

/** Restores GLB scene objects from project data and reports per-model progress. */
export async function restoreImportedProjectModels(
  objects: readonly SceneObjectData[],
  dependencies: ImportedProjectModelRestorationDependencies,
): Promise<void> {
  const importedObjects = objects.filter(object => !!object.importedModelData)
  const loader = new GLTFLoader()
  for (let i = 0; i < importedObjects.length; i += 1) {
    const data = importedObjects[i]!
    dependencies.report(
      `Carregando modelo ${i + 1} de ${importedObjects.length}: ${data.name}…`,
      30 + Math.round((i / Math.max(importedObjects.length, 1)) * 60),
    )
    try {
      const binary = Uint8Array.from(atob(data.importedModelData!), char => char.charCodeAt(0)).buffer
      const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>((resolve, reject) => {
        loader.parse(binary, '', resolve, reject)
      })
      const model = gltf.scene
      // Keep imported node names intact because animation tracks may address those nodes.
      model.userData.importPart = true
      model.userData.importAnimations = gltf.animations
      model.userData.importAnimationRoles = data.importAnimationRoles
      model.userData.importControlBindings = data.importControlBindings
      model.userData.componentId = data.componentId
      model.userData.sceneKind = data.sceneKind === 'entity' ? 'entity' : 'object'
      model.userData.importedModelData = data.importedModelData
      model.userData.importColliderType = data.colliderType ?? 'box'
      model.userData.importColliderSize = data.colliderSize ?? [1, 1, 1]
      model.userData.importColliderOffset = data.colliderOffset ?? [0, 0, 0]
      dependencies.addImportedModel(
        data.name,
        model,
        data.importedModelHeight ?? 1,
        { ...data, importedModelData: data.importedModelData },
      )
    } catch (error) {
      console.error('[Engine] Não foi possível restaurar o modelo importado:', data.name, error)
      throw new ProjectFormatError(`Não foi possível carregar o modelo "${data.name}" salvo no projeto.`)
    }
    // Let the UI update the progress bar between imported assets.
    await dependencies.yieldToUi()
  }
}
