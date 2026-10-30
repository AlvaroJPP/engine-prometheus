import assert from 'node:assert/strict'
import * as THREE from 'three'
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.ts'
import { RapierCollisionSystem } from '../engine/physics/RapierCollisionSystem.ts'
import { PhysicsDebug, SimplePhysicsDebugDrawer, DEFAULT_DEBUG_CONFIG } from '../engine/physics/PhysicsDebug.ts'

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

async function testPhysicsDebug() {
  console.log('Testing PhysicsDebug...')

  // Setup physics world
  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const mockWorld = { getScene: () => new THREE.Scene() }
  const collisionSystem = new RapierCollisionSystem(mockWorld)
  await collisionSystem.initialize()

  // Create some test objects
  const groundObj = new MockGameObject('ground', new THREE.Vector3(0, 0, 0))
  const ground = collisionSystem.addObject(groundObj, {
    type: 'fixed',
    position: new THREE.Vector3(0, 0, 0),
  }, {
    shape: 'cuboid',
    shapeParams: { halfExtents: new THREE.Vector3(10, 1, 10) },
    friction: 0.8,
  })

  const dynamicObj = new MockGameObject('dynamic-1', new THREE.Vector3(0, 5, 0))
  const dynamicBody = collisionSystem.addObject(dynamicObj, {
    type: 'dynamic',
    position: new THREE.Vector3(0, 5, 0),
    mass: 1.0,
  }, {
    shape: 'ball',
    shapeParams: { radius: 1.0 },
  })

  const capsuleObj = new MockGameObject('capsule-1', new THREE.Vector3(5, 5, 0))
  const capsuleBody = collisionSystem.addObject(capsuleObj, {
    type: 'dynamic',
    position: new THREE.Vector3(5, 5, 0),
    mass: 1.0,
  }, {
    shape: 'capsule',
    shapeParams: { radius: 0.5, halfHeight: 1.0 },
  })

  // Step physics to let objects settle
  for (let i = 0; i < 30; i++) {
    collisionSystem.step(1/60)
  }

  // Create a mock scene
  const scene = new THREE.Scene()

  // Test 1: Default config
  const debug = new PhysicsDebug(physicsWorld, collisionSystem, null)
  assert.deepEqual(debug.getConfig().showWireframes, DEFAULT_DEBUG_CONFIG.showWireframes)
  assert.deepEqual(debug.getConfig().dynamicColor, DEFAULT_DEBUG_CONFIG.dynamicColor)
  console.log('  ✓ Default config')

  // Test 2: Custom config
  const customConfig = {
    showWireframes: false,
    showColliders: true,
    showContacts: true,
    dynamicColor: new THREE.Color(0xff0000),
    lineWidth: 2,
  }
  const debug2 = new PhysicsDebug(physicsWorld, collisionSystem, null, customConfig)
  assert.equal(debug2.getConfig().showWireframes, false)
  assert.equal(debug2.getConfig().showColliders, true)
  assert.equal(debug2.getConfig().dynamicColor.getHex(), 0xff0000)
  assert.equal(debug2.getConfig().lineWidth, 2)
  console.log('  ✓ Custom config')

  // Test 3: Attach to scene
  debug.attachToScene(scene)
  assert.ok(scene.children.some(c => c.name === 'PhysicsDebug_Wireframes'))
  assert.ok(scene.children.some(c => c.name === 'PhysicsDebug_Contacts'))
  assert.ok(scene.children.some(c => c.name === 'PhysicsDebug_AABBs'))
  assert.ok(scene.children.some(c => c.name === 'PhysicsDebug_Velocities'))
  assert.ok(scene.children.some(c => c.name === 'PhysicsDebug_CenterOfMass'))
  console.log('  ✓ Attach to scene')

  // Test 4: Update debug
  debug.update()
  console.log('  ✓ Update debug')

  // Test 5: Toggle features
  debug.setFeature('showWireframes', false)
  assert.equal(debug.isFeatureEnabled('showWireframes'), false)
  debug.setFeature('showWireframes', true)
  assert.equal(debug.isFeatureEnabled('showWireframes'), true)
  console.log('  ✓ Toggle features')

  // Test 6: Update config
  debug.setConfig({ lineWidth: 3, pointSize: 8 })
  assert.equal(debug.getConfig().lineWidth, 3)
  assert.equal(debug.getConfig().pointSize, 8)
  console.log('  ✓ Update config')

  // Test 7: Set navmesh path
  const testPath = {
    path: [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(5, 0, 0),
      new THREE.Vector3(5, 0, 5),
    ],
  }
  debug.setNavMeshPath(testPath)
  debug.update()
  console.log('  ✓ Set navmesh path')

  // Test 8: Clear navmesh path
  debug.setNavMeshPath(null)
  debug.update()
  console.log('  ✓ Clear navmesh path')

  // Test 9: Detach from scene
  debug.detachFromScene()
  assert.ok(!scene.children.some(c => c.name === 'PhysicsDebug_Wireframes'))
  console.log('  ✓ Detach from scene')

  // Test 10: Re-attach and update
  debug.attachToScene(scene)
  debug.update()
  debug.detachFromScene()
  console.log('  ✓ Re-attach and update')

  // Test 11: Dispose
  debug.dispose()
  console.log('  ✓ Dispose')

  // Test 12: SimplePhysicsDebugDrawer (use collision system's physics world which has colliders)
  const simpleDrawer = new SimplePhysicsDebugDrawer(collisionSystem.getPhysicsWorld(), scene)
  simpleDrawer.drawColliders(0x00ff00)
  assert.ok(scene.children.length > 0)
  console.log('  ✓ SimplePhysicsDebugDrawer drawColliders')

  simpleDrawer.drawContacts(0xff0000, 10)
  console.log('  ✓ SimplePhysicsDebugDrawer drawContacts')

  simpleDrawer.clear()
  assert.equal(scene.children.length, 0)
  console.log('  ✓ SimplePhysicsDebugDrawer clear')

  simpleDrawer.dispose()
  console.log('  ✓ SimplePhysicsDebugDrawer dispose')

  // Test 13: Default debug config constant
  assert.ok(DEFAULT_DEBUG_CONFIG !== undefined)
  assert.equal(DEFAULT_DEBUG_CONFIG.showWireframes, true)
  assert.equal(DEFAULT_DEBUG_CONFIG.dynamicColor.getHex(), 0x00ff00)
  console.log('  ✓ Default debug config constant')

  // Cleanup
  collisionSystem.dispose()
  physicsWorld.dispose()

  console.log('All PhysicsDebug tests passed!')
}

testPhysicsDebug().catch((err) => {
  console.error('PhysicsDebug test failed:', err)
  process.exit(1)
})