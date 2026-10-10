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
  test('fills the used share of 14 cells and puts the tick at the compact point', () => {
    expect(barCells(360_000, 1_000_000, 835_000)).toEqual({ filled: 5, mark: 12 })
    expect(barCells(0, 1_000_000, null)).toEqual({ filled: 0, mark: null })
  })

  test('keeps the tick inside the bar and the fill within it', () => {
    expect(barCells(1_200_000, 1_000_000, 1_000_000)).toEqual({ filled: 14, mark: 13 })
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
  // 360k of 1M: five cells used (yellow at 36%), the tick in cell 12.
  expect(await ui.find({ type: 'Text', text: '█████' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '·······' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '│' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 360k/1M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '36%' })).toBeUndefined()
  await ui.unmount()
})
