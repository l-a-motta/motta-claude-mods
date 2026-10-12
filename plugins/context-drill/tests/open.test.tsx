import { expect, test } from 'claude-code/testing'

import { compactSummary, sections, short } from '../hooks/register.tsx'

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 12_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 240_000, color: 'purple', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 600_000, color: 'subtle', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 360_000,
  maxTokens: 1_000_000,
  percentage: 36,
  memoryFiles: [{ path: 'C:/code/CLAUDE.md', type: 'Project', tokens: 900 }],
  mcpTools: [
    { name: 'mcp__a__one', serverName: 'a', tokens: 300, isLoaded: true },
    { name: 'mcp__a__two', serverName: 'a', tokens: 200, isLoaded: false },
    { name: 'mcp__b__one', serverName: 'b', tokens: 1_000, isLoaded: true },
  ],
  agents: [],
  isAutoCompactEnabled: true,
  autoCompactThreshold: 835_000,
}

test('groups MCP tools by server, largest first, and leaves empty sections out', () => {
  const got = sections(BREAKDOWN as never)
  expect(got.map(s => s.title)).toEqual(['Memory files', 'MCP tools'])
  expect(got[1]?.items).toEqual([
    { name: 'b', tokens: 1_000, note: '1/1 loaded' },
    { name: 'a', tokens: 500, note: '1/2 loaded' },
  ])
  expect(short(1_234)).toBe('1.2k')
})

test('says where auto-compact fires and about how many turns are left', () => {
  expect(compactSummary(835_000, 360_000, 1_000_000, 30)).toBe('Auto-compact at 835k (84%) · about 40 turns before it fires')
  expect(compactSummary(835_000, 360_000, 1_000_000, 0)).toBe('Auto-compact at 835k (84%)')
  expect(compactSummary(null, 360_000, 1_000_000, 30)).toBe('Auto-compact off')
})

for (const surface of ['terminal', 'desktop'] as const) {
  // The noun's own path is tested from motta-statusline, whose module calls
  // it: the host refuses a noun call from a module whose scan lists none.
  test(`/context-drill opens the pane on a fresh breakdown (${surface})`, async ($, on) => {
    const opened: string[] = []
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 360_000, window: 1_000_000, percent: 36, breakdown: BREAKDOWN as never }, rateLimits: [] } }))
    on('session.turns', () => ({ value: 30 }))
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    expect((await $.command.run({ command: 'context-drill', args: '' } as never)).text).toBe('Context pane opened.')
    expect(opened).toEqual(['context-drill'])

    const pane = await $.ui.mount({ plugin: 'context-drill', surface, component: 'Pane', requestId: 'context-drill', props: { title: 'Context', isFocused: false, bodyColumns: 80 } as never })
    expect(await pane.find({ type: 'Text', text: 'Messages' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'C:/code/CLAUDE.md' })).toBeDefined()
    expect(await pane.find({ key: 'compact' })).toBeDefined()
  })
}
