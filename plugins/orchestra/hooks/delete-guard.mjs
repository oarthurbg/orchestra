// PreToolUse hook (Bash, PowerShell): when Claude Code does not ask before shell commands, refuse deletes that reach
// outside the session's folder and the temp folder. A net for a mis-expanded path, not a sandbox: code run by
// python, node or a script file is not read.
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// In these modes Claude Code asks before every shell command, so the owner is the guard.
const ASKING = new Set(['default', 'plan', 'acceptEdits'])
const PS_DELETE = new Set(['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir', 'rm'])
const PS_VALUE = new Set(['-include', '-exclude', '-filter', '-credential', '-stream'])
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'npx', 'pnpx', 'bunx', 'nohup', 'time', 'env', 'timeout', 'nice', 'xargs'])
// Stands for paths the delete gets from a pipe or from xargs, which the guard cannot read.
const PIPED = '<from a pipe>'

// Commands split on ; & | and newlines outside quotes, each a list of words, redirections dropped.
// shortcut: backslash is kept literal (Windows paths), so a bash `\ ` escape splits a word; rare in agent commands.
export function commands(text) {
  const out = []
  let words = [], word = null, quote = null
  const end = () => { if (word !== null) words.push(word); word = null }
  const next = () => { end(); if (words.length) out.push(dropRedirects(words)); words = [] }
  for (const c of text) {
    if (quote) { if (c === quote) quote = null; else word += c; continue }
    if (c === '"' || c === "'") { quote = c; word ??= ''; continue }
    if (c === '\n' || c === ';' || c === '&' || c === '|') { next(); continue }
    if (/\s/.test(c)) { end(); continue }
    word = (word ?? '') + c
  }
  next()
  return out.filter(w => w.length)
}

function dropRedirects(words) {
  const out = []
  for (let i = 0; i < words.length; i++) {
    if (/^\d*[<>]+$/.test(words[i])) i++
    else if (!/^\d*[<>]/.test(words[i])) out.push(words[i])
  }
  return out
}

// The word with ~ and environment variables replaced, or null when its value cannot be known here.
function expand(word, ctx) {
  if (word.includes('$(') || (ctx.tool === 'Bash' && word.includes('`'))) return null
  let unknown = false
  const look = name => {
    const key = Object.keys(ctx.env).find(k => k === name || (ctx.win && k.toLowerCase() === name.toLowerCase()))
    if (key === undefined) unknown = true
    return key === undefined ? '' : ctx.env[key]
  }
  if (word === '~' || /^~[\\/]/.test(word)) word = ctx.home + word.slice(1)
  word = word
    .replace(/\$env:(\w+)/gi, (_, n) => look(n))
    .replace(/\$\{(\w+)\}|\$([A-Za-z_]\w*)/g, (_, a, b) => look(a ?? b))
    .replace(/%(\w+)%/g, (_, n) => look(n))
  return unknown ? null : word
}

function resolve(word, base, ctx) {
  let p = word
  if (ctx.win) {
    // Git Bash spells C:\x as /c/x and the temp folder as /tmp.
    if (/^\/tmp(\/|$)/i.test(p)) p = ctx.tmp + p.slice(4)
    else if (/^\/[a-z](\/|$)/i.test(p)) p = `${p[1]}:\\${p.slice(3)}`
  }
  const P = ctx.win ? path.win32 : path.posix
  if (!P.isAbsolute(p) && base === null) return null
  return P.resolve(base ?? '', p)
}

function relation(target, dir, ctx) {
  const P = ctx.win ? path.win32 : path.posix
  const rel = ctx.win ? P.relative(dir.toLowerCase(), target.toLowerCase()) : P.relative(dir, target)
  if (rel === '') return 'same'
  return rel.startsWith('..') || P.isAbsolute(rel) ? 'outside' : 'inside'
}

// Why one delete target is refused, or null when it stays inside the session's folder or the temp folder.
function refuse(word, base, ctx) {
  if (word === PIPED) return 'its paths come from a pipe or xargs, which this guard cannot read; name the paths on the delete itself'
  const expanded = expand(word, ctx)
  if (expanded === null) return `${word}: its value is unknown here (a variable or $(...)); write the literal path`
  const glob = /[*?[]/.exec(expanded)
  const target = resolve(glob ? expanded.slice(0, glob.index) : expanded, base, ctx)
  if (target === null) return `${word}: relative to a folder that is unknown here; write the full path`
  const P = ctx.win ? path.win32 : path.posix
  // macOS's temp folder is under /var/folders, but agents write to /tmp too.
  const temps = ctx.win ? [ctx.tmp] : [ctx.tmp, '/tmp', '/private/tmp']
  if (temps.some(t => relation(target, t, ctx) === 'inside')) return null
  const there = relation(target, ctx.root, ctx)
  if (there === 'inside' && relation(target, P.join(ctx.root, '.git'), ctx) === 'outside') return null
  // A wildcard in the folder itself spares .git only in Bash and only when it does not start with a dot:
  // PowerShell's * matches dot names, and -Force takes hidden ones.
  if (there === 'same' && glob && ctx.tool === 'Bash' && !P.basename(expanded).startsWith('.')) return null
  return there === 'outside' ? `${word} is ${target}, outside ${ctx.root}` : `${word} is this session's own folder or its .git`
}

// The words a command deletes, or [] when it deletes nothing. Unknown means it deletes something we cannot see.
function targets(words, ctx) {
  const name = path.basename(words[0]).toLowerCase().replace(/\.exe$/, '')
  const args = words.slice(1)
  const plain = a => !a.startsWith('-')
  if (ctx.tool === 'PowerShell' && PS_DELETE.has(name)) {
    const out = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i].toLowerCase()
      const joined = /^-(path|literalpath):(.+)$/i.exec(args[i])
      if (PS_VALUE.has(a)) i++
      else if (joined) out.push(...joined[2].split(','))
      else if (a === '-path' || a === '-literalpath') out.push(...(args[++i] ?? '').split(','))
      // /s, /q, /f and other one-letter switches, from cmd's del and rd.
      else if (plain(a) && !/^\/[a-z]$/.test(a)) out.push(...args[i].split(','))
    }
    // No path: it deletes what a pipe hands it.
    return out.filter(Boolean).length ? out.filter(Boolean) : [PIPED]
  }
  if (name === 'rm' || name === 'rimraf' || name === 'unlink' || name === 'shred') return args.filter(plain)
  if (name === 'rmdir' || name === 'rd' || name === 'del' || name === 'erase') return args.filter(a => plain(a) && !/^\/[a-z]$/i.test(a))
  if (name === 'rsync' && args.some(a => a.startsWith('--delete') || a === '--remove-source-files')) return args.filter(plain).slice(-1)
  if (name === 'robocopy' && args.some(a => /^\/(mir|purge)$/i.test(a))) return args.filter(a => !/^\/[a-z]+(:.*)?$/i.test(a)).slice(1, 2)
  if (name === 'find' && (args.includes('-delete') || args.some((a, i) => /^-exec(dir)?$/.test(a) && /^(rm|rimraf)$/.test(args[i + 1] ?? '')))) {
    const start = args.slice(0, Math.max(0, args.findIndex(a => /^[-(!]/.test(a))))
    // find deletes what is under its start folders, as a glob would.
    return (start.length ? start : ['.']).map(s => `${s}/*`)
  }
  return []
}

