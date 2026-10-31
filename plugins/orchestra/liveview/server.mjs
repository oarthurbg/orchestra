#!/usr/bin/env node
// orchestra liveview: a local page for one project. Reads files on disk only; uses no LLM tokens.
//   node server.mjs --root <main checkout>            run in the foreground
//   node server.mjs --root <main checkout> --detach   start in the background, print the URL
//   node server.mjs --root <main checkout> --stop     stop it
//   --tailnet  also listen on this machine's Tailscale address, for the owner's phone and other devices on their tailnet

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { TranscriptReader, appendHistory, committedBytes, committedSize, gather, readHistory, readSessions, seedHistory } from './sources.mjs'
import { MIN, buildSnapshot, planPace, timedTasks } from './snapshot.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FIRST_PORT = 4317
export const PORT_TRIES = 21
export const TICK_MS = 5000
export const IDLE_MS = 30 * MIN
export const FILE_MAX = 20 * 1024 * 1024
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', html: 'text/html; charset=utf-8', md: 'text/plain; charset=utf-8' }
// Outlasts a first scan of the transcripts, during which a server cannot answer ping.
const PING_MS = 30_000

const infoFile = root => path.join(root, '.orchestra', 'liveview.json')
// The band reads its weekly run-out from here while the liveview runs.
const paceFile = root => path.join(root, '.orchestra', 'pace.json')

function readInfo(root) {
  try { return JSON.parse(fs.readFileSync(infoFile(root), 'utf8')) } catch { return null }
}

const key = p => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
const sameRoot = (a, b) => key(a) === key(b)
const alive = pid => { try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' } }

// Only a loopback http url is ever fetched: liveview.json is in the project and may be planted.
const loopback = url => /^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(url)
// Pings the address the server binds: on Node 18, fetch to localhost tries ::1 only and never falls back to IPv4.
const ping = (url, ms) => fetch(new URL('api/ping', url.replace('//localhost:', '//127.0.0.1:')), { signal: AbortSignal.timeout(ms) })

// True when the server recorded in liveview.json is alive and answers ping for this root with that same pid.
async function answers(info, root) {
  if (!info?.pid || !loopback(info.url) || !alive(info.pid)) return false
  try {
    const body = await (await ping(info.url, PING_MS)).json()
    return body.pid === info.pid && sameRoot(body.root, root)
  } catch {
    return false
  }
}

// The URL of a live server for this root, or null.
export async function liveUrl(root) {
  const info = readInfo(root)
  if (!loopback(info?.url)) return null
  try {
    const body = await (await ping(info.url, 1000)).json()
    return sameRoot(body.root, root) ? info.url : null
  } catch {
    return null
  }
}

// This machine on Tailscale ({ ip, name }) from `tailscale status --json`, or null when Tailscale is not running.
export function tailnetSelf(status) {
  if (status?.BackendState !== 'Running') return null
  const ip = (status.Self?.TailscaleIPs ?? []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a))
  // The MagicDNS name; '' when MagicDNS is off, and then the address alone serves.
  const name = String(status.Self?.DNSName ?? '').replace(/\.$/, '')
  return ip ? { ip, name: /^[a-z0-9.-]+$/i.test(name) ? name.toLowerCase() : '' } : null
}

// The Tailscale command is often not on PATH: the installers put it in a fixed place.
const TAILSCALE = ['tailscale', ...(process.platform === 'win32' ? ['C:\\Program Files\\Tailscale\\tailscale.exe'] : process.platform === 'darwin' ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : [])]
function readTailnet() {
  for (const cmd of TAILSCALE) {
    try { return tailnetSelf(JSON.parse(execFileSync(cmd, ['status', '--json'], { encoding: 'utf8', timeout: 5000, windowsHide: true }))) } catch { /* try the next */ }
  }
  return null
}

