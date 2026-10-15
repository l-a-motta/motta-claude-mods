// idle: nothing in hand. choosing: the draft in hand, Cleaned up or Expanded to
// pick. working: the one model call. result: the result, in the pane.
// error: why it failed.
export type Phase = 'idle' | 'choosing' | 'working' | 'result' | 'error'

export type Kind = 'clean' | 'expand'

// The draft, from the prompt box (the status line's ✦) or /enhance, and the
// way picked for it, null until one is.
export type Job = { original: string; via?: 'box' | 'command'; kind: Kind | null }

// Tokens the call spent; `cached` is the part of `input` the prompt cache
// served.
export type Usage = { input: number; output: number; cached: number }

// Whether this surface lets the mod write the prompt box ("Use it"): learned
// from a fill, `no` once one is refused as no_composer.
export type BoxAccess = 'unknown' | 'yes' | 'no'

// The noun prompt-enhancer adds to `$`, so another mod (motta-statusline's
// ✦) opens the Enhance pane: `$.promptEnhancer.open()`, typed for a mod that
// lists prompt-enhancer under `dependencies`.
export type PromptEnhancer = {
  /**
   * Opens the Enhance pane on what the prompt box holds; on an empty box, on
   * what the pane already has.
   *
   * @returns whether a surface draws the pane now, and why not when it waits
   */
  open: () => Promise<PromptEnhancerOpened>
}

export type PromptEnhancerOpened = {
  isPlaced: boolean
  reason?: string
}

declare module 'claude-code' {
  interface EngineInterface {
    promptEnhancer: PromptEnhancer
  }
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
