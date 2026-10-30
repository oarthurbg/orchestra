import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { REFRESH_MS, buildView, isSafeTarget, mainCheckout, norm, openerArgv, parseRegistry, parseSessionFile, parseStatus, pingDue, roleOf } from './logic'
import type { BandView, Limit, Role, SessionFile } from './types'

// The desktop app's session server, as Task 1 of the plan found it.
const APP_SESSION_SERVER = 'ccd_session_mgmt'

const EMPTY: BandView = { inProject: false, pings: 0, fiveHour: null, week: null, runOut: null, running: 0, waiting: 0, rows: [], liveview: '' }
const view = atom({ plugin: 'orchestra', key: 'view' } as const, EMPTY)

type Ctx = {
  main: string | null
  root: string
  id: string
  role: Role
  workstream: string | null
  branch: string
  title: string
  link: string
  turn: boolean
  question: string
  context: { tokens: number | null; window: number }
  limits: Limit[]
  lastRequestAt: number
  pings: number
  lastPing: string | null
  misses: number
  // A fork missed the cache: no pings until the next main-thread request.
  missed: boolean
  toasted: boolean
  seen: Map<string, number>
  // Parsed reports by file name, with the mtime they were read at.
  reports: Map<string, { mtimeMs: number; file: SessionFile }>
}

const fresh = (): Ctx => ({
  main: null, root: '', id: '', role: 'maestro', workstream: null, branch: '', title: '', link: '', turn: false, question: '',
  context: { tokens: null, window: 0 }, limits: [], lastRequestAt: 0, pings: 0, lastPing: null, misses: 0, missed: false, toasted: false,
  seen: new Map(), reports: new Map(),
})
const ctx: Ctx = fresh()

const read$ = ($: EngineInterface, path: string) => $.fs.read(path).then(t => (typeof t === 'string' ? t : null)).catch(() => null)

// Finds the main checkout and the session's role; null main means not an orchestra project.
async function locate($: EngineInterface) {
  ctx.root = norm(await $.session.root())
  ctx.id = await $.session.id()
  const gitFile = await read$($, `${ctx.root}/.git`)
  const main = mainCheckout(ctx.root, gitFile)
  const gitdir = gitFile === null ? `${ctx.root}/.git` : norm(/^gitdir:\s*(.+)$/m.exec(gitFile)?.[1] ?? '')
  const head = (await read$($, `${gitdir}/HEAD`)) ?? ''
  ctx.branch = /ref: refs\/heads\/(.+)/.exec(head)?.[1]?.trim() ?? ''
  ctx.main = (await $.fs.exists(`${main}/.orchestra`).catch(() => false)) ? main : null
  if (ctx.main === null) return
  const who = roleOf(ctx.root, ctx.main, parseRegistry((await read$($, `${ctx.main}/.orchestra/workstreams.md`)) ?? ''))
  ctx.role = who.role
  ctx.workstream = who.workstream
  await readTitle($)
}

// The sidebar title and link. The app names a session after its first prompt, so each main-thread turn reads them again.
async function readTitle($: EngineInterface) {
  const r = await $.mcp.call(APP_SESSION_SERVER, 'get_session', { session_id: 'self' }).catch(() => undefined)
  const text = r?.content?.find(c => c.type === 'text')
  // A failed call or a reply without them keeps what was read before (empty outside the desktop app: names stay plain text).
  try {
    const s = JSON.parse((text && 'text' in text ? text.text : undefined) ?? '{}') as { title?: unknown; link?: unknown }
    if (typeof s.title === 'string') ctx.title = s.title
    if (typeof s.link === 'string') ctx.link = s.link
  } catch {
    // An unparseable reply changes nothing.
  }
}

export async function writeReport($: EngineInterface) {
  if (ctx.main === null) return
  try {
    await write($)
  } catch {
    // A failed write must not stop the caller: the band still redraws from the other reports.
  }
}

