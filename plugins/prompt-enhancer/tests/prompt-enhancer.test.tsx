import { describe, expect, test } from 'claude-code/testing'

import { BUDGET, CLEAN_RULES, cleanPrompt, countNodes, enhancerPane, excerpt, expandPrompt, fit, formatUsage, missingTokens, protectedTokens, TOP_LEVEL } from '../hooks/register.tsx'
import type { PaneView } from '../hooks/register.tsx'
import { BAND, CLEANED, command, DRAFT, EXPANDED, PANE, START, world } from './world.tsx'

type Node = { type?: string; props?: { key?: string; flexDirection?: string }; children?: Node[] }

// A drawn tree as text: a card line's pieces are nested Text, so each Text
// joins its children into one line, and the lines go one per row.
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : n !== null && typeof n === 'object' ? ((n as Node).type === 'Text' ? textOf((n as Node).children ?? []) : ((n as Node).children ?? []).map(textOf).join('\n')) : ''

describe('protectedTokens', () => {
  test('finds @mentions, /commands and code, not emails or path segments', () => {
    expect(protectedTokens('see @src/a.ts, run /review and `pnpm test`; mail me@x.com about src/b.ts')).toEqual([
      '@src/a.ts',
      '/review',
      '`pnpm test`',
    ])
  })

  test('names the ones a result changed or dropped; backticks may go', () => {
    expect(missingTokens('fix @a.ts with `pnpm test`', 'Fix the file a.ts, then run pnpm test.')).toEqual(['@a.ts'])
  })
})

describe('excerpt', () => {
  test('keeps the text of each message, without tool calls or reminders', () => {
    const text = excerpt([
      { role: 'user', content: [{ type: 'text', text: 'hi <system-reminder>secret</system-reminder>' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ])
    expect(text).toBe('Me: hi\n\nClaude: hello')
  })

  test('keeps the last twelve messages', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: [{ type: 'text', text: `m${i}` }] }))
    expect(excerpt(many).split('\n\n')).toHaveLength(12)
    expect(excerpt(many).startsWith('Me: m8')).toBe(true)
  })
})

test('formatUsage counts the cached part of the input', () => {
  expect(formatUsage({ input: 14_200, output: 610, cached: 13_900 })).toBe('in 14.2k (13.9k cached) · out 610')
  expect(formatUsage({ input: 900, output: 40, cached: 0 })).toBe('in 900 · out 40')
})

test('Cleaned up fixes only typos, fillers, voice-to-text artifacts and punctuation', () => {
  expect(CLEAN_RULES).toContain('"uh", "um", "ah"')
  expect(CLEAN_RULES).toContain('Leave every other word exactly as written: the wording, the language, the order and the structure.')
  expect(cleanPrompt(DRAFT)).toBe(`<text>\n${DRAFT}\n</text>`)
})

