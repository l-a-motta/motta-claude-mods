export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

export type PlannedTask = {
  title: string
  tier: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
  /** The tool call whose transcript row draws this bar: the latest `progress` call of a flow. */
  anchor?: string
  /** The bar of one Agent or Workflow call, counted from its agents: drawn `Agents done/total`; one agent's, from the steps it reported: `Steps done/total`. */
  kind?: 'agents' | 'steps'
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  /** The Agent call that started it, or the Workflow call of its run. */
  anchor?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  round: number
  /** Self-reported by the worker through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
  /** The panel lists the agents started from here on, and any still running. */
  since?: number
  /** The band's bar the person hid with its ✕, by bandBar's key, until another takes its place. */
  bandDismissed?: string
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      flow: Flow | null
      /** Each tool call row's bar, by tool_use_id; the live flow's row reads `flow`. */
      rows: Record<string, Flow>
      agents: AgentRun[]
      panel: Panel
      now: number
    }
  }
}
