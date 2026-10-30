// Pure functions for the liveview snapshot: parsing, timing, ETA, tokens, projection, rollout. No I/O.

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const GAP_CAP_MIN = 120
export const DEFAULT_TASK_MIN = 45
export const DEFAULT_WORKSTREAM_MIN = 2 * 24 * 60
export const STALE_MS = 30 * MIN
export const BIG_CONTEXT = 250_000

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const ticks = s => [...s.matchAll(/`([^`]+)`/g)].map(m => m[1])

// `.orchestra/workstreams.md` rows: name, session, branch, worktree, stage.
export function parseRegistry(md) {
  const rows = []
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const c = cells(line)
    if (c.length < 7 || c[0] === 'Workstream') continue
    const [branch = '', worktree = ''] = ticks(c[2])
    if (!worktree) continue // separator and header rows have none
    rows.push({ name: c[0], session: c[1], branch, worktree: worktree.replace(/\\/g, '/'), stage: c[6] })
  }
  return rows
}

// The handoff note's "Plan: `docs/superpowers/plans/<plan>.md`, task N" line.
export function planPathFromNote(note) {
  return /^Plan:\s*`([^`]+)`/m.exec(note ?? '')?.[1] ?? null
}

// Plan tasks: `### Task N: title`, the `**Agent:** x. **Risk:** y.` line and the step checkboxes.
export function parsePlan(md) {
  const tasks = []
  let t = null, fenced = false
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    const h = /^###\s+Task\s+(\d+):\s*(.+?)\s*$/.exec(line)
    if (h) {
      t = { n: Number(h[1]), title: h[2], agent: '', risk: '', steps: 0, ticked: 0 }
      tasks.push(t)
      continue
    }
    if (!t) continue
    if (/^##\s/.test(line)) { t = null; continue }
    const agent = /\*\*Agent:\*\*\s*`?([\w-]+)`?/.exec(line)
    if (agent && !t.agent) t.agent = agent[1]
    const risk = /\*\*Risk:\*\*\s*`?([\w-]+)`?/.exec(line)
    if (risk && !t.risk) t.risk = risk[1]
    const box = /^\s*- \[([ xX])\]/.exec(line)
    if (box) { t.steps++; if (box[1] !== ' ') t.ticked++ }
  }
  return tasks.map(({ ticked, ...x }) => ({ ...x, done: x.steps > 0 && ticked === x.steps }))
}

// "Project settings" in CLAUDE.md: the integration and production branch names.
export function parseBranches(claudeMd) {
  // A name starting with '-' would be read by git as an option.
  const pick = re => { const b = re.exec(claudeMd ?? '')?.[1]?.replace(/^<|>$/g, '') ?? null; return b?.startsWith('-') ? null : b }
  return {
    integration: pick(/Integration branch[^`\n]*`([^`]+)`/),
    production: pick(/Production branch[^`\n]*`([^`]+)`/),
  }
}

// "Next workstreams" in docs/HANDOFF.md: "1. <name>: <one line>".
export function parseQueued(handoff) {
  const section = /^## Next workstreams\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(handoff ?? '')?.[1] ?? ''
  return [...section.matchAll(/^\s*\d+\.\s*([^:\n]+?)\s*:/gm)].map(m => m[1]).filter(n => !n.startsWith('<'))
}

export function median(xs) {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Minutes between `from` and `to`, summing the gaps between the commits in between, each capped.
export function cappedMinutes(from, to, commits) {
  const points = [from, ...commits.filter(c => c > from && c < to).sort((a, b) => a - b), to]
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.min((points[i] - points[i - 1]) / MIN, GAP_CAP_MIN)
  return Math.round(total)
}

// Finished tasks of one plan, from its versions in git (oldest first) and the branch's commit times.
// shortcut: wall-clock commit gaps, not real agent time; switch to subagent transcript spans if ETAs drift.
export function timedTasks(plan, versions, commits) {
  if (versions.length === 0) return []
  const finishes = new Map()
  for (const v of versions) {
    for (const t of parsePlan(v.md)) if (t.done && !finishes.has(t.n)) finishes.set(t.n, v.at)
  }
  const latest = new Map(parsePlan(versions.at(-1).md).map(t => [t.n, t]))
  const done = [...finishes].filter(([n]) => latest.get(n)?.done).sort((a, b) => a[1] - b[1])
  let prev = versions[0].at
  return done.map(([n, at]) => {
    const t = latest.get(n)
    const row = { plan, task: n, agent: t.agent, risk: t.risk, startedAt: prev, finishedAt: at, minutes: cappedMinutes(prev, at, commits) }
    prev = at
    return row
  })
}

// Estimate for an open task: median of the closest bucket with at least 3 past tasks.
export function estimate(task, history) {
  const buckets = [
    history.filter(h => h.agent === task.agent && h.risk === task.risk),
    history.filter(h => h.agent === task.agent),
    history,
  ]
  for (const b of buckets) if (b.length >= 3) return { minutes: Math.round(median(b.map(h => h.minutes))), calibrated: true }
  return { minutes: DEFAULT_TASK_MIN, calibrated: false }
}

// Typical workstream length: median of the per-plan totals in the history.
export function typicalWorkstream(history) {
  const perPlan = new Map()
  for (const h of history) perPlan.set(h.plan, (perPlan.get(h.plan) ?? 0) + h.minutes)
  const m = median([...perPlan.values()])
  return m === null ? { minutes: DEFAULT_WORKSTREAM_MIN, calibrated: false } : { minutes: Math.round(m), calibrated: true }
}

// shortcut: price ratios as a proxy for how plans count usage; recalibrated on every reading, so only the ratios matter.
export function modelWeight(model) {
  if (/opus/i.test(model ?? '')) return 5
  if (/haiku/i.test(model ?? '')) return 1
  return 3
}

export function weighted(usage, model) {
  const u = usage ?? {}
  const raw = (u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0) + 5 * (u.output_tokens ?? 0)
  return raw * modelWeight(model)
}

// One transcript line to a usage event, or null. Only id, time, model and usage are read.
export function usageEvent(line) {
  let o
  try { o = JSON.parse(line) } catch { return null }
  const m = o?.message
  if (o?.type !== 'assistant' || !m?.usage || !m.id) return null
  const at = Date.parse(o.timestamp)
  return Number.isFinite(at) ? { id: m.id, at, w: weighted(m.usage, m.model) } : null
}

const WINDOWS = { five_hour: 5 * HOUR, seven_day: 7 * DAY }

// Limit projection from usage events and the freshest reading ({ kind, percentUsed, resetsAt, at }).
export function projection(events, reading, kind, now) {
  if (!reading || !reading.resetsAt || Date.parse(reading.resetsAt) <= now) return { kind, percent: null, rate: 0, runOut: null, atReset: null, resetsAt: null, reading: null, series: [] }
  const span = WINDOWS[kind]
  const reset = Date.parse(reading.resetsAt)
  const start = reset - span
  const sum = (a, b) => events.reduce((s, e) => (e.at >= a && e.at <= b ? s + e.w : s), 0)
  const base = sum(start, reading.at)
  const k = base > 0 ? reading.percentUsed / base : null
  const percent = k === null ? reading.percentUsed : Math.round(k * sum(start, now) * 10) / 10
  const rateSpan = Math.min(DAY, span / 5)
  const rate = k === null ? 0 : (k * sum(now - rateSpan, now)) / rateSpan
  let runOut = percent >= 100 ? now : rate > 0 ? Math.round(now + (100 - percent) / rate) : null
  if (runOut !== null && runOut >= reset) runOut = null
  const series = []
  if (k !== null) {
    const step = span / 84
    for (let t = start; t <= Math.min(now, reset); t += step) series.push({ at: t, percent: Math.round(k * sum(start, t) * 10) / 10 })
  }
  const atReset = k === null ? null : Math.round((percent + rate * Math.max(0, reset - now)) * 10) / 10
  return { kind, percent, rate, runOut, atReset, resetsAt: reading.resetsAt, reading: { at: reading.at, percent: reading.percentUsed }, series }
}

// Limit pauses ahead: all work stops while a limit is spent and resumes at its reset. Jobs are { start, end } on the
// unpaused clock; the burn rate (percent per ms, from projection) scales with how many jobs are open at once.
// shortcut: today's pace held constant; a pace change shows up at the next 5-second rebuild.
export function limitPauses(jobs, limits, now) {
  const spans = jobs.map(j => ({ from: Math.max(0, j.start - now), to: Math.max(0, j.end - now) })).filter(j => j.to > j.from)
  const goal = Math.max(0, ...spans.map(j => j.to))
  const open = w => spans.filter(j => j.from <= w && w < j.to).length
  const base = open(0) || 1
  const meters = limits.filter(l => l.percent != null && (l.rate > 0 || l.percent >= 100))
    .map(l => ({ kind: l.kind, used: l.percent, reset: Date.parse(l.resetsAt), span: WINDOWS[l.kind], rate: l.rate }))
  const edges = [...new Set(spans.flatMap(j => [j.from, j.to]))].sort((a, b) => a - b)
  const pauses = []
  let t = now, w = 0
  for (let guard = 0; w < goal && guard < 10_000; guard++) {
    for (const m of meters) if (t >= m.reset) {
      m.used = 0
      // The weekly window resets on a fixed schedule; a new 5-hour window opens with the first message after a reset.
      m.reset = m.kind === 'five_hour' ? t + m.span : m.reset + Math.ceil((t - m.reset + 1) / m.span) * m.span
    }
    const spent = meters.filter(m => m.used >= 99.999)
    if (spent.length) {
      const last = spent.reduce((a, b) => (b.reset > a.reset ? b : a))
      pauses.push({ kind: last.kind, from: t, to: last.reset })
      t = last.reset
      continue
    }
    const share = open(w) / base
    let dt = edges.find(e => e > w) - w
    for (const m of meters) {
      if (share > 0) dt = Math.min(dt, (100 - m.used) / (m.rate * share))
      dt = Math.min(dt, m.reset - t)
    }
    for (const m of meters) m.used += m.rate * share * dt
    t += dt
    w += dt
  }
  return pauses
}

// A time on the unpaused clock, pushed back by every pause that starts before it.
export const afterPauses = (t, pauses) => pauses.reduce((out, p) => (p.from < out ? out + (p.to - p.from) : out), t)

// The freshest reading of one kind across session files.
export function freshestReading(sessions, kind) {
  let best = null
  for (const s of sessions) {
    const l = (s.limits ?? []).find(x => x.kind === kind)
    const at = Date.parse(s.updatedAt)
    if (l && Number.isFinite(at) && (!best || at > best.at)) best = { ...l, at }
  }
  return best
}

// Shape and reason, with the band's rules. An outlined half circle marks what is idle by accident: stale, unregistered, no session.
export function attention(session, now) {
  if (!session) return { shape: 'half-open', reason: 'no session' }
  if (session.state === 'waiting') return { shape: 'triangle', reason: 'waiting' }
  if ((session.context?.tokens ?? 0) >= BIG_CONTEXT) return { shape: 'square', reason: 'over 250k' }
  if (now - Date.parse(session.updatedAt) > STALE_MS) return { shape: 'half-open', reason: 'stale' }
  if (session.role === 'unregistered') return { shape: 'half-open', reason: 'unregistered' }
  if (session.state === 'running') return { shape: 'circle', reason: 'running' }
  return { shape: 'half', reason: 'idle' }
}

// Calendar: from the oldest open start (at most 3 days back) to the latest end, at least one day wide.
export function calendarWindow(starts, ends, now) {
  const from = Math.max(Math.min(now, ...starts), now - 3 * DAY)
  const to = Math.max(from + DAY, now + HOUR, ...ends)
  return { from, to }
}

// The n-th queued workstream starts at the n-th earliest projected end.
export function placeQueued(names, openEnds, typical, now) {
  const ends = [...openEnds].sort((a, b) => a - b)
  return names.map((name, i) => {
    const start = ends[i] ?? ends.at(-1) ?? now
    return { name, start, end: start + typical.minutes * MIN, calibrated: typical.calibrated }
  })
}

const sessionRow = (s, now) => ({
  key: s.session, name: s.title || s.workstream || s.branch || s.session, link: /^claude:\/\/[A-Za-z0-9._\/-]+$/.test(s.link ?? '') ? s.link : '',
  role: s.role, state: s.state, detail: s.detail ?? '', context: s.context?.tokens ?? null, stage: s.stage ?? '', pr: s.pr ?? '',
  ...attention(s, now), plan: null, tasks: [], done: 0, total: 0, eta: null, etaCalibrated: true, start: null, end: null,
})

// Everything the page draws, from what sources.mjs gathered.
export function buildSnapshot(input) {
  const { now, project, sessions, registry, workstreams, history, events, merges, releases, queued } = input
  const rows = []
  const listed = new Set()
  for (const s of sessions.filter(s => s.role === 'maestro')) { rows.push(sessionRow(s, now)); listed.add(s.session) }
  for (const r of registry) {
    const s = sessions.filter(x => x.workstream === r.name).reduce((a, b) => (!a || Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a), null)
    if (s) listed.add(s.session)
    const row = s ? { ...sessionRow(s, now), name: s.title || r.name } : { ...sessionRow({ session: r.name, workstream: r.name, role: 'principal', state: 'idle', updatedAt: new Date(now).toISOString() }, now), ...attention(null, now) }
    row.key = `ws:${r.name}`
    row.workstream = r.name
    if (!row.stage) row.stage = r.stage
    const w = workstreams[r.name] ?? {}
    if (w.worktreeMissing) row.detail = 'worktree missing'
    if (w.planMd) {
      row.plan = w.planPath
      const timed = new Map(timedTasks(w.planPath, w.versions ?? [], w.commits ?? []).map(t => [t.task, t]))
      let cursor = now
      let first = true
      row.tasks = parsePlan(w.planMd).map(t => {
        const real = timed.get(t.n)
        if (t.done) return { n: t.n, title: t.title, agent: t.agent, risk: t.risk, done: true, current: false, minutes: real?.minutes ?? null, estimated: false, calibrated: true, start: real?.startedAt ?? null, end: real?.finishedAt ?? null }
        const e = estimate(t, history)
        const out = { n: t.n, title: t.title, agent: t.agent, risk: t.risk, done: false, current: first, minutes: e.minutes, estimated: true, calibrated: e.calibrated, start: cursor, end: cursor + e.minutes * MIN }
        first = false
        cursor = out.end
        return out
      })
      row.done = row.tasks.filter(t => t.done).length
      row.total = row.tasks.length
      const open = row.tasks.filter(t => !t.done)
      row.eta = open.reduce((s, t) => s + t.minutes, 0)
      row.etaCalibrated = open.every(t => t.calibrated)
      row.start = w.versions?.[0]?.at ?? row.tasks.find(t => t.start)?.start ?? now
      row.end = cursor
    } else if (!w.worktreeMissing) row.detail = row.detail || 'no plan'
    rows.push(row)
  }
  for (const s of sessions.filter(s => !listed.has(s.session) && s.role === 'unregistered')) rows.push(sessionRow(s, now))

  const planned = rows.filter(r => r.end !== null)
  const typical = typicalWorkstream(history)
  const queue = placeQueued(queued, planned.map(r => r.end), typical, now)
  const limits = {
    fiveHour: projection(events, freshestReading(sessions, 'five_hour'), 'five_hour', now),
    week: projection(events, freshestReading(sessions, 'seven_day'), 'seven_day', now),
  }
  // Every estimate moves past the limit pauses, so the track, the calendar and the strip agree.
  const pauses = limitPauses([...planned.map(r => ({ start: now, end: r.end })), ...queue], [limits.fiveHour, limits.week], now)
  const shift = t => (t === null || t <= now ? t : afterPauses(t, pauses))
  for (const r of planned) {
    r.end = shift(r.end)
    for (const t of r.tasks) if (t.estimated) { t.start = shift(t.start); t.end = shift(t.end) }
  }
  for (const q of queue) { q.start = shift(q.start); q.end = shift(q.end) }
  const window = calendarWindow(planned.map(r => r.start), [...planned.map(r => r.end), ...queue.map(q => q.end)], now)
  const inWindow = xs => xs.filter(x => x.at >= window.from && x.at <= window.to)
  return {
    v: 1, project, builtAt: now, staleSince: null,
    limits, pauses,
    window, rows, queued: queue,
    rollout: { merges: inWindow(merges), releases: inWindow(releases), projected: planned.map(r => ({ name: r.name, at: r.end })) },
    etaBasis: history.length,
  }
}
