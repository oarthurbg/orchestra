import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { collect, modulesFor } from '../codemap.mjs'

const run = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
}

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-'))
  const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text) }
  run(dir, 'init', '-q')
  put('package.json', JSON.stringify({ scripts: { test: 'vitest' }, main: 'src/index.ts', devDependencies: { vitest: '1' } }))
  put('src/index.ts', "import { route } from './api/routes'\nimport { db } from './db/client.js'\n")
  put('src/api/routes.ts', "import { db } from '../db/client'\nexport const route = 1\n")
  put('src/db/client.ts', 'export const db = 1\n')
  put('src/api/routes.test.ts', "import { route } from './routes'\n")
  put('app/main.py', 'from app.models import User\nfrom .util import x\n')
  put('app/models/__init__.py', 'User = 1\n')
  put('app/util.py', 'x = 1\n')
  put('src/node_modules/lib/index.js', 'module.exports = 1\n')
  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'start')
  for (const msg of ['fix the client', 'Fix a bug in the client', 'add pooling']) {
    fs.appendFileSync(path.join(dir, 'src/db/client.ts'), `// ${msg}\n`)
    run(dir, 'commit', '-qam', msg)
  }
  return dir
}

test('modules are two folders deep, and a folder holding most of the code is split', () => {
  const flat = modulesFor(['src/api/v1/x.ts', 'src/x.ts', 'lib/y.ts', 'z.ts'])
  assert.equal(flat('src/api/v1/x.ts'), 'src/api')
  assert.equal(flat('src/x.ts'), 'src')
  assert.equal(flat('z.ts'), '.')
  const mono = modulesFor(['plugins/app/server/a.mjs', 'plugins/app/server/b.mjs', 'plugins/app/lsp/c.mjs', 'plugins/app/d.mjs', 'bench/e.mjs'])
  assert.equal(mono('plugins/app/server/a.mjs'), 'plugins/app/server')
  assert.equal(mono('plugins/app/d.mjs'), 'plugins/app')
  assert.equal(mono('bench/e.mjs'), 'bench')
  assert.equal(mono('plugins/app/server/tests/a.test.mjs'), 'plugins/app/server', 'tests sit with the folder they test')
})

test('collect maps structure, imports, tests and history', () => {
  const dir = repo()
  try {
    const m = collect(dir)
    assert.equal(m.project, path.basename(dir))
    assert.equal(m.testFiles, 1)
    assert.ok(!m.entries.some(f => f.includes('node_modules')), 'vendored code is left out')
    assert.deepEqual(m.manifests['package.json'].testTools, ['vitest'])
    assert.ok(m.entries.includes('src/index.ts'))
    assert.ok(m.entries.includes('app/main.py'))
    const edges = Object.fromEntries(m.imports.map(e => [e.edge, e.count]))
    assert.equal(edges['src -> src/api'], 1)
    assert.equal(edges['src -> src/db'], 1, 'a .js specifier resolves to the .ts file')
    assert.equal(edges['src/api -> src/db'], 1)
    assert.equal(edges['app -> app/models'], 1)
    assert.equal(m.mostImported[0].module, 'src/db')
    assert.equal(m.history.totalCommits, 4)
    assert.equal(m.history.hotspots[0].file, 'src/db/client.ts')
    assert.deepEqual(m.history.risk, [{ file: 'src/db/client.ts', fixes: 2, commits: 4, hasTest: false }])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('collect refuses a folder that is not a git repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-'))
  try {
    assert.throws(() => collect(dir), /not a git repository/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
