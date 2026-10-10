import { describe, expect, test } from 'claude-code/testing'

import { barCells, ctxLevel } from '../hooks/register.tsx'
import { answerSession } from './session.tsx'

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

describe('barCells', () => {
  test('fills the used share of 10 cells and puts the tick at the compact point', () => {
    expect(barCells(360_000, 1_000_000, 835_000)).toEqual({ filled: 4, mark: 8 })
    expect(barCells(0, 1_000_000, null)).toEqual({ filled: 0, mark: null })
  })

  test('keeps the tick inside the bar and the fill within it', () => {
    expect(barCells(1_200_000, 1_000_000, 1_000_000)).toEqual({ filled: 10, mark: 9 })
    // A 1M window compacts near 967k: the tick goes before the last cell, not on it.
    expect(barCells(338_000, 1_000_000, 967_000)).toEqual({ filled: 3, mark: 9 })
    expect(barCells(10, 0, 5)).toEqual({ filled: 0, mark: null })
  })
})

test('draws the bar with its compact tick and the tokens, without a percentage', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  // 360k of 1M: four dashes used (yellow at 36%), four free, the tick before
  // cell 8, and the two cells past it still drawn.
  expect(await ui.find({ type: 'Text', text: '----' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '|' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '--' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 360k/1M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '36%' })).toBeUndefined()
  await ui.unmount()
})
