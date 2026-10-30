import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DAY, HOUR, MIN, afterPauses, attention, buildSnapshot, calendarWindow, cappedMinutes, estimate, freshestReading, limitPauses, median, modelWeight,
  parseBranches, parsePlan, parseQueued, parseRegistry, placeQueued, planPathFromNote, projection, timedTasks,
  typicalWorkstream, usageEvent, weighted,
} from '../snapshot.mjs'

const NOW = Date.parse('2026-10-30T12:00:00Z')

const REGISTRY = `| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |
| --- | --- | --- | --- | --- | --- | --- |
| billing | s1 | \`billing\` at \`D:\\work\\.worktrees\\billing\` | none | none | no | build |
| reports | s2 | \`reports\` at \`/home/u/repo/.worktrees/reports\` | none | 3001 | no | plan |
`

const plan = (ticks) => `# Billing Implementation Plan

### Task 1: Schema

**Agent:** \`implementer\`. **Risk:** \`sensitive\`.

- [${ticks[0]}] **Step 1: Write the test.**
- [${ticks[1]}] **Step 2: Commit.**

### Task 2: Invoice page

**Agent:** \`implementer\`, with 👤 steps. **Risk:** \`ui\`.

- [${ticks[2]}] **Step 1: Build it.**

## Notes

- [ ] not a task step
`

test('parseRegistry reads name, branch, worktree and stage, with forward slashes', () => {
  assert.deepEqual(parseRegistry(REGISTRY), [
    { name: 'billing', session: 's1', branch: 'billing', worktree: 'D:/work/.worktrees/billing', stage: 'build' },
    { name: 'reports', session: 's2', branch: 'reports', worktree: '/home/u/repo/.worktrees/reports', stage: 'plan' },
  ])
})

test('planPathFromNote reads the Plan line', () => {
  assert.equal(planPathFromNote('# Handoff\n\nPlan: `docs/superpowers/plans/2026-10-01-billing.md`, task 2: x. State: in progress.'), 'docs/superpowers/plans/2026-10-01-billing.md')
  assert.equal(planPathFromNote('no plan here'), null)
  assert.equal(planPathFromNote(null), null)
})

test('parsePlan reads tasks, agent, risk and ticks, and stops at the next ## section', () => {
  assert.deepEqual(parsePlan(plan('xx ')), [
    { n: 1, title: 'Schema', agent: 'implementer', risk: 'sensitive', steps: 2, done: true },
    { n: 2, title: 'Invoice page', agent: 'implementer', risk: 'ui', steps: 1, done: false },
  ])
  assert.equal(parsePlan(plan('x  ')).at(0).done, false)
})

test('parsePlan ignores headings, sections and checkboxes inside fenced code blocks', () => {
  const md = ['### Task 1: Real', '', '- [ ] **Step 1: Do it.**', '', '```md', '### Task 9: Fake', '## Notes', '- [ ] fake step', '```', '', '- [x] **Step 2: Done.**', '', '### Task 2: Next', '', '- [ ] **Step 1: Go.**', ''].join('\n')
  assert.deepEqual(parsePlan(md).map(t => [t.n, t.steps]), [[1, 2], [2, 1]])
})

test('parseRegistry skips an aligned separator row', () => {
  const md = ['| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |', '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |'].join('\n')
  assert.deepEqual(parseRegistry(md), [])
})

test('parseBranches and parseQueued', () => {
  const md = '## Project settings\n\n- Integration branch (workstream PRs go here): `develop`\n- Production branch (releases and hotfixes only): `main`\n'
  assert.deepEqual(parseBranches(md), { integration: 'develop', production: 'main' })
  assert.deepEqual(parseBranches('nothing'), { integration: null, production: null })
  const handoff = '## Next workstreams\n\n1. export: CSV export\n2. search: full text\n\n## Open questions for the owner\n\n1. not: queued\n'
  assert.deepEqual(parseQueued(handoff), ['export', 'search'])
  assert.deepEqual(parseQueued('## Next workstreams\n\n1. <name>: <one line>\n'), [])
})

