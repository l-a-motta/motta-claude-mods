import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { actOf, BUDGET, batchesOf, batchTimes, busySpans, laneCells, lanesOf, rangeOf, rulerScale, CHAR_BUDGET, cardParts, charEm, countNodes, endCall, endStatus, firstLine, fit, foldFinished, groupsOf, idleNote, isOverdue, NO_CARDS, reconcile, saySlot, shortName, startCall, stripColor, toolColor } from '../hooks/register.tsx'
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
    expect(idleNote(busy, 80_000)).toBe('waiting on Bash · 1m20s')
    expect(idleNote(endCall(busy, 'c1', true, 0), 50_000)).toBe('quiet 50s')
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
  const n = node as { type?: string; props?: { source?: string; label?: string; display?: string }; children?: unknown[] }
  // A hover card is hidden until its host is hovered: not drawn text.
  if (n.props?.display === 'none') return ''
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
    // Its lane stays in the timeline; its card is gone.
    expect(text.match(/Broken read/g)?.length).toBe(1)
  }
})

test("a crab's name tag is its title's first word, past a shared prefix, cut to fit", () => {
  expect(shortName('Count savvy tests')).toBe('Count')
  expect(shortName('Demo: stopped midway')).toBe('stopped')
  expect(shortName('Tour, then stop')).toBe('Tour')
  expect(shortName('Internationalization pass').endsWith('…')).toBe(true)
})

test('the pane draws hover cards on the desktop: full paths, the estimate, the toggles, the waited-for tasks; the terminal draws none', { options: { language: 'en' } }, async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', tool_use_id: 'p1', title: 'Ship it', phase: 'delegate', tasks: [{ title: 'Survey READMEs', tier: 'light' }, { title: 'Fix them', tier: 'careful', after: [1] }] } as never)
  await spawn($, 't1', 'Survey READMEs')
  await $.tool.call({ tool: 'Read', agentId: 'a1', file_path: '/x/deep/README.md' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await (await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 100 } } as never)).drawn()
    const json = JSON.stringify(drawn)
    if (surface === 'terminal') {
      // No card at all, so no host lights up for one; the rows still draw.
      expect(textOf(drawn)).toMatch(/Survey READMEs/)
      expect(json).not.toContain('"position":"absolute"')
      expect(json).not.toContain('Folds the pane to one strip of crabs')
      expect(json).not.toContain('Cost ≈: tokens × the price table, per model')
      expect(json).not.toContain('"hover":{"backgroundColor":"#ffffff10"}')
      continue
    }
    // A card line is pieces: the path's folder dim and its file bold, labels dim and values plain.
    expect(json).toContain('{"bold":false,"italic":false,"color":"#9c9a94"},"children":["/x/deep/"]')
    expect(json).toContain('{"bold":true,"italic":false},"children":["README.md"]')
    expect(json).toContain('" tokens at "]},"$1/$5"')
    expect(json).toContain('"claude-haiku-5-5",{"type":"Text","props":{"bold":false,"italic":false,"color":"#6f6d68"},"children":[" · "]}')
    expect(json).toContain('Folds the pane to one strip of crabs')
    expect(json).toContain('Cost ≈: tokens × the price table, per model')
    expect(json).toContain('"●"," 1. Survey READMEs"')
    expect(json).toContain('tip:compact')
    // The compact toggle's card is an action: a blue bar.
    expect(json).toMatch(/"width":0.25,"backgroundColor":"#8db4f0"/)
  }
})

test("a failed agent's card is red and marks its ✗; the Failed toggle's card is an action", { options: { language: 'en' } }, async ($, on) => {
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
  const json = JSON.stringify(await (await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 100 } } as never)).drawn())
  expect(json).toMatch(/"width":0.25,"backgroundColor":"#ef8a80"/)
  expect(json).toContain('{"bold":false,"italic":false,"color":"#ef8a80"},"children":["✗"]')
  expect(json).toContain('Hides the failed agents')
})

// --- the ladder: the desktop goes blank past about 2,000 elements, so the pane
// drops info cards, then every card, then folds Finished.

