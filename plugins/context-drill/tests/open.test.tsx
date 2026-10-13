import { expect, test } from 'claude-code/testing'

import { brailleRuns, litSquares, squaresSvg } from '../hooks/bars.ts'
import { compactSummary, config, figure, growth, sections, short, shortPath, startupLine, fillLevel, transcriptWeights } from '../hooks/register.tsx'

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 12_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 240_000, color: 'purple', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 600_000, color: 'subtle', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 360_000,
  maxTokens: 1_000_000,
  percentage: 36,
  gridRows: [],
  memoryFiles: [{ path: 'C:/code/CLAUDE.md', type: 'Project', tokens: 900 }],
  mcpTools: [
    { name: 'mcp__a__one', serverName: 'a', tokens: 300, isLoaded: true },
    { name: 'mcp__a__two', serverName: 'a', tokens: 200, isLoaded: false },
    { name: 'mcp__b__one', serverName: 'b', tokens: 1_000, isLoaded: true },
    { name: 'mcp__c__one', serverName: 'c', tokens: 100, isLoaded: false },
  ],
  agents: [],
  isAutoCompactEnabled: true,
  autoCompactThreshold: 835_000,
  apiUsage: { input_tokens: 4_900, output_tokens: 800, cache_read_input_tokens: 104_000, cache_creation_input_tokens: 9_100 },
}

const MESSAGES = [
  { role: 'user', text: 'read the types', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      { tool_use_id: '1', tool: 'Read', input: { file_path: 'C:/code/types/index.d.ts' }, text: 'x'.repeat(8_000) },
      { tool_use_id: '2', tool: 'Bash', input: { command: 'ls' }, text: 'y'.repeat(400) },
      { tool_use_id: '3', tool: 'Read', input: { file_path: 'C:/code/a.ts' }, text: 'z'.repeat(2_000) },
    ],
  },
]

test('groups MCP tools by server counting loaded tools alone, largest first, marks idle servers and leaves empty sections out', () => {
  const got = sections(BREAKDOWN as never)
  expect(got.map(s => s.title)).toEqual(['Memory files', 'MCP tools'])
  expect(got[1]?.items).toEqual([
    { name: 'b', tokens: 1_000, note: '1/1 loaded' },
    { name: 'a', tokens: 300, note: '1/2 loaded' },
    { name: 'c', tokens: 0, note: '0/1 loaded', isIdle: true },
  ])
  expect(short(1_234)).toBe('1.2k')
})

test('says where auto-compact fires and about how many turns are left', () => {
  expect(compactSummary(835_000, 360_000, 1_000_000, 12_000)).toBe('Auto-compact at 835k (84%) · about 40 turns before it fires')
  expect(compactSummary(835_000, 360_000, 1_000_000, null)).toBe('Auto-compact at 835k (84%)')
  expect(compactSummary(null, 360_000, 1_000_000, 12_000)).toBe('Auto-compact off')
})

test('config reads each option, the manifest defaults filling the rest', () => {
  const c = config({ barWidth: '20', heaviest: 'off', sectionsMax: 'all' })
  expect([c.barWidth, c.heaviest, c.sectionsMax, c.categories, c.thresholdToast]).toEqual([20, 0, Infinity, 'stacked', true])
})

test('figures read as k, with commas, or as a share of the window', () => {
  expect(figure(12_345, 200_000, 'k')).toBe('12.3k')
  expect(figure(12_345, 200_000, 'comma')).toBe('12,345')
  expect(figure(12_345, 200_000, 'percent')).toBe('6.2%')
})

test('growth averages since the last compaction and gives the last turn', () => {
  expect(growth([10, 20, 30, 5, 9, 17])).toEqual({ average: 6, last: 8 })
  expect(growth([10])).toEqual({ average: null, last: 0 })
})

test('thresholds, paths and the startup line', () => {
  expect([29, 30, 49, 50, 69, 70].map(fillLevel)).toEqual([0, 1, 1, 2, 2, 3])
  expect(shortPath('C:/Users/me/.claude/CLAUDE.md', 'home')).toBe('~/.claude/CLAUDE.md')
  expect(shortPath('/home/me/x/CLAUDE.md', 'name')).toBe('CLAUDE.md')
  expect(startupLine({ tokens: 12_000, average: null, sessions: 0 }, 'all', short)).toBe('Startup 12k · the first session kept across projects')
})

test('weighs the transcript locally, tool by tool', () => {
  const { heavy, tools } = transcriptWeights(MESSAGES as never)
  expect(heavy[0]).toEqual({ who: 'Read', what: 'index.d.ts', tokens: 2_000 + 10, isTool: true })
  expect(tools.map(t => [t.tool, t.calls])).toEqual([['Read', 2], ['Bash', 1]])
})

