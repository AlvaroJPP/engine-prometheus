import { computed, onMounted, ref, type Ref } from 'vue'
import * as THREE from 'three'
import { disposeThreeObjectResources } from '@/lib/assets/ThreeObjectResources'
import { encodeArrayBufferBase64 } from '@engine/lib/BinaryEncoding'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import { markEntity } from '@engine'
import type { LogicRule, PackageJsonValue, PackageScalar } from '@engine'
import { deleteSavedComponent, getSavedComponent, listSavedComponents, saveComponentAsset, saveComponentAssets } from '@/lib/assets/ComponentLibrary'
import type { SavedComponent } from '@/lib/assets/ComponentLibrary'
import { generateComponentThumbnail } from '@/lib/assets/ComponentThumbnail'

interface UseComponentLibraryControllerOptions {
  status: Ref<string>
  setPlayerModelAsset: (
    bytes: ArrayBuffer,
    name: string,
    animationRoles?: Record<string, import('@engine').AnimationRole>,
    height?: number,
  ) => Promise<void>
  setBuildComponentPlacement: (name: string, model: THREE.Object3D, height: number) => void
}

export function useComponentLibraryController({
  status,
  setPlayerModelAsset,
  setBuildComponentPlacement,
}: UseComponentLibraryControllerOptions) {
function clonePackageJsonValue(value: PackageJsonValue): PackageJsonValue {
  if (Array.isArray(value)) return value.map(clonePackageJsonValue)
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, PackageJsonValue> = {}
    for (const [key, nested] of Object.entries(value)) copy[key] = clonePackageJsonValue(nested)
    return copy
  }
  return value
}

function clonePackageJsonRecord(record: Record<string, PackageJsonValue>): Record<string, PackageJsonValue> {
  return clonePackageJsonValue(record) as Record<string, PackageJsonValue>
}

function cloneSavedBehaviorPackageSettings(
  settings: NonNullable<SavedComponent['behaviorPackageSettings']>,
): NonNullable<SavedComponent['behaviorPackageSettings']> {
  return Object.fromEntries(Object.entries(settings).map(([id, draft]) => [id, {
    variables: { ...draft.variables },
    config: clonePackageJsonRecord(draft.config),
  }]))
}


const modelImportOpen = ref(false)
const previewComponentAsset = ref<{ id?: string; name: string; bytes: ArrayBuffer; height?: number; colliderType?: SavedComponent['colliderType']; colliderSize?: [number, number, number]; colliderOffset?: [number, number, number]; kind?: SavedComponent['kind']; libraryType?: SavedComponent['libraryType']; logic?: SavedComponent['logic']; animationRoles?: Record<string, import('@engine').AnimationRole>; controlBindings?: Partial<import('@engine').ModelControlBindings>; behaviorPackageIds?: string[]; behaviorPackageSettings?: Record<string, { variables: Record<string, PackageScalar>; config: Record<string, PackageJsonValue> }>; thumbnail?: string } | null>(null)
const previewAnimationSourceAsset = ref<{ id: string; name: string; bytes: ArrayBuffer; height?: number; libraryType: 'animation-source' } | null>(null)
const savedComponents = ref<Array<Omit<SavedComponent, 'bytes'>>>([])
const placeableSavedComponents = computed(() => savedComponents.value.filter(component => component.libraryType !== 'animation-source'))
const savedAnimationSourceOptions = computed(() => savedComponents.value
  .filter(component => component.libraryType === 'animation-source')
  .map(({ id, name, height, thumbnail }) => ({ id, name, height, thumbnail })))
const componentBusy = ref(false)
let componentThumbnailBackfillRunning = false

async function refreshSavedComponents() {
  try {
    savedComponents.value = await listSavedComponents()
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível carregar a biblioteca de componentes.'
  }
}

