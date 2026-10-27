import assert from 'node:assert/strict'
import { TimedCombatActionScheduler } from '../engine/script/TimedCombatActionScheduler.ts'

const scheduler = new TimedCombatActionScheduler()
scheduler.startCooldown('attack:enemy-1', 0.25)
assert.equal(scheduler.canExecute('attack:enemy-1'), false)
assert.equal(scheduler.canExecute('attack:enemy-2'), true, 'cooldowns are isolated by action ID')

assert.deepEqual(scheduler.update(0.1), [])
assert.equal(scheduler.canExecute('attack:enemy-1'), false)
assert.deepEqual(scheduler.update(0.1), [])
assert.equal(scheduler.canExecute('attack:enemy-1'), false)
assert.deepEqual(scheduler.update(0.1), [])
assert.equal(scheduler.canExecute('attack:enemy-1'), true)

scheduler.schedule({ id: 'projectile-1', damage: 12 }, 0.15)
assert.equal(scheduler.pendingCount, 1)
assert.deepEqual(scheduler.update(0.1), [])
assert.deepEqual(scheduler.update(0.1), [{ id: 'projectile-1', damage: 12 }])
assert.equal(scheduler.pendingCount, 0)

scheduler.schedule('immediate', 0)
assert.deepEqual(scheduler.update(0), ['immediate'])
scheduler.schedule('cancelled', 1)
scheduler.startCooldown('attack:enemy-1', 5)

// Invalid durations must not silently remove cooldowns or trigger delayed actions.
scheduler.startCooldown('attack:enemy-1', Number.NaN)
scheduler.startCooldown('attack:enemy-1', Number.POSITIVE_INFINITY)
assert.equal(scheduler.canExecute('attack:enemy-1'), false)
const pendingBeforeInvalidSchedules = scheduler.pendingCount
scheduler.schedule('invalid-nan-delay', Number.NaN)
scheduler.schedule('invalid-infinite-delay', Number.POSITIVE_INFINITY)
assert.equal(scheduler.pendingCount, pendingBeforeInvalidSchedules)
assert.deepEqual(scheduler.update(0), [])

scheduler.clear()
assert.equal(scheduler.pendingCount, 0)
assert.equal(scheduler.canExecute('attack:enemy-1'), true)
assert.deepEqual(scheduler.update(1), [])

const bounded = new TimedCombatActionScheduler()
bounded.startCooldown('bounded', 0.2)
bounded.update(2)
assert.equal(bounded.canExecute('bounded'), false, 'large frame gaps advance by at most 0.1 seconds')
console.log('Generic timed combat action scheduler self-test passed.')