async function write($: EngineInterface) {
  const status = ctx.workstream ? parseStatus((await read$($, `${ctx.root}/docs/workstreams/${ctx.workstream}.md`)) ?? '') : null
  const state = ctx.question ? 'waiting' : ctx.turn ? 'running' : status?.state === 'waiting' ? 'waiting' : 'idle'
  const file: SessionFile = {
    v: 1, session: ctx.id, role: ctx.role, workstream: ctx.workstream, branch: ctx.branch, title: ctx.title, link: ctx.link,
    state, detail: ctx.question || (state === 'waiting' ? (status?.waitingOn ?? '') : ''), stage: status?.stage ?? '', pr: status?.pr ?? '',
    context: ctx.context, limits: ctx.limits, warm: { pings: ctx.pings, last: ctx.lastPing, misses: ctx.misses },
    updatedAt: new Date(await $.clock.now()).toISOString(),
  }
  await $.fs.write(`${ctx.main}/.orchestra/sessions/${ctx.id}.json`, JSON.stringify(file))
}

// Re-reads the reports that changed, the registry and liveview.json, then stores the view: it depends on the clock too, so it never skips.
async function refresh($: EngineInterface) {
  const dir = `${ctx.main}/.orchestra/sessions`
  // A failed listing keeps every report as it was.
  const entries = ctx.main === null ? [] : await $.fs.list(dir).catch(() => null)
  if (entries !== null) {
    const listed = entries.filter(f => f.name.endsWith('.json'))
    await Promise.all(listed.map(async f => {
      if (ctx.reports.get(f.name)?.mtimeMs === f.mtimeMs) return
      // A failed read or parse (a file read mid-write) keeps the last good reading, and the old mtime so the next tick tries again.
      const file = parseSessionFile((await read$($, `${dir}/${f.name}`)) ?? '')
      if (file) ctx.reports.set(f.name, { mtimeMs: f.mtimeMs, file })
    }))
    for (const name of [...ctx.reports.keys()]) if (!listed.some(f => f.name === name)) ctx.reports.delete(name)
  }
  const files = [...ctx.reports.values()].map(r => r.file)
  const registry = ctx.main === null ? [] : parseRegistry((await read$($, `${ctx.main}/.orchestra/workstreams.md`)) ?? '')
  let liveview = ''
  try {
    liveview = ctx.main === null ? '' : String((JSON.parse((await read$($, `${ctx.main}/.orchestra/liveview.json`)) ?? '{}') as { url?: string }).url ?? '')
  } catch {
    liveview = ''
  }
  const next = buildView({ inProject: ctx.main !== null, role: ctx.role, self: ctx.id, files, registry, now: await $.clock.now(), liveview, ownLimits: ctx.limits, pings: ctx.pings })
  await update($, view, () => next)
}

async function measure($: EngineInterface) {
  const u = await $.session.usage().catch(() => undefined)
  if (u) {
    ctx.context = { tokens: u.context.tokens ?? null, window: u.context.window }
    ctx.limits = u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) }))
  }
}

async function osName($: EngineInterface): Promise<'windows' | 'mac' | 'linux'> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  return (await $.process.run(['uname'])).stdout.trim() === 'Darwin' ? 'mac' : 'linux'
}

