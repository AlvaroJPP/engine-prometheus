import assert from 'node:assert/strict'
import { EventBus } from '../engine/world/events/EventBus.ts'

interface TestEvents {
  value: { count: number }
  empty: undefined
}

const bus = new EventBus<TestEvents>()
const calls: string[] = []

const unsubscribeFirst = bus.on('value', ({ count }) => calls.push(`first:${count}`))
bus.on('value', ({ count }) => calls.push(`second:${count}`))
assert.equal(bus.listenerCount('value'), 2)

bus.emit('value', { count: 1 })
assert.deepEqual(calls, ['first:1', 'second:1'])

unsubscribeFirst()
unsubscribeFirst()
assert.equal(bus.listenerCount('value'), 1)
bus.emit('value', { count: 2 })
assert.deepEqual(calls, ['first:1', 'second:1', 'second:2'])

let onceCount = 0
bus.once('empty', () => { onceCount += 1 })
assert.equal(bus.listenerCount('empty'), 1)
bus.emit('empty', undefined)
bus.emit('empty', undefined)
assert.equal(onceCount, 1)
assert.equal(bus.listenerCount('empty'), 0)

const mutationBus = new EventBus<TestEvents>()
const mutationCalls: string[] = []
let unsubscribeLater = () => {}
mutationBus.on('empty', () => {
  mutationCalls.push('mutator')
  mutationBus.on('empty', () => mutationCalls.push('added'))
  unsubscribeLater()
})
unsubscribeLater = mutationBus.on('empty', () => mutationCalls.push('removed'))
mutationBus.emit('empty', undefined)
assert.deepEqual(mutationCalls, ['mutator'], 'listeners added mid-dispatch wait and removed listeners are skipped')
mutationBus.emit('empty', undefined)
assert.deepEqual(mutationCalls, ['mutator', 'mutator', 'added'], 'new listeners run on the next emission')

const clearBus = new EventBus<TestEvents>()
clearBus.on('value', () => calls.push('clear-value'))
clearBus.on('empty', () => calls.push('clear-empty'))
clearBus.clear('value')
assert.equal(clearBus.listenerCount('value'), 0)
assert.equal(clearBus.listenerCount('empty'), 1)
clearBus.clear()
assert.equal(clearBus.listenerCount('empty'), 0)
clearBus.emit('empty', undefined)
assert.equal(calls.includes('clear-empty'), false)

console.log('Event bus self-test passed.')
