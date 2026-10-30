#!/usr/bin/env node
// The code navigation command at scale: synthetic TypeScript (and Python) projects with a known call graph.
//   node bench/lsp.mjs            TypeScript at 100, 500, 2,000 and 5,000 files (layered and chain imports), then Python at 100 and 500
//   node bench/lsp.mjs --no-python
// Installs typescript@5 (and pyright) into temp folders with npm --prefix, never globally. Writes bench/results/lsp.json.
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LSP = path.join(HERE, '..', 'plugins', 'orchestra', 'lsp', 'lsp.mjs')
const TS_SIZES = [100, 500, 2000, 5000]
const PY_SIZES = [100, 500]
const RUNS = 3
const L1 = 12 // functions that call the target, one call site each, each in its own file
const L2 = 2 // functions that call each of those, each in its own file
const DECOY_EVERY = 20 // every 20th plain file has a same-named method, a call to it and a comment with the name

const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const sec = x => Math.round(x / 10) / 100
const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), `orchestra-bench-${name}-`))
const pad = i => String(i).padStart(4, '0')

// Share of CPU time the whole machine spent busy over one second, so a reader can see what else was running.
async function busyPercent() {
  const a = os.cpus()
  await new Promise(r => setTimeout(r, 1000))
  let idle = 0, total = 0
  os.cpus().forEach((c, i) => { for (const k of Object.keys(c.times)) { const d = c.times[k] - a[i].times[k]; total += d; if (k === 'idle') idle += d } })
  return Math.round(100 * (1 - idle / total))
}

function install(spec) {
  const prefix = tmp('npm')
  const t = performance.now()
  execSync(`npm install --prefix "${prefix}" ${spec} --no-audit --no-fund --silent`, { stdio: 'inherit', windowsHide: true })
  return { prefix, seconds: sec(performance.now() - t) }
}

// The project layout shared by both languages: where the target and its callers sit, and what each file imports.
// layered: 10 layers, each file imports 3 files of the layer below, the bottom layer imports 3 base files that import nothing,
//   so the deepest import chain is 11 files. The target sits in the bottom layer, its callers in the middle, theirs at the top.
// chain: file i imports files i+1, i+2 and i+3, so one import chain runs through the whole project. A stress case.
const LAYERS = 10
function layout(files, topology) {
  const chain = topology === 'chain'
  const at = {
    hub: chain ? 0 : Math.floor(files * 0.9),
    l1: j => (chain ? 1 + j : Math.floor(files * 0.5) + j),
    l2: (j, k) => (chain ? 1 + L1 : 0) + j * L2 + k,
  }
  const special = new Map([[at.hub, { kind: 'hub' }]])
  for (let j = 0; j < L1; j++) {
    special.set(at.l1(j), { kind: 'l1', j })
    for (let k = 0; k < L2; k++) special.set(at.l2(j, k), { kind: 'l2', j, k })
  }
  const size = files / LAYERS
  const neighbours = i => {
    if (chain) return [1, 2, 3].map(d => (i + d) % files)
    if (i >= files - 3) return []
    const layer = Math.floor(i / size)
    if (layer === LAYERS - 1) return [files - 3, files - 2, files - 1]
    return [0, 1, 2].map(d => (layer + 1) * size + ((i * 7 + d * Math.floor(size / 3)) % size))
  }
  return { special, neighbours, at }
}

function tsProject(files, topology) {
  const dir = tmp(`ts-${topology}-${files}`)
  fs.mkdirSync(path.join(dir, '.git'))
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2020', module: 'esnext', moduleResolution: 'bundler', strict: false, noEmit: true }, include: ['src'] }))
  const { special, neighbours, at } = layout(files, topology)
  const rel = i => `src/d${String(Math.floor(i / 100)).padStart(2, '0')}/m${pad(i)}.ts`
  const spec = (from, to) => { const r = path.posix.relative(path.posix.dirname(rel(from)), rel(to)).replace(/\.ts$/, ''); return r.startsWith('.') ? r : `./${r}` }
  const truth = { calls: [], tree: [] }
  for (let i = 0; i < files; i++) {
    const s = special.get(i)
    const deps = neighbours(i)
    const lines = []
    if (s?.kind === 'l1') { lines.push(`import { target } from '${spec(i, at.hub)}'`); deps.shift() }
    if (s?.kind === 'l2') { lines.push(`import { caller1_${s.j} } from '${spec(i, at.l1(s.j))}'`); deps.shift() }
    for (const d of deps) lines.push(`import { fn${pad(d)} } from '${spec(i, d)}'`)
    lines.push('', `export function fn${pad(i)}(x: number): number {`, `  return ${deps.length ? deps.map(d => `fn${pad(d)}(x)`).join(' + ') : 'x'}`, '}')
    if (s?.kind === 'hub') lines.push('', 'export function target(x: number): number {', '  return x * 2', '}')
    if (s?.kind === 'l1') {
      lines.push('', `export function caller1_${s.j}(x: number): number {`, '  return target(x) + 1', '}')
      truth.calls.push(`${rel(i)}:${lines.length - 1}`)
      truth.tree.push(`0 caller1_${s.j}  ${rel(i)}:${lines.length - 1}`)
    }
    if (s?.kind === 'l2') {
      lines.push('', `export function caller2_${s.j}_${s.k}(x: number): number {`, `  return caller1_${s.j}(x) + 2`, '}')
      truth.tree.push(`1 caller2_${s.j}_${s.k}  ${rel(i)}:${lines.length - 1}`)
    }
    if (!s && i % DECOY_EVERY === 0) {
      lines.push('', '// target: a same-named method below, which is not the function', `export class Decoy${pad(i)} {`, '  target(): number { return 1 }', '}', `export const decoy${pad(i)} = new Decoy${pad(i)}().target()`)
    }
    fs.mkdirSync(path.join(dir, path.dirname(rel(i))), { recursive: true })
    fs.writeFileSync(path.join(dir, rel(i)), `${lines.join('\n')}\n`)
  }
  return { dir, file: rel(at.hub), ext: 'ts', truth }
}

