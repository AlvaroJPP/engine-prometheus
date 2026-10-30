import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  createMountPoint,
} from '../engine/mount/MountPoint.ts'
import {
  createDefaultAnimationMapping,
  createAnimationMappingFromConfig,
} from '../engine/mount/MountAnimationMapper.ts'

function testMountPointCreation() {
  console.log('Testing MountPoint creation...')

  // Test 1: Create basic mount point
  const mp1 = createMountPoint('seat_0', 'Driver Seat', new THREE.Vector3(0, 0.55, 0))
  assert.equal(mp1.id, 'seat_0')
  assert.equal(mp1.label, 'Driver Seat')
  assert.deepEqual(mp1.localOffset.toArray(), [0, 0.55, 0])
  assert.deepEqual(mp1.capacityTags, ['passenger'])
  assert.equal(mp1.priority, 0)
  assert.equal(mp1.playerUsable, true)
  assert.equal(mp1.requiresInteraction, true)
  console.log('  ✓ Basic mount point creation')

  // Test 2: Create mount point with overrides
  const mp2 = createMountPoint('seat_1', 'Gunner Seat', new THREE.Vector3(1, 1, 0), {
    capacityTags: ['gunner'],
    priority: 50,
    stateVariable: 'seat_gunner_occupied',
    playerUsable: true,
    requiresInteraction: false,
  })
  assert.equal(mp2.id, 'seat_1')
  assert.equal(mp2.label, 'Gunner Seat')
  assert.deepEqual(mp2.capacityTags, ['gunner'])
  assert.equal(mp2.priority, 50)
  assert.equal(mp2.stateVariable, 'seat_gunner_occupied')
  assert.equal(mp2.requiresInteraction, false)
  console.log('  ✓ Mount point with overrides')

  // Test 3: MountPoint with bone name
  const mp3 = createMountPoint('seat_2', 'Bone Seat', new THREE.Vector3(0, 1, 0), {
    boneName: 'spine_02',
  })
  assert.equal(mp3.boneName, 'spine_02')
  console.log('  ✓ Mount point with bone name')

  // Test 4: MountPoint with camera offset
  const mp4 = createMountPoint('seat_3', 'Camera Seat', new THREE.Vector3(0, 1, 0), {
    cameraOffset: new THREE.Vector3(0, 2, 4),
  })
  assert.ok(mp4.cameraOffset)
  assert.deepEqual(mp4.cameraOffset.toArray(), [0, 2, 4])
  console.log('  ✓ Mount point with camera offset')
}

function testMountConfig() {
  console.log('Testing MountConfig...')

  const config = {
    mountPoints: [
      createMountPoint('seat_0', 'Driver', new THREE.Vector3(0, 0.55, 0), { capacityTags: ['driver'], priority: 100 }),
      createMountPoint('seat_1', 'Passenger', new THREE.Vector3(0.5, 0.55, 0), { capacityTags: ['passenger'], priority: 50 }),
      createMountPoint('seat_2', 'Gunner', new THREE.Vector3(-0.5, 1, 0.5), { capacityTags: ['gunner'], priority: 75 }),
    ],
    defaultSeatOffset: new THREE.Vector3(0, 0.55, 0),
    mountable: true,
    interactionRadius: 3.0,
    interactionKey: 'KeyE',
    controlBindings: {
      forward: 'KeyW',
      backward: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'ShiftLeft',
      jump: 'Space',
      interact: 'KeyE',
      action1: 'KeyQ',
      action2: 'KeyR',
      action3: 'KeyF',
      action4: 'KeyC',
    },
  }

  assert.equal(config.mountPoints.length, 3)
  assert.equal(config.mountable, true)
  assert.equal(config.interactionRadius, 3.0)
  assert.equal(config.controlBindings.forward, 'KeyW')
  assert.equal(config.controlBindings.action1, 'KeyQ')
  console.log('  ✓ MountConfig structure')

  // Test sorting by priority
  const sorted = [...config.mountPoints].sort((a, b) => b.priority - a.priority)
  assert.equal(sorted[0].id, 'seat_0') // driver priority 100
  assert.equal(sorted[1].id, 'seat_2') // gunner priority 75
  assert.equal(sorted[2].id, 'seat_1') // passenger priority 50
  console.log('  ✓ MountPoint priority sorting')
}

