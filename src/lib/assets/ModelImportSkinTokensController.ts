import * as THREE from 'three'
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog'
import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AnimationRole, ModelControlBindings } from '@engine'
import { captureRigPose } from '../animation/Rigging'
import type { AutoRigPreset } from '../animation/Rigging'
import { processSkinTokensModel } from './SkinTokensModelProcessor'
import { prepareSkinTokensRiggingResult } from './SkinTokensRiggingResult'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type SkinTokensOperation = 'rig' | 'skin'
type SkinTokensResolvedClass = 'humanoid' | 'quadruped' | 'custom'
type ModelImportSkinTokensContext = {
  model: ReadonlyValue<THREE.Object3D | null>
  skinTokensExecutablePath: WritableValue<string>
  skinTokensOperation: WritableValue<SkinTokensOperation>
  skinTokensLoading: WritableValue<boolean>
  skinTokensMessage: WritableValue<string>
  skinTokensResolvedClass: ReadonlyValue<SkinTokensResolvedClass>
  skinTokensRigCompatible: ReadonlyValue<boolean>
  animationRoles: WritableValue<Record<string, AnimationRole>>
  controlBindings: WritableValue<ModelControlBindings>
  colliderType: WritableValue<'box' | 'sphere' | 'capsule' | 'mesh' | 'none'>
  colliderSize: WritableValue<[number, number, number]>
  colliderOffset: WritableValue<[number, number, number]>
  componentName: WritableValue<string>
  fileName: ReadonlyValue<string>
  modelHeight: ReadonlyValue<number>
  animationClipRevision: WritableValue<number>
  rigBones: WritableValue<THREE.Bone[]>
  selectedRigBoneName: WritableValue<string>
  rigRestPose: WritableValue<Record<string, { position: number[]; quaternion: number[]; scale: number[] }>>
  rigKeyframes: WritableValue<Array<{ time: number; pose: Record<string, { position: number[]; quaternion: number[]; scale: number[] }> }>>
  rigFrameTime: WritableValue<number>
  rigDuration: WritableValue<number>
  rigPreset: WritableValue<AutoRigPreset>
  rigMessage: WritableValue<string>
  parseGlbBytes: (bytes: ArrayBuffer, manager?: THREE.LoadingManager) => Promise<THREE.Object3D>
  showLoadedModel: (loaded: THREE.Object3D, displayName: string, targetHeight?: number, preserveRetargetSource?: boolean) => Promise<void>
  guessedAnimationRole: (name: string) => AnimationRole
  refreshRigHelper: () => void
}

