import { describe, expect, test } from 'claude-code/testing'

import { BUDGET, CLEAN_RULES, cleanPrompt, countNodes, enhancerPane, excerpt, expandPrompt, fit, formatUsage, missingTokens, NO_CARDS, protectedTokens, TOP_LEVEL } from '../hooks/register.tsx'
import type { PaneView } from '../hooks/register.tsx'
import { CLEANED, command, DRAFT, EXPANDED, PANE, START, world } from './world.tsx'

type Node = { type?: string; children?: Node[] }

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
  test(`/enhance opens the pane with both ways, and Cleaned up is one cheap call with no conversation (${surface})`, async ($, on) => {
    const seen = world(on, { replies: [CLEANED] })
    await $.session.start(START)
    const pane = await $.ui.mount({ ...PANE, surface })

    const ran = await $.command.run(command(DRAFT))
    expect(ran.text).toBe('✦ Pick Cleaned up or Expanded in the Enhance pane.')
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

    await pane.press({ key: 'use' })
    expect(seen.filled.at(-1)).toBe(CLEANED)
    expect(seen.closed).toEqual(['prompt-enhancer'])
  })

  test(`Expanded is one call on the conversation's fork (${surface})`, async ($, on) => {
    const seen = world(on, { replies: [EXPANDED] })
    await $.session.start(START)
    const pane = await $.ui.mount({ ...PANE, surface })

    await $.command.run(command(DRAFT))
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

test('Copy copies, Send sends and leaves the box alone, Cancel closes the pane', async ($, on) => {
  const seen = world(on, { replies: [CLEANED] })
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.command.run(command(DRAFT))
  await pane.press({ key: 'cancel' })
  expect(seen.closed).toEqual(['prompt-enhancer'])
  expect(await pane.find({ key: 'clean' })).toBeUndefined()

  await $.command.run(command(DRAFT))
  await pane.press({ key: 'clean' })
  await pane.press({ key: 'copy' })
  expect(seen.copied).toEqual([CLEANED])
  await pane.press({ key: 'send' })
  expect(seen.filled).toEqual([])
  expect(seen.submitted).toEqual([CLEANED])
  expect(seen.closed).toEqual(['prompt-enhancer', 'prompt-enhancer'])
})

// The engine's own `no_composer` cannot be raised from a test: a hook's
// refusal reaches the plugin without its cause, which the mod reads as
// unknown, so Use it stays and says the box did not take the text.
test('where the box refuses the text, Use it says so and Send stays', async ($, on) => {
  const seen = world(on, { hasComposer: false, replies: [CLEANED] })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })

  const ran = await $.command.run(command(DRAFT))
  expect(ran.text).toContain('Pick Cleaned up or Expanded in the Enhance pane')
  await pane.press({ key: 'clean' })
  await pane.press({ key: 'use' })
  expect(seen.toasts.at(-1)).toBe('The box did not take the text. Use Send or Copy.')
  expect(await pane.find({ key: 'send' })).toBeDefined()
})

