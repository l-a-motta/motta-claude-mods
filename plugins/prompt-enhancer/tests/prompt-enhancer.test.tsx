import { describe, expect, test } from 'claude-code/testing'

import { askPrompt, excerpt, formatUsage, missingTokens, parseQuestions, parseVariants, protectedTokens, writePrompt } from '../hooks/register.tsx'
import { BALANCED, BAND, command, DRAFT, START, VARIANTS, world } from './world.tsx'

describe('parseQuestions', () => {
  test('keeps the Q: lines, at most four', () => {
    expect(parseQuestions('Q: How often?\nsome chatter\nq: Which runner?')).toEqual(['How often?', 'Which runner?'])
    expect(parseQuestions('Q: a\nQ: b\nQ: c\nQ: d\nQ: e')).toHaveLength(4)
  })

  test('reads NO QUESTIONS and a reply with no Q: lines as none', () => {
    expect(parseQuestions('NO QUESTIONS')).toEqual([])
    expect(parseQuestions('The draft is clear.')).toEqual([])
  })
})

describe('parseVariants', () => {
  test('splits the three versions by their markers', () => {
    expect(parseVariants(VARIANTS).map(v => v.name)).toEqual(['Tight', 'Balanced', 'Thorough'])
    expect(parseVariants(VARIANTS)[1]?.text).toBe(BALANCED)
  })

  test('takes a reply without markers as one Balanced version, and nothing as none', () => {
    expect(parseVariants('Just the prompt.')).toEqual([{ name: 'Balanced', text: 'Just the prompt.' }])
    expect(parseVariants('  ')).toEqual([])
  })
})

