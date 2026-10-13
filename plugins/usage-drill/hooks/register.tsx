// usage-drill: a Usage pane of each rate limit (5h, 7d): one line of its
// bar (motta-statusline's, a tick where the window's time stands), percent
// and reset, and a verdict in its color. Under `details`, 5h and 7d side by
// side: its readings this window against an even pace, burn rate, hourly
// budget, what each of this session's turns cost, this session's share, its
// past windows, the busiest hour and when it clears (draw.tsx).
//
// Nothing here sends a request: the figures come from the engine's push
// after a response (session.measure), a local read of the last response's
// limits ($.session.usage() with no breakdown) and what is kept in $.store,
// one entry per limit for its readings this window, its turns and its past
// windows. A limit's turn is its change from turn.start to turn.complete of
// a main-session turn; what other sessions spent while this one sat idle
// shows up on its next response, so it lands on that turn.
//
// It toasts when a limit passes a threshold (`toastAt`) and when it turns
// orange or red (`toastAhead`): motta-statusline's colors, which it no longer
// toasts itself. Opened by /usage-drill, or by another mod through the noun
// this mod adds to `$`, `$.usageDrill.open()`: a mod opens only its own
// panes, so motta-statusline's 5h and 7d ask this one to.

import type { EngineInterface, Register } from 'claude-code'

import type { UsageDrillOpened } from '../types'
import { fit, TOP_LEVEL, usagePane } from './draw.tsx'
import type { Days, Kept, ModelDays, Limit, PastWindow, Readings, Settings, Turns } from './figures.ts'
import { addRise, addSpend, daysOf, elapsedShare, fileWindow, isSameWindow, limitLevel, limitsOf, pointsOf, settingsOf, toastText } from './figures.ts'

const PANE = 'usage-drill'

const MAX_READINGS = 300
const MAX_TURNS = 100
const DAY = 86_400_000

// The last reading of the limits; null before the first.
let limits: Limit[] | null = null
// What $.store holds of each limit, by label, as of the last reading.
let kept: Record<string, Kept> = {}
// This session: its id, when its figures count from, and its cost so far.
let session: { id: string | null; startedAt: number | null; costUsd: number | null } = { id: null, startedAt: null, costUsd: null }
// Each limit as the running main-session turn started; null between turns.
let turnStart: Map<string, Limit> | null = null
// Each limit's last reading and color, for the toasts; empty until the first
// reading after a load, which only sets them.
const lastSeen = new Map<string, { resetsAt: number; exact: number; color: string }>()
let settings: Settings = settingsOf({})
// Whether the pane shows its details: open on each load; `d` closes them
// for the session.
let showDetails = true
// What the weekly limit took by day and hour, as last read from $.store.
let days: Days = {}
// What each model family cost by day, as last read from $.store.
let models: ModelDays = {}
// The session's cost ledger as the last step ended; null before the first.
let costSeen: number | null = null

export const register: Register = (on, options) => {
  settings = settingsOf(options)

  // The noun's own answer is the bottom of its event; the hook on
  // `usageDrill.open` below answers first with this mod's `$`.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, usageDrill: { open: async (): Promise<UsageDrillOpened> => ({ isPlaced: false, reason: 'usage-drill did not answer the call' }) } }
  })

  on('usageDrill.open', async $ => ({ value: await open($) }))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'usage-drill', description: 'Show the rate limits, their pace and their readings this window' })
    // So a reload draws figures before the next response.
    await readLimits($)
    return started
  })

  on('command.run', { command: 'usage-drill' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? 'Usage pane opened.' : `Usage pane waits: ${opened.reason ?? 'not placed'}` }
  })

  // The engine's push when a rate-limit window moves a whole point, from any
  // response: a subagent's too, and a background one's after the turn ended.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.cost !== undefined) session = { ...session, costUsd: e.cost.usd }
    await note($, limitsOf(e.rateLimits))
    return measured
  }).catch(($, e, next) => next(e))

  // The limits as the turn begins, before its first model call: a local read
  // of the last response's. Only the first since the last turn.complete
  // counts, so a subagent's turn starting mid-turn does not move it.
  // What each step cost, by the model that answered: the change in the
  // session's own cost ledger across it (a local read, no request), kept by
  // day for the cross. Steps that overlap may trade a little between them.
  on('turn.step', async function* ($, e, next) {
    if (costSeen === null) costSeen = await readCost($)
    const stream = next(e)
    for await (const chunk of stream) yield chunk
    const result = await stream.result
    await keepSpend($, result.usage?.model ?? e.model)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (turnStart === null) {
      await readLimits($)
      turnStart = new Map((limits ?? []).map(l => [l.label, l]))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await readLimits($)
      const started = turnStart
      turnStart = null
      if (started !== null) await keepTurn($, started)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const view = { limits, kept, days, models, session, settings, showDetails, columns: e.props.bodyColumns, surface: e.surface, onToggleDetails: () => void toggleDetails($), now: await $.clock.now() }
    // At the richest level that fits the desktop's element budget.
    return fit(e.surface, TOP_LEVEL, level => usagePane(table, 'Svg' in table ? table.Svg : null, view, level))
  })
}

