import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { liveBars } from '../hooks/register.tsx'
import type { AgentRun, Flow } from '../types'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Node = { type?: string; props?: { key?: string }; children?: Node[] }

const PROGRESS = 'mcp__savvy-progress__progress'
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

// The engine beneath: a clock, every spawn starting under its own id, and a
// band nothing else draws in unless a test says so.
function engine(on: On, beneath: () => unknown = () => ({ type: 'engine', ref: 1 })) {
  mock.clock(on)
  let n = 0
  on('agent.spawn', async () => ({ agentId: `a${++n}`, model: 'claude-haiku-5-5' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('turn.complete', async () => ({ text: 'ok' }))
  on('ui.render', { component: 'AbovePrompt' }, async () => beneath() as never)
}

const band = ($: $, surface: 'terminal' | 'desktop' = 'terminal', props: Partial<typeof BAND_PROPS> = {}) =>
  $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, ...props } } as never)

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

describe('liveBars', () => {
  const run = (anchor: string, type = 'Explore', description = 'x'): AgentRun => ({
    id: anchor, anchor, type, description, model: 'm', status: 'running', startedAt: 0,
    contextTokens: 0, contextMax: 1, tokens: 0, costUsd: 0, steps: 0, round: 1,
  })
  const call = (anchor: string, isFinished = false): Flow => ({
    title: 'Subagents', total: 1, done: isFinished ? 1 : 0, running: isFinished ? 0 : 1, phase: 'delegate', isFinished, tasks: [], anchor, kind: 'agents',
  })
  const live: Flow = { title: 'Ship it', total: 2, done: 0, running: 1, phase: 'delegate', isFinished: false, tasks: [], anchor: 'p1' }

  test('keeps the running calls, titled by their one agent', () => {
    const bars = liveBars(null, { t1: call('t1'), t2: call('t2', true) }, [run('t1', 'Explore', 'Map the repo')])
    expect(bars.map(b => [b.key, b.bar.title])).toEqual([['t1', 'Map the repo']])
  })

  test("puts a live flow first, and leaves its own workers to the flow's bar", () => {
    const bars = liveBars(live, { t1: call('t1'), t2: call('t2') }, [run('t1', 'savvy-light'), run('t2')])
    expect(bars.map(b => b.key)).toEqual(['p1', 't2'])
  })
})

test('nothing running: the band is left as the plugins beneath drew it', async ($, on) => {
  engine(on)
  expect(((await (await band($)).drawn()) as Node).type).toBe('engine')
})

test('a running Agent call puts its bar in the band, and it leaves once the agent is done', async ($, on) => {
  engine(on)
  await spawn($, 't1', 'Map the repo')
  const drawing = await band($)
  expect(((await drawing.drawn()) as Node).props?.key).toBe('band-under:savvy-progress')
  expect(await drawing.find({ type: 'Text', text: 'Map the repo' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Agents 0/1' })).toBeDefined()

  await finish($, 'a1')
  expect(((await (await band($)).drawn()) as Node).type).toBe('engine')
})

test('shows three bars and counts the rest', async ($, on) => {
  engine(on)
  for (const id of ['t1', 't2', 't3', 't4']) await spawn($, id, `Task ${id}`)
  const drawing = await band($)
  expect(await drawing.find({ type: 'Text', text: 'Task t3' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Task t4' })).toBeUndefined()
  expect(await drawing.find({ type: 'Text', text: '  +1 more running' })).toBeDefined()
})

test("a savvy flow's bar leads the band", async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, tool_use_id: 'p1', title: 'Ship it', total: 2, done: 1, phase: 'delegate' } as never)
  await spawn($, 't1', 'Map the repo')
  const drawing = await band($)
  expect(await drawing.find({ type: 'Text', text: 'Ship it' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Tasks 1/2' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Map the repo' })).toBeDefined()
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

test("a chip column beneath stays at the card's right", async ($, on) => {
  engine(on, () => h('Box', { key: 'band-beside:prompt-enhancer' }, h('Text', {}, '✦ enhance')))
  await spawn($, 't1')
  const root = (await (await band($)).drawn()) as Node
  expect(root.props?.key).toBe('band-under:savvy-progress')
  expect(root.children?.map(c => c.props?.key)).toEqual(['savvy-card', 'band-beside:prompt-enhancer'])
})

test('a survey keeps the band', async ($, on) => {
  engine(on)
  await spawn($, 't1')
  expect(((await (await band($, 'terminal', { hasSurvey: true })).drawn()) as Node).type).toBe('engine')
})
