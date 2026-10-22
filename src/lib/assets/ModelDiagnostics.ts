import * as THREE from 'three'

export type ModelDiagnostic = {
  id: string
  name: string
  type: string
  depth: number
  meshInfo: string
  materials: string
}

export type ModelDiagnosticSummary = {
  nodes: number
  meshes: number
  skinned: number
  materials: number
  textures: number
  clips: number
}

export type ModelDiagnosticsResult = {
  rows: ModelDiagnostic[]
  summary: ModelDiagnosticSummary
}

/**
 * Analisa hierarquia, geometria, materiais, texturas e pesos de skinning
 * sem depender do estado reativo do diálogo de importação.
 *
 * Malhas com mais de 50 mil vértices são amostradas para que a inspeção
 * técnica não bloqueie a interface em assets grandes.
 */
export function analyzeModelDiagnostics(root: THREE.Object3D): ModelDiagnosticsResult {
  const rows: ModelDiagnostic[] = []
  const materialIds = new Set<string>()
  const textureIds = new Set<string>()
  let meshes = 0
  let skinned = 0

  root.traverse((node) => {
    const depth = (() => {
      let value = 0
      let parent = node.parent
      while (parent && parent !== root) { value += 1; parent = parent.parent }
      return value
    })()
    const isMesh = node instanceof THREE.Mesh
    const mesh = isMesh ? node as THREE.Mesh : null
    let meshInfo = ''
    let materialsText = ''

    if (mesh) {
      meshes += 1
      if (mesh instanceof THREE.SkinnedMesh) skinned += 1
      const geometry = mesh.geometry
      const position = geometry.getAttribute('position')
      meshInfo = `vértices: ${position?.count ?? 0}; grupos: ${geometry.groups.length}`

      if (mesh instanceof THREE.SkinnedMesh) {
        const skinIndex = geometry.getAttribute('skinIndex')
        const skinWeight = geometry.getAttribute('skinWeight')
        const bones = mesh.skeleton?.bones ?? []
        if (!skinIndex || !skinWeight || !position) {
          meshInfo += `; SKINNING INVÁLIDO: skinIndex=${skinIndex ? 'ok' : 'ausente'}, skinWeight=${skinWeight ? 'ok' : 'ausente'}, vértices=${position?.count ?? 0}`
        } else {
          // Inspeciona as influências reais por malha, sem percorrer todos os
          // vértices de modelos excessivamente grandes.
          const vertexCount = position.count
          const step = Math.max(1, Math.ceil(vertexCount / 50000))
          const lowerBody = /hip|pelvis|waist|femur|thigh|leg|tibia|calf|shin|knee|foot|toe|ankle/i
          const lowerInfluenceCounts = new Map<string, number>()
          let sampledVertices = 0
          let zeroWeightVertices = 0
          let invalidJointIndices = 0
          let unnormalizedWeightVertices = 0
          const read = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, component: number) =>
            component === 0 ? attribute.getX(vertex)
              : component === 1 ? attribute.getY(vertex)
                : component === 2 ? attribute.getZ(vertex)
                  : attribute.getW(vertex)

          for (let vertex = 0; vertex < vertexCount; vertex += step) {
            sampledVertices += 1
            let weightSum = 0
            for (let influence = 0; influence < Math.min(4, skinIndex.itemSize, skinWeight.itemSize); influence += 1) {
              const jointIndex = Math.round(read(skinIndex, vertex, influence))
              const weight = read(skinWeight, vertex, influence)
              if (!Number.isFinite(weight) || weight <= 1e-5) continue
              weightSum += weight
              const joint = bones[jointIndex]
              if (!joint) {
                invalidJointIndices += 1
                continue
              }
              if (lowerBody.test(joint.name)) {
                lowerInfluenceCounts.set(joint.name, (lowerInfluenceCounts.get(joint.name) ?? 0) + 1)
              }
            }
            if (weightSum <= 1e-5) zeroWeightVertices += 1
            else if (Math.abs(weightSum - 1) > 0.08) unnormalizedWeightVertices += 1
          }

          const lowerSummary = [...lowerInfluenceCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([name, count]) => `${name}:${Math.round(count * 100 / Math.max(1, sampledVertices))}%`)
            .join(', ') || 'NENHUMA INFLUÊNCIA ENCONTRADA'
          meshInfo += `; skinning: ${bones.length} ossos, skinIndex=${skinIndex.itemSize} canais, skinWeight=${skinWeight.itemSize} canais; amostra=${sampledVertices}/${vertexCount} vértices; sem peso=${zeroWeightVertices}; índices inválidos=${invalidJointIndices}; pesos não normalizados=${unnormalizedWeightVertices}; influência inferior: ${lowerSummary}`
          if (step > 1) meshInfo += ` (amostragem 1:${step})`
        }
      }

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materialsText = materials.map((material) => {
        materialIds.add(material.uuid)
        const maps = ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']
          .filter((key) => {
            const texture = (material as unknown as Record<string, unknown>)[key]
            if (texture instanceof THREE.Texture) textureIds.add(texture.uuid)
            return texture instanceof THREE.Texture
          })
        const mapInfo = maps.length ? `texturas: ${maps.join(', ')}` : 'sem mapas de textura reconhecidos'
        const color = 'color' in material && (material as THREE.Material & { color?: THREE.Color }).color
        return `${material.name || 'material sem nome'} [${material.type}; ${mapInfo}; cor: ${color ? '#' + color.getHexString() : 'n/a'}]`
      }).join(' | ')
    }

    rows.push({
      id: node.uuid,
      name: node.name || '(sem nome)',
      type: node.type,
      depth,
      meshInfo,
      materials: materialsText,
    })
  })

  const clips = (root.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
  return {
    rows,
    summary: {
      nodes: rows.length,
      meshes,
      skinned,
      materials: materialIds.size,
      textures: textureIds.size,
      clips: clips.length,
    },
  }
}
