import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { batchOf, bandBar } from '../hooks/register.tsx'
import type { AgentRun, Flow } from '../types'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Node = { type?: string; props?: { key?: string }; children?: Node[] }

const PROGRESS = 'mcp__savvy-progress__progress'
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} as { agentId?: string } }

// The engine beneath: a clock, every spawn starting under its own id, and a
// band nothing else draws in unless a test says so.
function engine(on: On, beneath: () => unknown = () => ({ type: 'engine', ref: 1 })) {
  const clock = mock.clock(on)
  let n = 0
  on('agent.spawn', async () => ({ agentId: `a${++n}`, model: 'claude-haiku-5-5' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('turn.complete', async () => ({ text: 'ok' }))
  on('ui.render', { component: 'AbovePrompt' }, async () => beneath() as never)
  return clock
}

const band = ($: $, surface: 'terminal' | 'desktop' = 'terminal', props: Partial<typeof BAND_PROPS> = {}) =>
  $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, ...props } } as never)

const isLeft = async ($: $, props: Partial<typeof BAND_PROPS> = {}) =>
  ((await (await band($, 'terminal', props)).drawn()) as Node).type === 'engine'

const spawn = ($: $, call: string, description = 'Look around', subagentType = 'Explore') =>
  $.agent.spawn({
    prompt: 'look',
    description,
    subagentType,
    tool_use_id: call,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

const finish = ($: $, agentId: string) =>
  $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, agentId, reason: 'answer' })

const run = (id: string, startedAt: number, endedAt?: number, description = 'x'): AgentRun => ({
  id, agentId: id, type: 'Explore', description, model: 'm', status: endedAt === undefined ? 'running' : 'done', startedAt, endedAt,
  contextTokens: 0, contextMax: 1, tokens: 0, costUsd: 0, steps: 0, round: 1,
})

describe('batchOf', () => {
  test('takes every run that overlapped the ones still running, and those started since', () => {
    const list = [run('old', 0, 5), run('a', 10, 30), run('b', 20), run('c', 40, 50)]
    expect(batchOf(list).map(a => a.id)).toEqual(['a', 'b', 'c'])
  })

  test('is empty once none runs', () => {
    expect(batchOf([run('a', 0, 5)])).toEqual([])
  })
})

describe('bandBar', () => {
  const live: Flow = { title: 'Ship it', total: 2, done: 0, running: 1, phase: 'delegate', isFinished: false, tasks: [] }

  test('the open agent first, then a live flow, then the batch', () => {
    const list = [run('a1', 0, undefined, 'Map the repo'), run('a2', 1, undefined, 'Count tests')]
    expect(bandBar(live, list, 'a2', 7)?.bar.title).toBe('Count tests')
    expect(bandBar(live, list, undefined, 7)).toEqual({ key: 'flow:7', bar: live })
    const batch = bandBar(null, list, undefined, 7)
    expect([batch?.key, batch?.bar.title, batch?.bar.total, batch?.bar.done]).toEqual(['batch:0', 'Subagents', 2, 0])
  })

  test('a batch of one is titled by its agent; an unknown open agent leaves the band', () => {
    expect(bandBar(null, [run('a1', 0, undefined, 'Map the repo')], undefined, undefined)?.bar.title).toBe('Map the repo')
    expect(bandBar(null, [run('a1', 0)], 'gone', undefined)).toBeNull()
  })
})

test('nothing running: the band is left as the plugins beneath drew it', async ($, on) => {
  engine(on)
  expect(await isLeft($)).toBe(true)
})

test('agents working together share one roll call, which leaves once they are all done', async ($, on) => {
  engine(on)
  await spawn($, 't1', 'Map the repo')
  await spawn($, 't2', 'Count tests')
  let drawing = await band($)
  expect(((await drawing.drawn()) as Node).props?.key).toBe('band-under:savvy-progress')
  expect(await drawing.find({ type: 'Text', text: /^2 running · / } as never)).toBeDefined()

  await finish($, 'a1')
  drawing = await band($)
  expect(await drawing.find({ type: 'Text', text: /^1 running · / } as never)).toBeDefined()

  await finish($, 'a2')
  expect(await isLeft($)).toBe(true)
})

test("a live savvy flow's bar takes the band", async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, tool_use_id: 'p1', title: 'Ship it', total: 2, done: 1, phase: 'delegate' } as never)
  await spawn($, 't1', 'Map the repo')
  const drawing = await band($)
  expect(await drawing.find({ type: 'Text', text: 'Ship it' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Tasks 1/2' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Map the repo' })).toBeUndefined()
})

test("with an agent's transcript open, the band names that agent alone, done or not", async ($, on) => {
  engine(on)
  await spawn($, 't1', 'Map the repo')
  await spawn($, 't2', 'Count tests')
  const drawing = await band($, 'terminal', { view: { agentId: 'a2' } })
  expect(await drawing.find({ type: 'Text', text: /^Count tests · 1 running · / } as never)).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: /Map the repo/ } as never)).toBeUndefined()

  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a2', done: 1, total: 4 } as never)
  expect(await (await band($, 'terminal', { view: { agentId: 'a2' } })).find({ type: 'Text', text: /^Count tests · 1\/4 · / } as never)).toBeDefined()

  await finish($, 'a2')
  expect(await (await band($, 'terminal', { view: { agentId: 'a2' } })).find({ type: 'Text', text: /^Count tests · 1\/4 · Done · / } as never)).toBeDefined()
})

test('the ✕ hides the bar until the next batch', async ($, on) => {
  const clock = engine(on)
  await spawn($, 't1')
  const drawing = await band($)
  await drawing.press({ key: 'savvy-band-dismiss' })
  expect(await isLeft($)).toBe(true)

  await finish($, 'a1')
  await clock.advance(1_000)
  await spawn($, 't2', 'Next one')
  expect(await (await band($)).find({ type: 'Text', text: /^Next one · / } as never)).toBeDefined()
})

test('under a status line beneath, the card goes under its lines, on each surface', async ($, on) => {
  engine(on, () => h('Box', { key: 'beneath' }, h('Text', {}, 'status line')))
  await spawn($, 't1')
  for (const surface of ['terminal', 'desktop'] as const) {
    const root = (await (await band($, surface)).drawn()) as Node
    expect(root.props?.key).toBe('band-under:savvy-progress')
    expect(root.children?.[0]?.props?.key).toBe('beneath')
    expect(root.children?.[1]?.props?.key).toBe('savvy-card')
  }
})

test("a chip column beneath stays at the card's right, for a status line above to lift", async ($, on) => {
  engine(on, () => h('Box', { key: 'band-beside:prompt-enhancer' }, h('Text', {}, '✦ enhance')))
  await spawn($, 't1')
  const root = (await (await band($)).drawn()) as Node
  expect(root.props?.key).toBe('band-under:savvy-progress')
  expect(root.children?.map(c => c.props?.key)).toEqual(['savvy-card', 'band-beside:prompt-enhancer'])
})

test('a survey keeps the band', async ($, on) => {
  engine(on)
  await spawn($, 't1')
  expect(await isLeft($, { hasSurvey: true })).toBe(true)
})
