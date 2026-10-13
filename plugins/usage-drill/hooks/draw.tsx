// The Usage pane: each limit as one line and one verdict, motta-statusline's
// bar between its name and its percent; the rest, side by side for 5h and
// 7d, under `details`, a row only where it has something to say. Spacing
// comes from the layout's gaps, never from spaces between pieces: a desktop
// draws a proportional font, where a space has no fixed width.

import type { Kept, Limit, Settings } from './figures.ts'
import {
  burnRate,
  elapsedShare,
  hourlyBudget,
  limitLevel,
  pointsOf,
  resetIn,
  runwayMs,
  sessionTurns,
  sparkDots,
} from './figures.ts'
import { activityFigures, crossSvg, gridSvg, gridText, modelsText } from './activity.tsx'
import type { Days, ModelDays } from './figures.ts'
import { MODEL_FAMILIES, MODEL_NAMES } from './figures.ts'
import { blockDots, blocksWidth, dotsAcross, meter, type Ramp, seriesBlocks, SQ_H, squaresSvg, svgColor, wideBarSvg, wideBarWidth } from './meter.tsx'

export type View = {
  limits: Limit[] | null
  kept: Record<string, Kept>
  days: Days
  models: ModelDays
  // Cells across the pane's body.
  columns: number
  session: { id: string | null; startedAt: number | null; costUsd: number | null }
  settings: Settings
  showDetails: boolean
  onToggleDetails: () => void
  now: number
}

const DAY = 86_400_000

// Cells the details table gives its labels; the limits share the rest.
const LABEL_W = 14
// A desktop cell in pixels, as savvy-progress sizes its cards.
const CELL_PX = 8

// What a limit comes to, in a few words and a color: `lead` in the color,
// `tail` after it, subtle.
export type Verdict = { color: string; lead: string; tail: string }

export function verdictOf(l: Limit, pace: number | null, burn: number | null, now: number, s: Settings): Verdict | null {
  if (l.resetsAt === null || l.windowMs === null || pace === null) return null
  if (pace < 0.02) return { color: 'subtle', lead: 'Too early to tell', tail: '' }
  if (l.exact <= 0) return { color: 'success', lead: 'Nothing used yet', tail: '' }
  const msLeft = Math.max(0, l.resetsAt - now)
  const average = l.exact / ((pace * l.windowMs) / 3_600_000)
  const left = runwayMs(l.exact, s.runwayBasis === 'recent' ? burn : average)
  if (s.runway && left !== null && left < msLeft) {
    return { color: 'error', lead: `Runs out at ${clockAt(now + left, left > DAY, s)}`, tail: `${resetIn(msLeft - left)} before the reset` }
  }
  const end = `about ${Math.min(100, Math.round(l.exact / pace))}% by the reset`
  const color = limitLevel(l.percent, pace, s)
  if (color === 'error') return { color, lead: 'Near the limit', tail: end }
  if (color === '#ff8700') return { color, lead: 'Ahead of pace', tail: end }
  if (l.exact / pace >= s.redFrom) return { color: 'warning', lead: 'Tight', tail: end }
  return { color: 'success', lead: 'On track', tail: end }
}

