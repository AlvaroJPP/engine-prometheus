import assert from 'node:assert/strict'
import { moveSceneFolder, removeSceneFolder } from '../editor/hierarchy/SceneHierarchyModel'
import { parseSceneObject } from '../engine/project/validate'

const folders = [
  { id: 'scenario', name: 'Cenário', parentId: null },
  { id: 'forest', name: 'Floresta', parentId: 'scenario' },
  { id: 'trees', name: 'Árvores', parentId: 'forest' },
  { id: 'npcs', name: 'NPCs', parentId: null },
]
assert.equal(moveSceneFolder(folders, 'scenario', 'trees'), null)
assert.equal(moveSceneFolder(folders, 'forest', 'forest'), null)
const moved = moveSceneFolder(folders, 'forest', 'npcs')
assert.equal(moved?.find(folder => folder.id === 'forest')?.parentId, 'npcs')
assert.equal(folders.find(folder => folder.id === 'forest')?.parentId, 'scenario')

const deleted = removeSceneFolder(folders, 'forest')
assert.equal(deleted?.some(folder => folder.id === 'forest'), false)
assert.equal(deleted?.find(folder => folder.id === 'trees')?.parentId, 'scenario')

const scene = parseSceneObject({
  formatVersion: 2,
  id: 'scene-main',
  name: 'Mundo principal',
  folders,
  objects: [
    { id: 'tree-1', name: 'Árvore', type: 'cube', position: [0, 0, 0], folderId: 'trees' },
    { id: 'root-object', name: 'Objeto raiz', type: 'cube', position: [2, 0, 0] },
  ],
})
assert.deepEqual(scene.folders, folders)
assert.equal(scene.objects[0]?.folderId, 'trees')
assert.equal(scene.objects[1]?.folderId, null)

assert.throws(() => parseSceneObject({
  formatVersion: 2,
  id: 'invalid-parent',
  objects: [],
  folders: [{ id: 'child', name: 'Filha', parentId: 'missing' }],
}), /pasta pai inexistente/)

assert.throws(() => parseSceneObject({
  formatVersion: 2,
  id: 'cycle',
  objects: [],
  folders: [
    { id: 'a', name: 'A', parentId: 'b' },
    { id: 'b', name: 'B', parentId: 'a' },
  ],
}), /ciclo detectado/)

assert.throws(() => parseSceneObject({
  formatVersion: 2,
  id: 'invalid-object-folder',
  objects: [{ id: 'cube', type: 'cube', position: [0, 0, 0], folderId: 'missing' }],
  folders: [],
}), /pasta inexistente/)

console.log('scene-hierarchy-self-test: PASS')
