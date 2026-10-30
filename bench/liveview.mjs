#!/usr/bin/env node
// Liveview under load: synthetic orchestra projects with N workstreams, timed through the modules and through a started server.
//   node bench/liveview.mjs
// Writes bench/results/liveview.json. Temp projects go to the OS temp folder and are removed at the end.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIVEVIEW = path.join(HERE, '..', 'plugins', 'orchestra', 'liveview')
const SOURCES = pathToFileURL(path.join(LIVEVIEW, 'sources.mjs')).href
const SIZES = [1, 5, 10, 25, 50]
const RUNS = 5
const TICKS = 20
const TASKS = 8
const MIN = 60_000
const LIVE_REQUESTS = 20
const LIVE_GAP_MS = 500

const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const ms = x => Math.round(x * 10) / 10
const mb = x => Math.round((x / 2 ** 20) * 10) / 10

// Child mode: one started server, so its memory is the server's alone.
if (process.argv[2] === '--child') {
  const { startServer } = await import(pathToFileURL(path.join(LIVEVIEW, 'server.mjs')).href)
  const { TranscriptReader } = await import(SOURCES)
  const tx = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-bench-tx-'))
  // 'auto' keeps the server's own 5 s timer running, as in real use; otherwise the parent asks for the ticks.
  const auto = process.argv[4] === 'auto'
  const s = await startServer({ root: process.argv[3], port: 4517, reader: new TranscriptReader(tx), onIdle: () => {}, auto })
  const say = o => process.stdout.write(`${JSON.stringify(o)}\n`)
  say({ url: s.url, rssAfterFirstTick: process.memoryUsage().rss })
  process.stdin.once('data', async () => {
    const times = []
    for (let i = 0; i < (auto ? 0 : TICKS); i++) { const t = performance.now(); s.tick(); times.push(performance.now() - t) }
    const m = process.memoryUsage()
    say({ rss: m.rss, heapUsed: m.heapUsed, ticks: times })
    await s.close()
    fs.rmSync(tx, { recursive: true, force: true })
    process.exit(0)
  })
} else {
  await main()
}

function makeProject(n) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `orchestra-bench-lv-${n}-`))
  const now = Date.now()
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }
  const git = (cwd, args, at = now) => execFileSync('git', args, {
    cwd, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString(), GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@example.com', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@example.com' },
  })
  const plan = (name, ticked) => `# ${name} Implementation Plan\n\n${Array.from({ length: TASKS }, (_, i) =>
    `### Task ${i + 1}: Step ${i + 1} of ${name}\n\n**Agent:** \`${i % 3 ? 'implementer' : 'mechanic'}\`. **Risk:** \`${i % 4 ? 'normal' : 'sensitive'}\`.\n\n- [${i < ticked ? 'x' : ' '}] **Step 1: Do it.**\n- [${i < ticked ? 'x' : ' '}] **Step 2: Commit.**\n`).join('\n')}`

  write('CLAUDE.md', '## Project settings\n\n- Integration branch (workstream PRs go here): `develop`\n- Production branch (releases and hotfixes only): `main`\n')
  write('docs/HANDOFF.md', '## Next workstreams\n\n1. export: CSV export\n2. sso: Single sign-on\n3. audit-log: Audit log\n')
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'Release 1.0'], now - 2 * 24 * 60 * MIN)
  git(root, ['checkout', '-q', '-b', 'develop'])
  git(root, ['commit', '-q', '--allow-empty', '-m', 'Merge base (#1)'], now - 24 * 60 * MIN)

  let registry = '| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |\n| --- | --- | --- | --- | --- | --- | --- |\n'
  const iso = t => new Date(t).toISOString()
  const session = (id, over) => write(`.orchestra/sessions/${id}.json`, JSON.stringify({
    v: 1, session: id, role: 'workstream', workstream: null, branch: '', title: '', link: '', state: 'running', detail: '', stage: 'build', pr: '',
    context: { tokens: 90_000, window: 1_000_000 }, limits: [], warm: { pings: 0, last: null }, updatedAt: iso(now), options: [], waitingSince: null, ...over,
  }))
  session('maestro', { role: 'maestro', title: 'Maestro', state: 'idle', stage: '' })
  let waiting = 0
  for (let i = 0; i < n; i++) {
    const name = `ws-${String(i).padStart(2, '0')}`
    const wt = path.join(root, '.worktrees', name).replace(/\\/g, '/')
    git(root, ['worktree', 'add', '-q', '-b', name, wt, 'develop'])
    const rel = `docs/superpowers/plans/2026-10-30-${name}.md`
    fs.mkdirSync(path.join(wt, 'docs/superpowers/plans'), { recursive: true })
    // 0 to 7 tasks ticked, one commit per tick, 40 to 90 minutes apart.
    const ticked = (i * 3) % TASKS
    let t = now - (ticked + 1) * 90 * MIN
    for (let k = 0; k <= ticked; k++) {
      fs.writeFileSync(path.join(wt, rel), plan(name, k))
      git(wt, ['add', rel], t)
      git(wt, ['commit', '-q', '-m', k ? `Task ${k}` : 'Plan'], t)
      t += (40 + ((i + k) % 6) * 10) * MIN
    }
    registry += `| ${name} | s-${name} | \`${name}\` at \`${wt}\` | none | none | no | build |\n`
    if (i % 3 === 0) {
      waiting++
      session(`s-${name}`, { workstream: name, branch: name, state: 'waiting', detail: `asks: Approve step ${ticked + 1} of ${name}?`, options: ['Approve', 'Change it', 'Stop'], waitingSince: iso(now - (i + 5) * MIN) })
    } else session(`s-${name}`, { workstream: name, branch: name, state: i % 3 === 1 ? 'running' : 'idle' })
  }
  write('.orchestra/workstreams.md', registry)
  return { root, waiting }
}

