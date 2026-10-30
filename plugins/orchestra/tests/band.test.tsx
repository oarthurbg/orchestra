import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { REFRESH_MS } from '../hooks/band/logic'

const ROOT = '/home/u/repo'
const BAND = {
  plugin: 'orchestra',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const REGISTRY = `| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |
| --- | --- | --- | --- | --- | --- | --- |
| reports | s2 | \`reports\` at \`/home/u/repo/.worktrees/reports\` | none | none | no | spec |
| auth | s3 | \`auth\` at \`/home/u/repo/.worktrees/auth\` | none | none | no | review |
`
const now = () => new Date().toISOString()
const report = (session: string, over: Record<string, unknown>) => JSON.stringify({
  v: 1, session, role: 'principal', workstream: null, branch: '', title: '', link: '', state: 'running', detail: '',
  stage: '', pr: '', context: { tokens: 40_000, window: 1_000_000 }, limits: [], warm: { pings: 0, last: null }, updatedAt: now(), ...over,
})

// A small file system: reads answer from `files`, writes land there, lists come from the paths.
// The engine resolves a path against the host (D:\home\u\repo on Windows): the fake sees it the POSIX way.
const posix = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

function disk(on: On, files: Record<string, string>, failWrites = false) {
  const under = (dir: string) => Object.keys(files).filter(k => k.startsWith(`${dir}/`))
  // Each write moves a file's mtime; `touch` does it for a test that changes `files` itself.
  const mtime: Record<string, number> = {}
  const reads: Record<string, number> = {}
  let tick = 1
  on('fs.read', ($, e) => {
    reads[posix(e.path)] = (reads[posix(e.path)] ?? 0) + 1
    return posix(e.path) in files ? { value: files[posix(e.path)]! } : ({ deny: 'missing' }) as never
  })
  on('fs.write', ($, e) => { if (failWrites) return { deny: 'disk full' } as never; files[posix(e.path)] = e.text; mtime[posix(e.path)] = ++tick; return { value: undefined } })
  on('fs.exists', ($, e) => ({ value: posix(e.path) in files || under(posix(e.path)).length > 0 }))
  // exists() and stat() agree: a folder is there when a file lies under it.
  on('fs.stat', ($, e) => (posix(e.path) in files
    ? { value: { kind: 'file', size: 1, mtimeMs: mtime[posix(e.path)] ?? 1, isLink: false } }
    : under(posix(e.path)).length > 0 ? { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false } } : ({ deny: 'missing' }) as never))
  on('fs.list', ($, e) => ({
    value: under(posix(e.path)).filter(k => !k.slice(posix(e.path).length + 1).includes('/'))
      .map(k => ({ name: k.slice(posix(e.path).length + 1), kind: 'file', size: 1, mtimeMs: mtime[k] ?? 1, isLink: false })),
  }) as never)
  return { reads, touch: (path: string) => { mtime[path] = ++tick } }
}