test('/enhance with nothing after it says how to use it and opens nothing', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  expect((await $.command.run(command('  '))).text).toBe('Put your prompt after the command: /enhance fix the flaky checkout test.')
  expect(seen.opened).toEqual([])
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

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a failed call shows why, and Retry runs the same option again (${surface})`, async ($, on) => {
    const seen = world(on, { replies: ['fail', CLEANED] })
    await $.session.start(START)
    const pane = await $.ui.mount({ ...PANE, surface })

    await $.command.run(command(DRAFT))
    await pane.press({ key: 'clean' })
    expect(await pane.find({ text: /Could not enhance: the API answered 529 \(overloaded\)/ })).toBeDefined()
    // Retry's card: on the desktop only, the terminal draws none.
    expect(textOf(await pane.drawn()).includes('On haiku · a new model call')).toBe(surface === 'desktop')
    await pane.press({ key: 'retry-failed' })
    expect(seen.completed.map(c => c.model)).toEqual(['haiku', 'haiku'])
    expect(await pane.find({ text: CLEANED })).toBeDefined()
  })
}

test('the result names a mention it dropped', async ($, on) => {
  world(on, { replies: ['Fix the checkout test.'] })
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run(command(DRAFT))
  await pane.press({ key: 'clean' })
  expect(await pane.find({ text: /Changed or dropped: @tests\/checkout\.spec\.ts/ })).toBeDefined()
})

for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
  test(`each button and the result carry a hover card on the desktop, none in a terminal or on a phone (${surface})`, async ($, on) => {
    world(on, { replies: ['Fix the checkout test.'] })
    await $.session.start(START)
    const pane = await $.ui.mount({ ...PANE, surface })
    const drawn = async () => textOf(await pane.drawn())
    const has = surface === 'desktop'

    await $.command.run(command(DRAFT))
    expect(await pane.find({ key: 'tip:clean' })).toBeDefined()
    expect(await pane.find({ key: 'clean' })).toBeDefined()
    expect((await drawn()).includes('haiku · effort low · no conversation')).toBe(has)
    expect((await drawn()).includes('Session model: a fork of this conversation')).toBe(has)
    expect((await drawn()).includes('Nothing is sent')).toBe(has)
    // The hotkey is a chip; the tone is a bar. No card means no tone border,
    // and in a dock no room kept under the last row for a card either.
    const raw = JSON.stringify(await pane.drawn())
    expect(raw.includes('" c "') && raw.includes('"backgroundColor":"#ffffff1f"')).toBe(has)
    expect(raw.includes('"width":0.25,"backgroundColor":"#8db4f0"')).toBe(has)
    expect(raw.includes('"borderColor":"#ef8a80"')).toBe(false)
    expect(raw.includes('"key":"tip-room"')).toBe(has)

    await pane.press({ key: 'clean' })
    const after = await drawn()
    expect(after.includes('Replaces the prompt box text with this')).toBe(has)
    expect(after.includes('Leaves the prompt box as is')).toBe(has)
    expect(after.includes('Runs Cleaned up again on the draft')).toBe(has)
    expect(after.includes('1,200 tokens in · 300 out')).toBe(has)
    expect(after.includes('1,000 cached (83%) · 200 uncached')).toBe(has)
    expect(after.includes('Draft from /enhance')).toBe(has)
    expect(after.includes('1 of 1 not kept verbatim (✗)')).toBe(has)
    expect(after.includes('✗ @tests/checkout.spec.ts')).toBe(has)
  })
}

test('a named Expanded model and the warning list show in their cards', { options: { model: 'sonnet', effort: 'high' } }, async ($, on) => {
  world(on, { replies: ['Run pnpm test.'] })
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
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
// an inline frame fits the tree, so they open upward over the draft. Cards
// are the desktop's: the terminal draws none.
for (const placement of ['dock', 'inline'] as const) {
  test(`the choice's cards open ${placement === 'dock' ? 'downward' : 'upward'} in ${placement === 'dock' ? 'a dock' : 'an inline pane'}`, async ($, on) => {
    world(on)
    await $.session.start(START)
    const pane = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement } })
    await $.command.run(command(DRAFT))
    const drawn = JSON.stringify(await pane.drawn())
    expect(textOf(await pane.drawn())).toContain('Cleans up the draft, one model call  c ')
    // One row clear of the button row (a desktop button is 2 tall), either way.
    expect(drawn.includes('"bottom":3')).toBe(placement === 'inline')
    expect(drawn.includes('"top":3')).toBe(placement === 'dock')
    // Only a dock keeps room under the last row for them.
    expect(drawn.includes('"key":"tip-room"')).toBe(placement === 'dock')
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
    current: { original: DRAFT, kind: 'clean' },
    hasBox: true,
    label: 'haiku',
    failed: null,
    text: 'Fix the checkout test.',
    spent: { input: 1200, output: 300, cached: 1000 },
  })

  test('info cards go first, then every card; the terminal draws none', async $ => {
    const draw = (surface: 'desktop' | 'terminal') => (level: number) => enhancerPane($, table, view(surface), level)
    const counts = [0, 1, 2].map(level => countNodes(draw('desktop')(level)))
    expect(counts[0]).toBeGreaterThan(counts[1])
    expect(counts[1]).toBeGreaterThan(counts[2])
    // Between level 1 and level 0: the result's and the header's info cards
    // go, the buttons' cards stay.
    const one = JSON.stringify(fit('desktop', TOP_LEVEL, draw('desktop'), counts[1]))
    expect(one).not.toContain('not kept verbatim')
    expect(one).not.toContain('Draft from /enhance')
    expect(one).not.toContain('"scope":"usage"')
    expect(one).toContain('Replaces the prompt box text with this')
    expect(one).toContain('Drops this result and closes the pane')
    // Under level 1: no card, and no host lit for one.
    const two = JSON.stringify(fit('desktop', TOP_LEVEL, draw('desktop'), counts[2]))
    expect(two).not.toContain('Replaces the prompt box text with this')
    expect(two).not.toContain('#ffffff10')
    expect(two).toContain('Changed or dropped: ')
    // The terminal draws no card at all, however far under the budget.
    const terminal = fit('terminal', TOP_LEVEL, draw('terminal'))
    expect(countNodes(terminal)).toBe(countNodes(draw('terminal')(NO_CARDS)))
    expect(JSON.stringify(terminal)).not.toContain('not kept verbatim')
    expect(JSON.stringify(terminal)).not.toContain('Replaces the prompt box text with this')
    expect(JSON.stringify(terminal)).toContain('Changed or dropped: ')
  })

  test('the mounted desktop pane stays under the budget with every card', async ($, on) => {
    world(on, { replies: ['Fix the checkout test.'] })
    await $.session.start(START)
    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await $.command.run(command(DRAFT))
    await pane.press({ key: 'clean' })
    const drawn = await pane.drawn()
    expect(countNodes(drawn)).toBeLessThanOrEqual(BUDGET)
    expect(textOf(drawn)).toContain('1 of 1 not kept verbatim (✗)')
  })
})
