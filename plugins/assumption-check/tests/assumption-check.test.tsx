import { describe, expect, test } from 'claude-code/testing'

import { groupLabel, INSTRUCTION, ordered, parseAssumptions, parseSource } from '../hooks/register.tsx'
import { command, ENGINE_SECTION, LOGGED, PANE_PROPS, typed, world } from './world.tsx'

const START = { cwd: 'C:/repo', surface: 'terminal' as const, isInteractive: true }
const TOOL = 'mcp__assumption-check__note_assumption'
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] }
// Capture starts on unless the option says otherwise.
const OFF = { options: { startOn: false } }
const MOUNT = { plugin: 'assumption-check', component: 'Pane', props: PANE_PROPS, requestId: 'assumption-check' } as const

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

test('changes nothing Claude reads while capture is off', OFF, async ($, on) => {
  const { seen, appended } = world(on)
  await $.session.start(START)
  await $.prompt.submit(typed('add retry to fetch'))

  expect(await $.prompt.compose(COMPOSE)).toEqual({ sections: [ENGINE_SECTION] })
  expect(seen.tools).toEqual([])
  expect(seen.opened).toEqual([])
  expect(appended()).toBe(0)
})

test('/assumption-check on adds the tool and the instruction; cards open the pane once', OFF, async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  expect(seen.tools).toEqual(['note_assumption'])

  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections).toEqual([ENGINE_SECTION, { id: 'assumption-check:capture', text: INSTRUCTION, scope: 'session' }])

  await $.prompt.submit(typed('add retry to fetch'))
  const ran = await $.tool.call({ tool: TOOL, ...LOGGED })
  expect(ran.text ?? JSON.stringify(ran.result)).toContain('Logged A1, A2')
  await $.tool.call({ tool: TOOL, assumptions: [{ statement: 'Three retries', why: '', confidence: 'medium', category: 'tech', impact: '' }] })
  expect(seen.opened).toEqual(['assumption-check'])

  await $.command.run(command('off'))
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([ENGINE_SECTION])
  const described = await $.tool.describe({ tool: TOOL, description: 'Log assumptions', provider: { plugin: 'assumption-check', tier: 'user' } } as never)
  expect(described.description).toBe('Inactive: assumption-check is off. Do not call this tool.')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a card offers wrong, why? and delete, and only wrong and why? reach Claude (${surface})`, async ($, on) => {
    const { seen, appended } = world(on)
    await $.session.start(START)
    await $.command.run(command('on'))
    await $.prompt.submit(typed('add retry to fetch'))
    await $.tool.call({ tool: TOOL, ...LOGGED })

    const ui = await $.ui.mount({ ...MOUNT, surface })
    expect(await ui.find({ text: 'Low confidence' })).toBeDefined()
    // A1 is of low confidence, so it opens on arrival; a press folds it.
    expect(await ui.find({ key: 'wrong-A1' })).toBeDefined()
    await ui.press({ key: 'card-A1' })
    expect(await ui.find({ key: 'wrong-A1' })).toBeUndefined()

    await ui.press({ key: 'card-A1' })
    expect(await ui.find({ text: 'POST is not idempotent' })).toBeDefined()
    expect(await ui.find({ text: 'api/client.ts:42' })).toBeDefined()
    expect(await ui.find({ key: 'right-A1' })).toBeDefined()
    expect(await ui.find({ key: 'wrong-A1' })).toBeDefined()
    expect(await ui.find({ key: 'why-A1' })).toBeDefined()
    expect(await ui.find({ key: 'delete-A1' })).toBeDefined()

    // Delete: the card leaves the pane and Claude hears nothing.
    await ui.press({ key: 'delete-A1' })
    expect(await ui.find({ key: 'card-A1' })).toBeUndefined()
    expect(seen.submitted).toEqual(['add retry to fetch'])
    expect(appended()).toBe(0)

    // A2 is wrong, with the right assumption typed in: one prompt.
    await ui.press({ key: 'card-A2' })
    await ui.press({ key: 'wrong-A2' })
    await ui.input({ key: 'fix-A2', text: 'Use native fetch' })
    expect(seen.submitted.at(-1)).toBe(
      '[assumption-check] I marked assumption A2 "Use axios" as wrong. The right assumption: Use native fetch\nList what you did so far that relied on it, then fix that work to fit the right one.',
    )
    expect(await ui.find({ key: 'wrong-A2' })).toBeUndefined()
    expect(await ui.find({ text: '→ Use native fetch' })).toBeDefined()

    // Delete it too: the prompt's dropdown goes with its last card.
    await ui.press({ key: 'delete-A2' })
    expect(await ui.find({ key: 'toggle-P1' })).toBeUndefined()
    expect(await ui.find({ text: 'No assumptions yet.' })).toBeDefined()
    expect(await ui.find({ text: 'To check' })).toBeUndefined()
    expect(appended()).toBe(0)

    // A card logged after the deletes takes a new id, never A1 or A2 again.
    const ran = await $.tool.call({ tool: TOOL, assumptions: [{ statement: 'Three retries', why: '', confidence: 'medium', category: 'tech', impact: '' }] })
    expect(ran.text ?? JSON.stringify(ran.result)).toContain('Logged A3')
    expect(await ui.find({ key: 'card-A3' })).toBeDefined()
    await ui.unmount()
  })
}

test('an empty correction lets Claude ask, and "why?" asks for the reasoning', async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })

  await ui.press({ key: 'why-A1' })
  expect(seen.submitted.at(-1)).toContain('Why did you assume A1 "Retries apply to GET requests only"?')

  await ui.press({ key: 'wrong-A1' })
  await ui.input({ key: 'fix-A1', text: '  ' })
  expect(seen.submitted.at(-1)).toContain('Ask me what is incorrect about it and what the right assumption is.')
  await ui.unmount()
})

test('right and all right confirm cards, and Claude hears of neither', async ($, on) => {
  const { seen, appended } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })

  await ui.press({ key: 'right-A1' })
  expect(await ui.find({ key: 'right-A1' })).toBeUndefined()
  expect(await ui.find({ key: 'undo-A1' })).toBeDefined()
  await ui.press({ key: 'undo-A1' })
  expect(await ui.find({ key: 'right-A1' })).toBeDefined()

  await ui.press({ key: 'all-right-P1' })
  expect(await ui.find({ key: 'all-right-P1' })).toBeUndefined()
  expect(await ui.find({ text: '· all checked' })).toBeDefined()
  expect(seen.submitted).toEqual(['add retry'])
  expect(appended()).toBe(0)
  await ui.unmount()
})

test('a count box filters the cards to its own, and pressed again shows them all', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  await $.prompt.submit(typed('second prompt'))
  await $.tool.call({ tool: TOOL, assumptions: [{ statement: 'Node 22', why: '', confidence: 'high', category: 'environment', impact: '' }] })
  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })

  await ui.press({ key: 'filter-low' })
  expect(await ui.find({ key: 'card-A1' })).toBeDefined()
  expect(await ui.find({ key: 'card-A2' })).toBeUndefined()
  expect(await ui.find({ key: 'toggle-P2' })).toBeUndefined()

  // "all right" under a filter confirms only the cards it shows.
  await ui.press({ key: 'all-right-P1' })
  await ui.press({ key: 'filter-open' })
  expect(await ui.find({ key: 'card-A1' })).toBeUndefined()
  expect(await ui.find({ key: 'card-A2' })).toBeDefined()
  await ui.press({ key: 'filter-open' })

  await ui.press({ key: 'filter-confirmed' })
  expect(await ui.find({ key: 'card-A1' })).toBeDefined()
  await ui.press({ key: 'filter-confirmed' })
  await ui.press({ key: 'filter-marked' })
  expect(await ui.find({ text: 'None here. Press the box again to show every card.' })).toBeDefined()
  await ui.press({ key: 'filter-marked' })
  // P1 was folded when P2 came; with the filter off it is folded again.
  expect(await ui.find({ key: 'card-A3' })).toBeDefined()
  expect(await ui.find({ key: 'card-A1' })).toBeUndefined()
  await ui.unmount()
})

test('a low-confidence card opens on arrival, unless a correction is being typed', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  const low = { statement: 'No auth needed', why: '', confidence: 'low', category: 'scope', impact: '' }

  await ui.press({ key: 'card-A2' })
  await $.tool.call({ tool: TOOL, assumptions: [low] })
  expect(await ui.find({ key: 'right-A3' })).toBeDefined()

  await ui.press({ key: 'card-A2' })
  await ui.press({ key: 'wrong-A2' })
  await $.tool.call({ tool: TOOL, assumptions: [low] })
  expect(await ui.find({ key: 'fix-A2' })).toBeDefined()
  expect(await ui.find({ key: 'right-A4' })).toBeUndefined()
  await ui.unmount()
})

test('open cards of low confidence come first, the rest in the order they came', () => {
  const card = (id: string, confidence: 'low' | 'medium' | 'high', status: 'open' | 'confirmed' = 'open') =>
    ({ id, group: 'P1', statement: id, why: '', confidence, category: 'other' as const, impact: '', status })
  const list = [card('A1', 'high'), card('A2', 'low', 'confirmed'), card('A3', 'medium'), card('A4', 'low')]
  expect(ordered(list).map(c => c.id)).toEqual(['A4', 'A1', 'A2', 'A3'])
})

test('a source reads as path and line, a drive letter kept', () => {
  expect(parseSource('api/client.ts:42')).toEqual({ path: 'api/client.ts', line: 42 })
  expect(parseSource('C:\\repo\\a.ts:7:3')).toEqual({ path: 'C:\\repo\\a.ts', line: 7 })
  expect(parseSource('src/x.ts:10-20')).toEqual({ path: 'src/x.ts', line: 10 })
  expect(parseSource('README.md')).toEqual({ path: 'README.md' })
})

test('pressing a source opens it in VS Code at its line, and says so when it cannot', async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })

  await ui.press({ key: 'source-A1' })
  expect(seen.ran.at(-1)).toEqual(['code', '-g', 'C:/repo/api/client.ts:42'])
  expect(seen.toasts).toEqual([])

  seen.failRuns = true
  await ui.press({ key: 'source-A1' })
  expect(seen.ran.at(-1)).toEqual(['rundll32', 'url.dll,FileProtocolHandler', 'vscode://file/C:/repo/api/client.ts:42'])
  expect(seen.toasts).toEqual(["Couldn't open api/client.ts:42 in VS Code."])
  await ui.unmount()
})

test('a low-confidence card toasts only while the pane is not shown', async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))
  // The first cards open the pane, so they need no toast.
  await $.tool.call({ tool: TOOL, ...LOGGED })
  expect(seen.toasts).toEqual([])

  const low = { statement: 'No auth needed', why: '', confidence: 'low', category: 'scope', impact: '' }
  seen.paneShown = true
  await $.tool.call({ tool: TOOL, assumptions: [low] })
  expect(seen.toasts).toEqual([])

  seen.paneShown = false
  await $.tool.call({ tool: TOOL, assumptions: [{ ...low, confidence: 'high' }] })
  expect(seen.toasts).toEqual([])
  await $.tool.call({ tool: TOOL, assumptions: [low] })
  expect(seen.toasts).toEqual(['Low-confidence assumption A5 "No auth needed". Run /assumption-check to review it.'])
})

test("leaves a subagent's and a teammate's assumptions out", async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))

  const ran = await $.tool.call({ tool: TOOL, agentId: 'a1', ...LOGGED } as never)
  expect(ran.text ?? JSON.stringify(ran.result)).toContain('main session only')
  expect(seen.opened).toEqual([])
  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  expect(await ui.find({ key: 'card-A1' })).toBeUndefined()
  await ui.unmount()

  const teammate = await $.prompt.compose({ ...COMPOSE, surfaces: [], traits: ['teammate'] })
  expect(teammate.sections).toEqual([ENGINE_SECTION])
})

test('a call while capture is off logs no card and opens no pane, before it was on and after', OFF, async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  await $.prompt.submit(typed('add retry to fetch'))

  const never = await $.tool.call({ tool: TOOL, ...LOGGED })
  expect(never.text ?? JSON.stringify(never.result)).toContain('assumption-check is off; nothing was logged')

  await $.command.run(command('on'))
  await $.command.run(command('off'))
  const after = await $.tool.call({ tool: TOOL, ...LOGGED })
  expect(after.text ?? JSON.stringify(after.result)).toContain('assumption-check is off; nothing was logged')

  expect(seen.opened).toEqual([])
  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  expect(await ui.find({ key: 'card-A1' })).toBeUndefined()
  expect(await ui.find({ text: 'Capture is off, so Claude works as without this mod.' })).toBeDefined()
  await ui.unmount()
})

test('a call with no assumption in it is refused', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry'))

  const ran = await $.tool.call({ tool: TOOL, assumptions: [{ why: 'no statement' }] } as never)
  expect('deny' in ran ? ran.deny : ran.text).toContain('No assumption to log')
})

test('each prompt gets its own dropdown, the newest open, and a task notification adds none', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.command.run(command('on'))
  await $.prompt.submit(typed('add retry to fetch'))
  await $.tool.call({ tool: TOOL, ...LOGGED })
  await $.prompt.submit(typed('now write the tests'))
  await $.prompt.submit({ text: 'Task finished', wait: false, origin: { kind: 'task-notification' as const } })
  const ran = await $.tool.call({ tool: TOOL, assumptions: [{ statement: 'Tests use vitest', why: '', confidence: 'medium', category: 'tech', impact: '' }] })
  expect(ran.text ?? JSON.stringify(ran.result)).toContain('Logged A3')

  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  expect(await ui.find({ key: 'toggle-P2' })).toBeDefined()
  expect(await ui.find({ key: 'toggle-P3' })).toBeUndefined()
  expect(await ui.find({ key: 'card-A3' })).toBeDefined()
  expect(await ui.find({ key: 'card-A1' })).toBeUndefined()

  await ui.press({ key: 'toggle-P1' })
  expect(await ui.find({ key: 'card-A1' })).toBeDefined()
  await ui.unmount()
})

test('capture is on from the session start when the startOn option is unset', async ($, on) => {
  const { seen } = world(on)
  await $.session.start(START)
  expect(seen.tools).toEqual(['note_assumption'])
  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)).toEqual({ id: 'assumption-check:capture', text: INSTRUCTION, scope: 'session' })
})
