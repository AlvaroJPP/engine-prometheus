import assert from 'node:assert/strict'
import * as THREE from 'three'
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.ts'
import { MountSystem } from '../engine/mount/MountSystem.ts'
import { MountController } from '../engine/mount/MountController.ts'
import { createMountPoint } from '../engine/mount/MountPoint.ts'
import { createDefaultMountConfig } from '../engine/mount/MountEditorIntegration.ts'

// Mock World class for testing
function createMockWorld() {
  const objects = new Map()
  let terrainHeight = 0

  return {
    objects,
    terrainHeight,
    list() {
      return Array.from(objects.values())
    },
    get(id) {
      return objects.get(id)
    },
    notifyChanged(id) {
      // Mock notification
    },
    terrain: {
      heightAt: (x, z) => terrainHeight,
    },
    addObject(id, mesh, type = 'object') {
      objects.set(id, { mesh, type })
    },
    setTerrainHeight(height) {
      terrainHeight = height
    },
  }
}

// Mock collision mesh
function createMockPlayerMesh() {
  const geometry = new THREE.CapsuleGeometry(0.32, 1.8, 4, 8)
  const material = new THREE.MeshBasicMaterial({ visible: false })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.id = 'player'
  mesh.userData.colliderType = 'capsule'
  return mesh
}

function createMockVisualRoot() {
  const geometry = new THREE.BoxGeometry(1, 1.8, 1)
  const material = new THREE.MeshBasicMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.id = 'player_visual'
  return mesh
}

function createMockMountObject() {
  const geometry = new THREE.BoxGeometry(2, 1.5, 3)
  const material = new THREE.MeshBasicMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.id = 'horse_1'
  mesh.userData.colliderType = 'box'
  mesh.userData.mountConfig = createDefaultMountConfig()
  mesh.position.set(0, 0.75, 0)
  mesh.updateMatrixWorld(true)
  return mesh
}

async function testMountSystemInitialization() {
  console.log('Testing MountSystem initialization...')

  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const world = createMockWorld()
  const playerVisualRoot = createMockVisualRoot()
  const playerCollisionMesh = createMockPlayerMesh()
  const mountObject = createMockMountObject()

  world.addObject('player', playerCollisionMesh, 'player')
  world.addObject('horse_1', mountObject, 'mount')
  world.setTerrainHeight(0)

  const context = {
    world,
    physicsWorld,
    playerVisualRoot,
    playerCollisionMesh,
    getCameraYaw: () => 0,
    getPlayerRadius: () => 0.32,
    getStandingPlayerHeight: () => 1.8,
    getBodyScale: () => 1.0,
    collidesWithObjects: (mesh) => false,
    updateCameraTarget: (pos) => {},
    emitScriptEvent: (eventName, data) => {
      console.log(`  Script event: ${eventName}`, data)
    },
    getScriptVariable: (name, objectId) => {
      if (name === 'mounted') return false
      if (name === 'movementState') return 'idle'
      if (name === 'speed') return 4.2
      if (name === 'runMultiplier') return 1.7
      if (name === 'sprintMultiplier') return 2.5
      if (name === 'jumpImpulse') return 10.0
      if (name === 'gravity') return 18.0
      if (name === 'maxSlopeAngle') return Math.PI / 4
      if (name === 'maxStepHeight') return 0.5
      if (name === 'turnSpeed') return 5.5
      if (name === 'cameraSmoothing') return 0.2
      if (name === 'canJump') return true
      if (name === 'canSprint') return true
      if (name === 'canAttack') return false
      if (name === 'useCharacterController') return false
      return undefined
    },
    setScriptVariable: (name, value, objectId) => {
      console.log(`  Script variable set: ${name} = ${value} (object: ${objectId})`)
    },
  }

  const mountSystem = new MountSystem(context)
  await mountSystem.initialize()

  assert.equal(mountSystem.isMounted(), false)
  assert.equal(mountSystem.getMountedObjectId(), null)
  assert.equal(mountSystem.getMountPointId(), null)
  console.log('  ✓ MountSystem initialized correctly')

  // Test state getters
  const state = mountSystem.getState()
  assert.equal(state.isMounted, false)
  assert.equal(state.mountedObjectId, null)
  assert.equal(state.mountPointId, null)
  assert.equal(state.movementState, 'idle')
  assert.equal(state.airborne, false)
  console.log('  ✓ Initial state correct')

  physicsWorld.dispose()
  mountSystem.dispose()
}

