import assert from 'node:assert/strict'
import { RuleEngine } from '../engine/script/RuleEngine.ts'
import { registerBehaviorPackageDefinition } from '../engine/script/packages.ts'

const emitted = []
const target = { id: 'target-01', name: 'Target', mesh: { position: { x: 1, y: 0, z: 0 }, visible: true } }
const world = {
  events: { emit: (type, payload) => emitted.push({ type, payload }) },
  get: id => id === target.id ? target : undefined,
  isObjectVisible: object => object.mesh.visible,
  update: (id, patch) => { if (id === target.id && typeof patch.visible === 'boolean') target.mesh.visible = patch.visible },
  remove: id => { if (id === target.id) target.mesh.visible = false },
  info: () => [{ id: target.id, name: target.name }],
  getSelectedId: () => null,
  update: () => {},
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
      code: "api.global.add('runs', 1); api.package.set('{ID_OBJECT}', 'script-test', 'script_ran', true)",
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
  assert.equal(logic.getVariable('runs'), 1)
  assert.equal(logic.listPackages(target.id)[0].variables.script_ran, true)
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
