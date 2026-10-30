import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { cap, enclosing, findRoot, langOf, lineOf, lineStarts, parseArgs, pick, refLine } from '../core.mjs'

test('parseArgs reads the subcommand, file, symbol and options, and rejects anything else', () => {
  assert.deepEqual(parseArgs(['refs', 'a.ts', 'greet']), { cmd: 'refs', file: 'a.ts', symbol: 'greet', depth: 1, line: null })
  assert.deepEqual(parseArgs(['calls', 'a.py', 'run', '--depth', '3', '--line', '12']), { cmd: 'calls', file: 'a.py', symbol: 'run', depth: 3, line: 12 })
  assert.deepEqual(parseArgs(['defs', 'a.ts', '$el']), { cmd: 'defs', file: 'a.ts', symbol: '$el', depth: 1, line: null })
  for (const bad of [[], ['refs', 'a.ts'], ['find', 'a.ts', 'x'], ['refs', 'a.ts', 'a.b'], ['refs', 'a.ts', 'x', 'y'],
    ['calls', 'a.ts', 'x', '--depth', '4'], ['calls', 'a.ts', 'x', '--depth', '0'], ['refs', 'a.ts', 'x', '--depth', '2'],
    ['refs', 'a.ts', 'x', '--line'], ['refs', 'a.ts', 'x', '--line', 'two'], ['refs', 'a.ts', 'x', '--all']]) {
    assert.equal(parseArgs(bad), null, bad.join(' '))
  }
})

test('langOf maps extensions to a language', () => {
  for (const f of ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) assert.equal(langOf(f), 'ts', f)
  assert.equal(langOf('a.py'), 'py')
  assert.equal(langOf('a.pyi'), 'py')
  assert.equal(langOf('a.rb'), null)
  assert.equal(langOf('Makefile'), null)
})

test('findRoot is the nearest folder with .git, as a folder or a worktree file, else the current folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-root-'))
  fs.mkdirSync(path.join(dir, 'repo', '.git'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'repo', 'src', 'wt', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'repo', 'src', 'wt', '.git'), 'gitdir: elsewhere\n')
  assert.equal(findRoot(path.join(dir, 'repo', 'src', 'a.ts'), 'x'), path.join(dir, 'repo'))
  assert.equal(findRoot(path.join(dir, 'repo', 'src', 'wt', 'lib', 'a.ts'), 'x'), path.join(dir, 'repo', 'src', 'wt'))
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-bare-'))
  const r = findRoot(path.join(bare, 'a.ts'), 'here')
  // The temp folder may itself sit inside a repository on some machines.
  assert.ok(r === 'here' || fs.existsSync(path.join(r, '.git')))
})

test('lineOf finds the 0-based line of an offset', () => {
  const s = lineStarts('ab\ncd\r\n\nef')
  assert.deepEqual([0, 1, 2, 3, 6, 7, 8].map(o => lineOf(s, o)), [0, 0, 0, 1, 1, 2, 3])
})

test('enclosing names the innermost scope, Class.method inside a class, <module> outside', () => {
  const scopes = [
    { name: 'Host', isClass: true, start: 10, end: 100 },
    { name: 'open', isClass: false, start: 20, end: 60 },
    { name: 'inner', isClass: false, start: 30, end: 50 },
    { name: 'helper', isClass: false, start: 120, end: 150 },
  ]
  assert.equal(enclosing(scopes, 5), '<module>')
  assert.equal(enclosing(scopes, 15), 'Host')
  assert.equal(enclosing(scopes, 25), 'Host.open')
  assert.equal(enclosing(scopes, 35), 'inner')
  assert.equal(enclosing(scopes, 55), 'Host.open')
  assert.equal(enclosing(scopes, 100), '<module>')
  assert.equal(enclosing(scopes, 130), 'helper')
})

test('pick takes the first declaration, the first occurrence for defs, or the occurrence on --line', () => {
  const s = lineStarts('a\nb\nc\nd')
  const ids = [{ offset: 0, decl: false }, { offset: 2, decl: true }, { offset: 4, decl: true }]
  assert.equal(pick(ids, s, { decl: true }).offset, 2)
  assert.equal(pick(ids, s, { decl: false }).offset, 0)
  assert.equal(pick(ids, s, { decl: true, line: 1 }).offset, 0)
  assert.equal(pick(ids, s, { decl: true, line: 3 }).offset, 4)
  assert.equal(pick(ids, s, { decl: true, line: 4 }), undefined)
  assert.equal(pick([{ offset: 0, decl: false }], s, { decl: true }), undefined)
})

test('refLine prints path, line, enclosing name, mark and the trimmed source cut at 160 characters', () => {
  assert.equal(refLine('src/a.ts', 3, 'run', null, '   return greet(x)  '), 'src/a.ts:3  run  |  return greet(x)')
  assert.equal(refLine('src/a.ts', 1, '<module>', 'import', "import { greet } from './g'"), "src/a.ts:1  <module> (import)  |  import { greet } from './g'")
  assert.equal(refLine('a.py', 9, 'Host', 'declaration', 'x'.repeat(200)), `a.py:9  Host (declaration)  |  ${'x'.repeat(160)}`)
})

test('cap keeps 200 lines and says how many more there are', () => {
  const lines = Array.from({ length: 205 }, (_, i) => `l${i}`)
  const out = cap(lines)
  assert.equal(out.length, 201)
  assert.equal(out[199], 'l199')
  assert.equal(out[200], '... 5 more')
  assert.deepEqual(cap(['a', 'b']), ['a', 'b'])
  assert.equal(cap(Array(200).fill('x')).length, 200)
})