function session(on: On, root: string, id: string, agents: () => unknown[] = () => [], title: () => string | null = () => 'Maestro') {
  const clock = mock.clock(on, { now: Date.now() })
  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: root }))
  on('session.id', () => ({ value: id }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 30_000, window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }] } }) as never)
  // A null title means the app's session server is gone: the call rejects.
  on('mcp.call', () => { const t = title(); return (t === null ? { deny: 'no session server' } : { value: { content: [{ type: 'text', text: JSON.stringify({ title: t, link: 'claude://claude.ai/epitaxy/local_o' }) }] } }) as never })
  on('agent.list', () => ({ value: agents() }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return clock
}

test('the maestro band shows the summary and only the workstreams that need attention', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/sessions/s2.json`]: report('s2', { workstream: 'reports', state: 'waiting', detail: 'asks: pick chart library', link: 'claude://claude.ai/epitaxy/local_s2', title: 'Reports' }),
    [`${ROOT}/.orchestra/sessions/s3.json`]: report('s3', { workstream: 'auth', context: { tokens: 254_000, window: 1_000_000 } }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  // The main checkout: .git is a folder, so reading it as a file fails.
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /42% used/ }))).toBeDefined()
    expect(await ui.find({ key: 's2-name' })).toBeDefined()
    expect(await ui.find({ key: 's2-detail' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /over 250k/ }))).toBeDefined()
    // auth is running, only over 250k.
    expect((await ui.find({ type: 'Text', text: /1 of 2 running/ }))).toBeDefined()
    // Two rows fit the compact band: no arrow, no headings.
    expect(await ui.find({ key: 'orchestra-toggle' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Workstream$/ })).toBeUndefined()
    expect(await ui.find({ key: 'liveview' })).toBeUndefined()
    // The desktop draws nothing for an Svg with an empty alt.
    const svgs = await ui.findAll({ type: 'Svg' })
    // The mark, the 5-hour bar (the week has no reading), two shapes and one divider.
    expect(svgs.length).toBe(surface === 'desktop' ? 5 : 0)
    for (const s of svgs) expect(String(s.props.alt)).not.toBe('')
    await ui.unmount()
  }
  // Its own report landed in the main checkout.
  expect(JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).role).toBe('maestro')
})

test('a project without .orchestra/ shows the limits line only and writes nothing', async ($, on) => {
  const files: Record<string, string> = {}
  disk(on, files)
  session(on, '/home/u/other', 'x')
  await $.session.start({ cwd: '/home/u/other', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /42% used/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orchestra/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running/ })).toBeUndefined()
  expect(Object.keys(files)).toEqual([])
  await ui.unmount()
})

test('the Liveview button shows only for a local URL', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/liveview.json`]: JSON.stringify({ url: 'http://localhost:4123/' }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'liveview' })).toBeDefined()
  await ui.unmount()
})

test('a band another mod draws stays beneath ours', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  session(on, ROOT, 'o')
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /other band/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orchestra/ })).toBeDefined()
  await ui.unmount()
})

test('a stale report shows up on a tick even when no file changed', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY.split(String.fromCharCode(10)).filter(l => !l.includes('reports')).join(String.fromCharCode(10)),
    [`${ROOT}/.orchestra/sessions/s3.json`]: report('s3', { workstream: 'auth' }),
  }
  disk(on, files)
  const clock = session(on, ROOT, 'o')
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /stale/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(31 * 60_000)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /stale/ })).toBeDefined()
  await ui.unmount()
})

test('a worktree session reports into the main checkout and reads its branch from the worktree gitdir', async ($, on) => {
  const WT = `${ROOT}/.worktrees/reports`
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${WT}/.git`]: `gitdir: ${ROOT}/.git/worktrees/reports`,
    [`${ROOT}/.git/worktrees/reports/HEAD`]: 'ref: refs/heads/reports-branch',
  }
  disk(on, files)
  session(on, WT, 'w')
  await $.session.start({ cwd: WT, surface: 'desktop', isInteractive: true })
  const mine = JSON.parse(files[`${ROOT}/.orchestra/sessions/w.json`]!)
  expect(mine).toMatchObject({ role: 'principal', workstream: 'reports', branch: 'reports-branch' })
  expect(Object.keys(files).filter(k => k.startsWith(`${WT}/.orchestra`))).toEqual([])
})

test('a liveview URL that is not local shows no button', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/liveview.json`]: JSON.stringify({ url: 'https://example.com/' }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'liveview' })).toBeUndefined()
  await ui.unmount()
})

test('a failed write of its own report still draws the band', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files, true)
  session(on, ROOT, 'o')
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /42% used/ })).toBeDefined()
  await ui.unmount()
})

