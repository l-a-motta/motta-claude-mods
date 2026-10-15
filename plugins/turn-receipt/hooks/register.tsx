import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Receipt } from '../types'

// A receipt under each turn's reply: how long the turn took, the agents it
// spawned, the edits it made, the main loop's failed calls and what it added to
// the session's cost.
//
// Every turn gets its own: yours, and each one an agent's report or a
// background task's notice starts. A turn that wrote no answer gets none.
//
// A reply's drawing (`AssistantMessage`) carries the API's message id, which no
// event hands a mod, so a receipt is found by the reply's text: `turn.complete`
// gives the turn's answer, and the drawing whose text ends it is that reply.

const receipts = atom({ plugin: 'turn-receipt', key: 'receipts' } as const, {})
const KEPT = 300
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
// How much of an answer's end a receipt is kept by; a block shorter than
// SHORT matches only an answer it equals, so `Done.` finds no other reply.
const TAIL = 400
const SHORT = 40

// The figures take tool-borders' hues: agents delegate (clay), edits change
// (yellow); errors red once there are any, the cost orange from a dollar.
const COLOR = { good: '#4eba65', bad: '#ef5350', quiet: '#8a8a8a', agents: '#c0674a', edits: '#b8a531', cost: '#ee8d3a' }
const COST_LOUD = 1

// The turn running now.
let running: Receipt | undefined

const blank = (): Receipt => ({ isRunning: true, agents: 0, edits: 0, errors: 0, durationMs: 0 })

// An answer's end, whitespace folded: what a receipt is kept by.
export const textKey = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(-TAIL)

// The receipt whose answer this reply block ends, if any.
export const receiptFor = (all: Record<string, Receipt>, text: string): Receipt | undefined => {
  const block = textKey(text)
  if (!block) return undefined
  if (all[block]) return all[block]
  if (block.length < SHORT) return undefined
  const key = Object.keys(all).find(k => k.endsWith(block))
  return key ? all[key] : undefined
}

const keep = (all: Record<string, Receipt>, id: string, r: Receipt): Record<string, Receipt> => {
  const next = { ...all, [id]: r }
  const ids = Object.keys(next)
  return ids.length > KEPT ? Object.fromEntries(ids.slice(-KEPT).map(k => [k, next[k]!])) : next
}

// A turn's receipt once it ends.
export const finish = (turn: Receipt, end: { durationMs: number; reason: Receipt['reason']; costAdded?: number }): Receipt => ({
  isRunning: false,
  agents: turn.agents,
  edits: turn.edits,
  errors: turn.errors,
  durationMs: end.durationMs,
  reason: end.reason,
  costAdded: end.costAdded,
})

// `7s`, `2m37s`, `1h04m`.
export const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export type Piece = { figure: string; word?: string; color?: string; press?: 'agents' | 'edits' }

// The receipt as pieces: a figure (colored when it says something) and its word,
// the words of agents and edits pressable. Every count stays, zeros included.
export const receiptPieces = (r: Receipt): { mark: string; markColor: string; pieces: Piece[] } => {
  const stopped = r.reason === 'aborted'
  const failed = r.reason === 'error' || r.reason === 'refusal'
  const plural = (n: number, w: string) => (n === 1 ? w : `${w}s`)
  const pieces: Piece[] = [
    { figure: fmtDuration(r.durationMs), word: stopped ? 'stopped' : undefined },
    { figure: String(r.agents), word: plural(r.agents, 'agent'), color: r.agents ? COLOR.agents : undefined, press: 'agents' },
    { figure: String(r.edits), word: plural(r.edits, 'edit'), color: r.edits ? COLOR.edits : undefined, press: 'edits' },
    { figure: String(r.errors), word: plural(r.errors, 'error'), color: r.errors ? COLOR.bad : undefined },
  ]
  if (r.costAdded !== undefined && r.costAdded >= 0.005) pieces.push({ figure: `+$${r.costAdded.toFixed(2)}`, color: r.costAdded >= COST_LOUD ? COLOR.cost : undefined })
  return { mark: stopped ? '■' : failed ? '✗' : '✓', markColor: stopped ? COLOR.quiet : failed ? COLOR.bad : COLOR.good, pieces }
}

// The words that open another mod's pane, through the noun it adds to `$`;
// missing when that mod is not loaded.
async function openAgents($: EngineInterface) {
  try {
    const opened = await $.savvyProgress.open()
    if (!opened.isPlaced) $.ui.toast(`Agents pane waits: ${opened.reason ?? 'not placed'}`)
  } catch {
    $.ui.toast('Install savvy-progress for the agents pane')
  }
}

async function openChanges($: EngineInterface) {
  try {
    const opened = await $.changesDrill.open()
    if (!opened.isPlaced) $.ui.toast(`Changes pane waits: ${opened.reason ?? 'not placed'}`)
  } catch {
    $.ui.toast('Install changes-drill for the Changes pane')
  }
}

async function costNow($: EngineInterface): Promise<number | undefined> {
  const u = await $.session.usage().catch(() => null)
  return typeof u?.cost?.usd === 'number' ? u.cost.usd : undefined
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    running = { ...blank(), costAtStart: await costNow($) }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!e.parentAgentId && running) running = { ...running, agents: running.agents + 1 }
    return started
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!running) return ran
    const didRun = ran.deny === undefined
    if (didRun && ran.isError !== true && EDIT_TOOLS.has(e.tool)) running = { ...running, edits: running.edits + 1 }
    else if (!e.agentId && (!didRun || ran.isError === true)) running = { ...running, errors: running.errors + 1 }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)
    const turn = running
    if (e.agentId || !turn) return answered
    running = undefined
    const key = textKey(answered.text ?? e.answer ?? '')
    if (!key) return answered
    const cost = await costNow($)
    const costAdded = cost !== undefined && turn.costAtStart !== undefined ? cost - turn.costAtStart : undefined
    const r = finish(turn, { durationMs: e.durationMs, reason: e.reason, costAdded })
    await update($, receipts, all => keep(all, key, r))
    return answered
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const r = receiptFor(await read($, receipts), e.props.text)
    const row = await next(e)
    if (!r) return row
    const { Box, Text, Button } = $.ui.resolve(e)
    const onDesktop = e.surface === 'desktop'
    const { mark, markColor, pieces } = receiptPieces(r)
    // A desktop button draws its label plain: the word is the button, dim, its
    // colored figure plain Text beside it. In a reply row it pads its label by
    // about a quarter cell each side (seen: -0.75, the band's measure, left
    // `1agent`), which a negative margin takes back so every word sits one gap
    // from its figure.
    const word = (p: Piece, i: number) => {
      if (!p.word) return null
      if (!p.press) return <Text dimColor>{p.word}</Text>
      const button = <Button key={`receipt-${p.press}-${i}`} plain dimColor label={p.word} onPress={() => void (p.press === 'agents' ? openAgents($) : openChanges($))} />
      return onDesktop ? <Box marginX={-0.25}>{button}</Box> : button
    }
    const gap = onDesktop ? 0.5 : 1
    return (
      <Box flexDirection="column">
        {row}
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={gap} marginTop={onDesktop ? 0.5 : 0}>
          <Text color={markColor}>{mark}</Text>
          {pieces.map((p, i) => (
            <Box key={`piece-${i}`} flexDirection="row" alignItems="center" columnGap={gap}>
              {i > 0 && <Text dimColor>·</Text>}
              <Text color={p.color} dimColor={!p.color}>
                {p.figure}
              </Text>
              {word(p, i)}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