async function backfillMissingComponentThumbnails() {
  if (componentThumbnailBackfillRunning) return
  const missing = savedComponents.value.filter(component => !component.thumbnail)
  if (!missing.length) return

  componentThumbnailBackfillRunning = true
  let changed = false
  try {
    for (const metadata of missing) {
      try {
        const component = await getSavedComponent(metadata.id)
        if (!component || component.thumbnail) continue
        const thumbnail = await generateComponentThumbnail(component.bytes)
        if (!thumbnail) continue
        component.thumbnail = thumbnail
        await saveComponentAsset(component)
        changed = true
        savedComponents.value = savedComponents.value.map(item =>
          item.id === component.id ? { ...item, thumbnail } : item,
        )
      } catch (error) {
        console.warn('[ComponentLibrary] Não foi possível criar a miniatura de ' + metadata.name + '.', error)
      }
      // Permite que a interface responda entre uma miniatura e a próxima.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    }
    if (changed) await refreshSavedComponents()
  } finally {
    componentThumbnailBackfillRunning = false
  }
}

async function renameSavedComponent(id: string, requestedName: string) {
  const name = requestedName.trim().slice(0, 80)
  if (!name) {
    status.value = 'Informe um nome para o componente.'
    return
  }
  const normalized = name.toLocaleLowerCase('pt-BR')
  const duplicate = savedComponents.value.find(
    component => component.id !== id && component.name.trim().toLocaleLowerCase('pt-BR') === normalized,
  )
  if (duplicate) {
    status.value = 'Já existe um componente chamado "' + duplicate.name + '". Escolha outro nome.'
    return
  }

  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    // Atualiza apenas os metadados. O GLB, animações, colisor e ID permanecem intactos.
    component.name = name
    await saveComponentAsset(component)
    await refreshSavedComponents()
    status.value = 'Componente renomeado para "' + name + '".'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível renomear o componente.'
  }
}

async function handleUsePlayerModel(payload: { name: string; bytes: ArrayBuffer; animationRoles: Record<string, import('@engine').AnimationRole>; height: number }) {
  await setPlayerModelAsset(payload.bytes, payload.name, payload.animationRoles, payload.height)
}

async function handleSaveAnimationSource(payload: { name: string; bytes: ArrayBuffer; height: number }) {
  if (componentBusy.value) throw new Error('A biblioteca está ocupada. Tente salvar a fonte novamente.')
  if (!(payload.bytes instanceof ArrayBuffer) || payload.bytes.byteLength <= 20) {
    throw new Error('O GLB da fonte de animações está vazio ou inválido.')
  }
  componentBusy.value = true
  try {
    let thumbnail: string | undefined
    try {
      thumbnail = await generateComponentThumbnail(payload.bytes)
    } catch {
      thumbnail = undefined
    }
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2)
    const source: SavedComponent = {
      id,
      name: payload.name.trim() || 'Fonte de animação',
      libraryType: 'animation-source',
      kind: 'object',
      height: Number.isFinite(payload.height) && payload.height > 0 ? payload.height : 2,
      colliderType: 'none',
      colliderSize: [1, 1, 1],
      colliderOffset: [0, 0, 0],
      animationRoles: {},
      thumbnail,
      bytes: payload.bytes.slice(0),
      createdAt: Date.now(),
    }
    await saveComponentAsset(source)
    await refreshSavedComponents()
    status.value = 'Fonte de animações "' + source.name + '" salva. Ela fica na biblioteca de fontes e não será inserida no mundo.'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível salvar a fonte de animações.'
  } finally {
    componentBusy.value = false
  }
}

async function useSavedAnimationSource(id: string) {
  try {
    const source = await getSavedComponent(id)
    if (!source) throw new Error('Esta fonte de animações não está mais na biblioteca.')
    if (source.libraryType !== 'animation-source') {
      throw new Error('Este item não está categorizado como fonte de animações.')
    }
    // Se a janela já está aberta, mantém intacto o modelo A que está sendo editado.
    // Se estiver fechada, abre a fonte primeiro; depois, carregue o modelo A como destino.
    const targetAlreadyOpen = modelImportOpen.value
    if (!targetAlreadyOpen) previewComponentAsset.value = null
    previewAnimationSourceAsset.value = {
      id: source.id,
      name: source.name,
      bytes: source.bytes.slice(0),
      height: source.height,
      libraryType: 'animation-source',
    }
    modelImportOpen.value = true
    status.value = targetAlreadyOpen
      ? 'Carregando "' + source.name + '" como origem; o modelo A aberto foi mantido como destino.'
      : 'Fonte "' + source.name + '" carregada. Abra o modelo A no importador para usá-lo como destino.'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível carregar a fonte de animações.'
  }
}

async function previewSavedComponent(id: string) {
  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    previewComponentAsset.value = {
      id: component.id,
      name: component.name,
      bytes: component.bytes.slice(0),
      height: component.height,
      colliderType: component.colliderType,
      colliderSize: [...component.colliderSize],
      colliderOffset: [...component.colliderOffset],
      kind: component.kind,
      libraryType: component.libraryType ?? 'object',
      logic: component.logic,
      animationRoles: component.animationRoles,
      controlBindings: component.controlBindings,
      behaviorPackageIds: component.behaviorPackageIds,
      behaviorPackageSettings: component.behaviorPackageSettings,
      thumbnail: component.thumbnail,
    }
    modelImportOpen.value = true
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível abrir a prévia do componente.'
  }
}

