// The bars, drawn as motta-statusline draws its own (a mod imports only its
// own files, so they are copied here): on the desktop an image of blocks of
// small squares, elsewhere braille cells, a cell's dots rising from its
// bottom row. A bar is a list of blocks, each lit 0 to 10: a 0-100 figure
// fills them left to right (barBlocks), a series lights one block per value
// (seriesBlocks).

// The theme has no orange key; a raw color draws the same on every theme.
export const ORANGE = '#ff8700'

export const SVG_COLORS: Record<string, string> = { success: '#4eba65', warning: '#e5b84b', error: '#ef5350', suggestion: '#6a9ef5', subtle: '#8a8a8a' }

// Each block of a 0-100 figure: ten points to a block, filled left to right.
export function barBlocks(points: number): number[] {
  const p = Math.min(100, Math.max(0, Math.round(points)))
  return Array.from({ length: 10 }, (_, i) => Math.min(10, Math.max(0, p - i * 10)))
}

// One block per value, lit in proportion to the largest, and at least one
// square for any value above zero.
export function seriesBlocks(values: number[]): number[] {
  const max = Math.max(0, ...values)
  return values.map(v => (v <= 0 || max <= 0 ? 0 : Math.max(1, Math.round((v / max) * 10))))
}

// The desktop's bar: a block per entry of `lit`, SQ_COLS squares wide and
// SQ_ROWS tall on a track of its own, its squares lit from its bottom row
// up, left then right. `color` is one for every block or one per block.
// With `ramp` 'squares' each square is a step brighter than the one lit
// before it across the bar (RAMP_FROM), the newest at full; with 'blocks'
// each block is a step brighter than the one before it, for a series oldest
// first; with 'none' all are at full. A tick stands exactly where `share`
// (0-1) falls, measured along the blocks' tracks, the gaps left out. An image
// has no theme keys: the colors are the desktop's, the track and tick
// following its light or dark scheme.
export function squaresSvg(lit: number[], color: string | string[], share: number | null, ramp: Ramp = 'squares'): string {
  const n = lit.length
  const w = blocksWidth(n)
  const blockX = (block: number) => 1 + block * SQ_STRIDE
  const total = lit.reduce((sum, l) => sum + l, 0)
  const tracks: string[] = []
  const squares: string[] = []
  let order = 0
  for (let block = 0; block < n; block++) {
    tracks.push(`<rect x="${blockX(block) - 1}" y="0" width="${SQ_TRACK}" height="${SQ_H}" rx="1.5"/>`)
    const fill = svgColor(Array.isArray(color) ? (color[block] ?? 'subtle') : color)
    for (let i = 0; i < Math.min(10, lit[block] ?? 0); i++) {
      order++
      const col = i % SQ_COLS
      const row = SQ_ROWS - 1 - Math.floor(i / SQ_COLS)
      const step = ramp === 'squares' ? order / total : ramp === 'blocks' ? (block + 1) / n : 1
      const opacity = (RAMP_FROM + (1 - RAMP_FROM) * step).toFixed(3)
      squares.push(`<rect x="${blockX(block) + col * SQ_PITCH}" y="${1 + row * SQ_PITCH}" width="2" height="2" fill="${fill}" opacity="${opacity}"/>`)
    }
  }
  let tick = ''
  if (share !== null) {
    // The share placed along its block's track; 1 is the bar's end.
    const at = Math.min(n, Math.max(0, share * n))
    const block = Math.min(n - 1, Math.floor(at))
    const center = blockX(block) - 1 + (at - block) * SQ_TRACK
    const x = Math.min(w - 1.5, Math.max(0, center - 0.75))
    tick = `<rect class="tk" x="${Math.round(x * 100) / 100}" y="0" width="1.5" height="${SQ_H}" rx="0.75"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${SQ_H}" viewBox="0 0 ${w} ${SQ_H}">
<style>.k{fill:#e4e4e2}.tk{fill:#1f1f1f}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}.tk{fill:#ececec}}</style>
<g class="k">${tracks.join('')}</g>
${squares.join('')}${tick}
</svg>`
}

export type Ramp = 'squares' | 'blocks' | 'none'

export function svgColor(color: string) {
  return SVG_COLORS[color] ?? color
}

export const blocksWidth = (blocks: number) => blocks * SQ_STRIDE - SQ_GAP

const SQ_COLS = 2
const SQ_ROWS = 5
const SQ_PITCH = 3
// The space between two blocks' tracks, and from one block's start to the next.
const SQ_GAP = 2
// A block's track, from its left edge to its right.
const SQ_TRACK = SQ_COLS * SQ_PITCH + 1
const SQ_STRIDE = SQ_TRACK + SQ_GAP
export const SQ_H = SQ_ROWS * SQ_PITCH + 1

// The strength of the bar's first square; each square after it, in the
// order they light, is a step brighter, the newest at full.
const RAMP_FROM = 0.45

// The terminal's bar: a braille cell per block, its 10 points spread over
// the cell's 8 dots, at least one for any point.
export function blockDots(lit: number[]): number[] {
  return lit.map(l => (l <= 0 ? 0 : Math.max(1, Math.round((Math.min(10, l) * DOT_BITS.length) / 10))))
}

// A bar of braille cells: a cell's dots fill from the bottom row up in its
// color, an empty cell is a subtle track of its bottom two dots, and a `|`
// tick (the theme's text color) stands before cell `mark`, or after the last
// when `mark` is the cell count. Braille, not blocks or box-drawing: a
// desktop draws text in a proportional font, where block glyphs come out
// ragged and box-drawing lines join into one long rule. No tick when `mark`
// is null.
export function meter(Text: any, dots: number[], color: string | string[], mark: number | null) {
  // One Text per run of one color, the tick its own.
  const runs: { color: string; text: string }[] = []
  const add = (text: string, runColor: string) => {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === runColor && last.text !== '|') last.text += text
    else runs.push({ color: runColor, text })
  }
  dots.forEach((n, i) => {
    if (i === mark) runs.push({ color: 'text', text: '|' })
    if (n === 0) add(TRACK, 'subtle')
    else add(braille(n), Array.isArray(color) ? (color[i] ?? 'subtle') : color)
  })
  if (mark === dots.length) runs.push({ color: 'text', text: '|' })
  return runs.map(r => (
    <Text color={r.color} bold={r.text === '|'}>
      {r.text}
    </Text>
  ))
}

