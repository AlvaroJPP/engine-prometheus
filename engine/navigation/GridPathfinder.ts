export interface NavigationPoint {
  x: number
  z: number
}

export interface GridPathfinderOptions {
  /** Bounds of the navigable plane, in world units. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Distance between adjacent cell centers. */
  cellSize: number
  /** Return false for cells that cannot be occupied by an agent. */
  isWalkable: (point: NavigationPoint, cell: { x: number; z: number }) => boolean
  /** Allow diagonal steps. Corner-cutting is prevented. Defaults to true. */
  allowDiagonal?: boolean
  /** Hard limit protects the frame from unbounded searches. Defaults to 20000. */
  maxVisitedNodes?: number
  /** Simplify the result by skipping intermediate points when lineOfSight accepts them. */
  lineOfSight?: (from: NavigationPoint, to: NavigationPoint) => boolean
}

export interface GridPathfinderResult {
  path: NavigationPoint[]
  visitedNodes: number
  reached: boolean
}

interface Cell {
  x: number
  z: number
}

interface OpenNode extends Cell {
  g: number
  h: number
  f: number
  order: number
}

const keyOf = ({ x, z }: Cell): string => `${x},${z}`
const distance = (a: NavigationPoint, b: NavigationPoint): number =>
  Math.hypot(b.x - a.x, b.z - a.z)

function compareNodes(a: OpenNode, b: OpenNode): number {
  return a.f - b.f || a.h - b.h || a.order - b.order
}

/**
 * Bounded A* pathfinder for a generic XZ navigation grid.
 * It has no dependency on Three.js, a particular game, or a specific world model.
 */