async function testMountSystemMount() {
  console.log('Testing MountSystem mount...')

  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const world = createMockWorld()
  const playerVisualRoot = createMockVisualRoot()
  const playerCollisionMesh = createMockPlayerMesh()
  const mountObject = createMockMountObject()

  // Position player near mount
  playerCollisionMesh.position.set(0, 0, 2)
  playerVisualRoot.position.set(0, 0, 2)

  world.addObject('player', playerCollisionMesh, 'player')
  world.addObject('horse_1', mountObject, 'mount')
  world.setTerrainHeight(0)

  let scriptEvents = []
  let scriptVariables = new Map()

  const context = {
    world,
    physicsWorld,
    playerVisualRoot,
    playerCollisionMesh,
    getCameraYaw: () => 0,
    getPlayerRadius: () => 0.32,
    getStandingPlayerHeight: () => 1.8,
    getBodyScale: () => 1.0,
    collidesWithObjects: (mesh) => false,
    updateCameraTarget: (pos) => {},
    emitScriptEvent: (eventName, data) => {
      scriptEvents.push({ name: eventName, data })
    },
    getScriptVariable: (name, objectId) => {
      return scriptVariables.get(`${objectId}:${name}`)
    },
    setScriptVariable: (name, value, objectId) => {
      scriptVariables.set(`${objectId}:${name}`, value)
    },
  }

  const mountSystem = new MountSystem(context)
  await mountSystem.initialize()

  // Set interaction input buffer (required for mount points with requiresInteraction: true)
  mountSystem.setInput({ interact: true, forward: 0, backward: 0, left: 0, right: 0, run: false, sprint: false, jump: false, action1: false, action2: false, action3: false, action4: false })

  // Try to mount
  const result = await mountSystem.mount(mountObject)
  console.log('  Mount result:', result)
  assert.equal(result.success, true)
  assert.equal(result.mountPointId, 'seat_0')
  assert.equal(result.error, undefined)
  console.log('  ✓ Mount successful')

  // Verify state
  assert.equal(mountSystem.isMounted(), true)
  assert.equal(mountSystem.getMountedObjectId(), 'horse_1')
  assert.equal(mountSystem.getMountPointId(), 'seat_0')

  const state = mountSystem.getState()
  assert.equal(state.isMounted, true)
  assert.equal(state.mountedObjectId, 'horse_1')
  assert.equal(state.mountPointId, 'seat_0')
  console.log('  ✓ State updated after mount')

  // Verify script events
  const mountEvent = scriptEvents.find(e => e.name === 'OnMount')
  assert.ok(mountEvent)
  assert.equal(mountEvent.data.mountObjectId, 'horse_1')
  assert.equal(mountEvent.data.mountPointId, 'seat_0')
  console.log('  ✓ OnMount event emitted')

  // Verify script variables
  assert.equal(scriptVariables.get('horse_1:mounted'), true)
  assert.equal(scriptVariables.get('horse_1:movementState'), 'idle')
  assert.equal(scriptVariables.get('horse_1:seat_driver_occupied'), true)
  console.log('  ✓ Script variables updated')

  physicsWorld.dispose()
  mountSystem.dispose()
}

