#!/usr/bin/env node
// No new runs: the token measurements already published in docs/superpowers/specs/2026-10-30-lsp-measurement.md,
// transcribed so the README charts read them from one file.
//   node bench/codenav-tokens.mjs
// Writes bench/results/codenav-tokens.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = 'docs/superpowers/specs/2026-10-30-lsp-measurement.md'

// [question, arm, work tokens in thousands, tool calls, recall as found/expected or null, note]
const cell = ([question, arm, kTokens, toolCalls, found, expected, note]) => ({ question, arm, workTokensK: kTokens, toolCalls, recall: found == null ? null : Array.isArray(found) ? { foundPerRun: found, expected } : { found, expected }, ...(note ? { note } : {}) })

const tables = [
  {
    id: 'haiku-three-codebases',
    model: 'Haiku', section: 'the first results table',
    codebases: 'a public Python graph library (288 files), the Python 3.11 standard library (567 files), a public TypeScript drawing app (599 TS/TSX files)',
    accounting: 'Subagent total minus 77,842 tokens of a no-tool Haiku agent. One run per cell (N1 also repeated for noise). Not comparable with the two 1,960-file app tables.',
    arms: { grep: 'grep only', lspFirst: 'a one-line lsp refs|calls|defs wrapper command, then grep to confirm' },
    cells: [
      ['N1 who-calls shortest_path', 'grep', 25.8, 7, 11, 11], ['N1 who-calls shortest_path', 'lspFirst', 18.4, 4, 11, 11],
      ['N2 impact pairwise', 'grep', 43.4, 7, 33, 33], ['N2 impact pairwise', 'lspFirst', 25.7, 3, 33, 33],
      ['N3 trace _accumulate_edges', 'grep', 29.8, 14, 3, 3], ['N3 trace _accumulate_edges', 'lspFirst', 23.1, 6, 3, 3],
      ['S1 who-calls check_output', 'grep', 23.5, 3, 10, 10], ['S1 who-calls check_output', 'lspFirst', 16.3, 4, 10, 10],
      ['S2 impact os.makedirs', 'grep', 19.5, 5, 16, 16], ['S2 impact os.makedirs', 'lspFirst', 17.3, 7, 16, 16],
      ['S3 trace _rmtree_safe_fd', 'grep', 42.9, 14, 7, 8, 'missed onerror'], ['S3 trace _rmtree_safe_fd', 'lspFirst', 33.4, 6, 8, 8],
      ['T1 who-calls isBindingEnabled', 'grep', 54.7, 18, 13, 13, 'one function label wrong'], ['T1 who-calls isBindingEnabled', 'lspFirst', 34.6, 5, 13, 13],
      ['T2 impact redrawTextBoundingBox', 'grep', 41.6, 6, 19, 19], ['T2 impact redrawTextBoundingBox', 'lspFirst', 27.6, 12, 19, 19],
      ['T3 trace isElementInViewport', 'grep', 58.1, 23, null, null, 'same 15 functions in both arms; no truth fraction given'], ['T3 trace isElementInViewport', 'lspFirst', 42.6, 7, null, null, 'same 15 functions in both arms; no truth fraction given'],
    ].map(cell),
    totals: { grep: { workTokensK: 339.2, toolCalls: 97 }, lspFirst: { workTokensK: 238.9, toolCalls: 54 } },
  },
  {
    id: 'haiku-ts-app',
    model: 'Haiku', section: 'the paired trial on a public 1,960-file TypeScript app',
    codebases: 'a public TypeScript app, tests removed, 1,960 TS/TSX files',
    accounting: 'Run total (input, cache and output, summed over turns) minus 72,978 tokens of a no-tool run. Mean of 3 runs per cell; tool calls are means.',
    arms: { grep: 'Grep, Glob, Read', lspPlugin: 'the plugin LSP tool (useSyntaxServer never) plus Grep, Glob, Read', lspWrapper: 'a refs/calls command printing source lines and caller names, plus Grep, Glob, Read', lspGraphify: 'plugin LSP tool plus graphify affected, then confirm' },
    cells: [
      ['O1 who-calls hash', 'grep', 328, 15, 18, 18], ['O1 who-calls hash', 'lspPlugin', 423, 11, 18, 18], ['O1 who-calls hash', 'lspWrapper', 164, 2, 18, 18], ['O1 who-calls hash', 'lspGraphify', 323, 11, 18, 18],
      ['O2 impact parseDomain', 'grep', 333, 24, 22, 22], ['O2 impact parseDomain', 'lspPlugin', 497, 30, 22, 22], ['O2 impact parseDomain', 'lspWrapper', 354, 11, 22, 22], ['O2 impact parseDomain', 'lspGraphify', 487, 31, 22, 22],
      ['O3 trace canUserAccessDocument', 'grep', 1208, 23, [8, 8, 7], 8, 'one run missed init'], ['O3 trace canUserAccessDocument', 'lspPlugin', 1226, 31, 8, 8],
      ['O3 trace canUserAccessDocument', 'lspWrapper', 139, 2, 8, 8], ['O3 trace canUserAccessDocument', 'lspGraphify', 928, 27, 8, 8],
    ].map(cell),
    totals: {
      grep: { workTokensK: 1870, toolCalls: 62, costUSD: 0.201, perRunStdDevK: 449 }, lspPlugin: { workTokensK: 2146, toolCalls: 72, costUSD: 0.176, perRunStdDevK: 441 },
      lspWrapper: { workTokensK: 657, toolCalls: 15, costUSD: 0.046, perRunStdDevK: 114 }, lspGraphify: { workTokensK: 1737, toolCalls: 68, costUSD: 0.139, perRunStdDevK: 266 },
    },
  },
  {
    id: 'opus-ts-app',
    model: 'Opus, effort high', section: 'the same trial on Opus (high effort)',
    codebases: 'a public TypeScript app, tests removed, 1,960 TS/TSX files',
    accounting: 'Run total minus 72,820 tokens of a no-tool run on this model. Mean of 3 runs per cell; tool calls are means.',
    arms: { grep: 'Grep, Glob, Read', lspPlugin: 'the plugin LSP tool plus Grep, Glob, Read', lspWrapper: 'the refs/calls command plus Grep, Glob, Read' },
    cells: [
      ['O1 who-calls hash', 'grep', 503, 15, 18, 18], ['O1 who-calls hash', 'lspPlugin', 211, 5, 18, 18], ['O1 who-calls hash', 'lspWrapper', 236, 3, 18, 18],
      ['O2 impact parseDomain', 'grep', 546, 20, 22, 22], ['O2 impact parseDomain', 'lspPlugin', 536, 12, 22, 22], ['O2 impact parseDomain', 'lspWrapper', 501, 12, 22, 22],
      ['O3 trace canUserAccessDocument', 'grep', 550, 12, 6, 8, 'missed init and send in all 3 runs'], ['O3 trace canUserAccessDocument', 'lspPlugin', 959, 24, 8, 8], ['O3 trace canUserAccessDocument', 'lspWrapper', 613, 11, 8, 8],
    ].map(cell),
    totals: { grep: { workTokensK: 1599, toolCalls: 47, costUSD: 2.18 }, lspPlugin: { workTokensK: 1707, toolCalls: 40, costUSD: 1.98 }, lspWrapper: { workTokensK: 1351, toolCalls: 26, costUSD: 1.82 } },
  },
]

for (const t of tables) {
  console.log(`\n${t.id} (${t.model})`)
  console.table(t.cells.map(c => ({ question: c.question, arm: c.arm, 'work tokens (k)': c.workTokensK, 'tool calls': c.toolCalls, recall: c.recall ? `${c.recall.found ?? c.recall.foundPerRun.join(', ')}/${c.recall.expected}` : '-' })))
}
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true })
fs.writeFileSync(path.join(HERE, 'results', 'codenav-tokens.json'), `${JSON.stringify({
  benchmark: 'codenav-tokens', source: SOURCE,
  note: `Transcribed from ${SOURCE}; no new runs. Work tokens are in thousands. Recall is found over expected; in 3-run cells it held in every run unless foundPerRun lists each run.`,
  tables,
}, null, 2)}\n`)