test('Finished keeps its newest 20 agents, 10 or none when tight; Show is honored below that', () => {
  const groups = [
    { key: 'g1', title: 'x', span: 0, agents: Array.from({ length: 15 }, (_, i) => run({ id: `a${i}` })) },
    { key: 'g2', title: 'y', span: 0, agents: Array.from({ length: 15 }, (_, i) => run({ id: `b${i}` })) },
  ]
  const at = (level: number, isShown: boolean) => {
    const f = foldFinished(groups, level, isShown)
    return [f.shown.map(g => g.agents.length), f.hidden]
  }
  expect(at(0, false)).toEqual([[15, 5], 10])
  expect(at(2, true)).toEqual([[15, 15], 0])
  expect(at(3, true)).toEqual([[10], 20])
  expect(at(4, false)).toEqual([[], 30])
})

test('the desktop climbs the levels until the tree fits; the terminal draws the one with no cards', () => {
  // A tree of `n` elements: a Box holding n - 1 Texts.
  const tree = (n: number) => ({ type: 'Box', props: {}, children: Array.from({ length: n - 1 }, () => ({ type: 'Text', props: {}, children: ['x'] })) })
  const sizes = [3000, 2000, 1500, 1200, 400]
  const levelOf = (surface: string) => {
    const drawn = fit(surface, 4, level => ({ ...tree(sizes[level]!), level }))
    return [drawn.level, countNodes(drawn)]
  }
  expect(levelOf('desktop')).toEqual([4, 400])
  // Whatever its size: no cards, and Finished not folded.
  expect(levelOf('terminal')).toEqual([NO_CARDS, sizes[NO_CARDS]])
  // Under the budget the desktop keeps every card.
  expect(fit('desktop', 4, level => ({ ...tree(10), level })).level).toBe(0)
})

// Agents that each read a file and finished, a second apart.
const finishMany = async ($: $, clock: ReturnType<typeof engine>, n: number) => {
  for (let i = 1; i <= n; i++) {
    await clock.advance(1_000)
    await spawn($, `t${i}`, `Survey part ${i}`)
    await $.tool.call({ tool: 'Read', agentId: `a${i}`, file_path: `/x/deep/part-${i}.md` } as never)
    await $.turn.complete({ turnId: `r${i}`, answer: 'Done.', durationMs: 1, isAborted: false, agentId: `a${i}`, reason: 'answer' })
  }
}
const mountPane = ($: $, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 100 } } as never)

test('older finished agents fold under one line, and its press shows them', { options: { language: 'en' } }, async ($, on) => {
  const clock = engine(on)
  await finishMany($, clock, 25)
  const panes = await Promise.all((['terminal', 'desktop'] as const).map(surface => mountPane($, surface)))
  for (const pane of panes) {
    const text = textOf(await pane.drawn())
    expect(text).toMatch(/Finished · 25/)
    expect(text).toMatch(/5 older finished agents · Show/)
    expect(text).toMatch(/Survey part 6(?!\d)/)
    expect(text).not.toMatch(/Survey part 5(?!\d)/)
  }
  await panes[1]!.press({ key: 'older' })
  for (const pane of panes) {
    const text = textOf(await pane.drawn())
    expect(text).toMatch(/5 older finished agents · Hide/)
    expect(text).toMatch(/Survey part 1(?!\d)/)
  }
})

test('over the budget the desktop drops info cards first, keeping the action ones; the terminal draws none', { options: { language: 'en' } }, async ($, on) => {
  const clock = engine(on)
  await finishMany($, clock, 60)
  const panes = await Promise.all((['terminal', 'desktop'] as const).map(surface => mountPane($, surface)))
  await panes[1]!.press({ key: 'older' })
  const desktop = await panes[1]!.drawn()
  const json = JSON.stringify(desktop)
  // 60 agent blocks are too many characters even shown: Finished folds to fit.
  expect(textOf(desktop)).toMatch(/older finished agents · folded to fit/)
  expect(countNodes(desktop)).toBeLessThanOrEqual(BUDGET)
  expect(json.length).toBeLessThanOrEqual(CHAR_BUDGET)
  // A card's bar in its tone: no gray (info) one is left, the blue (action) ones are.
  expect(json).not.toMatch(/"width":0.25,"backgroundColor":"#6f6d68"/)
  // Folding is the step after "no cards", so the action cards are gone too.
  expect(json).not.toMatch(/"width":0.25,"backgroundColor":"#8db4f0"/)
  // An agent's host no longer lights up for a card it doesn't have.
  expect(json).not.toContain('"hover":{"backgroundColor":"#ffffff10"}')
  // The terminal has no budget and draws no cards: no card's border, no host lit, nothing folded to fit.
  const terminalTree = await panes[0]!.drawn()
  const terminal = JSON.stringify(terminalTree)
  expect(terminal).not.toContain('"position":"absolute"')
  expect(terminal).not.toMatch(/"borderColor":"#6f6d68"/)
  expect(terminal).not.toContain('"hover":{"backgroundColor":"#ffffff10"}')
  expect(textOf(terminalTree)).not.toMatch(/folded to fit/)
})