function closeModelImport() {
  modelImportOpen.value = false
  previewComponentAsset.value = null
  previewAnimationSourceAsset.value = null
}

function disposeComponentSource(root: THREE.Object3D) {
  disposeThreeObjectResources(root, 'meshes')
}

async function handleModelImport(payload: { name: string; model: import('three').Object3D; height: number; thumbnail?: string; componentId?: string; sourceGlbBytes?: ArrayBuffer; batchModels?: Array<{ partId: string; name: string; model: import('three').Object3D; height: number }> }): Promise<boolean> {
  if (componentBusy.value) {
    throw new Error('A biblioteca de componentes está ocupada com outra operação. Tente salvar novamente em alguns segundos.')
  }

  if (payload.batchModels?.length) {
    componentBusy.value = true
    const entries = payload.batchModels
    const savedComponents: SavedComponent[] = []
    status.value = `Preparando ${entries.length} componentes a partir do mesmo modelo…`
    try {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!
        status.value = `Exportando componente ${index + 1} de ${entries.length}: ${entry.name}…`
        const exportRoot = cloneSkinnedModel(entry.model)
        exportRoot.userData = { ...exportRoot.userData }
        for (const key of [
          'importAnimations', 'importGltfMetadata', 'importRecoveredTextures',
          'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl',
          'importAnimationRoles', 'importControlBindings', 'importRigPreset',
          'importRigGenerated', 'importRigBoneNames', 'importBehaviorPackageIds',
          'importBehaviorPackageSettings', 'importSourceGlbBytes', 'importNeedsReexport',
        ]) {
          delete exportRoot.userData[key]
        }

        const exporter = new GLTFExporter()
        const exported = await exporter.parseAsync(exportRoot, { binary: true, animations: [] })
        if (!(exported instanceof ArrayBuffer) || exported.byteLength <= 20) {
          throw new Error(`O exportador não gerou um GLB válido para "${entry.name}".`)
        }

        const modelData = entry.model.userData
        let thumbnail: string | undefined
        try {
          thumbnail = await generateComponentThumbnail(exported)
        } catch {
          thumbnail = undefined
        }

        const rawSize = modelData.importColliderSize
        const rawOffset = modelData.importColliderOffset
        const colliderType = modelData.importColliderType
        const id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + '-' + index.toString(36) + Math.random().toString(36).slice(2)
        savedComponents.push({
          id,
          name: entry.name.trim() || 'Modelo 3D',
          height: entry.height,
          colliderType: colliderType === 'sphere' || colliderType === 'capsule' || colliderType === 'mesh' || colliderType === 'none' ? colliderType : 'box',
          colliderSize: Array.isArray(rawSize) && rawSize.length === 3
            ? [...rawSize] as [number, number, number]
            : [1, 1, 1],
          colliderOffset: Array.isArray(rawOffset) && rawOffset.length === 3
            ? [...rawOffset] as [number, number, number]
            : [0, 0, 0],
          kind: 'object',
          libraryType: 'object',
          logic: undefined,
          behaviorPackageIds: Array.isArray(modelData.importBehaviorPackageIds)
            ? [...new Set((modelData.importBehaviorPackageIds as unknown[]).filter((value): value is string => typeof value === 'string'))]
            : [],
          behaviorPackageSettings: modelData.importBehaviorPackageSettings && typeof modelData.importBehaviorPackageSettings === 'object'
            ? modelData.importBehaviorPackageSettings as SavedComponent['behaviorPackageSettings']
            : {},
          animationRoles: {},
          controlBindings: modelData.importControlBindings as Partial<import('@engine').ModelControlBindings> | undefined,
          thumbnail,
          bytes: exported,
          createdAt: Date.now(),
        })
      }

      status.value = `Gravando ${savedComponents.length} componentes na biblioteca…`
      await saveComponentAssets(savedComponents)
      await refreshSavedComponents()
      status.value = `Pronto: ${savedComponents.length} componentes salvos da mesma importação. Você pode selecionar mais partes no importador sem abrir o arquivo novamente.`
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      status.value = `Não foi possível salvar o lote de componentes: ${message}`
      throw new Error(message)
    } finally {
      componentBusy.value = false
    }
  }

  if (payload.componentId) {
    componentBusy.value = true
    status.value = 'Exportando edições e salvando o componente existente…'
    let saved = false
    try {
      const existing = await getSavedComponent(payload.componentId)
      if (!existing) throw new Error('Este componente não está mais na biblioteca.')
      const modelData = payload.model.userData
      const rawPackageIds = modelData.importBehaviorPackageIds
      const rawPackageSettings = modelData.importBehaviorPackageSettings
      const animations = (modelData.importAnimations as THREE.AnimationClip[] | undefined) ?? []

      // Editar um componente precisa persistir o modelo 3D, não apenas os metadados.
      // Exporte um clone para incluir mudanças de malha, transformações, texturas,
      // remoções de partes e rigging sem modificar/destruir a prévia antes do commit.
      const exportRoot = cloneSkinnedModel(payload.model)
      const editorOnlyKeys = [
        'importAnimations', 'importGltfMetadata', 'importRecoveredTextures',
        'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl',
        'importAnimationRoles', 'importControlBindings', 'importRigPreset',
        'importRigGenerated', 'importRigBoneNames', 'importBehaviorPackageIds',
        'importBehaviorPackageSettings', 'importSourceGlbBytes', 'importNeedsReexport',
        'importColliderType', 'importColliderSize', 'importColliderOffset',
        'sceneKind', 'componentLogic',
      ]
      exportRoot.traverse(node => {
        node.userData = { ...node.userData }
        for (const key of editorOnlyKeys) delete node.userData[key]
      })
      const exporter = new GLTFExporter()
      const exported = await exporter.parseAsync(exportRoot, {
        binary: true,
        animations,
        // A hierarquia tem controles temporários de visibilidade para inspeção;
        // não deixe um nó apenas oculto na prévia desaparecer do componente salvo.
        onlyVisible: false,
      })
      if (!(exported instanceof ArrayBuffer) || exported.byteLength <= 20) {
        throw new Error('O exportador não gerou um GLB válido para o componente editado.')
      }

      const rawColliderType = modelData.importColliderType
      const rawColliderSize = modelData.importColliderSize
      const rawColliderOffset = modelData.importColliderOffset
      const validColliderSize = Array.isArray(rawColliderSize)
        && rawColliderSize.length === 3
        && rawColliderSize.every(value => typeof value === 'number' && Number.isFinite(value))
        ? rawColliderSize as [number, number, number]
        : existing.colliderSize
      const validColliderOffset = Array.isArray(rawColliderOffset)
        && rawColliderOffset.length === 3
        && rawColliderOffset.every(value => typeof value === 'number' && Number.isFinite(value))
        ? rawColliderOffset as [number, number, number]
        : existing.colliderOffset

      const updated: SavedComponent = {
        ...existing,
        name: payload.name.trim() || existing.name,
        libraryType: modelData.importHasModifiedAnimations === true
          ? 'animated-model'
          : (existing.libraryType ?? 'object'),
        height: Number.isFinite(payload.height) && payload.height > 0 ? payload.height : existing.height,
        bytes: exported,
        colliderType: rawColliderType === 'sphere' || rawColliderType === 'capsule' || rawColliderType === 'mesh' || rawColliderType === 'none'
          ? rawColliderType
          : 'box',
        colliderSize: validColliderSize,
        colliderOffset: validColliderOffset,
        // Tipo semântico e lógica são armazenados fora do GLB; mantê-los evita
        // apagar a configuração de entidade/eventos ao editar a aparência.
        kind: existing.kind,
        logic: existing.logic,
        behaviorPackageIds: Array.isArray(rawPackageIds)
          ? [...new Set(rawPackageIds.filter((id): id is string => typeof id === 'string'))]
          : [],
        behaviorPackageSettings: rawPackageSettings && typeof rawPackageSettings === 'object'
          ? rawPackageSettings as SavedComponent['behaviorPackageSettings']
          : {},
        animationRoles: modelData.importAnimationRoles as Record<string, import('@engine').AnimationRole> | undefined,
        controlBindings: modelData.importControlBindings as Partial<import('@engine').ModelControlBindings> | undefined,
        thumbnail: payload.thumbnail || existing.thumbnail,
      }
      await saveComponentAsset(updated)
      saved = true
      await refreshSavedComponents()
      status.value = 'Modelo 3D, colisão e configurações de "' + updated.name + '" salvos no componente existente.'
      return true
    } catch (error) {
      status.value = 'Não foi possível salvar as alterações: ' + (error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      componentBusy.value = false
      if (saved) disposeComponentSource(payload.model)
    }
  }

  componentBusy.value = true
  status.value = 'Salvando modelo na biblioteca de componentes…'
  let exportRoot: import('three').Object3D | null = null
  let savedComponentId: string | null = null
  let saveError: unknown = null
  try {
    let result: ArrayBuffer
    if (payload.sourceGlbBytes instanceof ArrayBuffer && payload.sourceGlbBytes.byteLength > 20) {
      // GLB já foi validado pelo GLTFLoader. Preserve o arquivo original quando
      // não houve edição da malha: evita falhas do GLTFExporter com texturas/
      // extensões válidas que o Three consegue carregar, mas não reexportar.
      result = payload.sourceGlbBytes.slice(0)
    } else {
      exportRoot = cloneSkinnedModel(payload.model)
      exportRoot.userData = { ...exportRoot.userData }
      for (const key of ['importAnimations', 'importGltfMetadata', 'importRecoveredTextures', 'importRecoveredColorTextures', 'importCenter', 'importOwnedObjectUrl', 'importRigPreset', 'importRigGenerated', 'importRigBoneNames', 'importBehaviorPackageIds', 'importBehaviorPackageSettings', 'importSourceGlbBytes', 'importNeedsReexport']) {
        delete exportRoot.userData[key]
      }

      const exporter = new GLTFExporter()
      const exported = await exporter.parseAsync(exportRoot, {
        binary: true,
        animations: (payload.model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? [],
      })
      if (!(exported instanceof ArrayBuffer)) throw new Error('O exportador não gerou um arquivo GLB válido.')
      result = exported
    }

    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2)
    const colliderType = payload.model.userData.importColliderType
    const size = payload.model.userData.importColliderSize
    const offset = payload.model.userData.importColliderOffset
    const rawPackageIds = payload.model.userData.importBehaviorPackageIds
    const rawPackageSettings = payload.model.userData.importBehaviorPackageSettings
    const component: SavedComponent = {
      id,
      name: payload.name.trim() || 'Modelo 3D',
      height: payload.height,
      colliderType: colliderType === 'sphere' || colliderType === 'capsule' || colliderType === 'mesh' || colliderType === 'none' ? colliderType : 'box',
      colliderSize: Array.isArray(size) && size.length === 3 ? [...size] as [number, number, number] : [1, 1, 1],
      colliderOffset: Array.isArray(offset) && offset.length === 3 ? [...offset] as [number, number, number] : [0, 0, 0],
      kind: payload.model.userData.sceneKind === 'entity' ? 'entity' : 'object',
      libraryType: payload.model.userData.importHasModifiedAnimations === true ? 'animated-model' : 'object',
      logic: Array.isArray(payload.model.userData.componentLogic) ? payload.model.userData.componentLogic as LogicRule[] : undefined,
      behaviorPackageIds: Array.isArray(rawPackageIds)
        ? [...new Set(rawPackageIds.filter((id): id is string => typeof id === 'string'))]
        : [],
      behaviorPackageSettings: rawPackageSettings && typeof rawPackageSettings === 'object'
        ? rawPackageSettings as SavedComponent['behaviorPackageSettings']
        : {},
      animationRoles: payload.model.userData.importAnimationRoles as Record<string, import('@engine').AnimationRole> | undefined,
      controlBindings: payload.model.userData.importControlBindings as Partial<import('@engine').ModelControlBindings> | undefined,
      thumbnail: payload.thumbnail,
      bytes: result,
      createdAt: Date.now(),
    }
    await saveComponentAsset(component)
    savedComponentId = id
    await refreshSavedComponents()
    status.value = 'Componente "' + component.name + '" salvo. Preparando para construir no mundo…'
  } catch (error) {
    saveError = error
    status.value = 'Não foi possível salvar o componente: ' + (error instanceof Error ? error.message : String(error))
  } finally {
    componentBusy.value = false
    // O clone compartilha recursos com a prévia: só os descartamos após gravar com sucesso.
    if (savedComponentId) {
      if (exportRoot) disposeComponentSource(exportRoot)
      disposeComponentSource(payload.model)
    }
  }

  if (!savedComponentId) {
    if (saveError instanceof Error) throw saveError
    throw new Error('O componente não foi gravado na biblioteca.')
  }

  await placeSavedComponent(savedComponentId)
  return true
}

