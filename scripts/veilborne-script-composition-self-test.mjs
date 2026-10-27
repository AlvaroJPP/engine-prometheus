import assert from 'node:assert/strict'
import * as THREE from 'three'
import { RuleEngine } from '../engine/script/RuleEngine.ts'
import { registerVeilborneBehaviorPackage } from '../packages/veilborne/runtime/behaviorPackageDefinition.ts'

const target = {
  id: 'enemy-01',
  name: 'Test boss',
  mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()),
}
const objects = new Map([[target.id, target]])
const world = {
  events: { emit: () => {} },
  get: id => objects.get(id),
  list: () => [...objects.values()],
  isObjectVisible: object => object.mesh.visible,
  add: object => { objects.set(object.id, object); return object },
  remove: id => { objects.delete(id) },
  info: () => [...objects.values()].map(object => ({ id: object.id, name: object.name })),
  getSelectedId: () => null,
  update: (id, patch) => {
    const object = objects.get(id)
    if (!object) return
    if (typeof patch.visible === 'boolean') object.mesh.visible = patch.visible
    for (const axis of ['x', 'y', 'z']) {
      if (typeof patch[axis] === 'number') object.mesh.position[axis] = patch[axis]
    }
  },
  getGroundHeightAt: () => 0,
}
const unregister = registerVeilborneBehaviorPackage()
try {
  const logic = new RuleEngine(world)
  logic.load({
    formatVersion: 1,
    variables: {
      ecos: 0,
      ecos_perdidos: 0,
      vida: 100,
      vida_max: 100,
      eter: 100,
      eter_max: 100,
      vigor: 100,
      vigor_max: 100,
      postura: 0,
      morto: false,
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
  assert.ok(rules.some(rule => rule.sourcePackageInstanceId === instance.id && rule.trigger.type === 'package_event' && rule.trigger.eventId === 'enemy_attack'))

  logic.setPackageVariable(instance.id, 'vida', 20)
  logic.setPackageVariable(instance.id, 'vida_max', 100)
  assert.equal(logic.triggerPackageEvent(target.id, 'veilborne_rpg', 'enemy_attack'), true)
  assert.equal(logic.listPackages(target.id)[0].variables.boss_phase, 3)
  assert.equal(logic.listPackages(target.id)[0].variables.ai_damage_multiplier, 1.45, 'boss phase scaling is configured by the declarative package script')

  assert.equal(logic.triggerPackageEvent(target.id, 'veilborne_rpg', 'enemy_killed'), true)
  assert.equal(logic.getVariable('ecos'), 100, 'boss reward is composed from a package script')
  assert.equal(logic.getVariable('nivel'), 2, 'the same generic script handles level thresholds')
  assert.equal(logic.getVariable('experiencia'), 50)
  assert.equal(logic.getVariable('experiencia_proximo_nivel'), 232)
  assert.equal(logic.getVariable('pontos_atributo'), 1)
  assert.equal(logic.triggerPackageEvent(target.id, 'veilborne_rpg', 'enemy_killed'), true)
  assert.equal(logic.getVariable('ecos'), 200, 'the reward rule is reusable for each defeat event')

  logic.setPackageVariable(instance.id, 'drop_item_id', 'echo_fragment')
  logic.setPackageVariable(instance.id, 'drop_chance', 1)
  logic.setPackageVariable(instance.id, 'drop_quantity', 2)
  assert.equal(logic.triggerPackageEvent(target.id, 'veilborne_rpg', 'enemy_killed'), true)
  const drop = [...objects.values()].find(object => object.id !== target.id)
  assert.ok(drop, 'enemy drop is assembled by the generic world and package APIs')
  assert.equal(drop.mesh.geometry.type, 'OctahedronGeometry')
  const dropPackage = logic.listPackages(drop.id).find(item => item.packageId === 'veilborne_rpg')
  assert.ok(dropPackage)
  assert.equal(dropPackage.variables.entity_role, 'loot')
  assert.equal(dropPackage.variables.loot_item_id, 'echo_fragment')
  assert.equal(dropPackage.variables.loot_quantity, 2)
  assert.equal(dropPackage.variables.loot_spawned, true)

  const globalRules = logic.list().filter(rule => rule.sourcePackageDefinitionId === 'veilborne_rpg')
  assert.ok(globalRules.some(rule => rule.trigger.type === 'global_event' && rule.trigger.eventId === 'veilborne:player_died'))
  assert.ok(globalRules.some(rule => rule.trigger.type === 'global_event' && rule.trigger.eventId === 'veilborne:respawn_requested'))
  assert.ok(globalRules.some(rule => rule.trigger.type === 'global_event' && rule.trigger.eventId === 'veilborne:restore_echo_cache'))

  logic.setVariable('ecos', 75)
  assert.equal(logic.triggerGlobalEvent('veilborne:player_died', { avatarX: 4, avatarY: 0, avatarZ: -2 }), true)
  assert.equal(logic.getVariable('ecos'), 0)
  assert.equal(logic.getVariable('ecos_perdidos'), 75)
  assert.equal(logic.getVariable('ponto_de_morte_x'), 4)
  let cache = logic.listPackages().find(item => item.packageId === 'veilborne_rpg' && item.variables.entity_role === 'echo_cache')
  assert.ok(cache, 'the global death script creates an Echo cache through generic object/package APIs')
  assert.deepEqual([objects.get(cache.ownerObjectId).mesh.position.x, objects.get(cache.ownerObjectId).mesh.position.z], [4, -2])

  const cacheId = cache.ownerObjectId
  world.remove(cacheId)
  logic.removeObjectVariables(cacheId)
  assert.equal(logic.triggerGlobalEvent('veilborne:restore_echo_cache'), true)
  cache = logic.listPackages().find(item => item.packageId === 'veilborne_rpg' && item.variables.entity_role === 'echo_cache')
  assert.ok(cache, 'saved lost Echoes recreate their cache through a global script')
  assert.equal(cache.variables.echoes_amount, 75)

  assert.equal(logic.triggerGlobalEvent('veilborne:respawn_requested', {
    defaultSpawnX: 10, defaultSpawnY: 2, defaultSpawnZ: -8,
  }), true)
  assert.deepEqual([
    logic.getVariable('respawn_x'),
    logic.getVariable('respawn_y'),
    logic.getVariable('respawn_z'),
  ], [10, 2, -8])
  assert.equal(logic.getVariable('vida'), logic.getVariable('vida_max'))
  assert.equal(logic.getVariable('ecos_perdidos'), 75, 'respawning does not collect the Echo cache')
} finally {
  unregister()
}

console.log('VEILBORNE reward script composition self-test passed.')
