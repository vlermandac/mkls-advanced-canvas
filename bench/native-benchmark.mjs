// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Deterministic native Obsidian Canvas benchmark, driven through the Obsidian CLI `eval` like
// tools/native-qa.mjs. The in-app part writes its report file directly; this driver polls for it.
//
// Usage:
//   node bench/native-benchmark.mjs --vault '<…/MKLS Canvas QA>' --mode fork|upstream|native \
//     [--shapes sparse,dense,grouped] [--sizes 100,1000,5000,10000] [--out <dir>] \
//     [--astar-percent 0] [--case-timeout-s 600] [--dry-run]
//
// --dry-run only generates fixtures + hashes into --out (no vault, no app). Fixtures written to the
// vault go to Bench/ and are retained, as are all reports. Run one benchmark at a time with the QA
// window visible and focused (requestAnimationFrame is throttled for hidden windows).
//
// Coverage limits (also written into every report):
// - Plain text nodes only: no images, PDFs, embeds, iframes or file nodes (media costs unmeasured).
// - A* routing is off unless --astar-percent > 0; native mode ignores pathfinding attributes.
// - "Load" is opening a file in an already running app, not a cold application start.
// - JS heap uses Chromium's non-standard performance.memory without forced GC: indicative only.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

const PLUGIN_IDS = { fork: 'mkls-advanced-canvas', upstream: 'advanced-canvas' }
const EDGES_PER_NODE = 3
const GROUP_BLOCK = 5 // grouped fixture: one group per 5×5 block of text nodes
const SEED = 20261012
const LIMITATIONS = [
  'Text nodes only, except the opt-in "media" shape: local deterministic SVG files and Markdown notes embedding them (no raster images, PDFs, video, iframes or remote content).',
  'A* routing only when --astar-percent > 0 and never in native mode; fork/upstream route dirty edges on render, so with A* edges load and drags include routing.',
  'Load is file open inside a running Obsidian, not a cold application start.',
  'JS heap is performance.memory (Chromium, non-standard) without forced GC; treat as indicative.',
  'Frame timings depend on monitor refresh rate, window size and focus; idle frame baseline is reported for normalization.',
]

// --- arguments and guards ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { shapes: 'sparse,dense,grouped', sizes: '100,1000,5000,10000', 'astar-percent': '0', 'case-timeout-s': '600' }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith('--')) throw Error(`Unexpected argument ${key}`)
    if (key === '--dry-run') args['dry-run'] = true
    else args[key.slice(2)] = argv[++i]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const dryRun = !!args['dry-run']
const mode = args.mode ?? 'fork'
if (!['fork', 'upstream', 'native'].includes(mode)) throw Error('--mode must be fork, upstream or native')
const shapes = args.shapes.split(',').filter(Boolean)
for (const shape of shapes) if (!['sparse', 'dense', 'grouped', 'media'].includes(shape)) throw Error(`Unknown shape ${shape}`)
const sizes = args.sizes.split(',').map(Number)
if (sizes.some(n => !Number.isInteger(n) || n <= 0)) throw Error('--sizes must be positive integers')
const astarPercent = Number(args['astar-percent'])
if (!(astarPercent >= 0 && astarPercent <= 100)) throw Error('--astar-percent must be within 0..100')
const caseTimeoutMs = Number(args['case-timeout-s']) * 1000
const runId = new Date().toISOString().replace(/[:.]/g, '-')

let vault = null
if (!dryRun) {
  if (!args.vault) throw Error('--vault is required (an isolated QA vault)')
  vault = resolve(args.vault)
  if (!basename(vault).includes('QA')) throw Error('Refusing: vault folder name must contain "QA"')
  if (!existsSync(join(vault, '.obsidian'))) throw Error('Refusing: not an existing Obsidian vault')
  if (!vault.split(sep).includes('evidence')) throw Error('Refusing: QA vault must live under an evidence/ directory')
  for (const forbidden of ['MKLS_Study', 'MKLS_Study_State', 'Markdown_Resources', 'Markdown_Resources.mkls'])
    if (vault.split(sep).includes(forbidden)) throw Error(`Refusing: ${forbidden} is not a QA vault`)
}
const outDir = resolve(args.out ?? (vault ? join(vault, '..', 'bench', `native-${mode}-${runId}`) : `.test-build/native-bench-${runId}`))
if (vault && !relative(vault, outDir).startsWith('..')) throw Error('Reports must not be written inside the vault')
mkdirSync(outDir, { recursive: true })

