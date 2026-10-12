import { expect, test } from 'claude-code/testing'

import { answerSession } from './session.tsx'

// A subagent's response moves the 5h window while the main session waits on
// it: the engine's push redraws the limit with no main-session step.
test('redraws the limits when the engine measures a window moving', async ($, on) => {
  answerSession(on)
  // The engine beneath echoes the units that moved.
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  expect(await ui.find({ type: 'Text', text: '5%' })).toBeDefined()

  await $.session.measure({
    context: { tokens: 360_000, window: 1_000_000, percent: 36 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    changed: ['rateLimits'],
  })
  expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5%' })).toBeUndefined()
  await ui.unmount()
})

// 12% of the 5h window used with 2h45m of it left: 45% of its time gone, so
// the tick stands before cell 5 of 10, after one full cell, two dots of the
// next and two cells of track.
test('draws a limit as a bar with a tick where the window stands, and the time to reset', async ($, on) => {
  const clock = answerSession(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  const now = clock.now()
  await $.session.measure({
    context: { tokens: 360_000, window: 1_000_000, percent: 36 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: new Date(now + 2.75 * 3_600_000).toISOString() }],
    changed: ['rateLimits'],
  })
  const texts = await ui.findAll({ type: 'Text' })
  const at = texts.findIndex(t => t.text === '12%')
  expect(texts.slice(at - 4, at).map(t => [t.props.color, t.text])).toEqual([
    ['success', '⣿⣀'],
    ['subtle', '⣀⣀⣀'],
    ['text', '|'],
    ['subtle', '⣀⣀⣀⣀⣀'],
  ])
  expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2h45m' })).toBeDefined()
  await ui.unmount()
})
