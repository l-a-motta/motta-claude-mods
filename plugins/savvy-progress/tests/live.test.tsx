import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { lastPhrase, toolLine } from '../hooks/register.tsx'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// The engine beneath: a clock, spawns under their own ids, a model that streams
// `words` as its text (a `✻`-prefixed word as thinking), and tools that answer,
// Bash with an error.
function engine(on: On, words: string[] = []) {
  const clock = mock.clock(on)
  let n = 0
  on('agent.spawn', async () => ({ agentId: `a${++n}`, model: 'claude-haiku-5-5' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('turn.step', async function* () {
    for (const [i, w] of words.entries()) {
      const isThinking = w.startsWith('✻')
      yield { kind: isThinking ? 'thinking' : 'text', index: 0, ref: i, text: isThinking ? w.slice(1) : w } as never
    }
    return { answer: words.filter(w => !w.startsWith('✻')).join(''), toolUses: [] } as never
  })
  on('tool.call', async ($, e) => (e.tool === 'Bash' ? { result: 'exit 1', text: 'exit 1', isError: true } : { result: 'ok' }) as never)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('tool.register', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: {} }) as never)
  return clock
}

const spawn = ($: $) =>
  $.agent.spawn({
    prompt: 'look',
    description: 'Look around',
    subagentType: 'Explore',
    tool_use_id: 't1',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

const step = async ($: $, agentId?: string) => {
  const stream = $.turn.step({ agentId, model: 'claude-haiku-5-5' } as never)
  for await (const _ of stream) void _
}

const pane = ($: $, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 100 } } as never)

describe('lastPhrase', () => {
  test('is the sentence being written', () => {
    expect(lastPhrase('I read the file. Now checking the tests for')).toBe('Now checking the tests for')
  })

  test('keeps the finished sentence while the next is a few words', () => {
    expect(lastPhrase('Found the bug in the parser. It')).toBe('Found the bug in the parser. It')
  })

  test('drops list marks and markdown', () => {
    expect(lastPhrase('Plan:\n- **Read** `register.tsx`')).toBe('Read register.tsx')
  })
})

describe('toolLine', () => {
  test('names the file a path points at', () => {
    expect(toolLine('Read', { file_path: 'C:\\repo\\hooks\\register.tsx' })).toBe('→ Read register.tsx')
  })

  test("a command's first line, and an MCP tool by its own name", () => {
    expect(toolLine('Bash', { command: 'npm test\necho done' })).toBe('→ Bash npm test')
    expect(toolLine('mcp__github__get_issue', {})).toBe('→ get_issue')
  })
})

// What a drawing reads as: its texts run together, an SVG's tags dropped.
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; props?: { source?: string }; children?: unknown[] }
  if (n.type === 'Svg') return (n.props?.source ?? '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  return (n.children ?? []).map(textOf).join('')
}

// The pane on both surfaces, and whether each now says `text`: the terminal in its
// text rows, the desktop in its rows' alt.
async function panes($: $) {
  const drawings = { terminal: await pane($, 'terminal'), desktop: await pane($, 'desktop') }
  return async (surface: 'terminal' | 'desktop', text: RegExp) => {
    const d = drawings[surface]
    await d.redraw()
    return text.test(textOf(await d.drawn()))
  }
}

const EN = { options: { language: 'en' } }
const START = { cwd: '.', surface: null, isInteractive: true }

test("a subagent's text and tool calls reach its row on the next tick", EN, async ($, on) => {
  const clock = engine(on, ['I looked at the config. ', 'Next I will run the tests'])
  await $.session.start(START)
  await spawn($)
  const says = await panes($)
  await step($, 'a1')
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /Next I will run/)).toBe(false)
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /Next I will run the tests/)).toBe(true)

  await $.tool.call({ tool: 'Bash', agentId: 'a1', command: 'npm test' } as never)
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, / 1 tool(?!s)/)).toBe(true)
  await $.tool.call({ tool: 'Read', agentId: 'a1', file_path: '/x/README.md' } as never)
  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a1', done: 1 } as never)
  await $.tool.call({ tool: 'Read', file_path: '/x/main-loop.md' } as never)
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await says(surface, /→ Read README\.md/)).toBe(true)
    expect(await says(surface, /2 tools/)).toBe(true)
  }
})

test("the main conversation's text and calls are left alone", EN, async ($, on) => {
  const clock = engine(on, ['Main loop talking.'])
  await $.session.start(START)
  await spawn($)
  const says = await panes($)
  await step($)
  await $.tool.call({ tool: 'Read', file_path: '/x/a.md' } as never)
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /Main loop|a\.md|tools/)).toBe(false)
})

test('thinking shows until the request writes text', EN, async ($, on) => {
  const clock = engine(on, ['✻Weighing which file to open first'])
  await $.session.start(START)
  await spawn($)
  const says = await panes($)
  await step($, 'a1')
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /✻ Weighing which file/)).toBe(true)
})

test('text written after thinking takes its place', EN, async ($, on) => {
  const clock = engine(on, ['✻Weighing which file to open first', 'Opening the config now'])
  await $.session.start(START)
  await spawn($)
  const says = await panes($)
  await step($, 'a1')
  await clock.advance(1_000)
  expect(await says('terminal', /Opening the config now/)).toBe(true)
  expect(await says('terminal', /Weighing/)).toBe(false)
})

test('a finished call is marked ✓, a failed one ✗', EN, async ($, on) => {
  const clock = engine(on)
  await $.session.start(START)
  await spawn($)
  const says = await panes($)
  await $.tool.call({ tool: 'Read', agentId: 'a1', file_path: '/x/README.md' } as never)
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /→ Read README\.md ✓/)).toBe(true)
  await $.tool.call({ tool: 'Bash', agentId: 'a1', command: 'npm test' } as never)
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /→ Bash npm test ✗/)).toBe(true)
})

test('an agent streaming no text is still active: no quiet warning', EN, async ($, on) => {
  const clock = engine(on)
  await $.session.start(START)
  await spawn($)
  const says = await panes($)
  for (let i = 0; i < 5; i++) {
    await clock.advance(10_000)
    await step($, 'a1')
  }
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /quiet/)).toBe(false)
  await clock.advance(50_000)
  for (const surface of ['terminal', 'desktop'] as const) expect(await says(surface, /quiet 0:5\d/)).toBe(true)
})
