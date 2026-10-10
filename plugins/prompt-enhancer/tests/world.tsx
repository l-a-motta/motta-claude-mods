// The engine beneath the mod: a prompt box (or none), the model calls
// answered from a queue of replies, and a record of what the mod filled,
// submitted, copied and toasted.

import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

export const START = { cwd: 'C:/repo', surface: 'terminal' as const, isInteractive: true }

export const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 40,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 39 },
  view: {},
}

// The Enhance pane, mounted as a surface draws it.
export const PANE = {
  plugin: 'prompt-enhancer',
  component: 'Pane',
  requestId: 'prompt-enhancer',
  props: { title: 'Enhance', isFocused: true, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

export const command = (args: string) => ({
  command: 'enhance',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

export const DRAFT = 'uh fix the flaky test in @tests/checkout.spec.ts, it fails sometimes on CI'

// What the cheap model and the conversation's model answer.
export const CLEANED = 'Fix the flaky test in @tests/checkout.spec.ts, it fails sometimes on CI.'
export const EXPANDED = 'Fix the flaky test in @tests/checkout.spec.ts: it fails on CI [how often]. Find the root cause, then show it passing 20 runs in a row.'

export const MESSAGES = [
  { role: 'user', content: [{ type: 'text', text: 'why is checkout slow?' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'The cart loads every item.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
    ],
  },
]

const USAGE = { input_tokens: 200, output_tokens: 300, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 0 }

type Setup = {
  box?: string
  hasComposer?: boolean
  canFork?: boolean
  // Each model call takes the next one: a reply's text, or `fail` for a 529.
  replies?: string[]
  // A plugin beneath drawing in the band: motta-statusline's lines, as it
  // draws them on the desktop, unkeyed.
  hasStatusLine?: boolean
  // A card beneath that shares the band (`band-under:`), as savvy-progress's bar.
  hasCard?: boolean
}

export function world(on: Parameters<TestBody>[1], setup: Setup = {}) {
  const seen = {
    forked: [] as string[],
    completed: [] as { model: string; prompt: string; system?: string; effort?: string }[],
    filled: [] as string[],
    submitted: [] as string[],
    copied: [] as string[],
    toasts: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
  }
  const replies = [...(setup.replies ?? [])]
  const hasComposer = setup.hasComposer ?? true
  const answer = () => {
    const next = replies.shift() ?? ''
    return next === 'fail'
      ? { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: { ...USAGE, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 } }
      : { isAnswered: true as const, text: next, usage: USAGE }
  }

  const clock = mock.clock(on)
  // The engine's own band, empty: the opaque reference it hands back.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (setup.hasCard) {
      return (
        <Box key="band-under:savvy-progress" flexDirection="column">
          <Text>Subagents 2/2</Text>
        </Box>
      )
    }
    if (!setup.hasStatusLine) return { type: 'engine', ref: 1 } as never
    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <Text>📁 motta-claude-mods 🌿 main</Text>
        <Text>CTX 36% 360k/1M</Text>
      </Box>
    )
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.read', () => ({ value: { text: hasComposer ? (setup.box ?? '') : '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    if (!hasComposer) return { isFilled: false, refusal: 'no_composer' as const }
    seen.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  on('model.fork', ($, e) => {
    seen.forked.push(e.prompt)
    if (setup.canFork === false) return { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
    return { value: answer() }
  })
  on('model.complete', ($, e) => {
    seen.completed.push({ model: e.model, prompt: e.prompt, ...(e.system ? { system: e.system } : {}), ...(e.effort ? { effort: e.effort } : {}) })
    return { value: answer() }
  })
  on('session.messages', () => ({ value: MESSAGES as never }))
  on('ui.copy', ($, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    seen.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  return Object.assign(seen, { settle: () => clock.settle() })
}
