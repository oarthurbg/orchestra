import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { USAGE } from '../core.mjs'

const LSP = fileURLToPath(new URL('../lsp.mjs', import.meta.url))

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-cli-'))
  fs.mkdirSync(path.join(dir, '.git'))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

// Only node's own folder on PATH, so no language server is found. Windows may spell the key Path.
const noServer = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')), PATH: path.dirname(process.execPath) }

const run = (cwd, args, env = process.env) => {
  const r = spawnSync(process.execPath, [LSP, ...args], { cwd, env, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr.trim() }
}

test('bad arguments exit 2 with the usage line', () => {
  const dir = project({ 'a.py': 'x = 1\n' })
  for (const args of [[], ['refs', 'a.py'], ['calls', 'a.py', 'x', '--depth', '9'], ['find', 'a.py', 'x']]) {
    assert.deepEqual(run(dir, args), { code: 2, out: '', err: USAGE }, args.join(' '))
  }
  assert.deepEqual(run(dir, ['refs', 'missing.py', 'x']), { code: 2, out: '', err: 'no such file missing.py' })
})

test('an unsupported file type exits 3', () => {
  const dir = project({ 'a.rb': 'def a; end\n' })
  assert.deepEqual(run(dir, ['refs', 'a.rb', 'a']), { code: 3, out: '', err: 'unsupported file type .rb' })
})

test('a Python symbol not declared in the file exits 1, before any server starts', () => {
  const dir = project({ 'a.py': 'def run():\n    return helper()\n' })
  assert.deepEqual(run(dir, ['refs', 'a.py', 'helper'], noServer), { code: 1, out: '', err: 'symbol helper not found in a.py' })
  assert.deepEqual(run(dir, ['defs', 'a.py', 'nothing'], noServer), { code: 1, out: '', err: 'symbol nothing not found in a.py' })
  assert.deepEqual(run(dir, ['refs', 'a.py', 'run', '--line', '2'], noServer), { code: 1, out: '', err: 'symbol run not found in a.py' })
})

test('Python without pyright-langserver on PATH exits 3', () => {
  const dir = project({ 'a.py': 'def run():\n    pass\n' })
  assert.deepEqual(run(dir, ['refs', 'a.py', 'run'], noServer),
    { code: 3, out: '', err: 'pyright-langserver not on PATH (npm install -g pyright)' })
})
