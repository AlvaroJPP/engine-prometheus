import assert from 'node:assert/strict'
import { CooldownScheduler } from '../engine/runtime/CooldownScheduler.ts'
import { ResourcePoolRegistry } from '../engine/runtime/ResourcePoolRegistry.ts'
import { StatusEffectRuntime } from '../engine/runtime/StatusEffectRuntime.ts'
import { GameplayWorldSystems } from '../engine/world/GameplayWorldSystems.ts'
import { BehaviorTreeRuntime } from '../engine/script/BehaviorTree.ts'
import { BehaviorTreeHandlerRegistry } from '../engine/script/BehaviorTreeHandlerRegistry.ts'
import { ObjectiveTracker } from '../engine/script/ObjectiveTracker.ts'
import { registerGameplayBehaviorNodes } from '../engine/script/GameplayBehaviorExtensions.ts'

const context = { ownerId: 'player' }
const resources = new ResourcePoolRegistry()
const energy = resources.create('player', 'energy', { current: 10, maximum: 10 })
const world = new GameplayWorldSystems(2)
world.upsert({ id: 'player', x: 0, y: 0, z: 0 }, ['player'])
world.upsert({ id: 'enemy', x: 1, y: 0, z: 0 }, ['enemy', 'alive'])
world.setTrigger({ id: 'safe-zone', shape: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 1, requiredTags: ['player'] })
assert.deepEqual(world.updateTriggers().map(event => event.type), ['enter'])

const statuses = new StatusEffectRuntime()
const objectives = new ObjectiveTracker()
objectives.register({ id: 'collect', requiredProgress: 2 })
objectives.register({ id: 'deliver', prerequisites: ['collect'] })
const cooldowns = new CooldownScheduler()
const registry = new BehaviorTreeHandlerRegistry()
const dispose = registerGameplayBehaviorNodes(registry, {
  resources, world, statuses, objectives, cooldowns,
  resolveOwnerId: value => value.ownerId,
  resolvePosition: value => {
    const entity = world.get(value.ownerId)
    return entity ? { x: entity.x, y: entity.y, z: entity.z } : null
  },
})
const handlers = registry.createHandlers()
const runtime = new BehaviorTreeRuntime(handlers)
runtime.setTree({
  id: 'root',
  type: 'sequence',
  children: [
    { id: 'enough-energy', type: 'condition', condition: 'gameplay:resource_at_least', parameters: { resourceId: 'energy', amount: 8 } },
    { id: 'near-enemy', type: 'condition', condition: 'gameplay:nearby_tagged', parameters: { tag: 'enemy', radius: 3 } },
    { id: 'inside-zone', type: 'condition', condition: 'gameplay:inside_trigger', parameters: { triggerId: 'safe-zone' } },
    { id: 'cooldown-ready', type: 'condition', condition: 'gameplay:cooldown_ready', parameters: { cooldownId: 'burst' } },
    { id: 'spend-energy', type: 'action', action: 'gameplay:resource_spend', parameters: { resourceId: 'energy', amount: 2 } },
    { id: 'mark-tag', type: 'action', action: 'gameplay:tag_add', parameters: { tag: 'charged' } },
    { id: 'apply-status', type: 'action', action: 'gameplay:status_apply', parameters: { effectId: 'focus', duration: 3, stackPolicy: 'stack', maxStacks: 2, tickInterval: 1 } },
    { id: 'progress-one', type: 'action', action: 'gameplay:objective_progress', parameters: { objectiveId: 'collect', amount: 1 } },
    { id: 'progress-two', type: 'action', action: 'gameplay:objective_progress', parameters: { objectiveId: 'collect', amount: 1 } },
    { id: 'start-cooldown', type: 'action', action: 'gameplay:cooldown_start', parameters: { cooldownId: 'burst', duration: 2 } },
    { id: 'check-tag', type: 'condition', condition: 'gameplay:has_tag', parameters: { tag: 'charged' } },
    { id: 'check-status', type: 'condition', condition: 'gameplay:status_stacks_at_least', parameters: { effectId: 'focus', stacks: 1 } },
    { id: 'check-objective', type: 'condition', condition: 'gameplay:objective_completed', parameters: { objectiveId: 'collect' } },
    { id: 'restore-energy', type: 'action', action: 'gameplay:resource_restore', parameters: { resourceId: 'energy', amount: 1 } },
  ],
})
assert.equal(runtime.tick(context, 0.016), 'success')
assert.equal(energy.current, 9, 'behavior actions can spend and restore registered resources')
assert.equal(world.tags.has('player', 'charged'), true)
assert.equal(statuses.get('player', 'focus')?.stacks, 1)
assert.equal(objectives.getState('collect'), 'completed')
assert.equal(objectives.getState('deliver'), 'active')
assert.equal(cooldowns.isReady('player::burst'), false)
assert.equal(handlers.condition('gameplay:cooldown_ready', { cooldownId: 'burst' }, context), false)
assert.equal(handlers.action('gameplay:status_remove', { effectId: 'missing' }, context), 'failure')
assert.deepEqual(statuses.update(1).map(event => event.type), ['tick'])
cooldowns.update(2)
assert.equal(handlers.condition('gameplay:cooldown_ready', { cooldownId: 'burst' }, context), true)
assert.equal(handlers.action('gameplay:objective_progress', { objectiveId: 'missing', amount: 1 }, context), 'failure')
dispose()
assert.equal(registry.hasAction('gameplay:resource_spend'), false)
console.log('Gameplay behavior extensions integration self-test passed.')
