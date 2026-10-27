import assert from 'node:assert/strict'
import * as THREE from 'three'
import { World } from '../engine/world/World.ts'

// Exercise the real World.update method without constructing the full renderer.
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
const object = { id: 'rotation-test', mesh }
const emitted = []
const runtime = {
  objects: new Map([[object.id, object]]),
  dirtyRenderDistanceObjectIds: new Set(),
  terrain: { grass: { invalidateOcclusion() {} } },
  events: { emit: (type, payload) => emitted.push({ type, payload }) },
}

World.prototype.update.call(runtime, object.id, {
  rotationX: 1e308,
  rotationY: -1e308,
  rotationZ: Number.MAX_VALUE,
})

for (const axis of ['x', 'y', 'z']) {
  assert.ok(Number.isFinite(mesh.rotation[axis]), `rotation ${axis} must remain finite`)
  assert.ok(Math.abs(mesh.rotation[axis]) <= Math.PI, `rotation ${axis} must be normalized`)
}
assert.ok(emitted.some(event => event.type === 'objectChanged'), 'valid update should emit objectChanged')

console.log('World transform safety self-test passed.')