async function toggleDetails($: EngineInterface) {
  showDetails = !showDetails
  $.ui.invalidate('ui.render')
}

async function readLimits($: EngineInterface) {
  try {
    // The id tags this session's turns; asked once.
    if (session.id === null) session = { ...session, id: await $.session.id().catch(() => null) }
    const usage = await $.session.usage()
    session = { ...session, startedAt: usage.startedAt, costUsd: usage.cost?.usd ?? session.costUsd }
    await note($, limitsOf(usage.rateLimits))
  } catch {
    // The last reading stays.
  }
}

// Takes a reading: keeps it when a limit's percent moved, files the window
// before it when the limit reset, toasts, and redraws the pane.
async function note($: EngineInterface, next: Limit[]) {
  limits = next
  const now = await $.clock.now()
  const fresh: Record<string, Kept> = {}
  for (const l of next) {
    if (l.resetsAt === null) continue
    const stored = await readStored<Readings>($, `usage:${l.label}`, isReadings)
    let history = (await readStored<PastWindow[]>($, `usage:history:${l.label}`, isHistory)) ?? []
    if (stored !== null && !isSameWindow(stored.resetsAt, l.resetsAt)) {
      history = fileWindow(history, stored)
      await keep($, `usage:history:${l.label}`, history)
    }
    let readings: Readings = { resetsAt: l.resetsAt, points: pointsOf(stored, l) }
    const last = readings.points[readings.points.length - 1]?.[1]
    if (last !== l.percent) {
      readings = { resetsAt: l.resetsAt, points: [...readings.points, [now, l.percent] as [number, number]].slice(-MAX_READINGS) }
      await keep($, `usage:${l.label}`, readings)
      // The weekly limit's rise, kept by day and hour: only the session that
      // takes the reading counts it, so no rise is counted twice.
      if (l.windowMs !== null && l.windowMs > DAY) await keepRise($, readings, last === undefined ? 0 : l.percent - last, now)
    }
    fresh[l.label] = { readings, history, turns: await readStored<Turns>($, `usage:turns:${l.label}`, isTurns) }
  }
  kept = fresh
  days = (await readStored<Days>($, 'usage:days', isDays)) ?? {}
  models = (await readStored<ModelDays>($, 'usage:models', isModels)) ?? {}
  // None kept yet: seeded from the weekly window's readings so far.
  const weekly = next.find(l => l.windowMs !== null && l.windowMs > DAY)
  const seed = weekly === undefined ? null : fresh[weekly.label]?.readings
  if (Object.keys(days).length === 0 && seed != null && seed.points.length > 1) {
    days = daysOf(seed.points)
    await keep($, 'usage:days', days)
  }
  toast($, next, now)
  $.ui.invalidate('ui.render')
}

// Adds a rise of the weekly limit to the days kept; with none kept yet,
// seeds them from this window's readings.
async function readCost($: EngineInterface): Promise<number | null> {
  try {
    return (await $.session.usage()).cost?.usd ?? null
  } catch {
    return null
  }
}

