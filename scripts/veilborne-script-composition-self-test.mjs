import assert from 'node:assert/strict'
import { RuleEngine } from '../engine/script/RuleEngine.ts'
import { registerVeilborneBehaviorPackage } from '../packages/veilborne/runtime/behaviorPackageDefinition.ts'

const target = { id: 'enemy-01', name: 'Test boss' }
const world = {
  events: { emit: () => {} },
  get: id => id === target.id ? target : undefined,
  info: () => [{ id: target.id, name: target.name }],
  getSelectedId: () => null,
  update: () => {},
}
const unregister = registerVeilborneBehaviorPackage()
try {
  const logic = new RuleEngine(world)
  logic.load({
    formatVersion: 1,
    variables: {
      ecos: 0,
      nivel: 1,
      experiencia: 0,
      experiencia_proximo_nivel: 100,
      pontos_atributo: 0,
    },
    objectVariables: {},
    events: [],
    packages: [],
  })
  const instance = logic.installPackage(target.id, 'veilborne_rpg')
  logic.setPackageVariable(instance.id, 'ai_profile', 'boss_phases')
  const rules = logic.list()
  assert.ok(rules.some(rule => rule.sourcePackageInstanceId === instance.id && rule.trigger.type === 'package_event' && rule.trigger.eventId === 'enemy_killed'))

  assert.equal(logic.triggerPackageEvent(target.id, 'veilborne_rpg', 'enemy_killed'), true)
  assert.equal(logic.getVariable('ecos'), 100, 'boss reward is composed from a package script')
  assert.equal(logic.getVariable('nivel'), 2, 'the same generic script handles level thresholds')
  assert.equal(logic.getVariable('experiencia'), 50)
  assert.equal(logic.getVariable('experiencia_proximo_nivel'), 232)
  assert.equal(logic.getVariable('pontos_atributo'), 1)
  assert.equal(logic.triggerPackageEvent(target.id, 'veilborne_rpg', 'enemy_killed'), true)
  assert.equal(logic.getVariable('ecos'), 200, 'the reward rule is reusable for each defeat event')
} finally {
  unregister()
}

console.log('VEILBORNE reward script composition self-test passed.')