test('a Liveview press that exits non-zero toasts instead of failing quietly', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/liveview.json`]: JSON.stringify({ url: 'http://localhost:4123/' }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  mock.env(on, { OS: 'Windows_NT' })
  let exitCode = 1
  const toasts: string[] = []
  on('process.run', () => ({ value: { exitCode, stdout: '', stderr: '' } }) as never)
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'liveview' })
  expect(toasts).toEqual(['orchestra band: could not open it'])
  exitCode = 0
  await ui.press({ key: 'liveview' })
  expect(toasts).toHaveLength(1)
  await ui.unmount()
})

test('keep-warm pings once while a subagent runs and the cache is about to end', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  let running = true
  const clock = session(on, ROOT, 'o', () => (running ? [{ id: 'a1', description: 'long task', type: 'implementer', status: 'running' }] : []))
  let forks = 0
  let answered = true
  on('model.fork', () => {
    forks += 1
    return { value: answered ? { isAnswered: true, text: 'ok', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0 } } : { isAnswered: false, reason: 'nothing-to-fork' } } as never
  })

  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  // The last request was at start; a 5-minute cache gets its ping 30 seconds before it ends.
  await clock.advance(4 * 60_000)
  expect(forks).toBe(0)
  await clock.advance(40_000)
  expect(forks).toBe(1)
  expect(JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).warm.pings).toBe(1)
  // The ping counts as a request: the next one waits for the next cache window.
  await clock.advance(60_000)
  expect(forks).toBe(1)
  // An unanswered fork is not a ping.
  answered = false
  await clock.advance(4 * 60_000)
  expect(forks).toBe(2)
  expect(JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).warm.pings).toBe(1)
  running = false
  await clock.advance(10 * 60_000)
  expect(forks).toBe(2)
})

const AGENT = (id: string) => ({ id, description: id, type: 'implementer', status: 'running' })
const REPLY = { isAnswered: true, text: 'ok', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0 } }
const MIN = 60_000
const REFRESH = REFRESH_MS

// Counts forks; the reply is `reply()`, or a denial when it returns null.
function forker(on: On, reply: () => unknown = () => REPLY) {
  const n = { count: 0 }
  on('model.fork', () => { n.count += 1; const r = reply(); return (r === null ? { deny: 'boom' } : { value: r }) as never })
  return n
}
const pings = (files: Record<string, string>) => JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).warm.pings as number
const start = ($: { session: { start: (e: { cwd: string; surface: 'desktop'; isInteractive: boolean }) => Promise<unknown> } }) =>
  $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })

test('keep-warm goes on for a young subagent after an old one passed warmMaxHours, and stops when only the old one is left', { options: { cacheMinutes: 5, warmMaxHours: 1 }, timeoutMs: 30_000 }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  let agents = [AGENT('old')]
  const clock = session(on, ROOT, 'o', () => agents)
  const forks = forker(on)
  await start($)
  await clock.advance(59 * MIN)
  expect(forks.count).toBeGreaterThan(0)
  agents = [AGENT('old'), AGENT('young')]
  await clock.advance(MIN)
  const before = forks.count
  await clock.advance(10 * MIN)
  expect(forks.count).toBeGreaterThan(before)
  agents = [AGENT('old')]
  await clock.advance(MIN)
  const after = forks.count
  await clock.advance(20 * MIN)
  expect(forks.count).toBe(after)
})

test('a subagent that finished is forgotten: the same id later starts a fresh age', { options: { cacheMinutes: 5, warmMaxHours: 1 }, timeoutMs: 30_000 }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  let agents = [AGENT('a1')]
  const clock = session(on, ROOT, 'o', () => agents)
  const forks = forker(on)
  await start($)
  await clock.advance(50 * MIN)
  agents = []
  await clock.advance(MIN)
  agents = [AGENT('a1')]
  await clock.advance(11 * MIN)
  const before = forks.count
  await clock.advance(5 * MIN)
  expect(forks.count).toBeGreaterThan(before)
})

test('a fork that rejects is swallowed and not counted as a ping', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  let fail = true
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on, () => (fail ? null : REPLY))
  await start($)
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(1)
  expect(pings(files)).toBe(0)
  fail = false
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(2)
  expect(pings(files)).toBe(1)
})

test('a cacheMinutes of zero falls back to 60 instead of pinging on every tick', { options: { cacheMinutes: 0 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on)
  await start($)
  await clock.advance(10 * MIN)
  expect(forks.count).toBe(0)
  await clock.advance(50 * MIN)
  expect(forks.count).toBe(1)
})

test('a negative warmMaxHours falls back to 2 hours', { options: { cacheMinutes: 5, warmMaxHours: -1 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on)
  await start($)
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(1)
})

// The bottom of a model request: answers at once, with no usage.
function steps(on: On) {
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
}
const step = async ($: { turn: { step: (e: { turnId: string; index: number; model: string; messageCount: number; agentId?: string }) => AsyncGenerator<unknown, unknown> } }, agentId?: string) => {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1, ...(agentId ? { agentId } : {}) })) { /* drain */ }
}

test('during a turn with no main-thread request for longer than the cache lifetime, a ping goes out', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(1)
})

test('a main-thread turn.step pushes the ping back; a subagent turn.step does not', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on)
  steps(on)
  await start($)
  await clock.advance(4 * MIN)
  await step($)
  await clock.advance(4 * MIN)
  expect(forks.count).toBe(0)
  await step($, 'a1')
  await clock.advance(MIN)
  expect(forks.count).toBe(1)
})

test('a session.measure is not a main-thread request: it does not push the ping back', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await start($)
  await clock.advance(4 * MIN)
  await $.session.measure({ context: { tokens: 30_000, window: 1_000_000 }, rateLimits: [], changed: [] } as never)
  await clock.advance(MIN)
  expect(forks.count).toBe(1)
})

test('a fork that missed the cache is no ping: it counts a miss, toasts once and waits for the next main-thread request', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  // The session holds 30k of context; a fork that read 1k of it from the cache paid for the rest.
  const forks = forker(on, () => ({ ...REPLY, usage: { ...REPLY.usage, cache_read_input_tokens: 1_000 } }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  steps(on)
  await start($)
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(1)
  const warm = () => JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).warm
  expect(warm()).toMatchObject({ pings: 0, misses: 1 })
  expect(toasts).toEqual(['orchestra band: keep-warm missed the cache; set cacheMinutes lower (5 for API keys and overage)'])
  await clock.advance(20 * MIN)
  expect(forks.count).toBe(1)
  await step($)
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(2)
  expect(warm()).toMatchObject({ pings: 0, misses: 2 })
  expect(toasts).toHaveLength(1)
})

test('the summary line shows the ping count in a maestro session', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  forker(on)
  await start($)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /warm/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(5 * MIN)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /warm 1x/ })).toBeDefined()
  await ui.unmount()
})

test('the summary line shows the ping count outside an orchestra project too', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = {}
  disk(on, files)
  const clock = session(on, '/home/u/other', 'x', () => [AGENT('a1')])
  forker(on)
  await $.session.start({ cwd: '/home/u/other', surface: 'desktop', isInteractive: true })
  await clock.advance(5 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /warm 1x/ })).toBeDefined()
  expect(Object.keys(files)).toEqual([])
  await ui.unmount()
})

test('a report whose re-read fails keeps its row, and an unchanged report is not re-read', async ($, on) => {
  const S2 = `${ROOT}/.orchestra/sessions/s2.json`
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [S2]: report('s2', { workstream: 'reports', state: 'waiting', detail: 'asks: pick chart library' }),
  }
  const fs = disk(on, files)
  const clock = session(on, ROOT, 'o')
  await start($)
  await clock.advance(REFRESH)
  await clock.advance(REFRESH)
  expect(fs.reads[S2]).toBe(1)
  // Half-written: the file changed and does not parse.
  files[S2] = '{"v": 1, "sess'
  fs.touch(S2)
  await clock.advance(REFRESH)
  expect(fs.reads[S2]).toBe(2)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^waiting$/ })).toBeDefined()
  await ui.unmount()
})

test('a report that disappeared is forgotten', async ($, on) => {
  const S2 = `${ROOT}/.orchestra/sessions/s2.json`
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [S2]: report('s2', { workstream: 'reports', state: 'waiting' }),
  }
  disk(on, files)
  const clock = session(on, ROOT, 'o')
  await start($)
  delete files[S2]
  await clock.advance(REFRESH)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^waiting$/ })).toBeUndefined()
  await ui.unmount()
})

test('an AskUserQuestion call writes waiting with its question, and clears it afterwards', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  session(on, ROOT, 'o')
  const mine = () => JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!) as { state: string; detail: string }
  let during: { state: string; detail: string } | undefined
  on('tool.call', () => { during = mine(); return { result: { questions: [], answers: {} } } as never })
  await start($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which chart library?', header: 'Library', multiSelect: false, options: [{ label: 'a', description: 'a' }, { label: 'b', description: 'b' }] }] } as never)
  expect(during).toMatchObject({ state: 'waiting', detail: 'asks: Which chart library?' })
  expect(mine()).toMatchObject({ state: 'idle', detail: '' })
})

test('a main-thread turn.complete reads the sidebar title again', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  let title = 'New session'
  const clock = session(on, ROOT, 'o', () => [], () => title)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await start($)
  const mine = () => JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).title as string
  expect(mine()).toBe('New session')
  title = 'Fix the login page'
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
  // The title is read without holding up the turn: wait for it to land.
  for (let i = 0; i < 50 && mine() !== title; i++) await clock.advance(1)
  expect(mine()).toBe('Fix the login page')
})

test('a refresh that rejects does not stop the keep-warm check', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  let broken = false
  on('state.set', () => ({ value: { isSet: !broken, version: 1 } }) as never)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on)
  await start($)
  broken = true
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(1)
})

test('a subagent turn is not the session turn: the ping goes out and the report stays idle', { options: { cacheMinutes: 5, warmMaxHours: 2 } }, async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  const clock = session(on, ROOT, 'o', () => [AGENT('a1')])
  const forks = forker(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
  expect(JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).state).toBe('idle')
  await clock.advance(5 * MIN)
  expect(forks.count).toBe(1)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' })
  expect(JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).state).toBe('idle')
})

test('a get_session call that rejects later keeps the title and link already read', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  let title: string | null = 'Maestro'
  session(on, ROOT, 'o', () => [], () => title)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await start($)
  title = null
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't2' })
  const mine = JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!)
  expect(mine).toMatchObject({ title: 'Maestro', link: 'claude://claude.ai/epitaxy/local_o' })
})

const REGISTRY3 = `${REGISTRY}| billing | s1 | \`billing\` at \`/home/u/repo/.worktrees/billing\` | none | none | no | plan |
`

test('more than two rows: the compact band shows two and a count, the arrow opens all of them with headings and is remembered', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY3,
    [`${ROOT}/.orchestra/sessions/s2.json`]: report('s2', { workstream: 'reports', state: 'waiting', link: 'claude://claude.ai/epitaxy/local_s2' }),
    [`${ROOT}/.orchestra/sessions/s3.json`]: report('s3', { workstream: 'auth', context: { tokens: 254_000, window: 1_000_000 } }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  mock.store(on)
  await start($)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /\+1 more: stale/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no report yet/ })).toBeUndefined()
  await ui.press({ key: 'orchestra-toggle' })
  await ui.unmount()
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /no report yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Workstream$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /more:/ })).toBeUndefined()
  await ui.unmount()
  // A new session reads the choice back from the store.
  await start($)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Workstream$/ })).toBeDefined()
  await ui.unmount()
})