// Adds what the ledger grew by since the last step to the model's day.
async function keepSpend($: EngineInterface, model: string) {
  const cost = await readCost($)
  if (cost === null) return
  const spent = costSeen === null ? 0 : cost - costSeen
  costSeen = cost
  if (spent <= 0) return
  const stored = (await readStored<ModelDays>($, 'usage:models', isModels)) ?? {}
  models = addSpend(stored, await $.clock.now(), model, spent)
  await keep($, 'usage:models', models)
  $.ui.invalidate('ui.render')
}

async function keepRise($: EngineInterface, readings: Readings, rise: number, now: number) {
  const stored = await readStored<Days>($, 'usage:days', isDays)
  const next = stored === null || Object.keys(stored).length === 0 ? daysOf(readings.points) : addRise(stored, now, rise)
  days = next
  await keep($, 'usage:days', next)
}

// Keeps what each limit moved over the turn that just ended, tagged with
// this session, in that limit's window.
async function keepTurn($: EngineInterface, started: Map<string, Limit>) {
  if (limits === null) return
  const now = await $.clock.now()
  for (const l of limits) {
    const before = started.get(l.label)
    if (l.resetsAt === null || before?.resetsAt == null || !isSameWindow(before.resetsAt, l.resetsAt)) continue
    const delta = Math.round((l.exact - before.exact) * 10) / 10
    if (delta < 0) continue
    const stored = await readStored<Turns>($, `usage:turns:${l.label}`, isTurns)
    const turns = stored !== null && isSameWindow(stored.resetsAt, l.resetsAt) ? stored.turns : []
    const next: Turns = { resetsAt: l.resetsAt, turns: [...turns, { at: now, session: session.id ?? '', delta }].slice(-MAX_TURNS) }
    await keep($, `usage:turns:${l.label}`, next)
    const k = kept[l.label]
    if (k !== undefined) kept = { ...kept, [l.label]: { ...k, turns: next } }
  }
  $.ui.invalidate('ui.render')
}

// A toast when a limit passes one of the thresholds, or turns orange (ahead
// of its window) or red; one per reading, the color's first. The first
// reading after a load only sets what was seen.
function toast($: EngineInterface, next: Limit[], now: number) {
  for (const l of next) {
    if (l.resetsAt === null) continue
    const pace = elapsedShare(l.resetsAt, l.windowMs, now)
    const color = limitLevel(l.percent, pace, settings)
    const before = lastSeen.get(l.label)
    lastSeen.set(l.label, { resetsAt: l.resetsAt, exact: l.exact, color })
    if (before === undefined || !isSameWindow(before.resetsAt, l.resetsAt)) continue
    const text = toastText(l, before, color, pace, now, settings)
    if (text !== null) $.ui.toast(text, { timeoutMs: 8_000 })
  }
}

async function open($: EngineInterface): Promise<UsageDrillOpened> {
  await readLimits($)
  const opened = await $.ui.open({ id: PANE, title: 'Usage' })
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

async function readStored<T>($: EngineInterface, key: string, isValid: (v: unknown) => boolean): Promise<T | null> {
  try {
    const value = await $.store.get(key)
    return isValid(value) ? (value as T) : null
  } catch {
    return null
  }
}

async function keep($: EngineInterface, key: string, value: unknown) {
  try {
    await $.store.set(key, value as never)
  } catch {
    // Not kept; the pane draws what it has.
  }
}

const isReadings = (v: any) => v != null && Array.isArray(v.points) && typeof v.resetsAt === 'number'
const isDays = (v: any) => v != null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(h => Array.isArray(h) && h.length === 24)
const isModels = (v: any) => v != null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(d => d != null && typeof d === 'object')
const isTurns = (v: any) => v != null && Array.isArray(v.turns) && typeof v.resetsAt === 'number'
const isHistory = (v: any) => Array.isArray(v) && v.every(h => typeof h?.resetsAt === 'number' && typeof h?.peak === 'number')

