import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { TranscriptReader, appendHistory, branchFiles, findPlan, firstParent, gather, planVersions, readHistory, readSessions, readWorkstream, seedHistory } from '../sources.mjs'
import { timedTasks } from '../snapshot.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-'))
const line = (id, at, input) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, model: 'claude-haiku-5-5', usage: { input_tokens: input } } })

test('TranscriptReader reads appended lines, re-reads a shrunk file, skips bad lines and dedupes by id', () => {
  const dir = tmp()
  const sub = path.join(dir, 'proj', 'session', 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  const now = Date.now()
  const main = path.join(dir, 'proj', 'a.jsonl')
  fs.writeFileSync(main, `${line('m1', now, 1)}\n${line('m1', now, 1)}\nnot json\n`)
  fs.writeFileSync(path.join(sub, 'b.jsonl'), `${line('m2', now, 2)}\n`)
  const r = new TranscriptReader(dir)
  assert.deepEqual(r.scan(now).map(e => e.id).sort(), ['m1', 'm2'])
  // A half-written line waits for its end.
  fs.appendFileSync(main, line('m3', now, 3).slice(0, 20))
  assert.equal(r.scan(now).length, 2)
  fs.appendFileSync(main, `${line('m3', now, 3).slice(20)}\n`)
  assert.equal(r.scan(now).length, 3)
  // Rewritten shorter: read again from the start.
  fs.writeFileSync(main, `${line('m4', now, 4)}\n`)
  assert.ok(r.scan(now).some(e => e.id === 'm4'))
})

test('readSessions keeps the last good reading of a file that fails to parse, and skips other versions', () => {
  const main = tmp()
  const dir = path.join(main, '.orchestra', 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ v: 1, session: 'a' }))
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ v: 2, session: 'b' }))
  assert.deepEqual(readSessions(main).map(s => s.session), ['a'])
  fs.writeFileSync(path.join(dir, 'a.json'), '{"v":1,"sess')
  assert.deepEqual(readSessions(main).map(s => s.session), ['a'])
  assert.deepEqual(readSessions(path.join(main, 'nowhere')), [])
})

test('the history file appends only new plan and task keys', () => {
  const main = tmp()
  fs.mkdirSync(path.join(main, '.orchestra'))
  const e = (task, minutes) => ({ plan: 'p.md', task, agent: 'implementer', risk: 'normal', minutes, finishedAt: 1, startedAt: 0 })
  let h = appendHistory(main, readHistory(main), [e(1, 10), e(2, 20)])
  h = appendHistory(main, h, [e(2, 99), e(3, 30)])
  assert.deepEqual(readHistory(main).map(x => [x.task, x.minutes]), [[1, 10], [2, 20], [3, 30]])
  assert.equal(h.length, 3)
})

test('planVersions and findPlan read a real git repository', () => {
  const repo = tmp()
  const g = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  g('init', '-q', '-b', 'develop')
  g('config', 'user.email', 'test@example.com')
  g('config', 'user.name', 'test')
  fs.writeFileSync(path.join(repo, 'README.md'), 'x')
  g('add', 'README.md')
  g('commit', '-q', '-m', 'base')
  g('checkout', '-q', '-b', 'billing')
  const plans = path.join(repo, 'docs', 'superpowers', 'plans')
  fs.mkdirSync(plans, { recursive: true })
  const p = 'docs/superpowers/plans/billing.md'
  fs.writeFileSync(path.join(repo, p), '### Task 1: A\n\n- [ ] step\n')
  g('add', p)
  g('commit', '-q', '-m', 'plan')
  fs.writeFileSync(path.join(repo, p), '### Task 1: A\n\n- [x] step\n')
  g('add', p)
  g('commit', '-q', '-m', 'task 1')
  const v = planVersions(repo, 'HEAD', p)
  assert.equal(v.length, 2)
  assert.match(v[1].md, /\[x\]/)
  assert.equal(findPlan(repo, 'billing', 'develop'), p)
  fs.mkdirSync(path.join(repo, 'docs', 'workstreams'))
  fs.writeFileSync(path.join(repo, 'docs', 'workstreams', 'billing.md'), 'Plan: `docs/superpowers/plans/other.md`, task 1')
  assert.equal(findPlan(repo, 'billing', 'develop'), 'docs/superpowers/plans/other.md')
})