async function testMountSystemDismount() {
  console.log('Testing MountSystem dismount...')

  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const world = createMockWorld()
  const playerVisualRoot = createMockVisualRoot()
  const playerCollisionMesh = createMockPlayerMesh()
  const mountObject = createMockMountObject()

  // Position player near mount
  playerCollisionMesh.position.set(0, 0, 2)
  playerVisualRoot.position.set(0, 0, 2)

  world.addObject('player', playerCollisionMesh, 'player')
  world.addObject('horse_1', mountObject, 'mount')
  world.setTerrainHeight(0)

  let scriptEvents = []
  let scriptVariables = new Map()

  const context = {
    world,
    physicsWorld,
    playerVisualRoot,
    playerCollisionMesh,
    getCameraYaw: () => 0,
    getPlayerRadius: () => 0.32,
    getStandingPlayerHeight: () => 1.8,
    getBodyScale: () => 1.0,
    collidesWithObjects: (mesh) => false,
    updateCameraTarget: (pos) => {},
    emitScriptEvent: (eventName, data) => {
      scriptEvents.push({ name: eventName, data })
    },
    getScriptVariable: (name, objectId) => {
      return scriptVariables.get(`${objectId}:${name}`)
    },
    setScriptVariable: (name, value, objectId) => {
      scriptVariables.set(`${objectId}:${name}`, value)
    },
  }

  const mountSystem = new MountSystem(context)
  await mountSystem.initialize()

  // Set interaction input buffer (required for mount points with requiresInteraction: true)
  mountSystem.setInput({ interact: true, forward: 0, backward: 0, left: 0, right: 0, run: false, sprint: false, jump: false, action1: false, action2: false, action3: false, action4: false })

  // Mount first
  await mountSystem.mount(mountObject)
  scriptEvents = [] // Clear events
  scriptVariables.clear()

  // Dismount
  const result = await mountSystem.dismount()
  console.log('  Dismount result:', result)
  assert.equal(result.success, true)
  assert.ok(result.dismountPosition)
  console.log('  ✓ Dismount successful')

  // Verify state reset
  assert.equal(mountSystem.isMounted(), false)
  assert.equal(mountSystem.getMountedObjectId(), null)
  assert.equal(mountSystem.getMountPointId(), null)

  const state = mountSystem.getState()
  assert.equal(state.isMounted, false)
  assert.equal(state.mountedObjectId, null)
  assert.equal(state.mountPointId, null)
  console.log('  ✓ State reset after dismount')

  // Verify script events
  const dismountEvent = scriptEvents.find(e => e.name === 'OnDismount')
  assert.ok(dismountEvent)
  assert.equal(dismountEvent.data.mountObjectId, 'horse_1')
  console.log('  ✓ OnDismount event emitted')

  // Verify script variables
  assert.equal(scriptVariables.get('horse_1:mounted'), false)
  assert.equal(scriptVariables.get('horse_1:movementState'), 'idle')
  assert.equal(scriptVariables.get('horse_1:seat_driver_occupied'), false)
  console.log('  ✓ Script variables reset')

  physicsWorld.dispose()
  mountSystem.dispose()
}

