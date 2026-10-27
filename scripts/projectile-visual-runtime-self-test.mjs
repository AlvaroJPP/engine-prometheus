import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ProjectileVisualRuntime } from '../engine/world/ProjectileVisualRuntime.ts'

const scene = new THREE.Scene()
let invalidations = 0
const runtime = new ProjectileVisualRuntime(scene, () => { invalidations += 1 })

runtime.spawn(
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(10, 1, 0),
  0x8c7cff,
  1,
  { coreRadius: 0.1, haloRadius: 0.2, trailOpacity: 0.5 },
)
assert.equal(runtime.activeCount, 1)
assert.equal(scene.children.filter(child => child instanceof THREE.Group).length, 1)
const trail = scene.children.find(child => child instanceof THREE.Line)
assert.ok(trail, 'the generic projectile includes a trajectory trail')

runtime.update(0.5)
const projectile = scene.children.find(child => child instanceof THREE.Group)
assert.ok(projectile)
assert.ok(Math.abs(projectile.position.x - 5) < 1e-9, 'projectile position interpolates along the trajectory')
const positions = trail.geometry.getAttribute('position')
assert.ok(Math.abs(positions.getX(1) - 5) < 1e-9, 'the trail advances to the projectile')
assert.ok(Math.abs(trail.material.opacity - 0.45) < 1e-9, 'the configured trail opacity is preserved')

runtime.update(0.6)
assert.equal(runtime.activeCount, 0)
assert.equal(scene.children.length, 0, 'completed projectiles release visual resources')
runtime.spawn(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0xffffff, 3)
runtime.clear()
assert.equal(runtime.activeCount, 0)
assert.equal(scene.children.length, 0, 'clear removes in-flight projectiles')
assert.equal(invalidations, 2, 'spawning notifies the renderer that the scene changed')

console.log('Generic projectile visual runtime self-test passed.')
