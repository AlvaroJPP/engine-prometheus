import type { SceneFolderData } from '@engine'

export function moveSceneFolder(
  folders: readonly SceneFolderData[],
  folderId: string,
  parentId: string | null,
): SceneFolderData[] | null {
  const current = folders.find(folder => folder.id === folderId)
  if (!current) return null
  if (parentId === folderId) return null
  if (parentId !== null && !folders.some(folder => folder.id === parentId)) return null

  const children = new Map<string, string[]>()
  for (const folder of folders) {
    if (folder.parentId === null) continue
    const list = children.get(folder.parentId) ?? []
    list.push(folder.id)
    children.set(folder.parentId, list)
  }
  const pending = [...(children.get(folderId) ?? [])]
  const descendants = new Set<string>()
  while (pending.length) {
    const next = pending.pop()!
    if (descendants.has(next)) continue
    descendants.add(next)
    pending.push(...(children.get(next) ?? []))
  }
  if (parentId !== null && descendants.has(parentId)) return null
  if (current.parentId === parentId) return [...folders]
  return folders.map(folder => folder.id === folderId ? { ...folder, parentId } : { ...folder })
}

export function removeSceneFolder(
  folders: readonly SceneFolderData[],
  folderId: string,
): SceneFolderData[] | null {
  const target = folders.find(folder => folder.id === folderId)
  if (!target) return null
  return folders
    .filter(folder => folder.id !== folderId)
    .map(folder => folder.parentId === folderId ? { ...folder, parentId: target.parentId } : { ...folder })
}
