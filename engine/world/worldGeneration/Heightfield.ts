import { clamp } from '../../lib/math'
import { fbm } from './noise'

export const TERRAIN_SIZE = 100
export const TERRAIN_SEGMENTS = 100
export const TERRAIN_VERTS_PER_SIDE = TERRAIN_SEGMENTS + 1
export const TERRAIN_VERTS = TERRAIN_VERTS_PER_SIDE * TERRAIN_VERTS_PER_SIDE
export const DEFAULT_SEED = 1337

const MIN_EDIT = -12
const MAX_EDIT = 30
const STEP = TERRAIN_SIZE / TERRAIN_SEGMENTS
const HALF = TERRAIN_SIZE / 2

/**
 * Mapa de alturas: relevo procedural (determinístico pela semente) + edições do usuário.
 * Só as edições são salvas no projeto; o relevo base é regenerado a partir da semente.
 */
export class Heightfield {
  seed = DEFAULT_SEED
  private base = new Float32Array(TERRAIN_VERTS)
  private edits = new Float32Array(TERRAIN_VERTS)

  constructor(seed = DEFAULT_SEED) {
    this.reset(seed, [])
  }

  reset(seed: number, edits: ReadonlyArray<readonly [number, number]>): void {
    this.seed = seed
    this.edits.fill(0)
    const n = TERRAIN_VERTS_PER_SIDE
    for (let iy = 0; iy < n; iy += 1) {
      for (let ix = 0; ix < n; ix += 1) {
        const i = iy * n + ix
        this.base[i] = seed === 0 ? 0 : (fbm(ix * 0.035, iy * 0.035, seed) - 0.5) * 5
      }
    }
    for (const [index, delta] of edits) {
      if (Number.isInteger(index) && index >= 0 && index < TERRAIN_VERTS && Number.isFinite(delta)) {
        this.edits[index] = clamp(delta, MIN_EDIT, MAX_EDIT)
      }
    }
  }

  clearEdits(): void {
    this.edits.fill(0)
  }

  editCount(): number {
    let count = 0
    for (let i = 0; i < TERRAIN_VERTS; i += 1) if (Math.abs(this.edits[i] ?? 0) >= 0.0005) count += 1
    return count
  }

  /** Altura do vértice (ix, iy). */
  height(ix: number, iy: number): number {
    const i = iy * TERRAIN_VERTS_PER_SIDE + ix
    return (this.base[i] ?? 0) + (this.edits[i] ?? 0)
  }

  /** Posição no mundo do vértice. */
  static worldX(ix: number): number {
    return -HALF + ix * STEP
  }

  /** Altura em qualquer ponto (x, z) do mundo, por interpolação bilinear. */
  sample(x: number, z: number): number {
    const gx = clamp((x + HALF) / STEP, 0, TERRAIN_SEGMENTS)
    const gz = clamp((z + HALF) / STEP, 0, TERRAIN_SEGMENTS)
    const ix = Math.min(Math.floor(gx), TERRAIN_SEGMENTS - 1)
    const iz = Math.min(Math.floor(gz), TERRAIN_SEGMENTS - 1)
    const tx = gx - ix
    const tz = gz - iz
    const h00 = this.height(ix, iz)
    const h10 = this.height(ix + 1, iz)
    const h01 = this.height(ix, iz + 1)
    const h11 = this.height(ix + 1, iz + 1)
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
  }

  /** Eleva/rebaixa o terreno e informa o menor retângulo de vértices realmente alterados. */
  brushWithBounds(
    x: number,
    z: number,
    radius: number,
    amount: number,
  ): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
    if (![x, z, radius, amount].every(Number.isFinite) || radius <= 0 || amount === 0) return null
    const n = TERRAIN_VERTS_PER_SIDE
    const minX = Math.max(0, Math.floor((x - radius + HALF) / STEP))
    const maxX = Math.min(n - 1, Math.ceil((x + radius + HALF) / STEP))
    const minZ = Math.max(0, Math.floor((z - radius + HALF) / STEP))
    const maxZ = Math.min(n - 1, Math.ceil((z + radius + HALF) / STEP))
    let changed = false
    let changedMinX = n
    let changedMinZ = n
    let changedMaxX = -1
    let changedMaxZ = -1
    for (let iz = minZ; iz <= maxZ; iz += 1) {
      for (let ix = minX; ix <= maxX; ix += 1) {
        const d = Math.hypot(Heightfield.worldX(ix) - x, Heightfield.worldX(iz) - z)
        if (d >= radius) continue
        const t = 1 - (d / radius) ** 2
        const i = iz * n + ix
        const prev = this.edits[i] ?? 0
        const next = clamp(prev + amount * t * t, MIN_EDIT, MAX_EDIT)
        if (next !== prev) {
          this.edits[i] = next
          changed = true
          changedMinX = Math.min(changedMinX, ix)
          changedMinZ = Math.min(changedMinZ, iz)
          changedMaxX = Math.max(changedMaxX, ix)
          changedMaxZ = Math.max(changedMaxZ, iz)
        }
      }
    }
    return changed ? {
      minX: changedMinX,
      minZ: changedMinZ,
      maxX: changedMaxX,
      maxZ: changedMaxZ,
    } : null
  }

  /** Compatibilidade para chamadas que só precisam saber se algo mudou. */
  brush(x: number, z: number, radius: number, amount: number): boolean {
    return this.brushWithBounds(x, z, radius, amount) !== null
  }

  exportEdits(): Array<[number, number]> {
    const out: Array<[number, number]> = []
    for (let i = 0; i < TERRAIN_VERTS; i += 1) {
      const v = this.edits[i] ?? 0
      if (Math.abs(v) >= 0.0005) out.push([i, Math.round(v * 1000) / 1000])
    }
    return out
  }
}
