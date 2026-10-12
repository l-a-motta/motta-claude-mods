import { describe, expect, test } from 'claude-code/testing'
import type { TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

import { chunkChars, exactRate } from '../hooks/register.tsx'
import { answerSession } from './session.tsx'

const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1 }

const result = (output_tokens: number): TurnStepResult => ({
  turnId: 't1',
  index: 0,
  answer: '',
  toolUses: [],
  stopReason: 'end_turn',
  usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
})

describe('chunkChars', () => {
  test('counts text, thinking and tool arguments, and nothing else', () => {
    expect(chunkChars({ kind: 'text', index: 0, text: 'abcd' })).toBe(4)
    expect(chunkChars({ kind: 'thinking', index: 0, text: 'ab' })).toBe(2)
    expect(chunkChars({ kind: 'input', index: 1, json: '{"a":1}' })).toBe(7)
    expect(chunkChars({ kind: 'tool', index: 1, id: 'x', name: 'Read' })).toBe(0)
  })
})

describe('exactRate', () => {
  test('divides the output tokens by the time from the first token to the end', () => {
    expect(exactRate(300, 1_000, 3_000)).toEqual({ kind: 'exact', perSec: 150 })
  })

  test('has no figure for a request that streamed nothing or ended at once', () => {
    expect(exactRate(300, null, 3_000)).toBeNull()
    expect(exactRate(0, 1_000, 3_000)).toBeNull()
    expect(exactRate(300, 1_000, 1_010)).toBeNull()
  })
})

test('shows the wait, then the live estimate, then the exact rate on Out', async ($, on) => {
  const clock = answerSession(on)
  // The model beneath: first token after 1.5 s, 400 characters, then 400
  // more and the stop 2 s later, 300 output tokens in all.
  on('turn.step', async function* () {
    await clock.sleep(1_500)
    yield { kind: 'text', index: 0, text: 'x'.repeat(400) } as TurnStepChunk
    await clock.sleep(2_000)
    yield { kind: 'text', index: 0, text: 'y'.repeat(400) } as TurnStepChunk
    yield { kind: 'stop', stopReason: 'end_turn', usage: result(300).usage } as TurnStepChunk
    return result(300)
  })
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  expect(await ui.find({ type: 'Text', text: /waiting|@/ })).toBeUndefined()

  const stream = $.turn.step(STEP)
  const read = (async () => {
    for await (const _ of stream) {
      // The test only drains the stream; the mod sees every chunk.
    }
    return stream.result
  })()

  await clock.advance(1_200)
  expect(await ui.find({ type: 'Text', text: 'waiting 1s' })).toBeDefined()

  // 400 characters, about 100 tokens, one second after the first token.
  await clock.advance(1_300)
  expect(await ui.find({ type: 'Text', text: '~100' })).toBeDefined()

  await clock.advance(1_000)
  await read
  expect(await ui.find({ type: 'Text', text: '150' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '~100' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '300' })).toBeDefined()
  await ui.unmount()
})

test("leaves a subagent's requests out of the rate", async ($, on) => {
  const clock = answerSession(on)
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x'.repeat(400) } as TurnStepChunk
    await clock.sleep(1_000)
    return result(200)
  })
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  const stream = $.turn.step({ ...STEP, agentId: 'a1' })
  const read = (async () => {
    for await (const _ of stream) {
      // Drains the stream.
    }
  })()
  await clock.advance(1_000)
  await read
  expect(await ui.find({ type: 'Text', text: /@|waiting/ })).toBeUndefined()
  await ui.unmount()
})

test('drops the live figure when a request ends without a result', async ($, on) => {
  const clock = answerSession(on)
  // The request dies mid-stream, as an interrupt or an API error ends it.
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x'.repeat(400) } as TurnStepChunk
    await clock.sleep(1_200)
    throw new Error('stream ended')
  })
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  const stream = $.turn.step(STEP)
  const read = (async () => {
    for await (const _ of stream) {
      // Drains the stream.
    }
  })().catch(() => undefined)

  await clock.advance(1_000)
  expect(await ui.find({ type: 'Text', text: '~100' })).toBeDefined()

  await clock.advance(500)
  await read
  expect(await ui.find({ type: 'Text', text: /^~/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /@|waiting/ })).toBeUndefined()
  await ui.unmount()
})
