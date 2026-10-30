import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { TranscriptReader } from '../sources.mjs'
import { liveUrl, startServer, stop } from '../server.mjs'

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url))
const PORT = 47317

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-root-'))
  fs.mkdirSync(path.join(root, '.orchestra', 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(root, '.orchestra', 'workstreams.md'), '| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |\n| --- | --- | --- | --- | --- | --- | --- |\n')
  return root
}

const reader = () => new TranscriptReader(fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-tx-')))

function get(port, url, host, method = 'GET') {
  return new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, path: url, method, headers: host ? { host } : {} }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject).end()
  })
}

test('serves the page and the snapshot, refuses a foreign Host, and cleans up on close', async () => {
  const root = fixture()
  const s = await startServer({ root, port: PORT, reader: reader(), auto: false, onIdle: () => {} })
  try {
    assert.equal(s.url, `http://localhost:${s.port}/`)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.orchestra', 'liveview.json'), 'utf8')), { url: s.url, pid: process.pid })
    const snap = await get(s.port, '/api/snapshot')
    assert.equal(snap.status, 200)
    assert.equal(JSON.parse(snap.body).v, 1)
    assert.equal((await get(s.port, '/')).status, 200)
    assert.equal((await get(s.port, '/?preview&bars=a')).status, 200, 'a query string still serves the page')
    assert.equal((await get(s.port, '/api/snapshot', 'evil.example')).status, 403)
    assert.equal((await get(s.port, '/api/snapshot', `localhost:${s.port}`)).status, 200)
    assert.equal((await get(s.port, '/api/snapshot', `localhost:${s.port + 1}`)).status, 403, 'the right name with the wrong port')
    assert.equal((await get(s.port, '/api/snapshot', undefined, 'POST')).status, 405)
    assert.equal((await get(s.port, '/nope')).status, 404)
    assert.equal(await liveUrl(root), s.url)
  } finally {
    await s.close()
  }
  assert.equal(fs.existsSync(path.join(root, '.orchestra', 'liveview.json')), false)
})

test('liveUrl pings the bound IPv4 address, as on Node 18 where fetch does not fall back from ::1', async () => {
  const root = fixture()
  const before = net.getDefaultAutoSelectFamily?.() ?? false
  const s = await startServer({ root, port: PORT + 20, reader: reader(), auto: false, onIdle: () => {} })
  net.setDefaultAutoSelectFamily?.(false)
  try {
    assert.equal(await liveUrl(root), s.url)
  } finally {
    net.setDefaultAutoSelectFamily?.(before)
    await s.close()
  }
})

test('a busy port moves to the next one', async () => {
  const busy = http.createServer().listen(PORT + 30, '127.0.0.1')
  await new Promise(r => busy.once('listening', r))
  const s = await startServer({ root: fixture(), port: PORT + 30, reader: reader(), auto: false, onIdle: () => {} })
  try {
    assert.equal(s.port, PORT + 31)
  } finally {
    await s.close()
    busy.close()
  }
})

test('exits on its own after 30 minutes with no fresh session file', async () => {
  const root = fixture()
  let t = Date.parse('2026-10-30T12:00:00Z')
  let idled = 0
  const s = await startServer({ root, port: PORT + 40, now: () => t, reader: reader(), auto: false, onIdle: () => { idled++ } })
  fs.writeFileSync(path.join(root, '.orchestra', 'sessions', 'a.json'), JSON.stringify({ v: 1, session: 'a', updatedAt: new Date(t + 20 * 60_000).toISOString() }))
  t += 31 * 60_000
  s.tick()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(idled, 0, 'a session file updated 11 minutes ago keeps it up')
  t += 20 * 60_000
  s.tick()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(idled, 1)
  assert.equal(fs.existsSync(path.join(root, '.orchestra', 'liveview.json')), false)
})