async function placeSavedComponent(id: string) {
  if (componentBusy.value) return
  componentBusy.value = true
  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    if (component.libraryType === 'animation-source') {
      status.value = '"' + component.name + '" é uma fonte de animações. Use "Usar origem" na biblioteca para carregá-la no retargeting; fontes não são inseridas no mundo.'
      return
    }
    const loader = new GLTFLoader()
    const model = await new Promise<import('three').Object3D>((resolve, reject) => {
      loader.parse(component.bytes.slice(0), '', gltf => {
        gltf.scene.userData.importAnimations = gltf.animations ?? []
        gltf.scene.userData.importAnimationRoles = component.animationRoles
        gltf.scene.userData.importControlBindings = component.controlBindings
        resolve(gltf.scene)
      }, reject)
    })
    // Não renomeie nem transforme o nó raiz do glTF aqui: os clips podem usar
    // seu nome e seus transforms. Engine.addImportedModel aplica escala e centro
    // num pivô externo, mantendo animação, seleção e colisor alinhados.
    model.updateMatrixWorld(true)
    const sourceBounds = new THREE.Box3().setFromObject(model)
    const sourceSize = sourceBounds.getSize(new THREE.Vector3())
    if (sourceBounds.isEmpty() || sourceSize.y <= 0) throw new Error('O componente não contém dimensões válidas.')
    model.userData.importPart = true
    if (component.kind === 'entity') {
      // A biblioteca declara a semântica. O GLB é marcado como entidade genérica
      // antes de entrar no World; o Engine transfere esses metadados para a raiz.
      markEntity(model, {
        componentId: component.id,
        componentLogic: component.logic ?? [],
      })
    } else {
      model.userData.sceneKind = 'object'
      model.userData.componentId = component.id
      model.userData.componentLogic = component.logic ?? []
    }
    model.userData.importedModelData = encodeArrayBufferBase64(component.bytes)
    model.userData.importedModelHeight = component.height
    model.userData.importBehaviorPackageIds = [...(component.behaviorPackageIds ?? [])]
    model.userData.importBehaviorPackageSettings = cloneSavedBehaviorPackageSettings(component.behaviorPackageSettings ?? {})
    model.userData.importColliderType = component.colliderType
    model.userData.importColliderSize = [...component.colliderSize]
    model.userData.importColliderOffset = [...component.colliderOffset]
    setBuildComponentPlacement(component.name, model, component.height)
    status.value = 'Componente "' + component.name + '" selecionado. Clique em Construir e depois no ponto do mundo onde deseja colocá-lo.'
  } catch (error) {
    status.value = 'Não foi possível inserir o componente: ' + (error instanceof Error ? error.message : String(error))
  } finally {
    componentBusy.value = false
  }
}

