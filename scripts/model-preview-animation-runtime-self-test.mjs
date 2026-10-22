import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  ModelPreviewAnimationRuntime,
  previewAnimationRoleForClip,
} from '../src/lib/animation/ModelPreviewAnimationRuntime.ts'

class FakePreviewController {
  constructor(mixer, actions) {
    this.disposed = false
    this.states = []
    this.updates = []
    this.mixer = mixer
    this.actions = actions
  }

  hasRole(role) {
    return this.actions.has(role)
  }

  setState(role, force = false) {
    this.states.push({ role, force })
    return this.actions.has(role)
  }

  stop() {}

  update(deltaSeconds) {
    this.updates.push(deltaSeconds)
    return true
  }

  dispose() {
    this.disposed = true
    this.mixer.stopAllAction()
  }
}

const runtime = new ModelPreviewAnimationRuntime(FakePreviewController)
const root = new THREE.Group()
const idle = new THREE.AnimationClip('Idle', 1, [])
const walk = new THREE.AnimationClip('Walk', 1, [])
const run = new THREE.AnimationClip('Run', 1, [])

assert.equal(previewAnimationRoleForClip(idle), `preview:${idle.uuid}`)

const firstController = runtime.ensure(root, [idle])
assert.equal(firstController.actions.size, 1)
assert.ok(firstController.hasRole(previewAnimationRoleForClip(idle)))
firstController.setState(previewAnimationRoleForClip(idle))
assert.deepEqual(firstController.states, [{ role: previewAnimationRoleForClip(idle), force: false }])

const afterAddingClip = runtime.ensure(root, [idle, walk])
assert.equal(afterAddingClip, firstController, 'New clips should use the existing controller')
assert.equal(afterAddingClip.actions.size, 2, 'New clips should be registered in the current mixer')
assert.equal(runtime.ensure(root, [idle, walk]), firstController, 'Repeated setup should not recreate the controller')

const otherRoot = new THREE.Group()
const replacement = runtime.ensure(otherRoot, [run])
assert.notEqual(replacement, firstController, 'Switching model roots should create a fresh controller')
assert.equal(firstController.disposed, true, 'Switching roots should dispose the old controller')
assert.equal(replacement.actions.size, 1)
assert.ok(replacement.hasRole(previewAnimationRoleForClip(run)))

runtime.clear()
assert.equal(runtime.controller, null, 'Clearing should release the current controller')
assert.equal(replacement.disposed, true, 'Clearing should dispose the current controller')

const recreated = runtime.ensure(root, [idle])
assert.notEqual(recreated, firstController, 'The runtime should be reusable after clear')
assert.equal(recreated.actions.size, 1)

runtime.clear()
console.log('Model preview animation runtime self-test passed.')