test('cappedMinutes caps each gap at two hours', () => {
  const t0 = NOW
  assert.equal(cappedMinutes(t0, t0 + 30 * MIN, [t0 + 10 * MIN]), 30)
  // A 10-hour night between two commits counts as 2 hours.
  assert.equal(cappedMinutes(t0, t0 + 11 * HOUR, [t0 + 30 * MIN, t0 + 10.5 * HOUR]), 30 + 120 + 30)
})

test('timedTasks finds each finish from the plan versions and times it from the previous one', () => {
  const versions = [
    { at: NOW, md: plan('   ') },
    { at: NOW + 40 * MIN, md: plan('xx ') },
    { at: NOW + 100 * MIN, md: plan('xxx') },
  ]
  const commits = [NOW + 20 * MIN, NOW + 40 * MIN, NOW + 70 * MIN, NOW + 100 * MIN]
  assert.deepEqual(timedTasks('p.md', versions, commits), [
    { plan: 'p.md', task: 1, agent: 'implementer', risk: 'sensitive', startedAt: NOW, finishedAt: NOW + 40 * MIN, minutes: 40 },
    { plan: 'p.md', task: 2, agent: 'implementer', risk: 'ui', startedAt: NOW + 40 * MIN, finishedAt: NOW + 100 * MIN, minutes: 60 },
  ])
  assert.deepEqual(timedTasks('p.md', [], []), [])
})

test('estimate falls back from agent and risk, to agent, to all, to 45 minutes', () => {
  const h = (agent, risk, minutes) => ({ plan: 'p', task: 1, agent, risk, minutes })
  const history = [h('implementer', 'ui', 30), h('implementer', 'ui', 50), h('implementer', 'ui', 40), h('implementer', 'normal', 100), h('mechanic', 'mechanical', 10)]
  assert.deepEqual(estimate({ agent: 'implementer', risk: 'ui' }, history), { minutes: 40, calibrated: true })
  assert.deepEqual(estimate({ agent: 'implementer', risk: 'normal' }, history), { minutes: 45, calibrated: true })
  assert.deepEqual(estimate({ agent: 'verifier', risk: 'ui' }, history), { minutes: 40, calibrated: true })
  assert.deepEqual(estimate({ agent: 'verifier', risk: 'ui' }, history.slice(0, 2)), { minutes: 45, calibrated: false })
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([]), null)
})

test('typicalWorkstream is the median per-plan total, else 2 days uncalibrated', () => {
  assert.deepEqual(typicalWorkstream([{ plan: 'a', minutes: 100 }, { plan: 'a', minutes: 50 }, { plan: 'b', minutes: 300 }]), { minutes: 225, calibrated: true })
  assert.deepEqual(typicalWorkstream([]), { minutes: 2880, calibrated: false })
})

test('weighted tokens and usage events', () => {
  assert.equal(modelWeight('claude-opus-5-5'), 5)
  assert.equal(modelWeight('claude-haiku-5-5'), 1)
  assert.equal(modelWeight('claude-sonnet-5-5'), 3)
  assert.equal(weighted({ input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 2 }, 'claude-haiku-5-5'), 10 + 125 + 100 + 10)
  const line = JSON.stringify({ type: 'assistant', timestamp: '2026-10-30T11:00:00Z', message: { id: 'msg_1', model: 'claude-haiku-5-5', usage: { input_tokens: 4 }, content: [{ type: 'text', text: 'secret' }] } })
  assert.deepEqual(usageEvent(line), { id: 'msg_1', at: Date.parse('2026-10-30T11:00:00Z'), w: 4 })
  assert.equal(usageEvent('{"type":"user"}'), null)
  assert.equal(usageEvent('not json'), null)
})

