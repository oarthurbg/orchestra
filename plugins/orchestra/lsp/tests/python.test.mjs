import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { enclosing, findRoot, lineOf, lineStarts } from '../core.mjs'
import { blank, pyOutline, which } from '../python.mjs'

const SRC = `import os
from .words import (
    greet,
    shout,
)
"""A docstring that says def fake(): and greet."""


@decorator
class Host:
    label: str = "host"

    def open(self, guest):
        text = """
not indented, still inside open
"""
        items = [
1, 2]
        print(greet(guest))  # greet in a comment

        def inner():
            return greet("x")

        return inner

    async def close(self): return greet("bye")


greet = None
total = greet
`

const at = (text, needle, nth = 0) => {
  let i = -1
  for (let k = 0; k <= nth; k++) i = text.indexOf(needle, i + 1)
  return i
}

test('blank keeps offsets and lines but empties strings and comments', () => {
  const b = blank(SRC)
  assert.equal(b.length, SRC.length)
  assert.equal(lineStarts(b).length, lineStarts(SRC).length)
  assert.ok(!b.includes('fake'))
  assert.ok(!b.includes('comment'))
  assert.ok(!b.includes('not indented'))
  assert.equal(blank("x = 'a\\'b' + f\"{y}\" # c"), `x = ${' '.repeat(6)} + ${' '.repeat(6)}${' '.repeat(4)}`)
})

test('Python scopes give Class.method, nested functions and <module>, ignoring strings and open brackets', () => {
  const { scopes } = pyOutline(SRC)
  const name = needle => enclosing(scopes, at(SRC, needle))
  assert.equal(name('label'), 'Host')
  assert.equal(name('items'), 'Host.open')
  assert.equal(name('print(greet'), 'Host.open')
  assert.equal(name('return greet("x")'), 'inner')
  assert.equal(name('return inner'), 'Host.open')
  assert.equal(name('greet("bye")'), 'Host.close')
  assert.equal(name('total'), '<module>')
  // A declaration's own name belongs to the scope around it, and so does its decorator.
  assert.equal(name('open(self'), 'Host')
  assert.equal(name('Host:'), '<module>')
  assert.equal(name('@decorator'), '<module>')
})

test('Python imports cover parenthesized multi-line imports', () => {
  const { imports } = pyOutline(SRC)
  assert.deepEqual([...imports].sort((a, b) => a - b), [0, 1, 2, 3, 4])
})

test('Python ids list real occurrences in order, marking def, class and assignment as declarations', () => {
  const s = lineStarts(SRC)
  const ids = pyOutline(SRC).ids('greet')
  assert.deepEqual(ids.map(i => [lineOf(s, i.offset) + 1, i.decl]), [[3, false], [19, false], [22, false], [26, false], [29, true], [30, false]])
  assert.deepEqual(pyOutline(SRC).ids('open').map(i => i.decl), [true])
  assert.deepEqual(pyOutline(SRC).ids('Host').map(i => i.decl), [true])
  assert.deepEqual(pyOutline(SRC).ids('label').map(i => i.decl), [true])
  assert.deepEqual(pyOutline('if a == b:\n    a = 1\n').ids('a').map(i => i.decl), [false, true])
})

const LSP = fileURLToPath(new URL('../lsp.mjs', import.meta.url))
const FIX = fileURLToPath(new URL('./fixtures/py/', import.meta.url))
const P = path.relative(findRoot(FIX, FIX), FIX).replaceAll('\\', '/').replace(/\/$/, '')
const skip = which('pyright-langserver') ? false : 'pyright-langserver not on PATH (npm install -g pyright)'
const run = (...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [LSP, ...args], { cwd: FIX, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status, out: e.stdout, err: e.stderr }
  }
}

test('Python refs finds every reference through imports and a re-export, and not a same-named local', { skip }, () => {
  const r = run('refs', 'pkg/words.py', 'greet')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, [
    `${P}/pkg/__init__.py:1  <module> (import)  |  from .words import greet`,
    `${P}/pkg/banner.py:1  <module> (import)  |  from . import greet`,
    `${P}/pkg/banner.py:5  banner  |  return greet("everyone").upper()`,
    `${P}/pkg/host.py:1  <module> (import)  |  from .words import greet`,
    `${P}/pkg/host.py:6  Host.open  |  print(greet(guest))`,
    `${P}/pkg/welcome.py:1  <module> (import)  |  from .words import greet`,
    `${P}/pkg/welcome.py:5  welcome  |  return greet(user)`,
    `${P}/pkg/words.py:1  <module> (declaration)  |  def greet(name):`,
    '',
  ].join('\n'))
  assert.equal(run('refs', 'pkg/local.py', 'greet').out, [
    `${P}/pkg/local.py:2  count (declaration)  |  greet = 3`,
    `${P}/pkg/local.py:3  count  |  return greet + 1`,
    '',
  ].join('\n'))
})

test('Python calls --depth 2 gives the caller tree', { skip }, () => {
  const r = run('calls', 'pkg/words.py', 'greet', '--depth', '2')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, [
    `banner  ${P}/pkg/banner.py:5`,
    `Host.open  ${P}/pkg/host.py:6`,
    `  main  ${P}/pkg/main.py:7`,
    `welcome  ${P}/pkg/welcome.py:5`,
    `  main  ${P}/pkg/main.py:6`,
    '',
  ].join('\n'))
})

test('Python defs lands on the declaration', { skip }, () => {
  const r = run('defs', 'pkg/welcome.py', 'greet', '--line', '5')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, `${P}/pkg/words.py:1  <module>  |  def greet(name):\n`)
})
