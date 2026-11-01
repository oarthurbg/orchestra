#!/usr/bin/env node
// Facts for a codebase map: structure, entry points, imports between folders, tests and git history. Uses no LLM tokens.
// Usage: node codemap.mjs [--root <dir>] [--months N]   prints JSON

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|vue|svelte)$/
const TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/
const ENTRY = /(^|\/)(index|main|app|server|cli|manage|wsgi|asgi)\.(ts|tsx|js|mjs|cjs|py|go)$/
const VENDOR = /(^|\/)(node_modules|vendor|third_party|dist|build|\.venv)\/|\.min\.js$/
const FIX =/\b(fix|fixes|fixed|bug|hotfix|regression)\b/i
const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json', 'pom.xml', 'build.gradle', 'docker-compose.yml', 'Dockerfile']
const TEST_TOOLS = ['vitest', 'jest', 'mocha', 'ava', '@playwright/test', 'cypress', 'pytest']
// shortcut: imports are read with regular expressions, not a parser, so dynamic paths and aliases are missed; good enough for folder-level edges.
const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm
const PY_IMPORT = /^\s*(?:from\s+(\.*[\w.]*)\s+import|import\s+([\w.]+))/gm
const MAX_FILES = 5000
const MAX_BYTES = 256 * 1024

const git = (root, args) => {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

// A tests folder belongs to the folder it tests.
const dirs = f => { const d = path.posix.dirname(f).split('/').filter(s => s !== '.'); while (d.length > 1 && /^(tests?|__tests__|spec)$/.test(d.at(-1))) d.pop(); return d }
const DOC = /\.(md|mdx|txt|rst)$/

// The folder a file belongs to, two levels deep: the unit the map talks about. A folder holding half the code is split
// one level deeper, so the packages of a monorepo (packages/x, plugins/x/y) each become a module.
export function modulesFor(code) {
  const deep = new Set()
  const mod = f => { const d = dirs(f); let n = 2; while (n < d.length && deep.has(d.slice(0, n).join('/'))) n++; return d.slice(0, n).join('/') || '.' }
  for (let i = 0; i < 4; i++) {
    const counts = {}
    for (const f of code) counts[mod(f)] = (counts[mod(f)] ?? 0) + 1
    const [big, n] = top(counts, 1)[0] ?? []
    if (!big || big === '.' || n < code.length / 2 || !code.some(f => mod(f) === big && dirs(f).join('/') !== big)) break
    deep.add(big)
  }
  return mod
}
const stem = f => path.posix.basename(f).replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '').replace(/^test_|_test$/, '')
const top = (counts, n) => Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)

