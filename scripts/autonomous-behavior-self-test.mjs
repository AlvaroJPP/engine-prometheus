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
const tick = (system, packages, dt = 0.1, targetPosition = playerPosition) => {
  const transitions = system.update({
    dt,
    runtimeEnabled: true,
    world,
    packages,
    playerPosition: targetPosition,
  })
  applyTransitions(packages, transitions)
  return transitions
}

{
  const system = new AutonomousBehaviorSystem()
  const agent = makeAgent('wander-agent', 'agent', 'wander')
  const startX = agentObject.mesh.position.x
  let transitions = []
  for (let index = 0; index < 40; index += 1) {
    transitions = tick(system, [agent], 0.1)
  }
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
  for (let index = 0; index < 20; index += 1) {
    latestTransitions = tick(system, [agent], 0.1)
  }
  assert.equal(agent.variables.state, 'reached')
  assert.ok(Math.abs(agentObject.mesh.position.x - 2) <= 0.25, 'move_to_point should stop near its destination')
  assert.ok(latestTransitions.every(item => !item.events.includes('destination_reached')), 'arrival event should only fire on the transition to reached')
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

console.log('Autonomous behavior self-test passed.')
