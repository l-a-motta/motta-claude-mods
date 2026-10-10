import { describe, expect, test } from 'claude-code/testing'

import { groupLabel, INSTRUCTION, parseAssumptions, toMarkdown } from '../hooks/register.tsx'
import { command, ENGINE_SECTION, LOGGED, PANE_PROPS, SUMMARY, typed, world } from './world.tsx'

const START = { cwd: 'C:/repo', surface: 'terminal' as const, isInteractive: true }
const TOOL = 'mcp__assumption-check__note_assumption'

describe('parseAssumptions', () => {
  test('keeps what a card holds and fills an unknown confidence or category', () => {
    const [first, second] = parseAssumptions({
      assumptions: [
        { statement: ' GET only ', why: 'idempotent', confidence: 'low', category: 'scope', impact: 'x', extra: 1 },
        { statement: 'axios', confidence: 'sure', category: 'library' },
      ],
    })
    expect(first).toEqual({ statement: 'GET only', why: 'idempotent', confidence: 'low', category: 'scope', impact: 'x' })
    expect(second).toEqual({ statement: 'axios', why: '', confidence: 'medium', category: 'other', impact: '' })
  })

  test('drops entries with no statement and input with no list', () => {
    expect(parseAssumptions({ assumptions: [{ why: 'no statement' }] })).toEqual([])
    expect(parseAssumptions({})).toEqual([])
    expect(parseAssumptions(null)).toEqual([])
  })
})

describe('groupLabel', () => {
  test("takes the prompt's first line, cut to 60, without the mod's tag", () => {
    expect(groupLabel('add retry to fetch\nand tests')).toBe('add retry to fetch')
    expect(groupLabel('[assumption-check] Why did you assume A1?')).toBe('Why did you assume A1?')
    expect(groupLabel('x'.repeat(80))).toHaveLength(60)
  })
})

describe('toMarkdown', () => {
  test('lists each prompt with its cards, marks and details', () => {
    const md = toMarkdown(
      [{ id: 'P1', label: 'add retry' }],
      [
        { id: 'A1', group: 'P1', statement: 'GET only', why: 'idempotent', confidence: 'low', category: 'scope', impact: 'x', status: 'reinforced' },
        { id: 'A2', group: 'P1', statement: 'axios', why: '', confidence: 'high', category: 'tech', impact: '', status: 'corrected', correction: 'native fetch' },
      ],
    )
    expect(md).toContain('## P1 · add retry')
    expect(md).toContain('- ✓ **A1** GET only _(reinforced, low confidence, scope)_')
    expect(md).toContain('  - correction: native fetch')
  })
})

test('changes nothing Claude reads while capture is off', async ($, on) => {
  const { seen, notes, notices } = world(on)
  await $.session.start(START)
  await $.prompt.submit(typed('add retry to fetch'))

  expect(await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })).toEqual({
    sections: [ENGINE_SECTION],
  })
  expect(seen.tools).toEqual([])
  expect(seen.opened).toEqual([])
  expect(notes()).toEqual([])
  expect(notices()).toEqual([])
})

