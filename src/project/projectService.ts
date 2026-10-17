import { invoke } from '@tauri-apps/api/core'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import { MAIN_SCENE_PATH, parseProject, parseScene, parseSceneObject } from '@engine'
import type { FaceTextureMap, ProjectBundle, SceneFile, SceneObjectData } from '@engine'

export type ProjectProgress = (message: string, percent: number) => void

export async function chooseFolder(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title })
  return typeof picked === 'string' ? picked : null
}

export async function projectExistsIn(dir: string): Promise<boolean> {
  return invoke<boolean>('project_exists', { dir })
}


function parseDataUrl(dataUrl: string): { mime: string; base64: string; extension: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!match) throw new Error('Uma textura do projeto tem um formato de imagem inválido.')
  const mime = match[1].toLowerCase()
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'png'
  return { mime, base64: match[2], extension }
}

function safeAssetId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'asset'
}

async function writeAsset(dir: string, rel: string, base64: string): Promise<void> {
  await invoke('write_project_asset', { dir, rel, base64 })
}

async function readAsset(dir: string, rel: string): Promise<string> {
  return invoke<string>('read_project_asset', { dir, rel })
}

export async function saveProjectTo(dir: string, bundle: ProjectBundle, onProgress?: ProjectProgress): Promise<void> {
  const totalFaces = Object.values(bundle.scenes).reduce((sum, scene) => sum + scene.objects.reduce((n, object) => n + Object.keys(object.faceTextures ?? {}).length, 0), 0)
  const totalModels = Object.values(bundle.scenes).reduce((sum, scene) => sum + scene.objects.filter(object => object.importedModelData).length + Number(!!scene.playerModel?.glbData), 0)
  const total = Math.max(1, totalFaces + totalModels + Object.keys(bundle.scenes).length * 2 + 2)
  let completed = 0
  const report = (message: string) => onProgress?.(message, Math.min(99, Math.round((completed / total) * 100)))
  const scenes: Record<string, SceneFile> = JSON.parse(JSON.stringify(bundle.scenes)) as Record<string, SceneFile>
  const retainedAssets = new Set<string>()

  // Recursos binários ficam em resources/, enquanto as cenas guardam apenas referências.
  for (const [scenePath, scene] of Object.entries(scenes)) {
    const environment = scene.environment
    if (environment?.skyTextureDataUrl && !environment.skyTextureDataUrl.startsWith('asset://')) {
      const parsedSky = parseDataUrl(environment.skyTextureDataUrl)
      const skyRel = `resources/textures/sky-${safeAssetId(scenePath.replace(/[^a-zA-Z0-9_-]/g, '_'))}.${parsedSky.extension}`
      await writeAsset(dir, skyRel, parsedSky.base64)
      environment.skyTextureDataUrl = `asset://${skyRel}`
      retainedAssets.add(skyRel)
      completed++
      report('Salvando textura do céu…')
    } else if (environment?.skyTextureDataUrl?.startsWith('asset://')) {
      retainedAssets.add(environment.skyTextureDataUrl.slice('asset://'.length))
    }
    if (scene.playerModel?.glbData?.startsWith('asset://')) {
      retainedAssets.add(scene.playerModel.glbData.slice('asset://'.length))
    } else if (scene.playerModel?.glbData) {
      const rel = `resources/models/player-${safeAssetId(scenePath.replace(/[^a-zA-Z0-9_-]/g, '_'))}.glb`
      await writeAsset(dir, rel, scene.playerModel.glbData.replace(/^data:.*?;base64,/, ''))
      scene.playerModel.glbData = `asset://${rel}`
      retainedAssets.add(rel)
      completed++
      report('Salvando modelo personalizado do jogador…')
    }
    for (const object of scene.objects as SceneObjectData[]) {
      const faceTextures = object.faceTextures as FaceTextureMap | undefined
      if (faceTextures) {
        for (const [face, texture] of Object.entries(faceTextures)) {
          if (!texture?.imageDataUrl) continue
          if (texture.imageDataUrl.startsWith('asset://')) {
            retainedAssets.add(texture.imageDataUrl.slice('asset://'.length))
            continue
          }
          const parsed = parseDataUrl(texture.imageDataUrl)
          const rel = `resources/textures/${safeAssetId(object.id)}-${face}.${parsed.extension}`
          await writeAsset(dir, rel, parsed.base64)
          texture.imageDataUrl = `asset://${rel}`
          retainedAssets.add(rel)
          completed++
          report(`Salvando textura ${face}…`)
        }
      }
      if (object.importedModelData?.startsWith('asset://')) {
        retainedAssets.add(object.importedModelData.slice('asset://'.length))
      } else if (object.importedModelData) {
        const rel = `resources/models/${safeAssetId(object.id)}.glb`
        // importedModelData é o conteúdo binário GLB codificado em Base64.
        await writeAsset(dir, rel, object.importedModelData.replace(/^data:.*?;base64,/, ''))
        object.importedModelData = `asset://${rel}`
        retainedAssets.add(rel)
        completed++
        report(`Salvando modelo 3D ${object.name}…`)
      }
    }
    completed++
    report(`Preparando cena ${scenePath}…`)
  }

  for (const [path, scene] of Object.entries(scenes)) {
    await invoke('write_project_file', { dir, rel: path, contents: JSON.stringify(scene, null, 2) })
    completed++
    report(`Gravando ${path}…`)
  }
  await invoke('write_project_file', {
    dir,
    rel: 'logic/events.json',
    contents: JSON.stringify(bundle.logic ?? { formatVersion: 1, variables: {}, events: [] }, null, 2),
  })
  completed++
  report('Gravando eventos e regras…')
  await invoke('write_project_file', { dir, rel: 'project.json', contents: JSON.stringify(bundle.project, null, 2) })
  onProgress?.('Limpando recursos que não são mais usados…', 98)
  await invoke('prune_project_assets', { dir, keep: [...retainedAssets] })
  onProgress?.('Salvamento concluído.', 100)
}