function pyProject(files, topology) {
  const dir = tmp(`py-${topology}-${files}`)
  fs.mkdirSync(path.join(dir, '.git'))
  const { special, neighbours, at } = layout(files, topology)
  const rel = i => `m${pad(i)}.py`
  const truth = { calls: [], tree: [] }
  for (let i = 0; i < files; i++) {
    const s = special.get(i)
    const deps = neighbours(i)
    const lines = []
    if (s?.kind === 'l1') { lines.push(`from m${pad(at.hub)} import target`); deps.shift() }
    if (s?.kind === 'l2') { lines.push(`from m${pad(at.l1(s.j))} import caller1_${s.j}`); deps.shift() }
    for (const d of deps) lines.push(`from m${pad(d)} import fn${pad(d)}`)
    lines.push('', '', `def fn${pad(i)}(x):`, `    return ${deps.length ? deps.map(d => `fn${pad(d)}(x)`).join(' + ') : 'x'}`)
    if (s?.kind === 'hub') lines.push('', '', 'def target(x):', '    return x * 2')
    if (s?.kind === 'l1') {
      lines.push('', '', `def caller1_${s.j}(x):`, '    return target(x) + 1')
      truth.calls.push(`${rel(i)}:${lines.length}`)
      truth.tree.push(`0 caller1_${s.j}  ${rel(i)}:${lines.length}`)
    }
    if (s?.kind === 'l2') {
      lines.push('', '', `def caller2_${s.j}_${s.k}(x):`, `    return caller1_${s.j}(x) + 2`)
      truth.tree.push(`1 caller2_${s.j}_${s.k}  ${rel(i)}:${lines.length}`)
    }
    if (!s && i % DECOY_EVERY === 0) {
      lines.push('', '', '# target: a same-named method below, which is not the function', `class Decoy${pad(i)}:`, '    def target(self):', '        return 1', '', '', `decoy${pad(i)} = Decoy${pad(i)}().target()`)
    }
    fs.writeFileSync(path.join(dir, rel(i)), `${lines.join('\n')}\n`)
  }
  return { dir, file: rel(at.hub), ext: 'py', truth }
}

const score = (got, truth) => {
  const t = new Set(truth), hit = got.filter(g => t.has(g)).length
  return { found: hit, expected: truth.length, returned: got.length, recall: truth.length ? hit / truth.length : null, precision: got.length ? hit / got.length : null }
}

