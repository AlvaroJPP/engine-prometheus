import * as THREE from 'three'

/**
 * Identifica cenários largos e multipartes que podem iniciar com colisor de malha.
 * Modelos animados permanecem com colisor padrão para evitar mudanças inesperadas.
 */
export function shouldDefaultToStaticCityCollider(
  root: THREE.Object3D,
  dimensions: readonly [number, number, number],
): boolean {
  let meshCount = 0
  let triangleCount = 0
  let hasAnimatedGeometry = false

  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const position = node.geometry.getAttribute('position')
    if (!position || position.count < 3) return

    meshCount += 1
    if (node instanceof THREE.SkinnedMesh || (node.geometry.morphAttributes.position?.length ?? 0) > 0) {
      hasAnimatedGeometry = true
    }

    const index = node.geometry.getIndex()
    triangleCount += Math.floor((index ? index.count : position.count) / 3)
  })

  // Evita mudar automaticamente o colisor de personagens, veículos ou arquivos
  // com clipes de animação. A malha estática continua selecionável manualmente.
  const clips = root.userData.importAnimations
  const hasAnimationClips = Array.isArray(clips) && clips.length > 0
  if (hasAnimatedGeometry || hasAnimationClips || meshCount === 0) return false

  // A biblioteca salva modelos já normalizados pela altura final. Para que
  // cidades importadas anteriormente também sejam reconhecidas, use proporção e
  // detalhe além da extensão absoluta, que pode ter diminuído após a normalização.
  const [width, height, depth] = dimensions
  const footprint = Math.max(width, depth)
  const aspectRatio = footprint / Math.max(height, 0.1)
  const detailedScene = triangleCount >= 800 || meshCount >= 12
  const wideLandscape = footprint >= 18 && detailedScene
  const manyIndependentParts = meshCount >= 36 && footprint >= 8
  const scaleNormalizedCity = footprint >= 8 && aspectRatio >= 3 && triangleCount >= 800
  return wideLandscape || manyIndependentParts || scaleNormalizedCity
}
