// idle: the chip. asking: the first call, finding what the draft leaves out.
// questions: waiting on the person's answers. writing: the second call.
// result: the card with the versions. error: why a call failed.
export type Phase = 'idle' | 'asking' | 'questions' | 'writing' | 'result' | 'error'

// The draft being enhanced, and whether it came from the box or /enhance.
export type Job = { original: string; via: 'box' | 'command' }

export type Variant = { name: string; text: string }

// Tokens spent on this enhance, every call summed; `cached` is the part of
// `input` the prompt cache served.
export type Usage = { input: number; output: number; cached: number }

// Whether this surface lets the mod read and write the prompt box: learned
// from the first read or fill, `no` once a fill is refused as no_composer.
export type BoxAccess = 'unknown' | 'yes' | 'no'

export type Failure = { reason: string; step: 'ask' | 'write' }

declare module 'claude-code' {
  interface PluginState {
    'prompt-enhancer': {
      phase: Phase
      job: Job | null
      questions: string[]
      answers: string[]
      variants: Variant[]
      shown: number
      usage: Usage | null
      modelLabel: string
      failure: Failure | null
      boxAccess: BoxAccess
    }
  }
}