test('the empty states: no workstreams yet, and nothing needs you', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY.split(String.fromCharCode(10)).slice(0, 2).join(String.fromCharCode(10)) }
  disk(on, files)
  session(on, ROOT, 'o')
  on('classic.FileChanged', () => ({}))
  await start($)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /No workstreams yet/ })).toBeDefined()
  await ui.unmount()
  files[`${ROOT}/.orchestra/workstreams.md`] = REGISTRY
  files[`${ROOT}/.orchestra/sessions/s2.json`] = report('s2', { workstream: 'reports' })
  files[`${ROOT}/.orchestra/sessions/s3.json`] = report('s3', { workstream: 'auth' })
  await $.classic.FileChanged({ file_path: `${ROOT}/.orchestra/workstreams.md`, event: 'change' })
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Nothing needs you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 of 2 running/ })).toBeDefined()
  await ui.unmount()
})

test('SessionStart asks to watch the reports, and a changed report redraws before the timer', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  session(on, ROOT, 'o')
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  await start($)
  const r = await $.classic.SessionStart({ source: 'startup' })
  expect(r.watchPaths).toContain(`${ROOT}/.orchestra/sessions`)
  files[`${ROOT}/.orchestra/sessions/s2.json`] = report('s2', { workstream: 'reports', state: 'waiting', link: 'claude://claude.ai/epitaxy/local_s2' })
  await $.classic.FileChanged({ file_path: `${ROOT}/.orchestra/sessions/s2.json`, event: 'add' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^waiting$/ })).toBeDefined()
  await ui.unmount()
})

