import type { BandRow, BandView, Limit, LimitView, Mark, RegistryRow, Role, SessionFile, State, StatusLine } from './types'

export const CONTEXT_LIMIT = 250_000
export const STALE_MS = 30 * 60_000
// The fallback redraw: file watching redraws at once, this catches what it misses and ages stale rows.
export const REFRESH_MS = 5_000

// Forward slashes, no trailing slash, lowercase drive letter: paths from git, the registry and the engine compare equal.
export function norm(path: string): string {
  const p = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:/.test(p) ? p[0]!.toLowerCase() + p.slice(1) : p
}

// A worktree's .git is a file: "gitdir: <main>/.git/worktrees/<name>". null means .git is a folder (the main checkout).
export function mainCheckout(root: string, gitFile: string | null): string {
  if (gitFile === null) return norm(root)
  const dir = /^gitdir:\s*(.+)$/m.exec(gitFile)?.[1]
  const at = dir === undefined ? -1 : norm(dir).indexOf('/.git/worktrees/')
  return at < 0 ? norm(root) : norm(dir!).slice(0, at)
}

// Rows of .orchestra/workstreams.md: | name | session | `branch` at `path` | ...
export function parseRegistry(md: string): RegistryRow[] {
  return md.split('\n').flatMap(line => {
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    const worktree = /at `([^`]+)`/.exec(cells[2] ?? '')?.[1]
    return cells[0] && worktree && cells[0] !== 'Workstream' ? [{ workstream: cells[0], worktree: norm(worktree) }] : []
  })
}

// A path from the registry, made absolute against `base` with its . and .. segments folded.
export function resolvePath(base: string, path: string): string {
  const p = norm(path)
  const parts = (p.startsWith('/') || /^[a-z]:/.test(p) ? p : `${norm(base)}/${p}`).split('/')
  // parts[0] is '' for a POSIX root or the drive: .. never climbs past it.
  const out = [parts[0]!]
  for (const s of parts.slice(1)) {
    if (s === '..') { if (out.length > 1) out.pop() }
    else if (s !== '.' && s !== '') out.push(s)
  }
  return out.join('/')
}

export function roleOf(root: string, main: string, rows: RegistryRow[]): { role: Role; workstream: string | null } {
  const r = norm(root)
  if (r === norm(main)) return { role: 'maestro', workstream: null }
  const row = rows.find(x => resolvePath(main, x.worktree) === r)
  return row ? { role: 'principal', workstream: row.workstream } : { role: 'unregistered', workstream: null }
}

// "Status: <running | idle | waiting on owner> · context <N>k · <stage> · PR <...> · waiting on: <...> · updated <...>"
export function parseStatus(note: string): StatusLine | null {
  const line = /^Status:\s*(.+)$/m.exec(note)?.[1]
  if (line === undefined) return null
  const parts = line.split(' · ').map(p => p.trim())
  const head = parts[0] ?? ''
  const state: State | null = head.startsWith('waiting') ? 'waiting' : head === 'running' ? 'running' : head === 'idle' ? 'idle' : null
  const pr = parts.find(p => p.startsWith('PR '))?.slice(3) ?? ''
  const waiting = parts.find(p => p.startsWith('waiting on:'))?.slice('waiting on:'.length).trim() ?? ''
  const stage = parts.slice(1).find(p => !/^(context |PR |waiting on:|updated )/.test(p)) ?? ''
  return { state, stage, pr, waitingOn: waiting === 'none' ? '' : waiting }
}

export function parseSessionFile(text: string): SessionFile | null {
  try {
    const f = JSON.parse(text) as SessionFile | null
    const ok = typeof f === 'object' && f !== null && f.v === 1 && typeof f.session === 'string' && Array.isArray(f.limits) &&
      f.limits.every(l => typeof l === 'object' && l !== null && typeof l.kind === 'string' && typeof l.percentUsed === 'number') &&
      typeof f.context === 'object' && f.context !== null && (typeof f.context.tokens === 'number' || f.context.tokens === null) &&
      typeof f.warm === 'object' && f.warm !== null &&
      typeof f.updatedAt === 'string' && !Number.isNaN(Date.parse(f.updatedAt))
    return ok ? f : null
  } catch {
    return null
  }
}

// shortcut: uses the week's average burn rate, not the last few hours; switch to recent samples kept in the session files if the projection proves misleading.
export function runOut(limit: Limit | undefined, now: number): number | null {
  if (!limit?.resetsAt || limit.percentUsed <= 0) return null
  const resets = Date.parse(limit.resetsAt)
  const elapsed = now - (resets - 7 * 86_400_000)
  if (!(elapsed > 0)) return null
  const at = now + ((100 - limit.percentUsed) * elapsed) / limit.percentUsed
  return at < resets ? Math.round(at) : null
}

export const fmtK = (tokens: number | null) => (tokens === null ? '?' : `${Math.max(1, Math.round(tokens / 1000))}k`)
export const age = (ms: number) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} h` : `${Math.floor(ms / 60_000)} min`)

export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

// cmd /c start re-parses & | ^ % " < >, so only plain characters may reach it.
export function isSafeTarget(target: string): boolean {
  return /^claude:\/\/[A-Za-z0-9._\/-]+$/.test(target) || (isLocalUrl(target) && /^[A-Za-z0-9:/._?=-]+$/.test(target))
}