function listen(server, port, last, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onError = err => {
      server.off('listening', onListening)
      if (err.code === 'EADDRINUSE' && port < last) resolve(listen(server, port + 1, last, host))
      else reject(err)
    }
    const onListening = () => { server.off('error', onError); resolve(port) }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

// Starts the server. Options exist for tests: port, clock, file size cap, transcript folder, idle action, own timer.
export async function startServer({
  root, port = FIRST_PORT, now = Date.now, fileMax = FILE_MAX,
  reader = new TranscriptReader(), onIdle = () => process.exit(0), auto = true, tailnet = null,
}) {
  root = path.resolve(root)
  const page = fs.readFileSync(path.join(HERE, 'page.html'))
  const startedAt = now()
  let history = appendHistory(root, readHistory(root), seedHistory(root))
  let snapshot = null
  let registry = []
  let bound = 0
  let idle = false
  let pace = ''

  const tick = () => {
    let input
    try {
      input = gather(root, now(), reader, history)
      const live = Object.values(input.workstreams).flatMap(w => (w.versions ? timedTasks(w.planPath, w.versions, w.commits) : []))
      history = appendHistory(root, history, live)
      input.history = history
      snapshot = buildSnapshot(input)
      registry = input.registry
      // Written only when it changes, so the band's file watch fires only then.
      const next = JSON.stringify(planPace(snapshot))
      if (next !== pace) { fs.writeFileSync(paceFile(root), next); pace = next }
    } catch (err) {
      if (snapshot) snapshot.staleSince ??= now()
      else snapshot = { v: 1, error: String(err?.message ?? err), staleSince: now(), rows: [] }
    }
    const fresh = (input?.sessions ?? readSessions(root)).some(s => now() - Date.parse(s.updatedAt) < IDLE_MS)
    if (!idle && now() - startedAt >= IDLE_MS && !fresh) {
      idle = true
      void close().then(onIdle)
    }
  }

  // File n of a waiting session's list in the latest snapshot. No path ever comes from the request.
  const serveFile = (query, res) => {
    const n = query.get('n') ?? ''
    const known = [...query.keys()].every(k => k === 's' || k === 'n') && /^\d+$/.test(n)
    const entry = known ? snapshot?.inbox?.find(q => q.session === query.get('s')) : undefined
    const f = entry?.files[Number(n)]
    // Files exist only for a registered workstream, so entry.workstream is its registry name.
    // gather keeps the last row of a repeated name, so findLast reads from the worktree the files came from.
    const worktree = f ? registry.findLast(r => r.name === entry.workstream)?.worktree : undefined
    const size = worktree ? committedSize(worktree, f.path) : null
    if (size === null) { res.writeHead(404).end('not found'); return }
    if (size > fileMax) { res.writeHead(413).end('too large'); return }
    const bytes = committedBytes(worktree, f.path, fileMax)
    if (!bytes) { res.writeHead(404).end('not found'); return }
    const ext = f.path.slice(f.path.lastIndexOf('.') + 1).toLowerCase()
    // A sandboxed page or drawing runs in an opaque origin, so its scripts cannot read the liveview's API.
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
      ...(ext === 'html' || ext === 'svg' ? { 'content-security-policy': 'sandbox allow-scripts' } : {}),
    }).end(bytes)
  }

  // The names a request may use: only these, so a page on another site cannot reach the API through DNS rebinding.
  let hosts = new Set()
  const handle = (req, res) => {
    if (!hosts.has(req.headers.host ?? '')) {
      res.writeHead(403).end('forbidden')
      return
    }
    const send = (type, body) => res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body)
    let url
    try { url = new URL(req.url ?? '/', 'http://localhost') } catch { res.writeHead(400).end('bad request'); return }
    const route = url.pathname
    if (req.method !== 'GET') res.writeHead(405).end()
    else if (route === '/' || route === '/inbox') send('text/html; charset=utf-8', page)
    else if (route === '/api/snapshot') send('application/json', JSON.stringify(snapshot))
    else if (route === '/api/ping') send('application/json', JSON.stringify({ root, pid: process.pid }))
    else if (route === '/api/file') serveFile(url.searchParams, res)
    else res.writeHead(404).end('not found')
  }
  const server = http.createServer(handle)

  bound = await listen(server, port, port + PORT_TRIES - 1)
  const url = `http://localhost:${bound}/`
  hosts = new Set([`localhost:${bound}`, `127.0.0.1:${bound}`])
  // Tailscale: a second listener on the tailnet address only, never on every interface. Skipped when that port is taken there.
  let phone = null
  let tailServer = null
  if (tailnet) {
    try {
      tailServer = http.createServer(handle)
      await listen(tailServer, bound, bound, tailnet.ip)
      const names = [tailnet.ip, ...(tailnet.name ? [tailnet.name, tailnet.name.split('.')[0]] : [])]
      for (const n of names) hosts.add(`${n}:${bound}`)
      phone = `http://${tailnet.name || tailnet.ip}:${bound}/`
    } catch {
      tailServer = null
    }
  }
  fs.mkdirSync(path.join(root, '.orchestra'), { recursive: true })
  const file = infoFile(root)
  const write = () => fs.writeFileSync(file, JSON.stringify({ url, pid: process.pid, ...(phone ? { phone } : {}) }), { flag: 'wx' })
  const raw = () => { try { return fs.readFileSync(file, 'utf8') } catch { return null } }
  const running = () => Object.assign(new Error(`liveview already running for ${root}`), { code: 'ERUNNING' })
  const fail = async err => { tailServer?.close(); await new Promise(resolve => server.close(resolve)); throw err }
  try {
    write()
  } catch (err) {
    if (err.code !== 'EEXIST') return fail(err)
    const stale = raw()
    if (await answers(readInfo(root), root)) return fail(running())
    // Remove the stale file only if no other start replaced it during the ping; then the 'wx' retry lets one start win.
    if (raw() === stale) fs.rmSync(file, { force: true })
    try { write() } catch (retry) { return fail(retry.code === 'EEXIST' ? running() : retry) }
  }
  let timer = null
  const close = () => {
    if (timer) clearInterval(timer)
    if (readInfo(root)?.url === url) {
      fs.rmSync(file, { force: true })
      fs.rmSync(paceFile(root), { force: true })
    }
    server.closeAllConnections?.()
    tailServer?.closeAllConnections?.()
    tailServer?.close()
    return new Promise(resolve => server.close(() => resolve()))
  }
  tick()
  if (auto) timer = setInterval(tick, TICK_MS)
  return { url, phone, port: bound, tick, close }
}

