#!/usr/bin/env node
// Token spend of one project, per branch and per session, from Claude Code's own transcripts. No dependencies.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Relative weight per token, close to API pricing: a cache read costs a tenth of plain input, a cache write 1.25x, output 5x.
export const WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 }

// Claude Code names a project's transcript folder after its path, every character but a letter or digit turned into '-'.
export const folderName = p => p.replace(/[^A-Za-z0-9]/g, '-').toLowerCase()

function jsonlFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...jsonlFiles(p))
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

const zero = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, weighted: 0 })

export function collect({ projectsDir, main, days = 0, now = Date.now() }) {
  const prefix = folderName(main)
  // The main checkout and every worktree under it or beside it (<main>-<name>).
  // shortcut: another repository whose path is this one's plus '-something' is counted too; filter on cwd if that ever matters.
  const folders = fs.readdirSync(projectsDir).filter(n => n.toLowerCase() === prefix || n.toLowerCase().startsWith(`${prefix}-`))
  const since = days > 0 ? now - days * 86_400_000 : 0
  const messages = new Map()
  for (const folder of folders) for (const file of jsonlFiles(path.join(projectsDir, folder))) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"usage"')) continue
      let o
      try { o = JSON.parse(line) } catch { continue }
      const u = o.message?.usage
      if (o.type !== 'assistant' || !u || (since && !(Date.parse(o.timestamp) >= since))) continue
      // A message is written once per content block, each line with the same usage: count it once.
      messages.set(o.message.id ?? `${file}:${o.uuid}`, { o, u })
    }
  }

  const total = zero()
  const branches = new Map()
  const sessions = new Map()
  for (const { o, u } of messages.values()) {
    const t = { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 }
    const w = t.input * WEIGHTS.input + t.cacheWrite * WEIGHTS.cacheWrite + t.cacheRead * WEIGHTS.cacheRead + t.output * WEIGHTS.output
    const branch = o.gitBranch || '(none)'
    if (!branches.has(branch)) branches.set(branch, { branch, ...zero() })
    if (!sessions.has(o.sessionId)) sessions.set(o.sessionId, { session: o.sessionId, folder: '', last: '', byBranch: {}, ...zero() })
    const s = sessions.get(o.sessionId)
    for (const row of [total, branches.get(branch), s]) {
      for (const k of Object.keys(t)) row[k] += t[k]
      row.weighted += w
    }
    s.byBranch[branch] = (s.byBranch[branch] ?? 0) + w
    if (!s.folder && !o.isSidechain && o.cwd) s.folder = path.basename(o.cwd.replace(/\\/g, '/'))
    if ((o.timestamp ?? '') > s.last) s.last = o.timestamp
  }
  const share = r => ({ ...r, share: total.weighted ? r.weighted / total.weighted : 0 })
  const byWeight = (a, b) => b.weighted - a.weighted
  return {
    main, days, folders: folders.length, messages: messages.size, total,
    branches: [...branches.values()].sort(byWeight).map(share),
    sessions: [...sessions.values()].sort(byWeight).map(({ byBranch, ...s }) => share({ ...s, branch: Object.entries(byBranch).sort((a, b) => b[1] - a[1])[0][0] })),
  }
}

const M = n => (n / 1e6).toFixed(1)
const pct = n => `${Math.round(n * 100)}%`

export function render(r, top = 15) {
  const out = [`Token spend for ${r.main}, ${r.days > 0 ? `last ${r.days} days` : 'all time'}: ${r.messages} model requests from ${r.folders} transcript folders.`,
    `Weighted units are relative cost, not dollars: input 1, cache write 1.25, cache read 0.1, output 5 per token. Total ${M(r.total.weighted)}M.`, '',
    '| Branch | Share | Weighted (M) | Output (M) | Cache write (M) | Cache read (M) |', '| --- | --- | --- | --- | --- | --- |',
    ...r.branches.slice(0, top).map(b => `| \`${b.branch}\` | ${pct(b.share)} | ${M(b.weighted)} | ${M(b.output)} | ${M(b.cacheWrite)} | ${M(b.cacheRead)} |`), '',
    '| Session | Folder | Main branch | Share | Weighted (M) | Last active |', '| --- | --- | --- | --- | --- | --- |',
    ...r.sessions.slice(0, top).map(s => `| ${String(s.session).slice(0, 8)} | ${s.folder} | \`${s.branch}\` | ${pct(s.share)} | ${M(s.weighted)} | ${s.last.slice(0, 16).replace('T', ' ')} |`)]
  if (r.branches.length > top || r.sessions.length > top) out.push('', `Top ${top} of ${r.branches.length} branches and ${r.sessions.length} sessions.`)
  return out.join('\n') + '\n'
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  try {
    const root = path.resolve(opt('--root') ?? '.')
    // The main checkout is the first worktree git lists, so a worktree session counts the whole project.
    const main = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).split('\n')[0].replace(/^worktree /, '')
    const projectsDir = opt('--projects') ?? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects')
    process.stdout.write(render(collect({ projectsDir, main, days: Number(opt('--days') ?? 0) }), Number(opt('--top') ?? 15)))
  } catch (e) {
    process.stderr.write(`cost: ${e.message}\n`)
    process.exit(2)
  }
}
