import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { actOf, cardParts, charEm, endCall, endStatus, firstLine, groupsOf, idleNote, isOverdue, reconcile, saySlot, shortName, startCall, stripColor, toolColor } from '../hooks/register.tsx'
import type { AgentRun } from '../types'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'a1', agentId: 'a1', type: 'Explore', description: 'Look around', model: 'claude-haiku-5-5', status: 'running', startedAt: 0,
  contextTokens: 0, contextMax: 1, tokens: 0, costUsd: 0, steps: 0, round: 1, ...over,
})

describe('the record of tool calls', () => {
  test('a call is counted by kind, ticked, and put on the trail', () => {
    const a = startCall(run(), 'c1', 'Grep', { pattern: 'on\\(' }, 5)
    expect([a.toolCalls, a.kinds?.read, a.ticks?.[0]?.state, a.trail?.[0]?.text, a.activeAt]).toEqual([1, 1, 'running', '→ Grep on\\(', 5])
  })

  test("a late ✗ lands on its own tick after older ones fell off the strip", () => {
    let a = run()
    for (let i = 0; i < 85; i++) a = startCall(a, `c${i}`, 'Read', { file_path: `/x/${i}.md` }, i)
    a = endCall(a, 'c40', false, 99)
    expect(a.ticks).toHaveLength(80)
    expect(a.ticks?.find(t => t.id === 'c40')?.state).toBe('failed')
    expect(a.ticks?.filter(t => t.state === 'failed')).toHaveLength(1)
    expect(a.failed).toBe(1)
  })

  test('the trail keeps three, and one request keeps one entry, thinking giving way to text', () => {
    let a = startCall(run(), 'c1', 'Read', { file_path: '/x/a.md' }, 1)
    a = saySlot(a, 's1', 'think', 'Which file next', 2)
    a = saySlot(a, 's1', 'say', 'Opening the config', 3)
    expect(a.trail?.map(t => t.kind)).toEqual(['tool', 'say'])
    a = startCall(a, 'c2', 'Bash', { command: 'ls' }, 4)
    a = startCall(a, 'c3', 'Edit', { file_path: '/x/b.ts' }, 5)
    expect(a.trail?.map(t => t.id)).toEqual(['s1', 'c2', 'c3'])
  })

  test('files are listed once, newest first, each as the riskiest thing done to it', () => {
    let a = startCall(run(), 'c1', 'Edit', { file_path: 'C:/repo/a.ts', old_string: 'x', new_string: 'y' }, 1, 'C:/repo')
    a = startCall(a, 'c2', 'Read', { file_path: 'C:/elsewhere/b.ts' }, 2, 'C:/repo')
    a = startCall(a, 'c3', 'Read', { file_path: 'C:/repo/a.ts' }, 3, 'C:/repo')
    expect(a.files).toEqual([
      { path: 'C:/repo/a.ts', family: 'change', reach: 'project' },
      { path: 'C:/elsewhere/b.ts', family: 'read', reach: 'machine' },
    ])
  })

  test("a shell command's files take its pieces' families; running one outranks reading it, whenever", () => {
    let a = startCall(run(), 'c1', 'Bash', { command: 'node build.js && cat "notes.md" > out.txt' }, 1, 'C:/repo')
    const fam = (x: typeof a) => Object.fromEntries((x.files ?? []).map(f => [f.path, f.family]))
    expect(fam(a)).toEqual({ 'build.js': 'run', 'notes.md': 'read', 'out.txt': 'change' })
    a = startCall(a, 'c2', 'Read', { file_path: 'build.js' }, 2, 'C:/repo')
    expect(fam(a)['build.js']).toBe('run')
    a = startCall(a, 'c3', 'Bash', { command: 'git -C C:/repo status && ping -n 3 127.0.0.1' }, 3, 'C:/repo')
    expect(a.files?.map(f => f.path)).not.toContain('127.0.0.1')
    expect(a.files?.map(f => f.path)).not.toContain('C:/repo')
  })

  test('text widths go letter by letter: narrow names get narrow pills', () => {
    const w = (t: string) => [...t].reduce((n, ch) => n + charEm(ch), 0)
    expect(w('register.tsx')).toBeLessThan(w('wwwwwwww.mmm'))
    expect(w('register.tsx')).toBeLessThan(12 * 0.56 * 0.85)
  })

  test("a call takes tool-borders' family and reach, read off its input", () => {
    const at = (tool: string, input: Record<string, unknown>) => {
      const t = startCall(run(), 'c', tool, input, 0, 'C:/repo').ticks?.[0]
      return `${t?.family}/${t?.reach}`
    }
    expect(at('Bash', { command: 'ls -la' })).toBe('read/project')
    expect(at('Bash', { command: 'npm install x' })).toBe('change/internet')
    expect(at('Write', { file_path: 'C:/elsewhere/a.md', content: 'x' })).toBe('change/machine')
    expect(at('WebFetch', { url: 'https://example.com' })).toBe('read/internet')
    expect(toolColor('read', 'internet')).toBe('#7dd3fc')
    expect(toolColor('search', undefined)).toBe('#6f6f6f')
  })

  test("an answer's first line, its markdown dropped", () => {
    expect(firstLine('\n## **Only 2** of 8 have a `README`.\nMore.')).toBe('Only 2 of 8 have a README.')
  })
})