export function openerArgv(os: 'windows' | 'mac' | 'linux', target: string): string[] {
  if (!isSafeTarget(target)) throw new Error('unsafe target')
  return os === 'windows' ? ['cmd', '/c', 'start', '', target] : [os === 'mac' ? 'open' : 'xdg-open', target]
}

export type ViewInput = {
  inProject: boolean
  role: Role
  self: string
  files: SessionFile[]
  registry: RegistryRow[]
  now: number
  liveview: string
  ownLimits?: Limit[]
  // This session's own keep-warm pings, shown on the summary line in every role.
  pings?: number
}

const newest = (files: SessionFile[]) => files.reduce<SessionFile | undefined>((a, b) => (!a || Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a), undefined)
const limitView = (limits: Limit[], kind: string): LimitView | null => {
  const l = limits.find(x => x.kind === kind)
  return l ? { pct: l.percentUsed, resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null } : null
}

// The liveview's order: what needs the owner first.
const rank = (r: BandRow) => (r.mark === 'waiting' ? 0 : r.big ? 1 : r.mark === 'stale' ? 2 : 3)

// A question the session asks is stored as "asks: <question>"; the band says what to do with it.
const answer = (detail: string) => (detail ? `answer: ${detail.replace(/^asks:\s*/, '')}` : 'answer the open question')

export function buildView(i: ViewInput): BandView {
  const fresh = newest(i.files.filter(f => f.limits.length > 0))
  const limits = (fresh?.limits ?? i.ownLimits ?? []).filter(l => !l.resetsAt || Date.parse(l.resetsAt) > i.now)
  const week = limitView(limits, 'seven_day')
  const view: BandView = {
    inProject: i.inProject,
    role: i.role,
    pings: i.pings ?? 0,
    fiveHour: limitView(limits, 'five_hour'),
    week: week && { ...week, runOut: runOut(limits.find(l => l.kind === 'seven_day'), i.now) },
    running: 0,
    waiting: 0,
    total: i.registry.length,
    rows: [],
    liveview: isLocalUrl(i.liveview) && isSafeTarget(i.liveview) ? i.liveview : '',
  }
  if (!i.inProject) return view

  const open = i.registry.map(r => ({ ws: r.workstream, f: newest(i.files.filter(f => f.workstream === r.workstream)) }))
  view.running = open.filter(o => o.f?.state === 'running' && i.now - Date.parse(o.f.updatedAt) <= STALE_MS).length
  // A session waiting on the owner is idle and stops writing, so it never goes stale.
  view.waiting = open.filter(o => o.f?.state === 'waiting').length
  const row = (f: SessionFile, name: string, mark: Mark, status: string, detail: string): BandRow =>
    ({ key: f.session, name, link: isSafeTarget(f.link) && f.link.startsWith('claude://') ? f.link : '', mark, status, context: fmtK(f.context.tokens), big: (f.context.tokens ?? 0) >= CONTEXT_LIMIT, detail })

  if (i.role !== 'maestro') {
    const me = i.files.find(f => f.session === i.self)
    if (me) {
      view.rows = [row(me, me.title || me.workstream || me.branch, me.state, me.state, me.state === 'waiting' ? answer(me.detail) : me.stage)]
    }
    return view
  }

  for (const { ws, f } of open) {
    if (f === undefined) {
      view.rows.push({ key: `none-${ws}`, name: ws, link: '', mark: 'stale', status: 'stale', context: '?', big: false, detail: 'no report yet; check its session' })
      continue
    }
    const name = f.title || ws
    const old = i.now - Date.parse(f.updatedAt)
    if (f.state === 'waiting') view.rows.push(row(f, name, 'waiting', 'waiting', answer(f.detail)))
    else if ((f.context.tokens ?? 0) >= CONTEXT_LIMIT) {
      const mark = old > STALE_MS ? 'stale' : f.state
      view.rows.push(row(f, name, mark, mark, 'over 250k: clear context at the next wave end'))
    } else if (old > STALE_MS) view.rows.push(row(f, name, 'stale', 'stale', `no report for ${age(old)}; open it to check`))
  }
  for (const f of i.files) {
    if (f.role === 'unregistered' && i.now - Date.parse(f.updatedAt) <= STALE_MS) {
      view.rows.push(row(f, f.branch || f.title || 'worktree', 'stale', 'unregistered', 'not in workstreams.md; register or close it'))
    }
  }
  // Stable: rows of one kind keep the registry's order.
  view.rows.sort((a, b) => rank(a) - rank(b))
  return view
}

export type PingInput = {
  now: number
  lastRequestAt: number
  cacheMinutes: number
  warmMaxHours: number
  youngestRunningSince: number | null
}

export function pingDue(p: PingInput): boolean {
  if (p.youngestRunningSince === null || p.now - p.youngestRunningSince > p.warmMaxHours * 3_600_000) return false
  const margin = p.cacheMinutes <= 5 ? 30_000 : 60_000
  return p.now >= p.lastRequestAt + p.cacheMinutes * 60_000 - margin
}
