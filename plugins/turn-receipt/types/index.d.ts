/** What one of your messages set going, kept under the latest reply it led to. */
export type Receipt = {
  isRunning: boolean
  /** The turns it spans: its own, then those agents' reports and task notices started before your next message. */
  turns: number
  /** Subagents the main loop spawned. */
  agents: number
  /** Edit, Write and NotebookEdit calls that went through, from any loop. */
  edits: number
  /** The main loop's tool calls that failed: an error or a refusal. */
  errors: number
  /** The session's cost when the running turn started, from /cost's ledger; absent without one. */
  costAtStart?: number
  /** What its turns added to it. */
  costAdded?: number
  /** How long its turns ran, summed, in milliseconds. */
  durationMs: number
  /** Why the last of its turns ended, as turn.complete says. */
  reason?: 'answer' | 'aborted' | 'refusal' | 'error'
}

declare module 'claude-code' {
  interface PluginState {
    'turn-receipt': {
      /** Each receipt, by the end of the answer it sits under (whitespace folded); the latest few hundred. */
      receipts: Record<string, Receipt>
    }
  }
}