test('a note plan path outside the worktree is not read', () => {
  const base = tmp()
  const repo = path.join(base, 'repo')
  fs.mkdirSync(path.join(repo, 'docs', 'workstreams'), { recursive: true })
  fs.writeFileSync(path.join(base, 'outside.md'), '### Task 1: A\n\n- [ ] step\n')
  for (const p of ['../outside.md', path.join(base, 'outside.md')]) {
    fs.writeFileSync(path.join(repo, 'docs', 'workstreams', 'billing.md'), `Plan: \`${p}\``)
    assert.equal(findPlan(repo, 'billing', null), null)
    assert.deepEqual(readWorkstream({ name: 'billing', worktree: repo }, null), {})
  }
})

const repoAt = (dir, env = {}) => (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: { ...process.env, ...env } })
const initRepo = (branch = 'develop') => {
  const repo = tmp()
  const g = repoAt(repo)
  g('init', '-q', '-b', branch)
  g('config', 'user.email', 'test@example.com')
  g('config', 'user.name', 'test')
  return { repo, g }
}
const emptyReader = () => new TranscriptReader(tmp())

test('planVersions skips the commit that deleted the plan and keeps every other version whole', () => {
  const { repo, g } = initRepo()
  const p = 'docs/superpowers/plans/x y.md'
  const write = text => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text) }
  write('### Task 1: é\n\n- [ ] step')
  g('add', p)
  g('commit', '-q', '-m', 'plan')
  g('rm', '-q', p)
  g('commit', '-q', '-m', 'gone')
  write('')
  g('add', p)
  g('commit', '-q', '-m', 'empty')
  assert.deepEqual(planVersions(repo, 'HEAD', p).map(v => v.md), ['### Task 1: é\n\n- [ ] step', ''])
})

test('a branch name that starts with a dash is treated as absent, so git never reads it as an option', () => {
  const { repo, g } = initRepo()
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'Integration branch: `--output=x.txt`\nProduction branch: `-x`\n')
  g('add', 'CLAUDE.md')
  g('commit', '-q', '-m', 'base')
  const s = gather(repo, Date.now(), emptyReader(), [])
  assert.deepEqual([s.merges, s.releases], [[], []])
  assert.equal(fs.existsSync(path.join(repo, 'x.txt')), false)
})

test('TranscriptReader reads a big append in chunks and keeps a multibyte character split across chunks and ticks', () => {
  const dir = tmp()
  const file = path.join(dir, 'a.jsonl')
  const now = Date.now()
  const rows = ['m1', 'm2', 'm3'].map((id, i) => line(id, now, i + 1).replace('"usage"', '"note":"ééé€€€","usage"'))
  const text = `${rows.join('\n')}\n`
  const bytes = Buffer.from(text)
  const cut = bytes.indexOf(Buffer.from('€')) + 1 // inside the first euro sign
  fs.writeFileSync(file, bytes.subarray(0, cut))
  const r = new TranscriptReader(dir, 7)
  assert.equal(r.scan(now).length, 0)
  assert.equal(r.files.get(file).rest.includes('�'), false)
  fs.appendFileSync(file, bytes.subarray(cut))
  assert.deepEqual(r.scan(now).map(e => e.id).sort(), ['m1', 'm2', 'm3'])
  assert.equal(r.files.get(file).offset, bytes.length)
})

