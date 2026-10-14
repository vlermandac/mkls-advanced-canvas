// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
// SpatialObstacles must answer exactly like the naive `obstacles.some(insideBBox)` scan.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BBox, Position } from '../src/@types/Canvas'
import BBoxHelper from '../src/utils/bbox-helper'
import SpatialObstacles from '../src/utils/spatial-obstacles'

function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const naive = (obstacles: BBox[], point: Position, inclusive: boolean) => obstacles.some(box => BBoxHelper.insideBBox(point, box, inclusive))

function assertEquivalent(obstacles: BBox[], points: Position[], index = new SpatialObstacles(obstacles), label = '') {
  for (const point of points) for (const inclusive of [true, false])
    assert.equal(index.contains(point, inclusive), naive(obstacles, point, inclusive), `${label} point ${JSON.stringify(point)} inclusive=${inclusive}`)
  return index
}

/** Points on and around every box edge, corner and centre, plus cell boundaries nearby. */
function borderPoints(obstacles: BBox[], cellSize = 250): Position[] {
  const points: Position[] = []
  for (const box of obstacles) {
    const xs = [box.minX, box.maxX, (box.minX + box.maxX) / 2, box.minX - 1e-9, box.maxX + 1e-9, box.minX + 1e-9, box.maxX - 1e-9]
    const ys = [box.minY, box.maxY, (box.minY + box.maxY) / 2, box.minY - 1e-9, box.maxY + 1e-9]
    for (const x of xs) for (const y of ys) points.push({ x, y })
    const cellX = Math.floor(box.minX / cellSize) * cellSize, cellY = Math.floor(box.minY / cellSize) * cellSize
    points.push({ x: cellX, y: cellY }, { x: cellX + cellSize, y: box.minY }, { x: box.minX, y: cellY + cellSize })
  }
  return points
}

