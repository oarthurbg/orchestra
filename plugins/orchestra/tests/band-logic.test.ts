import { describe, expect, test } from 'claude-code/testing'

import {
  CONTEXT_LIMIT,
  STALE_MS,
  age,
  buildView,
  fmtK,
  isLocalUrl,
  isSafeTarget,
  mainCheckout,
  norm,
  openerArgv,
  parseRegistry,
  parseSessionFile,
  parseStatus,
  pingDue,
  roleOf,
  runOut,
} from '../hooks/band/logic'
import type { SessionFile } from '../hooks/band/types'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const file = (over: Partial<SessionFile>): SessionFile => ({
  v: 1, session: 's', role: 'workstream', workstream: 'billing', branch: 'billing', title: '', link: '',
  state: 'running', detail: '', stage: '', pr: '', context: { tokens: 50_000, window: 1_000_000 },
  limits: [], warm: { pings: 0, last: null }, updatedAt: iso(60_000), ...over,
})

const REGISTRY = `| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |
| --- | --- | --- | --- | --- | --- | --- |
| billing | s1 | \`billing\` at \`D:\\repo\\.worktrees\\billing\` | none | none | no | plan |
| reports | s2 | \`reports\` at \`/home/u/repo/.worktrees/reports\` | none | none | no | spec |
| auth | s3 | \`auth\` at \`/home/u/repo/.worktrees/auth\` | none | none | no | review |
`

describe('paths and registry', () => {
  test('norm makes Windows and POSIX paths comparable', () => {
    expect(norm('D:\\Repo\\x\\')).toBe('d:/Repo/x')
    expect(norm('/home/u/repo/')).toBe('/home/u/repo')
  })

  test('mainCheckout reads a worktree .git file and keeps a main checkout as is', () => {
    expect(mainCheckout('/home/u/repo', null)).toBe('/home/u/repo')
    expect(mainCheckout('/home/u/repo/.worktrees/auth', 'gitdir: /home/u/repo/.git/worktrees/auth\n')).toBe('/home/u/repo')
    expect(mainCheckout('D:\\repo\\.worktrees\\b', 'gitdir: D:/repo/.git/worktrees/b')).toBe('d:/repo')
    expect(mainCheckout('/x', 'not a gitdir line')).toBe('/x')
  })

  test('parseRegistry reads name and worktree, skipping header and separator', () => {
    const rows = parseRegistry(REGISTRY)
    expect(rows.length).toBe(3)
    expect(rows[0]).toEqual({ workstream: 'billing', worktree: 'd:/repo/.worktrees/billing' })
    expect(parseRegistry('')).toEqual([])
  })

  test('roleOf: main checkout is the orchestrator, a known worktree a workstream, anything else unregistered', () => {
    const rows = parseRegistry(REGISTRY)
    expect(roleOf('/home/u/repo', '/home/u/repo', rows)).toEqual({ role: 'orchestrator', workstream: null })
    expect(roleOf('/home/u/repo/.worktrees/auth/', '/home/u/repo', rows)).toEqual({ role: 'workstream', workstream: 'auth' })
    expect(roleOf('/home/u/repo/.worktrees/old', '/home/u/repo', rows)).toEqual({ role: 'unregistered', workstream: null })
  })
})

