import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { REFRESH_MS, buildView, isSafeTarget, mainCheckout, norm, openerArgv, parseRegistry, parseSessionFile, parseStatus, pingDue, roleOf } from './logic'
import type { BandRow, BandView, Limit, Role, SessionFile, Shape } from './types'

// The desktop app's session server, as Task 1 of the plan found it.
const APP_SESSION_SERVER = 'ccd_session_mgmt'

const EMPTY: BandView = { inProject: false, role: 'maestro', pings: 0, fiveHour: null, week: null, running: 0, waiting: 0, total: 0, rows: [], liveview: '' }
const view = atom({ plugin: 'orchestra', key: 'view' } as const, EMPTY)
const detailed = atom({ plugin: 'orchestra', key: 'detailed' } as const, false)
const ponytail = atom({ plugin: 'orchestra', key: 'ponytail' } as const, { shown: false, level: 'off' })
const LEVELS = ['off', 'lite', 'full', 'ultra']

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
  // Unchanged views keep their value, so a quiet tick redraws nothing.
  await update($, view, prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
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


// Windows sets USERPROFILE, not HOME.
const claudeDir = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')}/.claude`

// ponytail's switch shows here only when ponytail is installed and `/ponytail band` hid its own band, so it is never drawn twice.
// ponytail keeps one level flag for every session (last write wins), so the level is read from it only when this
// session wrote it (its start, its own switch); after that this session follows its own switches (`switched`).
async function readPonytail($: EngineInterface, withLevel = false) {
  const dir = await claudeDir($)
  const installed = /"ponytail@/.test((await read$($, `${dir}/plugins/installed_plugins.json`)) ?? '')
  const hidden = ((await read$($, `${dir}/.ponytail-band`)) ?? '').trim() === 'off'
  // The level ponytail's own hooks write; an absent flag is off.
  const flag = withLevel ? ((await read$($, `${dir}/.ponytail-active`)) ?? '').trim() : ''
  await update($, ponytail, p => {
    const next = { shown: installed && hidden, level: withLevel ? (LEVELS.includes(flag) ? flag : 'off') : p.level }
    return p.shown === next.shown && p.level === next.level ? p : next
  })
}

// The level a ponytail switch asks for: `/ponytail lite`, the skill with `ultra`, "stop ponytail"; null for anything else.
function switched(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/[.!?\s]+$/, '')
  if (t === 'stop ponytail' || t === 'normal mode') return 'off'
  const m = /^\/?(?:ponytail:)?ponytail\s+(off|lite|full|ultra)$/.exec(t)
  return m ? m[1]! : null
}

async function follow($: EngineInterface, level: string | null) {
  if (level !== null) await update($, ponytail, p => (p.level === level ? p : { ...p, level }))
}