describe("the timeline", () => {
  test("lanes run in order of start, each a share of one axis from the first start to the last end", () => {
    const { lanes, span, hidden } = lanesOf([run({ id: "b", startedAt: 4_000, endedAt: 10_000, status: "done" }), run({ id: "a", startedAt: 0, endedAt: 2_000, status: "done" }), run({ id: "c", startedAt: 6_000 })], 8_000)
    expect(span).toBe(10_000)
    expect(lanes.map(l => [l.n, l.agent.id, l.from, l.to])).toEqual([[1, "a", 0, 0.2], [2, "b", 0.4, 1], [3, "c", 0.6, 0.8]])
    expect(hidden).toBe(0)
  })

  test("past twenty, the earlier ones are counted, not drawn", () => {
    const list = Array.from({ length: 23 }, (_, i) => run({ id: `a${i}`, startedAt: i * 1_000, endedAt: i * 1_000 + 500, status: "done" }))
    const { lanes, hidden } = lanesOf(list, 30_000)
    expect(hidden).toBe(3)
    expect(lanes[0]?.n).toBe(4)
  })

  test("a text lane is dots outside its run and its ticks spread over it, a failed one red", () => {
    const a = run({ ticks: [{ id: "t1", family: "read", reach: "project", state: "ok" }, { id: "t2", family: "run", reach: "project", state: "failed" }] })
    const cells = laneCells({ n: 1, agent: a, from: 0.5, to: 1 }, 10)
    expect(cells.map(c => c.ch).join("")).toBe("·····▮▮▮▮▮")
    expect(cells[9]?.color).toBe("#E24B4A")
    expect(cells[5]?.color).not.toBe(cells[9]?.color)
  })
})

