import assert from 'node:assert/strict'
import * as THREE from 'three'
import { disposeImportedModelResources } from '../src/lib/assets/ModelImportResourceCleanup.ts'

const events = []
const scene = new THREE.Scene()
const root = new THREE.Group()
root.name = 'ImportedModel'
root.userData.importOwnedObjectUrl = 'blob:main'
root.userData.importOwnedObjectUrls = ['blob:zip-a', 'blob:zip-shared']

const geometry = new THREE.BoxGeometry(1, 2, 3)
const baseColorTexture = new THREE.Texture()
const material = new THREE.MeshStandardMaterial({ map: baseColorTexture })
const mesh = new THREE.Mesh(geometry, material)
mesh.userData.importOwnedObjectUrl = 'blob:child'
mesh.userData.importOwnedObjectUrls = ['blob:zip-shared', 'blob:zip-b']
root.add(mesh)

const recoveredTexture = new THREE.Texture()
root.userData.importRecoveredTextures = [recoveredTexture]
scene.add(root)

geometry.addEventListener('dispose', () => events.push('geometry'))
material.addEventListener('dispose', () => events.push('material'))
baseColorTexture.addEventListener('dispose', () => events.push('base-color-texture'))
recoveredTexture.addEventListener('dispose', () => events.push('recovered-texture'))

const releasedRoots = []
const revokedUrls = []
disposeImportedModelResources(root, {
  scene,
  releaseStaticCollider: model => {
    events.push('release-static-collider')
    releasedRoots.push(model)
  },
  revokeObjectUrl: url => {
    events.push(`revoke:${url}`)
    revokedUrls.push(url)
  },
})

assert.equal(scene.children.includes(root), false, 'The imported model should be detached from the preview scene')
assert.deepEqual(releasedRoots, [root], 'Static collider resources should be released for that model')
assert.deepEqual(revokedUrls, ['blob:main', 'blob:zip-a', 'blob:zip-shared', 'blob:child', 'blob:zip-b'])
assert.equal(new Set(revokedUrls).size, revokedUrls.length, 'Each owned URL should be revoked only once')
assert.ok(events.includes('recovered-texture'), 'Recovered textures must be disposed')
assert.ok(events.includes('geometry'), 'Renderable geometry must be disposed')
assert.ok(events.includes('material'), 'Renderable materials must be disposed')
assert.ok(events.includes('base-color-texture'), 'Textures owned by materials must be disposed')
assert.ok(events.indexOf('release-static-collider') < events.indexOf('recovered-texture'), 'Collider release should happen before texture disposal')

let urlRevocationCount = 0
disposeImportedModelResources(new THREE.Group(), {
  releaseStaticCollider: () => {},
  revokeObjectUrl: () => { urlRevocationCount += 1 },
})
assert.equal(urlRevocationCount, 0, 'Models without owned URLs should not trigger revocation')

console.log('Imported model resource cleanup self-test passed.')
