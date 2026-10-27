import assert from 'node:assert/strict'
import { CombatPackageRuntime } from '../engine/script/CombatPackageRuntime.ts'

const instance = {
  id: 'combat-package-test',
  packageId: 'combatant',
  ownerObjectId: 'guard-01',
  enabled: true,
  variables: {
    health: 100,
    max_health: 100,
    alive: true,
    stamina: 40,
    max_stamina: 60,
    posture: 80,
    max_posture: 100,
    resistance: 0,
    last_damage: 0,
    last_damage_type: '',
  },
  config: { resistances: { physical: 25 }, statuses: [] },
}
const events = []
const changed = []
const runtime = new CombatPackageRuntime({
  getPackages: () => [instance],
  emitChanged: ownerObjectId => changed.push(ownerObjectId),
  triggerEvent: (ownerObjectId, packageId, eventId) => {
    events.push({ ownerObjectId, packageId, eventId })
    return true
  },
})

const hit = runtime.damage('guard-01', {
  amount: 40,
  damageType: 'physical',
  postureDamage: 25,
  postureVariable: 'posture',
  maximumPostureVariable: 'max_posture',
})
assert.equal(hit.resourceDamage, 30)
assert.equal(instance.variables.health, 70)
assert.equal(instance.variables.posture, 100)
assert.equal(hit.postureBroken, true)
assert.equal(instance.variables.last_damage, 30)
assert.equal(instance.variables.last_damage_type, 'physical')
assert.ok(events.some(event => event.eventId === 'damaged'))
assert.ok(events.some(event => event.eventId === 'posture_broken'))

assert.equal(runtime.spend('guard-01', {
  resourceVariable: 'stamina',
  maximumResourceVariable: 'max_stamina',
  amount: 15,
}), true)
assert.equal(instance.variables.stamina, 25)
assert.equal(runtime.spend('guard-01', {
  resourceVariable: 'stamina',
  maximumResourceVariable: 'max_stamina',
  amount: 30,
}), false)

runtime.applyStatus('guard-01', { id: 'slow', remainingSeconds: 1, potency: 2, stacks: 1 })
runtime.applyStatus('guard-01', { id: 'slow', remainingSeconds: 2, potency: 3, stacks: 1 })
assert.equal(instance.config.statuses.length, 1)
assert.equal(instance.config.statuses[0].remainingSeconds, 2)
assert.equal(instance.config.statuses[0].stacks, 2)
runtime.update(0.5)
assert.equal(instance.config.statuses[0].remainingSeconds, 1.9, 'combat runtime caps simulation delta to 0.1 seconds')
runtime.update(0.1)
assert.equal(instance.config.statuses[0].remainingSeconds, 1.8)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
runtime.update(0.1)
assert.equal(instance.config.statuses.length, 0)
assert.ok(events.some(event => event.eventId === 'status_expired'))

// A target killed by the same generic action may later be restored.
runtime.damage('guard-01', { amount: 500, damageType: 'physical' })
assert.equal(instance.variables.health, 0)
assert.equal(instance.variables.alive, false)
const restored = runtime.restore('guard-01', {
  resourceVariable: 'health',
  maximumResourceVariable: 'max_health',
  amount: 25,
})
assert.equal(restored, 25)
assert.equal(instance.variables.health, 25)
assert.equal(instance.variables.alive, true)
assert.ok(events.some(event => event.eventId === 'revived'))
assert.ok(changed.every(id => id === 'guard-01'))

console.log('Generic combat package runtime self-test passed.')