// --- deterministic fixtures -------------------------------------------------------------------

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOPICS = Array.from({ length: 20 }, (_, i) => `topic-${i}`)
const ROLES = ['uses', 'proves', 'generalizes', 'cites', 'contradicts']

const VIEWS = [
  { id: 'bench-topic', name: 'Bench topic', mode: 'nodes', nodes: { kind: 'condition', scope: 'properties', path: ['topic'], operator: 'equals', value: 'topic-3' } },
  { id: 'bench-nested', name: 'Bench nested', mode: 'nodes', nodes: { kind: 'all', conditions: [
    { kind: 'condition', scope: 'properties', path: ['level'], operator: 'gte', value: 4 },
    { kind: 'any', conditions: [
      { kind: 'condition', scope: 'properties', path: ['tags'], operator: 'contains', value: 'topic-1' },
      { kind: 'condition', scope: 'properties', path: ['updated'], operator: 'gt', value: '2023-06-30' },
    ] },
  ] } },
  { id: 'bench-edges', name: 'Bench edges', mode: 'edges',
    nodes: { kind: 'condition', scope: 'properties', path: ['level'], operator: 'lte', value: 7 },
    edges: { kind: 'condition', scope: 'properties', path: ['role'], operator: 'equals', value: 'proves' } },
]

function isoDay(next) {
  return new Date(Date.UTC(2020, 0, 1) + Math.floor(next() * 365 * 5) * 86_400_000).toISOString().slice(0, 10)
}

// Local media for the opt-in "media" shape: 8 SVGs and 8 Markdown notes embedding them.
const MEDIA_VARIANTS = 8
function mediaFiles() {
  const files = {}
  for (let k = 0; k < MEDIA_VARIANTS; k++) {
    const hue = k * 45
    files[`bench-shape-${k}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">` +
      `<rect width="240" height="160" fill="hsl(${hue},40%,85%)"/>` +
      Array.from({ length: 12 }, (_, i) => `<circle cx="${20 + i * 18}" cy="${80 + Math.round(40 * Math.sin(i + k))}" r="${6 + (i % 4) * 2}" fill="hsl(${(hue + i * 20) % 360},60%,45%)"/>`).join('') +
      `<text x="12" y="24" font-size="16" font-family="sans-serif">Bench ${k}</text></svg>\n`
    files[`bench-note-${k}.md`] = `---\ntopic: topic-${k}\nlevel: ${k + 1}\n---\n# Bench note ${k}\n\n![[bench-shape-${k}.svg]]\n\nLocal note with an embedded SVG, a [[bench-note-${(k + 1) % MEDIA_VARIANTS}]] link and $e^{i\\pi}+1=0$.\n`
  }
  return files
}

function generateFixture(shape, count) {
  const next = random(SEED + count * 7 + { sparse: 1, dense: 2, grouped: 3, media: 4 }[shape])
  const pick = list => list[Math.floor(next() * list.length)]
  const columns = Math.ceil(Math.sqrt(count))
  const spacing = shape === 'dense' ? { x: 300, y: 120 } : { x: 400, y: 200 }
  const nodes = []
  for (let i = 0; i < count; i++) {
    const column = i % columns, row = Math.floor(i / columns)
    const yaml = `topic: ${pick(TOPICS)}\nlevel: ${1 + Math.floor(next() * 10)}\nreviewed: ${next() < 0.5}\ntags: [${pick(TOPICS)}, ${pick(TOPICS)}]\nupdated: ${isoDay(next)}\n`
    const geometry = { x: column * spacing.x, y: row * spacing.y, width: 250, height: 80 }
    // media shape: every 4th node an SVG file node, every 4th+1 a Markdown note embedding an SVG
    if (shape === 'media' && i % 4 === 0) nodes.push({ id: `n${i}`, type: 'file', file: `Bench/media/bench-shape-${(i / 4) % MEDIA_VARIANTS}.svg`, ...geometry, height: 160, propertyGraph: { version: 1, yaml } })
    else if (shape === 'media' && i % 4 === 1) nodes.push({ id: `n${i}`, type: 'file', file: `Bench/media/bench-note-${((i - 1) / 4) % MEDIA_VARIANTS}.md`, ...geometry, height: 180, propertyGraph: { version: 1, yaml } })
    else nodes.push({ id: `n${i}`, type: 'text', text: `Node ${i}\n\nPlain benchmark text with **markdown** and $x^2$.`, ...geometry, propertyGraph: { version: 1, yaml } })
  }

  const edges = []
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < EDGES_PER_NODE; k++) {
      let target
      if (shape === 'dense') target = Math.floor(next() * count) // global, long and crossing edges
      else {
        const column = i % columns, row = Math.floor(i / columns)
        const targetColumn = Math.min(columns - 1, Math.max(0, column + Math.floor(next() * 7) - 3))
        const targetRow = Math.max(0, row + Math.floor(next() * 7) - 3)
        target = Math.min(count - 1, targetRow * columns + targetColumn)
      }
      const edge = { id: `e${i}-${k}`, fromNode: `n${i}`, fromSide: 'right', toNode: `n${target}`, toSide: 'left',
        propertyGraph: { version: 1, yaml: `role: ${pick(ROLES)}\nweight: ${Math.round(next() * 100) / 100}\n` } }
      if (astarPercent > 0 && next() * 100 < astarPercent) edge.styleAttributes = { pathfindingMethod: 'a-star' }
      edges.push(edge)
    }
  }

  const groups = []
  if (shape === 'grouped') {
    const rows = Math.ceil(count / columns)
    for (let blockRow = 0; blockRow < rows; blockRow += GROUP_BLOCK) {
      for (let blockColumn = 0; blockColumn < columns; blockColumn += GROUP_BLOCK) {
        const first = blockRow * columns + blockColumn
        if (first >= count) continue
        groups.push({ id: `g${blockRow}-${blockColumn}`, type: 'group', label: `Group ${groups.length}`,
          x: blockColumn * spacing.x - 40, y: blockRow * spacing.y - 60,
          width: Math.min(GROUP_BLOCK, columns - blockColumn) * spacing.x - 70, height: Math.min(GROUP_BLOCK, rows - blockRow) * spacing.y - 40,
          propertyGraph: { version: 1, yaml: `topic: ${pick(TOPICS)}\nlevel: ${1 + Math.floor(next() * 10)}\n` } })
      }
    }
  }

  return {
    metadata: { version: '1.0-1.0', frontmatter: {}, propertyGraph: { version: 1, views: VIEWS } },
    nodes: [...groups, ...nodes], // groups first so they render beneath members
    edges,
  }
}

