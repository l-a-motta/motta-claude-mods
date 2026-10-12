// The noun changes-drill adds to `$`, so another mod opens its pane:
// `$.changesDrill.open()`, typed for a mod that lists changes-drill under
// `dependencies`.

export type ChangesDrill = {
  /**
   * Reads the changed files fresh and opens the Changes pane on them.
   *
   * @returns whether a surface draws the pane now, and why not when it waits
   */
  open: () => Promise<ChangesDrillOpened>
}

export type ChangesDrillOpened = {
  isPlaced: boolean
  reason?: string
}

declare module 'claude-code' {
  interface EngineInterface {
    changesDrill: ChangesDrill
  }
}