export function usagePane(table: any, Svg: any, v: View) {
  const { Box, Text, Button } = table
  const s = v.settings
  if (v.limits === null || v.limits.length === 0) return <Text dimColor>No rate-limit reading yet: one comes with the next response.</Text>
  const compact = s.density === 'compact'
  const columns = Math.max(40, v.columns || 80)
  // The body's width in pixels on the desktop.
  const widthPx = Math.max(240, columns * CELL_PX - CELL_PX)
  const VALUE_W = Math.max(16, Math.floor((columns - LABEL_W) / Math.max(1, v.limits.length)) - 1)

  // Pieces in a row that wraps between them; a piece left out is false.
  const row = (key: string, parts: unknown[], gap = compact ? 1 : 2) => (
    <Box key={key} flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={gap}>
      {parts.filter(p => p !== false && p !== null && p !== undefined)}
    </Box>
  )
  // A 0-10 lit block per entry: squares on the desktop, braille elsewhere,
  // a tick at `share` (0-1) of the bar.
  const bar = (alt: string, lit: number[], color: string | string[], share: number | null, ramp: Ramp) =>
    Svg !== null ? (
      <Svg source={squaresSvg(lit, color, share, ramp)} alt={alt} width={blocksWidth(lit.length)} height={SQ_H} />
    ) : (
      <Box flexDirection="row">{meter(Text, blockDots(lit), color, share === null ? null : Math.min(lit.length, Math.max(0, Math.round(share * lit.length))))}</Box>
    )
  const dim = (text: string) => <Text color="subtle">{text}</Text>

  type Figures = { l: Limit; pace: number | null; color: string; points: [number, number][]; burn: number | null; k: Kept | undefined }
  const figures: Figures[] = v.limits.map(l => {
    const pace = l.resetsAt === null ? null : elapsedShare(l.resetsAt, l.windowMs, v.now)
    const k = v.kept[l.label]
    const points = k === undefined ? [] : pointsOf(k.readings, l)
    const burn = l.resetsAt === null || l.windowMs === null ? null : burnRate(points, l.exact, l.resetsAt - l.windowMs, v.now, s.burnLookbackMs)
    return { l, pace, color: limitLevel(l.percent, pace, s), points, burn, k }
  })

  const sections = figures.map(({ l, pace, color, burn }) => {
    const verdict = verdictOf(l, pace, burn, v.now, s)
    return (
      <Box key={l.label} flexDirection="column">
        {row('head', [
          <Box width={3}>
            <Text bold>{l.label}</Text>
          </Box>,
          <Text color={color} bold>
            {l.percent}%
          </Text>,
          l.resetsAt !== null && dim(`resets ${resetText(l.resetsAt, l.windowMs, v.now, s)}`),
        ])}
        {s.gauge === 'bar' &&
          (Svg !== null ? (
            <Svg source={wideBarSvg(l.percent, color, pace, widthPx)} alt={`${l.label} limit ${l.percent}%`} width={wideBarWidth(widthPx)} height={SQ_H} />
          ) : (
            <Box flexDirection="row">{meter(Text, dotsAcross(l.percent, columns - 2), color, pace === null ? null : Math.round(pace * (columns - 2)))}</Box>
          ))}
        {verdict !== null &&
          row(
            'verdict',
            [
              <Box width={3} />,
              <Text color={verdict.color}>{verdict.lead}</Text>,
              verdict.tail !== '' && dim(verdict.tail),
            ],
            1,
          )}
      </Box>
    )
  })

  // The details: a row per figure, a cell per limit; a row whose cells all
  // have nothing to say is left out.
  const rows: { label: string; cells: unknown[] }[] = []
  const addRow = (label: string, cell: (f: Figures) => unknown) => {
    const cells = figures.map(cell)
    if (cells.some(c => c !== null && c !== false)) rows.push({ label, cells })
  }
  if (v.showDetails) {
    addRow('This window', ({ l, color, points }) => {
      if (l.resetsAt === null || l.windowMs === null) return null
      if (Svg !== null) return <Svg source={sparkSvg(points, l.resetsAt, l.windowMs, v.now, color, s, VALUE_W * CELL_PX - 16)} alt={`${l.label} readings this window`} width={VALUE_W * CELL_PX - 16} height={SPARK_H} />
      const { dots, upTo } = sparkDots(points, l.resetsAt, l.windowMs, v.now, VALUE_W - 4)
      return <Box flexDirection="row">{meter(Text, dots, color, upTo)}</Box>
    })
    if (s.burnRate) addRow('Burning', ({ burn }) => burn !== null && burn > 0 && row('b', [<Text>{perHour(burn)}/h</Text>, dim(`last ${Math.round(s.burnLookbackMs / 60_000)}m`)], 1))
    if (s.budget) {
      // Only where it bites: past the target, or under twice what the limit
      // goes at now.
      addRow(`To end at ${s.budgetTarget}%`, ({ l, pace, burn }) => {
        if (l.resetsAt === null || l.windowMs === null || pace === null || pace < 0.02) return null
        const budget = hourlyBudget(l.exact, s.budgetTarget, Math.max(0, l.resetsAt - v.now))
        if (budget === null) return <Text color="error">past it</Text>
        const going = Math.max(burn ?? 0, l.exact / ((pace * l.windowMs) / 3_600_000))
        return budget <= going * 2 && <Text color={budget < going ? 'warning' : 'text'}>under {perHour(budget)}/h</Text>
      })
    }
    const mine = (f: Figures) => (f.l.resetsAt === null ? [] : sessionTurns(f.k?.turns ?? null, f.l.resetsAt, v.session.id, v.session.startedAt))
    if (s.turnCosts) {
      addRow('Per turn', f => {
        const recent = mine(f).slice(-s.turnCount)
        if (recent.length === 0 || recent.every(t => t.delta === 0)) return null
        const deltas = recent.map(t => t.delta)
        const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
        return row(
          't',
          [
            s.turnShape === 'bars' ? bar(`${f.l.label} per turn`, seriesBlocks(deltas), f.color, null, 'blocks') : <Text>{deltas.map(d => `+${d.toFixed(1)}`).join(' ')}</Text>,
            dim(`avg ${avg.toFixed(1)}%`),
          ],
          1,
        )
      })
    }
    if (s.sessionShare || s.dollars === 'per-point') {
      addRow('This session', f => {
        const ours = Math.round(mine(f).reduce((a, t) => a + t.delta, 0) * 10) / 10
        if (ours <= 0) return null
        const cost = s.dollars === 'per-point' && v.session.costUsd !== null && ours >= 0.5 ? `$${(v.session.costUsd / ours).toFixed(2)} per 1%` : null
        return row('s', [s.sessionShare && <Text>{ours.toFixed(1)} of {f.l.exact} pts</Text>, cost !== null && dim(cost)], 1)
      })
    }
    if (s.history) {
      addRow('Past windows', ({ l, k }) => {
        const past = (k?.history ?? []).slice(-s.historyCount)
        if (past.length === 0) return null
        const values = past.map(h => (s.historyMetric === 'peak' ? h.peak : h.last))
        const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        return row(
          'h',
          [bar(`${l.label} past windows`, values.map(p => Math.min(10, Math.max(p > 0 ? 1 : 0, Math.round(p / 10)))), values.map(p => limitLevel(p, null, s)), null, 'blocks'), dim(`avg ${avg}%`)],
          1,
        )
      })
    }
    if (s.idleHint) {
      addRow('If you stop', ({ l }) => {
        if (l.resetsAt === null) return null
        return l.windowMs !== null && l.windowMs > DAY ? dim(`holds ${l.percent}% to ${clockAt(l.resetsAt, true, s)}`) : dim(`clears at ${clockAt(l.resetsAt, false, s)}`)
      })
    }
  }
  // The weekly limit's activity: the grid of days by hours, then the cross
  // of the spend by model family beside what stands out.
  const activity = () => {
    const a = activityFigures(v.days, v.models)
    const m = a.models
    if (a.total <= 0 && m.total <= 0) return null
    const top = m.total > 0 ? MODEL_FAMILIES[m.shares.indexOf(Math.max(...m.shares))] : null
    const facts = [
      a.busiestHour !== null && row('hour', [dim('Busiest hour'), <Text>{hourText(a.busiestHour, s)}</Text>], 1),
      a.weekday !== null && row('day', [dim('Busiest day'), <Text>{a.weekday.name}</Text>, dim(pct(a.weekday.share) + ' of it')], 1),
      a.total > 0 && row('total', [dim('Weekly limit'), <Text>{Math.round(a.total)} pts</Text>, dim('over ' + a.dayCount + (a.dayCount === 1 ? ' day' : ' days'))], 1),
      top !== null && row('model', [dim('Mostly'), <Text>{MODEL_NAMES[top]}</Text>, dim(pct(Math.max(...m.shares)) + ' of $' + m.total.toFixed(2) + ' by model')], 1),
      m.other > 0 && row('other', [dim('Other models'), <Text>{pct(m.other)}</Text>], 1),
      m.total <= 0 && row('model', [dim('By model'), dim('measured from the next response on')], 1),
    ]
    if (Svg === null) {
      return (
        <Box key="activity" flexDirection="column">
          <Text bold>Activity</Text>
          {a.total > 0 && gridText(Box, Text, v.days, v.now, columns)}
          {m.total > 0 && modelsText(Box, Text, m.shares)}
          {facts}
        </Box>
      )
    }
    const g = a.total > 0 ? gridSvg(v.days, v.now, widthPx) : null
    return (
      <Box key="activity" flexDirection="column" rowGap={0.5}>
        <Text bold>Activity</Text>
        {g !== null && <Svg source={g.source} alt="The weekly limit by day and hour" height={g.height} />}
        <Box flexDirection="row" flexWrap="wrap" columnGap={4} rowGap={0.5}>
          {facts.filter(f => f !== false)}
        </Box>
        {m.total > 0 && (
          <Box flexDirection="row" justifyContent="center">
            <Svg source={crossSvg(m.shares)} alt="The spend by model family" width={300} height={200} />
          </Box>
        )}
      </Box>
    )
  }
  const cell = (key: string, width: number, child: unknown) => (
    <Box key={key} width={width} flexShrink={0}>
      {child}
    </Box>
  )

  return (
    <Box flexDirection="column" rowGap={compact ? 0 : 1}>
      {sections}
      {v.showDetails && rows.length > 0 && (
        <Box flexDirection="column" rowGap={compact ? 0 : 0.5}>
          <Box flexDirection="row">
            {cell('label', LABEL_W, null)}
            {figures.map(f => cell(f.l.label, VALUE_W, <Text bold>{f.l.label}</Text>))}
          </Box>
          {rows.map(r => (
            <Box key={r.label} flexDirection="row" alignItems="center">
              {cell('label', LABEL_W, dim(r.label))}
              {r.cells.map((c, i) => cell(String(i), VALUE_W, c === null || c === false ? null : c))}
            </Box>
          ))}
          {s.dollars === 'total' && v.session.costUsd !== null && dim(`$${v.session.costUsd.toFixed(2)} spent this session`)}
        </Box>
      )}
      {v.showDetails && s.heatmap && activity()}
      <Box flexDirection="row">
        <Button key="details" plain dimColor hotkey="d" label={v.showDetails ? 'fewer details' : 'details'} onPress={v.onToggleDetails} />
      </Box>
    </Box>
  )
}

