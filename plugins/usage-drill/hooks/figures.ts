// The figures the pane draws and the toasts say, worked out from the readings
// alone: no $ here, so each is a plain function the tests call.

import type { PluginOptions, SessionRateLimit } from 'claude-code'

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const LIMIT_WINDOWS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

// `percent` rounded for showing, `exact` as the response said it (one
// decimal at most), for a turn's change.
export type Limit = { label: string; windowMs: number | null; percent: number; exact: number; resetsAt: number | null }

// A limit's readings this window, as kept in $.store: when each came and the
// percent it said.
export type Readings = { resetsAt: number; points: [number, number][] }
// A limit's turns this window, every session's, each tagged with its own.
export type TurnCost = { at: number; session: string; delta: number }
export type Turns = { resetsAt: number; turns: TurnCost[] }
// A window gone by: its highest reading and its last.
export type PastWindow = { resetsAt: number; peak: number; last: number }

// What is kept of one limit, as last read from $.store.
export type Kept = { readings: Readings | null; turns: Turns | null; history: PastWindow[] }

export const MAX_HISTORY = 24
// Two readings of a window's reset this close are the same window.
const SAME_WINDOW_MS = 5 * 60_000

export type Settings = {
  gauge: 'bar' | 'number'
  sparkFill: 'area' | 'line'
  paceGuide: boolean
  projectionLine: boolean
  burnRate: boolean
  burnLookbackMs: number
  runway: boolean
  runwayBasis: 'window' | 'recent'
  budget: boolean
  budgetTarget: number
  turnCosts: boolean
  turnCount: number
  turnShape: 'bars' | 'list'
  sessionShare: boolean
  dollars: 'per-point' | 'total' | 'off'
  toastAt: number[]
  toastAhead: boolean
  history: boolean
  historyCount: number
  historyMetric: 'peak' | 'last'
  heatmap: boolean
  idleHint: boolean
  clock: '24h' | '12h'
  resetAs: 'both' | 'relative' | 'absolute'
  density: 'comfy' | 'compact'
  redFrom: number
  paceMargin: number
}

// The manifest's userConfig values, each checked and its default where unset.
export function settingsOf(o: PluginOptions): Settings {
  const pick = <T extends string>(key: string, values: readonly T[], fallback: T): T =>
    values.includes(o[key] as T) ? (o[key] as T) : fallback
  const flag = (key: string) => (typeof o[key] === 'boolean' ? (o[key] as boolean) : true)
  const num = (key: string, min: number, max: number, fallback: number) => {
    const v = o[key]
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
  }
  const toastAt = pick('toastAt', ['50/75/90', '75/90', '90', 'off'], '50/75/90')
  return {
    gauge: pick('gauge', ['bar', 'number'], 'bar'),
    sparkFill: pick('sparkFill', ['area', 'line'], 'area'),
    paceGuide: flag('paceGuide'),
    projectionLine: flag('projectionLine'),
    burnRate: flag('burnRate'),
    burnLookbackMs: { '15m': 15, '30m': 30, '60m': 60 }[pick('burnLookback', ['15m', '30m', '60m'], '60m')] * 60_000,
    runway: flag('runway'),
    runwayBasis: pick('runwayBasis', ['window average', 'recent'], 'window average') === 'recent' ? 'recent' : 'window',
    budget: flag('budget'),
    budgetTarget: num('budgetTarget', 10, 100, 90),
    turnCosts: flag('turnCosts'),
    turnCount: num('turnCount', 3, 40, 20),
    turnShape: pick('turnShape', ['bars', 'list'], 'bars'),
    sessionShare: flag('sessionShare'),
    dollars: ({ 'per 1%': 'per-point', total: 'total', off: 'off' } as const)[pick('dollars', ['per 1%', 'total', 'off'], 'per 1%')],
    toastAt: toastAt === 'off' ? [] : toastAt.split('/').map(Number),
    toastAhead: flag('toastAhead'),
    history: flag('history'),
    historyCount: num('historyCount', 3, MAX_HISTORY, 24),
    historyMetric: pick('historyMetric', ['peak', 'at reset'], 'peak') === 'peak' ? 'peak' : 'last',
    heatmap: flag('heatmap'),
    idleHint: flag('idleHint'),
    clock: pick('clock', ['24h', '12h'], '24h'),
    resetAs: pick('resetAs', ['both', 'relative', 'absolute'], 'both'),
    density: pick('density', ['comfy', 'compact'], 'comfy'),
    redFrom: num('redFrom', 50, 100, 80),
    paceMargin: num('paceMargin', 1, 50, 10),
  }
}