test('projection calibrates on the reading and projects the run-out at the last 24 hours rate', () => {
  const resetsAt = new Date(NOW + 2 * DAY).toISOString()
  const start = NOW + 2 * DAY - 7 * DAY
  // 1 unit per hour since the window start.
  const events = []
  for (let t = start; t <= NOW; t += HOUR) events.push({ id: String(t), at: t, w: 1 })
  const reading = { kind: 'seven_day', percentUsed: 50, resetsAt, at: NOW - 24 * HOUR }
  const p = projection(events, reading, 'seven_day', NOW)
  // 96 units at the reading = 50%, so k = 50/97 with both ends counted; 121 units now.
  assert.ok(p.percent > 60 && p.percent < 64)
  assert.equal(p.runOut, null, '24 units a day reach 100% after the reset')
  assert.ok(p.atReset > p.percent && p.atReset < 100)
  const fast = projection([...events, ...Array.from({ length: 24 }, (_, i) => ({ id: `f${i}`, at: NOW - i * HOUR, w: 2 }))], reading, 'seven_day', NOW)
  assert.ok(fast.runOut > NOW && fast.runOut < Date.parse(resetsAt))
  assert.ok(fast.series.length > 0 && fast.series.at(-1).at <= NOW)
  assert.equal(projection(events, null, 'seven_day', NOW).percent, null)
  const past = { kind: 'seven_day', percentUsed: 100, resetsAt: new Date(NOW - HOUR).toISOString(), at: NOW - 2 * HOUR }
  assert.deepEqual(projection(events, past, 'seven_day', NOW), projection(events, null, 'seven_day', NOW), 'a reading past its reset is no reading')
})

test('freshestReading picks the newest session file', () => {
  const s = (at, pct) => ({ updatedAt: new Date(at).toISOString(), limits: [{ kind: 'seven_day', percentUsed: pct, resetsAt: 'x' }] })
  assert.equal(freshestReading([s(NOW - HOUR, 10), s(NOW, 20)], 'seven_day').percentUsed, 20)
  assert.equal(freshestReading([s(NOW, 20)], 'five_hour'), null)
})

test('attention follows the band rules', () => {
  const s = over => ({ role: 'principal', state: 'idle', context: { tokens: 1000 }, updatedAt: new Date(NOW).toISOString(), ...over })
  assert.equal(attention(s({ state: 'waiting', context: { tokens: 300_000 } }), NOW).shape, 'triangle')
  assert.equal(attention(s({ context: { tokens: 250_000 } }), NOW).reason, 'over 250k')
  assert.equal(attention(s({ updatedAt: new Date(NOW - 31 * MIN).toISOString() }), NOW).reason, 'stale')
  assert.deepEqual(attention(s({ role: 'unregistered' }), NOW), { shape: 'half-open', reason: 'unregistered' })
  assert.equal(attention(s({}), NOW).shape, 'half')
  assert.equal(attention(s({ state: 'running' }), NOW).shape, 'circle')
  assert.equal(attention(null, NOW).reason, 'no session')
})

test('calendarWindow and placeQueued', () => {
  assert.deepEqual(calendarWindow([NOW - 5 * DAY], [NOW + DAY], NOW), { from: NOW - 3 * DAY, to: NOW + DAY })
  assert.deepEqual(calendarWindow([NOW - 2 * HOUR], [NOW + HOUR], NOW), { from: NOW - 2 * HOUR, to: NOW + 22 * HOUR })
  assert.deepEqual(calendarWindow([], [NOW + 9 * DAY], NOW), { from: NOW, to: NOW + 9 * DAY })
  const q = placeQueued(['a', 'b', 'c'], [NOW + 2 * HOUR, NOW + HOUR], { minutes: 60, calibrated: true }, NOW)
  assert.deepEqual(q.map(x => x.start), [NOW + HOUR, NOW + 2 * HOUR, NOW + 2 * HOUR])
  assert.equal(placeQueued(['a'], [], { minutes: 60, calibrated: false }, NOW)[0].start, NOW)
})

