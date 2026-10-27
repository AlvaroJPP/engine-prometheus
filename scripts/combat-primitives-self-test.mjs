import assert from 'node:assert/strict'
import {
  applyPercentageDiscount,
  calculateScaledMagnitude,
  clampFinite,
  isWithinTimeWindow,
  mergeTimedEffect,
  resolveResistedMagnitude,
  restoreResource,
  spendResource,
  tickTimedEffects,
} from '../engine/script/CombatPrimitives.ts'

assert.equal(clampFinite(Number.NaN, 0, 100, 20), 20)
assert.equal(clampFinite(125, 0, 100), 100)
assert.equal(calculateScaledMagnitude(10, { strength: 12, dexterity: 4 }, { strength: 2, dexterity: 0.5 }), 36)
assert.equal(calculateScaledMagnitude(10, { intellect: 8 }, { intellect: 3 }, [1.5]), 51)
assert.equal(resolveResistedMagnitude(20, 50), 10)
assert.equal(resolveResistedMagnitude(20, -50), 30)
assert.equal(resolveResistedMagnitude(20, 50, 2), 20)

assert.deepEqual(spendResource(80, 100, 30), { value: 50, changed: -30, accepted: true })
assert.deepEqual(spendResource(10, 100, 11), { value: 10, changed: 0, accepted: false })
assert.deepEqual(restoreResource(90, 100, 30), { value: 100, changed: 10, accepted: true })
assert.deepEqual(restoreResource(100, 100, 10), { value: 100, changed: 0, accepted: false })

const first = { id: 'burn', potency: 2, remainingSeconds: 3, stacks: 1, source: 'fire' }
const merged = mergeTimedEffect([first], { id: 'burn', potency: 5, remainingSeconds: 2, stacks: 2, source: 'spell' })
assert.equal(merged[0]?.potency, 5)
assert.equal(merged[0]?.remainingSeconds, 3)
assert.equal(merged[0]?.stacks, 3)
assert.equal(merged[0]?.source, 'fire', 'reapplication preserves existing metadata')
assert.equal(tickTimedEffects(merged, 0.5)[0]?.remainingSeconds, 2.5)
assert.equal(tickTimedEffects(merged, 3).length, 0)
assert.equal(isWithinTimeWindow(10.2, 10, 0.2), true)
assert.equal(isWithinTimeWindow(10.21, 10, 0.2), false)
assert.equal(isWithinTimeWindow(10, 10, -1), false)
assert.equal(applyPercentageDiscount(31, 0.2), 25)

console.log('Generic combat primitives self-test passed.')