test('the ponytail switch shows only while ponytail hides its own band, and runs its command', async ($, on) => {
  const CFG = '/home/u/.claude'
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${CFG}/plugins/installed_plugins.json`]: '{"plugins": {"ponytail@ponytail": []}}',
    [`${CFG}/.ponytail-active`]: 'full\n',
    [`${CFG}/.ponytail-band`]: 'off',
  }
  disk(on, files)
  session(on, ROOT, 'o')
  mock.env(on, { CLAUDE_CONFIG_DIR: CFG })
  const runs: string[][] = []
  on('command.run', ($, e) => { runs.push([e.command, e.args]); return { text: '' } })
  on('classic.FileChanged', () => ({}))
  await start($)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'orchestra-ponytail-full' })).toBeDefined()
  await ui.press({ key: 'orchestra-ponytail-lite' })
  expect(runs).toEqual([['ponytail:ponytail', 'lite']])
  await ui.unmount()
  // ponytail's own band is back: ours drops its switch.
  files[`${CFG}/.ponytail-band`] = 'on'
  await $.classic.FileChanged({ file_path: `${CFG}/.ponytail-band`, event: 'change' })
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'orchestra-ponytail-full' })).toBeUndefined()
  await ui.unmount()
})

test('a principal session shows its own row and no arrow or running count', async ($, on) => {
  const WT = `${ROOT}/.worktrees/reports`
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${WT}/.git`]: `gitdir: ${ROOT}/.git/worktrees/reports`,
  }
  disk(on, files)
  session(on, WT, 'w')
  await $.session.start({ cwd: WT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'w-name' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /of 2 running/ })).toBeUndefined()
  expect(await ui.find({ key: 'orchestra-toggle' })).toBeUndefined()
  await ui.unmount()
})