describe('protectedTokens', () => {
  test('finds @mentions, /commands and code, not emails or path segments', () => {
    expect(protectedTokens('see @src/a.ts, run /review and `pnpm test`; mail me@x.com about src/b.ts')).toEqual([
      '@src/a.ts',
      '/review',
      '`pnpm test`',
    ])
  })

  test('names the ones a version changed or dropped; backticks may go', () => {
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

test('the prompts carry the draft, the conversation and only the answers given', () => {
  expect(askPrompt(DRAFT, { kind: 'none' })).toContain(`<draft>\n${DRAFT}\n</draft>`)
  expect(askPrompt(DRAFT, { kind: 'fork' })).toContain('Our conversation so far is above')
  const written = writePrompt(DRAFT, [['How often?', ' one in five '], ['Which runner?', '']], { kind: 'excerpt', text: 'Me: hi' })
  expect(written).toContain('<conversation>\nMe: hi\n</conversation>')
  expect(written).toContain('Q: How often?\nA: one in five')
  expect(written).not.toContain('Which runner?')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the chip asks, takes the answers and puts the chosen version in the box (${surface})`, async ($, on) => {
    const seen = world(on, { box: DRAFT, replies: ['Q: How often does it fail?\nQ: Which runner?', VARIANTS] })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface, component: 'AbovePrompt', props: BAND })

    await ui.press({ key: 'enhance' })
    expect(seen.forked).toHaveLength(1)
    expect(seen.forked[0]).toContain(`<draft>\n${DRAFT}\n</draft>`)
    expect(await ui.find({ text: 'How often does it fail?' })).toBeDefined()

    await ui.input({ key: 'answer-0', text: 'one run in five' })
    expect(await ui.find({ text: 'Which runner?' })).toBeDefined()
    await ui.input({ key: 'answer-1', text: '' })

    expect(seen.forked).toHaveLength(2)
    expect(seen.forked[1]).toContain('Q: How often does it fail?\nA: one run in five')
    expect(seen.forked[1]).not.toContain('Which runner?')
    expect(await ui.find({ text: BALANCED })).toBeDefined()

    await ui.press({ key: 'variant-0' })
    expect(await ui.find({ text: 'Fix the flaky @tests/checkout.spec.ts.' })).toBeDefined()
    await ui.press({ key: 'use' })
    expect(seen.filled.at(-1)).toBe('Fix the flaky @tests/checkout.spec.ts.')
    expect(await ui.find({ key: 'enhance' })).toBeDefined()
  })
}

test('with nothing to ask it writes at once; Copy copies and Send sends, clearing the box', async ($, on) => {
  const seen = world(on, { box: DRAFT, replies: ['NO QUESTIONS', VARIANTS] })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  await ui.press({ key: 'enhance' })
  expect(seen.forked).toHaveLength(2)
  expect(await ui.find({ text: /session model · in 2\.4k \(2\.0k cached\) · out 600/ })).toBeDefined()

  await ui.press({ key: 'copy' })
  expect(seen.copied).toEqual([BALANCED])
  await ui.press({ key: 'send' })
  expect(seen.filled.at(-1)).toBe('')
  expect(seen.submitted).toEqual([BALANCED])
  expect(await ui.find({ key: 'enhance' })).toBeDefined()
})

// The engine's own `no_composer` cannot be raised from a test: a hook's
// refusal reaches the plugin without its cause, which the mod reads as
// unknown, so the chip stays. /enhance works either way.
test('an empty box, or a refusal of unknown cause, keeps the chip; /enhance still works', async ($, on) => {
  const seen = world(on, { hasComposer: false, replies: ['NO QUESTIONS', VARIANTS] })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  await ui.press({ key: 'enhance' })
  expect(seen.toasts.at(-1)).toBe('Write a prompt in the box first, then press ✦ enhance.')
  expect(await ui.find({ key: 'enhance' })).toBeDefined()

  const ran = await $.command.run(command(DRAFT))
  expect(ran.text).toContain('Enhancing')
  await seen.settle()
  expect(await ui.find({ key: 'use' })).toBeDefined()
  await ui.press({ key: 'use' })
  expect(seen.toasts.at(-1)).toBe('The box did not take the text. Use Send or Copy.')
  expect(await ui.find({ key: 'send' })).toBeDefined()
})

test('/enhance with nothing after it says how to use it', async ($, on) => {
  world(on)
  await $.session.start(START)
  expect((await $.command.run(command('  '))).text).toContain('/enhance fix the flaky checkout test')
})

test('a named model gets the conversation as an excerpt', { options: { model: 'haiku', effort: 'low' } }, async ($, on) => {
  const seen = world(on, { replies: ['NO QUESTIONS', VARIANTS] })
  await $.session.start(START)
  await $.command.run(command(DRAFT))
  await seen.settle()
  expect(seen.forked).toEqual([])
  expect(seen.completed.map(c => c.model)).toEqual(['haiku', 'haiku'])
  expect(seen.completed[0]?.effort).toBe('low')
  expect(seen.completed[0]?.prompt).toContain('<conversation>\nMe: why is checkout slow?\n\nClaude: The cart loads every item.\n</conversation>')
})

test('with no conversation to fork yet it falls back to Sonnet', async ($, on) => {
  const seen = world(on, { canFork: false, replies: ['NO QUESTIONS', VARIANTS] })
  await $.session.start(START)
  await $.command.run(command(DRAFT))
  await seen.settle()
  expect(seen.completed.map(c => c.model)).toEqual(['sonnet', 'sonnet'])
  expect(seen.completed[0]?.prompt).not.toContain('<conversation>')
})

test('a failed call shows why and retries the step that failed', async ($, on) => {
  const seen = world(on, { box: DRAFT, replies: ['NO QUESTIONS', 'fail', VARIANTS] })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  await ui.press({ key: 'enhance' })
  expect(await ui.find({ text: /Could not enhance: the API answered 529 \(overloaded\)/ })).toBeDefined()
  await ui.press({ key: 'retry-failed' })
  expect(seen.forked).toHaveLength(3)
  expect(await ui.find({ text: BALANCED })).toBeDefined()
})

test('the card names a mention the shown version dropped', async ($, on) => {
  world(on, { box: DRAFT, replies: ['NO QUESTIONS', '=== BALANCED ===\nFix the checkout test.'] })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await ui.press({ key: 'enhance' })
  expect(await ui.find({ text: /Changed or dropped: @tests\/checkout\.spec\.ts/ })).toBeDefined()
})

test('the chip stays out of the way during a turn and under a survey', async ($, on) => {
  world(on)
  await $.session.start(START)
  const working = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, isWorking: true } })
  expect(await working.find({ key: 'enhance' })).toBeUndefined()
  const survey = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
  expect(await survey.find({ key: 'enhance' })).toBeUndefined()
})

type Node = { type?: string; props?: { key?: string; flexDirection?: string }; children?: Node[] }

test('above the status line on the desktop, the chip draws at the right of it and a card under it', async ($, on) => {
  world(on, { box: DRAFT, hasStatusLine: true, replies: ['NO QUESTIONS', VARIANTS] })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ text: '📁 motta-claude-mods 🌿 main' })).toBeDefined()
  expect(await ui.find({ key: 'enhance' })).toBeDefined()
  const idle = (await ui.drawn()) as Node
  expect(idle.props?.flexDirection).toBe('row')
  expect(idle.children?.at(-1)?.props?.key).toBe('band-beside:prompt-enhancer')

  await ui.press({ key: 'enhance' })
  expect(await ui.find({ text: '📁 motta-claude-mods 🌿 main' })).toBeDefined()
  const card = (await ui.drawn()) as Node
  expect(card.props?.flexDirection).toBe('column')
  expect(card.children?.at(-1)?.props?.key).toBe('band-under:prompt-enhancer')
})

test('alone in the band, its trees carry the keys motta-statusline reads', async ($, on) => {
  world(on, { box: DRAFT, replies: ['NO QUESTIONS', VARIANTS] })
  await $.session.start({ ...START, surface: 'desktop' as const })
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(((await ui.drawn()) as Node).props?.key).toBe('band-beside:prompt-enhancer')
  await ui.press({ key: 'enhance' })
  expect(((await ui.drawn()) as Node).props?.key).toBe('band-under:prompt-enhancer')
})
