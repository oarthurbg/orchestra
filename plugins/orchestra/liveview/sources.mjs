// Everything liveview reads from disk and git. All I/O lives here; the maths is in snapshot.mjs.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { DAY, parseBranches, parsePlan, parseQueued, parseRegistry, planPathFromNote, timedTasks, usageEvent } from './snapshot.mjs'

const PLANS = 'docs/superpowers/plans'
const SPECS = 'docs/superpowers/specs'

export function readText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
}

// git output, or null when git is missing or the command fails.
export function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 10_000, windowsHide: true })
  } catch {
    return null
  }
}

// A committed file's size at HEAD, or null when git cannot read it.
export function committedSize(worktree, file) {
  const out = git(worktree, ['cat-file', '-s', `HEAD:${file}`])
  return out === null ? null : Number(out.trim())
}

// A committed file's bytes at HEAD, or null. Never the copy on disk, which may hold uncommitted work.
export function committedBytes(worktree, file, max) {
  try {
    return execFileSync('git', ['show', `HEAD:${file}`], { cwd: worktree, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: max + 1, timeout: 10_000, windowsHide: true })
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

// Versions of a plan file on a ref, oldest first. Author dates, since a rebase rewrites committer dates.
export function planVersions(cwd, ref, planPath) {
  const log = git(cwd, ['log', '--format=%H %at', ref, '--', planPath])
  if (!log) return []
  const commits = log.trim().split('\n').filter(Boolean).reverse().map(line => line.split(' '))
  const mds = blobs(cwd, commits.map(([sha]) => `${sha}:${planPath}`))
  return commits.flatMap(([sha, at], i) => (mds[i] === null ? [] : [{ at: Number(at) * 1000, md: mds[i], sha }]))
}

// Each object's text, or null when it is not a blob, from one git process instead of one per object.
function blobs(cwd, names) {
  let out
  try {
    out = execFileSync('git', ['cat-file', '--batch'], { cwd, input: `${names.join('\n')}\n`, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 10_000, windowsHide: true })
  } catch {
    return names.map(() => null)
  }
  // Each answer is "<sha> blob <size>\n<bytes>\n", or one line such as "<name> missing".
  let at = 0
  return names.map(() => {
    const nl = out.indexOf(10, at)
    const [, type, size] = out.toString('utf8', at, nl).split(' ')
    at = nl + 1
    if (type !== 'blob') return null
    const text = out.toString('utf8', at, at + Number(size))
    at += Number(size) + 1
    return text
  })
}

export function commitTimes(cwd, refArgs) {
  const log = git(cwd, ['log', '--format=%at', ...refArgs])
  return log ? log.trim().split('\n').filter(Boolean).map(s => Number(s) * 1000) : []
}

// First-parent commits on a branch since a time: merges on the integration branch, releases on production.
export function firstParent(cwd, branch, since) {
  if (!branch) return []
  const args = ['log', '--first-parent', `--since=${Math.floor(since / 1000)}`, '--format=%ct%x09%s']
  const log = git(cwd, [...args, `origin/${branch}`]) ?? git(cwd, [...args, branch])
  return log ? log.trim().split('\n').filter(Boolean).map(l => { const [ct, ...s] = l.split('\t'); return { at: Number(ct) * 1000, subject: s.join('\t') } }) : []
}

const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r) }

// A plan path comes from versioned files, so it must stay inside the worktree, symlinks resolved.
function safePlan(worktree, p) {
  if (!p || path.isAbsolute(p) || !inside(worktree, path.resolve(worktree, p))) return null
  try { return inside(fs.realpathSync(worktree), fs.realpathSync(path.join(worktree, p))) ? p : null } catch { return p } // shortcut: a path missing on disk skips the symlink check (nothing to read yet), check again at read time if the plan can appear in between
}

// The integration branch as git knows it, origin first as in findPlan, or null.
const integrationRef = (cwd, b) => (b ? [`origin/${b}`, b].find(r => git(cwd, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]) !== null) ?? null : null)

