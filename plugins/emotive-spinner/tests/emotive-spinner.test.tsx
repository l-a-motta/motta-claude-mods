import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { RenderPropsOf, TurnStepInput } from 'claude-code'

import { describeCall, mcpParts, Scanner, shortPath, spinnerWords, summarize, textOf } from '../hooks/register'

const line = (tool: string, input: Record<string, unknown>) => {
  const a = describeCall(tool, input)
  return `${a.icon} ${textOf(a)}${a.detail ? ` · ${a.detail}` : ''}`
}

describe('a call in words, by the shape of its input', () => {
  test('files: read, write with its size, edit with its lines', () => {
    expect(line('Read', { file_path: 'C:\\repo\\hooks\\register.tsx' })).toBe('📖 Reading hooks/register.tsx')
    expect(line('Read', { file_path: '/a/b/c.ts', offset: 120, limit: 100 })).toBe('📖 Reading b/c.ts · lines 120–219')
    expect(line('Write', { file_path: '/a/notes.md', content: 'one\ntwo\nthree' })).toBe('📝 Writing a/notes.md · 3 lines')
    expect(line('Write', { file_path: '/a/big.md', content: 'x'.repeat(4300) })).toBe('📝 Writing a/big.md · 1 line, 4.2 KB')
    expect(line('Edit', { file_path: '/a/b.ts', old_string: 'a\nb', new_string: 'a\nb\nc' })).toBe('✏️ Editing a/b.ts · −2 +3 lines')
  })

  test("commands say Claude's own description; git and gh get their own symbol", () => {
    expect(line('Bash', { command: 'npm ci', description: 'Install package dependencies' })).toBe('💻 Install package dependencies')
    expect(line('PowerShell', { command: 'Get-ChildItem' })).toBe('💻 Get-ChildItem')
    expect(line('Bash', { command: 'git commit -m x', description: 'Commit the mod' })).toBe('🌿 Commit the mod')
  })

  test('searches, the web, agents, questions and the plan', () => {
    expect(line('Grep', { pattern: 'Spinner', path: '/repo/plugins' })).toBe('🔍 Searching "Spinner" in repo/plugins')
    expect(line('Glob', { pattern: '**/*.tsx' })).toBe('🔍 Finding **/*.tsx')
    expect(line('WebSearch', { query: 'claude code mods' })).toBe('🔍 Searching the web for "claude code mods"')
    expect(line('WebFetch', { url: 'https://docs.anthropic.com/en/docs?x=1', prompt: 'read' })).toBe(
      '🌐 Fetching docs.anthropic.com/en/docs',
    )
    expect(line('Agent', { description: 'Explore codebase', prompt: 'go', subagent_type: 'Explore' })).toBe(
      '🤖 Explore codebase · Explore',
    )
    expect(line('AskUserQuestion', { questions: [] })).toBe('❓ Waiting for your answer')
    expect(
      line('TodoWrite', {
        todos: [
          { content: 'a', status: 'completed', activeForm: 'A' },
          { content: 'b', status: 'in_progress', activeForm: 'B' },
        ],
      }),
    ).toBe('📋 Updating the plan · 1/2 done')
  })

  test('a tool nobody knows yet still reads: MCP by server and action, the rest by name', () => {
    expect(line('mcp__slack__slack_send_message', { channel: 'x', text: 'hi' })).toBe('🔌 slack: send message')
    expect(line('mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__create', {})).toBe('🔌 Create')
    expect(mcpParts('mcp__plugin_desktop-commander_desktop-commander__read_file')).toEqual({
      server: 'desktop-commander',
      action: 'read file',
    })
    // An MCP tool with a path is file work, its server the detail.
    expect(line('mcp__plugin_desktop-commander_desktop-commander__read_file', { path: '/x/y.txt' })).toBe(
      '📖 Reading x/y.txt · desktop-commander',
    )
    expect(line('ScheduleWakeup', { delaySeconds: 60 })).toBe('🔧 Schedule wakeup')
    expect(line('FutureThing', { file_path: '/a/b.md' })).toBe('📖 Reading a/b.md')
  })

  test('short paths keep the last two parts', () => {
    expect(shortPath('C:\\Users\\me\\x\\y.ts')).toBe('x/y.ts')
    expect(shortPath('y.ts')).toBe('y.ts')
  })
})

