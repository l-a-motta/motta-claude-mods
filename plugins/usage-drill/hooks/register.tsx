// usage-drill: a Usage pane of each rate limit (5h, 7d): its percent, when
// it resets, where the pace so far ends, and its readings this window drawn
// against an even pace (a line image on the desktop, blocks in the terminal).
//
// The readings are kept in $.store, one list per limit, a reading added each
// time the percent moves: the engine's measure after a response, and a fresh
// read after each main-session turn. Opened by /usage-drill, or by another
// mod through the noun this mod adds to `$`, `$.usageDrill.open()`: a mod
// opens only its own panes, so motta-statusline's 5h and 7d ask this one to.

import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { UsageDrillOpened } from '../types'

const PANE = 'usage-drill'

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const LIMIT_WINDOWS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

export type Limit = { label: string; windowMs: number | null; percent: number; resetsAt: number | null }

// A limit's readings this window, as kept in $.store: when each came and the
// percent it said. A window that reset leaves its readings behind.
type Readings = { resetsAt: number; points: [number, number][] }

const MAX_READINGS = 300

// The last reading of the limits; null before the first.
let limits: Limit[] | null = null

export const register: Register = on => {
  // The noun's own answer is the bottom of its event; the hook on
  // `usageDrill.open` below answers first with this mod's `$`.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, usageDrill: { open: async (): Promise<UsageDrillOpened> => ({ isPlaced: false, reason: 'usage-drill did not answer the call' }) } }
  })

  on('usageDrill.open', async $ => ({ value: await open($) }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-drill', description: 'Show the rate limits, their pace and their readings this window' })
    return next(e)
  })

  on('command.run', { command: 'usage-drill' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? 'Usage pane opened.' : `Usage pane waits: ${opened.reason ?? 'not placed'}` }
  })

  // The engine's push when a rate-limit window moves a whole point, from any
  // response: a subagent's too, and a background one's after the turn ended.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await note($, limitsOf(e.rateLimits))
    return measured
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await readLimits($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const readings: Record<string, Readings | null> = {}
    for (const l of limits ?? []) readings[l.label] = await readStored($, l.label)
    return usagePane(table.Box, table.Text, 'Svg' in table ? table.Svg : null, limits, readings, await $.clock.now())
  })
}

async function readLimits($: EngineInterface) {
  try {
    await note($, limitsOf((await $.session.usage()).rateLimits))
  } catch {
    // The last reading stays.
  }
}

// Takes a reading: keeps it for the pane when a limit's percent moved, and
// redraws the pane.
async function note($: EngineInterface, next: Limit[]) {
  limits = next
  const now = await $.clock.now()
  for (const l of next) {
    if (l.resetsAt === null) continue
    const points = pointsOf(await readStored($, l.label), l)
    if (points[points.length - 1]?.[1] === l.percent) continue
    try {
      await $.store.set(`usage:${l.label}`, { resetsAt: l.resetsAt, points: [...points, [now, l.percent]].slice(-MAX_READINGS) })
    } catch {
      // Not kept; the pane draws what it has.
    }
  }
  $.ui.invalidate('ui.render')
}