test('Expanded asks for the shortest prompt and carries the conversation', () => {
  expect(expandPrompt(DRAFT, { kind: 'none' })).toContain(`<draft>\n${DRAFT}\n</draft>`)
  expect(expandPrompt(DRAFT, { kind: 'none' })).toContain('the shortest prompt that keeps everything that matters')
  expect(expandPrompt(DRAFT, { kind: 'fork' })).toContain('Our conversation so far is above')
  expect(expandPrompt(DRAFT, { kind: 'excerpt', text: 'Me: hi' })).toContain('<conversation>\nMe: hi\n</conversation>')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the chip opens the pane with both ways, and Cleaned up is one cheap call with no conversation (${surface})`, async ($, on) => {
    const seen = world(on, { box: DRAFT, replies: [CLEANED] })
    await $.session.start(START)
    const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface, component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ ...PANE, surface })

    await band.press({ key: 'enhance' })
    expect(seen.opened).toEqual(['prompt-enhancer'])
    expect(await pane.find({ text: DRAFT })).toBeDefined()
    expect(await pane.find({ key: 'clean' })).toBeDefined()
    expect(await pane.find({ key: 'expand' })).toBeDefined()
    expect(seen.completed).toEqual([])
    expect(seen.forked).toEqual([])

    await pane.press({ key: 'clean' })
    expect(seen.forked).toEqual([])
    expect(seen.completed).toEqual([{ model: 'haiku', prompt: `<text>\n${DRAFT}\n</text>`, system: CLEAN_RULES, effort: 'low' }])
    expect(await pane.find({ text: CLEANED })).toBeDefined()
    expect(await pane.find({ text: 'Before' })).toBeDefined()
    expect(await pane.find({ text: /✦ Cleaned up/, type: 'Text' })).toBeDefined()
    // The band keeps the chip alone the whole time.
    expect(await band.find({ key: 'enhance' })).toBeDefined()
    expect(await band.find({ key: 'use' })).toBeUndefined()

    await pane.press({ key: 'use' })
    expect(seen.filled.at(-1)).toBe(CLEANED)
    expect(seen.closed).toEqual(['prompt-enhancer'])
  })

  test(`Expanded is one call on the conversation's fork (${surface})`, async ($, on) => {
    const seen = world(on, { box: DRAFT, replies: [EXPANDED] })
    await $.session.start(START)
    const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface, component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ ...PANE, surface })

    await band.press({ key: 'enhance' })
    await pane.press({ key: 'expand' })
    expect(seen.completed).toEqual([])
    expect(seen.forked).toHaveLength(1)
    expect(seen.forked[0]).toContain(`<draft>\n${DRAFT}\n</draft>`)
    expect(seen.forked[0]).toContain('Our conversation so far is above')
    expect(await pane.find({ text: EXPANDED })).toBeDefined()
    expect(await pane.find({ text: /session model · in 1\.2k \(1\.0k cached\) · out 300/ })).toBeDefined()
  })
}

test('the cheap model is an option', { options: { cleanModel: 'claude-haiku-5-5' } }, async ($, on) => {
  const seen = world(on, { replies: [CLEANED] })
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run(command(DRAFT))
  await pane.press({ key: 'clean' })
  expect(seen.completed.map(c => c.model)).toEqual(['claude-haiku-5-5'])
})

test('Copy copies, Send sends and clears the box, Cancel closes the pane', async ($, on) => {
  const seen = world(on, { box: DRAFT, replies: [CLEANED] })
  await $.session.start(START)
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await band.press({ key: 'enhance' })
  await pane.press({ key: 'cancel' })
  expect(seen.closed).toEqual(['prompt-enhancer'])
  expect(await pane.find({ key: 'clean' })).toBeUndefined()

  await band.press({ key: 'enhance' })
  await pane.press({ key: 'clean' })
  await pane.press({ key: 'copy' })
  expect(seen.copied).toEqual([CLEANED])
  await pane.press({ key: 'send' })
  expect(seen.filled.at(-1)).toBe('')
  expect(seen.submitted).toEqual([CLEANED])
  expect(seen.closed).toEqual(['prompt-enhancer', 'prompt-enhancer'])
})

// The engine's own `no_composer` cannot be raised from a test: a hook's
// refusal reaches the plugin without its cause, which the mod reads as
// unknown, so the chip stays. /enhance works either way.
test('an empty box, or a refusal of unknown cause, keeps the chip; /enhance still works', async ($, on) => {
  const seen = world(on, { hasComposer: false, replies: [CLEANED] })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await band.press({ key: 'enhance' })
  expect(seen.toasts.at(-1)).toBe('Write a prompt in the box first, then press ✦ enhance.')
  expect(await band.find({ key: 'enhance' })).toBeDefined()
  expect(seen.opened).toEqual([])

  const ran = await $.command.run(command(DRAFT))
  expect(ran.text).toContain('Pick Cleaned up or Expanded in the Enhance pane')
  await pane.press({ key: 'clean' })
  await pane.press({ key: 'use' })
  expect(seen.toasts.at(-1)).toBe('The box did not take the text. Use Send or Copy.')
  expect(await pane.find({ key: 'send' })).toBeDefined()
})

test('/enhance with nothing after it says how to use it', async ($, on) => {
  world(on)
  await $.session.start(START)
  expect((await $.command.run(command('  '))).text).toContain('/enhance fix the flaky checkout test')
})

