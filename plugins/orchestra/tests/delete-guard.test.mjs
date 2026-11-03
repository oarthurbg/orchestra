// Run with: node --test plugins/orchestra/tests/delete-guard.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { check, commands } from '../hooks/delete-guard.mjs'

const unix = { tool: 'Bash', win: false, root: '/work/app', cwd: '/work/app', home: '/home/u', tmp: '/tmp', env: { HOME: '/home/u', BUILD: 'dist' } }
const win = { tool: 'Bash', win: true, root: 'D:\\Coding\\app', cwd: 'D:\\Coding\\app', home: 'C:\\Users\\u', tmp: 'C:\\Users\\u\\AppData\\Local\\Temp', env: { USERPROFILE: 'C:\\Users\\u', TEMP: 'C:\\Users\\u\\AppData\\Local\\Temp' } }
const ps = { ...win, tool: 'PowerShell' }

test('commands split on separators outside quotes and drop redirections', () => {
  assert.deepEqual(commands(`ls 2>/dev/null && rm -f "a b" > out.log; echo 'x | y'`), [['ls'], ['rm', '-f', 'a b'], ['echo', 'x | y']])
})

test('deletes inside the session folder or the temp folder run', () => {
  for (const c of [
    'rm -rf node_modules dist', 'rm -rf ./build/* && npm test', 'rm -rf /tmp/x', 'rm -rf $BUILD', 'rm -rf *',
    'git clean -fdx', 'rm -f out.log 2>/dev/null', `find . -name '*.pyc' -delete`, 'echo "rm -rf /"', 'cd src && rm -rf gen',
  ]) assert.equal(check(c, unix), null, c)
  for (const c of ['rm -rf /d/Coding/app/dist', 'rm -rf /tmp/claude/x']) assert.equal(check(c, win), null, c)
  for (const c of ['Remove-Item -Recurse -Force .\\dist, .\\coverage', 'Remove-Item $env:TEMP\\x -Recurse', 'Remove-Item d:\\coding\\APP\\dist -Recurse'])
    assert.equal(check(c, ps), null, c)
})

test('deletes outside, of the folder itself, or of unknown paths are refused', () => {
  for (const c of [
    'rm -rf ~/.ssh', 'rm -rf $HOME/projects', 'rm -rf "$UNSET/"', 'rm -rf /', 'cd / && rm -rf *', 'rm -rf ..', 'rm -rf .', 'rm -rf .git',
    'rsync -a --delete src/ /home/u/backup/', 'bash -c "rm -rf ~/x"', 'sudo rm -rf /etc', 'find / -name x -delete', 'rm -rf $(pwd)/../x',
    'cd $SOMEWHERE && rm -rf build',
  ]) assert.ok(check(c, unix), c)
  assert.ok(check('rm -rf /c/Users/u', win))
  for (const c of ['Remove-Item -Path C:\\Users\\u\\Documents -Recurse', 'rm -r -fo $HOME\\x', 'cmd /c rd /s /q C:\\data', 'robocopy src D:\\backup /MIR'])
    assert.ok(check(c, ps), c)
})

test('the hook refuses only when Claude Code does not ask first', () => {
  const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), '../hooks/delete-guard.mjs')
  const run = mode => spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ permission_mode: mode, tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: `rm -rf ${os.homedir().replaceAll('\\', '/')}/x` } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir() }, encoding: 'utf8',
  })
  assert.equal(run('default').status, 0)
  const bypass = run('bypassPermissions')
  assert.equal(bypass.status, 2)
  assert.match(bypass.stderr, /orchestra delete guard: refused/)
})