// The reason to refuse this command line, or null to let it run.
// A command's words split at ( and {, so subshells, groups and script blocks are checked as commands of their own.
function pieces(words) {
  const out = [[]]
  for (let w of words) {
    while (/^[({]/.test(w)) { out.push([]); w = w.slice(1) }
    w = w.replace(/[)}]+$/, '')
    if (w) out[out.length - 1].push(w)
  }
  return out.filter(p => p.length)
}

// The command after its wrappers (sudo, env, timeout 10, xargs -0) and FOO=1 prefixes. Under xargs, the paths come from the pipe.
function unwrap(words) {
  let piped = false
  while (words.length > 1) {
    const w = words[0].toLowerCase()
    if (/^[A-Za-z_]\w*=/.test(words[0])) words = words.slice(1)
    else if (WRAPPERS.has(w)) {
      piped ||= w === 'xargs'
      words = words.slice(1)
      // Their options and a duration or priority, as in `timeout 10` or `nice -n 5`.
      while (words.length > 1 && /^(-|\d)/.test(words[0])) words = words.slice(1)
    } else break
  }
  return { words, piped }
}

// The command line a nested shell runs, and the rules to read it with, or null.
function nested(name, rest) {
  const at = re => rest.findIndex(a => re.test(a))
  let i
  if (/^(ba|z|da)?sh$/.test(name) && (i = at(/^-[a-z]*c[a-z]*$/i)) >= 0) return [rest[i + 1] ?? '', 'Bash']
  if (/^(powershell|pwsh)$/.test(name) && (i = at(/^-(c|command)$/i)) >= 0) return [rest.slice(i + 1).join(' '), 'PowerShell']
  // Git Bash spells /c as //c.
  if (name === 'cmd' && (i = at(/^\/+[ck]$/i)) >= 0) return [rest.slice(i + 1).join(' '), 'PowerShell']
  return null
}

// The reason to refuse this command line, or null to let it run.
export function check(text, ctx, base = ctx.cwd, depth = 0) {
  for (const piece of commands(text).flatMap(pieces)) {
    const { words, piped } = unwrap(piece)
    const name = path.basename(words[0]).toLowerCase().replace(/\.exe$/, '')
    const rest = words.slice(1)
    // A shell inside the command: check its own command line too.
    const inner = nested(name, rest)
    if (inner && depth < 3) {
      const why = check(inner[0], { ...ctx, tool: inner[1] }, base, depth + 1)
      if (why) return why
      continue
    }
    if (/^(popd|pop-location)$/.test(name)) { base = null; continue }
    if (/^(cd|chdir|pushd|set-location|sl|push-location)$/.test(name)) {
      const dir = rest.find(a => !a.startsWith('-')) ?? '~'
      const expanded = expand(dir, ctx)
      base = expanded === null ? null : resolve(expanded, base, ctx)
      continue
    }
    const found = targets(words, ctx)
    const deletes = found.length || /^(rm|rimraf|unlink|shred|rmdir|rd|del|erase)$/.test(name)
    for (const t of piped && deletes ? [PIPED] : found) {
      const why = refuse(t, base, ctx)
      if (why) return `\`${words.join(' ')}\`: ${why}`
    }
  }
  return null
}

function main() {
  let input
  try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { return }
  if (ASKING.has(input.permission_mode)) return
  const text = input.tool_input?.command
  if (typeof text !== 'string') return
  const win = process.platform === 'win32'
  const ctx = {
    tool: input.tool_name, win, env: process.env, home: os.homedir(), tmp: os.tmpdir(),
    cwd: input.cwd ?? process.cwd(), root: process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(),
  }
  let why
  // A bug here must not stop every shell command.
  try { why = check(text, ctx) } catch { return }
  if (!why) return
  process.stderr.write(`orchestra delete guard: refused ${why}. Without approval prompts, deletes stay inside this session's folder (${ctx.root}) and the temp folder. If it must go, ask the owner to delete it themselves.\n`)
  process.exitCode = 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
