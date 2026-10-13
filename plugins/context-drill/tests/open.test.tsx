import { expect, test } from 'claude-code/testing'

import { brailleRuns, litSquares, squaresSvg } from '../hooks/bars.ts'
import { BUDGET, compactSummary, config, countNodes, figure, fit, growth, sections, short, shortPath, startupLine, fillLevel, transcriptWeights } from '../hooks/register.tsx'

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 12_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 240_000, color: 'purple', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 600_000, color: 'subtle', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 360_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  autocompactSource: 'model-default',
  model: 'Opus 5.5',
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
  // An open section lists every item by default: the ladder keeps the pane light.
  expect(config({}).sectionsMax).toBe(Infinity)
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

// The breakdown with agents and skills, two of each sharing a name.
const DRILLED = {
  ...BREAKDOWN,
  agents: [
    { agentType: 'reviewer', source: 'plugin', tokens: 120 },
    { agentType: 'reviewer', source: 'plugin', tokens: 80 },
  ],
  skills: {
    totalSkills: 3,
    includedSkills: 2,
    tokens: 400,
    skillFrontmatter: [
      { name: 'deploy', source: 'plugin', pluginName: 'ops', tokens: 150 },
      { name: 'deploy', source: 'userSettings', tokens: 90 },
    ],
  },
}

