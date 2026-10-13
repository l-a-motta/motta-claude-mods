// The pane's bars, drawn the way motta-statusline draws its own: on the
// desktop a grid of small squares as an SVG image (blocks of ten squares,
// two wide and five tall, each block on a track of its own), elsewhere
// braille cells, a cell's dots rising from its bottom row as its points come.
// Braille, not blocks: a desktop draws text in a proportional font, where
// block characters come out as slabs and box-drawing joins into one rule.

// One stretch of a bar: its tokens and its color, a theme key or a raw color.
export type Segment = { tokens: number; color: string }

// A run of braille text in one color; `|` is the tick.
export type Run = { color: string; text: string }

const SQ_COLS = 2
const SQ_ROWS = 5
const SQ_PITCH = 3
const SQ_GAP = 2
const SQ_TRACK = SQ_COLS * SQ_PITCH + 1
const SQ_STRIDE = SQ_TRACK + SQ_GAP
const SQ_H = SQ_ROWS * SQ_PITCH + 1
const SQUARES = SQ_COLS * SQ_ROWS

// The width a bar of `blocks` blocks takes on the desktop, in CSS pixels.
export const barWidth = (blocks: number) => blocks * SQ_STRIDE - SQ_GAP
export const BAR_HEIGHT = SQ_H

// The track and tick follow the desktop's light or dark scheme; an image has
// no theme keys.
const SVG_STYLE = '<style>.k{fill:#e4e4e2}.tk{fill:#1f1f1f}.ln{stroke:#8a8a8a}.lb{fill:#8a8a8a;font:11px sans-serif}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}.tk{fill:#ececec}}</style>'

// The theme keys /context and the pane color with, as the desktop draws them.
// A key the map lacks takes a color of PALETTE by its place in the bar.
const SVG_COLORS: Record<string, string> = {
  success: '#4eba65', green: '#4eba65', warning: '#e5b84b', yellow: '#e5b84b', error: '#ef5350', red: '#ef5350',
  suggestion: '#6a9ef5', blue: '#6a9ef5', merged: '#a371f7', purple: '#a371f7', autoaccept: '#af87ff',
  cyan: '#4fb8c9', ide: '#47a5c8', planmode: '#48968c', permission: '#b1b9f9', remember: '#b1b9f9',
  claude: '#d97757', orange: '#ff8700', magenta: '#d16ec4', pink: '#d16ec4', bashborder: '#fd5db1',
  promptborder: '#999999', inactive: '#8a8a8a', subtle: '#8a8a8a', text: '#cccccc',
}
const PALETTE = ['#7f77dd', '#1d9e75', '#d4537e', '#ba7517', '#378add', '#d85a30', '#888780']

export function svgColor(color: string, index = 0) {
  if (color.startsWith('#') || color.startsWith('rgb')) return color
  const key = color.replace(/_FOR_SUBAGENTS_ONLY$/i, '').toLowerCase()
  return SVG_COLORS[key] ?? PALETTE[index % PALETTE.length]!
}

// A bar of `blocks` blocks over `total` tokens: each segment's squares in its
// color, in order from the left, each block lit from its bottom row up, left
// then right; a tick exactly at `share` (0-1) of the bar, the gaps left out.
// `ramp` brightens each lit square a step over the one before, as the
// status line's single-color bars do; `scale` draws the whole bar larger.
export function squaresSvg(segments: Segment[], total: number, blocks: number, share: number | null, ramp = false, scale = 1): string {
  const count = blocks * SQUARES
  const x = (block: number) => 1 + block * SQ_STRIDE
  const tracks: string[] = []
  for (let b = 0; b < blocks; b++) tracks.push(`<rect x="${x(b) - 1}" y="0" width="${SQ_TRACK}" height="${SQ_H}" rx="1.5"/>`)
  const lit = litSquares(segments, total, count)
  const squares = lit.map((seg, i) => {
    const block = Math.floor(i / SQUARES)
    const col = i % SQ_COLS
    const row = SQ_ROWS - 1 - Math.floor((i % SQUARES) / SQ_COLS)
    const opacity = ramp ? ` opacity="${(0.45 + (0.55 * (i + 1)) / lit.length).toFixed(3)}"` : ''
    return `<rect x="${x(block) + col * SQ_PITCH}" y="${1 + row * SQ_PITCH}" width="2" height="2" fill="${svgColor(segments[seg]!.color, seg)}"${opacity}/>`
  })
  let tick = ''
  if (share !== null) {
    const at = Math.min(1, Math.max(0, share)) * blocks
    const block = Math.min(blocks - 1, Math.floor(at))
    const center = x(block) - 1 + (at - block) * SQ_TRACK
    const left = Math.min(barWidth(blocks) - 1.5, Math.max(0, center - 0.75))
    tick = `<rect class="tk" x="${Math.round(left * 100) / 100}" y="0" width="1.5" height="${SQ_H}" rx="0.75"/>`
  }
  const w = barWidth(blocks)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${SQ_H * scale}" viewBox="0 0 ${w} ${SQ_H}">${SVG_STYLE}<g class="k">${tracks.join('')}</g>${squares.join('')}${tick}</svg>`
}

