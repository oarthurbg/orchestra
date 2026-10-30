import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/home/u/repo'
const BAND = {
  plugin: 'orchestra',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const REGISTRY = `| Workstream | Session | Branch and worktree | Test data | Port | Schema change | Stage |
| --- | --- | --- | --- | --- | --- | --- |
| reports | s2 | \`reports\` at \`/home/u/repo/.worktrees/reports\` | none | none | no | spec |
| auth | s3 | \`auth\` at \`/home/u/repo/.worktrees/auth\` | none | none | no | review |
`
const now = () => new Date().toISOString()
const report = (session: string, over: Record<string, unknown>) => JSON.stringify({
  v: 1, session, role: 'workstream', workstream: null, branch: '', title: '', link: '', state: 'running', detail: '',
  stage: '', pr: '', context: { tokens: 40_000, window: 1_000_000 }, limits: [], warm: { pings: 0, last: null }, updatedAt: now(), ...over,
})

// A small file system: reads answer from `files`, writes land there, lists come from the paths.
// The engine resolves a path against the host (D:\home\u\repo on Windows): the fake sees it the POSIX way.
const posix = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

function disk(on: On, files: Record<string, string>) {
  const under = (dir: string) => Object.keys(files).filter(k => k.startsWith(`${dir}/`))
  on('fs.read', ($, e) => (posix(e.path) in files ? { value: files[posix(e.path)]! } : ({ deny: 'missing' }) as never))
  on('fs.write', ($, e) => { files[posix(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', ($, e) => ({ value: posix(e.path) in files || under(posix(e.path)).length > 0 }))
  // exists() and stat() agree: a folder is there when a file lies under it.
  on('fs.stat', ($, e) => (posix(e.path) in files
    ? { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }
    : under(posix(e.path)).length > 0 ? { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false } } : ({ deny: 'missing' }) as never))
  on('fs.list', ($, e) => ({
    value: under(posix(e.path)).filter(k => !k.slice(posix(e.path).length + 1).includes('/'))
      .map(k => ({ name: k.slice(posix(e.path).length + 1), kind: 'file', size: 1, mtimeMs: 1, isLink: false })),
  }) as never)
}

function session(on: On, root: string, id: string) {
  mock.clock(on)
  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: root }))
  on('session.id', () => ({ value: id }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 30_000, window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }] } }) as never)
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ title: 'Orchestrator', link: 'claude://claude.ai/epitaxy/local_o' }) }] } }) as never)
  on('agent.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
}

test('the orchestrator band shows the summary and only the workstreams that need attention', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/sessions/s2.json`]: report('s2', { workstream: 'reports', state: 'waiting', detail: 'asks: pick chart library', link: 'claude://claude.ai/epitaxy/local_s2', title: 'Reports' }),
    [`${ROOT}/.orchestra/sessions/s3.json`]: report('s3', { workstream: 'auth', context: { tokens: 254_000, window: 1_000_000 } }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  // The main checkout: .git is a folder, so reading it as a file fails.
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /5h 42%/ }))).toBeDefined()
    expect(await ui.find({ key: 'open-s2' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /over 250k/ }))).toBeDefined()
    expect(await ui.find({ key: 'liveview' })).toBeUndefined()
    await ui.unmount()
  }
  // Its own report landed in the main checkout.
  expect(JSON.parse(files[`${ROOT}/.orchestra/sessions/o.json`]!).role).toBe('orchestrator')
})

test('a project without .orchestra/ shows the limits line only and writes nothing', async ($, on) => {
  const files: Record<string, string> = {}
  disk(on, files)
  session(on, '/home/u/other', 'x')
  await $.session.start({ cwd: '/home/u/other', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /5h 42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orchestra/ })).toBeDefined()
  expect(Object.keys(files)).toEqual([])
  await ui.unmount()
})

test('the Liveview button shows only for a local URL', async ($, on) => {
  const files: Record<string, string> = {
    [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY,
    [`${ROOT}/.orchestra/liveview.json`]: JSON.stringify({ url: 'http://localhost:4123/' }),
  }
  disk(on, files)
  session(on, ROOT, 'o')
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'liveview' })).toBeDefined()
  await ui.unmount()
})

test('a band another mod draws stays beneath ours', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.orchestra/workstreams.md`]: REGISTRY }
  disk(on, files)
  session(on, ROOT, 'o')
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /other band/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orchestra/ })).toBeDefined()
  await ui.unmount()
})