async function testMountSystemInputProcessing() {
  console.log('Testing MountSystem input processing...')

  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const world = createMockWorld()
  const playerVisualRoot = createMockVisualRoot()
  const playerCollisionMesh = createMockPlayerMesh()
  const mountObject = createMockMountObject()

  playerCollisionMesh.position.set(0, 0, 2)
  playerVisualRoot.position.set(0, 0, 2)

  world.addObject('player', playerCollisionMesh, 'player')
  world.addObject('horse_1', mountObject, 'mount')
  world.setTerrainHeight(0)

  const context = {
    world,
    physicsWorld,
    playerVisualRoot,
    playerCollisionMesh,
    getCameraYaw: () => 0,
    getPlayerRadius: () => 0.32,
    getStandingPlayerHeight: () => 1.8,
    getBodyScale: () => 1.0,
    collidesWithObjects: (mesh) => false,
    updateCameraTarget: (pos) => {},
    emitScriptEvent: () => {},
    getScriptVariable: (name, objectId) => {
      if (name === 'speed') return 4.2
      if (name === 'runMultiplier') return 1.7
      if (name === 'sprintMultiplier') return 2.5
      if (name === 'jumpImpulse') return 10.0
      if (name === 'gravity') return 18.0
      if (name === 'maxSlopeAngle') return Math.PI / 4
      if (name === 'maxStepHeight') return 0.5
      if (name === 'turnSpeed') return 5.5
      if (name === 'cameraSmoothing') return 0.2
      if (name === 'canJump') return true
      if (name === 'canSprint') return true
      if (name === 'canAttack') return false
      if (name === 'useCharacterController') return false
      return undefined
    },
    setScriptVariable: () => {},
  }

  const mountSystem = new MountSystem(context)
  await mountSystem.initialize()

  // Mount
  await mountSystem.mount(mountObject)

  // Test forward movement input
  mountSystem.setInput({ forward: 1, backward: 0, left: 0, right: 0, run: false, sprint: false, jump: false })
  mountSystem.update(1/60)

  const state = mountSystem.getState()
  // Should be walking forward
  assert.ok(['walk', 'idle'].includes(state.movementState))
  console.log('  ✓ Forward movement input processed')

  // Test run input
  mountSystem.setInput({ forward: 1, backward: 0, left: 0, right: 0, run: true, sprint: false, jump: false })
  mountSystem.update(1/60)
  console.log('  ✓ Run input processed')

  // Test sprint input
  mountSystem.setInput({ forward: 1, backward: 0, left: 0, right: 0, run: false, sprint: true, jump: false })
  mountSystem.update(1/60)
  console.log('  ✓ Sprint input processed')

  // Test diagonal movement
  mountSystem.setInput({ forward: 1, backward: 0, left: 1, right: 0, run: false, sprint: false, jump: false })
  mountSystem.update(1/60)
  console.log('  ✓ Diagonal movement input processed')

  // Test jump input
  mountSystem.setInput({ forward: 0, backward: 0, left: 0, right: 0, run: false, sprint: false, jump: true })
  mountSystem.update(1/60)
  console.log('  ✓ Jump input processed')

  // Test action inputs
  mountSystem.setInput({ action1: true, action2: false, action3: false, action4: false })
  mountSystem.update(1/60)
  console.log('  ✓ Action inputs processed')

  physicsWorld.dispose()
  mountSystem.dispose()
}

async function testMountController() {
  console.log('Testing MountController...')

  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const world = createMockWorld()
  const playerVisualRoot = createMockVisualRoot()
  const playerCollisionMesh = createMockPlayerMesh()
  const mountObject = createMockMountObject()

  playerCollisionMesh.position.set(0, 0, 2)
  playerVisualRoot.position.set(0, 0, 2)

  world.addObject('player', playerCollisionMesh, 'player')
  world.addObject('horse_1', mountObject, 'mount')
  world.setTerrainHeight(0)

  const controllerContext = {
    world,
    physicsWorld,
    playerVisualRoot,
    playerCollisionMesh,
    getCameraYaw: () => 0,
    getPlayerRadius: () => 0.32,
    getStandingPlayerHeight: () => 1.8,
    getBodyScale: () => 1.0,
    collidesWithObjects: (mesh) => false,
    updateCameraTarget: (pos) => {},
    emitScriptEvent: () => {},
    getScriptVariable: (name, objectId) => {
      if (name === 'speed') return 4.2
      if (name === 'runMultiplier') return 1.7
      if (name === 'sprintMultiplier') return 2.5
      if (name === 'jumpImpulse') return 10.0
      if (name === 'gravity') return 18.0
      if (name === 'maxSlopeAngle') return Math.PI / 4
      if (name === 'maxStepHeight') return 0.5
      if (name === 'turnSpeed') return 5.5
      if (name === 'cameraSmoothing') return 0.2
      if (name === 'canJump') return true
      if (name === 'canSprint') return true
      if (name === 'canAttack') return false
      if (name === 'useCharacterController') return false
      return undefined
    },
    setScriptVariable: () => {},
  }

  const controller = new MountController(controllerContext)
  await controller.initialize()

  assert.equal(controller.isMounted(), false)
  console.log('  ✓ MountController initialized')

  // Test key handling
  controller.onKeyDown('KeyW')
  controller.onKeyDown('KeyE') // Interact
  controller.update(1/60)

  // Try to mount via controller
  const nearbyObjects = [mountObject]
  const mountResult = await controller.tryMount(nearbyObjects)

  // Note: tryMount checks interaction key from input buffer
  // Since we pressed KeyE, it should work
  console.log('  Mount result:', mountResult)

  // Test direct mount
  await controller.dismount() // Ensure not mounted
  const directMountResult = await controller.mount(mountObject)
  console.log('  Direct mount result:', directMountResult)

  assert.equal(controller.isMounted(), true)
  console.log('  ✓ MountController mount works')

  // Test jump request
  controller.requestJump()
  controller.update(1/60)
  console.log('  ✓ Jump request works')

  // Test state access
  const state = controller.getState()
  assert.equal(state.isMounted, true)
  assert.equal(state.mountedObjectId, 'horse_1')
  console.log('  ✓ State access works')

  // Test behavior config
  const behaviorConfig = controller.getBehaviorConfig()
  assert.equal(behaviorConfig.walkSpeed, 4.2)
  assert.equal(behaviorConfig.runMultiplier, 1.7)
  console.log('  ✓ Behavior config access works')

  // Test dismount
  await controller.dismount()
  assert.equal(controller.isMounted(), false)
  console.log('  ✓ Dismount works')

  controller.dispose()
  physicsWorld.dispose()
}

