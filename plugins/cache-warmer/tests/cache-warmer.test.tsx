import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { TurnStepInput, TurnStepResult } from 'claude-code'

import { chipLabel, isPingDue, warmthOf } from '../hooks/register.tsx'

const HOUR = 3_600_000
const MIN = 60_000
const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1 }
const BAND = {
  plugin: 'cache-warmer',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const usage = (read: number) => ({ input_tokens: 10, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: 0 })

const result = (read: number): TurnStepResult => ({
  turnId: 't1',
  index: 0,
  answer: 'done',
  toolUses: [],
  stopReason: 'end_turn',
  usage: { model: 'claude-opus-5-5', ...usage(read) },
})

type Beneath = 'nothing' | 'enhance' | 'statusline'

// The engine beneath the mod: a subscription session (rate limits reported,
// so an hour's TTL), steps that read the cache, forks counted, and in the
// band nothing, prompt-enhancer's chip column, or motta-statusline's lines
// with that column at their right.
function answerSession(on: Parameters<TestBody>[1], beneath: Beneath = 'nothing', forkUsage = usage(50_000)) {
  const clock = mock.clock(on)
  const forks: string[] = []
  const toasts: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 5 }] } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('classic.PostModelSwitch', () => ({}))
  on('turn.step', async function* () {
    return result(50_000)
  })
  on('turn.complete', () => ({ text: 'done' }))
  on('model.fork', ($, e) => {
    forks.push(e.prompt)
    return { value: { isAnswered: true, text: 'ok', usage: forkUsage } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    if (beneath === 'nothing') return { type: 'engine', ref: 1 } as never
    const { Box, Text } = $.ui.resolve(e)
    const enhance = (
      <Box key="band-beside:prompt-enhancer" flexDirection="column" alignItems="flex-end">
        <Box flexDirection="row">
          <Text>✦ enhance</Text>
        </Box>
      </Box>
    )
    if (beneath === 'enhance') return enhance
    return (
      <Box flexDirection="row">
        <Box flexDirection="column">
          <Text>📁 folder</Text>
        </Box>
        {enhance}
      </Box>
    )
  })
  return { clock, forks, toasts }
}

// One main-session step, and with `isDone` the turn's end after it.
async function step($: Parameters<TestBody>[0], isDone = true) {
  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result
  if (isDone) await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

describe('warmth', () => {
  const h = { at: 0, model: 'm', ttlMs: HOUR }

  test('is unknown before a reply, then the time left, low within the lead, then cold', () => {
    expect(warmthOf(null, 0, 3 * MIN)).toEqual({ kind: 'none' })
    expect(warmthOf(h, 18 * MIN, 3 * MIN)).toMatchObject({ kind: 'warm', label: '42m', isLow: false })
    expect(warmthOf(h, 58 * MIN, 3 * MIN)).toMatchObject({ kind: 'warm', label: '2m', isLow: true })
    expect(warmthOf(h, HOUR - 10_000, 3 * MIN)).toMatchObject({ label: '<1m' })
    expect(warmthOf(h, HOUR, 3 * MIN)).toEqual({ kind: 'cold' })
    expect(warmthOf({ ...h, at: null }, 0, 3 * MIN)).toEqual({ kind: 'cold' })
  })

  test('the label: the switch as 🔥 or ❄, the time left, cold or --, and the pings', () => {
    expect(chipLabel(false, warmthOf(null, 0, 3 * MIN), 0, false)).toBe('❄ --')
    expect(chipLabel(false, warmthOf(h, 18 * MIN, 3 * MIN), 0, false)).toBe('❄ 42m')
    expect(chipLabel(true, warmthOf(h, 18 * MIN, 3 * MIN), 2, false)).toBe('🔥 42m ↻2')
    expect(chipLabel(true, warmthOf(h, 18 * MIN, 3 * MIN), 2, true)).toBe('🔥 42m ↻…')
    expect(chipLabel(true, warmthOf(h, HOUR, 3 * MIN), 0, false)).toBe('🔥 cold')
  })

  test('a ping is due only while on, idle, warm, within the lead and not long idle', () => {
    const s = { isOn: true, isBusy: false, isPinging: false, hit: h, idleSince: 0 }
    expect(isPingDue(s, 58 * MIN, 3 * MIN, 3 * HOUR)).toBe(true)
    expect(isPingDue(s, 50 * MIN, 3 * MIN, 3 * HOUR)).toBe(false)
    expect(isPingDue({ ...s, isOn: false }, 58 * MIN, 3 * MIN, 3 * HOUR)).toBe(false)
    expect(isPingDue({ ...s, isBusy: true }, 58 * MIN, 3 * MIN, 3 * HOUR)).toBe(false)
    expect(isPingDue({ ...s, isPinging: true }, 58 * MIN, 3 * MIN, 3 * HOUR)).toBe(false)
    expect(isPingDue({ ...s, hit: { ...h, at: null } }, 58 * MIN, 3 * MIN, 3 * HOUR)).toBe(false)
    expect(isPingDue({ ...s, idleSince: -3 * HOUR }, 58 * MIN, 3 * MIN, 3 * HOUR)).toBe(false)
  })
})

test('shows the countdown and pings once, 3 minutes before expiry, only while on', async ($, on) => {
  const { clock, forks } = answerSession(on)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toBe('❄ --')
  await step($)
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toBe('❄ 1h00m')

  // Off: the cache runs into its last minutes and nothing is sent.
  await clock.advance(58 * MIN)
  expect(forks).toHaveLength(0)
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toBe('❄ 2m')

  await ui.press({ key: 'keep-warm' })
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toBe('🔥 2m')
  await clock.advance(15_000)
  expect(forks).toHaveLength(1)
  expect(forks[0]).toMatch(/exactly one word/)
  // The ping read the cache: an hour again, and one ping counted.
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toBe('🔥 1h00m ↻1')

  // Nothing more until the next lead.
  await clock.advance(50 * MIN)
  expect(forks).toHaveLength(1)
  await clock.advance(8 * MIN)
  expect(forks).toHaveLength(2)
  await ui.unmount()
})

test('never pings while a turn runs, nor a cache already cold', async ($, on) => {
  const { clock, forks } = answerSession(on)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'keep-warm' })
  // A turn whose step came back and whose tools still run.
  await step($, false)
  await clock.advance(58 * MIN)
  expect(forks).toHaveLength(0)
  await clock.advance(5 * MIN)
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toMatch(/^. cold/u)
  expect(forks).toHaveLength(0)
  await ui.unmount()
})