async function open($: EngineInterface): Promise<UsageDrillOpened> {
  await readLimits($)
  const opened = await $.ui.open({ id: PANE, title: 'Usage' })
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

export function limitsOf(rateLimits: SessionRateLimit[]): Limit[] {
  return rateLimits.map(l => ({
    label: LIMIT_LABELS[l.kind] ?? l.kind,
    windowMs: LIMIT_WINDOWS[l.kind] ?? null,
    percent: Math.round(l.percentUsed),
    resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
  }))
}

function pointsOf(r: Readings | null, l: Limit): [number, number][] {
  return r !== null && l.resetsAt !== null && Math.abs(r.resetsAt - l.resetsAt) < 5 * 60_000 ? r.points : []
}

async function readStored($: EngineInterface, label: string): Promise<Readings | null> {
  try {
    const kept = (await $.store.get(`usage:${label}`)) as Readings | undefined
    return kept && Array.isArray(kept.points) && typeof kept.resetsAt === 'number' ? kept : null
  } catch {
    return null
  }
}

// Each limit: its figure, when it resets, where this pace ends, and the
// readings seen this window against an even pace.
function usagePane(Box: any, Text: any, Svg: any, ls: Limit[] | null, readings: Record<string, Readings | null>, now: number) {
  if (ls === null || ls.length === 0) return <Text dimColor>No rate-limit reading yet: one comes with the next response.</Text>
  return (
    <Box flexDirection="column" rowGap={1}>
      {ls.map(l => {
        const pace = l.resetsAt === null ? null : elapsedShare(l.resetsAt, l.windowMs, now)
        const color = limitLevel(l.percent, pace)
        const points = pointsOf(readings[l.label] ?? null, l)
        return (
          <Box key={l.label} flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Text bold>{l.label}</Text>
              <Text color={color} bold>{l.percent}%</Text>
              {l.resetsAt !== null && (
                <Text color="subtle">
                  resets {clockAt(l.resetsAt, l.windowMs)}, in {resetIn(l.resetsAt - now)}
                </Text>
              )}
            </Box>
            <Text color="subtle">{projection(l.percent, pace, l.windowMs)}</Text>
            {l.resetsAt !== null && l.windowMs !== null && (Svg !== null ? (
              <Svg source={sparkSvg(points, l.resetsAt, l.windowMs, now, color)} alt={`${l.label} readings this window`} width={SPARK_W} height={SPARK_H} />
            ) : (
              <Text color={color}>{sparkText(points, l.resetsAt, l.windowMs, now)}</Text>
            ))}
          </Box>
        )
      })}
    </Box>
  )
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

// The theme has no orange key; a raw color draws the same on every theme.
const ORANGE = '#ff8700'
const PACE_MARGIN = 10

// Red from 80%. Short of that, orange when the limit runs PACE_MARGIN points
// or more ahead of the window's time, yellow from 60%, green below: the
// status line's colors for the same bar.
export function limitLevel(percent: number, elapsed: number | null) {
  if (percent >= 80) return 'error'
  if (elapsed !== null && percent - elapsed * 100 >= PACE_MARGIN) return ORANGE
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

// `16:47`, or `Wed 09:12` for a window longer than a day, in local time.
function clockAt(at: number, windowMs: number | null) {
  const t = new Date(at)
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return windowMs !== null && windowMs > 86_400_000 ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getDay()]} ${hm}` : hm
}

const SPARK_W = 240
const SPARK_H = 48
const SVG_COLORS: Record<string, string> = { success: '#4eba65', warning: '#e5b84b', error: '#ef5350', suggestion: '#6a9ef5' }

// The readings as a line across the window, against the dashed line of an
// even pace to 100% and a mark where the window stands now.
export function sparkSvg(points: [number, number][], resetsAt: number, windowMs: number, now: number, color: string) {
  const start = resetsAt - windowMs
  const x = (t: number) => Math.round(Math.min(1, Math.max(0, (t - start) / windowMs)) * SPARK_W * 10) / 10
  const y = (p: number) => Math.round((SPARK_H - 2 - (Math.min(100, p) / 100) * (SPARK_H - 4)) * 10) / 10
  const line = points.map(([t, p]) => `${x(t)},${y(p)}`).join(' ')
  const fill = SVG_COLORS[color] ?? color
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}">
<style>.k{fill:#e4e4e2}.p{stroke:#8a8a8a}.n{fill:#1f1f1f}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}.p{stroke:#6a6a6a}.n{fill:#ececec}}</style>
<rect class="k" width="${SPARK_W}" height="${SPARK_H}" rx="3"/>
<line class="p" x1="0" y1="${y(0)}" x2="${SPARK_W}" y2="${y(100)}" stroke-width="1" stroke-dasharray="3 3"/>
${points.length > 1 ? `<polyline fill="none" stroke="${fill}" stroke-width="2" stroke-linejoin="round" points="${line}"/>` : ''}
<rect class="n" x="${Math.max(0, x(now) - 0.75)}" y="0" width="1.5" height="${SPARK_H}"/>
</svg>`
}

// The terminal's sparkline: one block per slice of the window up to now, as
// tall as the last reading in it.
export function sparkText(points: [number, number][], resetsAt: number, windowMs: number, now: number, width = 30) {
  const start = resetsAt - windowMs
  const upTo = Math.min(width, Math.ceil(((now - start) / windowMs) * width))
  let last = 0
  let out = ''
  for (let i = 0; i < upTo; i++) {
    const end = start + ((i + 1) / width) * windowMs
    for (const [t, p] of points) if (t <= end) last = p
    out += '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((last / 100) * 8))]
  }
  return out.padEnd(width, '·')
}
