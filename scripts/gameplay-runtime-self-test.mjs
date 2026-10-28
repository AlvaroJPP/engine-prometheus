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
gameplay.entities.defineComponent('runtime-test')
gameplay.entities.defineComponent('deferred-test')
const queryCalls = []
const runtimeQuery = gameplay.queries.create('runtime-test-query', { allOf: ['runtime-test'] })
const deferredEvents = []
const deferredQuery = gameplay.queries.create('deferred-test-query', { allOf: ['deferred-test'] })
deferredQuery.subscribe(event => deferredEvents.push([event.type, event.entityId]))
runtimeQuery.subscribe(event => queryCalls.push([event.type, event.entityId]))
gameplay.entities.create('player')
gameplay.entities.addComponent('player', 'runtime-test', { ready: true })
const systemCalls = []
gameplay.systems.register({
  id: 'generic-runtime-test-system',
  requiredComponents: ['runtime-test'],
  onEntityEnter: (id, context) => systemCalls.push(['enter', id, context.runtime === gameplay]),
  updateEntity: (dt, id, context) => systemCalls.push(['update', dt, id, context.runtime === gameplay]),
  onEntityExit: (id, context) => systemCalls.push(['exit', id, context.runtime.world.get(id) !== undefined]),
})
const entityBehaviorTicks = []
let queuedDeferredEntity = false
gameplay.behaviors.add('player', {
  id: 'generic-test-behavior',
  update: (dt, context) => {
    entityBehaviorTicks.push([dt, context.entityId, context.runtime === gameplay])
    if (!queuedDeferredEntity) {
      queuedDeferredEntity = true
      gameplay.commands.createEntity('deferred-entity')
      gameplay.commands.addComponent('deferred-entity', 'deferred-test', { ready: true })
    }
  },
})
gameplay.start()

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
assert.equal(gameplay.entities.get('deferred-entity'), undefined, 'queued entity changes should wait for the frame flush')
const update = gameplay.update(1)
assert.deepEqual(update.statusEvents.map(event => event.type), ['tick'])
assert.deepEqual(update.triggerEvents.map(event => [event.type, event.subjectId]), [['enter', 'player']])
assert.deepEqual(update.commandReport, { commandCount: 2, appliedCount: 2, skippedCount: 0, failures: [] })
assert.deepEqual(gameplay.entities.getComponent('deferred-entity', 'deferred-test'), { ready: true })
assert.deepEqual(deferredEvents, [['enter', 'deferred-entity']])
assert.equal(gameplay.cooldowns.isReady('player::dash'), false)
assert.deepEqual(systemCalls, [
  ['enter', 'player', true],
  ['update', 1, 'player', true],
])
assert.deepEqual(entityBehaviorTicks, [[1, 'player', true]])
assert.deepEqual(queryCalls, [['enter', 'player']])
assert.equal(runtimeQuery.has('player'), true)

const cleanup = gameplay.removeEntity('player')
assert.deepEqual(cleanup, {
  entityRemoved: true,
  componentEntityRemoved: true,
  behaviorsRemoved: 1,
  resourcePoolsRemoved: 1,
  statusEffectsRemoved: 1,
  cooldownsCanceled: 1,
})
assert.equal(gameplay.world.tags.has('player', 'ready'), false)
assert.equal(gameplay.world.get('player'), undefined)
assert.equal(gameplay.resources.get('player', 'energy'), undefined)
assert.equal(gameplay.statuses.has('player', 'regeneration'), false)
assert.equal(gameplay.cooldowns.isReady('player::dash'), true)
assert.deepEqual(systemCalls.at(-1), ['exit', 'player', true], 'system cleanup should run before the indexed world entity is removed')
assert.deepEqual(queryCalls, [['enter', 'player'], ['exit', 'player']])
assert.equal(runtimeQuery.has('player'), false)
assert.equal(gameplay.removeEntity('player').entityRemoved, false)
dispose()
runtimeQuery.dispose()
deferredQuery.dispose()
gameplay.commands.createEntity('pending-cleanup')
gameplay.clear()
assert.equal(gameplay.commands.pendingCount, 0)
assert.equal(gameplay.entities.get('pending-cleanup'), undefined)
assert.equal(gameplay.world.size, 0)
assert.equal(gameplay.objectives.size, 0)
console.log('Gameplay runtime composition self-test passed.')
