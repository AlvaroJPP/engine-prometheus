import assert from 'node:assert/strict'
import { ResourcePool } from '../engine/runtime/ResourcePool.ts'
import { InteractionRuntime } from '../engine/script/InteractionRuntime.ts'

const runtime = new InteractionRuntime()
const stamina = new ResourcePool({ current: 5, maximum: 5 })
const targets = [
  { id: 'door', position: { x: 1, y: 0, z: 0 }, priority: 1 },
  { id: 'chest', position: { x: 2, y: 0, z: 0 }, priority: 2 },
]
const base = {
  origin: { x: 0, y: 0, z: 0 },
  targets,
  maxDistance: 4,
  cooldownKey: 'interact:player',
  cooldownSeconds: 2,
  costs: [{ pool: stamina, amount: 3 }],
}
const rejected = runtime.attempt({ ...base, perform: () => false })
assert.equal(rejected.status, 'rejected')
assert.equal(stamina.current, 5, 'rejected interaction refunds resource costs')
assert.equal(runtime.cooldowns.isReady('interact:player'), true)

let performed = ''
const success = runtime.attempt({ ...base, perform: target => { performed = target.id; return true } })
assert.equal(success.status, 'interacted')
assert.equal(performed, 'chest', 'priority wins before distance')
assert.equal(stamina.current, 2)
assert.equal(runtime.attempt({ ...base, perform: () => true }).status, 'cooldown')
assert.equal(runtime.cooldowns.getRemaining('interact:player'), 2)

runtime.update(2)
assert.equal(runtime.attempt({ ...base, perform: () => true }).status, 'insufficient_resource')
assert.equal(stamina.current, 2)
stamina.restore(3)
assert.equal(runtime.attempt({ ...base, targets: [], perform: () => true }).status, 'no_target')
assert.equal(runtime.attempt({ ...base, cooldownSeconds: -1, perform: () => true }).status, 'invalid_configuration')
runtime.reset()
assert.equal(runtime.cooldowns.snapshot().length, 0)
console.log('Interaction runtime self-test passed.')
