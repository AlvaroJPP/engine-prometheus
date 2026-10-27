import assert from 'node:assert/strict'
import { EngineBehaviorTreeRuntime } from '../engine/script/EngineBehaviorTreeRuntime.ts'

const packageInstance = {
  id: 'tree-instance',
  packageId: 'custom',
  ownerObjectId: 'npc',
  enabled: true,
  variables: {},
  config: {
    behaviorTree: {
      id: 'root',
      type: 'sequence',
      children: [
        { id: 'exists', type: 'condition', condition: 'object_exists' },
        { id: 'near-target', type: 'condition', condition: 'object_distance_lte', parameters: { targetObjectId: 'target', distance: 10 } },
        { id: 'move', type: 'action', action: 'set_object_position', parameters: { x: 2, z: 3 } },
        {
          id: 'mark',
          type: 'action',
          action: 'set_package_variable',
          parameters: { variable: 'ready', value: true },
        },
        {
          id: 'global',
          type: 'action',
          action: 'set_global_variable',
          parameters: { variable: 'tree_completed', value: 'yes' },
        },
        {
          id: 'event',
          type: 'action',
          action: 'trigger_package_event',
          parameters: { eventId: 'tree_finished' },
        },
      ],
    },
  },
}
const packages = [packageInstance]
const globals = {}
const emitted = []
const changed = []
const object = { id: 'npc', mesh: { visible: true, position: { x: 0, y: 0, z: 0 } } }
const target = { id: 'target', mesh: { visible: true, position: { x: 5, y: 0, z: 0 } } }
const context = {
  world: {
    get: id => id === 'npc' ? object : id === 'target' ? target : undefined,
    isObjectVisible: candidate => candidate.mesh.visible,
    update: (id, patch) => {
      const candidate = id === 'npc' ? object : id === 'target' ? target : undefined
      if (!candidate) return
      if (patch.x !== undefined) candidate.mesh.position.x = patch.x
      if (patch.y !== undefined) candidate.mesh.position.y = patch.y
      if (patch.z !== undefined) candidate.mesh.position.z = patch.z
    },
  },
  logic: {
    listPackages: () => structuredClone(packages),
    setPackageVariable: (id, name, value) => {
      const item = packages.find(candidate => candidate.id === id)
      if (item) item.variables[name] = value
    },
    removePackageVariable: (id, name) => {
      const item = packages.find(candidate => candidate.id === id)
      if (!item || !(name in item.variables)) return false
      delete item.variables[name]
      return true
    },
    getVariable: name => globals[name],
    setVariable: (name, value) => { globals[name] = value },
    triggerPackageEvent: (objectId, packageId, eventId) => {
      emitted.push([objectId, packageId, eventId])
      return true
    },
  },
  playerPosition: { x: 0, y: 0, z: 0 },
  invalidate: () => changed.push('invalidate'),
  notifyPackageChanged: id => changed.push(id),
}

const runtime = new EngineBehaviorTreeRuntime()
runtime.update(context, 0.016, true)
assert.equal(object.mesh.position.x, 2, 'set_object_position should update the object')
assert.equal(object.mesh.position.z, 3)
assert.equal(packages[0].variables.ready, true)
assert.equal(packages[0].variables.behavior_tree_status, 'success')
assert.equal(globals.tree_completed, 'yes')
assert.deepEqual(emitted, [['npc', 'custom', 'tree_finished']])
assert.ok(changed.includes('npc'))

runtime.update(context, 0.016, false)
assert.equal('behavior_tree_status' in packages[0].variables, false, 'stopping Run clears the transient status')
assert.equal(runtime['system'].hasRuntime('tree-instance'), false)

packages[0].config.behaviorTree = null
packages[0].variables.behavior_tree_status = 'running'
runtime.update(context, 0.016, true)
assert.equal('behavior_tree_status' in packages[0].variables, false, 'removing a tree clears its stale status')

console.log('Engine behavior tree runtime self-test passed.')
