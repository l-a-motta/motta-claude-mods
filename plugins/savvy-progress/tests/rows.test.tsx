import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { roleOf, stepTool, tally } from '../hooks/register.tsx'
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

test("an Agent call's row draws its own agent's activity strip", async ($, on) => {
  engine(on)
  await spawn($, 't1')
  await spawn($, 't2')
  const drawing = await row($, 'terminal', 'Agent', 't1')
  expect(await drawing.find({ type: 'Text', text: 'Look around' })).toBeDefined()
  expect(await drawing.find({ type: 'Text', text: '0s' })).toBeDefined()
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
  expect(await drawing.find({ type: 'Text', text: '0/2 · 0s' })).toBeDefined()
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

describe('roleOf', () => {
  const role = (type: string, model = 'claude-opus-5-5', effort?: string) => roleOf({ type, model, effort })

  test('a savvy agent wears its tier, named by it', () => {
    expect(role('savvy-flow:savvy-careful')).toEqual({ costume: 'careful', color: '#7F77DD', label: 'careful' })
  })

  test("a role the name spells out comes before the model's tier", () => {
    expect(role('hd-auditor', 'claude-haiku-5-5').costume).toBe('heavy')
    expect(role('hd-scout').costume).toBe('explore')
    expect(role('hd-developer').costume).toBe('careful')
    expect(role('code-reviewer').costume).toBe('heavy')
    expect(role('Explore').costume).toBe('explore')
    expect(role('hd-auditor').label).toBe('hd-auditor')
  })

  test('an unnamed role takes the tier its model and effort run at', () => {
    expect(role('general-purpose', 'claude-opus-5-5', 'xhigh').costume).toBe('heavy')
    expect(role('general-purpose', 'claude-opus-5-5', 'low').costume).toBe('light')
    expect(role('general-purpose', 'claude-haiku-5-5').costume).toBe('light')
    expect(role('general-purpose', 'claude-fable-5-1').costume).toBe('fable')
  })

  test("every agent's color is its model's, whatever its role", () => {
    expect(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'].map(m => role('hd-auditor', m).color)).toEqual([
      '#7F77DD', '#1D9E75', '#7FAF2E', '#D4537E',
    ])
  })

  test('the rest keep the plain crab, in their model\'s color', () => {
    const a = role('general-purpose')
    expect(a.costume).toBe('other')
    expect(role('general-purpose').color).toBe(a.color)
  })
})

describe('stepTool', () => {
  test('on, it rides in every tool list and asks subagents only, batched', () => {
    const t = stepTool(true)
    expect(t.isDeferred).toBe(false)
    expect(t.description).toContain('Subagents only')
    expect(t.description).toContain('same response as your next real tool call')
  })

  test('off, it waits behind tool search, as upstream has it', () => {
    const t = stepTool(false)
    expect(t.isDeferred).toBeUndefined()
    expect(t.description.startsWith('For savvy-flow workers')).toBe(true)
  })
})

test('a step from a subagent fills its own bar', async ($, on) => {
  engine(on)
  await spawn($, 't1')
  await $.tool.call({ tool: 'mcp__savvy-progress__step', tool_use_id: 's1', agentId: 'a1', done: 1, total: 4, note: 'reading' } as never)
  const drawing = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 80 } } as never)
  expect(await drawing.find({ type: 'Text', text: /1\/4 reading/ } as never)).toBeDefined()
})
