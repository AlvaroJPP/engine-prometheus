import assert from 'node:assert/strict'
import { EntityComponentRuntime } from '../engine/runtime/EntityComponentRuntime.ts'
import { EntityCommandBuffer } from '../engine/runtime/EntityCommandBuffer.ts'

interface Components {
  position: { x: number }
  flag: boolean
  fragile: boolean
  reentrant: boolean
  reentrantHook: boolean
}

const entities = new EntityComponentRuntime<Components>()
entities.defineComponent('position')
entities.defineComponent('flag')
entities.defineComponent('fragile', {
  onAttach: entityId => {
    if (entityId === 'broken') throw new Error('expected attach failure')
  },
})
entities.defineComponent('reentrant')
let nestedPlaybackError: unknown
let commands: EntityCommandBuffer<Components>
entities.defineComponent('reentrantHook', {
  onAttach: () => {
    try {
      commands.playback()
    } catch (error) {
      nestedPlaybackError = error
    }
  },
})
const failures = []
commands = new EntityCommandBuffer(entities, {
  onError: failure => failures.push({
    index: failure.commandIndex,
    type: failure.commandType,
    entityId: failure.entityId,
    message: failure.error.message,
  }),
})

commands.createEntity(' actor ')
commands.addComponent('actor', 'position', { x: 4 })
commands.setEnabled('actor', false)
assert.equal(entities.get('actor'), undefined, 'queued commands must not mutate storage before playback')
assert.equal(commands.pendingCount, 3)
assert.deepEqual(commands.playback(), {
  commandCount: 3,
  appliedCount: 3,
  skippedCount: 0,
  failures: [],
})
assert.deepEqual(entities.getComponent('actor', 'position'), { x: 4 })
assert.equal(entities.get('actor')?.enabled, false)
assert.equal(commands.pendingCount, 0)

commands.removeComponent('actor', 'flag')
commands.addComponent('actor', 'position', { x: 9 })
commands.destroyEntity('missing')
assert.deepEqual(commands.playback(), {
  commandCount: 3,
  appliedCount: 0,
  skippedCount: 3,
  failures: [],
}, 'commands that have no effect should be counted as skipped')

commands.createEntity('broken')
commands.addComponent('broken', 'fragile', true)
commands.addComponent('broken', 'flag', true)
const failedReport = commands.playback()
assert.equal(failedReport.commandCount, 3)
assert.equal(failedReport.appliedCount, 2)
assert.equal(failedReport.skippedCount, 0)
assert.equal(failedReport.failures.length, 1)
assert.equal(failedReport.failures[0].commandIndex, 1)
assert.equal(entities.hasComponent('broken', 'fragile'), false)
assert.equal(entities.hasComponent('broken', 'flag'), true)
assert.deepEqual(failures, [{
  index: 1,
  type: 'add-component',
  entityId: 'broken',
  message: 'expected attach failure',
}])

let queueFromCallback = true
const unsubscribe = entities.subscribe(event => {
  if (event.type === 'entity-created' && event.entity.id === 'first' && queueFromCallback) {
    queueFromCallback = false
    commands.createEntity('second')
  }
})
commands.createEntity('first')
const firstReport = commands.playback()
assert.equal(firstReport.appliedCount, 1)
assert.equal(entities.get('first')?.id, 'first')
assert.equal(entities.get('second'), undefined, 'commands queued during playback must wait for the next playback')
assert.equal(commands.pendingCount, 1)
assert.equal(commands.playback().appliedCount, 1)
assert.equal(entities.get('second')?.id, 'second')
unsubscribe()

commands.createEntity('nested')
commands.addComponent('nested', 'reentrantHook', true)
assert.equal(commands.playback().appliedCount, 2)
assert.match(String(nestedPlaybackError), /cannot be nested/i)

assert.throws(() => commands.createEntity('   '), /must not be empty/i)
assert.throws(() => commands.addComponent('actor', '', { x: 0 }), /not empty/i)
commands.createEntity('discarded')
commands.clear()
assert.equal(commands.pendingCount, 0)
assert.equal(entities.get('discarded'), undefined)
commands.dispose()
assert.throws(() => commands.createEntity('after-dispose'), /disposed/i)
assert.throws(() => commands.playback(), /disposed/i)
console.log('Entity command buffer self-test passed.')
