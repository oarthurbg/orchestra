// SessionStart (compact) hook: after the maestro compacts, list from disk the asks that may still wait on it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DAY, parseRegistry } from '../liveview/snapshot.mjs'

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

export function render({ messages, waiting, notes }) {
  const out = [
    'orchestra: your context was just compacted, and principals may still be waiting on you. Follow "After a compact" in the maestro skill: for each item below, check whether it is already done (PR merged, decision sent); if not, answer it now with SendMessage to that session. Then run /orchestra:status.',
    'What waits, rebuilt from disk:',
  ]
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
  return clip(out.join('\n'), MAX_OUT)
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const same = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))
const read = p => { try { return readFileSync(p, 'utf8') } catch { return null } }

async function main() {
  let input = {}
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch {}
  const cwd = input.cwd || process.cwd()
  let top, main
  try {
    top = git(cwd, ['rev-parse', '--show-toplevel'])
    main = /^worktree (.+)$/m.exec(git(cwd, ['worktree', 'list', '--porcelain']))?.[1]
  } catch { return }
  // Only the maestro, the session in the main checkout of an orchestra project.
  if (!main || !same(top, main) || !existsSync(resolve(main, '.orchestra'))) return
  const now = Date.now()
  const dir = resolve(main, '.orchestra/sessions')
  const sessions = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(read(resolve(dir, f))) } catch { return null } }) : []
  const registry = parseRegistry(read(resolve(main, '.orchestra/workstreams.md')) ?? '')
  const notes = registry.map(r => ({ workstream: r.name, text: read(resolve(main, r.worktree, 'docs/workstreams', `${r.name}.md`)) }))
  const lines = (input.transcript_path && read(input.transcript_path)?.split('\n')) || []
  process.stdout.write(render({ messages: unansweredMessages(lines, now), waiting: waitingSessions(sessions, now), notes: noteWaits(notes) }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
