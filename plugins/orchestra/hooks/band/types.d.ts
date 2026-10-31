export type Role = 'maestro' | 'principal' | 'unregistered'
export type State = 'running' | 'idle' | 'waiting'
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// One session's report: .orchestra/sessions/<session id>.json. Written only by that session.
export type SessionFile = {
  v: 1
  session: string
  role: Role
  workstream: string | null
  branch: string
  title: string
  link: string
  state: State
  detail: string
  stage: string
  pr: string
  // The open AskUserQuestion's first question's labels; [] otherwise. Older files lack both fields.
  options?: string[]
  // When the state last became waiting; null while not waiting.
  waitingSince?: string | null
  context: { tokens: number | null; window: number }
  limits: Limit[]
  // misses: forks that did not read the cache, so they were not counted as pings.
  warm: { pings: number; last: string | null; misses?: number }
  updatedAt: string
}

export type RegistryRow = { workstream: string; worktree: string }

export type StatusLine = { state: State | null; stage: string; pr: string; waitingOn: string }

// How a row's role shape is drawn (docs/BRAND.md): solid, outlined, over a heavy rule, or outlined in grey.
// stale also covers unregistered and no report.
export type Mark = 'running' | 'idle' | 'waiting' | 'stale'

export type BandRow = {
  key: string
  name: string
  link: string
  mark: Mark
  status: string
  context: string
  // 250k tokens or more: the context number is flagged.
  big: boolean
  detail: string
}

export type RowsShown = 'all' | 'top' | 'none'

// A newer orchestra on GitHub: offered, being installed, or installed and waiting for a restart.
export type UpdateOffer = { state: 'none' | 'offered' | 'updating' | 'done'; version: string }

export type LimitView ={ pct: number; resetsAt: number | null }

export type BandView = {
  inProject: boolean
  role: Role
  pings: number
  fiveHour: LimitView | null
  // runOut: when the week runs out before its reset, from the liveview's planned work while it runs, else at the week's average pace.
  week: (LimitView & { runOut: number | null }) | null
  running: number
  waiting: number
  // Workstreams open in the registry.
  total: number
  rows: BandRow[]
  liveview: string
}

declare module 'claude-code' {
  interface PluginState {
    orchestra: {
      view: BandView
      // The band shows every row, the two most urgent, or none (the header names the most urgent); kept in $.store across sessions.
      rows: RowsShown
      // ponytail's level switch, drawn when ponytail is installed and its own band is hidden.
      ponytail: { shown: boolean; level: string }
      // A newer orchestra the band offers to install.
      update: UpdateOffer
    }
  }
}
