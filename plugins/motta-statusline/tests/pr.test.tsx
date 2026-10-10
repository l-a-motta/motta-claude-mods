import { expect, test } from 'claude-code/testing'

import { answerSession, BAND_PROPS, PR_JSON } from './session.tsx'

// The mod keeps its readings in module state, so the two surfaces are drawn
// in one test, the terminal first, reading the PR afresh.
test("draws the branch's PR with its CI and conflicts, in the terminal and on the desktop", async ($, on) => {
  const clock = answerSession(on, PR_JSON)
  const terminal = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  expect(await terminal.find({ type: 'Text', text: /CI 1 failed/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /conflicts with main/ })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await desktop.find({ type: 'Text', text: /CI 1 failed/ })).toBeDefined()
  await desktop.unmount()
})

// While checks run the PR is read every 30 s; the reading that finds them
// all passed raises one toast.
test('raises a toast when the running checks all pass', async ($, on) => {
  const running = JSON.parse(PR_JSON)
  running.mergeable = 'MERGEABLE'
  running.mergeStateStatus = 'BLOCKED'
  running.statusCheckRollup = [{ __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: '' }]
  const passed = { ...running, statusCheckRollup: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
  let reading = running
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const clock = answerSession(on, () => JSON.stringify(reading))
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /CI 0\/1/ })).toBeDefined()

  reading = passed
  await clock.advance(30_000)
  expect(toasts).toEqual(['#482 ✓ all checks passed'])
  expect(await ui.find({ type: 'Text', text: /CI 1\/1/ })).toBeDefined()
  await ui.unmount()
})
