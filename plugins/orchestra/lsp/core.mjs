// The language-free parts of the command: arguments, root, positions, names and output lines.

import fs from 'node:fs'
import path from 'node:path'

export const USAGE = 'usage: lsp.mjs refs|calls|defs <file> <symbol> [--line N] [--depth N (calls only, 1 to 3)]'
const MAX_LINES = 200

// An error that ends the run with this exit code and one line on stderr.
export class Exit extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u

export function parseArgs(argv) {
  const [cmd, file, symbol, ...rest] = argv
  if (!['refs', 'calls', 'defs'].includes(cmd) || !file || !symbol || !IDENT.test(symbol)) return null
  const out = { cmd, file, symbol, depth: 1, line: null }
  for (let i = 0; i < rest.length; i += 2) {
    const n = /^\d+$/.test(rest[i + 1] ?? '') ? Number(rest[i + 1]) : NaN
    if (rest[i] === '--line' && n >= 1) out.line = n
    else if (rest[i] === '--depth' && cmd === 'calls' && n >= 1 && n <= 3) out.depth = n
    else return null
  }
  return out
}

const LANGS = { '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts', '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.cjs': 'ts', '.py': 'py', '.pyi': 'py' }
export const langOf = file => LANGS[path.extname(file).toLowerCase()] ?? null

export function findRoot(file, cwd) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    if (path.dirname(dir) === dir) return cwd
  }
}

export function lineStarts(text) {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

export function lineOf(starts, offset) {
  let lo = 0, hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Scopes are { name, isClass, start, end }, start being just after the name, so a declaration's own name belongs to the scope around it.
// Innermost first.
export const around = (scopes, offset) => scopes.filter(s => s.start <= offset && offset < s.end).sort((a, b) => b.start - a.start)

export function enclosing(scopes, offset) {
  const [s, p] = around(scopes, offset)
  if (!s) return '<module>'
  return p?.isClass ? `${p.name}.${s.name}` : s.name
}

// ids are the symbol's occurrences in one file, in order, each { offset, decl }.
export function pick(ids, starts, { decl, line }) {
  if (line) return ids.find(i => lineOf(starts, i.offset) === line - 1)
  return decl ? ids.find(i => i.decl) : ids[0]
}

export const refLine = (rel, line, name, mark, source) => `${rel}:${line}  ${name}${mark ? ` (${mark})` : ''}  |  ${source.trim().slice(0, 160)}`

export const cap = lines => lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `... ${lines.length - MAX_LINES} more`] : lines
