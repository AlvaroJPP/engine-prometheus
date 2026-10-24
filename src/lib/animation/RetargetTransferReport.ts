import type { RetargetAnimationResult } from './AnimationRetargeting'

/** Formata o resultado da transferência de animação para a mensagem do importador. */
export function formatRetargetAnimationTransferMessage(result: RetargetAnimationResult): string {
  const skippedDetails = [
    result.unmappedTracks.length ? `${result.unmappedTracks.length} sem correspondência de osso/pose de repouso (inclui nós auxiliares da origem)` : '',
    result.unsupportedTracks.length ? `${result.unsupportedTracks.length} de tipo não suportado (por exemplo, morph targets)` : '',
    result.conflictingTracks.length ? `${result.conflictingTracks.length} em conflito com outra trilha do mesmo osso` : '',
    result.invalidTracks.length ? `${result.invalidTracks.length} com dados inválidos` : '',
    result.collapsedTracks.length ? `${result.collapsedTracks.length} posições/escalas de juntas recolhidas foram ignoradas (as rotações foram combinadas)` : '',
    result.unsafeScaleTracks.length ? `${result.unsafeScaleTracks.length} canais de escala inseguros foram ignorados para preservar a geometria do modelo A` : '',
    result.unsafePositionTracks.length ? `${result.unsafePositionTracks.length} canais de posição incompatíveis foram ignorados para não deslocar/colapsar os membros` : '',
  ].filter(Boolean).join('; ')

  const mergedSummary = result.mergedTracks
    ? `; ${result.mergedTracks} rotação(ões) de juntas ausentes combinada(s)`
    : ''
  const rootMotionSummary = result.rootMotionTracks
    ? '; movimento global do corpo preservado no objeto raiz'
    : '; nenhum canal de deslocamento global detectado (a origem pode usar outro nó ou uma animação in-place)'

  return `"${result.clip.name}" aplicada: ${result.mappedTracks} trilha(s) de origem aproveitada(s) em ${result.outputTracks} trilha(s) de destino${mergedSummary}${rootMotionSummary}${result.skippedTracks.length ? `; ${result.skippedTracks.length} não transferida(s) (${skippedDetails || 'motivo não classificado'})` : ''}. O clipe será salvo junto do modelo quando confirmar a importação.`
}