test('appendHistory skips tasks timed at 0 minutes, such as tasks ticked in the same commit', () => {
  const main = tmp()
  const e = (task, minutes) => ({ plan: 'p.md', task, agent: 'implementer', risk: 'normal', minutes, finishedAt: 1 })
  const h = appendHistory(main, [], [e(1, 0), e(2, 7)])
  assert.deepEqual(h.map(x => x.task), [2])
  assert.deepEqual(readHistory(main).map(x => x.task), [2])
})

test('appendHistory creates .orchestra when it is missing', () => {
  const main = tmp()
  appendHistory(main, [], [{ plan: 'p.md', task: 1, agent: 'implementer', risk: 'normal', minutes: 5, finishedAt: 1 }])
  assert.equal(readHistory(main).length, 1)
})

test('gather resolves a relative registry worktree against the main checkout', () => {
  const { repo: main, g } = initRepo()
  fs.writeFileSync(path.join(main, 'README.md'), 'x')
  g('add', 'README.md')
  g('commit', '-q', '-m', 'base')
  g('worktree', 'add', '-q', '-b', 'billing', '.worktrees/billing')
  fs.mkdirSync(path.join(main, '.orchestra'))
  fs.writeFileSync(path.join(main, '.orchestra', 'workstreams.md'), '| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |\n| --- | --- | --- | --- | --- | --- | --- |\n| billing | s1 | `billing` at `.worktrees/billing` | none | none | no | build |\n')
  const s = gather(main, Date.now(), emptyReader(), [])
  assert.equal(s.workstreams.billing.worktreeMissing, undefined)
})

test('firstParent prefers origin/<branch>, which gh pr merge updates, over the local branch', () => {
  const { repo, g } = initRepo()
  fs.writeFileSync(path.join(repo, 'a'), '1')
  g('add', 'a')
  g('commit', '-q', '-m', 'local only')
  fs.writeFileSync(path.join(repo, 'a'), '2')
  g('commit', '-q', '-am', 'merged on origin')
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  g('reset', '-q', '--hard', 'HEAD~1')
  g('update-ref', 'refs/remotes/origin/develop', sha)
  assert.deepEqual(firstParent(repo, 'develop', Date.now() - 3600_000).map(c => c.subject), ['merged on origin', 'local only'])
})

test('seedHistory times a task against its own branch, not the commits of other branches', () => {
  const { repo } = initRepo('main')
  // Committer dates as a rebase leaves them, all the same: timing must read the author dates.
  const at = h => ({ GIT_AUTHOR_DATE: `2026-01-01T${String(h).padStart(2, '0')}:00:00Z`, GIT_COMMITTER_DATE: '2026-02-01T00:00:00Z' })
  const commit = (file, content, hour, msg) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), content)
    const g = repoAt(repo, at(hour))
    g('add', file)
    g('commit', '-q', '-m', msg)
  }
  const p = 'docs/superpowers/plans/x.md'
  commit(p, '### Task 1: A\n\n- [ ] step\n', 0, 'plan')
  repoAt(repo)('checkout', '-q', '-b', 'other')
  for (const h of [1, 2, 3, 4]) commit('o.txt', String(h), h, `other ${h}`)
  repoAt(repo)('checkout', '-q', 'main')
  commit(p, '### Task 1: A\n\n- [x] step\n', 5, 'done')
  assert.equal(seedHistory(repo)[0].minutes, 120) // one 5h gap on main, capped; hourly commits elsewhere must not add up to 300
})