// The gather and build that the server's tick runs, with an empty transcript folder and no ETA history.
async function snapshotTimes(root, reader, fresh) {
  const { buildSnapshot } = await import(pathToFileURL(path.join(LIVEVIEW, 'snapshot.mjs')).href)
  const out = []
  let mod = await import(SOURCES)
  for (let r = 0; r <= RUNS; r++) {
    // A fresh copy of sources.mjs starts with empty per-worktree caches, as the first tick of a new server does.
    if (fresh) mod = await import(`${SOURCES}?cold=${Date.now()}-${r}`)
    const t = performance.now()
    const snap = buildSnapshot(mod.gather(root, Date.now(), reader, []))
    out.push(performance.now() - t)
    if (snap.error) throw new Error(snap.error)
  }
  return out.slice(1)
}

function startChild(root, auto = false) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', root, ...(auto ? ['auto'] : [])], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
  const lines = []
  let buf = '', wake = null
  child.stdout.on('data', d => {
    buf += d
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) { lines.push(JSON.parse(buf.slice(0, i))); wake?.() }
  })
  const next = () => new Promise((resolve, reject) => {
    const check = () => { if (lines.length) resolve(lines.shift()); else wake = check }
    child.once('exit', code => reject(new Error(`server child exited with code ${code}`)))
    check()
  })
  return { child, next }
}

