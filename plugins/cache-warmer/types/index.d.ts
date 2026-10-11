// The main conversation's prompt cache: when a request last read or wrote
// it (`at`, null once it is known cold), the session model it was made on
// (a switch forfeits it) and how long it lives from then.
export type Hit = { at: number | null; model: string; ttlMs: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-warmer': {
      // The keep-warm switch the chip toggles.
      isOn: boolean
      hit: Hit | null
      // Pings sent since your last turn, and whether one is out now.
      pings: number
      isPinging: boolean
    }
  }
}
