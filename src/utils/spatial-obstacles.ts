// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Bounded uniform-grid index over obstacle boxes for point containment queries. `contains` returns
// exactly `obstacles.some(o => BBoxHelper.insideBBox(point, o, inclusive))` for the boxes given to
// the constructor; it only reduces how many boxes are tested.
//
// Correctness: a box is bucketed into every cell floor(minX/s)..floor(maxX/s) × floor(minY/s)..
// floor(maxY/s) inclusive. Division by a positive constant and floor are monotonic in IEEE-754, so
// minX ≤ x ≤ maxX implies the point's cell lies in that range: border, corner and negative points
// cannot be missed. Boxes that are non-finite, inverted (min > max), span more than
// `maxCellsPerObstacle` cells, or would exceed `maxEntries` total bucket entries go to a fallback
// list that every query tests exactly, so memory stays bounded and semantics are unchanged. Cell
// bounds must be safe integers: beyond Number.MAX_SAFE_INTEGER, `x++` stops advancing (e.g. a
// coordinate of 1e20 at cell size 250), so such boxes also use the fallback list.
// Query points whose cell is not a safe integer skip the buckets (no bucketed box can contain them)
// and test the fallback.
//
// The index keeps references to the BBox objects; rebuild it when boxes change.
import type { BBox, Position } from 'src/@types/Canvas'
import BBoxHelper from './bbox-helper'

export interface SpatialObstaclesOptions {
  /** Cell edge length in canvas units (default 250). */
  cellSize?: number
  /** Boxes covering more cells than this go to the fallback list (default 64). */
  maxCellsPerObstacle?: number
  /** Maximum total bucket entries across all boxes (default 100,000). */
  maxEntries?: number
}

export interface SpatialObstaclesStats {
  obstacles: number
  bucketed: number
  fallback: number
  entries: number
  cells: number
  /** insideBBox evaluations performed by `contains` since construction (or last reset). */
  checks: number
  queries: number
}

export default class SpatialObstacles {
  readonly stats: SpatialObstaclesStats
  private readonly obstacles: readonly BBox[]
  private readonly cellSize: number
  /** Rows keyed by cell y, then cells keyed by cell x, holding obstacle indexes. */
  private readonly rows = new Map<number, Map<number, number[]>>()
  private readonly fallback: number[] = []

  constructor(obstacles: readonly BBox[], options: SpatialObstaclesOptions = {}) {
    const cellSize = options.cellSize ?? 250
    const maxCellsPerObstacle = options.maxCellsPerObstacle ?? 64
    const maxEntries = options.maxEntries ?? 100_000
    if (!(Number.isFinite(cellSize) && cellSize > 0)) throw new TypeError('cellSize must be a positive finite number')
    if (!(Number.isInteger(maxCellsPerObstacle) && maxCellsPerObstacle >= 1)) throw new TypeError('maxCellsPerObstacle must be a positive integer')
    if (!(Number.isInteger(maxEntries) && maxEntries >= 0)) throw new TypeError('maxEntries must be a non-negative integer')

    this.obstacles = obstacles.slice()
    this.cellSize = cellSize
    let entries = 0, cells = 0

    this.obstacles.forEach((box, index) => {
      const minX = Math.floor(box.minX / cellSize), maxX = Math.floor(box.maxX / cellSize)
      const minY = Math.floor(box.minY / cellSize), maxY = Math.floor(box.maxY / cellSize)
      // Safe-integer cells (also rejects NaN/±Infinity/precision-lost cells) and non-inverted boxes only.
      const bucketable = box.minX <= box.maxX && box.minY <= box.maxY &&
        Number.isSafeInteger(minX) && Number.isSafeInteger(maxX) && Number.isSafeInteger(minY) && Number.isSafeInteger(maxY)
      const count = bucketable ? (maxX - minX + 1) * (maxY - minY + 1) : Infinity
      if (count > maxCellsPerObstacle || entries + count > maxEntries) {
        this.fallback.push(index)
        return
      }

      entries += count
      for (let y = minY; y <= maxY; y++) {
        let row = this.rows.get(y)
        if (!row) this.rows.set(y, row = new Map<number, number[]>())
        for (let x = minX; x <= maxX; x++) {
          const bucket = row.get(x)
          if (bucket) bucket.push(index)
          else { row.set(x, [index]); cells++ }
        }
      }
    })

    this.stats = { obstacles: this.obstacles.length, bucketed: this.obstacles.length - this.fallback.length, fallback: this.fallback.length, entries, cells, checks: 0, queries: 0 }
  }

  /** Same result as `obstacles.some(o => BBoxHelper.insideBBox(point, o, inclusive))`. */
  contains(point: Position, inclusive: boolean): boolean {
    this.stats.queries++
    const cellX = Math.floor(point.x / this.cellSize), cellY = Math.floor(point.y / this.cellSize)
    if (Number.isSafeInteger(cellX) && Number.isSafeInteger(cellY)) {
      const bucket = this.rows.get(cellY)?.get(cellX)
      if (bucket) {
        for (const index of bucket) {
          this.stats.checks++
          if (BBoxHelper.insideBBox(point, this.obstacles[index], inclusive)) return true
        }
      }
    }
    for (const index of this.fallback) {
      this.stats.checks++
      if (BBoxHelper.insideBBox(point, this.obstacles[index], inclusive)) return true
    }
    return false
  }

  resetCounters(): void {
    this.stats.checks = 0
    this.stats.queries = 0
  }
}
