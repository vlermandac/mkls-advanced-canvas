// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Paired overview-rendering probe on one loaded canvas at fit (minimum) zoom. Variants:
//   baseline  – unchanged rendering
//   edge-lod  – hide edge interaction paths and arrowheads, disable edge stroke transitions
//   no-edges  – hide all edge SVG layers and edge labels (upper bound for any edge-only fix)
// Order per round: baseline, edge-lod, no-edges; a final baseline detects drift.
// CSS is injected temporarily, scoped to this canvas wrapper via a data attribute, and removed in
// `finally`; graph/history/disk hashes are checked unchanged. No plugin settings are touched and
// no plugins are toggled: the probe measures whatever mode the QA vault currently runs.
//
// Usage:
//   node bench/overview-probe.mjs --vault '<…/MKLS Canvas QA>' [--fixture Bench/Bench-sparse-1000-….canvas] \
//     [--rounds 1] [--frames 120] [--out <dir>] [--case-timeout-s 600]
// Without --fixture the newest retained Bench/Bench-sparse-1000-*.canvas is used.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

const args = { rounds: '1', frames: '120', 'case-timeout-s': '600' }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) throw Error(`Unexpected argument ${argv[i]}`)
  args[argv[i].slice(2)] = argv[++i]
}

// --- guards (same as native-benchmark.mjs) ----------------------------------------------------
if (!args.vault) throw Error('--vault is required (an isolated QA vault)')
const vault = resolve(args.vault)
if (!basename(vault).includes('QA')) throw Error('Refusing: vault folder name must contain "QA"')
if (!existsSync(join(vault, '.obsidian'))) throw Error('Refusing: not an existing Obsidian vault')
if (!vault.split(sep).includes('evidence')) throw Error('Refusing: QA vault must live under an evidence/ directory')
for (const forbidden of ['MKLS_Study', 'MKLS_Study_State', 'Markdown_Resources', 'Markdown_Resources.mkls'])
  if (vault.split(sep).includes(forbidden)) throw Error(`Refusing: ${forbidden} is not a QA vault`)

const rounds = Number(args.rounds), frameCount = Number(args.frames), caseTimeoutMs = Number(args['case-timeout-s']) * 1000
if (!Number.isInteger(rounds) || rounds < 1 || !Number.isInteger(frameCount) || frameCount < 30) throw Error('--rounds ≥ 1 and --frames ≥ 30 required')

let fixture = args.fixture
if (!fixture) {
  const benchDir = join(vault, 'Bench')
  const candidates = existsSync(benchDir) ? readdirSync(benchDir).filter(name => /^Bench-sparse-1000-.*\.canvas$/.test(name)) : []
  if (!candidates.length) throw Error('No retained Bench/Bench-sparse-1000-*.canvas; pass --fixture')
  candidates.sort((a, b) => statSync(join(benchDir, b)).mtimeMs - statSync(join(benchDir, a)).mtimeMs)
  fixture = `Bench/${candidates[0]}`
}
const fixturePath = resolve(vault, fixture)
if (relative(vault, fixturePath).startsWith('..') || !existsSync(fixturePath)) throw Error(`Fixture not found inside the vault: ${fixture}`)
fixture = relative(vault, fixturePath).split(sep).join('/') // vault-relative path for the app
const fixtureText = readFileSync(fixturePath, 'utf8')
const fixtureData = JSON.parse(fixtureText)
const expected = { nodes: fixtureData.nodes.length, edges: fixtureData.edges.length }

const runId = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = resolve(args.out ?? join(vault, '..', 'bench', `overview-probe-${runId}`))
if (!relative(vault, outDir).startsWith('..')) throw Error('Reports must not be written inside the vault')
mkdirSync(outDir, { recursive: true })
const reportPath = join(outDir, 'overview-probe.json')
if (existsSync(reportPath)) throw Error(`Report already exists: ${reportPath}`)

// --- in-app probe (serialized; no outer references) -------------------------------------------

