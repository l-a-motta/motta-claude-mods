// The noun branch-drill adds to `$`, for the Changes pane's Branches button:
// typed here for the editor only, since changes-drill does not list
// branch-drill under `dependencies` (branch-drill depends on changes-drill).
// Not the contract (that is index.d.ts): `$.branchDrill` is missing when
// branch-drill is not installed, and the call is made inside a try.

declare module 'claude-code' {
  interface EngineInterface {
    branchDrill: { open: () => Promise<{ isPlaced: boolean; reason?: string }> }
  }
}

export {}