// Stops the server recorded in liveview.json, killing the pid only when that server answers ping as itself.
// On Windows the signal cannot run our handler, so the file goes here.
export async function stop(root) {
  const info = readInfo(root)
  if (await answers(info, root)) { try { process.kill(info.pid) } catch { /* already gone */ } }
  fs.rmSync(infoFile(root), { force: true })
}

async function main(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const root = path.resolve(arg('--root') ?? process.cwd())
  if (argv.includes('--stop')) { await stop(root); console.log('liveview stopped'); return }
  const wantsPhone = argv.includes('--tailnet')
  // The phone address on a second line, when the server listens on the tailnet.
  const report = url => {
    console.log(url)
    const phone = readInfo(root)?.phone
    if (phone) console.log(phone)
    else if (wantsPhone) console.error('no phone address: Tailscale is not running, or this liveview started without --tailnet (stop it and start it again)')
  }
  const running = await liveUrl(root)
  if (running) { report(running); return }
  if (argv.includes('--detach')) {
    const args = [fileURLToPath(import.meta.url), '--root', root, ...(wantsPhone ? ['--tailnet'] : [])]
    if (process.platform === 'win32') {
      // A child stays in this process's Windows job, which the Claude app can end with the session that started it.
      // WMI creates the server outside any job, hidden, with this environment. Paths cannot hold '"'; a trailing '\' is doubled so it does not escape the closing quote.
      const line = [process.execPath, ...args].map(a => `"${a.replace(/\\+$/, '$&$&')}"`).join(' ')
      const create = '$s = New-CimInstance Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = [string[]](Get-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" }) }; Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:LIVEVIEW_LINE; ProcessStartupInformation = $s }'
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', create], { env: { ...process.env, LIVEVIEW_LINE: line }, stdio: 'ignore', windowsHide: true }).unref()
    } else {
      spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref()
    }
    // About 30 s, PING_MS (plus one last ping of up to 1 s): the first scan of the transcripts can take several seconds, and the server cannot answer ping meanwhile.
    const deadline = Date.now() + PING_MS
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100))
      const url = await liveUrl(root)
      if (url) { report(url); return }
    }
    console.error('liveview did not start')
    process.exitCode = 1
    return
  }
  let s
  try {
    s = await startServer({ root, tailnet: wantsPhone ? readTailnet() : null })
  } catch (err) {
    if (err.code === 'ERUNNING') { const url = await liveUrl(root); if (url) report(url); else console.log('liveview already starting'); return }
    if (err.code === 'EADDRINUSE') console.error(`liveview: no free port from ${FIRST_PORT} to ${FIRST_PORT + PORT_TRIES - 1}`)
    else console.error(`liveview: ${err.message ?? err}`)
    process.exit(1)
  }
  report(s.url)
  const quit = () => s.close().then(() => process.exit(0))
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2))
