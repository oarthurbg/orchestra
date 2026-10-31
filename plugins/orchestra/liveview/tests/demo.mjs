// Builds a fake orchestra project with made-up data and serves it, for screenshots and manual checks.
//   node plugins/orchestra/liveview/tests/demo.mjs
//   node plugins/orchestra/liveview/tests/demo.mjs --inbox ten    (or none): ten waiting questions, or none
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { TranscriptReader } from '../sources.mjs'
import { startServer } from '../server.mjs'

const MIN = 60_000
const now = Date.now()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-demo-'))
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }
const git = (cwd, args, at) => execFileSync('git', args, {
  cwd, stdio: 'ignore',
  env: { ...process.env, GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString(), GIT_AUTHOR_NAME: 'demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'demo', GIT_COMMITTER_EMAIL: 'demo@example.com' },
})

const plan = (title, tasks, ticked) => `# ${title} Implementation Plan\n\n${tasks.map(([name, agent, risk], i) =>
  `### Task ${i + 1}: ${name}\n\n**Agent:** \`${agent}\`. **Risk:** \`${risk}\`.\n\n- [${i < ticked ? 'x' : ' '}] **Step 1: Do it.**\n- [${i < ticked ? 'x' : ' '}] **Step 2: Commit.**\n`).join('\n')}`

write('CLAUDE.md', '## Project settings\n\n- Integration branch (workstream PRs go here): `develop`\n- Production branch (releases and hotfixes only): `main`\n')
write('docs/HANDOFF.md', '## Next workstreams\n\n1. export: CSV export\n2. sso: Single sign-on\n3. audit-log: Audit log\n')
git(root, ['init', '-q', '-b', 'main'], now)
git(root, ['add', '.'], now)
git(root, ['commit', '-q', '-m', 'Release 1.4'], now - 30 * 60 * MIN)
git(root, ['checkout', '-q', '-b', 'develop'], now)
git(root, ['commit', '-q', '--allow-empty', '-m', 'Merge auth (#11)'], now - 20 * 60 * MIN)

const streams = {
  billing: { tasks: [['Schema and migration', 'implementer', 'sensitive'], ['Billing service', 'implementer', 'normal'], ['Webhooks', 'implementer-advanced', 'sensitive'], ['API routes', 'implementer', 'normal'], ['Invoice page', 'implementer', 'ui'], ['Emails', 'mechanic', 'mechanical'], ['Live check', 'verifier', 'ui']], done: 4 },
  reports: { tasks: [['Queries', 'implementer', 'normal'], ['Charts', 'implementer', 'ui'], ['PDF export', 'implementer-advanced', 'normal'], ['Filters', 'implementer', 'ui'], ['Docs', 'mechanic', 'mechanical']], done: 1 },
  search: { tasks: [['Index', 'implementer-advanced', 'normal'], ['Query parser', 'implementer', 'normal'], ['Results page', 'implementer', 'ui']], done: 2 },
}
let registry = '| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |\n| --- | --- | --- | --- | --- | --- | --- |\n'
for (const [name, s] of Object.entries(streams)) {
  const wt = path.join(root, '.worktrees', name).replace(/\\/g, '/')
  git(root, ['worktree', 'add', '-q', '-b', name, wt, 'develop'], now)
  const rel = `docs/superpowers/plans/2026-10-28-${name}.md`
  fs.mkdirSync(path.join(wt, 'docs/superpowers/plans'), { recursive: true })
  let t = now - (s.done * 70 + 30) * MIN
  for (let k = 0; k <= s.done; k++) {
    fs.writeFileSync(path.join(wt, rel), plan(name, s.tasks, k))
    git(wt, ['add', rel], t)
    git(wt, ['commit', '-q', '-m', k ? `Task ${k}` : 'Plan'], t)
    t += 70 * MIN
  }
  registry += `| ${name} | s-${name} | \`${name}\` at \`${wt}\` | none | none | no | build |\n`
}
write('.orchestra/workstreams.md', registry)
// billing's branch commits what its question points at; the origin remote makes its #14 a link.
const inboxMode = process.argv.includes('--inbox') ? process.argv[process.argv.indexOf('--inbox') + 1] : 'three'
const billing = path.join(root, '.worktrees', 'billing')
const fixtures = new URL('fixtures/', import.meta.url)
const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(billing, rel)), { recursive: true }); fs.writeFileSync(path.join(billing, rel), body) }
for (const f of ['invoice-light.png', 'invoice-dark.png', 'invoice.html']) put(`docs/mockups/${f}`, fs.readFileSync(new URL(f, fixtures)))
put('docs/invoice-sample.pdf', '%PDF-1.4\n% made-up sample\n')
for (const s of ['billing-design', 'billing-emails', 'billing-webhooks']) put(`docs/superpowers/specs/2026-10-28-${s}.md`, `# ${s}\n`)
git(billing, ['add', 'docs/mockups', 'docs/invoice-sample.pdf', 'docs/superpowers/specs'], now - 140 * MIN)
git(billing, ['commit', '-q', '-m', 'Invoice mockups'], now - 140 * MIN)
git(root, ['remote', 'add', 'origin', 'https://github.com/example/shop.git'], now)
const iso = t => new Date(t).toISOString()
const week = { kind: 'seven_day', percentUsed: 96, resetsAt: new Date(now + 2.5 * 24 * 60 * MIN).toISOString() }
const five = { kind: 'five_hour', percentUsed: 78, resetsAt: new Date(now + 2 * 60 * MIN).toISOString() }
const session = (id, over) => write(`.orchestra/sessions/${id}.json`, JSON.stringify({
  v: 1, session: id, role: 'principal', workstream: null, branch: '', title: '', link: '', state: 'running', detail: '', stage: 'build', pr: '',
  context: { tokens: 90_000, window: 1_000_000 }, limits: [five, week], warm: { pings: 0, last: null }, updatedAt: new Date(now).toISOString(), ...over,
}))
session('o', { role: 'maestro', title: 'Maestro', state: 'idle', stage: '', context: { tokens: 64_000, window: 1_000_000 } })
session('s-billing', { workstream: 'billing', link: 'claude://claude.ai/epitaxy/demo-billing', pr: '#14', context: { tokens: 182_000, window: 1_000_000 },
  ...(inboxMode === 'none' ? {} : { state: 'waiting', detail: 'asks: Approve the invoice mockup, or change how the totals sit?', options: ['Approve as it is', 'Move totals above the line items', 'Show tax on its own row'], waitingSince: iso(now - 130 * MIN) }) })
