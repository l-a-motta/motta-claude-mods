import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { TurnStepInput, TurnStepResult } from 'claude-code'

import { cacheLeft, cacheTtlMs, isCacheHit } from '../hooks/register.tsx'
import { answerSession } from './session.tsx'

const HOUR = 3_600_000
const MIN = 60_000
const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1 }

const result = (read: number): TurnStepResult => ({
  turnId: 't1',
  index: 0,
  answer: 'done',
  toolUses: [],
  stopReason: 'end_turn',
  usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: 0 },
})

describe('cacheLeft', () => {
  const c = { at: 0, model: 'm', ttlMs: HOUR }

  test('-- before a reply, then the time left, low in its last five minutes, then cold', () => {
    expect(cacheLeft(null, 0)).toEqual({ label: '--', isLow: false, isCold: false })
    expect(cacheLeft(c, 18 * MIN)).toEqual({ label: '42m', isLow: false, isCold: false })
    expect(cacheLeft(c, 56 * MIN)).toEqual({ label: '4m', isLow: true, isCold: false })
    expect(cacheLeft(c, HOUR - 10_000).label).toBe('<1m')
    expect(cacheLeft(c, HOUR)).toEqual({ label: 'cold', isLow: false, isCold: true })
    expect(cacheLeft({ ...c, at: null }, 0).isCold).toBe(true)
  })

  test("the TTL: as set, else the engine's word, else an hour on a subscription", () => {
    expect(cacheTtlMs('5m', '1h', true)).toBe(5 * MIN)
    expect(cacheTtlMs('auto', '5m', true)).toBe(5 * MIN)
    expect(cacheTtlMs('auto', null, true)).toBe(HOUR)
    expect(cacheTtlMs('auto', null, false)).toBe(5 * MIN)
  })

  test('a request that read or wrote the cache holds it warm', () => {
    expect(isCacheHit({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(false)
    expect(isCacheHit({ cache_read_input_tokens: 0, cache_creation_input_tokens: 5 })).toBe(true)
    expect(isCacheHit(null)).toBe(false)
  })
})

async function step($: Parameters<TestBody>[0]) {
  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result
}

// The cache slot, pressed to from `out`: rate, cost, session, compact, cache.
async function mountOnCache($: Parameters<TestBody>[0]) {
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  for (let i = 0; i < 4; i++) await ui.press({ key: 'slot' })
  expect((await ui.find({ key: 'slot' }))?.props.label).toBe('cache')
  return ui
}

test('the cache slot counts down from the last step that read the cache, and goes cold', async ($, on) => {
  const clock = answerSession(on)
  on('turn.step', async function* () {
    return result(50_000)
  })
  const ui = await mountOnCache($)
  expect(await ui.find({ type: 'Text', text: '--' })).toBeDefined()
  await step($)
  // A subscription (rate limits reported): an hour.
  expect(await ui.find({ type: 'Text', text: '1h00m' })).toBeDefined()
  await clock.advance(56 * MIN)
  expect((await ui.find({ type: 'Text', text: '4m' }))?.props.color).toBe('warning')
  await clock.advance(5 * MIN)
  expect((await ui.find({ type: 'Text', text: 'cold' }))?.props.color).toBe('subtle')
  await ui.unmount()
})

test("a model switch leaves the cache cold and takes the engine's TTL", async ($, on) => {
  answerSession(on)
  on('classic.PostModelSwitch', () => ({}))
  on('turn.step', async function* () {
    return result(50_000)
  })
  const ui = await mountOnCache($)
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
  expect(await ui.find({ type: 'Text', text: 'cold' })).toBeDefined()
  await step($)
  expect(await ui.find({ type: 'Text', text: '5m' })).toBeDefined()
  await ui.unmount()
})