test('live timing leaves out integration commits a merge brings in, when the integration branch is known', () => {
  const { repo } = initRepo()
  const at = h => ({ GIT_AUTHOR_DATE: `2026-01-01T0${h}:00:00Z`, GIT_COMMITTER_DATE: `2026-01-01T0${h}:00:00Z` })
  const commit = (file, content, hour, msg) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), content)
    repoAt(repo, at(hour))('add', file)
    repoAt(repo, at(hour))('commit', '-q', '-m', msg)
  }
  commit('README.md', 'x', 0, 'base')
  repoAt(repo)('checkout', '-q', '-b', 'feat')
  const p = 'docs/superpowers/plans/feat.md'
  commit(p, '### Task 1: A\n\n- [ ] step\n', 0, 'plan')
  repoAt(repo)('checkout', '-q', 'develop')
  commit('d.txt', '1', 2, 'integration work')
  repoAt(repo)('checkout', '-q', 'feat')
  repoAt(repo, at(4))('merge', '-q', '--no-edit', 'develop')
  commit(p, '### Task 1: A\n\n- [x] step\n', 4, 'task 1')
  fs.mkdirSync(path.join(repo, 'docs', 'workstreams'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'docs', 'workstreams', 'feat.md'), `Plan: \`${p}\``)
  const minutes = integration => { const w = readWorkstream({ name: 'feat', worktree: repo }, integration); return timedTasks(w.planPath, w.versions, w.commits)[0].minutes }
  assert.equal(minutes(null), 240, 'unknown integration: the develop commit at 02:00 splits the 4 hours')
  assert.equal(minutes('develop'), 120, 'one 4-hour gap, capped')
})

test('a plan that is a symlink leaving the worktree is not followed, from the note or the branch diff', t => {
  const { repo, g } = initRepo()
  const outside = path.join(path.dirname(repo), 'outside-link.md')
  fs.writeFileSync(outside, '### Task 1: A\n\n- [ ] step\n')
  fs.writeFileSync(path.join(repo, 'README.md'), 'x')
  g('add', 'README.md')
  g('commit', '-q', '-m', 'base')
  g('checkout', '-q', '-b', 'feat')
  const p = 'docs/superpowers/plans/x.md'
  fs.mkdirSync(path.join(repo, 'docs', 'superpowers', 'plans'), { recursive: true })
  try { fs.symlinkSync(outside, path.join(repo, p), 'file') } catch (err) {
    if (err.code === 'EPERM') return t.skip('creating a symlink needs privileges on this Windows')
    throw err
  }
  g('add', p)
  g('commit', '-q', '-m', 'plan')
  assert.equal(findPlan(repo, 'feat', 'develop'), null)
  fs.mkdirSync(path.join(repo, 'docs', 'workstreams'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'docs', 'workstreams', 'feat.md'), `Plan: \`${p}\``)
  assert.equal(findPlan(repo, 'feat', 'develop'), null)
  assert.deepEqual(readWorkstream({ name: 'feat', worktree: repo }, 'develop'), {})
})

test('a registry row naming a folder that is not a git worktree of main is reported missing and not read', () => {
  const { repo: main, g } = initRepo()
  fs.writeFileSync(path.join(main, 'README.md'), 'x')
  g('add', 'README.md')
  g('commit', '-q', '-m', 'base')
  const planted = tmp()
  fs.mkdirSync(path.join(planted, 'docs', 'workstreams'), { recursive: true })
  fs.writeFileSync(path.join(planted, 'docs', 'workstreams', 'evil.md'), 'Plan: `plan.md`')
  fs.writeFileSync(path.join(planted, 'plan.md'), '### Task 1: A\n\n- [ ] step\n')
  fs.mkdirSync(path.join(main, '.orchestra'))
  fs.writeFileSync(path.join(main, '.orchestra', 'workstreams.md'), `| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |\n| --- | --- | --- | --- | --- | --- | --- |\n| evil | s1 | \`evil\` at \`${planted}\` | none | none | no | build |\n`)
  assert.deepEqual(gather(main, Date.now(), emptyReader(), []).workstreams.evil, { worktreeMissing: true })
})