describe('status line and session files', () => {
  test('parseStatus reads state, stage, PR and what it waits on', () => {
    const note = '# billing\n\nStatus: waiting on owner · context 96k · plan, task 4 of 9 · PR none · waiting on: pick chart library, owner · updated 2026-10-30 11:40\n'
    expect(parseStatus(note)).toEqual({ state: 'waiting', stage: 'plan, task 4 of 9', pr: 'none', waitingOn: 'pick chart library, owner' })
    expect(parseStatus('Status: running · context 10k · spec · PR #12 ready · waiting on: none · updated x')).toEqual({ state: 'running', stage: 'spec', pr: '#12 ready', waitingOn: '' })
    expect(parseStatus('no status here')).toBeNull()
  })

  test('parseSessionFile accepts version 1 and refuses half-written or foreign files', () => {
    expect(parseSessionFile(JSON.stringify(file({})))?.session).toBe('s')
    expect(parseSessionFile('{"v": 1, "sess')).toBeNull()
    expect(parseSessionFile('{"v": 2, "session": "s"}')).toBeNull()
  })

  test('parseSessionFile refuses valid JSON of the wrong shape', () => {
    const { limits: _l, ...noLimits } = file({})
    expect(parseSessionFile('0')).toBeNull()
    expect(parseSessionFile('""')).toBeNull()
    expect(parseSessionFile('null')).toBeNull()
    expect(parseSessionFile(JSON.stringify(noLimits))).toBeNull()
    expect(parseSessionFile(JSON.stringify(file({ updatedAt: 'yesterday' })))).toBeNull()
  })
})

describe('pace', () => {
  const week = (percentUsed: number, resetsInDays: number) => ({ kind: 'seven_day', percentUsed, resetsAt: new Date(NOW + resetsInDays * 86_400_000).toISOString() })

  test('runOut projects the week average to 100%', () => {
    // 3.5 days in at 50%: 100% lands exactly at the reset, which is not a run-out.
    expect(runOut(week(50, 3.5), NOW)).toBeNull()
    // 4 days in, 80% used: 1 more day to 100%, reset is 3 days out.
    expect(runOut(week(80, 3), NOW)).toBe(NOW + 86_400_000)
  })

  test('runOut has no answer without a reset time or any use yet', () => {
    expect(runOut(undefined, NOW)).toBeNull()
    expect(runOut({ kind: 'seven_day', percentUsed: 40 }, NOW)).toBeNull()
    expect(runOut(week(0, 3), NOW)).toBeNull()
  })
})