const pct = (share: number) => `${Math.round(share * 100)}%`

function perHour(points: number) {
  return `${points < 10 ? points.toFixed(1) : Math.round(points)}%`
}

// `16:47, in 2h05m`, or either half alone, as the settings say.
export function resetText(resetsAt: number, windowMs: number | null, now: number, s: Settings) {
  const at = clockAt(resetsAt, windowMs !== null && windowMs > DAY, s)
  const inText = `in ${resetIn(resetsAt - now)}`
  return s.resetAs === 'absolute' ? at : s.resetAs === 'relative' ? inText : `${at}, ${inText}`
}

// `16:47` or `4:47pm`, and `Wed 09:12` with the day, in local time.
export function clockAt(at: number, withDay: boolean, s: Pick<Settings, 'clock'>) {
  const t = new Date(at)
  const m = String(t.getMinutes()).padStart(2, '0')
  const hm = s.clock === '12h' ? `${t.getHours() % 12 || 12}:${m}${t.getHours() < 12 ? 'am' : 'pm'}` : `${String(t.getHours()).padStart(2, '0')}:${m}`
  return withDay ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getDay()]} ${hm}` : hm
}

function hourText(hour: number, s: Pick<Settings, 'clock'>) {
  return s.clock === '12h' ? `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}` : `${String(hour).padStart(2, '0')}:00`
}

const SPARK_H = 48

// The readings as a line across the window, the area under it filled, against
// the dashed line of an even pace to 100%, a dotted line from now to where
// the pace so far ends, and a mark where the window stands now.
export function sparkSvg(points: [number, number][], resetsAt: number, windowMs: number, now: number, color: string, s: Pick<Settings, 'sparkFill' | 'paceGuide' | 'projectionLine'>, width = 240) {
  const SPARK_W = Math.max(120, Math.round(width))
  const start = resetsAt - windowMs
  const share = (t: number) => Math.min(1, Math.max(0, (t - start) / windowMs))
  const x = (sh: number) => Math.round(sh * SPARK_W * 10) / 10
  const y = (p: number) => Math.round((SPARK_H - 2 - (Math.min(100, p) / 100) * (SPARK_H - 4)) * 10) / 10
  const fill = svgColor(color)
  const nowShare = share(now)
  const line = [[start, 0] as [number, number], ...points]
  const coords = line.map(([t, p]) => `${x(share(t))},${y(p)}`)
  const last = line[line.length - 1][1]
  const parts: string[] = []
  if (s.paceGuide) parts.push(`<line class="p" x1="0" y1="${y(0)}" x2="${SPARK_W}" y2="${y(100)}" stroke-width="1" stroke-dasharray="3 3"/>`)
  if (points.length > 0) {
    // The line runs on flat to now: the last reading holds until the next.
    coords.push(`${x(nowShare)},${y(last)}`)
    if (s.sparkFill === 'area') parts.push(`<polygon fill="${fill}" opacity="0.18" points="${coords.join(' ')} ${x(nowShare)},${y(0)} 0,${y(0)}"/>`)
    parts.push(`<polyline fill="none" stroke="${fill}" stroke-width="2" stroke-linejoin="round" points="${coords.join(' ')}"/>`)
  }
  if (s.projectionLine && last > 0 && nowShare >= 0.02) {
    // The pace so far run on: to the reset, or to where it reaches 100%.
    const end = last / nowShare
    const toShare = end <= 100 ? 1 : (nowShare * 100) / last
    parts.push(`<line x1="${x(nowShare)}" y1="${y(last)}" x2="${x(toShare)}" y2="${y(Math.min(100, end))}" stroke="${fill}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.8"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}">
<style>.k{fill:#e4e4e2}.p{stroke:#8a8a8a}.n{fill:#1f1f1f}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}.p{stroke:#6a6a6a}.n{fill:#ececec}}</style>
<rect class="k" width="${SPARK_W}" height="${SPARK_H}" rx="3"/>
${parts.join('\n')}
<rect class="n" x="${Math.max(0, x(nowShare) - 0.75)}" y="0" width="1.5" height="${SPARK_H}"/>
</svg>`
}
