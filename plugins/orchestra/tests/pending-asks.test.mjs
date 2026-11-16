// Run with: node --test plugins/orchestra/tests/pending-asks.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { noteWaits, previousTranscript, readJson, registryExtras, render, renderPrincipal, resumeBlock, roleOf, unansweredMessages, waitingSessions } from '../hooks/pending-asks.mjs'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const at = h => new Date(NOW - h * 3_600_000).toISOString()
const peer = (h, attrs, body) => JSON.stringify({ type: 'user', timestamp: at(h), message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message ${attrs}>\n${body}\n</cross-session-message>\n\nThis came from another Claude session.` } })
const send = (h, input) => JSON.stringify({ type: 'assistant', timestamp: at(h), message: { content: [{ type: 'tool_use', name: 'SendMessage', input }] } })

test('a message stays open until a SendMessage names its session', () => {
  const lines = [
    peer(3, 'from="uds:pipe" from-session="local_a" from-name="Auth"', 'PR #4 ready to merge'),
    peer(2, 'from="local_b" from-name="Reports"', 'Which chart library?'),
    send(1, { to: 'local_a', message: 'Merged.' }),
    'not json',
  ]
  const open = unansweredMessages(lines, NOW)
  assert.deepEqual(open.map(m => [m.from, m.name, m.text]), [['local_b', 'Reports', 'Which chart library?']])
})

test('a message after the reply reopens the session; old and duplicate messages drop', () => {
  const lines = [
    peer(30, 'from="local_old"', 'from yesterday'),
    peer(3, 'from="local_a"', 'first'),
    send(2, { to: 'local_a', message: 'ok' }),
    peer(1, 'from="local_a"', 'second'),
    peer(1, 'from="local_a"', 'second'),
  ]
  assert.deepEqual(unansweredMessages(lines, NOW).map(m => m.text), ['second'])
})

test('waiting band reports and handoff notes', () => {
  const sessions = [
    { session: 's1', role: 'principal', workstream: 'reports', state: 'waiting', detail: 'asks: pick a chart', updatedAt: at(1), waitingSince: at(2) },
    { session: 's2', role: 'principal', workstream: 'auth', state: 'running', updatedAt: at(1) },
    { session: 's3', role: 'principal', workstream: 'old', state: 'waiting', updatedAt: at(30) },
    { session: 'm', role: 'maestro', state: 'waiting', updatedAt: at(1) },
    null,
  ]
  assert.deepEqual(waitingSessions(sessions, NOW), [{ who: 'reports', detail: 'pick a chart', since: at(2) }])
  const notes = [
    { workstream: 'auth', text: '# Handoff note: auth\n\nStatus: idle · context 120k · build, task 3 of 9 · PR none · waiting on: maestro, schema queue slot · updated 2026-10-30 11:00\n' },
    { workstream: 'reports', text: 'Status: running · context 80k · spec · PR none · waiting on: none · updated 2026-10-30 11:00' },
    { workstream: 'gone', text: null },
  ]
  assert.deepEqual(noteWaits(notes), [{ workstream: 'auth', on: 'maestro, schema queue slot' }])
})

test('render lists every source and stays under the context cap', () => {
  const big = { from: 'local_x', name: 'X', at: NOW, text: 'y'.repeat(5000) }
  const out = render({ messages: Array(40).fill(big), waiting: [{ who: 'reports', detail: 'pick', since: at(1) }], notes: [{ workstream: 'auth', on: 'maestro' }] })
  assert.ok(out.length <= 9501)
  assert.match(out, /After a compact/)
  assert.match(render({ messages: [], waiting: [], notes: [] }), /Nothing found/)
  const small = render({ messages: [], waiting: [{ who: 'reports', detail: 'pick', since: at(1) }], notes: [{ workstream: 'auth', on: 'maestro' }] })
  assert.match(small, /- reports: pick/)
  assert.match(small, /- auth: waiting on maestro/)
})

test('roleOf: main checkout is the maestro, a registered worktree its principal, anything else nothing', () => {
  const registry = [{ name: 'auth', worktree: '../repo-auth' }]
  assert.deepEqual(roleOf({ top: '/w/repo', main: '/w/repo', registry }), { role: 'maestro' })
  assert.deepEqual(roleOf({ top: '/w/repo-auth', main: '/w/repo', registry }), { role: 'principal', workstream: 'auth', worktree: resolve('/w/repo', '../repo-auth') })
  assert.equal(roleOf({ top: '/w/other', main: '/w/repo', registry }), null)
})

test('registryExtras reads task limit and pause by header, with or without the optional columns', () => {
  const full = '| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage | Task limit | Paused |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| auth | s1 | `auth` at `/w/a` | db_auth | 3001 | no | build | 2 | yes |'
  const lean = '| Workstream | Session | Branch and worktree | Schema change | Stage | Task limit | Paused |\n| --- | --- | --- | --- | --- | --- | --- |\n| auth | s1 | `auth` at `/w/a` | no | build | 3 | no |'
  assert.deepEqual(registryExtras(full, 'auth'), { taskLimit: '2', paused: true })
  assert.deepEqual(registryExtras(lean, 'auth'), { taskLimit: '3', paused: false })
  assert.deepEqual(registryExtras(lean, 'gone'), { taskLimit: '', paused: false })
  assert.deepEqual(registryExtras('', 'auth'), { taskLimit: '', paused: false })
})

test('resumeBlock takes the Resume section, capped at 20 lines', () => {
  const md = `# Status\n\n| table |\n\n## Resume\n${Array.from({ length: 25 }, (_, i) => `- line ${i}`).join('\n')}\n\n## Other\nx`
  const block = resumeBlock(md)
  assert.equal(block.split('\n').length, 20)
  assert.match(block, /^- line 0/)
  assert.equal(resumeBlock('# Status\nno block'), '')
})

