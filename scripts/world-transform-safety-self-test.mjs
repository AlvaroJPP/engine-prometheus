import assert from 'node:assert/strict'
import * as THREE from 'three'
import { World } from '../engine/world/World.ts'

// Exercise the real World.update method without constructing the full renderer.
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
const object = { id: 'transform-test', mesh }
const emitted = []
const runtime = {
  objects: new Map([[object.id, object]]),
  dirtyRenderDistanceObjectIds: new Set(),
  terrain: { grass: { invalidateOcclusion() {} } },
  events: { emit: (type, payload) => emitted.push({ type, payload }) },
}

World.prototype.update.call(runtime, object.id, {
  x: 1e308,
  y: -1e308,
  z: Number.MAX_VALUE,
  rotationX: 1e308,
  rotationY: -1e308,
  rotationZ: Number.MAX_VALUE,
  scale: 1e308,
})

assert.equal(mesh.position.x, 50, 'finite extreme x must be clamped')
assert.equal(mesh.position.y, -50, 'finite extreme y must be clamped')
assert.equal(mesh.position.z, 50, 'finite extreme z must be clamped')
assert.deepEqual(mesh.scale.toArray(), [20, 20, 20], 'primitive scale must respect its maximum')

World.prototype.update.call(runtime, object.id, {
  x: Number.POSITIVE_INFINITY,
  y: Number.NaN,
  z: Number.NEGATIVE_INFINITY,
  rotationX: Number.NaN,
  rotationY: Number.POSITIVE_INFINITY,
  rotationZ: Number.NEGATIVE_INFINITY,
  scale: Number.NaN,
  scaleX: Number.POSITIVE_INFINITY,
  scaleY: Number.NaN,
  scaleZ: Number.NEGATIVE_INFINITY,
})

assert.deepEqual(mesh.position.toArray(), [50, -50, 50], 'non-finite positions must be ignored')
assert.deepEqual(mesh.scale.toArray(), [20, 20, 20], 'non-finite scales must be ignored')

for (const axis of ['x', 'y', 'z']) {
  assert.ok(Number.isFinite(mesh.rotation[axis]), `rotation ${axis} must remain finite`)
  assert.ok(Math.abs(mesh.rotation[axis]) <= Math.PI, `rotation ${axis} must be normalized`)
}
assert.ok(emitted.some(event => event.type === 'objectChanged'), 'valid update should emit objectChanged')

mesh.userData.importedModel = true
World.prototype.update.call(runtime, object.id, { scale: 1e308 })
assert.deepEqual(mesh.scale.toArray(), [10000, 10000, 10000], 'imported model scale must respect its maximum')

mesh.userData.locked = true
const lockedPosition = mesh.position.toArray()
const lockedRotation = mesh.rotation.toArray()
const lockedScale = mesh.scale.toArray()
World.prototype.update.call(runtime, object.id, {
  x: 12,
  y: 13,
  z: 14,
  rotationX: 90,
  rotationY: 90,
  rotationZ: 90,
  scale: 2,
})
assert.deepEqual(mesh.position.toArray(), lockedPosition, 'locked object position must not change')
assert.deepEqual(mesh.rotation.toArray(), lockedRotation, 'locked object rotation must not change')
assert.deepEqual(mesh.scale.toArray(), lockedScale, 'locked object scale must not change')

console.log('World transform safety self-test passed.')
