import assert from 'node:assert/strict'
import * as THREE from 'three'
import { applyRecoveredBaseColorTexture } from '../src/lib/assets/ModelColorTextureRepair.ts'

function addMesh(root, name, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  mesh.name = name
  root.add(mesh)
  return mesh
}

const root = new THREE.Group()
const originalTexture = new THREE.Texture()
const previouslyRecoveredTexture = new THREE.Texture()
const newTexture = new THREE.Texture()

const missingMap = new THREE.MeshStandardMaterial()
missingMap.name = 'Paint'
const originalMap = new THREE.MeshStandardMaterial({ map: originalTexture })
originalMap.name = 'Paint'
const toolMap = new THREE.MeshStandardMaterial({ map: previouslyRecoveredTexture })
toolMap.name = 'Paint'
const unrelated = new THREE.MeshStandardMaterial()
unrelated.name = 'Metal'

const missingMesh = addMesh(root, 'MissingMap', missingMap)
const originalMesh = addMesh(root, 'OriginalMap', originalMap)
const recoveredMesh = addMesh(root, 'RecoveredMap', toolMap)
addMesh(root, 'UnrelatedMaterial', unrelated)

root.userData.importRecoveredTextures = [previouslyRecoveredTexture]
root.userData.importRecoveredColorTextures = { '1': 3 }

applyRecoveredBaseColorTexture(root, 'Paint', 1, 4, newTexture)

assert.equal(missingMap.map, newTexture, 'A material with no base-color map should receive the recovered texture')
assert.equal(originalMap.map, originalTexture, 'A valid source texture must never be overwritten')
assert.equal(toolMap.map, newTexture, 'A texture previously installed by the repair tool may be replaced')
assert.equal(unrelated.map, null, 'Materials with different names must not be modified')
assert.equal(missingMesh.material, missingMap)
assert.equal(originalMesh.material, originalMap)
assert.equal(recoveredMesh.material, toolMap)
assert.deepEqual(root.userData.importRecoveredColorTextures, { '1': 4 })
assert.equal(root.userData.importNeedsReexport, true)
assert.deepEqual(root.userData.importRecoveredTextures, [previouslyRecoveredTexture, newTexture])

let disposed = false
const unusedTexture = new THREE.Texture()
unusedTexture.addEventListener('dispose', () => { disposed = true })
assert.throws(
  () => applyRecoveredBaseColorTexture(root, 'Missing', 7, 2, unusedTexture),
  /Não encontrei malhas usando o material "Missing" sem mapa de cor/,
)
assert.equal(disposed, true, 'A new texture should be released if no matching material could use it')
assert.deepEqual(root.userData.importRecoveredColorTextures, { '1': 4 }, 'Failed repair must not update saved metadata')

console.log('Model color texture repair self-test passed.')