test("the timeline sits open on top of the pane, numbers each agent as its card does, and its press folds it", { options: { language: "en" } }, async ($, on) => {
  const clock = engine(on)
  await finishMany($, clock, 3)
  const panes = await Promise.all((["terminal", "desktop"] as const).map(surface => mountPane($, surface)))
  for (const pane of panes) {
    const text = textOf(await pane.drawn())
    expect(text).toMatch(/▾ agents · 0 running · 3 total/)
    expect(text).toMatch(/Batch 1/)
    expect(text).toMatch(/· 3 agents/)
    expect(text.indexOf("agents · 0 running")).toBeLessThan(text.indexOf("Finished · 3"))
    // Once in its lane, once on its card.
    expect(text.match(/#1 ?Survey part 1/g)?.length).toBe(2)
    expect(text).toMatch(/#3 ?Survey part 3/)
  }
  await panes[1]!.press({ key: "lanes" })
  for (const pane of panes) {
    const text = textOf(await pane.drawn())
    expect(text).toMatch(/▸ agents · 0 running · 3 total/)
    expect(text).not.toMatch(/Batch 1/)
    expect(text.match(/#1 ?Survey part 1/g)?.length).toBe(1)
  }
})

describe("batches and the ruler", () => {
  const at = (s: number) => s * 1000
  const list = [
    run({ id: "a", anchor: "t1", startedAt: at(0), endedAt: at(29), status: "done" }),
    run({ id: "b", anchor: "t2", startedAt: at(1), endedAt: at(12), status: "done" }),
    run({ id: "c", anchor: "t3", startedAt: at(1095), endedAt: at(1102), status: "failed" }),
    run({ id: "d", anchor: "w1", startedAt: at(1200) }),
    run({ id: "e", anchor: "w1", startedAt: at(1230) }),
  ]

  test("agents started together, or by one call, make a batch; numbered in order of start", () => {
    const bs = batchesOf(list, at(1300))
    expect(bs.map(b => [b.n, b.agents.map(a => a.id).join(""), b.failed, b.running])).toEqual([[1, "ab", 0, 0], [2, "c", 1, 0], [3, "de", 0, 2]])
    expect([bs[0]!.start, bs[0]!.end, bs[2]!.end]).toEqual([0, at(29), at(1300)])
  })

  test("idle time longer than ten seconds splits the ruler; each stretch gets room by how long it ran", () => {
    const spans = busySpans(batchesOf(list, at(1300)))
    expect(spans.length).toBe(3)
    const { boxes, at: x } = rulerScale(spans, 400, 22, 36)
    expect(boxes.map(b => Math.round(b.x))).toEqual([0, Math.round(boxes[0]!.w + 22), Math.round(boxes[0]!.w + boxes[1]!.w + 44)])
    expect(Math.round(boxes.at(-1)!.x + boxes.at(-1)!.w)).toBe(400)
    expect(boxes[1]!.w).toBeGreaterThanOrEqual(36)
    expect(Math.round(x(at(1095)))).toBe(Math.round(boxes[1]!.x))
  })

  test("times read on the clock, without seconds; a second line says when a batch started, ended, ran and idled before", () => {
    const t = new Date(2026, 9, 15, 14, 2, 10).getTime()
    expect(rangeOf(t, t + 3 * 60_000, false)).toBe("14:02–14:05")
    expect(rangeOf(t, t + 20_000, true)).toBe("14:02–now")
    const bs = batchesOf([run({ id: "a", startedAt: t, endedAt: t + 172_000, status: "done" }), run({ id: "b", startedAt: t + 782_000, endedAt: t + 873_000, status: "done" })], t + 900_000)
    expect(batchTimes(bs[1]!, bs[0])).toBe("started 14:15 · ended 14:16 · ran 1m31s · 10m idle before")
    // Begun and ended within one minute: one clock time.
    const quick = batchesOf([run({ id: "q", startedAt: t, endedAt: t + 29_000, status: "done" })], t + 30_000)
    expect(batchTimes(quick[0]!, undefined)).toBe("at 14:02 · ran 29s")
    expect(batchTimes({ ...bs[1]!, running: 1 }, bs[0])).toMatch(/^started 14:15 · running · ran/)
  })

  test("agents your turn set going are one batch, named by the turn, however far apart they start", () => {
    const bs = batchesOf(
      [
        run({ id: "a", turn: 3, prompt: "spawn some agents", startedAt: 0, endedAt: 5_000, status: "done" }),
        run({ id: "b", turn: 3, prompt: "spawn some agents", startedAt: 90_000, endedAt: 95_000, status: "done" }),
        run({ id: "c", turn: 4, prompt: "and another", startedAt: 92_000 }),
      ],
      100_000,
    )
    expect(bs.map(b => [b.label, b.key, b.agents.map(a => a.id).join(""), b.prompt])).toEqual([
      ["Turn 3", "turn-3", "ab", "spawn some agents"],
      ["Turn 4", "turn-4", "c", "and another"],
    ])
  })
})

test("the newest batch is open as lanes, older ones fold to a strip until pressed", { options: { language: "en" } }, async ($, on) => {
  const clock = engine(on)
  await finishMany($, clock, 2)
  await clock.advance(60_000)
  await spawn($, "t9", "Late survey")
  const panes = await Promise.all((["terminal", "desktop"] as const).map(surface => mountPane($, surface)))
  for (const pane of panes) {
    const text = textOf(await pane.drawn())
    expect(text).toMatch(/Batch 1/)
    expect(text).toMatch(/Batch 2/)
    // Batch 2 is open: its lane and its card; batch 1 folded: its agents on their cards alone.
    expect(text.match(/#3 ?Late survey/g)?.length).toBe(2)
    expect(text.match(/#1 ?Survey part 1/g)?.length).toBe(1)
  }
  const batch1 = (await panes[1]!.findAll({ type: "Button" })).find(b => String(b.props.key).startsWith("batch-") && String(b.props.label).includes("Batch 1"))
  await panes[1]!.press({ key: String(batch1?.props.key) })
  for (const pane of panes) expect(textOf(await pane.drawn()).match(/#1 ?Survey part 1/g)?.length).toBe(2)
})