test('a named Expanded model gets the conversation as an excerpt', { options: { model: 'sonnet', effort: 'low' } }, async ($, on) => {
  const seen = world(on, { replies: [EXPANDED] })
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run(command(DRAFT))
  await pane.press({ key: 'expand' })
  expect(seen.forked).toEqual([])
  expect(seen.completed.map(c => [c.model, c.effort])).toEqual([['sonnet', 'low']])
  expect(seen.completed[0]?.prompt).toContain('<conversation>\nMe: why is checkout slow?\n\nClaude: The cart loads every item.\n</conversation>')
})

test('with no conversation to fork yet, Expanded falls back to Sonnet', async ($, on) => {
  const seen = world(on, { canFork: false, replies: [EXPANDED] })
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run(command(DRAFT))
  await pane.press({ key: 'expand' })
  expect(seen.completed.map(c => c.model)).toEqual(['sonnet'])
  expect(seen.completed[0]?.prompt).not.toContain('<conversation>')
})

test('a failed call shows why, and Retry runs the same option again', async ($, on) => {
  const seen = world(on, { box: DRAFT, replies: ['fail', CLEANED] })
  await $.session.start(START)
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await band.press({ key: 'enhance' })
  await pane.press({ key: 'clean' })
  expect(await pane.find({ text: /Could not enhance: the API answered 529 \(overloaded\)/ })).toBeDefined()
  expect(textOf(await pane.drawn())).toContain('On haiku · a new model call')
  await pane.press({ key: 'retry-failed' })
  expect(seen.completed.map(c => c.model)).toEqual(['haiku', 'haiku'])
  expect(await pane.find({ text: CLEANED })).toBeDefined()
})

test('the result names a mention it dropped', async ($, on) => {
  world(on, { box: DRAFT, replies: ['Fix the checkout test.'] })
  await $.session.start(START)
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await band.press({ key: 'enhance' })
  await pane.press({ key: 'clean' })
  expect(await pane.find({ text: /Changed or dropped: @tests\/checkout\.spec\.ts/ })).toBeDefined()
})

for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
  test(`each button and the result carry a hover card, none on a phone (${surface})`, async ($, on) => {
    world(on, { box: DRAFT, replies: ['Fix the checkout test.'] })
    await $.session.start(START)
    const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ ...PANE, surface })
    const drawn = async () => textOf(await pane.drawn())
    const has = surface !== 'mobile'

    await band.press({ key: 'enhance' })
    expect(await pane.find({ key: 'tip:clean' })).toBeDefined()
    expect(await pane.find({ key: 'clean' })).toBeDefined()
    expect((await drawn()).includes('haiku · effort low · no conversation')).toBe(has)
    expect((await drawn()).includes('Session model: a fork of this conversation')).toBe(has)
    expect((await drawn()).includes('Your draft stays in the prompt box')).toBe(has)
    // The hotkey is a chip; the tone is a bar on a desktop, the border in a terminal.
    const raw = JSON.stringify(await pane.drawn())
    expect(raw.includes('" c "') && raw.includes('"backgroundColor":"#ffffff1f"')).toBe(has)
    expect(raw.includes('"width":0.25,"backgroundColor":"#8db4f0"')).toBe(surface === 'desktop')
    expect(raw.includes('"borderColor":"#ef8a80"')).toBe(surface === 'terminal')

    await pane.press({ key: 'clean' })
    const after = await drawn()
    expect(after.includes('Replaces the prompt box text with this')).toBe(has)
    expect(after.includes('Clears your draft from the prompt box first')).toBe(has)
    expect(after.includes('Runs Cleaned up again on the draft')).toBe(has)
    expect(after.includes('1,200 tokens in · 300 out')).toBe(has)
    expect(after.includes('1,000 cached (83%) · 200 uncached')).toBe(has)
    expect(after.includes('Draft from the prompt box')).toBe(has)
    expect(after.includes('1 of 1 not kept verbatim (✗)')).toBe(has)
    expect(after.includes('✗ @tests/checkout.spec.ts')).toBe(has)
  })
}

