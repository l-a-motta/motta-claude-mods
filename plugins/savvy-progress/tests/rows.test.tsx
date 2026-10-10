import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { tally } from '../hooks/register.tsx'
import type { AgentRun } from '../types'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Node = { type?: string; props?: { key?: string }; children?: Node[] }

const PROGRESS = 'mcp__savvy-progress__progress'

// The engine beneath: a clock, every spawn starting under its own id, the
// engine's own tool rows, and panes placed. Returns the panes opened.
function engine(on: On) {
  mock.clock(on)
  let n = 0
  const opened: string[] = []
  on('agent.spawn', async () => ({ agentId: `a${++n}`, model: 'claude-haiku-5-5' }))
  on('ui.render', { component: 'ToolUse' }, async () => ({ type: 'engine', ref: 0 }) as never)
  on('ui.open', async ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return { opened }
}

// The spawn an Agent call makes (`call` its tool_use_id), or a workflow run's
// agent (`runId`), every one of whose spawns carries the Workflow call's id.
const spawn = ($: $, call: string, subagentType = 'Explore', runId?: string) =>
  $.agent.spawn({
    prompt: 'look',
    description: 'Look around',
    subagentType,
    tool_use_id: call,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    ...(runId ? { workflow: { runId, agentIndex: 1 } } : {}),
  })

const row = ($: $, surface: 'terminal' | 'desktop', tool: string, requestId: string) =>
  $.ui.mount({
    plugin: 'savvy-progress',
    surface,
    component: 'ToolUse',
    requestId,
    props: { tool_use_id: requestId, tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false },
  })

// A progress call under a known id, as the model's tool call carries one.
const progress = ($: $, id: string, input: Record<string, unknown>) =>
  $.tool.call({ tool: PROGRESS, tool_use_id: id, ...input } as never)

describe('tally', () => {
  const run = (anchor: string, status: AgentRun['status']): AgentRun => ({
    id: `${anchor}-${status}-${Math.round(status.length)}`, anchor, type: 'Explore', description: 'x', model: 'm', status, startedAt: 0,
    contextTokens: 0, contextMax: 1, tokens: 0, costUsd: 0, steps: 0, round: 1,
  })

  test("counts the call's own agents", () => {
    const f = tally('w1', [run('w1', 'done'), run('w1', 'running'), run('t9', 'running')], 'Workflow')
    expect([f.total, f.done, f.running, f.isFinished, f.kind]).toEqual([2, 1, 1, false, 'agents'])
  })

  test('is done once none of them runs', () => {
    const f = tally('w1', [run('w1', 'done'), run('w1', 'failed')], 'Workflow')
    expect([f.total, f.done, f.isFinished, f.phase]).toEqual([2, 2, true, 'close'])
  })
})

test("an Agent call's row draws its own agent's bar", async ($, on) => {
  engine(on)
  await spawn($, 't1')
  await spawn($, 't2')
  const drawing = await row($, 'terminal', 'Agent', 't1')
  expect(await drawing.find({ type: 'Text', text: 'Subagents' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Agents 0/1' })).toBeDefined()
  const root = (await (await row($, 'desktop', 'Agent', 't2')).drawn()) as Node
  expect(root.props?.key).toBe('savvy-row')
  expect(root.children?.[0]?.type).toBe('engine')
})

test("a Workflow call's row counts its whole run", async ($, on) => {
  engine(on)
  await spawn($, 'w1', 'general-purpose', 'wf_1')
  await spawn($, 'w1', 'general-purpose', 'wf_1')
  await spawn($, 't9')
  const drawing = await row($, 'terminal', 'Workflow', 'w1')
  expect(await drawing.find({ type: 'Text', text: 'Workflow' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: 'Agents 0/2' })).toBeDefined()
})

test('other tools, and calls with no agents, are left as the engine draws them', async ($, on) => {
  engine(on)
  await spawn($, 't1')
  for (const [tool, id] of [['Bash', 't1'], ['Agent', 'nope']]) {
    const root = (await (await row($, 'desktop', tool ?? '', id ?? '')).drawn()) as Node
    expect(root.type).toBe('engine')
  }
})

test("the row draws the engine's own row, then the bar, on each surface", async ($, on) => {
  engine(on)
  await progress($, 'p1', { title: 'Ship it', total: 2, done: 1, phase: 'delegate' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const drawing = await row($, surface, PROGRESS, 'p1')
    const root = (await drawing.drawn()) as Node
    expect(root.props?.key).toBe('savvy-row')
    expect(root.children?.[0]?.type).toBe('engine')
    expect(await drawing.find({ key: 'savvy-agents' })).toBeDefined()
    if (surface === 'desktop') expect(await drawing.find({ type: 'Svg' })).toBeDefined()
  }
})

test("a savvy flow draws on its latest progress call's row", async ($, on) => {
  engine(on)
  await progress($, 'p1', { title: 'Ship it', total: 2, done: 1, phase: 'delegate' })
  const live = await row($, 'terminal', PROGRESS, 'p1')
  expect(await live.find({ type: 'Text', text: 'Ship it' })).toBeDefined()
  expect(await live.find({ type: 'Text', text: 'Tasks 1/2' })).toBeDefined()

  await progress($, 'p2', { done: 2 })
  await live.redraw()
  expect(((await live.drawn()) as Node).type).toBe('engine')
  expect(await (await row($, 'terminal', PROGRESS, 'p2')).find({ type: 'Text', text: 'Tasks 2/2' })).toBeDefined()
})

test('a flow that ends keeps its last state on its row when the next one starts', async ($, on) => {
  engine(on)
  await progress($, 'p1', { title: 'Ship it', total: 1, done: 1, finished: true })
  await progress($, 'p2', { title: 'Next thing', total: 3, phase: 'plan' })
  expect(await (await row($, 'terminal', PROGRESS, 'p1')).find({ type: 'Text', text: 'Done' })).toBeDefined()
  expect(await (await row($, 'terminal', PROGRESS, 'p2')).find({ type: 'Text', text: 'Plan' })).toBeDefined()
})

test('a plain subagent opens the agents panel once per call', async ($, on) => {
  const { opened } = engine(on)
  await spawn($, 't1')
  expect(opened).toEqual(['savvy-agents'])
})