export function toastText(l: Limit, before: { exact: number; color: string }, color: string, pace: number | null, now: number, s: Settings): string | null {
  const rank = LEVEL_RANK[color] ?? 0
  if (s.toastAhead && rank > (LEVEL_RANK[before.color] ?? 0) && rank >= 2) return levelToast(l, pace, color, now)
  const passed = s.toastAt.filter(t => before.exact < t && l.exact >= t)
  if (passed.length === 0) return null
  return `${l.label} limit passed ${passed[passed.length - 1]}%${l.resetsAt === null ? '' : `, resets in ${resetIn(l.resetsAt - now)}`}`
}

const LEVEL_RANK: Record<string, number> = { success: 0, warning: 1, '#ff8700': 2, error: 3 }

export function levelToast(l: Limit, pace: number | null, color: string, now: number) {
  if (color === 'error') return `${l.label} limit at ${l.percent}%${l.resetsAt === null ? '' : `, resets in ${resetIn(l.resetsAt - now)}`}`
  const ahead = pace === null ? 0 : Math.round(l.percent - pace * 100)
  return `${l.label} limit is ${ahead} points ahead of its window: ${projection(l.percent, pace, l.windowMs)}`
}

export function limitsOf(rateLimits: SessionRateLimit[]): Limit[] {
  return rateLimits.map(l => ({
    label: LIMIT_LABELS[l.kind] ?? l.kind,
    windowMs: LIMIT_WINDOWS[l.kind] ?? null,
    percent: Math.round(l.percentUsed),
    exact: l.percentUsed,
    resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
  }))
}

export function isSameWindow(a: number, b: number) {
  return Math.abs(a - b) < SAME_WINDOW_MS
}

export function pointsOf(r: Readings | null, l: { resetsAt: number | null }): [number, number][] {
  return r !== null && l.resetsAt !== null && isSameWindow(r.resetsAt, l.resetsAt) ? r.points : []
}

// The history with the window `r` added, its highest reading and its last;
// a window already filed (by another session) is left as it is.
export function fileWindow(history: PastWindow[], r: Readings): PastWindow[] {
  if (r.points.length === 0 || history.some(h => isSameWindow(h.resetsAt, r.resetsAt))) return history
  const peak = Math.max(...r.points.map(([, p]) => p))
  const last = r.points[r.points.length - 1][1]
  return [...history, { resetsAt: r.resetsAt, peak, last }].sort((a, b) => a.resetsAt - b.resetsAt).slice(-MAX_HISTORY)
}

// How the limit ends at the pace so far: its average rate since the window
// opened, run to the reset.
export function projection(percent: number, elapsed: number | null, windowMs: number | null) {
  if (elapsed === null || windowMs === null) return ''
  const gone = `${Math.round(elapsed * 100)}% of the window gone`
  if (elapsed < 0.02) return `${gone}, too early to project`
  if (percent <= 0) return `${gone} · nothing used yet`
  const end = percent / elapsed
  if (end <= 100) return `${gone} · at this pace about ${Math.round(end)}% by the reset`
  return `${gone} · at this pace 100% in about ${resetIn((elapsed * windowMs * (100 - percent)) / percent)}, before the reset`
}

// The share of a rate-limit window gone by: 0 as it opens, 1 as it resets.
export function elapsedShare(resetsAt: number, windowMs: number | null, now: number): number | null {
  if (windowMs === null) return null
  return Math.min(1, Math.max(0, 1 - (resetsAt - now) / windowMs))
}

// motta-statusline's colors for the same bar: red from `redFrom` (80%).
// Short of that, orange when the limit runs `paceMargin` (10) points or more
// ahead of the window's time, yellow from 60%, green below.
export function limitLevel(percent: number, elapsed: number | null, s: Pick<Settings, 'redFrom' | 'paceMargin'> = { redFrom: 80, paceMargin: 10 }) {
  if (percent >= s.redFrom) return 'error'
  if (elapsed !== null && percent - elapsed * 100 >= s.paceMargin) return '#ff8700'
  if (percent >= 60) return 'warning'
  return 'success'
}

