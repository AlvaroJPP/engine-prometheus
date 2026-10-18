#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import * as THREE from 'three'
import { rankTargetBoneCandidates, suggestTargetBoneMappings } from '../src/lib/animation/AnimationRetargeting.ts'

const TRANSFORM_PATHS = new Set(['translation', 'rotation', 'scale'])

function printUsage() {
  console.log(`Engine Prometheus — diagnóstico de similaridade entre rigs

Uso:
  node --experimental-strip-types scripts/analyze-rig-similarity.mjs <origem.glb|gltf> <destino.glb|gltf> [opções]

Opções:
  --clip <índice>         Clipe de origem a analisar (padrão: 0; índice começa em zero)
  --all-source-bones      Analisa todos os ossos da origem, não só os usados no clipe
  --report <arquivo.md>   Salva também um relatório Markdown
  --self-test             Executa um teste rápido com rigs sintéticos
  --help                  Mostra esta ajuda

Exemplo:
  npm run rig:similarity -- ./modelos/animacao.glb ./modelos/personagem.glb --clip 0 --report ./relatorio-rig.md

O script trabalha offline. Para arquivos .gltf, lê a hierarquia do JSON principal;
recursos externos (texturas e buffers) não precisam ser carregados para a análise óssea.
`)
}

async function readGltfJson(filePath) {
  const data = await readFile(resolve(filePath))
  if (filePath.toLowerCase().endsWith('.gltf')) {
    return JSON.parse(data.toString('utf8'))
  }
  if (!filePath.toLowerCase().endsWith('.glb')) {
    throw new Error(`Formato não reconhecido: ${filePath}. Use .glb ou .gltf.`)
  }
  if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error(`O arquivo ${filePath} não possui um cabeçalho GLB válido.`)
  }
  const version = data.readUInt32LE(4)
  if (version !== 2) throw new Error(`GLB versão ${version} não suportado; esperado GLB 2.0.`)
  const declaredLength = data.readUInt32LE(8)
  if (declaredLength > data.length) {
    throw new Error(`O GLB ${filePath} está incompleto: tamanho declarado maior que o arquivo.`)
  }

  let offset = 12
  while (offset + 8 <= Math.min(declaredLength, data.length)) {
    const chunkLength = data.readUInt32LE(offset)
    const chunkType = data.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkEnd > data.length) throw new Error(`Chunk inválido no GLB ${filePath}.`)
    // JSON chunk type: ASCII "JSON" interpreted as little-endian uint32.
    if (chunkType === 0x4E4F534A) {
      return JSON.parse(data.toString('utf8', chunkStart, chunkEnd).replace(/\0+$/g, ''))
    }
    offset = chunkEnd
  }
  throw new Error(`O GLB ${filePath} não contém um chunk JSON.`)
}

function animationTargetIndices(json) {
  const result = new Set()
  for (const animation of json.animations ?? []) {
    for (const channel of animation.channels ?? []) {
      const target = channel.target
      if (Number.isInteger(target?.node) && TRANSFORM_PATHS.has(target.path)) result.add(target.node)
    }
  }
  return result
}

function jointIndicesFor(json) {
  const skins = json.skins ?? []
  if (skins.length) {
    // A skin mais completa é a melhor referência para um único esqueleto.
    const selected = [...skins].sort((a, b) => (b.joints?.length ?? 0) - (a.joints?.length ?? 0))[0]
    return new Set((selected?.joints ?? []).filter(Number.isInteger))
  }
  // Modelos sem skin, mas com animação transform, ainda permitem diagnóstico.
  return animationTargetIndices(json)
}

