import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { collect, folderName, render } from '../cost.mjs'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-02T12:00:00Z')
const at = daysAgo => new Date(NOW - daysAgo * DAY).toISOString()
const msg = (id, session, branch, usage, extra = {}) => JSON.stringify({
  type: 'assistant', sessionId: session, gitBranch: branch, cwd: 'D:\\Code\\app', timestamp: at(1), isSidechain: false,
  message: { id, model: 'claude-opus-5-5', usage }, ...extra,
})

function projects() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'))
  const put = (f, lines) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), lines.join('\n') + '\n') }
  put('D--Code-app/s1.jsonl', [
    msg('m1', 's1', 'main', { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
    // The same message again, once per content block: counted once.
    msg('m1', 's1', 'main', { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
    JSON.stringify({ type: 'user', sessionId: 's1', message: { content: 'hi' } }),
    'not json',
    // Outside a 7-day window.
    msg('m0', 's1', 'main', { input_tokens: 99_000, output_tokens: 0 }, { timestamp: at(30) }),
  ])
  // A subagent's transcript: it counts toward its parent session.
  put('D--Code-app/s1/subagents/agent-a.jsonl', [msg('m2', 's1', 'main', { input_tokens: 0, cache_read_input_tokens: 10_000, output_tokens: 0 }, { isSidechain: true })])
  // A worktree beside the main checkout.
  put('D--Code-app-reports/s2.jsonl', [msg('m3', 's2', 'reports', { input_tokens: 0, cache_creation_input_tokens: 800, output_tokens: 200 }, { cwd: 'D:\\Code\\app-reports' })])
  // Another project: not counted.
  put('D--Code-other/s3.jsonl', [msg('m4', 's3', 'main', { input_tokens: 5_000_000, output_tokens: 0 })])
  return dir
}

test('folderName follows Claude Code: every character but a letter or digit becomes "-"', () => {
  assert.equal(folderName('D:/Code/app'), 'd--code-app')
  assert.equal(folderName('/home/u/my.app'), '-home-u-my-app')
})

test('sums one project and its worktrees per branch and session, once per message, inside the window', () => {
  const r = collect({ projectsDir: projects(), main: 'D:/Code/app', days: 7, now: NOW })
  assert.equal(r.folders, 2)
  assert.equal(r.messages, 3)
  // main: 1000 input + 10000 cache read x 0.1 = 2000; reports: 800 x 1.25 + 200 x 5 = 2000.
  assert.deepEqual(r.branches.map(b => [b.branch, b.weighted, b.share]), [['main', 2000, 0.5], ['reports', 2000, 0.5]])
  assert.equal(r.total.weighted, 4000)
  const s1 = r.sessions.find(s => s.session === 's1')
  assert.equal(s1.folder, 'app')
  assert.equal(s1.branch, 'main')
  assert.equal(r.sessions.find(s => s.session === 's2').folder, 'app-reports')
  // All time takes the old message in.
  assert.equal(collect({ projectsDir: projects(), main: 'D:/Code/app', now: NOW }).total.weighted, 103_000)
})

test('the CLI prints both tables for the project the git root belongs to', () => {
  const dir = projects()
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-repo-'))
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0)
  // Name a transcript folder after this repo so the CLI finds it.
  fs.cpSync(path.join(dir, 'D--Code-app'), path.join(dir, path.resolve(repo).replace(/[^A-Za-z0-9]/g, '-')), { recursive: true })
  const cli = fileURLToPath(new URL('../cost.mjs', import.meta.url))
  const r = spawnSync(process.execPath, [cli, '--root', repo, '--projects', dir], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /\| Branch \| Share \|/)
  assert.match(r.stdout, /\| `main` \| 100% \|/)
  assert.match(r.stdout, /\| s1 \| app \| `main` \|/)
})

test('render notes when it cuts the tables', () => {
  const r = collect({ projectsDir: projects(), main: 'D:/Code/app', days: 7, now: NOW })
  assert.match(render(r, 1), /Top 1 of 2 branches and 2 sessions\./)
})
