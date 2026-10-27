import assert from 'node:assert/strict'
import { GameplayRuntime } from '../engine/runtime/GameplayRuntime.ts'
import { BehaviorTreeHandlerRegistry } from '../engine/script/BehaviorTreeHandlerRegistry.ts'
import { BehaviorTreeRuntime } from '../engine/script/BehaviorTree.ts'

const gameplay = new GameplayRuntime({ cellSize: 2 })
gameplay.world.upsert({ id: 'player', x: 0, y: 0, z: 0 }, ['player'])
gameplay.world.upsert({ id: 'target', x: 1, y: 0, z: 0 }, ['target'])
gameplay.world.setTrigger({ id: 'spawn', shape: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 1, requiredTags: ['player'] })
const energy = gameplay.resources.create('player', 'energy', { current: 5, maximum: 5 })
gameplay.statuses.apply('player', 'regeneration', 2, { tickIntervalSeconds: 1 })
gameplay.cooldowns.start('player::dash', 3)
gameplay.objectives.register({ id: 'intro' })

const context = { ownerId: 'player' }
const registry = new BehaviorTreeHandlerRegistry()
const dispose = gameplay.registerBehaviorNodes(registry, {
  resolveOwnerId: value => value.ownerId,
  resolvePosition: value => {
    const item = gameplay.world.get(value.ownerId)
    return item ? { x: item.x, y: item.y, z: item.z } : null
  },
})
const tree = new BehaviorTreeRuntime(registry.createHandlers())
tree.setTree({
  id: 'root',
  type: 'sequence',
  children: [
    { id: 'cost', type: 'action', action: 'gameplay:resource_spend', parameters: { resourceId: 'energy', amount: 1 } },
    { id: 'tag', type: 'action', action: 'gameplay:tag_add', parameters: { tag: 'ready' } },
  ],
})
assert.equal(tree.tick(context, 0.016), 'success')
assert.equal(energy.current, 4)
const update = gameplay.update(1)
assert.deepEqual(update.statusEvents.map(event => event.type), ['tick'])
assert.deepEqual(update.triggerEvents.map(event => [event.type, event.subjectId]), [['enter', 'player']])
assert.equal(gameplay.cooldowns.isReady('player::dash'), false)

const cleanup = gameplay.removeEntity('player')
assert.deepEqual(cleanup, {
  entityRemoved: true,
  resourcePoolsRemoved: 1,
  statusEffectsRemoved: 1,
  cooldownsCanceled: 1,
})
assert.equal(gameplay.world.tags.has('player', 'ready'), false)
assert.equal(gameplay.world.get('player'), undefined)
assert.equal(gameplay.resources.get('player', 'energy'), undefined)
assert.equal(gameplay.statuses.has('player', 'regeneration'), false)
assert.equal(gameplay.cooldowns.isReady('player::dash'), true)
assert.equal(gameplay.removeEntity('player').entityRemoved, false)
dispose()
gameplay.clear()
assert.equal(gameplay.world.size, 0)
assert.equal(gameplay.objectives.size, 0)
console.log('Gameplay runtime composition self-test passed.')
