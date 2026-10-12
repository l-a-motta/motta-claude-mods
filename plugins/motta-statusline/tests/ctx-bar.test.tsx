import { describe, expect, test } from 'claude-code/testing'

import { braille, cellDots, compactMark, compactShare, ctxLevel, elapsedShare, limitLevel, paceMark, resetIn, squaresSvg } from '../hooks/register.tsx'
import { answerSession, BAND_PROPS } from './session.tsx'

const HOUR = 3_600_000

describe('ctxLevel', () => {
  test('is green under 30%, yellow to 50%, orange to 70% and red past it', () => {
    expect(ctxLevel(29)).toBe('success')
    expect(ctxLevel(30)).toBe('warning')
    expect(ctxLevel(49)).toBe('warning')
    expect(ctxLevel(50)).toBe('#ff8700')
    expect(ctxLevel(69)).toBe('#ff8700')
    expect(ctxLevel(70)).toBe('error')
  })
})

describe('braille', () => {
  test('raises dots from the bottom row up, left then right', () => {
    expect(braille(0)).toBe('⠀')
    expect(braille(1)).toBe('⡀')
    expect(braille(2)).toBe('⣀')
    expect(braille(3)).toBe('⣄')
    expect(braille(8)).toBe('⣿')
  })
})

describe('cellDots', () => {
  test("fills a cell per 10 points and spreads the rest over the next cell's 8 dots", () => {
    expect(cellDots(36)).toEqual([8, 8, 8, 5, 0, 0, 0, 0, 0, 0])
    expect(cellDots(100)).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8, 8])
    expect(cellDots(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  test('shows a dot for any point, and a cell full only at its last point', () => {
    expect(cellDots(1)[0]).toBe(1)
    expect(cellDots(9)[0]).toBe(7)
    expect(cellDots(10)[0]).toBe(8)
  })

  test('takes one dot a point at 8 points a cell', () => {
    expect(cellDots(11, 8)).toEqual([8, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('compactMark', () => {
  test('puts the tick before the cell where auto-compact fires, never after the last', () => {
    expect(compactMark(835_000, 1_000_000)).toBe(8)
    // A 1M window compacts near 967k: the tick goes before the last cell, not on it.
    expect(compactMark(967_000, 1_000_000)).toBe(9)
    expect(compactMark(null, 1_000_000)).toBeNull()
    expect(compactMark(5, 0)).toBeNull()
  })
})

describe('compactShare', () => {
  test('is where auto-compact fires as a share of the window', () => {
    expect(compactShare(967_000, 1_000_000)).toBe(0.967)
    expect(compactShare(null, 1_000_000)).toBeNull()
  })
})

describe('paceMark', () => {
  test("puts the tick where the window's time stands, the end included", () => {
    expect(paceMark(0.74)).toBe(7)
    expect(paceMark(1)).toBe(10)
    expect(paceMark(null)).toBeNull()
  })
})

describe('elapsedShare', () => {
  test("is the share of the window gone by, within 0 and 1", () => {
    // 2h45m left of 5h: 45% gone.
    expect(Math.round((elapsedShare(2.75 * HOUR, 5 * HOUR, 0) ?? 0) * 100)).toBe(45)
    expect(elapsedShare(6 * HOUR, 5 * HOUR, 0)).toBe(0)
    expect(elapsedShare(0, 5 * HOUR, HOUR)).toBe(1)
    expect(elapsedShare(HOUR, null, 0)).toBeNull()
  })
})

describe('limitLevel', () => {
  test('is green, yellow from 60% and red from 80%', () => {
    expect(limitLevel(12, 0.45)).toBe('success')
    expect(limitLevel(60, 0.9)).toBe('warning')
    expect(limitLevel(80, 1)).toBe('error')
    expect(limitLevel(65, null)).toBe('warning')
  })

  test('is orange once the limit runs 10 points ahead of the window, short of red', () => {
    expect(limitLevel(40, 0.3)).toBe('#ff8700')
    expect(limitLevel(39, 0.3)).toBe('success')
    expect(limitLevel(91, 0.5)).toBe('error')
  })
})

describe('resetIn', () => {
  test('reads hours and minutes, and days and hours from a day on', () => {
    expect(resetIn(2.75 * HOUR)).toBe('2h45m')
    expect(resetIn(0.5 * HOUR)).toBe('30m')
    expect(resetIn(44 * HOUR + 25 * 60_000)).toBe('1d20h')
    expect(resetIn(0)).toBe('now')
  })
})

test('draws the context as braille cells with its compact tick, the share and the tokens', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  // 36% of 1M: three full cells and five dots of the fourth (yellow), the
  // track to the tick before cell 8, and the two cells past it still drawn.
  // `ctx` is the button that opens context-drill's Context pane, a space, then the bar.
  expect((await ui.find({ key: 'context' }))?.props.label).toBe('ctx')
  const texts = await ui.findAll({ type: 'Text' })
  const at = texts.findIndex(t => t.text?.startsWith('⣿'))
  expect(texts.slice(at, at + 4).map(t => [t.props.color, t.text])).toEqual([
    ['warning', '⣿⣿⣿⣦'],
    ['subtle', '⣀⣀⣀⣀'],
    ['text', '|'],
    ['subtle', '⣀⣀'],
  ])
  expect(await ui.find({ type: 'Text', text: '36%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '360k/1M' })).toBeDefined()
  // The context was printed a second time as In.
  expect(await ui.find({ type: 'Text', text: /^In/ })).toBeUndefined()
  await ui.unmount()
})

describe('squaresSvg', () => {
  test('lights one square a point in blocks of ten, in the level color, with the tick exactly at its share', () => {
    const svg = squaresSvg(36, 'warning', 0.835)
    expect(svg.match(/opacity=/g)).toHaveLength(36)
    // The squares ramp in their fill order across the blocks, from dim at the first to full at the newest.
    const shades = (svg.match(/opacity="([\d.]+)"/g) ?? []).map(o => Number(o.slice(9, -1)))
    expect(shades[0]).toBe(0.465)
    expect(shades.every((o, i) => i === 0 || o > (shades[i - 1] ?? 1))).toBe(true)
    expect(shades[35]).toBe(1)
    expect(svg.match(/rx="1.5"/g)).toHaveLength(10)
    expect(svg).toContain('fill="#e5b84b"')
    // 83.5%: 35% into the ninth block's track, which runs 72-79.
    expect(svg).toContain('class="tk" x="73.7"')
    // 96.7% sits two thirds into the last block, short of the end.
    expect(squaresSvg(0, 'success', 0.967)).toContain('class="tk" x="84.94"')
    expect(squaresSvg(0, 'success', 1)).toContain('class="tk" x="86.5"')
    expect(squaresSvg(0, 'success', null)).not.toContain('class="tk"')
    expect(squaresSvg(140, 'error', null).match(/opacity=/g)).toHaveLength(100)
  })
})

test('draws the bars as square grids on the desktop', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  const drawn = JSON.stringify(await ui.drawn())
  // 835k of 1M compacts 35% into the ninth block, where the tick stands.
  expect(drawn).toContain('class=\\"tk\\" x=\\"73.7\\"')
  expect(drawn).toContain('"alt":"context 36%"')
  expect(drawn).toContain('"alt":"5h limit 5%"')
  expect(await ui.find({ type: 'Text', text: /⣀/ })).toBeUndefined()
  await ui.unmount()
})
