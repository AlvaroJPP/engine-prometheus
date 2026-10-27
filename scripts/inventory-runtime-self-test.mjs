import assert from 'node:assert/strict'
import { InventoryRuntime } from '../engine/script/InventoryRuntime.ts'

let stored = JSON.stringify([
  { id: 'potion', quantity: 2 },
  { id: 'potion', quantity: 3 },
  { id: 'key', quantity: 1 },
  { id: 'unknown', quantity: 9 },
  null,
  { id: 'negative', quantity: -1 },
])
const inventory = new InventoryRuntime({
  readSerialized: () => stored,
  writeSerialized: value => { stored = value },
  isKnownItem: id => id !== 'unknown',
  maxStack: 10,
  maxGrantPerCall: 5,
})

assert.deepEqual(inventory.read(), [
  { id: 'potion', quantity: 5 },
  { id: 'key', quantity: 1 },
])
assert.equal(inventory.quantity('potion'), 5)
assert.equal(inventory.grant('potion', 3), true)
assert.equal(inventory.quantity('potion'), 8)
assert.equal(inventory.grant('potion', 50), true)
assert.equal(inventory.quantity('potion'), 10)
assert.equal(inventory.grant('potion', 1), false, 'a full stack cannot exceed its maximum')
assert.equal(inventory.grant('unknown', 1), false, 'a catalog guard can reject unknown IDs')
assert.equal(inventory.consume('potion', 4), true)
assert.equal(inventory.quantity('potion'), 6)
assert.equal(inventory.consume('potion', 99), false)
assert.equal(inventory.consume('missing', 1), false)
assert.equal(inventory.consume('key', 1), true)
assert.equal(inventory.quantity('key'), 0)

// Explicit invalid quantities must not be silently converted into a one-item operation.
const quantityBeforeInvalidOperations = inventory.quantity('potion')
for (const quantity of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(inventory.grant('potion', quantity), false, `invalid grant quantity: ${quantity}`)
  assert.equal(inventory.consume('potion', quantity), false, `invalid consume quantity: ${quantity}`)
}
assert.equal(inventory.quantity('potion'), quantityBeforeInvalidOperations)
assert.deepEqual(JSON.parse(stored), [{ id: 'potion', quantity: 6 }])

stored = '{not valid json'
assert.deepEqual(inventory.read(), [])
stored = '42'
assert.deepEqual(inventory.read(), [])
console.log('Generic inventory runtime self-test passed.')