// A braille cell's dots in the order they fill: the bottom row left then
// right, then each row above.
const DOT_BITS = [0x40, 0x80, 0x04, 0x20, 0x02, 0x10, 0x01, 0x08]

// The braille character with a cell's first `n` dots raised.
export function braille(n: number) {
  return String.fromCharCode(0x2800 + DOT_BITS.slice(0, n).reduce((bits, bit) => bits | bit, 0))
}

export const TRACK = braille(2)

// A 0-100 figure across `width` pixels: the status line's bar made longer,
// as many of its blocks (each SQ_COLS by SQ_ROWS squares on its own track) as
// fit, each holding its share of the 100 points; the tick exactly at
// `share` (0-1).
export function wideBarSvg(points: number, color: string, share: number | null, width: number): string {
  const blocks = Math.max(10, Math.floor((width + SQ_GAP) / SQ_STRIDE))
  const per = 100 / blocks
  const p = Math.min(100, Math.max(0, points))
  const lit = Array.from({ length: blocks }, (_, i) => Math.round(Math.min(1, Math.max(0, (p - i * per) / per)) * 10))
  return squaresSvg(lit, color, share, 'squares')
}

// How wide wideBarSvg draws at `width`.
export const wideBarWidth = (width: number) => blocksWidth(Math.max(10, Math.floor((width + SQ_GAP) / SQ_STRIDE)))


// A 0-100 figure over `cells` braille cells, each cell its share of the
// points spread over its 8 dots, at least one for any point.
export function dotsAcross(points: number, cells: number): number[] {
  const per = 100 / cells
  const p = Math.min(100, Math.max(0, points))
  return Array.from({ length: cells }, (_, i) => {
    const inCell = Math.min(per, Math.max(0, p - i * per))
    return inCell <= 0 ? 0 : Math.max(1, Math.round((inCell * DOT_BITS.length) / per))
  })
}
