// The weekly limit's activity, as GitHub draws contributions: a grid of days
// (columns, newest at the right) by three-hour slots of the day (rows), each
// cell shaded by what that slot took, and beside it a cross of the day's four
// spend by model family (Opus, Sonnet, Haiku, Fable), each arm as long as
// its share. Images on the desktop; colored
// squares and braille in the terminal.

import type { Days } from './figures.ts'
import type { ModelDays } from './figures.ts'
import { dayKey, hoursOf, MODEL_FAMILIES, MODEL_NAMES, modelShares, shade } from './figures.ts'
import { dotsAcross, meter } from './meter.tsx'

const SLOTS = 8
const SLOT_HOURS = 24 / SLOTS
const CELL = 10
const PITCH = 13
const LEFT = 24
const TOP = 16
const LEGEND = 22
const DAY = 86_400_000

// The light theme's shades, then the dark's: GitHub's greens.
const LIGHT = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
const DARK = ['#2c2c2c', '#0e4429', '#006d32', '#26a641', '#39d353']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Each slot of each day from `count` days back to today: [slot][day].
export function grid(days: Days, now: number, count: number): { cells: number[][]; dates: Date[] } {
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  const dates = Array.from({ length: count }, (_, i) => new Date(today.getTime() - (count - 1 - i) * DAY))
  const cells = Array.from({ length: SLOTS }, (_, slot) =>
    dates.map(d => (days[dayKey(d.getTime())] ?? []).slice(slot * SLOT_HOURS, (slot + 1) * SLOT_HOURS).reduce((a, b) => a + b, 0)),
  )
  return { cells, dates }
}

// How many days fit across `width` pixels.
export const daysAcross = (width: number) => Math.max(7, Math.floor((width - LEFT) / PITCH))

