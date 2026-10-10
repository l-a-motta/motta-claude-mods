import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { view } from '../hooks/register.tsx'
import type { AgentRun, Flow } from '../types'

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Node = { type?: string; props?: { key?: string }; children?: Node[] }

const band = ($: $, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND_PROPS })

// The engine beneath: a clock, every spawn starting under its own id, and a
// band nothing else draws in unless a test says so.
function engine(on: On, beneath: () => unknown = () => ({ type: 'engine', ref: 1 })) {
  mock.clock(on)
  let n = 0
  on('agent.spawn', async () => ({ agentId: `a${++n}`, model: 'claude-haiku-5-5' }))
  on('ui.render', { component: 'AbovePrompt' }, async () => beneath() as never)
}

const spawn = ($: $, subagentType = 'Explore') =>
  $.agent.spawn({ prompt: 'look', description: 'Look around', subagentType })

describe('view', () => {
  const auto: Flow = { title: 'Subagents', total: 0, done: 0, running: 0, phase: 'delegate', isFinished: false, tasks: [], isAuto: true, since: 100 }
  const run = (startedAt: number, status: AgentRun['status'], type = 'Explore'): AgentRun => ({
    id: `${startedAt}`, type, description: 'x', model: 'm', status, startedAt,
    contextTokens: 0, contextMax: 1, tokens: 0, costUsd: 0, steps: 0, round: 1,
  })

  test('counts the plain agents started since the flow began', () => {
    const f = view(auto, [run(50, 'running'), run(100, 'done'), run(120, 'running'), run(130, 'running', 'savvy-light')])
    expect([f.total, f.done, f.running, f.isFinished]).toEqual([2, 1, 1, false])
  })

  test('is done once none of them runs', () => {
    const f = view(auto, [run(100, 'done'), run(120, 'failed')])
    expect([f.total, f.done, f.isFinished, f.phase]).toEqual([2, 2, true, 'close'])
  })

  test('leaves a savvy flow as it is', () => {
    const savvy: Flow = { ...auto, isAuto: undefined, total: 3, done: 1 }
    expect(view(savvy, [run(120, 'running')])).toBe(savvy)
  })
})

test('any subagent puts the bar up', async ($, on) => {
  engine(on)
  await spawn($)
  const row = await band($, 'terminal')
  expect(await row.find({ type: 'Text', text: 'Subagents' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: 'Agents 0/1' })).toBeDefined()
})

test('a plain subagent leaves a savvy flow on the bar', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 2, done: 1, phase: 'delegate' })
  await spawn($)
  const row = await band($, 'terminal')
  expect(await row.find({ type: 'Text', text: 'Ship it' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: 'Tasks 1/2' })).toBeDefined()
})

test('shares the band: keyed band-under, under what a plugin beneath drew', async ($, on) => {
  engine(on, () => h('Box', { key: 'beneath' }, h('Text', {}, 'status line')))
  await spawn($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const root = (await (await band($, surface)).drawn()) as Node
    expect(root.props?.key).toBe('band-under:savvy-progress')
    expect(root.children?.[0]?.props?.key).toBe('beneath')
  }
})


test('agents started together share one bar', async ($, on) => {
  engine(on)
  await spawn($)
  await spawn($, 'general-purpose')
  const row = await band($, 'terminal')
  expect(await row.find({ type: 'Text', text: 'Agents 0/2' })).toBeDefined()
})
