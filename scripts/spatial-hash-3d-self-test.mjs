import assert from 'node:assert/strict'
import { SpatialHash3D } from '../engine/world/SpatialHash3D.ts'

const index = new SpatialHash3D(2)
const a = { id: 'a', x: 0, y: 0, z: 0 }
const b = { id: 'b', x: 1, y: 0, z: 0 }
const c = { id: 'c', x: -4, y: 0, z: 0 }
assert.equal(index.upsert(a), true)
index.upsert(b)
index.upsert(c)
assert.equal(index.size, 3)
assert.deepEqual(index.queryRadius({ x: 0, y: 0, z: 0 }, 1).map(result => result.item.id), ['a', 'b'])
assert.equal(index.queryNearest({ x: 0, y: 0, z: 0 }, 10, item => item.id === 'c')?.item.id, 'c')
assert.equal(index.upsert({ id: 'a', x: 20, y: 0, z: 0 }), true)
assert.deepEqual(index.queryRadius({ x: 0, y: 0, z: 0 }, 1).map(result => result.item.id), ['b'])
assert.equal(index.get('a')?.x, 20)
assert.equal(index.upsert({ id: 'bad', x: Number.NaN, y: 0, z: 0 }), false)
assert.equal(index.remove('c'), true)
assert.equal(index.remove('missing'), false)
index.clear()
assert.equal(index.size, 0)
console.log('Spatial hash 3D self-test passed.')