export class GridPathfinder {
  findPath(
    start: NavigationPoint,
    goal: NavigationPoint,
    options: GridPathfinderOptions,
  ): GridPathfinderResult {
    this.validate(start, 'start')
    this.validate(goal, 'goal')
    const { bounds, cellSize, isWalkable } = options
    if (
      !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)
      || !Number.isFinite(bounds.minZ) || !Number.isFinite(bounds.maxZ)
      || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ
    ) throw new Error('Navigation bounds must have finite, increasing limits.')
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error('Navigation cellSize must be a finite positive number.')
    }
    if (typeof isWalkable !== 'function') throw new Error('Navigation requires an isWalkable callback.')

    const maxVisitedNodes = options.maxVisitedNodes ?? 20000
    if (!Number.isInteger(maxVisitedNodes) || maxVisitedNodes < 1 || maxVisitedNodes > 500000) {
      throw new Error('maxVisitedNodes must be an integer between 1 and 500000.')
    }
    const startCell = this.toCell(start, bounds, cellSize)
    const goalCell = this.toCell(goal, bounds, cellSize)
    if (!startCell || !goalCell) return { path: [], visitedNodes: 0, reached: false }

    const startPoint = this.toPoint(startCell, bounds, cellSize)
    const goalPoint = this.toPoint(goalCell, bounds, cellSize)
    if (!isWalkable(startPoint, startCell) || !isWalkable(goalPoint, goalCell)) {
      return { path: [], visitedNodes: 0, reached: false }
    }

    const allowDiagonal = options.allowDiagonal !== false
    const offsets: Cell[] = allowDiagonal
      ? [
          { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
          { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: -1, z: -1 },
        ]
      : [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]

    const open: OpenNode[] = []
    const openKeys = new Set<string>()
    const closed = new Set<string>()
    const cameFrom = new Map<string, string>()
    const cells = new Map<string, Cell>([[keyOf(startCell), startCell]])
    const gScores = new Map<string, number>([[keyOf(startCell), 0]])
    let order = 0
    const heuristic = (cell: Cell): number => {
      const dx = Math.abs(goalCell.x - cell.x)
      const dz = Math.abs(goalCell.z - cell.z)
      return allowDiagonal ? Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) : dx + dz
    }
    const startKey = keyOf(startCell)
    open.push({ ...startCell, g: 0, h: heuristic(startCell), f: heuristic(startCell), order: order++ })
    openKeys.add(startKey)
    let visitedNodes = 0
    let reached = false

    while (open.length > 0 && visitedNodes < maxVisitedNodes) {
      open.sort(compareNodes)
      const current = open.shift()!
      const currentKey = keyOf(current)
      openKeys.delete(currentKey)
      if (closed.has(currentKey)) continue
      closed.add(currentKey)
      visitedNodes += 1

      if (currentKey === keyOf(goalCell)) {
        reached = true
        break
      }

      for (const offset of offsets) {
        const next = { x: current.x + offset.x, z: current.z + offset.z }
        const nextKey = keyOf(next)
        if (closed.has(nextKey)) continue
        const point = this.toPoint(next, bounds, cellSize)
        if (!point || !isWalkable(point, next)) continue

        const diagonal = offset.x !== 0 && offset.z !== 0
        if (diagonal) {
          const sideA = { x: current.x + offset.x, z: current.z }
          const sideB = { x: current.x, z: current.z + offset.z }
          const pointA = this.toPoint(sideA, bounds, cellSize)
          const pointB = this.toPoint(sideB, bounds, cellSize)
          if (!pointA || !pointB || !isWalkable(pointA, sideA) || !isWalkable(pointB, sideB)) continue
        }

        const tentative = current.g + (diagonal ? Math.SQRT2 : 1)
        if (tentative >= (gScores.get(nextKey) ?? Infinity)) continue
        cameFrom.set(nextKey, currentKey)
        gScores.set(nextKey, tentative)
        cells.set(nextKey, next)
        const h = heuristic(next)
        if (!openKeys.has(nextKey)) {
          open.push({ ...next, g: tentative, h, f: tentative + h, order: order++ })
          openKeys.add(nextKey)
        } else {
          const existing = open.find(node => keyOf(node) === nextKey)
          if (existing) {
            existing.g = tentative
            existing.h = h
            existing.f = tentative + h
          }
        }
      }
    }

    if (!reached) return { path: [], visitedNodes, reached: false }
    const reversed: NavigationPoint[] = []
    let cursor: string | undefined = keyOf(goalCell)
    while (cursor) {
      const cell = cells.get(cursor)
      if (!cell) break
      reversed.push(this.toPoint(cell, bounds, cellSize)!)
      if (cursor === startKey) break
      cursor = cameFrom.get(cursor)
    }
    if (reversed.length === 0 || keyOf(this.toCell(reversed[reversed.length - 1]!, bounds, cellSize)!) !== startKey) {
      return { path: [], visitedNodes, reached: false }
    }

    const path = reversed.reverse()
    const simplified = options.lineOfSight ? this.simplify(path, options.lineOfSight) : path
    return { path: simplified, visitedNodes, reached: true }
  }

  private simplify(
    path: NavigationPoint[],
    lineOfSight: (from: NavigationPoint, to: NavigationPoint) => boolean,
  ): NavigationPoint[] {
    if (path.length <= 2) return path
    const result: NavigationPoint[] = [path[0]!]
    let anchor = 0
    while (anchor < path.length - 1) {
      let furthest = anchor + 1
      for (let candidate = path.length - 1; candidate > anchor + 1; candidate -= 1) {
        if (lineOfSight(path[anchor]!, path[candidate]!)) {
          furthest = candidate
          break
        }
      }
      result.push(path[furthest]!)
      anchor = furthest
    }
    return result
  }

  private toCell(
    point: NavigationPoint,
    bounds: GridPathfinderOptions['bounds'],
    cellSize: number,
  ): Cell | null {
    if (
      point.x < bounds.minX || point.x > bounds.maxX
      || point.z < bounds.minZ || point.z > bounds.maxZ
    ) return null
    return {
      x: Math.round((point.x - bounds.minX) / cellSize),
      z: Math.round((point.z - bounds.minZ) / cellSize),
    }
  }

  private toPoint(
    cell: Cell,
    bounds: GridPathfinderOptions['bounds'],
    cellSize: number,
  ): NavigationPoint | null {
    const point = {
      x: bounds.minX + cell.x * cellSize,
      z: bounds.minZ + cell.z * cellSize,
    }
    if (
      point.x < bounds.minX - 1e-8 || point.x > bounds.maxX + 1e-8
      || point.z < bounds.minZ - 1e-8 || point.z > bounds.maxZ + 1e-8
    ) return null
    return point
  }

  private validate(point: NavigationPoint, name: string): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      throw new Error(`Navigation ${name} coordinates must be finite numbers.`)
    }
  }
}
