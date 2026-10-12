// context-drill: a Context pane that drills into what fills the window.
//
// The top lists the /context categories with their share of the window; below
// it, what stands behind them: memory files, MCP tools by server, agents and
// skills, each with its tokens. Under the categories, where auto-compact
// fires and about how many turns are left before it does, with Compact now.
// Opened by /context-drill, or by another mod
// through the noun this mod adds to `$`, `$.contextDrill.open()`: a mod opens
// only its own panes, so motta-statusline's ctx asks this one to.

import type { EngineInterface, Register, SessionContextBreakdown, SessionContextUsage } from 'claude-code'

import type { ContextDrillOpened } from '../types'

const PANE = 'context-drill'

// The last reading and the session's turns; the pane draws them, Refresh
// reads them again.
let usage: SessionContextUsage | null = null
let turns = 0

export const register: Register = on => {
  // The noun's own answer is the bottom of its event; the hook on
  // `contextDrill.open` below answers first with this mod's `$`.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, contextDrill: { open: async (): Promise<ContextDrillOpened> => ({ isPlaced: false, reason: 'context-drill did not answer the call' }) } }
  })

  on('contextDrill.open', async $ => ({ value: await open($) }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-drill', description: 'Drill into what fills the context window' })
    return next(e)
  })

  on('command.run', { command: 'context-drill' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? 'Context pane opened.' : `Context pane waits: ${opened.reason ?? 'not placed'}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return contextPane($, Box, Text, Button, usage, turns)
  })
}

async function readUsage($: EngineInterface) {
  try {
    usage = (await $.session.usage({ breakdown: 'summary' })).context
    turns = await $.session.turns()
  } catch {
    // The last reading stays.
  }
}

async function open($: EngineInterface): Promise<ContextDrillOpened> {
  await readUsage($)
  const opened = await $.ui.open({ id: PANE, title: 'Context' })
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

async function compactNow($: EngineInterface) {
  await $.ui.close({ id: PANE })
  try {
    await $.command.run({ command: 'compact' })
  } catch {
    $.ui.toast('Run /compact to compact now')
  }
}

async function refresh($: EngineInterface) {
  await readUsage($)
  $.ui.invalidate('ui.render')
}

function contextPane($: EngineInterface, Box: any, Text: any, Button: any, ctx: SessionContextUsage | null, turns: number) {
  const b = ctx?.breakdown
  if (ctx == null || b == null) return <Text dimColor>No reading yet.</Text>
  const window = ctx.window ?? b.maxTokens
  const share = (n: number) => (window > 0 ? `${Math.round((n / window) * 100)}%` : '')
  const rows = b.categories.filter(c => c.kind !== 'deferred' && c.tokens > 0)
  const used = ctx.tokens ?? b.totalTokens
  const compactAt = b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Text bold>{Math.round(ctx.percent ?? b.percentage)}%</Text>
        <Text color="subtle">of the window · {short(used)} of {short(window)}</Text>
        <Button key="refresh" plain dimColor label="Refresh" onPress={() => void refresh($)} />
      </Box>
      {rows.map(c => (
        <Box key={`cat:${c.name}`} flexDirection="row" columnGap={1}>
          <Text color={c.color}>■</Text>
          <Text>{c.name}</Text>
          <Text color="subtle">{short(c.tokens)} · {share(c.tokens)}</Text>
        </Box>
      ))}
      <Text color="subtle">{compactSummary(compactAt, used, window, turns)}</Text>
      {compactAt !== null && <Button key="compact" label="Compact now" onPress={() => void compactNow($)} />}
      {sections(b).map(s => (
        <Box key={`sec:${s.title}`} flexDirection="column" marginTop={1}>
          <Text bold>{s.title} <Text color="subtle">{short(s.tokens)}</Text></Text>
          {s.items.map(i => (
            <Box key={`${s.title}:${i.name}`} flexDirection="row" columnGap={1}>
              <Box flexShrink={1}>
                <Text wrap="truncate-start">{i.name}</Text>
              </Box>
              <Text color="subtle">{short(i.tokens)}{i.note ? ` · ${i.note}` : ''}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

// Where auto-compact fires and about how many turns are left before it does,
// at the context's average growth per turn so far.
export function compactSummary(compactAt: number | null, used: number, window: number, turns: number) {
  if (compactAt === null) return 'Auto-compact off'
  const at = window > 0 ? ` (${Math.round((compactAt / window) * 100)}%)` : ''
  const left = turns > 0 && used > 0 ? Math.max(0, Math.round((compactAt - used) / (used / turns))) : null
  return `Auto-compact at ${short(compactAt)}${at}${left === null ? '' : ` · about ${left} turns before it fires`}`
}

type Section = { title: string; tokens: number; items: { name: string; tokens: number; note?: string }[] }

// What stands behind the categories, largest first; an empty one is left out.
export function sections(b: Pick<SessionContextBreakdown, 'memoryFiles' | 'mcpTools' | 'agents' | 'skills'>): Section[] {
  const servers = new Map<string, { tokens: number; tools: number; loaded: number }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { tokens: 0, tools: 0, loaded: 0 }
    servers.set(t.serverName, { tokens: s.tokens + t.tokens, tools: s.tools + 1, loaded: s.loaded + (t.isLoaded ? 1 : 0) })
  }
  const all: Section[] = [
    section('Memory files', b.memoryFiles.map(f => ({ name: f.path, tokens: f.tokens, note: f.type }))),
    section('MCP tools', [...servers].map(([name, s]) => ({ name, tokens: s.tokens, note: `${s.loaded}/${s.tools} loaded` }))),
    section('Agents', b.agents.map(a => ({ name: a.agentType, tokens: a.tokens, note: a.source }))),
    section('Skills', (b.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, tokens: 0, note: s.source })), b.skills?.tokens),
  ]
  return all.filter(s => s.items.length > 0)
}

function section(title: string, items: Section['items'], tokens?: number): Section {
  const sorted = [...items].sort((x, y) => y.tokens - x.tokens)
  return { title, tokens: tokens ?? sorted.reduce((n, i) => n + i.tokens, 0), items: sorted }
}

// 1234 -> 1.2k, 1_000_000 -> 1M.
export function short(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}