test('a named Expanded model and the warning list show in their cards', { options: { model: 'sonnet', effort: 'high' } }, async ($, on) => {
  world(on, { replies: ['Run pnpm test.'] })
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run(command('see @a.ts and run /review with `pnpm test`'))
  const choosing = textOf(await pane.drawn())
  expect(choosing).toContain('sonnet · effort high')
  expect(choosing).toContain('Sent the last 12 messages as an excerpt')
  expect(choosing).toContain('Up to 10k chars, 1.2k per message')
  expect(choosing).toContain('Nothing is sent')
  await pane.press({ key: 'expand' })
  const after = textOf(await pane.drawn())
  expect(after).toContain('✗ @a.ts · ✗ /review · ✓ `pnpm test`')
  expect(after).toContain('Draft from /enhance')
  expect(after).toContain('Leaves the prompt box as is')
})

// A dock has room below its last row, so the choice's cards open into it;
// an inline frame fits the tree, so they open upward over the draft.
for (const placement of ['dock', 'inline'] as const) {
  test(`the choice's cards open ${placement === 'dock' ? 'downward' : 'upward'} in ${placement === 'dock' ? 'a dock' : 'an inline pane'}`, async ($, on) => {
    world(on)
    await $.session.start(START)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement } })
    await $.command.run(command(DRAFT))
    const drawn = JSON.stringify(await pane.drawn())
    expect(textOf(await pane.drawn())).toContain('Cleans up the draft, one model call  c ')
    // One row clear of the button row, either way.
    expect(drawn.includes('"bottom":2')).toBe(placement === 'inline')
    expect(drawn.includes('"top":2')).toBe(placement === 'dock')
  })
}

test('the chip shows during a turn, and stays out of a survey', async ($, on) => {
  world(on)
  await $.session.start(START)
  const working = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, isWorking: true } })
  expect(await working.find({ key: 'enhance' })).toBeDefined()
  const survey = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
  expect(await survey.find({ key: 'enhance' })).toBeUndefined()
})

test('above the status line on the desktop, the chip draws at the right of it, and nothing under it', async ($, on) => {
  world(on, { box: DRAFT, hasStatusLine: true, replies: [CLEANED] })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })

  for (const step of ['idle', 'choosing', 'result']) {
    if (step === 'choosing') await band.press({ key: 'enhance' })
    if (step === 'result') await pane.press({ key: 'clean' })
    expect(await band.find({ text: '📁 motta-claude-mods 🌿 main' })).toBeDefined()
    const drawn = (await band.drawn()) as Node
    expect(drawn.props?.flexDirection).toBe('row')
    expect(drawn.children?.at(-1)?.props?.key).toBe('band-beside:prompt-enhancer')
  }
})

test('alone in the band, its tree carries the key motta-statusline reads, whatever the stage', async ($, on) => {
  world(on, { box: DRAFT, replies: [CLEANED] })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(((await band.drawn()) as Node).props?.key).toBe('band-beside:prompt-enhancer')
  await band.press({ key: 'enhance' })
  expect(((await band.drawn()) as Node).props?.key).toBe('band-beside:prompt-enhancer')
  await pane.press({ key: 'clean' })
  expect(((await band.drawn()) as Node).props?.key).toBe('band-beside:prompt-enhancer')
})

test('over a card that shares the band, the chip keeps it shared, so the status line stays', async ($, on) => {
  world(on, { hasCard: true })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const drawn = (await band.drawn()) as Node
  expect(drawn.props?.key).toBe('band-under:prompt-enhancer')
  expect(await band.find({ text: 'Subagents 2/2' })).toBeDefined()
  expect(drawn.children?.at(-1)?.props?.key).toBe('band-beside:prompt-enhancer')
})

