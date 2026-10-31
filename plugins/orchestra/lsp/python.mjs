// Python: scopes, imports and declarations read from the text, answers from pyright-langserver over JSON-RPC.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Exit, lineOf, lineStarts } from './core.mjs'

const W = '\\p{L}\\p{N}_'

// The same text with strings, their prefixes and comments turned into spaces, so offsets and lines still match.
export function blank(text) {
  const a = text.split('')
  const wipe = (from, to) => { for (let k = from; k < to; k++) if (a[k] !== '\n' && a[k] !== '\r') a[k] = ' ' }
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '#') {
      const e = text.indexOf('\n', i), end = e === -1 ? text.length : e
      wipe(i, end)
      i = end
    } else if (c === '"' || c === "'") {
      const q = text.startsWith(c + c + c, i) ? c + c + c : c
      let j = i + q.length
      while (j < text.length && !text.startsWith(q, j) && !(q.length === 1 && text[j] === '\n')) j += text[j] === '\\' ? 2 : 1
      const end = Math.min(text.startsWith(q, j) ? j + q.length : j, text.length)
      const prefix = new RegExp(`(?:^|[^${W}])([rbuf]{1,2})$`, 'iu').exec(text.slice(Math.max(0, i - 3), i))
      wipe(i - (prefix ? prefix[1].length : 0), end)
      i = end
    } else i++
  }
  return a.join('')
}

const DEF = new RegExp(`^([ \\t]*)(?:async[ \\t]+)?(def|class)[ \\t]+([${W}]+)`, 'u')
const bracketDepth = line => { let d = 0; for (const ch of line) d += '([{'.includes(ch) ? 1 : ')]}'.includes(ch) ? -1 : 0; return d }

function scopes(b) {
  const out = [], open = []
  let depth = 0, off = 0
  for (const line of b.split('\n')) {
    // Lines inside open brackets may sit at any indent, so they never end a scope.
    if (depth === 0 && line.trim()) {
      const indent = line.length - line.trimStart().length
      while (open.length && indent <= open.at(-1).indent) open.pop().end = off
      const m = DEF.exec(line)
      if (m) {
        const s = { name: m[3], isClass: m[2] === 'class', at: off + m[0].length - m[3].length, start: off + m[0].length, end: b.length, indent }
        out.push(s)
        open.push(s)
      }
    }
    depth = Math.max(0, depth + bracketDepth(line))
    off += line.length + 1
  }
  return out
}

function imports(b) {
  const out = new Set(), lines = b.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:from\s+\S+\s+import|import)\b/.test(lines[i])) continue
    for (let depth = 0; ; i++) {
      out.add(i)
      depth += bracketDepth(lines[i])
      if ((depth <= 0 && !/\\\s*$/.test(lines[i])) || i + 1 >= lines.length) break
    }
  }
  return out
}

export function pyOutline(text) {
  const b = blank(text), starts = lineStarts(b)
  const ids = name => [...b.matchAll(new RegExp(`(?<![${W}])${name.replaceAll('$', '\\$')}(?![${W}])`, 'gu'))].map(m => {
    const line = lineOf(starts, m.index)
    const before = b.slice(starts[line], m.index), after = b.slice(m.index + name.length, starts[line + 1] ?? b.length)
    const decl = /^[ \t]*(?:(?:async[ \t]+)?def|class)[ \t]+$/.test(before) || (/^[ \t]*$/.test(before) && /^[ \t]*(?::|=(?!=))/.test(after))
    return { offset: m.index, decl }
  })
  return { scopes: scopes(b), imports: imports(b), ids }
}

export function which(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext)
      if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file
    }
  }
  return null
}

// A JSON-RPC client over pyright-langserver --stdio, rooted at the project root.
export async function pyServer(root) {
  const exe = which('pyright-langserver')
  if (!exe) throw new Exit(3, 'pyright-langserver not on PATH (npm install -g pyright)')
  // npm installs a .cmd shim on Windows, which only a shell can start.
  const shell = /\.(cmd|bat)$/i.test(exe)
  const opts = { shell, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
  const child = shell ? spawn(`"${exe}" --stdio`, opts) : spawn(exe, ['--stdio'], opts)
  const pending = new Map()
  let seq = 0, buf = Buffer.alloc(0), ready
  // Answers before Pyright has listed the workspace only cover open files, so wait for that.
  const listed = new Promise((resolve, reject) => { ready = { resolve, reject } })
  listed.catch(() => {})
  const fail = err => { ready.reject(err); for (const p of pending.values()) p.reject(err); pending.clear() }
  child.on('error', fail)
  child.on('exit', code => fail(new Error(`pyright-langserver exited with code ${code}`)))
  child.stdin.on('error', () => {})
  const send = msg => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }))
    child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    send({ id, method, params })
  })
  child.stdout.on('data', chunk => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const head = buf.indexOf('\r\n\r\n')
      if (head === -1) return
      const len = Number(/Content-Length: *(\d+)/i.exec(buf.subarray(0, head).toString())?.[1])
      if (buf.length < head + 4 + len) return
      const msg = JSON.parse(buf.subarray(head + 4, head + 4 + len).toString())
      buf = buf.subarray(head + 4 + len)
      if (msg.method === 'textDocument/publishDiagnostics' || (msg.method === 'window/logMessage' && /^Found \d+ source file/.test(msg.params?.message))) ready.resolve()
      // The server's own requests (progress, registrations) only need an answer.
      if (msg.method && msg.id !== undefined) send({ id: msg.id, result: null })
      else if (pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      }
    }
  })

  const texts = new Map()
  const text = f => texts.get(f) ?? texts.set(f, fs.readFileSync(f, 'utf8')).get(f)
  const opened = new Set()
  const at = (f, offset) => {
    const uri = pathToFileURL(f).href
    if (!opened.has(uri)) {
      opened.add(uri)
      send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'python', version: 1, text: text(f) } } })
    }
    const starts = lineStarts(text(f)), line = lineOf(starts, offset)
    return { textDocument: { uri }, position: { line, character: offset - starts[line] } }
  }
  const loc = (uri, { line, character }) => {
    const file = fileURLToPath(uri)
    return { file, offset: (lineStarts(text(file))[line] ?? 0) + character }
  }

  const rootUri = pathToFileURL(root).href
  await request('initialize', {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
    capabilities: { textDocument: { references: {}, definition: {}, callHierarchy: {} } },
  })
  send({ method: 'initialized', params: {} })
  await listed

  return {
    refs: async (f, o) => ((await request('textDocument/references', { ...at(f, o), context: { includeDeclaration: true } })) ?? []).map(l => loc(l.uri, l.range.start)),
    async incoming(f, o) {
      const out = []
      for (const item of (await request('textDocument/prepareCallHierarchy', at(f, o))) ?? []) {
        for (const c of (await request('callHierarchy/incomingCalls', { item })) ?? []) out.push(...c.fromRanges.map(r => loc(c.from.uri, r.start)))
      }
      return out
    },
    defs: async (f, o) => [(await request('textDocument/definition', at(f, o))) ?? []].flat().map(d => loc(d.targetUri ?? d.uri, (d.targetSelectionRange ?? d.range).start)),
    async close() {
      await Promise.race([request('shutdown').catch(() => {}), new Promise(r => setTimeout(r, 2000).unref())])
      send({ method: 'exit' })
      child.stdin.end()
      child.kill()
    },
  }
}
