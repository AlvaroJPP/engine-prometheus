<script setup lang="ts">
import { ref, toRefs } from 'vue'
import * as THREE from 'three'
import type { AnimationRole, ModelControlBindings } from '@engine'
import type { GltfMetadata } from '@/lib/assets/GltfMetadata'

type AnimationOption = { value: string; label: string }
type ControlBindingField = { key: keyof ModelControlBindings; label: string; description: string }
type ModelImportRightPanelBindings = Record<string, any> & {
  ANIMATION_ROLE_BASE_OPTIONS: ReadonlyArray<AnimationOption>
  animationRoleOptions: ReadonlyArray<AnimationOption>
  controlBindingFields: ReadonlyArray<ControlBindingField>
  previewAnimations: readonly THREE.AnimationClip[]
  retargetSourceClips: readonly THREE.AnimationClip[]
  animationSourceOptions?: Array<{ id: string; name: string; height?: number; thumbnail?: string }>
}

const props = defineProps<{ bindings: ModelImportRightPanelBindings }>()
const {
  ANIMATION_ROLE_BASE_OPTIONS,
  BEHAVIOR_PACKAGE_DEFINITIONS,
  DEFAULT_MODEL_CONTROL_BINDINGS,
  activeSetupTab,
  addImportPackageModelState,
  animationRoleOptions,
  animationRoles,
  animationSourceOptions,
  applyRecoveredColorTexture,
  applyRetargetedAnimation,
  applyRigFrame,
  applySelectedBoneTransform,
  autoMapRetargetBones,
  bonePositionDraft,
  boneRotationDraft,
  changeColliderType,
  chooseRetargetAnimationSource,
  chooseSkinTokensExecutable,
  chooseThumbnailImage,
  clearCustomThumbnail,
  clearRigKeyframesForNewClip,
  colliderOffset,
  colliderPreviewNotice,
  colliderSize,
  colliderType,
  componentName,
  controlBindingFields,
  controlBindings,
  createRig,
  createRigAnimation,
  customThumbnail,
  customThumbnailFileName,
  deleteRetargetLibraryAsset,
  diagnosticSummary,
  dialogProps,
  error,
  fileName,
  formatModelControlKey,
  formatPackageConfigLabel,
  hasRetargetMapping,
  importPackageConfigValue,
  importPackageControlBindingFields,
  importPackageControlBindingValue,
  importPackageModelStates,
  importPackageVariableValue,
  importPackageVectorValue,
  isEditingSavedComponent,
  isReadOnlyPreview,
  isSimplePackageConfigValue,
  isTauri,
  listeningForBinding,
  loading,
  materialsMissingColorTexture,
  model,
  modelDiagnostics,
  modelHeight,
  onImportPackageModelStateValueChange,
  onRetargetSourceClipChanged,
  previewAnimationIndex,
  previewAnimations,
  previewComponentDimensions,
  previewPackageModelNodes,
  recordRigKeyframe,
  recoverableColorImages,
  removeImportPackageModelState,
  resetControlBindings,
  resetRigPose,
  retargetAutonomousLoading,
  retargetAutonomousStage,
  retargetBoneMap,
  retargetClipName,
  retargetCollapsedSourceNames,
  retargetLibrary,
  retargetLoading,
  retargetMappedBoneCount,
  retargetMessage,
  retargetOtherBonesFor,
  retargetPreviewStatus,
  retargetSourceBytes,
  retargetSourceClip,
  retargetSourceClipIndex,
  retargetSourceClips,
  retargetSourceFileName,
  retargetSourceNodeNames,
  retargetSourcePreviewPlaying,
  retargetSourceRoot,
  retargetSuggestedBonesFor,
  retargetTargetBones,
  retargetTargetPreviewPlaying,
  rigBones,
  rigClipName,
  rigClipRole,
  rigDuration,
  rigFrameTime,
  rigInputAnalysis,
  rigKeyframes,
  rigMessage,
  rigPreset,
  rigPresetOptions,
  runAutonomousRetargeting,
  runSkinTokensRigging,
  saveRetargetAnimationToLibrary,
  saveRetargetSourceToLibrary,
  selectPreviewAnimation,
  selectRetargetLibraryAsset,
  selectSavedAnimationSource,
  selectedBehaviorPackageDefinitions,
  selectedBehaviorPackageIds,
  selectedRetargetLibraryId,
  selectedRigBone,
  selectedRigBoneName,
  selectedSavedAnimationSourceId,
  setAnimationRole,
  setColliderVector,
  setImportPackageControlBinding,
  setImportPackageInteractionKey,
  setImportPackageVector,
  setModelHeight,
  setRetargetBoneMapping,
  setRetargetSourcePreviewCanvas,
  setRetargetTargetPreviewCanvas,
  setRigTime,
  skinTokensClassChoice,
  skinTokensClassOptions,
  skinTokensExecutablePath,
  skinTokensLoading,
  skinTokensMessage,
  skinTokensOperation,
  skinTokensResolvedClass,
  skinTokensRigCompatible,
  startControlBindingCapture,
  testSkinTokensBackend,
  textureRepairBusy,
  textureRepairMessage,
  textureRepairSelections,
  thumbnailImageError,
  toggleImportBehaviorPackage,
  toggleRetargetSourcePreviewPlayback,
  toggleRetargetTargetPreviewPlayback,
  updateImportPackageConfigScalar,
  updateImportPackageModelState,
  updateImportPackageVariable
} = toRefs(props.bindings)

async function handleChooseRetargetAnimationSource(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : retargetFileInput.value
  try {
    await chooseRetargetAnimationSource.value(event)
  } finally {
    if (input) input.value = ''
  }
}

// These inputs belong to this panel; the preview canvases are callback refs because
// their Three.js stages remain lifecycle-managed by the parent dialog.
const retargetFileInput = ref<HTMLInputElement | null>(null)
const thumbnailFileInput = ref<HTMLInputElement | null>(null)
</script>

