// SessionStart (compact or clear) hook: after the maestro or a principal loses its context, say how to resume and, for the maestro, list from disk the asks that may still wait on it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DAY, parseRegistry } from '../liveview/snapshot.mjs'
import { git, readText } from '../liveview/sources.mjs'

const MAX_ITEMS = 15
const MAX_CHARS = 1200
// Claude Code caps injected context at 10,000 characters and spills the rest to a file.
const MAX_OUT = 9500

const clip = (s, n = MAX_CHARS) => (s.length > n ? `${s.slice(0, n)}…` : s)
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '')
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? ''

// Messages other sessions sent this one (SendMessage) with no SendMessage back to that session since, from the last day.
export function unansweredMessages(lines, now) {
  const open = new Map()
  for (const line of lines) {
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o?.type === 'user') {
      const m = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/.exec(textOf(o.message?.content))
      // Over a pipe, `from` is the pipe and `from-session` the session; otherwise `from` is the session.
      const from = m && (attr(m[1], 'from-session') || attr(m[1], 'from'))
      const at = Date.parse(o.timestamp)
      if (!from || !(now - at <= DAY)) continue
      const text = m[2].trim()
      const list = open.get(from) ?? []
      // A transcript can log the same delivery twice.
      if (!list.some(x => x.at === at && x.text === text)) open.set(from, [...list, { from, name: attr(m[1], 'from-name'), at, text }])
    } else if (o?.type === 'assistant') {
      for (const b of o.message?.content ?? []) {
        if (b?.type !== 'tool_use' || !/send_?message/i.test(b.name ?? '')) continue
        const input = JSON.stringify(b.input ?? {})
        for (const id of open.keys()) if (input.includes(id)) open.delete(id)
      }
    }
  }
  return [...open.values()].flat().sort((a, b) => a.at - b.at)
}

// Band reports in the waiting state, with the inbox's rule: a report a day old leaves the list.
export function waitingSessions(sessions, now) {
  return sessions.filter(s => s?.state === 'waiting' && s.role !== 'maestro' && !(now - Date.parse(s.updatedAt) > DAY))
    .map(s => ({ who: s.workstream || s.title || s.branch || s.session, detail: String(s.detail ?? '').replace(/^asks: /, ''), since: s.waitingSince ?? s.updatedAt }))
}

// Handoff notes whose status line names someone the workstream waits on.
export function noteWaits(notes) {
  return notes.map(({ workstream, text }) => ({ workstream, on: /^Status:.*?·\s*waiting on:\s*([^·\r\n]+)/m.exec(text ?? '')?.[1]?.trim() ?? '' }))
    .filter(n => n.on && n.on !== 'none' && !n.on.startsWith('<'))
}


const noAlarm = (section, skill) => `No alarm recorded in .orchestra/alarms.json: open one, as "${section}" in the ${skill} skill says.`

export function render({ source = 'compact', resume = '', alarm = '', messages, waiting, notes }) {
  const cleared = source === 'clear'
  const out = [cleared
    ? `orchestra: you cleared your context. First: load the orchestra:maestro skill, turn your Remote Control back on (set_remote_control on yourself), then read the resume below. ${alarm ? `Your alarm for the next clear: ${alarm}.` : noAlarm('The alarm', 'maestro')}`
    : 'orchestra: your context was just compacted, and principals may still be waiting on you. Follow "After a compact" in the maestro skill: for each item below, check whether it is already done (PR merged, decision sent); if not, answer it now with SendMessage to that session. Then run /orchestra:status.']
  if (cleared) out.push('Resume (from .orchestra/status.md):', resume || 'No resume block in .orchestra/status.md.')
  else if (resume) out.push('Resume (from .orchestra/status.md):', resume)
  out.push('What waits, rebuilt from disk:')
  if (waiting.length) {
    out.push('', 'Sessions waiting (band reports in .orchestra/sessions):')
    for (const w of waiting.slice(0, MAX_ITEMS)) out.push(`- ${w.who}: ${clip(w.detail, 200) || '(no detail)'} (since ${w.since})`)
  }
  if (notes.length) {
    out.push('', 'Handoff notes whose status line waits on someone:')
    for (const n of notes.slice(0, MAX_ITEMS)) out.push(`- ${n.workstream}: waiting on ${clip(n.on, 200)}`)
  }
  if (messages.length) {
    const shown = messages.slice(-MAX_ITEMS)
    // The messages share what is left, so the newest ones never push the rest out.
    const each = Math.min(MAX_CHARS, Math.floor(4500 / shown.length))
    out.push('', 'Messages from sessions with no SendMessage from you to that session since (last 24 hours, oldest first):')
    for (const m of shown) out.push(`- ${m.name || m.from} (${m.from}), ${new Date(m.at).toISOString()}: ${clip(m.text, each).replace(/\s*\n\s*/g, ' / ')}`)
  }
  if (!messages.length && !waiting.length && !notes.length) out.push('', 'Nothing found: no unanswered messages, waiting sessions or waiting handoff notes.')
  out.push('', 'If no session is working and nothing above needs you, run /orchestra:status now.')
  return clip(out.join('\n'), MAX_OUT)
}

