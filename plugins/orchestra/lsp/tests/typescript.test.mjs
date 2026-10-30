import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { enclosing, findRoot, lineOf, lineStarts } from '../core.mjs'
import { tsOutline } from '../typescript.mjs'

const LSP = fileURLToPath(new URL('../lsp.mjs', import.meta.url))
const FIX = fileURLToPath(new URL('./fixtures/ts/', import.meta.url))

// The fixture's own node_modules first, then a global install through NODE_PATH.
function findTs() {
  try { return { ts: createRequire(path.join(FIX, 'x.js'))('typescript'), env: {} } } catch {}
  try {
    const global = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { ts: createRequire(path.join(global, 'x.js'))(path.join(global, 'typescript')), env: { NODE_PATH: global } }
  } catch {}
  return null
}
const found = findTs()
const skip = found ? false : 'no typescript package: run "npm install --no-save typescript@5" in plugins/orchestra/lsp/tests/fixtures/ts'

const P = path.relative(findRoot(FIX, FIX), FIX).replaceAll('\\', '/').replace(/\/$/, '')
const run = (...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [LSP, ...args], { cwd: FIX, encoding: 'utf8', env: { ...process.env, ...found?.env }, stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status, out: e.stdout, err: e.stderr }
  }
}

const SRC = `import {
  greet,
  shout,
} from './words'
import fs = require('fs')
const path = require('path')
export * from './all'

export function run(items: string[]) {
  items.forEach(item => greet(item))
  const inner = () => greet('x')
  return inner
}

export class Host {
  label = greet('host')
  handle = () => greet('h')
  constructor() { greet('new') }
  open() {
    return { go() { return greet('go') } }
  }
  get size() { return greet('s').length }
}

export default function () { return greet('d') }
const named = function inner2() { return greet('n') }
`

test('TypeScript scopes skip anonymous callbacks and name methods, properties, accessors and constructors', { skip }, () => {
  const { scopes } = tsOutline(found.ts, SRC, 'a.ts')
  const name = needle => enclosing(scopes, SRC.indexOf(needle))
  assert.equal(name('greet(item)'), 'run')
  assert.equal(name("greet('x')"), 'inner')
  assert.equal(name("greet('host')"), 'Host')
  assert.equal(name("greet('h')"), 'Host.handle')
  assert.equal(name("greet('new')"), 'Host.constructor')
  assert.equal(name("greet('go')"), 'go')
  assert.equal(name("greet('s')"), 'Host.size')
  assert.equal(name("greet('d')"), 'default')
  assert.equal(name("greet('n')"), 'named')
  assert.equal(name('run(items'), '<module>')
  assert.equal(name('open()'), 'Host')
})

test('TypeScript imports cover multi-line imports, import = require, require calls and export from', { skip }, () => {
  const { imports } = tsOutline(found.ts, SRC, 'a.ts')
  assert.deepEqual([...imports].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6])
})

test('TypeScript ids list identifiers in order and mark declarations, not property accesses', { skip }, () => {
  const s = lineStarts(SRC)
  const o = tsOutline(found.ts, SRC, 'a.ts')
  assert.deepEqual(o.ids('greet').map(i => [lineOf(s, i.offset) + 1, i.decl]).slice(0, 3), [[2, true], [10, false], [11, false]])
  assert.deepEqual(o.ids('inner').map(i => i.decl), [true, false])
  assert.deepEqual(o.ids('forEach').map(i => i.decl), [false])
  assert.deepEqual(o.ids('size').map(i => i.decl), [true])
})

test('refs finds every reference through imports and a re-export, and not a same-named local', { skip }, () => {
  const r = run('refs', 'src/greet.ts', 'greet')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, [
    `${P}/src/banner.ts:1  <module> (import)  |  import { greet } from './index'`,
    `${P}/src/banner.ts:3  banner  |  export const banner = () => greet('everyone').toUpperCase()`,
    `${P}/src/greet.ts:1  <module> (declaration)  |  export function greet(name: string): string {`,
    `${P}/src/host.ts:1  <module> (import)  |  import { greet } from './greet'`,
    `${P}/src/host.ts:5  Host.open  |  console.log(greet(guest))`,
    `${P}/src/index.ts:1  <module> (import)  |  export { greet } from './greet'`,
    `${P}/src/welcome.ts:1  <module> (import)  |  import { greet } from './greet'`,
    `${P}/src/welcome.ts:4  welcome  |  return greet(user)`,
    '',
  ].join('\n'))
  assert.equal(run('refs', 'src/local.ts', 'greet').out, [
    `${P}/src/local.ts:2  count (declaration)  |  const greet = 3`,
    `${P}/src/local.ts:3  count  |  return greet + 1`,
    '',
  ].join('\n'))
})

test('calls --depth 2 gives the caller tree', { skip }, () => {
  const r = run('calls', 'src/greet.ts', 'greet', '--depth', '2')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, [
    `banner  ${P}/src/banner.ts:3`,
    `Host.open  ${P}/src/host.ts:5`,
    `  main  ${P}/src/main.ts:6`,
    `welcome  ${P}/src/welcome.ts:4`,
    `  main  ${P}/src/main.ts:5`,
    '',
  ].join('\n'))
  assert.equal(run('calls', 'src/greet.ts', 'greet').out.split('\n').filter(l => l.startsWith(' ')).length, 0)
})

test('defs lands on the declaration, through a re-export too', { skip }, () => {
  const decl = `${P}/src/greet.ts:1  <module>  |  export function greet(name: string): string {\n`
  assert.equal(run('defs', 'src/welcome.ts', 'greet').out, decl)
  assert.equal(run('defs', 'src/banner.ts', 'greet', '--line', '3').out, decl)
  assert.equal(run('defs', path.join(FIX, 'src', 'main.ts'), 'welcome', '--line', '5').out, `${P}/src/welcome.ts:3  <module>  |  export function welcome(user: string) {\n`)
})

test('a symbol that is not declared in the file exits 1', { skip }, () => {
  const r = run('refs', 'src/welcome.ts', 'nothing')
  assert.equal(r.code, 1)
  assert.equal(r.err.trim(), 'symbol nothing not found in src/welcome.ts')
})

test('a TypeScript file in a project without the typescript package exits 3', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lsp-nots-'))
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1\n')
  try {
    execFileSync(process.execPath, [LSP, 'refs', 'a.ts', 'a'], { cwd: dir, env: { ...process.env, NODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
    assert.fail('expected exit 3')
  } catch (e) {
    assert.equal(e.status, 3)
    assert.equal(e.stderr.toString().trim(), 'no typescript package in this project')
  }
})
