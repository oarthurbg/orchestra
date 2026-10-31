#!/usr/bin/env node
// Code navigation for agents: references, callers and definitions from a language server, one line per item.
// Usage: node lsp.mjs refs|calls|defs <file> <symbol> [--line N] [--depth N]

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Worker, isMainThread } from 'node:worker_threads'

import { Exit, USAGE, around, cap, enclosing, findRoot, langOf, lineOf, lineStarts, parseArgs, pick, refLine } from './core.mjs'
import { pyOutline, pyServer } from './python.mjs'
import { loadTs, projectDir, tsOutline, tsServer } from './typescript.mjs'

const LIMIT_MS = 60_000
const STACK_MB = 64

async function run(argv, cwd) {
  const a = parseArgs(argv)
  if (!a) throw new Exit(2, USAGE)
  const file = path.resolve(cwd, a.file)
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Exit(2, `no such file ${a.file}`)
  const lang = langOf(file)
  if (!lang) throw new Exit(3, `unsupported file type ${path.extname(file) || path.basename(file)}`)
  const root = findRoot(file, cwd)
  const ts = lang === 'ts' ? loadTs(projectDir(file, root)) : null

  const rel = f => path.relative(root, f).replaceAll('\\', '/')
  const files = new Map()
  const read = f => {
    if (!files.has(f)) {
      const text = fs.readFileSync(f, 'utf8')
      files.set(f, { text, starts: lineStarts(text), lines: text.split(/\r?\n/), ...(ts ? tsOutline(ts, text, f) : pyOutline(text)) })
    }
    return files.get(f)
  }
  const where = loc => {
    const o = read(loc.file), line = lineOf(o.starts, loc.offset)
    return { ...loc, o, line, rel: rel(loc.file), place: `${rel(loc.file)}:${line + 1}` }
  }
  const byPlace = (x, y) => x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : x.offset - y.offset

  const target = read(file)
  const id = pick(target.ids(a.symbol), target.starts, { decl: a.cmd !== 'defs', line: a.line })
  if (!id) throw new Exit(1, `symbol ${a.symbol} not found in ${a.file}`)

  const server = ts ? tsServer(ts, file, root) : await pyServer(root)
  try {
    if (a.cmd === 'calls') {
      const out = [], expanded = new Set([`${rel(file)}#${id.offset}`])
      const walk = async (f, offset, level) => {
        const callers = new Map()
        for (const site of (await server.incoming(f, offset)).map(where).sort(byPlace)) {
          const scope = around(site.o.scopes, site.offset)[0] ?? null
          const key = `${site.rel}#${scope ? scope.at : 'module'}`
          if (!callers.has(key)) callers.set(key, { site, scope, key })
        }
        for (const { site, scope, key } of callers.values()) {
          out.push(`${'  '.repeat(level)}${enclosing(site.o.scopes, site.offset)}  ${site.place}`)
          if (scope && level + 1 < a.depth && !expanded.has(key)) {
            expanded.add(key)
            await walk(site.file, scope.at, level + 1)
          }
        }
      }
      await walk(file, id.offset, 0)
      return cap(out)
    }
    const targetLine = lineOf(target.starts, id.offset), seen = new Set()
    return cap((await server[a.cmd](file, id.offset)).map(where).sort(byPlace).filter(w => !seen.has(w.place) && seen.add(w.place)).map(w => {
      const mark = a.cmd !== 'refs' ? null : w.o.imports.has(w.line) ? 'import' : path.relative(w.file, file) === '' && w.line === targetLine ? 'declaration' : null
      return refLine(w.rel, w.line + 1, enclosing(w.o.scopes, w.offset), mark, w.o.lines[w.line])
    }))
  } finally {
    await server.close()
  }
}

if (process.env.ORCHESTRA_LSP_CHILD !== '1') {
  // The TypeScript language service blocks the event loop, so a parent process keeps the time limit.
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, ORCHESTRA_LSP_CHILD: '1' }, timeout: LIMIT_MS, windowsHide: true })
  if (r.error || r.signal) {
    console.error(r.error?.code === 'ETIMEDOUT' || r.signal ? `no answer within ${LIMIT_MS / 1000} s` : r.error.message)
    process.exit(4)
  }
  process.exit(r.status)
} else if (isMainThread) {
  // TypeScript loads imports recursively, a few frames per level, so a long import chain needs more stack than node's main thread has.
  new Worker(new URL(import.meta.url), { argv: process.argv.slice(2), resourceLimits: { stackSizeMb: STACK_MB } }).on('exit', code => { process.exitCode = code })
} else {
  try {
    const lines = await run(process.argv.slice(2), process.cwd())
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`)
  } catch (e) {
    const overflow = e instanceof RangeError && /call stack/.test(e.message)
    console.error(e instanceof Exit ? e.message : overflow ? `language server failed: ran out of its ${STACK_MB} MB stack, most likely on a very deep import chain; use grep here` : `language server failed: ${e.message}`)
    process.exitCode = e instanceof Exit ? e.code : 4
  }
}
