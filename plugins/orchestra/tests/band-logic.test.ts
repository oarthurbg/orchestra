import { describe, expect, test } from 'claude-code/testing'

import {
  CONTEXT_LIMIT,
  STALE_MS,
  age,
  buildView,
  claudeArgv,
  fmtK,
  isLocalUrl,
  isNewer,
  isSafeTarget,
  mainCheckout,
  norm,
  openerArgv,
  parseRegistry,
  parseSessionFile,
  parseStatus,
  pingDue,
  resolvePath,
  roleOf,
  runOut,
} from '../hooks/band/logic'
import type { SessionFile } from '../hooks/band/types'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const file = (over: Partial<SessionFile>): SessionFile => ({
  v: 1, session: 's', role: 'principal', workstream: 'billing', branch: 'billing', title: '', link: '',
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

  test('roleOf: main checkout is the maestro, a known worktree a principal, anything else unregistered', () => {
    const rows = parseRegistry(REGISTRY)
    expect(roleOf('/home/u/repo', '/home/u/repo', rows)).toEqual({ role: 'maestro', workstream: null })
    expect(roleOf('/home/u/repo/.worktrees/auth/', '/home/u/repo', rows)).toEqual({ role: 'principal', workstream: 'auth' })
    expect(roleOf('/home/u/repo/.worktrees/old', '/home/u/repo', rows)).toEqual({ role: 'unregistered', workstream: null })
  })

  test('a relative registry path resolves against the main checkout, . and .. included', () => {
    const rel = parseRegistry('| x | s | `x` at `.worktrees/x` | |\n| app | s | `app-x` at `../app-x` | |\n| y | s | `y` at `./.worktrees/a/../y` | |\n')
    expect(roleOf('/home/u/repo/.worktrees/x', '/home/u/repo', rel)).toEqual({ role: 'principal', workstream: 'x' })
    expect(roleOf('/home/u/app-x', '/home/u/repo', rel)).toEqual({ role: 'principal', workstream: 'app' })
    expect(roleOf('D:\\repo\\.worktrees\\y', 'D:/repo', rel)).toEqual({ role: 'principal', workstream: 'y' })
    expect(resolvePath('/home/u/repo', '/abs/./p/../q')).toBe('/abs/q')
    expect(resolvePath('d:/repo', '..\\..\\..\\up')).toBe('d:/up')
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

  test('parseSessionFile refuses a bad limits entry or a context.tokens that is neither a number nor null', () => {
    const bad = (over: Record<string, unknown>) => parseSessionFile(JSON.stringify({ ...file({}), ...over }))
    expect(bad({ limits: ['five_hour'] })).toBeNull()
    expect(bad({ limits: [null] })).toBeNull()
    expect(bad({ limits: [{ kind: 5, percentUsed: 1 }] })).toBeNull()
    expect(bad({ limits: [{ kind: 'five_hour', percentUsed: '42' }] })).toBeNull()
    expect(bad({ context: { tokens: '182k', window: 1 } })).toBeNull()
    expect(bad({ context: { window: 1 } })).toBeNull()
    expect(bad({ context: { tokens: null, window: 1 }, limits: [{ kind: 'five_hour', percentUsed: 42 }] })?.session).toBe('s')
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

  test('maestro: summary counts and one row per workstream that needs attention', () => {
    const files = [
      file({ session: 'a', workstream: 'billing', state: 'running', limits, updatedAt: iso(10_000) }),
      file({ session: 'b', workstream: 'reports', state: 'waiting', detail: 'asks: pick chart library', link: 'claude://claude.ai/epitaxy/local_b', title: 'Reports' }),
      file({ session: 'c', workstream: 'auth', state: 'idle', context: { tokens: 254_000, window: 1_000_000 } }),
      file({ session: 'd', role: 'unregistered', workstream: null, branch: 'old-try' }),
    ]
    const v = buildView({ inProject: true, role: 'maestro', self: 'o', files, registry: rows, now: NOW, liveview: '' })
    expect([v.fiveHour?.pct, v.week?.pct, v.week?.runOut]).toEqual([42, 80, NOW + 86_400_000])
    expect([v.role, v.running, v.waiting, v.total]).toEqual(['maestro', 1, 1, 3])
    expect(v.rows.map(r => [r.name, r.mark, r.status, r.big, r.detail])).toEqual([
      ['Reports', 'waiting', 'waiting', false, 'answer: pick chart library'],
      ['auth', 'idle', 'idle', true, 'over 250k: clear context at the next wave end'],
      ['old-try', 'stale', 'unregistered', false, 'not in workstreams.md; register or close it'],
    ])
    expect(v.rows[0]?.link).toBe('claude://claude.ai/epitaxy/local_b')
    expect(v.rows[1]?.context).toBe('254k')
  })

  test('a registered workstream with an old or missing report shows as stale', () => {
    const files = [file({ session: 'a', workstream: 'billing', updatedAt: iso(STALE_MS + 60_000) })]
    const v = buildView({ inProject: true, role: 'maestro', self: 'o', files, registry: rows, now: NOW, liveview: '' })
    expect(v.rows.map(r => [r.name, r.status, r.detail])).toEqual([
      ['billing', 'stale', 'no report for 31 min; open it to check'],
      ['reports', 'stale', 'no report yet; check its session'],
      ['auth', 'stale', 'no report yet; check its session'],
    ])
    expect([v.running, v.waiting]).toEqual([0, 0])
    // A session waiting on the owner is idle and stops writing: it is never stale.
    const old = iso(2 * 3_600_000)
    const files2 = [
      file({ session: 'a', workstream: 'billing', state: 'running', updatedAt: old }),
      file({ session: 'b', workstream: 'reports', state: 'waiting', updatedAt: old }),
    ]
    const w = buildView({ inProject: true, role: 'maestro', self: 'o', files: files2, registry: rows, now: NOW, liveview: '' })
    expect([w.running, w.waiting]).toEqual([0, 1])
    // Waiting sorts first, ahead of the registry's order.
    expect(w.rows.slice(0, 2).map(r => [r.name, r.mark, r.status])).toEqual([['reports', 'waiting', 'waiting'], ['billing', 'stale', 'stale']])
  })

  test('a principal session always shows its own row', () => {
    const me = file({ session: 'me', workstream: 'billing', stage: 'plan, task 4 of 9', warm: { pings: 2, last: iso(1000) } })
    const v = buildView({ inProject: true, role: 'principal', self: 'me', files: [me], registry: rows, now: NOW, liveview: '' })
    expect(v.rows).toEqual([{ key: 'me', name: 'billing', link: '', mark: 'running', status: 'running', context: '50k', big: false, detail: 'plan, task 4 of 9' }])
    const own = (over: Partial<SessionFile>) => buildView({ inProject: true, role: 'principal', self: 'me', files: [{ ...me, ...over }], registry: rows, now: NOW, liveview: '' }).rows[0]
    expect(own({ state: 'idle' })).toMatchObject({ mark: 'idle', status: 'idle' })
    expect(own({ state: 'waiting', detail: 'asks: which port?' })).toMatchObject({ mark: 'waiting', status: 'waiting', detail: 'answer: which port?' })
    expect(own({ state: 'waiting', detail: '' })?.detail).toBe('answer the open question')
    expect(own({ context: { tokens: 260_000, window: 1_000_000 } })).toMatchObject({ mark: 'running', status: 'running', big: true })
  })

  test('rows sort waiting, then over 250k, then stale, then unregistered', () => {
    const files = [
      file({ session: 'x', role: 'unregistered', workstream: null, branch: 'stray' }),
      file({ session: 'a', workstream: 'billing', state: 'running', updatedAt: iso(STALE_MS + 60_000) }),
      file({ session: 'b', workstream: 'reports', context: { tokens: 300_000, window: 1_000_000 } }),
      file({ session: 'c', workstream: 'auth', state: 'waiting' }),
    ]
    const v = buildView({ inProject: true, role: 'maestro', self: 'o', files, registry: rows, now: NOW, liveview: '' })
    expect(v.rows.map(r => [r.name, r.status])).toEqual([['auth', 'waiting'], ['reports', 'running'], ['billing', 'stale'], ['stray', 'unregistered']])
  })

  test('the week carries its reset, and a run-out only when it lands before the reset', () => {
    const resetsAt = new Date(NOW + 3.5 * 86_400_000).toISOString()
    const v = buildView({ inProject: false, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: '', ownLimits: [{ kind: 'seven_day', percentUsed: 50, resetsAt }] })
    expect(v.week).toEqual({ pct: 50, resetsAt: Date.parse(resetsAt), runOut: null })
    expect(v.fiveHour).toBeNull()
  })

  test('the session own ping count reaches the view in every role and outside a project', () => {
    for (const role of ['maestro', 'principal', 'unregistered'] as const) {
      expect(buildView({ inProject: true, role, self: 'o', files: [], registry: rows, now: NOW, liveview: '', pings: 3 }).pings).toBe(3)
    }
    expect(buildView({ inProject: false, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: '', pings: 2 }).pings).toBe(2)
    expect(buildView({ inProject: false, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: '' }).pings).toBe(0)
  })

  test('a limit whose reset time has passed is dropped', () => {
    const past = [{ kind: 'five_hour', percentUsed: 97, resetsAt: iso(60_000) }, { kind: 'seven_day', percentUsed: 80, resetsAt: new Date(NOW + 86_400_000).toISOString() }]
    const v = buildView({ inProject: false, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: '', ownLimits: past })
    expect([v.fiveHour, v.week?.pct]).toEqual([null, 80])
  })

  test('an unregistered session draws only its own row, like a principal', () => {
    const me = file({ session: 'me', role: 'unregistered', workstream: null, branch: 'old-try' })
    const other = file({ session: 'o2', workstream: 'billing', state: 'waiting' })
    const v = buildView({ inProject: true, role: 'unregistered', self: 'me', files: [me, other], registry: rows, now: NOW, liveview: '' })
    expect(v.rows.map(r => r.key)).toEqual(['me'])
  })

  test('a link that is not a safe claude:// target is dropped from its row', () => {
    const me = file({ session: 'me', link: 'claude://a&b' })
    const v = buildView({ inProject: true, role: 'principal', self: 'me', files: [me], registry: rows, now: NOW, liveview: '' })
    expect(v.rows[0]?.link).toBe('')
    const web = file({ session: 'me', link: 'http://localhost:1/x' })
    expect(buildView({ inProject: true, role: 'principal', self: 'me', files: [web], registry: rows, now: NOW, liveview: '' }).rows[0]?.link).toBe('')
  })

  test('freshness compares instants, not strings, across time zone offsets', () => {
    // 09:00 at -03:00 is 12:00Z, newer than 11:00Z although it sorts lower as text.
    const a = file({ session: 'a', limits: [{ kind: 'five_hour', percentUsed: 10 }], updatedAt: '2026-10-30T11:00:00Z' })
    const b = file({ session: 'b', workstream: 'reports', limits: [{ kind: 'five_hour', percentUsed: 30 }], updatedAt: '2026-10-30T09:00:00-03:00' })
    expect(buildView({ inProject: true, role: 'maestro', self: 'o', files: [a, b], registry: [], now: NOW, liveview: '' }).fiveHour?.pct).toBe(30)
    const regs = parseRegistry(REGISTRY)
    const c = file({ session: 'c', workstream: 'billing', state: 'waiting', title: 'old', updatedAt: '2026-10-30T11:50:00Z' })
    const d = file({ session: 'd', workstream: 'billing', state: 'waiting', title: 'new', updatedAt: '2026-10-30T08:55:00-03:00' })
    const v = buildView({ inProject: true, role: 'maestro', self: 'o', files: [c, d], registry: regs.slice(0, 1), now: NOW, liveview: '' })
    expect(v.rows[0]?.name).toBe('new')
  })

  test('outside a project: limits only, no rows', () => {
    const v = buildView({ inProject: false, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: '', ownLimits: limits })
    expect(v.rows).toEqual([])
    expect(v.fiveHour?.pct).toBe(42)
  })

  test('the freshest limit reading wins', () => {
    const old = file({ session: 'a', limits: [{ kind: 'five_hour', percentUsed: 10 }], updatedAt: iso(600_000) })
    const fresh = file({ session: 'b', workstream: 'reports', limits: [{ kind: 'five_hour', percentUsed: 30 }], updatedAt: iso(1000) })
    const v = buildView({ inProject: true, role: 'maestro', self: 'o', files: [old, fresh], registry: rows, now: NOW, liveview: '' })
    expect(v.fiveHour?.pct).toBe(30)
  })

  test('the liveview URL passes only when it is local', () => {
    const v = buildView({ inProject: true, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: 'http://localhost:4123/' })
    expect(v.liveview).toBe('http://localhost:4123/')
    expect(buildView({ inProject: true, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: 'https://evil.example/' }).liveview).toBe('')
    expect(buildView({ inProject: true, role: 'maestro', self: 'o', files: [], registry: [], now: NOW, liveview: 'http://localhost:1/&calc.exe' }).liveview).toBe('')
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
    expect([age(31 * 60_000), age(2 * 3_600_000 + 5)]).toEqual(['31 min', '2 h'])
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
    expect(isSafeTarget('claude://claude.ai/epitaxy/local_0a1b2c3d-0000')).toBe(true)
    expect(isSafeTarget('http://localhost:4123/')).toBe(true)
    expect(isSafeTarget('https://github.com/oarthurbg/orchestra/blob/main/CHANGELOG.md')).toBe(true)
    for (const bad of ['http://localhost:1/&calc.exe', 'claude://x&y', 'claude://x y', 'https://evil.example/', 'claude://x"y']) {
      expect(isSafeTarget(bad)).toBe(false)
      expect(() => openerArgv('windows', bad)).toThrow('unsafe target')
    }
  })

  test('isNewer compares x.y.z versions and ignores anything else', () => {
    expect(isNewer('1.3.2', '1.3.1')).toBe(true)
    expect(isNewer('1.10.0', '1.9.9')).toBe(true)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('1.3.1', '1.3.1')).toBe(false)
    expect(isNewer('1.3.0', '1.3.1')).toBe(false)
    for (const bad of ['', '1.3', '1.3.2-beta', 'latest', '<html>']) expect(isNewer(bad, '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', 'dev')).toBe(false)
  })

  test('claudeArgv goes through cmd on Windows only', () => {
    expect(claudeArgv('windows', ['plugin', 'list'])).toEqual(['cmd', '/c', 'claude', 'plugin', 'list'])
    expect(claudeArgv('linux', ['plugin', 'list'])).toEqual(['claude', 'plugin', 'list'])
  })
})
