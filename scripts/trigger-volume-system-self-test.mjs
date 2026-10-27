import assert from 'node:assert/strict'
import { TriggerVolumeSystem } from '../engine/world/TriggerVolumeSystem.ts'

const triggers = new TriggerVolumeSystem()
triggers.setVolume({
  id: 'camp',
  shape: 'sphere',
  center: { x: 0, y: 0, z: 0 },
  radius: 2,
  requiredTags: ['npc'],
})
const npc = { id: 'npc-1', position: { x: 1, y: 0, z: 0 }, tags: ['npc', 'friendly'] }
const rock = { id: 'rock', position: { x: 0, y: 0, z: 0 }, tags: ['prop'] }
assert.deepEqual(triggers.update([npc, rock]), [{ type: 'enter', triggerId: 'camp', subjectId: 'npc-1' }])
assert.deepEqual(triggers.update([npc]), [{ type: 'stay', triggerId: 'camp', subjectId: 'npc-1' }])
assert.deepEqual(triggers.getOccupants('camp'), ['npc-1'])
assert.deepEqual(triggers.update([{ ...npc, position: { x: 3, y: 0, z: 0 } }]), [{ type: 'exit', triggerId: 'camp', subjectId: 'npc-1' }])
triggers.setVolume({ id: 'box', shape: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } })
assert.deepEqual(triggers.update([{ id: 'player', position: { x: 0.5, y: 0, z: 0 } }]), [{ type: 'enter', triggerId: 'box', subjectId: 'player' }])
triggers.setVolume({ id: 'box', shape: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 }, enabled: false })
assert.deepEqual(triggers.update([{ id: 'player', position: { x: 0, y: 0, z: 0 } }]), [{ type: 'exit', triggerId: 'box', subjectId: 'player' }])
assert.deepEqual(triggers.removeVolume('box'), [])
assert.throws(() => triggers.setVolume({ id: 'invalid', shape: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: -1 }), /radius/)
console.log('Trigger volume system self-test passed.')
