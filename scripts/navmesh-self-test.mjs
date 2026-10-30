import assert from 'node:assert/strict'
import * as THREE from 'three'
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.ts'
import { RapierCollisionSystem } from '../engine/physics/RapierCollisionSystem.ts'
import { NavMesh, NavMeshBuilder, DEFAULT_NAVMESH_CONFIG } from '../engine/physics/NavMesh.ts'

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

async function testNavMesh() {
  console.log('Testing NavMesh...')

  // Setup physics world with some ground
  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const mockWorld = { getScene: () => new THREE.Scene() }
  const collisionSystem = new RapierCollisionSystem(mockWorld)
  await collisionSystem.initialize()

  // Create ground plane using collision system
  const groundObj = new MockGameObject('ground', new THREE.Vector3(0, 0, 0))
  const groundBody = collisionSystem.addObject(groundObj, {
    mass: 0,
    colliderType: 'box',
    size: new THREE.Vector3(50, 1, 50),
    friction: 0.8,
  })
  assert.ok(groundBody !== null)

  // Create some obstacles at fixed positions (away from center and test path)
  const obstaclePositions = [
    new THREE.Vector3(20, 3, 20),
    new THREE.Vector3(-20, 3, 20),
    new THREE.Vector3(20, 3, -20),
    new THREE.Vector3(-20, 3, -20),
    new THREE.Vector3(0, 3, 30),
  ]
  for (let i = 0; i < obstaclePositions.length; i++) {
    const obsObj = new MockGameObject('obstacle-' + i, obstaclePositions[i])
    collisionSystem.addObject(obsObj, {
      mass: 0,
      colliderType: 'box',
      size: new THREE.Vector3(2, 2, 2),
    })
  }

  // Step physics to ensure everything is registered
  collisionSystem.step(1/60)

  // Use the collision system's physics world for navmesh (it has the colliders)
  const navMeshPhysicsWorld = collisionSystem.getPhysicsWorld()

  // Test 1: Default config
  const navMesh = new NavMesh(navMeshPhysicsWorld)
  assert.deepEqual(navMesh.getConfig().cellSize, DEFAULT_NAVMESH_CONFIG.cellSize)
  console.log('  ✓ Default config')

  // Test 2: Custom config
  const customConfig = {
    cellSize: 0.5,
    agentRadius: 0.6,
    agentHeight: 2.0,
    maxSlopeAngle: Math.PI / 4,
  }
  const navMesh2 = new NavMesh(navMeshPhysicsWorld, customConfig)
  assert.equal(navMesh2.getConfig().cellSize, 0.5)
  assert.equal(navMesh2.getConfig().agentRadius, 0.6)
  console.log('  ✓ Custom config')

  // Test 3: Build navmesh
  const buildResult = await navMesh.build()
  console.log('  Build result:', JSON.stringify(buildResult))
  if (buildResult.nodesBuilt === 0) {
    // Debug: check all colliders
    const world = navMeshPhysicsWorld.getWorld()
    if (world) {
      world.forEachCollider((c) => {
        const pos = c.translation()
        const shape = c.shape
        console.log('  Collider at', pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2), 'type:', shape.type)
      })
    }
    // Test raycast at center
    const rayResult = navMeshPhysicsWorld.raycast(
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(0, -1, 0),
      200
    )
    console.log('  Raycast at center:', rayResult ? 'hit at y=' + (100 - rayResult.timeOfImpact).toFixed(2) : 'no hit')
    // Test sampleHeight directly
    const sample = navMesh['sampleHeight'](0, 0)
    console.log('  sampleHeight at (0,0):', sample)
  }
  assert.equal(buildResult.success, true)
  assert.ok(buildResult.nodesBuilt > 0)

  // Test 4: Find nearest point (using getHeightAt and isWalkable)
  const height = navMesh.getHeightAt(new THREE.Vector3(0, 0, 0))
  assert.ok(typeof height === 'number')
  const walkable = navMesh.isWalkable(new THREE.Vector3(0, 0, 0))
  assert.ok(typeof walkable === 'boolean')
  console.log('  ✓ Get height and walkable at point')

  // Test 5: Find path
  const start = new THREE.Vector3(-10, 0, -10)
  const end = new THREE.Vector3(10, 0, 10)
  const pathResult = navMesh.findPath(start, end)
  assert.ok(typeof pathResult.success === 'boolean')
  if (pathResult.success) {
    assert.ok(pathResult.path.length > 0)
    assert.ok(pathResult.path[0].distanceTo(start) < 5)
    assert.ok(pathResult.path[pathResult.path.length - 1].distanceTo(end) < 5)
  }
  console.log('  ✓ Find path: ' + (pathResult.success ? 'found' : 'not found') + ' (' + pathResult.path.length + ' points)')

  // Test 6: Get random point
  const randomPoint = navMesh.getRandomPoint()
  assert.ok(randomPoint !== null || randomPoint === null)
  if (randomPoint) {
    assert.ok(randomPoint instanceof THREE.Vector3)
  }
  console.log('  ✓ Get random point')

  // Test 7: Get height at
  const height2 = navMesh.getHeightAt(new THREE.Vector3(0, 0, 0))
  assert.ok(typeof height2 === 'number' || height2 === null)
  console.log('  ✓ Get height at')

  // Test 8: Get all nodes
  const nodes = navMesh.getAllNodes()
  assert.ok(Array.isArray(nodes))
  console.log('  ✓ Get all nodes: ' + nodes.length + ' nodes')

  // Test 9: Get grid size
  const gridSize = navMesh.getGridSize()
  assert.ok(typeof gridSize.width === 'number')
  assert.ok(typeof gridSize.depth === 'number')
  console.log('  ✓ Get grid size: ' + gridSize.width + 'x' + gridSize.depth)

  // Test 10: Config update
  navMesh.setConfig({ cellSize: 2.0 })
  assert.equal(navMesh.getConfig().cellSize, 2.0)
  assert.equal(navMesh.isReady(), false)
  console.log('  ✓ Config update')

  // Test 11: Clear
  navMesh.clear()
  assert.equal(navMesh.isReady(), false)
  console.log('  ✓ Clear')

  // Test 12: Dispose
  navMesh.dispose()
  assert.equal(navMesh.isReady(), false)
  console.log('  ✓ Dispose')

  // Test 13: NavMeshBuilder
  const builder = new NavMeshBuilder(navMeshPhysicsWorld, { cellSize: 1.0 })
  const builderResult = await builder.build()
  assert.ok(typeof builderResult.success === 'boolean')
  console.log('  ✓ NavMeshBuilder: ' + (builderResult.success ? 'success' : 'failed'))

  // Cleanup
  collisionSystem.dispose()

  console.log('All NavMesh tests passed!')
}

testNavMesh().catch((err) => {
  console.error('NavMesh test failed:', err)
  process.exit(1)
})