for (const hasStatusLine of [false, true]) {
  test(`over cache-warmer's chip, the chip goes on top of it in one column (status line: ${hasStatusLine})`, async ($, on) => {
    world(on, { hasWarmChip: true, hasStatusLine })
    await $.session.start({ ...START, surface: 'desktop' as const })
    const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    const drawn = (await band.drawn()) as Node
    const column = hasStatusLine ? drawn.children?.at(-1) : drawn
    expect(column?.props?.key).toBe('band-beside:prompt-enhancer')
    expect(JSON.stringify(column?.children?.[0])).toContain('enhance')
    expect(JSON.stringify(column?.children?.[1])).toContain('🔥 42m')
    expect(column?.children).toHaveLength(2)
    if (hasStatusLine) expect(await band.find({ text: '📁 motta-claude-mods 🌿 main' })).toBeDefined()
  })
}

// The element budget. This pane is small (under 200 elements), so it never
// reaches BUDGET itself: the ladder is shown with a lower budget, drawing the
// result straight from enhancerPane with a plain table.
describe('the element budget', () => {
  const table = { Box: 'Box', Text: 'Text', Button: 'Button' }
  const view = (surface: 'desktop' | 'terminal'): PaneView => ({
    surface,
    columns: 60,
    now: 'result',
    current: { original: DRAFT, via: 'box', kind: 'clean' },
    hasBox: true,
    label: 'haiku',
    failed: null,
    text: 'Fix the checkout test.',
    spent: { input: 1200, output: 300, cached: 1000 },
    fromBox: true,
  })

  test('info cards go first, then every card; the terminal keeps them all', async $ => {
    const draw = (surface: 'desktop' | 'terminal') => (level: number) => enhancerPane($, table, view(surface), level)
    const counts = [0, 1, 2].map(level => countNodes(draw('desktop')(level)))
    expect(counts[0]).toBeGreaterThan(counts[1])
    expect(counts[1]).toBeGreaterThan(counts[2])
    // Between level 1 and level 0: the result's and the header's info cards
    // go, the buttons' cards stay.
    const one = JSON.stringify(fit('desktop', TOP_LEVEL, draw('desktop'), counts[1]))
    expect(one).not.toContain('not kept verbatim')
    expect(one).not.toContain('Draft from the prompt box')
    expect(one).not.toContain('"scope":"usage"')
    expect(one).toContain('Replaces the prompt box text with this')
    expect(one).toContain('Drops this result and closes the pane')
    // Under level 1: no card, and no host lit for one.
    const two = JSON.stringify(fit('desktop', TOP_LEVEL, draw('desktop'), counts[2]))
    expect(two).not.toContain('Replaces the prompt box text with this')
    expect(two).not.toContain('#ffffff10')
    expect(two).toContain('Changed or dropped: ')
    // The terminal has no limit.
    const terminal = JSON.stringify(fit('terminal', TOP_LEVEL, draw('terminal'), 1))
    expect(terminal).toContain('not kept verbatim')
    expect(terminal).toContain('Replaces the prompt box text with this')
  })

  test('the mounted desktop pane stays under the budget with every card', async ($, on) => {
    world(on, { box: DRAFT, replies: ['Fix the checkout test.'] })
    await $.session.start(START)
    const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await band.press({ key: 'enhance' })
    await pane.press({ key: 'clean' })
    const drawn = await pane.drawn()
    expect(countNodes(drawn)).toBeLessThanOrEqual(BUDGET)
    expect(textOf(drawn)).toContain('1 of 1 not kept verbatim (✗)')
  })
})

test("over the status line's slots, the chip takes line 1's and moves cache-warmer's to line 2", async ($, on) => {
  world(on, { hasWarmChip: true, hasSlots: true })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const drawn = (await band.drawn()) as Node
  expect(drawn.props?.key).toBe('band-lines:motta-statusline')
  const slot = (i: number) => JSON.stringify(drawn.children?.[i]?.children?.at(-1))
  expect(slot(0)).toContain('enhance')
  expect(slot(0)).not.toContain('🔥')
  expect(slot(1)).toContain('🔥 42m')
})

test('a narrow band presses the ✦ alone', async ($, on) => {
  world(on, { box: DRAFT })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const band = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 50 } })
  expect((await band.find({ key: 'enhance' }))?.props.label).toBe('✦')
  expect(await band.find({ type: 'Text', text: '✦' })).toBeUndefined()
})