test('buildSnapshot puts the maestro first, then workstreams with tasks and ETA, then unregistered sessions', () => {
  const iso = NOW => new Date(NOW).toISOString()
  const sessions = [
    { v: 1, session: 'o', role: 'maestro', workstream: null, title: 'Maestro', link: 'claude://claude.ai/epitaxy/o', state: 'idle', context: { tokens: 64_000 }, updatedAt: iso(NOW), limits: [] },
    { v: 1, session: 's1', role: 'principal', workstream: 'billing', title: '', link: 'javascript:alert(1)', state: 'waiting', detail: 'asks: approve mockup', context: { tokens: 182_000 }, stage: 'build', pr: '', updatedAt: iso(NOW), limits: [] },
    { v: 1, session: 'u', role: 'unregistered', workstream: null, branch: 'fix-typo', title: '', link: 'claude://x" onmouseover=alert(1)', state: 'idle', context: { tokens: 12_000 }, updatedAt: iso(NOW), limits: [] },
  ]
  const snap = buildSnapshot({
    now: NOW, project: 'repo', sessions, registry: parseRegistry(REGISTRY),
    workstreams: {
      billing: { planPath: 'p.md', planMd: plan('xx '), versions: [{ at: NOW - 2 * HOUR, md: plan('   ') }, { at: NOW - HOUR, md: plan('xx ') }], commits: [NOW - HOUR] },
      reports: { worktreeMissing: true },
    },
    history: [], events: [], merges: [{ at: NOW - HOUR, subject: 'Merge auth' }, { at: NOW - 9 * DAY, subject: 'old' }], releases: [], queued: ['export'],
  })
  assert.deepEqual(snap.rows.map(r => r.name), ['Maestro', 'billing', 'reports', 'fix-typo'])
  const billing = snap.rows[1]
  assert.equal(billing.shape, 'triangle')
  assert.equal(billing.link, '', 'only claude:// links pass')
  assert.equal(snap.rows[0].link, 'claude://claude.ai/epitaxy/o')
  assert.equal(snap.rows[3].link, '', 'a claude:// string with quotes is dropped')
  assert.equal(billing.done, 1)
  assert.equal(billing.total, 2)
  assert.equal(billing.tasks[0].minutes, 60)
  assert.deepEqual([billing.tasks[1].current, billing.tasks[1].minutes, billing.tasks[1].calibrated], [true, 45, false])
  assert.equal(billing.eta, 45)
  assert.equal(billing.end, NOW + 45 * MIN)
  assert.equal(snap.rows[2].detail, 'worktree missing')
  assert.equal(snap.queued[0].start, NOW + 45 * MIN)
  assert.deepEqual(snap.rollout.merges.map(m => m.subject), ['Merge auth'])
  assert.equal(snap.limits.week.percent, null)
})

test('buildSnapshot reads the newest session file of a workstream', () => {
  const iso = t => new Date(t).toISOString()
  const mk = (session, at, state, tokens) => ({ v: 1, session, role: 'principal', workstream: 'billing', title: '', link: '', state, context: { tokens }, updatedAt: iso(at), limits: [] })
  const snap = buildSnapshot({
    now: NOW, project: 'repo', sessions: [mk('old', NOW - HOUR, 'idle', 260_000), mk('new', NOW, 'running', 70_000)], registry: parseRegistry(REGISTRY).slice(0, 1),
    workstreams: {}, history: [], events: [], merges: [], releases: [], queued: [],
  })
  assert.deepEqual([snap.rows[0].shape, snap.rows[0].context], ['circle', 70_000])
})

test('buildSnapshot shows only the newest maestro file and drops stale unregistered files', () => {
  const iso = t => new Date(t).toISOString()
  const mk = (session, role, at) => ({ v: 1, session, role, workstream: null, title: session, link: '', state: 'waiting', context: { tokens: 1000 }, updatedAt: iso(at), limits: [] })
  const snap = buildSnapshot({
    now: NOW, project: 'repo', registry: [], workstreams: {}, history: [], events: [], merges: [], releases: [], queued: [],
    sessions: [mk('old-maestro', 'maestro', NOW - DAY), mk('maestro', 'maestro', NOW - MIN), mk('old-fix', 'unregistered', NOW - 31 * MIN), mk('fix', 'unregistered', NOW - 30 * MIN)],
  })
  assert.deepEqual(snap.rows.map(r => r.name), ['maestro', 'fix'])
})