test('the command line detaches, reuses a live server and stops it', async () => {
  const root = fixture()
  const env = { ...process.env, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-cfg-')) }
  const run = (...args) => new Promise(resolve => {
    const p = spawn(process.execPath, [SERVER, '--root', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env })
    let out = ''
    p.stdout.on('data', c => { out += c })
    p.on('close', () => resolve(out.trim()))
  })
  try {
    const url = await run('--detach')
    assert.match(url, /^http:\/\/localhost:\d+\/$/)
    assert.equal(await run('--detach'), url, 'a second start reuses the running server')
    await run('--stop')
    assert.equal(fs.existsSync(path.join(root, '.orchestra', 'liveview.json')), false)
    await new Promise(r => setTimeout(r, 300))
    await assert.rejects(fetch(`${url}api/ping`, { signal: AbortSignal.timeout(2000) }), 'the server process is gone')
  } finally {
    await stop(root)
  }
})

// The starter joins a new job that kills every process in it when the starter exits, the way an app can end a session's job.
const IN_KILL_JOB = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Job {
  [DllImport("kernel32.dll")] public static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr j, int c, byte[] i, int l);
  [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
}
'@
$j = [Job]::CreateJobObject([IntPtr]::Zero, $null)
# JOBOBJECT_EXTENDED_LIMIT_INFORMATION (class 9) on x64: LimitFlags at byte 16, KILL_ON_JOB_CLOSE = 0x2000.
$info = New-Object byte[] 144
[BitConverter]::GetBytes([uint32]0x2000).CopyTo($info, 16)
if (-not [Job]::SetInformationJobObject($j, 9, $info, 144) -or -not [Job]::AssignProcessToJobObject($j, [Job]::GetCurrentProcess())) { exit 2 }
& $env:LIVEVIEW_NODE $env:LIVEVIEW_SERVER --root $env:LIVEVIEW_ROOT --detach`

test('the detached server outlives the Windows job of the process that started it', { skip: process.platform !== 'win32' && 'Windows job objects only' }, async () => {
  const root = fixture()
  const env = { ...process.env, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-cfg-')), LIVEVIEW_NODE: process.execPath, LIVEVIEW_SERVER: SERVER, LIVEVIEW_ROOT: root }
  try {
    const url = await new Promise(resolve => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', IN_KILL_JOB], { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true })
      let out = ''
      p.stdout.on('data', c => { out += c })
      p.on('close', code => resolve(code === 0 ? out.trim() : `exit ${code}`))
    })
    assert.match(url, /^http:\/\/localhost:\d+\/$/)
    await new Promise(r => setTimeout(r, 1000))
    assert.equal((await fetch(`${url}api/ping`.replace('//localhost:', '//127.0.0.1:'), { signal: AbortSignal.timeout(5000) })).status, 200, 'the server survived the job')
  } finally {
    await stop(root)
  }
})

test('SIGTERM removes liveview.json', { skip: process.platform === 'win32' && 'Windows cannot deliver SIGTERM to a handler; --stop covers it' }, async () => {
  const root = fixture()
  const env = { ...process.env, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-cfg-')) }
  const p = spawn(process.execPath, [SERVER, '--root', root], { stdio: 'ignore', env })
  try {
    for (let i = 0; i < 50 && !(await liveUrl(root)); i++) await new Promise(r => setTimeout(r, 100))
    p.kill('SIGTERM')
    await new Promise(r => p.on('close', r))
    assert.equal(fs.existsSync(path.join(root, '.orchestra', 'liveview.json')), false)
  } finally {
    p.kill()
    await stop(root)
  }
})

test('a second start for the same root is refused while the first is alive', async () => {
  const root = fixture()
  const s = await startServer({ root, port: PORT + 50, reader: reader(), auto: false, onIdle: () => {} })
  try {
    await assert.rejects(startServer({ root, port: PORT + 50, reader: reader(), auto: false, onIdle: () => {} }), { code: 'ERUNNING' })
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.orchestra', 'liveview.json'), 'utf8')), { url: s.url, pid: process.pid })
    await assert.rejects(get(PORT + 51, '/api/ping'), 'the second server closed its port')
    assert.deepEqual(JSON.parse((await get(s.port, '/api/ping')).body), { root: path.resolve(root), pid: process.pid })
  } finally {
    await s.close()
  }
})

test('a request line that is not a valid URL gets 400', async () => {
  const s = await startServer({ root: fixture(), port: PORT + 60, reader: reader(), auto: false, onIdle: () => {} })
  try {
    const reply = await new Promise((resolve, reject) => {
      const sock = net.connect(s.port, '127.0.0.1', () => sock.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nConnection: close\r\n\r\n`))
      let out = ''
      sock.on('data', c => { out += c })
      sock.on('end', () => resolve(out))
      sock.on('error', reject)
    })
    assert.match(reply, /^HTTP\/1\.1 400/)
    assert.equal((await get(s.port, '/api/snapshot')).status, 200, 'the server is still up')
  } finally {
    await s.close()
  }
})

