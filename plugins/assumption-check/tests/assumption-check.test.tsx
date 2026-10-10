import { describe, expect, test } from 'claude-code/testing'

import { groupLabel, INSTRUCTION, parseAssumptions } from '../hooks/register.tsx'
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
    expect(await ui.find({ key: 'card-A1' })).toBeDefined()
    expect(await ui.find({ key: 'wrong-A1' })).toBeUndefined()

    await ui.press({ key: 'card-A1' })
    expect(await ui.find({ text: 'why: POST is not idempotent' })).toBeDefined()
    expect(await ui.find({ text: 'source: api/client.ts:42' })).toBeDefined()
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
