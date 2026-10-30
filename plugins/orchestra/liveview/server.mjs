#!/usr/bin/env node
// orchestra liveview: a local page for one project. Reads files on disk only; uses no LLM tokens.
//   node server.mjs --root <main checkout>            run in the foreground
//   node server.mjs --root <main checkout> --detach   start in the background, print the URL
//   node server.mjs --root <main checkout> --stop     stop it

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { TranscriptReader, appendHistory, gather, readHistory, readSessions, seedHistory } from './sources.mjs'
import { MIN, buildSnapshot, timedTasks } from './snapshot.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FIRST_PORT = 4317
export const PORT_TRIES = 21
export const TICK_MS = 5000
export const IDLE_MS = 30 * MIN

const infoFile = root => path.join(root, '.orchestra', 'liveview.json')

function readInfo(root) {
  try { return JSON.parse(fs.readFileSync(infoFile(root), 'utf8')) } catch { return null }
}

// The URL of a live server for this root, or null.
export async function liveUrl(root) {
  const info = readInfo(root)
  if (!info?.url) return null
  try {
    const r = await fetch(new URL('api/ping', info.url), { signal: AbortSignal.timeout(1000) })
    const body = await r.json()
    return path.resolve(body.root) === path.resolve(root) ? info.url : null
  } catch {
    return null
  }
}

function listen(server, port, last) {
  return new Promise((resolve, reject) => {
    const onError = err => {
      server.off('listening', onListening)
      if (err.code === 'EADDRINUSE' && port < last) resolve(listen(server, port + 1, last))
      else reject(err)
    }
    const onListening = () => { server.off('error', onError); resolve(port) }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

// Starts the server. Options exist for tests: port, clock, tick, idle limit, transcript folder, idle action.
export async function startServer({
  root, port = FIRST_PORT, now = Date.now, tickMs = TICK_MS, idleMs = IDLE_MS,
  reader = new TranscriptReader(), onIdle = () => process.exit(0), auto = true,
}) {
  root = path.resolve(root)
  const page = fs.readFileSync(path.join(HERE, 'page.html'))
  const startedAt = now()
  let history = appendHistory(root, readHistory(root), seedHistory(root))
  let snapshot = null
  let bound = 0
  let idle = false

  const tick = () => {
    try {
      const input = gather(root, now(), reader, history)
      const live = Object.values(input.workstreams).flatMap(w => (w.versions ? timedTasks(w.planPath, w.versions, w.commits) : []))
      history = appendHistory(root, history, live)
      input.history = history
      snapshot = buildSnapshot(input)
    } catch (err) {
      if (snapshot) snapshot.staleSince ??= now()
      else snapshot = { v: 1, error: String(err?.message ?? err), staleSince: now(), rows: [] }
    }
    const fresh = readSessions(root).some(s => now() - Date.parse(s.updatedAt) < idleMs)
    if (!idle && now() - startedAt >= idleMs && !fresh) {
      idle = true
      void close().then(onIdle)
    }
  }

  const server = http.createServer((req, res) => {
    const host = req.headers.host ?? ''
    if (host !== `localhost:${bound}` && host !== `127.0.0.1:${bound}`) {
      res.writeHead(403).end('forbidden')
      return
    }
    const send = (type, body) => res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body)
    const route = new URL(req.url ?? '/', 'http://localhost').pathname
    if (req.method !== 'GET') res.writeHead(405).end()
    else if (route === '/') send('text/html; charset=utf-8', page)
    else if (route === '/api/snapshot') send('application/json', JSON.stringify(snapshot))
    else if (route === '/api/ping') send('application/json', JSON.stringify({ root }))
    else res.writeHead(404).end('not found')
  })

  bound = await listen(server, port, port + PORT_TRIES - 1)
  const url = `http://localhost:${bound}/`
  fs.mkdirSync(path.join(root, '.orchestra'), { recursive: true })
  fs.writeFileSync(infoFile(root), JSON.stringify({ url, pid: process.pid }))
  let timer = null
  const close = () => {
    if (timer) clearInterval(timer)
    if (readInfo(root)?.url === url) fs.rmSync(infoFile(root), { force: true })
    return new Promise(resolve => server.close(() => resolve()))
  }
  tick()
  if (auto) timer = setInterval(tick, tickMs)
  return { url, port: bound, tick, close }
}

// Stops the server recorded in liveview.json. On Windows the signal cannot run our handler, so the file goes here.
export function stop(root) {
  const info = readInfo(root)
  if (info?.pid) { try { process.kill(info.pid) } catch { /* already gone */ } }
  fs.rmSync(infoFile(root), { force: true })
}

async function main(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const root = path.resolve(arg('--root') ?? process.cwd())
  if (argv.includes('--stop')) { stop(root); console.log('liveview stopped'); return }
  const running = await liveUrl(root)
  if (running) { console.log(running); return }
  if (argv.includes('--detach')) {
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--root', root], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    // Up to 30 s: the first scan of the transcripts can take several seconds, and the server cannot answer ping meanwhile.
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 100))
      const url = await liveUrl(root)
      if (url) { console.log(url); return }
    }
    console.error('liveview did not start')
    process.exitCode = 1
    return
  }
  let s
  try {
    s = await startServer({ root })
  } catch (err) {
    console.error(`liveview: no free port from ${FIRST_PORT} to ${FIRST_PORT + PORT_TRIES - 1} (${err.code ?? err})`)
    process.exit(1)
  }
  console.log(s.url)
  const quit = () => s.close().then(() => process.exit(0))
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2))