const infoPath = root => path.join(root, '.orchestra', 'liveview.json')
const DEAD_URL = `http://localhost:${PORT + 90}/`
const decoy = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })

test('a leftover liveview.json with a dead pid is overwritten', async () => {
  const root = fixture()
  const gone = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise(r => gone.on('close', r))
  fs.writeFileSync(infoPath(root), JSON.stringify({ url: DEAD_URL, pid: gone.pid }))
  const s = await startServer({ root, port: PORT + 70, reader: reader(), auto: false, onIdle: () => {} })
  try {
    assert.deepEqual(JSON.parse(fs.readFileSync(infoPath(root), 'utf8')), { url: s.url, pid: process.pid })
  } finally {
    await s.close()
  }
})

test('a leftover liveview.json naming a live unrelated pid with a dead url is overwritten', async () => {
  const root = fixture()
  const d = decoy()
  try {
    fs.writeFileSync(infoPath(root), JSON.stringify({ url: DEAD_URL, pid: d.pid }))
    const s = await startServer({ root, port: PORT + 72, reader: reader(), auto: false, onIdle: () => {} })
    try {
      assert.deepEqual(JSON.parse(fs.readFileSync(infoPath(root), 'utf8')), { url: s.url, pid: process.pid })
    } finally {
      await s.close()
    }
  } finally {
    d.kill()
  }
})

test('a liveview.json with a non-loopback url is stale and never fetched', async () => {
  const root = fixture()
  const d = decoy()
  const realFetch = globalThis.fetch
  const hosts = []
  globalThis.fetch = (u, ...rest) => { hosts.push(new URL(u).host); return realFetch(u, ...rest) }
  try {
    fs.writeFileSync(infoPath(root), JSON.stringify({ url: 'http://example.com/', pid: d.pid }))
    assert.equal(await liveUrl(root), null)
    const s = await startServer({ root, port: PORT + 74, reader: reader(), auto: false, onIdle: () => {} })
    try {
      assert.deepEqual(JSON.parse(fs.readFileSync(infoPath(root), 'utf8')), { url: s.url, pid: process.pid })
    } finally {
      await s.close()
    }
    assert.ok(!hosts.includes('example.com'), hosts.join())
  } finally {
    globalThis.fetch = realFetch
    d.kill()
  }
})

test('two overlapping starts over a stale liveview.json leave one server', async () => {
  const root = fixture()
  const d = decoy()
  try {
    fs.writeFileSync(infoPath(root), JSON.stringify({ url: DEAD_URL, pid: d.pid }))
    const opts = { root, port: PORT + 74, reader: reader(), auto: false, onIdle: () => {} }
    const [a, b] = await Promise.allSettled([startServer(opts), startServer({ ...opts, reader: reader() })])
    const won = [a, b].filter(r => r.status === 'fulfilled').map(r => r.value)
    try {
      assert.equal(won.length, 1, 'exactly one start wins')
      assert.equal([a, b].find(r => r.status === 'rejected').reason.code, 'ERUNNING')
      assert.deepEqual(JSON.parse(fs.readFileSync(infoPath(root), 'utf8')), { url: won[0].url, pid: process.pid })
    } finally {
      for (const s of won) await s.close()
    }
  } finally {
    d.kill()
  }
})

test('stop does not kill a live pid whose url does not answer, and removes the file', async () => {
  const root = fixture()
  const d = decoy()
  try {
    fs.writeFileSync(infoPath(root), JSON.stringify({ url: DEAD_URL, pid: d.pid }))
    await stop(root)
    assert.equal(fs.existsSync(infoPath(root)), false)
    await new Promise(r => setTimeout(r, 200))
    assert.equal(d.exitCode, null, 'the decoy is still running')
    assert.equal(d.signalCode, null)
  } finally {
    d.kill()
  }
})
