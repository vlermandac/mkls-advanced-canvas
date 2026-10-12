// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Deterministic benchmark for SpatialObstacles vs the naive `obstacles.some(insideBBox)` scan used
// by A* obstacle tests. Measures build time, query time and insideBBox evaluations (candidate
// checks) for 10k boxes and 100k points, and verifies identical answers. Pure Node; it does not
// measure A* itself, Obsidian, DOM or routing geometry.
// Usage (after bundling with esbuild): node routing-benchmark.cjs [boxes] [points]
import { performance } from 'node:perf_hooks'
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

const boxCount = Number(process.argv[2] ?? 10_000), pointCount = Number(process.argv[3] ?? 100_000)

/** Canvas-like layout: grid of 250×80 text nodes (400×200 spacing) plus optional large groups. */
function obstaclesFor(scenario: 'grid' | 'grid+groups', next: () => number): BBox[] {
  const columns = Math.ceil(Math.sqrt(boxCount))
  const boxes: BBox[] = []
  for (let i = 0; i < boxCount; i++) {
    const x = (i % columns) * 400, y = Math.floor(i / columns) * 200
    boxes.push({ minX: x, minY: y, maxX: x + 250, maxY: y + 80 })
  }
  if (scenario === 'grid+groups') {
    // 1% group boxes spanning 5×5 nodes (~ 8×4 cells) and a few giant ones (> 64 cells → fallback)
    for (let i = 0; i < boxCount / 100; i++) {
      const x = Math.floor(next() * columns) * 400 - 40, y = Math.floor(next() * (boxCount / columns)) * 200 - 60
      boxes.push({ minX: x, minY: y, maxX: x + 1930, maxY: y + 960 })
    }
    for (let i = 0; i < 5; i++) {
      const x = next() * columns * 400, y = next() * (boxCount / columns) * 200
      boxes.push({ minX: x, minY: y, maxX: x + 6000, maxY: y + 6000 })
    }
  }
  return boxes
}

/** A*-like points: half on the 12.5-unit routing grid near boxes, half uniform, plus exact borders. */
function pointsFor(boxes: BBox[], next: () => number): Position[] {
  const extent = { x: Math.ceil(Math.sqrt(boxCount)) * 400, y: Math.ceil(boxCount / Math.ceil(Math.sqrt(boxCount))) * 200 }
  const points: Position[] = []
  for (let i = 0; i < pointCount; i++) {
    if (i % 10 === 0) {
      const box = boxes[Math.floor(next() * boxes.length)]
      points.push({ x: next() < 0.5 ? box.minX : box.maxX, y: box.minY + next() * (box.maxY - box.minY) })
    } else if (i % 2 === 0) points.push({ x: Math.round(next() * extent.x / 12.5) * 12.5, y: Math.round(next() * extent.y / 12.5) * 12.5 })
    else points.push({ x: (next() - 0.05) * extent.x * 1.1, y: (next() - 0.05) * extent.y * 1.1 })
  }
  return points
}

function median(samples: number[]): number { return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] }

console.log(`# Routing obstacle benchmark — node ${process.version}, ${boxCount.toLocaleString('en')} boxes, ${pointCount.toLocaleString('en')} points × inclusive/exclusive`)
console.log('| scenario | build ms | buckets / entries / fallback | naive ms | indexed ms | speedup | naive checks/query | indexed checks/query | identical |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')

for (const scenario of ['grid', 'grid+groups'] as const) {
  const next = random(scenario === 'grid' ? 11 : 12)
  const boxes = obstaclesFor(scenario, next)
  const points = pointsFor(boxes, next)

  const builds: number[] = []
  let index = new SpatialObstacles(boxes)
  for (let i = 0; i < 5; i++) { const start = performance.now(); index = new SpatialObstacles(boxes); builds.push(performance.now() - start) }

  let naiveChecks = 0
  const naiveAnswers: boolean[] = []
  const naiveRun = () => {
    naiveAnswers.length = 0; naiveChecks = 0
    for (const point of points) for (const inclusive of [true, false]) {
      let hit = false
      for (const box of boxes) { naiveChecks++; if (BBoxHelper.insideBBox(point, box, inclusive)) { hit = true; break } }
      naiveAnswers.push(hit)
    }
  }
  const indexedAnswers: boolean[] = []
  const indexedRun = () => {
    indexedAnswers.length = 0; index.resetCounters()
    for (const point of points) for (const inclusive of [true, false]) indexedAnswers.push(index.contains(point, inclusive))
  }

  const naiveTimes: number[] = [], indexedTimes: number[] = []
  for (let run = 0; run < 3; run++) {
    let start = performance.now(); naiveRun(); naiveTimes.push(performance.now() - start)
    start = performance.now(); indexedRun(); indexedTimes.push(performance.now() - start)
  }
  const identical = naiveAnswers.length === indexedAnswers.length && naiveAnswers.every((answer, i) => answer === indexedAnswers[i])
  if (!identical) throw new Error(`answers differ in ${scenario}`)

  const queries = points.length * 2
  const naiveMs = median(naiveTimes), indexedMs = median(indexedTimes)
  console.log(`| ${scenario} (${boxes.length} boxes) | ${median(builds).toFixed(1)} | ${index.stats.cells} / ${index.stats.entries} / ${index.stats.fallback} | ${naiveMs.toFixed(0)} | ${indexedMs.toFixed(1)} | ${(naiveMs / indexedMs).toFixed(0)}× | ${(naiveChecks / queries).toFixed(0)} | ${(index.stats.checks / queries).toFixed(2)} | ${identical} (${naiveAnswers.filter(Boolean).length} hits) |`)
}
console.log('\nNaive checks stop at the first hit (as `.some` does). Times are medians of 3 runs; build is the median of 5.')
