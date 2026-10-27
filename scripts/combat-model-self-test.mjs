import assert from 'node:assert/strict'
import {
  applyCombatDamage,
  applyCombatStatus,
  createCombatActorState,
  updateCombatActor,
} from '../engine/script/CombatModel.ts'

const actor = createCombatActorState(
  'test-guard',
  { health: 100, maxHealth: 100, stamina: 40, maxStamina: 60, posture: 70, maxPosture: 100 },
  { strength: 12, will: 8 },
  { physical: 25 },
)
assert.equal(actor.alive, true)
const hit = applyCombatDamage(actor, {
  amount: 40,
  damageType: 'physical',
  resourceKey: 'health',
  maximumResourceKey: 'maxHealth',
  postureDamage: 35,
  postureResourceKey: 'posture',
  maximumPostureKey: 'maxPosture',
})
assert.equal(hit.resourceDamage, 30)
assert.equal(actor.resources.health, 70)
assert.equal(hit.postureBroken, true)
assert.equal(actor.resources.posture, 100)
assert.equal(hit.killed, false)

applyCombatStatus(actor, { id: 'slow', potency: 2, stacks: 1, remainingSeconds: 3 })
applyCombatStatus(actor, { id: 'slow', potency: 3, stacks: 1, remainingSeconds: 4 })
assert.equal(actor.statuses.length, 1)
assert.equal(actor.statuses[0].stacks, 2)
assert.equal(actor.statuses[0].potency, 3)
assert.equal(actor.statuses[0].remainingSeconds, 4)

updateCombatActor(actor, 0.5, {
  resourceRecoveryPerSecond: { stamina: 10 },
  resourceLimits: { stamina: 'maxStamina', posture: 'maxPosture' },
  postureResourceKey: 'posture',
  postureRecoveryPerSecond: 8,
})
assert.equal(actor.resources.stamina, 45)
assert.equal(actor.resources.posture, 96)
assert.equal(actor.statuses[0].remainingSeconds, 3.5)

const lethal = applyCombatDamage(actor, {
  amount: 1000,
  damageType: 'physical',
  resourceKey: 'health',
  maximumResourceKey: 'maxHealth',
})
assert.equal(lethal.killed, true)
assert.equal(actor.alive, false)
assert.equal(actor.resources.health, 0)
assert.equal(applyCombatDamage(actor, { amount: 10, damageType: 'physical' }).resourceDamage, 0)

console.log('Generic combat actor model self-test passed.')