async function main() {
  const busyBefore = await busyPercent()
  const began = performance.now()
  const { TranscriptReader } = await import(SOURCES)
  const tx = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-bench-tx-'))
  const reader = new TranscriptReader(tx)
  const results = []
  const made = []
  try {
    for (const n of SIZES) {
      let t = performance.now()
      const { root, waiting } = makeProject(n)
      made.push(root)
      const setupMs = performance.now() - t
      const cold = await snapshotTimes(root, reader, true)
      const warm = await snapshotTimes(root, reader, false)

      const { child, next } = startChild(root)
      const first = await next()
      const api = `${first.url.replace('//localhost:', '//127.0.0.1:')}api/snapshot`
      const apiTimes = []
      let snap = null, bytes = 0
      for (let r = 0; r <= RUNS; r++) {
        t = performance.now()
        const body = await (await fetch(api)).text()
        if (r) apiTimes.push(performance.now() - t)
        snap = JSON.parse(body)
        bytes = Buffer.byteLength(body)
      }
      child.stdin.write('tick\n')
      const after = await next()
      if (child.exitCode === null) await new Promise(r => child.once('exit', r))

      // The same route while the server's own 5 s timer runs: a tick is synchronous, so a request that lands during one waits for it.
      const live = startChild(root, true)
      const liveApi = `${(await live.next()).url.replace('//localhost:', '//127.0.0.1:')}api/snapshot`
      const busyTimes = []
      for (let r = 0; r < LIVE_REQUESTS; r++) {
        await new Promise(res => setTimeout(res, LIVE_GAP_MS))
        t = performance.now()
        await (await fetch(liveApi)).text()
        busyTimes.push(performance.now() - t)
      }
      live.child.stdin.write('stop\n')
      await live.next()
      if (live.child.exitCode === null) await new Promise(r => live.child.once('exit', r))

      // Correctness: one row per workstream plus the maestro, every waiting session in the inbox, no error.
      const rows = snap.rows.filter(r => r.workstream).length
      const ok = !snap.error && rows === n && snap.inbox.length === waiting && snap.rows.every(r => !r.workstream || r.total === TASKS)
      const row = {
        workstreams: n, setupMs: Math.round(setupMs), checks: { ok, rows, inbox: snap.inbox.length, expectedInbox: waiting, snapshotBytes: bytes },
        coldSnapshotMs: { median: ms(median(cold)), runs: cold.map(ms) },
        warmSnapshotMs: { median: ms(median(warm)), runs: warm.map(ms) },
        apiSnapshotMs: { median: ms(median(apiTimes)), runs: apiTimes.map(ms) },
        apiWhileTickingMs: { median: ms(median(busyTimes)), max: ms(Math.max(...busyTimes)), over1s: busyTimes.filter(x => x > 1000).length, requests: busyTimes.length, runs: busyTimes.map(ms) },
        serverTickMs: { median: ms(median(after.ticks)), runs: after.ticks.map(ms) },
        rssMB: { afterFirstTick: mb(first.rssAfterFirstTick), after20Ticks: mb(after.rss) }, heapUsedMB: mb(after.heapUsed),
      }
      results.push(row)
      console.error(`N=${n} done`)
    }
  } finally {
    for (const root of made) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    fs.rmSync(tx, { recursive: true, force: true })
  }

  console.table(results.map(r => ({
    workstreams: r.workstreams, 'cold snapshot ms': r.coldSnapshotMs.median, 'warm snapshot ms': r.warmSnapshotMs.median,
    '/api/snapshot ms': r.apiSnapshotMs.median, 'while ticking median ms': r.apiWhileTickingMs.median, 'while ticking max ms': r.apiWhileTickingMs.max, 'tick ms': r.serverTickMs.median, 'RSS MB (20 ticks)': r.rssMB.after20Ticks, 'snapshot KB': Math.round(r.checks.snapshotBytes / 1024), ok: r.checks.ok,
  })))
  const totalS = Math.round((performance.now() - began) / 100) / 10
  const busyAfter = await busyPercent()
  console.log(`total ${totalS} s, machine busy ${busyBefore}% before and ${busyAfter}% after`)
  const out = {
    benchmark: 'liveview', date: new Date().toISOString(), machine: { ...machine(), cpuBusyPercentBefore: busyBefore, cpuBusyPercentAfter: busyAfter }, runs: RUNS, warmups: 1, ticks: TICKS, tasksPerPlan: TASKS,
    notes: [
      'coldSnapshotMs: gather() plus buildSnapshot() on a fresh copy of sources.mjs, so the per-worktree git caches are empty, as on a new server.',
      'warmSnapshotMs: the same on one module copy after a first call, so cached results are reused while HEAD does not move, as on every later 5 s tick.',
      'apiSnapshotMs: GET /api/snapshot on a started server between ticks; the route serves the snapshot built by the last tick.',
      'apiWhileTickingMs: 20 GET /api/snapshot requests, 500 ms apart, on a server whose own 5 s tick timer runs, as in real use.',
      'Ticks run back to back, not 5 s apart. The transcript folder is empty, so reading session transcripts is not measured. ETA history is empty.',
    ],
    totalSeconds: totalS, results,
  }
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true })
  fs.writeFileSync(path.join(HERE, 'results', 'liveview.json'), `${JSON.stringify(out, null, 2)}\n`)
}

// Share of CPU time the whole machine spent busy over one second, so a reader can see what else was running.
async function busyPercent() {
  const a = os.cpus()
  await new Promise(r => setTimeout(r, 1000))
  let idle = 0, total = 0
  os.cpus().forEach((c, i) => { for (const k of Object.keys(c.times)) { const d = c.times[k] - a[i].times[k]; total += d; if (k === 'idle') idle += d } })
  return Math.round(100 * (1 - idle / total))
}

function machine() {
  const c = os.cpus()
  return { cpu: c[0]?.model.trim(), logicalCores: c.length, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}`, node: process.version }
}