test('an empty registry still shows an unregistered worktree session', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY.split(String.fromCharCode(10)).slice(0, 2).join(String.fromCharCode(10)),
    [`${ROOT}/.orchestra/sessions/x.json`]: report('x', { role: 'unregistered', branch: 'stray-branch' }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /stray-branch/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No workstreams yet/ })).toBeUndefined()
  await ui.unmount()
})

test('any cell of a row opens its session, and the week shows its reset or its run-out', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/sessions/s2.json`]: report('s2', { workstream: 'reports', state: 'waiting', link: 'claude://claude.ai/epitaxy/local_s2' }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  mock.env(on, { OS: 'Windows_NT' })
  const argv: string[][] = []
  on('process.run', ($, e) => { argv.push([...(e as unknown as { argv: string[] }).argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } as never })
  const week = (percentUsed: number, days: number) => [{ kind: 'seven_day', percentUsed, resetsAt: new Date(Date.now() + days * 86_400_000).toISOString() }]
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await start($)
  await $.session.measure({ context: { tokens: 30_000, window: 1_000_000 }, rateLimits: week(10, 3), changed: [] } as never)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  for (const part of ['status', 'context', 'detail']) await ui.press({ key: `s2-${part}` })
  expect(argv.map(a => a.at(-1))).toEqual(Array(3).fill('claude://claude.ai/epitaxy/local_s2'))
  expect(await ui.find({ type: 'Text', text: /^resets / })).toBeDefined()
  await ui.unmount()
  // 95% with three days left runs out first.
  await $.session.measure({ context: { tokens: 30_000, window: 1_000_000 }, rateLimits: week(95, 3), changed: [] } as never)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^runs out / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
  await ui.unmount()
})

test('a narrow band, as in a split view, keeps one line and adds a red line only while the week runs out', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/sessions/s2.json`]: report('s2', { workstream: 'reports', state: 'waiting' }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  const week = (percentUsed: number) => [{ kind: 'seven_day', percentUsed, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }]
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await start($)
  const mount = (bodyColumns: number) => $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'desktop' })
  await $.session.measure({ context: { tokens: 30_000, window: 1_000_000 }, rateLimits: week(10), changed: [] } as never)
  let ui = await mount(60)
  expect(await ui.find({ type: 'Text', text: /^10%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /% used/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\d+\/\d+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /runs out/i })).toBeUndefined()
  await ui.unmount()
  await $.session.measure({ context: { tokens: 30_000, window: 1_000_000 }, rateLimits: week(95), changed: [] } as never)
  ui = await mount(60)
  expect(await ui.find({ type: 'Text', text: /^Weekly limit runs out .+, before it resets$/ })).toBeDefined()
  await ui.unmount()
  // Narrower still: no bars, "Wk", and the short warning.
  ui = await mount(40)
  expect(await ui.find({ type: 'Text', text: /^Wk$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Runs out / })).toBeDefined()
  for (const s of await ui.findAll({ type: 'Svg' })) expect(String(s.props.alt)).not.toMatch(/limit/)
  await ui.unmount()
})