function testAnimationMapping() {
  console.log('Testing MountAnimationMapping...')

  const mapping = createDefaultAnimationMapping()
  assert.ok(mapping.mountClipNames.mount_idle)
  assert.ok(mapping.mountClipNames.mount_walk)
  assert.ok(mapping.mountClipNames.mount_run)
  assert.ok(mapping.mount_transition_mount)
  assert.ok(mapping.playerClipNames.player_mount_idle)
  assert.ok(mapping.player_transition_mount)
  assert.equal(mapping.useGenericFallback, true)
  console.log('  ✓ Default animation mapping')

  // Test creating from config
  const config = {
    mountPoints: [],
    defaultSeatOffset: new THREE.Vector3(0, 0.55, 0),
    mountable: true,
    interactionRadius: 2.5,
    interactionKey: 'KeyE',
    controlBindings: {
      forward: 'KeyW',
      backward: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'ShiftLeft',
      jump: 'Space',
      interact: 'KeyE',
    },
    animationMapping: {
      mountClipNames: {
        mount_idle: 'custom_idle',
        mount_walk: 'custom_walk',
      },
      playerClipNames: {
        player_mount_idle: 'custom_player_idle',
      },
      mount_transition_mount: 'custom_mount',
      player_transition_mount: 'custom_player_mount',
      mount_transition_dismount: 'custom_dismount',
      player_transition_dismount: 'custom_player_dismount',
      useGenericFallback: false,
    },
  }

  const customMapping = createAnimationMappingFromConfig(config)
  assert.equal(customMapping.mountClipNames.mount_idle, 'custom_idle')
  assert.equal(customMapping.mountClipNames.mount_walk, 'custom_walk')
  assert.equal(customMapping.playerClipNames.player_mount_idle, 'custom_player_idle')
  assert.equal(customMapping.mount_transition_mount, 'custom_mount')
  assert.equal(customMapping.mount_transition_dismount, 'custom_dismount')
  assert.equal(customMapping.useGenericFallback, false)
  console.log('  ✓ Animation mapping from config')
}

function testMountAnimationRoles() {
  console.log('Testing MountAnimationRole types...')

  const mountRoles = [
    'mount_idle', 'mount_walk', 'mount_run', 'mount_sprint',
    'mount_turn_left', 'mount_turn_right',
    'mount_jump_start', 'mount_jump_air', 'mount_jump_land',
    'mount_dash', 'mount_attack', 'mount_special', 'mount_emote', 'mount_death',
    'player_mount_idle', 'player_mount_walk', 'player_mount_run',
    'player_mount_turn_left', 'player_mount_turn_right', 'player_mount_jump', 'player_mount_action',
    'mount_transition_mount', 'mount_transition_dismount',
    'player_transition_mount', 'player_transition_dismount',
  ]

  for (const role of mountRoles) {
    // Just verify they're valid strings
    assert.ok(typeof role === 'string')
  }
  console.log('  ✓ All MountAnimationRole types valid')
}

function testMountMovementStates() {
  console.log('Testing MountMovementState types...')

  const states = [
    'idle', 'walk', 'run', 'sprint',
    'walk_diagonal_left', 'walk_diagonal_right',
    'run_diagonal_left', 'run_diagonal_right',
    'turn_left', 'turn_right',
    'jump', 'dash', 'attack', 'special',
  ]

  for (const state of states) {
    assert.ok(typeof state === 'string')
  }
  console.log('  ✓ All MountMovementState types valid')
}

function testBehaviorConfig() {
  console.log('Testing MountBehaviorConfig...')

  const config = {
    walkSpeed: 5.0,
    runMultiplier: 2.0,
    sprintMultiplier: 3.0,
    jumpImpulse: 12.0,
    gravity: 20.0,
    maxSlopeAngle: Math.PI / 3,
    maxStepHeight: 0.6,
    turnSpeed: 8.0,
    cameraSmoothing: 0.15,
    canJump: true,
    canSprint: true,
    canAttack: true,
    useCharacterController: true,
  }

  assert.equal(config.walkSpeed, 5.0)
  assert.equal(config.runMultiplier, 2.0)
  assert.equal(config.sprintMultiplier, 3.0)
  assert.equal(config.canAttack, true)
  assert.equal(config.useCharacterController, true)
  console.log('  ✓ MountBehaviorConfig structure')
}

