// The noun context-drill adds to `$`, so another mod opens its pane:
// `$.contextDrill.open()`, typed for a mod that lists context-drill under
// `dependencies`.

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

declare module 'claude-code' {
  interface EngineInterface {
    contextDrill: ContextDrill
  }
}
