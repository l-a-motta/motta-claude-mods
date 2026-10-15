/**
 * How a tool call got past the permission check: allowed by a rule or the
 * mode, decided by the auto-mode classifier, put to the person, still waiting,
 * or refused.
 */
export type Verdict = {
  by: 'rule' | 'classifier' | 'you' | 'pending' | 'denied'
  /** On a refused call, who refused it. */
  deniedBy?: 'rule' | 'classifier' | 'you'
}

declare module 'claude-code' {
  interface PluginState {
    'tool-borders': {
      /** Each call's verdict, by tool_use_id; the latest few hundred. */
      verdicts: Record<string, Verdict>
    }
  }
}