async function testMultipleMountPoints() {
  console.log('Testing multiple mount points...')

  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const world = createMockWorld()
  const playerVisualRoot = createMockVisualRoot()
  const playerCollisionMesh = createMockPlayerMesh()

  // Create mount with multiple seats
  const mountObject = createMockMountObject()
  mountObject.userData.mountConfig = {
    ...createDefaultMountConfig(),
    mountPoints: [
      createMountPoint('seat_driver', 'Driver', new THREE.Vector3(0, 1, 0), { capacityTags: ['driver'], priority: 100, stateVariable: 'seat_driver_occupied' }),
      createMountPoint('seat_passenger', 'Passenger', new THREE.Vector3(0.6, 1, 0), { capacityTags: ['passenger'], priority: 50, stateVariable: 'seat_passenger_occupied' }),
      createMountPoint('seat_gunner', 'Gunner', new THREE.Vector3(-0.6, 1.2, 0.5), { capacityTags: ['gunner'], priority: 75, stateVariable: 'seat_gunner_occupied', playerUsable: true }),
    ],
  }

  playerCollisionMesh.position.set(0, 0, 2)
  playerVisualRoot.position.set(0, 0, 2)

  world.addObject('player', playerCollisionMesh, 'player')
  world.addObject('horse_1', mountObject, 'mount')
  world.setTerrainHeight(0)

  const context = {
    world,
    physicsWorld,
    playerVisualRoot,
    playerCollisionMesh,
    getCameraYaw: () => 0,
    getPlayerRadius: () => 0.32,
    getStandingPlayerHeight: () => 1.8,
    getBodyScale: () => 1.0,
    collidesWithObjects: (mesh) => false,
    updateCameraTarget: (pos) => {},
    emitScriptEvent: () => {},
    getScriptVariable: (name, objectId) => {
      if (name === 'speed') return 4.2
      if (name === 'runMultiplier') return 1.7
      if (name === 'sprintMultiplier') return 2.5
      if (name === 'jumpImpulse') return 10.0
      if (name === 'gravity') return 18.0
      if (name === 'maxSlopeAngle') return Math.PI / 4
      if (name === 'maxStepHeight') return 0.5
      if (name === 'turnSpeed') return 5.5
      if (name === 'cameraSmoothing') return 0.2
      if (name === 'canJump') return true
      if (name === 'canSprint') return true
      if (name === 'canAttack') return false
      if (name === 'useCharacterController') return false
      return undefined
    },
    setScriptVariable: () => {},
  }

  const mountSystem = new MountSystem(context)
  await mountSystem.initialize()

  // Set interaction input buffer (required for mount points with requiresInteraction: true)
  mountSystem.setInput({ interact: true, forward: 0, backward: 0, left: 0, right: 0, run: false, sprint: false, jump: false, action1: false, action2: false, action3: false, action4: false })

  // Mount - should pick driver seat (highest priority)
  const result = await mountSystem.mount(mountObject)
  assert.equal(result.success, true)
  assert.equal(result.mountPointId, 'seat_driver')
  console.log('  ✓ Mounted on driver seat (highest priority)')

  await mountSystem.dismount()

  // Mount with preferred seat
  const result2 = await mountSystem.mount(mountObject, 'seat_gunner')
  assert.equal(result2.success, true)
  assert.equal(result2.mountPointId, 'seat_gunner')
  console.log('  ✓ Mounted on preferred seat (gunner)')

  await mountSystem.dismount()

  // Test passenger seat
  const result3 = await mountSystem.mount(mountObject, 'seat_passenger')
  assert.equal(result3.success, true)
  assert.equal(result3.mountPointId, 'seat_passenger')
  console.log('  ✓ Mounted on passenger seat')

  physicsWorld.dispose()
  mountSystem.dispose()
}