async function inApp(config) {
  const fs = require('fs')
  const report = { config, startedAt: new Date().toISOString(), phases: {}, variants: [], warnings: [], failures: [] }
  const frame = () => new Promise(r => requestAnimationFrame(r))
  const frames = async n => { for (let i = 0; i < n; i++) await frame() }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('')
  const stats = values => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], mean: values.reduce((a, b) => a + b, 0) / values.length, over16_7: sorted.filter(v => v > 16.7).length, over33: sorted.filter(v => v > 33.4).length }
  }
  const STYLE_ID = 'mkls-overview-probe-style', ATTRIBUTE = 'data-mkls-overview-probe'
  let leaf = null, canvas = null, styleEl = null

  // Focus helpers (same protocol as native-benchmark.mjs)
  let focusWindow = window
  const remoteWindowOf = () => focusWindow.electronWindow ?? window.electronWindow ?? null
  const describeElement = element => element ? `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).join('.') : ''}` : 'none'
  const focusState = () => {
    const doc = focusWindow.document, remoteWindow = remoteWindowOf()
    const safe = read => { try { return read() } catch { return null } }
    return { sameDocumentAsGlobal: doc === document, visibility: doc.visibilityState, documentHasFocus: doc.hasFocus(), activeElement: describeElement(doc.activeElement),
      windowFocused: remoteWindow ? safe(() => remoteWindow.isFocused()) : null, webContentsFocused: remoteWindow ? safe(() => remoteWindow.webContents.isFocused()) : null }
  }
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
  const idleCadence = async count => {
    let previous = await frame(); const deltas = []
    for (let i = 0; i < count; i++) { const now = await frame(); deltas.push(now - previous); previous = now }
    return stats(deltas)
  }

  try {
    if (app.vault.adapter.getBasePath() !== config.vault) throw Error('Wrong vault: ' + app.vault.adapter.getBasePath())
    report.environment = {
      userAgent: navigator.userAgent, window: { width: innerWidth, height: innerHeight, devicePixelRatio },
      enabledPlugins: [...app.plugins.enabledPlugins].sort(), pluginVersions: Object.fromEntries([...app.plugins.enabledPlugins].map(id => [id, app.plugins.manifests[id]?.version ?? null])),
    }
    report.phases.idleBaseline = await idleCadence(60)

    // Open the retained fixture
    let file = null
    for (let i = 0; i < 600 && !(file = app.vault.getAbstractFileByPath(config.fixture)); i++) await sleep(100)
    if (!file) throw Error('Fixture not indexed by the vault: ' + config.fixture)
    for (const existing of app.workspace.getLeavesOfType('canvas')) if (existing.view?.file?.path?.startsWith('Bench/')) existing.detach()
    await sleep(500)
    leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
    canvas = leaf.view.canvas
    if (!canvas) throw Error('Opened view is not a canvas')
    for (let i = 0; i < 6000 && !(canvas.nodes.size === config.expected.nodes && canvas.edges.size === config.expected.edges); i++) await frame()
    if (canvas.nodes.size !== config.expected.nodes || canvas.edges.size !== config.expected.edges) throw Error('Import incomplete')

    const settle = async () => {
      const probe = () => `${canvas.canvasEl.querySelectorAll('.canvas-node').length}:${canvas.wrapperEl.querySelectorAll('path').length}`
      const start = performance.now(); let previous = null, stable = 0
      while (stable < 15 && performance.now() - start < 60_000) { await frame(); const current = probe(); stable = current === previous ? stable + 1 : 0; previous = current }
      return { ms: performance.now() - start, timedOut: stable < 15 }
    }
    const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const node of canvas.nodes.values()) {
      bbox.minX = Math.min(bbox.minX, node.x); bbox.minY = Math.min(bbox.minY, node.y)
      bbox.maxX = Math.max(bbox.maxX, node.x + node.width); bbox.maxY = Math.max(bbox.maxY, node.y + node.height)
    }
    const centre = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 }
    const jump = (x, y, zoom) => { canvas.tx = canvas.x = x; canvas.ty = canvas.y = y; canvas.tZoom = canvas.zoom = zoom; canvas.zoomCenter = null; canvas.markViewportChanged() }
    canvas.zoomToFit(); await frames(5)
    const fitZoom = canvas.tZoom
    const sweep = async (record) => {
      const widthCanvas = innerWidth / Math.pow(2, fitZoom), startX = centre.x - widthCanvas / 4, step = (widthCanvas / 2) / config.frames
      jump(startX, centre.y, fitZoom); await settle()
      const deltas = [], longTasks = []
      let observer = null
      if (record) { try { observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration) }); observer.observe({ entryTypes: ['longtask'] }) } catch { report.warnings.push('longtask observer unavailable') } }
      let previous = await frame()
      for (let i = 0; i < config.frames; i++) { jump(startX + i * step, centre.y, fitZoom); const now = await frame(); deltas.push(now - previous); previous = now }
      await frames(2); observer?.disconnect()
      return { frames: stats(deltas), longTasks: { count: longTasks.length, totalMs: longTasks.reduce((a, b) => a + b, 0), max: Math.max(0, ...longTasks) } }
    }

    // Preservation snapshot before any variant
    const snapshot = async () => ({ graph: await hash(JSON.stringify(canvas.getData())), disk: await hash(await app.vault.adapter.read(config.fixture)), history: canvas.history.data.length, current: canvas.history.current })
    const before = await snapshot()

    // Warm-up sweep (unmeasured) so the sweep area is mounted before the paired variants
    report.phases.warmup = { settle: await settle(), sweep: (await sweep(false)).frames, fitZoom }

    // Probe stylesheet, scoped to this canvas by attribute
    const doc = canvas.wrapperEl.doc ?? document
    styleEl = doc.createElement('style'); styleEl.id = STYLE_ID
    styleEl.textContent = [
      `.canvas-wrapper[${ATTRIBUTE}="edge-lod"].mod-zoomed-out .canvas-edges path.canvas-interaction-path,`,
      `.canvas-wrapper[${ATTRIBUTE}="edge-lod"].mod-zoomed-out .canvas-edges polygon.canvas-path-end { display: none !important; }`,
      `.canvas-wrapper[${ATTRIBUTE}="edge-lod"].mod-zoomed-out .canvas-edges path { transition: none !important; }`,
      `.canvas-wrapper[${ATTRIBUTE}="no-edges"] .canvas-edges,`,
      `.canvas-wrapper[${ATTRIBUTE}="no-edges"] .canvas-path-label-wrapper { display: none !important; }`,
    ].join('\n')
    doc.head.appendChild(styleEl)

    // Rendered (not merely present) counts, sampled with computed style outside timed sections
    const renderedCounts = () => {
      const result = {}
      for (const [name, selector] of Object.entries({ displayPaths: '.canvas-edges path.canvas-display-path', interactionPaths: '.canvas-edges path.canvas-interaction-path', arrowheads: '.canvas-edges polygon.canvas-path-end', nodes: '.canvas-node' })) {
        const all = canvas.wrapperEl.querySelectorAll(selector), sampleSize = Math.min(400, all.length)
        let visible = 0
        for (let i = 0; i < sampleSize; i++) {
          const element = all[Math.floor(i * all.length / sampleSize)]
          const shown = typeof element.checkVisibility === 'function' ? element.checkVisibility() : getComputedStyle(element).display !== 'none'
          if (shown) visible++
        }
        result[name] = { present: all.length, sampled: sampleSize, estimatedRendered: sampleSize ? Math.round(visible / sampleSize * all.length) : 0 }
      }
      result.zoomedOutClass = canvas.wrapperEl.classList.contains('mod-zoomed-out')
      return result
    }

    const order = []
    for (let round = 0; round < config.rounds; round++) order.push('baseline', 'edge-lod', 'no-edges')
    order.push('baseline')
    for (const [index, variant] of order.entries()) {
      if (variant === 'baseline') canvas.wrapperEl.removeAttribute(ATTRIBUTE)
      else canvas.wrapperEl.setAttribute(ATTRIBUTE, variant)
      await frames(3)
      const counts = renderedCounts()
      const focus = await ensureFocus(canvas.wrapperEl)
      const cadence = await idleCadence(30)
      const baseline = report.phases.idleBaseline?.p50 ?? 16.7
      const throttled = !cadence || cadence.p50 > Math.max(2 * baseline, 20) || cadence.p50 > 50
      const result = await sweep(true)
      const valid = focus.after.visibility === 'visible' && !throttled
      if (!valid) report.failures.push(`${index}:${variant}: window hidden or rAF throttled (idle p50 ${cadence?.p50?.toFixed?.(1)} ms vs baseline ${baseline.toFixed(1)} ms)`)
      else if (!focus.after.documentHasFocus) report.warnings.push(`${index}:${variant}: document.hasFocus() false after restoration, but visible and unthrottled`)
      report.variants.push({ index, variant, valid, counts, focus, idleCadenceBefore: cadence, ...result })
    }

    // Remove probe state and verify
    canvas.wrapperEl.removeAttribute(ATTRIBUTE); styleEl.remove(); styleEl = null
    await frames(2)
    const after = await snapshot()
    report.phases.cleanup = { styleRemoved: !doc.getElementById(STYLE_ID), attributeRemoved: !canvas.wrapperEl.hasAttribute(ATTRIBUTE) }
    report.phases.preservation = { before, after, graphUnchanged: before.graph === after.graph, diskUnchanged: before.disk === after.disk,
      historyUnchanged: before.history === after.history && before.current === after.current, diskMatchesFixture: before.disk === config.fixtureSha256 }
    if (!report.phases.cleanup.styleRemoved || !report.phases.cleanup.attributeRemoved) report.failures.push('Probe CSS state not removed')
    if (!report.phases.preservation.graphUnchanged || !report.phases.preservation.diskUnchanged || !report.phases.preservation.historyUnchanged) report.failures.push('Graph, disk or history changed during probe')
    report.finishedAt = new Date().toISOString()
  } catch (error) {
    report.error = String(error?.stack ?? error)
  } finally {
    try { canvas?.wrapperEl?.removeAttribute(ATTRIBUTE) } catch { /* ignored */ }
    try { styleEl?.remove() } catch { /* ignored */ }
    try { document.getElementById(STYLE_ID)?.remove() } catch { /* ignored */ }
    try { leaf?.detach() } catch { /* ignored */ }
    fs.writeFileSync(config.reportPath, JSON.stringify(report))
  }
}