describe('the card', () => {
  test('a running agent shows its trail newest first; a finished one its answer', () => {
    let a = startCall(run(), 'c1', 'Read', { file_path: '/x/a.md' }, 1)
    a = saySlot(a, 's1', 'say', 'Reading done', 2)
    expect(cardParts(a, 3).trail.map(t => t.text)).toEqual(['Reading done', '→ Read a.md'])
    const done = { ...a, status: 'done' as const, result: 'All good.' }
    expect([cardParts(done, 3).trail, cardParts(done, 3).result]).toEqual([[], 'All good.'])
  })

  test('quiet for five minutes, a running agent is overdue; its next sign of life clears it', () => {
    const a = startCall(run(), 'c1', 'Bash', { command: 'npm test' }, 0)
    expect([isOverdue(a, 299_000), isOverdue(a, 300_000), isOverdue(endCall(a, 'c1', true, 290_000), 300_000)]).toEqual([false, true, false])
    expect(isOverdue({ ...a, status: 'done' }, 900_000)).toBe(false)
    expect(stripColor([a], 300_000)).toBe('#BA7517')
  })

  test('quiet for 45 s: waiting on a running tool, or just quiet', () => {
    const busy = startCall(run(), 'c1', 'Bash', { command: 'npm test' }, 0)
    expect(idleNote(busy, 30_000)).toBe('')
    expect(idleNote(busy, 80_000)).toBe('waiting on Bash · 1:20')
    expect(idleNote(endCall(busy, 'c1', true, 0), 50_000)).toBe('quiet 0:50')
  })

  test('the crab acts out the running tool, its words or its thoughts', () => {
    const a = startCall(run(), 'c1', 'Grep', { pattern: 'x' }, 0)
    expect(actOf(a.trail?.at(-1))).toBe('read')
    expect(actOf(endCall(a, 'c1', true, 1).trail?.at(-1))).toBe('')
    expect(actOf(saySlot(a, 's', 'think', 'hm', 2).trail?.at(-1))).toBe('think')
  })
})

describe('the pane order', () => {
  test('failed agents are pinned on top; the rest go by the call that started them', () => {
    const list = [
      run({ id: 'x1', agentId: 'x1', anchor: 't1', startedAt: 1, status: 'done', endedAt: 5 }),
      run({ id: 'x2', agentId: 'x2', anchor: 't1', startedAt: 2, status: 'failed', endedAt: 4 }),
      run({ id: 'y1', agentId: 'y1', anchor: 't2', startedAt: 3 }),
      run({ id: 'y2', agentId: 'y2', anchor: 't2', startedAt: 4, isWorkflow: true }),
    ]
    const g = groupsOf(list, 10)
    expect(g.failed.map(a => a.id)).toEqual(['x2'])
    expect(g.running.map(x => [x.key, x.title, x.agents.map(a => a.id)])).toEqual([['t2', 'Workflow', ['y2', 'y1']]])
    expect(g.finished.map(x => x.agents.map(a => a.id))).toEqual([['x1']])
  })
})