test('/assumption-check on adds the tool and the instruction; cards open the pane once', async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  expect(seen.tools).toEqual(['note_assumption'])

  const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections).toEqual([ENGINE_SECTION, { id: 'assumption-check:capture', text: INSTRUCTION, scope: 'session' }])

  await $.prompt.submit(typed('add retry to fetch'))
  const ran = await $.tool.call({ tool: TOOL, ...LOGGED })
  expect(ran.text ?? JSON.stringify(ran.result)).toContain('Logged A1, A2')
  await $.tool.call({ tool: TOOL, assumptions: [{ statement: 'Three retries', why: '', confidence: 'medium', category: 'tech', impact: '' }] })
  expect(seen.opened).toEqual(['assumption-check'])

  await $.command.run(command('off'))
  const off = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(off.sections).toEqual([ENGINE_SECTION])
  const described = await $.tool.describe({ tool: TOOL, description: 'Log assumptions', provider: { plugin: 'assumption-check', tier: 'user' } } as never)
  expect(described.description).toBe('Inactive: assumption-check is off. Do not call this tool.')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws a dropdown per prompt and turns each mark into a note or a prompt (${surface})`, async ($, on) => {
    const { seen, notes, notices } = world(on)
    await $.session.start(START)
    await $.command.run(command('on'))
    await $.prompt.submit(typed('add retry to fetch'))
    await $.tool.call({ tool: TOOL, ...LOGGED })

    const ui = await $.ui.mount({ plugin: 'assumption-check', surface, component: 'Pane', props: PANE_PROPS, requestId: 'assumption-check' })
    expect(await ui.find({ key: 'toggle-P1' })).toBeDefined()
    expect(await ui.find({ key: 'card-A1' })).toBeDefined()
    expect(await ui.find({ key: 'reinforce-A1' })).toBeUndefined()

    // Reinforce A1: a note Claude reads, no turn.
    await ui.press({ key: 'card-A1' })
    expect(await ui.find({ text: 'why: POST is not idempotent' })).toBeDefined()
    expect(await ui.find({ text: 'source: api/client.ts:42' })).toBeDefined()
    await ui.press({ key: 'reinforce-A1' })
    expect(notes()).toEqual(['[assumption-check] The user confirmed assumption A1 "Retries apply to GET requests only". Treat it as settled and keep relying on it.'])
    expect(seen.submitted).toEqual(['add retry to fetch'])
    expect(notices()).toEqual(['assumption-check: you confirmed A1'])

    // Undo it: a note taking it back.
    await ui.press({ key: 'undo-A1' })
    expect(notes()[1]).toContain('withdrew their confirmation of assumption A1')

    // A2 is wrong, with the right assumption typed in: one prompt.
    await ui.press({ key: 'card-A2' })
    await ui.press({ key: 'wrong-A2' })
    await ui.input({ key: 'fix-A2', text: 'Use native fetch' })
    expect(seen.submitted.at(-1)).toBe(
      '[assumption-check] I marked assumption A2 "Use axios" as wrong. The right assumption: Use native fetch\nList what you did so far that relied on it, then fix that work to fit the right one.',
    )

    // The pinned view lists only what is confirmed: nothing, after the undo.
    await ui.press({ key: 'view' })
    expect(await ui.find({ text: 'Nothing confirmed yet' })).toBeDefined()
    await ui.unmount()
  })
}

test('an empty correction lets Claude ask, and "why?" asks for the reasoning', async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  const ui = await $.ui.mount({ plugin: 'assumption-check', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'assumption-check' })

  await ui.press({ key: 'card-A1' })
  await ui.press({ key: 'why-A1' })
  expect(seen.submitted.at(-1)).toContain('Why did you assume A1 "Retries apply to GET requests only"?')

  await ui.press({ key: 'wrong-A1' })
  await ui.input({ key: 'fix-A1', text: '  ' })
  expect(seen.submitted.at(-1)).toContain('Ask me what is incorrect about it and what the right assumption is.')
  await ui.unmount()
})

test("leaves a subagent's and a teammate's assumptions out", async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))

  const ran = await $.tool.call({ tool: TOOL, agentId: 'a1', ...LOGGED } as never)
  expect(ran.text ?? JSON.stringify(ran.result)).toContain('main session only')
  expect(seen.opened).toEqual([])
  const ui = await $.ui.mount({ plugin: 'assumption-check', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'assumption-check' })
  expect(await ui.find({ key: 'card-A1' })).toBeUndefined()
  await ui.unmount()

  const teammate = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: ['teammate'] })
  expect(teammate.sections).toEqual([ENGINE_SECTION])
})

test('says the confirmed assumptions again after a compaction', async ($, on) => {
  const { notes } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  const ui = await $.ui.mount({ plugin: 'assumption-check', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'assumption-check' })
  await ui.press({ key: 'all-P1' })
  await ui.unmount()

  await $.session.compact({ trigger: 'auto', messages: [SUMMARY] })
  expect(notes().at(-1)).toBe(
    '[assumption-check] Assumptions the user confirmed earlier in this session, kept across the compaction. Keep relying on them:\n- A1 "Retries apply to GET requests only"\n- A2 "Use axios"',
  )
})

test('/assumption-check export writes the cards as markdown under ~/.claude', async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('export'))
  expect(seen.written.map(path => path.replaceAll('\\', '/'))).toEqual(['C:/Users/me/.claude/assumption-check/1970-01-01-01234567.md'])
})
