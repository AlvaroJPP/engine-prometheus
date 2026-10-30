import assert from 'node:assert/strict'
import * as THREE from 'three'
import { PhysicsWorld, DEFAULT_PHYSICS_CONFIG } from '../engine/physics/PhysicsWorld.ts'

async function testPhysicsWorld() {
  console.log('Testing PhysicsWorld...')

  // Test 1: Default config
  const world = new PhysicsWorld()
  assert.deepEqual(world.getGravity(), DEFAULT_PHYSICS_CONFIG.gravity)
  assert.equal(world.getTimeStep(), DEFAULT_PHYSICS_CONFIG.timeStep)
  console.log('  ✓ Default config')

  // Test 2: Custom config
  const customConfig = {
    gravity: new THREE.Vector3(0, -1.62, 0),
    timeStep: 1 / 120,
    maxSubSteps: 8,
  }
  const world2 = new PhysicsWorld(customConfig)
  assert.deepEqual(world2.getGravity(), customConfig.gravity)
  assert.equal(world2.getTimeStep(), customConfig.timeStep)
  console.log('  ✓ Custom config')

  // Test 3: Initialize
  await world.initialize()
  assert.equal(world.isReady(), true)
  assert.ok(world.getWorld() !== null)
  console.log('  ✓ Initialize')

  // Test 4: Step simulation
  world.step(1 / 60)
  console.log('  ✓ Step simulation')

  // Test 5: Create rigid body
  const rapier = await import('@dimforge/rapier3d-compat')
  const bodyDesc = rapier.RigidBodyDesc.dynamic().setTranslation(0, 5, 0)
  const body = world.createRigidBody(bodyDesc)
  assert.ok(body !== null)
  assert.equal(world.getActiveBodyCount(), 1)
  console.log('  ✓ Create rigid body')

  // Test 6: Create collider
  const colliderDesc = rapier.ColliderDesc.ball(1)
  const collider = world.createCollider(colliderDesc, body)
  assert.ok(collider !== null)
  assert.equal(world.getActiveColliderCount(), 1)
  console.log('  ✓ Create collider')

  // Test 7: Raycast (create a static ground to hit)
  const groundDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
  const groundBody = world.createRigidBody(groundDesc)
  const groundColliderDesc = rapier.ColliderDesc.cuboid(10, 0.5, 10)
  world.createCollider(groundColliderDesc, groundBody)

  // Step to update broadphase with new ground collider
  world.step(1 / 60)

  const rayOrigin = new THREE.Vector3(0, 10, 0)
  const rayDir = new THREE.Vector3(0, -1, 0)
  const hit = world.raycastFirst(rayOrigin, rayDir, 20)
  assert.ok(hit !== null)
  assert.ok(hit.hit)
  assert.ok(hit.distance > 0 && hit.distance < 20)
  console.log('  ✓ Raycast')

  // Test 8: Overlap sphere
  const overlaps = []
  world.overlapSphere(new THREE.Vector3(0, 5, 0), 2, (collider) => {
    overlaps.push(collider)
    return true
  })
  assert.ok(overlaps.length > 0)
  console.log('  ✓ Overlap sphere')

  // Test 9: Set gravity
  const newGravity = new THREE.Vector3(0, -20, 0)
  world.setGravity(newGravity)
  assert.deepEqual(world.getGravity(), newGravity)
  console.log('  ✓ Set gravity')

  // Test 10: Vector conversion
  const threeVec = new THREE.Vector3(1, 2, 3)
  const rapierVec = PhysicsWorld.toRapier(threeVec)
  assert.equal(rapierVec.x, 1)
  assert.equal(rapierVec.y, 2)
  assert.equal(rapierVec.z, 3)
  const backToThree = PhysicsWorld.toThree(rapierVec)
  assert.deepEqual(backToThree, threeVec)
  console.log('  ✓ Vector conversion')

  // Test 11: Quaternion conversion
  const threeQuat = new THREE.Quaternion(0, 0, 0.707, 0.707)
  const rapierRot = PhysicsWorld.toRapierRotation(threeQuat)
  const backToQuat = PhysicsWorld.toThreeQuaternion(rapierRot)
  assert.ok(Math.abs(backToQuat.x - threeQuat.x) < 0.001)
  assert.ok(Math.abs(backToQuat.y - threeQuat.y) < 0.001)
  assert.ok(Math.abs(backToQuat.z - threeQuat.z) < 0.001)
  assert.ok(Math.abs(backToQuat.w - threeQuat.w) < 0.001)
  console.log('  ✓ Quaternion conversion')

  // Test 12: Sleeping
  world.setSleeping(true)
  world.setSleeping(false)
  console.log('  ✓ Sleeping toggle')

  // Test 13: Dispose
  world.dispose()
  assert.equal(world.isReady(), false)
  assert.equal(world.getWorld(), null)
  console.log('  ✓ Dispose')

  console.log('All PhysicsWorld tests passed!')
}

testPhysicsWorld().catch((err) => {
  console.error('PhysicsWorld test failed:', err)
  process.exit(1)
})