test('buildSnapshot moves ends and queued starts past a spent 5-hour limit', () => {
  const iso = t => new Date(t).toISOString()
  const limits = [{ kind: 'five_hour', percentUsed: 100, resetsAt: iso(NOW + 2 * HOUR) }]
  const sessions = [{ v: 1, session: 's1', role: 'principal', workstream: 'billing', title: '', link: '', state: 'running', context: { tokens: 1000 }, updatedAt: iso(NOW), limits }]
  const snap = buildSnapshot({
    now: NOW, project: 'repo', sessions, registry: parseRegistry(REGISTRY).slice(0, 1),
    workstreams: { billing: { planPath: 'p.md', planMd: plan('xx '), versions: [], commits: [] } },
    history: [], events: [{ id: 'a', at: NOW - 2 * HOUR, w: 999 }, { id: 'b', at: NOW - 30 * MIN, w: 1 }], merges: [], releases: [], queued: ['export'],
  })
  assert.deepEqual(snap.pauses, [{ kind: 'five_hour', from: NOW, to: NOW + 2 * HOUR }])
  assert.equal(snap.rows[0].end, NOW + 45 * MIN + 2 * HOUR)
  assert.equal(snap.queued[0].start, NOW + 45 * MIN + 2 * HOUR)
})

test('limitPauses stops work while the 5-hour limit is spent and resumes at its reset', () => {
  const five = { kind: 'five_hour', percent: 50, rate: 25 / HOUR, resetsAt: new Date(NOW + 3 * HOUR).toISOString() }
  const pauses = limitPauses([{ start: NOW, end: NOW + 4 * HOUR }], [five], NOW)
  assert.deepEqual(pauses, [{ kind: 'five_hour', from: NOW + 2 * HOUR, to: NOW + 3 * HOUR }])
  assert.equal(afterPauses(NOW + 4 * HOUR, pauses), NOW + 5 * HOUR)
  assert.equal(afterPauses(NOW + 2 * HOUR, pauses), NOW + 2 * HOUR, 'work that ends as the limit runs out is not delayed')
})

test('limitPauses burns slower as jobs finish, and waits for the weekly reset when it is spent', () => {
  const five = { kind: 'five_hour', percent: 0, rate: 30 / HOUR, resetsAt: new Date(NOW + 10 * HOUR).toISOString() }
  assert.deepEqual(limitPauses([{ start: NOW, end: NOW + HOUR }, { start: NOW, end: NOW + 3 * HOUR }], [five], NOW), [], '30 + 2 x 15 = 60%')
  const week = { kind: 'seven_day', percent: 100, rate: 1 / HOUR, resetsAt: new Date(NOW + HOUR).toISOString() }
  assert.deepEqual(limitPauses([{ start: NOW, end: NOW + HOUR }], [week, { kind: 'five_hour', percent: null, rate: 0 }], NOW), [{ kind: 'seven_day', from: NOW, to: NOW + HOUR }])
})

test('limitPauses waits for the reset of a spent limit even when its recent rate is 0', () => {
  const week = { kind: 'seven_day', percent: 100, rate: 0, resetsAt: new Date(NOW + 2 * HOUR).toISOString() }
  assert.deepEqual(limitPauses([{ start: NOW, end: NOW + 3 * HOUR }], [week], NOW), [{ kind: 'seven_day', from: NOW, to: NOW + 2 * HOUR }])
})

