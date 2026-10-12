import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bandShare, liftBeside } from '../hooks/register.tsx'
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

test("lifts the chips a card holds back to the right of its lines, the card under them", async ($, on) => {
  answerSession(on, null, 'card-with-chips')
  const root = (await (await desktopBand($)).drawn()) as Node
  const [top, card] = root.children ?? []
  expect(top?.props?.flexDirection).toBe('row')
  expect(top?.children?.at(-1)?.props?.key).toBe('band-beside:prompt-enhancer')
  expect(card?.props?.key).toBe('band-under:savvy-progress')
  expect(card?.children?.map(c => c.props?.key)).toEqual(['savvy-card'])
})

describe('liftBeside', () => {
  test('takes the first chip column out of a nested tree, and nothing from a tree without one', () => {
    const chips = { type: 'Box', props: { key: 'band-beside:x' } }
    const tree = { type: 'Box', props: { key: 'band-under:y' }, children: [{ type: 'Box', props: {}, children: [{ type: 'Text' }, chips] }] }
    const { beside, rest } = liftBeside(tree as never)
    expect(beside).toBe(chips)
    expect(rest).toEqual({ type: 'Box', props: { key: 'band-under:y' }, children: [{ type: 'Box', props: {}, children: [{ type: 'Text' }] }] })
    const plain = { type: 'Box', children: [{ type: 'Text' }] }
    expect(liftBeside(plain as never)).toEqual({ rest: plain })
  })
})

test('gives the band to a tree that takes it', async ($, on) => {
  answerSession(on, null, 'taken')
  const band = await desktopBand($)
  expect(await band.find({ type: 'Text', text: 'Edit 1 of 3' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeUndefined()
})
