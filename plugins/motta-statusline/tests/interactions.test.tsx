import { describe, expect, test } from 'claude-code/testing'

import { folderOpeners, projection, turnsToCompact } from '../hooks/register.tsx'
import { answerSession, BAND_PROPS, runs } from './session.tsx'

const HOUR = 3_600_000
const WORKTREE = { cwd: 'C:/code/vtex-copilot-fse/.claude/worktrees/ui-tweaks', status: '## feat/ui-tweaks...origin/feat/ui-tweaks [ahead 2]\n M manifest.json\n?? notes.md\n' }

describe('projection', () => {
  test('says where the pace so far ends, and when it is too early to tell', () => {
    expect(projection(19, 0.64, 5 * HOUR)).toBe('64% of the window gone · at this pace about 30% by the reset')
    expect(projection(40, 0.2, 5 * HOUR)).toBe('20% of the window gone · at this pace 100% in about 1h30m, before the reset')
    expect(projection(5, 0.01, 5 * HOUR)).toBe('1% of the window gone, too early to project')
    expect(projection(5, null, null)).toBe('')
  })
})

describe('turnsToCompact', () => {
  test('runs the average growth per turn on to the compact point', () => {
    expect(turnsToCompact({ compactAt: 900_000, ctxTokens: 300_000, turns: 30 })).toBe(60)
    expect(turnsToCompact({ compactAt: null, ctxTokens: 300_000, turns: 30 })).toBeNull()
    expect(turnsToCompact({ compactAt: 900_000, ctxTokens: 300_000, turns: 0 })).toBeNull()
  })
})

describe('folderOpeners', () => {
  test("opens a folder in the system's explorer, through start first on Windows", () => {
    expect(folderOpeners('C:/code/app')).toEqual([
      ['cmd', '/c', 'start', '""', 'C:\\code\\app'],
      ['explorer.exe', 'C:\\code\\app'],
    ])
    expect(folderOpeners('/home/me/app')).toEqual([['open', '/home/me/app'], ['xdg-open', '/home/me/app']])
  })
})

test('names the worktree, links the branch as a compare view, and opens the folder in the explorer', async ($, on) => {
  answerSession(on, null, 'nothing', WORKTREE)
  const band = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  // The name is the button; the icon before it an image on the desktop.
  expect((await band.find({ key: 'folder' }))?.props.label).toBe('ui-tweaks')
  expect(JSON.stringify(await band.drawn())).toContain('"alt":"folder"')
  // The repository it is a worktree of: a two-folder icon, then its name.
  expect(JSON.stringify(await band.drawn())).toContain('"alt":"worktree"')
  expect(await band.find({ type: 'Text', text: 'vtex-copilot-fse' })).toBeDefined()
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('https://github.com/o/vtex-copilot-fse/compare/main...feat/ui-tweaks')
  // Two commits to push, so the last one has no page yet: plain text, no link.
  expect(drawn).not.toContain('/commit/abc1234def')
  expect(await band.find({ type: 'Text', text: '↑2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '?1' })).toBeDefined()

  await band.press({ key: 'folder' })
  expect(runs.some(r => r.argv[2] === 'start' && r.argv.at(-1) === WORKTREE.cwd.replace(/\//g, '\\'))).toBe(true)
  await band.unmount()
})

test('marks a shell that a cd took below the root, and opens that folder', async ($, on) => {
  const root = 'C:/code/vtex-copilot-fse'
  answerSession(on, null, 'nothing', { root, cwd: `${root}/plugins/ui`, status: '## dev\n' })
  const band = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect((await band.find({ key: 'folder' }))?.props.label).toBe('vtex-copilot-fse')
  expect(await band.find({ type: 'Text', text: '↳' })).toBeDefined()
  expect((await band.find({ key: 'cwd' }))?.props.label).toBe('plugins/ui')
  await band.press({ key: 'cwd' })
  expect(runs.some(r => r.argv[2] === 'start' && r.argv.at(-1) === 'C:\\code\\vtex-copilot-fse\\plugins\\ui')).toBe(true)
  await band.unmount()
})

test('cycles the last slot through rate, cost, session and runway', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  const label = async () => (await ui.find({ key: 'slot' }))?.props.label
  expect(await label()).toBe('out')
  await ui.press({ key: 'slot' })
  expect(await label()).toBe('cost')
  await ui.press({ key: 'slot' })
  expect(await label()).toBe('session')
  await ui.press({ key: 'slot' })
  expect(await label()).toBe('compact')
  await ui.press({ key: 'slot' })
  expect(await label()).toBe('out')
  await ui.unmount()
})

test('toasts once when a limit turns orange, running ahead of its window', async ($, on) => {
  const clock = answerSession(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  const resetsAt = new Date(clock.now() + 4 * HOUR).toISOString()
  const measure = (percentUsed: number) =>
    $.session.measure({ context: { tokens: 360_000, window: 1_000_000, percent: 36 }, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }], changed: ['rateLimits'] })
  // 20% of the window gone: 25% is 5 points ahead, 35% is 15.
  await measure(25)
  await measure(35)
  await measure(36)
  expect(toasts).toEqual(['5h limit is 15 points ahead of its window: 20% of the window gone · at this pace 100% in about 1h51m, before the reset'])
  await ui.unmount()
})