// --- drawn: the strip on a call's row, the roll call in the band, the answer on a card.

function engine(on: On) {
  const clock = mock.clock(on)
  let n = 0
  on('agent.spawn', async () => ({ agentId: `a${++n}`, model: 'claude-haiku-5-5' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'ToolUse' }, async () => ({ type: 'engine', ref: 0 }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'engine', ref: 1 }) as never)
  on('tool.call', async ($, e) => (e.tool === 'Bash' ? { result: 'exit 1', text: 'exit 1', isError: true } : { result: 'ok' }) as never)
  on('turn.complete', async () => ({ text: 'ok' }) as never)
  return clock
}

const spawn = ($: $, call: string, description: string) =>
  $.agent.spawn({
    prompt: 'look', description, subagentType: 'Explore', tool_use_id: call,
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })

const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; props?: { source?: string; label?: string }; children?: unknown[] }
  if (n.type === 'Button') return n.props?.label ?? ''
  if (n.type === 'Svg') return (n.props?.source ?? '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  return (n.children ?? []).map(textOf).join('')
}

const ROW = (requestId: string) => ({ tool_use_id: requestId, tool: 'Agent', input: {}, isRunning: false, isErrored: false, isInterrupted: false })
const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

test("a call's row strips its agent's calls, a red tick for the one that failed", async ($, on) => {
  engine(on)
  await spawn($, 't1', 'Survey READMEs')
  await $.tool.call({ tool: 'Read', agentId: 'a1', file_path: '/x/README.md' } as never)
  await $.tool.call({ tool: 'Bash', agentId: 'a1', command: 'false' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await (await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'ToolUse', requestId: 't1', props: ROW('t1') } as never)).drawn()
    const text = textOf(drawn)
    expect(text).toMatch(/Survey READMEs/)
    expect(text).toMatch(/2 tools · ✗ 1/)
    const json = JSON.stringify(drawn)
    // Read in one of tool-borders' read blues, as far as it reached.
    expect(json).toMatch(surface === 'terminal' ? /"color":"#(3f5670|5b8fcc|7dd3fc)"[^}]*\},"children":\["▮"\]/ : /fill=\\"#(3f5670|5b8fcc|7dd3fc)\\"/)
    expect(json).toMatch(/#E24B4A/)
  }
})

test('the band calls the roll: totals of the agents at work together', async ($, on) => {
  engine(on)
  await spawn($, 't1', 'Map the repo')
  await spawn($, 't2', 'Count tests')
  await $.tool.call({ tool: 'Read', agentId: 'a1', file_path: '/x/a.md' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await (await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND } as never)).drawn()
    expect(textOf(drawn)).toMatch(/2running1tool\d+s\$0\.00✕$/)
  }
})

test("a finished agent's card quotes the first line of its answer", async ($, on) => {
  engine(on)
  await spawn($, 't1', 'Survey READMEs')
  await $.turn.complete({ turnId: 't', answer: 'Only 2 of 8 have one.\nDetails follow.', durationMs: 1, isAborted: false, agentId: 'a1', reason: 'answer' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await (await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 100 } } as never)).drawn()
    expect(textOf(drawn)).toMatch(/“Only 2 of 8 have one\.”/)
  }
})

