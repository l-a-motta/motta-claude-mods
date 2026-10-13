// The noun changes-drill adds to `$`, so another mod opens its pane:
// `$.changesDrill.open()`, typed for a mod that lists changes-drill under
// `dependencies`. Below it, the session values the mod keeps in `$.state`, so
// a reload (hot or not) keeps the turns and who touched what.

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

// One main-session turn: its number in the session, its id, the first words
// of its prompt and when it started.
export type ChangesDrillTurn = { n: number; id: string; text: string; at: number }

// Who last changed a file through a tool (`claude` on the main loop, `agent`
// in a subagent's, `shell` for a change that showed up after Claude's own
// shell command), in which turn, how many edits in the session, and when.
export type ChangesDrillTouch = { who: 'claude' | 'agent' | 'shell'; turn: number; edits: number; at: number }

// The commits the session and last-turn baselines diff against: a `git stash
// create` of the work tree at that moment (HEAD's when it was clean), and when.
export type ChangesDrillSnapshot = { sha: string; at: number }

declare module 'claude-code' {
  interface EngineInterface {
    changesDrill: ChangesDrill
  }
  interface PluginState {
    'changes-drill': {
      turns: ChangesDrillTurn[]
      touches: Record<string, ChangesDrillTouch>
      session: ChangesDrillSnapshot | null
      turn: ChangesDrillSnapshot | null
      warned: { sensitive: string[] }
    }
  }
}
