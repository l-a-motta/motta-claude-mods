/** What one turn did, kept under that turn's reply. */
export type Receipt = {
  isRunning: boolean
  /** Subagents the main loop spawned. */
  agents: number
  /** Edit, Write and NotebookEdit calls that went through, from any loop. */
  edits: number
  /** The main loop's tool calls that failed: an error or a refusal. */
  errors: number
  /** The session's cost when the running turn started, from /cost's ledger; absent without one. */
  costAtStart?: number
  /** What the turn added to it. */
  costAdded?: number
  /** How long the turn ran, in milliseconds. */
  durationMs: number
  /** Why the turn ended, as turn.complete says. */
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
