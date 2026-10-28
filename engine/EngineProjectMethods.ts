import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { randomSeed } from './lib/id'
import { resetIds } from './lib/id'
import { uuid } from './lib/id'
import { MAIN_SCENE_PATH } from './project/format'
import type { ProjectBundle } from './project/format'
import { buildBundle } from './project/serialize'
import { objectFromData } from './project/serialize'
import { ProjectFormatError } from './project/validate'
import { clamp } from './lib/math'
import { decodeBase64ArrayBuffer } from './lib/BinaryEncoding'

export interface EngineProjectContext {
  [key: string]: any
}

export function createEngineProjectMethods() {
  return {
    newProject(this: EngineProjectContext, name = 'Novo Mundo'): void {
      this.gameModules.stop()
      this.runtimeModeActive = false
      resetIds()
      this.meta = { id: uuid(), name }
      this.orbit.setFirstPersonMode(false)
      this.avatar.setFirstPersonMode(false)
      this.orbit.setPreset('free')
      this.events.emit('cameraChanged', { preset: 'free' })
      if (this.avatar.isMounted() || this.activeMountPackageId) this.dismountActiveMount()
      this.modelLod.clear()
      if (this.playerModelData) {
        this.playerModelData = null
        void this.avatar.resetDefaultModel().catch((error: unknown) => {
          console.warn('[Engine] Não foi possível restaurar o avatar padrão ao criar um projeto novo.', error)
        })
      }
      this.world.replaceAll([], { seed: randomSeed(), visible: true, edits: [] })
      this.world.setEnvironment({ skyTextureDataUrl: '', timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1 })
      this.avatar.reset()
      this.collisions.clear()
      this.world.setGridVisible(true)
      this.setBrush({ strength: 1.5, radius: 4 })
      this.logic.load()
    },
    exportProject(this: EngineProjectContext): ProjectBundle {
      const bundle = buildBundle(this.world.list(), this.world.terrainData(), this.orbit.getState(), this.meta, {
        gridVisible: this.world.isGridVisible(),
        brushStrength: this.state.brush.strength,
        brushRadius: this.state.brush.radius,
      })
      const scenePath = bundle.project.scenes[0] ?? MAIN_SCENE_PATH
      bundle.scenes[scenePath].environment = this.world.getEnvironment()
      if (this.playerModelData) bundle.scenes[scenePath].playerModel = { ...this.playerModelData }
      else delete bundle.scenes[scenePath].playerModel
      bundle.logic = this.logic.exportData()
      return bundle
    },
    async loadProject(
      this: EngineProjectContext,
      bundle: ProjectBundle,
      onProgress?: (message: string, percent: number) => void,
    ): Promise<void> {
      this.gameModules.stop()
      this.runtimeModeActive = false
      // Os IDs dos pacotes são persistidos. Limpe a assinatura em cache antes de
      // recarregar um projeto para não confundir o estado visual da cena anterior.
      this.mountModelStateController.clear()
      const report = (message: string, percent: number) => onProgress?.(message, Math.max(0, Math.min(100, percent)))
      const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    
      this.orbit.setFirstPersonMode(false)
      this.avatar.setFirstPersonMode(false)
      if (this.avatar.isMounted() || this.activeMountPackageId) this.dismountActiveMount()
      const firstPath = bundle.project.scenes[0] ?? MAIN_SCENE_PATH
      const scene = bundle.scenes[firstPath]
      if (!scene) throw new ProjectFormatError('O projeto não tem nenhuma cena para carregar.')
    
      resetIds()
      this.meta = { id: bundle.project.id, name: bundle.project.name }
      this.orbit.restore(scene.camera)
      this.events.emit('cameraChanged', { preset: scene.camera.preset })
    
      report('Preparando o terreno e os objetos básicos…', 5)
      const regularObjects = scene.objects.filter(object => !object.importedModelData)
      const restoredObjects: ReturnType<typeof objectFromData>[] = []
      // Construir objetos em lotes permite que a interface atualize o progresso
      // em projetos com muitas centenas ou milhares de objetos.
      for (let i = 0; i < regularObjects.length; i += 50) {
        const batch = regularObjects.slice(i, i + 50)
        for (const data of batch) restoredObjects.push(objectFromData(data))
        const percent = regularObjects.length
          ? 5 + Math.round((Math.min(i + batch.length, regularObjects.length) / regularObjects.length) * 20)
          : 25
        report(`Preparando objetos básicos… ${Math.min(i + batch.length, regularObjects.length)}/${regularObjects.length}`, percent)
        if (i + 50 < regularObjects.length) await yieldToUi()
      }
      // Remove LOD temporário antes de descartar as geometrias do mundo anterior.
      this.modelLod.clear()
      await this.world.replaceAllAsync(restoredObjects, scene.terrain, (loaded, total) => {
        const percent = total > 0 ? 25 + Math.round((loaded / total) * 3) : 28
        report(
          total > 0
            ? `Restaurando grama pintada… ${loaded.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`
            : 'Terreno e grama prontos.',
          percent,
        )
      })
      this.world.setEnvironment(scene.environment ?? { timeOfDay: 12, cycleEnabled: false, cycleSpeed: 0.1, skyTextureDataUrl: '' })
      report('Terreno pronto. Restaurando modelos 3D…', 28)
    
      const importedObjects = scene.objects.filter(object => !!object.importedModelData)
      const loader = new GLTFLoader()
      for (let i = 0; i < importedObjects.length; i += 1) {
        const data = importedObjects[i]!
        report(`Carregando modelo ${i + 1} de ${importedObjects.length}: ${data.name}…`, 30 + Math.round((i / Math.max(importedObjects.length, 1)) * 60))
        try {
          const binary = Uint8Array.from(atob(data.importedModelData!), char => char.charCodeAt(0)).buffer
          const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>((resolve, reject) => {
            loader.parse(binary, '', resolve, reject)
          })
          const model = gltf.scene
          // O nome visível fica no proxy; preservar o nome do nó glTF mantém os bindings de animação.
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
          this.addImportedModel(data.name, model, data.importedModelHeight ?? 1, { ...data, importedModelData: data.importedModelData })
        } catch (error) {
          console.error('[Engine] Não foi possível restaurar o modelo importado:', data.name, error)
          throw new ProjectFormatError(`Não foi possível carregar o modelo "${data.name}" salvo no projeto.`)
        }
        // Dá ao navegador/Tauri a chance de pintar a barra e processar eventos
        // entre assets, em vez de bloquear a interface até terminar tudo.
        await yieldToUi()
      }
    
      if (scene.playerModel?.glbData) {
        report('Restaurando modelo personalizado do jogador…', 91)
        try {
          const playerBytes = decodeBase64ArrayBuffer(scene.playerModel.glbData)
          const playerHeight = clamp(scene.playerModel.height ?? 1.8, 0.1, 10000)
          await this.avatar.setCustomModel(playerBytes, scene.playerModel.animationRoles, playerHeight)
          this.playerModelData = {
            name: scene.playerModel.name,
            glbData: scene.playerModel.glbData,
            height: playerHeight,
            ...(scene.playerModel.sourceUrl ? { sourceUrl: scene.playerModel.sourceUrl } : {}),
            ...(scene.playerModel.animationRoles ? { animationRoles: { ...scene.playerModel.animationRoles } } : {}),
          }
        } catch (error) {
          console.error('[Engine] Não foi possível restaurar o modelo personalizado do jogador:', error)
          throw new ProjectFormatError('Não foi possível carregar o modelo personalizado do jogador salvo neste projeto.')
        }
      } else if (this.playerModelData) {
        report('Restaurando modelo padrão do jogador…', 91)
        try {
          await this.avatar.resetDefaultModel()
          this.playerModelData = null
        } catch (error) {
          console.error('[Engine] Não foi possível restaurar o avatar padrão:', error)
          throw new ProjectFormatError('Não foi possível restaurar o modelo padrão do jogador.')
        }
      }
    
      report('Finalizando configurações do editor…', 93)
      const editorSettings = bundle.project.settings.editor
      this.world.setGridVisible(editorSettings.gridVisible)
      this.setBrush({ strength: editorSettings.brushStrength, radius: editorSettings.brushRadius })
      this.logic.load(bundle.logic)
    
      // Pré-compila shaders após restaurar os modelos e texturas do projeto. Isso
      // desloca parte do custo do primeiro quadro para a etapa de carregamento.
      report('Pré-processando geometria e visibilidade…', 96)
      await this.modelOcclusion.waitForPreparation()
      for (const object of this.world.list()) {
        if (object.mesh.userData.importedModel === true) {
          // A oclusão restaura o estado anterior das submalhas. As regras visuais
          // do pacote de montaria precisam ser reaplicadas depois desse último reset.
          this.modelOcclusion.restoreObjectVisibility(object.mesh)
        }
      }
    
      // A preparação de oclusão pode terminar depois da primeira avaliação dos
      // pacotes e restaurar a malha do cavaleiro como visível. Reaplique as regras
      // explicitamente e force o bypass da assinatura para persistir o estado inicial.
      for (const instance of this.logic.listPackages()) {
        if (instance.packageId === 'mount') this.applyMountModelStates(instance, true)
      }
    
      report('Preparando shaders e recursos gráficos…', 98)
      await this.viewport.precompile(this.world.scene, this.orbit.camera)
      report('Mundo carregado.', 100)
    },
    dispose(this: EngineProjectContext): void {
      this.behaviorTreeRuntime.reset()
      this.gameModules.dispose()
      window.removeEventListener('pointerdown', this.onRuntimePointerDown, true)
      window.removeEventListener('pointerup', this.onRuntimePointerUp, true)
      window.removeEventListener('keydown', this.onRuleKeyDown)
      window.removeEventListener('keyup', this.onGameModuleKeyUp)
      window.removeEventListener('blur', this.onGameModuleBlur)
      this.input.dispose()
      this.avatar.dispose()
      this.collisions.dispose()
      this.modelLod.dispose()
      this.modelOcclusion.dispose()
      this.transformControls.dispose()
      for (const off of this.viewportInvalidationOffs) off()
      this.viewportInvalidationOffs.length = 0
      this.viewport.dispose()
    }
  }
}