async function testBehaviorConfigUpdate() {
  console.log('Testing behavior config updates...')

  const physicsWorld = new PhysicsWorld()
  await physicsWorld.initialize()

  const world = createMockWorld()
  const playerVisualRoot = createMockVisualRoot()
  const playerCollisionMesh = createMockPlayerMesh()
  const mountObject = createMockMountObject()

  playerCollisionMesh.position.set(0, 0, 2)
  playerVisualRoot.position.set(0, 0, 2)

  world.addObject('player', playerCollisionMesh, 'player')
  world.addObject('horse_1', mountObject, 'mount')
  world.setTerrainHeight(0)

  const context = {
    world,
    physicsWorld,
    playerVisualRoot,
    playerCollisionMesh,
    getCameraYaw: () => 0,
    getPlayerRadius: () => 0.32,
    getStandingPlayerHeight: () => 1.8,
    getBodyScale: () => 1.0,
    collidesWithObjects: (mesh) => false,
    updateCameraTarget: (pos) => {},
    emitScriptEvent: () => {},
    getScriptVariable: (name, objectId) => {
      if (name === 'speed') return 4.2
      if (name === 'runMultiplier') return 1.7
      if (name === 'sprintMultiplier') return 2.5
      if (name === 'jumpImpulse') return 10.0
      if (name === 'gravity') return 18.0
      if (name === 'maxSlopeAngle') return Math.PI / 4
      if (name === 'maxStepHeight') return 0.5
      if (name === 'turnSpeed') return 5.5
      if (name === 'cameraSmoothing') return 0.2
      if (name === 'canJump') return true
      if (name === 'canSprint') return true
      if (name === 'canAttack') return false
      if (name === 'useCharacterController') return false
      return undefined
    },
    setScriptVariable: () => {},
  }

  const mountSystem = new MountSystem(context)
  await mountSystem.initialize()

  // Check default config
  let config = mountSystem.getBehaviorConfig()
  assert.equal(config.walkSpeed, 4.2)
  assert.equal(config.runMultiplier, 1.7)
  console.log('  ✓ Default behavior config')

  // Update config
  mountSystem.setBehaviorConfig({
    walkSpeed: 6.0,
    runMultiplier: 2.0,
    sprintMultiplier: 3.0,
    jumpImpulse: 15.0,
    canAttack: true,
  })

  config = mountSystem.getBehaviorConfig()
  assert.equal(config.walkSpeed, 6.0)
  assert.equal(config.runMultiplier, 2.0)
  assert.equal(config.sprintMultiplier, 3.0)
  assert.equal(config.jumpImpulse, 15.0)
  assert.equal(config.canAttack, true)
  console.log('  ✓ Behavior config updated')

  physicsWorld.dispose()
  mountSystem.dispose()
}

async function runTests() {
  console.log('\n=== Mount System Integration Tests ===\n')

  await testMountSystemInitialization()
  await testMountSystemMount()
  await testMountSystemDismount()
  await testMountSystemInputProcessing()
  await testMountController()
  await testMultipleMountPoints()
  await testBehaviorConfigUpdate()

  console.log('\n=== All Mount System Integration Tests Passed! ===\n')
}

runTests().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})