describe('stopped', () => {
  test('a turn ends done on an answer, stopped on an interruption, failed otherwise', () => {
    expect(['answer', 'aborted', 'error', 'refusal'].map(endStatus)).toEqual(['done', 'stopped', 'failed', 'failed'])
  })

  test("the engine's list ends what savvy still has running; an agent it does not name is left", () => {
    let a = startCall(run({ id: 'k', agentId: 'k' }), 'c1', 'Read', { file_path: 'x' }, 0)
    const list = [a, run({ id: 'f', agentId: 'f' }), run({ id: 'c', agentId: 'c' }), run({ id: 'w', agentId: 'w' }), run({ id: 'i', agentId: 'i' })]
    const engine = [{ id: 'k', status: 'killed' }, { id: 'f', status: 'failed' }, { id: 'c', status: 'completed' }, { id: 'i', status: 'idle' }]
    const out = reconcile(list, engine, 9)
    expect(out.map(x => x.status)).toEqual(['stopped', 'failed', 'done', 'running', 'running'])
    a = out[0]!
    expect([a.endedAt, a.ticks?.[0]?.state, a.trail?.[0]?.state]).toEqual([9, 'failed', 'failed'])
  })

  test("the strip's dot: the agent's model while it runs, then red, green, or gray when all stopped", () => {
    expect(stripColor([run()])).toBe('#7FAF2E')
    expect(stripColor([run(), run({ id: 'b' })])).toBe('#8a8a86')
    expect(stripColor([run({ status: 'stopped' }), run({ id: 'b', status: 'failed' })])).toBe('#E24B4A')
    expect(stripColor([run({ status: 'stopped' }), run({ id: 'b', status: 'done' })])).toBe('#3B9C5F')
    expect(stripColor([run({ status: 'stopped' })])).toBe('#8a8a86')
  })
})

test('an agent the engine killed goes to Finished, stopped, within a tick', { options: { language: 'en' } }, async ($, on) => {
  const clock = engine(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('tool.register', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: {} }) as never)
  let killed = false
  // The engine's list of agents: a1 running, then killed from the tasks list.
  const hook = on as unknown as (event: string, h: () => Promise<unknown>) => void
  hook('agent.list', async () => ({ value: [{ id: 'a1', description: 'x', type: 'Explore', status: killed ? 'killed' : 'running' }] }))
  await $.session.start({ cwd: '.', surface: null, isInteractive: true })
  await spawn($, 't1', 'Long read')
  killed = true
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await (await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 100 } } as never)).drawn()
    const text = textOf(drawn)
    expect(text).toMatch(/Finished · 1/)
    expect(text).toMatch(/stopped/)
    expect(text).not.toMatch(/Failed ·/)
  }
})

test('Failed folds under its header as Finished does, on each surface', { options: { language: 'en' } }, async ($, on) => {
  const clock = engine(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('tool.register', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: {} }) as never)
  let failed = false
  const hook = on as unknown as (event: string, h: () => Promise<unknown>) => void
  hook('agent.list', async () => ({ value: [{ id: 'a1', description: 'x', type: 'Explore', status: failed ? 'failed' : 'running' }] }))
  await $.session.start({ cwd: '.', surface: null, isInteractive: true })
  await spawn($, 't1', 'Broken read')
  failed = true
  await clock.advance(1_000)
  const panes = await Promise.all(
    (['terminal', 'desktop'] as const).map(surface =>
      $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 100 } } as never),
    ),
  )
  for (const pane of panes) {
    const text = textOf(await pane.drawn())
    expect(text).toMatch(/Failed · 1/)
    expect(text).toMatch(/Broken read/)
  }
  await panes[1]!.press({ key: 'failed' })
  for (const pane of panes) {
    const text = textOf(await pane.drawn())
    expect(text).toMatch(/Failed · 1/)
    expect(text).not.toMatch(/Broken read/)
  }
})

test("a crab's name tag is its title's first word, past a shared prefix, cut to fit", () => {
  expect(shortName('Count savvy tests')).toBe('Count')
  expect(shortName('Demo: stopped midway')).toBe('stopped')
  expect(shortName('Tour, then stop')).toBe('Tour')
  expect(shortName('Internationalization pass').endsWith('…')).toBe(true)
})