test('previousTranscript picks the newest earlier transcript that cleared itself, never the alarm', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pending-asks-'))
  try {
    const cleared = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__ccd_session_mgmt__clear_session', input: {} }] } })
    const plain = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
    for (const [f, body] of [['current.jsonl', plain], ['alarm.jsonl', plain], ['maestro.jsonl', cleared], ['old.jsonl', cleared]]) writeFileSync(join(dir, f), body)
    const now = Date.now()
    const t = ms => new Date(now - ms)
    utimesSync(join(dir, 'old.jsonl'), t(2 * 86_400_000), t(2 * 86_400_000))
    utimesSync(join(dir, 'maestro.jsonl'), t(60_000), t(60_000))
    utimesSync(join(dir, 'alarm.jsonl'), t(1000), t(1000))
    assert.equal(previousTranscript(dir, join(dir, 'current.jsonl'), now), join(dir, 'maestro.jsonl'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('render after a clear starts with the maestro first steps, the resume and the alarm', () => {
  const out = render({ source: 'clear', resume: '- auth builds task 3', alarm: 'local_al', messages: [], waiting: [], notes: [] })
  assert.match(out, /orchestra:maestro/)
  assert.match(out, /set_remote_control/)
  assert.match(out, /- auth builds task 3/)
  assert.match(out, /local_al/)
  assert.match(out, /\/orchestra:status/)
  assert.match(render({ source: 'clear', messages: [], waiting: [], notes: [] }), /No alarm recorded/)
})

test('renderPrincipal: note, status line, limit and pause', () => {
  const out = renderPrincipal({ source: 'clear', workstream: 'auth', notePath: 'docs/workstreams/auth.md', status: 'Status: idle · context 40k', alarm: 'local_al', taskLimit: '2', paused: false })
  assert.match(out, /orchestra:principal/)
  assert.match(out, /docs\/workstreams\/auth\.md/)
  assert.match(out, /Task limit: 2/)
  assert.match(out, /next unticked task/)
  assert.match(renderPrincipal({ source: 'clear', workstream: 'auth', notePath: 'x', status: '', alarm: '', taskLimit: '', paused: true }), /paused/i)
})

test('readJson gives {} for anything but an object, so alarms lookups never throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pending-asks-'))
  try {
    for (const [body, want] of [['null', {}], ['5', {}], ['"x"', {}], ['{bad', {}], ['{"maestro":{"alarm":"a"}}', { maestro: { alarm: 'a' } }]]) {
      writeFileSync(join(dir, 'a.json'), body)
      assert.deepEqual(readJson(join(dir, 'a.json')), want)
    }
    assert.deepEqual(readJson(join(dir, 'missing.json')), {})
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
