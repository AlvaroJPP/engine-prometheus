import assert from 'node:assert/strict'
import { removeTransientScriptObjects } from '../engine/script/TransientScriptObjectCleanup.ts'

const removed = []
const objects = [
  { id: 'runtime-drop', mesh: { userData: { scriptSpawned: true } } },
  { id: 'runtime-cache', mesh: { userData: { scriptSpawned: true } } },
  { id: 'authored-object', mesh: { userData: { scriptSpawned: false } } },
  { id: 'legacy-object', mesh: { userData: {} } },
]
const world = {
  list: () => [...objects],
  remove: id => {
    removed.push(id)
    const index = objects.findIndex(object => object.id === id)
    if (index >= 0) objects.splice(index, 1)
  },
}

assert.deepEqual(removeTransientScriptObjects(world), ['runtime-drop', 'runtime-cache'])
assert.deepEqual(removed, ['runtime-drop', 'runtime-cache'])
assert.deepEqual(objects.map(object => object.id), ['authored-object', 'legacy-object'])
assert.deepEqual(removeTransientScriptObjects(world), [])
console.log('Transient script object cleanup self-test passed.')