test('bars light each segment its share, at least a square, with the tick where it falls', () => {
  expect(litSquares([{ tokens: 50, color: 'a' }, { tokens: 1, color: 'b' }], 100, 10)).toEqual([0, 0, 0, 0, 0, 1])
  const svg = squaresSvg([{ tokens: 59, color: 'warning' }], 100, 10, 0.84)
  expect(svg.match(/width="2"/g)?.length).toBe(59)
  expect(svg).toContain('class="tk"')
  const runs = brailleRuns([{ tokens: 59, color: 'warning' }], 100, 10, 0.84)
  expect(runs.map(r => r.text).join('')).toBe('⣿⣿⣿⣿⣿⣷⣀⣀|⣀⣀')
})

for (const surface of ['terminal', 'desktop'] as const) {
  // The noun's own path is tested from motta-statusline, whose module calls
  // it: the host refuses a noun call from a module whose scan lists none.
  test(`/context-drill opens the pane on a fresh breakdown (${surface})`, async ($, on) => {
    const opened: string[] = []
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 360_000, window: 1_000_000, percent: 36, breakdown: BREAKDOWN as never }, rateLimits: [] } }))
    on('session.turns', () => ({ value: 30 }))
    on('session.messages', () => ({ value: MESSAGES as never }))
    on('session.id', () => ({ value: 's2' }))
    on('session.root', () => ({ value: 'C:/code' }))
    on('clock.now', () => ({ value: 0 }))
    const store = new Map<string, unknown>([['startup:C:/code', [{ id: 's1', tokens: 10_000 }]]])
    on('store.get', (_, e) => ({ value: store.get(e.key) }))
    on('store.set', (_, e) => {
      store.set(e.key, e.value)
      return { value: undefined }
    })
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    expect((await $.command.run({ command: 'context-drill', args: '' } as never)).text).toBe('Context pane opened.')
    expect(opened).toEqual(['context-drill'])
    expect(store.get('startup:all')).toEqual([{ id: 's2', tokens: 12_000 }])

    const pane = await $.ui.mount({ plugin: 'context-drill', surface, component: 'Pane', requestId: 'context-drill', props: { title: 'Context', isFocused: false, bodyColumns: 80 } as never })
    expect(await pane.find({ type: 'Text', text: 'Messages' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'C:/code/CLAUDE.md' })).toBeDefined()
    expect(await pane.find({ key: 'compact' })).toBeDefined()
    expect(await pane.find({ key: 'refresh' })).toBeDefined()
    // The footer's focus picker; a custom focus swaps in a field.
    expect(await pane.find({ key: 'focus' })).toBeDefined()
    await pane.select({ key: 'focus', value: 'custom' })
    expect(await pane.find({ key: 'compact' })).toBeUndefined()
    await pane.input({ key: 'focus', text: '' })
    expect(await pane.find({ key: 'compact' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Startup 12k · your average 10k over 1 session in this project · +20%' })).toBeDefined()
    // MCP tools start folded; pressing the heading opens it.
    expect(await pane.find({ key: 'MCP tools:b' })).toBeUndefined()
    await pane.press({ key: 'fold:MCP tools' })
    expect(await pane.find({ key: 'MCP tools:b' })).toBeDefined()
  })
}

test('reads again after each turn while the pane is shown, never while it is closed', async ($, on) => {
  let reads = 0
  let isShown = true
  on('session.usage', () => {
    reads++
    return { value: { startedAt: 0, context: { tokens: 360_000, window: 1_000_000, percent: 36, breakdown: BREAKDOWN as never }, rateLimits: [] } }
  })
  on('session.turns', () => ({ value: 30 }))
  on('session.messages', () => ({ value: [] }))
  on('session.id', () => ({ value: 's2' }))
  on('session.root', () => ({ value: 'C:/code' }))
  on('clock.now', () => ({ value: 0 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'context-drill', title: 'Context', isShown, isFocused: false, isPlaced: true }] }))
  on('session.measure', (_, e) => ({ changed: [...e.changed] }))
  await $.command.run({ command: 'context-drill', args: '' } as never)
  const turn = { context: { tokens: 370_000, window: 1_000_000, percent: 37 }, rateLimits: [], changed: ['context'] } as never
  await $.session.measure(turn)
  expect(reads).toBe(2)
  isShown = false
  await $.session.measure(turn)
  expect(reads).toBe(2)
})
