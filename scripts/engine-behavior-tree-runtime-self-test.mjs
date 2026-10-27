import assert from 'node:assert/strict'
import { EngineBehaviorTreeRuntime } from '../engine/script/EngineBehaviorTreeRuntime.ts'

const packageInstance = {
  id: 'tree-instance',
  packageId: 'custom',
  ownerObjectId: 'npc',
  enabled: true,
  variables: { stamina: 40 },
  config: {
    behaviorTree: {
      id: 'root',
      type: 'sequence',
      children: [
        { id: 'global-health-check', type: 'condition', condition: 'global_variable_compare', parameters: { variable: 'health', operator: 'gte', value: 50 } },
        { id: 'package-stamina-check', type: 'condition', condition: 'package_variable_compare', parameters: { variable: 'stamina', operator: 'lt', value: 50 } },
        { id: 'exists', type: 'condition', condition: 'object_exists' },
        { id: 'near-target', type: 'condition', condition: 'object_distance_lte', parameters: { targetObjectId: 'target', distance: 10 } },
        { id: 'move', type: 'action', action: 'set_object_position', parameters: { x: 2, z: 3 } },
        { id: 'rotate', type: 'action', action: 'set_object_rotation', parameters: { y: 90 } },
        { id: 'scale', type: 'action', action: 'set_object_scale', parameters: { value: 2 } },
        { id: 'destroy-target', type: 'action', action: 'destroy_object', parameters: { objectId: 'target' } },
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
const globals = { health: 75 }
const emitted = []
const changed = []
const removed = new Set()
const object = { id: 'npc', mesh: { visible: true, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 } } }
const target = { id: 'target', mesh: { visible: true, position: { x: 5, y: 0, z: 0 } } }
const context = {
  world: {
    get: id => removed.has(id) ? undefined : id === 'npc' ? object : id === 'target' ? target : undefined,
    remove: id => { removed.add(id) },
    isObjectVisible: candidate => candidate.mesh.visible,
    update: (id, patch) => {
      const candidate = id === 'npc' ? object : id === 'target' ? target : undefined
      if (!candidate) return
      if (patch.x !== undefined) candidate.mesh.position.x = patch.x
      if (patch.y !== undefined) candidate.mesh.position.y = patch.y
      if (patch.z !== undefined) candidate.mesh.position.z = patch.z
      if (patch.rotationX !== undefined) candidate.mesh.rotation.x = patch.rotationX * Math.PI / 180
      if (patch.rotationY !== undefined) candidate.mesh.rotation.y = patch.rotationY * Math.PI / 180
      if (patch.rotationZ !== undefined) candidate.mesh.rotation.z = patch.rotationZ * Math.PI / 180
      if (patch.scale !== undefined) Object.assign(candidate.mesh.scale, { x: patch.scale, y: patch.scale, z: patch.scale })
      if (patch.scaleX !== undefined) candidate.mesh.scale.x = patch.scaleX
      if (patch.scaleY !== undefined) candidate.mesh.scale.y = patch.scaleY
      if (patch.scaleZ !== undefined) candidate.mesh.scale.z = patch.scaleZ
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
const customCalls = []
const disposeCustom = runtime.registerNamespace('custom', {
  conditions: { context_is_ready: (_params, _context) => true },
  actions: { record: (params, _context) => { customCalls.push(params.value); return 'success' } },
})
packages[0].config.behaviorTree.children.unshift(
  { id: 'custom-condition', type: 'condition', condition: 'custom:context_is_ready' },
  { id: 'custom-action', type: 'action', action: 'custom:record', parameters: { value: 'works' } },
)
runtime.update(context, 0.016, true)
assert.deepEqual(customCalls, ['works'], 'registered module handlers must execute in engine behavior trees')
assert.equal(object.mesh.position.x, 2, 'set_object_position should update the object')
assert.equal(object.mesh.position.z, 3)
assert.ok(Math.abs(object.mesh.rotation.y - Math.PI / 2) < 1e-8, 'set_object_rotation should update rotation in degrees')
assert.deepEqual(object.mesh.scale, { x: 2, y: 2, z: 2 }, 'set_object_scale should support uniform scaling')
assert.equal(packages[0].variables.ready, true)
assert.equal(packages[0].variables.behavior_tree_status, 'success')
assert.equal(globals.tree_completed, 'yes')
assert.deepEqual(emitted, [['npc', 'custom', 'tree_finished']])
assert.ok(changed.includes('npc'))
assert.ok(removed.has('target'), 'destroy_object should remove an existing world object')

runtime.update(context, 0.016, false)
assert.equal('behavior_tree_status' in packages[0].variables, false, 'stopping Run clears the transient status')
assert.equal(runtime['system'].hasRuntime('tree-instance'), false)
disposeCustom()

packages[0].config.behaviorTree = null
packages[0].variables.behavior_tree_status = 'running'
runtime.update(context, 0.016, true)
assert.equal('behavior_tree_status' in packages[0].variables, false, 'removing a tree clears its stale status')

console.log('Engine behavior tree runtime self-test passed.')
