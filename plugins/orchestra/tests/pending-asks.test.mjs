// Run with: node --test plugins/orchestra/tests/pending-asks.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noteWaits, render, unansweredMessages, waitingSessions } from '../hooks/pending-asks.mjs'

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