<template>
<aside class="model-import-right-panel">
          <section v-if="activeSetupTab === 'controls'" class="model-panel-section model-controls-section">
            <div class="model-panel-heading"><span>02</span> MAPA DE CONTROLES</div>
            <p class="model-panel-hint">Clique em uma tecla e pressione a nova combinação. Estas teclas são salvas junto ao modelo e serão usadas quando o componente receber o pacote de comportamento <strong>Montaria</strong>.</p>
            <div class="model-control-bindings">
              <div v-for="binding in controlBindingFields" :key="binding.key" class="model-control-row">
                <div class="model-control-copy">
                  <strong>{{ binding.label }}</strong>
                  <small>{{ binding.description }}</small>
                </div>
                <button
                  type="button"
                  class="model-control-key"
                  :class="{ listening: listeningForBinding === binding.key }"
                  :disabled="!model || isReadOnlyPreview"
                  @click="startControlBindingCapture(binding.key)"
                >{{ listeningForBinding === binding.key ? 'Pressione…' : formatModelControlKey(controlBindings[binding.key]) }}</button>
              </div>
            </div>
            <p v-if="listeningForBinding" class="model-control-capture-tip">Aguardando tecla para “{{ controlBindingFields.find(item => item.key === listeningForBinding)?.label }}”. Pressione Esc para cancelar.</p>
            <p class="model-control-note">Padrão: W/A/S/D movimentam, Shift corre, Espaço pula e E interage. As setas continuam aceitas para movimento. A tecla de interação também é usada para desmontar.</p>
            <button type="button" class="model-control-reset" :disabled="!model || isReadOnlyPreview" title="Descarta as alterações e restaura as teclas de movimento padrão para este modelo." @click="resetControlBindings">Restaurar teclas padrão</button>
          </section>

          <section v-if="activeSetupTab === 'animations'" class="model-panel-section model-animation-section">
            <div class="model-panel-heading"><span>03</span> MAPEAMENTO DE ANIMAÇÕES <b>{{ previewAnimations.length }}</b></div>
            <p class="model-panel-hint">Associe cada clipe a uma função do motor. Selecione “Prévia” para testar o clipe no viewport antes de salvar.</p>
            <div v-if="previewAnimations.length" class="model-animation-mapping-list">
              <article v-for="(clip, index) in previewAnimations" :key="index" class="model-animation-map-row" :class="{ active: previewAnimationIndex === index }">
                <div class="model-animation-map-head">
                  <strong :title="clip.name || ('Animação ' + (index + 1))">{{ clip.name || ('Animação ' + (index + 1)) }}</strong>
                  <small>{{ clip.duration.toFixed(2) }} s</small>
                </div>
                <select
                  :value="animationRoles[String(index)] ?? 'ignore'"
                  :disabled="isReadOnlyPreview"
                  :aria-label="'Função para ' + (clip.name || ('Animação ' + (index + 1)))"
                  @change="setAnimationRole(index, ($event.target as HTMLSelectElement).value as AnimationRole)"
                >
                  <option v-for="role in animationRoleOptions" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
                <button type="button" title="Seleciona e reproduz este clipe de animação na prévia." @click="selectPreviewAnimation(index)">▶ Prévia deste clipe</button>
              </article>
            </div>
            <div v-else class="model-setup-empty">
              <strong>Nenhuma animação encontrada</strong>
              <small>O arquivo precisa conter clipes de animação para configurar movimento automaticamente.</small>
            </div>
            <p class="model-control-note">As funções acompanham o mapa de controles ativo: movimento, caminhada lenta, postura, esquiva, rolamento, interação e ações de inventário/itens/habilidades. A tecla atual aparece ao lado do papel. Câmera e sair do jogo não acionam animações do personagem.</p>
          </section>

          <section v-if="activeSetupTab === 'rigging'" class="model-panel-section model-rigging-section">
            <div class="model-panel-heading"><span>04</span> RIGGING E ANIMAÇÃO POR OSSOS <b>{{ rigBones.length }}</b></div>
            <p class="model-panel-hint">Crie um esqueleto para modelos estáticos ou use os ossos de um modelo que já seja rigado. Depois ajuste a pose dos ossos e grave quadros-chave em tempos diferentes.</p>
            <div class="model-retarget-panel">
              <div class="model-rigging-subtitle">CAPTURAR E REUTILIZAR ANIMAÇÕES</div>
              <p class="model-panel-hint">Carregue um GLB animado de outro modelo, guarde o movimento na biblioteca e transfira as rotações para os ossos do rig atual. O arquivo original pode ser fechado depois de salvar na biblioteca.</p>
              <input ref="retargetFileInput" class="model-file-input" type="file" accept=".glb,model/gltf-binary" @change="handleChooseRetargetAnimationSource" />
              <button type="button" class="model-rigging-secondary" :disabled="retargetLoading || loading || retargetAutonomousLoading" @click="retargetFileInput?.click()">＋ Carregar GLB com animação</button>
              <button v-if="retargetSourceRoot && retargetSourceBytes" type="button" class="model-rigging-secondary model-retarget-save-source" :disabled="retargetLoading || retargetAutonomousLoading" @click="saveRetargetSourceToLibrary">▣ Salvar modelo B na biblioteca de importados</button>
              <label class="model-rigging-field">Fontes de animação importadas
                <select :value="selectedSavedAnimationSourceId" :disabled="retargetLoading || retargetAutonomousLoading || !(animationSourceOptions?.length)" @change="selectSavedAnimationSource">
                  <option value="">{{ animationSourceOptions?.length ? 'Escolher fonte salva…' : 'Nenhuma fonte salva' }}</option>
                  <option v-for="source in animationSourceOptions ?? []" :key="source.id" :value="source.id">{{ source.name }}</option>
                </select>
              </label>
              <p v-if="retargetSourceFileName" class="model-retarget-source">Origem: <strong>{{ retargetSourceFileName }}</strong></p>
              <label v-if="retargetSourceRoot" class="model-rigging-field">Animação extraída
                <select v-model.number="retargetSourceClipIndex" :disabled="retargetAutonomousLoading" @change="onRetargetSourceClipChanged">
                  <option v-for="(clip, index) in retargetSourceClips" :key="clip.uuid" :value="index">{{ clip.name || ('Animação ' + (index + 1)) }} · {{ clip.duration.toFixed(2) }} s</option>
                </select>
              </label>
              <label class="model-rigging-field">Biblioteca local de animações
                <select :value="selectedRetargetLibraryId" :disabled="retargetAutonomousLoading" @change="selectRetargetLibraryAsset(($event.target as HTMLSelectElement).value)">
                  <option value="">Usar arquivo GLB carregado acima</option>
                  <option v-for="asset in retargetLibrary" :key="asset.id" :value="asset.id">{{ asset.name }} · {{ asset.duration.toFixed(2) }} s</option>
                </select>
              </label>
              <button v-if="selectedRetargetLibraryId" type="button" class="model-rigging-secondary" @click="deleteRetargetLibraryAsset">Excluir da biblioteca local</button>
              <label v-if="retargetSourceClip" class="model-rigging-field">Nome do clipe no modelo de destino
                <input v-model.trim="retargetClipName" maxlength="80" placeholder="Ex.: Caminhada reutilizada" />
              </label>
              <label v-if="retargetSourceClip" class="model-rigging-field">Papel no jogo
                <select v-model="rigClipRole">
                  <option v-for="role in ANIMATION_ROLE_BASE_OPTIONS.filter(option => option.value !== 'ignore')" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
              </label>
              <div v-if="retargetSourceClip && retargetSourceNodeNames.length" class="model-retarget-mapping-wrap">
                <div class="model-retarget-mapping-heading">
                  <div class="model-rigging-subtitle">MAPEAR OSSOS DE ORIGEM → RIG ATUAL <span>{{ retargetMappedBoneCount }}/{{ retargetSourceNodeNames.length }}</span></div>
                  <button type="button" class="model-retarget-auto-map" :disabled="!retargetTargetBones.length" title="Refaz as sugestões considerando nomes anatômicos, lado, segmento e hierarquia." @click="autoMapRetargetBones">↻ Refazer automático</button>
                </div>
                <p class="model-panel-hint">As sugestões usam sinônimos anatômicos, prefixos comuns de rigs e a hierarquia dos pais. Correspondências ambíguas ficam vazias para evitar misturar lados ou partes do corpo. “Ignorar” deixa o osso sem transferência.</p>
                <div class="model-retarget-mappings">
                  <label v-for="sourceName in retargetSourceNodeNames" :key="sourceName" class="model-retarget-map-row" :class="{ 'model-retarget-map-row-unmapped': !retargetBoneMap[sourceName] }">
                    <span :title="sourceName">
                      {{ sourceName }}
                      <small v-if="retargetCollapsedSourceNames.includes(sourceName)"> · junta recolhida</small>
                      <small v-else-if="!retargetBoneMap[sourceName]"> · revisar</small>
                    </span>
                    <select :value="retargetBoneMap[sourceName] ?? ''" :disabled="retargetTargetBones.length === 0 || retargetAutonomousLoading" @change="setRetargetBoneMapping(sourceName, ($event.target as HTMLSelectElement).value)">
                      <option value="">Ignorar</option>
                      <optgroup v-if="retargetSuggestedBonesFor(sourceName).length" label="Melhores sugestões automáticas">
                        <option v-for="candidate in retargetSuggestedBonesFor(sourceName)" :key="'suggested-' + candidate.targetName" :value="candidate.targetName">
                          {{ candidate.targetName }} · {{ Math.round(candidate.score) }} pts{{ candidate.exactName ? ' · nome compatível' : '' }}
                        </option>
                      </optgroup>
                      <optgroup label="Demais ossos do destino">
                        <option v-for="bone in retargetOtherBonesFor(sourceName)" :key="'all-' + bone.uuid" :value="bone.name">{{ bone.name }}</option>
                      </optgroup>
                    </select>
                  </label>
                </div>
              </div>
              <p v-else-if="retargetSourceClip" class="model-control-note">Nenhuma trilha de posição, rotação ou escala compatível foi encontrada neste clipe.</p>
              <div v-if="retargetSourceClip" class="model-retarget-previews">
                <article class="model-retarget-preview-card">
                  <header class="model-retarget-preview-heading">
                    <strong>01 · Animação capturada</strong>
                    <small>{{ retargetSourceClip.name || 'Clipe de origem' }}</small>
                  </header>
                  <div class="model-retarget-preview-viewport">
                    <canvas :ref="setRetargetSourcePreviewCanvas" aria-label="Prévia da animação capturada no modelo de origem"></canvas>
                    <div v-if="!retargetSourceRoot" class="model-retarget-preview-overlay">
                      A biblioteca guarda o clipe e as poses, não o modelo original. Carregue o GLB de origem para visualizar este lado.
                    </div>
                  </div>
                  <button type="button" class="model-rigging-secondary model-retarget-preview-play" :disabled="!retargetSourceRoot" @click="toggleRetargetSourcePreviewPlayback">{{ retargetSourcePreviewPlaying ? 'Ⅱ Pausar origem' : '▶ Reproduzir origem' }}</button>
                </article>
                <article class="model-retarget-preview-card">
                  <header class="model-retarget-preview-heading">
                    <strong>02 · No modelo de destino</strong>
                    <small>Prévia temporária — ainda não salva</small>
                  </header>
                  <div class="model-retarget-preview-viewport">
                    <canvas :ref="setRetargetTargetPreviewCanvas" aria-label="Prévia da animação retargetada no modelo de destino"></canvas>
                    <div v-if="!model" class="model-retarget-preview-overlay">Carregue o modelo de destino para ver a animação aplicada a ele.</div>
                  </div>
                  <p class="model-retarget-preview-status">{{ retargetPreviewStatus }}</p>
                  <button type="button" class="model-rigging-secondary model-retarget-preview-play" :disabled="!model" @click="toggleRetargetTargetPreviewPlayback">{{ retargetTargetPreviewPlaying ? 'Ⅱ Pausar destino' : '▶ Reproduzir destino' }}</button>
                </article>
              </div>
              <div class="model-retarget-actions">
                <button type="button" class="model-rigging-secondary" :disabled="!retargetSourceRoot || !retargetSourceClip || !!selectedRetargetLibraryId || retargetLoading || retargetAutonomousLoading" @click="saveRetargetAnimationToLibrary">Guardar na biblioteca</button>
                <button type="button" class="model-rigging-primary" :disabled="!model || !retargetSourceClip || !retargetTargetBones.length || !hasRetargetMapping || isReadOnlyPreview || retargetLoading || retargetAutonomousLoading" @click="applyRetargetedAnimation">Retargetar manualmente e adicionar ao rig</button>
              </div>
              <button type="button" class="model-rigging-primary model-retarget-autonomous-button" :disabled="!model || !retargetSourceClip || !retargetSourceNodeNames.length || isReadOnlyPreview || loading || retargetLoading || retargetAutonomousLoading || skinTokensLoading" @click="runAutonomousRetargeting">
                <span v-if="retargetAutonomousLoading" class="model-skintokens-button-spinner" aria-hidden="true"></span>
                {{ retargetAutonomousLoading ? 'Executando retargeting autônomo…' : '✦ Executar fluxo autônomo (IA + retargeting)' }}
              </button>
              <div v-if="retargetAutonomousLoading" class="model-skintokens-loading" role="status" aria-live="polite" aria-busy="true">
                <div class="model-skintokens-loading-heading">
                  <span class="model-skintokens-spinner" aria-hidden="true"></span>
                  <strong>Fluxo autônomo em execução</strong>
                </div>
                <p>{{ retargetAutonomousStage }}</p>
                <div class="model-skintokens-progress-track" aria-hidden="true"><span></span></div>
                <small>O rig local só será gerado por IA se o modelo A ainda não tiver malha esquelética utilizável. Os arquivos permanecem no computador.</small>
              </div>
              <p class="model-control-note">O fluxo autônomo prepara o rig do modelo A com SkinTokens local quando necessário, associa os ossos por anatomia, hierarquia e geometria, transfere o clipe e informa a cobertura do mapeamento. A biblioteca local também permite reutilizar animações neste dispositivo.</p>
              <p v-if="retargetMessage" class="model-rigging-status">{{ retargetMessage }}</p>
            </div>
            <div class="model-rigging-separator"></div>
            <section class="model-retarget-panel model-skintokens-panel">
              <div class="model-rigging-subtitle">RIGGING POR IA LOCAL · GRATUITO</div>
              <p class="model-panel-hint">SkinTokens/TokenRig gera esqueleto e pesos de deformação com um modelo aberto executado no seu computador. Não usa chave de API, créditos ou plano pago.</p>
              <label class="model-rigging-field">Executável SkinTokens
                <input v-model.trim="skinTokensExecutablePath" type="text" spellcheck="false" :disabled="skinTokensLoading || loading" placeholder="C:\...\skintokens\target\release\skintokens.exe" />
              </label>
              <div class="model-retarget-actions">
                <button type="button" class="model-rigging-secondary" :disabled="!isTauri() || skinTokensLoading || loading" @click="chooseSkinTokensExecutable">Selecionar executável</button>
                <button type="button" class="model-rigging-secondary" :disabled="!isTauri() || !skinTokensExecutablePath.trim() || skinTokensLoading || loading" @click="testSkinTokensBackend">Testar backend local</button>
              </div>
              <label class="model-rigging-field">Operação de IA
                <select v-model="skinTokensOperation" :disabled="skinTokensLoading || loading">
                  <option value="rig">Gerar esqueleto + pesos (modelo sem rig)</option>
                  <option value="skin">Melhorar pesos do rig existente</option>
                </select>
              </label>
              <label v-if="skinTokensOperation === 'rig'" class="model-rigging-field">Classe do modelo
                <select v-model="skinTokensClassChoice" :disabled="skinTokensLoading || loading">
                  <option v-for="option in skinTokensClassOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <p v-if="skinTokensOperation === 'rig' && skinTokensClassChoice === 'auto' && rigInputAnalysis" class="model-control-note">Classe detectada: <strong>{{ skinTokensResolvedClass }}</strong>. {{ rigInputAnalysis.reason }}</p>
              <button type="button" class="model-rigging-primary" :disabled="!model || !!dialogProps.initialAsset || !isTauri() || loading || skinTokensLoading || !skinTokensExecutablePath.trim() || !skinTokensRigCompatible" @click="runSkinTokensRigging">
                <span v-if="skinTokensLoading" class="model-skintokens-button-spinner" aria-hidden="true"></span>
                {{ skinTokensLoading ? (skinTokensMessage.startsWith('Verificando') ? 'Verificando backend…' : 'Processando modelo…') : skinTokensOperation === 'rig' ? 'Gerar rig com SkinTokens' : 'Recalcular pesos com SkinTokens' }}
              </button>
              <div v-if="skinTokensLoading" class="model-skintokens-loading" role="status" aria-live="polite" aria-busy="true">
                <div class="model-skintokens-loading-heading">
                  <span class="model-skintokens-spinner" aria-hidden="true"></span>
                  <div class="model-skintokens-loading-copy">
                    <strong>{{ skinTokensMessage.startsWith('Verificando') ? 'Verificando o backend local' : skinTokensOperation === 'rig' ? 'Gerando esqueleto e pesos' : 'Recalculando pesos de deformação' }}</strong>
                    <small>SkinTokens está trabalhando no computador</small>
                  </div>
                  <span class="model-skintokens-live-pill"><i></i> ATIVO</span>
                </div>
                <div class="model-skintokens-progress-track" role="progressbar" aria-label="Processamento local em andamento" aria-valuetext="Progresso indeterminado">
                  <span></span>
                </div>
                <p>{{ skinTokensMessage }}</p>
                <small class="model-skintokens-loading-note">A barra é indeterminada: o backend não fornece porcentagem real. Não feche o importador até a operação terminar.</small>
              </div>
              <p v-if="!skinTokensLoading && !skinTokensRigCompatible && model && !dialogProps.initialAsset" class="model-control-note">{{ skinTokensOperation === 'rig' ? 'Para gerar rig, o modelo deve conter malhas estáticas sem esqueleto. Modelos já rigados usam a opção de melhorar pesos.' : 'A operação de pesos exige que o modelo já tenha uma malha esquelética.' }}</p>
              <p v-if="skinTokensMessage && !skinTokensLoading" class="model-rigging-status">{{ skinTokensMessage }}</p>
              <p class="model-control-note">Instalação única no Windows: execute <code>powershell -ExecutionPolicy Bypass -File .\scripts\install-skintokens.ps1</code> na pasta do repositório. O instalador compila o backend em CPU e baixa os pesos abertos (aprox. 1,1 GB); depois é possível trabalhar offline. Sua RTX 3060 de 6 GB não é requisito, pois esta versão usa CPU.</p>
              <a class="model-control-note" href="https://github.com/chris-straka/skintokens" target="_blank" rel="noreferrer">Código-fonte e detalhes de licença do backend</a>
            </section>
            <div class="model-rigging-separator"></div>
            <label class="model-rigging-field">Modelo de rig
              <select v-model="rigPreset" :disabled="!model || !!dialogProps.initialAsset || loading" title="Escolha a estrutura de rig sugerida para o tipo de modelo selecionado.">
                <option v-for="option in rigPresetOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <button type="button" class="model-rigging-primary" :disabled="!model || !!dialogProps.initialAsset || loading" title="Gera um rig inicial para permitir selecionar ossos, ajustar poses e criar clipes." @click="createRig">
              {{ rigBones.length ? 'Recarregar rig existente' : 'Criar rig automático' }}
            </button>
            <p v-if="rigPreset === 'auto' && rigInputAnalysis" class="model-control-note">Detecção sugerida: <strong>{{ rigInputAnalysis.recommendedPreset }}</strong>. {{ rigInputAnalysis.reason }} Medidas aproximadas: {{ rigInputAnalysis.dimensions.width.toFixed(2) }} × {{ rigInputAnalysis.dimensions.height.toFixed(2) }} × {{ rigInputAnalysis.dimensions.depth.toFixed(2) }}; {{ rigInputAnalysis.meshCount }} malha(s).</p>
            <p class="model-control-note">O modo “Por peças” é indicado quando cada parte articulada é uma malha separada: cada uma recebe seu próprio pivô e pesos rígidos. Para malhas orgânicas únicas, os pesos por proximidade são apenas uma base inicial; confira a deformação e ajuste as juntas. Modelos arbitrários não podem ser rigados perfeitamente apenas por heurísticas.</p>

            <template v-if="rigBones.length">
              <div class="model-rigging-summary">
                <span><small>OSSOS</small><strong>{{ rigBones.length }}</strong></span>
                <span><small>QUADROS</small><strong>{{ rigKeyframes.length }}</strong></span>
                <span><small>CLIPES</small><strong>{{ previewAnimations.length }}</strong></span>
              </div>

              <label class="model-rigging-field">Osso selecionado
                <select v-model="selectedRigBoneName" title="Seleciona o osso do rig que receberá os ajustes de posição e rotação.">
                  <option v-for="bone in rigBones" :key="bone.uuid" :value="bone.name">{{ bone.name }}</option>
                </select>
              </label>
              <div v-if="selectedRigBone" class="model-rigging-rotation">
                <div class="model-rigging-subtitle">POSIÇÃO LOCAL · UNIDADES</div>
                <label>X<input v-model.number="bonePositionDraft.x" type="number" step="0.05" :disabled="model?.userData.importRigGenerated !== true" @change="applySelectedBoneTransform" /></label>
                <label>Y<input v-model.number="bonePositionDraft.y" type="number" step="0.05" :disabled="model?.userData.importRigGenerated !== true" @change="applySelectedBoneTransform" /></label>
                <label>Z<input v-model.number="bonePositionDraft.z" type="number" step="0.05" :disabled="model?.userData.importRigGenerated !== true" @change="applySelectedBoneTransform" /></label>
                <div class="model-rigging-subtitle">ROTAÇÃO LOCAL · GRAUS</div>
                <label>X<input v-model.number="boneRotationDraft.x" type="number" step="5" @change="applySelectedBoneTransform" /></label>
                <label>Y<input v-model.number="boneRotationDraft.y" type="number" step="5" @change="applySelectedBoneTransform" /></label>
                <label>Z<input v-model.number="boneRotationDraft.z" type="number" step="5" @change="applySelectedBoneTransform" /></label>
              </div>
              <button type="button" class="model-rigging-secondary" title="Retorna o rig à pose inicial de referência." @click="resetRigPose">Restaurar pose inicial</button>
              <div class="model-rigging-separator"></div>

              <div class="model-rigging-subtitle">LINHA DO TEMPO</div>
              <label class="model-rigging-field">Tempo do quadro (segundos)
                <input :value="rigFrameTime" type="number" min="0" max="120" step="0.1" @change="setRigTime(Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label class="model-rigging-field">Duração do clipe (segundos)
                <input v-model.number="rigDuration" type="number" min="0.1" max="120" step="0.1" />
              </label>
              <button type="button" class="model-rigging-primary" title="Grava a pose atual do rig como um quadro-chave no tempo indicado." @click="recordRigKeyframe">＋ Gravar pose neste tempo</button>
              <div v-if="rigKeyframes.length" class="model-rigging-frames">
                <button v-for="frame in rigKeyframes" :key="frame.time" type="button" @click="applyRigFrame(frame)" :class="{ active: Math.abs(rigFrameTime - frame.time) < 0.001 }">
                  <strong>{{ frame.time.toFixed(2) }} s</strong><span>Aplicar pose</span>
                </button>
              </div>
              <p class="model-control-note">Exemplo: grave uma pose em 0 s, gire os ossos, mude para 0,5 s e grave outra. O motor interpola entre as poses.</p>

              <div class="model-rigging-separator"></div>
              <div class="model-rigging-subtitle">SALVAR COMO NOVA ANIMAÇÃO</div>
              <label class="model-rigging-field">Nome
                <input v-model.trim="rigClipName" maxlength="80" placeholder="Ex.: Montar cavalo" />
              </label>
              <label class="model-rigging-field">Papel no jogo
                <select v-model="rigClipRole">
                  <option v-for="role in ANIMATION_ROLE_BASE_OPTIONS.filter(option => option.value !== 'ignore')" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
              </label>
              <button type="button" class="model-rigging-primary" :disabled="rigKeyframes.length < 2 || !!dialogProps.initialAsset" title="Cria uma animação interpolando os quadros-chave gravados." @click="createRigAnimation">Criar clipe de animação</button>
              <button type="button" class="model-rigging-secondary" title="Limpa os quadros-chave atuais para começar outro clipe." @click="clearRigKeyframesForNewClip">Nova animação / limpar quadros</button>
              <p class="model-control-note">Para sincronizar a montagem, crie um clipe com o papel “Montar / subir” no jogador e outro com o mesmo papel no cavalo. O pacote Montaria dispara os dois quando o jogador monta.</p>
              <p v-if="rigMessage" class="model-rigging-status">{{ rigMessage }}</p>
            </template>
            <div v-else class="model-setup-empty">
              <strong>Nenhum rig carregado</strong>
              <small>Escolha Humanoide, Quadrúpede ou Corrente genérica e crie o rig. Se o modelo já tiver um esqueleto glTF, a ferramenta detectará os ossos existentes.</small>
            </div>
          </section>

          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>04</span> NOME DO COMPONENTE</div>
            <label class="model-component-name-field">Nome na biblioteca
              <input v-model.trim="componentName" maxlength="80" placeholder="Ex.: Taverna medieval" :disabled="!model || isReadOnlyPreview" />
            </label>
            <p class="model-panel-hint">Esse nome será usado na biblioteca e nas novas cópias colocadas no mundo.</p>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section model-behavior-packages-section">
            <div class="model-panel-heading"><span>04B</span> PACOTES DE COMPORTAMENTO <b>{{ selectedBehaviorPackageIds.length }}</b></div>
            <p class="model-panel-hint">Selecione os sistemas que este componente deve receber e configure aqui suas variáveis, controles, posição e estados visuais. As configurações também poderão ser ajustadas depois no painel Pacotes.</p>
            <div v-if="BEHAVIOR_PACKAGE_DEFINITIONS.length" class="model-behavior-package-list">
              <label
                v-for="definition in BEHAVIOR_PACKAGE_DEFINITIONS"
                :key="definition.id"
                class="model-behavior-package-card"
                :class="{ selected: selectedBehaviorPackageIds.includes(definition.id) }"
                :title="definition.description"
              >
                <input
                  type="checkbox"
                  :checked="selectedBehaviorPackageIds.includes(definition.id)"
                  :disabled="!model || isReadOnlyPreview"
                  @change="toggleImportBehaviorPackage(definition.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="model-behavior-package-check" aria-hidden="true">{{ selectedBehaviorPackageIds.includes(definition.id) ? '✓' : '' }}</span>
                <span class="model-behavior-package-copy">
                  <strong>{{ definition.name }}</strong>
                  <small>{{ definition.description }}</small>
                  <span class="model-behavior-package-meta">{{ definition.variables.length }} variáveis · {{ definition.triggers.length }} gatilhos · {{ definition.conditions.length }} condições · {{ definition.actions.length }} ações</span>
                </span>
              </label>
            </div>
            <div v-else class="model-setup-empty">
              <strong>Nenhum pacote disponível</strong>
              <small>Os pacotes instalados no motor aparecerão aqui quando estiverem disponíveis.</small>
            </div>

            <div v-if="selectedBehaviorPackageDefinitions.length" class="model-package-settings-list">
              <article v-for="definition in selectedBehaviorPackageDefinitions" :key="definition.id" class="model-package-settings-card">
                <div class="model-package-settings-header">
                  <div><strong>{{ definition.name }}</strong><small>Configurações deste pacote para o componente</small></div>
                  <span class="model-package-settings-badge">ATIVO</span>
                </div>

                <div class="model-package-subheading">VARIÁVEIS</div>
                <div v-for="variable in definition.variables" :key="variable.name" class="model-package-variable">
                  <label v-if="variable.type === 'boolean'" class="model-package-toggle">
                    <input
                      type="checkbox"
                      :checked="importPackageVariableValue(definition.id, variable.name, variable.defaultValue) === true"
                      :disabled="variable.readOnly === true || isReadOnlyPreview"
                      @change="updateImportPackageVariable(definition.id, variable, $event)"
                    />
                    <span><strong>{{ variable.label }}</strong><small>{{ variable.description }}</small></span>
                  </label>
                  <label v-else class="model-package-field">
                    <span><strong>{{ variable.label }}</strong><small>{{ variable.description }}</small></span>
                    <input
                      :type="variable.type === 'number' ? 'number' : 'text'"
                      :value="String(importPackageVariableValue(definition.id, variable.name, variable.defaultValue))"
                      :min="variable.min"
                      :max="variable.max"
                      :step="variable.step"
                      :disabled="variable.readOnly === true || isReadOnlyPreview"
                      @change="updateImportPackageVariable(definition.id, variable, $event)"
                    />
                  </label>
                </div>

                <template v-if="definition.id === 'mount'">
                  <div class="model-package-subheading">CONTROLES E INTERAÇÃO</div>
                  <label class="model-package-field">
                    <span><strong>Tecla para montar / desmontar</strong><small>Também atualiza o comando de interação do pacote.</small></span>
                    <select
                      :value="String(importPackageConfigValue(definition.id, 'interactionKey', 'KeyE'))"
                      :disabled="isReadOnlyPreview"
                      @change="setImportPackageInteractionKey(definition.id, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="KeyE">E</option><option value="KeyF">F</option><option value="KeyR">R</option><option value="KeyQ">Q</option><option value="KeyG">G</option>
                    </select>
                  </label>
                  <div class="model-package-subheading">POSIÇÃO DO JOGADOR</div>
                  <p class="model-panel-hint">Deslocamento relativo ao centro da montaria. Ajuste para posicionar o jogador sobre a sela.</p>
                  <div class="model-package-vector">
                    <label>X<input type="number" step="0.05" :value="importPackageVectorValue(definition.id, 'seatOffset', 0, 0)" :disabled="isReadOnlyPreview" @change="setImportPackageVector(definition.id, 'seatOffset', 0, $event)" /></label>
                    <label>Y<input type="number" step="0.05" :value="importPackageVectorValue(definition.id, 'seatOffset', 1, 0.55)" :disabled="isReadOnlyPreview" @change="setImportPackageVector(definition.id, 'seatOffset', 1, $event)" /></label>
                    <label>Z<input type="number" step="0.05" :value="importPackageVectorValue(definition.id, 'seatOffset', 2, 0)" :disabled="isReadOnlyPreview" @change="setImportPackageVector(definition.id, 'seatOffset', 2, $event)" /></label>
                  </div>

                  <div class="model-package-subheading">MAPEAMENTO DAS TECLAS DA MONTARIA</div>
                  <div class="model-package-bindings">
                    <label v-for="binding in importPackageControlBindingFields" :key="binding.key" class="model-package-field">
                      <span><strong>{{ binding.label }}</strong><small>Tecla física do teclado</small></span>
                      <input
                        :value="importPackageControlBindingValue(definition.id, binding.key)"
                        maxlength="32"
                        :disabled="isReadOnlyPreview"
                        :placeholder="DEFAULT_MODEL_CONTROL_BINDINGS[binding.key]"
                        @change="setImportPackageControlBinding(definition.id, binding.key, $event)"
                      />
                    </label>
                  </div>

                  <div class="model-package-subheading">ESTADOS VISUAIS DO MODELO</div>
                  <p class="model-panel-hint">Mostre ou oculte partes do GLB conforme uma variável do pacote, por exemplo: exibir o cavaleiro quando <code>mounted = true</code>.</p>
                  <button type="button" class="model-package-add-state" :disabled="!previewPackageModelNodes.length || isReadOnlyPreview" @click="addImportPackageModelState(definition.id)">＋ Adicionar estado visual</button>
                  <p v-if="!previewPackageModelNodes.length" class="model-panel-hint">O modelo precisa conter grupos ou malhas na hierarquia para criar estados visuais.</p>
                  <div v-for="state in importPackageModelStates(definition.id)" :key="state.id" class="model-package-state">
                    <label class="model-package-field">
                      <span><strong>Parte / grupo do GLB</strong></span>
                      <select :value="state.nodePath" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { nodePath: ($event.target as HTMLSelectElement).value })">
                        <option v-for="node in previewPackageModelNodes" :key="node.path" :value="node.path">{{ node.name }} · {{ node.meshCount }} malha(s)</option>
                      </select>
                    </label>
                    <label class="model-package-field">
                      <span><strong>Variável da condição</strong></span>
                      <select :value="state.variable" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { variable: ($event.target as HTMLSelectElement).value })">
                        <option v-for="variable in definition.variables" :key="variable.name" :value="variable.name">{{ variable.name }}</option>
                      </select>
                    </label>
                    <div class="model-package-state-grid">
                      <label class="model-package-field">
                        <span><strong>Comparação</strong></span>
                        <select :value="state.operator" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { operator: ($event.target as HTMLSelectElement).value as 'equals' | 'not_equals' })">
                          <option value="equals">Igual a</option><option value="not_equals">Diferente de</option>
                        </select>
                      </label>
                      <label class="model-package-field">
                        <span><strong>Valor esperado</strong></span>
                        <input type="text" :value="String(state.value)" :disabled="isReadOnlyPreview" @change="onImportPackageModelStateValueChange(definition.id, state.id, $event)" />
                      </label>
                    </div>
                    <label class="model-package-toggle">
                      <input type="checkbox" :checked="state.visibleWhenMatched" :disabled="isReadOnlyPreview" @change="updateImportPackageModelState(definition.id, state.id, { visibleWhenMatched: ($event.target as HTMLInputElement).checked })" />
                      <span><strong>Exibir quando a condição for verdadeira</strong></span>
                    </label>
                    <button type="button" class="model-package-remove-state" :disabled="isReadOnlyPreview" @click="removeImportPackageModelState(definition.id, state.id)">Remover estado ×</button>
                  </div>
                </template>

                <template v-for="(defaultValue, configKey) in definition.defaultConfig" :key="configKey">
                  <label v-if="isSimplePackageConfigValue(configKey, defaultValue)" class="model-package-field">
                    <span><strong>{{ formatPackageConfigLabel(configKey) }}</strong><small>Configuração do pacote</small></span>
                    <input
                      :type="typeof defaultValue === 'number' ? 'number' : 'text'"
                      :value="String(importPackageConfigValue(definition.id, configKey, defaultValue))"
                      :disabled="isReadOnlyPreview"
                      @change="updateImportPackageConfigScalar(definition.id, configKey, defaultValue, $event)"
                    />
                  </label>
                </template>
              </article>
            </div>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>04A</span> IMAGEM DE PREVIEW</div>
            <input
              ref="thumbnailFileInput"
              class="model-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              @change="chooseThumbnailImage"
            />
            <div class="model-preview-image-config">
              <div class="model-preview-image-frame">
                <img v-if="customThumbnail" :src="customThumbnail" alt="Prévia da imagem escolhida" />
                <span v-else>▧</span>
              </div>
              <div class="model-preview-image-copy">
                <strong :title="customThumbnailFileName">{{ customThumbnailFileName || 'Prévia 3D automática' }}</strong>
                <small>{{ customThumbnail ? 'Esta imagem aparecerá na biblioteca de componentes.' : 'Escolha uma imagem para usar no cartão do componente.' }}</small>
                <div class="model-preview-image-actions">
                  <button type="button" :disabled="!model || isReadOnlyPreview" title="Escolhe uma imagem JPG, PNG ou WEBP do computador para o cartão do componente." @click="thumbnailFileInput?.click()">Escolher imagem</button>
                  <button v-if="customThumbnail" type="button" :disabled="isReadOnlyPreview" title="Remove a imagem escolhida e volta a gerar a miniatura a partir da prévia 3D." @click="clearCustomThumbnail">Usar 3D</button>
                </div>
              </div>
            </div>
            <p v-if="thumbnailImageError" class="model-preview-image-error">{{ thumbnailImageError }}</p>
            <p class="model-panel-hint">A imagem é reduzida para 256 × 256 px para não ocupar muito espaço. Se nenhuma for escolhida, o editor usa a captura da prévia 3D.</p>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section">
            <div class="model-panel-heading"><span>05</span> TRANSFORMAÇÃO</div>
            <label class="model-height-label"><span>Altura final</span><strong>{{ modelHeight.toFixed(2) }} <small>u</small></strong></label>
            <div class="model-height-entry">
              <input class="model-height-number" type="number" min="0.1" max="10000" step="0.01" :value="modelHeight" :disabled="!model" title="Digite a altura final em unidades do mundo, até 10.000 unidades." @change="setModelHeight(Number(($event.target as HTMLInputElement).value))" />
              <span>unidades (u)</span>
            </div>
            <input v-model.number="modelHeight" class="model-height-slider" type="range" min="0.1" max="10" step="0.1" :disabled="!model" title="Ajuste rápido para tamanhos comuns até 10 unidades; use o campo numérico para valores maiores." />
            <p class="model-height-unit-note">Para modelos gigantes, digite o tamanho em unidades no campo acima.</p>
            <div class="model-height-presets"><button v-for="size in [0.5, 1, 1.8, 2, 3, 5]" :key="size" :class="{ active: Math.abs(modelHeight - size) < 0.05 }" :disabled="!model" @click="modelHeight = size">{{ size }}u</button></div>
            <div class="model-import-dimensions">
              <div><small>LARGURA X</small><strong>{{ previewComponentDimensions.x ? previewComponentDimensions.x.toFixed(2) : '—' }}</strong></div>
              <div><small>ALTURA Y</small><strong>{{ model ? previewComponentDimensions.y.toFixed(2) : '—' }}</strong></div>
              <div><small>PROF. Z</small><strong>{{ previewComponentDimensions.z ? previewComponentDimensions.z.toFixed(2) : '—' }}</strong></div>
            </div>
          </section>
          <div v-if="activeSetupTab === 'model'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'model'" class="model-panel-section model-collider-section">
            <div class="model-panel-heading"><span>06</span> COLISOR FÍSICO</div>
            <p class="model-collider-help">Escolha como o jogador e os objetos vão interagir com este modelo. Para cidades, prédios agrupados e terrenos importados, use <strong>Malha estática (cidade)</strong>: a colisão usa os triângulos reais e uma árvore BVH para consultar apenas a geometria próxima, preservando ruas e espaços vazios. Use apenas em cenários que não sejam animados. O contorno verde representa a colisão.</p>
            <label class="model-collider-field">Forma
              <select :value="colliderType" :disabled="!model" title="Escolha o formato da área física de colisão usada no jogo." @change="changeColliderType(($event.target as HTMLSelectElement).value as 'box' | 'sphere' | 'capsule' | 'mesh' | 'none')">
                <option value="box">Caixa</option>
                <option value="sphere">Esfera</option>
                <option value="capsule">Cápsula</option>
                <option value="mesh">Malha estática (cidade)</option>
                <option value="none">Sem colisão</option>
              </select>
            </label>
            <p v-if="colliderPreviewNotice" class="model-collider-example" role="status" aria-live="polite">{{ colliderPreviewNotice }}</p>
            <template v-if="colliderType !== 'mesh'">
              <div class="model-collider-subtitle">{{ colliderType === 'sphere' ? 'DIÂMETRO DA ESFERA (raio = metade)' : 'DIMENSÕES DO COLISOR' }}</div>
            <div class="model-collider-grid">
              <label>{{ colliderType === 'sphere' ? 'Diâmetro X' : 'Largura X' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[0]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 0, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>{{ colliderType === 'sphere' ? 'Diâmetro Y' : 'Altura Y' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[1]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 1, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>{{ colliderType === 'sphere' ? 'Diâmetro Z' : 'Prof. Z' }}<input type="number" min="0.05" step="0.1" :value="colliderSize[2]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderSize', 2, Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
            <div class="model-collider-subtitle">DESLOCAMENTO RELATIVO AO CENTRO DO MODELO</div>
            <div class="model-collider-grid">
              <label>X<input type="number" step="0.1" :value="colliderOffset[0]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 0, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>Y<input type="number" step="0.1" :value="colliderOffset[1]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 1, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>Z<input type="number" step="0.1" :value="colliderOffset[2]" :disabled="!model || colliderType === 'none'" @input="setColliderVector('colliderOffset', 2, Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
            <p class="model-collider-example">Exemplo: para uma esfera de raio 0,5, informe 1,0 nos três diâmetros. Em uma árvore, ajuste o deslocamento Y para posicionar a esfera no tronco.</p>
            </template>
          </section>
          <div v-if="activeSetupTab === 'technical'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'technical'" class="model-panel-section">
            <div class="model-panel-heading"><span>01</span> INFORMAÇÕES DO ARQUIVO</div>
            <div class="model-asset-info-row"><span>Arquivo</span><strong :title="fileName">{{ fileName || '—' }}</strong></div>
            <div class="model-asset-info-row"><span>Tipo</span><strong>{{ fileName ? (fileName.split('.').pop() || '—').toUpperCase() : '—' }}</strong></div>
            <div class="model-asset-info-row"><span>Geometria</span><strong>{{ diagnosticSummary.meshes }} malhas</strong></div>
            <div class="model-asset-info-row"><span>Materiais</span><strong>{{ diagnosticSummary.materials }}</strong></div>
            <div class="model-asset-info-row"><span>Texturas</span><strong>{{ diagnosticSummary.textures }}</strong></div>
            <div class="model-asset-info-row"><span>Animações</span><strong>{{ diagnosticSummary.clips }}</strong></div>
          </section>
          <div v-if="activeSetupTab === 'technical'" class="model-panel-separator"></div>
          <section v-if="activeSetupTab === 'technical'" class="model-panel-section model-diagnostic-section">
            <div class="model-panel-heading"><span>02</span> DIAGNÓSTICO E TEXTURAS</div>
                      <details class="model-diagnostics">
            <summary>DIAGNÓSTICO TÉCNICO DO MODELO</summary>
            <div class="model-diagnostics-summary">
              <span>Nós <b>{{ diagnosticSummary.nodes }}</b></span>
              <span>Malhas <b>{{ diagnosticSummary.meshes }}</b></span>
              <span>Skinned <b>{{ diagnosticSummary.skinned }}</b></span>
              <span>Materiais <b>{{ diagnosticSummary.materials }}</b></span>
              <span>Texturas <b>{{ diagnosticSummary.textures }}</b></span>
              <span>Animações <b>{{ diagnosticSummary.clips }}</b></span>
            </div>
            <p class="model-diagnostics-hint">URI data: indica imagem incorporada no JSON; URI externa indica arquivo referenciado. Imagens presentes no ZIP só serão usadas como cor se algum material as referenciar em baseColorTexture.</p>
            <div v-if="model" class="model-diagnostics-list">
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>GLTF</b><span>Imagens e texturas declaradas no arquivo</span></div>
                <template v-for="image in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.images ?? [])" :key="'image-' + image.index">
                  <small>Imagem {{ image.index }}: {{ image.name || '(sem nome)' }} · {{ image.mimeType || (image.uri.startsWith('data:') ? (image.uri.slice(5, image.uri.indexOf(';')) || 'tipo não declarado') : 'tipo não declarado') }} · {{ image.uri.startsWith('data:') ? 'incorporada (data URI)' : image.uri ? 'URI externa' : image.bufferView !== null ? 'incorporada por bufferView' : 'origem não identificada' }}</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.images?.length)">Nenhuma imagem declarada no JSON glTF.</small>
              </div>
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>MAPAS</b><span>Associação original de texturas por material</span></div>
                <template v-for="material in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.materials ?? [])" :key="'material-' + material.index">
                  <small>{{ material.name || ('Material ' + material.index) }}: cor={{ material.baseColorTexture ?? (((model.userData.importRecoveredColorTextures as Record<string, number> | undefined)?.[String(material.index)] !== undefined) ? 'imagem recuperada ' + (model.userData.importRecoveredColorTextures as Record<string, number>)[String(material.index)] : 'nenhuma') }}, normal={{ material.normalTexture ?? 'nenhuma' }}, oclusão={{ material.occlusionTexture ?? 'nenhuma' }}, emissiva={{ material.emissiveTexture ?? 'nenhuma' }}{{ material.baseColorFactor ? ', fator=' + material.baseColorFactor.join('/') : '' }}</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.materials?.length)">Nenhum material declarado no JSON glTF.</small>
              </div>
              <div v-if="materialsMissingColorTexture.length && recoverableColorImages.length" class="model-diagnostic-row model-texture-repair">
                <div class="model-diagnostic-title"><b>RECUPERAÇÃO</b><span>Aplicar imagem como cor principal</span></div>
                <p>O glTF não associa imagens à cor principal de alguns materiais. Selecione uma imagem para testar no material; os mapas normais e de oclusão serão mantidos.</p>
                <div v-for="material in materialsMissingColorTexture" :key="'repair-' + material.index" class="model-texture-repair-item">
                  <label :for="'repair-image-' + material.index">{{ material.name || ('Material ' + material.index) }}</label>
                  <select :id="'repair-image-' + material.index" v-model="textureRepairSelections[String(material.index)]" :disabled="textureRepairBusy">
                    <option value="">Selecionar imagem…</option>
                    <option v-for="image in recoverableColorImages" :key="image.index" :value="String(image.index)">Imagem {{ image.index }} · {{ image.mimeType || 'imagem' }}</option>
                  </select>
                  <button type="button" :disabled="textureRepairBusy || !textureRepairSelections[String(material.index)]" @click="applyRecoveredColorTexture(material.index)">{{ textureRepairBusy ? 'Aplicando…' : 'Aplicar textura' }}</button>
                </div>
                <small v-if="textureRepairMessage" class="model-texture-repair-message">{{ textureRepairMessage }}</small>
              </div>
              <div class="model-diagnostic-row">
                <div class="model-diagnostic-title"><b>CLIPS</b><span>Clipes de animação originais</span></div>
                <template v-for="clip in ((model.userData.importGltfMetadata as GltfMetadata | undefined)?.animations ?? [])" :key="'clip-' + clip.index">
                  <small>{{ clip.name || ('Animação ' + clip.index) }} · {{ clip.channels }} canais</small>
                </template>
                <small v-if="!((model.userData.importGltfMetadata as GltfMetadata | undefined)?.animations?.length)">Nenhuma animação declarada no JSON glTF.</small>
              </div>
            </div>
            <div v-if="modelDiagnostics.length" class="model-diagnostics-list">
              <div v-for="item in modelDiagnostics" :key="item.id" class="model-diagnostic-row">
                <div class="model-diagnostic-title" :style="{ paddingLeft: (item.depth * 10) + 'px' }">
                  <b>{{ item.type }}</b><span>{{ item.name }}</span>
                </div>
                <small v-if="item.meshInfo">{{ item.meshInfo }}</small>
                <small v-if="item.materials">{{ item.materials }}</small>
              </div>
            </div>
          </details>
          </section>
          <p v-if="error" class="model-import-error">{{ error }}</p>
          <p class="model-import-tip">{{ isEditingSavedComponent ? 'Modo de edição: nome, controles, papéis de animação, miniatura e pacotes serão salvos no componente existente. A malha original será preservada.' : dialogProps.initialAsset ? 'Modo de pré-visualização: explore as abas, os clipes e os controles salvos. Nenhuma alteração será aplicada ao mundo.' : 'Configure o modelo, os controles e os clipes. A prévia não altera o mundo; salvar cria um componente reutilizável na biblioteca.' }}</p>
        </aside>
</template>
