import { expect, test } from 'claude-code/testing'

import { answerSession, PR_JSON } from './session.tsx'

// While checks run the PR is read every 30 s. A reading gh fails keeps the
// last one up, dim, until a reading succeeds again.
test('draws the last PR reading dim while gh fails, and full again once it answers', async ($, on) => {
  let answer: string | { stderr: string } = PR_JSON
  const clock = answerSession(on, () => answer)
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /CI 1 failed/ }))?.props).toEqual({ color: 'error', dimColor: false })

  answer = { stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)' }
  await clock.advance(30_000)
  expect((await ui.find({ type: 'Text', text: /CI 1 failed/ }))?.props).toEqual({ color: 'error', dimColor: true })

  answer = PR_JSON
  await clock.advance(30_000)
  expect((await ui.find({ type: 'Text', text: /CI 1 failed/ }))?.props).toEqual({ color: 'error', dimColor: false })
  await ui.unmount()
})
