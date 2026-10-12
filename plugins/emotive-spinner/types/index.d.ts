// What the spinner line says for one loop: a symbol, the words (animated by
// the line), an optional detail, and whether it names a tool call (else the
// loop waits, thinks or answers).
export type Shown = { icon: string; text: string; detail?: string; isCall?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'emotive-spinner': {
      // Keyed by loop: `main`, or a subagent's id as its `tool.call`s carry it.
      shown: Record<string, Shown>
    }
  }
}