test('branchFiles keeps the pictures, pages, PDFs, specs and plans a branch commits, pictures first', () => {
  const { repo, g } = initRepo()
  const put = (file, content = 'x') => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), content) }
  put('docs/old.png')
  put('docs/superpowers/specs/billing-design.md', 'v1')
  g('add', 'docs')
  g('commit', '-q', '-m', 'base')
  g('checkout', '-q', '-b', 'billing')
  put('docs/mockups/invoice.png')
  put('docs/screenshots/search.png')
  put('docs/superpowers/specs/billing-design.md', 'v2')
  put('docs/superpowers/plans/billing.md')
  put('src/app.js')
  put('notes.md')
  g('add', 'docs', 'src', 'notes.md')
  g('rm', '-q', 'docs/old.png')
  g('commit', '-q', '-m', 'work')
  put('docs/mockups/draft.png') // on disk, never committed
  assert.deepEqual(branchFiles(repo, 'develop'), [
    { path: 'docs/mockups/invoice.png', kind: 'Mockup', change: 'added', picture: true },
    { path: 'docs/screenshots/search.png', kind: 'Screenshot', change: 'added', picture: true },
    { path: 'docs/superpowers/specs/billing-design.md', kind: 'Spec', change: 'changed', picture: false },
    { path: 'docs/superpowers/plans/billing.md', kind: 'Plan', change: 'added', picture: false },
  ])
  assert.deepEqual(branchFiles(repo, null), [])
  // A new commit moves HEAD, so the cached list is read again.
  put('docs/invoice.pdf')
  put('docs/mockups/invoice.html')
  g('add', 'docs/invoice.pdf', 'docs/mockups/invoice.html')
  g('commit', '-q', '-m', 'more')
  assert.deepEqual(branchFiles(repo, 'develop').map(f => [f.path, f.kind]), [
    ['docs/mockups/invoice.png', 'Mockup'], ['docs/screenshots/search.png', 'Screenshot'], ['docs/mockups/invoice.html', 'Mockup'],
    ['docs/invoice.pdf', 'PDF'], ['docs/superpowers/specs/billing-design.md', 'Spec'], ['docs/superpowers/plans/billing.md', 'Plan'],
  ])
  g('remote', 'add', 'origin', 'https://github.com/acme/shop.git')
  assert.equal(gather(repo, Date.now(), emptyReader(), []).origin, 'https://github.com/acme/shop.git')
})

test('gather reuses the plan a branch adds until its HEAD or the integration branch moves', () => {
  const { repo: main, g } = initRepo()
  fs.writeFileSync(path.join(main, 'CLAUDE.md'), 'Integration branch: `develop`\n')
  g('add', 'CLAUDE.md')
  g('commit', '-q', '-m', 'base')
  g('worktree', 'add', '-q', '-b', 'billing', '.worktrees/billing')
  const wt = path.join(main, '.worktrees', 'billing')
  const w = repoAt(wt)
  const plan = file => { fs.mkdirSync(path.join(wt, 'docs/superpowers/plans'), { recursive: true }); fs.writeFileSync(path.join(wt, file), '### Task 1: A\n\n- [ ] step\n'); w('add', file); w('commit', '-q', '-m', file) }
  plan('docs/superpowers/plans/billing.md')
  fs.mkdirSync(path.join(main, '.orchestra'))
  fs.writeFileSync(path.join(main, '.orchestra', 'workstreams.md'), '| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |\n| --- | --- | --- | --- | --- | --- | --- |\n| billing | s1 | `billing` at `.worktrees/billing` | none | none | no | build |\n')
  const planPath = () => gather(main, Date.now(), emptyReader(), []).workstreams.billing.planPath
  assert.equal(planPath(), 'docs/superpowers/plans/billing.md')
  assert.equal(planPath(), 'docs/superpowers/plans/billing.md')
  // Merged into develop: HEAD is unchanged, but the branch no longer adds a plan.
  g('merge', '-q', '--no-ff', '--no-edit', 'billing')
  assert.equal(planPath(), undefined)
  g('reset', '-q', '--hard', 'HEAD~1')
  assert.equal(planPath(), 'docs/superpowers/plans/billing.md')
  // A second plan moves HEAD, and two added plans name none.
  plan('docs/superpowers/plans/other.md')
  assert.equal(planPath(), undefined)
})
