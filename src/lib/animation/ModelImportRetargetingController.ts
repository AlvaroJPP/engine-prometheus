import * as THREE from 'three'
import { nextTick, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import type { AnimationRole } from '@engine'
import {
  createReusableAnimationAsset,
  parseReusableAnimationClip,
  retargetAnimationClip,
  suggestAutonomousBoneMappingsDetailed,
  type ReusableAnimationAsset,
} from './AnimationRetargeting'
import { createRetargetAssetForSource } from './RetargetAssetFactory'
import { inspectRetargetTargetRig } from './RetargetTargetRigInspection'
import { buildRetargetTargetPreview } from './RetargetTargetPreviewBuilder'
import { buildAutonomousRetargetReport } from './RetargetAutonomousReport'
import { formatRetargetAnimationTransferMessage } from './RetargetTransferReport'
import { integrateRetargetedAnimationClip } from './RetargetClipIntegration'
import {
  loadRetargetAnimationLibrary as readRetargetAnimationLibrary,
  persistRetargetAnimationLibrary as writeRetargetAnimationLibrary,
} from './RetargetAnimationLibrary'
import { restoreRetargetRestPose } from './RetargetRestPose'
import { cloneRetargetPreviewObject } from './RetargetPreviewObjects'
import {
  createRetargetPreviewStage,
  disposeRetargetPreviewStage,
  setRetargetPreviewStageObject,
  type RetargetPreviewStage,
} from './RetargetPreviewStage'
import { applyRigPose } from './Rigging'
import type { RigAnimationPose as RigPose } from './RigAnimationClip'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type SetupTab = 'model' | 'controls' | 'animations' | 'rigging' | 'technical'
type RetargetAnimationSourceAsset = {
  id: string
  name: string
  bytes: ArrayBuffer
  height?: number
  libraryType?: 'animation-source'
}
type ModelImportRetargetingProps = {
  animationSourceAsset?: RetargetAnimationSourceAsset | null
}
type ModelImportRetargetingContext = {
  props: ModelImportRetargetingProps
  emit: {
    (event: 'save-animation-source', payload: { name: string; bytes: ArrayBuffer; height: number }): void
    (event: 'load-animation-source', id: string): void
  }
  activeSetupTab: WritableValue<SetupTab>
  animationClipRevision: WritableValue<number>
  animationRoles: WritableValue<Record<string, AnimationRole>>
  error: WritableValue<string>
  fitCamera: (root: THREE.Object3D) => void
  getScene: () => THREE.Scene | null
  guessedAnimationRole: (name: string) => AnimationRole
  isReadOnlyPreview: ReadonlyValue<boolean>
  loading: ReadonlyValue<boolean>
  model: ReadonlyValue<THREE.Object3D | null>
  originalHeight: ReadonlyValue<number>
  parseGlbBytes: (bytes: ArrayBuffer) => Promise<THREE.Object3D>
  disposeModel: (root: THREE.Object3D) => void
  performSkinTokensRigging: (preserveRetargetSource: boolean) => Promise<void>
  previewAnimationIndex: WritableValue<number>
  previewAnimationRuntime: { controller?: { stop: () => void } | null }
  previewAnimations: ReadonlyValue<THREE.AnimationClip[]>
  refreshModelDiagnostics: () => void
  selectPreviewAnimation: (index: number) => void
  restoreModelRenderableMeshes: (root: THREE.Object3D) => void
  restorePreviewVisibility: () => void
  retargetAutonomousLoading: WritableValue<boolean>
  retargetAutonomousStage: WritableValue<string>
  retargetBoneMap: WritableValue<Record<string, string>>
  retargetClipName: WritableValue<string>
  retargetCollapsedSourceNames: WritableValue<string[]>
  retargetLibrary: WritableValue<ReusableAnimationAsset[]>
  retargetLibraryAsset: ReadonlyValue<ReusableAnimationAsset | null>
  retargetLoading: WritableValue<boolean>
  retargetMessage: WritableValue<string>
  retargetPreviewStatus: WritableValue<string>
  retargetSourceBytes: WritableValue<ArrayBuffer | null>
  retargetSourceClip: ReadonlyValue<THREE.AnimationClip | null>
  retargetSourceClipIndex: WritableValue<number>
  retargetSourceFileName: WritableValue<string>
  retargetSourceNodeNames: ReadonlyValue<string[]>
  retargetSourcePreviewCanvas: ReadonlyValue<HTMLCanvasElement | null>
  retargetSourcePreviewPlaying: WritableValue<boolean>
  retargetSourceRoot: WritableValue<THREE.Object3D | null>
  retargetTargetBones: ReadonlyValue<THREE.Bone[]>
  retargetTargetPreviewCanvas: ReadonlyValue<HTMLCanvasElement | null>
  retargetTargetPreviewPlaying: WritableValue<boolean>
  rigBones: ReadonlyValue<THREE.Bone[]>
  rigClipRole: WritableValue<AnimationRole>
  rigRestPose: ReadonlyValue<RigPose>
  selectedRetargetLibraryClip: WritableValue<THREE.AnimationClip | null>
  selectedRetargetLibraryId: WritableValue<string>
  selectedSavedAnimationSourceId: WritableValue<string>
  skinTokensExecutablePath: ReadonlyValue<string>
  skinTokensLoading: ReadonlyValue<boolean>
  skinTokensMessage: ReadonlyValue<string>
  skinTokensOperation: WritableValue<'rig' | 'skin'>
  skinTokensRigCompatible: ReadonlyValue<boolean>
  updateColliderPreview: () => void
}

export function createModelImportRetargetingController(context: ModelImportRetargetingContext) {
  const {
    props,
    emit,
    activeSetupTab,
    animationClipRevision,
    animationRoles,
    error,
    fitCamera,
    getScene,
    guessedAnimationRole,
    isReadOnlyPreview,
    loading,
    model,
    originalHeight,
    parseGlbBytes,
    disposeModel,
    performSkinTokensRigging,
    previewAnimationIndex,
    previewAnimationRuntime,
    previewAnimations,
    refreshModelDiagnostics,
    selectPreviewAnimation,
    restoreModelRenderableMeshes,
    restorePreviewVisibility,
    retargetAutonomousLoading,
    retargetAutonomousStage,
    retargetBoneMap,
    retargetClipName,
    retargetCollapsedSourceNames,
    retargetLibrary,
    retargetLibraryAsset,
    retargetLoading,
    retargetMessage,
    retargetPreviewStatus,
    retargetSourceBytes,
    retargetSourceClip,
    retargetSourceClipIndex,
    retargetSourceFileName,
    retargetSourceNodeNames,
    retargetSourcePreviewCanvas,
    retargetSourcePreviewPlaying,
    retargetSourceRoot,
    retargetTargetBones,
    retargetTargetPreviewCanvas,
    retargetTargetPreviewPlaying,
    rigBones,
    rigClipRole,
    rigRestPose,
    selectedRetargetLibraryClip,
    selectedRetargetLibraryId,
    selectedSavedAnimationSourceId,
    skinTokensExecutablePath,
    skinTokensLoading,
    skinTokensMessage,
    skinTokensOperation,
    skinTokensRigCompatible,
    updateColliderPreview,
  } = context

function loadRetargetAnimationLibrary() {
  retargetLibrary.value = readRetargetAnimationLibrary()
}

function persistRetargetAnimationLibrary() {
  const saved = writeRetargetAnimationLibrary(retargetLibrary.value)
  if (!saved) {
    retargetMessage.value = 'Não foi possível guardar a animação. A biblioteca local pode estar sem espaço.'
  }
  return saved
}

function clearRetargetSource() {
  const previous = retargetSourceRoot.value
  retargetSourceRoot.value = null
  retargetSourceBytes.value = null
  selectedSavedAnimationSourceId.value = ''
  if (previous) disposeModel(previous)
  retargetSourceFileName.value = ''
  retargetSourceClipIndex.value = 0
  selectedRetargetLibraryId.value = ''
  selectedRetargetLibraryClip.value = null
  retargetBoneMap.value = {}
  retargetCollapsedSourceNames.value = []
  retargetClipName.value = ''
}

async function chooseRetargetAnimationSource(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  retargetLoading.value = true
  retargetMessage.value = ''
  error.value = ''
  try {
    if (!file.name.toLowerCase().endsWith('.glb')) {
      throw new Error('Escolha um arquivo GLB com animações incorporadas.')
    }
    const sourceBytes = await file.arrayBuffer()
    const loaded = await parseGlbBytes(sourceBytes)
    loaded.userData.importSourceGlbBytes = sourceBytes.slice(0)
    loaded.updateWorldMatrix(true, true)
    const clips = (loaded.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    if (clips.length === 0) {
      disposeModel(loaded)
      throw new Error('Esse GLB não contém clipes de animação. Escolha um modelo animado.')
    }
    // Importar o modelo B como origem de animação não pode remover nem deixar
    // invisível o modelo A, que continua sendo o destino do retargeting.
    const targetBeforeSourceLoad = model.value
    const currentScene = getScene()
    if (targetBeforeSourceLoad) {
      restorePreviewVisibility()
      restoreModelRenderableMeshes(targetBeforeSourceLoad)
      if (currentScene && targetBeforeSourceLoad.parent !== currentScene) currentScene.add(targetBeforeSourceLoad)
      targetBeforeSourceLoad.updateMatrixWorld(true)
      if (targetBeforeSourceLoad.parent === currentScene) fitCamera(targetBeforeSourceLoad)
      updateColliderPreview()
    }

    clearRetargetSource()
    retargetSourceRoot.value = loaded
    retargetSourceBytes.value = sourceBytes.slice(0)
    retargetSourceFileName.value = file.name
    retargetSourceClipIndex.value = 0
    retargetClipName.value = clips[0]?.name?.trim() || file.name.replace(/\.glb$/i, '')
    retargetMessage.value = `Origem carregada: ${clips.length} animação(ões). O modelo A foi mantido como destino. Faça o mapeamento para o rig de destino e aplique.`
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível abrir o modelo de animação.'
  } finally {
    retargetLoading.value = false
  }
}

function selectSavedAnimationSource(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  if (id) emit('load-animation-source', id)
}

function saveRetargetSourceToLibrary() {
  const root = retargetSourceRoot.value
  const bytes = retargetSourceBytes.value
    ?? (root?.userData.importSourceGlbBytes instanceof ArrayBuffer ? root.userData.importSourceGlbBytes : null)
  if (!root || !bytes || bytes.byteLength <= 20) {
    retargetMessage.value = 'Não há um GLB original disponível para salvar como fonte de animação.'
    return
  }
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  const height = bounds.isEmpty() ? 2 : Math.max(0.1, bounds.getSize(new THREE.Vector3()).y)
  const name = retargetSourceFileName.value.replace(/\\.glb$/i, '').trim() || root.name || 'Fonte de animação'
  emit('save-animation-source', { name, bytes: bytes.slice(0), height })
  retargetMessage.value = `"${name}" enviado à biblioteca de importados como fonte de animações. Ele não será inserido no mundo.`
}

async function loadSavedAnimationSource(asset: RetargetAnimationSourceAsset) {
  retargetLoading.value = true
  try {
    const bytes = asset.bytes.slice(0)
    const loaded = await parseGlbBytes(bytes)
    loaded.userData.importSourceGlbBytes = bytes.slice(0)
    loaded.updateWorldMatrix(true, true)
    const clips = (loaded.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    if (clips.length === 0) {
      disposeModel(loaded)
      throw new Error('Esta fonte não contém clipes de animação válidos.')
    }

    // O arquivo da biblioteca é apenas a origem (modelo B). Nunca substitui o
    // modelo A que já está aberto no importador.
    const target = model.value
    const currentScene = getScene()
    if (target) {
      restorePreviewVisibility()
      restoreModelRenderableMeshes(target)
      if (currentScene && target.parent !== currentScene) currentScene.add(target)
      target.updateMatrixWorld(true)
      if (target.parent === currentScene) fitCamera(target)
      updateColliderPreview()
    }
    clearRetargetSource()
    retargetSourceRoot.value = loaded
    retargetSourceBytes.value = bytes
    selectedSavedAnimationSourceId.value = asset.id
    retargetSourceFileName.value = asset.name + '.glb'
    retargetSourceClipIndex.value = 0
    retargetClipName.value = clips[0]?.name?.trim() || asset.name
    activeSetupTab.value = 'rigging'
    retargetMessage.value = `Fonte "${asset.name}" carregada. O modelo A permanece como destino; escolha a animação e execute o retargeting.`
    await nextTick()
    ensureRetargetPreviewStages()
    refreshRetargetSourcePreview()
    refreshRetargetTargetPreview()
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível carregar a fonte de animação.'
  } finally {
    retargetLoading.value = false
  }
}

function onRetargetSourceClipChanged() {
  const clip = retargetSourceClip.value
  if (clip) retargetClipName.value = clip.name?.trim() || 'Animação reutilizada'
  retargetMessage.value = ''
  retargetBoneMap.value = {}
}

function selectRetargetLibraryAsset(id: string) {
  selectedRetargetLibraryId.value = id
  selectedRetargetLibraryClip.value = null
  if (id) {
    const asset = retargetLibrary.value.find(item => item.id === id)
    if (!asset) {
      selectedRetargetLibraryId.value = ''
      return
    }
    try {
      selectedRetargetLibraryClip.value = parseReusableAnimationClip(asset)
      if (retargetSourceRoot.value) {
        const previous = retargetSourceRoot.value
        retargetSourceRoot.value = null
        retargetSourceBytes.value = null
        selectedSavedAnimationSourceId.value = ''
        disposeModel(previous)
      }
      retargetSourceFileName.value = ''
      retargetClipName.value = asset.name
      rigClipRole.value = asset.role
      retargetMessage.value = `Animação "${asset.name}" carregada da biblioteca. Selecione os ossos de destino e aplique-a ao modelo atual.`
    } catch (cause) {
      retargetMessage.value = cause instanceof Error ? cause.message : 'A animação salva está inválida.'
      selectedRetargetLibraryId.value = ''
      selectedRetargetLibraryClip.value = null
    }
  } else {
    selectedRetargetLibraryClip.value = null
    retargetMessage.value = retargetSourceRoot.value
      ? 'Usando a animação do arquivo GLB carregado.'
      : 'Carregue um GLB animado ou escolha uma animação da biblioteca.'
  }
  retargetBoneMap.value = {}
}

function setRetargetBoneMapping(sourceName: string, targetName: string) {
  retargetBoneMap.value = { ...retargetBoneMap.value, [sourceName]: targetName }
  // A manual assignment replaces only this row's inferred collapsed-joint rule.
  retargetCollapsedSourceNames.value = retargetCollapsedSourceNames.value.filter(name => name !== sourceName)
}

function retargetableAssetForCurrentSource(): ReusableAnimationAsset | null {
  return createRetargetAssetForSource({
    libraryAsset: retargetLibraryAsset.value,
    root: retargetSourceRoot.value,
    clip: retargetSourceClip.value,
    sourceName: retargetSourceFileName.value,
    clipName: retargetClipName.value,
    role: rigClipRole.value,
  })
}

let retargetSourcePreviewStage: RetargetPreviewStage | null = null
let retargetTargetPreviewStage: RetargetPreviewStage | null = null

function setRetargetPreviewObject(stage: RetargetPreviewStage, root: THREE.Object3D | null, clip: THREE.AnimationClip | null = null) {
  setRetargetPreviewStageObject(stage, root, clip, () => {
    if (stage.key === 'source') retargetSourcePreviewPlaying.value = true
    else retargetTargetPreviewPlaying.value = true
  })
}

function ensureRetargetPreviewStages() {
  if (!retargetSourcePreviewStage && retargetSourcePreviewCanvas.value) {
    retargetSourcePreviewStage = createRetargetPreviewStage(
      retargetSourcePreviewCanvas.value,
      'source',
      () => retargetSourcePreviewPlaying.value,
    )
  }
  if (!retargetTargetPreviewStage && retargetTargetPreviewCanvas.value) {
    retargetTargetPreviewStage = createRetargetPreviewStage(
      retargetTargetPreviewCanvas.value,
      'target',
      () => retargetTargetPreviewPlaying.value,
    )
  }
}

function disposeRetargetPreviews() {
  disposeRetargetPreviewStage(retargetSourcePreviewStage)
  disposeRetargetPreviewStage(retargetTargetPreviewStage)
  retargetSourcePreviewStage = null
  retargetTargetPreviewStage = null
}

function refreshRetargetSourcePreview() {
  const stage = retargetSourcePreviewStage
  const source = retargetSourceRoot.value
  const clip = retargetSourceClip.value
  if (!stage || !source || !clip) {
    if (stage) setRetargetPreviewObject(stage, null)
    retargetSourcePreviewPlaying.value = false
    return
  }
  setRetargetPreviewObject(stage, cloneRetargetPreviewObject(source), clip)
  retargetSourcePreviewPlaying.value = true
}

function refreshRetargetTargetPreview() {
  const stage = retargetTargetPreviewStage
  const sourceClip = retargetSourceClip.value
  const target = model.value
  if (!stage) return
  if (!target) {
    setRetargetPreviewObject(stage, null)
    retargetPreviewStatus.value = 'Carregue o modelo que receberá a animação.'
    return
  }

  const previewModel = cloneRetargetPreviewObject(target)
  try {
    const preview = buildRetargetTargetPreview({
      target,
      previewModel,
      sourceClip,
      asset: sourceClip ? retargetableAssetForCurrentSource() : null,
      boneMap: retargetBoneMap.value,
      collapsedSourceNames: retargetCollapsedSourceNames.value,
      originalHeight: originalHeight.value,
      clipName: retargetClipName.value,
      fallbackRestPose: rigRestPose.value,
    })
    setRetargetPreviewObject(stage, previewModel, preview.clip)
    retargetPreviewStatus.value = preview.status
  } catch (cause) {
    setRetargetPreviewObject(stage, previewModel)
    retargetPreviewStatus.value = cause instanceof Error
      ? cause.message
      : 'Não foi possível gerar a prévia no modelo de destino.'
  }
}

function toggleRetargetSourcePreviewPlayback() {
  retargetSourcePreviewPlaying.value = !retargetSourcePreviewPlaying.value
  if (retargetSourcePreviewPlaying.value) retargetSourcePreviewStage?.clock.start()
}

function toggleRetargetTargetPreviewPlayback() {
  retargetTargetPreviewPlaying.value = !retargetTargetPreviewPlaying.value
  if (retargetTargetPreviewPlaying.value) retargetTargetPreviewStage?.clock.start()
}

function saveRetargetAnimationToLibrary() {
  const root = retargetSourceRoot.value
  const clip = retargetSourceClip.value
  if (!root || !clip || selectedRetargetLibraryId.value) {
    retargetMessage.value = 'Carregue uma animação de um arquivo GLB antes de guardá-la na biblioteca.'
    return
  }
  try {
    const asset = createReusableAnimationAsset(
      root,
      clip,
      retargetSourceFileName.value || root.name || 'Modelo de origem',
      rigClipRole.value,
    )
    asset.name = retargetClipName.value.trim() || asset.name
    retargetLibrary.value = [...retargetLibrary.value, asset]
    if (persistRetargetAnimationLibrary()) {
      retargetMessage.value = `"${asset.name}" foi guardada na biblioteca local e poderá ser usada em outros modelos.`
    }
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível guardar essa animação.'
  }
}

function deleteRetargetLibraryAsset() {
  const id = selectedRetargetLibraryId.value
  if (!id) return
  retargetLibrary.value = retargetLibrary.value.filter(asset => asset.id !== id)
  selectedRetargetLibraryId.value = ''
  selectedRetargetLibraryClip.value = null
  retargetBoneMap.value = {}
  if (persistRetargetAnimationLibrary()) retargetMessage.value = 'Animação removida da biblioteca local.'
}

function applyRetargetedAnimation() {
  const root = model.value
  const clip = retargetSourceClip.value
  const targetBones = retargetTargetBones.value
  if (!root || !clip || targetBones.length === 0) {
    retargetMessage.value = 'O modelo de destino precisa ter um rig. Crie o rig ou carregue um modelo que já possua ossos.'
    return
  }

  const asset = retargetableAssetForCurrentSource()
  if (!asset) {
    retargetMessage.value = 'Carregue um GLB animado ou escolha uma animação da biblioteca.'
    return
  }

  try {
    previewAnimationRuntime.controller?.stop()
    const hasStoredTargetRestPose = restoreRetargetRestPose(root, targetBones)
    if (!hasStoredTargetRestPose && rigBones.value.length && Object.keys(rigRestPose.value).length > 0) {
      applyRigPose(targetBones, rigRestPose.value)
    }
    root.updateWorldMatrix(true, true)
    const targetHeight = originalHeight.value > 1e-5
      ? originalHeight.value
      : Math.max(0.1, new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y)
    const name = retargetClipName.value.trim() || asset.name || clip.name || 'Animação reutilizada'
    const result = retargetAnimationClip(
      asset,
      targetBones,
      retargetBoneMap.value,
      name,
      targetHeight,
      retargetCollapsedSourceNames.value,
      root,
    )
    const integratedClip = integrateRetargetedAnimationClip(
      root,
      result.clip,
      previewAnimations.value,
      animationRoles.value,
      rigClipRole.value,
    )
    // A transferência muda ossos, não deve ocultar as malhas ligadas ao rig.
    restoreModelRenderableMeshes(root)
    animationRoles.value = integratedClip.roles
    animationClipRevision.value += 1
    previewAnimationIndex.value = integratedClip.index
    refreshModelDiagnostics()
    selectPreviewAnimation(integratedClip.index)
    retargetMessage.value = formatRetargetAnimationTransferMessage(result)
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível transferir a animação.'
  }
}


async function runAutonomousRetargeting() {
  if (retargetAutonomousLoading.value || retargetLoading.value || loading.value) return

  const initialTarget = model.value
  const sourceClip = retargetSourceClip.value
  const sourceNames = [...retargetSourceNodeNames.value]
  if (!initialTarget) {
    retargetMessage.value = 'Carregue primeiro o modelo A, que receberá a animação.'
    return
  }
  if (!sourceClip || sourceNames.length === 0) {
    retargetMessage.value = 'Carregue um GLB animado do modelo B e selecione um clipe com trilhas de transformação.'
    return
  }
  if (isReadOnlyPreview.value) {
    retargetMessage.value = 'Este ativo está em modo de visualização. Abra-o para edição antes de transferir animações.'
    return
  }
  if (skinTokensLoading.value) {
    retargetMessage.value = 'Aguarde a operação de IA em andamento antes de iniciar o retargeting autônomo.'
    return
  }

  // Não retargetear nem salvar um personagem com partes temporariamente
  // escondidas pelo modo "Isolar parte" do painel de inspeção.
  restorePreviewVisibility()

  retargetAutonomousLoading.value = true
  let generatedRig = false
  try {
    const asset = retargetableAssetForCurrentSource()
    if (!asset || !asset.sourceNodeNames.length) {
      throw new Error('Não consegui extrair poses de repouso do modelo B. Confira se o clipe anima ossos ou outros nós com posição, rotação ou escala.')
    }

    retargetAutonomousStage.value = 'Etapa 1/3 · Verificando o rig do modelo A'
    let targetRoot = model.value
    if (!targetRoot) throw new Error('O modelo A deixou de estar disponível.')

    let targetRig = inspectRetargetTargetRig(targetRoot)
    if (targetRig.bones.length === 0 || !targetRig.hasSkinnedMesh) {
      if (!isTauri()) {
        throw new Error('Para fazer o fluxo autônomo completo, abra o aplicativo desktop Tauri e configure o SkinTokens local. O destino ainda não tem um rig esquelético utilizável.')
      }
      if (!skinTokensExecutablePath.value.trim()) {
        throw new Error('O modelo A não tem um rig pronto. Instale o SkinTokens com scripts/install-skintokens.ps1 e informe o caminho de skintokens.exe no painel de IA local.')
      }
      skinTokensOperation.value = 'rig'
      if (!skinTokensRigCompatible.value) {
        throw new Error('A IA não pode gerar um rig para a estrutura atual. Verifique se o modelo A contém malhas estáticas válidas e não mistura malhas estáticas e esqueléticas incompatíveis.')
      }

      retargetAutonomousStage.value = 'Etapa 1/3 · A IA local está gerando o esqueleto e os pesos do modelo A'
      const targetBeforeAi = targetRoot
      await performSkinTokensRigging(true)
      if (model.value === targetBeforeAi) {
        throw new Error(skinTokensMessage.value || 'A IA local não conseguiu preparar o rig do modelo A.')
      }
      targetRoot = model.value
      if (!targetRoot) throw new Error('A IA terminou, mas o modelo A não foi carregado novamente.')
      targetRig = inspectRetargetTargetRig(targetRoot)
      if (targetRig.bones.length === 0 || !targetRig.hasSkinnedMesh) {
        throw new Error('A IA não produziu um rig esquelético com malha deformável. O modelo não foi retargetado.')
      }
      generatedRig = true
      activeSetupTab.value = 'rigging'
      await nextTick()
    }

    retargetAutonomousStage.value = 'Etapa 2/3 · Relacionando ossos por anatomia, hierarquia e geometria'
    targetRoot.updateWorldMatrix(true, true)
    const mappingResult = suggestAutonomousBoneMappingsDetailed(
      sourceNames,
      targetRig.bones,
      retargetSourceRoot.value,
      targetRoot,
    )
    const mapping = mappingResult.mapping
    retargetCollapsedSourceNames.value = mappingResult.collapsedSourceNames
    retargetBoneMap.value = Object.fromEntries(sourceNames.map(name => [name, mapping[name] ?? '']))
    const mappedNames = sourceNames.filter(name => Boolean(mapping[name]))
    if (mappedNames.length === 0) {
      throw new Error('Não encontrei correspondências seguras entre os ossos dos modelos A e B. O rig foi preservado; revise os ossos manualmente ou escolha modelos com anatomias mais semelhantes.')
    }

    if (!retargetClipName.value.trim()) {
      retargetClipName.value = sourceClip.name?.trim() || (retargetSourceFileName.value || 'Animação') + ' transferida'
    }
    const guessedRole = guessedAnimationRole(sourceClip.name || retargetSourceFileName.value)
    if (guessedRole !== 'ignore') rigClipRole.value = guessedRole

    retargetAutonomousStage.value = 'Etapa 3/3 · Adaptando a animação e validando as trilhas transferidas'
    const revisionBeforeTransfer = animationClipRevision.value
    applyRetargetedAnimation()

    const finalRoot = model.value
    const finalClips = (finalRoot?.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    // A transferência pode atualizar um clipe existente em vez de aumentar a lista.
    if (animationClipRevision.value === revisionBeforeTransfer || finalClips.length === 0) {
      throw new Error(retargetMessage.value || 'A transferência não gerou nem atualizou um clipe válido.')
    }

    const report = buildAutonomousRetargetReport({
      sourceNodeCount: sourceNames.length,
      mappedNodeCount: mappedNames.length,
      destinationBoneCount: targetRig.bones.length,
      mappedDestinationBoneCount: new Set(Object.values(mapping)).size,
      directMappedCount: mappingResult.directMappedCount,
      collapsedSourceCount: mappingResult.collapsedSourceNames.length,
      generatedRig,
      transferReport: retargetMessage.value,
    })
    retargetMessage.value = report.message
    retargetPreviewStatus.value = report.previewStatus
    retargetTargetPreviewPlaying.value = true
    await nextTick()
    refreshRetargetTargetPreview()
  } catch (cause) {
    retargetMessage.value = cause instanceof Error ? cause.message : 'Não foi possível concluir o retargeting autônomo.'
  } finally {
    retargetAutonomousLoading.value = false
    retargetAutonomousStage.value = ''
  }
}

function autoMapRetargetBones() {
  const sourceNames = retargetSourceNodeNames.value
  const result = suggestAutonomousBoneMappingsDetailed(
    sourceNames,
    retargetTargetBones.value,
    retargetSourceRoot.value,
    model.value,
  )
  const mapping = result.mapping
  retargetCollapsedSourceNames.value = result.collapsedSourceNames
  retargetBoneMap.value = Object.fromEntries(sourceNames.map(name => [name, mapping[name] ?? '']))
  retargetMessage.value = `Mapeamento automático: ${Object.keys(mapping).length}/${sourceNames.length}; ${result.directMappedCount} associação(ões) direta(s) e ${result.collapsedSourceNames.length} junta(s) recolhida(s) em ossos compatíveis. As linhas ignoradas têm sugestões candidatas; confira antes de aplicar.`
}

watch(
  () => props.animationSourceAsset?.id ?? '',
  async id => {
    const asset = props.animationSourceAsset
    if (!id || !asset || asset.libraryType !== 'animation-source') return
    await loadSavedAnimationSource(asset)
  },
)

watch(
  () => [
    selectedRetargetLibraryId.value,
    retargetSourceRoot.value?.uuid ?? '',
    retargetSourceClip.value?.uuid ?? '',
    retargetSourceNodeNames.value.join('|'),
    retargetTargetBones.value.map(bone => bone.name).join('|'),
  ].join('::'),
  () => {
    autoMapRetargetBones()
    if (retargetSourceClip.value && !retargetClipName.value.trim()) {
      retargetClipName.value = retargetSourceClip.value.name || 'Animação reutilizada'
    }
  },
)

watch(
  () => [
    activeSetupTab.value,
    retargetSourceRoot.value?.uuid ?? '',
    retargetSourceClip.value?.uuid ?? '',
    selectedRetargetLibraryId.value,
  ].join('::'),
  async () => {
    await nextTick()
    if (activeSetupTab.value !== 'rigging' || !retargetSourceClip.value) {
      disposeRetargetPreviews()
      return
    }
    ensureRetargetPreviewStages()
    refreshRetargetSourcePreview()
    refreshRetargetTargetPreview()
  },
)

watch(
  () => [
    activeSetupTab.value,
    model.value?.uuid ?? '',
    retargetSourceClip.value?.uuid ?? '',
    JSON.stringify(retargetBoneMap.value),
    retargetTargetBones.value.map(bone => bone.name).join('|'),
    JSON.stringify(rigRestPose.value),
  ].join('::'),
  async () => {
    await nextTick()
    if (activeSetupTab.value !== 'rigging' || !retargetSourceClip.value) return
    ensureRetargetPreviewStages()
    refreshRetargetTargetPreview()
  },
)


  return {
    loadRetargetAnimationLibrary,
    clearRetargetSource,
    chooseRetargetAnimationSource,
    selectSavedAnimationSource,
    saveRetargetSourceToLibrary,
    onRetargetSourceClipChanged,
    selectRetargetLibraryAsset,
    setRetargetBoneMapping,
    disposeRetargetPreviews,
    toggleRetargetSourcePreviewPlayback,
    toggleRetargetTargetPreviewPlayback,
    saveRetargetAnimationToLibrary,
    deleteRetargetLibraryAsset,
    applyRetargetedAnimation,
    runAutonomousRetargeting,
    autoMapRetargetBones,
  }
}