test('buildSnapshot lists the waiting sessions oldest first, with options, files and staleness', () => {
  const iso = t => new Date(t).toISOString()
  const mk = (session, over) => ({ v: 1, session, role: 'principal', workstream: null, branch: '', title: '', link: '', state: 'waiting', detail: '', stage: '', pr: '', context: { tokens: 1000 }, updatedAt: iso(NOW), limits: [], ...over })
  const files = [{ path: 'docs/mockups/a.png', kind: 'Mockup', change: 'added', picture: true }]
  const snap = buildSnapshot({
    now: NOW, project: 'repo', registry: parseRegistry(REGISTRY), origin: 'git@github.com:acme/shop.git',
    workstreams: { billing: { files }, reports: { worktreeMissing: true } },
    history: [], events: [], merges: [], releases: [], queued: [],
    sessions: [
      mk('new', { workstream: 'billing', detail: 'asks: Approve the mockup?', options: ['Yes', 'No'], waitingSince: iso(NOW - 10 * MIN), stage: 'build', pr: '#14', link: 'claude://claude.ai/epitaxy/new' }),
      mk('old', { workstream: 'reports', detail: 'pick the colours', waitingSince: iso(NOW - 2 * HOUR), updatedAt: iso(NOW - 31 * MIN), pr: 'https://example.com/pr/3' }),
      mk('nosince', { role: 'unregistered', branch: 'fix-typo', title: 'billing', detail: 'asks: Merge it?', pr: 'none', link: 'claude://x" onmouseover=alert(1)' }),
      mk('busy', { workstream: 'billing', state: 'running' }),
      mk('gone', { workstream: 'billing', detail: 'asks: Still there?', waitingSince: iso(NOW - 26 * HOUR), updatedAt: iso(NOW - 25 * HOUR) }),
    ],
  })
  assert.deepEqual(snap.inbox.map(q => q.session), ['old', 'new', 'nosince'])
  const [old, neu, stray] = snap.inbox
  assert.deepEqual(neu, {
    session: 'new', workstream: 'billing', stage: 'build', question: 'Approve the mockup?', options: ['Yes', 'No'],
    since: NOW - 10 * MIN, reportedAt: NOW, stale: false, link: 'claude://claude.ai/epitaxy/new',
    files: [{ n: 0, ...files[0] }], pr: { label: '#14', href: 'https://github.com/acme/shop/pull/14' },
  })
  assert.deepEqual([old.question, old.options, old.stale, old.reportedAt, old.files, old.pr], ['pick the colours', [], true, NOW - 31 * MIN, [], { label: 'https://example.com/pr/3', href: 'https://example.com/pr/3' }])
  assert.deepEqual([stray.workstream, stray.since, stray.link, stray.files, stray.pr], ['billing', null, '', [], null], 'an unregistered session gets no files, even under a registered name')
})

test('the inbox links a PR only from an https URL, or #N on a github.com origin', () => {
  const at = new Date(NOW).toISOString()
  const pr = (value, origin) => buildSnapshot({
    now: NOW, project: 'repo', registry: [], workstreams: {}, history: [], events: [], merges: [], releases: [], queued: [], origin,
    sessions: [{ v: 1, session: 'a', role: 'unregistered', workstream: null, branch: 'x', state: 'waiting', detail: '', pr: value, context: { tokens: 1 }, updatedAt: at, limits: [] }],
  }).inbox[0].pr
  assert.deepEqual(pr('#14', 'https://github.com/acme/shop.git'), { label: '#14', href: 'https://github.com/acme/shop/pull/14' })
  assert.deepEqual(pr('#14', 'ssh://git@github.com/acme/shop'), { label: '#14', href: 'https://github.com/acme/shop/pull/14' })
  assert.deepEqual(pr('#14', 'https://notgithub.com/acme/shop.git'), { label: '#14', href: '' })
  assert.deepEqual(pr('#14', ''), { label: '#14', href: '' })
  assert.deepEqual(pr('#14 draft', 'https://github.com/acme/shop.git'), { label: '#14 draft', href: '' })
  assert.deepEqual(pr('javascript:alert(1)', ''), { label: 'javascript:alert(1)', href: '' })
  assert.equal(pr('none', ''), null)
  assert.equal(pr('', ''), null)
})

test('a non-string detail in a waiting session file gives an empty question and does not throw', () => {
  const at = new Date(NOW).toISOString()
  const snap = () => buildSnapshot({
    now: NOW, project: 'repo', registry: [], workstreams: {}, history: [], events: [], merges: [], releases: [], queued: [], origin: '',
    sessions: [{ v: 1, session: 'a', role: 'unregistered', workstream: null, branch: 'x', state: 'waiting', detail: 5, pr: '', context: { tokens: 1 }, updatedAt: at, limits: [] }],
  })
  assert.doesNotThrow(snap)
  assert.equal(snap().inbox[0].question, '')
})
