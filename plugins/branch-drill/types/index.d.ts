// The noun branch-drill adds to `$`, so another mod opens its pane:
// `$.branchDrill.open()`, the Changes pane's Branches button among them.
// branch-drill keeps nothing in `$.state`: its picks are in `$.store`.

export type BranchDrill = {
  /**
   * Reads the branches fresh and opens the Branches pane on them.
   *
   * @returns whether a surface draws the pane now, and why not when it waits
   */
  open: () => Promise<BranchDrillOpened>
}

export type BranchDrillOpened = {
  isPlaced: boolean
  reason?: string
}

declare module 'claude-code' {
  interface EngineInterface {
    branchDrill: BranchDrill
  }
}
