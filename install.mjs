// Installs orchestra and the plugins its workflow uses, skipping any you already have from any marketplace.
// Run: curl -fsSL https://raw.githubusercontent.com/oarthurbg/orchestra/main/install.mjs | node --input-type=module
// From a clone: node install.mjs [--dry-run]
import { spawnSync } from 'node:child_process'

const MARKETPLACE = 'orchestra'
const REPO = 'oarthurbg/orchestra'
const dry = process.argv.includes('--dry-run')

// stdin may be this script itself (piped into node), so children never read it.
const claude = (args, { mutates = false } = {}) => {
  if (mutates && dry) return console.log(`would run: claude ${args.join(' ')}`), { status: 0, stdout: '' }
  // Windows needs a shell to find claude.cmd; the arguments are fixed words, so one command line is safe.
  const opts = { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', mutates ? 'inherit' : 'pipe', 'inherit'] }
  const r = process.platform === 'win32' ? spawnSync(['claude', ...args].join(' '), { ...opts, shell: true }) : spawnSync('claude', args, opts)
  if (r.error || (process.platform === 'win32' && r.status === 9009)) { console.error('Claude Code (`claude`) is not on PATH. Install it first: https://code.claude.com/docs'); process.exit(1) }
  return r
}
const json = args => {
  const r = claude([...args, '--json'])
  try { return JSON.parse(r.stdout) } catch { console.error(`claude ${args.join(' ')} failed`); process.exit(1) }
}

const added = json(['plugin', 'marketplace', 'list']).some(m => m.name === MARKETPLACE)
if (!added && claude(['plugin', 'marketplace', 'add', REPO], { mutates: true }).status !== 0) process.exit(1)
if (!added && dry) console.log(`(a real run would now list the ${MARKETPLACE} marketplace's plugins)`)

// available leaves out what is installed from this marketplace already, so both lists name its plugins.
const { installed, available } = json(['plugin', 'list', '--available'])
const names = [...new Set([
  ...available.filter(p => p.marketplaceName === MARKETPLACE).map(p => p.name),
  ...installed.filter(p => p.id.endsWith(`@${MARKETPLACE}`)).map(p => p.id.slice(0, -MARKETPLACE.length - 1)),
])]
// orchestra first, then its companions in the marketplace's order.
names.sort((a, b) => (b === 'orchestra') - (a === 'orchestra'))

const failed = []
for (const name of names) {
  const have = installed.find(p => p.id.startsWith(`${name}@`))
  if (have) { console.log(`skip ${name}: already installed as ${have.id} (${have.scope} scope${have.enabled ? '' : ', disabled'})`); continue }
  if (claude(['plugin', 'install', `${name}@${MARKETPLACE}`], { mutates: true }).status !== 0) failed.push(name)
}

console.log(`
${failed.length ? `Not installed: ${failed.join(', ')}. Retry with claude plugin install <name>@${MARKETPLACE}.` : 'Done.'}
- playwright-cli also needs its CLI, for apps with a web UI: npm install -g @playwright/cli@latest
- Then, in your project, run /orchestra:init and load the orchestra:maestro skill in your main session.`)
process.exitCode = failed.length ? 1 : 0