test('stops pinging past maxIdleHours', { options: { maxIdleHours: 1.5 } }, async ($, on) => {
  const { clock, forks } = answerSession(on)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'keep-warm' })
  await step($)
  await clock.advance(58 * MIN)
  expect(forks).toHaveLength(1)
  // The next lead falls past an hour and a half idle.
  await clock.advance(60 * MIN)
  expect(forks).toHaveLength(1)
  await clock.advance(10 * MIN)
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toMatch(/^. cold/u)
  await ui.unmount()
})

for (const beneath of ['nothing', 'enhance', 'statusline'] as const) {
  test(`stacks the chip under ✦ enhance in the band's chip column (beneath: ${beneath})`, async ($, on) => {
    answerSession(on, beneath)
    const ui = await $.ui.mount(BAND)
    const drawn = (await ui.drawn()) as { props?: { key?: unknown }; children?: unknown[] }
    type El = { type?: string; props?: { key?: unknown }; children?: El[] }
    const column = (function find(n: El | undefined): El | undefined {
      if (!n || typeof n !== 'object') return undefined
      if (n.props?.key === 'band-beside:cache-warmer') return n
      for (const c of n.children ?? []) {
        const f = find(c)
        if (f) return f
      }
      return undefined
    })(drawn as El)
    expect(column).toBeDefined()
    const last = column!.children![column!.children!.length - 1]
    expect(JSON.stringify(last)).toContain('keep-warm')
    if (beneath !== 'nothing') expect(JSON.stringify(column!.children![0])).toContain('✦ enhance')
    if (beneath === 'statusline') expect(JSON.stringify(drawn.children?.[0])).toContain('📁 folder')
    await ui.unmount()
  })
}

test('a ping that finds the cache lapsed reads the TTL as 5 minutes', async ($, on) => {
  const { clock, forks, toasts } = answerSession(on, 'nothing', { ...usage(0), cache_creation_input_tokens: 50_000 })
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'keep-warm' })
  await step($)
  await clock.advance(57 * MIN)
  expect(forks).toHaveLength(1)
  expect(toasts.some(t => /5 minutes/.test(t))).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toMatch(/^. 5m/u)
  await ui.unmount()
})

test("a model switch leaves the cache cold and takes the engine's TTL", async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount(BAND)
  await step($)
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 50_000,
    prompt_cache_warm: true,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0.1,
    pricing: 'catalog',
  })
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toMatch(/^. cold/u)
  await step($)
  expect((await ui.find({ type: 'Text', text: /^(❄|🔥) /u } as never))?.text).toMatch(/^. 5m/u)
  await ui.unmount()
})