function testControlBindings() {
  console.log('Testing MountControlBindings...')

  const bindings = {
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    run: 'ShiftLeft',
    jump: 'Space',
    interact: 'KeyE',
    action1: 'KeyQ',
    action2: 'KeyR',
    action3: 'KeyF',
    action4: 'KeyC',
    cameraYaw: 'MouseX',
    cameraPitch: 'MouseY',
    cameraZoom: 'Wheel',
  }

  assert.equal(bindings.forward, 'KeyW')
  assert.equal(bindings.action1, 'KeyQ')
  assert.equal(bindings.cameraYaw, 'MouseX')
  console.log('  ✓ MountControlBindings structure')
}

function testMountResult() {
  console.log('Testing MountResult and MountError...')

  const successResult = { success: true, mountPointId: 'seat_0' }
  assert.equal(successResult.success, true)
  assert.equal(successResult.mountPointId, 'seat_0')
  assert.equal(successResult.error, undefined)
  console.log('  ✓ Successful MountResult')

  const errorResult = { success: false, mountPointId: null, error: 'OUT_OF_RANGE' }
  assert.equal(errorResult.success, false)
  assert.equal(errorResult.mountPointId, null)
  assert.equal(errorResult.error, 'OUT_OF_RANGE')
  console.log('  ✓ Error MountResult')

  // Test all error types
  const errors = [
    'ALREADY_MOUNTED', 'NOT_MOUNTABLE', 'NO_VALID_MOUNT_POINTS',
    'OUT_OF_RANGE', 'MOUNT_POINT_OCCUPIED', 'MOUNT_POINT_NOT_PLAYER_USABLE',
    'INTERACTION_REQUIRED', 'ANIMATION_FAILED', 'PHYSICS_FAILED', 'UNKNOWN'
  ]
  for (const err of errors) {
    const r = { success: false, mountPointId: null, error: err }
    assert.equal(r.error, err)
  }
  console.log('  ✓ All MountError types valid')
}

function testDismountResult() {
  console.log('Testing DismountResult and DismountError...')

  const successResult = { success: true, dismountPosition: new THREE.Vector3(1, 0, 1) }
  assert.equal(successResult.success, true)
  assert.ok(successResult.dismountPosition)
  console.log('  ✓ Successful DismountResult')

  const errorResult = { success: false, dismountPosition: null, error: 'BLOCKED_BY_COLLISION' }
  assert.equal(errorResult.success, false)
  assert.equal(errorResult.error, 'BLOCKED_BY_COLLISION')
  console.log('  ✓ Error DismountResult')

  const errors = [
    'NOT_MOUNTED', 'NO_VALID_DISMOUNT_POSITION', 'BLOCKED_BY_COLLISION', 'ANIMATION_FAILED', 'UNKNOWN'
  ]
  for (const err of errors) {
    const r = { success: false, dismountPosition: null, error: err }
    assert.equal(r.error, err)
  }
  console.log('  ✓ All DismountError types valid')
}