describe('SpatialObstacles', () => {
  it('matches the naive scan on random canvas-like boxes, including all borders and negative coordinates', () => {
    const next = random(1)
    const obstacles: BBox[] = Array.from({ length: 2000 }, () => {
      const minX = Math.round((next() - 0.5) * 40_000), minY = Math.round((next() - 0.5) * 40_000)
      return { minX, minY, maxX: minX + Math.round(next() * 600), maxY: minY + Math.round(next() * 300) }
    })
    const points: Position[] = [
      ...Array.from({ length: 20_000 }, () => ({ x: (next() - 0.5) * 41_000, y: (next() - 0.5) * 41_000 })),
      ...borderPoints(obstacles.slice(0, 300)),
    ]
    const index = assertEquivalent(obstacles, points)
    assert.equal(index.stats.fallback, 0)
    assert.ok(index.stats.checks < points.length * 2 * 4, `few candidate checks (${index.stats.checks})`)
  })

  it('handles boxes aligned exactly to cell boundaries and zero-size boxes', () => {
    const obstacles: BBox[] = [
      { minX: 0, minY: 0, maxX: 250, maxY: 250 }, { minX: -250, minY: -250, maxX: 0, maxY: 0 },
      { minX: 500, minY: 500, maxX: 500, maxY: 500 }, { minX: -0, minY: -0, maxX: 0, maxY: 0 },
      { minX: 249.99999999999997, minY: 0, maxX: 250.00000000000003, maxY: 1 }, { minX: -1e-12, minY: -1e-12, maxX: 1e-12, maxY: 1e-12 },
    ]
    const points: Position[] = [
      ...borderPoints(obstacles),
      { x: 0, y: 0 }, { x: -0, y: -0 }, { x: 250, y: 250 }, { x: 250, y: 0 }, { x: 500, y: 500 }, { x: 500.0000001, y: 500 },
      { x: -250, y: -250 }, { x: -125, y: -0 }, { x: 249.99999999999997, y: 0.5 }, { x: 250.00000000000003, y: 1 },
    ]
    assertEquivalent(obstacles, points)
  })

  it('keeps exact semantics for invalid boxes and points through the fallback list', () => {
    const obstacles: BBox[] = [
      { minX: NaN, minY: 0, maxX: 10, maxY: 10 }, { minX: 0, minY: 0, maxX: Infinity, maxY: 10 },
      { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity }, { minX: 10, minY: 10, maxX: 0, maxY: 0 },
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    ]
    const points: Position[] = [
      { x: 5, y: 5 }, { x: 1e300, y: 5 }, { x: Infinity, y: 5 }, { x: -Infinity, y: -Infinity }, { x: NaN, y: 5 },
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: -1e300, y: 1e300 },
    ]
    const index = assertEquivalent(obstacles, points)
    assert.equal(index.stats.fallback, 4, 'non-finite and inverted boxes (even within one cell) use the fallback list')
    assert.equal(index.stats.bucketed, 1)
    const spanning = assertEquivalent([{ minX: 1000, minY: 0, maxX: 0, maxY: 10 }], points)
    assert.equal(spanning.stats.fallback, 1, 'an inverted box spanning cells has no bucket range and is tested exactly')
  })

  it('terminates and stays exact for finite coordinates beyond safe-integer cells (1e20)', () => {
    const obstacles: BBox[] = [
      { minX: 1e20, minY: 0, maxX: 1e20, maxY: 10 },            // cell 4e17: x++ would not advance
      { minX: 1e20, minY: 1e20, maxX: 1e20 + 1e5, maxY: 1e20 },  // both axes unsafe
      { minX: -1e20, minY: -5, maxX: 1e20, maxY: 5 },             // spans across zero
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 2 ** 53 * 250, minY: 0, maxX: 2 ** 53 * 250, maxY: 1 }, // first unsafe cell index
    ]
    const points: Position[] = [
      ...borderPoints(obstacles),
      { x: 1e20, y: 0 }, { x: 1e20, y: 10 }, { x: 1e20, y: 5 }, { x: 1e20, y: 1e20 }, { x: 1e20 + 1e5, y: 1e20 },
      { x: -1e20, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 6 }, { x: 5, y: 5 }, { x: 2 ** 53 * 250, y: 0.5 }, { x: 9e15, y: 0 },
    ]
    const index = assertEquivalent(obstacles, points)
    assert.equal(index.stats.fallback, 4, 'only the 0..10 box has safe bucket bounds')
    assert.equal(index.contains({ x: 1e20, y: 10 }, true), true, 'inclusive border')
    assert.equal(index.contains({ x: 1e20, y: 10 }, false), false, 'exclusive border')
  })

  it('routes giant boxes and entry overflow to the fallback list with bounded memory', () => {
    const next = random(2)
    const giants: BBox[] = [{ minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 }, { minX: 0, minY: 0, maxX: 2000, maxY: 2001 }]
    const small: BBox[] = Array.from({ length: 500 }, () => {
      const minX = Math.round((next() - 0.5) * 8000), minY = Math.round((next() - 0.5) * 8000)
      return { minX, minY, maxX: minX + 300, maxY: minY + 100 }
    })
    const obstacles = [...giants, ...small]
    const points = [...Array.from({ length: 5000 }, () => ({ x: (next() - 0.5) * 12_000, y: (next() - 0.5) * 12_000 })), ...borderPoints(giants)]

    const index = assertEquivalent(obstacles, points, new SpatialObstacles(obstacles), 'default caps')
    assert.equal(index.stats.fallback, 2, '1600-cell and 81-cell boxes exceed 64 cells')
    assert.ok(index.stats.entries <= 100_000)

    const capped = assertEquivalent(obstacles, points, new SpatialObstacles(obstacles, { maxEntries: 300 }), 'entry cap')
    assert.ok(capped.stats.entries <= 300)
    assert.equal(capped.stats.bucketed + capped.stats.fallback, obstacles.length)
    assert.ok(capped.stats.fallback > 2)

    const noBuckets = assertEquivalent(obstacles, points, new SpatialObstacles(obstacles, { maxEntries: 0 }), 'no buckets')
    assert.equal(noBuckets.stats.fallback, obstacles.length)
  })

  it('matches for other cell sizes and fractional coordinates', () => {
    const next = random(3)
    const obstacles: BBox[] = Array.from({ length: 400 }, () => {
      const minX = (next() - 0.5) * 3000, minY = (next() - 0.5) * 3000
      return { minX, minY, maxX: minX + next() * 400, maxY: minY + next() * 200 }
    })
    const points = [...Array.from({ length: 5000 }, () => ({ x: (next() - 0.5) * 3200, y: (next() - 0.5) * 3200 })), ...borderPoints(obstacles, 37.5)]
    for (const cellSize of [1, 37.5, 250, 10_000]) assertEquivalent(obstacles, points, new SpatialObstacles(obstacles, { cellSize }), `cell ${cellSize}`)
  })

  it('snapshots the obstacle array and validates options', () => {
    const obstacles: BBox[] = [{ minX: 0, minY: 0, maxX: 10, maxY: 10 }]
    const index = new SpatialObstacles(obstacles)
    obstacles.push({ minX: 100, minY: 100, maxX: 110, maxY: 110 })
    assert.equal(index.contains({ x: 105, y: 105 }, true), false, 'later array pushes are ignored')
    assert.equal(new SpatialObstacles([]).contains({ x: 0, y: 0 }, true), false)
    for (const options of [{ cellSize: 0 }, { cellSize: NaN }, { maxCellsPerObstacle: 0 }, { maxEntries: -1 }])
      assert.throws(() => new SpatialObstacles(obstacles, options), TypeError)
  })
})