// openerArgv throws for a target that is not plain; that must never escape a button press.
const open = async ($: EngineInterface, target: string) => {
  try {
    if (!isSafeTarget(target)) throw new Error('unsafe target')
    if ((await $.process.run(openerArgv(await osName($), target))).exitCode !== 0) throw new Error('opener failed')
  } catch {
    try {
      $.ui.toast('orchestra band: could not open it')
    } catch {
      // Nothing more to do: a button press never rejects.
    }
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(REFRESH_MS, () => void tick($, options).catch(() => {}))
    Object.assign(ctx, fresh())
    ctx.lastRequestAt = await $.clock.now()
    await locate($)
    await measure($)
    await writeReport($)
    await refresh($)
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    ctx.context = { tokens: e.context.tokens ?? null, window: e.context.window }
    ctx.limits = e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) }))
    await writeReport($)
    await refresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The keep-warm schedule counts from the main thread's last model request; a subagent's request has its own cache.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      ctx.lastRequestAt = await $.clock.now()
      ctx.missed = false
    }
    return yield* next(e)
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // Only a main-thread turn is the session's turn (running or idle); a subagent's turn is not.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      ctx.turn = true
      await writeReport($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      ctx.turn = false
      await writeReport($)
      // Not awaited: the turn must not wait on the app's session server.
      if (ctx.main !== null) void readTitle($).then(() => writeReport($)).catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Waiting on the owner, live, for as long as the question is open.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = (e as unknown as { questions?: { question?: string }[] }).questions
    try {
      ctx.question = `asks: ${questions?.[0]?.question ?? 'a question'}`
      await writeReport($)
      return await next(e)
    } finally {
      ctx.question = ''
      await writeReport($)
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || (!v.inProject && v.fiveHour === null && v.week === null && v.pings === 0)) return next(e)
    // Other mods share this slot: draw theirs beneath ours instead of replacing it.
    const below = await next(e).catch(() => undefined)
    const { Box, Text, Button } = $.ui.resolve(e)
    const shape = { circle: ['●', 'suggestion'], triangle: ['▲', 'warning'], square: ['■', 'error'], half: ['◓', 'inactive'] } as const
    const day = v.runOut === null ? '' : new Date(v.runOut).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

    const mine = (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" alignItems="center" gap={2}>
          <Text bold>orchestra</Text>
          {v.fiveHour !== null && <Text>5h {v.fiveHour}%</Text>}
          {v.week !== null && <Text>week {v.week}%{day && <Text dimColor> to {day}</Text>}</Text>}
          {v.inProject && <Text>{v.running} running</Text>}
          {v.inProject && v.waiting > 0 && <Text color="warning">{v.waiting} waiting</Text>}
          {v.pings > 0 && <Text dimColor>warm {v.pings}x</Text>}
          <Box flexGrow={1} />
          {v.liveview !== '' && <Button key="liveview" plain label="Liveview" onPress={() => open($, v.liveview)} />}
        </Box>
        {v.rows.map(r => (
          <Box key={r.key} flexDirection="row" alignItems="center" gap={2}>
            <Text color={shape[r.shape][1]}>{shape[r.shape][0]}</Text>
            {r.link !== '' ? <Button key={`open-${r.key}`} plain label={r.name} onPress={() => open($, r.link)} /> : <Text>{r.name}</Text>}
            <Text color={r.shape === 'square' ? 'error' : undefined}>{r.reason}</Text>
            <Text>{r.context}</Text>
            <Text dimColor>{r.detail}</Text>
          </Box>
        ))}
      </Box>
    )
    return below ? <Box flexDirection="column">{mine}{below}</Box> : mine
  }).catch(($, e, next) => next(e))
}

// A missing, non-numeric, zero or negative setting means its default.
const positive = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback)

const MISS_TOAST = 'orchestra band: keep-warm missed the cache; set cacheMinutes lower (5 for API keys and overage)'

// Every REFRESH_MS: keep the cache warm while one of this session's subagents runs, then redraw.
async function tick($: EngineInterface, options: Readonly<Record<string, unknown>>) {
  try {
    await keepWarm($, options)
  } finally {
    await refresh($).catch(() => {})
  }
}

async function keepWarm($: EngineInterface, options: Readonly<Record<string, unknown>>) {
  const now = await $.clock.now()
  const running = (await $.agent.list().catch(() => [])).filter(a => a.status === 'running' || a.status === 'pending')
  for (const a of running) if (!ctx.seen.has(a.id)) ctx.seen.set(a.id, now)
  for (const id of [...ctx.seen.keys()]) if (!running.some(a => a.id === id)) ctx.seen.delete(id)
  const due = pingDue({
    now,
    lastRequestAt: ctx.lastRequestAt,
    cacheMinutes: positive(options.cacheMinutes, 60),
    warmMaxHours: positive(options.warmMaxHours, 2),
    youngestRunningSince: ctx.seen.size === 0 ? null : Math.max(...ctx.seen.values()),
  })
  if (!due || ctx.missed) return
  // Set before the call: a slow fork must not let the next tick ping again; the ping is a request for the next schedule.
  ctx.lastRequestAt = now
  const r = await $.model.fork({ prompt: 'Reply with: ok' }).catch(() => undefined)
  if (!r?.isAnswered) return
  const tokens = ctx.context.tokens
  if (tokens !== null && r.usage.cache_read_input_tokens < tokens / 2) {
    // It paid to write the context again: the cache lifetime is shorter than cacheMinutes says.
    ctx.misses += 1
    ctx.missed = true
    if (!ctx.toasted) {
      ctx.toasted = true
      try {
        $.ui.toast(MISS_TOAST)
      } catch {
        // A toast that fails changes nothing else.
      }
    }
  } else {
    ctx.pings += 1
    ctx.lastPing = new Date(now).toISOString()
  }
  await writeReport($)
}
