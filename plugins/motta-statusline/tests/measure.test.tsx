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
