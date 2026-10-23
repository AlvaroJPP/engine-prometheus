export type AutonomousRetargetReportInput = {
  sourceNodeCount: number
  mappedNodeCount: number
  destinationBoneCount: number
  mappedDestinationBoneCount: number
  directMappedCount: number
  collapsedSourceCount: number
  generatedRig: boolean
  transferReport: string
}

export type AutonomousRetargetReport = {
  coverage: number
  destinationUse: number
  message: string
  previewStatus: string
}

/** Builds the user-facing quality report for an autonomous retargeting run. */
export function buildAutonomousRetargetReport(
  input: AutonomousRetargetReportInput,
): AutonomousRetargetReport {
  const {
    sourceNodeCount,
    mappedNodeCount,
    destinationBoneCount,
    mappedDestinationBoneCount,
    directMappedCount,
    collapsedSourceCount,
    generatedRig,
    transferReport,
  } = input

  const coverage = Math.round((mappedNodeCount / Math.max(1, sourceNodeCount)) * 100)
  const destinationUse = Math.round(
    (mappedDestinationBoneCount / Math.max(1, destinationBoneCount)) * 100,
  )
  const destinationIsCapacityLimited = destinationBoneCount < sourceNodeCount &&
    mappedDestinationBoneCount >= Math.floor(destinationBoneCount * 0.9)
  const qualityLead = coverage < 60 && !destinationIsCapacityLimited
    ? 'Retargeting concluído com cobertura baixa; revise as associações antes de usar. '
    : coverage < 80 && !destinationIsCapacityLimited
      ? 'Retargeting concluído; a cobertura é parcial e precisa de revisão. '
      : 'Fluxo autônomo concluído. '
  const capacityNote = destinationIsCapacityLimited
    ? 'O modelo A tem ' + destinationBoneCount + ' ossos para ' + sourceNodeCount + ' ossos animados na origem; ' + destinationUse + '% dos ossos do destino estão em uso. '
    : 'Foram utilizados ' + destinationUse + '% dos ossos disponíveis no destino. '
  const collapseNote = collapsedSourceCount
    ? collapsedSourceCount + ' junta(s) da origem foram recolhidas em ossos existentes; as rotações compatíveis foram combinadas. '
    : ''
  const message = qualityLead
    + (generatedRig ? 'A IA local gerou o rig e os pesos do modelo A; ' : 'O rig existente do modelo A foi mantido; ')
    + mappedNodeCount + '/' + sourceNodeCount + ' ossos da origem associados (' + coverage + '%: '
    + directMappedCount + ' associação(ões) direta(s) e ' + collapsedSourceCount + ' recolhida(s)). '
    + capacityNote + collapseNote + transferReport
    + ' Confira a prévia antes de confirmar a importação.'

  return {
    coverage,
    destinationUse,
    message,
    previewStatus: 'Retargeting concluído · ' + mappedNodeCount + '/' + sourceNodeCount
      + ' nós da origem associados (' + coverage + '%). Confira a deformação do modelo A.',
  }
}