session('s-reports', { workstream: 'reports', context: { tokens: 96_000, window: 1_000_000 } })
session('s-search', { workstream: 'search', link: 'claude://claude.ai/epitaxy/demo-search', stage: 'review', pr: '#12 open', context: { tokens: 254_000, window: 1_000_000 } })
session('u', { role: 'unregistered', branch: 'fix-typo', state: 'idle', stage: '', context: { tokens: 12_000, window: 1_000_000 } })
if (inboxMode !== 'none') {
  // A question with six options whose report is 42 minutes old, and one with no link, no options and nothing on its branch.
  session('x-search', { role: 'unregistered', branch: 'search-filters', state: 'waiting', stage: 'review', link: 'claude://claude.ai/epitaxy/demo-search-filters', detail: 'asks: Which filters stay next to the new search box?', options: ['Category', 'Price', 'Brand', 'Rating', 'Size', 'Colour'], waitingSince: iso(now - 50 * MIN), updatedAt: iso(now - 42 * MIN) })
  session('x-exports', { role: 'unregistered', branch: 'exports', state: 'waiting', stage: 'plan', detail: 'Send a sample export file to test the parser against.', waitingSince: iso(now - 9 * MIN) })
}
if (inboxMode === 'ten') {
  for (let i = 1; i <= 7; i++) session(`x-topic-${i}`, { role: 'unregistered', branch: `topic-${i}`, state: 'waiting', stage: 'spec', link: `claude://claude.ai/epitaxy/demo-topic-${i}`, detail: `asks: Question ${i}: is this wording long enough that the index has to cut it to a single line?`, options: ['Yes', 'No'], waitingSince: iso(now - i * 3 * MIN) })
}

const tx = fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-demo-tx-'))
const lines = []
for (let t = now - 4.5 * 24 * 60 * MIN, i = 0; t <= now; t += 20 * MIN, i++) {
  lines.push(JSON.stringify({ type: 'assistant', timestamp: new Date(t).toISOString(), message: { id: `m${i}`, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 400 + (i % 7) * 60, cache_read_input_tokens: 40_000 } } }))
}
fs.writeFileSync(path.join(tx, 'demo.jsonl'), `${lines.join('\n')}\n`)

const s = await startServer({ root, reader: new TranscriptReader(tx), onIdle: () => {} })
console.log(`${s.url}  (fixture in ${root})`)
