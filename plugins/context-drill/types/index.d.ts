// The noun context-drill adds to `$`, so another mod opens its pane:
// `$.contextDrill.open()`, typed for a mod that lists context-drill under
// `dependencies`. And the values the pane keeps in `$.state`.

export type ContextDrill = {
  /**
   * Reads the context breakdown fresh and opens the Context pane on it.
   *
   * @returns whether a surface draws the pane now, and why not when it waits
   */
  open: () => Promise<ContextDrillOpened>
}

export type ContextDrillOpened = {
  isPlaced: boolean
  reason?: string
}

// One heavy item of the transcript: who or which tool, what it was about,
// and its estimated tokens.
export type HeavyItem = { who: string; what: string; tokens: number; isTool: boolean }

// One tool's results summed.
export type ToolTotal = { tool: string; tokens: number; calls: number }

// The startup cost against earlier sessions'.
export type Startup = { tokens: number; average: number | null; sessions: number }

declare module 'claude-code' {
  interface EngineInterface {
    contextDrill: ContextDrill
  }

  // One reading, taken when the pane opens and on Refresh: what the pane draws.
  export interface ContextDrillReading {
    usage: SessionContextUsage
    turns: number
    readAt: number
    // The fill after each turn as of this reading, oldest first.
    history: number[]
    heavy: HeavyItem[]
    tools: ToolTotal[]
    startup: Startup | null
    // Each category's tokens at the baseline `since` measures from.
    since: Record<string, number> | null
  }

  interface PluginState {
    'context-drill': {
      reading: ContextDrillReading | null
      // The fill after each turn, from the figures the engine pushes.
      history: number[]
      // Each category's tokens when the baseline was taken; null until then.
      since: Record<string, number> | null
      // Sections folded or open by title, once pressed.
      folds: Record<string, boolean>
      // The fill's level when last measured: 0 green, 1 yellow, 2 orange, 3 red.
      alerted: number
      // This session's startup cost as first read, once it is in the store.
      startupTokens: number | null
      // The focus picked in the footer: 'none', a preset's key or 'custom'.
      focus: string
    }
  }
}
