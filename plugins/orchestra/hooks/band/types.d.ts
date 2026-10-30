export type Role = 'orchestrator' | 'workstream' | 'unregistered'
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
  warm: { pings: number; last: string | null }
  updatedAt: string
}

export type RegistryRow = { workstream: string; worktree: string }

export type StatusLine = { state: State | null; stage: string; pr: string; waitingOn: string }

export type BandRow = {
  key: string
  name: string
  link: string
  shape: 'circle' | 'triangle' | 'square' | 'half'
  reason: string
  context: string
  detail: string
}

export type BandView = {
  inProject: boolean
  fiveHour: number | null
  week: number | null
  runOut: number | null
  running: number
  waiting: number
  rows: BandRow[]
  liveview: string
}

declare module 'claude-code' {
  interface PluginState {
    orchestra: { view: BandView }
  }
}