export function gridSvg(days: Days, now: number, width: number): { source: string; height: number } {
  const count = daysAcross(width)
  const { cells, dates } = grid(days, now, count)
  const max = Math.max(0, ...cells.flat())
  const height = TOP + SLOTS * PITCH + LEGEND
  const parts: string[] = []
  // A month's name over its first day, and over the first column when the
  // month has room left to show it.
  dates.forEach((d, i) => {
    if (d.getDate() === 1 || (i === 0 && d.getDate() <= 20)) parts.push(`<text class="t" x="${LEFT + i * PITCH}" y="11">${MONTHS[d.getMonth()]}</text>`)
  })
  for (let slot = 0; slot < SLOTS; slot += 2) parts.push(`<text class="t" x="0" y="${TOP + slot * PITCH + 9}">${String(slot * SLOT_HOURS).padStart(2, '0')}</text>`)
  cells.forEach((row, slot) =>
    row.forEach((v, i) => parts.push(`<rect class="s${shade(v, max)}" x="${LEFT + i * PITCH}" y="${TOP + slot * PITCH}" width="${CELL}" height="${CELL}" rx="2"/>`)),
  )
  // Less, the five shades, More, at the right under the grid.
  const legendY = TOP + SLOTS * PITCH + 8
  const right = LEFT + count * PITCH - 3
  const swatchesX = right - 26 - 5 * PITCH
  parts.push(`<text class="t" x="${swatchesX - 6}" y="${legendY + 9}" text-anchor="end">Less</text>`)
  for (let s = 0; s < 5; s++) parts.push(`<rect class="s${s}" x="${swatchesX + s * PITCH}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2"/>`)
  parts.push(`<text class="t" x="${right}" y="${legendY + 9}" text-anchor="end">More</text>`)
  const shades = (colors: string[]) => colors.map((c, i) => `.s${i}{fill:${c}}`).join('')
  const w = LEFT + count * PITCH
  return {
    height,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}">
<style>${shades(LIGHT)}.t{fill:#6e6e6e;font:10px system-ui,sans-serif}@media (prefers-color-scheme: dark){${shades(DARK)}.t{fill:#9a9a9a}}</style>
${parts.join('\n')}
</svg>`,
  }
}

export const gridWidth = (width: number) => LEFT + daysAcross(width) * PITCH

// The cross: an arm per model family (Opus up, Sonnet right, Haiku down,
// Fable left), each point as far out as its share of the largest, the shape
// between them filled, and each arm's name and share at its end.
export function crossSvg(shares: number[]): string {
  const W = 300
  const H = 200
  const cx = W / 2
  const cy = H / 2
  const arm = 62
  const max = Math.max(...shares)
  const reach = (s: number) => (max <= 0 ? 0 : Math.max(3, (s / max) * arm))
  // Up, right, down, left, as MODEL_FAMILIES.
  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]
  const pts = shares.map((s, i) => [cx + dirs[i][0] * reach(s), cy + dirs[i][1] * reach(s)])
  const pct = (s: number) => `${Math.round(s * 100)}%`
  const label = (i: number, x: number, y: number, anchor: string) =>
    `<text class="v" x="${x}" y="${y}" text-anchor="${anchor}">${pct(shares[i])}</text><text class="t" x="${x}" y="${y + 15}" text-anchor="${anchor}">${MODEL_NAMES[MODEL_FAMILIES[i]]}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.a{stroke:#26a641}.f{fill:#26a641;fill-opacity:.45;stroke:#39d353;stroke-width:1.5}.d{fill:#ffffff;stroke:#39d353;stroke-width:2}.t,.v{fill:#6e6e6e;font:12px system-ui,sans-serif}.v{fill:#4a4a4a}@media (prefers-color-scheme: dark){.t{fill:#9a9a9a}.v{fill:#c8c8c8}}</style>
<line class="a" x1="${cx - arm - 8}" y1="${cy}" x2="${cx + arm + 8}" y2="${cy}" stroke-width="2"/>
<line class="a" x1="${cx}" y1="${cy - arm - 8}" x2="${cx}" y2="${cy + arm + 8}" stroke-width="2"/>
${max > 0 ? `<polygon class="f" points="${pts.map(p => p.join(',')).join(' ')}"/>${pts.map(([x, y]) => `<circle class="d" cx="${x}" cy="${y}" r="3.5"/>`).join('')}` : ''}
${label(0, cx, 14, 'middle')}
${label(1, cx + arm + 14, cy - 4, 'start')}
${label(2, cx, H - 20, 'middle')}
${label(3, cx - arm - 14, cy - 4, 'end')}
</svg>`
}

// The terminal's grid: a row of squares per slot, each colored by its shade,
// the hour before it on every other row.
export function gridText(Box: any, Text: any, days: Days, now: number, columns: number) {
  const count = Math.max(7, columns - 4)
  const { cells } = grid(days, now, count)
  const max = Math.max(0, ...cells.flat())
  return cells.map((row, slot) => {
    const runs: { color: string; text: string }[] = []
    for (const v of row) {
      const s = shade(v, max)
      const glyph = s === 0 ? '·' : '■'
      const color = s === 0 ? 'subtle' : DARK[s]
      const last = runs[runs.length - 1]
      if (last !== undefined && last.color === color) last.text += glyph
      else runs.push({ color, text: glyph })
    }
    return (
      <Box key={`slot-${slot}`} flexDirection="row">
        <Box width={3}>{slot % 2 === 0 ? <Text color="subtle">{String(slot * SLOT_HOURS).padStart(2, '0')}</Text> : null}</Box>
        {runs.map(r => (
          <Text color={r.color}>{r.text}</Text>
        ))}
      </Box>
    )
  })
}

// The terminal's cross: a row per model family, its share as a braille bar.
export function modelsText(Box: any, Text: any, shares: number[]) {
  return MODEL_FAMILIES.map(f => MODEL_NAMES[f]).map((name, i) => (
    <Box key={name} flexDirection="row" columnGap={1}>
      <Box width={10}>
        <Text color="subtle">{name}</Text>
      </Box>
      <Box flexDirection="row">{meter(Text, dotsAcross(shares[i] * 100, 12), DARK[3], null)}</Box>
      <Text>{Math.round(shares[i] * 100)}%</Text>
    </Box>
  ))
}

// The day of the week that took the most, and its share.
export function busiestWeekday(days: Days): { name: string; share: number } | null {
  const sums = new Array(7).fill(0)
  for (const [key, hours] of Object.entries(days)) {
    const [y, m, d] = key.split('-').map(Number)
    sums[new Date(y, m - 1, d).getDay()] += hours.reduce((a, b) => a + b, 0)
  }
  const total = sums.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const best = sums.indexOf(Math.max(...sums))
  return { name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][best], share: sums[best] / total }
}

export function activityFigures(days: Days, models: ModelDays) {
  const hours = hoursOf(days)
  const total = hours.reduce((a, b) => a + b, 0)
  const busiestHour = total > 0 ? hours.indexOf(Math.max(...hours)) : null
  return { hours, total, busiestHour, models: modelShares(models), weekday: busiestWeekday(days), dayCount: Object.keys(days).length }
}

