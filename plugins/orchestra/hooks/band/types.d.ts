export type Role = 'maestro' | 'workstream' | 'unregistered'
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
  context: { tokens: number | null; window: number }
  limits: Limit[]
  // misses: forks that did not read the cache, so they were not counted as pings.
  warm: { pings: number; last: string | null; misses?: number }
  updatedAt: string
}

export type RegistryRow = { workstream: string; worktree: string }

export type StatusLine = { state: State | null; stage: string; pr: string; waitingOn: string }

// half: idle (filled); hollow: stale, unregistered or no report (outlined).
export type Shape = 'circle' | 'triangle' | 'square' | 'half' | 'hollow'

export type BandRow = {
  key: string
  name: string
  link: string
  shape: Shape
  status: string
  context: string
  detail: string
}

export type LimitView = { pct: number; resetsAt: number | null }

export type BandView = {
  inProject: boolean
  role: Role
  pings: number
  fiveHour: LimitView | null
  // runOut: when the week runs out at its average pace, only if that comes before the reset.
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
      // The band shows every row (true) or the two most urgent (false); kept in $.store across sessions.
      detailed: boolean
      // ponytail's level switch, drawn when ponytail is installed and its own band is hidden.
      ponytail: { shown: boolean; level: string }
    }
  }
}
