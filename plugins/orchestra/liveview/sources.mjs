// Everything liveview reads from disk and git. All I/O lives here; the maths is in snapshot.mjs.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DAY, parseBranches, parsePlan, parseQueued, parseRegistry, planPathFromNote, timedTasks, usageEvent } from './snapshot.mjs'

const PLANS = 'docs/superpowers/plans'

export function readText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
}

// git output, or null when git is missing or the command fails.
export function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  } catch {
    return null
  }
}

// Session files with the band's format. A file that fails to parse keeps its last good reading.
const lastGood = new Map()
export function readSessions(main) {
  const dir = path.join(main, '.orchestra', 'sessions')
  let names = []
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')) } catch { return [] }
  const out = []
  for (const n of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      if (s?.v !== 1) continue
      lastGood.set(n, s)
      out.push(s)
    } catch {
      if (lastGood.has(n)) out.push(lastGood.get(n))
    }
  }
  return out
}

// Versions of a plan file on a ref, oldest first.
export function planVersions(cwd, ref, planPath) {
  const log = git(cwd, ['log', '--format=%H %ct', ref, '--', planPath])
  if (!log) return []
  return log.trim().split('\n').filter(Boolean).reverse().flatMap(line => {
    const [sha, ct] = line.split(' ')
    const md = git(cwd, ['show', `${sha}:${planPath}`])
    return md === null ? [] : [{ at: Number(ct) * 1000, md }]
  })
}

export function commitTimes(cwd, refArgs) {
  const log = git(cwd, ['log', '--format=%ct', ...refArgs])
  return log ? log.trim().split('\n').filter(Boolean).map(s => Number(s) * 1000) : []
}

// First-parent commits on a branch since a time: merges on the integration branch, releases on production.
export function firstParent(cwd, branch, since) {
  if (!branch) return []
  const log = git(cwd, ['log', '--first-parent', `--since=${Math.floor(since / 1000)}`, '--format=%ct%x09%s', branch])
  return log ? log.trim().split('\n').filter(Boolean).map(l => { const [ct, ...s] = l.split('\t'); return { at: Number(ct) * 1000, subject: s.join('\t') } }) : []
}

// Which plan a workstream follows: its note's Plan line, else the one plan file its branch adds.
export function findPlan(worktree, name, integration) {
  const fromNote = planPathFromNote(readText(path.join(worktree, 'docs', 'workstreams', `${name}.md`)))
  if (fromNote) return fromNote
  for (const base of integration ? [`origin/${integration}`, integration] : []) {
    const added = git(worktree, ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', PLANS])
    if (added === null) continue
    const files = added.trim().split('\n').filter(f => f.endsWith('.md'))
    return files.length === 1 ? files[0] : null
  }
  return null
}

// Per-worktree git results, reused while HEAD does not move.
const wsCache = new Map()
export function readWorkstream(row, integration) {
  if (!row.worktree || !fs.existsSync(row.worktree)) return { worktreeMissing: true }
  const planPath = findPlan(row.worktree, row.name, integration)
  const planMd = planPath ? readText(path.join(row.worktree, planPath)) : null
  if (!planPath || planMd === null || parsePlan(planMd).length === 0) return {}
  const head = git(row.worktree, ['rev-parse', 'HEAD'])?.trim() ?? ''
  const key = `${row.worktree}|${planPath}`
  const cached = wsCache.get(key)
  if (cached && cached.head === head && head) return { planPath, planMd, versions: cached.versions, commits: cached.commits }
  const versions = planVersions(row.worktree, 'HEAD', planPath)
  const since = versions[0]?.at ?? Date.now() - 30 * DAY
  const commits = commitTimes(row.worktree, [`--since=${Math.floor(since / 1000)}`, 'HEAD'])
  wsCache.set(key, { head, versions, commits })
  return { planPath, planMd, versions, commits }
}

// The ETA history: one JSON line per finished task, keyed by plan and task.
export function readHistory(main) {
  const text = readText(path.join(main, '.orchestra', 'eta-history.jsonl')) ?? ''
  const seen = new Map()
  for (const line of text.split('\n')) {
    try { const h = JSON.parse(line); seen.set(`${h.plan}#${h.task}`, h) } catch { /* a torn last line */ }
  }
  return [...seen.values()]
}

export function appendHistory(main, history, entries) {
  const known = new Set(history.map(h => `${h.plan}#${h.task}`))
  const fresh = entries.filter(e => !known.has(`${e.plan}#${e.task}`))
  if (fresh.length === 0) return history
  const lines = fresh.map(({ plan, task, agent, risk, minutes, finishedAt }) => JSON.stringify({ plan, task, agent, risk, minutes, finishedAt }))
  fs.appendFileSync(path.join(main, '.orchestra', 'eta-history.jsonl'), `${lines.join('\n')}\n`)
  return [...history, ...fresh]
}

// Seeds the history from every plan file anywhere in the repository's history.
export function seedHistory(main) {
  const names = git(main, ['log', '--all', '--name-only', '--format=', '--', PLANS])
  const plans = [...new Set((names ?? '').split('\n').filter(f => f.endsWith('.md')))]
  return plans.flatMap(p => {
    const versions = planVersions(main, '--all', p)
    if (versions.length === 0) return []
    return timedTasks(p, versions, commitTimes(main, ['--all', `--since=${Math.floor(versions[0].at / 1000)}`]))
  })
}

// Reads Claude Code transcripts incrementally: only the bytes appended since the last pass.
export class TranscriptReader {
  constructor(dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')) {
    this.dir = dir
    this.files = new Map()
    this.events = new Map()
  }

  scan(now) {
    for (const file of this.list(this.dir, now - 8 * DAY)) this.readFile(file)
    for (const [id, e] of this.events) if (e.at < now - 8 * DAY) this.events.delete(id)
    return [...this.events.values()]
  }

  list(dir, since) {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
    return entries.flatMap(e => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return this.list(p, since)
      if (!e.name.endsWith('.jsonl')) return []
      try { return fs.statSync(p).mtimeMs >= since ? [p] : [] } catch { return [] }
    })
  }

  readFile(file) {
    let size
    try { size = fs.statSync(file).size } catch { return }
    let st = this.files.get(file) ?? { offset: 0, rest: '' }
    if (size < st.offset) st = { offset: 0, rest: '' }
    if (size === st.offset) return
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(size - st.offset)
      fs.readSync(fd, buf, 0, buf.length, st.offset)
      const lines = (st.rest + buf.toString('utf8')).split('\n')
      st = { offset: size, rest: lines.pop() ?? '' }
      for (const line of lines) {
        const e = line.includes('"usage"') ? usageEvent(line) : null
        if (e) this.events.set(e.id, e)
      }
    } finally {
      fs.closeSync(fd)
      this.files.set(file, st)
    }
  }
}

// Everything buildSnapshot needs, read fresh.
export function gather(main, now, reader, history) {
  const registry = parseRegistry(readText(path.join(main, '.orchestra', 'workstreams.md')) ?? '')
  const { integration, production } = parseBranches(readText(path.join(main, 'CLAUDE.md')))
  const workstreams = Object.fromEntries(registry.map(r => [r.name, readWorkstream(r, integration)]))
  const since = now - 3 * DAY
  return {
    now,
    project: path.basename(main),
    sessions: readSessions(main),
    registry,
    workstreams,
    history,
    events: reader.scan(now),
    merges: firstParent(main, integration, since),
    releases: firstParent(main, production, since),
    queued: parseQueued(readText(path.join(main, 'docs', 'HANDOFF.md'))),
  }
}
