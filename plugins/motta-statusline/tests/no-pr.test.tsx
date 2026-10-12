import { expect, test } from 'claude-code/testing'

import { answerSession } from './session.tsx'

test('draws no PR segment when the branch has none', async ($, on) => {
  const clock = answerSession(on, null)
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  expect(await ui.find({ key: 'folder' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CI / })).toBeUndefined()
  await ui.unmount()
})
