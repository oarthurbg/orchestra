// Run with: node --test plugins/orchestra/tests/delete-guard.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { check, commands } from '../hooks/delete-guard.mjs'

// macOS-style temp folder, so /tmp is only allowed by its own rule.
const unix = { tool: 'Bash', win: false, root: '/work/app', cwd: '/work/app', home: '/home/u', tmp: '/var/folders/ab/xyz/T', env: { HOME: '/home/u', BUILD: 'dist' } }
const win = { tool: 'Bash', win: true, root: 'D:\\Coding\\app', cwd: 'D:\\Coding\\app', home: 'C:\\Users\\u', tmp: 'C:\\Users\\u\\AppData\\Local\\Temp', env: { USERPROFILE: 'C:\\Users\\u', TEMP: 'C:\\Users\\u\\AppData\\Local\\Temp' } }
const ps = { ...win, tool: 'PowerShell' }

test('commands split on separators outside quotes and drop redirections', () => {
  assert.deepEqual(commands(`ls 2>/dev/null && rm -f "a b" > out.log; echo 'x | y'`), [['ls'], ['rm', '-f', 'a b'], ['echo', 'x | y']])
})

test('deletes inside the session folder or the temp folder run', () => {
  for (const c of [
    'rm -rf node_modules dist', 'rm -rf ./build/* && npm test', 'rm -rf /tmp/x', 'rm -rf $BUILD', 'rm -rf *',
    'git clean -fdx', 'rm -f out.log 2>/dev/null', `find . -name '*.pyc' -delete`, 'echo "rm -rf /"', 'cd src && rm -rf gen',
    'rm -rf /tmp/build', 'rm -rf /private/tmp/x', '(cd src && rm -rf gen)', 'FOO=1 rm -rf dist', 'timeout 10 rm -rf dist', 'bash -lc "rm -rf dist"',
  ]) assert.equal(check(c, unix), null, c)
  for (const c of ['rm -rf /d/Coding/app/dist', 'rm -rf /tmp/claude/x', 'cmd //c "rd /s /q build"']) assert.equal(check(c, win), null, c)
  for (const c of [
    'Remove-Item -Recurse -Force .\\dist, .\\coverage', 'Remove-Item $env:TEMP\\x -Recurse', 'Remove-Item d:\\coding\\APP\\dist -Recurse',
    'Remove-Item .\\dist\\* -Recurse -Force', 'cmd /c del /f /q build\\out.txt', 'Remove-Item -Path:.\\dist -Recurse',
  ]) assert.equal(check(c, ps), null, c)
})

test('deletes outside, of the folder itself, or of unknown paths are refused', () => {
  for (const c of [
    'rm -rf ~/.ssh', 'rm -rf $HOME/projects', 'rm -rf "$UNSET/"', 'rm -rf /', 'cd / && rm -rf *', 'rm -rf ..', 'rm -rf .', 'rm -rf .git',
    'rsync -a --delete src/ /home/u/backup/', 'bash -c "rm -rf ~/x"', 'sudo rm -rf /etc', 'find / -name x -delete', 'rm -rf $(pwd)/../x',
    'cd $SOMEWHERE && rm -rf build',
    // A wildcard in the folder itself that can match .git.
    'rm -rf .*', 'rm -rf ./.*',
    // Nested shells, subshells and prefixes.
    'bash -lc "rm -rf ~/x"', '(cd /etc && rm -rf ssh)', 'FOO=1 rm -rf /etc', 'env rm -rf /etc', 'timeout 10 rm -rf /etc', 'nice -n 5 rm -rf /etc',
    // Paths that come from a pipe.
    'find /etc -name x | xargs rm -rf', 'xargs rm -rf < list.txt',
  ]) assert.ok(check(c, unix), c)
  for (const c of ['rm -rf /c/Users/u', 'cmd //c "rd /s /q C:\\data"', 'cmd.exe /c "rd /s /q C:\\data"', 'pwsh -NoProfile -c "Remove-Item C:/Users/u -Recurse"'])
    assert.ok(check(c, win), c)
  for (const c of [
    'Remove-Item -Path C:\\Users\\u\\Documents -Recurse', 'rm -r -fo $HOME\\x', 'cmd /c rd /s /q C:\\data', 'robocopy src D:\\backup /MIR',
    'Remove-Item * -Recurse -Force', 'Remove-Item .\\* -Recurse -Force', 'Remove-Item -Path:C:\\Users\\u -Recurse',
    'powershell -NoProfile -Command "Remove-Item C:\\Users\\u -Recurse"', 'Push-Location C:\\Users\\u; Remove-Item -Recurse Documents',
    'Get-ChildItem "$root\\" | Remove-Item -Recurse -Force', 'Get-ChildItem .\\dist | ForEach-Object { Remove-Item $_ -Recurse }',
  ]) assert.ok(check(c, ps), c)
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
