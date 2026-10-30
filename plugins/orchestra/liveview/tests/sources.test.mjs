import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { TranscriptReader, appendHistory, findPlan, planVersions, readHistory, readSessions } from '../sources.mjs'

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
