import assert from 'node:assert/strict'
import * as THREE from 'three'
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.ts'
import { RapierCollisionSystem, DEFAULT_PHYSICS_OBJECT_CONFIG } from '../engine/physics/RapierCollisionSystem.ts'

// Mock GameObject for testing
class MockGameObject {
  constructor(id, position = new THREE.Vector3()) {
    this.id = id
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial()
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.position.copy(position)
  }
}

async function testRapierCollisionSystem() {
  console.log('Testing RapierCollisionSystem...')

  // Setup physics world
  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  // Create a mock world object (RapierCollisionSystem expects a World with getScene)
  const mockWorld = {
    getScene: () => new THREE.Scene(),
  }

  const collisionSystem = new RapierCollisionSystem(mockWorld)
  await collisionSystem.initialize()

  // Test 1: Add dynamic object
  const dynamicObj = new MockGameObject('dynamic-1', new THREE.Vector3(0, 5, 0))
  const dynamicResult = collisionSystem.addObject(dynamicObj, {
    mass: 1.0,
    colliderType: 'box',
    size: new THREE.Vector3(0.5, 0.5, 0.5),
    ccdEnabled: true,
  })
  assert.ok(dynamicResult !== null)
  assert.ok(dynamicResult.body !== null)
  assert.ok(dynamicResult.collider !== null)
  assert.equal(dynamicResult.config.mass, 1.0)
  console.log('  ✓ Add dynamic object with box collider')

  // Test 2: Add static object (ground)
  const staticObj = new MockGameObject('ground', new THREE.Vector3(0, 0, 0))
  const staticResult = collisionSystem.addObject(staticObj, {
    mass: 0,
    colliderType: 'box',
    size: new THREE.Vector3(10, 1, 10),
  })
  assert.ok(staticResult !== null)
  assert.equal(staticResult.config.mass, 0)
  console.log('  ✓ Add static object with box collider')

  // Test 3: Add capsule collider
  const capsuleObj = new MockGameObject('capsule-1', new THREE.Vector3(5, 5, 0))
  const capsuleResult = collisionSystem.addObject(capsuleObj, {
    mass: 2.0,
    colliderType: 'capsule',
    size: new THREE.Vector3(0.5, 1.0, 0.5),
  })
  assert.ok(capsuleResult !== null)
  assert.equal(capsuleResult.config.colliderType, 'capsule')
  console.log('  ✓ Add capsule collider')

  // Test 4: Add cylinder collider
  const cylinderObj = new MockGameObject('cylinder-1', new THREE.Vector3(-5, 5, 0))
  const cylinderResult = collisionSystem.addObject(cylinderObj, {
    mass: 1.5,
    colliderType: 'cylinder',
    size: new THREE.Vector3(0.8, 1.5, 0.8),
  })
  assert.ok(cylinderResult !== null)
  assert.equal(cylinderResult.config.colliderType, 'cylinder')
  console.log('  ✓ Add cylinder collider')

  // Test 5: Get object counts
  const dynamicCount = collisionSystem.getDynamicBodyCount()
  const staticCount = collisionSystem.getStaticBodyCount()
  assert.ok(dynamicCount >= 3)
  assert.ok(staticCount >= 1)
  console.log('  ✓ Body counts: ' + dynamicCount + ' dynamic, ' + staticCount + ' static')

  // Test 6: Step simulation
  collisionSystem.step(1/60)
  console.log('  ✓ Step simulation')

  // Test 7: Raycast - ray from above should hit dynamic object first, then ground
  const rayHit = collisionSystem.raycast(
    new THREE.Vector3(0, 10, 0),
    new THREE.Vector3(0, -1, 0),
    20
  )
  assert.ok(rayHit !== null)
  // Could hit dynamic object at y=5 or ground at y=0
  assert.ok(['dynamic-1', 'ground'].includes(rayHit.objectId))
  console.log('  ✓ Raycast hits object: ' + rayHit.objectId)

  // Test 8: Apply impulse
  collisionSystem.applyImpulse('dynamic-1', new THREE.Vector3(0, 10, 0))
  console.log('  ✓ Apply impulse')

  // Test 9: Apply force
  collisionSystem.applyForce('dynamic-1', new THREE.Vector3(5, 0, 0))
  console.log('  ✓ Apply force')

  // Test 10: Get/set velocity
  collisionSystem.setVelocity('dynamic-1', new THREE.Vector3(1, 0, 0))
  const vel = collisionSystem.getVelocity('dynamic-1')
  assert.ok(vel !== null)
  assert.ok(Math.abs(vel.linear.x - 1) < 0.1)
  console.log('  ✓ Get/set velocity')

  // Test 11: Sync from physics
  collisionSystem.syncFromPhysics()
  console.log('  ✓ Sync from physics')

  // Test 12: Collision events callback
  let collisionEventReceived = false
  collisionSystem.onCollision('test-callback', (event) => {
    collisionEventReceived = true
    assert.ok(event.type === 'start' || event.type === 'end')
    assert.ok(event.objectA && event.objectB)
  })
  collisionSystem.step(1/60)
  collisionSystem.offCollision('test-callback')
  console.log('  ✓ Collision event callback')

  // Test 13: Sensor collider
  const sensorObj = new MockGameObject('sensor-1', new THREE.Vector3(0, 5, 10))
  const sensorResult = collisionSystem.addObject(sensorObj, {
    mass: 0,
    colliderType: 'ball',
    size: new THREE.Vector3(2, 2, 2),
    isSensor: true,
  })
  assert.ok(sensorResult !== null)
  assert.equal(sensorResult.config.isSensor, true)
  console.log('  ✓ Sensor collider')

  // Test 14: Remove object
  collisionSystem.removeObject('sensor-1')
  assert.ok(!collisionSystem.hasObject('sensor-1'))
  console.log('  ✓ Remove object')

  // Test 15: Default config
  assert.ok(DEFAULT_PHYSICS_OBJECT_CONFIG !== undefined)
  assert.equal(DEFAULT_PHYSICS_OBJECT_CONFIG.mass, 1)
  assert.equal(DEFAULT_PHYSICS_OBJECT_CONFIG.friction, 0.6)
  console.log('  ✓ Default physics object config')

  // Test 16: Get objects
  const objects = collisionSystem.getObjects()
  assert.ok(objects.size >= 4)
  console.log('  ✓ Get objects map')

  // Test 17: Get object by ID
  const obj = collisionSystem.getObject('dynamic-1')
  assert.ok(obj !== undefined)
  assert.equal(obj.id, 'dynamic-1')
  console.log('  ✓ Get object by ID')

  // Test 18: Has object
  assert.ok(collisionSystem.hasObject('dynamic-1'))
  assert.ok(!collisionSystem.hasObject('non-existent'))
  console.log('  ✓ Has object')

  // Test 19: Set gravity
  collisionSystem.setGravity(new THREE.Vector3(0, -5, 0))
  console.log('  ✓ Set gravity')

  // Cleanup
  collisionSystem.dispose()
  physicsWorld.dispose()

  console.log('All RapierCollisionSystem tests passed!')
}

testRapierCollisionSystem().catch((err) => {
  console.error('RapierCollisionSystem test failed:', err)
  process.exit(1)
})