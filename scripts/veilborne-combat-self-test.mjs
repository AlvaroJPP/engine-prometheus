import assert from 'node:assert/strict'
import {
  applyVeilborneDamage,
  applyVeilborneStatus,
  calculateVeilborneSpellDamage,
  calculateVeilborneWeaponDamage,
  createVeilborneCombatant,
  isVeilborneParrySuccessful,
  restoreVeilborneResource,
  spendVeilborneResource,
  tickVeilborneStatuses,
  VEILBORNE_RUNTIME_SPELLS,
  VEILBORNE_RUNTIME_WEAPONS,
} from '../packages/veilborne/runtime/VeilborneCombat.ts'
import {
  BEHAVIOR_PACKAGE_DEFINITIONS,
  getBehaviorPackageDefinition,
} from '../engine/script/packages.ts'
import {
  registerVeilborneBehaviorPackage,
  VEILBORNE_BEHAVIOR_PACKAGE_DEFINITION,
} from '../packages/veilborne/runtime/behaviorPackageDefinition.ts'

const player = createVeilborneCombatant('test-player')
const quickWeapon = VEILBORNE_RUNTIME_WEAPONS.starter_arcane_sword
assert.ok(quickWeapon, 'the starter weapon must be available')
const quickDamage = calculateVeilborneWeaponDamage(quickWeapon, player.attributes)
const heavyDamage = calculateVeilborneWeaponDamage(quickWeapon, player.attributes, { heavy: true })
const criticalDamage = calculateVeilborneWeaponDamage(quickWeapon, player.attributes, { critical: true })
assert.ok(quickDamage > 0)
assert.ok(heavyDamage > quickDamage, 'a heavy attack must deal more damage than a quick attack')
assert.ok(criticalDamage > quickDamage, 'a critical attack must deal more damage than a regular attack')

const spell = VEILBORNE_RUNTIME_SPELLS.arcane_bolt
assert.ok(spell, 'the starter spell must be available')
assert.ok(calculateVeilborneSpellDamage(spell, player.attributes) >= spell.damage)

assert.equal(spendVeilborneResource(player, 'stamina', 25), true)
assert.equal(player.resources.stamina, 75)
assert.equal(spendVeilborneResource(player, 'stamina', 100), false)
assert.equal(player.resources.stamina, 75)
assert.equal(restoreVeilborneResource(player, 'stamina', 100), 25)
assert.equal(player.resources.stamina, player.resources.maxStamina)

const target = createVeilborneCombatant('test-target')
target.resistances.physical = 50
const hit = applyVeilborneDamage(target, { amount: 20, type: 'physical', postureDamage: 12 })
assert.equal(hit.vitalityDamage, 10, '50% resistance must halve physical damage')
assert.equal(target.resources.posture, 12)
assert.equal(hit.killed, false)

applyVeilborneStatus(target, {
  id: 'burn',
  potency: 2,
  remainingSeconds: 3,
  stacks: 1,
})
applyVeilborneStatus(target, {
  id: 'burn',
  potency: 3,
  remainingSeconds: 2,
  stacks: 1,
})
assert.equal(target.statuses[0]?.stacks, 2, 'reapplying a status must stack it')
assert.equal(target.statuses[0]?.potency, 3, 'the strongest potency must be retained')
tickVeilborneStatuses(target, 0.5)
assert.equal(target.statuses[0]?.remainingSeconds, 2.5)
assert.equal(target.resources.posture, 8, 'posture must recover at the configured rate')
assert.equal(isVeilborneParrySuccessful(10.15, 10, 0.2), true)
assert.equal(isVeilborneParrySuccessful(10.21, 10, 0.2), false)

assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), undefined)
const unregister = registerVeilborneBehaviorPackage()
assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), VEILBORNE_BEHAVIOR_PACKAGE_DEFINITION)
assert.ok(BEHAVIOR_PACKAGE_DEFINITIONS.includes(VEILBORNE_BEHAVIOR_PACKAGE_DEFINITION))
const unregisterDuplicate = registerVeilborneBehaviorPackage()
unregisterDuplicate()
assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), VEILBORNE_BEHAVIOR_PACKAGE_DEFINITION)
unregister()
assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), undefined)

console.log('VEILBORNE combat and optional package registration self-test passed.')