// What a file watch covers: the reports, the registry, liveview.json and ponytail's two flags.
async function watchPaths($: EngineInterface) {
  // A config folder that cannot be read costs ponytail's flags, never the project's paths.
  const own = await claudeDir($).then(dir => [`${dir}/.ponytail-active`, `${dir}/.ponytail-band`]).catch(() => [] as string[])
  return ctx.main === null ? own : [`${ctx.main}/.orchestra/sessions`, `${ctx.main}/.orchestra/workstreams.md`, `${ctx.main}/.orchestra/liveview.json`, ...own]
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayTime = (ms: number) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(',', '')

// The brand's shapes (docs/BRAND.md); the outlines keep each one at 3:1 on a dark and a light band.
const SHAPE_SVG: Record<Shape, string> = {
  triangle: '<polygon points="6,1 11.5,11 0.5,11" fill="#FFC21A" stroke="#8A5A00" stroke-width="1" stroke-linejoin="round"/>',
  square: '<rect x="1" y="1" width="10" height="10" fill="#F0442C"/>',
  circle: '<circle cx="6" cy="6" r="4.6" fill="#2450E0" stroke="#B9C8F2" stroke-width="1"/>',
  half: '<path d="M0.5 10 A 5.5 5.5 0 0 1 11.5 10 Z" fill="#B9C8F2"/>',
  hollow: '<path d="M1 10 A 5 5 0 0 1 11 10 Z" fill="none" stroke="#8C8A84" stroke-width="1.3"/>',
}
// The terminal has no Svg: a glyph in a theme colour.
const SHAPE_TEXT: Record<Shape, [string, string]> = { triangle: ['▲', 'warning'], square: ['■', 'error'], circle: ['●', 'suggestion'], half: ['◓', 'inactive'], hollow: ['◠', 'inactive'] }
const svg = (body: string, w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
// assets/brand/mark-dark.svg, scaled by its viewBox.
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="6 6 88 88"><path d="M10 90 A 27 27 0 0 1 64 90 Z" fill="#B9C8F2"/><circle cx="34" cy="34" r="24" fill="#2450E0"/><rect x="62" y="10" width="28" height="42" fill="#F0442C"/><polygon points="66,90 90,90 78,56" fill="#FFC21A"/></svg>'
const bar = (pct: number, alarm: boolean) =>
  svg(`<rect width="44" height="4" rx="2" fill="#8080804D"/><rect width="${Math.max(2, Math.round((44 * Math.min(100, pct)) / 100))}" height="4" rx="2" fill="${alarm ? '#F0442C' : '#A9A49A'}"/>`, 44, 4)
// A hairline as wide as the slot: wider than any band, stretched (not scaled) to the slot's width.
const RULE = '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1" viewBox="0 0 4000 1" preserveAspectRatio="none"><rect width="4000" height="1" fill="#80808059"/></svg>'
const STRIPE = '#80808012'
const HOVER = '#80808033'

export const register: Register = (on, options) => {
  // session.start's locate, which classic.SessionStart waits for so its watch paths know the main checkout.
  let located: Promise<void> = Promise.resolve()
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(REFRESH_MS, () => void tick($, options).catch(() => {}))
    Object.assign(ctx, fresh())
    const stored = await $.store.get('detailed').catch(() => undefined)
    ctx.lastRequestAt = await $.clock.now()
    located = locate($)
    await located
    await measure($)
    await writeReport($)
    await refresh($)
    await update($, detailed, () => stored === true)
    await readPonytail($, true).catch(() => {})
    return result
  }).catch(($, e, next) => next(e))

  // Live updates: the engine watches these paths and fires FileChanged; the REFRESH_MS timer covers what it misses.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await located.catch(() => {})
    if (ctx.root === '') await locate($).catch(() => {})
    const paths = await watchPaths($).catch(() => [] as string[])
    return { ...result, watchPaths: [...(result.watchPaths ?? []), ...paths] }
  }).catch(($, e, next) => next(e))

  on('classic.FileChanged', async ($, e, next) => {
    const result = await next(e)
    const path = norm(e.file_path)
    if (/\/\.ponytail-(active|band)$/.test(path)) await readPonytail($).catch(() => {})
    else if (ctx.main !== null && path.toLowerCase().startsWith(`${ctx.main}/.orchestra/`.toLowerCase())) await refresh($).catch(() => {})
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

  // This session's own ponytail switches: a prompt the person typed, or the skill a principal calls at a stage change.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    await follow($, switched(e.text)).catch(() => {})
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    const { skill, args } = e as unknown as { skill?: string; args?: string }
    if (/^(ponytail:)?ponytail$/.test(skill ?? '')) await follow($, switched(`ponytail ${args ?? ''}`)).catch(() => {})
    return result
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
    const pt = await read($, ponytail)
    if (e.props.hasSurvey || (!v.inProject && v.fiveHour === null && v.week === null && v.pings === 0 && !pt.shown)) return next(e)
    // Other mods share this slot: draw theirs beneath ours instead of replacing it.
    const below = await next(e).catch(() => undefined)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // Svg is in the desktop, editor and mobile tables; the terminal draws glyphs and no bars or rules.
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const desktop = Svg !== undefined
    // The desktop draws nothing for an Svg whose alt is empty, so every drawing says what it is.
    const pic = (source: string, alt: string, w?: number, ht?: number) => (Svg ? <Svg source={source} alt={alt} {...(w ? { width: w } : {})} {...(ht ? { height: ht } : {})} /> : null)
    // Open only while there is more to show: with two rows or fewer there is no arrow to close it.
    const isOpen = (await read($, detailed)) && v.rows.length > 2
    const maestro = v.inProject && v.role === 'maestro'
    const shown = maestro && !isOpen ? v.rows.slice(0, 2) : v.rows
    const hidden = v.rows.slice(shown.length)
    const rule = pic(RULE, 'divider', undefined, 1)

    const toggle = async () => {
      const value = !(await read($, detailed))
      await update($, detailed, () => value)
      await $.store.set('detailed', value).catch(() => {})
    }
    const setLevel = async (level: string) => {
      await update($, ponytail, p => ({ ...p, level }))
      // The same command a person types, so ponytail's own skill stays the only logic.
      await $.command.run({ command: 'ponytail:ponytail', args: level }).catch(() => {})
      // The flag ponytail wrote is the truth: a command that failed puts the switch back.
      await readPonytail($, true).catch(() => {})
    }

    const limit = (label: string, l: { pct: number } | null, tail: string, alarm: boolean) => (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text size="footnote" dimColor>{label}</Text>
        {l === null ? <Text size="footnote" dimColor>-</Text> : pic(bar(l.pct, alarm), `${l.pct}% of the ${label} limit`, 44, 4)}
        {l !== null && <Text size="footnote" color={alarm ? 'error' : undefined}>{l.pct}% used</Text>}
        {l !== null && tail !== '' && <Text size="footnote" color={alarm ? 'error' : undefined} dimColor={!alarm}>{tail}</Text>}
      </Box>
    )
    const runOutAt = v.week?.runOut ?? null
    const weekTail = runOutAt !== null ? `runs out ${dayTime(runOutAt)}` : v.week?.resetsAt ? `resets ${dayTime(v.week.resetsAt)}` : ''
    const fiveTail = v.fiveHour?.resetsAt ? `resets ${time(v.fiveHour.resetsAt)}` : ''

    // Every text cell of a row opens its session: a Button holds only text, so each cell is one, and the row lights as one on hover.
    // The desktop pads a plain Button's text by about a column; headings and unlinked cells take the same inset to line up.
    const inset = desktop ? 1 : 0
    const cell = (r: BandRow, part: string, label: string, style: { bold?: boolean; dimColor?: boolean; underline?: boolean } = {}) =>
      r.link !== ''
        ? <Button key={`${r.key}-${part}`} plain onPress={() => open($, r.link)}><Text {...style}>{label}</Text></Button>
        : <Box paddingX={inset}><Text {...style}>{label}</Text></Box>
    const row = (r: BandRow, n: number) => {
      const waiting = r.shape === 'triangle'
      return (
        <Box key={`row-${r.key}`} flexDirection="row" alignItems="center" paddingX={1} {...(desktop ? { paddingY: 'xs' as const } : {})} {...(n % 2 === 1 ? { backgroundColor: STRIPE } : {})} {...(r.link !== '' ? { hover: { backgroundColor: HOVER } } : {})}>
          <Box width="24%">{cell(r, 'name', r.name, { bold: waiting, underline: r.link !== '' })}</Box>
          <Box width="18%" flexDirection="row" alignItems="center" gap={1}>
            {desktop ? pic(svg(SHAPE_SVG[r.shape], 12, 12), r.status, 12, 12) : <Text color={SHAPE_TEXT[r.shape][1]}>{SHAPE_TEXT[r.shape][0]}</Text>}
            {cell(r, 'status', r.status, { bold: waiting })}
          </Box>
          <Box width="9%" justifyContent="flex-end">{cell(r, 'context', r.context)}</Box>
          <Box flexGrow={1} paddingLeft={3}>{r.detail !== '' ? cell(r, 'detail', r.detail, { dimColor: true }) : null}</Box>
        </Box>
      )
    }
    const heads = (
      <Box flexDirection="row" paddingX={1} {...(desktop ? { paddingY: 'xs' as const } : {})}>
        <Box width="24%" paddingLeft={inset}><Text dimColor>Workstream</Text></Box>
        <Box width="18%" paddingLeft={desktop ? 3 + inset : 2}><Text dimColor>Status</Text></Box>
        <Box width="9%" justifyContent="flex-end" paddingRight={inset}><Text dimColor>Context</Text></Box>
        <Box flexGrow={1} paddingLeft={3 + inset}><Text dimColor>Detail</Text></Box>
      </Box>
    )

    let body = null
    if (maestro && v.total === 0 && v.rows.length === 0) body = <Text dimColor>No workstreams yet. Start one with /orchestra:start-workstream.</Text>
    else if (maestro && v.rows.length === 0) body = <Text dimColor>Nothing needs you.</Text>
    else if (v.rows.length > 0) body = (
      <Box flexDirection="column">
        {maestro && isOpen && heads}
        {shown.map(row)}
        {hidden.length > 0 && <Box paddingX={1}><Text dimColor>+{hidden.length} more: {[...new Set(hidden.map(r => r.status))].join(', ')}</Text></Box>}
      </Box>
    )

    const show5 = v.fiveHour !== null || v.inProject
    const showWeek = v.week !== null || v.inProject
    const counted = maestro && v.total > 0
    const toggleButton = maestro && v.rows.length > 2 && <Button key="orchestra-toggle" label={isOpen ? '▾' : '▴'} onPress={toggle} />
    // Roughly the cells the one-line header takes (a bar is about 6); below that, as in a split view, it goes compact.
    const cells = (label: string, l: { pct: number } | null, tail: string) => label.length + (l === null ? 2 : 8 + `${l.pct}% used`.length + (tail ? tail.length + 1 : 0))
    const wide = 16 + (show5 ? cells('5h', v.fiveHour, fiveTail) : 0) + (showWeek ? 3 + cells('Weekly', v.week, weekTail) : 0)
      + (counted ? `${v.running} of ${v.total} running`.length + 1 : 0) + (toggleButton ? 4 : 0)
    const narrow = e.props.bodyColumns < wide
    // Narrower still, the bars go and "Weekly" shortens.
    const tight = e.props.bodyColumns < 48
    const short = (label: string, l: { pct: number } | null, alarm: boolean) => (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text size="footnote" dimColor>{label}</Text>
        {l === null ? <Text size="footnote" dimColor>-</Text> : !tight && pic(bar(l.pct, alarm), `${l.pct}% of the ${label} limit`, 44, 4)}
        {l !== null && <Text size="footnote" color={alarm ? 'error' : undefined}>{l.pct}%</Text>}
      </Box>
    )

    const header = narrow ? (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={2}>
          {desktop ? pic(MARK, 'orchestra mark', 20, 20) : <Text bold>orchestra</Text>}
          {show5 && short('5h', v.fiveHour, false)}
          {showWeek && short(tight ? 'Wk' : 'Weekly', v.week, runOutAt !== null)}
          <Box width={0} flexGrow={1} />
          {counted && <Text size="footnote" dimColor>{v.running}/{v.total}</Text>}
          {toggleButton}
        </Box>
        {/* The run-out warning keeps its time on a line of its own, only while the week runs out. */}
        {runOutAt !== null && (
          <Box paddingLeft={desktop ? 4 : 0}>
            <Text size="footnote" color="error">{tight ? `Runs out ${dayTime(runOutAt)}` : `Weekly limit runs out ${dayTime(runOutAt)}, before it resets`}</Text>
          </Box>
        )}
      </Box>
    ) : (
      <Box flexDirection="row" alignItems="center">
        {/* The ends keep their text's width and two equal spacers centre the limits between them. */}
        <Box flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
          {pic(MARK, 'orchestra mark', 20, 20)}
          <Text bold>orchestra</Text>
        </Box>
        <Box width={0} flexGrow={1} />
        <Box flexDirection="row" alignItems="center" gap={3} flexShrink={1} flexWrap="wrap" justifyContent="center">
          {show5 && limit('5h', v.fiveHour, fiveTail, false)}
          {showWeek && limit('Weekly', v.week, weekTail, runOutAt !== null)}
        </Box>
        <Box width={0} flexGrow={1} />
        <Box flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
          {counted && <Text size="footnote" dimColor>{v.running} of {v.total} running</Text>}
          {toggleButton}
        </Box>
      </Box>
    )

    const footer = pt.shown || v.pings > 0 || v.liveview !== '' ? (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {pt.shown && <Text dimColor>ponytail</Text>}
        {pt.shown && LEVELS.map(level => (
          <Button key={`orchestra-ponytail-${level}`} label={level} {...(level === pt.level ? { variant: 'secondary' as const } : { plain: true as const })} onPress={() => setLevel(level)} />
        ))}
        <Box flexGrow={1} />
        {v.pings > 0 && <Text dimColor>kept warm {v.pings}x</Text>}
        {v.liveview !== '' && <Button key="liveview" label="Liveview" onPress={() => open($, v.liveview)} />}
      </Box>
    ) : null

    const mine = (
      <Box flexDirection="column" width={e.props.bodyColumns} gap={desktop ? 'xs' : 0}>
        {header}
        {body && rule}
        {body}
        {footer && rule}
        {footer}
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
    // The watch fires at once; this covers a session where it does not.
    await readPonytail($).catch(() => {})
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
