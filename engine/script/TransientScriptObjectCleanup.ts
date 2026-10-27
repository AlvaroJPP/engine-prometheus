export interface ScriptSpawnedObject {
  id: string
  mesh: { userData: Record<string, unknown> }
}

export interface ScriptSpawnedWorld {
  list(): ScriptSpawnedObject[]
  remove(id: string): void
}

/** Removes objects created by runtime Visual Scripts when the game returns to Edit. */
export function removeTransientScriptObjects(world: ScriptSpawnedWorld): string[] {
  const ids = world.list()
    .filter(object => object.mesh.userData.scriptSpawned === true)
    .map(object => object.id)

  for (const id of ids) world.remove(id)
  return ids
}