function timed(cwd, args, env) {
  const runs = []
  let last
  for (let r = 0; r < RUNS; r++) {
    const t = performance.now()
    last = spawnSync(args[0], args.slice(1), { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    runs.push(performance.now() - t)
  }
  return { seconds: sec(median(runs)), runs: runs.map(sec), code: last.status, stdout: last.stdout ?? '', stderr: (last.stderr ?? '').trim() }
}

function bench(p, env) {
  const node = process.execPath
  const refs = timed(p.dir, [node, LSP, 'refs', p.file, 'target'], env)
  const calls = timed(p.dir, [node, LSP, 'calls', p.file, 'target', '--depth', '2'], env)
  const grep = timed(p.dir, ['grep', '-rnw', `--include=*.${p.ext}`, '--exclude-dir=node_modules', 'target', '.'], env)
  // refs: lines that are not marked import or declaration are the call sites.
  const refLines = refs.stdout.split('\n').filter(Boolean)
  const sites = refLines.filter(l => !/\((import|declaration)\)  \|/.test(l)).map(l => l.split('  ')[0])
  const tree = calls.stdout.split('\n').filter(Boolean).map(l => { const m = /^( *)(\S+)  (\S+)$/.exec(l); return m ? `${m[1].length / 2} ${m[2]}  ${m[3]}` : `? ${l}` })
  const fail = r => (r.code === 0 ? null : { code: r.code, message: r.stderr })
  return {
    refs: { seconds: refs.seconds, runs: refs.runs, failure: fail(refs), lines: refLines.length, imports: refLines.filter(l => l.includes('(import)')).length, ...score(sites, p.truth.calls) },
    calls: { seconds: calls.seconds, runs: calls.runs, failure: fail(calls), ...score(tree, p.truth.tree) },
    grep: { seconds: grep.seconds, runs: grep.runs, failure: grep.code > 1 ? { code: grep.code, message: grep.stderr } : null, hits: grep.stdout.split('\n').filter(Boolean).length },
  }
}

function suite(lang, topology, sizes, make, link) {
  const out = []
  for (const files of sizes) {
    const p = make(files, topology)
    try {
      const env = link(p.dir)
      const r = bench(p, env)
      out.push({ language: lang, topology, files, ...r })
      console.error(`${lang} ${topology} ${files} files: refs ${r.refs.seconds} s, calls ${r.calls.seconds} s, grep ${r.grep.seconds} s`)
    } finally {
      fs.rmSync(p.dir, { recursive: true, force: true, maxRetries: 5 })
    }
  }
  return out
}

const busyBefore = await busyPercent()
const began = performance.now()
const results = []
const installs = { grep: spawnSync('grep', ['--version'], { encoding: 'utf8' }).stdout?.split('\n')[0] ?? 'not found' }
const ts = install('typescript@5')
installs.typescript = { version: JSON.parse(fs.readFileSync(path.join(ts.prefix, 'node_modules', 'typescript', 'package.json'), 'utf8')).version, installSeconds: ts.seconds }
try {
  // A junction needs no admin rights on Windows; the target folder is outside the project, so removing the project leaves it.
  const link = dir => { fs.symlinkSync(path.join(ts.prefix, 'node_modules'), path.join(dir, 'node_modules'), 'junction'); return process.env }
  results.push(...suite('typescript', 'layered', TS_SIZES, tsProject, link))
  results.push(...suite('typescript', 'chain', TS_SIZES, tsProject, link))
} finally {
  fs.rmSync(ts.prefix, { recursive: true, force: true, maxRetries: 5 })
}
if (!process.argv.includes('--no-python')) {
  const py = install('pyright')
  installs.pyright = { version: JSON.parse(fs.readFileSync(path.join(py.prefix, 'node_modules', 'pyright', 'package.json'), 'utf8')).version, installSeconds: py.seconds }
  // Only this run's PATH gets the temp install's bin folder. Windows may spell the key Path.
  const bin = path.join(py.prefix, 'node_modules', '.bin')
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')), PATH: `${bin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}` }
  try {
    results.push(...suite('python', 'layered', PY_SIZES, pyProject, () => env))
  } finally {
    fs.rmSync(py.prefix, { recursive: true, force: true, maxRetries: 5 })
  }
}

const pct = x => (x === null ? '-' : `${Math.round(x * 100)}%`)
console.table(results.map(r => ({
  language: r.language, imports: r.topology, files: r.files,
  'refs s': r.refs.failure ? `failed (${r.refs.failure.message})` : r.refs.seconds, 'refs recall': pct(r.refs.recall), 'refs precision': pct(r.refs.precision),
  'calls s': r.calls.failure ? `failed (${r.calls.failure.message})` : r.calls.seconds, 'calls recall': pct(r.calls.recall), 'calls precision': pct(r.calls.precision),
  'grep s': r.grep.seconds, 'grep hits': r.grep.hits, 'true call sites': r.refs.expected,
})))
const totalS = Math.round((performance.now() - began) / 100) / 10
const busyAfter = await busyPercent()
console.log(`total ${totalS} s, machine busy ${busyBefore}% before and ${busyAfter}% after`)
const c = os.cpus()
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true })
fs.writeFileSync(path.join(HERE, 'results', 'lsp.json'), `${JSON.stringify({
  benchmark: 'lsp', date: new Date().toISOString(),
  machine: { cpu: c[0]?.model.trim(), logicalCores: c.length, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}`, node: process.version, cpuBusyPercentBefore: busyBefore, cpuBusyPercentAfter: busyAfter },
  runs: RUNS, installs,
  design: { importsPerFile: 3, layers: LAYERS, topologies: ['layered', 'chain'], directCallers: L1, secondLevelCallers: L1 * L2, decoyEvery: DECOY_EVERY, symbol: 'target' },
  notes: [
    'Each run is a fresh process: the language server starts cold every time. Times are wall time of the whole command, median of 3.',
    'refs recall and precision count call sites only: lines marked import or declaration are left out.',
    'calls recall and precision compare (level, function name, file:line) against the 12 direct and 24 second-level callers.',
    'grep is grep -rnw over the source files; its hit count includes imports, the declaration and the planted decoys.',
  ],
  totalSeconds: totalS, results,
}, null, 2)}\n`)