describe('view', () => {
  const rows = parseRegistry(REGISTRY)
  const limits = [
    { kind: 'five_hour', percentUsed: 42, resetsAt: iso(-3_600_000) },
    { kind: 'seven_day', percentUsed: 80, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
  ]

  test('orchestrator: summary counts and one row per workstream that needs attention', () => {
    const files = [
      file({ session: 'a', workstream: 'billing', state: 'running', limits, updatedAt: iso(10_000) }),
      file({ session: 'b', workstream: 'reports', state: 'waiting', detail: 'asks: pick chart library', link: 'claude://claude.ai/epitaxy/local_b', title: 'Reports' }),
      file({ session: 'c', workstream: 'auth', state: 'idle', context: { tokens: 254_000, window: 1_000_000 } }),
      file({ session: 'd', role: 'unregistered', workstream: null, branch: 'old-try' }),
    ]
    const v = buildView({ inProject: true, role: 'orchestrator', self: 'o', files, registry: rows, now: NOW, liveview: '' })
    expect([v.fiveHour, v.week, v.runOut]).toEqual([42, 80, NOW + 86_400_000])
    expect([v.running, v.waiting]).toEqual([1, 1])
    expect(v.rows.map(r => [r.name, r.shape, r.reason])).toEqual([
      ['Reports', 'triangle', 'waiting on you'],
      ['auth', 'square', 'over 250k'],
      ['unregistered old-try', 'half', 'unregistered'],
    ])
    expect(v.rows[0]?.link).toBe('claude://claude.ai/epitaxy/local_b')
    expect(v.rows[1]?.context).toBe('254k')
  })

  test('a registered workstream with an old or missing report shows as stale', () => {
    const files = [file({ session: 'a', workstream: 'billing', updatedAt: iso(STALE_MS + 60_000) })]
    const v = buildView({ inProject: true, role: 'orchestrator', self: 'o', files, registry: rows, now: NOW, liveview: '' })
    expect(v.rows.map(r => [r.name, r.reason, r.detail])).toEqual([
      ['billing', 'stale', 'stale · 31m'],
      ['reports', 'stale', 'no report yet'],
      ['auth', 'stale', 'no report yet'],
    ])
    expect([v.running, v.waiting]).toEqual([0, 0])
    // A session waiting on the owner is idle and stops writing: it is never stale.
    const old = iso(2 * 3_600_000)
    const files2 = [
      file({ session: 'a', workstream: 'billing', state: 'running', updatedAt: old }),
      file({ session: 'b', workstream: 'reports', state: 'waiting', updatedAt: old }),
    ]
    const w = buildView({ inProject: true, role: 'orchestrator', self: 'o', files: files2, registry: rows, now: NOW, liveview: '' })
    expect([w.running, w.waiting]).toEqual([0, 1])
    expect(w.rows.slice(0, 2).map(r => [r.name, r.shape, r.reason])).toEqual([['billing', 'half', 'stale'], ['reports', 'triangle', 'waiting on you']])
  })

  test('a workstream session always shows its own row', () => {
    const me = file({ session: 'me', workstream: 'billing', stage: 'plan, task 4 of 9', warm: { pings: 2, last: iso(1000) } })
    const v = buildView({ inProject: true, role: 'workstream', self: 'me', files: [me], registry: rows, now: NOW, liveview: '' })
    expect(v.rows).toEqual([{ key: 'me', name: 'billing', link: '', shape: 'circle', reason: 'plan, task 4 of 9', context: '50k', detail: 'warm 2x' }])
  })

  test('an unregistered session draws only its own row, like a workstream', () => {
    const me = file({ session: 'me', role: 'unregistered', workstream: null, branch: 'old-try' })
    const other = file({ session: 'o2', workstream: 'billing', state: 'waiting' })
    const v = buildView({ inProject: true, role: 'unregistered', self: 'me', files: [me, other], registry: rows, now: NOW, liveview: '' })
    expect(v.rows.map(r => r.key)).toEqual(['me'])
  })

  test('a link that is not a safe claude:// target is dropped from its row', () => {
    const me = file({ session: 'me', link: 'claude://a&b' })
    const v = buildView({ inProject: true, role: 'workstream', self: 'me', files: [me], registry: rows, now: NOW, liveview: '' })
    expect(v.rows[0]?.link).toBe('')
    const web = file({ session: 'me', link: 'http://localhost:1/x' })
    expect(buildView({ inProject: true, role: 'workstream', self: 'me', files: [web], registry: rows, now: NOW, liveview: '' }).rows[0]?.link).toBe('')
  })

  test('freshness compares instants, not strings, across time zone offsets', () => {
    // 09:00 at -03:00 is 12:00Z, newer than 11:00Z although it sorts lower as text.
    const a = file({ session: 'a', limits: [{ kind: 'five_hour', percentUsed: 10 }], updatedAt: '2026-10-30T11:00:00Z' })
    const b = file({ session: 'b', workstream: 'reports', limits: [{ kind: 'five_hour', percentUsed: 30 }], updatedAt: '2026-10-30T09:00:00-03:00' })
    expect(buildView({ inProject: true, role: 'orchestrator', self: 'o', files: [a, b], registry: [], now: NOW, liveview: '' }).fiveHour).toBe(30)
    const regs = parseRegistry(REGISTRY)
    const c = file({ session: 'c', workstream: 'billing', state: 'waiting', title: 'old', updatedAt: '2026-10-30T11:50:00Z' })
    const d = file({ session: 'd', workstream: 'billing', state: 'waiting', title: 'new', updatedAt: '2026-10-30T08:55:00-03:00' })
    const v = buildView({ inProject: true, role: 'orchestrator', self: 'o', files: [c, d], registry: regs.slice(0, 1), now: NOW, liveview: '' })
    expect(v.rows[0]?.name).toBe('new')
  })

  test('outside a project: limits only, no rows', () => {
    const v = buildView({ inProject: false, role: 'orchestrator', self: 'o', files: [], registry: [], now: NOW, liveview: '', ownLimits: limits })
    expect(v.rows).toEqual([])
    expect(v.fiveHour).toBe(42)
  })

  test('the freshest limit reading wins', () => {
    const old = file({ session: 'a', limits: [{ kind: 'five_hour', percentUsed: 10 }], updatedAt: iso(600_000) })
    const fresh = file({ session: 'b', workstream: 'reports', limits: [{ kind: 'five_hour', percentUsed: 30 }], updatedAt: iso(1000) })
    const v = buildView({ inProject: true, role: 'orchestrator', self: 'o', files: [old, fresh], registry: rows, now: NOW, liveview: '' })
    expect(v.fiveHour).toBe(30)
  })

  test('the liveview URL passes only when it is local', () => {
    const v = buildView({ inProject: true, role: 'orchestrator', self: 'o', files: [], registry: [], now: NOW, liveview: 'http://localhost:4123/' })
    expect(v.liveview).toBe('http://localhost:4123/')
    expect(buildView({ inProject: true, role: 'orchestrator', self: 'o', files: [], registry: [], now: NOW, liveview: 'https://evil.example/' }).liveview).toBe('')
    expect(buildView({ inProject: true, role: 'orchestrator', self: 'o', files: [], registry: [], now: NOW, liveview: 'http://localhost:1/&calc.exe' }).liveview).toBe('')
  })
})

describe('keep-warm schedule', () => {
  const base = { now: NOW, lastRequestAt: NOW - 59 * 60_000 - 10_000, cacheMinutes: 60, warmMaxHours: 2, youngestRunningSince: NOW - 30 * 60_000 }

  test('pings one minute before a 60-minute cache ends, 30 seconds before a 5-minute one', () => {
    expect(pingDue(base)).toBe(true)
    expect(pingDue({ ...base, lastRequestAt: NOW - 58 * 60_000 })).toBe(false)
    expect(pingDue({ ...base, cacheMinutes: 5, lastRequestAt: NOW - 4 * 60_000 - 31_000 })).toBe(true)
    expect(pingDue({ ...base, cacheMinutes: 5, lastRequestAt: NOW - 4 * 60_000 })).toBe(false)
  })

  test('no subagent running, or one running past warmMaxHours, means no ping', () => {
    expect(pingDue({ ...base, youngestRunningSince: null })).toBe(false)
    expect(pingDue({ ...base, youngestRunningSince: NOW - 2 * 3_600_000 - 1 })).toBe(false)
  })
})

describe('small helpers', () => {
  test('formatting', () => {
    expect([fmtK(254_000), fmtK(96_400), fmtK(null), fmtK(800)]).toEqual(['254k', '96k', '?', '1k'])
    expect([age(31 * 60_000), age(2 * 3_600_000 + 5)]).toEqual(['31m', '2h'])
    expect(CONTEXT_LIMIT).toBe(250_000)
  })

  test('isLocalUrl and openerArgv', () => {
    expect(isLocalUrl('http://127.0.0.1:9000')).toBe(true)
    expect(isLocalUrl('http://localhost.evil.example')).toBe(false)
    expect(isLocalUrl('file:///etc/passwd')).toBe(false)
    expect(isLocalUrl('not a url')).toBe(false)
    expect(openerArgv('windows', 'claude://x')).toEqual(['cmd', '/c', 'start', '', 'claude://x'])
    expect(openerArgv('mac', 'claude://x')).toEqual(['open', 'claude://x'])
    expect(openerArgv('linux', 'claude://x')).toEqual(['xdg-open', 'claude://x'])
  })

  test('isSafeTarget accepts plain claude:// and local URLs, and openerArgv refuses the rest', () => {
    expect(isSafeTarget('claude://claude.ai/epitaxy/local_d07fe721-a1b0')).toBe(true)
    expect(isSafeTarget('http://localhost:4123/')).toBe(true)
    for (const bad of ['http://localhost:1/&calc.exe', 'claude://x&y', 'claude://x y', 'https://evil.example/', 'claude://x"y']) {
      expect(isSafeTarget(bad)).toBe(false)
      expect(() => openerArgv('windows', bad)).toThrow('unsafe target')
    }
  })
})
