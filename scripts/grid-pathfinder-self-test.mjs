import assert from 'node:assert/strict'
import { GridPathfinder } from '../engine/navigation/GridPathfinder.ts'

const pathfinder = new GridPathfinder()
const bounds = { minX: 0, maxX: 6, minZ: 0, maxZ: 6 }
const wall = (point) => !(point.x === 2 && point.z < 5)

const route = pathfinder.findPath(
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { bounds, cellSize: 1, isWalkable: wall },
)
assert.equal(route.reached, true)
assert.ok(route.visitedNodes > 0)
assert.deepEqual(route.path[0], { x: 0, z: 0 })
assert.deepEqual(route.path.at(-1), { x: 4, z: 0 })
assert.ok(route.path.some(point => point.z >= 5), 'route should go around the wall gap')

const blocked = pathfinder.findPath(
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  {
    bounds,
    cellSize: 1,
    isWalkable: point => !(point.x === 2),
    allowDiagonal: false,
  },
)
assert.equal(blocked.reached, false)
assert.deepEqual(blocked.path, [])

const cornerBlocked = pathfinder.findPath(
  { x: 0, z: 0 },
  { x: 1, z: 1 },
  {
    bounds,
    cellSize: 1,
    isWalkable: point => !(point.x === 1 && point.z === 0)
      && !(point.x === 0 && point.z === 1),
  },
)
assert.equal(cornerBlocked.reached, false, 'diagonal movement must not cut blocked corners')

const limited = pathfinder.findPath(
  { x: 0, z: 0 },
  { x: 6, z: 6 },
  { bounds, cellSize: 1, maxVisitedNodes: 1, isWalkable: () => true },
)
assert.equal(limited.reached, false)
assert.equal(limited.visitedNodes, 1)

const simplified = pathfinder.findPath(
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  {
    bounds,
    cellSize: 1,
    allowDiagonal: false,
    isWalkable: () => true,
    lineOfSight: () => true,
  },
)
assert.equal(simplified.path.length, 2, 'line-of-sight simplification should remove unnecessary waypoints')

assert.throws(() => pathfinder.findPath(
  { x: Number.NaN, z: 0 },
  { x: 1, z: 1 },
  { bounds, cellSize: 1, isWalkable: () => true },
), /finite numbers/)
assert.throws(() => pathfinder.findPath(
  { x: 0, z: 0 },
  { x: 1, z: 1 },
  { bounds, cellSize: 0, isWalkable: () => true },
), /cellSize/)

console.log('Grid pathfinder self-test passed.')