test('calls at once: a count of a kind with their names, or the newest of a mix', () => {
  const read = (p: string) => describeCall('Read', { file_path: p })
  const three = summarize([read('/a/x.ts'), read('/a/y.ts'), read('/a/z.ts')])!
  expect(`${textOf(three)} · ${three.detail}`).toBe('Reading 3 files · a/x.ts, a/y.ts, a/z.ts')
  const agents = summarize([
    describeCall('Agent', { description: 'Explore codebase', prompt: 'p', subagent_type: 'Explore' }),
    describeCall('Agent', { description: 'Plan approach', prompt: 'p', subagent_type: 'Plan' }),
  ])!
  expect(`${agents.icon} ${textOf(agents)} · ${agents.detail}`).toBe('🤖 Running 2 agents · Explore codebase, Plan approach')
  // A mix shows the newest: the call the model wrote last.
  const mixed = summarize([read('/a/x.ts'), describeCall('Grep', { pattern: 'p' })])!
  expect(textOf(mixed)).toBe('Searching "p"')
})

test('the arguments read as they stream, in any pieces', () => {
  const json = JSON.stringify({ file_path: '/repo/hooks/register.tsx', content: 'a\nb\nc\n"quoted" {x: [1]}' })
  const s = new Scanner()
  for (let i = 0; i < json.length; i += 7) s.feed(json.slice(i, i + 7))
  expect(s.fields.file_path).toBe('/repo/hooks/register.tsx')
  expect(s.live()).toEqual({ key: 'content', lines: 4, bytes: 23 })

  const half = new Scanner()
  half.feed('{"file_path":"/repo/a.ts","content":"one\\ntwo\\nth')
  const a = describeCall('Write', half.fields, half.live())
  expect(`${a.icon} ${textOf(a)} · ${a.detail}`).toBe('📝 Writing repo/a.ts · 3 lines so far')

  // A key inside the content is not taken for one of the call's own.
  const nested = new Scanner()
  nested.feed('{"file_path":"/a.md","content":"{\\"command\\": \\"rm\\"}","limit":5}')
  expect(nested.fields.command).toBeUndefined()
  expect(nested.fields.limit).toBe(5)
})

test("the words fit the line, and the detail goes after the engine's ellipsis", () => {
  expect(spinnerWords({ icon: '📖', text: 'Reading a/b.ts', detail: 'lines 1–9' }, '…')).toEqual({
    word: '📖 Reading a/b.ts',
    suffix: '… · lines 1–9',
  })
  const narrow = spinnerWords({ icon: '📖', text: 'Reading a/very/long/path/that/goes/on.ts', detail: 'x'.repeat(30) }, '…', 60)
  expect(narrow.word.length).toBeLessThanOrEqual(24)
  expect(narrow.suffix).toBe('')
  // The desktop draws no suffix: the detail joins the words.
  expect(spinnerWords({ icon: '📖', text: 'Reading a/b.ts', detail: 'lines 1–9' }, '…', undefined, true)).toEqual({
    word: '📖 Reading a/b.ts · lines 1–9',
    suffix: '…',
  })
})

const SPINNER = (surface: 'terminal' | 'desktop', word = 'Sauteing') =>
  ({
    plugin: 'emotive-spinner',
    surface,
    component: 'Spinner',
    props: { word, message: null, suffix: '…', mode: 'requesting' } as RenderPropsOf['Spinner'],
  }) as const

// The engine beneath: its Spinner records the props it was handed.
function engine(on: Parameters<TestBody>[1]) {
  const seen: RenderPropsOf['Spinner'][] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    seen.push(e.props as RenderPropsOf['Spinner'])
    return { type: 'engine', ref: 1 } as never
  })
  on('turn.complete', () => ({ text: 'done' }))
  const last = () => {
    const p = seen[seen.length - 1]!
    return `${p.word}${p.suffix}`
  }
  return { seen, last }
}

