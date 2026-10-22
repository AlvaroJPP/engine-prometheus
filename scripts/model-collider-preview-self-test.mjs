import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  createModelColliderPreview,
  disposeModelColliderPreview,
} from '../src/lib/assets/ModelColliderPreview.ts'

const root = new THREE.Group()
root.position.set(2, 3, 4)
const options = {
  model: root,
  size: [2, 4, 6],
  offset: [1, 2, 3],
}

const none = createModelColliderPreview({ ...options, type: 'none' })
assert.equal(none.preview, null)
assert.equal(none.notice, '')

const box = createModelColliderPreview({ ...options, type: 'box' })
assert.ok(box.preview)
assert.equal(box.preview.name, 'import-collider-preview')
assert.equal(box.preview.renderOrder, 1000)
assert.equal(box.preview.material.depthTest, false)
assert.equal(box.preview.material.opacity, 0.98)
box.preview.geometry.computeBoundingBox()
assert.deepEqual(box.preview.geometry.boundingBox.min.toArray(), [0, 0, 0])
assert.deepEqual(box.preview.geometry.boundingBox.max.toArray(), [2, 4, 6])

const sphere = createModelColliderPreview({ ...options, type: 'sphere', offset: [0, 0, 0] })
assert.ok(sphere.preview)
sphere.preview.geometry.computeBoundingBox()
assert.ok(Math.abs(sphere.preview.geometry.boundingBox.max.x - 3) < 0.01)
assert.ok(Math.abs(sphere.preview.geometry.boundingBox.min.x + 3) < 0.01)

const capsule = createModelColliderPreview({
  ...options,
  type: 'capsule',
  size: [2, 4, 2],
  offset: [0, 0, 0],
})
assert.ok(capsule.preview)
capsule.preview.geometry.computeBoundingBox()
assert.ok(capsule.preview.geometry.boundingBox.max.y > 1.9)
assert.ok(capsule.preview.geometry.boundingBox.min.y < -1.9)

const selectedPart = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshBasicMaterial(),
)
selectedPart.position.set(8, 1, -3)
root.add(selectedPart)
const selectedBox = createModelColliderPreview({
  ...options,
  type: 'box',
  offset: [0, 0, 0],
  selectedPart,
})
assert.deepEqual(selectedBox.preview.position.toArray(), [10, 4, 1], 'Preview should align to the selected part world-space center')

const staticMeshRoot = new THREE.Group()
staticMeshRoot.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()))
const meshResult = createModelColliderPreview({
  model: staticMeshRoot,
  type: 'mesh',
  size: [1, 1, 1],
  offset: [0, 0, 0],
})
assert.ok(meshResult.preview)
assert.match(meshResult.notice, /Malha pronta: 1 partes estáticas/)
assert.equal(meshResult.preview.matrixAutoUpdate, false)
assert.equal(meshResult.preview.material.opacity, 0.72)

const unsupported = createModelColliderPreview({
  model: new THREE.Group(),
  type: 'mesh',
  size: [1, 1, 1],
  offset: [0, 0, 0],
})
assert.equal(unsupported.preview, null)
assert.match(unsupported.notice, /Não foi possível preparar a malha estática/)

const scene = new THREE.Scene()
scene.add(box.preview)
let geometryDisposed = false
let materialDisposed = false
box.preview.geometry.addEventListener('dispose', () => { geometryDisposed = true })
box.preview.material.addEventListener('dispose', () => { materialDisposed = true })
disposeModelColliderPreview(scene, box.preview)
assert.equal(scene.children.includes(box.preview), false)
assert.equal(geometryDisposed, true)
assert.equal(materialDisposed, true)
disposeModelColliderPreview(scene, null)

for (const preview of [sphere.preview, capsule.preview, selectedBox.preview, meshResult.preview]) {
  disposeModelColliderPreview(undefined, preview)
}

console.log('Model collider preview self-test passed.')