function resolveJs(from, spec, files) {
  if (!spec.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  for (const c of [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'].flatMap(e => [base + e, `${base}/index${e}`])]) if (files.has(c)) return c
  return files.has(base.replace(/\.js$/, '.ts')) ? base.replace(/\.js$/, '.ts') : null
}

function resolvePy(from, spec, files) {
  const dots = spec.match(/^\.*/)[0].length
  const parts = spec.slice(dots).split('.').filter(Boolean)
  let dir = dots ? path.posix.dirname(from).split('/') : []
  for (let i = 1; i < dots; i++) dir = dir.slice(0, -1)
  const base = [...dir, ...parts].filter(s => s && s !== '.').join('/')
  for (const c of [`${base}.py`, `${base}/__init__.py`]) if (files.has(c)) return c
  return null
}

export function collect(root, { months = 12, now = Date.now() } = {}) {
  const listed = git(root, ['ls-files', '-z'])
  if (listed === null) throw new Error(`not a git repository: ${root}`)
  const all = listed.split('\0').filter(f => f && !VENDOR.test(f))
  const files = new Set(all)
  const code = all.filter(f => CODE.test(f))
  const tests = code.filter(f => TEST.test(f))
  const moduleOf = modulesFor(code)

  const structure = {}
  for (const f of all) {
    const m = moduleOf(f)
    const s = (structure[m] ??= { files: 0, code: 0, tests: 0 })
    s.files++
    if (CODE.test(f)) s.code++
    if (TEST.test(f)) s.tests++
  }

  const manifests = {}
  for (const name of MANIFESTS) if (files.has(name)) manifests[name] = true
  if (files.has('package.json')) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
      const deps = { ...p.dependencies, ...p.devDependencies }
      manifests['package.json'] = {
        scripts: p.scripts ?? {}, main: p.main ?? null, bin: p.bin ?? null,
        dependencies: Object.keys(p.dependencies ?? {}).length, devDependencies: Object.keys(p.devDependencies ?? {}).length,
        testTools: TEST_TOOLS.filter(t => t in deps),
      }
    } catch { manifests['package.json'] = 'unreadable' }
  }

  const entries = code.filter(f => ENTRY.test(f) && !TEST.test(f))

  const edges = {}, fanIn = {}
  const scanned = code.slice(0, MAX_FILES)
  for (const f of scanned) {
    const full = path.join(root, f)
    if ((fs.statSync(full, { throwIfNoEntry: false })?.size ?? MAX_BYTES + 1) > MAX_BYTES) continue
    const text = fs.readFileSync(full, 'utf8')
    const py = f.endsWith('.py')
    for (const m of text.matchAll(py ? PY_IMPORT : JS_IMPORT)) {
      const target = py ? resolvePy(f, m[1] ?? m[2], files) : resolveJs(f, m[1], files)
      if (!target) continue
      const a = moduleOf(f), b = moduleOf(target)
      if (a === b) continue
      edges[`${a} -> ${b}`] = (edges[`${a} -> ${b}`] ?? 0) + 1
      fanIn[b] = (fanIn[b] ?? 0) + 1
    }
  }

  const since = Math.floor((now - months * 30.44 * 86400e3) / 1000)
  const log = git(root, ['log', `--since=${since}`, '--no-merges', '--format=%x1e%ct%x1f%s', '--name-only']) ?? ''
  const touched = {}, fixes = {}, monthly = {}
  let commits = 0
  for (const chunk of log.split('\x1e').slice(1)) {
    const [head, ...names] = chunk.split('\n')
    const [ct, subject] = head.split('\x1f')
    commits++
    const month = new Date(Number(ct) * 1000).toISOString().slice(0, 7)
    monthly[month] = (monthly[month] ?? 0) + 1
    for (const n of names.filter(n => files.has(n))) {
      touched[n] = (touched[n] ?? 0) + 1
      if (FIX.test(subject)) fixes[n] = (fixes[n] ?? 0) + 1
    }
  }
  const testStems = new Set(tests.map(stem))
  const firstRoot = (git(root, ['rev-list', '--max-parents=0', 'HEAD']) ?? '').trim().split('\n')[0]
  const first = firstRoot ? Number(git(root, ['log', '-1', '--format=%ct', firstRoot])) : null
  const last = Number(git(root, ['log', '-1', '--format=%ct']) ?? 0) || null

  return {
    v: 1,
    project: path.basename(path.resolve(root)),
    files: all.length, codeFiles: code.length, testFiles: tests.length,
    capped: code.length > MAX_FILES ? `imports read from the first ${MAX_FILES} of ${code.length} code files` : null,
    structure: top(Object.fromEntries(Object.entries(structure).map(([k, v]) => [k, v.files])), 40).map(([m]) => ({ module: m, ...structure[m] })),
    manifests,
    entries: entries.slice(0, 20),
    imports: top(edges, 40).map(([edge, count]) => ({ edge, count })),
    mostImported: top(fanIn, 15).map(([module, count]) => ({ module, count })),
    tests: { byModule: top(Object.fromEntries(Object.entries(structure).filter(([, v]) => v.tests).map(([k, v]) => [k, v.tests])), 15) },
    history: {
      months,
      totalCommits: Number(git(root, ['rev-list', '--count', 'HEAD']) ?? 0),
      firstCommit: first ? new Date(first * 1000).toISOString().slice(0, 10) : null,
      lastCommit: last ? new Date(last * 1000).toISOString().slice(0, 10) : null,
      commitsInWindow: commits,
      byMonth: Object.entries(monthly).sort(),
      hotspots: top(touched, 15).map(([file, count]) => ({ file, commits: count, fixes: fixes[file] ?? 0 })),
      risk: top(Object.fromEntries(Object.entries(fixes).filter(([f, n]) => n >= 2 && !TEST.test(f) && !DOC.test(f))), 15)
        .map(([file, count]) => ({ file, fixes: count, commits: touched[file], hasTest: testStems.has(stem(file)) || testStems.has(path.posix.basename(path.posix.dirname(file))) })),
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  try {
    process.stdout.write(JSON.stringify(collect(path.resolve(opt('--root') ?? '.'), { months: Number(opt('--months') ?? 12) }), null, 1) + '\n')
  } catch (e) {
    process.stderr.write(`codemap: ${e.message}\n`)
    process.exit(2)
  }
}
