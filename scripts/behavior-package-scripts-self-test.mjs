import assert from 'node:assert/strict'
import { RuleEngine } from '../engine/script/RuleEngine.ts'
import { registerBehaviorPackageDefinition } from '../engine/script/packages.ts'

const emitted = []
const target = { id: 'target-01', name: 'Target', mesh: { position: { x: 1, y: 0, z: 0 }, visible: true } }
const objects = new Map([[target.id, target]])
const world = {
  events: { emit: (type, payload) => emitted.push({ type, payload }) },
  get: id => objects.get(id),
  isObjectVisible: object => object.mesh.visible,
  add: object => { objects.set(object.id, object); return object },
  update: (id, patch) => {
    const object = objects.get(id)
    if (!object) return
    if (typeof patch.visible === 'boolean') object.mesh.visible = patch.visible
    for (const axis of ['x', 'y', 'z']) if (typeof patch[axis] === 'number') object.mesh.position[axis] = patch[axis]
  },
  remove: id => { objects.delete(id) },
  list: () => [...objects.values()],
  info: () => [...objects.values()].map(object => ({ id: object.id, name: object.name })),
  getSelectedId: () => null,
  getGroundHeightAt: () => 0,
}
const definition = {
  id: 'script-test',
  version: '1.0.0',
  name: 'Script test',
  description: 'Verifies package-defined Visual Script installation.',
  variables: [
    { name: 'script_ran', label: 'Script ran', type: 'boolean', defaultValue: false },
  ],
  triggers: [],
  conditions: [],
  actions: [],
  defaultConfig: {},
  scripts: [{
    id: 'on-ping',
    name: 'Increment counter',
    enabled: true,
    trigger: { type: 'package_event', objectId: '{ID_OBJECT}', packageId: 'script-test', eventId: 'ping' },
    conditions: [],
    actions: [{
      type: 'javascript',
      code: "api.global.add('runs', 1); api.package.set('{ID_OBJECT}', 'script-test', 'script_ran', true); const spawned = api.world.spawnPrimitive({ name: 'Script Spawned', shape: 'octahedron', x: 0, y: 1, z: 0, color: 123 }); api.package.install(spawned, 'script-test'); api.package.configure(spawned, 'script-test', { script_ran: true }); api.world.setVisibleTemporary('{ID_OBJECT}', false); api.global.set('nearby_invalid_count', api.world.nearby({ x: Number.NaN, y: 0, z: 0 }, 100).length); api.global.add('runs', Number.NaN); api.global.set('bad_global_value', Number.POSITIVE_INFINITY); api.set('bad_scoped_value', Number.NaN); api.package.set('{ID_OBJECT}', 'script-test', 'bad_package_value', Number.NaN); api.package.configure('{ID_OBJECT}', 'script-test', { bad_configured_value: Number.POSITIVE_INFINITY })",
    }],
  }],
}
const unregister = registerBehaviorPackageDefinition(definition)
try {
  const logic = new RuleEngine(world)
  logic.load({ formatVersion: 1, variables: { runs: 0 }, objectVariables: {}, events: [], packages: [] })
  const installed = logic.installPackage(target.id, 'script-test')
  const generatedRuleId = installed.id + '::on-ping'
  assert.ok(logic.list().some(rule => rule.id === generatedRuleId))
  assert.equal(logic.list().find(rule => rule.id === generatedRuleId).ownerObjectId, target.id)

  assert.equal(logic.triggerNearestPackageEvent({ x: 0, y: 0, z: 0 }, {
    eventId: 'ping', packageId: 'script-test', radius: 2, variableEquals: { script_ran: false },
  }), true)
  assert.equal(logic.getVariable('runs'), 1, 'invalid numeric additions must not corrupt global counters')
  assert.equal(logic.getVariable('nearby_invalid_count'), 0, 'nearby returns no objects for a non-finite center')
  assert.equal(logic.getVariable('bad_global_value'), undefined, 'non-finite global values are rejected')
  assert.equal(logic.getVariable('bad_scoped_value', target.id), undefined, 'non-finite scoped values are rejected')
  const targetPackage = logic.listPackages(target.id)[0]
  assert.equal(targetPackage.variables.script_ran, true)
  assert.equal(targetPackage.variables.bad_package_value, undefined, 'non-finite package values are rejected')
  assert.equal(targetPackage.variables.bad_configured_value, undefined, 'package configuration rejects non-finite values')
  const spawned = [...objects.values()].find(object => object.id !== target.id)
  assert.ok(spawned, 'generic script API can create an object')
  assert.equal(spawned.type, 'cube')
  assert.equal(spawned.mesh.geometry.type, 'OctahedronGeometry')
  assert.equal(logic.listPackages(spawned.id)[0].variables.script_ran, true, 'scripts can install and configure behavior packages on created objects')
  assert.equal(target.mesh.visible, false, 'scripts can hide an authored object temporarily during Run')
  logic.restoreRuntimeWorldChanges()
  assert.equal(target.mesh.visible, true, 'the generic runtime restores temporary visibility on return to Edit')
  assert.ok(emitted.some(event => event.type === 'behaviorPackageChanged'))

  logic.remove(generatedRuleId)
  assert.equal(logic.triggerPackageEvent(target.id, 'script-test', 'ping'), false)
  assert.equal(logic.getVariable('runs'), 1, 'a manually removed template script stays disabled')
  assert.equal(logic.list().some(rule => rule.id === generatedRuleId), false)
  logic.removePackage(installed.id)
  assert.equal(logic.listPackages(target.id).length, 0)
} finally {
  unregister()
}

console.log('Behavior package Visual Script self-test passed.')