const sha256 = text => createHash('sha256').update(text).digest('hex')

// --- in-app measurement (serialized with Function.prototype.toString; no outer references) ----

async function inApp(config) {
  const fs = require('fs')
  const report = { config, startedAt: new Date().toISOString(), phases: {}, warnings: [], failures: [] }
  // Codex (LLM agent): stop expensive cases in-app before the CLI driver expires.
  const deadline = performance.now() + config.runBudgetMs
  const frame = () => {
    if (performance.now() > deadline) throw Error('Native benchmark exceeded its bounded run budget')
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Animation frame stalled; native benchmark focus/visibility is invalid')), 10000)
      requestAnimationFrame(time => { clearTimeout(timeout); resolve(time) })
    })
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const frames = async n => { for (let i = 0; i < n; i++) await frame() }
  const heap = () => performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null
  const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('')
  const stats = values => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], over16_7: sorted.filter(v => v > 16.7).length, over33: sorted.filter(v => v > 33.4).length }
  }
  const restore = []
  let leaf = null
  try {
    if (app.vault.adapter.getBasePath() !== config.vault) throw Error('Wrong vault: ' + app.vault.adapter.getBasePath())
    // Focus the page before the initial idle frames, not just before pan phases.
    try { window.electronWindow?.webContents.focus(); document.body.focus() } catch { /* diagnosed by frame watchdog */ }
    // Focus diagnostics. CLI eval runs in this vault window's main frame (main process:
    // openVaultById(id, false) + webContents.executeJavaScript, no focus call), so `document` is the
    // canvas document. document.hasFocus() reflects Chromium page/webContents focus, which can differ
    // from the compositor's active window; rAF is throttled by visibility/occlusion, not by focus.
    // Obsidian assigns window.electronWindow (remote.getCurrentWindow()) to every app window and uses
    // electronWindow.focus() itself when !doc.hasFocus(); use the leaf's own window when known.
    let focusWindow = window
    const remoteWindowOf = () => focusWindow.electronWindow ?? window.electronWindow ?? null
    const describeElement = element => element ? `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).join('.') : ''}` : 'none'
    const focusState = () => {
      const doc = focusWindow.document, remoteWindow = remoteWindowOf()
      const safe = read => { try { return read() } catch { return null } }
      return {
        sameDocumentAsGlobal: doc === document, visibility: doc.visibilityState, documentHasFocus: doc.hasFocus(), activeElement: describeElement(doc.activeElement),
        windowFocused: remoteWindow ? safe(() => remoteWindow.isFocused()) : null, windowVisible: remoteWindow ? safe(() => remoteWindow.isVisible()) : null,
        webContentsFocused: remoteWindow ? safe(() => remoteWindow.webContents.isFocused()) : null,
      }
    }
    // Safe focus restoration inside the already active window: page focus first; window.focus() is
    // only a request (Wayland may ignore it without an activation token). Nothing is clicked.
    const ensureFocus = async target => {
      if (target?.win) focusWindow = target.win
      const before = focusState(), remoteWindow = remoteWindowOf()
      if (!before.documentHasFocus && remoteWindow) {
        try { if (!remoteWindow.isFocused()) remoteWindow.focus() } catch { /* ignored */ }
        try { remoteWindow.webContents.focus() } catch { /* ignored */ }
      }
      try { target?.focus?.({ preventScroll: true }) } catch { /* ignored */ }
      await frames(2)
      return { before, after: focusState() }
    }
    // Throttling check: idle rAF cadence (no viewport change) compared with the first baseline.
    const idleCadence = async count => {
      let previous = await frame(); const deltas = []
      for (let i = 0; i < count; i++) { const now = await frame(); deltas.push(now - previous); previous = now }
      return stats(deltas)
    }
    report.phases.focusAtStart = focusState()
    if (document.visibilityState !== 'visible') report.warnings.push('Window not visible at start: frame timings are throttled')

    // Plugin mode, restored afterwards without saving plugin configuration
    const ids = config.pluginIds
    const wanted = config.mode === 'native' ? [] : [ids[config.mode]]
    for (const id of Object.values(ids)) {
      const enabled = app.plugins.enabledPlugins.has(id)
      if (enabled && !wanted.includes(id)) { await app.plugins.disablePlugin(id); restore.push(() => app.plugins.enablePlugin(id)) }
    }
    for (const id of wanted) {
      if (!app.plugins.manifests[id]) throw Error(`Plugin ${id} is not installed in the QA vault`)
      if (!app.plugins.enabledPlugins.has(id)) { await app.plugins.enablePlugin(id); restore.push(() => app.plugins.disablePlugin(id)) }
    }
    const plugin = wanted.length ? app.plugins.getPlugin(wanted[0]) : null
    if (wanted.length && !plugin) throw Error(`Plugin ${wanted[0]} failed to load`)
    report.environment = {
      obsidian: (() => { try { return require('obsidian').apiVersion } catch { return null } })(), userAgent: navigator.userAgent, plugin: plugin?.manifest ?? null,
      window: { width: innerWidth, height: innerHeight, devicePixelRatio }, hardwareConcurrency: navigator.hardwareConcurrency,
    }

    // Idle frame baseline (monitor refresh)
    let last = await frame(); const idle = []
    for (let i = 0; i < 60; i++) { const now = await frame(); idle.push(now - last); last = now }
    report.phases.idleFrames = stats(idle)

    // Load
    let file = null
    for (let i = 0; i < 600 && !(file = app.vault.getAbstractFileByPath(config.fixture)); i++) await sleep(100)
    if (!file) throw Error('Fixture not indexed by the vault: ' + config.fixture)
    for (const existing of app.workspace.getLeavesOfType('canvas')) if (existing.view?.file?.path?.startsWith('Bench/')) existing.detach()
    await sleep(500)
    const heapBeforeOpen = heap()
    leaf = app.workspace.getLeaf('tab')
    const t0 = performance.now()
    await leaf.openFile(file)
    const tOpened = performance.now()
    const canvas = leaf.view.canvas
    if (!canvas) throw Error('Opened view is not a canvas')
    let tImported = null
    for (let i = 0; i < 6000; i++) {
      if (canvas.nodes.size === config.expected.nodes && canvas.edges.size === config.expected.edges) { tImported = performance.now(); break }
      await frame()
    }
    if (tImported === null) throw Error(`Import incomplete: ${canvas.nodes.size}/${config.expected.nodes} nodes, ${canvas.edges.size}/${config.expected.edges} edges`)
    const mounted = () => {
      let nodes = 0, edges = 0
      for (const node of canvas.nodes.values()) if (node.nodeEl?.isConnected) nodes++
      for (const edge of canvas.edges.values()) if (edge.lineGroupEl?.isConnected) edges++
      return { nodes, edges, domElements: canvas.wrapperEl.querySelectorAll('*').length, svgPaths: canvas.wrapperEl.querySelectorAll('path').length }
    }
    // Cheap per-frame probe (DOM query); the full element scan runs once after settling.
    const probe = () => {
      const nodes = canvas.canvasEl.querySelectorAll('.canvas-node').length
      return nodes > 0 || canvas.nodes.size === 0 ? `${nodes}:${canvas.wrapperEl.querySelectorAll('path').length}` : JSON.stringify(mounted())
    }
    const settle = async (label) => {
      const start = performance.now(); let previous = null, stable = 0, framesWaited = 0, lastChange = start
      while (stable < 15 && performance.now() - start < 30_000) {
        await frame(); framesWaited++
        const current = probe()
        if (current === previous) stable++
        else { stable = 0; lastChange = performance.now() }
        previous = current
      }
      return { label, ms: lastChange - start, timedOut: stable < 15, framesWaited, ...mounted(), heap: heap() }
    }
    const initialMount = await settle('initial viewport')
    report.phases.load = {
      openFileMs: tOpened - t0, importedMs: tImported - t0, mountedStableMs: initialMount.ms + (tImported - t0),
      note: 'mountedStableMs = import time + time until the last mounted-DOM change (15 unchanged frames confirm stability)',
      initialViewport: { zoom: canvas.zoom, ...initialMount }, heapBeforeOpen,
    }

    // Working viewport (100% zoom at the graph centre) and fit-all viewport
    const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const node of canvas.nodes.values()) {
      bbox.minX = Math.min(bbox.minX, node.x); bbox.minY = Math.min(bbox.minY, node.y)
      bbox.maxX = Math.max(bbox.maxX, node.x + node.width); bbox.maxY = Math.max(bbox.maxY, node.y + node.height)
    }
    const centre = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 }
    const jump = (x, y, zoom) => {
      canvas.tx = canvas.x = x; canvas.ty = canvas.y = y; canvas.tZoom = canvas.zoom = zoom; canvas.zoomCenter = null
      canvas.markViewportChanged()
    }
    jump(centre.x, centre.y, 0)
    report.phases.workingViewport = await settle('zoom 1.0 at centre')
    canvas.zoomToFit(); await frames(5)
    const fitZoom = canvas.tZoom
    report.phases.fitViewport = { zoom: fitZoom, ...(await settle('zoom to fit')) }

    // Pan: scripted horizontal sweep, frame deltas and long tasks
    const pan = async (label, zoom, sweepScreens) => {
      const focus = await ensureFocus(canvas.wrapperEl)
      const cadence = await idleCadence(30)
      const baseline = report.phases.idleFrames?.p50 ?? 16.7
      // Valid when visible and the idle rAF cadence is not throttled (≤ 2× baseline and ≤ 50 ms).
      const throttled = !cadence || cadence.p50 > Math.max(2 * baseline, 20) || cadence.p50 > 50
      if (focus.after.visibility !== 'visible' || throttled) report.failures.push(`${label}: window hidden or rAF throttled (idle p50 ${cadence?.p50?.toFixed?.(1)} ms vs baseline ${baseline.toFixed(1)} ms); frame timings invalid`)
      else if (!focus.after.documentHasFocus) report.warnings.push(`${label}: document.hasFocus() false after focus restoration, but visible and unthrottled`)
      jump(centre.x, centre.y, zoom); await settle(label + ' (settle)')
      const longTasks = []
      let observer = null
      try { observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration) }); observer.observe({ entryTypes: ['longtask'] }) }
      catch { report.warnings.push('longtask observer unavailable') }
      const scale = Math.pow(2, zoom), widthCanvas = innerWidth / scale
      const startX = centre.x - sweepScreens * widthCanvas / 2, step = sweepScreens * widthCanvas / 180
      const deltas = []; const mountedSamples = []
      let previous = await frame()
      for (let i = 0; i < 180; i++) {
        jump(startX + i * step, centre.y, zoom)
        const now = await frame()
        deltas.push(now - previous); previous = now
        if (i % 30 === 0) mountedSamples.push(mounted().nodes)
      }
      await frames(2); observer?.disconnect()
      return { label, zoom, focused: document.visibilityState === 'visible' && document.hasFocus(), focus, idleCadenceBefore: cadence, focusAfter: focusState(), frames: stats(deltas), longTasks: { count: longTasks.length, totalMs: longTasks.reduce((a, b) => a + b, 0), max: Math.max(0, ...longTasks) }, mountedNodesSamples: mountedSamples, after: mounted() }
    }
    report.phases.pan = [await pan('pan at zoom 1.0', 0, 3), await pan('pan at fit zoom', fitZoom, 0.5)]

    // Graph and disk hashes before view switches
    const diskHash = async () => hash(await app.vault.adapter.read(config.fixture))
    const graphHash = async () => hash(JSON.stringify(canvas.getData()))
    const before = { graph: await graphHash(), disk: await diskHash(), history: canvas.history.data.length, current: canvas.history.current }

    // Filter changes (fork only)
    const extension = plugin?.canvasExtensions?.find?.(e => e.constructor.name === 'PropertyGraphCanvasExtension')
    if (config.mode === 'fork' && extension && typeof extension.setView === 'function') {
      const parses = () => extension.states?.get(canvas)?.service?.parseCount ?? null
      const switchTo = async (id, label) => {
        const parseBefore = parses(), heapBefore = heap()
        const start = performance.now(); extension.setView(canvas, id); const sync = performance.now() - start
        await frame(); await frame(); const painted = performance.now() - start
        const state = extension.states?.get(canvas)
        return { label, view: id ?? 'All', syncMs: sync, twoFramesMs: painted, yamlParses: parseBefore === null ? null : parses() - parseBefore,
          visibleNodes: state?.active ? state.visible.nodes.size : canvas.nodes.size, visibleEdges: state?.active ? state.visible.edges.size : canvas.edges.size,
          mounted: mounted(), heapDelta: heapBefore && heap() ? heap().usedJSHeapSize - heapBefore.usedJSHeapSize : null }
      }
      jump(centre.x, centre.y, 0); await settle('filter viewport')
      const switches = []
      switches.push(await switchTo('bench-topic', 'first filter (cold parse + index)'))
      switches.push(await switchTo(undefined, 'back to All'))
      switches.push(await switchTo('bench-topic', 'warm same view'))
      switches.push(await switchTo('bench-nested', 'warm other node view'))
      switches.push(await switchTo('bench-edges', 'warm edge view'))
      report.phases.panFiltered = await pan('pan at zoom 1.0 under bench-topic', 0, 3).then(async result => { await switchTo('bench-topic', 'restore'); return result })
      switches.push(await switchTo(undefined, 'final All'))
      report.phases.filters = switches
    } else {
      report.phases.filters = { skipped: config.mode === 'fork' ? 'PropertyGraphCanvasExtension.setView unavailable' : `not applicable in ${config.mode} mode` }
    }

    await sleep(config.saveSettleMs)
    const after = { graph: await graphHash(), disk: await diskHash(), history: canvas.history.data.length, current: canvas.history.current }
    report.phases.preservation = { before, after, graphUnchanged: before.graph === after.graph, diskUnchanged: before.disk === after.disk,
      historyUnchanged: before.history === after.history && before.current === after.current, diskMatchesFixture: before.disk === config.fixtureSha256 }

    // One-property commit and history cost
    const viewport = canvas.getViewportBBox()
    const candidates = [...canvas.nodes.values()].filter(node => node.getData().type === 'text' && node.nodeEl?.isConnected &&
      node.x >= viewport.minX && node.y >= viewport.minY && node.x + node.width <= viewport.maxX && node.y + node.height <= viewport.maxY)
    const target = candidates[0]
    const commit = {}
    if (!target) report.warnings.push('No mounted text node fully inside the viewport for commit measurement')
    else {
      commit.nodeId = target.id
      // Generic path comparable across modes: data change + history snapshot + save request
      const historyBefore = canvas.history.data.length, heapBefore = heap()
      let start = performance.now()
      target.setData({ ...target.getData(), color: '4' })
      canvas.pushHistory(canvas.getData()); canvas.requestSave()
      const genericMs = performance.now() - start
      await frame()
      commit.generic = { ms: genericMs, historyEntriesAdded: canvas.history.data.length - historyBefore,
        lastSnapshotBytes: JSON.stringify(canvas.history.data[canvas.history.data.length - 1] ?? null).length,
        heapDelta: heapBefore && heap() ? heap().usedJSHeapSize - heapBefore.usedJSHeapSize : null }

      if (config.mode === 'fork' && extension) {
        // Real YAML-panel path: enter native editing, focus the panel, change one property to a
        // value that cannot already exist, then time the blur that commits it.
        const historyMark = () => ({ length: canvas.history.data.length, current: canvas.history.current })
        // focus/blur events are only dispatched while the page has focus; restore it first.
        const pageFocus = await ensureFocus(canvas.wrapperEl)
        target.setIsEditing(true); await frames(2)
        const field = target.nodeEl.querySelector('.mkls-frontmatter-text')
        const yamlCommit = { valid: false, pageFocus }
        commit.forkYamlPanel = yamlCommit
        if (!field) yamlCommit.reason = 'frontmatter panel not found after setIsEditing(true)'
        else {
          field.focus(); await frames(2)
          const describe = element => element ? `${element.tagName.toLowerCase()}${element.className ? '.' + String(element.className).split(' ').join('.') : ''}` : 'none'
          yamlCommit.focus = { active: document.activeElement === field, connected: field.isConnected, activeElement: describe(document.activeElement) }
          if (!yamlCommit.focus.active || !yamlCommit.focus.connected) yamlCommit.reason = 'panel not focused and connected two frames after focus()'
          else {
            const levels = [...field.value.matchAll(/^level: (-?\d+)\s*$/gm)].map(match => Number(match[1]))
            const newLevel = Math.max(0, ...levels) + 1000
            field.value = levels.length ? field.value.replace(/^level: .*$/m, `level: ${newLevel}`) : field.value + (field.value.endsWith('\n') || !field.value ? '' : '\n') + `level: ${newLevel}\n`
            const before = historyMark()
            const startBlur = performance.now(); field.blur(); yamlCommit.blurCommitMs = performance.now() - startBlur
            await frames(2)
            const afterBlur = historyMark()
            yamlCommit.committed = new RegExp(`^level: ${newLevel}$`, 'm').test(target.getData().propertyGraph?.yaml ?? '')
            yamlCommit.historyByBlur = { lengthDelta: afterBlur.length - before.length, currentDelta: afterBlur.current - before.current }
            target.setIsEditing(false); await frames(2)
            const afterEdit = historyMark()
            yamlCommit.historyAfterEditEnd = { lengthDelta: afterEdit.length - before.length, currentDelta: afterEdit.current - before.current, note: 'includes any native body-editing history' }
            yamlCommit.valid = yamlCommit.committed && yamlCommit.historyByBlur.currentDelta === 1
            if (!yamlCommit.valid) yamlCommit.reason = 'blur did not commit exactly one history entry with the new value'
          }
        }
        if (!yamlCommit.valid) report.failures.push('YAML commit measurement invalid: ' + yamlCommit.reason)
      }
    }
    report.phases.commit = commit
    // Codex (LLM agent): route-count evidence, when the fork exposes it.
    const routing = plugin?.canvasExtensions?.find(extension => typeof extension.getRouteStats === 'function')
    if (routing) report.phases.routing = { ...routing.getRouteStats(canvas) }

    // Close and residual heap
    leaf.detach(); leaf = null
    await sleep(2000)
    report.phases.afterClose = { heap: heap() }
    report.finishedAt = new Date().toISOString()
  } catch (error) {
    report.error = String(error?.stack ?? error)
  } finally {
    try { leaf?.detach() } catch { /* already closed */ }
    for (const undo of restore.reverse()) { try { await undo() } catch (error) { report.warnings.push('Plugin restore failed: ' + error) } }
    fs.writeFileSync(config.reportPath, JSON.stringify(report))
  }
}

