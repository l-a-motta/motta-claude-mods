// idle: nothing in hand. choosing: the draft in hand, Cleaned up or Expanded to
// pick. working: the one model call. result: the result, in the pane.
// error: why it failed.
export type Phase = 'idle' | 'choosing' | 'working' | 'result' | 'error'

export type Kind = 'clean' | 'expand'

// The draft /enhance was given, and the way picked for it, null until one is.
export type Job = { original: string; kind: Kind | null }

// Tokens the call spent; `cached` is the part of `input` the prompt cache
// served.
export type Usage = { input: number; output: number; cached: number }

// Whether this surface lets the mod write the prompt box ("Use it"): learned
// from a fill, `no` once one is refused as no_composer.
export type BoxAccess = 'unknown' | 'yes' | 'no'

declare module 'claude-code' {
  interface PluginState {
    'prompt-enhancer': {
      phase: Phase
      job: Job | null
      result: string
      usage: Usage | null
      modelLabel: string
      failure: string | null
      boxAccess: BoxAccess
    }
  }
}