async function hydrateSceneAssets(dir: string, rawText: string, onProgress?: ProjectProgress, percent = 10): Promise<string | SceneFile> {
  // Sem arquivos referenciados externamente, evitamos parse + stringify + parse
  // da cena completa — caro em projetos com centenas de milhares de tufos de grama.
  if (!rawText.includes('asset://')) return rawText

  let scene: SceneFile
  try {
    scene = JSON.parse(rawText) as SceneFile
  } catch {
    // Deixa o validador emitir a mensagem de JSON inválido.
    return rawText
  }
  if (scene.environment?.skyTextureDataUrl?.startsWith('asset://')) {
    const rel = scene.environment.skyTextureDataUrl.slice('asset://'.length)
    onProgress?.(`Carregando textura do céu ${rel.split('/').pop()}…`, percent)
    const base64 = await readAsset(dir, rel)
    const extension = rel.split('.').pop()?.toLowerCase()
    const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : 'image/png'
    scene.environment.skyTextureDataUrl = `data:${mime};base64,${base64}`
  }
  const playerModel = scene.playerModel
  if (playerModel?.glbData?.startsWith('asset://')) {
    const rel = playerModel.glbData.slice('asset://'.length)
    onProgress?.(`Carregando modelo do jogador ${rel.split('/').pop()}…`, percent)
    playerModel.glbData = await readAsset(dir, rel)
  }
  for (const object of scene.objects ?? []) {
    const faces = object.faceTextures as FaceTextureMap | undefined
    if (faces) {
      for (const texture of Object.values(faces)) {
        if (!texture?.imageDataUrl?.startsWith('asset://')) continue
        const rel = texture.imageDataUrl.slice('asset://'.length)
        onProgress?.(`Carregando textura ${rel.split('/').pop()}…`, percent)
        const base64 = await readAsset(dir, rel)
        const extension = rel.split('.').pop()?.toLowerCase()
        const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : 'image/png'
        texture.imageDataUrl = `data:${mime};base64,${base64}`
      }
    }
    if (typeof object.importedModelData === 'string' && object.importedModelData.startsWith('asset://')) {
      const rel = object.importedModelData.slice('asset://'.length)
      onProgress?.(`Carregando modelo 3D ${object.name}…`, percent)
      object.importedModelData = await readAsset(dir, rel)
    }
  }
  // Entrega o objeto já hidratado diretamente à validação, evitando outra
  // serialização e parse completo da cena quando há referências a assets.
  return scene
}

export async function loadProjectFrom(dir: string, onProgress?: ProjectProgress): Promise<ProjectBundle> {
  onProgress?.('Lendo configurações do projeto…', 3)
  const project = parseProject(await invoke<string>('read_project_file', { dir, rel: 'project.json' }))
  const scenes: ProjectBundle['scenes'] = {}
  const totalScenes = project.scenes.length
  for (let index = 0; index < totalScenes; index++) {
    const path = project.scenes[index]
    const raw = await invoke<string>('read_project_file', { dir, rel: path })
    onProgress?.(`Carregando recursos da cena ${index + 1}/${totalScenes}…`, Math.round(5 + ((index + 1) / totalScenes) * 65))
    const hydrated = await hydrateSceneAssets(dir, raw, onProgress, Math.round(5 + ((index + 1) / totalScenes) * 65))
    scenes[path] = typeof hydrated === 'string'
      ? parseScene(hydrated, path)
      : parseSceneObject(hydrated, path)
  }
  if (!scenes[MAIN_SCENE_PATH] && Object.keys(scenes).length === 0) {
    throw new Error('Nenhuma cena foi carregada.')
  }
  let logic: ProjectBundle['logic'] = { formatVersion: 1, variables: {}, events: [] }
  const logicExists = await invoke<boolean>('project_file_exists', { dir, rel: 'logic/events.json' })
  if (logicExists) {
    onProgress?.('Carregando eventos e regras…', 85)
    const rawText = await invoke<string>('read_project_file', { dir, rel: 'logic/events.json' })
    let raw: unknown
    try {
      raw = JSON.parse(rawText)
    } catch {
      throw new Error('logic/events.json existe, mas contém JSON inválido. O arquivo não foi ignorado para evitar perder variáveis e scripts.')
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('logic/events.json precisa conter um objeto JSON.')
    }
    const candidate = raw as Partial<NonNullable<ProjectBundle['logic']>>
    if (candidate.formatVersion !== 1 || !Array.isArray(candidate.events) || !candidate.variables || typeof candidate.variables !== 'object' || Array.isArray(candidate.variables)) {
      throw new Error('logic/events.json tem estrutura inválida. O arquivo não foi ignorado para evitar perder variáveis e scripts.')
    }
    logic = candidate as NonNullable<ProjectBundle['logic']>
  }
  onProgress?.('Projeto carregado; preparando o mundo…', 95)
  return { project, scenes, logic }
}

export async function confirmDiscard(dirty: boolean): Promise<boolean> {
  if (!dirty) return true
  return confirm('Há alterações não salvas. Deseja descartá-las?', {
    title: 'Nexus Worlds',
    kind: 'warning',
  })
}

export async function confirmOverwrite(dir: string): Promise<boolean> {
  return confirm(`A pasta já contém um projeto:\n${dir}\n\nSubstituir o conteúdo?`, {
    title: 'Nexus Worlds',
    kind: 'warning',
  })
}