// Which segment each lit square belongs to, in order: a segment's squares are
// its share of `count`, rounded on the running total so they add up, and a
// segment with any tokens lights at least one.
export function litSquares(segments: Segment[], total: number, count: number): number[] {
  const out: number[] = []
  if (total <= 0) return out
  let acc = 0
  segments.forEach((s, i) => {
    const from = Math.round((acc / total) * count)
    acc += Math.max(0, s.tokens)
    let to = Math.min(count, Math.round((acc / total) * count))
    if (s.tokens > 0 && to <= from && from < count) to = from + 1
    for (let n = Math.max(from, out.length); n < to; n++) out.push(i)
  })
  return out.slice(0, count)
}

// A braille bar of `cells` cells over `total` tokens: each cell in the color
// of the segment holding most of it, its dots its filled share of 8; an empty
// cell a subtle track of its bottom two dots; the tick before the cell where
// `share` falls.
export function brailleRuns(segments: Segment[], total: number, cells: number, share: number | null): Run[] {
  const runs: Run[] = []
  const add = (text: string, color: string) => {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === color && last.text !== '|') last.text += text
    else runs.push({ color, text })
  }
  const mark = share === null ? null : Math.min(cells - 1, Math.max(0, Math.round(share * cells)))
  const ends: number[] = []
  let acc = 0
  for (const s of segments) ends.push((acc += Math.max(0, s.tokens)))
  for (let c = 0; c < cells; c++) {
    if (c === mark) runs.push({ color: 'text', text: '|' })
    const lo = (c / cells) * total
    const hi = ((c + 1) / cells) * total
    let best = -1
    let bestIn = 0
    let filled = 0
    segments.forEach((_, i) => {
      const start = i === 0 ? 0 : ends[i - 1]!
      const inCell = Math.max(0, Math.min(hi, ends[i]!) - Math.max(lo, start))
      filled += inCell
      if (inCell > bestIn) (best = i), (bestIn = inCell)
    })
    const dots = total > 0 ? Math.round((filled / (hi - lo)) * 8) : 0
    if (best < 0 || dots === 0) add(braille(2), 'subtle')
    else add(braille(dots), segments[best]!.color)
  }
  return runs
}

// A braille cell's dots in the order they fill: the bottom row left then
// right, then each row above.
const DOT_BITS = [0x40, 0x80, 0x04, 0x20, 0x02, 0x10, 0x01, 0x08]

export function braille(n: number) {
  return String.fromCharCode(0x2800 + DOT_BITS.slice(0, n).reduce((bits, bit) => bits | bit, 0))
}

// The fill after each turn as a line over a faint area, the newest point
// dotted and labeled, under a dashed rule where auto-compact fires, labeled
// too. The scale's top is a tenth above the higher of the two, so the line's
// growth reads instead of lying flat along the bottom.
export function sparkSvg(points: number[], compactAt: number | null, color: string, labels: { compact: string; last: string }, width = 480, height = 64): string {
  const top = Math.max(compactAt ?? 0, ...points) * 1.1 || 1
  const pad = 14
  const y = (v: number) => Math.round((height - 2 - (v / top) * (height - pad - 2)) * 10) / 10
  const right = width - 4
  const step = points.length > 1 ? right / (points.length - 1) : 0
  const xy = points.map((v, i) => [Math.round(i * step * 10) / 10, y(v)] as const)
  const line = xy.map(([x, v]) => `${x},${v}`).join(' ')
  const fill = svgColor(color)
  const [lx, ly] = xy[xy.length - 1] ?? [0, height]
  let rule = ''
  if (compactAt !== null) {
    const cy = y(compactAt)
    rule = `<line class="ln" x1="0" x2="${width}" y1="${cy}" y2="${cy}" stroke-dasharray="3 3" stroke-width="1"/><text class="lb" x="0" y="${cy - 3}">${labels.compact}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}${rule}<polygon fill="${fill}" opacity="0.15" points="0,${height} ${line} ${lx},${height}"/><polyline fill="none" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round" points="${line}"/><circle cx="${lx}" cy="${ly}" r="2.5" fill="${fill}"/><text class="lb" x="${Math.max(0, lx - 6)}" y="${Math.max(10, ly - 6)}" text-anchor="end">${labels.last}</text></svg>`
}

const SPARKS = '▁▂▃▄▅▆▇█'

// The same line in text, one block character a point.
export function sparkText(points: number[], max: number) {
  return points.map(v => SPARKS[Math.min(7, Math.max(0, Math.round((Math.min(v, max) / max) * 7)))]).join('')
}

// /context's own grid, square by square: each square in its row's color,
// as full as its `squareFullness`; an empty one a track square.
export function gridSvg(rows: { color: string; isFilled: boolean; squareFullness: number }[][]): string {
  const P = 9
  const cols = Math.max(0, ...rows.map(r => r.length))
  const w = cols * P - 2
  const h = rows.length * P - 2
  const colors: string[] = []
  const cells = rows.flatMap((row, r) =>
    row.map((sq, c) => {
      if (!sq.isFilled) return `<rect class="k" x="${c * P}" y="${r * P}" width="7" height="7" rx="1.5"/>`
      let i = colors.indexOf(sq.color)
      if (i < 0) i = colors.push(sq.color) - 1
      const o = Math.max(0.35, Math.min(1, sq.squareFullness)).toFixed(2)
      return `<rect x="${c * P}" y="${r * P}" width="7" height="7" rx="1.5" fill="${svgColor(sq.color, i)}" opacity="${o}"/>`
    }),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${SVG_STYLE}${cells.join('')}</svg>`
}