export function renderPrincipal({ source = 'compact', workstream, notePath, status = '', alarm = '', taskLimit = '', paused = false }) {
  return clip([
    `orchestra: you ${source === 'clear' ? 'cleared' : 'compacted'} your context. You are the principal for ${workstream}. First: load the orchestra:principal skill, turn your Remote Control back on (set_remote_control on yourself), then read ${notePath} and follow its clean-session checklist.`,
    status,
    `Task limit: ${taskLimit || 1} at once.`,
    alarm ? `Your alarm for the next clear: ${alarm}.` : noAlarm('Context', 'principal'),
    paused ? 'You are paused: update your status line and wait for the maestro.' : 'Continue from the next unticked task of your plan.',
  ].filter(Boolean).join('\n'), MAX_OUT)
}

const same = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))

// The maestro in the main checkout, a principal in a registered worktree, else nobody.
export function roleOf({ top, main, registry }) {
  if (same(top, main)) return { role: 'maestro' }
  for (const r of registry) {
    const worktree = resolve(main, r.worktree)
    if (same(top, worktree)) return { role: 'principal', workstream: r.name, worktree }
  }
  return null
}

// Optional registry columns, found by header name because the lean and full tables put them in different places.
export function registryExtras(md, name) {
  const rows = md.split(/\r?\n/).filter(l => l.trim().startsWith('|')).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
  const head = rows.find(c => c[0] === 'Workstream') ?? []
  const row = rows.find(c => c[0] === name) ?? []
  const at = h => (head.indexOf(h) < 0 ? '' : row[head.indexOf(h)] ?? '')
  return { taskLimit: at('Task limit'), paused: at('Paused').toLowerCase() === 'yes' }
}

export function resumeBlock(statusMd) {
  const m = /^## Resume[^\S\n]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(statusMd ?? '')
  return m ? m[1].trim().split(/\r?\n/).slice(0, 20).join('\n').trim() : ''
}

export const calledClear = lines => lines.some(line => {
  try { return JSON.parse(line)?.message?.content?.some?.(b => b?.type === 'tool_use' && /clear_session$/.test(b.name ?? '')) } catch { return false }
})

// The transcript the session before this one wrote: the newest from the last day that called clear_session (an alarm's session never does).
export function previousTranscript(dir, current, now) {
  const mtime = f => { try { return statSync(f).mtimeMs } catch { return 0 } }
  return readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => resolve(dir, f))
    .filter(f => !same(f, current) && now - mtime(f) <= DAY)
    .sort((a, b) => mtime(b) - mtime(a))
    .find(f => calledClear(readText(f)?.split('\n') ?? [])) ?? null
}

// Anything but an object (null, a number, bad JSON) counts as empty.
export const readJson = f => { try { const v = JSON.parse(readText(f) ?? ''); return v && typeof v === 'object' ? v : {} } catch { return {} } }

async function main() {
  let input = {}
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch {}
  const source = input.source || 'compact'
  const cwd = input.cwd || process.cwd()
  const top = git(cwd, ['rev-parse', '--show-toplevel'])?.trim()
  const main = top && /^worktree (.+)$/m.exec(git(cwd, ['worktree', 'list', '--porcelain']) ?? '')?.[1]
  if (!main || !existsSync(resolve(main, '.orchestra'))) return
  const registryMd = readText(resolve(main, '.orchestra/workstreams.md')) ?? ''
  const registry = parseRegistry(registryMd)
  const who = roleOf({ top, main, registry })
  if (!who) return
  const alarms = readJson(resolve(main, '.orchestra/alarms.json'))
  if (who.role === 'principal') {
    const notePath = `docs/workstreams/${who.workstream}.md`
    const status = /^Status:.*$/m.exec(readText(resolve(who.worktree, notePath)) ?? '')?.[0] ?? ''
    process.stdout.write(renderPrincipal({ source, workstream: who.workstream, notePath, status, alarm: alarms[who.workstream]?.alarm, ...registryExtras(registryMd, who.workstream) }))
    return
  }
  const now = Date.now()
  const dir = resolve(main, '.orchestra/sessions')
  const sessions = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(readText(resolve(dir, f))) } catch { return null } }) : []
  const notes = registry.map(r => ({ workstream: r.name, text: readText(resolve(main, r.worktree, 'docs/workstreams', `${r.name}.md`)) }))
  const lines = (input.transcript_path && readText(input.transcript_path)?.split('\n')) || []
  // After a clear the asks sit in the transcript of the session that cleared itself.
  const before = source === 'clear' && input.transcript_path && existsSync(dirname(input.transcript_path)) ? previousTranscript(dirname(input.transcript_path), input.transcript_path, now) : null
  const all = before ? [...(readText(before)?.split('\n') ?? []), ...lines] : lines
  process.stdout.write(render({ source, resume: resumeBlock(readText(resolve(main, '.orchestra/status.md'))), alarm: alarms.maestro?.alarm, messages: unansweredMessages(all, now), waiting: waitingSessions(sessions, now), notes: noteWaits(notes) }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