const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a tool call names the line while it runs, then the line lets go (${surface})`, async ($, on) => {
    const { last } = engine(on)
    let during = ''
    let drawn = async () => {}
    on('tool.call', async () => {
      await drawn()
      during = last()
      return { result: 'ok', text: 'ok' } as never
    })
    const ui = await $.ui.mount(SPINNER(surface, surface === 'desktop' ? 'Working' : 'Sauteing'))
    drawn = async () => void (await ui.drawn())
    expect(last()).toBe('⏳ Waiting for the model…')
    await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/register.tsx', limit: 50 })
    expect(during).toBe(
      surface === 'desktop' ? '📖 Reading hooks/register.tsx · lines 1–50…' : '📖 Reading hooks/register.tsx… · lines 1–50',
    )
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await ui.redraw()
    expect(last()).toBe('⏳ Waiting for the model…')
    await ui.unmount()
  })

  test(`the response as it streams: thinking, a file being written, the answer (${surface})`, async ($, on) => {
    const { last } = engine(on)
    const frames: string[] = []
    let drawn = async () => {}
    on('turn.step', async function* () {
      const snap = async () => {
        await drawn()
        frames.push(last())
      }
      yield { kind: 'thinking', index: 0, text: 'hmm' }
      await snap()
      yield { kind: 'tool', index: 1, id: 'tu1', name: 'Write' }
      yield { kind: 'input', index: 1, json: '{"file_path":"/r/hooks/a.ts","content":"x\\ny\\n' }
      await snap()
      yield { kind: 'input', index: 1, json: 'z"}' }
      yield { kind: 'text', index: 2, text: 'Done.' }
      await snap()
      return { turnId: 't1', index: 0, answer: 'Done.', toolUses: [], stopReason: 'end_turn' } as never
    })
    const ui = await $.ui.mount(SPINNER(surface, 'Working'))
    drawn = async () => void (await ui.drawn())
    const stream = $.turn.step(STEP)
    for await (const _ of stream) {
      // Drained only.
    }
    await stream.result
    expect(frames[0]).toBe('💭 Thinking…')
    expect(frames[1]).toBe(
      surface === 'desktop' ? '📝 Writing hooks/a.ts · 3 lines so far…' : '📝 Writing hooks/a.ts… · 3 lines so far',
    )
    // The written call waits for the engine to run it; the answer streams beside it.
    expect(frames[2]).toMatch(/^📝 Writing hooks\/a\.ts|^💬 Writing the answer/)
    await ui.unmount()
  })
}

test("a state's own message is left alone", async ($, on) => {
  const { last } = engine(on)
  const ui = await $.ui.mount({ ...SPINNER('terminal'), props: { ...SPINNER('terminal').props, message: 'Compacting conversation' } })
  expect(last()).toBe('Sauteing…')
  await ui.unmount()
})

test('the desktop keeps its own words for a call when they say as much, with the emoji and the detail', async ($, on) => {
  const { last } = engine(on)
  const LONG = 'Creating the notes file for you'
  const during: string[] = []
  let act = async () => {}
  on('tool.call', async () => {
    await act()
    return { result: 'ok', text: 'ok' } as never
  })
  const props = { ...SPINNER('desktop').props, word: LONG, mode: 'tool-use' as const }
  const desk = await $.ui.mount({ ...SPINNER('desktop'), props })
  act = async () => {
    await desk.drawn()
    during.push(last())
    // A shorter row ("Creating") gives way to ours, which names the file.
    await desk.redraw({ ...props, word: 'Creating' })
    during.push(last())
  }
  expect(last()).toBe(`🔧 ${LONG}…`)
  await $.tool.call({ tool: 'Write', file_path: '/r/notes.md', content: 'a\nb' })
  expect(during).toEqual([`📝 ${LONG} · 2 lines…`, '📝 Writing r/notes.md · 2 lines…'])
  // The call is over: the row's words are the last call's, so the wait says ours.
  await desk.redraw({ ...props, word: LONG })
  expect(last()).toBe('⏳ Waiting for the model…')
  await desk.unmount()
})
