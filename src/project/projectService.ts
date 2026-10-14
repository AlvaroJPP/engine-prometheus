import { invoke } from '@tauri-apps/api/core'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import { MAIN_SCENE_PATH, parseProject, parseScene } from '@engine'
import type { ProjectBundle } from '@engine'

export async function chooseFolder(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title })
  return typeof picked === 'string' ? picked : null
}

export async function projectExistsIn(dir: string): Promise<boolean> {
  return invoke<boolean>('project_exists', { dir })
}

export async function saveProjectTo(dir: string, bundle: ProjectBundle): Promise<void> {
  // As cenas vão primeiro; o project.json por último, para nunca apontar para cena que não foi gravada.
  for (const [path, scene] of Object.entries(bundle.scenes)) {
    await invoke('write_project_file', { dir, rel: path, contents: JSON.stringify(scene, null, 2) })
  }
  await invoke('write_project_file', {
    dir,
    rel: 'logic/events.json',
    contents: JSON.stringify(bundle.logic ?? { formatVersion: 1, variables: {}, events: [] }, null, 2),
  })
  await invoke('write_project_file', {
    dir,
    rel: 'project.json',
    contents: JSON.stringify(bundle.project, null, 2),
  })
}

export async function loadProjectFrom(dir: string): Promise<ProjectBundle> {
  const project = parseProject(await invoke<string>('read_project_file', { dir, rel: 'project.json' }))
  const scenes: ProjectBundle['scenes'] = {}
  for (const path of project.scenes) {
    scenes[path] = parseScene(await invoke<string>('read_project_file', { dir, rel: path }), path)
  }
  if (!scenes[MAIN_SCENE_PATH] && Object.keys(scenes).length === 0) {
    throw new Error('Nenhuma cena foi carregada.')
  }
  let logic: ProjectBundle['logic'] = { formatVersion: 1, variables: {}, events: [] }
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Compatibilidade: apenas ausência do arquivo indica projeto antigo. Erros de leitura reais devem ser exibidos.
    const missing = /logic\/events\.json.*(not found|cannot find|não foi possível ler logic\/events\.json:.*(não foi possível localizar|não foi possível encontrar|o sistema não pode encontrar|arquivo não encontrado|no such file|cannot find the file))/i.test(message)
    if (!missing) throw error
  }
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