function stubReads(on: any, breakdown: unknown) {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 360_000, window: 1_000_000, percent: 36, breakdown }, rateLimits: [] } }))
  on('session.turns', () => ({ value: 30 }))
  on('session.messages', () => ({ value: MESSAGES as never }))
  on('session.id', () => ({ value: 's2' }))
  on('session.root', () => ({ value: 'C:/code' }))
  on('clock.now', () => ({ value: 0 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

// A drawn node's text, its nested pieces joined.
const textOf = (n: any): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : n?.children ? textOf(n.children) : '')
// Every Text's whole line, one a line: a card line's pieces read as one.
function lines(n: any, out: string[] = []): string[] {
  if (Array.isArray(n)) n.forEach(c => lines(c, out))
  else if (n && typeof n === 'object') {
    if (n.type === 'Text') out.push(textOf(n))
    else lines(n.children, out)
  }
  return out
}
// The card whose first line is `first`, and its tone: the rule's color in a
// terminal, the bar's on the desktop.
function cardTone(n: any, first: string): string | undefined {
  if (Array.isArray(n)) {
    for (const c of n) {
      const t = cardTone(c, first)
      if (t) return t
    }
    return undefined
  }
  if (!n || typeof n !== 'object') return undefined
  if (n.props?.position === 'absolute' && lines(n.children)[0] === first) return n.props.borderColor ?? n.children[0].props.backgroundColor
  return cardTone(n.children, first)
}
// A styled piece's color, by its text.
function pieceColor(n: any, text: string): string | undefined {
  if (Array.isArray(n)) {
    for (const c of n) {
      const t = pieceColor(c, text)
      if (t) return t
    }
    return undefined
  }
  if (!n || typeof n !== 'object') return undefined
  if (n.type === 'Text' && n.children?.length === 1 && n.children[0] === text && n.props?.color) return n.props.color
  return pieceColor(n.children, text)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`hover cards carry the exact figures and what each control does (${surface})`, async ($, on) => {
    stubReads(on, DRILLED)
    await $.command.run({ command: 'context-drill', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'context-drill', surface, component: 'Pane', requestId: 'context-drill', props: { title: 'Context', isFocused: false, bodyColumns: 80 } as never })
    let tree = await pane.drawn()
    let drawn = lines(tree).join('\n')
    // Tones: the header's the fill level (36%: warn), a fold heading's and
    // Refresh's action, Compact now's warn, a plain card's info.
    expect(cardTone(tree, '360,000 of 1,000,000 tokens · 36%')).toBe('#e7c06b')
    expect(cardTone(tree, 'Unfolds MCP tools')).toBe('#8db4f0')
    expect(cardTone(tree, 'Reads the breakdown, the turns and the transcript again')).toBe('#8db4f0')
    expect(cardTone(tree, 'Closes this pane and runs /compact')).toBe('#e7c06b')
    expect(cardTone(tree, '360,000 of 1,000,000 tokens · Opus 5.5')).toBe('#6f6d68')
    // Labels dim, separators faint, the cache's read green and written amber.
    expect(pieceColor(tree, 'breakdown window ')).toBe('#9c9a94')
    expect(pieceColor(tree, ' · ')).toBe('#6f6d68')
    expect(pieceColor(tree, 'read')).toBe('#7fc97f')
    expect(pieceColor(tree, 'written')).toBe('#e7c06b')
    // A memory file's path: its folder dim.
    expect(pieceColor(tree, 'C:/code/')).toBe('#9c9a94')
    // The header and a legend entry, revealed downward by scope.
    expect(drawn).toContain('360,000 of 1,000,000 tokens · 36%')
    expect(drawn).toContain('Opus 5.5 · breakdown window 1,000,000 (model default)')
    expect(drawn).toContain('Messages · 240,000 tokens')
    expect(JSON.stringify(tree)).toContain('tip:cat:Messages')
    // The forecast, a cache row, a heaviest row, a heading and the footer.
    expect(drawn).toContain('Fires at 835,000 · 475,000 to go')
    expect(drawn).toContain('104,000 read · 88.1%')
    expect(drawn).toContain('A Read call: its input and result')
    expect(drawn).toContain('Unfolds MCP tools')
    expect(drawn).toContain('Closes this pane and runs /compact')
    expect(drawn).toContain('Reads the breakdown, the turns and the transcript again')
    // A preset's own instructions on the picker's card.
    await pane.select({ key: 'focus', value: 'keep-task' })
    tree = await pane.drawn()
    drawn = lines(tree).join('\n')
    // The picker's card is an action; the preset's instructions a quote.
    expect(cardTone(tree, 'Picks what Compact now asks the summary to keep')).toBe('#8db4f0')
    expect(JSON.stringify(tree)).toContain('"italic":true},"children":["\\"Keep the current task in full')
    expect(drawn).toContain('Keep the current task in full: what is being built, the files being changed, and what is left to do.')
    expect(drawn).toContain('Focus: Keep current task, picked at left')
    // MCP rows list their tools, loaded and deferred.
    await pane.press({ key: 'fold:MCP tools' })
    tree = await pane.drawn()
    drawn = lines(tree).join('\n')
    expect(drawn).toContain('Loaded: one 300')
    expect(drawn).toContain('Deferred, 0 until searched: two')
    // Names repeated across plugins keep keys of their own, and a skill names its plugin.
    expect(await pane.find({ key: 'Agents:reviewer' })).toBeDefined()
    expect(await pane.find({ key: 'Agents:reviewer#1' })).toBeDefined()
    expect(await pane.find({ key: 'Skills:deploy#1' })).toBeDefined()
    expect(drawn).toContain('From ops · plugin')
    expect(drawn).toContain('150 tokens in the listing')
  })
}

test('a phone gets no hover cards', async ($, on) => {
  stubReads(on, BREAKDOWN)
  await $.command.run({ command: 'context-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'context-drill', surface: 'mobile', component: 'Pane', requestId: 'context-drill', props: { title: 'Context', isFocused: false, bodyColumns: 80 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Messages')
  expect(drawn).not.toContain('Closes this pane and runs /compact')
  expect(drawn).not.toContain('tip:head')
  expect(drawn).not.toContain('360,000 of 1,000,000 tokens')
})

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

// A session with `n` agents and `n` skills, every one drawn ("Section items"
// all, the default).
const crowded = (n: number) => ({
  ...BREAKDOWN,
  agents: Array.from({ length: n }, (_, i) => ({ agentType: `agent-${i}`, source: 'plugin', tokens: 100 + i })),
  skills: { totalSkills: n, includedSkills: n, tokens: 4_000, skillFrontmatter: Array.from({ length: n }, (_, i) => ({ name: `skill-${i}`, source: 'plugin', pluginName: 'ops', tokens: 50 + i })) },
})
// A skill row's card (info) and Refresh's (action).
const INFO_CARD = 'From ops · plugin'
const ACTION_CARD = 'Reads the breakdown, the turns and the transcript again'

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a pane over the element budget sheds info cards first (${surface})`, async ($, on) => {
    stubReads(on, crowded(60))
    await $.command.run({ command: 'context-drill', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'context-drill', surface, component: 'Pane', requestId: 'context-drill', props: { title: 'Context', isFocused: false, bodyColumns: 80 } as never })
    const tree = await pane.drawn()
    const drawn = lines(tree).join('\n')
    expect(drawn).toContain('skill-59')
    expect(drawn).toContain(ACTION_CARD)
    if (surface === 'desktop') {
      // About 2,270 elements with every card; 921 with the action and status ones.
      expect(countNodes(tree)).toBeLessThanOrEqual(BUDGET)
      expect(drawn).not.toContain(INFO_CARD)
    } else {
      // A terminal has no such limit: every card stays.
      expect(countNodes(tree)).toBeGreaterThan(BUDGET)
      expect(drawn).toContain(INFO_CARD)
    }
  })
}

test('a pane still over the budget with no cards trims its sections and says so', async ($, on) => {
  stubReads(on, crowded(300))
  await $.command.run({ command: 'context-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'context-drill', surface: 'desktop', component: 'Pane', requestId: 'context-drill', props: { title: 'Context', isFocused: false, bodyColumns: 80 } as never })
  const tree = await pane.drawn()
  const drawn = lines(tree).join('\n')
  // About 9,230 with every card, 3,210 with none; 316 at ten items a section.
  expect(countNodes(tree)).toBeLessThanOrEqual(BUDGET)
  expect(drawn).not.toContain(ACTION_CARD)
  expect(drawn).toContain('skill-9')
  expect(drawn).not.toContain('skill-10\n')
  expect(drawn).toContain('+290 more · trimmed to fit, fold other sections to list them')
})

test('fit draws the richest level that fits, up to the top one, and only on the desktop', () => {
  const tree = (size: number) => Array.from({ length: size }, () => ({ type: 'Box', props: {}, children: [] }))
  const drawn: number[] = []
  const draw = (level: number) => {
    drawn.push(level)
    return tree(BUDGET + 500 - 400 * level)
  }
  expect(countNodes(fit('desktop', 5, draw))).toBe(BUDGET - 300)
  expect(drawn).toEqual([0, 1, 2])
  expect(countNodes(fit('desktop', 1, draw))).toBe(BUDGET + 100)
  expect(countNodes(fit('terminal', 5, draw))).toBe(BUDGET + 500)
})
