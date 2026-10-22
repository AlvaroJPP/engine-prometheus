import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  getRetargetRestPose,
  restoreRetargetRestPose,
  storeRetargetRestPose,
} from '../src/lib/animation/RetargetRestPose.ts'

const root = new THREE.Group()
root.name = 'ModelRoot'
const hip = new THREE.Bone()
hip.name = 'Hips'
hip.position.set(0, 1, 0)
const leg = new THREE.Bone()
leg.name = 'LeftLeg'
leg.position.set(0.25, -0.5, 0)
hip.add(leg)
root.add(hip)

assert.equal(getRetargetRestPose(root), undefined)
assert.equal(restoreRetargetRestPose(root), false, 'Restoring a model without a saved pose should be a no-op')

const savedPose = storeRetargetRestPose(root)
assert.equal(getRetargetRestPose(root), savedPose)
assert.deepEqual(savedPose.Hips.position, [0, 1, 0])
assert.deepEqual(savedPose.LeftLeg.position, [0.25, -0.5, 0])

hip.position.set(4, 5, 6)
hip.rotation.set(0.1, 0.2, 0.3)
hip.scale.set(2, 2, 2)
leg.position.set(3, 2, 1)
root.updateMatrixWorld(true)

assert.equal(restoreRetargetRestPose(root), true)
assert.deepEqual(hip.position.toArray(), [0, 1, 0])
assert.deepEqual(hip.scale.toArray(), [1, 1, 1])
assert.deepEqual(leg.position.toArray(), [0.25, -0.5, 0])
assert.ok(Math.abs(hip.rotation.x) < 1e-7)
assert.ok(Math.abs(hip.rotation.y) < 1e-7)
assert.ok(Math.abs(hip.rotation.z) < 1e-7)

const anotherRoot = new THREE.Group()
assert.equal(getRetargetRestPose(anotherRoot), undefined, 'Each model must have an independent WeakMap entry')
assert.equal(restoreRetargetRestPose(anotherRoot), false)

console.log('Retarget rest pose self-test passed.')