// The one plan file a branch adds: null when it adds none or several, undefined when git cannot tell.
function addedPlan(worktree, integration) {
  for (const base of integration ? [`origin/${integration}`, integration] : []) {
    const added = git(worktree, ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', PLANS])
    if (added === null) continue
    const files = added.trim().split('\n').filter(f => f.endsWith('.md'))
    return files.length === 1 ? files[0] : null
  }
  return undefined
}

// Which plan a workstream follows: its note's Plan line, else the one plan file its branch adds.
// at names HEAD and the integration tips; while it holds, the branch diff is reused.
const addedCache = new Map()
export function findPlan(worktree, name, integration, at = '') {
  const fromNote = safePlan(worktree, planPathFromNote(readText(path.join(worktree, 'docs', 'workstreams', `${name}.md`))))
  if (fromNote) return fromNote
  const key = `${worktree}|${integration}`
  const hit = at ? addedCache.get(key) : undefined
  const file = hit?.at === at ? hit.file : addedPlan(worktree, integration)
  if (at && file !== undefined) addedCache.set(key, { at, file })
  return safePlan(worktree, file)
}

// Per-worktree git results, reused while HEAD does not move. gather passes HEAD and the integration tips it reads once per tick.
const wsCache = new Map()
export function readWorkstream(row, integration, head, tips) {
  if (!row.worktree || !fs.existsSync(row.worktree)) return { worktreeMissing: true }
  head ??= git(row.worktree, ['rev-parse', 'HEAD'])?.trim() ?? ''
  const planPath = findPlan(row.worktree, row.name, integration, head && tips !== undefined ? `${head} ${tips}` : '')
  const planMd = planPath ? readText(path.join(row.worktree, planPath)) : null
  if (!planPath || planMd === null || parsePlan(planMd).length === 0) return {}
  const key = `${row.worktree}|${planPath}|${integration}`
  const cached = wsCache.get(key)
  if (cached && cached.head === head && head) return { planPath, planMd, versions: cached.versions, commits: cached.commits }
  const versions = planVersions(row.worktree, 'HEAD', planPath)
  const since = versions[0]?.at ?? Date.now() - 30 * DAY
  // Integration commits a merge or rebase brings in would split the task gaps.
  const base = integrationRef(row.worktree, integration)
  const commits = commitTimes(row.worktree, [`--since=${Math.floor(since / 1000)}`, 'HEAD', ...(base ? ['--not', base] : [])])
  wsCache.set(key, { head, versions, commits })
  return { planPath, planMd, versions, commits }
}

const PICTURE = /\.(png|jpe?g|gif|webp|svg)$/i

// Kind and sort rank of a file worth looking at before answering: pictures, pages, PDFs, specs, plans. null for the rest.
function fileKind(p) {
  const low = p.toLowerCase()
  // A mockup or screenshot can be a picture, a page or a PDF; a spec or plan keeps its own kind.
  const named = low.includes('mockup') ? 'Mockup' : low.includes('screenshot') ? 'Screenshot' : null
  if (PICTURE.test(low)) return [named ?? 'Image', 0]
  if (low.endsWith('.html')) return [named ?? 'Page', 1]
  if (low.endsWith('.pdf')) return [named ?? 'PDF', 2]
  if (!low.endsWith('.md')) return null
  if (p.startsWith(`${SPECS}/`)) return ['Spec', 3]
  if (p.startsWith(`${PLANS}/`)) return ['Plan', 4]
  return null
}

// The files a workstream's branch committed that the owner may look at, reused while HEAD does not move.
const filesCache = new Map()
export function branchFiles(worktree, integration, head = git(worktree, ['rev-parse', 'HEAD'])?.trim()) {
  if (!head) return []
  const key = `${worktree}|${integration}`
  if (filesCache.get(key)?.head === head) return filesCache.get(key).files
  const base = integrationRef(worktree, integration)
  // -z keeps unusual paths unquoted; --no-renames lists a renamed file as added, so it is kept.
  const out = base ? git(worktree, ['diff', '-z', '--no-renames', '--name-status', '--diff-filter=AM', `${base}...HEAD`]) : null
  const parts = (out ?? '').split('\0')
  const ranked = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const k = fileKind(parts[i + 1])
    if (k) ranked.push([k[1], { path: parts[i + 1], kind: k[0], change: parts[i] === 'A' ? 'added' : 'changed', picture: PICTURE.test(parts[i + 1]) }])
  }
  const files = ranked.sort((a, b) => a[0] - b[0] || (a[1].path < b[1].path ? -1 : a[1].path > b[1].path ? 1 : 0)).map(r => r[1])
  if (out !== null) filesCache.set(key, { head, files })
  return files
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
  // 0 minutes means ticked in the same commit as the task before; the file is append-only, so it would stay.
  const fresh = entries.filter(e => e.minutes > 0 && !known.has(`${e.plan}#${e.task}`))
  if (fresh.length === 0) return history
  const lines = fresh.map(({ plan, task, agent, risk, minutes, finishedAt }) => JSON.stringify({ plan, task, agent, risk, minutes, finishedAt }))
  fs.mkdirSync(path.join(main, '.orchestra'), { recursive: true })
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
    return timedTasks(p, versions, commitTimes(main, ['--first-parent', `--since=${Math.floor(versions[0].at / 1000)}`, versions.at(-1).sha]))
  })
}

