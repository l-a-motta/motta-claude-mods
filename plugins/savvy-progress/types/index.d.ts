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

/** `stopped`: interrupted, from the tasks list, TaskStop or Esc; not a failure. */
export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

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
  /** Tool calls the agent made, its own `step` reports left out. */
  toolCalls?: number
  /** Of those, the ones that failed: an error, a refusal or an abort. */
  failed?: number
  /** Tool calls by family, as tool-borders names them. */
  kinds?: Record<string, number>
  /** The latest tool calls in order, one tick each, for the activity strip. */
  ticks?: Tick[]
  /** Its latest actions, oldest first: tool calls, and what it said or thought. */
  trail?: TrailEntry[]
  /** Files it read or wrote, newest first. */
  files?: TouchedFile[]
  /** The first line of its final answer. */
  result?: string
  /** When it last streamed text or started or ended a tool call. */
  activeAt?: number
  /** Started by a workflow run, not an Agent call. */
  isWorkflow?: boolean
}

/** What a call does and how far it reaches, as tool-borders classifies it (hooks/tool-kinds.ts). */
export type ToolFamily = 'bookkeeping' | 'read' | 'change' | 'delegate' | 'run'
export type ToolReach = 'project' | 'machine' | 'internet'

export type CallState = 'running' | 'ok' | 'failed'

export type Tick = {
  /** The call's tool_use_id, which its end matches. */
  id: string
  family: ToolFamily
  reach: ToolReach
  state: CallState
}

export type TrailEntry = {
  id: string
  /** A tool call, a phrase of its text, or a phrase of its thinking. */
  kind: 'tool' | 'say' | 'think'
  text: string
  /** A tool call's family, reach and outcome. */
  tool?: ToolFamily
  reach?: ToolReach
  state?: CallState
}

export type TouchedFile = {
  path: string
  /** The riskiest thing done to it (tool-borders' order), and how far it is. */
  family?: ToolFamily
  reach?: ToolReach
  /** Written before files had a family: an edit. */
  isEdited?: boolean
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