test('a FileChanged path in another case and with backslashes still refreshes', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  session(on, ROOT, 'o')
  on('classic.FileChanged', () => ({}))
  await start($)
  files[`${ROOT}/.orchestra/sessions/s2.json`] = report('s2', { workstream: 'reports', state: 'waiting' })
  await $.classic.FileChanged({ file_path: '\\HOME\\U\\Repo\\.orchestra\\sessions\\s2.json', event: 'add' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^waiting$/ })).toBeDefined()
  await ui.unmount()
})

test('a maestro session starts the liveview once, detached', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  session(on, ROOT, 'o')
  const runs: string[] = []
  on('process.run', ($, e) => { runs.push(JSON.stringify(e)); return { value: { stdout: '', stderr: '', exitCode: 0 } } as never })
  on('env.get', ($, e) => ({ value: JSON.stringify(e).includes('CLAUDE_PLUGIN_ROOT') ? '/plug/orchestra' : undefined }) as never)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  // The start is not awaited by the hook: wait for it to land.
  for (let i = 0; i < 20 && !runs.some(r => r.includes('server.mjs')); i++) await new Promise(r => setTimeout(r, 10))
  // A late duplicate would land in this wait.
  await new Promise(r => setTimeout(r, 50))
  const starts = runs.filter(r => r.includes('liveview/server.mjs'))
  expect(starts.length).toBe(1)
  expect(starts[0]).toContain('--detach')
  expect(starts[0]).toContain(ROOT)
  // --detach waits up to about 31 s: the default 30 s timeout would kill it first.
  expect(starts[0]).toContain('"timeoutMs":60000')
})

test('a principal session never starts the liveview', async ($, on) => {
  const WT = '/home/u/repo/.worktrees/reports'
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${WT}/.git`]: `gitdir: ${ROOT}/.git/worktrees/reports`,
  }
  disk(on, files)
  session(on, WT, 's2')
  const runs: string[] = []
  on('process.run', ($, e) => { runs.push(JSON.stringify(e)); return { value: { stdout: '', stderr: '', exitCode: 0 } } as never })
  on('env.get', () => ({ value: '/plug/orchestra' }) as never)
  await $.session.start({ cwd: WT, surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))
  expect(runs.filter(r => r.includes('server.mjs')).length).toBe(0)
})

// A start that fails in either call must not stop the session: its report is written and the band draws.
for (const failing of ['process.run', 'env.get'] as const) {
  test(`a liveview start whose ${failing} rejects still starts the session`, async ($, on) => {
    const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
    disk(on, files)
    session(on, ROOT, 'o')
    on('process.run', () => (failing === 'process.run' ? { deny: 'spawn failed' } : { value: { stdout: '', stderr: '', exitCode: 0 } }) as never)
    on('env.get', ($, e) => (failing === 'env.get' && JSON.stringify(e).includes('CLAUDE_PLUGIN_ROOT') ? { deny: 'no env' } : { value: JSON.stringify(e).includes('CLAUDE_PLUGIN_ROOT') ? '/plug/orchestra' : undefined }) as never)
    await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
    // The start is not awaited: let a late rejection surface before the test ends.
    await new Promise(r => setTimeout(r, 50))
    expect(JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).role).toBe('maestro')
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /42% used/ })).toBeDefined()
    await ui.unmount()
  })
}

test('a session outside an orchestra project never starts the liveview', async ($, on) => {
  disk(on, {})
  session(on, '/home/u/other', 'x')
  const runs: string[] = []
  on('process.run', ($, e) => { runs.push(JSON.stringify(e)); return { value: { stdout: '', stderr: '', exitCode: 0 } } as never })
  on('env.get', () => ({ value: '/plug/orchestra' }) as never)
  await $.session.start({ cwd: '/home/u/other', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))
  expect(runs.filter(r => r.includes('server.mjs')).length).toBe(0)
})
