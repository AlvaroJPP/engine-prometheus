import assert from 'node:assert/strict'
import { InteractionTargetSelector } from '../engine/script/InteractionTargetSelector.ts'

const selector = new InteractionTargetSelector()
const origin = { x: 0, y: 0, z: 0 }
const targets = [
  { id: 'near', position: { x: 1, y: 0, z: 0 } },
  { id: 'important', position: { x: 2, y: 0, z: 0 }, priority: 2 },
  { id: 'disabled', position: { x: 0, y: 0, z: 0 }, enabled: false, priority: 99 },
  { id: 'blocked', position: { x: 0.5, y: 0, z: 0 } },
  { id: 'far', position: { x: 20, y: 0, z: 0 } },
]
const selected = selector.select(origin, targets, {
  maxDistance: 3,
  lineOfSight: (_origin, target) => target.id !== 'blocked',
})
assert.equal(selected?.target.id, 'important')
assert.equal(selected?.distance, 2)
assert.equal(selector.select(origin, targets, { maxDistance: 3, canInteract: target => target.id === 'near' })?.target.id, 'near')
assert.equal(selector.select(origin, targets, { maxDistance: -1 }), null)
assert.equal(selector.select({ x: NaN, y: 0, z: 0 }, targets, { maxDistance: 5 }), null)
console.log('Interaction target selector self-test passed.')