// `2h45m`, `45m`, and from a day on `1d20h`.
export function resetIn(ms: number) {
  if (ms <= 0) return 'now'
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

// The percent the limit stood at `at`: its last reading by then, 0 before
// the window's first.
function percentAt(points: [number, number][], at: number) {
  let p = 0
  for (const [t, v] of points) if (t <= at) p = v
  return p
}

// Points an hour over the last `lookbackMs`, or since the window opened when
// that is later; null with under a minute to measure.
export function burnRate(points: [number, number][], percent: number, windowStart: number, now: number, lookbackMs: number): number | null {
  const from = Math.max(windowStart, now - lookbackMs)
  const hours = (now - from) / 3_600_000
  if (hours < 1 / 60) return null
  return Math.max(0, percent - percentAt(points, from)) / hours
}

// How long until the limit reaches 100% at `perHour`; null when it never does.
export function runwayMs(percent: number, perHour: number | null): number | null {
  if (perHour === null || perHour <= 0) return null
  return (Math.max(0, 100 - percent) / perHour) * 3_600_000
}

// Points an hour that end the window at `target`; null once past it.
export function hourlyBudget(percent: number, target: number, msLeft: number): number | null {
  if (percent >= target) return null
  return (target - percent) / Math.max(1 / 60, msLeft / 3_600_000)
}

// What each hour of the day took, from the rises between readings, each
// counted in the local hour of the reading that showed it.
export function hourBuckets(points: [number, number][]): number[] {
  const buckets = new Array(24).fill(0)
  for (let i = 1; i < points.length; i++) {
    const rise = points[i][1] - points[i - 1][1]
    if (rise > 0) buckets[new Date(points[i][0]).getHours()] += rise
  }
  return buckets
}

// This session's turns in the window, oldest first.
export function sessionTurns(turns: Turns | null, resetsAt: number, sessionId: string | null, since: number | null): TurnCost[] {
  if (turns === null || sessionId === null || !isSameWindow(turns.resetsAt, resetsAt)) return []
  return turns.turns.filter(t => t.session === sessionId && (since === null || t.at >= since))
}

// The braille cells of the terminal's sparkline: one per slice of the window
// up to now, as tall as the last reading in it, and how many there are.
export function sparkDots(points: [number, number][], resetsAt: number, windowMs: number, now: number, width = 30): { dots: number[]; upTo: number } {
  const start = resetsAt - windowMs
  const upTo = Math.max(0, Math.min(width, Math.ceil(((now - start) / windowMs) * width)))
  const dots = Array.from({ length: width }, (_, i) => {
    if (i >= upTo) return 0
    const p = percentAt(points, start + ((i + 1) / width) * windowMs)
    return p <= 0 ? 0 : Math.max(1, Math.round((Math.min(100, p) / 100) * 8))
  })
  return { dots, upTo }
}

// What the weekly limit took, by local day and hour of the day: points of the
// 7d limit, as `{ '2026-10-12': [24 numbers] }`. Kept across windows, so the
// activity grid reaches back past the current week.
export type Days = Record<string, number[]>

export const MAX_DAYS = 140

export function dayKey(at: number) {
  const t = new Date(at)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

// The days with `rise` points added in the hour of `at`, the oldest dropped
// past MAX_DAYS.
export function addRise(days: Days, at: number, rise: number): Days {
  if (rise <= 0) return days
  const key = dayKey(at)
  const hours = [...(days[key] ?? new Array(24).fill(0))]
  hours[new Date(at).getHours()] += rise
  const next = { ...days, [key]: hours }
  const keys = Object.keys(next).sort()
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete next[old]
  return next
}

// The rises between a window's readings, as days: what seeds the activity
// before any was kept.
export function daysOf(points: [number, number][]): Days {
  let days: Days = {}
  for (let i = 1; i < points.length; i++) days = addRise(days, points[i][0], points[i][1] - points[i - 1][1])
  return days
}

// Each hour of the day summed over every kept day.
export function hoursOf(days: Days): number[] {
  const sum = new Array(24).fill(0)
  for (const hours of Object.values(days)) hours.forEach((v, h) => (sum[h] += v))
  return sum
}

// A cell's shade, 0 (nothing) to 4, as GitHub's graph: each step a quarter
// of the largest cell.
export function shade(v: number, max: number) {
  if (v <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((v / max) * 4)))
}

// What each model family cost, by local day: `{ '2026-10-12': { opus: 1.2 } }`
// in dollars, as the session's own cost ledger grew over each of its steps.
export type ModelDays = Record<string, Record<string, number>>

// The cross's arms, in the order drawn: up, right, down, left.
export const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const
export const MODEL_NAMES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', other: 'Other' }

// `claude-opus-5-5[1m]` is opus; a model of no known family is other.
export function familyOf(model: string): string {
  const m = model.toLowerCase()
  return MODEL_FAMILIES.find(f => m.includes(f)) ?? 'other'
}

export function addSpend(days: ModelDays, at: number, model: string, usd: number): ModelDays {
  if (!(usd > 0)) return days
  const key = dayKey(at)
  const family = familyOf(model)
  const day = { ...(days[key] ?? {}) }
  day[family] = (day[family] ?? 0) + usd
  const next = { ...days, [key]: day }
  const keys = Object.keys(next).sort()
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete next[old]
  return next
}

// Each family's share of the spend kept, the cross's four and `other`.
export function modelShares(days: ModelDays): { shares: number[]; other: number; total: number } {
  const sum: Record<string, number> = {}
  for (const day of Object.values(days)) for (const [f, usd] of Object.entries(day)) sum[f] = (sum[f] ?? 0) + usd
  const total = Object.values(sum).reduce((a, b) => a + b, 0)
  if (total <= 0) return { shares: [0, 0, 0, 0], other: 0, total: 0 }
  return { shares: MODEL_FAMILIES.map(f => (sum[f] ?? 0) / total), other: (sum.other ?? 0) / total, total }
}
