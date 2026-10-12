// The noun usage-drill adds to `$`, so another mod opens its pane:
// `$.usageDrill.open()`, typed for a mod that lists usage-drill under
// `dependencies`.

export type UsageDrill = {
  /**
   * Reads the rate limits fresh and opens the Usage pane on them.
   *
   * @returns whether a surface draws the pane now, and why not when it waits
   */
  open: () => Promise<UsageDrillOpened>
}

export type UsageDrillOpened = {
  isPlaced: boolean
  reason?: string
}

declare module 'claude-code' {
  interface EngineInterface {
    usageDrill: UsageDrill
  }
}