// Reads Claude Code transcripts incrementally: only the bytes appended since the last pass.
export class TranscriptReader {
  constructor(dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'), chunk = 16 * 1024 * 1024) {
    this.dir = dir
    this.chunk = chunk
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
    let st = this.files.get(file)
    // The decoder keeps a multibyte character split across chunks or ticks whole.
    if (!st || size < st.offset) st = { offset: 0, rest: '', decoder: new StringDecoder('utf8') }
    if (size === st.offset) return
    let fd
    try {
      fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(Math.min(this.chunk, size - st.offset))
      while (st.offset < size) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - st.offset), st.offset)
        if (n === 0) break
        const lines = (st.rest + st.decoder.write(buf.subarray(0, n))).split('\n')
        st = { ...st, offset: st.offset + n, rest: lines.pop() ?? '' }
        for (const line of lines) {
          const e = line.includes('"usage"') ? usageEvent(line) : null
          if (e) this.events.set(e.id, e)
        }
      }
    } catch { /* deleted or locked between stat and read: skip this file for now */ } finally {
      if (fd !== undefined) fs.closeSync(fd)
      this.files.set(file, st)
    }
  }
}

const realKey = p => { let r = path.resolve(p); try { r = fs.realpathSync.native(r) } catch { /* not on disk */ } return process.platform === 'win32' ? r.toLowerCase() : r }

// The worktrees git itself lists for the main checkout, each with its HEAD ('' when unborn); a registry row naming anything else is not trusted.
function registeredWorktrees(main) {
  const out = git(main, ['worktree', 'list', '--porcelain']) ?? ''
  const heads = new Map()
  let key = null
  for (const l of out.split('\n')) {
    if (l.startsWith('worktree ')) heads.set(key = realKey(l.slice(9).trim()), '')
    else if (l.startsWith('HEAD ') && key) heads.set(key, l.slice(5).trim().replace(/^0+$/, ''))
  }
  return heads
}

// Everything buildSnapshot needs, read fresh.
export function gather(main, now, reader, history) {
  const registry = parseRegistry(readText(path.join(main, '.orchestra', 'workstreams.md')) ?? '').map(r => ({ ...r, worktree: path.resolve(main, r.worktree) }))
  const { integration, production } = parseBranches(readText(path.join(main, 'CLAUDE.md')))
  const known = registeredWorktrees(main)
  // Refs are shared by every worktree, so the integration tips are read once here, not per workstream.
  const tips = integration ? [`origin/${integration}`, integration].map(r => git(main, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`])?.trim() ?? '').join(' ') : ''
  const workstreams = Object.fromEntries(registry.map(r => {
    const head = known.get(realKey(r.worktree))
    return [r.name, head !== undefined ? { ...readWorkstream(r, integration, head, tips), files: branchFiles(r.worktree, integration, head) } : { worktreeMissing: true }]
  }))
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
    origin: git(main, ['remote', 'get-url', 'origin'])?.trim() ?? '',
  }
}
