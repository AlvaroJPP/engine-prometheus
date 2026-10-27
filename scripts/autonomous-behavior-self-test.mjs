import assert from 'node:assert/strict'
import * as THREE from 'three'
import { AutonomousBehaviorSystem } from '../engine/script/AutonomousBehaviorSystem.ts'

class TestWorld {
  objects = new Map()
  terrain = { heightAt: () => 0 }

  add(id, x = 0, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh.position.set(x, 0.5, z)
    this.objects.set(id, { id, name: id, type: 'cube', mesh })
    return this.objects.get(id)
  }

  get(id) {
    return this.objects.get(id)
  }

  isObjectVisible(object) {
    return object.mesh.visible
  }

  update(id, patch) {
    const object = this.objects.get(id)
    if (!object) return
    if (patch.x !== undefined) object.mesh.position.x = patch.x
    if (patch.y !== undefined) object.mesh.position.y = patch.y
    if (patch.z !== undefined) object.mesh.position.z = patch.z
    if (patch.rotationY !== undefined) object.mesh.rotation.y = patch.rotationY * Math.PI / 180
  }
}

const world = new TestWorld()
const agentObject = world.add('agent')
world.add('target', 10, 0)
const playerPosition = { x: 12, y: 0, z: 0 }

const makeAgent = (id, ownerObjectId, mode, overrides = {}) => ({
  id,
  packageId: 'autonomous_agent',
  ownerObjectId,
  enabled: true,
  variables: {
    mode,
    state: 'idle',
    move_speed: 3,
    perception_range: 20,
    stopping_distance: 1,
    wander_radius: 4,
    patrol_radius: 3,
    idle_duration: 0,
    target_object_id: 'target',
    destination_x: 4,
    destination_y: 0,
    destination_z: 0,
    ...overrides,
  },
  config: {},
})

const applyTransitions = (packages, transitions) => {
  for (const transition of transitions) {
    const instance = packages.find(item => item.id === transition.instanceId)
    if (instance) instance.variables.state = transition.state
  }
}

const tick = (system, packages, dt = 0.1, targetPosition = playerPosition, canMoveTo) => {
  const transitions = system.update({
    dt,
    runtimeEnabled: true,
    world,
    packages,
    playerPosition: targetPosition,
    canMoveTo,
  })
  applyTransitions(packages, transitions)
  return transitions
}

{
  const system = new AutonomousBehaviorSystem()
  const agent = makeAgent('wander-agent', 'agent', 'wander')
  agentObject.mesh.position.set(0, 0.5, 0)
  const startX = agentObject.mesh.position.x
  for (let index = 0; index < 40; index += 1) tick(system, [agent], 0.1)
  assert.notEqual(agentObject.mesh.position.x, startX, 'wander mode should move the object away from its start point')
  assert.ok(['wandering', 'waiting'].includes(agent.variables.state))
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('follow-agent', 'agent', 'follow_player')
  for (let index = 0; index < 10; index += 1) tick(system, [agent], 0.1)
  assert.ok(agentObject.mesh.position.x > 0, 'follow_player should approach the player')
  const lost = tick(system, [agent], 0.1, { x: 100, y: 0, z: 0 })
  assert.equal(agent.variables.state, 'idle')
  assert.ok(lost.some(item => item.events.includes('target_lost')), 'losing the player should emit target_lost')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('point-agent', 'agent', 'move_to_point', {
    destination_x: 2,
    stopping_distance: 0.2,
  })
  let latestTransitions = []
  const emittedEvents = []
  for (let index = 0; index < 20; index += 1) {
    latestTransitions = tick(system, [agent], 0.1)
    emittedEvents.push(...latestTransitions.flatMap(item => item.events))
  }
  assert.equal(agent.variables.state, 'reached')
  assert.ok(Math.abs(agentObject.mesh.position.x - 2) <= 0.25, 'move_to_point should stop near its destination')
  assert.equal(emittedEvents.filter(event => event === 'destination_reached').length, 1, 'arrival event should fire exactly once')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('idle-agent', 'agent', 'idle')
  const start = agentObject.mesh.position.clone()
  tick(system, [agent], 0.1)
  assert.ok(agentObject.mesh.position.distanceTo(start) < 1e-6, 'idle mode should not move the object')
  assert.equal(agent.variables.state, 'idle')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('patrol-agent', 'agent', 'patrol', { patrol_radius: 2, idle_duration: 0 })
  for (let index = 0; index < 8; index += 1) tick(system, [agent], 0.1)
  assert.ok(agentObject.mesh.position.x > 0, 'patrol mode should move the object toward a patrol endpoint')
  assert.ok(['patrolling', 'waiting'].includes(agent.variables.state), 'patrol should expose a moving or waiting state')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('flee-agent', 'agent', 'flee_player')
  for (let index = 0; index < 3; index += 1) tick(system, [agent], 0.1, { x: 5, y: 0, z: 0 })
  assert.ok(agentObject.mesh.position.x < 0, 'flee_player should move away from the player')
  assert.equal(agent.variables.state, 'fleeing')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  world.get('target').mesh.position.set(10, 0.5, 0)
  const agent = makeAgent('follow-object-agent', 'agent', 'follow_object')
  for (let index = 0; index < 3; index += 1) tick(system, [agent], 0.1)
  assert.ok(agentObject.mesh.position.x > 0, 'follow_object should approach the selected object')
  assert.equal(agent.variables.state, 'following')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  agentObject.mesh.rotation.y = 0
  const agent = makeAgent('look-agent', 'agent', 'look_at_player')
  const transitions = tick(system, [agent], 0.1, { x: 10, y: 0, z: 0 })
  assert.equal(agent.variables.state, 'watching')
  assert.ok(Math.abs(agentObject.mesh.rotation.y) > 0.1, 'look_at_player should rotate the object toward the player')
  assert.ok(transitions.some(item => item.events.includes('target_detected')), 'observing the player should emit target_detected')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('disabled-agent', 'agent', 'follow_player', { state: 'following' })
  agent.enabled = false
  const transitions = tick(system, [agent], 0.1)
  assert.equal(agent.variables.state, 'idle', 'a disabled behavior should return to idle')
  assert.ok(transitions.every(item => item.events.length === 0), 'disabling a behavior should not emit transition events')
}