// --- driver -----------------------------------------------------------------------------------

function runCase(shape, count) {
  const data = generateFixture(shape, count)
  const json = JSON.stringify(data, null, 2)
  const name = `Bench-${shape}-${count}-${runId}.canvas`
  const expected = { nodes: data.nodes.length, edges: data.edges.length }
  const fixtureSha256 = sha256(json)
  const summary = { shape, count, expected, fixture: `Bench/${name}`, fixtureSha256, fixtureBytes: Buffer.byteLength(json) }
  const media = shape === 'media' ? mediaFiles() : {}
  if (shape === 'media') summary.mediaSha256 = Object.fromEntries(Object.entries(media).map(([file, text]) => [file, sha256(text).slice(0, 16)]))
  const writeMedia = root => {
    if (shape !== 'media') return
    mkdirSync(join(root, 'Bench', 'media'), { recursive: true })
    for (const [file, text] of Object.entries(media)) writeFileSync(join(root, 'Bench', 'media', file), text)
  }

  if (dryRun) {
    writeFileSync(join(outDir, name), json); writeMedia(outDir)
    return { ...summary, dryRun: true }
  }

  mkdirSync(join(vault, 'Bench'), { recursive: true }); writeMedia(vault)
  writeFileSync(join(vault, 'Bench', name), json)
  const reportPath = join(outDir, `${shape}-${count}.json`)
  if (existsSync(reportPath)) throw Error(`Report already exists: ${reportPath}`)
  const config = { vault, mode, fixture: `Bench/${name}`, fixtureSha256, expected, reportPath, pluginIds: PLUGIN_IDS, saveSettleMs: 2500, limitations: LIMITATIONS, astarPercent, runBudgetMs: Math.min(180000, caseTimeoutMs - 10000) }
  const code = `(${inApp.toString()})(${JSON.stringify(config)})`
  const result = spawnSync('obsidian', [`vault=${basename(vault)}`, 'eval', `code=${code}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  writeFileSync(reportPath + '.log', (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : ''))

  const deadline = Date.now() + caseTimeoutMs
  while (!existsSync(reportPath) && Date.now() < deadline) spawnSync('sleep', ['0.5'])
  if (!existsSync(reportPath)) return { ...summary, error: `No report within ${caseTimeoutMs / 1000}s; see ${reportPath}.log` }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  return { ...summary, report: reportPath, error: report.error ?? null, failures: report.failures ?? [], warnings: report.warnings ?? [], phases: report.phases }
}

function markdown(results) {
  const num = value => value === null || value === undefined ? '–' : typeof value === 'number' ? (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)) : String(value)
  const lines = [`# Native benchmark ${mode} ${runId}`, '', ...LIMITATIONS.map(l => `- ${l}`), '',
    '| shape | nodes/edges | import ms | mounted ms | mounted nodes (1.0 / fit) | DOM (1.0) | heap MiB (1.0) | pan p95 ms 1.0 / fit | long tasks | first / warm filter ms | generic commit ms | YAML commit ms | graph/disk/history unchanged |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
  for (const r of results) {
    const p = r.phases ?? {}
    const filters = Array.isArray(p.filters) ? p.filters : []
    const pres = p.preservation
    lines.push(`| ${r.shape} | ${r.expected.nodes}/${r.expected.edges} | ${num(p.load?.importedMs)} | ${num(p.load?.mountedStableMs)} | ${num(p.workingViewport?.nodes)} / ${num(p.fitViewport?.nodes)} | ${num(p.workingViewport?.domElements)} | ${num(p.workingViewport?.heap ? p.workingViewport.heap.usedJSHeapSize / 1048576 : null)} | ${num(p.pan?.[0]?.frames?.p95)} / ${num(p.pan?.[1]?.frames?.p95)} | ${num(p.pan?.[0]?.longTasks?.count)} | ${num(filters[0]?.twoFramesMs)} / ${num(filters[2]?.twoFramesMs)} | ${num(p.commit?.generic?.ms)} | ${p.commit?.forkYamlPanel ? (p.commit.forkYamlPanel.valid ? num(p.commit.forkYamlPanel.blurCommitMs) : 'INVALID') : '–'} | ${pres ? [pres.graphUnchanged, pres.diskUnchanged, pres.historyUnchanged].join('/') : '–'} |${r.error ? ` error: ${r.error.split('\n')[0]}` : ''}${r.failures?.length ? ` failures: ${r.failures.join('; ')}` : ''}`)
  }
  return lines.join('\n') + '\n'
}

const lockPath = join(outDir, '.benchmark.lock')
const lock = openSync(lockPath, 'wx') // fails if another run uses this directory
try {
  // Validate the in-app code once (syntax only) before touching the app.
  new Function(`return (${inApp.toString()})`)
  const results = []
  for (const shape of shapes) for (const count of sizes) {
    const result = runCase(shape, count)
    results.push(result)
    console.log(JSON.stringify({ shape, count, error: result.error ?? null, report: result.report ?? null, dryRun }))
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ mode, runId, vault, limitations: LIMITATIONS, results }, null, 2))
    writeFileSync(join(outDir, 'summary.md'), markdown(results))
  }
  console.log(JSON.stringify({ summary: join(outDir, 'summary.md') }))
} finally {
  closeSync(lock); unlinkSync(lockPath)
}