function createObjectTree(json, label, boneIndices) {
  const specs = json.nodes ?? []
  if (!specs.length) throw new Error(`${label}: o arquivo não contém nodes.`)
  const objects = specs.map((spec, index) => {
    const object = boneIndices.has(index) ? new THREE.Bone() : new THREE.Group()
    object.name = typeof spec.name === 'string' && spec.name.trim() ? spec.name : `Node_${index}`
    object.userData.gltfNodeIndex = index
    if (Array.isArray(spec.matrix) && spec.matrix.length === 16) {
      new THREE.Matrix4().fromArray(spec.matrix).decompose(object.position, object.quaternion, object.scale)
    } else {
      if (Array.isArray(spec.translation)) object.position.fromArray(spec.translation)
      if (Array.isArray(spec.rotation) && spec.rotation.length === 4) {
        object.quaternion.fromArray(spec.rotation).normalize()
      }
      if (Array.isArray(spec.scale)) object.scale.fromArray(spec.scale)
    }
    object.updateMatrix()
    return object
  })

  const hasParent = new Set()
  specs.forEach((spec, parentIndex) => {
    for (const childIndex of spec.children ?? []) {
      if (!Number.isInteger(childIndex) || !objects[childIndex]) continue
      objects[parentIndex].add(objects[childIndex])
      hasParent.add(childIndex)
    }
  })

  const root = new THREE.Group()
  root.name = label
  const activeScene = json.scenes?.[json.scene ?? 0]
  const sceneRoots = Array.isArray(activeScene?.nodes) ? activeScene.nodes : []
  const preferredRoots = sceneRoots.length
    ? [...new Set([...sceneRoots, ...specs.map((_, index) => index).filter(index => !hasParent.has(index))])]
    : specs.map((_, index) => index).filter(index => !hasParent.has(index))

  for (const index of preferredRoots) {
    if (Number.isInteger(index) && objects[index] && !objects[index].parent) root.add(objects[index])
  }
  root.updateWorldMatrix(true, true)

  const bones = [...boneIndices]
    .map(index => objects[index])
    .filter(object => object instanceof THREE.Bone)
  const allBones = objects.filter(object => object instanceof THREE.Bone)
  const nameToIndices = new Map()
  objects.forEach((object, index) => {
    if (!nameToIndices.has(object.name)) nameToIndices.set(object.name, [])
    nameToIndices.get(object.name).push(index)
  })
  const duplicateNames = [...nameToIndices.entries()].filter(([, indices]) => indices.length > 1)

  return { root, objects, bones, allBones, nameToIndices, duplicateNames }
}

function clipSourceNames(json, hierarchy, clipIndex, allSourceBones) {
  if (allSourceBones) {
    return hierarchy.bones.map(bone => bone.name)
  }
  const animations = json.animations ?? []
  const clip = animations[clipIndex]
  if (!clip) {
    if (!animations.length) return hierarchy.bones.map(bone => bone.name)
    throw new Error(`Índice de clipe ${clipIndex} inválido; o arquivo tem ${animations.length} clipe(s), de 0 a ${animations.length - 1}.`)
  }
  const indices = [...new Set((clip.channels ?? [])
    .filter(channel => TRANSFORM_PATHS.has(channel.target?.path) && Number.isInteger(channel.target?.node))
    .map(channel => channel.target.node))]
  const names = indices
    .map(index => hierarchy.objects[index]?.name)
    .filter(name => typeof name === 'string')
  return [...new Set(names)]
}

function skeletonEnvelope(root, bones) {
  if (!bones.length) return null
  root.updateWorldMatrix(true, true)
  const inverseRoot = root.matrixWorld.clone().invert()
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (const bone of bones) {
    const position = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot)
    min.min(position)
    max.max(position)
  }
  const size = max.sub(min)
  const largest = Math.max(size.x, size.y, size.z, 1e-6)
  return {
    x: size.x / largest,
    y: size.y / largest,
    z: size.z / largest,
    largestExtent: largest,
    joints: bones.length,
  }
}

function confidenceLabel(mappedName, candidates) {
  const picked = candidates.find(candidate => candidate.targetName === mappedName)
  if (!mappedName || !picked) return candidates[0]?.score >= 48 ? 'Ambígua / revisar' : 'Sem candidato forte'
  const margin = picked.score - (candidates[1]?.score ?? 0)
  if (picked.exactName || (picked.score >= 95 && margin >= 18)) return 'Alta'
  if (picked.score >= 72 && margin >= 10) return 'Média'
  return 'Baixa / revisar'
}