// --- driver -----------------------------------------------------------------------------------

new Function(`return (${inApp.toString()})`) // syntax check before contacting the app
const config = { vault, fixture, fixtureSha256: createHash('sha256').update(fixtureText).digest('hex'), expected, reportPath, rounds, frames: frameCount }
const code = `(${inApp.toString()})(${JSON.stringify(config)})`
const result = spawnSync('obsidian', [`vault=${basename(vault)}`, 'eval', `code=${code}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
writeFileSync(reportPath + '.log', (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : ''))
const deadline = Date.now() + caseTimeoutMs
while (!existsSync(reportPath) && Date.now() < deadline) spawnSync('sleep', ['0.5'])
if (!existsSync(reportPath)) throw Error(`No report within ${caseTimeoutMs / 1000}s; see ${reportPath}.log`)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
writeFileSync(reportPath, JSON.stringify(report, null, 2))

const num = value => typeof value === 'number' ? value.toFixed(1) : '–'
const lines = [`# Overview probe ${runId}`, '', `Fixture ${fixture} (${expected.nodes} nodes / ${expected.edges} edges), fit zoom, ${frameCount}-frame pan; plugins: ${(report.environment?.enabledPlugins ?? []).join(', ') || 'none'}`, '',
  '| # | variant | valid | frame p50 | p95 | mean | long tasks (total ms) | rendered interaction paths | rendered arrowheads | rendered display paths |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
for (const v of report.variants ?? []) lines.push(`| ${v.index} | ${v.variant} | ${v.valid} | ${num(v.frames?.p50)} | ${num(v.frames?.p95)} | ${num(v.frames?.mean)} | ${v.longTasks?.count ?? '–'} (${num(v.longTasks?.totalMs)}) | ${v.counts?.interactionPaths?.estimatedRendered ?? '–'} / ${v.counts?.interactionPaths?.present ?? '–'} | ${v.counts?.arrowheads?.estimatedRendered ?? '–'} / ${v.counts?.arrowheads?.present ?? '–'} | ${v.counts?.displayPaths?.estimatedRendered ?? '–'} / ${v.counts?.displayPaths?.present ?? '–'} |`)
const p = report.phases ?? {}
lines.push('', `Cleanup: ${JSON.stringify(p.cleanup ?? null)}; preservation graph/disk/history unchanged: ${p.preservation ? [p.preservation.graphUnchanged, p.preservation.diskUnchanged, p.preservation.historyUnchanged].join('/') : '–'}`)
if (report.error) lines.push('', `Error: ${report.error.split('\n')[0]}`)
if (report.failures?.length) lines.push('', 'Failures:', ...report.failures.map(f => `- ${f}`))
if (report.warnings?.length) lines.push('', 'Warnings:', ...report.warnings.map(w => `- ${w}`))
writeFileSync(join(outDir, 'summary.md'), lines.join('\n') + '\n')
console.log(JSON.stringify({ report: reportPath, summary: join(outDir, 'summary.md'), error: report.error ?? null, failures: report.failures?.length ?? null }))
if (report.error || report.failures?.length) process.exitCode = 1