export function createModelImportSkinTokensController(context: ModelImportSkinTokensContext) {
  const {
    model,
    skinTokensExecutablePath,
    skinTokensOperation,
    skinTokensLoading,
    skinTokensMessage,
    skinTokensResolvedClass,
    skinTokensRigCompatible,
    animationRoles,
    controlBindings,
    colliderType,
    colliderSize,
    colliderOffset,
    componentName,
    fileName,
    modelHeight,
    animationClipRevision,
    rigBones,
    selectedRigBoneName,
    rigRestPose,
    rigKeyframes,
    rigFrameTime,
    rigDuration,
    rigPreset,
    rigMessage,
    parseGlbBytes,
    showLoadedModel,
    guessedAnimationRole,
    refreshRigHelper,
  } = context

async function chooseSkinTokensExecutable() {
  if (!isTauri()) {
    skinTokensMessage.value = 'O backend local exige o aplicativo desktop Tauri; não pode ser executado na prévia do navegador.'
    return
  }
  try {
    const selected = await openNativeDialog({
      multiple: false,
      directory: false,
      title: 'Selecionar executável local SkinTokens',
      filters: [{ name: 'Executável SkinTokens', extensions: ['exe'] }],
    })
    if (typeof selected === 'string' && selected) {
      skinTokensExecutablePath.value = selected
      skinTokensMessage.value = 'Executável selecionado. Clique em “Testar backend local” para verificar o modelo e o checkpoint.'
    }
  } catch (cause) {
    skinTokensMessage.value = cause instanceof Error ? cause.message : 'Não foi possível selecionar o executável.'
  }
}

async function testSkinTokensBackend() {
  if (!isTauri()) {
    skinTokensMessage.value = 'O backend local exige o aplicativo desktop Tauri.'
    return
  }
  if (!skinTokensExecutablePath.value.trim()) {
    skinTokensMessage.value = 'Instale o backend gratuito e selecione o executável skintokens.exe.'
    return
  }
  skinTokensLoading.value = true
  skinTokensMessage.value = 'Verificando o executável e o checkpoint local...'
  try {
    const result = await invoke<string>('skintokens_doctor', { executablePath: skinTokensExecutablePath.value.trim() })
    skinTokensMessage.value = 'Backend local disponível. ' + result
  } catch (cause) {
    skinTokensMessage.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    skinTokensLoading.value = false
  }
}

async function runSkinTokensRigging() {
  await performSkinTokensRigging(false)
}

async function performSkinTokensRigging(preserveRetargetSource: boolean) {
  const root = model.value
  if (!root || skinTokensLoading.value) return
  if (!isTauri()) {
    skinTokensMessage.value = 'Abra o Engine Prometheus como aplicativo desktop Tauri para executar IA local.'
    return
  }
  if (!skinTokensExecutablePath.value.trim()) {
    skinTokensMessage.value = 'Instale o backend gratuito usando scripts/install-skintokens.ps1 e informe o caminho de skintokens.exe.'
    return
  }
  if (!skinTokensRigCompatible.value) {
    skinTokensMessage.value = skinTokensOperation.value === 'rig'
      ? 'Para gerar um rig novo, importe um modelo sem malha esquelética. Se o modelo já tiver rig, selecione “Melhorar pesos do rig atual”.'
      : 'A operação de pesos exige um modelo que já tenha pelo menos uma malha SkinnedMesh com esqueleto.'
    return
  }

  skinTokensLoading.value = true
  skinTokensMessage.value = 'Preparando o GLB e executando SkinTokens localmente. A primeira execução pode demorar; o arquivo não é enviado para um serviço remoto.'
  try {
    const operation = skinTokensOperation.value
    const sourceClips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
    const sourceRolesByName = new Map<string, AnimationRole>()
    sourceClips.forEach((clip, index) => {
      const role = animationRoles.value[String(index)]
      if (role) sourceRolesByName.set(clip.name, role)
    })
    const preservedControls = { ...controlBindings.value }
    const preservedColliderType = colliderType.value
    const preservedColliderSize = [...colliderSize.value] as [number, number, number]
    const preservedColliderOffset = [...colliderOffset.value] as [number, number, number]
    const preservedComponentName = componentName.value
    const loaded = await processSkinTokensModel(root, {
      executablePath: skinTokensExecutablePath.value.trim(),
      operation,
      modelClass: skinTokensResolvedClass.value,
      sourceClips,
      parseGlbBytes,
    })
    const displayName = fileName.value || root.name || 'Modelo com rig de IA'
    const targetHeight = Math.max(0.1, modelHeight.value)
    let detectedBones: THREE.Bone[] = []
    let generatedPreset: AutoRigPreset = skinTokensResolvedClass.value === 'humanoid'
      ? 'humanoid'
      : skinTokensResolvedClass.value === 'quadruped' ? 'quadruped' : 'ai'

    const preparedResult = prepareSkinTokensRiggingResult(
      loaded,
      operation,
      generatedPreset,
      sourceRolesByName,
      guessedAnimationRole,
    )
    detectedBones = preparedResult.detectedBones
    if (!detectedBones.length) throw new Error('O resultado da IA não contém ossos reconhecíveis. Confira o relatório/diagnóstico do SkinTokens e tente novamente.')

    await showLoadedModel(loaded, displayName, targetHeight, preserveRetargetSource)
    // Preserve configurações do importador que não fazem parte do arquivo GLB original.
    componentName.value = preservedComponentName || loaded.name
    controlBindings.value = preservedControls
    colliderType.value = preservedColliderType
    colliderSize.value = preservedColliderSize
    colliderOffset.value = preservedColliderOffset
    loaded.userData.importControlBindings = { ...preservedControls }
    loaded.userData.importColliderType = colliderType.value
    loaded.userData.importColliderSize = [...colliderSize.value]
    loaded.userData.importColliderOffset = [...colliderOffset.value]
    const outputRoles = preparedResult.animationRoles
    animationRoles.value = outputRoles
    loaded.userData.importAnimationRoles = { ...outputRoles }
    animationClipRevision.value += 1
    // Também disponibiliza os ossos preservados na operação de pesos, sem marcá-los
    // como rig gerado nem liberar o reposicionamento de juntas de um esqueleto existente.
    rigBones.value = detectedBones
    selectedRigBoneName.value = detectedBones[0]?.name ?? ''
    rigRestPose.value = captureRigPose(detectedBones)
    rigKeyframes.value = []
    rigFrameTime.value = 0
    rigDuration.value = 1
    if (operation === 'rig') {
      rigPreset.value = generatedPreset
      rigMessage.value = 'Rig criado pela IA local. Revise a posição dos ossos e teste a deformação antes de criar animações.'
    } else {
      rigMessage.value = 'Os pesos foram recalculados pela IA. O esqueleto existente foi preservado; a posição das juntas permanece bloqueada para evitar alteração acidental do rig original.'
    }
    refreshRigHelper()
    skinTokensMessage.value = operation === 'rig'
      ? 'Rig por IA concluído: ' + detectedBones.length + ' ossos. O modelo agora está na prévia; confira juntas, pesos e pose antes de salvar.'
      : 'Pesos de deformação recalculados pela IA local. O esqueleto do modelo foi preservado; confira as deformações antes de salvar.'
  } catch (cause) {
    skinTokensMessage.value = cause instanceof Error ? cause.message : 'O processamento de IA local falhou.'
  } finally {
    skinTokensLoading.value = false
  }
}


  return {
    chooseSkinTokensExecutable,
    testSkinTokensBackend,
    runSkinTokensRigging,
    performSkinTokensRigging,
  }
}