function createReport(sourcePath, targetPath, sourceJson, targetJson, sourceTree, targetTree, sourceNames, mapping, ranking, clipIndex) {
  const sourceLabel = basename(sourcePath)
  const targetLabel = basename(targetPath)
  const sourceEnvelope = skeletonEnvelope(sourceTree.root, sourceTree.bones)
  const targetEnvelope = skeletonEnvelope(targetTree.root, targetTree.bones)
  let envelopeSimilarity = null
  if (sourceEnvelope && targetEnvelope) {
    const distance = (
      Math.abs(sourceEnvelope.x - targetEnvelope.x) +
      Math.abs(sourceEnvelope.y - targetEnvelope.y) +
      Math.abs(sourceEnvelope.z - targetEnvelope.z)
    ) / 3
    envelopeSimilarity = Math.round(Math.max(0, 1 - distance) * 100)
  }

  const mappedCount = Object.keys(mapping).length
  const rows = sourceNames.map(sourceName => {
    const candidates = ranking[sourceName] ?? []
    const mappedName = mapping[sourceName] ?? ''
    const picked = candidates.find(candidate => candidate.targetName === mappedName)
    const top = candidates.slice(0, 3)
    const alternatives = top.length
      ? top.map(candidate => `${candidate.targetName} (${candidate.score.toFixed(1)}${candidate.exactName ? ', nome exato' : ''})`).join('<br>')
      : '—'
    return `| ${escapeCell(sourceName)} | ${escapeCell(mappedName || '—')} | ${picked ? picked.score.toFixed(1) : (top[0]?.score.toFixed(1) ?? '—')} | ${confidenceLabel(mappedName, candidates)} | ${alternatives} |`
  }).join('\n')

  const lines = [
    '# Relatório de similaridade de rigs — Engine Prometheus',
    '',
    `- **Origem:** ${sourceLabel}`,
    `- **Destino:** ${targetLabel}`,
    `- **Clipe analisado:** ${(sourceJson.animations ?? []).length ? `${clipIndex} — ${sourceJson.animations?.[clipIndex]?.name || 'sem nome'}` : 'nenhum clipe; análise dos ossos disponíveis'}`,
    `- **Ossos na origem:** ${sourceTree.bones.length}`,
    `- **Ossos no destino:** ${targetTree.bones.length}`,
    `- **Canais de origem analisados:** ${sourceNames.length}`,
    `- **Mapeados sem colisão de destino:** ${mappedCount}/${sourceNames.length} (${sourceNames.length ? Math.round(mappedCount / sourceNames.length * 100) : 0}%)`,
    `- **Similaridade aproximada do envelope ósseo:** ${envelopeSimilarity === null ? 'não disponível' : `${envelopeSimilarity}/100`}`,
    '',
    '> As pontuações são comparativas, não probabilidades. A semelhança do envelope considera as proporções X/Y/Z dos pontos de articulação, não mede a semelhança visual da malha. Confira visualmente as correspondências antes de usar a animação no jogo.',
    '',
    '## Proporção da estrutura óssea',
    '',
    '| Medida | Origem | Destino |',
    '|---|---:|---:|',
    `| Largura X normalizada | ${sourceEnvelope ? sourceEnvelope.x.toFixed(3) : '—'} | ${targetEnvelope ? targetEnvelope.x.toFixed(3) : '—'} |`,
    `| Altura Y normalizada | ${sourceEnvelope ? sourceEnvelope.y.toFixed(3) : '—'} | ${targetEnvelope ? targetEnvelope.y.toFixed(3) : '—'} |`,
    `| Profundidade Z normalizada | ${sourceEnvelope ? sourceEnvelope.z.toFixed(3) : '—'} | ${targetEnvelope ? targetEnvelope.z.toFixed(3) : '—'} |`,
    '',
    '## Correspondências e alternativas',
    '',
    '| Osso da origem | Sugestão automática | Score escolhido/topo | Confiança heurística | Top 3 alternativas |',
    '|---|---|---:|---|---|',
    rows || '| — | — | — | — | Nenhum canal ósseo encontrado no clipe selecionado. |',
    '',
    '## Avisos de qualidade',
    '',
    ...[
      sourceTree.duplicateNames.length
        ? `- A origem tem nomes repetidos: ${sourceTree.duplicateNames.map(([name]) => name).slice(0, 12).join(', ')}. Canais com nomes duplicados podem ser difíceis de distinguir automaticamente.`
        : '- Não foram detectados nomes de nó duplicados na origem.',
      targetTree.duplicateNames.length
        ? `- O destino tem nomes repetidos: ${targetTree.duplicateNames.map(([name]) => name).slice(0, 12).join(', ')}. O retargeting por nome pode precisar de renomeação.`
        : '- Não foram detectados nomes de nó duplicados no destino.',
      sourceTree.bones.length === 0 ? '- A origem não declarou ossos em uma skin glTF. A análise pode não representar um rig completo.' : '',
      targetTree.bones.length === 0 ? '- O destino não declarou ossos em uma skin glTF nem canais de animação que possam ser usados como referência.' : '',
      mappedCount < sourceNames.length
        ? `- ${sourceNames.length - mappedCount} canal(is) ficaram sem correspondência automática segura; revise as alternativas ou mapeie manualmente.`
        : '- Todos os canais analisados receberam uma sugestão automática sem duplicar ossos de destino.',
    ].filter(Boolean),
    '',
  ]
  return lines.join('\n')
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function makeTestRig(label, definition) {
  const root = new THREE.Group()
  root.name = label
  const bones = new Map()
  for (const spec of definition) {
    const bone = new THREE.Bone()
    bone.name = spec.name
    bone.position.set(...spec.position)
    bones.set(spec.name, bone)
  }
  for (const spec of definition) {
    const bone = bones.get(spec.name)
    if (spec.parent) bones.get(spec.parent).add(bone)
    else root.add(bone)
  }
  root.updateWorldMatrix(true, true)
  return { root, bones: [...bones.values()] }
}

function runSelfTest() {
  const source = makeTestRig('source', [
    { name: 'mixamorig:Hips', position: [0, 1, 0] },
    { name: 'mixamorig:LeftArm', position: [-0.25, 0.5, 0], parent: 'mixamorig:Hips' },
    { name: 'mixamorig:RightArm', position: [0.25, 0.5, 0], parent: 'mixamorig:Hips' },
  ])
  const target = makeTestRig('target', [
    { name: 'pelvis', position: [0, 0.8, 0] },
    { name: 'upperarm_l', position: [-0.2, 0.45, 0], parent: 'pelvis' },
    { name: 'upperarm_r', position: [0.2, 0.45, 0], parent: 'pelvis' },
  ])
  const names = ['mixamorig:Hips', 'mixamorig:LeftArm', 'mixamorig:RightArm']
  const mapping = suggestTargetBoneMappings(names, target.bones, source.root, target.root)
  const expected = {
    'mixamorig:Hips': 'pelvis',
    'mixamorig:LeftArm': 'upperarm_l',
    'mixamorig:RightArm': 'upperarm_r',
  }
  for (const [sourceName, targetName] of Object.entries(expected)) {
    if (mapping[sourceName] !== targetName) {
      throw new Error(`Self-test falhou: ${sourceName} esperava ${targetName}, recebeu ${mapping[sourceName] ?? 'sem mapeamento'}.`)
    }
  }
  const ranking = rankTargetBoneCandidates(names, target.bones, source.root, target.root)
  if (!ranking['mixamorig:LeftArm']?.length) throw new Error('Self-test falhou: nenhuma pontuação gerada para o braço esquerdo.')

  // Rigs exportados com nomes opacos precisam ser mapeados pela hierarquia e geometria,
  // não apenas por aliases humanos (Bone.001 -> Joint_A, por exemplo).
  const genericSource = makeTestRig('generic-source', [
    { name: 'Bone_00', position: [0, 0, 0] },
    { name: 'Bone_01', position: [0, 0.9, 0], parent: 'Bone_00' },
    { name: 'Bone_02', position: [0, 1.0, 0], parent: 'Bone_01' },
  ])
  const genericTarget = makeTestRig('generic-target', [
    { name: 'joint_A', position: [0, 0, 0] },
    { name: 'segment_B', position: [0, 0.85, 0], parent: 'joint_A' },
    { name: 'node_C', position: [0, 1.1, 0], parent: 'segment_B' },
  ])
  const genericMap = suggestTargetBoneMappings(
    ['Bone_00', 'Bone_01', 'Bone_02'],
    genericTarget.bones,
    genericSource.root,
    genericTarget.root,
  )
  const genericExpected = { Bone_00: 'joint_A', Bone_01: 'segment_B', Bone_02: 'node_C' }
  for (const [sourceName, targetName] of Object.entries(genericExpected)) {
    if (genericMap[sourceName] !== targetName) {
      throw new Error(`Self-test estrutural falhou: ${sourceName} esperava ${targetName}, recebeu ${genericMap[sourceName] ?? 'sem mapeamento'}.`)
    }
  }
  console.log('OK: mapeamento semântico, espacial e estrutural de rigs passou.')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.length === 0) {
    printUsage()
    if (args.length === 0) process.exitCode = 2
    return
  }
  if (args.includes('--self-test')) {
    runSelfTest()
    return
  }

  const positional = []
  let clipIndex = 0
  let allSourceBones = false
  let reportPath = ''
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--clip') {
      const raw = args[++index]
      clipIndex = Number(raw)
      if (!Number.isInteger(clipIndex) || clipIndex < 0) throw new Error('--clip precisa ser um índice inteiro maior ou igual a zero.')
    } else if (arg === '--all-source-bones') {
      allSourceBones = true
    } else if (arg === '--report') {
      reportPath = args[++index] ?? ''
      if (!reportPath) throw new Error('--report precisa de um caminho para salvar o arquivo Markdown.')
    } else if (arg.startsWith('--')) {
      throw new Error(`Opção desconhecida: ${arg}. Use --help.`)
    } else {
      positional.push(arg)
    }
  }

  if (positional.length !== 2) throw new Error('Informe exatamente o arquivo de origem e o arquivo de destino. Use --help para ver um exemplo.')
  const [sourcePath, targetPath] = positional
  const sourceJson = await readGltfJson(sourcePath)
  const targetJson = await readGltfJson(targetPath)
  const sourceJointIndices = jointIndicesFor(sourceJson)
  const targetJointIndices = jointIndicesFor(targetJson)
  if (sourceJointIndices.size === 0) {
    throw new Error('Não foram encontrados ossos de origem. Confira se o GLB possui skin/joints ou animações transform.')
  }
  if (targetJointIndices.size === 0) {
    throw new Error('Não foram encontrados ossos de destino. O modelo de destino precisa ter skin/joints ou animações que identifiquem o rig.')
  }

  const sourceTree = createObjectTree(sourceJson, 'SourceRig', sourceJointIndices)
  const targetTree = createObjectTree(targetJson, 'TargetRig', targetJointIndices)
  const sourceNames = clipSourceNames(sourceJson, sourceTree, clipIndex, allSourceBones)
  if (sourceNames.length === 0) {
    throw new Error('O clipe escolhido não contém canais de posição/rotação/escala e não foi possível encontrar ossos de origem.')
  }

  const ranking = rankTargetBoneCandidates(sourceNames, targetTree.bones, sourceTree.root, targetTree.root)
  const mapping = suggestTargetBoneMappings(sourceNames, targetTree.bones, sourceTree.root, targetTree.root)
  const report = createReport(sourcePath, targetPath, sourceJson, targetJson, sourceTree, targetTree, sourceNames, mapping, ranking, clipIndex)
  console.log(report)
  if (reportPath) {
    await writeFile(resolve(reportPath), report + '\n', 'utf8')
    console.log(`\nRelatório salvo em: ${resolve(reportPath)}`)
  }
}

main().catch(error => {
  console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