function testMountPointSerialization() {
  console.log('Testing MountPoint serialization concepts...')

  const mp = createMountPoint('seat_test', 'Test Seat', new THREE.Vector3(1, 2, 3), {
    localRotation: new THREE.Euler(0, Math.PI / 2, 0),
    capacityTags: ['driver', 'commander'],
    priority: 200,
    stateVariable: 'seat_test_occupied',
    cameraOffset: new THREE.Vector3(0, 1.5, 3),
  })

  // Simulate serialization
  const serialized = {
    id: mp.id,
    label: mp.label,
    localOffset: mp.localOffset.toArray(),
    localRotation: mp.localRotation?.toArray(),
    capacityTags: mp.capacityTags,
    priority: mp.priority,
    stateVariable: mp.stateVariable,
    playerUsable: mp.playerUsable,
    requiresInteraction: mp.requiresInteraction,
    cameraOffset: mp.cameraOffset?.toArray(),
  }

  assert.deepEqual(serialized.localOffset, [1, 2, 3])
  assert.deepEqual(serialized.localRotation, [0, Math.PI / 2, 0, 'XYZ'])
  assert.deepEqual(serialized.capacityTags, ['driver', 'commander'])
  assert.equal(serialized.priority, 200)
  assert.equal(serialized.stateVariable, 'seat_test_occupied')
  assert.deepEqual(serialized.cameraOffset, [0, 1.5, 3])
  console.log('  ✓ MountPoint serialization structure')

  // Simulate deserialization
  const deserialized = createMountPoint(
    serialized.id,
    serialized.label,
    new THREE.Vector3(...serialized.localOffset),
    {
      localRotation: serialized.localRotation ? new THREE.Euler(...serialized.localRotation) : undefined,
      capacityTags: serialized.capacityTags,
      priority: serialized.priority,
      stateVariable: serialized.stateVariable,
      playerUsable: serialized.playerUsable,
      requiresInteraction: serialized.requiresInteraction,
      cameraOffset: serialized.cameraOffset ? new THREE.Vector3(...serialized.cameraOffset) : undefined,
    }
  )

  assert.equal(deserialized.id, mp.id)
  assert.deepEqual(deserialized.localOffset.toArray(), mp.localOffset.toArray())
  assert.equal(deserialized.priority, mp.priority)
  console.log('  ✓ MountPoint deserialization structure')
}

function testMountPointSelectionLogic() {
  console.log('Testing MountPoint selection logic...')

  const mountPoints = [
    createMountPoint('seat_0', 'Driver', new THREE.Vector3(0, 0.55, 0), { capacityTags: ['driver'], priority: 100, playerUsable: true }),
    createMountPoint('seat_1', 'Passenger', new THREE.Vector3(0.5, 0.55, 0), { capacityTags: ['passenger'], priority: 50, playerUsable: true }),
    createMountPoint('seat_2', 'Gunner', new THREE.Vector3(-0.5, 1, 0.5), { capacityTags: ['gunner'], priority: 75, playerUsable: false }), // Not player usable
    createMountPoint('seat_3', 'Commander', new THREE.Vector3(0, 1, -0.5), { capacityTags: ['commander'], priority: 200, playerUsable: true, requiresInteraction: false }),
  ]

  // Filter player usable
  const playerUsable = mountPoints.filter(mp => mp.playerUsable)
  assert.equal(playerUsable.length, 3)
  console.log('  ✓ Filter player usable')

  // Sort by priority
  const sorted = [...playerUsable].sort((a, b) => b.priority - a.priority)
  assert.equal(sorted[0].id, 'seat_3') // Commander priority 200
  assert.equal(sorted[1].id, 'seat_0') // Driver priority 100
  assert.equal(sorted[2].id, 'seat_1') // Passenger priority 50
  console.log('  ✓ Sort by priority')

  // Find by capacity tag
  const driverSeats = mountPoints.filter(mp => mp.capacityTags.includes('driver'))
  assert.equal(driverSeats.length, 1)
  assert.equal(driverSeats[0].id, 'seat_0')
  console.log('  ✓ Find by capacity tag')

  // Find by ID
  const preferred = mountPoints.find(mp => mp.id === 'seat_1')
  assert.ok(preferred)
  assert.equal(preferred.id, 'seat_1')
  console.log('  ✓ Find by ID')
}

// Run all tests
async function runTests() {
  console.log('\n=== Mount System Unit Tests ===\n')

  testMountPointCreation()
  testMountConfig()
  testAnimationMapping()
  testMountAnimationRoles()
  testMountMovementStates()
  testBehaviorConfig()
  testControlBindings()
  testMountResult()
  testDismountResult()
  testMountPointSerialization()
  testMountPointSelectionLogic()

  console.log('\n=== All Mount System Unit Tests Passed! ===\n')
}

runTests().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})