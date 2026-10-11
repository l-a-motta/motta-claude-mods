import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { SessionMessage, TurnStepInput, TurnStepResult } from 'claude-code'

import { cacheLeft, isCacheHit, ttlMs } from '../hooks/register.tsx'
import { answerSession } from './session.tsx'

const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1 }

const usage = (cache_read_input_tokens: number, cache_creation_input_tokens = 0) => ({
  input_tokens: 10,
  output_tokens: 20,
  cache_read_input_tokens,
  cache_creation_input_tokens,
})

const result = (read: number): TurnStepResult => ({
  turnId: 't1',
  index: 0,
  answer: 'ok',
  toolUses: [],
  stopReason: 'end_turn',
  usage: { model: 'claude-opus-5-5', ...usage(read) },
})

// A mod that forks at each turn's start, as cache-warmer pings.
const PINGER: Plugin = {
  name: 'pinger',
  register: on => {
    on('turn.start', async ($, e, next) => {
      await $.model.fork({ prompt: 'ok' })
      return next(e)
    })
  },
}

const SUMMARY: SessionMessage = { role: 'user', text: 'Summary.', toolUses: [] }

const HINT = { plugin: 'motta-statusline', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } } as const

describe('the cache figures', () => {
  test('a read or a write holds the cache; neither does not', () => {
    expect(isCacheHit(usage(5_000))).toBe(true)
    expect(isCacheHit(usage(0, 5_000))).toBe(true)
    expect(isCacheHit(usage(0))).toBe(false)
    expect(isCacheHit(null)).toBe(false)
  })

  test("auto takes what the engine said, else a subscription as an hour and anything else as five minutes; a setting wins", () => {
    expect(ttlMs('auto', null, true)).toBe(3_600_000)
    expect(ttlMs('auto', null, false)).toBe(300_000)
    expect(ttlMs('auto', '5m', true)).toBe(300_000)
    expect(ttlMs('auto', '1h', false)).toBe(3_600_000)
    expect(ttlMs('5m', '1h', true)).toBe(300_000)
    expect(ttlMs('1h', '5m', false)).toBe(3_600_000)
    expect(cacheLeft({ hitAt: 1_000, ttlMs: 300_000 }, 101_000)).toBe(200_000)
  })
})

test('counts down from a cached step, yellow at the end, then cold', async ($, on) => {
  const clock = answerSession(on)
  on('turn.step', async function* () {
    return result(50_000)
  })
  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: 'cache ' })).toBeUndefined()

  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result
  // The session reports rate limits: an hour.
  expect(await ui.find({ type: 'Text', text: '1h00m' })).toBeDefined()

  await clock.advance(58 * 60_000)
  expect((await ui.find({ type: 'Text', text: '2m' }))?.props.color).toBe('warning')

  await clock.advance(3 * 60_000)
  expect(await ui.find({ type: 'Text', text: 'cold' })).toBeDefined()
  await ui.unmount()
})

test('a step that cached nothing starts no countdown', async ($, on) => {
  answerSession(on)
  on('turn.step', async function* () {
    return result(0)
  })
  const ui = await $.ui.mount(HINT)
  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result
  expect(await ui.find({ type: 'Text', text: 'cache ' })).toBeUndefined()
  await ui.unmount()
})

test("a fork that read the cache restarts the TTL, as a cache-warmer ping does", { plugins: [PINGER] }, async ($, on) => {
  const clock = answerSession(on)
  on('turn.step', async function* () {
    return result(50_000)
  })
  on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage: usage(50_000) } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  const ui = await $.ui.mount(HINT)
  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result

  await clock.advance(50 * 60_000)
  expect(await ui.find({ type: 'Text', text: '10m' })).toBeDefined()
  await $.turn.start({ text: '', turnId: 't2' })
  expect(await ui.find({ type: 'Text', text: '1h00m' })).toBeDefined()
  await ui.unmount()
})

test('a compaction leaves the cache cold', async ($, on) => {
  answerSession(on)
  on('turn.step', async function* () {
    return result(50_000)
  })
  on('session.compact', () => ({ messages: [SUMMARY] }))
  const ui = await $.ui.mount(HINT)
  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result
  expect(await ui.find({ type: 'Text', text: '1h00m' })).toBeDefined()

  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] } as never)
  expect(await ui.find({ type: 'Text', text: 'cold' })).toBeDefined()
  await ui.unmount()
})

test("a model switch leaves the cache cold and gives the engine's TTL", async ($, on) => {
  answerSession(on)
  on('classic.PostModelSwitch', () => ({}))
  on('turn.step', async function* () {
    return result(50_000)
  })
  const ui = await $.ui.mount(HINT)
  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result
  expect(await ui.find({ type: 'Text', text: '1h00m' })).toBeDefined()

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
  const again = $.turn.step(STEP)
  for await (const _ of again) {
    // Drained only.
  }
  await again.result
  expect(await ui.find({ type: 'Text', text: '5m' })).toBeDefined()
  await ui.unmount()
})