{
  const system = new AutonomousBehaviorSystem()
  const agent = makeAgent('runtime-stop-agent', 'agent', 'wander', { state: 'idle' })
  tick(system, [agent], 0.1)
  assert.equal(system.hasRuntimeState(), true, 'running an autonomous behavior should create runtime state')
  const transitions = system.update({
    dt: 0.1,
    runtimeEnabled: false,
    world,
    packages: [agent],
    playerPosition,
  })
  applyTransitions([agent], transitions)
  assert.equal(agent.variables.state, 'idle', 'stopping runtime should reset the behavior state')
  assert.ok(transitions.every(item => item.events.length === 0), 'stopping runtime should not emit behavior events')
  assert.equal(system.hasRuntimeState(), false, 'stopping runtime should clear autonomous runtime state')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('missing-target-agent', 'agent', 'follow_object', { state: 'following' })
  world.get('target').mesh.visible = false
  const transitions = tick(system, [agent], 0.1)
  world.get('target').mesh.visible = true
  assert.equal(agent.variables.state, 'idle', 'an invisible target should stop follow_object')
  assert.ok(transitions.some(item => item.events.includes('target_lost')), 'losing an object target should emit target_lost')
}


{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('avoidance-agent', 'agent', 'move_to_point', {
    destination_x: 3,
    stopping_distance: 0.2,
  })
  const canMoveTo = (_id, target) =>
    !(target.x > 0.75 && target.x < 1.5 && Math.abs(target.z) < 0.2)
  let usedLateralPath = false

  for (let index = 0; index < 30; index += 1) {
    tick(system, [agent], 0.1, playerPosition, canMoveTo)
    usedLateralPath ||= Math.abs(agentObject.mesh.position.z) > 0.2
  }
  assert.ok(usedLateralPath, 'obstacle avoidance should choose a lateral path when direct movement is blocked')
  assert.ok(Math.abs(agentObject.mesh.position.x - 3) <= 0.25, 'the agent should resume its route after passing a finite obstacle')
  assert.equal(agent.variables.state, 'reached', 'the autonomous behavior should reach its destination after avoiding an obstacle')
}

{
  const system = new AutonomousBehaviorSystem()
  agentObject.mesh.position.set(0, 0.5, 0)
  const agent = makeAgent('invalid-terrain-agent', 'agent', 'move_to_point', {
    destination_x: 2,
    stopping_distance: 0.2,
  })
  const previousHeightAt = world.terrain.heightAt
  world.terrain.heightAt = () => Number.NaN

  try {
    for (let index = 0; index < 20; index += 1) tick(system, [agent], 0.1)
    assert.ok(
      Number.isFinite(agentObject.mesh.position.x)
        && Number.isFinite(agentObject.mesh.position.y)
        && Number.isFinite(agentObject.mesh.position.z),
      'invalid terrain height must never contaminate a transform',
    )
    assert.ok(agentObject.mesh.position.x > 0, 'movement should fall back to the current ground height')
    assert.equal(agent.variables.state, 'reached')
  } finally {
    world.terrain.heightAt = previousHeightAt
  }
}

console.log('Autonomous behavior self-test passed.')
