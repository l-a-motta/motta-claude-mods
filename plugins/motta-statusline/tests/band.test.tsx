import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bandShare } from '../hooks/register.tsx'
import { answerSession, BAND_PROPS } from './session.tsx'

describe('bandShare', () => {
  test("reads how a tree beneath shares the band from its root Box's key", () => {
    expect(bandShare(null)).toBe('free')
    expect(bandShare({ type: 'engine', ref: 1 })).toBe('free')
    expect(bandShare({ type: 'Box', props: { key: 'band-beside:prompt-enhancer' } })).toBe('beside')
    expect(bandShare({ type: 'Box', props: { key: 'band-under:prompt-enhancer' } })).toBe('under')
    expect(bandShare({ type: 'Box', props: { flexDirection: 'column' } })).toBe('taken')
    expect(bandShare({ type: 'Text', props: { key: 'band-beside:x' } })).toBe('taken')
  })
})

// Mounted on the desktop, where the status line draws in the band, with a
// plugin beneath it drawing there too.
async function desktopBand($: Parameters<TestBody>[0]) {
  return $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
}

type Node = { type?: string; props?: { key?: string; flexDirection?: string }; children?: Node[] }

test("draws prompt-enhancer's chip at the right of its lines on the desktop", async ($, on) => {
  answerSession(on, null, 'chip')
  const band = await desktopBand($)
  expect(await band.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeDefined()
  expect(await band.find({ key: 'enhance' })).toBeDefined()

  const root = (await band.drawn()) as Node
  expect(root.props?.flexDirection).toBe('row')
  expect(root.children?.at(-1)?.props?.key).toBe('band-beside:prompt-enhancer')
})

test("draws prompt-enhancer's card under its lines", async ($, on) => {
  answerSession(on, null, 'card')
  const band = await desktopBand($)
  expect(await band.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '✦ Enhanced' })).toBeDefined()

  const root = (await band.drawn()) as Node
  expect(root.props?.flexDirection).toBe('column')
  expect(root.children?.at(-1)?.props?.key).toBe('band-under:prompt-enhancer')
})

test('gives the band to a tree that takes it, as replay-theater does', async ($, on) => {
  answerSession(on, null, 'taken')
  const band = await desktopBand($)
  expect(await band.find({ type: 'Text', text: 'Edit 1 of 3' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeUndefined()
})