async function removeSavedComponent(id: string) {
  const component = savedComponents.value.find(item => item.id === id)
  if (!component || !window.confirm('Excluir "' + component.name + '" da biblioteca? Os objetos já colocados no mundo não serão removidos.')) return
  try {
    await deleteSavedComponent(id)
    await refreshSavedComponents()
    status.value = 'Componente removido da biblioteca.'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível excluir o componente.'
  }
}

onMounted(() => {
  void (async () => {
    // Remove da biblioteca local o componente legado criado por versões anteriores.
    try {
      await deleteSavedComponent('builtin-horse-low-poly')
    } catch (error) {
      console.warn('[ComponentLibrary] Não foi possível remover um componente legado.', error)
    }
    await refreshSavedComponents()
  })()
})

async function moveSavedComponentGroup(id: string, group: string) {
  const normalizedGroup = group.trim().slice(0, 48)
  if (!normalizedGroup) return
  try {
    const component = await getSavedComponent(id)
    if (!component) throw new Error('Este componente não está mais na biblioteca.')
    if (component.group === normalizedGroup) return
    component.group = normalizedGroup
    await saveComponentAsset(component)
    await refreshSavedComponents()
    status.value = 'Componente movido para "' + normalizedGroup + '".'
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Não foi possível mover o componente de grupo.'
  }
}


  return {
    backfillMissingComponentThumbnails,
    closeModelImport,
    handleModelImport,
    handleSaveAnimationSource,
    handleUsePlayerModel,
    modelImportOpen,
    moveSavedComponentGroup,
    placeSavedComponent,
    placeableSavedComponents,
    previewAnimationSourceAsset,
    previewComponentAsset,
    previewSavedComponent,
    removeSavedComponent,
    renameSavedComponent,
    savedAnimationSourceOptions,
    savedComponents,
    useSavedAnimationSource,
  }
}
